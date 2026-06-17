import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin/compact-simulator';
import {
  type CFT_EscrowEntry,
  type ElGamal_Ciphertext,
  ledger,
  Contract as MockCFT,
} from '../../../../artifacts/MockConfidentialFungibleToken/contract/index.js';
import {
  ConfidentialFungibleTokenPrivateState,
  ConfidentialFungibleTokenWitnesses,
  DEFAULT_RANDOMNESS_SEED,
} from '../witnesses/ConfidentialFungibleTokenWitnesses.js';

/**
 * Type constructor args
 */
type ConfidentialFungibleTokenArgs = readonly [
  name: string,
  symbol: string,
  decimals: bigint,
];

const ConfidentialFungibleTokenSimulatorBase = createSimulator<
  ConfidentialFungibleTokenPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ConfidentialFungibleTokenWitnesses>,
  MockCFT<ConfidentialFungibleTokenPrivateState>,
  ConfidentialFungibleTokenArgs
>({
  contractFactory: (witnesses) =>
    new MockCFT<ConfidentialFungibleTokenPrivateState>(witnesses),
  defaultPrivateState: () => ConfidentialFungibleTokenPrivateState.generate(),
  contractArgs: (name, symbol, decimals) => [name, symbol, decimals],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ConfidentialFungibleTokenWitnesses(),
});

/**
 * ConfidentialFungibleToken Simulator
 */
export class ConfidentialFungibleTokenSimulator extends ConfidentialFungibleTokenSimulatorBase {
  constructor(
    name: string,
    symbol: string,
    decimals: bigint,
    options: BaseSimulatorOptions<
      ConfidentialFungibleTokenPrivateState,
      ReturnType<typeof ConfidentialFungibleTokenWitnesses>
    > = {},
  ) {
    super([name, symbol, decimals], options);
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
   * @returns The token name.
   */
  public symbol(): string {
    return this.circuits.impure.symbol();
  }

  /**
   * @description Returns the number of decimals used to get its user representation.
   * @returns The account's token balance.
   */
  public decimals(): bigint {
    return this.circuits.impure.decimals();
  }

  /**
   * @description Returns the value of tokens in existence.
   * @returns The total supply of tokens.
   */
  public totalSupply(): bigint {
    return this.circuits.impure.totalSupply();
  }

  /**
   * @description Returns the value of tokens owned by `account`.
   * @param account The public key or contract address to query.
   * @returns The account's token balance.
   */
  public balanceOf(account: Uint8Array): ElGamal_Ciphertext {
    return this.circuits.impure.balanceOf(account);
  }

  /**
   * @description Returns the remaining number of tokens that `spender` will be allowed to spend on behalf of `owner`
   * through `transferFrom`. This value changes when `approve` or `transferFrom` are called.
   * @param owner The public key or contract address of approver.
   * @param spender The public key or contract address of spender.
   * @returns The `spender`'s allowance over `owner`'s tokens.
   */
  public allowance(owner: Uint8Array, spender: Uint8Array): CFT_EscrowEntry {
    return this.circuits.impure.allowance(owner, spender);
  }

  /**
   * @description Moves a `value` amount of tokens from the caller's account to `to`.
   * Reverts on failure (no boolean return).
   * @param to The recipient account id.
   * @param value The amount to transfer.
   */
  public transfer(to: Uint8Array, value: bigint): Uint8Array {
    return this.circuits.impure.transfer(to, value);
  }

  /**
   * @description Moves `value` tokens from `fromAddress` to `to` using the
   * escrow allowance mechanism. Reverts on failure (no boolean return).
   * @param fromAddress The owner whose escrow the caller draws on.
   * @param to The recipient account id.
   * @param value The amount to transfer.
   */
  public transferFrom(
    fromAddress: Uint8Array,
    to: Uint8Array,
    value: bigint,
  ): Uint8Array {
    return this.circuits.impure.transferFrom(fromAddress, to, value);
  }

  /**
   * @description Sets `value` as the escrow allowance of `spender` over the
   * caller's balance. Reverts on failure (no boolean return).
   * @param spender The account id that may spend on behalf of the caller.
   * @param value The amount the `spender` may spend.
   */
  public approve(spender: Uint8Array, value: bigint): Uint8Array {
    return this.circuits.impure.approve(spender, value);
  }

  /**
   * @description Creates a `value` amount of tokens and assigns them to `account`,
   * by transferring it from the zero address. Relies on the `update` mechanism.
   * @param account The recipient of tokens minted.
   * @param value The amount of tokens minted.
   */
  public _mint(account: Uint8Array, value: bigint) {
    this.circuits.impure._mint(account, value);
  }

  /**
   * @description Destroys a `value` amount of tokens from `account`, lowering the total supply.
   * Relies on the `_update` mechanism.
   * @param account The target owner of tokens to burn.
   * @param value The amount of tokens to burn.
   */
  public _burn(value: bigint): Uint8Array {
    return this.circuits.impure._burn(value);
  }

  public _burnFrom(fromAddress: Uint8Array, value: bigint): Uint8Array {
    return this.circuits.impure._burnFrom(fromAddress, value);
  }

  public clearMemos() {
    this.circuits.impure.clearMemos();
  }

  public register(): Uint8Array {
    return this.circuits.impure.register();
  }

  public isRegistered(account: Uint8Array): boolean {
    return this.circuits.impure.isRegistered(account);
  }

  /**
   * @description Computes an account identifier without on-chain state, allowing a user to derive
   * their identity commitment before submitting it in a grant or revoke operation.
   * @param {Bytes<32>} secretKey - A 32-byte cryptographically secure random value.
   * @returns {Bytes<32>} accountId - The computed account identifier.
   */
  public computeAccountId(secretKey: Uint8Array): Uint8Array {
    return this.circuits.pure.computeAccountId(secretKey);
  }

  public readonly privateState = {
    /**
     * @description Replaces SK in the private state. Used in tests to switch
     * between different user identities or inject incorrect keys to test
     * failure paths.
     */
    injectSecretKey: (
      newSK: Uint8Array,
    ): ConfidentialFungibleTokenPrivateState => {
      const current = this.getPrivateState();
      const updated = { ...current, secretKey: newSK };
      this.circuitContextManager.updatePrivateState(updated);
      return updated;
    },

    /**
     * @description Replaces EK in the private state. Used in tests to inject
     * a wrong EK and verify the decryption-consistency assertion catches it.
     */
    injectEncryptionKey: (
      newEK: Uint8Array,
    ): ConfidentialFungibleTokenPrivateState => {
      const current = this.getPrivateState();
      const updated = { ...current, encryptionKey: newEK };
      this.circuitContextManager.updatePrivateState(updated);
      return updated;
    },

    /**
     * @description Replaces SK, EK, and clears the plaintext cache atomically.
     * Used to switch between user identities mid-test (e.g., Alice -> Bob)
     * without leaving Alice's cached plaintexts in Bob's state.
     */
    switchIdentity: (
      newSK: Uint8Array,
      newEK: Uint8Array,
    ): ConfidentialFungibleTokenPrivateState => {
      const updated = {
        secretKey: newSK,
        encryptionKey: newEK,
        plaintextCache: new Map<string, bigint>(),
        randomnessSeed:
          this.getPrivateState().randomnessSeed ?? DEFAULT_RANDOMNESS_SEED,
      };
      this.circuitContextManager.updatePrivateState(updated);
      return updated;
    },

    /**
     * @description Sets the randomness seed returned by `wit_RandomnessSeed`.
     * Use to vary randomness between transactions (e.g. to avoid producing
     * identical ciphertexts when repeating the same operation).
     */
    setRandomnessSeed: (
      seed: Uint8Array,
    ): ConfidentialFungibleTokenPrivateState => {
      const updated = { ...this.getPrivateState(), randomnessSeed: seed };
      this.circuitContextManager.updatePrivateState(updated);
      return updated;
    },

    /**
     * @description Returns the current SK.
     */
    getCurrentSecretKey: (): Uint8Array => {
      const sk = this.getPrivateState().secretKey;
      if (typeof sk === 'undefined') {
        throw new Error('Missing secret key');
      }
      return sk;
    },

    /**
     * @description Returns the current EK.
     */
    getCurrentEncryptionKey: (): Uint8Array => {
      const ek = this.getPrivateState().encryptionKey;
      if (typeof ek === 'undefined') {
        throw new Error('Missing encryption key');
      }
      return ek;
    },

    /**
     * @description Records a known plaintext for a ciphertext in the wallet's
     * cache. Tests call this after any operation that changes a balance
     * ciphertext, since the wallet would normally do this automatically as
     * part of constructing the transaction.
     */
    cachePlaintext: (
      ct: ElGamal_Ciphertext,
      plaintext: bigint,
    ): ConfidentialFungibleTokenPrivateState => {
      const current = this.getPrivateState();
      const updated = ConfidentialFungibleTokenPrivateState.cachePlaintext(
        current,
        ct,
        plaintext,
      );
      this.circuitContextManager.updatePrivateState(updated);
      return updated;
    },

    /**
     * @description Looks up a cached plaintext by ciphertext. Returns
     * undefined if not cached.
     */
    lookupPlaintext: (ct: ElGamal_Ciphertext): bigint | undefined => {
      return ConfidentialFungibleTokenPrivateState.lookupPlaintext(
        this.getPrivateState(),
        ct,
      );
    },

    /**
     * @description Returns the entire plaintext cache. Useful for assertions
     * about cache contents in tests.
     */
    getCache: (): Map<string, bigint> => {
      return new Map(this.getPrivateState().plaintextCache);
    },

    /**
     * @description Clears the plaintext cache without changing SK/EK. Used in
     * tests that simulate cache loss while preserving identity.
     */
    clearCache: (): ConfidentialFungibleTokenPrivateState => {
      const current = this.getPrivateState();
      const updated = { ...current, plaintextCache: new Map<string, bigint>() };
      this.circuitContextManager.updatePrivateState(updated);
      return updated;
    },

    /**
     * @description Returns the accountId derived from the current SK. Wraps
     * the contract's pure `computeAccountId` for convenience in tests.
     */
    getCurrentAccountId: (): Uint8Array => {
      const sk = this.getPrivateState().secretKey;
      if (typeof sk === 'undefined') {
        throw new Error('Missing secret key');
      }
      return this.circuits.pure.computeAccountId(sk);
    },
  };
}
