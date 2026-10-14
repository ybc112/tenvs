// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Context} from "./oz/Context.sol";
import {Ownable} from "./oz/Ownable.sol";
import {Ownable2Step} from "./oz/Ownable2Step.sol";
import {ReentrancyGuard} from "./oz/ReentrancyGuard.sol";
import {IERC20} from "./oz/IERC20.sol";
import {SafeERC20} from "./oz/SafeERC20.sol";

/**
 * @title VSAStaking — TVS 质押挖 VSA（VSA 质押挖矿合约）
 * @notice 质押币 = TVS（带税 BEP-20，按 balance-delta 实收记账），产出币 = VSA（零税 BEP-20）。
 *
 * 业务规则：
 *  - 质押周期 30 天(权重 1.0) / 90 天(1.5) / 270 天(2.5)，期内可强行解除（罚没未释放奖励）
 *  - 10 年产出总量精确 10,000,000 VSA，段位每日产出 5000/3500/2450/1715/末段，每段 730 天
 *  - 个人产出 = 段内产出 × (个人加权量 ÷ 全网加权总量)，O(1) 账本快照结算（严禁遍历用户）
 *  - 单地址加权质押量 ≤ 全网 10%（全网为空时跳过 = bootstrap）；结算窗口产出 ≤ 窗口产出 20%（超出部分暂存补发，不没收）
 *  - 领取 50% 立即到账 + 50% 锁 90 天线性释放（各笔独立窗口，勤领不重置他人进度；队列上限 200 笔，超出并入最新笔）
 *  - 复投 = 全部可领（立即半 + 锁仓已释放部分）+ 10% bonus（独立 bonusPool 账本，仅 owner 注资）
 *  - 到期解押退本金，奖励不受影响（先结算入 claimable，锁仓按原窗口继续释放）
 *  - 强行解除退本金，按该笔权重比例罚未领取 + 锁定中奖励（留在产出池账本，不消失）
 *
 * 安全红线（BEP-652 / CZ 实战经验）：
 *  - 全部写路径 O(1)，无遍历用户循环；BSC 单笔 gas 上限 16,777,216
 *  - 产出池记账式发放（rewardPool 账本），不依赖 balanceOf(this) 判断额度
 *  - 罚没奖励不消失：留在 rewardPool 账本内供全网产出
 *  - Ownable2Step：部署后转移给 Gnosis Safe 3/5（可再套 TimelockController 24h）
 *  - receive()/fallback() 空 payable 永不 revert；无交互费
 */
contract VSAStaking is Context, Ownable, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============================== 常量 ==============================

    /// @notice 质押币 TVS
    IERC20 public immutable TVS;
    /// @notice 产出币 VSA
    IERC20 public immutable VSA;

    /// @notice 产出起始锚点（部署时刻）
    uint64 public immutable startTime;

    /**
     * @notice 一个"业务日"的秒数。
     * @dev 主网部署固定 86400；测试网/本地可用更短值（如 60）把 30/90/270 天压缩成分钟级，
     *      便于在几小时内跑完全流程。所有周期/锁仓窗口均以该单位换算。
     */
    uint256 public immutable daySeconds;

    /// @notice 主网标准值（部署脚本强制校验）
    uint256 public constant MAINNET_DAY_SECONDS = 86400;
    /// @notice 每段天数（2 年）
    uint256 private constant SEG_DAYS = 730;
    /// @notice 总产出天数（10 年）
    uint256 private constant TOTAL_DAYS = 3650;
    /// @notice 领取锁仓释放窗口（90 个业务日）
    uint256 private constant LOCK_DAYS = 90;
    uint256 private constant WAD = 1e18;
    /// @notice accPerWeight 精度：acc += dE × ACC_SCALE / totalWeight（防大池小产出被 floor 归零）
    uint256 private constant ACC_SCALE = 1e30;

    /// @notice 单地址加权质押上限：全网 10%（bp）
    uint256 public constant STAKE_CAP_BPS = 1000;
    /// @notice 单地址结算窗口产出上限：窗口产出 20%（bp）
    uint256 public constant DAILY_CAP_BPS = 2000;
    /// @notice 复投额外奖励：+10%（bp）
    uint256 public constant REINVEST_BONUS_BPS = 1000;
    /// @notice 锁仓队列上限（超出时新锁并入最新一笔，加权平均起点、进度守恒）
    uint256 public constant MAX_LOCK_ENTRIES = 200;

    /// @notice 10 年总产出 = 10,000,000 VSA（wei 精确，测试断言 Σ段 = 此值）
    uint256 public constant TOTAL_EMISSION = 10_000_000 * 1e18;

    // ============================== 数据结构 ==============================

    /**
     * @notice 单笔质押记录（只管本金；奖励走用户级账本）
     * @dev owner/标志打包第 1 槽，principal/weight 各 1 槽，共 3 槽
     */
    struct StakeRecord {
        address owner; // 质押人
        uint64 startTime; // 起始时间
        uint64 maturityTime; // 到期时间 = startTime + 周期
        uint8 termIdx; // 周期档位 0/1/2
        bool isVsa; // true = 本金为 VSA（复投产生），false = TVS
        bool active; // 是否在押
        uint256 principal; // 本金（实收，wei）
        uint256 weight; // 加权量 = principal × 档位倍率（WAD）
    }

    /**
     * @notice 锁仓队列条目：各笔独立 90 天线性释放（勤领不重置他人进度）
     * @dev scanned = 本笔已离开待领状态的量（已领取 + 强解罚没），防止重复发放
     */
    struct LockEntry {
        uint128 amount; // 本笔锁定量
        uint64 start; // 线性释放起点
        uint128 scanned; // 已领取/已罚没部分
    }

    /**
     * @notice 用户级账本（skill §3.2 账本快照模式）
     */
    struct UserInfo {
        uint256 weighted; // Σ在押权重（WAD）
        uint256 accPaid; // 已结算锚点（不变量 accPaid == weighted × accPerWeight / SCALE）
        uint256 claimable; // 已结算待领（解押/强解时入库）
        uint256 deferred; // 被 20% 上限暂存的产出（份额回落后自动补发，不没收）
        uint64 lastCapSettle; // 20% 产出上限窗口锚点
        LockEntry[] locks; // 锁仓队列（各笔独立窗口）
        uint256 lockCursor; // 头部已完结笔数（扫除优化）
        uint256[] stakeIds; // 全部质押记录 id（含已退出的，前端按 active 过滤）
    }

    mapping(address => UserInfo) private _users;
    mapping(uint256 => StakeRecord) private _records;
    uint256 private _stakeCount; // 记录 id 从 1 开始

    // 全局账本
    uint256 public accPerWeight; // 累计每单位权重产出（WAD）
    uint64 public lastGlobalSettle; // 全局上次结算时间
    uint256 public totalWeight; // 全网加权总量（WAD）

    // 资金账本（记账式，勿用 balanceOf 判断额度）
    uint256 public rewardPool; // 产出池：全网奖励发放额度
    uint256 public bonusPool; // 复投奖池：+10% bonus 额度
    uint256 public totalStakedTvs; // 全网 TVS 在押本金
    uint256 public totalStakedVsa; // 全网 VSA 在押本金（复投产生）

    // ============================== 错误与事件 ==============================

    error ZeroAmount();
    error BadTerm();
    error NotRecordOwner();
    error RecordInactive();
    error NotMatured();
    error MustUseUnstake(); // 已到期应走 unstake，不应强解
    error CapTenPercentExceeded();
    error NothingToClaim();
    error InsufficientRewardPool();
    error InsufficientBonusPool();
    error TokenProhibited(); // 禁止回收 VSA（产出池资金红线）
    error RecoverExceedsFreeBalance(); // TVS 可回收量不得超过「余额 − 在押本金」

    event Staked(address indexed user, uint256 indexed stakeId, uint256 principal, uint256 weight, uint8 termIdx, bool isVsa);
    event Claimed(address indexed user, uint256 immediate, uint256 lockedAdded, uint256 swept);
    event Reinvested(address indexed user, uint256 indexed newStakeId, uint256 principal, uint256 bonus, uint8 termIdx);
    event Unstaked(address indexed user, uint256 indexed stakeId, uint256 principal, bool isVsa);
    event EmergencyUnstaked(address indexed user, uint256 indexed stakeId, uint256 principal, uint256 forfeited, bool isVsa);
    event PoolFunded(uint256 rewardAmount, uint256 bonusAmount);

    // ============================== 构造 ==============================

    /**
     * @param tvs 质押币 TVS
     * @param vsa 产出币 VSA
     * @param initialOwner 初始 owner（部署后应 transferOwnership 给 Gnosis Safe）
     * @param daySeconds_ 一个业务日的秒数；主网传 86400，测试网可传 60 等短值
     */
    constructor(address tvs, address vsa, address initialOwner, uint256 daySeconds_) Ownable(initialOwner) {
        if (tvs == address(0) || vsa == address(0)) revert ZeroAmount();
        if (daySeconds_ == 0) revert ZeroAmount();
        TVS = IERC20(tvs);
        VSA = IERC20(vsa);
        daySeconds = daySeconds_;
        startTime = uint64(block.timestamp);
        lastGlobalSettle = uint64(block.timestamp);
    }

    // ============================== 产出函数 E(t) ==============================

    /**
     * @notice 段位信息：cumBefore = 段前累计产出；amount = 段内总产出
     * @dev 段内线性：E = cumBefore + dayInSeg × amount × WAD / SEG_DAYS（先乘后除，段界 wei 精确）
     *      每段 730 天，段合计：365 万 / 255.5 万 / 178.85 万 / 125.195 万 / 75.455 万 = 1000 万
     */
    function _segInfo(uint256 seg) internal pure returns (uint256 cumBefore, uint256 amount) {
        if (seg == 0) return (0, 3_650_000 * 1e18);
        if (seg == 1) return (3_650_000 * 1e18, 2_555_000 * 1e18);
        if (seg == 2) return (6_205_000 * 1e18, 1_788_500 * 1e18);
        if (seg == 3) return (7_993_500 * 1e18, 1_251_950 * 1e18);
        return (9_245_450 * 1e18, 754_550 * 1e18);
    }

    /**
     * @notice 累计产出函数 E(t)：按"整日"阶梯累计，段内 telescoping，E(3650) = TOTAL_EMISSION wei 精确
     */
    function _emission(uint256 t) internal view returns (uint256) {
        if (t <= startTime) return 0;
        uint256 day = (t - startTime) / daySeconds;
        if (day >= TOTAL_DAYS) return TOTAL_EMISSION;
        uint256 seg = day / SEG_DAYS; // 0..4
        uint256 dayInSeg = day % SEG_DAYS;
        (uint256 cumBefore, uint256 amount) = _segInfo(seg);
        return cumBefore + (dayInSeg * amount) / SEG_DAYS;
    }

    /// @notice 当前第几天（0..3650，封顶）
    function dayIndex() public view returns (uint256) {
        if (block.timestamp <= startTime) return 0;
        uint256 day = (block.timestamp - startTime) / daySeconds;
        return day > TOTAL_DAYS ? TOTAL_DAYS : day;
    }

    /// @notice 指定时刻的累计产出 E(t)（视图，测试与前端进度用）
    function emissionAt(uint256 t) external view returns (uint256) {
        return _emission(t);
    }

    /// @notice 当前段位今日名义日产出（展示用；末段为线性均值 ≈1033.63/日）
    function currentDailyEmission() external view returns (uint256) {
        uint256 day = dayIndex();
        if (day >= TOTAL_DAYS) return 0;
        (, uint256 amount) = _segInfo(day / SEG_DAYS);
        return amount / SEG_DAYS;
    }

    // ============================== 档位 ==============================

    /// @notice 档位定义：0 = 30 天/1.0 倍，1 = 90 天/1.5 倍，2 = 270 天/2.5 倍
    /// @return duration_ 质押时长（秒，= 天数 × daySeconds）
    function termInfo(uint8 termIdx) external view returns (uint256 duration_, uint256 weightMultiplier) {
        if (termIdx == 0) return (30 * daySeconds, WAD);
        if (termIdx == 1) return (90 * daySeconds, (15 * WAD) / 10);
        if (termIdx == 2) return (270 * daySeconds, (25 * WAD) / 10);
        revert BadTerm();
    }

    function _term(uint8 termIdx) internal view returns (uint256 duration_, uint256 weightMultiplier) {
        if (termIdx == 0) return (30 * daySeconds, WAD);
        if (termIdx == 1) return (90 * daySeconds, (15 * WAD) / 10);
        if (termIdx == 2) return (270 * daySeconds, (25 * WAD) / 10);
        revert BadTerm();
    }

    // ============================== 账本结算（全部 O(1)） ==============================

    /**
     * @notice 全局惰性结算：accPerWeight 前进到 now。任何触碰状态的操作先调本函数
     */
    function _updateGlobal(uint256 t) internal {
        uint256 dE = _emission(t) - _emission(lastGlobalSettle);
        if (totalWeight > 0 && dE > 0) {
            accPerWeight += (dE * ACC_SCALE) / totalWeight;
        }
        lastGlobalSettle = uint64(t);
    }

    /**
     * @notice 用户 raw 待领 = weighted × accPerWeight / ACC_SCALE − accPaid（weighted > 0 时有效）
     */
    function _rawPending(UserInfo storage u) internal view returns (uint256) {
        if (u.weighted == 0) return 0;
        return (u.weighted * accPerWeight) / ACC_SCALE - u.accPaid;
    }

    /**
     * @notice 20% 窗口上限 = DAILY_CAP_BPS% × (E(now) − E(锚点))，跨段由 E 自动处理
     */
    function _windowCap(UserInfo storage u, uint256 t) internal view returns (uint256) {
        uint256 dE = _emission(t) - _emission(u.lastCapSettle);
        return (dE * DAILY_CAP_BPS) / 10000;
    }

    /**
     * @notice 锁仓队列扫描：累计「已释放未领取」部分（各笔独立进度，幂等重算）
     * @dev 遍历上限 = MAX_LOCK_ENTRIES(200)，gas 有界；完全扫出的头部笔推进 cursor
     */
    function _sweepLocks(UserInfo storage u, uint256 t) internal returns (uint256 released) {
        uint256 window = LOCK_DAYS * daySeconds;
        uint256 len = u.locks.length;
        for (uint256 i = u.lockCursor; i < len; i += 1) {
            LockEntry storage e = u.locks[i];
            if (e.amount == 0) continue;
            uint256 elapsed = t > e.start ? t - e.start : 0;
            uint256 rel = elapsed >= window ? e.amount : (uint256(e.amount) * elapsed) / window;
            if (rel > e.scanned) {
                released += rel - e.scanned;
                e.scanned = uint128(rel);
            }
            if (rel == e.amount && e.scanned == e.amount) {
                // 本笔已全额离开待领状态：头部笔推进 cursor（中间笔清零跳过）
                if (i == u.lockCursor) {
                    u.lockCursor = i + 1;
                } else {
                    e.amount = 0;
                }
            }
        }
    }

    /**
     * @notice 用户结算：raw 按 20% 窗口封顶后入 claimable，accPaid 记为「当前权重对应的应得总额」
     * @dev 仅在 claim/reinvest/stake/unstake/emergencyUnstake 中调用；推进 lastCapSettle。
     *      结算后满足不变量 accPaid == weighted × accPerWeight / ACC_SCALE，
     *      故权重变更（增/减）后必须再次调用 _reanchor，否则会欠账下溢或追溯多计。
     */
    function _settleUser(UserInfo storage u, uint256 t) internal {
        uint256 raw = _rawPending(u);
        uint256 cap = _windowCap(u, t);
        if (raw > cap) {
            u.claimable += cap;
            u.deferred += raw - cap; // 暂存，份额回落后补发
        } else {
            u.claimable += raw;
            if (u.deferred > 0) {
                if (_emission(t) >= TOTAL_EMISSION) {
                    // 产出已结束：限速失去意义，暂存一次性补发（不没收）
                    u.claimable += u.deferred;
                    u.deferred = 0;
                } else {
                    uint256 spare = cap - raw;
                    if (spare > 0) {
                        uint256 payback = u.deferred <= spare ? u.deferred : spare;
                        u.deferred -= payback;
                        u.claimable += payback;
                    }
                }
            }
        }
        u.accPaid = (u.weighted * accPerWeight) / ACC_SCALE;
        u.lastCapSettle = uint64(t);
    }

    /**
     * @notice 权重变更后重锚定 accPaid（关键安全不变量）
     * @dev raw = weighted×acc/SCALE − accPaid 要求 accPaid 始终等于「当前权重在当前 acc 下的应得额」。
     *      质押加权重后不重锚定 → 新仓位追溯领取历史产出；
     *      解押减权重后不重锚定 → 剩余仓位 raw 变负，_rawPending 下溢，账户永久无法领取。
     */
    function _reanchor(UserInfo storage u) internal {
        u.accPaid = (u.weighted * accPerWeight) / ACC_SCALE;
    }

    // ============================== 质押 ==============================

    /**
     * @notice 质押 TVS。带税代币按 balance-delta 实收记账；全网为空时跳过 10% 上限（bootstrap）
     */
    function stake(uint256 amount, uint8 termIdx) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        (uint256 duration, uint256 mult) = _term(termIdx);

        uint256 t = block.timestamp;
        _updateGlobal(t);

        // balance-delta 实收（防带税代币少收虚记）
        uint256 balBefore = TVS.balanceOf(address(this));
        TVS.safeTransferFrom(_msgSender(), address(this), amount);
        uint256 received = TVS.balanceOf(address(this)) - balBefore;
        if (received == 0) revert ZeroAmount();

        UserInfo storage u = _users[_msgSender()];
        uint256 weight = received * mult;

        // 单地址 ≤ 全网 10%（用加权量；totalWeight == 0 时 bootstrap 跳过）
        if (totalWeight != 0) {
            if ((u.weighted + weight) * 10000 > (totalWeight + weight) * STAKE_CAP_BPS) {
                revert CapTenPercentExceeded();
            }
        }

        uint256 id = ++_stakeCount;
        StakeRecord storage r = _records[id];
        r.owner = _msgSender();
        r.startTime = uint64(t);
        r.maturityTime = uint64(t + duration);
        r.termIdx = termIdx;
        r.isVsa = false;
        r.active = true;
        r.principal = received;
        r.weight = weight;

        _settleUser(u, t); // 先按旧权重结算（新地址 raw = 0）
        u.weighted += weight;
        _reanchor(u); // 防止新仓位追溯领取历史产出
        u.stakeIds.push(id);
        totalWeight += weight;
        totalStakedTvs += received;

        emit Staked(_msgSender(), id, received, weight, termIdx, false);
    }

    // ============================== 领取 / 复投 ==============================

    /**
     * @notice 结算 + 锁仓扫描 + 新锁入队（claim/reinvest 共用）
     * @return transferable 可领总额 = (claimable 含补发) ÷ 2 + 锁仓已释放
     * @return lockedAdded 本次新并入锁仓的部分
     * @return released 锁仓已释放部分（随本次一并转出）
     */
    function _sweepClaimable(UserInfo storage u, uint256 t)
        internal
        returns (uint256 transferable, uint256 lockedAdded, uint256 released)
    {
        _settleUser(u, t);
        released = _sweepLocks(u, t);
        uint256 half = u.claimable / 2;
        transferable = half + released;
        lockedAdded = u.claimable - half;
        u.claimable = 0;
        if (lockedAdded > 0) {
            if (u.locks.length - u.lockCursor >= MAX_LOCK_ENTRIES) {
                // 队列满：并入最新一笔（加权平均起点，线性段内进度守恒）
                LockEntry storage last = u.locks[u.locks.length - 1];
                uint256 la = last.amount;
                last.start = uint64((uint256(la) * last.start + lockedAdded * t) / (la + lockedAdded));
                last.amount = uint128(la + lockedAdded);
            } else {
                u.locks.push(LockEntry(uint128(lockedAdded), uint64(t), 0));
            }
        }
    }

    /**
     * @notice 领取：可领 = (claimable 含补发) ÷ 2 立即到账 + 锁仓已释放部分；
     *         新的 50% 作为独立一笔进入 90 天线性释放队列
     */
    function claim() external nonReentrant {
        _claimFor(_msgSender());
    }

    /**
     * @notice 兼容需求书接口：按 stakeId 领取（实际为账户级结算，任意一笔在押记录均可调用）
     */
    function claimRewards(uint256 stakeId) external nonReentrant {
        StakeRecord storage r = _records[stakeId];
        if (r.owner != _msgSender()) revert NotRecordOwner();
        if (!r.active) revert RecordInactive();
        _claimFor(_msgSender());
    }

    function _claimFor(address user) internal {
        uint256 t = block.timestamp;
        _updateGlobal(t);
        UserInfo storage u = _users[user];
        (uint256 transferable, uint256 lockedAdded, uint256 released) = _sweepClaimable(u, t);
        if (transferable == 0) revert NothingToClaim();
        if (rewardPool < transferable) revert InsufficientRewardPool();

        rewardPool -= transferable;
        VSA.safeTransfer(user, transferable);
        emit Claimed(user, transferable, lockedAdded, released);
    }

    /**
     * @notice 复投：全部可领（立即半 + 锁仓已释放）+ 10% bonus（bonusPool 账本）
     *         合成一笔新 VSA 本金质押（1 VSA = 1 权重基准 × 档位倍率），到期解押退 VSA
     */
    function reinvest(uint8 termIdx) external nonReentrant returns (uint256 newStakeId) {
        (uint256 duration, uint256 mult) = _term(termIdx);
        uint256 t = block.timestamp;
        _updateGlobal(t);
        UserInfo storage u = _users[_msgSender()];
        uint256 transferable;
        (transferable, , ) = _sweepClaimable(u, t);
        if (transferable == 0) revert NothingToClaim();
        if (rewardPool < transferable) revert InsufficientRewardPool();

        uint256 bonus = (transferable * REINVEST_BONUS_BPS) / 10000;
        if (bonusPool < bonus) revert InsufficientBonusPool();

        rewardPool -= transferable;
        bonusPool -= bonus;

        uint256 principal = transferable + bonus;
        uint256 weight = principal * mult;

        // 新质押同样受 10% 上限约束
        if (totalWeight != 0) {
            if ((u.weighted + weight) * 10000 > (totalWeight + weight) * STAKE_CAP_BPS) {
                revert CapTenPercentExceeded();
            }
        }

        newStakeId = ++_stakeCount;
        StakeRecord storage r = _records[newStakeId];
        r.owner = _msgSender();
        r.startTime = uint64(t);
        r.maturityTime = uint64(t + duration);
        r.termIdx = termIdx;
        r.isVsa = true;
        r.active = true;
        r.principal = principal;
        r.weight = weight;

        u.weighted += weight;
        _reanchor(u); // 复投新增权重后重锚定
        u.stakeIds.push(newStakeId);
        totalWeight += weight;
        totalStakedVsa += principal;

        emit Reinvested(_msgSender(), newStakeId, principal, bonus, termIdx);
    }

    // ============================== 解押 ==============================

    /**
     * @notice 到期解押：退本金（TVS 记录退 TVS / VSA 记录退 VSA）；奖励先结算入 claimable，可续领
     */
    function unstake(uint256 stakeId) external nonReentrant {
        StakeRecord storage r = _records[stakeId];
        if (r.owner != _msgSender()) revert NotRecordOwner();
        if (!r.active) revert RecordInactive();
        if (block.timestamp < r.maturityTime) revert NotMatured();

        uint256 t = block.timestamp;
        _updateGlobal(t);
        UserInfo storage u = _users[_msgSender()];
        _settleUser(u, t);

        uint256 weight = r.weight;
        uint256 principal = r.principal;
        bool isVsa = r.isVsa;

        r.active = false;
        r.principal = 0;
        r.weight = 0;

        u.weighted -= weight;
        _reanchor(u); // 减权重后重锚定，防止剩余仓位 raw 下溢
        totalWeight -= weight;
        if (isVsa) {
            totalStakedVsa -= principal;
        } else {
            totalStakedTvs -= principal;
        }

        if (isVsa) {
            VSA.safeTransfer(_msgSender(), principal);
        } else {
            TVS.safeTransfer(_msgSender(), principal);
        }
        emit Unstaked(_msgSender(), stakeId, principal, isVsa);
    }

    /**
     * @notice 强行解除（期内）：退本金；按该笔权重比例罚没 claimable + 锁定中奖励
     *         （留在 rewardPool 账本内，不消失）；已到期请走 unstake
     */
    function emergencyUnstake(uint256 stakeId) external nonReentrant {
        StakeRecord storage r = _records[stakeId];
        if (r.owner != _msgSender()) revert NotRecordOwner();
        if (!r.active) revert RecordInactive();
        if (block.timestamp >= r.maturityTime) revert MustUseUnstake();

        uint256 t = block.timestamp;
        _updateGlobal(t);
        UserInfo storage u = _users[_msgSender()];
        _settleUser(u, t);

        uint256 weight = r.weight;
        uint256 principal = r.principal;
        bool isVsa = r.isVsa;

        // 比例罚没（分母 = 全部在押权重，必 > 0 因 weight 在押）
        uint256 rBps = (weight * 10000) / u.weighted;
        uint256 fClaimable = (u.claimable * weight) / u.weighted;
        uint256 fDeferred = (u.deferred * weight) / u.weighted;
        u.claimable -= fClaimable;
        u.deferred -= fDeferred;
        // 锁仓队列逐笔按比例缩减（未领取部分 a − s 罚 rBps，进度自动保持）
        uint256 fLocked = 0;
        uint256 len = u.locks.length;
        for (uint256 i = u.lockCursor; i < len; i += 1) {
            LockEntry storage e = u.locks[i];
            if (e.amount == 0) continue;
            uint256 cut = ((uint256(e.amount) - e.scanned) * rBps) / 10000;
            if (cut > 0) {
                e.amount = uint128(uint256(e.amount) - cut);
                fLocked += cut;
            }
        }
        uint256 forfeited = fClaimable + fDeferred + fLocked;

        r.active = false;
        r.principal = 0;
        r.weight = 0;

        u.weighted -= weight;
        _reanchor(u); // 减权重后重锚定，防止剩余仓位 raw 下溢
        totalWeight -= weight;
        if (isVsa) {
            totalStakedVsa -= principal;
        } else {
            totalStakedTvs -= principal;
        }

        if (isVsa) {
            VSA.safeTransfer(_msgSender(), principal);
        } else {
            TVS.safeTransfer(_msgSender(), principal);
        }
        emit EmergencyUnstaked(_msgSender(), stakeId, principal, forfeited, isVsa);
    }

    // ============================== 视图 ==============================

    function userInfo(address user)
        external
        view
        returns (
            uint256 weighted,
            uint256 claimable,
            uint256 deferred,
            uint256[] memory stakeIds
        )
    {
        UserInfo storage u = _users[user];
        return (u.weighted, u.claimable, u.deferred, u.stakeIds);
    }

    function records(uint256 stakeId) external view returns (StakeRecord memory) {
        return _records[stakeId];
    }

    function stakeCount() external view returns (uint256) {
        return _stakeCount;
    }

    function getUserStakes(address user) external view returns (uint256[] memory) {
        return _users[user].stakeIds;
    }

    /**
     * @notice 锁仓队列统计（前端画各笔进度 / 检查笔数上限）
     * @return entryCount 未完结笔数
     * @return totalLockedRemaining 锁定中（未释放）总额
     * @return totalReleasedPending 已释放未领取总额
     */
    function lockStats(address user)
        external
        view
        returns (uint256 entryCount, uint256 totalLockedRemaining, uint256 totalReleasedPending)
    {
        UserInfo storage u = _users[user];
        uint256 window = LOCK_DAYS * daySeconds;
        uint256 t = block.timestamp;
        uint256 len = u.locks.length;
        for (uint256 i = u.lockCursor; i < len; i += 1) {
            LockEntry storage e = u.locks[i];
            if (e.amount == 0) continue;
            entryCount += 1;
            uint256 elapsed = t > e.start ? t - e.start : 0;
            uint256 rel = elapsed >= window ? e.amount : (uint256(e.amount) * elapsed) / window;
            totalLockedRemaining += e.amount - rel;
            if (rel > e.scanned) totalReleasedPending += rel - e.scanned;
        }
    }

    /**
     * @notice 兼容需求书接口：按 stakeId 查询待领产出
     * @dev 奖励为账户级账本（非按笔独立），故返回该记录所有者当前的待领总额；
     *      记录不存在或已退出返回 0
     */
    function pendingRewards(uint256 stakeId) external view returns (uint256) {
        StakeRecord storage r = _records[stakeId];
        if (r.owner == address(0) || !r.active) return 0;
        return _pendingRawOf(r.owner, block.timestamp);
    }

    /**
     * @notice 指定账户在 t 时刻的待领产出（视图内模拟全局推进 + 20% 限速 + 暂存补发，不改状态）
     */
    function _pendingRawOf(address user, uint256 t) internal view returns (uint256) {
        UserInfo storage u = _users[user];
        uint256 acc = accPerWeight;
        if (totalWeight > 0) {
            uint256 dE = _emission(t) - _emission(lastGlobalSettle);
            acc += (dE * ACC_SCALE) / totalWeight;
        }
        uint256 raw = u.weighted > 0 ? (u.weighted * acc) / ACC_SCALE - u.accPaid : 0;
        uint256 cap = _windowCap(u, t);
        uint256 take;
        if (raw > cap) {
            take = cap;
        } else if (u.deferred > 0) {
            if (_emission(t) >= TOTAL_EMISSION) {
                take = raw + u.deferred; // 产出已结束：一次性补发
            } else {
                uint256 spare = cap - raw;
                take = raw + (u.deferred <= spare ? u.deferred : spare);
            }
        } else {
            take = raw;
        }
        return u.claimable + take;
    }

    /**
     * @notice 用户待领概览（视图内模拟全局结算与 20% 限速）
     * @return pendingRaw 未领取产出（claimable + 本窗口结算 + 本次可补发，限速后口径）
     * @return claimableNow 现在领取可立即到账 = pendingRaw ÷ 2 + 锁仓已释放
     * @return lockedTotal 锁定中总额（未释放部分，各笔独立窗口）
     * @return lockedReleased 锁仓已释放未领取部分
     */
    function pendingOf(address user)
        external
        view
        returns (uint256 pendingRaw, uint256 claimableNow, uint256 lockedTotal, uint256 lockedReleased)
    {
        uint256 t = block.timestamp;
        pendingRaw = _pendingRawOf(user, t);
        (, lockedTotal, lockedReleased) = this.lockStats(user);
        claimableNow = pendingRaw / 2 + lockedReleased;
    }

    /**
     * @notice 池盈余 = 合约 VSA 余额 − 产出池 − 复投奖池 − 复投形成的 VSA 在押本金
     * @dev 必须扣除 totalStakedVsa：复投本金来自产出池（已扣账）但代币仍留存于本合约，
     *      不扣除会把「用户本金」误算成可支配盈余
     */
    function poolSurplus() external view returns (uint256) {
        return VSA.balanceOf(address(this)) - rewardPool - bonusPool - totalStakedVsa;
    }

    // ============================== 管理（部署后转 Gnosis Safe） ==============================

    /**
     * @notice 注资产出池：仅 owner（未来 = Safe 多签）。transferFrom + 账本记账
     */
    function fundRewardPool(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        VSA.safeTransferFrom(_msgSender(), address(this), amount);
        rewardPool += amount;
        emit PoolFunded(amount, 0);
    }

    /**
     * @notice 注资复投奖池：仅 owner（未来 = Safe 多签）
     */
    function fundBonusPool(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        VSA.safeTransferFrom(_msgSender(), address(this), amount);
        bonusPool += amount;
        emit PoolFunded(0, amount);
    }

    /**
     * @notice 回收误入合约的代币（红线：VSA 永不可回收，产出池资金只能发给质押用户）
     * @dev TVS 仅可回收「余额 − 在押本金」的盈余部分，防止误操作/私钥泄露卷走质押者本金
     */
    function recoverWrongToken(address token, uint256 amount) external onlyOwner nonReentrant {
        if (token == address(VSA)) revert TokenProhibited();
        if (token == address(TVS) && amount > TVS.balanceOf(address(this)) - totalStakedTvs) {
            revert RecoverExceedsFreeBalance();
        }
        IERC20(token).safeTransfer(owner(), amount);
    }

    /// @notice BNB 误入永不 revert（CZ 经验：避免意外进币打挂用户操作）
    receive() external payable {}
    fallback() external payable {}
}
