// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Context} from "./oz/Context.sol";
import {Ownable} from "./oz/Ownable.sol";
import {Ownable2Step} from "./oz/Ownable2Step.sol";
import {ReentrancyGuard} from "./oz/ReentrancyGuard.sol";
import {IERC20} from "./oz/IERC20.sol";
import {SafeERC20} from "./oz/SafeERC20.sol";

/**
 * @title TokenDistributor — 通用 BEP-20 代币分发（锁仓释放）合约
 * @notice 把 TGE 后的预留份额锁进本合约，按「TGE 即时 + cliff + 线性」日程释放给各多签/受益人。
 *         日程写死后受益人只能按计划领取；owner 可撤销 revocable 日程，把未解锁部分收回金库。
 *
 * 业务规则：
 *  - owner 创建日程：{token, beneficiary, total, start, cliff, linearDuration, tgeBps, revocable}
 *  - 一体化注资：createSchedule 内 transferFrom 并按 balance-delta 实收记账（防带税代币虚记）
 *  - 解锁曲线：tgePart = total × tgeBps / 1e4 于 start 即解锁；
 *    linearTotal = total − tgePart（单次取整，期末 vested == total wei 精确）在 start + cliff 后
 *    按 linearDuration 线性解锁；linearDuration == 0 表示 cliff 到点后一次性整额解锁
 *  - release：受益人或任何人触发，O(1)；batchRelease 聚合领取本人全部日程
 *  - revoke：仅 owner、仅 revocable。撤销即结清：已解锁未领部分发给受益人，
 *    未解锁部分退回 owner；此后日程关闭不可再领
 *  - recoverWrongToken 仅可回收「余额 − 未清义务」的盈余，用户资产红线不可触碰
 *
 * 安全红线：
 *  - 无暂停功能：allocated 封顶已保证合约内代币只够兑付日程，无盗取面
 *  - 带税代币：入金按实收记账；若代币有出金税，请在代币侧把本合约加入豁免名单
 *  - Ownable2Step：部署后 transferOwnership 给治理多签（社区自治核心），Safe 执行 acceptOwnership
 */
contract TokenDistributor is Context, Ownable, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============================== 数据结构 ==============================

    /**
     * @notice 释放日程（4 槽：token / beneficiary / total+released / 时间与标志）
     * @dev total = 实收代币（createSchedule 按 balance-delta 记账）；released = 已交付
     */
    struct Schedule {
        address token; // 分发代币
        address beneficiary; // 受益人（多签）
        uint128 total; // 本日程总量（实收）
        uint128 released; // 已释放（含撤销结清部分）
        uint64 start; // 解锁起点（可为过去时刻）
        uint64 cliff; // 线性起点延迟（秒）
        uint32 linearDuration; // 线性期（秒）；0 = cliff 到点一次性解锁
        uint16 tgeBps; // TGE 即时解锁比例（bp，≤ 1e4）
        bool revocable; // 是否允许 owner 撤销
        bool revoked; // 已撤销（结清后关闭）
    }

    Schedule[] private _schedules;
    mapping(address => uint256[]) private _schedulesOf;
    mapping(address => uint256) public allocated; // token => 未清义务 Σ(total − released − 已退回)
    uint256 public scheduleCount; // 日程总数（id 从 0 递增）

    // ============================== 错误与事件 ==============================

    error ZeroAddress();
    error ZeroAmount();
    error BadTgeBps(); // tgeBps > 1e4
    error TooLarge(); // 实收超出 uint128
    error NoSuchSchedule();
    error NothingToRelease();
    error NotRevocable();
    error AlreadyRevoked();
    error NothingToRevoke();
    error ExceedsSurplus(); // 回收量超过盈余
    error BnbTransferFailed();

    event ScheduleCreated(
        uint256 indexed id,
        address indexed token,
        address indexed beneficiary,
        uint256 total,
        uint64 start,
        uint64 cliff,
        uint32 linearDuration,
        uint16 tgeBps,
        bool revocable
    );
    event Released(uint256 indexed id, address indexed beneficiary, uint256 amount);
    event ScheduleRevoked(uint256 indexed id, uint256 paidToBeneficiary, uint256 refunded);
    event BnbRecovered(uint256 amount);

    // ============================== 构造 ==============================

    constructor(address initialOwner) Ownable(initialOwner) {}

    // ============================== 创建日程 ==============================

    /**
     * @notice 创建日程并一体化注资（owner 须先对该代币 approve）
     * @param token 分发代币
     * @param beneficiary 受益人（多签地址）
     * @param total 意图锁定量（实收为准：带税代币按 balance-delta 记账）
     * @param start 解锁起点（可为过去时刻 = 立即生效）
     * @param cliff 线性期前的延迟（秒）
     * @param linearDuration 线性释放期（秒）；0 = cliff 到点一次性解锁 linearTotal
     * @param tgeBps TGE 即时解锁比例（bp）
     * @param revocable 是否允许 owner 撤销
     */
    function createSchedule(
        address token,
        address beneficiary,
        uint256 total,
        uint64 start,
        uint64 cliff,
        uint32 linearDuration,
        uint16 tgeBps,
        bool revocable
    ) external onlyOwner nonReentrant returns (uint256 id) {
        if (token == address(0) || beneficiary == address(0)) revert ZeroAddress();
        if (total == 0) revert ZeroAmount();
        if (tgeBps > 1e4) revert BadTgeBps();

        // balance-delta 实收记账（防带税代币少收虚记）
        uint256 balBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(_msgSender(), address(this), total);
        uint256 received = IERC20(token).balanceOf(address(this)) - balBefore;
        if (received == 0) revert ZeroAmount();
        if (received > type(uint128).max) revert TooLarge();

        Schedule storage s = _schedules.push();
        s.token = token;
        s.beneficiary = beneficiary;
        s.total = uint128(received);
        s.start = start;
        s.cliff = cliff;
        s.linearDuration = linearDuration;
        s.tgeBps = tgeBps;
        s.revocable = revocable;

        allocated[token] += received;
        id = scheduleCount;
        scheduleCount = id + 1;
        _schedulesOf[beneficiary].push(id);

        emit ScheduleCreated(id, token, beneficiary, received, start, cliff, linearDuration, tgeBps, revocable);
    }

    // ============================== 领取 ==============================

    /**
     * @notice 领取单条日程已解锁未领部分（受益人或任何人可触发，gas 恒定）
     */
    function release(uint256 id) external nonReentrant returns (uint256 amount) {
        if (id >= scheduleCount) revert NoSuchSchedule();
        Schedule storage s = _schedules[id];
        amount = _releasable(s);
        if (amount == 0) revert NothingToRelease();

        s.released += uint128(amount);
        allocated[s.token] -= amount;
        IERC20(s.token).safeTransfer(s.beneficiary, amount);
        emit Released(id, s.beneficiary, amount);
    }

    /**
     * @notice 聚合领取受益人全部日程（跳过无可领条目；gas 随本人日程数线性，
     *         与 VSAStaking 的 O(1) 红线不同：此处遍历范围仅限本人日程，规模有界）
     */
    function batchRelease(address beneficiary) external nonReentrant returns (uint256 totalAmount) {
        if (beneficiary == address(0)) revert ZeroAddress();
        uint256[] storage ids = _schedulesOf[beneficiary];
        uint256 len = ids.length;
        for (uint256 i = 0; i < len; i += 1) {
            Schedule storage s = _schedules[ids[i]];
            uint256 r = _releasable(s);
            if (r == 0) continue;
            s.released += uint128(r);
            allocated[s.token] -= r;
            totalAmount += r;
            IERC20(s.token).safeTransfer(beneficiary, r);
            emit Released(ids[i], beneficiary, r);
        }
    }

    // ============================== 撤销（结清） ==============================

    /**
     * @notice 撤销日程 = 结清：已解锁未领部分发给受益人，未解锁部分退回 owner；
     *         此后日程关闭不可再领。不可撤销（revocable = false）的日程拒绝本调用
     */
    function revoke(uint256 id) external onlyOwner nonReentrant {
        if (id >= scheduleCount) revert NoSuchSchedule();
        Schedule storage s = _schedules[id];
        if (!s.revocable) revert NotRevocable();
        if (s.revoked) revert AlreadyRevoked();

        uint256 vested = _vestedAt(s, block.timestamp);
        uint256 paid = vested - s.released; // 已解锁未领 → 受益人
        uint256 refund = uint256(s.total) - vested; // 未解锁 → owner
        if (paid == 0 && refund == 0) revert NothingToRevoke(); // 已全额结清，无事可撤
        if (paid > 0) {
            s.released += uint128(paid);
            allocated[s.token] -= paid;
            IERC20(s.token).safeTransfer(s.beneficiary, paid);
        }
        if (refund > 0) {
            allocated[s.token] -= refund;
            IERC20(s.token).safeTransfer(owner(), refund);
        }
        s.revoked = true;
        emit ScheduleRevoked(id, paid, refund);
    }

    // ============================== 解锁数学 ==============================

    /**
     * @notice t 时刻已解锁量。单次取整：linearTotal = total − tgePart，
     *         保证期末 start+cliff+linear 处 vested == total wei 精确
     */
    function _vestedAt(Schedule storage s, uint256 t) internal view returns (uint256) {
        if (t < s.start) return 0;
        uint256 total = uint256(s.total);
        uint256 tgePart = (total * s.tgeBps) / 1e4;
        uint256 linearTotal = total - tgePart;
        uint256 cliffEnd = uint256(s.start) + s.cliff; // 提升到 uint256 防相加回绕
        if (t < cliffEnd) return tgePart;
        if (s.linearDuration == 0) return total; // cliff 到点一次性解锁
        uint256 elapsed = t - cliffEnd;
        if (elapsed >= s.linearDuration) return total;
        return tgePart + (linearTotal * elapsed) / s.linearDuration;
    }

    function _releasable(Schedule storage s) internal view returns (uint256) {
        if (s.revoked) return 0; // 撤销即结清，不再有任何可领
        return _vestedAt(s, block.timestamp) - s.released;
    }

    // ============================== 视图 ==============================

    function schedules(uint256 id) external view returns (Schedule memory) {
        return _schedules[id];
    }

    function vested(uint256 id, uint256 t) external view returns (uint256) {
        return _vestedAt(_schedules[id], t);
    }

    function releasable(uint256 id) external view returns (uint256) {
        return _releasable(_schedules[id]);
    }

    function schedulesOf(address beneficiary) external view returns (uint256[] memory) {
        return _schedulesOf[beneficiary];
    }

    // ============================== 管理 ==============================

    /**
     * @notice 回收误入合约的代币。仅可回收「余额 − 未清义务(allocated)」的盈余，
     *         受益人资产红线不可触碰；代币带出金税时请先在代币侧豁免本合约
     */
    function recoverWrongToken(address token, uint256 amount) external onlyOwner nonReentrant {
        if (token == address(0)) revert ZeroAddress();
        uint256 bal = IERC20(token).balanceOf(address(this));
        uint256 owed = allocated[token];
        uint256 surplus = bal > owed ? bal - owed : 0;
        if (amount > surplus) revert ExceedsSurplus();
        IERC20(token).safeTransfer(owner(), amount);
    }

    /// @notice 回收误入的 BNB（全额转 owner）
    function recoverBNB() external onlyOwner nonReentrant {
        uint256 bal = address(this).balance;
        if (bal == 0) revert ZeroAmount();
        (bool ok, ) = owner().call{value: bal}("");
        if (!ok) revert BnbTransferFailed();
        emit BnbRecovered(bal);
    }

    /// @notice BNB 误入永不 revert
    receive() external payable {}
    fallback() external payable {}
}
