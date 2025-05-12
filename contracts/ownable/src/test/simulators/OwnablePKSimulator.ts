import {
  type CircuitContext,
  CoinPublicKey,
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
} from '../../artifacts/MockOwnablePK/contract/index.cjs'; // Combined imports
import {
  OwnablePrivateState,
  OwnableWitnesses,
  SetWitnessContext,
} from '../../witnesses/OwnableWitnesses';
import type { IContractSimulator } from '../types/test';
import { useCircuitContextSender } from '../utils/test';
import { ZswapCoinPublicKey } from '../../artifacts/MockOwnable/contract/index.cjs';

/**
 * @description A simulator implementation of a contract for testing purposes.
 * @template P - The private state type, fixed to OwnablePrivateState.
 * @template L - The ledger type, fixed to Contract.Ledger.
 */
export class OwnablePKSimulator
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
  constructor(initOwner: ZswapCoinPublicKey, deployer: CoinPublicKey) {
    this.contract = new MockOwnable<OwnablePrivateState>(OwnableWitnesses());
    this.deployer = deployer;
    const {
      currentPrivateState,
      currentContractState,
      currentZswapLocalState,
    } = this.contract.initialState(
      constructorContext(OwnablePrivateState.generate(), deployer),
      initOwner,
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

  public owner(): Uint8Array {
    return this.contract.impureCircuits.owner(this.circuitContext).result;
  }

  public pendingOwner(): Uint8Array {
    return this.contract.impureCircuits.pendingOwner(this.circuitContext)
      .result;
  }

  public transferOwnership(
    newOwner: ZswapCoinPublicKey,
    sender: CoinPublicKey,
  ): CircuitContext<OwnablePrivateState> {
    const res = this.contract.impureCircuits.transferOwnership(
      {
        ...this.circuitContext,
        currentZswapLocalState: sender
          ? emptyZswapLocalState(sender)
          : this.circuitContext.currentZswapLocalState,
      },
      newOwner,
    );

    this.circuitContext = res.context;
    return this.circuitContext;
  }

  public acceptOwnership(
    sender: CoinPublicKey,
  ): CircuitContext<OwnablePrivateState> {
    const res = this.contract.impureCircuits.acceptOwnership({
      ...this.circuitContext,
      currentZswapLocalState: sender
        ? emptyZswapLocalState(sender)
        : this.circuitContext.currentZswapLocalState,
    });

    this.circuitContext = res.context;
    return this.circuitContext;
  }

  public renounceOwnership(
    sender: CoinPublicKey,
  ): CircuitContext<OwnablePrivateState> {
    const res = this.contract.impureCircuits.renounceOwnership({
      ...this.circuitContext,
      currentZswapLocalState: sender
        ? emptyZswapLocalState(sender)
        : this.circuitContext.currentZswapLocalState,
    });

    this.circuitContext = res.context;
    return this.circuitContext;
  }

  public assertOnlyOwner(
    sender: CoinPublicKey,
  ): CircuitContext<OwnablePrivateState> {
    const res = this.contract.impureCircuits.assertOnlyOwner({
      ...this.circuitContext,
      currentZswapLocalState: sender
        ? emptyZswapLocalState(sender)
        : this.circuitContext.currentZswapLocalState,
    });

    this.circuitContext = res.context;
    return this.circuitContext;
  }

  public shieldOwner(
    ownerPK: ZswapCoinPublicKey,
    instance: Uint8Array,
  ): Uint8Array {
    return this.contract.circuits.shieldOwner(
      this.circuitContext,
      ownerPK,
      instance,
    ).result;
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

  public _proposeOwner(
    newOwner: ZswapCoinPublicKey,
  ): CircuitContext<OwnablePrivateState> {
    this.circuitContext = this.contract.impureCircuits._proposeOwner(
      this.circuitContext,
      newOwner,
    ).context;
    return this.circuitContext;
  }
}
