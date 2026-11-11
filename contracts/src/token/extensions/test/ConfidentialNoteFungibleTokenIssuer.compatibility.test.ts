/**
 * Compatibility claims for the ConfidentialNoteFungibleTokenIssuer extension.
 *
 * An issuer derives its key off-chain and a deploy script installs it, so the
 * key derivation is wire format: move the tag, the salt binding or the `Prf`
 * layout and no secret derives the installed key any more. A client also reads
 * the ledger by slot and calls circuits by name. This suite pins absolute
 * values and the published surface, as the core's does.
 *
 * A FAILURE HERE IS NOT A TEST TO FIX. Revert, or accept deliberately and
 * regenerate in the same commit; post-release it is a migration. Never
 * regenerate a value without deciding which of the three it is.
 *
 * PROVENANCE. Every value below was recorded under compiler 0.36.0 (language
 * 0.28.0, runtime 0.21.0), the CI compiler.
 */

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type CircuitSurface,
  circuitSurface,
  type Exhaustive,
  ledgerSlots,
  type NameOf,
  readContractInfo,
} from '#test-utils/compiler/contractInfo.js';
import {
  type Circuits as ComposedCircuits,
  type Ledger as ComposedLedger,
  type ProvableCircuits as ComposedProvableCircuits,
  pureCircuits as composed,
} from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenIssued/contract/index.js';
import {
  type Circuits,
  pureCircuits as issuer,
  type Ledger,
  type ProvableCircuits,
} from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenIssuer/contract/index.js';
import { PrfSimulator } from '../../../crypto/test/simulators/PrfSimulator.js';
import { INSTANCE_SALT } from '../../test/witnesses/ConfidentialNoteFungibleTokenWitnesses.js';
import { ConfidentialNoteFungibleTokenIssuedSimulator } from './simulators/ConfidentialNoteFungibleTokenIssuedSimulator.js';
import { ConfidentialNoteFungibleTokenIssuerSimulator } from './simulators/ConfidentialNoteFungibleTokenIssuerSimulator.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A deterministic 32-byte secret key from a label. */
const secretKey = (label: string): Uint8Array => {
  const sk = new Uint8Array(32);
  sk.set(new TextEncoder().encode(label));
  return sk;
};

/** The core compatibility spec's fixtures, so the two pins share inputs. */
const ALICE_SK = secretKey('ALICE');
const SALT = INSTANCE_SALT;

/** `derivePk(ALICE_SK, SALT)` on the issuer. */
const PINNED_ISSUER_PK =
  426067052262719536046677308300902963571916559121608027424922956751582302608n;

/** `derivePk(ALICE_SK, SALT)` on the core, as its compatibility spec pins it. */
const PINNED_CORE_PK =
  262435359501940701077170570879675701887870845687505442111448399011781289948n;

const ISSUER_TAG = 'CNFT:issuer:pk';
const CORE_TAG = 'CNFT:pk';

const tag = (label: string): Uint8Array => secretKey(label);

const sourceOf = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

const EXTENSION_SOURCE = sourceOf(
  '../ConfidentialNoteFungibleTokenIssuer.compact',
);
const CORE_SOURCE = sourceOf('../../ConfidentialNoteFungibleToken.compact');

/** The distinct `pad(32, "...")` literals in a source, in order of appearance. */
const tagsOf = (source: string): string[] => [
  ...new Set(
    [...source.matchAll(/pad\(32, "([^"]+)"\)/g)].map(([, found]) => found),
  ),
];

/** The tag a module's `derivePk` body hashes under. */
const derivePkTagOf = (source: string): string | undefined =>
  source.match(
    /pure circuit derivePk\([^)]*\): Field \{\s*return Prf_prfField<Bytes<32>>\(pad\(32, "([^"]+)"\)/,
  )?.[1];

/** Source lines with doc and line comments dropped. */
const codeLines = (source: string): string[] =>
  source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => !line.startsWith('*') && !line.startsWith('//'));

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenIssuer compatibility: key derivation', () => {
  // Pure circuits: no deployment, so these run on either backend.

  it('should derive the pinned issuer key from a known secret and salt', () => {
    expect(issuer.derivePk(ALICE_SK, SALT)).toBe(PINNED_ISSUER_PK);
  });

  it('should derive the same key through the composed mock', () => {
    expect(composed.deriveIssuerPk(ALICE_SK, SALT)).toBe(PINNED_ISSUER_PK);
  });

  it('should give one secret and one salt two different keys in the composition', () => {
    const identity = composed.derivePk(ALICE_SK, SALT);
    const issuerKey = composed.deriveIssuerPk(ALICE_SK, SALT);

    expect(identity).toBe(PINNED_CORE_PK);
    expect(issuerKey).toBe(PINNED_ISSUER_PK);
    expect(issuerKey).not.toBe(identity);
  });

  it('should derive distinct issuer keys for one secret under distinct salts', () => {
    expect(issuer.derivePk(ALICE_SK, SALT)).not.toBe(
      issuer.derivePk(ALICE_SK, secretKey('OTHER-SALT')),
    );
  });

  // Deploys, since the gate derives the key inside a circuit. On live it
  // proves the deployed bytecode derives what the pure circuit does.
  it('should install the pinned key and pass the gate for its secret', async () => {
    const token = await ConfidentialNoteFungibleTokenIssuerSimulator.create({
      wallet: { secretKey: ALICE_SK },
      instanceSalt: SALT,
    });

    expect((await token.getPublicState()).Issuer__issuerPk).toBe(
      PINNED_ISSUER_PK,
    );
    await token.assertOnlyIssuer();
  });
});

// ---------------------------------------------------------------------------
// Tags and the Prf layout
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenIssuer compatibility: tags', () => {
  let prf: PrfSimulator;

  beforeAll(async () => {
    prf = await PrfSimulator.create();
  });

  it('should keep the pinned issuer tag', () => {
    expect(tagsOf(EXTENSION_SOURCE)).toStrictEqual([ISSUER_TAG]);
    expect(derivePkTagOf(EXTENSION_SOURCE)).toBe(ISSUER_TAG);
  });

  it("should keep the core's identity tag on its derivePk", () => {
    expect(derivePkTagOf(CORE_SOURCE)).toBe(CORE_TAG);
  });

  it('should share no tag with the core', () => {
    const coreTags = new Set(tagsOf(CORE_SOURCE));

    expect(coreTags.has(CORE_TAG)).toBe(true);
    expect(ISSUER_TAG).not.toBe(CORE_TAG);
    for (const found of tagsOf(EXTENSION_SOURCE)) {
      expect(coreTags.has(found)).toBe(false);
    }
  });

  // Deploys `MockPrf`: both pinned keys are `Prf.prfField` over
  // `{tag, salt, sk}`, each under its own tag.
  it('should derive both pinned keys as Prf.prfField under their tags', async () => {
    expect(await prf.prfFieldOfBytes(tag(ISSUER_TAG), SALT, ALICE_SK)).toBe(
      PINNED_ISSUER_PK,
    );
    expect(await prf.prfFieldOfBytes(tag(CORE_TAG), SALT, ALICE_SK)).toBe(
      PINNED_CORE_PK,
    );
  });
});

// ---------------------------------------------------------------------------
// Published surface: the extension alone
// ---------------------------------------------------------------------------

/** Emitted with or without keys, so this section runs under `SKIP_ZK`. */
describe('ConfidentialNoteFungibleTokenIssuer compatibility: published surface', () => {
  const contractInfo = () =>
    readContractInfo(
      'token/extensions/test/mocks/MockConfidentialNoteFungibleTokenIssuer',
    );

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
        name: '_issuerPk',
        index: 2,
        exported: true,
        storage: 'Cell',
        type: { 'type-name': 'Field' },
      },
    ]);
  });

  // `contract-info.json` carries no `sealed` flag, so the source pins it. A
  // sealed field is writable only during construction.
  it('should keep the flag and the salt sealed and the key writable', () => {
    const fields = codeLines(EXTENSION_SOURCE).filter((line) =>
      /^export (sealed )?ledger /.test(line),
    );

    expect(fields).toStrictEqual([
      'export sealed ledger _isInitialized: Boolean;',
      'export sealed ledger _instanceSalt: Bytes<32>;',
      'export ledger _issuerPk: Field;',
    ]);
  });

  const SURFACE: Exhaustive<
    NameOf<Circuits<never>>,
    Pick<CircuitSurface, 'pure' | 'proof'>
  > = {
    _setIssuer: { pure: false, proof: true },
    assertOnlyIssuer: { pure: false, proof: true },
    derivePk: { pure: true, proof: false },
    rotateIssuer: { pure: false, proof: true },
  };

  it('should keep the pinned circuit surface', () => {
    const expected = Object.entries(SURFACE)
      .map(([name, flags]) => ({ name, ...flags }))
      .sort((left, right) => left.name.localeCompare(right.name));

    expect(circuitSurface(contractInfo())).toStrictEqual(expected);
  });

  it('should agree with the generated circuit types on what is callable', () => {
    const provable = circuitSurface(contractInfo())
      .filter(({ proof }) => proof)
      .map(({ name }) => name);

    const declared: Exhaustive<NameOf<ProvableCircuits<never>>> = {
      _setIssuer: true,
      assertOnlyIssuer: true,
      rotateIssuer: true,
    };

    expect(provable).toStrictEqual(Object.keys(declared).sort());
  });

  it('should export exactly the slots the generated Ledger type exposes', () => {
    const exported = ledgerSlots(contractInfo())
      .filter(({ exported }) => exported)
      .map(({ name }) => `Issuer_${name}`);

    const declared: Exhaustive<NameOf<Ledger>> = {
      Issuer__instanceSalt: true,
      Issuer__isInitialized: true,
      Issuer__issuerPk: true,
    };

    expect(exported.sort()).toStrictEqual(Object.keys(declared).sort());
  });

  // A wallet implements the witness by name, so the name and type are surface.
  it('should keep the pinned witness', () => {
    expect(
      contractInfo().witnesses.map((witness) => ({
        name: witness.name,
        arguments: witness.arguments,
        result: witness['result type'],
      })),
    ).toStrictEqual([
      {
        name: 'wit_ConfidentialNoteIssuerSK',
        arguments: [],
        result: { 'type-name': 'Bytes', length: 32 },
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Published surface: composed with the core
// ---------------------------------------------------------------------------

/**
 * The composition appends the issuer's three slots after the core's five.
 * Both modules export `_isInitialized` and `_instanceSalt`: under distinct
 * prefixes they are separate slots, so names repeat and only the index tells
 * them apart.
 */
describe('ConfidentialNoteFungibleTokenIssuer compatibility: composed surface', () => {
  const contractInfo = () =>
    readContractInfo(
      'token/extensions/test/mocks/MockConfidentialNoteFungibleTokenIssued',
    );

  /** The import prefix each slot index belongs to. */
  const PREFIX_BY_INDEX = [
    'Core_',
    'Core_',
    'Core_',
    'Core_',
    'Core_',
    'Issuer_',
    'Issuer_',
    'Issuer_',
  ];

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
      {
        name: '_isInitialized',
        index: 5,
        exported: true,
        storage: 'Cell',
        type: { 'type-name': 'Boolean' },
      },
      {
        name: '_instanceSalt',
        index: 6,
        exported: true,
        storage: 'Cell',
        type: { 'type-name': 'Bytes', length: 32 },
      },
      {
        name: '_issuerPk',
        index: 7,
        exported: true,
        storage: 'Cell',
        type: { 'type-name': 'Field' },
      },
    ]);
  });

  it('should hold two flags and two salts with one value each after construction', async () => {
    const token = await ConfidentialNoteFungibleTokenIssuedSimulator.create({
      issuerWallet: { secretKey: ALICE_SK },
      instanceSalt: SALT,
    });
    const state = await token.getPublicState();

    expect(state.Core__isInitialized).toBe(true);
    expect(state.Issuer__isInitialized).toBe(true);
    expect(state.Core__instanceSalt).toStrictEqual(SALT);
    expect(state.Issuer__instanceSalt).toStrictEqual(SALT);
    expect(state.Issuer__issuerPk).toBe(PINNED_ISSUER_PK);
  });

  const SURFACE: Exhaustive<
    NameOf<ComposedCircuits<never>>,
    Pick<CircuitSurface, 'pure' | 'proof'>
  > = {
    deriveIssuerPk: { pure: true, proof: false },
    derivePk: { pure: true, proof: false },
    mint: { pure: false, proof: true },
    rotateIssuer: { pure: false, proof: true },
  };

  it('should keep the pinned circuit surface', () => {
    const expected = Object.entries(SURFACE)
      .map(([name, flags]) => ({ name, ...flags }))
      .sort((left, right) => left.name.localeCompare(right.name));

    expect(circuitSurface(contractInfo())).toStrictEqual(expected);
  });

  it('should agree with the generated circuit types on what is callable', () => {
    const provable = circuitSurface(contractInfo())
      .filter(({ proof }) => proof)
      .map(({ name }) => name);

    const declared: Exhaustive<NameOf<ComposedProvableCircuits<never>>> = {
      mint: true,
      rotateIssuer: true,
    };

    expect(provable).toStrictEqual(Object.keys(declared).sort());
  });

  it('should export exactly the slots the generated Ledger type exposes', () => {
    const exported = ledgerSlots(contractInfo())
      .filter(({ exported }) => exported)
      .map(({ name, index }) => `${PREFIX_BY_INDEX[index]}${name}`);

    const declared: Exhaustive<NameOf<ComposedLedger>> = {
      Core__commitments: true,
      Core__instanceSalt: true,
      Core__isInitialized: true,
      Core__issuedNonces: true,
      Core__nullifiers: true,
      Issuer__instanceSalt: true,
      Issuer__isInitialized: true,
      Issuer__issuerPk: true,
    };

    expect(exported.sort()).toStrictEqual(Object.keys(declared).sort());
  });
});
