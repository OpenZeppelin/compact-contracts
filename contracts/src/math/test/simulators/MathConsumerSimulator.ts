import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  Contract,
  ledger,
} from '../../../../artifacts/MockMathConsumer/contract/index.js';
import {
  type MathConsumerPrivateState,
  MathConsumerWitnesses,
} from '../witnesses/MathConsumerWitnesses.js';

const MathConsumerBase = createSimulator<
  MathConsumerPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof MathConsumerWitnesses>,
  Contract<MathConsumerPrivateState>,
  readonly []
>({
  contractFactory: (witnesses) =>
    new Contract<MathConsumerPrivateState>(witnesses),
  defaultPrivateState: () => ({}),
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => MathConsumerWitnesses(),
  artifactName: 'MockMathConsumer',
});

export class MathConsumerSimulator extends MathConsumerBase {
  static async create(
    options: SimulatorOptions<
      MathConsumerPrivateState,
      ReturnType<typeof MathConsumerWitnesses>
    > = {},
  ): Promise<MathConsumerSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: The factory must keep the subclass.
    return super.create([], options) as Promise<MathConsumerSimulator>;
  }

  public update(reserve0: bigint, reserve1: bigint): Promise<bigint> {
    return this.circuits.impure.update(reserve0, reserve1);
  }
}
