// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "common/IMintableERC20.sol";

/// @notice Minimal mintable/burnable ERC20 used for Foundry invariants.
contract TestMintableERC20 is ERC20, ERC20Burnable, IMintableERC20 {
    uint8 private immutable _tokenDecimals;
    address private _owner;
    mapping(address => bool) private _minters;

    error NotOwner();
    error NotMinter();

    modifier onlyOwner() {
        if (msg.sender != _owner) revert NotOwner();
        _;
    }

    modifier onlyMinter() {
        if (!_minters[msg.sender]) revert NotMinter();
        _;
    }

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _tokenDecimals = decimals_;
        _owner = msg.sender;
        _minters[msg.sender] = true;
    }

    function decimals() public view override(ERC20, IMintableERC20) returns (uint8) {
        return _tokenDecimals;
    }

    function owner() external view returns (address) {
        return _owner;
    }

    function setOwner(address newOwner) external onlyOwner {
        _owner = newOwner;
    }

    function setMinter(address account, bool allowed) external onlyOwner {
        _minters[account] = allowed;
    }

    function mint(address to, uint256 amount) public override onlyMinter {
        _mint(to, amount);
    }

    function burn(uint256 amount) public override(ERC20Burnable, IMintableERC20) {
        super.burn(amount);
    }

    function burnFrom(address account, uint256 amount) public override(ERC20Burnable, IMintableERC20) {
        super.burnFrom(account, amount);
    }
}
