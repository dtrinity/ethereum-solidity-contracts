// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { DataTypes } from "../../dlend/core/protocol/libraries/types/DataTypes.sol";

// TEST ONLY. The real StaticATokenLM is used by the tests; these deterministic
// pool/controller fixtures isolate its accounting from live emissions and RPCs.
contract FollowupAToken is ERC20 {
    address public immutable UNDERLYING_ASSET_ADDRESS;
    constructor(address asset_) ERC20("Test aToken", "TA") {
        UNDERLYING_ASSET_ADDRESS = asset_;
    }
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
    function scaledTotalSupply() external view returns (uint256) {
        return totalSupply();
    }
}

contract FollowupIndexPool {
    uint256 public income = 1e27;
    FollowupAToken public immutable aToken;
    constructor(FollowupAToken token_) {
        aToken = token_;
    }
    function setIncome(uint256 rate_) external {
        require(rate_ >= 1e27);
        income = rate_;
    }
    function getReserveNormalizedIncome(address) external view returns (uint256) {
        return income;
    }
    function getReserveData(address) external view returns (DataTypes.ReserveData memory r) {
        r.configuration.data = (uint256(1) << 56) | (uint256(18) << 48); // active, 18 decimals, no cap
        r.aTokenAddress = address(aToken);
        r.liquidityIndex = uint128(income);
        r.lastUpdateTimestamp = uint40(block.timestamp);
    }
    function deposit(address asset, uint256 amount, address onBehalfOf, uint16) external {
        require(IERC20(asset).transferFrom(msg.sender, address(aToken), amount));
        aToken.mint(onBehalfOf, amount);
    }
}

contract FollowupRewardsController {
    address public immutable reward;
    address public immutable owner;
    uint256 public index = 1e18;
    mapping(address => address) private claimers;
    constructor(address reward_) {
        reward = reward_;
        owner = msg.sender;
    }
    function getRewardsController() external view returns (address) {
        return address(this);
    }
    function setIndex(uint256 next) external {
        require(next >= index);
        index = next;
    }
    function setClaimer(address user, address claimer) external {
        require(msg.sender == owner);
        claimers[user] = claimer;
    }
    function getClaimer(address user) external view returns (address) {
        return claimers[user];
    }
    function getRewardsByAsset(address) external view returns (address[] memory list) {
        list = new address[](1);
        list[0] = reward;
    }
    function getAssetIndex(address, address) external view returns (uint256, uint256) {
        return (index, index);
    }
    function getUserRewards(address[] calldata, address, address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }
    function claimRewards(address[] calldata, uint256 amount, address to, address token) external returns (uint256) {
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (amount > balance) amount = balance;
        require(IERC20(token).transfer(to, amount));
        return amount;
    }
    // Deliberately no aggregate claimAllRewardsOnBehalf: the manager must use the
    // real wrapper's holder-level claim, NOT bypass its accounting.
}

contract FollowupCurvePoolSentinel {
    error ExternalProtocolTouched();
    function getReservesList() external pure returns (address[] memory) {
        return new address[](0);
    }
    function getReserveData(address) external pure returns (DataTypes.ReserveData memory) {
        revert ExternalProtocolTouched();
    }
    fallback() external {
        revert ExternalProtocolTouched();
    }
}

contract FollowupFeed {
    uint8 public constant decimals = 8;
    uint80 public constant version = 1;
    int256 public answer = 1e8;
    uint256 public started;
    uint256 public updated;
    constructor() {
        started = block.timestamp;
        updated = block.timestamp;
    }
    function setTimes(uint256 started_, uint256 updated_) external {
        started = started_;
        updated = updated_;
    }
    function description() external pure returns (string memory) {
        return "Test feed";
    }
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, started, updated, 1);
    }
}
