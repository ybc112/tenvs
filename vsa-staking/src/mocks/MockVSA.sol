// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "../oz/IERC20.sol";

/**
 * @title MockVSA — 模拟零税 BEP-20 产出币（仅测试/测试网）
 * @notice 真实 VSA 由外部代币合约承接，此处仅用于本地测试与测试网联调。
 *         附带可选 transfer hook（用于重入防护测试）。
 */
contract MockVSA is IERC20 {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    address public hook; // 可选回调（每次 transfer 后触发）

    constructor(string memory name_, string memory symbol_) {
        name = name_;
        symbol = symbol_;
    }

    function setHook(address h) external {
        hook = h;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "insufficient allowance");
            allowance[from][msg.sender] = allowed - amount;
        }
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        if (hook != address(0)) {
            (bool ok, bytes memory ret) =
                hook.call(abi.encodeWithSignature("onTransfer(address,address,uint256)", from, to, amount));
            if (!ok) {
                // 原样冒泡回滚数据（保留重入 revert 的原始错误）
                assembly ("memory-safe") {
                    revert(add(ret, 32), mload(ret))
                }
            }
        }
    }
}
