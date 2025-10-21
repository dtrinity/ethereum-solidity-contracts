// USD Oracles
export const USD_ORACLE_AGGREGATOR_ID = "USD_OracleAggregator";
export const USD_API3_ORACLE_WRAPPER_ID = "USD_API3Wrapper";
export const USD_API3_WRAPPER_WITH_THRESHOLDING_ID = "USD_API3WrapperWithThresholding";
export const USD_API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID = "USD_API3CompositeWrapperWithThresholding";
export const USD_REDSTONE_ORACLE_WRAPPER_ID = "USD_RedstoneChainlinkWrapper";
export const USD_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID = "USD_RedstoneChainlinkWrapperWithThresholding";
export const USD_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID = "USD_RedstoneChainlinkCompositeWrapperWithThresholding";

// Pendle PT Oracles
export const PENDLE_CHAINLINK_ORACLE_FACTORY_ID = "PendleChainlinkOracleFactory";
export const PENDLE_PT_AUSDC_DECIMAL_CONVERTER_ID = "ChainlinkDecimalConverter_PT_aUSDC_14AUG2025";
export const PENDLE_PT_WSTKSCUSD_DECIMAL_CONVERTER_ID = "ChainlinkDecimalConverter_PT_wstkscUSD_18DEC2025";
export const OS_TO_S_DECIMAL_CONVERTER_ID = "ChainlinkDecimalConverter_OS_to_S";
export const WOS_TO_OS_DECIMAL_CONVERTER_ID = "ChainlinkDecimalConverter_wOS_to_OS";

// ETH Oracles
export const ETH_ORACLE_AGGREGATOR_ID = "ETH_OracleAggregator";
export const ETH_API3_ORACLE_WRAPPER_ID = "ETH_API3Wrapper";
export const ETH_API3_WRAPPER_WITH_THRESHOLDING_ID = "ETH_API3WrapperWithThresholding";
export const ETH_API3_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID = "ETH_API3CompositeWrapperWithThresholding";
export const ETH_REDSTONE_ORACLE_WRAPPER_ID = "ETH_RedstoneWrapper";
export const ETH_REDSTONE_WRAPPER_WITH_THRESHOLDING_ID = "ETH_RedstoneWrapperWithThresholding";
export const ETH_REDSTONE_COMPOSITE_WRAPPER_WITH_THRESHOLDING_ID = "ETH_RedstoneCompositeWrapperWithThresholding";

// dUSD
export const DUSD_TOKEN_ID = "dUSD";
export const DUSD_ISSUER_CONTRACT_ID = "dUSD_Issuer";
export const DUSD_ISSUER_V2_CONTRACT_ID = "dUSD_IssuerV2";
export const DUSD_REDEEMER_CONTRACT_ID = "dUSD_Redeemer";
export const DUSD_COLLATERAL_VAULT_CONTRACT_ID = "dUSD_CollateralHolderVault";
export const DUSD_AMO_MANAGER_ID = "dUSD_AmoManager";
export const DUSD_HARD_PEG_ORACLE_WRAPPER_ID = "dUSD_HardPegOracleWrapper";

// dETH
export const DETH_TOKEN_ID = "dETH";
export const DETH_ISSUER_CONTRACT_ID = "dETH_Issuer";
export const DETH_ISSUER_V2_CONTRACT_ID = "dETH_IssuerV2";
export const DETH_REDEEMER_CONTRACT_ID = "dETH_Redeemer";
export const DETH_COLLATERAL_VAULT_CONTRACT_ID = "dETH_CollateralHolderVault";
export const DETH_AMO_MANAGER_ID = "dETH_AmoManager";
export const DETH_HARD_PEG_ORACLE_WRAPPER_ID = "dETH_HardPegOracleWrapper";
export const WETH_HARD_PEG_ORACLE_WRAPPER_LEGACY_ID = "wS_HardPegOracleWrapper"; // Legacy reference
export const WETH_HARD_PEG_ORACLE_WRAPPER_ID = "WETH_HardPegOracleWrapper";

// dLEND
export const TREASURY_PROXY_ID = "TreasuryProxy";
export const TREASURY_CONTROLLER_ID = "TreasuryController";
export const TREASURY_IMPL_ID = "TreasuryImpl";
export const POOL_ADDRESSES_PROVIDER_ID = "PoolAddressesProvider";
export const POOL_DATA_PROVIDER_ID = "PoolDataProvider";
export const POOL_IMPL_ID = "PoolImpl";
export const POOL_CONFIGURATOR_ID = "PoolConfigurator";
export const ACL_MANAGER_ID = "ACLManager";
export const PRICE_ORACLE_ID = "PriceOracle";
export const PRICE_ORACLE_SENTINEL_ID = "PriceOracleSentinel";
export const ATOKEN_IMPL_ID = "ATokenImpl";
export const VARIABLE_DEBT_TOKEN_IMPL_ID = "VariableDebtTokenImpl";
export const STABLE_DEBT_TOKEN_IMPL_ID = "StableDebtTokenImpl";
export const RATE_STRATEGY_ID = "RateStrategy";
export const POOL_PROXY_ID = "PoolProxy";
export const POOL_CONFIGURATOR_PROXY_ID = "PoolConfiguratorProxy";
export const POOL_ADDRESS_PROVIDER_REGISTRY_ID = "PoolAddressesProviderRegistry";
export const SUPPLY_LOGIC_ID = "SupplyLogic";
export const BORROW_LOGIC_ID = "BorrowLogic";
export const LIQUIDATION_LOGIC_ID = "LiquidationLogic";
export const EMODE_LOGIC_ID = "EModeLogic";
export const BRIDGE_LOGIC_ID = "BridgeLogic";
export const CONFIGURATOR_LOGIC_ID = "ConfiguratorLogic";
export const FLASH_LOAN_LOGIC_ID = "FlashLoanLogic";
export const POOL_LOGIC_ID = "PoolLogic";
export const CALLDATA_LOGIC_ID = "CalldataLogic";
export const RESERVES_SETUP_HELPER_ID = "ReservesSetupHelper";
export const WALLET_BALANCE_PROVIDER_ID = "WalletBalanceProvider";
export const UI_INCENTIVE_DATA_PROVIDER_ID = "UiIncentiveDataProviderV3";
export const UI_POOL_DATA_PROVIDER_ID = "UiPoolDataProviderV3";
export const EMISSION_MANAGER_ID = "EmissionManager";
export const INCENTIVES_IMPL_ID = "RewardsController";
export const INCENTIVES_PROXY_ID = "IncentivesProxy";
export const PULL_REWARDS_TRANSFER_STRATEGY_ID = "PullRewardsTransferStrategy";
export const ORACLE_AGGREGATOR_WRAPPER_BASE_ID = "oracle-aggregator-wrapper-base";

// dLOOP
export const DLOOP_CORE_LOGIC_ID = "DLoopCoreLogic";
export const DLOOP_CORE_DLEND_ID = "DLoopCoreDLend";

/* dLOOP Periphery */
export const DLOOP_PERIPHERY_ODOS_DEPOSITOR_ID = "DLoopDepositorOdos";
export const DLOOP_PERIPHERY_ODOS_REDEEMER_ID = "DLoopRedeemerOdos";
export const DLOOP_PERIPHERY_ODOS_DECREASE_LEVERAGE_ID = "DLoopDecreaseLeverageOdos";
export const DLOOP_PERIPHERY_ODOS_INCREASE_LEVERAGE_ID = "DLoopIncreaseLeverageOdos";
export const DLOOP_PERIPHERY_ODOS_SWAP_LOGIC_ID = "OdosSwapLogic";

// Chainlink Oracle Converters
export const CHAINLINK_DECIMAL_CONVERTER_WSTKSCUSD_ID = "ChainlinkDecimalConverter_wstkscUSD";
export const CHAINLINK_DECIMAL_CONVERTER_WSTKSCETH_ID = "ChainlinkDecimalConverter_wstkscETH";

// Wrapped dLEND ATokens
export const DLEND_STATIC_A_TOKEN_FACTORY_ID = "dLend_StaticATokenFactory";
export const DLEND_A_TOKEN_WRAPPER_PREFIX = "dLend_ATokenWrapper";
export const DUSD_A_TOKEN_WRAPPER_ID = `${DLEND_A_TOKEN_WRAPPER_PREFIX}_dUSD`;
export const DETH_A_TOKEN_WRAPPER_ID = `${DLEND_A_TOKEN_WRAPPER_PREFIX}_dETH`;

// dSTAKE deployment tag
export const DSTAKE_DEPLOYMENT_TAG = "dStake"; // Define the deployment tag

// dSTAKE deploy ID prefixes
export const DSTAKE_TOKEN_ID_PREFIX = "DStakeTokenV2";
export const DSTAKE_COLLATERAL_VAULT_ID_PREFIX = "DStakeCollateralVaultV2";
export const DSTAKE_ROUTER_ID_PREFIX = "DStakeRouterV2";

// dSTAKE Libraries
export const DETERMINISTIC_VAULT_SELECTOR_LIB_ID = "DeterministicVaultSelector";
export const ALLOCATION_CALCULATOR_LIB_ID = "AllocationCalculator";

// dSTAKE specific instance IDs
export const SDUSD_DSTAKE_TOKEN_ID = `${DSTAKE_TOKEN_ID_PREFIX}_sdUSD`;
export const SDUSD_COLLATERAL_VAULT_ID = `${DSTAKE_COLLATERAL_VAULT_ID_PREFIX}_sdUSD`;
export const SDUSD_ROUTER_ID = `${DSTAKE_ROUTER_ID_PREFIX}_sdUSD`;

export const SDETH_DSTAKE_TOKEN_ID = `${DSTAKE_TOKEN_ID_PREFIX}_sdETH`;
export const SDETH_COLLATERAL_VAULT_ID = `${DSTAKE_COLLATERAL_VAULT_ID_PREFIX}_sdETH`;
export const SDETH_ROUTER_ID = `${DSTAKE_ROUTER_ID_PREFIX}_sdETH`;

// RedeemerWithFees
export const DUSD_REDEEMER_WITH_FEES_CONTRACT_ID = "dUSD_RedeemerWithFees";
export const DETH_REDEEMER_WITH_FEES_CONTRACT_ID = "dETH_RedeemerWithFees";

// Vesting NFT
export const ERC20_VESTING_NFT_ID = "ERC20VestingNFT";
export const DSTAKE_NFT_VESTING_DEPLOYMENT_TAG = "dstake_nft_vesting";
