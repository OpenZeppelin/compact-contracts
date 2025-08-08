import {
  type CircuitContext,
  type CoinPublicKey,
  type ContractState,
  constructorContext,
  emptyZswapLocalState,
  QueryContext,
} from '@midnight-ntwrk/compact-runtime';
import { sampleContractAddress } from '@midnight-ntwrk/zswap';
import type { ZswapCoinPublicKey } from '../../artifacts/MockZ_OwnablePK/contract/index.cjs';
import {
  type Ledger,
  ledger,
  Contract as MockOwnable,
} from '../../artifacts/MockZ_OwnablePK/contract/index.cjs'; // Combined imports
import {
Z_OwnablePKPrivateState,
  Z_OwnablePKWitnesses,
} from '../../witnesses/Z_OwnablePKWitnesses.js';
import type { IContractSimulator } from '../types/test.js';

/**
 * @description A simulator implementation of a contract for testing purposes.
 * @template P - The private state type, fixed to Z_OwnablePKPrivateState.
 * @template L - The ledger type, fixed to Contract.Ledger.
 */
export class Z_OwnablePKSimulator
  implements IContractSimulator<Z_OwnablePKPrivateState, Ledger>
{
  /** @description The underlying contract instance managing contract logic. */
  readonly contract: MockOwnable<Z_OwnablePKPrivateState>;

  /** @description The deployed address of the contract. */
  readonly contractAddress: string;

  /** @description The deployer address of the contract. */
  readonly deployer: CoinPublicKey;

  /** @description The current circuit context, updated by contract operations. */
  circuitContext: CircuitContext<Z_OwnablePKPrivateState>;

  /**
   * @description Initializes the mock contract.
   */
  constructor(initOwner: Uint8Array, deployer: CoinPublicKey) {
    this.contract = new MockOwnable<Z_OwnablePKPrivateState>(Z_OwnablePKWitnesses());
    this.deployer = deployer;

    const {
      currentPrivateState,
      currentContractState,
      currentZswapLocalState,
    } = this.contract.initialState(
      constructorContext(Z_OwnablePKPrivateState.generate(), deployer),
      initOwner
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
   * @returns The private state of type Z_OwnablePKPrivateState.
   */
  public getCurrentPrivateState(): Z_OwnablePKPrivateState {
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
   * @description Returns the shielded owner.
   * @returns The shielded owner.
   */
  public owner(): Uint8Array {
    return this.contract.impureCircuits.owner(this.circuitContext).result;
  }

  /**
   * @description Initiates the two-step ownership transfer to `newOwner`.
   */
  public transferOwnership(
    newOwner: Uint8Array,
    sender: CoinPublicKey,
  ): CircuitContext<Z_OwnablePKPrivateState> {
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

  /**
   * @description Leaves the contract without an owner. It will not be
   * possible to call `assertOnlyOnwer` circuits anymore. Can only be
   * called by the current owner.
   */
  public renounceOwnership(
    sender: CoinPublicKey,
  ): CircuitContext<Z_OwnablePKPrivateState> {
    const res = this.contract.impureCircuits.renounceOwnership({
      ...this.circuitContext,
      currentZswapLocalState: sender
        ? emptyZswapLocalState(sender)
        : this.circuitContext.currentZswapLocalState,
    });

    this.circuitContext = res.context;
    return this.circuitContext;
  }

  /**
   * @description Throws if called by any account other than the owner.
   * Use this to restrict access to sensitive circuits.
   */
  public assertOnlyOwner(
    sender: CoinPublicKey,
  ): CircuitContext<Z_OwnablePKPrivateState> {
    const res = this.contract.impureCircuits.assertOnlyOwner({
      ...this.circuitContext,
      currentZswapLocalState: sender
        ? emptyZswapLocalState(sender)
        : this.circuitContext.currentZswapLocalState,
    });

    this.circuitContext = res.context;
    return this.circuitContext;
  }

  /**
   * @description Obfuscates the `ownerPK` be hashing it with a domain separator and
   * the passed `instance`.
   * @returns The shielded hash of the owner and instance.
   */
  public shieldPK(
    ownerPK: ZswapCoinPublicKey,
    instance: bigint,
    nonce: Uint8Array
  ): Uint8Array {
    return this.contract.circuits.shieldPK(
      this.circuitContext,
      ownerPK,
      instance,
      nonce
    ).result;
  }

  /**
   * @description Internal circuit that transfers ownership of the contract to `newOwner`.
   */
  public _transferOwnership(
    newOwner: Uint8Array,
  ): CircuitContext<Z_OwnablePKPrivateState> {
    this.circuitContext = this.contract.impureCircuits._transferOwnership(
      this.circuitContext,
      newOwner,
    ).context;
    return this.circuitContext;
  }
}
