import {
  CompactTypeBytes,
  CompactTypeVector,
  convertBytesToField,
  ecMulGenerator,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
// The ElGamal pure circuits double as an off-circuit "mirror" — they let a test
// predict a ciphertext the contract will produce internally (e.g. the
// post-refund balance in `approve`) so its plaintext can be cached ahead of the
// witness query. They are pure (no proof), so this is cheap.
import { pureCircuits as elgamal } from '../../../artifacts/MockElGamal/contract/index.js';
import { ConfidentialFungibleTokenSimulator } from './simulators/ConfidentialFungibleTokenSimulator.js';
import { DEFAULT_RANDOMNESS_SEED } from './witnesses/ConfidentialFungibleTokenWitnesses.js';

// Mirrors Compact's `pad(32, s)`: UTF-8 bytes of `s`, zero-padded to 32 bytes.
const padTag = (s: string): Uint8Array => {
  const b = new Uint8Array(32);
  b.set(new TextEncoder().encode(s));
  return b;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * @description Derives the expected pk for a given EK, mirroring the
 * in-circuit `_derivePk`:
 *   pk = ecMulGenerator(degradeToTransient(persistentHash([ek])))
 *
 * The `convertBytesToField` call mirrors `degradeToTransient`, producing the
 * field element that `ecMulGenerator` expects.
 *
 * @note tThe field-element derivation from EK uses 31 bytes of the hash output
 * (empirically determined); the effective collision resistance is therefore 248 bits.
 */
const derivePk = (ek: Uint8Array) => {
  const rt_type = new CompactTypeVector(1, new CompactTypeBytes(32));
  const ekHash = persistentHash(rt_type, [ek]);
  const ekField = convertBytesToField(31, ekHash, 'derivePk');
  return ecMulGenerator(ekField);
};

const buildAccountIdHash = (sk: Uint8Array): Uint8Array => {
  const rt_type = new CompactTypeVector(1, new CompactTypeBytes(32));
  return persistentHash(rt_type, [sk]);
};

/**
 * @description The identity element on Jubjub, produced by ecMulGenerator(0).
 * Used as both c1 and c2 of Enc(0).
 */
const identityPoint = () => ecMulGenerator(0n);

const createTestKey = (label: string): Uint8Array => {
  const key = new Uint8Array(32);
  const encoded = new TextEncoder().encode(label);
  key.set(encoded.slice(0, 32));
  return key;
};

const makeUser = (label: string) => {
  const secretKey = createTestKey(`${label}_SK`);
  const encryptionKey = createTestKey(`${label}_EK`);
  const accountId = buildAccountIdHash(secretKey);
  return { secretKey, encryptionKey, accountId };
};

// Users
const ALICE = makeUser('ALICE');
const BOB = makeUser('BOB');
const CHARLIE = makeUser('CHARLIE');

// Token metadata
const NAME = 'ConfidentialToken';
const SYMBOL = 'CT';
const DECIMALS = 6n;

let cft: ConfidentialFungibleTokenSimulator;

describe('ConfidentialFungibleToken: registration', () => {
  beforeEach(() => {
    cft = new ConfidentialFungibleTokenSimulator(NAME, SYMBOL, DECIMALS);
  });

  describe('register', () => {
    it('should register a fresh account', () => {
      cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);

      expect(cft.isRegistered(ALICE.accountId)).toBe(false);

      cft.register();

      expect(cft.isRegistered(ALICE.accountId)).toBe(true);
    });

    it('should fail when re-registering the same account', () => {
      cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
      cft.register();

      expect(() => cft.register()).toThrow(
        'ConfidentialFungibleToken: already registered',
      );
    });

    it('should allow distinct users to register independently', () => {
      cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
      cft.register();

      cft.privateState.switchIdentity(BOB.secretKey, BOB.encryptionKey);
      cft.register();

      cft.privateState.switchIdentity(CHARLIE.secretKey, CHARLIE.encryptionKey);
      cft.register();

      expect(cft.isRegistered(ALICE.accountId)).toBe(true);
      expect(cft.isRegistered(BOB.accountId)).toBe(true);
      expect(cft.isRegistered(CHARLIE.accountId)).toBe(true);
    });

    it('should store the expected pk for the registered EK', () => {
      cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
      cft.register();

      const ledger = cft.getPublicState();
      const storedPk = ledger.CFT__encryptionKeys.lookup(ALICE.accountId);
      const expectedPk = derivePk(ALICE.encryptionKey);

      expect(storedPk).toEqual(expectedPk);
    });

    it('should store distinct pks for distinct EKs', () => {
      cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
      cft.register();

      cft.privateState.switchIdentity(BOB.secretKey, BOB.encryptionKey);
      cft.register();

      const ledger = cft.getPublicState();
      const alicePk = ledger.CFT__encryptionKeys.lookup(ALICE.accountId);
      const bobPk = ledger.CFT__encryptionKeys.lookup(BOB.accountId);

      expect(alicePk).not.toEqual(bobPk);
    });

    it('should initialize the balance to Enc(0)', () => {
      cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
      cft.register();

      const balance = cft.balanceOf(ALICE.accountId);
      const identity = identityPoint();

      expect(balance.c1).toEqual(identity);
      expect(balance.c2).toEqual(identity);
    });

    it('should leave totalSupply at zero after registration', () => {
      cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
      cft.register();

      expect(cft.totalSupply()).toBe(0n);
    });

    it('should fail to transfer from an unregistered account', () => {
      // Registration is a prerequisite for transfer. _debit asserts the
      // sender is registered.
      cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);

      expect(() => cft.transfer(BOB.accountId, 100n)).toThrow();
    });

    it('should fail to transfer to an unregistered account', () => {
      // Alice registers, Bob doesn't. Alice tries to transfer to Bob.
      cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
      cft.register();

      expect(() => cft.transfer(BOB.accountId, 100n)).toThrow();
    });
  });

  describe('isRegistered', () => {
    it('should return false for an unregistered account', () => {
      expect(cft.isRegistered(ALICE.accountId)).toBe(false);
    });

    it('should return true after registration', () => {
      cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
      cft.register();

      expect(cft.isRegistered(ALICE.accountId)).toBe(true);
    });

    it('should return false for an account that has not registered, even when others have', () => {
      cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
      cft.register();

      expect(cft.isRegistered(BOB.accountId)).toBe(false);
    });
  });

  describe('computeAccountId', () => {
    it('should match the test helper derivation', () => {
      const users = [ALICE, BOB, CHARLIE];

      for (const user of users) {
        expect(cft.computeAccountId(user.secretKey)).toEqual(user.accountId);
      }
    });

    it('should produce distinct identifiers for distinct keys', () => {
      const users = [ALICE, BOB, CHARLIE];
      const ids = users.map((u) => cft.computeAccountId(u.secretKey));

      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          expect(ids[i]).not.toEqual(ids[j]);
        }
      }
    });

    it('should be deterministic for the same secret key', () => {
      const id1 = cft.computeAccountId(ALICE.secretKey);
      const id2 = cft.computeAccountId(ALICE.secretKey);

      expect(id1).toEqual(id2);
    });
  });

  describe('mint and burn', () => {
    // Note: _mint and _burn are intended to be called from privileged contract
    // contexts (e.g., gated by an Ownable or AccessControl companion module).
    // In these unit tests, we don't model that gating — we call them directly
    // and treat the active identity as both "the minter" and "the account
    // being minted to." This keeps the cache updates straightforward, since
    // the test identity is the one whose plaintext-cache the witness reads.

    describe('_mint', () => {
      it('should credit the recipient and increase totalSupply', () => {
        cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
        cft.register();

        cft._mint(ALICE.accountId, 100n);
        expect(cft.totalSupply()).toBe(100n);

        // Alice's balance ciphertext should no longer be Enc(0).
        const balance = cft.balanceOf(ALICE.accountId);
        const identity = identityPoint();
        expect(balance.c1).not.toEqual(identity);
        expect(balance.c2).not.toEqual(identity);
      });

      it('should accumulate across multiple mints', () => {
        cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
        cft.register();

        cft._mint(ALICE.accountId, 100n);

        // Cache the post-mint plaintext so the next _mint's _credit can
        // verify (note: _credit itself doesn't decrypt; it only adds. But
        // any subsequent _burn or transfer would need this.)
        let aliceBalance = cft.balanceOf(ALICE.accountId);
        cft.privateState.cachePlaintext(aliceBalance, 100n);

        cft._mint(ALICE.accountId, 50n);

        expect(cft.totalSupply()).toBe(150n);

        // After the second mint, the cache entry for the old ciphertext is
        // stale; cache the new one.
        aliceBalance = cft.balanceOf(ALICE.accountId);
        cft.privateState.cachePlaintext(aliceBalance, 150n);

        // Verify Alice can spend her accumulated balance.
        cft._burn(150n);
        expect(cft.totalSupply()).toBe(0n);
      });

      it('should mint to a different account than the caller', () => {
        // Register Alice and Bob; Alice mints to Bob.
        cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
        cft.register();

        cft.privateState.switchIdentity(BOB.secretKey, BOB.encryptionKey);
        cft.register();

        // Switch back to Alice and mint to Bob.
        cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
        cft._mint(BOB.accountId, 100n);

        expect(cft.totalSupply()).toBe(100n);

        const bobBalance = cft.balanceOf(BOB.accountId);
        const identity = identityPoint();
        expect(bobBalance.c1).not.toEqual(identity);
        expect(bobBalance.c2).not.toEqual(identity);
      });

      it('should push a memo to the recipient on mint', () => {
        cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
        cft.register();

        cft._mint(ALICE.accountId, 100n);

        const ledger = cft.getPublicState();
        const aliceMemos = ledger.CFT__memos.lookup(ALICE.accountId);
        // Expect exactly one memo entry after one mint.
        expect(aliceMemos.length()).toBe(1n);
      });

      it('should fail to mint to an unregistered account', () => {
        cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
        // Alice does not register.

        expect(() => cft._mint(ALICE.accountId, 100n)).toThrow();
      });

      it('should fail when value exceeds MAX_TRANSFER_VALUE', () => {
        cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
        cft.register();

        const overBound = (1n << 48n) + 1n;
        expect(() => cft._mint(ALICE.accountId, overBound)).toThrow(
          'ConfidentialFungibleToken: value exceeds bound',
        );
      });

      it('should treat a zero-value mint as a no-op (no semantic restriction)', () => {
        // The module does not prohibit value=0; _mint(account, 0) credits 0
        // and increments totalSupply by 0 (both no-ops). Documented explicitly.
        cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
        cft.register();

        expect(() => cft._mint(ALICE.accountId, 0n)).not.toThrow();
        expect(cft.totalSupply()).toBe(0n);
      });
    });

    describe('_burn', () => {
      it('should debit the caller and decrease totalSupply', () => {
        cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
        cft.register();

        cft._mint(ALICE.accountId, 100n);
        const aliceBalance = cft.balanceOf(ALICE.accountId);
        cft.privateState.cachePlaintext(aliceBalance, 100n);

        cft._burn(40n);

        expect(cft.totalSupply()).toBe(60n);
      });

      it('should allow burning the entire balance', () => {
        cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
        cft.register();

        cft._mint(ALICE.accountId, 100n);
        let aliceBalance = cft.balanceOf(ALICE.accountId);
        cft.privateState.cachePlaintext(aliceBalance, 100n);

        cft._burn(100n);

        expect(cft.totalSupply()).toBe(0n);

        // The balance now encrypts 0, but it is NOT the identity ciphertext:
        // subEncrypted re-randomizes, so Enc(0) here has non-trivial c1/c2.
        // Verify the balance is treated as 0 by showing a further burn of 1
        // fails for insufficient balance.
        aliceBalance = cft.balanceOf(ALICE.accountId);
        cft.privateState.cachePlaintext(aliceBalance, 0n);
        expect(() => cft._burn(1n)).toThrow(
          'ConfidentialFungibleToken: insufficient balance',
        );
      });

      it('should fail to burn more than the balance', () => {
        cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
        cft.register();

        cft._mint(ALICE.accountId, 100n);
        const aliceBalance = cft.balanceOf(ALICE.accountId);
        cft.privateState.cachePlaintext(aliceBalance, 100n);

        expect(() => cft._burn(101n)).toThrow(
          'ConfidentialFungibleToken: insufficient balance',
        );
      });

      it('should fail to burn from an unregistered account', () => {
        cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
        // Alice does not register.

        expect(() => cft._burn(50n)).toThrow();
      });

      it('should fail when value exceeds MAX_TRANSFER_VALUE', () => {
        cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
        cft.register();

        const overBound = (1n << 48n) + 1n;
        expect(() => cft._burn(overBound)).toThrow(
          'ConfidentialFungibleToken: value exceeds bound',
        );
      });

      it('should fail with a hostile plaintext witness', () => {
        cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
        cft.register();

        cft._mint(ALICE.accountId, 100n);
        const aliceBalance = cft.balanceOf(ALICE.accountId);

        // Cache the WRONG plaintext: claim Alice has 1000 when she has 100.
        // ElGamal_assertDecryptsTo (via _debit) should reject this.
        cft.privateState.cachePlaintext(aliceBalance, 1000n);

        expect(() => cft._burn(50n)).toThrow('ElGamal: plaintext mismatch');
      });
    });

    describe('totalSupply tracking across operations', () => {
      it('should reflect cumulative mints and burns', () => {
        cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
        cft.register();

        cft._mint(ALICE.accountId, 1000n);
        expect(cft.totalSupply()).toBe(1000n);

        let aliceBalance = cft.balanceOf(ALICE.accountId);
        cft.privateState.cachePlaintext(aliceBalance, 1000n);

        cft._burn(300n);
        expect(cft.totalSupply()).toBe(700n);

        aliceBalance = cft.balanceOf(ALICE.accountId);
        cft.privateState.cachePlaintext(aliceBalance, 700n);

        cft._mint(ALICE.accountId, 200n);
        expect(cft.totalSupply()).toBe(900n);

        aliceBalance = cft.balanceOf(ALICE.accountId);
        cft.privateState.cachePlaintext(aliceBalance, 900n);

        cft._burn(900n);
        expect(cft.totalSupply()).toBe(0n);
      });
    });
  });
});

// ---------------------------------------------------------------------------
// Transfers
//
// Confidential balances can't be read directly, so "X holds exactly N" is
// proven behaviorally: cache N for the balance and burn N. The burn's
// in-circuit `ElGamal_assertDecryptsTo` only passes if the balance truly
// encrypts N, and the totalSupply delta confirms the amount.
// ---------------------------------------------------------------------------

describe('ConfidentialFungibleToken: transfer', () => {
  beforeEach(() => {
    cft = new ConfidentialFungibleTokenSimulator(NAME, SYMBOL, DECIMALS);
  });

  const registerAll = () => {
    for (const u of [ALICE, BOB, CHARLIE]) {
      cft.privateState.switchIdentity(u.secretKey, u.encryptionKey);
      cft.register();
    }
  };

  // Registers everyone, mints `amount` to Alice, and leaves Alice active with
  // her balance cached.
  const fundAlice = (amount: bigint) => {
    registerAll();
    cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
    cft._mint(ALICE.accountId, amount);
    cft.privateState.cachePlaintext(cft.balanceOf(ALICE.accountId), amount);
  };

  it('moves value from sender to recipient and leaves supply unchanged', () => {
    fundAlice(100n);

    cft.transfer(BOB.accountId, 30n);
    expect(cft.totalSupply()).toBe(100n);

    // Alice holds exactly 70.
    cft.privateState.cachePlaintext(cft.balanceOf(ALICE.accountId), 70n);
    cft._burn(70n);
    expect(cft.totalSupply()).toBe(30n);

    // Bob holds exactly 30.
    cft.privateState.switchIdentity(BOB.secretKey, BOB.encryptionKey);
    cft.privateState.cachePlaintext(cft.balanceOf(BOB.accountId), 30n);
    cft._burn(30n);
    expect(cft.totalSupply()).toBe(0n);
  });

  it('rejects a self-transfer', () => {
    fundAlice(100n);
    expect(() => cft.transfer(ALICE.accountId, 10n)).toThrow(
      'ConfidentialFungibleToken: self-transfer',
    );
  });

  it('rejects a transfer exceeding the balance', () => {
    fundAlice(100n);
    expect(() => cft.transfer(BOB.accountId, 101n)).toThrow(
      'ConfidentialFungibleToken: insufficient balance',
    );
  });

  it('rejects a transfer above MAX_TRANSFER_VALUE', () => {
    fundAlice(100n);
    expect(() => cft.transfer(BOB.accountId, (1n << 48n) + 1n)).toThrow(
      'ConfidentialFungibleToken: value exceeds bound',
    );
  });
});

// ---------------------------------------------------------------------------
// Escrow allowances: approve / transferFrom / burnFrom
// ---------------------------------------------------------------------------

describe('ConfidentialFungibleToken: escrow allowance', () => {
  beforeEach(() => {
    cft = new ConfidentialFungibleTokenSimulator(NAME, SYMBOL, DECIMALS);
  });

  const registerAll = () => {
    for (const u of [ALICE, BOB, CHARLIE]) {
      cft.privateState.switchIdentity(u.secretKey, u.encryptionKey);
      cft.register();
    }
  };

  // Alice (owner) funds with `amount` and approves Bob (spender) for `cap`.
  // Leaves Alice active.
  const approveBob = (amount: bigint, cap: bigint) => {
    registerAll();
    cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
    cft._mint(ALICE.accountId, amount);
    cft.privateState.cachePlaintext(cft.balanceOf(ALICE.accountId), amount);
    cft.approve(BOB.accountId, cap);
  };

  it('records an allowance and debits the owner balance', () => {
    approveBob(100n, 40n);

    // An escrow entry now exists for (Alice, Bob).
    const ledger = cft.getPublicState();
    expect(
      ledger.CFT__escrow.lookup(ALICE.accountId).member(BOB.accountId),
    ).toBe(true);

    // Alice's main balance was debited by the cap: she now holds 60.
    cft.privateState.cachePlaintext(cft.balanceOf(ALICE.accountId), 60n);
    cft._burn(60n);
    expect(cft.totalSupply()).toBe(40n);
  });

  it('lets the spender transferFrom up to the allowance', () => {
    approveBob(100n, 40n);

    // Bob decrypts his escrow copy (value 40) and caches it, then spends 25
    // to Charlie.
    cft.privateState.switchIdentity(BOB.secretKey, BOB.encryptionKey);
    const escrow = cft.allowance(ALICE.accountId, BOB.accountId);
    cft.privateState.cachePlaintext(escrow.spenderCt, 40n);

    cft.transferFrom(ALICE.accountId, CHARLIE.accountId, 25n);
    expect(cft.totalSupply()).toBe(100n);

    // Charlie holds exactly 25.
    cft.privateState.switchIdentity(CHARLIE.secretKey, CHARLIE.encryptionKey);
    cft.privateState.cachePlaintext(cft.balanceOf(CHARLIE.accountId), 25n);
    cft._burn(25n);
    expect(cft.totalSupply()).toBe(75n);
  });

  it('rejects transferFrom with no escrow', () => {
    registerAll();
    // Bob never received an approval from Alice.
    cft.privateState.switchIdentity(BOB.secretKey, BOB.encryptionKey);
    expect(() =>
      cft.transferFrom(ALICE.accountId, CHARLIE.accountId, 10n),
    ).toThrow('ConfidentialFungibleToken: no escrow');
  });

  it('rejects transferFrom exceeding the allowance', () => {
    approveBob(100n, 40n);

    cft.privateState.switchIdentity(BOB.secretKey, BOB.encryptionKey);
    const escrow = cft.allowance(ALICE.accountId, BOB.accountId);
    cft.privateState.cachePlaintext(escrow.spenderCt, 40n);

    expect(() =>
      cft.transferFrom(ALICE.accountId, CHARLIE.accountId, 41n),
    ).toThrow('ConfidentialFungibleToken: insufficient allowance');
  });

  it('burnFrom consumes the allowance and lowers supply', () => {
    approveBob(100n, 40n);

    cft.privateState.switchIdentity(BOB.secretKey, BOB.encryptionKey);
    const escrow = cft.allowance(ALICE.accountId, BOB.accountId);
    cft.privateState.cachePlaintext(escrow.spenderCt, 40n);

    cft._burnFrom(ALICE.accountId, 25n);
    // Owner balance (60) untouched; only the escrowed amount is burned.
    expect(cft.totalSupply()).toBe(75n);
  });

  it('rejects a self-approval', () => {
    registerAll();
    cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
    expect(() => cft.approve(ALICE.accountId, 10n)).toThrow(
      'ConfidentialFungibleToken: self-approval',
    );
  });

  it('rejects approving an unregistered spender', () => {
    cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
    cft.register();
    // Bob is not registered.
    expect(() => cft.approve(BOB.accountId, 10n)).toThrow(
      'ConfidentialFungibleToken: spender not registered',
    );
  });

  it('rejects approving the zero account', () => {
    cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
    cft.register();
    expect(() => cft.approve(new Uint8Array(32), 10n)).toThrow(
      'ConfidentialFungibleToken: invalid spender',
    );
  });

  it('rejects approve above MAX_TRANSFER_VALUE', () => {
    approveBob(100n, 40n); // registers all + leaves Alice active with cache
    expect(() => cft.approve(BOB.accountId, (1n << 48n) + 1n)).toThrow(
      'ConfidentialFungibleToken: value exceeds bound',
    );
  });

  it('rejects transferFrom to the zero account', () => {
    approveBob(100n, 40n);
    cft.privateState.switchIdentity(BOB.secretKey, BOB.encryptionKey);
    cft.privateState.cachePlaintext(
      cft.allowance(ALICE.accountId, BOB.accountId).spenderCt,
      40n,
    );
    expect(() =>
      cft.transferFrom(ALICE.accountId, new Uint8Array(32), 10n),
    ).toThrow('ConfidentialFungibleToken: invalid receiver');
  });

  it('re-approve refunds the prior escrow to the owner before setting the new cap', () => {
    // _refundPriorEscrow is the one flow that re-queries a ciphertext the same
    // circuit just produced (the post-refund main balance). We predict that
    // ciphertext via the ElGamal pure circuits and cache its plaintext before
    // the second approve queries it.
    registerAll();
    cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
    cft._mint(ALICE.accountId, 100n);
    cft.privateState.cachePlaintext(cft.balanceOf(ALICE.accountId), 100n);

    // First approve: 40 to Bob. Alice's main balance 100 -> 60.
    cft.approve(BOB.accountId, 40n);

    // Caches the second approve's refund path needs:
    const ownerPk = cft
      .getPublicState()
      .CFT__encryptionKeys.lookup(ALICE.accountId);
    // (a) the owner's escrow copy, decrypted by _refundPriorEscrow.
    cft.privateState.cachePlaintext(
      cft.allowance(ALICE.accountId, BOB.accountId).ownerCt,
      40n,
    );
    // (b) the post-refund main balance: addEncrypted(Enc(60), pk, 40, r) = Enc(100),
    //     where r is the "refund_balance"-tagged expansion of the fixed seed.
    const r = elgamal.expandRandomness(
      DEFAULT_RANDOMNESS_SEED,
      padTag('refund_balance'),
    );
    const refunded = elgamal.addEncrypted(
      cft.balanceOf(ALICE.accountId),
      ownerPk,
      40n,
      r,
    );
    cft.privateState.cachePlaintext(refunded, 100n);

    // Second approve: 30 to Bob. Refund 40 (main 60 -> 100), then debit 30 (-> 70).
    cft.approve(BOB.accountId, 30n);

    // Refund proof: Alice holds 70 (= 100 - 30), NOT 30 (= 100 - 40 - 30 without
    // the refund). Caching 70 and burning it only succeeds if the balance truly
    // decrypts to 70.
    cft.privateState.cachePlaintext(cft.balanceOf(ALICE.accountId), 70n);
    expect(() => cft._burn(71n)).toThrow(
      'ConfidentialFungibleToken: insufficient balance',
    );
    cft._burn(70n);
    expect(cft.totalSupply()).toBe(30n);
  });
});

// ---------------------------------------------------------------------------
// Metadata & default views
// ---------------------------------------------------------------------------

describe('ConfidentialFungibleToken: metadata & views', () => {
  beforeEach(() => {
    cft = new ConfidentialFungibleTokenSimulator(NAME, SYMBOL, DECIMALS);
  });

  it('exposes the constructor metadata', () => {
    expect(cft.name()).toBe(NAME);
    expect(cft.symbol()).toBe(SYMBOL);
    expect(cft.decimals()).toBe(DECIMALS);
  });

  it('balanceOf returns the default ciphertext for an unregistered account', () => {
    // Sentinel value (no entry); identical for any unregistered account.
    expect(cft.balanceOf(ALICE.accountId)).toEqual(
      cft.balanceOf(BOB.accountId),
    );
  });

  it('allowance returns the default entry when no escrow exists', () => {
    expect(cft.allowance(ALICE.accountId, BOB.accountId)).toEqual(
      cft.allowance(BOB.accountId, CHARLIE.accountId),
    );
  });
});

// ---------------------------------------------------------------------------
// Memos
// ---------------------------------------------------------------------------

describe('ConfidentialFungibleToken: memos', () => {
  beforeEach(() => {
    cft = new ConfidentialFungibleTokenSimulator(NAME, SYMBOL, DECIMALS);
  });

  it('pushes one memo per credit', () => {
    cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
    cft.register();

    cft._mint(ALICE.accountId, 10n);
    cft._mint(ALICE.accountId, 20n);

    const memos = cft.getPublicState().CFT__memos.lookup(ALICE.accountId);
    expect(memos.length()).toBe(2n);
  });

  it('clearMemos empties the caller’s memo list', () => {
    cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
    cft.register();
    cft._mint(ALICE.accountId, 10n);
    expect(
      cft.getPublicState().CFT__memos.lookup(ALICE.accountId).length(),
    ).toBe(1n);

    cft.clearMemos();

    expect(
      cft.getPublicState().CFT__memos.lookup(ALICE.accountId).length(),
    ).toBe(0n);
  });
});

// ---------------------------------------------------------------------------
// Per-operation value bound (boundary)
// ---------------------------------------------------------------------------

describe('ConfidentialFungibleToken: value bound', () => {
  beforeEach(() => {
    cft = new ConfidentialFungibleTokenSimulator(NAME, SYMBOL, DECIMALS);
  });

  it('accepts a value exactly at MAX_TRANSFER_VALUE (2^48 - 1)', () => {
    const MAX = (1n << 48n) - 1n;
    cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
    cft.register();

    cft._mint(ALICE.accountId, MAX);
    expect(cft.totalSupply()).toBe(MAX);
  });

  it('rejects 2^48 (one above the bound; undecodable by the wallet table)', () => {
    cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
    cft.register();

    expect(() => cft._mint(ALICE.accountId, 1n << 48n)).toThrow(
      'ConfidentialFungibleToken: value exceeds bound',
    );
  });
});
