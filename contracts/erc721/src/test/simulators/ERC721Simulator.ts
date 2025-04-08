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
  Contract as MockERC721,
  ledger,
  Either,
  ZswapCoinPublicKey,
  ContractAddress,
} from '../../artifacts/MockERC721/contract/index.cjs'; // Combined imports
import { MaybeString } from '../types';
import type { IContractSimulator } from '../types';
import { ERC721PrivateState, ERC721Witnesses } from '../../witnesses';

/**
 * @description A simulator implementation of an ERC721 contract for testing purposes.
 * @template P - The private state type, fixed to ERC721PrivateState.
 * @template L - The ledger type, fixed to Contract.Ledger.
 */
export class ERC721Simulator
  implements IContractSimulator<ERC721PrivateState, Ledger> {
  /** @description The underlying contract instance managing contract logic. */
  readonly contract: MockERC721<ERC721PrivateState>;

  /** @description The deployed address of the contract. */
  readonly contractAddress: string;

  /** @description The current circuit context, updated by contract operations. */
  circuitContext: CircuitContext<ERC721PrivateState>;

  /**
   * @description Initializes the mock contract.
   */
  constructor(name: MaybeString, symbol: MaybeString) {
    this.contract = new MockERC721<ERC721PrivateState>(
      ERC721Witnesses,
    );
    const {
      currentPrivateState,
      currentContractState,
      currentZswapLocalState,
    } = this.contract.initialState(
      constructorContext({}, '0'.repeat(64)), name, symbol,
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
   * @returns The private state of type ERC721PrivateState.
   */
  public getCurrentPrivateState(): ERC721PrivateState {
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
  public name(): MaybeString {
    return this.contract.impureCircuits.name(this.circuitContext).result;
  }

  /**
   * @description Returns the symbol of the token.
   * @returns The token name.
   */
  public symbol(): MaybeString {
    return this.contract.impureCircuits.symbol(this.circuitContext).result;
  }

  /**
   * @description Returns the value of tokens owned by `account`.
   * @param account The public key or contract address to query.
   * @returns The account's token balance.
   */
  public balanceOf(account: Either<ZswapCoinPublicKey, ContractAddress>): bigint {
    return this.contract.impureCircuits.balanceOf(this.circuitContext, account).result;
  }

  /**
   * @description Returns the owner of `tokenId`.
   * @param tokenId The Id of the token to query.
   * @returns The account owner of the token.
   */
  public ownerOf(tokenId: bigint): Either<ZswapCoinPublicKey, ContractAddress> {
    return this.contract.impureCircuits.ownerOf(this.circuitContext, tokenId).result;
  }
}

