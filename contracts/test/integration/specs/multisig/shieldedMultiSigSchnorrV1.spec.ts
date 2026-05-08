import {
  CompactTypeBytes,
  CompactTypeVector,
  convertFieldToBytes,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { jubjubSignDeterministic } from '../../../../src/crypto/utils/jubjubSchnorr.js';
import {
  deployShieldedMultiSigSchnorrV1,
  type ShieldedMultiSigSchnorrV1Kit,
} from '../../fixtures/shieldedMultiSigSchnorrV1.js';

/**
 * Scheme C — three-person multisig (3-of-3 Schnorr-on-Jubjub) end-to-end
 * against a live local Midnight node + proof server.
 *
 * Real-world story modelled here:
 *   - ADMIN, ALICE, BOB are three independent users. Each holds a prefunded
 *     Midnight wallet (their "daily-driver") AND an independent Jubjub
 *     multisig keypair (their "approval signing key"). The wallets and the
 *     multisig keys are intentionally decoupled — wallets pay gas, multisig
 *     keys produce signatures.
 *   - The genesis wallet deploys the multisig, registering the three
 *     Jubjub public keys at construction.
 *   - Any of the three (or any other wallet) can submit `execute` once
 *     they collect three valid Schnorr signatures over the action message
 *     hash. We rotate submitters across tests below to demonstrate that
 *     the auth path is purely the Schnorr signatures, independent of who
 *     pays gas.
 *
 * Pins:
 *  - Deploy with three real prefunded users' Jubjub pubkeys.
 *  - Initial ledger reflects constructor args.
 *  - Proof server REJECTS execute with a duplicate signer (submitted by ALICE).
 *  - Proof server REJECTS execute with a non-registered pubkey (submitted by BOB).
 *  - Proof server REJECTS execute with a tampered signature (submitted by ADMIN).
 *  - Proof server REJECTS execute with signatures over the wrong message
 *    (submitted by ALICE).
 *
 * Treasury happy-path (deposit a coin then execute the actual transfer) is
 * deferred to a follow-up spec — it requires real coin handling that goes
 * beyond the auth validation we're pinning here.
 */

const RecipientKind = { ShieldedUser: 0, UnshieldedUser: 1, Contract: 2 };
const COLOR = new Uint8Array(32).fill(1);
const AMOUNT = 1000n;
const TO_ADDR = new Uint8Array(32).fill(7);
const NONCE_BASE = 0x4242424242424242424242424242424242424242424242424242424242424242n;

function recipient(address: Uint8Array): {
  kind: number;
  address: Uint8Array;
} {
  return { kind: RecipientKind.ShieldedUser, address };
}

function makeQualifiedCoin(
  color: Uint8Array,
  value: bigint,
  mtIndex: bigint,
  nonce?: Uint8Array,
) {
  return {
    nonce: nonce ?? new Uint8Array(32).fill(0),
    color,
    value,
    mt_index: mtIndex,
  };
}

/**
 * Reproduce the on-chain `execute` message hash off-chain.
 *
 * MUST byte-match `persistentHash<Vector<4, Bytes<32>>>([nonce, to.address,
 * coin.color, amount])` in `ShieldedMultiSigSchnorrV1.execute`.
 */
function executeMessageHash(
  currentNonce: bigint,
  toAddress: Uint8Array,
  coinColor: Uint8Array,
  amount: bigint,
): Uint8Array {
  const rt = new CompactTypeVector(4, new CompactTypeBytes(32));
  return persistentHash(rt, [
    convertFieldToBytes(32, currentNonce, ''),
    toAddress,
    coinColor,
    convertFieldToBytes(32, amount, ''),
  ]);
}

describe('Scheme C — ShieldedMultiSigSchnorrV1 (3-person live-node)', () => {
  let kit: ShieldedMultiSigSchnorrV1Kit;

  beforeAll(async () => {
    kit = await deployShieldedMultiSigSchnorrV1({ threshold: 3n });
  }, 240_000);

  afterAll(async () => {
    await kit?.teardown();
  });

  it('deploys with the three alias Jubjub keys (ADMIN, ALICE, BOB)', () => {
    expect(kit.contractAddress).toMatch(/^[0-9a-f]+$/);
    expect(kit.aliasJubjub.ADMIN.publicKey).toBeDefined();
    expect(kit.aliasJubjub.ALICE.publicKey).toBeDefined();
    expect(kit.aliasJubjub.BOB.publicKey).toBeDefined();
  });

  it('initial ledger reflects 3 signers, threshold 3, _nonce = 0', async () => {
    const ledger = await kit.readLedger();
    expect(ledger._nonce).toBe(0n);
    expect(ledger.Signer__signerCount).toBe(3n);
    expect(ledger.Signer__threshold).toBe(3n);
    expect(ledger.Signer__signers.member(kit.aliasJubjub.ADMIN.publicKey)).toBe(
      true,
    );
    expect(ledger.Signer__signers.member(kit.aliasJubjub.ALICE.publicKey)).toBe(
      true,
    );
    expect(ledger.Signer__signers.member(kit.aliasJubjub.BOB.publicKey)).toBe(
      true,
    );
  });

  it('ALICE submits execute with a duplicate signer; proof server rejects', async () => {
    const msgHash = executeMessageHash(0n, TO_ADDR, COLOR, AMOUNT);
    const approvals = [
      {
        pubkey: kit.aliasJubjub.ADMIN.publicKey,
        signature: jubjubSignDeterministic(
          kit.aliasJubjub.ADMIN.secret,
          msgHash,
          NONCE_BASE,
        ),
      },
      {
        pubkey: kit.aliasJubjub.ADMIN.publicKey, // ← duplicated ADMIN
        signature: jubjubSignDeterministic(
          kit.aliasJubjub.ADMIN.secret,
          msgHash,
          NONCE_BASE + 1n,
        ),
      },
      {
        pubkey: kit.aliasJubjub.BOB.publicKey,
        signature: jubjubSignDeterministic(
          kit.aliasJubjub.BOB.secret,
          msgHash,
          NONCE_BASE + 2n,
        ),
      },
    ];

    const aliceHandle = await kit.as('ALICE');
    await expect(
      aliceHandle.callTx.execute(
        recipient(TO_ADDR),
        AMOUNT,
        makeQualifiedCoin(COLOR, AMOUNT, 0n),
        approvals,
      ),
    ).rejects.toThrow(/duplicate signer/);
  }, 180_000);

  it('BOB submits execute with a non-registered pubkey; proof server rejects', async () => {
    const msgHash = executeMessageHash(0n, TO_ADDR, COLOR, AMOUNT);
    // Build an outsider Jubjub keypair the multisig has never seen.
    const outsiderSecret = kit.aliasJubjub.ADMIN.secret + 7n;
    const { jubjubKeypairFromSecret } = await import(
      '../../../../src/crypto/utils/jubjubSchnorr.js'
    );
    const outsider = jubjubKeypairFromSecret(outsiderSecret);

    const approvals = [
      {
        pubkey: kit.aliasJubjub.ADMIN.publicKey,
        signature: jubjubSignDeterministic(
          kit.aliasJubjub.ADMIN.secret,
          msgHash,
          NONCE_BASE,
        ),
      },
      {
        pubkey: kit.aliasJubjub.ALICE.publicKey,
        signature: jubjubSignDeterministic(
          kit.aliasJubjub.ALICE.secret,
          msgHash,
          NONCE_BASE + 1n,
        ),
      },
      {
        pubkey: outsider.publicKey,
        signature: jubjubSignDeterministic(
          outsider.secret,
          msgHash,
          NONCE_BASE + 2n,
        ),
      },
    ];

    const bobHandle = await kit.as('BOB');
    await expect(
      bobHandle.callTx.execute(
        recipient(TO_ADDR),
        AMOUNT,
        makeQualifiedCoin(COLOR, AMOUNT, 0n),
        approvals,
      ),
    ).rejects.toThrow(/Signer: not a signer/);
  }, 180_000);

  it('ADMIN submits execute with a tampered signature; proof server rejects', async () => {
    const msgHash = executeMessageHash(0n, TO_ADDR, COLOR, AMOUNT);
    const aliceSig = jubjubSignDeterministic(
      kit.aliasJubjub.ALICE.secret,
      msgHash,
      NONCE_BASE + 1n,
    );
    const approvals = [
      {
        pubkey: kit.aliasJubjub.ADMIN.publicKey,
        signature: jubjubSignDeterministic(
          kit.aliasJubjub.ADMIN.secret,
          msgHash,
          NONCE_BASE,
        ),
      },
      {
        pubkey: kit.aliasJubjub.ALICE.publicKey,
        signature: { R: aliceSig.R, sigma: aliceSig.sigma + 1n }, // ← tampered
      },
      {
        pubkey: kit.aliasJubjub.BOB.publicKey,
        signature: jubjubSignDeterministic(
          kit.aliasJubjub.BOB.secret,
          msgHash,
          NONCE_BASE + 2n,
        ),
      },
    ];

    const adminHandle = await kit.as('ADMIN');
    await expect(
      adminHandle.callTx.execute(
        recipient(TO_ADDR),
        AMOUNT,
        makeQualifiedCoin(COLOR, AMOUNT, 0n),
        approvals,
      ),
    ).rejects.toThrow(/Schnorr: invalid signature/);
  }, 180_000);

  it('ALICE submits execute with signatures over a different amount; proof server rejects', async () => {
    // Sigs sign hash for amount=AMOUNT; the call uses amount=AMOUNT+1, so the
    // on-chain msgHash differs and all three signatures fail to verify.
    const wrongHash = executeMessageHash(0n, TO_ADDR, COLOR, AMOUNT);
    const approvals = [
      {
        pubkey: kit.aliasJubjub.ADMIN.publicKey,
        signature: jubjubSignDeterministic(
          kit.aliasJubjub.ADMIN.secret,
          wrongHash,
          NONCE_BASE,
        ),
      },
      {
        pubkey: kit.aliasJubjub.ALICE.publicKey,
        signature: jubjubSignDeterministic(
          kit.aliasJubjub.ALICE.secret,
          wrongHash,
          NONCE_BASE + 1n,
        ),
      },
      {
        pubkey: kit.aliasJubjub.BOB.publicKey,
        signature: jubjubSignDeterministic(
          kit.aliasJubjub.BOB.secret,
          wrongHash,
          NONCE_BASE + 2n,
        ),
      },
    ];

    const aliceHandle = await kit.as('ALICE');
    await expect(
      aliceHandle.callTx.execute(
        recipient(TO_ADDR),
        AMOUNT + 1n,
        makeQualifiedCoin(COLOR, AMOUNT + 1n, 0n),
        approvals,
      ),
    ).rejects.toThrow(/Schnorr: invalid signature/);
  }, 180_000);
});
