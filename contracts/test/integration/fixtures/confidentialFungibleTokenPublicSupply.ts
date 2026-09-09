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
  type ElGamal_Ciphertext,
  ledger,
  Contract as MockConfidentialFungibleTokenPublicSupply,
  type Token_EscrowEntry,
} from '../../../artifacts/ComposedConfidentialFungibleTokenPublicSupply/contract/index.js';
import {
  ConfidentialFungibleTokenPrivateState,
  ConfidentialFungibleTokenWitnesses,
  DEFAULT_RANDOMNESS_SEED,
} from '../../../src/token/test/witnesses/ConfidentialFungibleTokenWitnesses.js';

/**
 * Integration fixture for the assembled ConfidentialFungibleToken + PublicSupply
 * contract
 * (`test/integration/_mocks/ComposedConfidentialFungibleTokenPublicSupply`).
 *
 * It reuses the base token's confidential-token witnesses and private state (SK,
 * EK, plaintext cache, randomness seed) verbatim — the assembled contract's
 * witness surface is exactly the base's — and adds the composed `mint`/`burn`/
 * `burnFrom` and the public `totalSupply` getter. The spec drives it to assert
 * that each supply-changing op moves `totalSupply` in lockstep with the value op.
 *
 * The shared spec helpers (test users, `deployCft`, `actAs`, `registerAs`,
 * `fundAs`) live at the bottom of this file, so every spec under
 * `specs/confidentialFungibleToken/` sets up identities the same way.
 */
type ConfidentialFungibleTokenPublicSupplyArgs = readonly [
  name: string,
  symbol: string,
  decimals: bigint,
];

const Base = createSimulator<
  ConfidentialFungibleTokenPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ConfidentialFungibleTokenWitnesses>,
  MockConfidentialFungibleTokenPublicSupply<ConfidentialFungibleTokenPrivateState>,
  ConfidentialFungibleTokenPublicSupplyArgs
>({
  contractFactory: (witnesses) =>
    new MockConfidentialFungibleTokenPublicSupply<ConfidentialFungibleTokenPrivateState>(
      witnesses,
    ),
  defaultPrivateState: () => ConfidentialFungibleTokenPrivateState.generate(),
  contractArgs: (name, symbol, decimals) => [name, symbol, decimals],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ConfidentialFungibleTokenWitnesses(),
  artifactName: 'ComposedConfidentialFungibleTokenPublicSupply',
});

export class ConfidentialFungibleTokenPublicSupplySimulator extends Base {
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

  /** @description The public circulating supply (disclosed on chain). */
  public totalSupply(): Promise<bigint> {
    return this.circuits.impure.totalSupply();
  }

  public register(): Promise<Uint8Array> {
    return this.circuits.impure.register();
  }

  public isRegistered(account: Uint8Array): Promise<boolean> {
    return this.circuits.impure.isRegistered(account);
  }

  /** @description Derives an accountId off-chain, without touching state. */
  public computeAccountId(secretKey: Uint8Array): Promise<Uint8Array> {
    return this.circuits.pure.computeAccountId(secretKey);
  }

  public sweep(): Promise<Uint8Array> {
    return this.circuits.impure.sweep();
  }

  public clearMemos(expectedEpoch: bigint): Promise<[]> {
    return this.circuits.impure.clearMemos(expectedEpoch);
  }

  public balanceOf(account: Uint8Array): Promise<ElGamal_Ciphertext> {
    return this.circuits.impure.balanceOf(account);
  }

  public pendingOf(account: Uint8Array): Promise<ElGamal_Ciphertext> {
    return this.circuits.impure.pendingOf(account);
  }

  public allowance(
    owner: Uint8Array,
    spender: Uint8Array,
  ): Promise<Token_EscrowEntry> {
    return this.circuits.impure.allowance(owner, spender);
  }

  public transfer(to: Uint8Array, value: bigint): Promise<Uint8Array> {
    return this.circuits.impure.transfer(to, value);
  }

  /** @description Debits the caller and credits `to`, net zero, supply untouched. */
  public _move(to: Uint8Array, value: bigint): Promise<Uint8Array> {
    return this.circuits.impure._move(to, value);
  }

  public approve(spender: Uint8Array, value: bigint): Promise<Uint8Array> {
    return this.circuits.impure.approve(spender, value);
  }

  public transferFrom(
    fromAddress: Uint8Array,
    to: Uint8Array,
    value: bigint,
  ): Promise<Uint8Array> {
    return this.circuits.impure.transferFrom(fromAddress, to, value);
  }

  /** @description Composed mint: bumps `totalSupply` by `value`, then credits `account`. */
  public mint(account: Uint8Array, value: bigint): Promise<[]> {
    return this.circuits.impure.mint(account, value);
  }

  /** @description Composed burn: debits the caller, then drops `totalSupply` by `value`. */
  public burn(value: bigint): Promise<Uint8Array> {
    return this.circuits.impure.burn(value);
  }

  /** @description Composed burnFrom: spends the caller's escrow, then drops `totalSupply`. */
  public burnFrom(fromAddress: Uint8Array, value: bigint): Promise<Uint8Array> {
    return this.circuits.impure.burnFrom(fromAddress, value);
  }

  public readonly privateState = {
    /**
     * @description Replaces SK, EK, and clears the plaintext cache atomically,
     * to switch between user identities mid-test.
     */
    switchIdentity: (
      newSK: Uint8Array,
      newEK: Uint8Array,
    ): Promise<ConfidentialFungibleTokenPrivateState> =>
      this.updatePrivateState((current) => ({
        secretKey: newSK,
        encryptionKey: newEK,
        plaintextCache: new Map<string, bigint>(),
        randomnessSeed: current.randomnessSeed ?? DEFAULT_RANDOMNESS_SEED,
      })),

    /**
     * @description Replaces EK alone, to check the decryption-consistency
     * assertion rejects a wallet whose key does not match the registered pk.
     */
    injectEncryptionKey: (
      newEK: Uint8Array,
    ): Promise<ConfidentialFungibleTokenPrivateState> =>
      this.updatePrivateState({ encryptionKey: newEK }),

    /**
     * @description Pins the seed `wit_RandomnessSeed` returns, so a repeated
     * operation produces a comparable ciphertext.
     */
    setRandomnessSeed: (
      seed: Uint8Array,
    ): Promise<ConfidentialFungibleTokenPrivateState> =>
      this.updatePrivateState({ randomnessSeed: seed }),

    /**
     * @description Records a known plaintext for a ciphertext in the wallet's
     * cache (what a real wallet does when it constructs or decrypts a value).
     */
    cachePlaintext: (
      ct: ElGamal_Ciphertext,
      plaintext: bigint,
    ): Promise<ConfidentialFungibleTokenPrivateState> =>
      this.updatePrivateState((current) =>
        ConfidentialFungibleTokenPrivateState.cachePlaintext(
          current,
          ct,
          plaintext,
        ),
      ),
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
