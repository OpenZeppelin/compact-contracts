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
  type Maybe,
  Contract as MockERC721,
  type ZswapCoinPublicKey,
  ledger,
} from '../../artifacts/MockERC721/contract/index.cjs'; // Combined imports
import {
  type ERC721PrivateState,
  ERC721Witnesses,
} from '../../witnesses/ERC721Witnesses';
import type { MaybeString } from '../types/string';
import type { IContractSimulator } from '../types/test';

/**
 * @description A simulator implementation of an ERC721 contract for testing purposes.
 * @template P - The private state type, fixed to ERC721PrivateState.
 * @template L - The ledger type, fixed to Contract.Ledger.
 */
export class ERC721Simulator
  implements IContractSimulator<ERC721PrivateState, Ledger>
{
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
    this.contract = new MockERC721<ERC721PrivateState>(ERC721Witnesses);
    const {
      currentPrivateState,
      currentContractState,
      currentZswapLocalState,
    } = this.contract.initialState(
      constructorContext({}, '0'.repeat(64)),
      name,
      symbol,
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
   * @description Returns the number of tokens in `account`'s account.
   * @param account The public key to query.
   * @return The number of tokens in `account`'s account.
   */
  public balanceOf(account: ZswapCoinPublicKey): bigint {
    return this.contract.impureCircuits.balanceOf(this.circuitContext, account)
      .result;
  }

  /**
   * @description Returns the owner of the `tokenId` token.
   * @param tokenId The identifier for a token.
   * @return The public key that owns the token.
   */
  public ownerOf(tokenId: bigint): ZswapCoinPublicKey {
    return this.contract.impureCircuits.ownerOf(this.circuitContext, tokenId)
      .result;
  }

  /**
   * @description Returns the token URI for the given `tokenId`.
   * @notice Since Midnight does not support native strings and string operations
   * within the Compact language, concatenating a base URI + token ID is not possible
   * like in other NFT implementations. Therefore, we propose the URI storage
   * approach; whereby, NFTs may or may not have unique "base" URIs.
   * It's up to the implementation to decide on how to handle this.
   * @param tokenId The identifier for a token.
   * @returns The token id's URI.
   */
  public tokenURI(tokenId: bigint): Maybe<string> {
    return this.contract.impureCircuits.tokenURI(this.circuitContext, tokenId)
      .result;
  }

  /**
   * @description Gives permission to `to` to transfer `tokenId` token to another account.
   * The approval is cleared when the token is transferred.
   *
   * Only a single account can be approved at a time, so approving the zero address clears previous approvals.
   *
   * Requirements:
   *
   * - The caller must own the token or be an approved operator.
   * - `tokenId` must exist.
   *
   * @param to The account receiving the approval
   * @param tokenId The token `to` may be permitted to transfer
   * @return None.
   */
  public approve(
    to: ZswapCoinPublicKey,
    tokenId: bigint,
    sender?: CoinPublicKey,
  ): [] {
    const res = this.contract.impureCircuits.approve(
      {
        ...this.circuitContext,
        currentZswapLocalState: sender
          ? emptyZswapLocalState(sender)
          : this.circuitContext.currentZswapLocalState,
      },
      to,
      tokenId,
    );

    this.circuitContext = res.context;
    return res.result;
  }

  /**
   * @description Returns the account approved for `tokenId` token.
   * @param tokenId The token an account may be approved to manage
   * @return The account approved to manage the token
   */
  public getApproved(tokenId: bigint): ZswapCoinPublicKey {
    return this.contract.impureCircuits.getApproved(
      this.circuitContext,
      tokenId,
    ).result;
  }

  /**
   * @description Approve or remove `operator` as an operator for the caller.
   * Operators can call {transferFrom} for any token owned by the caller.
   *
   * Requirements:
   *
   * - The `operator` cannot be the address zero.
   * 
   * @param operator An operator to manage the caller's tokens
   * @param approved A boolean determining if `operator` may manage all tokens of the caller
   * @return None.
   */
  public setApprovalForAll(
    operator: ZswapCoinPublicKey,
    approved: boolean,
    sender?: CoinPublicKey,
  ): [] {
    const res = this.contract.impureCircuits.setApprovalForAll(
      {
        ...this.circuitContext,
        currentZswapLocalState: sender
          ? emptyZswapLocalState(sender)
          : this.circuitContext.currentZswapLocalState,
      },
      operator,
      approved,
    );

    this.circuitContext = res.context;
    return res.result;
  }

  public isApprovedForAll(
    owner: ZswapCoinPublicKey,
    operator: ZswapCoinPublicKey,
  ): boolean {
    return this.contract.impureCircuits.isApprovedForAll(
      this.circuitContext,
      owner,
      operator,
    ).result;
  }

  /**
   * @description Returns if the `operator` is allowed to manage all of the assets of `owner`.
   *
   * @param owner The owner of a token
   * @param operator An account that may operate on `owner`'s tokens
   * @return A boolean determining if `operator` is allowed to manage all of the tokens of `owner` 
   */
  public transferFrom(
    from: ZswapCoinPublicKey,
    to: ZswapCoinPublicKey,
    tokenId: bigint,
    sender?: CoinPublicKey,
  ): [] {
    const res = this.contract.impureCircuits.transferFrom(
      {
        ...this.circuitContext,
        currentZswapLocalState: sender
          ? emptyZswapLocalState(sender)
          : this.circuitContext.currentZswapLocalState,
      },
      from,
      to,
      tokenId,
    );

    this.circuitContext = res.context;
    return res.result;
  }

  public _requireOwned(
    tokenId: bigint,
  ): ZswapCoinPublicKey {
    return this.contract.impureCircuits._requireOwned(
      this.circuitContext,
      tokenId,
    ).result;
  }

  /**
   * @description Returns the owner of the `tokenId`. Does NOT revert if token doesn't exist
   *
   * @param tokenId The target token of the owner query
   * @return The owner of the token
   */
  public _ownerOf(
    tokenId: bigint,
  ): ZswapCoinPublicKey {
    return this.contract.impureCircuits._ownerOf(this.circuitContext, tokenId)
      .result;
  }

  /**
   * @description Transfers `tokenId` from its current owner to `to`, or alternatively mints (or burns) if the current owner
   * (or `to`) is the zero address. Returns the owner of the `tokenId` before the update.
   *
   * The `auth` argument is optional. If the value passed is non 0, then this function will check that
   * `auth` is either the owner of the token, or approved to operate on the token (by the owner).
   * 
   * @param to The intended recipient of the token transfer
   * @param tokenId The token being transfered
   * @param auth An account authorized to transfer the token
   * @return Owner of the token before it was transfered
   */
  public _update(
    to: ZswapCoinPublicKey,
    tokenId: bigint,
    auth: ZswapCoinPublicKey,
  ): ZswapCoinPublicKey {
    return this.contract.impureCircuits._update(
      this.circuitContext,
      to,
      tokenId,
      auth,
    ).result;
  }

  public _approve(
    to: ZswapCoinPublicKey,
    tokenId: bigint,
    auth: ZswapCoinPublicKey,
  ): [] {
    return this.contract.impureCircuits._approve(
      this.circuitContext,
      to,
      tokenId,
      auth,
    ).result;
  }

  public _checkAuthorized(
    owner: ZswapCoinPublicKey,
    spender: ZswapCoinPublicKey,
    tokenId: bigint,
  ): [] {
    return this.contract.impureCircuits._checkAuthorized(
      this.circuitContext,
      owner,
      spender,
      tokenId,
    ).result;
  }

  public _isAuthorized(
    owner: ZswapCoinPublicKey,
    spender: ZswapCoinPublicKey,
    tokenId: bigint,
  ): boolean {
    return this.contract.impureCircuits._isAuthorized(
      this.circuitContext,
      owner,
      spender,
      tokenId,
    ).result;
  }

  /**
   * @description Returns the approved address for `tokenId`. Returns 0 if `tokenId` is not minted.
   *
   * @param tokenId The token to query
   * @return An account approved to spend `tokenId`
   */
  public _getApproved(
    tokenId: bigint,
  ): ZswapCoinPublicKey {
    return this.contract.impureCircuits._getApproved(
      this.circuitContext,
      tokenId,
    ).result;
  }

  /**
   * @description Approve `operator` to operate on all of `owner` tokens
   *
   * Requirements:
   * - operator can't be the address zero.
   *
   * @param owner Owner of a token
   * @param operator The account to approve
   * @param approved A boolean determining if `operator` may operate on all of `owner` tokens 
   * @return None.
   */
  public _setApprovalForAll(
    owner: ZswapCoinPublicKey,
    operator: ZswapCoinPublicKey,
    approved: boolean,
  ): [] {
    return this.contract.impureCircuits._setApprovalForAll(
      this.circuitContext,
      owner,
      operator,
      approved,
    ).result;
  }

  /**
   * @description Mints `tokenId` and transfers it to `to`.
   *
   * Requirements:
   *
   * - `tokenId` must not exist.
   * - `to` cannot be the zero address.
   * 
   * @param to The account receiving `tokenId`
   * @param tokenId The token to transfer
   * @return None.
   */
  public _mint(
    to: ZswapCoinPublicKey,
    tokenId: bigint,
  ): [] {
    return this.contract.impureCircuits._mint(this.circuitContext, to, tokenId)
      .result;
  }

  public _burn(tokenId: bigint): [] {
    return this.contract.impureCircuits._burn(this.circuitContext, tokenId)
      .result;
  }

  public _transfer(
    from: ZswapCoinPublicKey,
    to: ZswapCoinPublicKey,
    tokenId: bigint,
  ): [] {
    return this.contract.impureCircuits._transfer(
      this.circuitContext,
      from,
      to,
      tokenId,
    ).result;
  }

  public _setTokenURI(tokenId: bigint, tokenURI: Maybe<string>): [] {
    return this.contract.impureCircuits._setTokenURI(
      this.circuitContext,
      tokenId,
      tokenURI,
    ).result;
  }
}
