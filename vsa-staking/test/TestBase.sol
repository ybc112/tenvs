// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title TestBase — 最小 Foundry 测试基座（forge-std 的自包含替代，规避 GitHub 直连）
 * @notice Vm 接口只声明稳定签名的 cheatcode（与 forge 内置 cheatcode 注册表按签名匹配选择器）；
 *         断言用 require 风格 revert 实现：失败即回滚，forge 判定测试失败并回显原因。
 */

/// @dev 最小 cheatcode 面（签名与 forge 内置注册表一致）
interface Vm {
    function prank(address msgSender) external;
    function startPrank(address msgSender) external;
    function startPrank(address msgSender, address txOrigin) external;
    function stopPrank() external;
    function warp(uint256 newTimestamp) external;
    function roll(uint256 newHeight) external;
    function deal(address account, uint256 newBalance) external;
    function label(address account, string calldata name) external;
    function log(string memory text) external;
    function log(string memory text, uint256 value) external;
    function expectRevert() external;
    function expectRevert(bytes4 revertData) external;
    function expectRevert(bytes memory revertData) external;
}

abstract contract TestBase {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    // ---------- 断言（失败即 revert，forge 判定测试失败） ----------
    function _fail(string memory what) internal pure {
        revert(string.concat("ASSERT FAIL: ", what));
    }

    function assertTrue(bool data) internal pure {
        if (!data) _fail("assertTrue");
    }

    function assertTrue(bool data, string memory why) internal pure {
        if (!data) revert(string.concat("ASSERT FAIL: ", why));
    }

    function assertFalse(bool data) internal pure {
        if (data) _fail("assertFalse");
    }

    function assertFalse(bool data, string memory why) internal pure {
        if (data) revert(string.concat("ASSERT FAIL: ", why));
    }

    function assertEq(uint256 a, uint256 b) internal pure {
        if (a != b) _fail("assertEq(uint256)");
    }

    function assertEq(uint256 a, uint256 b, string memory why) internal pure {
        if (a != b) revert(string.concat("ASSERT FAIL: ", why));
    }

    function assertEq(address a, address b) internal pure {
        if (a != b) _fail("assertEq(address)");
    }

    function assertEq(bool a, bool b) internal pure {
        if (a != b) _fail("assertEq(bool)");
    }

    function assertGt(uint256 a, uint256 b) internal pure {
        if (!(a > b)) _fail("assertGt(uint256)");
    }

    function assertGt(uint256 a, uint256 b, string memory why) internal pure {
        if (!(a > b)) revert(string.concat("ASSERT FAIL: ", why));
    }

    function assertLt(uint256 a, uint256 b) internal pure {
        if (!(a < b)) _fail("assertLt(uint256)");
    }

    function assertLe(uint256 a, uint256 b) internal pure {
        if (!(a <= b)) _fail("assertLe(uint256)");
    }

    function assertLe(uint256 a, uint256 b, string memory why) internal pure {
        if (!(a <= b)) revert(string.concat("ASSERT FAIL: ", why));
    }

    function assertLt(uint256 a, uint256 b, string memory why) internal pure {
        if (!(a < b)) revert(string.concat("ASSERT FAIL: ", why));
    }

    function assertApproxEqAbs(uint256 a, uint256 b, uint256 maxDelta) internal pure {
        uint256 diff = a > b ? a - b : b - a;
        if (diff > maxDelta) _fail("assertApproxEqAbs(uint256)");
    }

    function assertApproxEqAbs(uint256 a, uint256 b, uint256 maxDelta, string memory why) internal pure {
        uint256 diff = a > b ? a - b : b - a;
        if (diff > maxDelta) revert(string.concat("ASSERT FAIL: ", why));
    }
}
