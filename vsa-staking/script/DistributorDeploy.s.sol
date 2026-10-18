// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ScriptBase} from "./ScriptBase.sol";
import {TokenDistributor} from "../src/TokenDistributor.sol";
import {MockTVS} from "../src/mocks/MockTVS.sol";

/**
 * @title DistributorDeploy — TokenDistributor 部署（测试网一键 / 主网仅部署）
 *
 * 环境变量（见 .env）：
 *   TESTNET_PRIVATE_KEY  部署私钥（必填）
 *   DISTRIBUTION_TOKEN   分发代币地址（可选；留空 = 测试网模式，现场部署 MockTVS）
 *   DISTRIBUTOR_OWNER    分发合约 owner（默认 = 社区自治核心多签 0xabce...7812）
 *   DIST_AMOUNT          分发总量（仅测试网模式用于建日程，默认 1,000,000e18）
 *
 * 两种模式：
 *  ① 测试网模式（DISTRIBUTION_TOKEN 留空）
 *     现场部署 MockTVS → 部署钱包为 owner → 一键建 5 条日程 → 交接给 DISTRIBUTOR_OWNER
 *  ② 主网正式模式（DISTRIBUTION_TOKEN = 真 VSA 0x0282...7777）
 *     仅部署 TokenDistributor，owner 直接设为 DISTRIBUTOR_OWNER（金库多签）；
 *     5 条日程由 owner（金库多签）经 Safe 批量执行 approve + createSchedule 创建
 *     （部署钱包不持 VSA、也非 owner，故脚本不建日程）
 *
 * 默认分配方案（占分发总量百分比）：
 *   市值多签   30% | TGE 20% | cliff 30 天 | 线性 365 天 | 可撤销
 *   LP 多签    20% | TGE 30% | cliff 0    | 线性 180 天 | 可撤销
 *   社区激励   25% | TGE 10% | cliff 90 天 | 线性 730 天 | 可撤销
 *   商学院多签 15% | TGE 10% | cliff 90 天 | 线性 730 天 | 可撤销
 *   质押多签   10% | TGE 0%  | cliff 0    | 线性 730 天 | 可撤销
 *
 * 用法：
 *   测试网：forge script script/DistributorDeploy.s.sol:DistributorDeploy --rpc-url bsc_testnet --broadcast
 *   主网：  DISTRIBUTION_TOKEN=0x02828c0a371ab1A0F2D2EC446484a06AAAa87777 \
 *           DISTRIBUTOR_OWNER=0xaBce72802F9d85CdB45063057E079ce6AbdD7812 \
 *           forge script script/DistributorDeploy.s.sol:DistributorDeploy --rpc-url bsc --broadcast
 */
contract DistributorDeploy is ScriptBase {
    // 多签角色地址（用户提供；LP 与商学院为同一地址，已确认）
    address constant MARKET_MS = 0xa80F329Fd36b9c2DA6dEC86d1df1E518500A9123;
    address constant LP_MS = 0x6e5Ed612Fc7B054c28a3d2C1aC92eeB098EAD7d5;
    address constant COMMUNITY_MS = 0x227ea5869d11cC683BA9B43F8BC10278B210Ff3f;
    address constant ACADEMY_MS = 0x6e5Ed612Fc7B054c28a3d2C1aC92eeB098EAD7d5;
    address constant STAKING_MS = 0x72f8637eC6519702B99a22Ec6F893FB3822dD213;
    address constant GOVERNANCE_MS = 0xaBce72802F9d85CdB45063057E079ce6AbdD7812; // 社区自治核心（默认 owner）

    uint256 constant DAY = 86_400;

    function run() external returns (TokenDistributor dist) {
        uint256 pk = vm.envUint("TESTNET_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address tokenAddr = vm.envOr("DISTRIBUTION_TOKEN", address(0));
        address distOwner = vm.envOr("DISTRIBUTOR_OWNER", GOVERNANCE_MS);
        uint256 amount = vm.envOr("DIST_AMOUNT", uint256(1_000_000 * 1e18));

        vm.startBroadcast(pk);

        if (tokenAddr == address(0)) {
            // ===== ① 测试网模式：MockTVS + 一键建日程 =====
            MockTVS token = new MockTVS("TVS Test", "TVS", 500);
            tokenAddr = address(token);
            dist = new TokenDistributor(deployer);

            token.setPool(address(dist), true);
            token.mint(deployer, amount);

            IERC20Tok(tokenAddr).approve(address(dist), amount);
            uint256 start = block.timestamp;
            dist.createSchedule(tokenAddr, MARKET_MS, (amount * 3000) / 1e4, uint64(start), uint64(30 * DAY), uint32(365 * DAY), 2000, true);
            dist.createSchedule(tokenAddr, LP_MS, (amount * 2000) / 1e4, uint64(start), 0, uint32(180 * DAY), 3000, true);
            dist.createSchedule(tokenAddr, COMMUNITY_MS, (amount * 2500) / 1e4, uint64(start), uint64(90 * DAY), uint32(730 * DAY), 1000, true);
            dist.createSchedule(tokenAddr, ACADEMY_MS, (amount * 1500) / 1e4, uint64(start), uint64(90 * DAY), uint32(730 * DAY), 1000, true);
            dist.createSchedule(tokenAddr, STAKING_MS, (amount * 1000) / 1e4, uint64(start), 0, uint32(730 * DAY), 0, true);

            if (distOwner != deployer) {
                dist.transferOwnership(distOwner);
            }
        } else {
            // ===== ② 主网正式模式：仅部署，owner 直设金库多签 =====
            dist = new TokenDistributor(distOwner);
        }

        vm.stopBroadcast();

        emit Deployed("deployer        ", deployer);
        emit Deployed("token           ", tokenAddr);
        emit Deployed("TokenDistributor", address(dist));
        emit Deployed("owner           ", dist.owner());
        emit Deployed("pendingOwner    ", dist.pendingOwner());
        emit DeployedU("schedules       ", dist.scheduleCount());
        emit DeployedU("allocated       ", dist.allocated(tokenAddr));
    }

    event Deployed(string label, address indexed value);
    event DeployedU(string label, uint256 indexed value);
}

/// @dev 最小 ERC20 调用面（approve）
interface IERC20Tok {
    function approve(address spender, uint256 amount) external returns (bool);
}
