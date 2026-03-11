import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin-compact/contracts-simulator';
import {
  ledger,
  Contract as MockShieldedTreasury,
  pureCircuits,
} from '../../../../artifacts/MockShieldedTreasury/contract/index.js';
import {
  ShieldedTreasuryPrivateState,
  ShieldedTreasuryWitnesses,
} from '../../witnesses/ShieldedTreasuryWitnesses.js';

type ShieldedCoinInfo = { nonce: Uint8Array; color: Uint8Array; value: bigint };
type ShieldedSendResult = {
  change: { is_some: boolean; value: ShieldedCoinInfo };
  sent: ShieldedCoinInfo;
};

type ShieldedTreasuryArgs = readonly [];

const ShieldedTreasurySimulatorBase = createSimulator<
  ShieldedTreasuryPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ShieldedTreasuryWitnesses>,
  MockShieldedTreasury<ShieldedTreasuryPrivateState>,
  ShieldedTreasuryArgs
>({
  contractFactory: (witnesses) =>
    new MockShieldedTreasury<ShieldedTreasuryPrivateState>(witnesses),
  defaultPrivateState: () => ShieldedTreasuryPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ShieldedTreasuryWitnesses(),
});

export class ShieldedTreasurySimulator extends ShieldedTreasurySimulatorBase {
  constructor(
    options: BaseSimulatorOptions<
      ShieldedTreasuryPrivateState,
      ReturnType<typeof ShieldedTreasuryWitnesses>
    > = {},
  ) {
    super([], options);
  }

  public static UINT128_MAX(): bigint {
    return pureCircuits.UINT128_MAX();
  }

  public _deposit(coin: ShieldedCoinInfo) {
    return this.circuits.impure._deposit(coin);
  }

  public _send(
    recipient: {
      is_left: boolean;
      left: { bytes: Uint8Array };
      right: { bytes: Uint8Array };
    },
    color: Uint8Array,
    amount: bigint,
  ): ShieldedSendResult {
    return this.circuits.impure._send(recipient, color, amount);
  }

  public getTokenBalance(color: Uint8Array): bigint {
    return this.circuits.impure.getTokenBalance(color);
  }

  public getReceivedTotal(color: Uint8Array): bigint {
    return this.circuits.impure.getReceivedTotal(color);
  }

  public getSentTotal(color: Uint8Array): bigint {
    return this.circuits.impure.getSentTotal(color);
  }

  public getReceivedMinusSent(color: Uint8Array): bigint {
    return this.circuits.impure.getReceivedMinusSent(color);
  }
}
