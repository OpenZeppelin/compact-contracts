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
  Contract as MockNativeShieldedTokenFamily,
  ledger,
} from '../../../../artifacts/MockNativeShieldedTokenFamily/contract/index.js';

/**
 * The family module (and the derived-nonce extension) declare no witnesses, so
 * the private state is empty and the witnesses object is `{}`.
 */
export type NativeShieldedTokenFamilyPrivateState = Record<string, never>;
export const NativeShieldedTokenFamilyPrivateState: NativeShieldedTokenFamilyPrivateState =
  {};
export const NativeShieldedTokenFamilyWitnesses = () => ({});

/**
 * Type constructor args — mirrors `MockNativeShieldedTokenFamily`'s
 * constructor: `(initNonce, name, symbol, decimals, init)`. The Family profile
 * has no sealed `_domain`; the domain is a per-call circuit parameter instead.
 */
type NativeShieldedTokenFamilyArgs = readonly [
  initNonce: Uint8Array,
  name: string,
  symbol: string,
  decimals: bigint,
  init: boolean,
];

const NativeShieldedTokenFamilySimulatorBase = createSimulator<
  NativeShieldedTokenFamilyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof NativeShieldedTokenFamilyWitnesses>,
  MockNativeShieldedTokenFamily<NativeShieldedTokenFamilyPrivateState>,
  NativeShieldedTokenFamilyArgs
>({
  contractFactory: (witnesses) =>
    new MockNativeShieldedTokenFamily<NativeShieldedTokenFamilyPrivateState>(
      witnesses,
    ),
  defaultPrivateState: () => NativeShieldedTokenFamilyPrivateState,
  contractArgs: (initNonce, name, symbol, decimals, init) => [
    initNonce,
    name,
    symbol,
    decimals,
    init,
  ],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => NativeShieldedTokenFamilyWitnesses(),
});

/**
 * NativeShieldedTokenFamily (Family profile) Simulator.
 *
 * Same standard as the Fungible profile with an explicit `domain` parameter on
 * every issuance / burn / supply circuit. Wraps `MockNativeShieldedTokenFamily`.
 */
export class NativeShieldedTokenFamilySimulator extends NativeShieldedTokenFamilySimulatorBase {
  constructor(
    initNonce: Uint8Array,
    name: string,
    symbol: string,
    decimals: bigint,
    init: boolean,
    options: BaseSimulatorOptions<
      NativeShieldedTokenFamilyPrivateState,
      ReturnType<typeof NativeShieldedTokenFamilyWitnesses>
    > = {},
  ) {
    super([initNonce, name, symbol, decimals, init], options);
  }

  ///
  /// Metadata (family-wide)
  ///

  /** @description Returns the family name shared by all token types. */
  public name(): string {
    return this.circuits.impure.name();
  }

  /** @description Returns the family symbol shared by all token types. */
  public symbol(): string {
    return this.circuits.impure.symbol();
  }

  /** @description Returns the family-wide decimals. */
  public decimals(): bigint {
    return this.circuits.impure.decimals();
  }

  /**
   * @description Returns the coin color for `domain`
   * (`tokenType(domain, kernel.self())`), computed at call time.
   */
  public tokenColor(domain: Uint8Array): Uint8Array {
    return this.circuits.impure.tokenColor(domain);
  }

  ///
  /// Supply accounting (per domain)
  ///

  /** @description Returns the exact amount ever minted for `domain`. */
  public totalMinted(domain: Uint8Array): bigint {
    return this.circuits.impure.totalMinted(domain);
  }

  /** @description Returns the contract-mediated amount burned for `domain`. */
  public totalBurned(domain: Uint8Array): bigint {
    return this.circuits.impure.totalBurned(domain);
  }

  /** @description Returns `totalMinted(domain) - totalBurned(domain)`. */
  public totalSupply(domain: Uint8Array): bigint {
    return this.circuits.impure.totalSupply(domain);
  }

  ///
  /// Mint / burn (per domain)
  ///

  /**
   * @description Mints `amount` of the `domain` token to `recipient` using a
   * caller-supplied nonce.
   */
  public _mint(
    domain: Uint8Array,
    recipient: Either<ZswapCoinPublicKey, ContractAddress>,
    amount: bigint,
    nonce: Uint8Array,
  ): ShieldedCoinInfo {
    return this.circuits.impure._mint(domain, recipient, amount, nonce);
  }

  /** @description Burns `amount` from a same-tx `coin` of `domain`. */
  public _burn(
    domain: Uint8Array,
    coin: ShieldedCoinInfo,
    amount: bigint,
    refundTo: Either<ZswapCoinPublicKey, ContractAddress>,
  ): Maybe<ShieldedCoinInfo> {
    return this.circuits.impure._burn(domain, coin, amount, refundTo);
  }

  /** @description Burns `amount` from a contract-held `coin` of `domain`. */
  public _burnFromContract(
    domain: Uint8Array,
    coin: QualifiedShieldedCoinInfo,
    amount: bigint,
  ): Maybe<ShieldedCoinInfo> {
    return this.circuits.impure._burnFromContract(domain, coin, amount);
  }

  ///
  /// Derived-nonce extension
  ///

  /** @description Advances the nonce chain and returns the next derived coin nonce. */
  public _deriveNonce(): Uint8Array {
    return this.circuits.impure._deriveNonce();
  }

  /** @description The documented composition: base `_mint` with `_deriveNonce()`. */
  public _mintWithDerivedNonce(
    domain: Uint8Array,
    recipient: Either<ZswapCoinPublicKey, ContractAddress>,
    amount: bigint,
  ): ShieldedCoinInfo {
    return this.circuits.impure._mintWithDerivedNonce(domain, recipient, amount);
  }

  /** @description Seeds the derived-nonce chain post-deploy (test-only). */
  public initializeNonce(initNonce: Uint8Array): void {
    this.circuits.impure.initializeNonce(initNonce);
  }

  ///
  /// Ledger reads (fields without getter circuits)
  ///

  /** @description Whether the family module has been initialized. */
  public isInitialized(): boolean {
    return this.getPublicState().NativeShieldedTokenFamily__isInitialized;
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
