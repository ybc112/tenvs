// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (v5.0.x) vendored: access/Ownable2Step.sol
pragma solidity ^0.8.20;

import {Ownable} from "./Ownable.sol";

abstract contract Ownable2Step is Ownable {
    address private _pendingOwner;

    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);

    function pendingOwner() public view virtual returns (address) {
        return _pendingOwner;
    }

    function transferOwnership(address newOwner) public virtual onlyOwner {
        _pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner(), newOwner);
    }

    function acceptOwnership() external {
        address sender = _msgSender();
        if (pendingOwner() != sender) revert OwnableUnauthorizedAccount(sender);
        _transferOwnership(sender);
        delete _pendingOwner;
    }
}
