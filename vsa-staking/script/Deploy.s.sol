// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ScriptBase} from "./ScriptBase.sol";
import {VSAStaking} from "../src/VSAStaking.sol";

/**
 * @title Deploy — VSAStaking 部署脚本
 *
 * 环境变量：
 *   TVS_ADDRESS    质押币 TVS（必填）
 *   VSA_ADDRESS    产出币 VSA（必填）
 *   INITIAL_OWNER  初始 owner（必填；建议先填部署多签，或部署后 transferOwnership）
 *   DAY_SECONDS    一个业务日秒数（可选，默认 86400）
 *                  · 主网：留空或 86400
 *                  · 测试网/联调加速：60（→30 天档=30 分钟，90 天锁仓=90 分钟，全曲线≈2.5 天）
 *                  · 极限快测：10（→ 全曲线≈10 小时）
 *
 * 用法：
 *   forge script script/Deploy.s.sol:Deploy --rpc-url $RPC --broadcast
 *   # 加速版：
 *   $env:DAY_SECONDS=60; forge script script/Deploy.s.sol:Deploy --rpc-url $RPC --broadcast
 *
 * 部署后必须（见交付文档）：
 *   1) TVS 合约将质押合约地址加入税豁免（否则转账被扣税，用户实收变少）
 *   2) transferOwnership → Gnosis Safe 3/5（两步确认）
 *   3) Safe 调 fundRewardPool / fundBonusPool 注资产出池与复投奖池
 */
contract Deploy is ScriptBase {
    function run() external returns (VSAStaking staking) {
        address tvs = vm.envAddress("TVS_ADDRESS");
        address vsa = vm.envAddress("VSA_ADDRESS");
        address initialOwner = vm.envAddress("INITIAL_OWNER");
        uint256 daySeconds = vm.envOr("DAY_SECONDS", uint256(86400));

        // 主网硬闸：chainId 56 必须用真实业务日（防止误用测试加速值）
        if (block.chainid == 56 && daySeconds != 86400) {
            revert("mainnet requires DAY_SECONDS=86400");
        }
        if (daySeconds == 0) revert("DAY_SECONDS must be > 0");

        vm.startBroadcast();
        staking = new VSAStaking(tvs, vsa, initialOwner, daySeconds);
        vm.stopBroadcast();
    }
}
