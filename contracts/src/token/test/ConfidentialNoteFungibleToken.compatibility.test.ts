/**
 * Compatibility claims for the ConfidentialNoteFungibleToken core.
 *
 * Every other suite compares the module against itself, so all of them stay green
 * when the WIRE FORMAT moves: rename a domain tag or reorder a hash preimage and
 * every digest moves together, keeping relative assertions consistent.
 *
 * This suite pins absolute values and the shape of the published state, the two
 * things an outside party depends on. A holder rebuilds a commitment and derives a
 * nullifier to spend; move either and their note is unspendable. A client reads
 * the ledger by slot and calls circuits by name; move a slot index or unexport a
 * field and it reads the wrong thing.
 *
 * SO A FAILURE HERE IS NOT A TEST TO FIX, in order of likelihood:
 *
 *   1. Revert. Most failures are accidental.
 *   2. Accept deliberately. Pre-release nothing is deployed to break, as with the
 *      `OZ:note:` to `CNFT:` rename. Regenerate in the same commit and say so.
 *   3. Post-release, it is a breaking change needing a migration.
 *
 * Never regenerate a value without deciding which of the three it is.
 *
 * PROVENANCE. Every value below is byte-identical under compiler 0.34.0 (CI,
 * language 0.26.0) and 0.31.1 (language 0.23.0), on runtime 0.19.0. Digests,
 * layout, and circuit surface alike.
 *
 * Recorded, not asserted. Those compilers differ in name and agree on every byte,
 * so a pinned `compiler-version` would fail with nothing broken. The enforceable
 * pin is `.github/actions/setup/action.yml`. On a toolchain bump, rebuild under
 * both compilers and diff instead of assuming.
 *
 * Circuit complexity (k, rows) is not pinned here; it needs a non-`SKIP_ZK`
 * build. See OpenZeppelin/compact-contracts#750.
 */

import {
  CompactTypeBytes,
  CompactTypeVector,
  degradeToTransient,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type CircuitSurface,
  circuitSurface,
  type Exhaustive,
  ledgerSlots,
  type NameOf,
  readContractInfo,
} from '#test-utils/compiler/contractInfo.js';
import type {
  Circuits,
  Ledger,
  ProvableCircuits,
} from '../../../artifacts/MockConfidentialNoteFungibleToken/contract/index.js';
import { pureCircuits as core } from '../../../artifacts/MockConfidentialNoteFungibleToken/contract/index.js';
import { ConfidentialNoteFungibleTokenSimulator } from './simulators/ConfidentialNoteFungibleTokenSimulator.js';
import {
  INSTANCE_SALT,
  type Note,
} from './witnesses/ConfidentialNoteFungibleTokenWitnesses.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A deterministic 32-byte secret key from a label. */
const secretKey = (label: string): Uint8Array => {
  const sk = new Uint8Array(32);
  sk.set(new TextEncoder().encode(label));
  return sk;
};

const ALICE_SK = secretKey('ALICE');

/** Every deployment here is constructed with this salt. */
const SALT = INSTANCE_SALT;

const ALICE = core.derivePk(ALICE_SK, SALT);
const BOB = core.derivePk(secretKey('BOB'), SALT);

/** Stands in for wallet randomness, the only non-deterministic mint input. */
const FIXED_SEED = secretKey('FIXED-NONCE-SEED');

/** Lowercase `0x…` rendering, so a failed vector prints readably. */
const hex = (bytes: Uint8Array): string =>
  `0x${Buffer.from(bytes).toString('hex')}`;

/** The one note every digest below is taken over. */
const NOTE: Note = { value: 100n, nonce: 7n };

// ---------------------------------------------------------------------------
// Digests
// ---------------------------------------------------------------------------

/**
 * Domain-separated hashes. The tags are permanent parts of the format:
 * `CNFT:pk`, `CNFT:commitment`, `CNFT:nullifier`, `CNFT:issued`,
 * `CNFT:nonce:core`, `CNFT:mint`, `CNFT:out`, `CNFT:change`. So is
 * each preimage's field order, and the binder every derived nonce is taken
 * over: the recipient for a mint, the consumed note's nullifier for a spend.
 *
 * `derivePk` hashes `(CNFT:pk, salt, sk)`, the circuits' salt being the
 * deployment's `_instanceSalt`. Pinned because every commitment is taken over
 * its output.
 */
describe('ConfidentialNoteFungibleToken compatibility: digests', () => {
  // Pure circuits: no deployment, so these run on either backend.

  it('should derive the pinned pk from a known secret and salt', () => {
    expect(core.derivePk(ALICE_SK, SALT)).toBe(
      262435359501940701077170570879675701887870845687505442111448399011781289948n,
    );
  });

  // The public modules publish `computeAccountId(sk) = H([sk])` as a ledger
  // key, so an untagged `pk` would be one field reduction away from it.
  it('should not collide with computeAccountId for the same secret', () => {
    const accountId = persistentHash(
      new CompactTypeVector(1, new CompactTypeBytes(32)),
      [ALICE_SK],
    );
    expect(core.derivePk(ALICE_SK, SALT)).not.toBe(
      degradeToTransient(accountId),
    );
  });

  it('should derive distinct pks for one secret under distinct salts', () => {
    expect(core.derivePk(ALICE_SK, SALT)).not.toBe(
      core.derivePk(ALICE_SK, secretKey('OTHER-SALT')),
    );
  });

  it('should commit a known note to the pinned digest', () => {
    expect(hex(core.commitOf(NOTE, ALICE))).toBe(
      '0xcbdb241e72e5c22f54c848203b2f525ae67dc6822fc0f350af92d9921742bd00',
    );
  });

  it('should nullify a known note to the pinned digest', () => {
    expect(hex(core.nullifierOf(NOTE))).toBe(
      '0xfb3222fcc782cf98276a6d821788f1b81a78aa14aca248290de1fda823c30f17',
    );
  });

  // Same preimage shape as the nullifier under a different domain, so the pair
  // pins that the two tags cannot be read as one another.
  it('should tag a known note to the pinned digest', () => {
    expect(hex(core.issuedTagOf(NOTE))).toBe(
      '0x27eaf0b7591acabab03a7b8f370edb87ced140a090678267592a272a812ae9e1',
    );
    expect(core.issuedTagOf(NOTE)).not.toEqual(core.nullifierOf(NOTE));
  });
});

// ---------------------------------------------------------------------------
// Nonce derivation
// ---------------------------------------------------------------------------

/**
 * These deploy, since nonce derivation happens inside a circuit. Worth the cost on
 * live too: it proves the deployed bytecode derives the same nonces as the local
 * artifact, which nothing else here checks.
 */
describe('ConfidentialNoteFungibleToken compatibility: nonce derivation', () => {
  let token: ConfidentialNoteFungibleTokenSimulator;

  beforeEach(async () => {
    token = await ConfidentialNoteFungibleTokenSimulator.create();
    token.wallet.nonceSeed = FIXED_SEED;
  });

  it('should derive the pinned nonce for a minted note', async () => {
    const minted = await token._mint(ALICE, 100n);

    expect(minted.nonce).toBe(
      83773517281668237013701764967495064806186604495330812658612081094756733863n,
    );
  });

  it('should derive the pinned nonce for a change note', async () => {
    await token._mintNote(NOTE, ALICE);
    token.wallet.secretKey = ALICE_SK;
    token.wallet.inputNote = NOTE;
    token.wallet.pathOverride = undefined;
    token.wallet.nonceSeed = FIXED_SEED;

    const [, change] = await token.transfer(BOB, 30n);

    // A different slot tag from the output note, which is why one reused seed
    // still yields two distinct nonces. The vector also covers the spend
    // binder: it is taken over `NOTE`'s nullifier.
    expect(change.nonce).toBe(
      77824219952240050540805526813721639986822092098692714850076464499317872093n,
    );
  });
});

// ---------------------------------------------------------------------------
// Published surface
// ---------------------------------------------------------------------------

/** Emitted with or without keys, so this section runs under `SKIP_ZK`. */
const contractInfo = () =>
  readContractInfo('MockConfidentialNoteFungibleToken');

describe('ConfidentialNoteFungibleToken compatibility: published surface', () => {
  /**
   * Every field costs something if it moves. `index` is the slot a client reads.
   * `storage` decides semantics: `HistoricMerkleTree` accepts a recently-current
   * root where `MerkleTree` accepts only the current one, which is what lets
   * concurrent spends coexist with mints. `depth` fixes capacity and is part of
   * the serialized form. `exported` decides whether clients see the slot.
   *
   * Asserted whole, so an ADDED or REMOVED slot fails too.
   */
  it('should keep the pinned ledger layout', () => {
    expect(ledgerSlots(contractInfo())).toStrictEqual([
      {
        name: '_isInitialized',
        index: 0,
        exported: true,
        storage: 'Cell',
        type: { 'type-name': 'Boolean' },
      },
      {
        name: '_instanceSalt',
        index: 1,
        exported: true,
        storage: 'Cell',
        type: { 'type-name': 'Bytes', length: 32 },
      },
      {
        name: '_commitments',
        index: 2,
        exported: true,
        storage: 'HistoricMerkleTree',
        depth: 32,
        type: { 'type-name': 'Bytes', length: 32 },
      },
      {
        name: '_nullifiers',
        index: 3,
        exported: true,
        storage: 'Set',
        type: { 'type-name': 'Bytes', length: 32 },
      },
      {
        name: '_issuedNonces',
        index: 4,
        exported: true,
        storage: 'Set',
        type: { 'type-name': 'Bytes', length: 32 },
      },
    ]);
  });

  /**
   * `proof` is the load-bearing flag: a circuit touching no ledger state has an
   * empty public transcript, gets no verifier key, and cannot be called on a
   * deployed instance. `_inputNote` is in that class, which is why the
   * functional suite skips it on live. Flipping one changes what a
   * client may do without changing any behaviour a test would notice.
   *
   * Keyed on `Circuits`, the generated type, so TS rejects this table if a circuit
   * is added, removed, or renamed. Sorted by name because dispatch is by name.
   */
  const SURFACE: Exhaustive<
    NameOf<Circuits<never>>,
    Pick<CircuitSurface, 'pure' | 'proof'>
  > = {
    _burn: { pure: false, proof: true },
    _consumeNote: { pure: false, proof: true },
    _inputNote: { pure: false, proof: false },
    _mint: { pure: false, proof: true },
    _mintNote: { pure: false, proof: true },
    _spenderPk: { pure: false, proof: true },
    _transfer: { pure: false, proof: true },
    burn: { pure: false, proof: true },
    commitOf: { pure: true, proof: false },
    derivePk: { pure: true, proof: false },
    issuedTagOf: { pure: true, proof: false },
    nullifierOf: { pure: true, proof: false },
    transfer: { pure: false, proof: true },
  };

  it('should keep the pinned circuit surface', () => {
    const expected = Object.entries(SURFACE)
      .map(([name, flags]) => ({ name, ...flags }))
      .sort((left, right) => left.name.localeCompare(right.name));

    expect(circuitSurface(contractInfo())).toStrictEqual(expected);
  });

  /**
   * The JSON and the generated `.d.ts` describe the same contract independently,
   * and a client trusts both, so they have to agree. `ProvableCircuits` is the
   * compiler's own answer to what a deployed instance accepts.
   */
  it('should agree with the generated circuit types on what is callable', () => {
    const provable = circuitSurface(contractInfo())
      .filter(({ proof }) => proof)
      .map(({ name }) => name);

    const declared: Exhaustive<NameOf<ProvableCircuits<never>>> = {
      _burn: true,
      _consumeNote: true,
      _mint: true,
      _mintNote: true,
      _spenderPk: true,
      _transfer: true,
      burn: true,
      transfer: true,
    };

    expect(provable).toStrictEqual(Object.keys(declared).sort());
  });

  /**
   * `Ledger` is the generated reader and holds only EXPORTED slots, so the exported
   * subset must be exactly its keys. Unexporting a slot removes it from every
   * client's reader while leaving it in the state, a silent break.
   *
   * The `Core__` prefix comes from the mock importing the module prefixed.
   */
  it('should export exactly the slots the generated Ledger type exposes', () => {
    const exported = ledgerSlots(contractInfo())
      .filter(({ exported }) => exported)
      .map(({ name }) => `Core_${name}`);

    const declared: Exhaustive<NameOf<Ledger>> = {
      Core__commitments: true,
      Core__instanceSalt: true,
      Core__isInitialized: true,
      Core__issuedNonces: true,
      Core__nullifiers: true,
    };

    expect(exported.sort()).toStrictEqual(Object.keys(declared).sort());
  });
});
