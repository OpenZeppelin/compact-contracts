import {
  CompactTypeBytes,
  CompactTypeVector,
  convertBytesToField,
  ecMulGenerator,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import { pureCircuits as ecdhMask } from '../../../artifacts/MockEcdhMask/contract/index.js';
// The ElGamal pure circuits double as an off-circuit "mirror." They let a test
// predict a ciphertext the contract will produce internally (e.g. the
// post-refund balance in `approve`) so its plaintext can be cached ahead of the
// witness query. They are pure (no proof), so this is cheap.
import { pureCircuits as elgamal } from '../../../artifacts/MockElGamal/contract/index.js';
import { ConfidentialFungibleTokenCoreSimulator } from './simulators/ConfidentialFungibleTokenCoreSimulator.js';

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
 * @note The field-element derivation from EK uses 31 bytes of the hash output
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

let cft: ConfidentialFungibleTokenCoreSimulator;

describe('ConfidentialFungibleToken: registration', () => {
  beforeEach(async () => {
    cft = await ConfidentialFungibleTokenCoreSimulator.create(
      NAME,
      SYMBOL,
      DECIMALS,
    );
  });

  describe('register', () => {
    it('should register a fresh account', async () => {
      await cft.privateState.switchIdentity(
        ALICE.secretKey,
        ALICE.encryptionKey,
      );

      expect(await cft.isRegistered(ALICE.accountId)).toBe(false);

      await cft.register();

      expect(await cft.isRegistered(ALICE.accountId)).toBe(true);
    });

    it('should fail when re-registering the same account', async () => {
      await cft.privateState.switchIdentity(
        ALICE.secretKey,
        ALICE.encryptionKey,
      );
      await cft.register();

      await expect(cft.register()).rejects.toThrow(
        'ConfidentialFungibleToken: already registered',
      );
    });

    it('should allow distinct users to register independently', async () => {
      await cft.privateState.switchIdentity(
        ALICE.secretKey,
        ALICE.encryptionKey,
      );
      await cft.register();

      await cft.privateState.switchIdentity(BOB.secretKey, BOB.encryptionKey);
      await cft.register();

      await cft.privateState.switchIdentity(
        CHARLIE.secretKey,
        CHARLIE.encryptionKey,
      );
      await cft.register();

      expect(await cft.isRegistered(ALICE.accountId)).toBe(true);
      expect(await cft.isRegistered(BOB.accountId)).toBe(true);
      expect(await cft.isRegistered(CHARLIE.accountId)).toBe(true);
    });

    it('should store the expected pk for the registered EK', async () => {
      await cft.privateState.switchIdentity(
        ALICE.secretKey,
        ALICE.encryptionKey,
      );
      await cft.register();

      const ledger = await cft.getPublicState();
      const storedPk = ledger.CFT__encryptionKeys.lookup(ALICE.accountId);
      const expectedPk = derivePk(ALICE.encryptionKey);

      expect(storedPk).toEqual(expectedPk);
    });

    it('should store distinct pks for distinct EKs', async () => {
      await cft.privateState.switchIdentity(
        ALICE.secretKey,
        ALICE.encryptionKey,
      );
      await cft.register();

      await cft.privateState.switchIdentity(BOB.secretKey, BOB.encryptionKey);
      await cft.register();

      const ledger = await cft.getPublicState();
      const alicePk = ledger.CFT__encryptionKeys.lookup(ALICE.accountId);
      const bobPk = ledger.CFT__encryptionKeys.lookup(BOB.accountId);

      expect(alicePk).not.toEqual(bobPk);
    });

    it('should initialize the balance to Enc(0)', async () => {
      await cft.privateState.switchIdentity(
        ALICE.secretKey,
        ALICE.encryptionKey,
      );
      await cft.register();

      const balance = await cft.balanceOf(ALICE.accountId);
      const identity = identityPoint();

      expect(balance.c1).toEqual(identity);
      expect(balance.c2).toEqual(identity);
    });

    it('should fail to transfer from an unregistered account', async () => {
      // Registration is a prerequisite for transfer. _debit asserts the
      // sender is registered.
      await cft.privateState.switchIdentity(
        ALICE.secretKey,
        ALICE.encryptionKey,
      );

      await expect(cft.transfer(BOB.accountId, 100n)).rejects.toThrow();
    });

    it('should fail to transfer to an unregistered account', async () => {
      // Alice registers, Bob doesn't. Alice tries to transfer to Bob.
      await cft.privateState.switchIdentity(
        ALICE.secretKey,
        ALICE.encryptionKey,
      );
      await cft.register();

      await expect(cft.transfer(BOB.accountId, 100n)).rejects.toThrow();
    });
  });

  describe('isRegistered', () => {
    it('should return false for an unregistered account', async () => {
      expect(await cft.isRegistered(ALICE.accountId)).toBe(false);
    });

    it('should return true after registration', async () => {
      await cft.privateState.switchIdentity(
        ALICE.secretKey,
        ALICE.encryptionKey,
      );
      await cft.register();

      expect(await cft.isRegistered(ALICE.accountId)).toBe(true);
    });

    it('should return false for an account that has not registered, even when others have', async () => {
      await cft.privateState.switchIdentity(
        ALICE.secretKey,
        ALICE.encryptionKey,
      );
      await cft.register();

      expect(await cft.isRegistered(BOB.accountId)).toBe(false);
    });
  });

  describe('computeAccountId', () => {
    it('should match the test helper derivation', async () => {
      const users = [ALICE, BOB, CHARLIE];

      for (const user of users) {
        expect(await cft.computeAccountId(user.secretKey)).toEqual(
          user.accountId,
        );
      }
    });

    it('should produce distinct identifiers for distinct keys', async () => {
      const users = [ALICE, BOB, CHARLIE];
      const ids = await Promise.all(
        users.map((u) => cft.computeAccountId(u.secretKey)),
      );

      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          expect(ids[i]).not.toEqual(ids[j]);
        }
      }
    });

    it('should be deterministic for the same secret key', async () => {
      const id1 = await cft.computeAccountId(ALICE.secretKey);
      const id2 = await cft.computeAccountId(ALICE.secretKey);

      expect(id1).toEqual(id2);
    });
  });
});

// ---------------------------------------------------------------------------
// Transfers
//
// Confidential balances can't be read directly, so "X holds exactly N" is
// proven behaviorally: cache N and `_debit(N)`. The debit's in-circuit
// `ElGamal_assertDecryptsTo` only passes if the balance truly encrypts >= N, so
// `_debit(N)` succeeding (and `_debit(N+1)` failing) pins the balance to N — no
// supply total needed. `_debit`/`_credit` are the base's own supply-free
// primitives, so this suite never touches mint/burn/totalSupply.
// ---------------------------------------------------------------------------

describe('ConfidentialFungibleToken: transfer', () => {
  beforeEach(async () => {
    cft = await ConfidentialFungibleTokenCoreSimulator.create(
      NAME,
      SYMBOL,
      DECIMALS,
    );
  });

  const registerAll = async () => {
    for (const u of [ALICE, BOB, CHARLIE]) {
      await cft.privateState.switchIdentity(u.secretKey, u.encryptionKey);
      await cft.register();
    }
  };

  // Registers everyone, credits `amount` to Alice via the base's supply-free
  // `_credit`, and leaves Alice active with her balance cached.
  const fundAlice = async (amount: bigint) => {
    await registerAll();
    await cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
    await cft._credit(ALICE.accountId, amount);
    // Dual-balance: `_credit` lands in `pending`; sweep it into `spendable` so
    // the amount is debitable, then cache the swept spendable ciphertext.
    await cft.sweep();
    await cft.privateState.cachePlaintext(
      await cft.balanceOf(ALICE.accountId),
      amount,
    );
  };

  it('moves value from sender to recipient', async () => {
    await fundAlice(100n);

    await cft.transfer(BOB.accountId, 30n);

    // Alice holds exactly 70.
    await cft.privateState.cachePlaintext(
      await cft.balanceOf(ALICE.accountId),
      70n,
    );
    await cft._debit(70n);

    // Bob holds exactly 30 (sweep his received value into spendable first).
    await cft.privateState.switchIdentity(BOB.secretKey, BOB.encryptionKey);
    await cft.sweep();
    await cft.privateState.cachePlaintext(
      await cft.balanceOf(BOB.accountId),
      30n,
    );
    await cft._debit(30n);
  });

  it('rejects a self-transfer', async () => {
    await fundAlice(100n);
    await expect(cft.transfer(ALICE.accountId, 10n)).rejects.toThrow(
      'ConfidentialFungibleToken: self-transfer',
    );
  });

  it('rejects a transfer exceeding the balance', async () => {
    await fundAlice(100n);
    await expect(cft.transfer(BOB.accountId, 101n)).rejects.toThrow(
      'ConfidentialFungibleToken: insufficient balance',
    );
  });

  it('rejects a debit when the witness EK does not match the registered pk', async () => {
    await fundAlice(100n);
    await cft.privateState.injectEncryptionKey(BOB.encryptionKey);
    await expect(cft._debit(10n)).rejects.toThrow('ElGamal: ek/pk mismatch');
  });
});

// ---------------------------------------------------------------------------
// Escrow allowances: approve / transferFrom / burnFrom
// ---------------------------------------------------------------------------

describe('ConfidentialFungibleToken: escrow allowance', () => {
  beforeEach(async () => {
    cft = await ConfidentialFungibleTokenCoreSimulator.create(
      NAME,
      SYMBOL,
      DECIMALS,
    );
  });

  const registerAll = async () => {
    for (const u of [ALICE, BOB, CHARLIE]) {
      await cft.privateState.switchIdentity(u.secretKey, u.encryptionKey);
      await cft.register();
    }
  };

  // Alice (owner) funds with `amount` and approves Bob (spender) for `cap`.
  // Leaves Alice active.
  const approveBob = async (amount: bigint, cap: bigint) => {
    await registerAll();
    await cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
    await cft._credit(ALICE.accountId, amount);
    // Dual-balance: sweep the minted value into spendable so approve can debit it.
    await cft.sweep();
    await cft.privateState.cachePlaintext(
      await cft.balanceOf(ALICE.accountId),
      amount,
    );
    await cft.approve(BOB.accountId, cap);
  };

  it('records an allowance and debits the owner balance', async () => {
    await approveBob(100n, 40n);

    // An escrow entry now exists for (Alice, Bob).
    const ledger = await cft.getPublicState();
    expect(
      ledger.CFT__escrow.lookup(ALICE.accountId).member(BOB.accountId),
    ).toBe(true);

    // Alice's main balance was debited by the cap: she now holds 60.
    await cft.privateState.cachePlaintext(
      await cft.balanceOf(ALICE.accountId),
      60n,
    );
    await cft._debit(60n);
  });

  it('lets the spender transferFrom up to the allowance', async () => {
    await approveBob(100n, 40n);

    // Bob decrypts his escrow copy (value 40) and caches it, then spends 25
    // to Charlie.
    await cft.privateState.switchIdentity(BOB.secretKey, BOB.encryptionKey);
    const escrow = await cft.allowance(ALICE.accountId, BOB.accountId);
    await cft.privateState.cachePlaintext(escrow.spenderCt, 40n);

    await cft.transferFrom(ALICE.accountId, CHARLIE.accountId, 25n);

    // Charlie holds exactly 25 (sweep his received value into spendable first).
    await cft.privateState.switchIdentity(
      CHARLIE.secretKey,
      CHARLIE.encryptionKey,
    );
    await cft.sweep();
    await cft.privateState.cachePlaintext(
      await cft.balanceOf(CHARLIE.accountId),
      25n,
    );
    await cft._debit(25n);
  });

  it('transferFrom pushes a memo to the recipient', async () => {
    await approveBob(100n, 40n);

    await cft.privateState.switchIdentity(BOB.secretKey, BOB.encryptionKey);
    await cft.privateState.cachePlaintext(
      (await cft.allowance(ALICE.accountId, BOB.accountId)).spenderCt,
      40n,
    );

    await cft.transferFrom(ALICE.accountId, CHARLIE.accountId, 25n);

    const charlieMemos = (await cft.getPublicState()).CFT__memos.lookup(
      CHARLIE.accountId,
    );
    expect(charlieMemos.length()).toBe(1n);
  });

  it('reduces the allowance by the spent amount on a partial transferFrom', async () => {
    await approveBob(100n, 40n);

    await cft.privateState.switchIdentity(BOB.secretKey, BOB.encryptionKey);
    let escrow = await cft.allowance(ALICE.accountId, BOB.accountId);
    await cft.privateState.cachePlaintext(escrow.spenderCt, 40n);

    await cft.transferFrom(ALICE.accountId, CHARLIE.accountId, 25n);

    // Remaining allowance is 15: cache the reduced spender copy.
    escrow = await cft.allowance(ALICE.accountId, BOB.accountId);
    await cft.privateState.cachePlaintext(escrow.spenderCt, 15n);

    // Spending 16 (over the remaining 15) fails; exactly 15 succeeds.
    await expect(
      cft.transferFrom(ALICE.accountId, CHARLIE.accountId, 16n),
    ).rejects.toThrow('ConfidentialFungibleToken: insufficient allowance');
    await cft.transferFrom(ALICE.accountId, CHARLIE.accountId, 15n);
  });

  it('rejects transferFrom with no escrow', async () => {
    await registerAll();
    // Bob never received an approval from Alice.
    await cft.privateState.switchIdentity(BOB.secretKey, BOB.encryptionKey);
    await expect(
      cft.transferFrom(ALICE.accountId, CHARLIE.accountId, 10n),
    ).rejects.toThrow('ConfidentialFungibleToken: no escrow');
  });

  it('rejects transferFrom exceeding the allowance', async () => {
    await approveBob(100n, 40n);

    await cft.privateState.switchIdentity(BOB.secretKey, BOB.encryptionKey);
    const escrow = await cft.allowance(ALICE.accountId, BOB.accountId);
    await cft.privateState.cachePlaintext(escrow.spenderCt, 40n);

    await expect(
      cft.transferFrom(ALICE.accountId, CHARLIE.accountId, 41n),
    ).rejects.toThrow('ConfidentialFungibleToken: insufficient allowance');
  });

  it('rejects a self-approval', async () => {
    await registerAll();
    await cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
    await expect(cft.approve(ALICE.accountId, 10n)).rejects.toThrow(
      'ConfidentialFungibleToken: self-approval',
    );
  });

  it('rejects approving an unregistered spender', async () => {
    await cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
    await cft.register();
    // Bob is not registered.
    await expect(cft.approve(BOB.accountId, 10n)).rejects.toThrow(
      'ConfidentialFungibleToken: spender not registered',
    );
  });

  it('rejects approving the zero account', async () => {
    await cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
    await cft.register();
    await expect(cft.approve(new Uint8Array(32), 10n)).rejects.toThrow(
      'ConfidentialFungibleToken: invalid spender',
    );
  });

  it('rejects transferFrom to the zero account', async () => {
    await approveBob(100n, 40n);
    await cft.privateState.switchIdentity(BOB.secretKey, BOB.encryptionKey);
    await cft.privateState.cachePlaintext(
      (await cft.allowance(ALICE.accountId, BOB.accountId)).spenderCt,
      40n,
    );
    await expect(
      cft.transferFrom(ALICE.accountId, new Uint8Array(32), 10n),
    ).rejects.toThrow('ConfidentialFungibleToken: invalid receiver');
  });

  it('re-approve refunds the prior escrow to the owner before setting the new cap', async () => {
    // _refundPriorEscrow is the one flow that re-queries a ciphertext the same
    // circuit just produced (the post-refund main balance). We predict that
    // ciphertext via the ElGamal pure circuits and cache its plaintext before
    // the second approve queries it.
    await registerAll();
    await cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
    await cft._credit(ALICE.accountId, 100n);
    await cft.sweep();
    await cft.privateState.cachePlaintext(
      await cft.balanceOf(ALICE.accountId),
      100n,
    );

    // First approve: 40 to Bob. Alice's main balance 100 -> 60.
    await cft.approve(BOB.accountId, 40n);

    // The refund is now HOMOMORPHIC: `_refundPriorEscrow` adds the escrow's
    // owner-copy ciphertext (Enc(40)) straight onto Alice's balance (Enc(60))
    // via `ElGamal_add`, with no decrypt. Predict that exact post-refund
    // ciphertext (Enc(100)) and cache its plaintext so approve's subsequent debit
    // decrypt resolves it. No cache is needed for the escrow copy itself. The
    // refund never decrypts it
    const escrowOwnerCt = (await cft.allowance(ALICE.accountId, BOB.accountId))
      .ownerCt;
    const refunded = elgamal.add(
      await cft.balanceOf(ALICE.accountId),
      escrowOwnerCt,
    );
    await cft.privateState.cachePlaintext(refunded, 100n);

    // Second approve: 30 to Bob. Refund 40 (main 60 -> 100), then debit 30 (-> 70).
    await cft.approve(BOB.accountId, 30n);

    // Refund proof: Alice holds 70 (= 100 - 30), NOT 30 (= 100 - 40 - 30 without
    // the refund). Caching 70 and burning it only succeeds if the balance truly
    // decrypts to 70.
    await cft.privateState.cachePlaintext(
      await cft.balanceOf(ALICE.accountId),
      70n,
    );
    await expect(cft._debit(71n)).rejects.toThrow(
      'ConfidentialFungibleToken: insufficient balance',
    );
    await cft._debit(70n);
  });

  it('lets the owner re-approve after a PARTIAL spend by decrypting the ownerMemo', async () => {
    const OWNER_MEMO_DOMAIN = padTag('OZ_CFT_escrow_owner_v1');

    await approveBob(100n, 40n); // Alice: spendable 100 -> 60; escrow(Alice,Bob) = 40.

    // Bob partially spends 25 to Charlie (remaining allowance -> 15)
    await cft.privateState.switchIdentity(BOB.secretKey, BOB.encryptionKey);
    await cft.privateState.cachePlaintext(
      (await cft.allowance(ALICE.accountId, BOB.accountId)).spenderCt,
      40n,
    );
    await cft.transferFrom(ALICE.accountId, CHARLIE.accountId, 25n);

    // Alice (owner) learns the remaining allowance ONLY by decrypting the memo
    // the spend refreshed
    await cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
    const escrow = await cft.allowance(ALICE.accountId, BOB.accountId);
    const aliceEk = elgamal.secretToScalar(ALICE.encryptionKey);
    const remaining = ecdhMask.decrypt(
      escrow.ownerMemo,
      aliceEk,
      OWNER_MEMO_DOMAIN,
    );
    expect(remaining).toBe(15n);

    // She proves the post-refund balance (spendable 60 + refunded remaining 15 =
    // 75) using the decrypted remaining, then re-approves Bob for 20
    const refunded = elgamal.add(
      await cft.balanceOf(ALICE.accountId),
      escrow.ownerCt,
    );
    await cft.privateState.cachePlaintext(refunded, 60n + remaining);
    await cft.approve(BOB.accountId, 20n);

    // Post-state: Alice holds 75 - 20 = 55; a fresh escrow of 20 exists.
    await cft.privateState.cachePlaintext(
      await cft.balanceOf(ALICE.accountId),
      55n,
    );
    await cft._debit(55n);
  });

  it('re-approve after a partial spend fails if the owner assumes the escrow is untouched', async () => {
    await approveBob(100n, 40n);

    await cft.privateState.switchIdentity(BOB.secretKey, BOB.encryptionKey);
    await cft.privateState.cachePlaintext(
      (await cft.allowance(ALICE.accountId, BOB.accountId)).spenderCt,
      40n,
    );
    await cft.transferFrom(ALICE.accountId, CHARLIE.accountId, 25n);

    // Alice wrongly assumes remaining == cap == 40, predicting 60 + 40 = 100.
    // The real post-refund balance is 60 + 15 = 75, so the claim is rejected
    await cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
    const escrow = await cft.allowance(ALICE.accountId, BOB.accountId);
    const refunded = elgamal.add(
      await cft.balanceOf(ALICE.accountId),
      escrow.ownerCt,
    );
    await cft.privateState.cachePlaintext(refunded, 100n); // wrong: should be 75
    await expect(cft.approve(BOB.accountId, 20n)).rejects.toThrow(
      'ElGamal: plaintext mismatch',
    );
  });

  it('revokes an allowance via approve(spender, 0)', async () => {
    await approveBob(100n, 40n);

    const escrow = await cft.allowance(ALICE.accountId, BOB.accountId);
    const refunded = elgamal.add(
      await cft.balanceOf(ALICE.accountId),
      escrow.ownerCt,
    );
    await cft.privateState.cachePlaintext(refunded, 100n);
    await cft.approve(BOB.accountId, 0n);

    // The escrow now encrypts 0.
    await cft.privateState.switchIdentity(BOB.secretKey, BOB.encryptionKey);
    await cft.privateState.cachePlaintext(
      (await cft.allowance(ALICE.accountId, BOB.accountId)).spenderCt,
      0n,
    );
    await expect(
      cft.transferFrom(ALICE.accountId, CHARLIE.accountId, 1n),
    ).rejects.toThrow('ConfidentialFungibleToken: insufficient allowance');
  });
});

// ---------------------------------------------------------------------------
// Metadata & default views
// ---------------------------------------------------------------------------

describe('ConfidentialFungibleToken: metadata & views', () => {
  beforeEach(async () => {
    cft = await ConfidentialFungibleTokenCoreSimulator.create(
      NAME,
      SYMBOL,
      DECIMALS,
    );
  });

  it('exposes the constructor metadata', async () => {
    expect(await cft.name()).toBe(NAME);
    expect(await cft.symbol()).toBe(SYMBOL);
    expect(await cft.decimals()).toBe(DECIMALS);
  });

  it('balanceOf returns Enc(0) for an unregistered account', async () => {
    // Unregistered accounts hold zero: balanceOf returns a well-formed Enc(0)
    // (identity, identity) — identical for any unregistered account and
    // matching a registered account's fresh balance.
    const bal = await cft.balanceOf(ALICE.accountId);
    const identity = identityPoint();
    expect(bal.c1).toEqual(identity);
    expect(bal.c2).toEqual(identity);
    expect(bal).toEqual(await cft.balanceOf(BOB.accountId));
  });

  it('allowance returns the default entry when no escrow exists', async () => {
    expect(await cft.allowance(ALICE.accountId, BOB.accountId)).toEqual(
      await cft.allowance(BOB.accountId, CHARLIE.accountId),
    );
  });
});

// ---------------------------------------------------------------------------
// Memos
// ---------------------------------------------------------------------------

describe('ConfidentialFungibleToken: memos', () => {
  beforeEach(async () => {
    cft = await ConfidentialFungibleTokenCoreSimulator.create(
      NAME,
      SYMBOL,
      DECIMALS,
    );
  });

  it('pushes one memo per credit', async () => {
    await cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
    await cft.register();

    await cft._credit(ALICE.accountId, 10n);
    await cft._credit(ALICE.accountId, 20n);

    const memos = (await cft.getPublicState()).CFT__memos.lookup(
      ALICE.accountId,
    );
    expect(memos.length()).toBe(2n);
  });

  it('clearMemos empties the caller’s memo list', async () => {
    await cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
    await cft.register();
    await cft._credit(ALICE.accountId, 10n);
    expect(
      (await cft.getPublicState()).CFT__memos.lookup(ALICE.accountId).length(),
    ).toBe(1n);

    await cft.clearMemos();

    expect(
      (await cft.getPublicState()).CFT__memos.lookup(ALICE.accountId).length(),
    ).toBe(0n);
  });
});

// ---------------------------------------------------------------------------
// Dual-balance grief fix (spendable vs pending; owner-only sweep)
// ---------------------------------------------------------------------------

describe('ConfidentialFungibleToken: dual-balance grief fix', () => {
  beforeEach(async () => {
    cft = await ConfidentialFungibleTokenCoreSimulator.create(
      NAME,
      SYMBOL,
      DECIMALS,
    );
  });

  const registerBoth = async () => {
    for (const u of [ALICE, BOB]) {
      await cft.privateState.switchIdentity(u.secretKey, u.encryptionKey);
      await cft.register();
    }
  };

  it('credits land in pending, and only sweep() moves them into spendable', async () => {
    const id = identityPoint();
    await registerBoth();

    // Mint to Alice: value lands in PENDING; spendable stays Enc(0).
    await cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
    await cft._credit(ALICE.accountId, 1000n);
    expect((await cft.balanceOf(ALICE.accountId)).c1).toEqual(id); // spendable Enc(0)
    expect((await cft.pendingOf(ALICE.accountId)).c1).not.toEqual(id); // pending funded

    // Alice sweeps: pending -> spendable, pending reset to Enc(0).
    await cft.sweep();
    expect((await cft.pendingOf(ALICE.accountId)).c1).toEqual(id); // pending reset
    expect((await cft.balanceOf(ALICE.accountId)).c1).not.toEqual(id); // spendable funded

    // The swept balance is genuinely spendable: a transfer whose _debit asserts
    // the cached plaintext decrypts the spendable ciphertext must succeed.
    await cft.privateState.cachePlaintext(
      await cft.balanceOf(ALICE.accountId),
      1000n,
    );
    await cft.transfer(BOB.accountId, 400n);

    // Bob's received value is in PENDING, not spendable.
    expect((await cft.balanceOf(BOB.accountId)).c1).toEqual(id);
    expect((await cft.pendingOf(BOB.accountId)).c1).not.toEqual(id);

    // Bob sweeps and can spend it (a successful transfer back proves it).
    await cft.privateState.switchIdentity(BOB.secretKey, BOB.encryptionKey);
    await cft.sweep();
    expect((await cft.pendingOf(BOB.accountId)).c1).toEqual(id);
    await cft.privateState.cachePlaintext(
      await cft.balanceOf(BOB.accountId),
      400n,
    );
    await cft.transfer(ALICE.accountId, 400n); // succeeds => spendable
  });

  it('an incoming credit never changes the victim’s spendable ciphertext', async () => {
    // The grief-resistance invariant: a third party pushing value to you lands
    // in pending, so your spendable ciphertext is byte-identical and any
    // in-flight spend proof against it stays valid.
    await registerBoth();

    // Fund Alice's spendable, and fund Bob so he can push a dust credit.
    await cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
    await cft._credit(ALICE.accountId, 500n);
    await cft.sweep();
    const spendableBefore = await cft.balanceOf(ALICE.accountId);

    await cft.privateState.switchIdentity(BOB.secretKey, BOB.encryptionKey);
    await cft._credit(BOB.accountId, 10n);
    await cft.sweep();
    await cft.privateState.cachePlaintext(
      await cft.balanceOf(BOB.accountId),
      10n,
    );

    // Bob spams a dust credit to Alice.
    await cft.transfer(ALICE.accountId, 1n);

    // Alice's spendable is unchanged; the dust sits in her pending.
    const spendableAfter = await cft.balanceOf(ALICE.accountId);
    expect(spendableAfter).toEqual(spendableBefore);
    expect((await cft.pendingOf(ALICE.accountId)).c1).not.toEqual(
      identityPoint(),
    );
  });

  it('_move conserves: debits caller, credits recipient pending, net zero', async () => {
    const id = identityPoint();
    await registerBoth();
    await cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
    await cft._credit(ALICE.accountId, 1000n);
    await cft.sweep();
    await cft.privateState.cachePlaintext(
      await cft.balanceOf(ALICE.accountId),
      1000n,
    );

    await cft._move(BOB.accountId, 400n);

    // Recipient credited into pending, spendable untouched (dual-balance).
    expect((await cft.balanceOf(BOB.accountId)).c1).toEqual(id); // spendable still 0
    expect((await cft.pendingOf(BOB.accountId)).c1).not.toEqual(id); // pending funded

    // Caller debited by exactly 400 (1000 -> 600): proves net-zero conservation
    // without a supply total to read.
    await cft.privateState.cachePlaintext(
      await cft.balanceOf(ALICE.accountId),
      600n,
    );
    await cft._debit(600n);
  });
});

// ---------------------------------------------------------------------------
// Memo value delivery (ECDH one-time pad; no discrete-log recovery)
// ---------------------------------------------------------------------------

describe('ConfidentialFungibleToken: memo value delivery', () => {
  beforeEach(async () => {
    cft = await ConfidentialFungibleTokenCoreSimulator.create(
      NAME,
      SYMBOL,
      DECIMALS,
    );
  });

  it('recipient recovers the transferred value from the on-chain memo', async () => {
    for (const u of [ALICE, BOB]) {
      await cft.privateState.switchIdentity(u.secretKey, u.encryptionKey);
      await cft.register();
    }
    await cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
    await cft._credit(ALICE.accountId, 1000n);
    await cft.sweep();
    await cft.privateState.cachePlaintext(
      await cft.balanceOf(ALICE.accountId),
      1000n,
    );
    await cft.transfer(BOB.accountId, 250n);

    // Bob reads his newest on-chain memo (pushFront => index 0) and decrypts it
    // with his EK scalar — recovering the value directly, no BSGS.
    const memoList = (await cft.getPublicState()).CFT__memos.lookup(
      BOB.accountId,
    );
    const memos = [...memoList];
    expect(memos.length).toBe(1);

    const bobEk = elgamal.secretToScalar(BOB.encryptionKey);
    expect(
      ecdhMask.decrypt(memos[0], bobEk, padTag('OZ_CFT_ecdh_memo_v1')),
    ).toBe(250n);
  });

  it('delivers a value far above 2^48 via the memo (no discrete-log bound)', async () => {
    for (const u of [ALICE, BOB]) {
      await cft.privateState.switchIdentity(u.secretKey, u.encryptionKey);
      await cft.register();
    }
    await cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
    const big = 1n << 80n;
    await cft._credit(ALICE.accountId, big);
    await cft.sweep();
    await cft.privateState.cachePlaintext(
      await cft.balanceOf(ALICE.accountId),
      big,
    );
    await cft.transfer(BOB.accountId, big);

    const memoList = (await cft.getPublicState()).CFT__memos.lookup(
      BOB.accountId,
    );
    const bobEk = elgamal.secretToScalar(BOB.encryptionKey);
    expect(
      ecdhMask.decrypt([...memoList][0], bobEk, padTag('OZ_CFT_ecdh_memo_v1')),
    ).toBe(big);
  });
});

// ---------------------------------------------------------------------------
// Per-operation value bound (boundary)
// ---------------------------------------------------------------------------

describe('ConfidentialFungibleToken: value bound', () => {
  beforeEach(async () => {
    cft = await ConfidentialFungibleTokenCoreSimulator.create(
      NAME,
      SYMBOL,
      DECIMALS,
    );
  });

  it('accepts values above the former 2^48 cap (ECDH memo removes the bound)', async () => {
    await cft.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
    await cft.register();

    const large = 1n << 100n; // far above the old 2^48 cap
    await cft._credit(ALICE.accountId, large);

    // The full value round-trips with no discrete-log bound: sweep it into
    // spendable and debit it back out. `_debit`'s in-circuit decrypt only
    // passes if the balance truly encrypts `large`.
    await cft.sweep();
    await cft.privateState.cachePlaintext(
      await cft.balanceOf(ALICE.accountId),
      large,
    );
    await cft._debit(large);
  });
});
