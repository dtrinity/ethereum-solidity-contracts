// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IRewardHookReceiver {
    function onRewardReceived(address token, uint256 amount) external;
}

/// @dev ERC20 that triggers receiver hook callbacks for registered recipients.
contract MockRewardHookToken is ERC20 {
    address public immutable owner;
    mapping(address => bool) public hookEnabled;

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {
        owner = msg.sender;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == owner, "not owner");
        _mint(to, amount);
    }

    function setHook(address account, bool status) external {
        require(msg.sender == owner, "not owner");
        hookEnabled[account] = status;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);

        if (from == address(0) || value == 0 || !hookEnabled[to]) {
            return;
        }

        if (to.code.length > 0) {
            IRewardHookReceiver(to).onRewardReceived(address(this), value);
        }
    }
}
