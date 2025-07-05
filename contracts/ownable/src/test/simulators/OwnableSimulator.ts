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
  type ContractAddress,
  type Either,
  type Ledger,
  Contract as MockOwnable,
  type ZswapCoinPublicKey,
  ledger,
} from '../../artifacts/MockOwnable/contract/index.cjs'; // Combined imports
import {
  type OwnablePrivateState,
  OwnableWitnesses,
} from '../../witnesses/OwnableWitnesses';
import type { IContractSimulator } from '../types/test';

/**
 * @description A simulator implementation of a Ownable contract for testing purposes.
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

  /** @description The current circuit context, updated by contract operations. */
  circuitContext: CircuitContext<OwnablePrivateState>;

  /**
   * @description Initializes the mock contract.
   */
  constructor(
    initialOwner: Either<ZswapCoinPublicKey, ContractAddress>,
    isInit: boolean,
  ) {
    this.contract = new MockOwnable<OwnablePrivateState>(OwnableWitnesses);
    const {
      currentPrivateState,
      currentContractState,
      currentZswapLocalState,
    } = this.contract.initialState(
      constructorContext({}, '0'.repeat(64)),
      initialOwner,
      isInit,
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
   * @description Returns the token name.
   * @returns The token name.
   */
  public owner(): Either<ZswapCoinPublicKey, ContractAddress> {
    return this.contract.impureCircuits.owner(this.circuitContext).result;
  }

  /**
   * @description Returns the value of tokens owned by `account`.
   * @param account The public key or contract address to query.
   * @returns The account's token balance.
   */
  public transferOwnership(
    newOwner: Either<ZswapCoinPublicKey, ContractAddress>,
    sender?: CoinPublicKey,
  ) {
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
    return res.result;
  }

  /**
   * @description Returns the value of tokens owned by `account`.
   * @param account The public key or contract address to query.
   * @returns The account's token balance.
   */
  public _unsafeTransferOwnership(
    newOwner: Either<ZswapCoinPublicKey, ContractAddress>,
    sender?: CoinPublicKey,
  ) {
    const res = this.contract.impureCircuits._unsafeTransferOwnership(
      {
        ...this.circuitContext,
        currentZswapLocalState: sender
          ? emptyZswapLocalState(sender)
          : this.circuitContext.currentZswapLocalState,
      },
      newOwner,
    );

    this.circuitContext = res.context;
    return res.result;
  }

  /**
   * @description Returns the remaining number of tokens that `spender` will be allowed to spend on behalf of `owner`
   * through `transferFrom`. This value changes when `approve` or `transferFrom` are called.
   * @param owner The public key or contract address of approver.
   * @param spender The public key or contract address of spender.
   * @returns The `spender`'s allowance over `owner`'s tokens.
   */
  public renounceOwnership(sender?: CoinPublicKey) {
    const res = this.contract.impureCircuits.renounceOwnership({
      ...this.circuitContext,
      currentZswapLocalState: sender
        ? emptyZswapLocalState(sender)
        : this.circuitContext.currentZswapLocalState,
    });

    this.circuitContext = res.context;
    return res.result;
  }

  /**
   * @description Returns the number of decimals used to get its user representation.
   * @returns The account's token balance.
   */
  public assertOnlyOwner(sender?: CoinPublicKey) {
    const res = this.contract.impureCircuits.assertOnlyOwner({
      ...this.circuitContext,
      currentZswapLocalState: sender
        ? emptyZswapLocalState(sender)
        : this.circuitContext.currentZswapLocalState,
    });

    this.circuitContext = res.context;
    return res.result;
  }

  /**
   * @description Moves a `value` amount of tokens from the caller's account to `to`.
   * @param to The recipient of the transfer, either a user or a contract.
   * @param value The amount to transfer.
   * @param sender The simulated caller.
   * @returns As per the IERC20 spec, this MUST return true.
   */
  public _transferOwnership(
    newOwner: Either<ZswapCoinPublicKey, ContractAddress>,
    sender?: CoinPublicKey,
  ) {
    const res = this.contract.impureCircuits._transferOwnership(
      {
        ...this.circuitContext,
        currentZswapLocalState: sender
          ? emptyZswapLocalState(sender)
          : this.circuitContext.currentZswapLocalState,
      },
      newOwner,
    );

    this.circuitContext = res.context;
    return res.result;
  }

  /**
   * @description Moves a `value` amount of tokens from the caller's account to `to`.
   * @param to The recipient of the transfer, either a user or a contract.
   * @param value The amount to transfer.
   * @param sender The simulated caller.
   * @returns As per the IERC20 spec, this MUST return true.
   */
  public _unsafeUncheckedTransferOwnership(
    newOwner: Either<ZswapCoinPublicKey, ContractAddress>,
    sender?: CoinPublicKey,
  ) {
    const res = this.contract.impureCircuits._unsafeUncheckedTransferOwnership(
      {
        ...this.circuitContext,
        currentZswapLocalState: sender
          ? emptyZswapLocalState(sender)
          : this.circuitContext.currentZswapLocalState,
      },
      newOwner,
    );

    this.circuitContext = res.context;
    return res.result;
  }
}
