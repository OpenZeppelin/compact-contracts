import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type Caller,
  type ContractAddress,
  type Either,
  ledger,
  Contract as MockMultiTokenCaller,
} from '../../../../artifacts/token/test/mocks/MockMultiTokenCaller/contract/index.js';

// The mock declares no witnesses, so the private state and witness set are
// both empty.
export type MultiTokenCallerPrivateState = Record<string, never>;
export const MultiTokenCallerPrivateState: MultiTokenCallerPrivateState = {};
export const MultiTokenCallerWitnesses = () => ({});

/**
 * Type constructor args
 */
type MultiTokenCallerArgs = readonly [uri: string];

const MultiTokenCallerSimulatorBase = createSimulator<
  MultiTokenCallerPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof MultiTokenCallerWitnesses>,
  MockMultiTokenCaller<MultiTokenCallerPrivateState>,
  MultiTokenCallerArgs
>({
  contractFactory: (witnesses) =>
    new MockMultiTokenCaller<MultiTokenCallerPrivateState>(witnesses),
  defaultPrivateState: () => MultiTokenCallerPrivateState,
  contractArgs: (uri) => [uri],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => MultiTokenCallerWitnesses(),
  artifactName: 'MockMultiTokenCaller',
});

/**
 * MultiToken Simulator for the mock that takes the caller as an argument.
 *
 * Each method is a thin pass-through to the mock's matching circuit.
 */
export class MultiTokenCallerSimulator extends MultiTokenCallerSimulatorBase {
  static async create(
    uri: string,
    options: SimulatorOptions<
      MultiTokenCallerPrivateState,
      ReturnType<typeof MultiTokenCallerWitnesses>
    > = {},
  ): Promise<MultiTokenCallerSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([uri], options) as Promise<MultiTokenCallerSimulator>;
  }

  /**
   * @description Returns the `id` balance of `account`.
   * @param account - The account to query.
   * @param id - The token type.
   * @returns The `id` balance of `account`.
   */
  public balanceOf(
    account: Either<Uint8Array, ContractAddress>,
    id: bigint,
  ): Promise<bigint> {
    return this.circuits.impure.balanceOf(account, id);
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
   * @description Returns whether `operator` may manage all of `account`'s tokens.
   * @param account - The token holder.
   * @param operator - The operator.
   * @returns Whether `operator` is approved for all of `account`'s tokens.
   */
  public isApprovedForAll(
    account: Either<Uint8Array, ContractAddress>,
    operator: Either<Uint8Array, ContractAddress>,
  ): Promise<boolean> {
    return this.circuits.impure.isApprovedForAll(account, operator);
  }

  /**
   * @description Transfers `value` tokens of type `id` from `fromAddress` to `to`.
   * @param caller - The caller to act as.
   * @param fromAddress - The token holder.
   * @param to - The recipient.
   * @param id - The token type.
   * @param value - The amount to transfer.
   */
  public transferFrom(
    caller: Caller,
    fromAddress: Either<Uint8Array, ContractAddress>,
    to: Either<Uint8Array, ContractAddress>,
    id: bigint,
    value: bigint,
  ): Promise<[]> {
    return this.circuits.impure.transferFrom(
      caller,
      fromAddress,
      to,
      id,
      value,
    );
  }

  /**
   * @description Unsafe variant of `transferFrom`.
   * @param caller - The caller to act as.
   * @param fromAddress - The token holder.
   * @param to - The recipient.
   * @param id - The token type.
   * @param value - The amount to transfer.
   */
  public _unsafeTransferFrom(
    caller: Caller,
    fromAddress: Either<Uint8Array, ContractAddress>,
    to: Either<Uint8Array, ContractAddress>,
    id: bigint,
    value: bigint,
  ): Promise<[]> {
    return this.circuits.impure._unsafeTransferFrom(
      caller,
      fromAddress,
      to,
      id,
      value,
    );
  }

  /**
   * @description Mints `value` tokens of type `id` to `to`.
   * @param to - The recipient.
   * @param id - The token type.
   * @param value - The amount to mint.
   */
  public _mint(
    to: Either<Uint8Array, ContractAddress>,
    id: bigint,
    value: bigint,
  ): Promise<[]> {
    return this.circuits.impure._mint(to, id, value);
  }

  /**
   * @description Unsafe variant of `_mint`.
   * @param to - The recipient.
   * @param id - The token type.
   * @param value - The amount to mint.
   */
  public _unsafeMint(
    to: Either<Uint8Array, ContractAddress>,
    id: bigint,
    value: bigint,
  ): Promise<[]> {
    return this.circuits.impure._unsafeMint(to, id, value);
  }
}

export type { Caller, ContractAddress, Either };
