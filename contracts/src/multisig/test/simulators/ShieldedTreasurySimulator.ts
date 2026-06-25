import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockShieldedTreasury,
} from '../../../../artifacts/MockShieldedTreasury/contract/index.js';
import { EmptyPrivateState, emptyWitnesses } from '../EmptyWitnesses.js';

type ShieldedCoinInfo = { nonce: Uint8Array; color: Uint8Array; value: bigint };
type ShieldedSendResult = {
  change: { is_some: boolean; value: ShieldedCoinInfo };
  sent: ShieldedCoinInfo;
};

type ShieldedTreasuryArgs = readonly [];

const ShieldedTreasurySimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  MockShieldedTreasury<EmptyPrivateState>,
  ShieldedTreasuryArgs
>({
  contractFactory: (witnesses) =>
    new MockShieldedTreasury<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
});

export class ShieldedTreasurySimulator extends ShieldedTreasurySimulatorBase {
  constructor(
    options: BaseSimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ) {
    super([], options);
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
