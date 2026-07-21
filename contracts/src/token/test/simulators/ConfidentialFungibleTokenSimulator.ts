import {
  createSimulator,
  type SimulatorOptions,
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
  artifactName: 'MockConfidentialFungibleToken',
});

/**
 * ConfidentialFungibleToken Simulator
 */
export class ConfidentialFungibleTokenSimulator extends ConfidentialFungibleTokenSimulatorBase {
  static async create(
    name: string,
    symbol: string,
    decimals: bigint,
    options: SimulatorOptions<
      ConfidentialFungibleTokenPrivateState,
      ReturnType<typeof ConfidentialFungibleTokenWitnesses>
    > = {},
  ): Promise<ConfidentialFungibleTokenSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [name, symbol, decimals],
      options,
    ) as Promise<ConfidentialFungibleTokenSimulator>;
  }
  /**
   * @description Returns the value of tokens owned by `account`.
   * @param account The public key or contract address to query.
   * @returns The account's token balance.
   */
  public balanceOf(account: Uint8Array): Promise<ElGamal_Ciphertext> {
    return this.circuits.impure.balanceOf(account);
  }

  /**
   * @description Returns the pending (incoming, not-yet-swept) balance ciphertext
   * for `account`. A wallet's total is `balanceOf` (spendable) + `pendingOf`.
   * @param account The account id to query.
   */
  public pendingOf(account: Uint8Array): Promise<ElGamal_Ciphertext> {
    return this.circuits.impure.pendingOf(account);
  }

  /**
   * @description Sweeps the caller's pending pool into their spendable balance.
   * Only the owner can call it (account derived from the caller's secret).
   */
  public sweep(): Promise<Uint8Array> {
    return this.circuits.impure.sweep();
  }

  /**
   * @description Returns the remaining number of tokens that `spender` will be allowed to spend on behalf of `owner`
   * through `transferFrom`. This value changes when `approve` or `transferFrom` are called.
   * @param owner The public key or contract address of approver.
   * @param spender The public key or contract address of spender.
   * @returns The `spender`'s allowance over `owner`'s tokens.
   */
  public allowance(
    owner: Uint8Array,
    spender: Uint8Array,
  ): Promise<CFT_EscrowEntry> {
    return this.circuits.impure.allowance(owner, spender);
  }

  /**
   * @description Moves a `value` amount of tokens from the caller's account to `to`.
   * Reverts on failure (no boolean return).
   * @param to The recipient account id.
   * @param value The amount to transfer.
   */
  public transfer(to: Uint8Array, value: bigint): Promise<Uint8Array> {
    return this.circuits.impure.transfer(to, value);
  }

  /**
   * @description The conserving value-movement primitive: debits the caller and
   * credits `to`, net zero, never touching supply.
   */
  public _move(to: Uint8Array, value: bigint): Promise<Uint8Array> {
    return this.circuits.impure._move(to, value);
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
  ): Promise<Uint8Array> {
    return this.circuits.impure.transferFrom(fromAddress, to, value);
  }

  /**
   * @description Sets `value` as the escrow allowance of `spender` over the
   * caller's balance. Reverts on failure (no boolean return).
   * @param spender The account id that may spend on behalf of the caller.
   * @param value The amount the `spender` may spend.
   */
  public approve(spender: Uint8Array, value: bigint): Promise<Uint8Array> {
    return this.circuits.impure.approve(spender, value);
  }

  /**
   * @description Test-only funding: mints `value` to `account` via the base's
   * exposed `_mint` building block (a raw credit, no supply bookkeeping). Lands
   * in the recipient's pending pool, so sweep before spending. The supply-free
   * base suite funds accounts with this.
   * @param account The recipient account id.
   * @param value The amount to mint.
   */
  public _mint(account: Uint8Array, value: bigint): Promise<[]> {
    return this.circuits.impure._mint(account, value);
  }

  /**
   * @description Test-only balance proof / drain: burns `value` from the
   * caller's spendable balance via the base's `_burn` building block. Its
   * in-circuit assertDecryptsTo only passes if the balance truly encrypts
   * >= value, so it doubles as the behavioural "holds at least N" check the
   * supply-free suite uses.
   * @param value The amount to burn.
   */
  public _burn(value: bigint): Promise<Uint8Array> {
    return this.circuits.impure._burn(value);
  }

  /**
   * @description Test-only escrow-burn: consumes `value` from the allowance
   * `fromAddress` granted the caller, with no recipient credit (the base's
   * `_spendEscrow` under its burn-intent name). Its in-circuit checks only pass
   * if a sufficient escrow exists, so it doubles as the behavioural allowance check.
   * @param fromAddress The owner whose escrow the caller (spender) draws on.
   * @param value The amount to burn from the allowance.
   */
  public _burnFrom(
    fromAddress: Uint8Array,
    value: bigint,
  ): Promise<Uint8Array> {
    return this.circuits.impure._burnFrom(fromAddress, value);
  }

  public clearMemos() {
    return this.circuits.impure.clearMemos();
  }

  public register(): Promise<Uint8Array> {
    return this.circuits.impure.register();
  }

  public isRegistered(account: Uint8Array): Promise<boolean> {
    return this.circuits.impure.isRegistered(account);
  }

  /**
   * @description Computes an account identifier without on-chain state, allowing a user to derive
   * their identity commitment before submitting it in a grant or revoke operation.
   * @param {Bytes<32>} secretKey - A 32-byte cryptographically secure random value.
   * @returns {Bytes<32>} accountId - The computed account identifier.
   */
  public computeAccountId(secretKey: Uint8Array): Promise<Uint8Array> {
    return this.circuits.pure.computeAccountId(secretKey);
  }

  public readonly privateState = {
    /**
     * @description Replaces SK in the private state. Used in tests to switch
     * between different user identities or inject incorrect keys to test
     * failure paths.
     */
    injectSecretKey: async (
      newSK: Uint8Array,
    ): Promise<ConfidentialFungibleTokenPrivateState> => {
      const current = await this.getPrivateState();
      const updated = { ...current, secretKey: newSK };
      this.setPrivateState(updated);
      return updated;
    },

    /**
     * @description Replaces EK in the private state. Used in tests to inject
     * a wrong EK and verify the decryption-consistency assertion catches it.
     */
    injectEncryptionKey: async (
      newEK: Uint8Array,
    ): Promise<ConfidentialFungibleTokenPrivateState> => {
      const current = await this.getPrivateState();
      const updated = { ...current, encryptionKey: newEK };
      this.setPrivateState(updated);
      return updated;
    },

    /**
     * @description Replaces SK, EK, and clears the plaintext cache atomically.
     * Used to switch between user identities mid-test (e.g., Alice -> Bob)
     * without leaving Alice's cached plaintexts in Bob's state.
     */
    switchIdentity: async (
      newSK: Uint8Array,
      newEK: Uint8Array,
    ): Promise<ConfidentialFungibleTokenPrivateState> => {
      const updated = {
        secretKey: newSK,
        encryptionKey: newEK,
        plaintextCache: new Map<string, bigint>(),
        randomnessSeed:
          (await this.getPrivateState()).randomnessSeed ??
          DEFAULT_RANDOMNESS_SEED,
      };
      this.setPrivateState(updated);
      return updated;
    },

    /**
     * @description Sets the randomness seed returned by `wit_RandomnessSeed`.
     * Use to vary randomness between transactions (e.g. to avoid producing
     * identical ciphertexts when repeating the same operation).
     */
    setRandomnessSeed: async (
      seed: Uint8Array,
    ): Promise<ConfidentialFungibleTokenPrivateState> => {
      const updated = {
        ...(await this.getPrivateState()),
        randomnessSeed: seed,
      };
      this.setPrivateState(updated);
      return updated;
    },

    /**
     * @description Returns the current SK.
     */
    getCurrentSecretKey: async (): Promise<Uint8Array> => {
      const sk = (await this.getPrivateState()).secretKey;
      if (typeof sk === 'undefined') {
        throw new Error('Missing secret key');
      }
      return sk;
    },

    /**
     * @description Returns the current EK.
     */
    getCurrentEncryptionKey: async (): Promise<Uint8Array> => {
      const ek = (await this.getPrivateState()).encryptionKey;
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
    cachePlaintext: async (
      ct: ElGamal_Ciphertext,
      plaintext: bigint,
    ): Promise<ConfidentialFungibleTokenPrivateState> => {
      const current = await this.getPrivateState();
      const updated = ConfidentialFungibleTokenPrivateState.cachePlaintext(
        current,
        ct,
        plaintext,
      );
      this.setPrivateState(updated);
      return updated;
    },

    /**
     * @description Looks up a cached plaintext by ciphertext. Returns
     * undefined if not cached.
     */
    lookupPlaintext: async (
      ct: ElGamal_Ciphertext,
    ): Promise<bigint | undefined> => {
      return ConfidentialFungibleTokenPrivateState.lookupPlaintext(
        await this.getPrivateState(),
        ct,
      );
    },

    /**
     * @description Returns the entire plaintext cache. Useful for assertions
     * about cache contents in tests.
     */
    getCache: async (): Promise<Map<string, bigint>> => {
      return new Map((await this.getPrivateState()).plaintextCache);
    },

    /**
     * @description Clears the plaintext cache without changing SK/EK. Used in
     * tests that simulate cache loss while preserving identity.
     */
    clearCache: async (): Promise<ConfidentialFungibleTokenPrivateState> => {
      const current = await this.getPrivateState();
      const updated = { ...current, plaintextCache: new Map<string, bigint>() };
      this.setPrivateState(updated);
      return updated;
    },

    /**
     * @description Returns the accountId derived from the current SK. Wraps
     * the contract's pure `computeAccountId` for convenience in tests.
     */
    getCurrentAccountId: async (): Promise<Uint8Array> => {
      const sk = (await this.getPrivateState()).secretKey;
      if (typeof sk === 'undefined') {
        throw new Error('Missing secret key');
      }
      return this.circuits.pure.computeAccountId(sk);
    },
  };
}
