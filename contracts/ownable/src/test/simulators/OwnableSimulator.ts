import {
  type CircuitContext,
  type CoinPublicKey,
  type ContractState,
  QueryContext,
  constructorContext,
  emptyZswapLocalState,
} from '@midnight-ntwrk/compact-runtime';
import { sampleContractAddress } from '@midnight-ntwrk/zswap';
import {
  type Ledger,
  Contract as MockOwnable,
  ledger,
} from '../../artifacts/MockOwnable/contract/index.cjs'; // Combined imports
import {
  OwnablePrivateState,
  OwnableWitnesses,
  SetWitnessContext,
} from '../../witnesses/OwnableWitnesses';
import type { IContractSimulator } from '../types/test';

/**
 * @description A simulator implementation of a contract for testing purposes.
 * @template P - The private state type, fixed to OwnablePrivateState.
 * @template L - The ledger type, fixed to Contract.Ledger.
 */
export class OwnableSimulator
  implements IContractSimulator<OwnablePrivateState, Ledger>
{
  /** @description The underlying contract instance managing contract logic. */
  readonly contract: MockOwnable<OwnablePrivateState>;

  /** @description The deployed address of the contract. */
  readonly contractAddress: string;

  /** @description The deployer address of the contract. */
  readonly deployer: CoinPublicKey;

  /** @description The current circuit context, updated by contract operations. */
  circuitContext: CircuitContext<OwnablePrivateState>;

  /**
   * @description Initializes the mock contract.
   */
  constructor(deployer: CoinPublicKey) {
    this.contract = new MockOwnable<OwnablePrivateState>(OwnableWitnesses());
    this.deployer = deployer;
    const {
      currentPrivateState,
      currentContractState,
      currentZswapLocalState,
    } = this.contract.initialState(
      constructorContext(OwnablePrivateState.generate(), deployer),
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
   * @returns The private state of type OwnablePrivateState.
   */
  public getCurrentPrivateState(): OwnablePrivateState {
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
   * @description Changes the witness context by setting `sk`
   * as the `secretKey`.
   * @returns None.
   */
  public setWitnessContext(sk: Uint8Array) {
    this.contract.witnesses = SetWitnessContext(sk);
  }

  public owner(): Uint8Array {
    return this.contract.impureCircuits.owner(this.circuitContext).result;
  }

  public renounceOwnership(): CircuitContext<OwnablePrivateState> {
    this.circuitContext = this.contract.impureCircuits.renounceOwnership(
      this.circuitContext,
    ).context;
    return this.circuitContext;
  }

  public assertOnlyOwner(): CircuitContext<OwnablePrivateState> {
    return this.contract.impureCircuits.assertOnlyOwner(this.circuitContext)
      .context;
  }

  public publicKey(
    sk: Uint8Array,
    instance: Uint8Array,
    sender: CoinPublicKey,
  ): CircuitContext<OwnablePrivateState> {
    const res = this.contract.circuits.publicKey(
      {
        ...this.circuitContext,
        currentZswapLocalState: sender
          ? emptyZswapLocalState(sender)
          : this.circuitContext.currentZswapLocalState,
      },
      sk,
      instance,
    );

    this.circuitContext = res.context;
    return this.circuitContext;
  }

  public _transferOwnership(
    newOwner: Uint8Array,
  ): CircuitContext<OwnablePrivateState> {
    this.circuitContext = this.contract.impureCircuits._transferOwnership(
      this.circuitContext,
      newOwner,
    ).context;
    return this.circuitContext;
  }
}
