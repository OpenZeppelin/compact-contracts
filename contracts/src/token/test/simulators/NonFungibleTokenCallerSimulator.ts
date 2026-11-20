import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type Caller,
  type ContractAddress,
  type Either,
  ledger,
  Contract as MockNonFungibleTokenCaller,
} from '../../../../artifacts/token/test/mocks/MockNonFungibleTokenCaller/contract/index.js';

// The mock declares no witnesses, so the private state and witness set are
// both empty.
export type NonFungibleTokenCallerPrivateState = Record<string, never>;
export const NonFungibleTokenCallerPrivateState: NonFungibleTokenCallerPrivateState =
  {};
export const NonFungibleTokenCallerWitnesses = () => ({});

/**
 * Type constructor args
 */
type NonFungibleTokenCallerArgs = readonly [name: string, symbol: string];

const NonFungibleTokenCallerSimulatorBase = createSimulator<
  NonFungibleTokenCallerPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof NonFungibleTokenCallerWitnesses>,
  MockNonFungibleTokenCaller<NonFungibleTokenCallerPrivateState>,
  NonFungibleTokenCallerArgs
>({
  contractFactory: (witnesses) =>
    new MockNonFungibleTokenCaller<NonFungibleTokenCallerPrivateState>(
      witnesses,
    ),
  defaultPrivateState: () => NonFungibleTokenCallerPrivateState,
  contractArgs: (name, symbol) => [name, symbol],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => NonFungibleTokenCallerWitnesses(),
  artifactName: 'MockNonFungibleTokenCaller',
});

/**
 * NonFungibleToken Simulator for the mock that takes the caller as an argument.
 *
 * Each method is a thin pass-through to the mock's matching circuit.
 */
export class NonFungibleTokenCallerSimulator extends NonFungibleTokenCallerSimulatorBase {
  static async create(
    name: string,
    symbol: string,
    options: SimulatorOptions<
      NonFungibleTokenCallerPrivateState,
      ReturnType<typeof NonFungibleTokenCallerWitnesses>
    > = {},
  ): Promise<NonFungibleTokenCallerSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [name, symbol],
      options,
    ) as Promise<NonFungibleTokenCallerSimulator>;
  }

  /**
   * @description Returns the number of tokens `owner` holds.
   * @param owner - The account to query.
   * @returns The number of tokens `owner` holds.
   */
  public balanceOf(
    owner: Either<Uint8Array, ContractAddress>,
  ): Promise<bigint> {
    return this.circuits.impure.balanceOf(owner);
  }

  /**
   * @description Returns the owner of `tokenId`.
   * @param tokenId - The token to query.
   * @returns The account that owns `tokenId`.
   */
  public ownerOf(
    tokenId: bigint,
  ): Promise<Either<Uint8Array, ContractAddress>> {
    return this.circuits.impure.ownerOf(tokenId);
  }

  /**
   * @description Approves `to` to transfer `tokenId`.
   * @param caller - The caller to act as.
   * @param to - The account receiving the approval.
   * @param tokenId - The token to approve.
   */
  public approve(
    caller: Caller,
    to: Either<Uint8Array, ContractAddress>,
    tokenId: bigint,
  ): Promise<[]> {
    return this.circuits.impure.approve(caller, to, tokenId);
  }

  /**
   * @description Returns the account approved for `tokenId`.
   * @param tokenId - The token to query.
   * @returns The approved account.
   */
  public getApproved(
    tokenId: bigint,
  ): Promise<Either<Uint8Array, ContractAddress>> {
    return this.circuits.impure.getApproved(tokenId);
  }

  /**
   * @description Approves or removes `operator` for all of the caller's tokens.
   * @param caller - The caller to act as.
   * @param operator - The operator.
   * @param approved - Whether `operator` may manage the caller's tokens.
   */
  public setApprovalForAll(
    caller: Caller,
    operator: Either<Uint8Array, ContractAddress>,
    approved: boolean,
  ): Promise<[]> {
    return this.circuits.impure.setApprovalForAll(caller, operator, approved);
  }

  /**
   * @description Returns whether `operator` may manage all of `owner`'s tokens.
   * @param owner - The token owner.
   * @param operator - The operator.
   * @returns Whether `operator` is approved for all of `owner`'s tokens.
   */
  public isApprovedForAll(
    owner: Either<Uint8Array, ContractAddress>,
    operator: Either<Uint8Array, ContractAddress>,
  ): Promise<boolean> {
    return this.circuits.impure.isApprovedForAll(owner, operator);
  }

  /**
   * @description Transfers `tokenId` from `fromAddress` to `to`.
   * @param caller - The caller to act as.
   * @param fromAddress - The current owner.
   * @param to - The recipient.
   * @param tokenId - The token to transfer.
   */
  public transferFrom(
    caller: Caller,
    fromAddress: Either<Uint8Array, ContractAddress>,
    to: Either<Uint8Array, ContractAddress>,
    tokenId: bigint,
  ): Promise<[]> {
    return this.circuits.impure.transferFrom(caller, fromAddress, to, tokenId);
  }

  /**
   * @description Unsafe variant of `transferFrom`.
   * @param caller - The caller to act as.
   * @param fromAddress - The current owner.
   * @param to - The recipient.
   * @param tokenId - The token to transfer.
   */
  public _unsafeTransferFrom(
    caller: Caller,
    fromAddress: Either<Uint8Array, ContractAddress>,
    to: Either<Uint8Array, ContractAddress>,
    tokenId: bigint,
  ): Promise<[]> {
    return this.circuits.impure._unsafeTransferFrom(
      caller,
      fromAddress,
      to,
      tokenId,
    );
  }

  /**
   * @description Mints `tokenId` to `to`.
   * @param to - The recipient.
   * @param tokenId - The token to mint.
   */
  public _mint(
    to: Either<Uint8Array, ContractAddress>,
    tokenId: bigint,
  ): Promise<[]> {
    return this.circuits.impure._mint(to, tokenId);
  }

  /**
   * @description Unsafe variant of `_mint`.
   * @param to - The recipient.
   * @param tokenId - The token to mint.
   */
  public _unsafeMint(
    to: Either<Uint8Array, ContractAddress>,
    tokenId: bigint,
  ): Promise<[]> {
    return this.circuits.impure._unsafeMint(to, tokenId);
  }
}

export type { Caller, ContractAddress, Either };
