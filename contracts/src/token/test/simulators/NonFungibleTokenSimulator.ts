import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin-compact/contracts-simulator';
import {
  type ContractAddress,
  type Either,
  ledger,
  Contract as MockNonFungibleToken,
  type ZswapCoinPublicKey,
} from '../../../../artifacts/MockNonFungibleToken/contract/index.js';
import {
  NonFungibleTokenPrivateState,
  NonFungibleTokenWitnesses,
} from '../../witnesses/NonFungibleTokenWitnesses.js';

/**
 * Type constructor args
 */
type NonFungibleTokenArgs = readonly [
  name: string,
  symbol: string,
  init: boolean,
];

const NonFungibleTokenSimulatorBase = createSimulator<
  NonFungibleTokenPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof NonFungibleTokenWitnesses>,
  MockNonFungibleToken<NonFungibleTokenPrivateState>,
  NonFungibleTokenArgs
>({
  contractFactory: (witnesses) =>
    new MockNonFungibleToken<NonFungibleTokenPrivateState>(witnesses),
  defaultPrivateState: () => NonFungibleTokenPrivateState,
  contractArgs: (name, symbol, init) => [name, symbol, init],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => NonFungibleTokenWitnesses(),
});

/**
 * NonFungibleToken Simulator
 */
export class NonFungibleTokenSimulator extends NonFungibleTokenSimulatorBase {
  constructor(
    name: string,
    symbol: string,
    init: boolean,
    options: BaseSimulatorOptions<
      NonFungibleTokenPrivateState,
      ReturnType<typeof NonFungibleTokenWitnesses>
    > = {},
  ) {
    super([name, symbol, init], options);
  }

  /**
   * @description Returns the token name.
   * @returns The token name.
   */
  public name(): string {
    return this.circuits.impure.name();
  }

  /**
   * @description Returns the symbol of the token.
   * @returns The token symbol.
   */
  public symbol(): string {
    return this.circuits.impure.symbol();
  }

  /**
   * @description Returns the number of tokens in `account`'s account.
   * @param account The public key to query.
   * @return The number of tokens in `account`'s account.
   */
  public balanceOf(
    account: Either<ZswapCoinPublicKey, ContractAddress>,
  ): bigint {
    return this.circuits.impure.balanceOf(account);
  }

  /**
   * @description Returns the owner of the `tokenId` token.
   * @param tokenId The identifier for a token.
   * @return The public key that owns the token.
   */
  public ownerOf(tokenId: bigint): Either<ZswapCoinPublicKey, ContractAddress> {
    return this.circuits.impure.ownerOf(tokenId);
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
  public tokenURI(tokenId: bigint): string {
    return this.circuits.impure.tokenURI(tokenId);
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
   */
  public approve(
    to: Either<ZswapCoinPublicKey, ContractAddress>,
    tokenId: bigint,
  ) {
    this.circuits.impure.approve(to, tokenId);
  }

  /**
   * @description Returns the account approved for `tokenId` token.
   * @param tokenId The token an account may be approved to manage
   * @return The account approved to manage the token
   */
  public getApproved(
    tokenId: bigint,
  ): Either<ZswapCoinPublicKey, ContractAddress> {
    return this.circuits.impure.getApproved(tokenId);
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
   */
  public setApprovalForAll(
    operator: Either<ZswapCoinPublicKey, ContractAddress>,
    approved: boolean,
  ) {
    this.circuits.impure.setApprovalForAll(operator, approved);
  }

  /**
   * @description Returns if the `operator` is allowed to manage all of the assets of `owner`.
   *
   * @param owner The owner of a token
   * @param operator An account that may operate on `owner`'s tokens
   * @return A boolean determining if `operator` is allowed to manage all of the tokens of `owner`
   */
  public isApprovedForAll(
    owner: Either<ZswapCoinPublicKey, ContractAddress>,
    operator: Either<ZswapCoinPublicKey, ContractAddress>,
  ): boolean {
    return this.circuits.impure.isApprovedForAll(owner, operator);
  }

  /**
   * @description Transfers `tokenId` token from `fromAddress` to `to`.
   *
   * Requirements:
   *
   * - `fromAddress` cannot be the zero address.
   * - `to` cannot be the zero address.
   * - `tokenId` token must be owned by `fromAddress`.
   * - If the caller is not `fromAddress`, it must be approved to move this token by either {approve} or {setApprovalForAll}.
   *
   * @param {Either<ZswapCoinPublicKey, ContractAddress>} fromAddress - The source account from which the token is being transfered
   * @param {Either<ZswapCoinPublicKey, ContractAddress>} to - The target account to transfer token to
   * @param {TokenId} tokenId - The token being transfered
   */
  public transferFrom(
    fromAddress: Either<ZswapCoinPublicKey, ContractAddress>,
    to: Either<ZswapCoinPublicKey, ContractAddress>,
    tokenId: bigint,
  ) {
    this.circuits.impure.transferFrom(fromAddress, to, tokenId);
  }

  /**
   * @description Reverts if the `tokenId` doesn't have a current owner (it hasn't been minted, or it has been burned).
   * Returns the owner.
   *
   * Overrides to ownership logic should be done to {_ownerOf}.
   *
   * @param tokenId The token that should be owned
   * @return The owner of `tokenId`
   */
  public _requireOwned(
    tokenId: bigint,
  ): Either<ZswapCoinPublicKey, ContractAddress> {
    return this.circuits.impure._requireOwned(tokenId);
  }

  /**
   * @description Returns the owner of the `tokenId`. Does NOT revert if token doesn't exist
   *
   * @param tokenId The target token of the owner query
   * @return The owner of the token
   */
  public _ownerOf(
    tokenId: bigint,
  ): Either<ZswapCoinPublicKey, ContractAddress> {
    return this.circuits.impure._ownerOf(tokenId);
  }

  /**
   * @description  Approve `to` to operate on `tokenId`
   *
   * The `auth` argument is optional. If the value passed is non 0, then this function will check that `auth` is
   * either the owner of the token, or approved to operate on all tokens held by this owner.
   *
   * @param to The target account to approve
   * @param tokenId The token to approve
   * @param auth An account authorized to operate on all tokens held by the owner the token
   */
  public _approve(
    to: Either<ZswapCoinPublicKey, ContractAddress>,
    tokenId: bigint,
    auth: Either<ZswapCoinPublicKey, ContractAddress>,
  ) {
    this.circuits.impure._approve(to, tokenId, auth);
  }

  /**
   * @description Checks if `spender` can operate on `tokenId`, assuming the provided `owner` is the actual owner.
   * Reverts if:
   * - `spender` does not have approval from `owner` for `tokenId`.
   * - `spender` does not have approval to manage all of `owner`'s assets.
   *
   * WARNING: This function assumes that `owner` is the actual owner of `tokenId` and does not verify this
   * assumption.
   *
   * @param owner Owner of the token
   * @param spender Account operating on `tokenId`
   * @param tokenId The token to spend
   */
  public _checkAuthorized(
    owner: Either<ZswapCoinPublicKey, ContractAddress>,
    spender: Either<ZswapCoinPublicKey, ContractAddress>,
    tokenId: bigint,
  ) {
    return this.circuits.impure._checkAuthorized(owner, spender, tokenId);
  }

  /**
   * @description Returns whether `spender` is allowed to manage `owner`'s tokens, or `tokenId` in
   * particular (ignoring whether it is owned by `owner`).
   *
   * WARNING: This function assumes that `owner` is the actual owner of `tokenId` and does not verify this
   * assumption.
   *
   * @param owner Owner of the token
   * @param spender Account that wishes to spend `tokenId`
   * @param tokenId Token to spend
   * @return A boolean determining if `spender` may manage `tokenId`
   */
  public _isAuthorized(
    owner: Either<ZswapCoinPublicKey, ContractAddress>,
    spender: Either<ZswapCoinPublicKey, ContractAddress>,
    tokenId: bigint,
  ): boolean {
    return this.circuits.impure._isAuthorized(owner, spender, tokenId);
  }

  /**
   * @description Returns the approved address for `tokenId`. Returns 0 if `tokenId` is not minted.
   *
   * @param tokenId The token to query
   * @return An account approved to spend `tokenId`
   */
  public _getApproved(
    tokenId: bigint,
  ): Either<ZswapCoinPublicKey, ContractAddress> {
    return this.circuits.impure._getApproved(tokenId);
  }

  /**
   * @description Approve `operator` to operate on all of `owner` tokens
   *
   * Requirements:
   *
   * - operator can't be the address zero.
   *
   * @param owner Owner of a token
   * @param operator The account to approve
   * @param approved A boolean determining if `operator` may operate on all of `owner` tokens
   */
  public _setApprovalForAll(
    owner: Either<ZswapCoinPublicKey, ContractAddress>,
    operator: Either<ZswapCoinPublicKey, ContractAddress>,
    approved: boolean,
  ) {
    this.circuits.impure._setApprovalForAll(owner, operator, approved);
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
   */
  public _mint(
    to: Either<ZswapCoinPublicKey, ContractAddress>,
    tokenId: bigint,
  ) {
    this.circuits.impure._mint(to, tokenId);
  }

  /**
   * @description Destroys `tokenId`.
   * The approval is cleared when the token is burned.
   * This is an internal function that does not check if the sender is authorized to operate on the token.
   *
   * Requirements:
   *
   * - `tokenId` must exist.
   *
   * @param tokenId The token to burn
   */
  public _burn(tokenId: bigint) {
    this.circuits.impure._burn(tokenId);
  }

  /**
   * @description Transfers `tokenId` from `fromAddress` to `to`.
   *  As opposed to {transferFrom}, this imposes no restrictions on ownPublicKey().
   *
   * Requirements:
   *
   * - `to` cannot be the zero address.
   * - `tokenId` token must be owned by `fromAddress`.
   *
   * @param fromAddress The source account of the token transfer
   * @param to The target account of the token transfer
   * @param tokenId The token to transfer
   */
  public _transfer(
    fromAddress: Either<ZswapCoinPublicKey, ContractAddress>,
    to: Either<ZswapCoinPublicKey, ContractAddress>,
    tokenId: bigint,
  ) {
    this.circuits.impure._transfer(fromAddress, to, tokenId);
  }

  /**
   * @description Sets the the URI as `tokenURI` for the given `tokenId`.
   * The `tokenId` must exist.
   *
   * @notice The URI for a given NFT is usually set when the NFT is minted.
   *
   * @param tokenId The identifier of the token.
   * @param tokenURI The URI of `tokenId`.
   */
  public _setTokenURI(tokenId: bigint, tokenURI: string) {
    this.circuits.impure._setTokenURI(tokenId, tokenURI);
  }

  /**
   * @description Transfers `tokenId` token from `fromAddress` to `to`. It does NOT check if the recipient is a ContractAddress.
   *
   * @notice External smart contracts cannot call the token contract at this time, so any transfers to external contracts
   * may result in a permanent loss of the token. All transfers to external contracts will be permanently "stuck" at the
   * ContractAddress
   *
   * Requirements:
   *
   * - `fromAddress` cannot be the zero address.
   * - `to` cannot be the zero address.
   * - `tokenId` token must be owned by `fromAddress`.
   * - If the caller is not `fromAddress`, it must be approved to move this token by either {approve} or {setApprovalForAll}.
   *
   * @param {Either<ZswapCoinPublicKey, ContractAddress>} fromAddress - The source account from which the token is being transfered
   * @param {Either<ZswapCoinPublicKey, ContractAddress>} to - The target account to transfer token to
   * @param {TokenId} tokenId - The token being transfered
   */
  public _unsafeTransferFrom(
    fromAddress: Either<ZswapCoinPublicKey, ContractAddress>,
    to: Either<ZswapCoinPublicKey, ContractAddress>,
    tokenId: bigint,
  ) {
    this.circuits.impure._unsafeTransferFrom(fromAddress, to, tokenId);
  }

  /**
   * @description Transfers `tokenId` from `fromAddress` to `to`.
   * As opposed to {_unsafeTransferFrom}, this imposes no restrictions on ownPublicKey().
   * It does NOT check if the recipient is a ContractAddress.
   *
   * @notice External smart contracts cannot call the token contract at this time, so any transfers to external contracts
   * may result in a permanent loss of the token. All transfers to external contracts will be permanently "stuck" at the
   * ContractAddress
   *
   * Requirements:
   *
   * - `to` cannot be the zero address.
   * - `tokenId` token must be owned by `fromAddress`.
   *
   * @param {Either<ZswapCoinPublicKey, ContractAddress>} fromAddress - The source account of the token transfer
   * @param {Either<ZswapCoinPublicKey, ContractAddress>} to - The target account of the token transfer
   * @param {TokenId} tokenId - The token to transfer
   */
  public _unsafeTransfer(
    fromAddress: Either<ZswapCoinPublicKey, ContractAddress>,
    to: Either<ZswapCoinPublicKey, ContractAddress>,
    tokenId: bigint,
  ) {
    this.circuits.impure._unsafeTransfer(fromAddress, to, tokenId);
  }

  /**
   * @description Mints `tokenId` and transfers it to `to`. It does NOT check if the recipient is a ContractAddress.
   *
   * @notice External smart contracts cannot call the token contract at this time, so any transfers to external contracts
   * may result in a permanent loss of the token. All transfers to external contracts will be permanently "stuck" at the
   * ContractAddress
   *
   * Requirements:
   *
   * - `tokenId` must not exist.
   * - `to` cannot be the zero address.
   *
   * @param {Either<ZswapCoinPublicKey, ContractAddress>} to - The account receiving `tokenId`
   * @param {TokenId} tokenId - The token to transfer
   */
  public _unsafeMint(
    to: Either<ZswapCoinPublicKey, ContractAddress>,
    tokenId: bigint,
  ) {
    this.circuits.impure._unsafeMint(to, tokenId);
  }
}
