import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin-compact/contracts-simulator';
import {
  ledger,
  Contract as MockPausable,
} from '../../../../artifacts/MockPausable/contract/index.js';
import {
  PausablePrivateState,
  PausableWitnesses,
} from '../../witnesses/PausableWitnesses.js';

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
});

/**
 * Pausable Simulator
 */
export class PausableSimulator extends PausableSimulatorBase {
  constructor(
    options: BaseSimulatorOptions<
      PausablePrivateState,
      ReturnType<typeof PausableWitnesses>
    > = {},
  ) {
    super([], options);
  }

  /**
   * @description Returns true if the contract is paused, and false otherwise.
   * @returns True if paused.
   */
  public isPaused(): boolean {
    return this.circuits.impure.isPaused();
  }

  /**
   * @description Makes a circuit only callable when the contract is paused.
   */
  public assertPaused() {
    this.circuits.impure.assertPaused();
  }

  /**
   * @description Makes a circuit only callable when the contract is not paused.
   */
  public assertNotPaused() {
    this.circuits.impure.assertNotPaused();
  }

  /**
   * @description Triggers a stopped state.
   */
  public pause() {
    this.circuits.impure.pause();
  }

  /**
   * @description Lifts the pause on the contract.
   */
  public unpause() {
    this.circuits.impure.unpause();
  }
}
