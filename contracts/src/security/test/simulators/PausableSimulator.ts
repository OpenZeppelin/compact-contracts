import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockPausable,
} from '../../../../artifacts/MockPausable/contract/index.js';
import {
  PausablePrivateState,
  PausableWitnesses,
} from '../witnesses/PausableWitnesses.js';

/**
 * Type constructor args
 */
type PausableArgs = readonly [];

const PausableSimulatorBase = createSimulator<
  PausablePrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof PausableWitnesses>,
  MockPausable<PausablePrivateState>,
  PausableArgs
>({
  contractFactory: (witnesses) =>
    new MockPausable<PausablePrivateState>(witnesses),
  defaultPrivateState: () => PausablePrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => PausableWitnesses(),
  artifactName: 'MockPausable',
});

/**
 * Pausable Simulator
 */
export class PausableSimulator extends PausableSimulatorBase {
  static async create(
    options: SimulatorOptions<
      PausablePrivateState,
      ReturnType<typeof PausableWitnesses>
    > = {},
  ): Promise<PausableSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<PausableSimulator>;
  }

  /**
   * @description Returns true if the contract is paused, and false otherwise.
   * @returns True if paused.
   */
  public isPaused(): Promise<boolean> {
    return this.circuits.impure.isPaused();
  }

  /**
   * @description Makes a circuit only callable when the contract is paused.
   */
  public assertPaused(): Promise<[]> {
    return this.circuits.impure.assertPaused();
  }

  /**
   * @description Makes a circuit only callable when the contract is not paused.
   */
  public assertNotPaused(): Promise<[]> {
    return this.circuits.impure.assertNotPaused();
  }

  /**
   * @description Triggers a stopped state.
   */
  public pause(): Promise<[]> {
    return this.circuits.impure.pause();
  }

  /**
   * @description Lifts the pause on the contract.
   */
  public unpause(): Promise<[]> {
    return this.circuits.impure.unpause();
  }
}
