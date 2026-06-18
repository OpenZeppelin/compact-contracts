import {
  type BaseSimulatorOptions,
  createSimulator,
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
});

export class ForwarderPrivateSimulator extends ForwarderPrivateSimulatorBase {
  constructor(
    parentCommitment: Uint8Array,
    options: BaseSimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ) {
    super([parentCommitment], options);
  }

  public static calculateParentCommitment(
    parentAddr: Uint8Array,
    opSecret: Uint8Array,
  ): Uint8Array {
    return pureCircuits.calculateParentCommitment(parentAddr, opSecret);
  }

  public deposit(coin: ShieldedCoinInfo) {
    return this.circuits.impure.deposit(coin);
  }

  public drain(
    coin: QualifiedShieldedCoinInfo,
    parent: ZswapCoinPublicKey,
    opSecret: Uint8Array,
    value: bigint,
  ): ShieldedSendResult {
    return this.circuits.impure.drain(coin, parent, opSecret, value);
  }

  public getParentCommitment(): Uint8Array {
    return this.circuits.impure.getParentCommitment();
  }
}
