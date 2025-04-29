<<<<<<< HEAD
import {
  type CircuitContext,
  type ContractState,
  QueryContext,
  constructorContext,
  sampleContractAddress,
} from '@midnight-ntwrk/compact-runtime';
import {
  type Ledger,
  Contract as MockInitializable,
  ledger,
} from '../../artifacts/MockInitializable/contract/index.cjs';
import {
  type InitializablePrivateState,
  InitializableWitnesses,
} from '../../witnesses/InitializableWitnesses.js';
import type { IContractSimulator } from '../types/test.js';
=======
import { type CircuitContext, type ContractState, QueryContext, sampleContractAddress, constructorContext } from '@midnight-ntwrk/compact-runtime';
import { Contract as MockInitializable, type Ledger, ledger } from '../../artifacts/MockInitializable/contract/index.cjs';
import type { IContractSimulator } from '../types/test';
import { InitializablePrivateState, InitializableWitnesses } from '../../witnesses/InitializableWitnesses';
>>>>>>> b6f5215 (Add pausable (#22))

/**
 * @description A simulator implementation of an utils contract for testing purposes.
 * @template P - The private state type, fixed to UtilsPrivateState.
 * @template L - The ledger type, fixed to Contract.Ledger.
 */
export class InitializableSimulator
  implements IContractSimulator<InitializablePrivateState, Ledger> {
  /** @description The underlying contract instance managing contract logic. */
  readonly contract: MockInitializable<InitializablePrivateState>;

  /** @description The deployed address of the contract. */
  readonly contractAddress: string;

  /** @description The current circuit context, updated by contract operations. */
  circuitContext: CircuitContext<InitializablePrivateState>;

  /**
   * @description Initializes the mock contract.
   */
  constructor() {
    this.contract = new MockInitializable<InitializablePrivateState>(
      InitializableWitnesses,
    );
    const {
      currentPrivateState,
      currentContractState,
      currentZswapLocalState,
<<<<<<< HEAD
    } = this.contract.initialState(constructorContext({}, '0'.repeat(64)));
=======
    } = this.contract.initialState(
      constructorContext({}, '0'.repeat(64))
    );
>>>>>>> b6f5215 (Add pausable (#22))
    this.circuitContext = {
      currentPrivateState,
      currentZswapLocalState,
      originalState: currentContractState,
      transactionContext: new QueryContext(
        currentContractState.data,
        sampleContractAddress(),
      ),
    };
    this.contractAddress = this.circuitContext.transactionContext.address;
  }

  /**
   * @description Retrieves the current public ledger state of the contract.
   * @returns The ledger state as defined by the contract.
   */
  public getCurrentPublicState(): Ledger {
    return ledger(this.circuitContext.transactionContext.state);
  }

  /**
   * @description Retrieves the current private state of the contract.
   * @returns The private state of type UtilsPrivateState.
   */
  public getCurrentPrivateState(): InitializablePrivateState {
    return this.circuitContext.currentPrivateState;
  }

  /**
   * @description Retrieves the current contract state.
   * @returns The contract state object.
   */
  public getCurrentContractState(): ContractState {
    return this.circuitContext.originalState;
  }

  /**
   * @description Initializes the state.
   * @returns None.
   */
  public initialize() {
<<<<<<< HEAD
    this.circuitContext = this.contract.impureCircuits.initialize(
      this.circuitContext,
    ).context;
=======
    this.circuitContext = this.contract.impureCircuits.initialize(this.circuitContext).context;
>>>>>>> b6f5215 (Add pausable (#22))
  }

  /**
   * @description Asserts that the contract has been initialized, throwing an error if not.
   * @returns None.
   * @throws Will throw "Initializable: contract not initialized" if the contract is not initialized.
   */
  public assertInitialized() {
<<<<<<< HEAD
    return this.contract.impureCircuits.assertInitialized(this.circuitContext)
      .result;
=======
    return this.contract.impureCircuits.assertInitialized(this.circuitContext).result;
>>>>>>> b6f5215 (Add pausable (#22))
  }

  /**
   * @description Asserts that the contract has not been initialized, throwing an error if it has.
   * @returns None.
   * @throws Will throw "Initializable: contract already initialized" if the contract is already initialized.
   */
  public assertNotInitialized() {
<<<<<<< HEAD
    return this.contract.impureCircuits.assertNotInitialized(
      this.circuitContext,
    ).result;
=======
    return this.contract.impureCircuits.assertNotInitialized(this.circuitContext).result;
>>>>>>> b6f5215 (Add pausable (#22))
  }
}
