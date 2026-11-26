/**
 * Compatibility claims for the ConfidentialNoteFungibleTokenAudit extension.
 *
 * An auditor depends on four things the other suites compare only against
 * themselves: the `AuditRecord` layout, the four pad tags, the modular pad and
 * the limb order. Move any of them and every record already on chain opens to
 * garbage. This suite pins absolute values and the published surface, as the
 * core's does.
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
  pureCircuits as audit,
  type Circuits,
  type Ledger,
  type ProvableCircuits,
} from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenAudit/contract/index.js';
import type {
  Circuits as ComposedCircuits,
  Ledger as ComposedLedger,
  ProvableCircuits as ComposedProvableCircuits,
} from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenAudited/contract/index.js';
import {
  type AuditRecord,
  ConfidentialNoteFungibleTokenAuditSimulator,
} from './simulators/ConfidentialNoteFungibleTokenAuditSimulator.js';

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
const FIXED_SEED = bytes32('FIXED-AUDIT-SEED');

const AUDIT_SCALAR = 111222333444555n;
const AUDIT_KEY = ecMulGenerator(AUDIT_SCALAR);
const SLOT = bytes32('CNFT:audit:golden');

/** Owner bytes `0x01..0x20` and the limbs they split into. */
const OWNER = {
  is_left: true,
  left: Uint8Array.from({ length: 32 }, (_, i) => i + 1),
  right: { bytes: new Uint8Array(32) },
};
const OPENING = {
  value: 100n,
  nonce: 7n,
  ownerLo: 0x100f0e0d0c0b0a090807060504030201n,
  ownerHi: 0x201f1e1d1c1b1a191817161514131211n,
};

/** `_audit(OWNER, 100, 7, SLOT)` to `AUDIT_KEY` under `FIXED_SEED`. */
const PINNED_RECORD: AuditRecord = {
  ephemeralPk: {
    x: 17530982455774205817789485183882719593217766861558650112259485547548893229129n,
    y: 12379276356768444969190596307054866530165442066178855223649622216440565663647n,
  },
  valueCt:
    2101629644763690268777423281253835096893431695718826418130537618483687494n,
  nonceCt:
    137670811662239812125299707776242627778426093193457662055368802863205126072n,
  ownerLoCt:
    428424580110017804217287451828747078690190910084770249475384436650436906711n,
  ownerHiCt:
    424562263594953764090011528310108503419249326088489658134217151563588324114n,
};

const sourceOf = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

/** Source lines that are code, not doc or line comments. */
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

/**
 * The distinct `pad(32, "...")` literals in a source's code, in order of
 * appearance. Comments are skipped: a module header may carry an example tag.
 */
const tagsOf = (source: string): string[] => [
  ...new Set(
    [
      ...codeLines(source)
        .join('\n')
        .matchAll(/pad\(32, "([^"]+)"\)/g),
    ].map(([, tag]) => tag),
  ),
];

const EXTENSION_SOURCE = sourceOf(
  '../ConfidentialNoteFungibleTokenAudit.compact',
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
      file !== 'extensions/ConfidentialNoteFungibleTokenAudit.compact',
  )
  .map((file) => readFileSync(new URL(file, TOKEN_DIR), 'utf8'));

const byCodeUnit = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

// ---------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenAudit compatibility: wire format', () => {
  let token: ConfidentialNoteFungibleTokenAuditSimulator;

  beforeEach(async () => {
    token = await ConfidentialNoteFungibleTokenAuditSimulator.create({
      auditKey: AUDIT_KEY,
      wallet: { auditSeed: FIXED_SEED },
    });
  });

  // Deploys, since the pad runs inside a circuit. On live it proves the
  // deployed bytecode pads as the local artifact does.
  it('should pad a known note to the pinned record', async () => {
    await token._audit(OWNER, OPENING.value, OPENING.nonce, SLOT);
    const [record] = [...(await token.getPublicState()).Audit__auditTrail];

    expect(record).toStrictEqual(PINNED_RECORD);
  });

  // Pure, so it pins the auditor side on its own: the shared point, the four
  // tags, the modular pad and the limb order, without a deployment.
  it('should open the pinned record to the known note and owner limbs', () => {
    const opened = audit.recoverRecord(PINNED_RECORD, AUDIT_SCALAR);

    expect(opened).toStrictEqual(OPENING);
    expect(audit.ownerOf(opened.ownerLo, opened.ownerHi)).toStrictEqual(OWNER);
  });

  it('should keep the pinned domain tags', () => {
    expect(tagsOf(EXTENSION_SOURCE)).toStrictEqual([
      'CNFT:audit:e',
      'CNFT:audit:value',
      'CNFT:audit:nonce',
      'CNFT:audit:owner:lo',
      'CNFT:audit:owner:hi',
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
 * The record type as the compiler reports it. `maxval` arrives as a JSON
 * number, so it is only the nearest double to `2^248 - 1`.
 */
const AUDIT_RECORD_TYPE = {
  'type-name': 'Struct',
  name: 'AuditRecord',
  elements: [
    { name: 'ephemeralPk', type: { 'type-name': 'JubjubPoint' } },
    ...['valueCt', 'nonceCt', 'ownerLoCt', 'ownerHiCt'].map((name) => ({
      name,
      type: { 'type-name': 'Uint', maxval: Number(MAX_U248) },
    })),
  ],
};

/** The module's three slots, from `first` on. */
const auditSlots = (first: number) => [
  {
    name: '_isInitialized',
    index: first,
    exported: true,
    storage: 'Cell',
    type: { 'type-name': 'Boolean' },
  },
  {
    name: '_auditKey',
    index: first + 1,
    exported: true,
    storage: 'Cell',
    type: { 'type-name': 'JubjubPoint' },
  },
  {
    name: '_auditTrail',
    index: first + 2,
    exported: true,
    storage: 'List',
    type: AUDIT_RECORD_TYPE,
  },
];

describe('ConfidentialNoteFungibleTokenAudit compatibility: published surface', () => {
  const contractInfo = () =>
    readContractInfo(
      'token/extensions/test/mocks/MockConfidentialNoteFungibleTokenAudit',
    );

  it('should keep the pinned ledger layout', () => {
    expect(ledgerSlots(contractInfo())).toStrictEqual(auditSlots(0));
  });

  const SURFACE: Exhaustive<
    NameOf<Circuits<never>>,
    Pick<CircuitSurface, 'pure' | 'proof'>
  > = {
    _audit: { pure: false, proof: true },
    _setAuditKey: { pure: false, proof: true },
    ownerOf: { pure: true, proof: false },
    recoverRecord: { pure: true, proof: false },
  };

  it('should keep the pinned circuit surface', () => {
    const expected = Object.entries(SURFACE)
      .map(([name, flags]) => ({ name, ...flags }))
      .sort((left, right) => byCodeUnit(left.name, right.name));

    expect(circuitSurface(contractInfo())).toStrictEqual(expected);
  });

  it('should agree with the generated circuit types on what is callable', () => {
    const provable = circuitSurface(contractInfo())
      .filter(({ proof }) => proof)
      .map(({ name }) => name);

    const declared: Exhaustive<NameOf<ProvableCircuits<never>>> = {
      _audit: true,
      _setAuditKey: true,
    };

    expect(provable).toStrictEqual(Object.keys(declared).sort(byCodeUnit));
  });

  it('should export exactly the slots the generated Ledger type exposes', () => {
    const exported = ledgerSlots(contractInfo())
      .filter(({ exported }) => exported)
      .map(({ name }) => `Audit_${name}`);

    const declared: Exhaustive<NameOf<Ledger>> = {
      Audit__auditKey: true,
      Audit__auditTrail: true,
      Audit__isInitialized: true,
    };

    expect(exported.sort()).toStrictEqual(Object.keys(declared).sort());
  });
});

// ---------------------------------------------------------------------------
// Published surface: composed with the core
// ---------------------------------------------------------------------------

/**
 * The composition appends three slots after the core's three. An auditor reads
 * the trail by that index, so the core's layout is re-pinned here in full.
 */
describe('ConfidentialNoteFungibleTokenAudit compatibility: composed surface', () => {
  const contractInfo = () =>
    readContractInfo(
      'token/extensions/test/mocks/MockConfidentialNoteFungibleTokenAudited',
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
      ...auditSlots(3),
      {
        name: '_noteSalt',
        index: 6,
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
    _setAuditKey: { pure: false, proof: true },
    burn: { pure: false, proof: true },
    commitOf: { pure: true, proof: false },
    deriveIdentifier: { pure: true, proof: false },
    mint: { pure: false, proof: true },
    nullifierOf: { pure: true, proof: false },
    ownerOf: { pure: true, proof: false },
    recoverRecord: { pure: true, proof: false },
    seize: { pure: false, proof: true },
    transfer: { pure: false, proof: true },
  };

  it('should keep the pinned circuit surface', () => {
    const expected = Object.entries(SURFACE)
      .map(([name, flags]) => ({ name, ...flags }))
      .sort((left, right) => byCodeUnit(left.name, right.name));

    expect(circuitSurface(contractInfo())).toStrictEqual(expected);
  });

  it('should agree with the generated circuit types on what is callable', () => {
    const provable = circuitSurface(contractInfo())
      .filter(({ proof }) => proof)
      .map(({ name }) => name);

    const declared: Exhaustive<NameOf<ComposedProvableCircuits<never>>> = {
      _setAuditKey: true,
      burn: true,
      mint: true,
      seize: true,
      transfer: true,
    };

    expect(provable).toStrictEqual(Object.keys(declared).sort(byCodeUnit));
  });

  it('should export exactly the slots the generated Ledger type exposes', () => {
    const exported = ledgerSlots(contractInfo())
      .filter(({ exported }) => exported)
      .map(({ name }) =>
        name.startsWith('_audit') || name === '_isInitialized'
          ? `Audit_${name}`
          : `Core_${name}`,
      );

    const declared: Exhaustive<NameOf<ComposedLedger>> = {
      Audit__auditKey: true,
      Audit__auditTrail: true,
      Audit__isInitialized: true,
      Core__commitments: true,
      Core__issuedNonces: true,
      Core__nullifiers: true,
    };

    expect(exported.sort()).toStrictEqual(Object.keys(declared).sort());
  });
});
