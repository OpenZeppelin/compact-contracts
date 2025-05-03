import {
  type CircuitContext,
  type ContractState,
  QueryContext,
  constructorContext,
} from '@midnight-ntwrk/compact-runtime';
import { sampleContractAddress } from '@midnight-ntwrk/zswap';
import {
  type Ledger,
  Contract as MockMyContract,
  ledger,
} from '../../artifacts/MockMyContract/contract/index.cjs'; // Combined imports
import {
  type MyContractPrivateState,
  MyContractWitnesses,
} from '../../witnesses/MyContractWitnesses';
import type { MaybeString } from '../types/string';
import type { IContractSimulator } from '../types/test';

/**
 * @description A simulator implementation of a contract for testing purposes.
 * @template P - The private state type, fixed to MyContractPrivateState.
 * @template L - The ledger type, fixed to Contract.Ledger.
 */
export class MyContractSimulator
  implements IContractSimulator<MyContractPrivateState, Ledger>
{
  /** @description The underlying contract instance managing contract logic. */
  readonly contract: MockMyContract<MyContractPrivateState>;

  /** @description The deployed address of the contract. */
  readonly contractAddress: string;

  /** @description The current circuit context, updated by contract operations. */
  circuitContext: CircuitContext<MyContractPrivateState>;

  /**
   * @description Initializes the mock contract.
   */
  constructor(name: MaybeString) {
    this.contract = new MockMyContract<MyContractPrivateState>(
      MyContractWitnesses,
    );
    const {
      currentPrivateState,
      currentContractState,
      currentZswapLocalState,
    } = this.contract.initialState(
      constructorContext({}, '0'.repeat(64)),
      name,
    );
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
   * @returns The private state of type MyContractPrivateState.
   */
  public getCurrentPrivateState(): MyContractPrivateState {
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
   * @description Returns the contract name.
   * @returns The contract name.
   */
  public getName(): MaybeString {
    return this.contract.impureCircuits.getName(this.circuitContext).result;
  }

  /**
   * @description Sets the contract name.
   * @returns None.
   */
  public setName(newName: MaybeString) {
    return this.contract.impureCircuits.setName(this.circuitContext, newName)
      .result;
  }
}
