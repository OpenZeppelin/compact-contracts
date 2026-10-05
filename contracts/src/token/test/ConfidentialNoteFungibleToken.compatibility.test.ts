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
 *      `OZ:cnt:` to `OZ:note:` rename. Regenerate in the same commit and say so.
 *   3. Post-release, it is a breaking change needing a migration.
 *
 * Never regenerate a value without deciding which of the three it is.
 *
 * PROVENANCE. Every value below is byte-identical under compiler 0.31.0 (CI) and
 * 0.31.1 (current local), on language 0.23.0 and runtime 0.16.0. Digests, layout,
 * and circuit surface alike.
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
 * `OZ:note:pk`, `OZ:note:commit`, `OZ:note:null`, `OZ:note:issued`,
 * `OZ:note:nonce:core`, `OZ:note:mint`, `OZ:note:out`, `OZ:note:chng`. So is
 * each preimage's field order, and the binder every derived nonce is taken
 * over: the recipient for a mint, the consumed note's nullifier for a spend.
 *
 * `derivePk` hashes `(OZ:note:pk, salt, sk)`, the circuits' salt being the
 * deployment's `_instanceSalt`. Pinned because every commitment is taken over
 * its output.
 */
describe('ConfidentialNoteFungibleToken compatibility: digests', () => {
  // Pure circuits: no deployment, so these run on either backend.

  it('should derive the pinned pk from a known secret and salt', () => {
    expect(core.derivePk(ALICE_SK, SALT)).toBe(
      404079673548458092994380058248597846216344394093932603328224206768657321132n,
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
      '0xbd8de8666508c3414f6476ba17734b6e408b315d7694afddf081b285b37472a5',
    );
  });

  it('should nullify a known note to the pinned digest', () => {
    expect(hex(core.nullifierOf(NOTE))).toBe(
      '0xeea890f67c3c07ea1850ba30f4059f45313d9294dcd7fbffce5a393dd69ceff9',
    );
  });

  // Same preimage shape as the nullifier under a different domain, so the pair
  // pins that the two tags cannot be read as one another.
  it('should tag a known note to the pinned digest', () => {
    expect(hex(core.issuedTagOf(NOTE))).toBe(
      '0x20d63e4db2f5590754068c9cb78d7357944e203ccab2de1b48477d677fc7a87c',
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
      175043109306300762329028251661519816384523072696833120721788531167794284186n,
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
      8152819341088759731288825067977169974517950477747020773559273934289734179n,
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
