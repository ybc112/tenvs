// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (v5.0.x) vendored: utils/Context.sol
pragma solidity ^0.8.20;

abstract contract Context {
    function _msgSender() internal view virtual returns (address) {
        return msg.sender;
    }

    function _msgData() internal view virtual returns (bytes calldata) {
        return msg.data;
    }
}
