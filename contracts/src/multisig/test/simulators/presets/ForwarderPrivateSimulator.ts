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
} from '../../../../../artifacts/ForwarderPrivate/contract/index.js';
import {
  ForwarderPrivatePrivateState,
  ForwarderPrivateWitnesses,
} from '../../witnesses/presets/ForwarderPrivateWitnesses.js';

type ForwarderPrivateArgs = readonly [parentCommitment: Uint8Array];

const ForwarderPrivateSimulatorBase = createSimulator<
  ForwarderPrivatePrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ForwarderPrivateWitnesses>,
  ForwarderPrivate<ForwarderPrivatePrivateState>,
  ForwarderPrivateArgs
>({
  contractFactory: (witnesses) =>
    new ForwarderPrivate<ForwarderPrivatePrivateState>(witnesses),
  defaultPrivateState: () => ForwarderPrivatePrivateState,
  contractArgs: (parentCommitment) => [parentCommitment],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ForwarderPrivateWitnesses(),
});

export class ForwarderPrivateSimulator extends ForwarderPrivateSimulatorBase {
  constructor(
    parentCommitment: Uint8Array,
    options: BaseSimulatorOptions<
      ForwarderPrivatePrivateState,
      ReturnType<typeof ForwarderPrivateWitnesses>
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
    parentAddr: Uint8Array,
    opSecret: Uint8Array,
    value: bigint,
  ): ShieldedSendResult {
    return this.circuits.impure.drain(coin, parentAddr, opSecret, value);
  }

  public getParentCommitment(): Uint8Array {
    return this.circuits.impure.getParentCommitment();
  }
}
