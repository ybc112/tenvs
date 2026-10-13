// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {TestBase} from "./TestBase.sol";
import {VSAStaking} from "../src/VSAStaking.sol";
import {Ownable} from "../src/oz/Ownable.sol";
import {SafeERC20} from "../src/oz/SafeERC20.sol";
import {MockTVS} from "../src/mocks/MockTVS.sol";
import {MockVSA} from "../src/mocks/MockVSA.sol";

/// @dev 重入攻击者：领取时在 VSA 转账回调里重入 claim()
contract ReentrantAttacker {
    VSAStaking public staking;
    MockTVS public tvs;

    constructor(VSAStaking s, MockTVS t) {
        staking = s;
        tvs = t;
    }

    function stakeIn(uint256 amount) external {
        tvs.approve(address(staking), amount);
        staking.stake(amount, 0);
    }

    function go() external {
        staking.claim();
    }

    /// @notice MockVSA hook 回调：尝试重入 claim
    function onTransfer(address, address, uint256) external {
        (bool ok, ) = address(staking).call(abi.encodeWithSignature("claim()"));
        if (ok) revert("REENTRANCY NOT BLOCKED"); // 重入成功 = 防线失效，测试必失败
        revert("REENTRY_STOPPED"); // guard 拦截后以固定标记回滚
    }
}

contract VSAStakingTest is TestBase {
    VSAStaking internal staking;
    MockTVS internal tvs;
    MockVSA internal vsa;

    uint256 internal constant DAY = 86_400;
    /// @notice 主网业务日秒数（测试与主网一致，便于沿用「天」为单位的推导）
    uint256 internal constant DAY_SECONDS = 86_400;
    uint256 internal constant SEG1_DAILY = 5000 * 1e18;
    uint256 internal constant TOTAL_EMISSION = 10_000_000 * 1e18;
    /// @notice 1 个代币（1e18 wei）在 1.0 倍权重下的权重单位
    uint256 internal constant W_PER_TOKEN = 1e36;
    /// @notice accPerWeight 精度（与合约一致）
    uint256 internal constant ACC_SCALE = 1e30;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    function setUp() public {
        tvs = new MockTVS("TVS", "TVS", 500); // 5% 税（默认豁免质押合约）
        vsa = new MockVSA("VSA", "VSA");
        staking = new VSAStaking(address(tvs), address(vsa), address(this), DAY_SECONDS);
        tvs.setPool(address(staking), true);

        tvs.mint(alice, 1_000_000 * 1e18);
        tvs.mint(bob, 1_000_000 * 1e18);
        tvs.mint(address(this), 100_000_000 * 1e18);
        vsa.mint(address(this), 200_000_000 * 1e18);
        vsa.approve(address(staking), type(uint256).max);
    }

    // ---------- 工具 ----------

    function _fund(uint256 reward, uint256 bonus) internal {
        if (reward > 0) staking.fundRewardPool(reward);
        if (bonus > 0) staking.fundBonusPool(bonus);
    }

    function _stake(address who, uint256 amount, uint8 term) internal returns (uint256 id) {
        vm.startPrank(who);
        tvs.approve(address(staking), amount);
        staking.stake(amount, term);
        vm.stopPrank();
        id = staking.stakeCount();
    }

    /**
     * @notice 种子池：几何增长灌入权重（每个新质押者恰好 10% 上限），直到全网 ≥ minTokens 个代币。
     *         用于让小份额用户（≤2%）的产出不被 2% 上限截断，保证精度断言确定性。
     */
    function _seedPool(uint256 minTokens) internal {
        for (uint256 i = 0; i < 80 && staking.totalWeight() < minTokens * W_PER_TOKEN; i += 1) {
            uint256 before = staking.totalWeight();
            // 首笔 bootstrap 100 个；其后每笔 = before/9 权重 → before/9/1e18 代币
            uint256 amountWei = before == 0 ? 100 * 1e18 : (before / 9) / 1e18;
            address who = address(uint160(0x1000 + i));
            tvs.mint(who, amountWei + (1e18));
            vm.startPrank(who);
            tvs.approve(address(staking), type(uint256).max);
            staking.stake(amountWei, 0);
            vm.stopPrank();
        }
    }

    /// @notice 复刻合约结算公式：raw = weighted × (dE × ACC_SCALE / totalWeight) / ACC_SCALE
    function _expectedRaw(uint256 userWeight, uint256 dE) internal view returns (uint256) {
        uint256 acc = (dE * ACC_SCALE) / staking.totalWeight();
        return (userWeight * acc) / ACC_SCALE;
    }

    function _segAmount(uint256 seg) internal pure returns (uint256) {
        if (seg == 0) return 3_650_000 * 1e18;
        if (seg == 1) return 2_555_000 * 1e18;
        if (seg == 2) return 1_788_500 * 1e18;
        if (seg == 3) return 1_251_950 * 1e18;
        return 754_550 * 1e18;
    }

    function _segCum(uint256 seg) internal pure returns (uint256) {
        uint256 cum = 0;
        for (uint256 i = 0; i < seg; i += 1) cum += _segAmount(i);
        return cum;
    }

    // ---------- 1. 产出曲线 ----------

    function test_EmissionTotalExact() public {
        // Σ段 = 1000 万
        uint256 sum = _segAmount(0) + _segAmount(1) + _segAmount(2) + _segAmount(3) + _segAmount(4);
        assertEq(sum, TOTAL_EMISSION, "segments must sum to 10,000,000e18");

        // 段界精确
        uint256 t0 = block.timestamp;
        assertEq(staking.emissionAt(t0 + 730 * DAY), _segAmount(0), "E@seg1 boundary");
        assertEq(staking.emissionAt(t0 + 1460 * DAY), _segCum(2), "E@seg2 boundary");
        assertEq(staking.emissionAt(t0 + 2190 * DAY), _segCum(3), "E@seg3 boundary");
        assertEq(staking.emissionAt(t0 + 2920 * DAY), _segCum(4), "E@seg4 boundary");
        assertEq(staking.emissionAt(t0 + 3650 * DAY), TOTAL_EMISSION, "E@10y exact");

        // 冻结
        assertEq(staking.emissionAt(t0 + 3650 * DAY + 1), TOTAL_EMISSION);
        assertEq(staking.emissionAt(t0 + 4000 * DAY), TOTAL_EMISSION);

        // 末日无尖峰（≤ 1035/日）
        uint256 last = staking.emissionAt(t0 + 3650 * DAY) - staking.emissionAt(t0 + 3649 * DAY);
        assertLt(last, 1035 * 1e18, "no final-day spike");

        // 末段每日增量在 [1033, 1034]
        uint256 inc1 = staking.emissionAt(t0 + 2921 * DAY) - staking.emissionAt(t0 + 2920 * DAY);
        assertTrue(inc1 >= 1033 * 1e18 && inc1 <= 1034 * 1e18, "seg5 daily increment bounded");
    }

    function test_EmissionTelescopingPerDay() public {
        // 逐日对账：段 1 每日增量恒等于 5000/日
        uint256 t0 = block.timestamp;
        for (uint256 d = 0; d < 730; d += 1) {
            uint256 inc = staking.emissionAt(t0 + (d + 1) * DAY) - staking.emissionAt(t0 + d * DAY);
            assertEq(inc, SEG1_DAILY, "seg1 daily exact");
        }
    }

    function testFuzz_EmissionMonotonicBounded(uint256 x) public {
        uint256 t0 = block.timestamp;
        uint256 t = t0 + (x % (3650 * DAY));
        uint256 day = (t - t0) / DAY;
        uint256 seg = day / 730;
        uint256 dIn = day % 730;
        uint256 e = staking.emissionAt(t);
        uint256 daily = _segAmount(seg) / 730;
        // E ∈ [cum + dIn×daily, cum + dIn×(daily + 1e18))
        assertLt(e + 1, _segCum(seg) + dIn * (daily + 1e18) + 2);
        assertGt(e + 1, _segCum(seg) + dIn * daily);
    }

    // ---------- 2. 档位与权重 ----------

    function test_TermWeightsAndMaturity() public {
        _seedPool(4_600); // alice 三笔累计 500 需全网 ≥ 5,000 才都在 10% 上限内
        uint256 twBefore = staking.totalWeight();
        uint256 stakedBefore = staking.totalStakedTvs();

        uint256 idA = _stake(alice, 100 * 1e18, 0);
        VSAStaking.StakeRecord memory r = staking.records(idA);
        assertEq(r.weight, 100 * W_PER_TOKEN, "30d weight 1.0");
        assertEq(r.maturityTime - r.startTime, 30 * DAY, "30d maturity");

        uint256 idB = _stake(alice, 100 * 1e18, 1);
        r = staking.records(idB);
        assertEq(r.weight, 150 * W_PER_TOKEN, "90d weight 1.5");

        uint256 idC = _stake(alice, 100 * 1e18, 2);
        r = staking.records(idC);
        assertEq(r.weight, 250 * W_PER_TOKEN, "270d weight 2.5");
        assertEq(r.maturityTime - r.startTime, 270 * DAY, "270d maturity");

        assertEq(staking.totalWeight() - twBefore, 500 * W_PER_TOKEN, "totalWeight delta");
        assertEq(staking.totalStakedTvs() - stakedBefore, 300 * 1e18, "totalStakedTvs delta");
    }

    function test_StakeReverts() public {
        vm.startPrank(alice);
        tvs.approve(address(staking), 100 * 1e18);
        vm.expectRevert(VSAStaking.ZeroAmount.selector);
        staking.stake(0, 0);
        vm.expectRevert(VSAStaking.BadTerm.selector);
        staking.stake(100 * 1e18, 3);
        vm.stopPrank();
    }

    // ---------- 3. TVS 带税代币 balance-delta 记账 ----------

    function test_StakeBalanceDeltaWithTax() public {
        _seedPool(9_900);
        // 未豁免：5% 税 → 实收记账
        tvs.setPool(address(staking), false);
        uint256 id = _stake(bob, 1000 * 1e18, 0);
        VSAStaking.StakeRecord memory r = staking.records(id);
        assertEq(r.principal, 950 * 1e18, "principal = received net of tax");
        assertEq(r.weight, 950 * W_PER_TOKEN, "weight on received");

        // 恢复豁免：全额记账
        tvs.setPool(address(staking), true);
        tvs.mint(address(0xC0C0), 10_000 * 1e18);
        uint256 id2 = _stake(address(0xC0C0), 1000 * 1e18, 0);
        r = staking.records(id2);
        assertEq(r.principal, 1000 * 1e18, "exempt path full amount");
    }

    // ---------- 4. 产出与领取（种子池内 1% 份额精度场景） ----------

    function test_SmallShareAccrualExact() public {
        _seedPool(9_900);
        _fund(1_000_000 * 1e18, 100_000 * 1e18);
        uint256 aliceW = 100 * W_PER_TOKEN;
        uint256 twBefore = staking.totalWeight();
        _stake(alice, 100 * 1e18, 0);
        twBefore += 100 * W_PER_TOKEN;

        vm.warp(block.timestamp + 10 * DAY);
        uint256 expected = _expectedRaw(aliceW, 10 * SEG1_DAILY);

        (uint256 pending, uint256 claimableNow, uint256 lockedTotal, ) = staking.pendingOf(alice);
        assertEq(pending, expected, "accrual matches replicated formula");
        assertEq(claimableNow, expected / 2, "claimable now = half");
        assertEq(lockedTotal, 0);
    }

    function test_ClaimSplitAndLock() public {
        _seedPool(9_900);
        _fund(1_000_000 * 1e18, 100_000 * 1e18);
        _stake(alice, 100 * 1e18, 0);
        vm.warp(block.timestamp + 10 * DAY);

        (uint256 expected, , , ) = staking.pendingOf(alice);
        uint256 poolBefore = staking.rewardPool();
        vm.prank(alice);
        staking.claim();

        assertEq(vsa.balanceOf(alice), expected / 2, "immediate half");
        assertEq(staking.rewardPool(), poolBefore - expected / 2, "pool decremented");

        (, , uint256 lockedTotal, ) = staking.pendingOf(alice);
        assertEq(lockedTotal, expected - expected / 2, "locked half");
    }

    function test_LockLinearReleaseAndConservation() public {
        _seedPool(9_900);
        _fund(1_000_000 * 1e18, 100_000 * 1e18);
        uint256 id = _stake(alice, 100 * 1e18, 0);

        uint256 accrued = 0; // 累计应得（未封顶口径）
        uint256 received = 0; // 累计实收

        // day10 领取：L1 入队（独立 90 天窗口）
        vm.warp(block.timestamp + 10 * DAY);
        (uint256 t1, , , ) = staking.pendingOf(alice);
        accrued += t1;
        uint256 bal = vsa.balanceOf(alice);
        vm.prank(alice);
        staking.claim();
        received += vsa.balanceOf(alice) - bal;
        assertEq(received, t1 / 2, "claim1 immediate half");
        uint256 L1 = t1 - t1 / 2;

        // day31 解押（结算入 claimable）再领取：L2 入队，L1 独立释放 21/90
        vm.warp(block.timestamp + 21 * DAY);
        vm.prank(alice);
        staking.unstake(id);
        (uint256 t2, , , ) = staking.pendingOf(alice);
        accrued += t2;
        bal = vsa.balanceOf(alice);
        vm.prank(alice);
        staking.claim();
        received += vsa.balanceOf(alice) - bal;
        assertApproxEqAbs(received - t1 / 2, t2 / 2 + (L1 * 21) / 90, 1e18, "claim2 = half + L1 partial");
        uint256 L2 = t2 / 2;

        // day76：L1 过 66/90、L2 过 45/90（各笔独立进度）→ 未领 pending = (L1+L2)/2
        vm.warp(block.timestamp + 45 * DAY);
        (, , , uint256 pending76) = staking.pendingOf(alice);
        assertApproxEqAbs(pending76, (L1 + L2) / 2, 1e18, "entries release independently");
        bal = vsa.balanceOf(alice);
        vm.prank(alice);
        staking.claim();
        received += vsa.balanceOf(alice) - bal;
        assertApproxEqAbs(vsa.balanceOf(alice) - bal, (L1 + L2) / 2, 1e18, "claim3 pending");

        // +90 天：各笔全部释放完；守恒：累计实收 = 累计应得（±截断尘埃）
        bal = vsa.balanceOf(alice);
        vm.warp(block.timestamp + 90 * DAY);
        vm.prank(alice);
        staking.claim();
        received += vsa.balanceOf(alice) - bal;

        assertApproxEqAbs(received, accrued, 1e3, "conservation: received == accrued");
        (uint256 left, , uint256 lockedEnd, ) = staking.pendingOf(alice);
        assertEq(left, 0);
        assertEq(lockedEnd, 0, "lock drained");
    }

    function test_MultiEntryLockIndependent() public {
        _seedPool(9_900);
        _fund(2_000_000 * 1e18, 100_000 * 1e18);
        _stake(alice, 100 * 1e18, 0);
        vm.warp(block.timestamp + 10 * DAY);
        vm.prank(alice);
        staking.claim(); // L1 = 250 @ day10，独立 90 天窗口

        (, , uint256 L1, ) = staking.pendingOf(alice);

        vm.warp(block.timestamp + 30 * DAY); // day 40
        // L1 释放 30/90（独立窗口，不重置）；新结算 30d 一半立即、一半成 L2
        (uint256 total2, uint256 claimableNow, , uint256 released) = staking.pendingOf(alice);
        uint256 releasedExpect = L1 / 3;
        assertApproxEqAbs(released, releasedExpect, 1e18, "L1 independent 30d release");
        assertApproxEqAbs(claimableNow, total2 / 2 + releasedExpect, 1e18, "claimable now");

        uint256 bal = vsa.balanceOf(alice);
        vm.prank(alice);
        staking.claim();
        assertApproxEqAbs(vsa.balanceOf(alice) - bal, total2 / 2 + releasedExpect, 1e18, "received");
        uint256 L2 = total2 / 2;

        // day100：L1 到 90 天全额释放（day40 已领走 1/3），L2 过 60/90 — 关键区分点
        vm.warp(block.timestamp + 60 * DAY); // day 100
        (, , uint256 lockedTotal, uint256 released100) = staking.pendingOf(alice);
        assertApproxEqAbs(released100, (2 * L1) / 3 + (L2 * 2) / 3, 1e18, "L1 fully released at day100");
        assertApproxEqAbs(lockedTotal, L2 / 3, 1e18, "only L2 tail remains");
    }

    function test_ClaimInsufficientRewardPool() public {
        _stake(alice, 100 * 1e18, 0);
        vm.warp(block.timestamp + 10 * DAY);
        vm.expectRevert(VSAStaking.InsufficientRewardPool.selector);
        vm.prank(alice);
        staking.claim();
    }

    // ---------- 5. 10% 质押上限 ----------

    function test_CapTenPercentAndBootstrap() public {
        // bootstrap：全网为空，首笔任意大小
        _stake(alice, 10_000 * 1e18, 0);

        // bob 最大：9×w ≤ 10,000 → w ≤ 1,111.11
        _stake(bob, 1_111 * 1e18, 0);
        vm.startPrank(bob);
        tvs.approve(address(staking), 10_000 * 1e18);
        vm.expectRevert(VSAStaking.CapTenPercentExceeded.selector);
        staking.stake(1_112 * 1e18, 0);
        vm.stopPrank();
    }

    // ---------- 6. 2% 日产出上限（超出暂存补发，不没收） ----------

    function test_CapDailyTwoPercent() public {
        _fund(10_000_000 * 1e18, 0);
        _stake(alice, 100 * 1e18, 0); // 100% 份额
        vm.warp(block.timestamp + 10 * DAY);

        // raw = 50,000；cap = 2% × 50,000 = 1,000；超出 49,000 暂存
        (uint256 pending, , , ) = staking.pendingOf(alice);
        assertEq(pending, 1_000 * 1e18, "capped to 2% of window emission");

        vm.prank(alice);
        staking.claim(); // 立即 500，同时结算 deferred
        assertEq(vsa.balanceOf(alice), 500 * 1e18);
        (, , uint256 deferred, ) = staking.userInfo(alice);
        assertEq(deferred, 49_000 * 1e18, "excess deferred, not forfeited");

        // 新窗口再过 10 天：份额仍 100%，继续暂存
        vm.warp(block.timestamp + 10 * DAY);
        (uint256 pending2, , , ) = staking.pendingOf(alice);
        assertEq(pending2, 1_000 * 1e18, "next window cap");
        vm.prank(alice);
        staking.claim();
        (, , uint256 deferred2, ) = staking.userInfo(alice);
        assertEq(deferred2, 98_000 * 1e18, "deferred accumulates");
    }

    /// @notice 份额回落后（新大额质押者稀释），暂存的产出自动补发
    function test_DeferredPaybackWhenShareDrops() public {
        _fund(10_000_000 * 1e18, 0);
        _stake(alice, 100 * 1e18, 0); // bootstrap，权重 100
        vm.warp(block.timestamp + 10 * DAY); // 独占期产出 50,000 全记 alice

        // 几何灌池到 alice 份额 < 2%（每笔恰好在 10% 上限内；权重 1e36/代币）
        for (uint256 i = 0; i < 50; i += 1) {
            uint256 tw = staking.totalWeight();
            uint256 amt = tw / 9 / 1e36;
            if (amt == 0) amt = 1;
            address who = address(uint160(0x3000 + i));
            tvs.mint(who, amt * 1e18);
            vm.startPrank(who);
            tvs.approve(address(staking), type(uint256).max);
            staking.stake(amt * 1e18, 0);
            vm.stopPrank();
        }
        uint256 T = staking.totalWeight();
        assertLt((100 * 1e36 * 10000) / T, 200, "alice share < 2%");

        vm.warp(block.timestamp + 10 * DAY);
        // raw = 50,000（独占期）+ 100/T×50,000（稀释期）；cap = 2%×100,000 = 2,000
        (uint256 pending, , , ) = staking.pendingOf(alice);
        assertEq(pending, 2_000 * 1e18, "take capped at 2k");

        vm.prank(alice);
        staking.claim(); // 立即 1,000，deferred 落账
        assertEq(vsa.balanceOf(alice), 1_000 * 1e18);
        (, , uint256 deferred, ) = staking.userInfo(alice);
        assertGt(deferred, 0, "excess stored as deferred");

        // 再过 10 天：份额 < 2% → raw < cap → spare 补发 deferred
        vm.warp(block.timestamp + 10 * DAY);
        (uint256 pending3, , , ) = staking.pendingOf(alice);
        assertEq(pending3, 1_000 * 1e18, "raw + payback fills to cap");
        vm.prank(alice);
        staking.claim();
        // 到账 = 第二次结算立即半 500 + 首笔锁仓释放 1,000×10/90 ≈ 111.11
        uint256 lockSwept = (1_000 * 1e18 * 10 * DAY) / (90 * DAY);
        assertEq(vsa.balanceOf(alice), 1_500 * 1e18 + lockSwept, "payback half received");

        // 暂存余额 = 总应得 − 两次结算入账（2,000 + 1,000）；稀释期 raw 复刻合约双重 floor 公式
        (, , uint256 deferredLeft, ) = staking.userInfo(alice);
        uint256 rawDiluted = _expectedRaw(100 * W_PER_TOKEN, 50_000 * 1e18);
        assertEq(
            deferredLeft,
            (50_000 * 1e18 + 2 * rawDiluted) - 3_000 * 1e18,
            "deferred net of payback"
        );
    }

    function test_CapWindowAcrossSegment() public {
        _fund(10_000_000 * 1e18, 0);
        _stake(alice, 100 * 1e18, 2); // 270d，跨段
        vm.warp(block.timestamp + 729 * DAY); // seg1 末日
        vm.prank(alice);
        staking.claim(); // 锚点 = day 729

        vm.warp(block.timestamp + 2 * DAY); // day 731，跨入 seg2
        // cap = 2% × (E(731) − E(729)) = 2% × (3,653,500 − 3,645,000) = 170
        (uint256 pending, , , ) = staking.pendingOf(alice);
        assertEq(pending, 170 * 1e18, "cap across segment uses E diff");
    }

    /// @notice 全部解押后 raw 恒为 0，deferred 仍须按窗口补发（读写路径一致性）
    function test_DeferredPaybackAfterFullUnstake() public {
        _fund(10_000_000 * 1e18, 0);
        uint256 id = _stake(alice, 100 * 1e18, 0); // 独占期 100% 份额
        vm.warp(block.timestamp + 30 * DAY); // raw = 150,000，cap = 3,000
        vm.prank(alice);
        staking.unstake(id); // claimable += 3,000，deferred += 147,000，weighted → 0

        (, , uint256 deferred0, ) = staking.userInfo(alice);
        assertEq(deferred0, 147_000 * 1e18, "deferred kept on mature unstake");

        vm.warp(block.timestamp + DAY); // 新窗口 cap = 100
        (uint256 pending, , , ) = staking.pendingOf(alice);
        assertEq(pending, 3_000 * 1e18 + 100 * 1e18, "view includes payback at raw=0");
        vm.prank(alice);
        staking.claim();
        (, , uint256 deferred1, ) = staking.userInfo(alice);
        assertEq(deferred1, 147_000 * 1e18 - 100 * 1e18, "payback works after full unstake");
        assertEq(vsa.balanceOf(alice), (3_000 * 1e18 + 100 * 1e18) / 2, "half received");
    }

    /// @notice 10 年产出结束后 cap 恒为 0，deferred 一次性补发（不没收）
    function test_DeferredDrainAfterEmissionEnd() public {
        _fund(10_000_000 * 1e18, 0);
        _stake(alice, 100 * 1e18, 0); // 独占全网 → raw = 全部产出
        vm.warp(block.timestamp + 3650 * DAY);
        vm.prank(alice);
        staking.claim(); // cap = 200,000 → 立即领 100,000，deferred += 9,800,000
        assertEq(vsa.balanceOf(alice), 100_000 * 1e18);
        (, , uint256 deferred0, ) = staking.userInfo(alice);
        assertEq(deferred0, 9_800_000 * 1e18, "excess deferred during emission");

        vm.warp(block.timestamp + 10 * DAY); // 产出已结束
        (uint256 pendDrain, , , ) = staking.pendingOf(alice);
        assertEq(pendDrain, 9_800_000 * 1e18, "view promises full drain");
        vm.prank(alice);
        staking.claim(); // 暂存一次性补发
        (, , uint256 deferred1, ) = staking.userInfo(alice);
        assertEq(deferred1, 0, "drained once emission over");
        // 到账 = 补发 9,800,000 的一半 + 首笔锁仓释放 100,000×10/90
        uint256 lockSwept = (100_000 * 1e18 * 10 * DAY) / (90 * DAY);
        assertEq(
            vsa.balanceOf(alice),
            100_000 * 1e18 + 4_900_000 * 1e18 + lockSwept,
            "full deferred paid"
        );
    }

    /// @notice 产出池不足时复投应干净报错（此前为算术下溢 panic）
    function test_ReinvestInsufficientRewardPool() public {
        _fund(0, 10_000 * 1e18); // 只注复投奖池
        _stake(alice, 100 * 1e18, 0);
        vm.warp(block.timestamp + 10 * DAY); // transferable = 500
        vm.expectRevert(VSAStaking.InsufficientRewardPool.selector);
        vm.prank(alice);
        staking.reinvest(0);
    }

    /// @notice 强解时锁仓队列逐笔按权重比例罚没（决策③适配路径）
    function test_EmergencyUnstakeForfeitsLockedShare() public {
        _fund(10_000_000 * 1e18, 0);
        _stake(alice, 100 * 1e18, 0); // id1
        _seedPool(11_000); // alice 最终份额 < 2% → 不触 2% 上限，数字确定
        uint256 idA2 = _stake(alice, 100 * 1e18, 0);
        uint256 T = staking.totalWeight();
        uint256 raw = _expectedRaw(200 * W_PER_TOKEN, 50_000 * 1e18); // 10 天窗口应得
        assertTrue(raw <= (50_000 * 1e18 * 200) / 10000, "share within 2% cap");

        vm.warp(block.timestamp + 10 * DAY);
        vm.prank(alice);
        staking.claim(); // 立即 raw/2，锁 L1 = (raw/2, day10, scanned 0)
        assertEq(vsa.balanceOf(alice), raw / 2);

        vm.warp(block.timestamp + 10 * DAY); // day 20
        vm.prank(alice);
        staking.emergencyUnstake(idA2); // rBps = 100/200 = 5000：罚没一半
        // settle 先入账 raw2 = raw（T 不变）→ claimable = raw → 罚一半剩一半
        (, uint256 cAfter, uint256 dAfter, ) = staking.userInfo(alice);
        assertEq(cAfter, raw / 2, "claimable halved");
        assertEq(dAfter, 0, "no deferred below 2% share");

        uint256 rel = ((raw / 4) * 10 * DAY) / (90 * DAY);
        (uint256 entries, uint256 remain, uint256 relPending) = staking.lockStats(alice);
        assertEq(entries, 1);
        assertEq(remain, raw / 4 - rel, "lock cut to half");
        assertEq(relPending, rel, "released progress intact");

        assertEq(tvs.balanceOf(alice), 999_900 * 1e18, "principal returned");
    }

    /// @notice 复投新增权重同样受 10% 上限约束（份额被动涨超后）
    function test_ReinvestCapTenPercent() public {
        _fund(10_000_000 * 1e18, 1_000_000 * 1e18);
        _stake(alice, 100 * 1e18, 0); // bootstrap
        _seedPool(1_100); // alice 份额 ≤ 9.09%
        // 紧急解除全部种子仓位 → alice 回到 100%（同日结算，产出为 0）
        uint256 n = staking.stakeCount();
        for (uint256 i = 2; i <= n; i += 1) {
            address who = staking.records(i).owner;
            vm.prank(who);
            staking.emergencyUnstake(i);
        }
        vm.warp(block.timestamp + DAY); // alice 独占窗口 raw = 5,000 → cap 100
        vm.prank(alice);
        vm.expectRevert(VSAStaking.CapTenPercentExceeded.selector);
        staking.reinvest(0);
    }

    /// @notice 强解复投产生的 VSA 仓：退 VSA 本金、totalStakedVsa 归零
    function test_EmergencyUnstakeReinvestedVsa() public {
        _fund(10_000_000 * 1e18, 1_000_000 * 1e18);
        _stake(alice, 10 * 1e18, 0);
        _seedPool(1_000); // alice 份额 ≤ 1%
        vm.warp(block.timestamp + DAY);
        (uint256 pending, , , ) = staking.pendingOf(alice);
        assertGt(pending, 0);
        vm.prank(alice);
        uint256 id = staking.reinvest(0);
        uint256 principalExpected = (pending / 2) * 11 / 10; // 立即半 + 10% bonus
        assertEq(staking.totalStakedVsa(), principalExpected);

        vm.warp(block.timestamp + DAY);
        vm.prank(alice);
        staking.emergencyUnstake(id);
        assertEq(vsa.balanceOf(alice), principalExpected, "vsa principal returned");
        assertEq(staking.totalStakedVsa(), 0);
    }

    /// @notice 视图辅助函数与边界
    function test_ViewHelpers() public {
        _stake(alice, 100 * 1e18, 0);
        assertEq(staking.currentDailyEmission(), 5_000 * 1e18);
        vm.expectRevert(VSAStaking.BadTerm.selector);
        staking.termInfo(3);
        uint256[] memory ids = staking.getUserStakes(alice);
        assertEq(ids.length, 1);
        assertEq(ids[0], 1);
        vm.warp(block.timestamp + 3651 * DAY);
        assertEq(staking.currentDailyEmission(), 0, "zero after emission end");
    }

    /// @notice TVS 只可回收「余额 − 在押本金」盈余，在押本金不可回收
    function test_RecoverTvsLimitedToSurplus() public {
        _stake(alice, 100 * 1e18, 0);
        vm.expectRevert(VSAStaking.RecoverExceedsFreeBalance.selector);
        staking.recoverWrongToken(address(tvs), 100 * 1e18); // owner = 测试合约

        tvs.mint(address(staking), 5 * 1e18); // 模拟误入
        staking.recoverWrongToken(address(tvs), 5 * 1e18);
        assertEq(tvs.balanceOf(address(staking)), 100 * 1e18, "staked principal intact");
    }

    // ---------- 7. 到期解押 ----------

    function test_UnstakeAfterMaturity() public {
        _fund(1_000_000 * 1e18, 0);
        uint256 id = _stake(alice, 1000 * 1e18, 0);

        vm.expectRevert(VSAStaking.NotMatured.selector);
        vm.prank(alice);
        staking.unstake(id);

        vm.warp(block.timestamp + 31 * DAY);
        uint256 tvsBal = tvs.balanceOf(alice);
        vm.prank(alice);
        staking.unstake(id);
        assertEq(tvs.balanceOf(alice), tvsBal + 1000 * 1e18, "principal returned");
        assertEq(staking.totalWeight(), 0, "weight removed");

        // 奖励可续领（claimable 已入库；单押者受 2% 封顶 = 2%×155,000 = 3,100）
        (uint256 pending, , , ) = staking.pendingOf(alice);
        assertEq(pending, 3_100 * 1e18, "banked with cap");
        vm.prank(alice);
        staking.claim();
        assertEq(vsa.balanceOf(alice), 1_550 * 1e18, "claimed half");
    }

    function test_UnstakeWrongOwner() public {
        uint256 id = _stake(alice, 100 * 1e18, 0);
        vm.warp(block.timestamp + 31 * DAY);
        vm.expectRevert(VSAStaking.NotRecordOwner.selector);
        vm.prank(bob);
        staking.unstake(id);
    }

    // ---------- 8. 强行解除 ----------

    function test_EmergencyUnstakeForfeitsShare() public {
        _seedPool(9_900);
        _fund(10_000_000 * 1e18, 0);
        _stake(alice, 100 * 1e18, 0);
        _stake(bob, 100 * 1e18, 0);
        vm.warp(block.timestamp + 10 * DAY);

        (uint256 bobBefore, , , ) = staking.pendingOf(bob);
        (uint256 aliceBefore, , , ) = staking.pendingOf(alice);
        assertGt(aliceBefore, 0, "alice has accrued");

        uint256 id = staking.stakeCount(); // bob 的记录 id
        uint256 aliceId = id - 1;
        uint256 tvsBal = tvs.balanceOf(alice);
        vm.prank(alice);
        staking.emergencyUnstake(aliceId);
        assertEq(tvs.balanceOf(alice), tvsBal + 100 * 1e18, "principal back mid-term");

        // alice 单笔 = 自身权重 100% → 全部罚没
        (uint256 aliceAfter, , , ) = staking.pendingOf(alice);
        assertEq(aliceAfter, 0, "forfeited all (single stake)");

        // bob 不受影响；罚没留在产出池账本（不消失）
        (uint256 bobAfter, , , ) = staking.pendingOf(bob);
        assertEq(bobAfter, bobBefore, "bob unaffected");
        assertEq(staking.rewardPool(), 10_000_000 * 1e18, "forfeit stays in pool ledger");
    }

    function test_EmergencyUnstakeAfterMaturityReverts() public {
        uint256 id = _stake(alice, 100 * 1e18, 0);
        vm.warp(block.timestamp + 30 * DAY + 1);
        vm.expectRevert(VSAStaking.MustUseUnstake.selector);
        vm.prank(alice);
        staking.emergencyUnstake(id);
    }

    // ---------- 9. 复投 ----------

    function test_ReinvestCreatesVsaStakeWithBonus() public {
        _seedPool(9_900);
        _fund(1_000_000 * 1e18, 100_000 * 1e18);
        _stake(alice, 100 * 1e18, 0);
        vm.warp(block.timestamp + 10 * DAY);

        (, uint256 claimableNow, , ) = staking.pendingOf(alice);
        uint256 poolBefore = staking.rewardPool();
        uint256 bonusBefore = staking.bonusPool();

        vm.prank(alice);
        uint256 newId = staking.reinvest(1); // 90d

        uint256 bonusExpect = claimableNow / 10;
        VSAStaking.StakeRecord memory r = staking.records(newId);
        assertTrue(r.isVsa, "new stake is VSA principal");
        assertEq(r.principal, claimableNow + bonusExpect, "principal = claimable + 10%");
        assertEq(r.weight, (claimableNow + bonusExpect) * 15 * 1e18 / 10, "weight 1.5x");
        assertEq(r.maturityTime - r.startTime, 90 * DAY, "reinvest term");

        assertEq(staking.rewardPool(), poolBefore - claimableNow, "rewardPool decremented");
        assertEq(staking.bonusPool(), bonusBefore - bonusExpect, "bonusPool decremented");
        assertEq(vsa.balanceOf(alice), 0, "no VSA left user wallet");
    }

    function test_ReinvestInsufficientBonus() public {
        _fund(1_000_000 * 1e18, 0); // 不注资复投池
        _stake(alice, 100 * 1e18, 0);
        vm.warp(block.timestamp + 10 * DAY);
        vm.expectRevert(VSAStaking.InsufficientBonusPool.selector);
        vm.prank(alice);
        staking.reinvest(1);
    }

    function test_ReinvestedStakeUnstakeReturnsVsa() public {
        _seedPool(9_900);
        _fund(1_000_000 * 1e18, 100_000 * 1e18);
        _stake(alice, 100 * 1e18, 0);
        vm.warp(block.timestamp + 10 * DAY);
        vm.prank(alice);
        uint256 newId = staking.reinvest(0); // 30d

        VSAStaking.StakeRecord memory r = staking.records(newId);
        vm.warp(block.timestamp + 31 * DAY);
        uint256 vsaBal = vsa.balanceOf(alice);
        vm.prank(alice);
        staking.unstake(newId);
        assertEq(vsa.balanceOf(alice), vsaBal + r.principal, "VSA principal returned");
    }

    // ---------- 10. 权限 ----------

    function test_OwnershipTwoStep() public {
        address safe = address(0x5AFE);
        staking.transferOwnership(safe);
        assertEq(staking.pendingOwner(), safe);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        staking.fundRewardPool(1);

        vm.prank(safe);
        staking.acceptOwnership();
        assertEq(staking.owner(), safe);

        vsa.mint(safe, 1000 * 1e18);
        vm.startPrank(safe);
        vsa.approve(address(staking), 1000 * 1e18);
        staking.fundRewardPool(1000 * 1e18);
        vm.stopPrank();
        assertEq(staking.rewardPool(), 1000 * 1e18);
    }

    function test_RecoverProhibitsVsa() public {
        vm.expectRevert(VSAStaking.TokenProhibited.selector);
        staking.recoverWrongToken(address(vsa), 1);
        // TVS 可回收
        staking.recoverWrongToken(address(tvs), 0);
    }

    // ---------- 11. 产出结束后 ----------

    function test_AfterEmissionEnd() public {
        vm.warp(block.timestamp + 3651 * DAY);
        assertEq(staking.dayIndex(), 3650, "day capped");
        assertEq(staking.currentDailyEmission(), 0, "no emission after end");
        assertEq(staking.emissionAt(block.timestamp), TOTAL_EMISSION, "frozen");

        // 结束后仍可质押/解押（无产出）
        _fund(1_000_000 * 1e18, 0);
        uint256 id = _stake(alice, 100 * 1e18, 0);
        (uint256 pending, , , ) = staking.pendingOf(alice);
        assertEq(pending, 0, "no rewards after end");
        vm.warp(block.timestamp + 31 * DAY);
        vm.prank(alice);
        staking.unstake(id);
    }

    // ---------- 12. 重入防护 ----------

    function test_ReentrancyGuardBlocksCallback() public {
        _fund(1_000_000 * 1e18, 0);
        ReentrantAttacker attacker = new ReentrantAttacker(staking, tvs);
        tvs.mint(address(attacker), 100 * 1e18);
        attacker.stakeIn(100 * 1e18);
        vsa.setHook(address(attacker)); // VSA 转账回调 → 重入
        vm.warp(block.timestamp + 10 * DAY);

        // MockVSA hook → 攻击者重入 claim → guard revert（"REENTRY_STOPPED"）→
        // 原始 revert 数据冒泡至 SafeERC20，包装为 SafeERC20FailedOperation(VSA)
        vm.expectRevert(
            abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(vsa))
        );
        attacker.go();
    }

    // ---------- 13. 池盈余视图 ----------

    function test_PoolSurplus() public {
        _fund(1_000_000 * 1e18, 100_000 * 1e18);
        assertEq(staking.poolSurplus(), 0, "no surplus after funding");
        // 直转误入（模拟灰尘）
        vsa.mint(address(staking), 5 * 1e18);
        assertEq(staking.poolSurplus(), 5 * 1e18, "dust counted as surplus");
    }

    function test_PoolSurplusExcludesReinvestPrincipal() public {
        _seedPool(9_900);
        _fund(1_000_000 * 1e18, 100_000 * 1e18);
        _stake(alice, 100 * 1e18, 0);
        vm.warp(block.timestamp + 10 * DAY);
        vm.prank(alice);
        staking.reinvest(0); // 产出转为 VSA 在押本金

        // 盈余不得把复投本金算进去
        assertEq(staking.poolSurplus(), 0, "reinvest principal is not surplus");
    }

    // ---------- 14. 小时级部署（测试网/本地加速） ----------

    function test_HourScaleDeployment() public {
        // 1 业务日 = 60 秒 → 30 天档 = 30 分钟，90 天锁仓 = 90 分钟，10 年曲线 = 3650 分钟（约 2.5 天）
        VSAStaking fast = new VSAStaking(address(tvs), address(vsa), address(this), 60);
        assertEq(fast.daySeconds(), 60, "daySeconds configurable");

        (uint256 dur0, uint256 mult0) = fast.termInfo(0);
        assertEq(dur0, 30 * 60, "30d term = 30 min");
        assertEq(mult0, 1e18, "weight 1.0");
        (uint256 dur2, uint256 mult2) = fast.termInfo(2);
        assertEq(dur2, 270 * 60, "270d term = 270 min");
        assertEq(mult2, 25 * 1e17, "weight 2.5");

        // 质押 → 不足期不可解押 → 到期可解押
        tvs.setPool(address(fast), true);
        vm.startPrank(bob);
        tvs.approve(address(fast), 1000 * 1e18);
        fast.stake(100 * 1e18, 0);
        vm.stopPrank();
        uint256 id = fast.stakeCount();
        assertEq(fast.records(id).maturityTime - fast.records(id).startTime, 30 * 60, "maturity in minutes");

        vm.warp(block.timestamp + 29 * 60);
        vm.expectRevert(VSAStaking.NotMatured.selector);
        vm.prank(bob);
        fast.unstake(id);

        vm.warp(block.timestamp + 61);
        vm.prank(bob);
        fast.unstake(id);
        assertEq(tvs.balanceOf(bob), 1_000_000 * 1e18, "principal returned at minute scale");

        // 曲线在分钟级下仍 wei 精确
        assertEq(fast.emissionAt(fast.startTime() + 3650 * 60), TOTAL_EMISSION, "curve exact at hour scale");
    }

    // ---------- 15. 需求书兼容接口 ----------

    function test_PendingRewardsAndClaimRewardsById() public {
        _seedPool(9_900);
        _fund(1_000_000 * 1e18, 0);
        uint256 id = _stake(alice, 100 * 1e18, 0);
        vm.warp(block.timestamp + 10 * DAY);

        uint256 p = staking.pendingRewards(id);
        (uint256 pendingOfUser, , , ) = staking.pendingOf(alice);
        assertEq(p, pendingOfUser, "pendingRewards mirrors account ledger");
        // 不存在的记录返回 0
        assertEq(staking.pendingRewards(999), 0, "unknown stake returns 0");

        vm.prank(alice);
        staking.claimRewards(id);
        assertEq(vsa.balanceOf(alice), p / 2, "claimRewards pays immediate half");
    }

    // ---------- 16. 权重变更时的账本锚定（关键回归） ----------

    /// @notice 部分解押后，账户必须仍可正常领取剩余产出（不得因 accPaid 欠账而下溢）
    function test_PartialUnstakeKeepsAccountHealthy() public {
        _seedPool(9_900);
        _fund(1_000_000 * 1e18, 0);
        uint256 idA = _stake(alice, 100 * 1e18, 0); // 30 天档
        uint256 idB = _stake(alice, 100 * 1e18, 2); // 270 天档，保持部分仓位

        vm.warp(block.timestamp + 31 * DAY);
        vm.prank(alice);
        staking.unstake(idA); // 部分退出

        // 回归点：权重下降后 accPaid 必须重锚定，否则此处下溢 revert
        vm.warp(block.timestamp + 10 * DAY);
        uint256 bal = vsa.balanceOf(alice);
        vm.prank(alice);
        staking.claim();
        assertGt(vsa.balanceOf(alice) - bal, 0, "still claimable after partial unstake");

        // 剩余持仓仍可到期解押
        vm.warp(block.timestamp + 240 * DAY);
        vm.prank(alice);
        staking.unstake(idB);
        assertEq(tvs.balanceOf(alice), 1_000_000 * 1e18, "remaining principal returned");
    }

    /// @notice 追加质押不得追溯领取过去的历史产出
    function test_SecondStakeNoRetroactiveReward() public {
        _seedPool(9_900);
        _fund(1_000_000 * 1e18, 0);
        _stake(alice, 100 * 1e18, 0);
        vm.warp(block.timestamp + 100 * DAY);

        (uint256 beforePending, , , ) = staking.pendingOf(alice);
        assertGt(beforePending, 0, "has accrued before second stake");

        _stake(alice, 100 * 1e18, 0); // 追加等额

        (uint256 afterPending, , , ) = staking.pendingOf(alice);
        // 追加瞬间不得翻倍（新仓位不应追溯过去 100 天）
        assertLt(afterPending, beforePending + beforePending / 50, "no retroactive reward on new stake");
    }

    /// @notice 部分强行解除后，账户仍可正常领取剩余仓位产出
    function test_PartialEmergencyUnstakeKeepsAccountHealthy() public {
        _seedPool(9_900);
        _fund(1_000_000 * 1e18, 0);
        uint256 idA = _stake(alice, 100 * 1e18, 2);
        _stake(alice, 100 * 1e18, 2);

        vm.warp(block.timestamp + 10 * DAY);
        vm.prank(alice);
        staking.emergencyUnstake(idA);

        vm.warp(block.timestamp + 10 * DAY);
        uint256 bal = vsa.balanceOf(alice);
        vm.prank(alice);
        staking.claim();
        assertGt(vsa.balanceOf(alice) - bal, 0, "still claimable after partial emergency unstake");
    }

    /// @notice 高频领取堆满锁仓队列：笔数封顶 200（合并）、全程保守恒（含 deferred）
    function test_LockQueueCapAndGlobalConservation() public {
        // 100% 份额：触发 2% 限速（deferred）+ 每天领取堆锁仓笔数
        _fund(10_000_000 * 1e18, 0);
        _stake(alice, 100 * 1e18, 2); // 270 天档，持续在押

        uint256 received = 0;
        for (uint256 d = 1; d <= 205; d += 1) {
            vm.warp(block.timestamp + DAY);
            uint256 bal = vsa.balanceOf(alice);
            vm.prank(alice);
            staking.claim();
            received += vsa.balanceOf(alice) - bal;
        }

        // 队列上限：未完结笔数 ≤ 200（超出部分并入最新笔）
        (uint256 entryCount, uint256 lockedRemain, ) = staking.lockStats(alice);
        assertLe(entryCount, 200, "lock queue capped");

        // 全局保守恒：received + pendingRaw + lockedRemaining + deferred == 总产出 E(205d) = 1,025,000
        (uint256 pendingRaw, , uint256 lockedTotal, ) = staking.pendingOf(alice);
        (, , uint256 deferredNow, ) = staking.userInfo(alice);
        uint256 accounted = received + pendingRaw + lockedRemain + deferredNow;
        assertApproxEqAbs(accounted, 1_025_000 * 1e18, 1e6, "global conservation incl deferred");
        // 锁定中 + 待领口径一致性
        assertEq(lockedTotal, lockedRemain, "lockStats consistent with pendingOf");
    }
}
