// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {TestBase} from "./TestBase.sol";
import {TokenDistributor} from "../src/TokenDistributor.sol";
import {Ownable} from "../src/oz/Ownable.sol";
import {MockTVS} from "../src/mocks/MockTVS.sol";
import {MockVSA} from "../src/mocks/MockVSA.sol";

/// @dev 重入攻击者：领取时在代币转账回调里重入 release()，用标志位记录是否得手
contract DistReentrantAttacker {
    TokenDistributor public dist;
    uint256 public targetId;
    bool public reentered;

    constructor(TokenDistributor d) {
        dist = d;
    }

    function setTarget(uint256 id) external {
        targetId = id;
    }

    /// @notice MockVSA hook 回调：尝试重入 release（guard 拦截则 ok = false）
    function onTransfer(address, address, uint256) external {
        (bool ok, ) = address(dist).call(abi.encodeWithSignature("release(uint256)", targetId));
        if (ok) reentered = true; // 重入成功 = 防线失效
        // 正常返回，不打断外层转账
    }
}

contract TokenDistributorTest is TestBase {
    TokenDistributor internal dist;
    MockTVS internal tvs; // 带税（5%），可豁免
    MockVSA internal vsa; // 零税，带可选 hook

    uint256 internal constant DAY = 86_400;
    uint256 internal constant TOTAL = 1_000_000 * 1e18;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal carol = address(0xC0CA);

    function setUp() public {
        tvs = new MockTVS("TVS", "TVS", 500);
        vsa = new MockVSA("VSA", "VSA");
        dist = new TokenDistributor(address(this));

        tvs.mint(address(this), 10 * TOTAL);
        vsa.mint(address(this), 10 * TOTAL);
        tvs.approve(address(dist), type(uint256).max);
        vsa.approve(address(dist), type(uint256).max);
    }

    // ---------- 工具 ----------

    /// @notice 创建日程（默认：vsa 代币、start = now、可撤销；时间参数内部 cast）
    function _create(
        address token,
        address beneficiary,
        uint256 total,
        uint256 start,
        uint256 cliff,
        uint256 linear,
        uint16 tgeBps,
        bool revocable
    ) internal returns (uint256 id) {
        id = dist.createSchedule(token, beneficiary, total, uint64(start), uint64(cliff), uint32(linear), tgeBps, revocable);
    }

    function _createDefault(address beneficiary) internal returns (uint256 id) {
        return _create(address(vsa), beneficiary, TOTAL, block.timestamp, 30 * DAY, 365 * DAY, 2000, true);
    }

    /// @notice 复刻合约解锁公式（单次取整：linearTotal = total − tgePart）
    function _expectedVested(
        uint256 total,
        uint256 tgeBps,
        uint256 start,
        uint256 cliff,
        uint256 linear,
        uint256 t
    ) internal pure returns (uint256) {
        if (t < start) return 0;
        uint256 tgePart = (total * tgeBps) / 1e4;
        uint256 linearTotal = total - tgePart;
        uint256 cliffEnd = start + cliff;
        if (t < cliffEnd) return tgePart;
        if (linear == 0) return total;
        uint256 elapsed = t - cliffEnd;
        if (elapsed >= linear) return total;
        return tgePart + (linearTotal * elapsed) / linear;
    }

    // ---------- 1. 创建与记账 ----------

    function test_CreateScheduleBasic() public {
        uint256 id = _createDefault(alice);
        TokenDistributor.Schedule memory s = dist.schedules(id);
        assertEq(s.total, TOTAL, "total equals received (exempt full)");
        assertEq(s.beneficiary, alice);
        assertEq(s.released, 0);
        assertEq(s.tgeBps, 2000);
        assertTrue(s.revocable);
        assertFalse(s.revoked);
        assertEq(dist.allocated(address(vsa)), TOTAL);
        assertEq(dist.scheduleCount(), 1);
        uint256[] memory ids = dist.schedulesOf(alice);
        assertEq(ids.length, 1);
        assertEq(ids[0], id);
    }

    function test_CreateScheduleWithTaxDelta() public {
        // 不豁免分发合约：入金扣 5% 税，total 必须按实收记账
        tvs.setPool(address(dist), false);
        uint256 id = _create(address(tvs), bob, 1000 * 1e18, uint64(block.timestamp), 0, 0, 1e4, true);
        TokenDistributor.Schedule memory s = dist.schedules(id);
        assertEq(s.total, 950 * 1e18, "total equals balance-delta received");
        assertEq(dist.allocated(address(tvs)), 950 * 1e18);
    }

    function test_TaxChangeMidwayAppliesPerCreate() public {
        // 第一次豁免全额；调税后第二次按 95% 实收
        tvs.setPool(address(dist), true);
        uint256 id1 = _create(address(tvs), alice, 1000 * 1e18, block.timestamp, 0, 0, 1e4, true);
        assertEq(dist.schedules(id1).total, 1000 * 1e18);
        tvs.setPool(address(dist), false);
        uint256 id2 = _create(address(tvs), bob, 1000 * 1e18, block.timestamp, 0, 0, 1e4, true);
        assertEq(dist.schedules(id2).total, 950 * 1e18);
    }

    function test_CreateReverts() public {
        vm.expectRevert(TokenDistributor.ZeroAddress.selector);
        _create(address(0), alice, 1e18, 0, 0, 0, 0, true);
        vm.expectRevert(TokenDistributor.ZeroAddress.selector);
        _create(address(vsa), address(0), 1e18, 0, 0, 0, 0, true);
        vm.expectRevert(TokenDistributor.ZeroAmount.selector);
        _create(address(vsa), alice, 0, 0, 0, 0, 0, true);
        vm.expectRevert(TokenDistributor.BadTgeBps.selector);
        _create(address(vsa), alice, 1e18, 0, 0, 0, 10001, true);
    }

    function test_OnlyOwnerCanCreateAndRevoke() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vm.prank(alice);
        _create(address(vsa), alice, 1e18, 0, 0, 0, 0, true);
        uint256 id = _createDefault(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vm.prank(alice);
        dist.revoke(id);
    }

    // ---------- 2. 解锁曲线 ----------

    function test_TgeImmediateRelease() public {
        uint256 id = _create(address(vsa), alice, TOTAL, uint64(block.timestamp), 100 * DAY, 0, 3000, true);
        // start 时刻：tgePart = 30% 立即可领
        assertEq(dist.releasable(id), 300_000 * 1e18);
        uint256 balBefore = vsa.balanceOf(alice);
        dist.release(id); // 任何人可触发（此处 test 合约即 owner，另测第三方）
        assertEq(vsa.balanceOf(alice) - balBefore, 300_000 * 1e18);
        assertEq(dist.schedules(id).released, 300_000 * 1e18);
        vm.expectRevert(TokenDistributor.NothingToRelease.selector);
        dist.release(id);
    }

    function test_ThirdPartyCanTriggerRelease() public {
        uint256 id = _create(address(vsa), alice, TOTAL, uint64(block.timestamp), 0, 0, 1e4, true);
        vm.prank(bob); // 非受益人非 owner
        dist.release(id);
        assertEq(vsa.balanceOf(alice), TOTAL);
    }

    function test_NothingBeforeStart() public {
        uint256 id = _create(address(vsa), alice, TOTAL, uint64(block.timestamp + 10 * DAY), 0, 0, 1e4, true);
        assertEq(dist.releasable(id), 0, "zero before start");
        vm.expectRevert(TokenDistributor.NothingToRelease.selector);
        dist.release(id);
    }

    function test_CliffBlocksLinearPortion() public {
        uint256 id = _create(address(vsa), alice, TOTAL, uint64(block.timestamp), 30 * DAY, 365 * DAY, 2000, true);
        assertEq(dist.releasable(id), 200_000 * 1e18, "only TGE during cliff");
        vm.warp(block.timestamp + 15 * DAY);
        assertEq(dist.releasable(id), 200_000 * 1e18, "linear still zero before cliff");
    }

    function test_LinearProgressExact() public {
        uint256 id = _create(address(vsa), alice, TOTAL, uint64(block.timestamp), 30 * DAY, 365 * DAY, 2000, true);
        vm.warp(block.timestamp + 30 * DAY + 100 * DAY);
        uint256 expected = _expectedVested(TOTAL, 2000, block.timestamp - 130 * DAY, 30 * DAY, 365 * DAY, block.timestamp);
        assertEq(dist.vested(id, block.timestamp), expected, "linear progress exact");
        assertEq(dist.releasable(id), expected);
        uint256 balBefore = vsa.balanceOf(alice);
        dist.release(id);
        assertEq(vsa.balanceOf(alice) - balBefore, expected);
        // 已领部分不再重复释放
        assertEq(dist.releasable(id), 0);
    }

    function test_VestedExactAtEnd() public {
        // 双重取整回归：小数值 + 非整 tgeBps，期末必须 == total
        uint256 id = _create(address(vsa), alice, 10001, uint64(block.timestamp), 7 * DAY, 100 * DAY, 3333, true);
        vm.warp(block.timestamp + 7 * DAY + 100 * DAY);
        assertEq(dist.vested(id, block.timestamp), 10001, "vested == total at end (single floor)");
        assertEq(dist.releasable(id), 10001);
    }

    function testFuzz_VestedEndExact(uint16 tgeBps, uint128 total) public {
        tgeBps = uint16(tgeBps % 10001); // 0..1e4
        total = uint128(1 + (uint256(total) % 1e24));
        uint256 id = _create(address(vsa), alice, total, uint64(block.timestamp), 7 * DAY, 100 * DAY, tgeBps, true);
        vm.warp(block.timestamp + 7 * DAY + 100 * DAY);
        assertEq(dist.vested(id, block.timestamp), total, "end exact for any tgeBps/total");
    }

    function test_LinearZeroLumpSum() public {
        // linearDuration == 0：cliff 到点后一次性整额解锁
        uint256 id = _create(address(vsa), alice, TOTAL, uint64(block.timestamp), 10 * DAY, 0, 1000, true);
        vm.warp(block.timestamp + 10 * DAY - 1);
        assertEq(dist.releasable(id), 100_000 * 1e18, "TGE part before cliff");
        vm.warp(block.timestamp + 1); // 恰到 cliff
        assertEq(dist.releasable(id), TOTAL, "lump sum at cliff end");
    }

    function test_StartInPastImmediate() public {
        vm.warp(2 * DAY); // 避免默认时间戳 1 减法下溢
        uint256 id = _create(address(vsa), alice, TOTAL, block.timestamp - 1 * DAY, 0, 0, 5000, true);
        // linear = 0 → cliff（= start）已过即整额解锁；start 为过去时刻立即生效
        assertEq(dist.releasable(id), TOTAL, "past start effective now");
    }

    function test_CliffLongerThanLinear() public {
        // cliff 100 天 > 线性 10 天：cliff 到点后 10 天内放完
        uint256 id = _create(address(vsa), alice, TOTAL, uint64(block.timestamp), 100 * DAY, 10 * DAY, 0, true);
        vm.warp(block.timestamp + 105 * DAY);
        uint256 expected = _expectedVested(TOTAL, 0, block.timestamp - 105 * DAY, 100 * DAY, 10 * DAY, block.timestamp);
        assertEq(dist.vested(id, block.timestamp), expected);
        vm.warp(block.timestamp + 5 * DAY); // cliff + 10 天
        assertEq(dist.vested(id, block.timestamp), TOTAL);
    }

    function test_VestedViewExplicitTimestamp() public {
        uint256 id = _create(address(vsa), alice, TOTAL, uint64(block.timestamp), 30 * DAY, 365 * DAY, 2000, true);
        uint256 future = block.timestamp + 30 * DAY + 182 * DAY; // 半程
        uint256 expected = _expectedVested(TOTAL, 2000, block.timestamp, 30 * DAY, 365 * DAY, future);
        assertEq(dist.vested(id, future), expected, "vested at explicit timestamp");
    }

    // ---------- 3. 多日程 / 聚合领取 ----------

    function test_MultiBeneficiaryIndependent() public {
        uint256 idA = _create(address(vsa), alice, TOTAL, uint64(block.timestamp), 0, 0, 1e4, true);
        uint256 idB = _create(address(vsa), bob, TOTAL, uint64(block.timestamp), 0, 0, 1e4, true);
        dist.release(idA);
        assertEq(vsa.balanceOf(alice), TOTAL);
        assertEq(dist.releasable(idB), TOTAL, "schedules independent");
        assertEq(dist.allocated(address(vsa)), TOTAL); // 1000+1000-1000
    }

    function test_BatchReleaseAggregatesAndSkipsZero() public {
        uint256 id1 = _create(address(vsa), carol, TOTAL, block.timestamp, 0, 365 * DAY, 3000, true); // 可领 30%
        uint256 id2 = _create(address(vsa), carol, TOTAL, block.timestamp, 0, 365 * DAY, 2000, true); // 可领 20%
        uint256 id3 = _create(address(vsa), carol, TOTAL, block.timestamp + 365 * DAY, 0, 0, 1e4, true); // 未开始
        vm.prank(carol);
        uint256 got = dist.batchRelease(carol);
        assertEq(got, 500_000 * 1e18, "batch sums 30pct+20pct skips future");
        assertEq(vsa.balanceOf(carol), 500_000 * 1e18);
        assertEq(dist.schedules(id1).released, 300_000 * 1e18);
        assertEq(dist.schedules(id2).released, 200_000 * 1e18);
        assertEq(dist.schedules(id3).released, 0);
        // 再领一次无事可领
        vm.prank(carol);
        assertEq(dist.batchRelease(carol), 0);
    }

    function test_SchedulesOfView() public {
        uint256 id1 = _createDefault(alice);
        uint256 id2 = _createDefault(alice);
        uint256[] memory ids = dist.schedulesOf(alice);
        assertEq(ids.length, 2);
        assertEq(ids[0], id1);
        assertEq(ids[1], id2);
        uint256[] memory none = dist.schedulesOf(bob);
        assertEq(none.length, 0);
    }

    // ---------- 4. 撤销（结清） ----------

    function test_RevokeSettlesExactly() public {
        uint256 id = _create(address(vsa), alice, TOTAL, uint64(block.timestamp), 30 * DAY, 365 * DAY, 2000, true);
        vm.warp(block.timestamp + 30 * DAY + 100 * DAY);
        uint256 claimed = dist.releasable(id);
        dist.release(id); // 先领一部分
        uint256 ownerBalBefore = vsa.balanceOf(address(this));
        uint256 aliceBalBefore = vsa.balanceOf(alice);

        dist.revoke(id); // 结清：已解锁未领 → alice，未解锁 → owner

        uint256 vestedNow = _expectedVested(TOTAL, 2000, block.timestamp - 130 * DAY, 30 * DAY, 365 * DAY, block.timestamp);
        assertEq(vsa.balanceOf(alice) - aliceBalBefore, vestedNow - claimed, "vested-unclaimed paid to beneficiary");
        assertEq(vsa.balanceOf(address(this)) - ownerBalBefore, TOTAL - vestedNow, "unvested refunded to owner");
        // 守恒：released + 撤销支付 + 退款 == total
        assertEq(dist.schedules(id).released + (TOTAL - vestedNow), TOTAL);
        assertTrue(dist.schedules(id).revoked);
        assertEq(dist.releasable(id), 0, "nothing releasable after revoke");
        assertEq(dist.allocated(address(vsa)), 0);
    }

    function test_RevokeStopsRelease() public {
        uint256 id = _createDefault(alice);
        dist.revoke(id);
        assertEq(dist.releasable(id), 0);
        vm.expectRevert(TokenDistributor.NothingToRelease.selector);
        dist.release(id);
        // 时间推进也不再生效
        vm.warp(block.timestamp + 365 * DAY);
        assertEq(dist.releasable(id), 0);
    }

    function test_RevokeTwiceReverts() public {
        uint256 id = _createDefault(alice);
        dist.revoke(id);
        vm.expectRevert(TokenDistributor.AlreadyRevoked.selector);
        dist.revoke(id);
    }

    function test_RevokeNonRevocableReverts() public {
        uint256 id = _create(address(vsa), alice, TOTAL, uint64(block.timestamp), 0, 0, 1e4, false);
        vm.expectRevert(TokenDistributor.NotRevocable.selector);
        dist.revoke(id);
    }

    function test_RevokeFullyVestedReverts() public {
        uint256 id = _create(address(vsa), alice, TOTAL, block.timestamp, 0, 0, 1e4, true);
        dist.release(id); // 全额已领
        vm.warp(block.timestamp + 1);
        // 结清语义：paid = 0 且 refund = 0 → 无事可撤
        vm.expectRevert(TokenDistributor.NothingToRevoke.selector);
        dist.revoke(id);
    }

    function test_RevokeNoSuchSchedule() public {
        vm.expectRevert(TokenDistributor.NoSuchSchedule.selector);
        dist.revoke(99);
        vm.expectRevert(TokenDistributor.NoSuchSchedule.selector);
        dist.release(99);
    }

    // ---------- 5. 资金不变量 / 回收 ----------

    function test_RecoverWrongTokenSurplusOnly() public {
        uint256 id = _createDefault(alice);
        // 全部余额都是未清义务 → 不可回收
        vm.expectRevert(TokenDistributor.ExceedsSurplus.selector);
        dist.recoverWrongToken(address(vsa), 1);
        // 误转 5 枚进来 → 盈余可回收
        vsa.mint(address(dist), 5 * 1e18);
        dist.recoverWrongToken(address(vsa), 5 * 1e18);
        assertEq(vsa.balanceOf(address(this)), 10 * TOTAL + 5 * 1e18 - TOTAL);
        vm.expectRevert(TokenDistributor.ExceedsSurplus.selector);
        dist.recoverWrongToken(address(vsa), 1);
    }

    function test_RecoverAfterReleaseKeepsInvariant() public {
        uint256 id = _create(address(vsa), alice, TOTAL, uint64(block.timestamp), 0, 0, 1e4, true);
        dist.release(id); // allocated -= TOTAL，义务清零
        assertEq(dist.allocated(address(vsa)), 0);
        assertEq(vsa.balanceOf(address(dist)), 0);
        // 义务清零后全额可回收（此时合约无义务）
        vsa.mint(address(dist), 1e18);
        dist.recoverWrongToken(address(vsa), 1e18);
    }

    function test_AllocatedInvariantAcrossLifecycle() public {
        uint256 id1 = _create(address(vsa), alice, TOTAL, block.timestamp, 0, 365 * DAY, 3000, true);
        uint256 id2 = _create(address(vsa), bob, TOTAL, block.timestamp, 0, 365 * DAY, 2000, true);
        assertEq(dist.allocated(address(vsa)), 2 * TOTAL);
        dist.release(id1); // 领取 TGE 30%
        assertEq(dist.allocated(address(vsa)), 2 * TOTAL - 300_000 * 1e18);
        dist.revoke(id2); // 结清：已解锁 20% 给 bob，未解锁 80% 退 owner
        // 义务：2000k − 300k(领取) − 200k(结清支付) − 800k(退款) = 700k，与余额一致
        assertEq(dist.allocated(address(vsa)), 700_000 * 1e18);
        assertEq(vsa.balanceOf(address(dist)), 700_000 * 1e18);
    }

    function test_RecoverBnb() public {
        vm.deal(address(dist), 1 ether);
        uint256 before = address(this).balance;
        dist.recoverBNB();
        assertEq(address(this).balance - before, 1 ether);
        vm.expectRevert(TokenDistributor.ZeroAmount.selector);
        dist.recoverBNB();
    }

    receive() external payable {}

    // ---------- 6. 重入防护 ----------

    function test_ReentrancyGuardBlocksCallback() public {
        DistReentrantAttacker attacker = new DistReentrantAttacker(dist);
        uint256 id = _create(address(vsa), address(attacker), TOTAL, block.timestamp, 0, 0, 1e4, true);
        attacker.setTarget(id);
        vsa.setHook(address(attacker)); // 先建日程再挂钩子
        dist.release(id); // 外层正常完成
        assertFalse(attacker.reentered(), "reentrancy blocked by guard");
        assertEq(vsa.balanceOf(address(attacker)), TOTAL, "outer release paid in full");
    }
}
