// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ScriptBase} from "./ScriptBase.sol";
import {VSAStaking} from "../src/VSAStaking.sol";
import {MockTVS} from "../src/mocks/MockTVS.sol";
import {MockVSA} from "../src/mocks/MockVSA.sol";

/**
 * @title TestnetDeploy — BSC 测试网一键部署全流程
 *
 * 环境变量（见 .env）：
 *   TESTNET_PRIVATE_KEY  部署私钥（必填；专用测试钱包，绝不复用到主网）
 *   STAKING_OWNER        质押合约 owner 交接目标（可选；传质押多签地址 = 模拟交接，
 *                        测试网该多签未部署时 owner 仍由部署钱包代持）
 *   DAY_SECONDS          业务日秒数（默认 60：30 天档 = 30 分钟，90 天锁仓 = 90 分钟）
 *
 * 用法：
 *   forge script script/TestnetDeploy.s.sol:TestnetDeploy --rpc-url bsc_testnet --broadcast
 *
 * 流程：MockTVS + MockVSA + VSAStaking 部署 → TVS 税豁免质押合约 →
 *       部署钱包 mint 测试资金 → 注资产出池 / 复投奖池 → pendingOwner 交接质押多签
 */
contract TestnetDeploy is ScriptBase {
    function run() external returns (MockTVS tvs, MockVSA vsa, VSAStaking staking) {
        uint256 pk = vm.envUint("TESTNET_PRIVATE_KEY");
        address owner = vm.envOr("STAKING_OWNER", address(0));
        uint256 daySeconds = vm.envOr("DAY_SECONDS", uint256(60));
        address deployer = vm.addr(pk);
        if (daySeconds == 0) revert("DAY_SECONDS must be > 0");

        vm.startBroadcast(pk);

        tvs = new MockTVS("TVS Test", "TVS", 500); // 5% 转账税（默认池子豁免）
        vsa = new MockVSA("VSA Test", "VSA");
        staking = new VSAStaking(address(tvs), address(vsa), deployer, daySeconds);

        // 税豁免：用户往质押合约质押不扣税（实收 = 全额）
        tvs.setPool(address(staking), true);

        // 测试资金：部署钱包 100 万 TVS + 200 万 VSA，注资产出池 / 复投奖池
        tvs.mint(deployer, 1_000_000 * 1e18);
        vsa.mint(deployer, 2_000_000 * 1e18);
        vsa.approve(address(staking), type(uint256).max);
        staking.fundRewardPool(1_000_000 * 1e18);
        staking.fundBonusPool(100_000 * 1e18);

        // 模拟交接：pendingOwner = 质押多签（主网由 Safe 执行 acceptOwnership）
        if (owner != address(0) && owner != deployer) {
            staking.transferOwnership(owner);
        }

        vm.stopBroadcast();

        // 用事件输出地址（该 forge 版本的 log cheatcode 不可用，事件在 trace 中稳定可见）
        emit Deployed("deployer    ", deployer);
        emit Deployed("TVS         ", address(tvs));
        emit Deployed("VSA         ", address(vsa));
        emit Deployed("VSAStaking  ", address(staking));
        emit Deployed("owner       ", staking.owner());
        emit Deployed("pendingOwner", staking.pendingOwner());
        emit DeployedU256("daySeconds ", daySeconds);
    }

    event Deployed(string label, address indexed value);
    event DeployedU256(string label, uint256 indexed value);
}
