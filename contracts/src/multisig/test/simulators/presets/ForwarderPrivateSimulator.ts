import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  Contract as ForwarderPrivate,
  ledger,
  pureCircuits,
  type QualifiedShieldedCoinInfo,
  type ShieldedCoinInfo,
  type ShieldedSendResult,
  type ZswapCoinPublicKey,
} from '../../../../../artifacts/ForwarderPrivate/contract/index.js';
import { EmptyPrivateState, emptyWitnesses } from '../../EmptyWitnesses.js';

type ForwarderPrivateArgs = readonly [parentCommitment: Uint8Array];

const ForwarderPrivateSimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  ForwarderPrivate<EmptyPrivateState>,
  ForwarderPrivateArgs
>({
  contractFactory: (witnesses) =>
    new ForwarderPrivate<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: (parentCommitment) => [parentCommitment],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
  artifactName: 'ForwarderPrivate',
});

export class ForwarderPrivateSimulator extends ForwarderPrivateSimulatorBase {
  static async create(
    parentCommitment: Uint8Array,
    options: SimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ): Promise<ForwarderPrivateSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [parentCommitment],
      options,
    ) as Promise<ForwarderPrivateSimulator>;
  }

  public static calculateParentCommitment(
    parentAddr: Uint8Array,
    opSecret: Uint8Array,
  ): Uint8Array {
    return pureCircuits.calculateParentCommitment(parentAddr, opSecret);
  }

  public deposit(coin: ShieldedCoinInfo): Promise<[]> {
    return this.circuits.impure.deposit(coin);
  }

  public drain(
    coin: QualifiedShieldedCoinInfo,
    parent: ZswapCoinPublicKey,
    opSecret: Uint8Array,
    value: bigint,
  ): Promise<ShieldedSendResult> {
    return this.circuits.impure.drain(coin, parent, opSecret, value);
  }

  public getParentCommitment(): Promise<Uint8Array> {
    return this.circuits.impure.getParentCommitment();
  }
}
