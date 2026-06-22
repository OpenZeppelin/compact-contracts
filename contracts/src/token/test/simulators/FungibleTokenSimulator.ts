import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type ContractAddress,
  type Either,
  ledger,
  Contract as MockFungibleToken,
} from '../../../../artifacts/MockFungibleToken/contract/index.js';
import {
  FungibleTokenPrivateState,
  FungibleTokenWitnesses,
} from '../witnesses/FungibleTokenWitnesses.js';

/**
 * Type constructor args
 */
type FungibleTokenArgs = readonly [
  name: string,
  symbol: string,
  decimals: bigint,
  init: boolean,
];

const FungibleTokenSimulatorBase = createSimulator<
  FungibleTokenPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof FungibleTokenWitnesses>,
  MockFungibleToken<FungibleTokenPrivateState>,
  FungibleTokenArgs
>({
  contractFactory: (witnesses) =>
    new MockFungibleToken<FungibleTokenPrivateState>(witnesses),
  defaultPrivateState: () => FungibleTokenPrivateState.generate(),
  contractArgs: (name, symbol, decimals, init) => [
    name,
    symbol,
    decimals,
    init,
  ],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => FungibleTokenWitnesses(),
  artifactName: 'MockFungibleToken',
});

/**
 * FungibleToken Simulator
 */
export class FungibleTokenSimulator extends FungibleTokenSimulatorBase {
  static async create(
    name: string,
    symbol: string,
    decimals: bigint,
    init: boolean,
    options: SimulatorOptions<
      FungibleTokenPrivateState,
      ReturnType<typeof FungibleTokenWitnesses>
    > = {},
  ): Promise<FungibleTokenSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [name, symbol, decimals, init],
      options,
    ) as Promise<FungibleTokenSimulator>;
  }
  /**
   * @description Returns the token name.
   * @returns The token name.
   */
  public name(): Promise<string> {
    return this.circuits.impure.name();
  }

  /**
   * @description Returns the symbol of the token.
   * @returns The token name.
   */
  public symbol(): Promise<string> {
    return this.circuits.impure.symbol();
  }

  /**
   * @description Returns the number of decimals used to get its user representation.
   * @returns The account's token balance.
   */
  public decimals(): Promise<bigint> {
    return this.circuits.impure.decimals();
  }

  /**
   * @description Returns the value of tokens in existence.
   * @returns The total supply of tokens.
   */
  public totalSupply(): Promise<bigint> {
    return this.circuits.impure.totalSupply();
  }

  /**
   * @description Returns the value of tokens owned by `account`.
   * @param account The public key or contract address to query.
   * @returns The account's token balance.
   */
  public balanceOf(
    account: Either<Uint8Array, ContractAddress>,
  ): Promise<bigint> {
    return this.circuits.impure.balanceOf(account);
  }

  /**
   * @description Returns the remaining number of tokens that `spender` will be allowed to spend on behalf of `owner`
   * through `transferFrom`. This value changes when `approve` or `transferFrom` are called.
   * @param owner The public key or contract address of approver.
   * @param spender The public key or contract address of spender.
   * @returns The `spender`'s allowance over `owner`'s tokens.
   */
  public allowance(
    owner: Either<Uint8Array, ContractAddress>,
    spender: Either<Uint8Array, ContractAddress>,
  ): Promise<bigint> {
    return this.circuits.impure.allowance(owner, spender);
  }

  /**
   * @description Moves a `value` amount of tokens from the caller's account to `to`.
   * @param to The recipient of the transfer, either a user or a contract.
   * @param value The amount to transfer.
   * @returns As per the IERC20 spec, this MUST return true.
   */
  public transfer(
    to: Either<Uint8Array, ContractAddress>,
    value: bigint,
  ): Promise<boolean> {
    return this.circuits.impure.transfer(to, value);
  }

  /**
   * @description Unsafe variant of `transfer` which allows transfers to contract addresses.
   * @param to The recipient of the transfer, either a user or a contract.
   * @param value The amount to transfer.
   * @returns As per the IERC20 spec, this MUST return true.
   */
  public _unsafeTransfer(
    to: Either<Uint8Array, ContractAddress>,
    value: bigint,
  ): Promise<boolean> {
    return this.circuits.impure._unsafeTransfer(to, value);
  }

  /**
   * @description Moves `value` tokens from `from` to `to` using the allowance mechanism.
   * `value` is the deducted from the caller's allowance.
   * @param fromAddress The current owner of the tokens for the transfer, either a user or a contract.
   * @param to The recipient of the transfer, either a user or a contract.
   * @param value The amount to transfer.
   * @returns As per the IERC20 spec, this MUST return true.
   */
  public transferFrom(
    fromAddress: Either<Uint8Array, ContractAddress>,
    to: Either<Uint8Array, ContractAddress>,
    value: bigint,
  ): Promise<boolean> {
    return this.circuits.impure.transferFrom(fromAddress, to, value);
  }

  /**
   * @description Unsafe variant of `transferFrom` which allows transfers to contract addresses.
   * @param fromAddress The current owner of the tokens for the transfer, either a user or a contract.
   * @param to The recipient of the transfer, either a user or a contract.
   * @param value The amount to transfer.
   * @returns As per the IERC20 spec, this MUST return true.
   */
  public _unsafeTransferFrom(
    fromAddress: Either<Uint8Array, ContractAddress>,
    to: Either<Uint8Array, ContractAddress>,
    value: bigint,
  ): Promise<boolean> {
    return this.circuits.impure._unsafeTransferFrom(fromAddress, to, value);
  }

  /**
   * @description Sets a `value` amount of tokens as allowance of `spender` over the caller's tokens.
   * @param spender The Zswap key or ContractAddress that may spend on behalf of the caller.
   * @param value The amount of tokens the `spender` may spend.
   * @returns Returns a boolean value indicating whether the operation succeeded.
   */
  public approve(
    spender: Either<Uint8Array, ContractAddress>,
    value: bigint,
  ): Promise<boolean> {
    return this.circuits.impure.approve(spender, value);
  }

  ///
  /// Internal
  ///

  /**
   * @description Moves a `value` amount of tokens from `from` to `to`.
   * This internal function is equivalent to {transfer}, and can be used to
   * e.g. implement automatic token fees, slashing mechanisms, etc.
   * @param fromAddress The owner of the tokens to transfer.
   * @param to The receipient of the transferred tokens.
   * @param value The amount of tokens to transfer.
   */
  public _transfer(
    fromAddress: Either<Uint8Array, ContractAddress>,
    to: Either<Uint8Array, ContractAddress>,
    value: bigint,
  ): Promise<[]> {
    return this.circuits.impure._transfer(fromAddress, to, value);
  }

  /**
   * @description Unsafe variant of `_transfer` which allows transfers to contract addresses.
   * @param fromAddress The owner of the tokens to transfer.
   * @param to The receipient of the transferred tokens.
   * @param value The amount of tokens to transfer.
   */
  public _unsafeUncheckedTransfer(
    fromAddress: Either<Uint8Array, ContractAddress>,
    to: Either<Uint8Array, ContractAddress>,
    value: bigint,
  ): Promise<[]> {
    return this.circuits.impure._unsafeUncheckedTransfer(
      fromAddress,
      to,
      value,
    );
  }

  /**
   * @description Creates a `value` amount of tokens and assigns them to `account`,
   * by transferring it from the zero address. Relies on the `update` mechanism.
   * @param account The recipient of tokens minted.
   * @param value The amount of tokens minted.
   */
  public _mint(
    account: Either<Uint8Array, ContractAddress>,
    value: bigint,
  ): Promise<[]> {
    return this.circuits.impure._mint(account, value);
  }

  /**
   * @description Unsafe variant of `_mint` which allows transfers to contract addresses.
   * @param account The recipient of tokens minted.
   * @param value The amount of tokens minted.
   */
  public _unsafeMint(
    account: Either<Uint8Array, ContractAddress>,
    value: bigint,
  ): Promise<[]> {
    return this.circuits.impure._unsafeMint(account, value);
  }

  /**
   * @description Destroys a `value` amount of tokens from `account`, lowering the total supply.
   * Relies on the `_update` mechanism.
   * @param account The target owner of tokens to burn.
   * @param value The amount of tokens to burn.
   */
  public _burn(
    account: Either<Uint8Array, ContractAddress>,
    value: bigint,
  ): Promise<[]> {
    return this.circuits.impure._burn(account, value);
  }

  /**
   * @description Sets `value` as the allowance of `spender` over the `owner`'s tokens.
   * This internal function is equivalent to `approve`, and can be used to
   * e.g. set automatic allowances for certain subsystems, etc.
   * @param owner The owner of the tokens.
   * @param spender The spender of the tokens.
   * @param value The amount of tokens `spender` may spend on behalf of `owner`.
   */
  public _approve(
    owner: Either<Uint8Array, ContractAddress>,
    spender: Either<Uint8Array, ContractAddress>,
    value: bigint,
  ): Promise<[]> {
    return this.circuits.impure._approve(owner, spender, value);
  }

  /**
   * @description Updates `owner`'s allowance for `spender` based on spent `value`.
   * Does not update the allowance value in case of infinite allowance.
   * @param owner The owner of the tokens.
   * @param spender The spender of the tokens.
   * @param value The amount of token allowance to spend.
   */
  public _spendAllowance(
    owner: Either<Uint8Array, ContractAddress>,
    spender: Either<Uint8Array, ContractAddress>,
    value: bigint,
  ): Promise<[]> {
    return this.circuits.impure._spendAllowance(owner, spender, value);
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
    ): Promise<FungibleTokenPrivateState> => {
      const updatedState = FungibleTokenPrivateState.withSecretKey(newSK);
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
