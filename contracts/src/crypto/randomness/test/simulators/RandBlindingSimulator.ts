import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockRandBlinding,
} from '../../../../../artifacts/crypto/randomness/test/mocks/MockRandBlinding/contract/index.js';
import {
  RandBlindingPrivateState,
  RandBlindingWitnesses,
} from '../witnesses/RandBlindingWitnesses.js';

/**
 * Type constructor args
 */
type RandBlindingArgs = readonly [];

const RandBlindingSimulatorBase = createSimulator<
  RandBlindingPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof RandBlindingWitnesses>,
  MockRandBlinding<RandBlindingPrivateState>,
  RandBlindingArgs
>({
  contractFactory: (witnesses) =>
    new MockRandBlinding<RandBlindingPrivateState>(witnesses),
  defaultPrivateState: () => RandBlindingPrivateState.generate(),
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => RandBlindingWitnesses(),
  artifactName: 'MockRandBlinding',
});

/**
 * RandBlinding Simulator
 *
 * A thin pass-through to the mock's `read` circuit. The blinding factor comes
 * from the private state.
 */
export class RandBlindingSimulator extends RandBlindingSimulatorBase {
  static async create(
    options: SimulatorOptions<
      RandBlindingPrivateState,
      ReturnType<typeof RandBlindingWitnesses>
    > = {},
  ): Promise<RandBlindingSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<RandBlindingSimulator>;
  }

  /** @description `RandBlinding.read`. */
  public read(): Promise<Uint8Array> {
    return this.circuits.impure.read();
  }
}
