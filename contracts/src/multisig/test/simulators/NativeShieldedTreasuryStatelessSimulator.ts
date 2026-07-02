import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockShieldedTreasuryStateless,
} from '../../../../artifacts/MockShieldedTreasuryStateless/contract/index.js';
import { EmptyPrivateState, emptyWitnesses } from '../EmptyWitnesses.js';

type EitherRecipient = {
  is_left: boolean;
  left: { bytes: Uint8Array };
  right: { bytes: Uint8Array };
};
type ShieldedCoinInfo = { nonce: Uint8Array; color: Uint8Array; value: bigint };
type QualifiedShieldedCoinInfo = {
  nonce: Uint8Array;
  color: Uint8Array;
  value: bigint;
  mt_index: bigint;
};
type ShieldedSendResult = {
  change: { is_some: boolean; value: ShieldedCoinInfo };
  sent: ShieldedCoinInfo;
};

type NativeShieldedTreasuryStatelessArgs = readonly [];

const NativeShieldedTreasuryStatelessSimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  MockShieldedTreasuryStateless<EmptyPrivateState>,
  NativeShieldedTreasuryStatelessArgs
>({
  contractFactory: (witnesses) =>
    new MockShieldedTreasuryStateless<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
});

export class NativeShieldedTreasuryStatelessSimulator extends NativeShieldedTreasuryStatelessSimulatorBase {
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
    coin: QualifiedShieldedCoinInfo,
    recipient: EitherRecipient,
    amount: bigint,
  ): ShieldedSendResult {
    return this.circuits.impure._send(coin, recipient, amount);
  }
}
