// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Simple ERC20 that reverts transfers to blocked recipients.
contract MockERC20Blocklist is ERC20 {
    error BlockedRecipient(address account);

    mapping(address => bool) public blocked;
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function setBlocked(address account, bool status) external {
        blocked[account] = status;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (blocked[to]) {
            revert BlockedRecipient(to);
        }
        super._update(from, to, value);
    }
}
