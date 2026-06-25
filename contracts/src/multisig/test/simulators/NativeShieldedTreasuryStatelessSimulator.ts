import {
  createSimulator,
  type SimulatorOptions,
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
  artifactName: 'MockShieldedTreasuryStateless',
});

export class NativeShieldedTreasuryStatelessSimulator extends NativeShieldedTreasuryStatelessSimulatorBase {
  static async create(
    options: SimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ): Promise<NativeShieldedTreasuryStatelessSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [],
      options,
    ) as Promise<NativeShieldedTreasuryStatelessSimulator>;
  }

  public _deposit(coin: ShieldedCoinInfo): Promise<[]> {
    return this.circuits.impure._deposit(coin);
  }

  public _send(
    coin: QualifiedShieldedCoinInfo,
    recipient: EitherRecipient,
    amount: bigint,
  ): Promise<ShieldedSendResult> {
    return this.circuits.impure._send(coin, recipient, amount);
  }
}
