// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev 最小广播/环境变量 cheatcode 面（与 TestBase 同样自包含，规避 forge-std 依赖）
interface VmScript {
    function startBroadcast() external;
    function startBroadcast(address signer) external;
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
    function addr(uint256 privateKey) external view returns (address);
    function log(string calldata message) external;
    function envAddress(string calldata name) external view returns (address);
    function envUint(string calldata name) external view returns (uint256);
    function envOr(string calldata name, uint256 defaultValue) external view returns (uint256);
    function envOr(string calldata name, address defaultValue) external view returns (address);
    function envOr(string calldata name, string calldata defaultValue) external view returns (string memory);
}

abstract contract ScriptBase {
    VmScript internal constant vm = VmScript(address(uint160(uint256(keccak256("hevm cheat code")))));
}
