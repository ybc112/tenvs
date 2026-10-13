// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "../oz/IERC20.sol";

/**
 * @title MockTVS — 模拟带税 TVS（仅测试/测试网）
 * @notice 模拟 TVS 的税机制：transferFrom 时对非豁免地址扣 taxBps；
 *         豁免走 pools(address) 映射（与真实 TVS 一致的形态，便于联调豁免路径）
 */
contract MockTVS is IERC20 {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    uint256 public taxBps;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public pools; // 豁免映射（仿真实 TVS）

    address public owner;

    event TaxExemptSet(address indexed account, bool exempt);

    constructor(string memory name_, string memory symbol_, uint256 taxBps_) {
        name = name_;
        symbol = symbol_;
        taxBps = taxBps_;
        owner = msg.sender;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function setPool(address account, bool exempt) external {
        require(msg.sender == owner, "only owner");
        pools[account] = exempt;
        emit TaxExemptSet(account, exempt);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        return _transfer(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "insufficient allowance");
            allowance[from][msg.sender] = allowed - amount;
        }
        return _transfer(from, to, amount);
    }

    function _transfer(address from, address to, uint256 amount) internal returns (bool) {
        require(balanceOf[from] >= amount, "insufficient balance");
        balanceOf[from] -= amount;
        // 豁免（发送方或接收方任一在 pools）则全额，否则扣税
        if (pools[from] || pools[to] || taxBps == 0) {
            balanceOf[to] += amount;
            emit Transfer(from, to, amount);
        } else {
            uint256 tax = (amount * taxBps) / 10000;
            balanceOf[to] += amount - tax;
            balanceOf[address(this)] += tax; // 税留存本合约（测试用）
            emit Transfer(from, to, amount - tax);
        }
        return true;
    }
}
