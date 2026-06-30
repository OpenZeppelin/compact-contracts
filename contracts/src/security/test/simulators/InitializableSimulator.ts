import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockInitializable,
} from '../../../../artifacts/MockInitializable/contract/index.js';
import {
  InitializablePrivateState,
  InitializableWitnesses,
} from '../witnesses/InitializableWitnesses.js';

/**
 * Type constructor args
 */
type InitializableArgs = readonly [];

const InitializableSimulatorBase = createSimulator<
  InitializablePrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof InitializableWitnesses>,
  MockInitializable<InitializablePrivateState>,
  InitializableArgs
>({
  contractFactory: (witnesses) =>
    new MockInitializable<InitializablePrivateState>(witnesses),
  defaultPrivateState: () => InitializablePrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => InitializableWitnesses(),
  artifactName: 'MockInitializable',
});

/**
 * Initializable Simulator
 */
export class InitializableSimulator extends InitializableSimulatorBase {
  static async create(
    options: SimulatorOptions<
      InitializablePrivateState,
      ReturnType<typeof InitializableWitnesses>
    > = {},
  ): Promise<InitializableSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<InitializableSimulator>;
  }

  /**
   * @description Initializes the state.
   */
  public initialize(): Promise<[]> {
    return this.circuits.impure.initialize();
  }

  /**
   * @description Asserts that the contract has been initialized, throwing an error if not.
   * @throws Will throw "Initializable: contract not initialized" if the contract is not initialized.
   */
  public assertInitialized(): Promise<[]> {
    return this.circuits.impure.assertInitialized();
  }

  /**
   * @description Asserts that the contract has not been initialized, throwing an error if it has.
   * @throws Will throw "Initializable: contract already initialized" if the contract is already initialized.
   */
  public assertNotInitialized(): Promise<[]> {
    return this.circuits.impure.assertNotInitialized();
  }
}
