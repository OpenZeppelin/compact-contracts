import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type ContractAddress,
  type Either,
  ledger,
  type Maybe,
  Contract as MockMultiToken,
} from '../../../../artifacts/MockMultiToken/contract/index.js';
import {
  MultiTokenPrivateState,
  MultiTokenWitnesses,
} from '../witnesses/MultiTokenWitnesses.js';

/**
 * Type constructor args
 */
type MultiTokenArgs = readonly [_uri: Maybe<string>];

const MultiTokenSimulatorBase = createSimulator<
  MultiTokenPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof MultiTokenWitnesses>,
  MockMultiToken<MultiTokenPrivateState>,
  MultiTokenArgs
>({
  contractFactory: (witnesses) =>
    new MockMultiToken<MultiTokenPrivateState>(witnesses),
  defaultPrivateState: () => MultiTokenPrivateState.generate(),
  contractArgs: (_uri) => [_uri],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => MultiTokenWitnesses(),
  artifactName: 'MockMultiToken',
});

/**
 * MultiToken Simulator
 */
export class MultiTokenSimulator extends MultiTokenSimulatorBase {
  static async create(
    _uri: Maybe<string>,
    options: SimulatorOptions<
      MultiTokenPrivateState,
      ReturnType<typeof MultiTokenWitnesses>
    > = {},
  ): Promise<MultiTokenSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([_uri], options) as Promise<MultiTokenSimulator>;
  }

  /**
   * @description Initializes the contract. This is already executed in the simulator constructor;
   * however, this method enables the tests to assert it cannot be called again.
   * @param uri The base URI for all token URIs.
   */
  public initialize(uri: string): Promise<[]> {
    return this.circuits.impure.initialize(uri);
  }

  /**
   * @description Returns the token URI.
   * @param id The token identifier to query.
   * @returns The token URI.
   */
  public uri(id: bigint): Promise<string> {
    return this.circuits.impure.uri(id);
  }

  /**
   * @description Returns the amount of `id` tokens owned by `account`.
   * @param account The account balance to query.
   * @param id The token identifier to query.
   * @returns The quantity of `id` tokens that `account` owns.
   */
  public balanceOf(
    account: Either<Uint8Array, ContractAddress>,
    id: bigint,
  ): Promise<bigint> {
    return this.circuits.impure.balanceOf(account, id);
  }

  /**
   * @description Enables or disables approval for `operator` to manage all of the caller's assets.
   * @param operator The Uint8Array or ContractAddress whose approval is set for the caller's assets.
   * @param approved The boolean value determining if the operator may or may not handle the
   * caller's assets.
   */
  public setApprovalForAll(
    operator: Either<Uint8Array, ContractAddress>,
    approved: boolean,
  ): Promise<[]> {
    return this.circuits.impure.setApprovalForAll(operator, approved);
  }

  /**
   * @description Queries if `operator` is an authorized operator for `owner`.
   * @param account The queried possessor of assets.
   * @param operator The queried handler of `account`'s assets.
   * @returns Whether or not `operator` has permission to handle `account`'s assets.
   */
  public isApprovedForAll(
    account: Either<Uint8Array, ContractAddress>,
    operator: Either<Uint8Array, ContractAddress>,
  ): Promise<boolean> {
    return this.circuits.impure.isApprovedForAll(account, operator);
  }

  /**
   * @description Transfers ownership of `value` amount of `id` tokens from `fromAddress` to `to`.
   * The caller must be `fromAddress` or approved to transfer on their behalf.
   * @param fromAddress The owner from which the transfer originates.
   * @param to The recipient of the transferred assets.
   * @param id The unique identifier of the asset type.
   * @param value The quantity of `id` tokens to transfer.
   */
  public transferFrom(
    fromAddress: Either<Uint8Array, ContractAddress>,
    to: Either<Uint8Array, ContractAddress>,
    id: bigint,
    value: bigint,
  ): Promise<[]> {
    return this.circuits.impure.transferFrom(fromAddress, to, id, value);
  }

  /**
   * @description Unsafe variant of `transferFrom` which allows transfers to contract addresses.
   * The caller must be `fromAddress` or approved to transfer on their behalf.
   * @param fromAddress The owner from which the transfer originates.
   * @param to The recipient of the transferred assets.
   * @param id The unique identifier of the asset type.
   * @param value The quantity of `id` tokens to transfer.
   */
  public _unsafeTransferFrom(
    fromAddress: Either<Uint8Array, ContractAddress>,
    to: Either<Uint8Array, ContractAddress>,
    id: bigint,
    value: bigint,
  ): Promise<[]> {
    return this.circuits.impure._unsafeTransferFrom(fromAddress, to, id, value);
  }

  /**
   *  @description Transfers ownership of `value` amount of `id` tokens from `fromAddress` to `to`.
   * Does not impose restrictions on the caller, making it suitable for composition
   * in higher-level contract logic.
   * @param fromAddress The owner from which the transfer originates.
   * @param to The recipient of the transferred assets.
   * @param id The unique identifier of the asset type.
   * @param value The quantity of `id` tokens to transfer.
   */
  public _transfer(
    fromAddress: Either<Uint8Array, ContractAddress>,
    to: Either<Uint8Array, ContractAddress>,
    id: bigint,
    value: bigint,
  ): Promise<[]> {
    return this.circuits.impure._transfer(fromAddress, to, id, value);
  }

  /**
   * @description Unsafe variant of `_transfer` which allows transfers to contract addresses.
   * Does not impose restrictions on the caller, making it suitable as a low-level
   * building block for advanced contract logic.
   * @param fromAddress The owner from which the transfer originates.
   * @param to The recipient of the transferred assets.
   * @param id The unique identifier of the asset type.
   * @param value The quantity of `id` tokens to transfer.
   */
  public _unsafeTransfer(
    fromAddress: Either<Uint8Array, ContractAddress>,
    to: Either<Uint8Array, ContractAddress>,
    id: bigint,
    value: bigint,
  ): Promise<[]> {
    return this.circuits.impure._unsafeTransfer(fromAddress, to, id, value);
  }

  /**
   * @description Sets a new URI for all token types.
   * @param newURI The new base URI for all tokens.
   */
  public _setURI(newURI: string): Promise<[]> {
    return this.circuits.impure._setURI(newURI);
  }

  /**
   * @description Creates a `value` amount of tokens of type `token_id`, and assigns them to `to`.
   * @param to The recipient of the minted tokens.
   * @param id The unique identifier for the token type.
   * @param value The quantity of `id` tokens that are minted to `to`.
   */
  public _mint(
    to: Either<Uint8Array, ContractAddress>,
    id: bigint,
    value: bigint,
  ): Promise<[]> {
    return this.circuits.impure._mint(to, id, value);
  }

  /**
   * @description Creates a `value` amount of tokens of type `token_id`, and assigns them to `to`.
   * @param to The recipient of the minted tokens.
   * @param id The unique identifier for the token type.
   * @param value The quantity of `id` tokens that are minted to `to`.
   */
  public _unsafeMint(
    to: Either<Uint8Array, ContractAddress>,
    id: bigint,
    value: bigint,
  ): Promise<[]> {
    return this.circuits.impure._unsafeMint(to, id, value);
  }

  /**
   * @description Destroys a `value` amount of tokens of type `token_id` from `fromAddress`.
   * @param fromAddress The owner whose tokens will be destroyed.
   * @param id The unique identifier of the token type.
   * @param value The quantity of `id` tokens that will be destroyed from `fromAddress`
   */
  public _burn(
    fromAddress: Either<Uint8Array, ContractAddress>,
    id: bigint,
    value: bigint,
  ): Promise<[]> {
    return this.circuits.impure._burn(fromAddress, id, value);
  }

  /**
   * @description Enables or disables approval for `operator` to manage all of the caller's assets.
   * @param owner The Uint8Array or ContractAddress of the target owner.
   * @param operator The Uint8Array or ContractAddress whose approval is set for the
   * `owner`'s assets.
   * @param approved The boolean value determining if the operator may or may not handle the
   * `owner`'s assets.
   */
  public _setApprovalForAll(
    owner: Either<Uint8Array, ContractAddress>,
    operator: Either<Uint8Array, ContractAddress>,
    approved: boolean,
  ): Promise<[]> {
    return this.circuits.impure._setApprovalForAll(owner, operator, approved);
  }

  public readonly privateState = {
    /**
     * @description Replaces the secret key in the private state. Used in tests to
     * simulate switching between different user identities or injecting incorrect
     * keys to test failure paths.
     * @param newSK - The new secret key to set.
     * @returns The updated private state.
     */
    injectSecretKey: async (
      newSK: Uint8Array,
    ): Promise<MultiTokenPrivateState> => {
      const updatedState = MultiTokenPrivateState.withSecretKey(newSK);
      this.setPrivateState(updatedState);
      return updatedState;
    },

    /**
     * @description Returns the current secret key from the private state.
     * @returns The secret key.
     * @throws If the secret key is undefined.
     */
    getCurrentSecretKey: async (): Promise<Uint8Array> => {
      const sk = (await this.getPrivateState()).secretKey;
      if (typeof sk === 'undefined') {
        throw new Error('Missing secret key');
      }
      return Uint8Array.from(sk);
    },
  };
}
