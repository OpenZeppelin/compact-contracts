/**
 * Compatibility claims for the ConfidentialNoteFungibleTokenReview extension.
 *
 * A reviewer depends on four things the other suites compare only against
 * themselves: the `ReviewRecord` layout, the four pad tags, the modular pad
 * and the limb order. Move any of them and every record already on chain
 * opens to garbage. This suite pins absolute values and the published
 * surface, as the core's does.
 *
 * A FAILURE HERE IS NOT A TEST TO FIX. Revert, or accept deliberately and
 * regenerate in the same commit; post-release it is a migration.
 *
 * PROVENANCE. Every value below was recorded under compiler 0.36.0 (language
 * 0.28.0, runtime 0.21.0), the CI compiler.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { ecMulGenerator } from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type CircuitSurface,
  circuitSurface,
  type Exhaustive,
  ledgerSlots,
  type NameOf,
  readContractInfo,
} from '#test-utils/compiler/contractInfo.js';
import {
  type Circuits,
  type Ledger,
  type ProvableCircuits,
  pureCircuits as review,
} from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenReview/contract/index.js';
import type {
  Circuits as ComposedCircuits,
  Ledger as ComposedLedger,
  ProvableCircuits as ComposedProvableCircuits,
} from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenReviewed/contract/index.js';
import {
  ConfidentialNoteFungibleTokenReviewSimulator,
  type Identifier,
  type ReviewRecord,
} from './simulators/ConfidentialNoteFungibleTokenReviewSimulator.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Deterministic 32 bytes from a label. */
const bytes32 = (label: string): Uint8Array => {
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode(label));
  return bytes;
};

const MAX_U248 = (1n << 248n) - 1n;

/** Stands in for wallet randomness, the only non-deterministic input. */
const FIXED_SEED = bytes32('FIXED-REVIEW-SEED');

const REVIEWER_SCALAR = 111222333444555n;
const REVIEWER_KEY = ecMulGenerator(REVIEWER_SCALAR);
const SLOT = bytes32('CNFT:review:golden');

/** 32 distinct non-zero bytes, so the limb order is pinned too. */
const OWNER: Identifier = {
  is_left: true,
  left: Uint8Array.from({ length: 32 }, (_, i) => i + 1),
  right: { bytes: new Uint8Array(32) },
};
const NOTE = { value: 100n, nonce: 7n };

/** `_review(REVIEWER_KEY, OWNER, 100, 7, SLOT)` under `FIXED_SEED`. */
const PINNED_RECORD: ReviewRecord = {
  reviewerKey: {
    x: 40782113241433830408158481806609677127829655822218902285927854450136695467452n,
    y: 32440273651805406647758002546664373684173538198442390866331885461612984344107n,
  },
  ephemeralPk: {
    x: 25053478258939958127671770717698769228960644376884336312714783629337971935502n,
    y: 31656880646167641739792584398302900475354041828348266173673483923518379289442n,
  },
  valueCt:
    380623184760472702328408031327393901248847878565254000117752349497905619561n,
  nonceCt:
    334772488649734262347443227915111524026845943359017398595926980700558017631n,
  ownerLoCt:
    233624873200756449133742266784391699432942473521346917081309836081516334654n,
  ownerHiCt:
    367629719576925605489701505665025150591317946205052352367834491065382793136n,
};

const sourceOf = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

const EXTENSION_SOURCE = sourceOf(
  '../ConfidentialNoteFungibleTokenReview.compact',
);

const TOKEN_DIR = new URL('../../', import.meta.url);

/** Every other Compact source under `contracts/src/token`, mocks included. */
const OTHER_SOURCES: readonly string[] = readdirSync(TOKEN_DIR, {
  encoding: 'utf8',
  recursive: true,
})
  .filter(
    (file) =>
      file.endsWith('.compact') &&
      file !== 'extensions/ConfidentialNoteFungibleTokenReview.compact',
  )
  .map((file) => readFileSync(new URL(file, TOKEN_DIR), 'utf8'));

/** Source lines with doc and line comments dropped, so usage snippets do not count. */
const codeOf = (source: string): string =>
  source
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        !line.startsWith('*') &&
        !line.startsWith('/*') &&
        !line.startsWith('//'),
    )
    .join('\n');

/** The distinct `pad(32, "...")` literals in a source's code, in order of appearance. */
const tagsOf = (source: string): string[] => [
  ...new Set(
    [...codeOf(source).matchAll(/pad\(32, "([^"]+)"\)/g)].map(([, tag]) => tag),
  ),
];

// ---------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenReview compatibility: wire format', () => {
  let token: ConfidentialNoteFungibleTokenReviewSimulator;

  beforeEach(async () => {
    token = await ConfidentialNoteFungibleTokenReviewSimulator.create({
      wallet: { reviewSeed: FIXED_SEED },
    });
    await token._addReviewer(REVIEWER_KEY);
  });

  // Deploys, since the pad runs inside a circuit. On live it proves the
  // deployed bytecode pads as the local artifact does.
  it('should pad a known note to the pinned record', async () => {
    await token._review(REVIEWER_KEY, OWNER, NOTE.value, NOTE.nonce, SLOT);
    const [record] = [...(await token.getPublicState()).Review__reviewTrail];

    expect(record).toStrictEqual(PINNED_RECORD);
  });

  // Pure, so it pins the reviewer side on its own: the shared point, the four
  // tags, the modular pad and the limb order, without a deployment.
  it('should open the pinned record to the known note and owner', () => {
    expect(review.recoverRecord(PINNED_RECORD, REVIEWER_SCALAR)).toStrictEqual({
      value: NOTE.value,
      nonce: NOTE.nonce,
      ownerLo: 0x100f0e0d0c0b0a090807060504030201n,
      ownerHi: 0x201f1e1d1c1b1a191817161514131211n,
    });
    expect(
      review.ownerOf(
        0x100f0e0d0c0b0a090807060504030201n,
        0x201f1e1d1c1b1a191817161514131211n,
      ),
    ).toStrictEqual(OWNER);
  });

  it('should keep the pinned domain tags', () => {
    expect(tagsOf(EXTENSION_SOURCE)).toStrictEqual([
      'CNFT:review:e',
      'CNFT:review:value',
      'CNFT:review:nonce',
      'CNFT:review:owner:lo',
      'CNFT:review:owner:hi',
    ]);
  });

  it('should share none of its tags with another source under contracts/src/token', () => {
    const others = new Set(OTHER_SOURCES.flatMap(tagsOf));

    expect(others.size).toBeGreaterThan(0);
    expect(
      tagsOf(EXTENSION_SOURCE).filter((tag) => others.has(tag)),
    ).toStrictEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Published surface: the extension alone
// ---------------------------------------------------------------------------

/**
 * The trail's element type as the compiler reports it. `maxval` arrives as a
 * JSON number, so it is only the nearest double to `2^248 - 1`.
 */
const PAD_TYPE = { 'type-name': 'Uint', maxval: Number(MAX_U248) };

const REVIEWERS_SLOT_TYPE = { 'type-name': 'JubjubPoint' };

const RECORD_SLOT_TYPE = {
  'type-name': 'Struct',
  name: 'ReviewRecord',
  elements: [
    { name: 'reviewerKey', type: { 'type-name': 'JubjubPoint' } },
    { name: 'ephemeralPk', type: { 'type-name': 'JubjubPoint' } },
    { name: 'valueCt', type: PAD_TYPE },
    { name: 'nonceCt', type: PAD_TYPE },
    { name: 'ownerLoCt', type: PAD_TYPE },
    { name: 'ownerHiCt', type: PAD_TYPE },
  ],
};

describe('ConfidentialNoteFungibleTokenReview compatibility: published surface', () => {
  const contractInfo = () =>
    readContractInfo(
      'token/extensions/test/mocks/MockConfidentialNoteFungibleTokenReview',
    );

  it('should keep the pinned ledger layout', () => {
    expect(ledgerSlots(contractInfo())).toStrictEqual([
      {
        name: '_reviewers',
        index: 0,
        exported: true,
        storage: 'Set',
        type: REVIEWERS_SLOT_TYPE,
      },
      {
        name: '_reviewTrail',
        index: 1,
        exported: true,
        storage: 'List',
        type: RECORD_SLOT_TYPE,
      },
    ]);
  });

  const SURFACE: Exhaustive<
    NameOf<Circuits<never>>,
    Pick<CircuitSurface, 'pure' | 'proof'>
  > = {
    _addReviewer: { pure: false, proof: true },
    _removeReviewer: { pure: false, proof: true },
    _review: { pure: false, proof: true },
    ownerOf: { pure: true, proof: false },
    recoverRecord: { pure: true, proof: false },
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
      _addReviewer: true,
      _removeReviewer: true,
      _review: true,
    };

    expect(provable).toStrictEqual(Object.keys(declared).sort());
  });

  it('should export exactly the slots the generated Ledger type exposes', () => {
    const exported = ledgerSlots(contractInfo())
      .filter(({ exported }) => exported)
      .map(({ name }) => `Review_${name}`);

    const declared: Exhaustive<NameOf<Ledger>> = {
      Review__reviewers: true,
      Review__reviewTrail: true,
    };

    expect(exported.sort()).toStrictEqual(Object.keys(declared).sort());
  });
});

// ---------------------------------------------------------------------------
// Published surface: composed with the core
// ---------------------------------------------------------------------------

/**
 * The composition appends two slots after the core's three. A reviewer reads
 * the trail by that index, so the core's layout is re-pinned here in full.
 */
describe('ConfidentialNoteFungibleTokenReview compatibility: composed surface', () => {
  const contractInfo = () =>
    readContractInfo(
      'token/extensions/test/mocks/MockConfidentialNoteFungibleTokenReviewed',
    );

  it('should keep the pinned ledger layout', () => {
    expect(ledgerSlots(contractInfo())).toStrictEqual([
      {
        name: '_commitments',
        index: 0,
        exported: true,
        storage: 'HistoricMerkleTree',
        depth: 32,
        type: { 'type-name': 'Bytes', length: 32 },
      },
      {
        name: '_nullifiers',
        index: 1,
        exported: true,
        storage: 'Set',
        type: { 'type-name': 'Bytes', length: 32 },
      },
      {
        name: '_issuedNonces',
        index: 2,
        exported: true,
        storage: 'Set',
        type: { 'type-name': 'Bytes', length: 32 },
      },
      {
        name: '_reviewers',
        index: 3,
        exported: true,
        storage: 'Set',
        type: REVIEWERS_SLOT_TYPE,
      },
      {
        name: '_reviewTrail',
        index: 4,
        exported: true,
        storage: 'List',
        type: RECORD_SLOT_TYPE,
      },
      {
        name: '_noteSalt',
        index: 5,
        exported: false,
        storage: 'Cell',
        type: { 'type-name': 'Bytes', length: 32 },
      },
    ]);
  });

  const SURFACE: Exhaustive<
    NameOf<ComposedCircuits<never>>,
    Pick<CircuitSurface, 'pure' | 'proof'>
  > = {
    _addReviewer: { pure: false, proof: true },
    _removeReviewer: { pure: false, proof: true },
    burn: { pure: false, proof: true },
    commitOf: { pure: true, proof: false },
    deriveIdentifier: { pure: true, proof: false },
    mint: { pure: false, proof: true },
    nullifierOf: { pure: true, proof: false },
    ownerOf: { pure: true, proof: false },
    recoverRecord: { pure: true, proof: false },
    transfer: { pure: false, proof: true },
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
      _addReviewer: true,
      _removeReviewer: true,
      burn: true,
      mint: true,
      transfer: true,
    };

    expect(provable).toStrictEqual(Object.keys(declared).sort());
  });

  it('should export exactly the slots the generated Ledger type exposes', () => {
    const exported = ledgerSlots(contractInfo())
      .filter(({ exported }) => exported)
      .map(({ name }) =>
        name.startsWith('_review') ? `Review_${name}` : `Core_${name}`,
      );

    const declared: Exhaustive<NameOf<ComposedLedger>> = {
      Core__commitments: true,
      Core__issuedNonces: true,
      Core__nullifiers: true,
      Review__reviewers: true,
      Review__reviewTrail: true,
    };

    expect(exported.sort()).toStrictEqual(Object.keys(declared).sort());
  });
});
