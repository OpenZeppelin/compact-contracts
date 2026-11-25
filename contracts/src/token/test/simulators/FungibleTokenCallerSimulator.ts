import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type Caller,
  type ContractAddress,
  type Either,
  ledger,
  Contract as MockFungibleTokenCaller,
} from '../../../../artifacts/token/test/mocks/MockFungibleTokenCaller/contract/index.js';

// The mock declares no witnesses, so the private state and witness set are
// both empty.
export type FungibleTokenCallerPrivateState = Record<string, never>;
export const FungibleTokenCallerPrivateState: FungibleTokenCallerPrivateState =
  {};
export const FungibleTokenCallerWitnesses = () => ({});

/**
 * Type constructor args
 */
type FungibleTokenCallerArgs = readonly [
  name: string,
  symbol: string,
  decimals: bigint,
];

const FungibleTokenCallerSimulatorBase = createSimulator<
  FungibleTokenCallerPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof FungibleTokenCallerWitnesses>,
  MockFungibleTokenCaller<FungibleTokenCallerPrivateState>,
  FungibleTokenCallerArgs
>({
  contractFactory: (witnesses) =>
    new MockFungibleTokenCaller<FungibleTokenCallerPrivateState>(witnesses),
  defaultPrivateState: () => FungibleTokenCallerPrivateState,
  contractArgs: (name, symbol, decimals) => [name, symbol, decimals],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => FungibleTokenCallerWitnesses(),
  artifactName: 'MockFungibleTokenCaller',
});

/**
 * FungibleToken Simulator for the mock that takes the caller as an argument.
 *
 * Each method is a thin pass-through to the mock's matching circuit.
 */
export class FungibleTokenCallerSimulator extends FungibleTokenCallerSimulatorBase {
  static async create(
    name: string,
    symbol: string,
    decimals: bigint,
    options: SimulatorOptions<
      FungibleTokenCallerPrivateState,
      ReturnType<typeof FungibleTokenCallerWitnesses>
    > = {},
  ): Promise<FungibleTokenCallerSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [name, symbol, decimals],
      options,
    ) as Promise<FungibleTokenCallerSimulator>;
  }

  /**
   * @description Returns the total supply.
   * @returns The total supply.
   */
  public totalSupply(): Promise<bigint> {
    return this.circuits.impure.totalSupply();
  }

  /**
   * @description Returns the balance of `account`.
   * @param account - The account to query.
   * @returns The balance of `account`.
   */
  public balanceOf(
    account: Either<Uint8Array, ContractAddress>,
  ): Promise<bigint> {
    return this.circuits.impure.balanceOf(account);
  }

  /**
   * @description Moves `value` tokens from the caller to `to`.
   * @param caller - The caller to act as.
   * @param to - The recipient.
   * @param value - The amount to transfer.
   * @returns True.
   */
  public transfer(
    caller: Caller,
    to: Either<Uint8Array, ContractAddress>,
    value: bigint,
  ): Promise<boolean> {
    return this.circuits.impure.transfer(caller, to, value);
  }

  /**
   * @description Unsafe variant of `transfer`.
   * @param caller - The caller to act as.
   * @param to - The recipient.
   * @param value - The amount to transfer.
   * @returns True.
   */
  public _unsafeTransfer(
    caller: Caller,
    to: Either<Uint8Array, ContractAddress>,
    value: bigint,
  ): Promise<boolean> {
    return this.circuits.impure._unsafeTransfer(caller, to, value);
  }

  /**
   * @description Returns the allowance of `spender` over `owner`'s tokens.
   * @param owner - The token owner.
   * @param spender - The spender.
   * @returns The allowance.
   */
  public allowance(
    owner: Either<Uint8Array, ContractAddress>,
    spender: Either<Uint8Array, ContractAddress>,
  ): Promise<bigint> {
    return this.circuits.impure.allowance(owner, spender);
  }

  /**
   * @description Sets `value` as the allowance of `spender` over the caller's tokens.
   * @param caller - The caller to act as.
   * @param spender - The spender.
   * @param value - The allowance.
   * @returns True.
   */
  public approve(
    caller: Caller,
    spender: Either<Uint8Array, ContractAddress>,
    value: bigint,
  ): Promise<boolean> {
    return this.circuits.impure.approve(caller, spender, value);
  }

  /**
   * @description Moves `value` tokens from `fromAddress` to `to` against the caller's allowance.
   * @param caller - The caller to act as.
   * @param fromAddress - The token owner.
   * @param to - The recipient.
   * @param value - The amount to transfer.
   * @returns True.
   */
  public transferFrom(
    caller: Caller,
    fromAddress: Either<Uint8Array, ContractAddress>,
    to: Either<Uint8Array, ContractAddress>,
    value: bigint,
  ): Promise<boolean> {
    return this.circuits.impure.transferFrom(caller, fromAddress, to, value);
  }

  /**
   * @description Unsafe variant of `transferFrom`.
   * @param caller - The caller to act as.
   * @param fromAddress - The token owner.
   * @param to - The recipient.
   * @param value - The amount to transfer.
   * @returns True.
   */
  public _unsafeTransferFrom(
    caller: Caller,
    fromAddress: Either<Uint8Array, ContractAddress>,
    to: Either<Uint8Array, ContractAddress>,
    value: bigint,
  ): Promise<boolean> {
    return this.circuits.impure._unsafeTransferFrom(
      caller,
      fromAddress,
      to,
      value,
    );
  }

  /**
   * @description Mints `value` tokens to `account`.
   * @param account - The recipient.
   * @param value - The amount to mint.
   */
  public _mint(
    account: Either<Uint8Array, ContractAddress>,
    value: bigint,
  ): Promise<[]> {
    return this.circuits.impure._mint(account, value);
  }

  /**
   * @description Unsafe variant of `_mint`.
   * @param account - The recipient.
   * @param value - The amount to mint.
   */
  public _unsafeMint(
    account: Either<Uint8Array, ContractAddress>,
    value: bigint,
  ): Promise<[]> {
    return this.circuits.impure._unsafeMint(account, value);
  }
}

export type { Caller, ContractAddress, Either };
