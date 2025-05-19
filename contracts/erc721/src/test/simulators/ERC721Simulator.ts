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
  Maybe,
  ledger,
  Either,
  ZswapCoinPublicKey,
  ContractAddress,
  pureCircuits
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
      constructorContext({ tokenURI: "https://www.mynft.test/" }, '0'.repeat(64)), name, symbol,
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

  public tokenURI(tokenId: bigint): Maybe<string> {
    return this.contract.impureCircuits.tokenURI(this.circuitContext, tokenId).result;
  }

  public approve(to: Either<ZswapCoinPublicKey, ContractAddress>, tokenId: bigint): [] {
    return this.contract.impureCircuits.approve(this.circuitContext, to, tokenId).result;
  }

  public getApproved(tokenId: bigint): Either<ZswapCoinPublicKey, ContractAddress> {
    return this.contract.impureCircuits.getApproved(this.circuitContext, tokenId).result;
  }

  public setApprovalForAll(operator: Either<ZswapCoinPublicKey, ContractAddress>, approved: boolean): [] {
    return this.contract.impureCircuits.setApprovalForAll(this.circuitContext, operator, approved).result;
  }

  public isApprovedForAll(owner: Either<ZswapCoinPublicKey, ContractAddress>, operator: Either<ZswapCoinPublicKey, ContractAddress>): boolean {
    return this.contract.impureCircuits.isApprovedForAll(this.circuitContext, owner, operator).result;
  }

  public transferFrom(from: Either<ZswapCoinPublicKey, ContractAddress>, to: Either<ZswapCoinPublicKey, ContractAddress>, tokenId: bigint): [] {
    return this.contract.impureCircuits.transferFrom(this.circuitContext, from, to, tokenId).result;
  }

  public _requireOwned(tokenId: bigint): Either<ZswapCoinPublicKey, ContractAddress> {
    return this.contract.impureCircuits._requireOwned(this.circuitContext, tokenId).result;
  }

  public _ownerOf(tokenId: bigint): Either<ZswapCoinPublicKey, ContractAddress> {
    return this.contract.impureCircuits._ownerOf(this.circuitContext, tokenId).result;
  }

  public _update(to: Either<ZswapCoinPublicKey, ContractAddress>, tokenId: bigint, auth: Either<ZswapCoinPublicKey, ContractAddress>): Either<ZswapCoinPublicKey, ContractAddress> {
    return this.contract.impureCircuits._update(this.circuitContext, to, tokenId, auth).result;
  }

  public _approve(to: Either<ZswapCoinPublicKey, ContractAddress>, tokenId: bigint, auth: Either<ZswapCoinPublicKey, ContractAddress>): [] {
    return this.contract.impureCircuits._approve(this.circuitContext, to, tokenId, auth).result;
  }

  public _checkAuthorized(owner: Either<ZswapCoinPublicKey, ContractAddress>, spender: Either<ZswapCoinPublicKey, ContractAddress>, tokenId: bigint): [] {
    return this.contract.impureCircuits._checkAuthorized(this.circuitContext, owner, spender, tokenId).result;
  }

  public _isAuthorized(owner: Either<ZswapCoinPublicKey, ContractAddress>, spender: Either<ZswapCoinPublicKey, ContractAddress>, tokenId: bigint): boolean {
    return this.contract.impureCircuits._isAuthorized(this.circuitContext, owner, spender, tokenId).result;
  }

  public _getApproved(tokenId: bigint): Either<ZswapCoinPublicKey, ContractAddress> {
    return this.contract.impureCircuits._getApproved(this.circuitContext, tokenId).result;
  }

  public _setApprovalForAll(owner: Either<ZswapCoinPublicKey, ContractAddress>, operator: Either<ZswapCoinPublicKey, ContractAddress>, approved: boolean): [] {
    return this.contract.impureCircuits._setApprovalForAll(this.circuitContext, owner, operator, approved).result;
  }

  public _increaseBalance(account: Either<ZswapCoinPublicKey, ContractAddress>, value: bigint): [] {
    return this.contract.impureCircuits._increaseBalance(this.circuitContext, account, value).result;
  }

  public _mint(to: Either<ZswapCoinPublicKey, ContractAddress>, tokenId: bigint): [] {
    return this.contract.impureCircuits._mint(this.circuitContext, to, tokenId).result;
  }

  public _burn(tokenId: bigint): [] {
    return this.contract.impureCircuits._burn(this.circuitContext, tokenId).result;
  }

  public _transfer(from: Either<ZswapCoinPublicKey, ContractAddress>, to: Either<ZswapCoinPublicKey, ContractAddress>, tokenId: bigint): [] {
    return this.contract.impureCircuits._transfer(this.circuitContext, from, to, tokenId).result;
  }

  public _setTokenURI(tokenId: bigint, tokenURI: Maybe<string>): [] {
    return this.contract.impureCircuits._setTokenURI(this.circuitContext, tokenId, tokenURI).result;
  }
}

