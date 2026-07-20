import {
  CompactTypeBytes,
  CompactTypeVector,
  ecMulGenerator,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  Contract as CFTPublicSupply,
  type ElGamal_Ciphertext,
  ledger,
  type Token_EscrowEntry,
} from '../../../artifacts/ConfidentialFungibleTokenPublicSupply/contract/index.js';
import {
  ConfidentialFungibleTokenPrivateState,
  ConfidentialFungibleTokenWitnesses,
  DEFAULT_RANDOMNESS_SEED,
} from '../../../src/token/test/witnesses/ConfidentialFungibleTokenWitnesses.js';

/**
 * Type constructor args
 */
type ConfidentialFungibleTokenArgs = readonly [
  name: string,
  symbol: string,
  decimals: bigint,
];

const ConfidentialFungibleTokenPublicSupplySimulatorBase = createSimulator<
  ConfidentialFungibleTokenPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ConfidentialFungibleTokenWitnesses>,
  CFTPublicSupply<ConfidentialFungibleTokenPrivateState>,
  ConfidentialFungibleTokenArgs
>({
  contractFactory: (witnesses) =>
    new CFTPublicSupply<ConfidentialFungibleTokenPrivateState>(witnesses),
  defaultPrivateState: () => ConfidentialFungibleTokenPrivateState.generate(),
  contractArgs: (name, symbol, decimals) => [name, symbol, decimals],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ConfidentialFungibleTokenWitnesses(),
  artifactName: 'ConfidentialFungibleTokenPublicSupply',
});

/**
 * Drives the ConfidentialFungibleTokenPublicSupply integration contract: the
 * production ConfidentialFungibleToken module composed with the
 * ConfidentialFungibleTokenSupply extension.
 */
export class ConfidentialFungibleTokenPublicSupplySimulator extends ConfidentialFungibleTokenPublicSupplySimulatorBase {
  static async create(
    name: string,
    symbol: string,
    decimals: bigint,
    options: SimulatorOptions<
      ConfidentialFungibleTokenPrivateState,
      ReturnType<typeof ConfidentialFungibleTokenWitnesses>
    > = {},
  ): Promise<ConfidentialFungibleTokenPublicSupplySimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [name, symbol, decimals],
      options,
    ) as Promise<ConfidentialFungibleTokenPublicSupplySimulator>;
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
  ): Promise<Token_EscrowEntry> {
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
   * @description Creates a `value` amount of tokens and credits them to
   * `account`, increasing the public total supply (the composed
   * `_addSupply` + `_mint` pairing).
   * @param account The recipient of tokens minted.
   * @param value The amount of tokens minted.
   */
  public mint(account: Uint8Array, value: bigint): Promise<[]> {
    return this.circuits.impure.mint(account, value);
  }

  /**
   * @description Destroys a `value` amount of tokens from the caller's balance,
   * lowering the public total supply (the composed `_burn` + `_subSupply`
   * pairing).
   * @param value The amount of tokens to burn.
   */
  public burn(value: bigint): Promise<Uint8Array> {
    return this.circuits.impure.burn(value);
  }

  public burnFrom(fromAddress: Uint8Array, value: bigint): Promise<Uint8Array> {
    return this.circuits.impure.burnFrom(fromAddress, value);
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

// ---------------------------------------------------------------------------
// Shared spec helpers (specs/confidentialFungibleToken)
// ---------------------------------------------------------------------------

const buildAccountIdHash = (sk: Uint8Array): Uint8Array => {
  const rt_type = new CompactTypeVector(1, new CompactTypeBytes(32));
  return persistentHash(rt_type, [sk]);
};

/**
 * @description The identity element on Jubjub, produced by ecMulGenerator(0).
 * Used as both c1 and c2 of Enc(0).
 */
export const identityPoint = () => ecMulGenerator(0n);

const createTestKey = (label: string): Uint8Array => {
  const key = new Uint8Array(32);
  const encoded = new TextEncoder().encode(label);
  key.set(encoded.slice(0, 32));
  return key;
};

export const makeUser = (label: string) => {
  const secretKey = createTestKey(`${label}_SK`);
  const encryptionKey = createTestKey(`${label}_EK`);
  const accountId = buildAccountIdHash(secretKey);
  return { secretKey, encryptionKey, accountId };
};

export type TestUser = ReturnType<typeof makeUser>;

// Users
export const ALICE = makeUser('ALICE');
export const BOB = makeUser('BOB');

// Token metadata
export const TOKEN_NAME = 'ConfidentialToken';
export const TOKEN_SYMBOL = 'CT';
export const TOKEN_DECIMALS = 6n;

/** Deploys a fresh composed token with the shared metadata. */
export function deployCft(): Promise<ConfidentialFungibleTokenPublicSupplySimulator> {
  return ConfidentialFungibleTokenPublicSupplySimulator.create(
    TOKEN_NAME,
    TOKEN_SYMBOL,
    TOKEN_DECIMALS,
  );
}

/** Switches the active identity to `user` (assumed already registered). */
export async function actAs(
  cft: ConfidentialFungibleTokenPublicSupplySimulator,
  user: TestUser,
): Promise<void> {
  await cft.privateState.switchIdentity(user.secretKey, user.encryptionKey);
}

/** Switches the active identity to `user` and registers their account. */
export async function registerAs(
  cft: ConfidentialFungibleTokenPublicSupplySimulator,
  user: TestUser,
): Promise<void> {
  await actAs(cft, user);
  await cft.register();
}

/**
 * Funds a FRESH account: as `user`, mints `amount` to self, sweeps it into
 * spendable, and caches the plaintext so a later debit's witness matches.
 * Only valid while the user's spendable balance is 0 (it caches `amount` as
 * the whole balance, not a running total).
 */
export async function fundAs(
  cft: ConfidentialFungibleTokenPublicSupplySimulator,
  user: TestUser,
  amount: bigint,
): Promise<void> {
  await actAs(cft, user);
  await cft.mint(user.accountId, amount);
  await cft.sweep();
  await cft.privateState.cachePlaintext(
    await cft.balanceOf(user.accountId),
    amount,
  );
}
