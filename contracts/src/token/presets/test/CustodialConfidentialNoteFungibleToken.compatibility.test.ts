/**
 * Compatibility claims for the CustodialConfidentialNoteFungibleToken preset.
 *
 * Every other suite compares the preset against itself, so all of them stay
 * green when the wire format moves. This suite pins absolute values and the
 * published surface, the things an outside party depends on: a deploy script
 * derives the issuer id off-chain, a holder derives its note key and rebuilds
 * its commitments, and a client reads the ledger by slot and calls circuits by
 * name.
 *
 * A FAILURE HERE IS NOT A TEST TO FIX, in order of likelihood:
 *
 *   1. Revert. Most failures are accidental.
 *   2. Accept deliberately. Pre-release nothing is deployed to break.
 *      Regenerate in the same commit and say so.
 *   3. Post-release, it is a breaking change needing a migration.
 *
 * Never regenerate a value without deciding which of the three it is.
 *
 * PROVENANCE. Every value below was recorded under compiler 0.36.0 (CI,
 * language 0.28.0, runtime 0.21.0). Digests, layout, and circuit surface alike.
 *
 * Recorded, not asserted: a pinned `compiler-version` would fail on a toolchain
 * bump with nothing broken. The enforceable pin is
 * `.github/actions/setup/action.yml`. On a toolchain bump, rebuild under both
 * compilers and diff instead of assuming.
 */

import { readFileSync } from 'node:fs';
import {
  CompactTypeBytes,
  CompactTypeVector,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type CircuitInfo,
  type CompactTypeInfo,
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
  PureCircuits,
} from '../../../../artifacts/token/presets/test/mocks/MockCustodialConfidentialNoteFungibleToken/contract/index.js';
import { pureCircuits as preset } from '../../../../artifacts/token/presets/test/mocks/MockCustodialConfidentialNoteFungibleToken/contract/index.js';
import {
  type Account,
  CustodialConfidentialNoteFungibleTokenSimulator,
  type Note,
} from './simulators/CustodialConfidentialNoteFungibleTokenSimulator.js';
import { NOTE_SALT } from './witnesses/CustodialConfidentialNoteFungibleTokenWitnesses.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Deterministic 32 bytes from a label; also Compact's `pad(32, label)`. */
const bytes32 = (label: string): Uint8Array => {
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode(label));
  return bytes;
};

/** Lowercase `0x…` rendering, so a failed vector prints readably. */
const hex = (bytes: Uint8Array): string =>
  `0x${Buffer.from(bytes).toString('hex')}`;

const TAG = bytes32('AuthPrfAddr:account');

/** The authenticator and core compatibility specs' inputs, so the pins share them. */
const ALICE_SK = bytes32('ALICE');
const SALT = bytes32('SALT');
const NOTE: Note = { value: 100n, nonce: 7n };

/** `deriveAccount(ALICE_SK, SALT).left`, as the AuthPrfAddr suite pins it. */
const PINNED_ACCOUNT =
  '0xaf55d489c3c0228cece2bb86074c0bab748bd9e2419f5d1ab06bc1aa7ac6d8db';

/** `commitOf(NOTE, deriveAccount(ALICE_SK, SALT))`. */
const PINNED_COMMITMENT =
  '0xc544609033d9b69f5679dd94712dab1349fc7a51908059b21ba3a3f10d9bbdf8';

/** `nullifierOf(NOTE)`, as the core suite pins it. */
const PINNED_NULLIFIER =
  '0xfb3222fcc782cf98276a6d821788f1b81a78aa14aca248290de1fda823c30f17';

/** `left(persistentHash([tag, salt, sk]))`, the authenticator's account. */
const referenceAccount = (sk: Uint8Array, salt: Uint8Array): Account => ({
  is_left: true,
  left: persistentHash(new CompactTypeVector(3, new CompactTypeBytes(32)), [
    TAG,
    salt,
    sk,
  ]),
  right: { bytes: new Uint8Array(32) },
});

const PRESET_SOURCE = readFileSync(
  new URL('../CustodialConfidentialNoteFungibleToken.compact', import.meta.url),
  'utf8',
);

/** Source lines with doc and line comments dropped. */
const codeLines = (source: string): string[] =>
  source
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        !line.startsWith('*') &&
        !line.startsWith('/*') &&
        !line.startsWith('//'),
    );

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/**
 * The issuer id and every note key are `AuthPrfAddr` accounts. A deploy
 * script installs an issuer id it derived off-chain, and a holder hands out
 * its note key, so the derivation is wire format.
 */
describe('CustodialConfidentialNoteFungibleToken compatibility: accounts', () => {
  // Pure circuits: no deployment, so these run on either backend.

  it('should derive the pinned account for a known secret and salt', () => {
    expect(hex(preset.deriveAccount(ALICE_SK, SALT).left)).toBe(PINNED_ACCOUNT);
  });

  it('should match a persistentHash over the tag, salt and secret key', () => {
    expect(preset.deriveAccount(ALICE_SK, SALT)).toStrictEqual(
      referenceAccount(ALICE_SK, SALT),
    );
  });

  // Deploys, since the gate derives the id inside a circuit. On live it proves
  // the deployed bytecode derives what the pure circuit does.
  it('should install the pinned issuer and pass the gate for its secret', async () => {
    const token = await CustodialConfidentialNoteFungibleTokenSimulator.create({
      wallet: { secretKey: ALICE_SK },
      issuerSalt: SALT,
    });

    expect(hex((await token.owner()).left)).toBe(PINNED_ACCOUNT);
    expect(hex((await token.getPublicState()).Token_Ownable__owner.left)).toBe(
      PINNED_ACCOUNT,
    );
    await expect(
      token.mint(preset.deriveAccount(ALICE_SK, NOTE_SALT), 1n),
    ).resolves.toMatchObject({ value: 1n });
  });
});

// ---------------------------------------------------------------------------
// Note digests
// ---------------------------------------------------------------------------

/**
 * The core instantiated with `Either<Bytes<32>, ContractAddress>` keys. The
 * key type is part of the commitment preimage, so this vector is the preset's
 * own. The nullifier takes no key and equals the core's.
 */
describe('CustodialConfidentialNoteFungibleToken compatibility: note digests', () => {
  it('should commit a known note to the pinned digest', () => {
    expect(
      hex(preset.commitOf(NOTE, preset.deriveAccount(ALICE_SK, SALT))),
    ).toBe(PINNED_COMMITMENT);
  });

  it('should nullify a known note to the pinned digest', () => {
    expect(hex(preset.nullifierOf(NOTE))).toBe(PINNED_NULLIFIER);
  });
});

// ---------------------------------------------------------------------------
// Published surface
// ---------------------------------------------------------------------------

const MOCK =
  'token/presets/test/mocks/MockCustodialConfidentialNoteFungibleToken';
const EXAMPLE = 'token/examples/CustodialConfidentialNoteFungibleTokenExample';

const BYTES_32: CompactTypeInfo = { 'type-name': 'Bytes', length: 32 };
const BOOLEAN: CompactTypeInfo = { 'type-name': 'Boolean' };
const FIELD: CompactTypeInfo = { 'type-name': 'Field' };
const UNIT: CompactTypeInfo = { 'type-name': 'Tuple', types: [] };
// JSON numbers, so `2^n - 1` reads back rounded to `2^n`.
const UINT_128: CompactTypeInfo = {
  'type-name': 'Uint',
  maxval: Number((1n << 128n) - 1n),
};
const ACCOUNT: CompactTypeInfo = {
  'type-name': 'Struct',
  name: 'Either',
  elements: [
    { name: 'is_left', type: BOOLEAN },
    { name: 'left', type: BYTES_32 },
    {
      name: 'right',
      type: {
        'type-name': 'Struct',
        name: 'ContractAddress',
        elements: [{ name: 'bytes', type: BYTES_32 }],
      },
    },
  ],
};
const NOTE_TYPE: CompactTypeInfo = {
  'type-name': 'Struct',
  name: 'Note',
  elements: [
    { name: 'value', type: UINT_128 },
    { name: 'nonce', type: FIELD },
  ],
};
const PATH: CompactTypeInfo = {
  'type-name': 'Vector',
  length: 32,
  type: {
    'type-name': 'Struct',
    name: 'MerkleTreePathEntry',
    elements: [
      {
        name: 'sibling',
        type: {
          'type-name': 'Struct',
          name: 'MerkleTreeDigest',
          elements: [{ name: 'field', type: FIELD }],
        },
      },
      { name: 'goes_left', type: BOOLEAN },
    ],
  },
};

const byName = <T extends { name: string }>(left: T, right: T): number =>
  left.name.localeCompare(right.name);

describe('CustodialConfidentialNoteFungibleToken compatibility: published surface', () => {
  let mock: ReturnType<typeof readContractInfo>;

  beforeAll(() => {
    mock = readContractInfo(MOCK);
  });

  /**
   * `index` is the slot a client reads and `exported` whether it can. Asserted
   * whole, so an added or removed slot fails too. The preset's salts come
   * first, then the core's three slots, then `Ownable`'s two.
   */
  it('should keep the pinned ledger layout', () => {
    expect(ledgerSlots(mock)).toStrictEqual([
      {
        name: '_issuerSalt',
        index: 0,
        exported: true,
        storage: 'Cell',
        type: BYTES_32,
      },
      {
        name: '_noteSalt',
        index: 1,
        exported: true,
        storage: 'Cell',
        type: BYTES_32,
      },
      {
        name: '_commitments',
        index: 2,
        exported: true,
        storage: 'HistoricMerkleTree',
        depth: 32,
        type: BYTES_32,
      },
      {
        name: '_nullifiers',
        index: 3,
        exported: true,
        storage: 'Set',
        type: BYTES_32,
      },
      {
        name: '_issuedNonces',
        index: 4,
        exported: true,
        storage: 'Set',
        type: BYTES_32,
      },
      {
        name: '_isInitialized',
        index: 5,
        exported: true,
        storage: 'Cell',
        type: BOOLEAN,
      },
      {
        name: '_owner',
        index: 6,
        exported: true,
        storage: 'Cell',
        type: ACCOUNT,
      },
    ]);
  });

  // `contract-info.json` carries no `sealed` flag, so the source pins it. A
  // sealed field is writable only during construction.
  it('should keep both salts sealed', () => {
    const fields = codeLines(PRESET_SOURCE).filter((line) =>
      /^export (sealed )?ledger /.test(line),
    );

    expect(fields).toStrictEqual([
      'export sealed ledger _issuerSalt: Bytes<32>;',
      'export sealed ledger _noteSalt: Bytes<32>;',
    ]);
  });

  /**
   * Keyed on `Circuits`, the generated type, so a circuit added, removed or
   * renamed fails to compile. Argument order and result type are the circuit
   * signature.
   */
  const SURFACE: Exhaustive<
    NameOf<Circuits<never>>,
    Omit<CircuitInfo, 'name'>
  > = {
    burn: {
      pure: false,
      proof: true,
      arguments: [
        { name: 'value', type: UINT_128 },
        { name: 'note', type: NOTE_TYPE },
        { name: 'path', type: PATH },
      ],
      'result-type': NOTE_TYPE,
    },
    commitOf: {
      pure: true,
      proof: false,
      arguments: [
        { name: 'note', type: NOTE_TYPE },
        { name: 'pk', type: ACCOUNT },
      ],
      'result-type': BYTES_32,
    },
    deriveAccount: {
      pure: true,
      proof: false,
      arguments: [
        { name: 'secretKey', type: BYTES_32 },
        { name: 'salt', type: BYTES_32 },
      ],
      'result-type': ACCOUNT,
    },
    mint: {
      pure: false,
      proof: true,
      arguments: [
        { name: 'recipientPk', type: ACCOUNT },
        { name: 'value', type: UINT_128 },
      ],
      'result-type': NOTE_TYPE,
    },
    nullifierOf: {
      pure: true,
      proof: false,
      arguments: [{ name: 'note', type: NOTE_TYPE }],
      'result-type': BYTES_32,
    },
    owner: { pure: false, proof: true, arguments: [], 'result-type': ACCOUNT },
    transfer: {
      pure: false,
      proof: true,
      arguments: [
        { name: 'recipientPk', type: ACCOUNT },
        { name: 'value', type: UINT_128 },
        { name: 'note', type: NOTE_TYPE },
        { name: 'path', type: PATH },
      ],
      'result-type': { 'type-name': 'Tuple', types: [NOTE_TYPE, NOTE_TYPE] },
    },
    transferOwnership: {
      pure: false,
      proof: true,
      arguments: [{ name: 'newOwner', type: ACCOUNT }],
      'result-type': UNIT,
    },
  };

  it('should keep the pinned circuit surface', () => {
    const expected = Object.entries(SURFACE)
      .map(([name, info]) => ({ name, ...info }))
      .sort(byName);

    expect([...mock.circuits].sort(byName)).toStrictEqual(expected);
  });

  // A wallet implements the witnesses by name, so names and types are surface.
  it('should declare only the secret-key and seed witnesses', () => {
    expect(mock.witnesses).toStrictEqual([
      { name: 'wit_RandPrfExpandSeed', arguments: [], 'result type': BYTES_32 },
      { name: 'wit_AuthPrfAddrSK', arguments: [], 'result type': BYTES_32 },
    ]);
  });

  /**
   * The JSON and the generated `.d.ts` describe the same contract independently,
   * so they have to agree on what a deployed instance accepts and what runs
   * off-chain for free.
   */
  it('should agree with the generated circuit types on what is callable', () => {
    const surface = circuitSurface(mock);

    const provable: Exhaustive<NameOf<ProvableCircuits<never>>> = {
      burn: true,
      mint: true,
      owner: true,
      transfer: true,
      transferOwnership: true,
    };
    const pure: Exhaustive<NameOf<PureCircuits>> = {
      commitOf: true,
      deriveAccount: true,
      nullifierOf: true,
    };

    expect(
      surface.filter(({ proof }) => proof).map(({ name }) => name),
    ).toStrictEqual(Object.keys(provable).sort());
    expect(
      surface.filter(({ pure }) => pure).map(({ name }) => name),
    ).toStrictEqual(Object.keys(pure).sort());
    // Every impure circuit here touches the ledger, so all of them are provable.
    expect(surface.filter(({ pure, proof }) => !pure && !proof)).toStrictEqual(
      [],
    );
  });

  /**
   * `Ledger` is the generated reader and holds only exported slots. The keys
   * carry the import prefixes the mock re-exports them under.
   */
  it('should export exactly the slots the generated Ledger type exposes', () => {
    const PREFIX_BY_INDEX = [
      'Token_',
      'Token_',
      'Token_Core_',
      'Token_Core_',
      'Token_Core_',
      'Token_Ownable_',
      'Token_Ownable_',
    ];
    const exported = ledgerSlots(mock)
      .filter(({ exported }) => exported)
      .map(({ index, name }) => `${PREFIX_BY_INDEX[index]}${name}`);

    const declared: Exhaustive<NameOf<Ledger>> = {
      Token_Core__commitments: true,
      Token_Core__issuedNonces: true,
      Token_Core__nullifiers: true,
      Token_Ownable__isInitialized: true,
      Token_Ownable__owner: true,
      Token__issuerSalt: true,
      Token__noteSalt: true,
    };

    expect(exported.sort()).toStrictEqual(Object.keys(declared).sort());
  });

  /**
   * The example re-exports every preset circuit. The mock's extra `inits`
   * constructor argument is not in `contract-info.json`.
   */
  it('should give the example the mock surface, witnesses and ledger', () => {
    const example = readContractInfo(EXAMPLE);

    expect([...example.circuits].sort(byName)).toStrictEqual(
      [...mock.circuits].sort(byName),
    );
    expect(example.witnesses).toStrictEqual(mock.witnesses);
    expect(ledgerSlots(example)).toStrictEqual(ledgerSlots(mock));
  });
});
