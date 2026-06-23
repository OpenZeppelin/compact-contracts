import {
  type BaseSimulatorOptions,
  createSimulator,
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
 * The native shielded token modules (and the derived-nonce extension) declare
 * no witnesses, so the private state is empty and the witnesses object is `{}`.
 */
export type NativeShieldedTokenPrivateState = Record<string, never>;
export const NativeShieldedTokenPrivateState: NativeShieldedTokenPrivateState =
  {};
export const NativeShieldedTokenWitnesses = () => ({});

/**
 * Type constructor args — mirrors `MockNativeShieldedToken`'s constructor:
 * `(domainSep, initNonce, name, symbol, decimals, init)`. When `init` is
 * false the contract is left uninitialized so the pre-init guards are testable.
 */
type NativeShieldedTokenArgs = readonly [
  domain: Uint8Array,
  initNonce: Uint8Array,
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
  contractArgs: (domain, initNonce, name, symbol, decimals, init) => [
    domain,
    initNonce,
    name,
    symbol,
    decimals,
    init,
  ],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => NativeShieldedTokenWitnesses(),
});

/**
 * NativeShieldedToken (Fungible profile) Simulator.
 *
 * Wraps the `MockNativeShieldedToken` test contract, which composes the
 * `NativeShieldedToken` module with the `NativeShieldedTokenDerivedNonce`
 * extension and exposes their internal circuits unrestricted.
 */
export class NativeShieldedTokenSimulator extends NativeShieldedTokenSimulatorBase {
  constructor(
    domain: Uint8Array,
    initNonce: Uint8Array,
    name: string,
    symbol: string,
    decimals: bigint,
    init: boolean,
    options: BaseSimulatorOptions<
      NativeShieldedTokenPrivateState,
      ReturnType<typeof NativeShieldedTokenWitnesses>
    > = {},
  ) {
    super([domain, initNonce, name, symbol, decimals, init], options);
  }

  ///
  /// Metadata
  ///

  /** @description Returns the token name. */
  public name(): string {
    return this.circuits.impure.name();
  }

  /** @description Returns the token symbol. */
  public symbol(): string {
    return this.circuits.impure.symbol();
  }

  /** @description Returns the token decimals. */
  public decimals(): bigint {
    return this.circuits.impure.decimals();
  }

  /**
   * @description Returns this token's coin color
   * (`tokenType(_domain, kernel.self())`), computed at call time.
   */
  public tokenColor(): Uint8Array {
    return this.circuits.impure.tokenColor();
  }

  ///
  /// Supply accounting
  ///

  /** @description Returns the exact amount ever minted. */
  public totalMinted(): bigint {
    return this.circuits.impure.totalMinted();
  }

  /** @description Returns the contract-mediated amount burned (lower bound). */
  public totalBurned(): bigint {
    return this.circuits.impure.totalBurned();
  }

  /** @description Returns `totalMinted() - totalBurned()` (upper bound on supply). */
  public totalSupply(): bigint {
    return this.circuits.impure.totalSupply();
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
  ): ShieldedCoinInfo {
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
  ): Maybe<ShieldedCoinInfo> {
    return this.circuits.impure._burn(coin, amount, refundTo);
  }

  /**
   * @description Burns `amount` from a contract-held `coin` (Merkle spend).
   * @returns The change coin retained by the contract, or `none` on a full burn.
   */
  public _burnFromContract(
    coin: QualifiedShieldedCoinInfo,
    amount: bigint,
  ): Maybe<ShieldedCoinInfo> {
    return this.circuits.impure._burnFromContract(coin, amount);
  }

  ///
  /// Derived-nonce extension
  ///

  /** @description Advances the nonce chain and returns the next derived coin nonce. */
  public _deriveNonce(): Uint8Array {
    return this.circuits.impure._deriveNonce();
  }

  /**
   * @description The documented composition: base `_mint` with the extension's
   * `_deriveNonce()` output as the nonce.
   */
  public _mintWithDerivedNonce(
    recipient: Either<ZswapCoinPublicKey, ContractAddress>,
    amount: bigint,
  ): ShieldedCoinInfo {
    return this.circuits.impure._mintWithDerivedNonce(recipient, amount);
  }

  /**
   * @description Seeds the derived-nonce chain post-deploy. Test-only entry
   * point for the seed-once / zero-seed guards.
   */
  public initializeNonce(initNonce: Uint8Array): void {
    this.circuits.impure.initializeNonce(initNonce);
  }

  ///
  /// Ledger reads (fields without getter circuits)
  ///

  /** @description Whether the token module has been initialized. */
  public isInitialized(): boolean {
    return this.getPublicState().NativeShieldedToken__isInitialized;
  }

  /** @description Current value of the derived-nonce chain counter. */
  public nonceCounter(): bigint {
    return this.getPublicState().NativeShieldedTokenDerivedNonce__counter;
  }

  /** @description Latest value of the derived-nonce evolution chain (`_nonce`). */
  public nonceChainValue(): Uint8Array {
    return this.getPublicState().NativeShieldedTokenDerivedNonce__nonce;
  }
}
