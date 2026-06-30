import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type ContractAddress,
  type Either,
  type Maybe,
  type QualifiedShieldedCoinInfo,
  type ShieldedCoinInfo,
  type ZswapCoinPublicKey,
  Contract as MockNativeShieldedToken,
  ledger,
} from '../../../../artifacts/MockNativeShieldedToken/contract/index.js';

/**
 * The native shielded token core module declares no witnesses, so the private
 * state is empty and the witnesses object is `{}`.
 */
export type NativeShieldedTokenPrivateState = Record<string, never>;
export const NativeShieldedTokenPrivateState: NativeShieldedTokenPrivateState =
  {};
export const NativeShieldedTokenWitnesses = () => ({});

/**
 * Type constructor args — mirrors `MockNativeShieldedToken`'s constructor:
 * `(domainSep, name, symbol, decimals, init)`. When `init` is false the
 * contract is left uninitialized so the pre-init guards are testable.
 */
type NativeShieldedTokenArgs = readonly [
  domain: Uint8Array,
  name: string,
  symbol: string,
  decimals: bigint,
  init: boolean,
];

const NativeShieldedTokenSimulatorBase = createSimulator<
  NativeShieldedTokenPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof NativeShieldedTokenWitnesses>,
  MockNativeShieldedToken<NativeShieldedTokenPrivateState>,
  NativeShieldedTokenArgs
>({
  contractFactory: (witnesses) =>
    new MockNativeShieldedToken<NativeShieldedTokenPrivateState>(witnesses),
  defaultPrivateState: () => NativeShieldedTokenPrivateState,
  contractArgs: (domain, name, symbol, decimals, init) => [
    domain,
    name,
    symbol,
    decimals,
    init,
  ],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => NativeShieldedTokenWitnesses(),
  artifactName: 'MockNativeShieldedToken',
});

/**
 * NativeShieldedToken (Fungible profile) Simulator.
 *
 * Wraps the `MockNativeShieldedToken` test contract, which composes the
 * `NativeShieldedToken` core module in isolation (no supply accounting, no
 * derived-nonce extension) and exposes its internal circuits unrestricted.
 */
export class NativeShieldedTokenSimulator extends NativeShieldedTokenSimulatorBase {
  static async create(
    domain: Uint8Array,
    name: string,
    symbol: string,
    decimals: bigint,
    init: boolean,
    options: SimulatorOptions<
      NativeShieldedTokenPrivateState,
      ReturnType<typeof NativeShieldedTokenWitnesses>
    > = {},
  ): Promise<NativeShieldedTokenSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [domain, name, symbol, decimals, init],
      options,
    ) as Promise<NativeShieldedTokenSimulator>;
  }

  ///
  /// Metadata
  ///

  /** @description Returns the token name. */
  public name(): Promise<string> {
    return this.circuits.impure.name();
  }

  /** @description Returns the token symbol. */
  public symbol(): Promise<string> {
    return this.circuits.impure.symbol();
  }

  /** @description Returns the token decimals. */
  public decimals(): Promise<bigint> {
    return this.circuits.impure.decimals();
  }

  /**
   * @description Returns this token's coin color
   * (`tokenType(_domain, kernel.self())`), computed at call time.
   */
  public tokenColor(): Promise<Uint8Array> {
    return this.circuits.impure.tokenColor();
  }

  ///
  /// Mint / burn
  ///

  /**
   * @description Mints `amount` to `recipient` using a caller-supplied nonce.
   * @returns The newly created coin's info (nonce, color, value).
   */
  public _mint(
    recipient: Either<ZswapCoinPublicKey, ContractAddress>,
    amount: bigint,
    nonce: Uint8Array,
  ): Promise<ShieldedCoinInfo> {
    return this.circuits.impure._mint(recipient, amount, nonce);
  }

  /**
   * @description Burns `amount` from a same-tx `coin`, routing change to
   * `refundTo`.
   * @returns The refund coin created for `refundTo`, or `none` on a full burn.
   */
  public _burn(
    coin: ShieldedCoinInfo,
    amount: bigint,
    refundTo: Either<ZswapCoinPublicKey, ContractAddress>,
  ): Promise<Maybe<ShieldedCoinInfo>> {
    return this.circuits.impure._burn(coin, amount, refundTo);
  }

  /**
   * @description Burns `amount` from a contract-held `coin` (Merkle spend).
   * @returns The change coin retained by the contract, or `none` on a full burn.
   */
  public _burnFromSelf(
    coin: QualifiedShieldedCoinInfo,
    amount: bigint,
  ): Promise<Maybe<ShieldedCoinInfo>> {
    return this.circuits.impure._burnFromSelf(coin, amount);
  }

  ///
  /// State reads
  ///

  /** @description Whether the token module has been initialized. */
  public isInitialized(): Promise<boolean> {
    return this.circuits.impure.isInitialized();
  }
}
