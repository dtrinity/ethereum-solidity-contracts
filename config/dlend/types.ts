import { IInterestRateStrategyParams, IReserveParams } from "../types";

export interface DLendConfig {
  readonly providerID: number;
  readonly flashLoanPremium: {
    readonly total: number;
    readonly protocol: number;
  };
  readonly rateStrategies: IInterestRateStrategyParams[];
  readonly reservesConfig: {
    [reserveName: string]: IReserveParams;
  };
}
