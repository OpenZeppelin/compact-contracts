/**
 * Compatibility claims for the ConfidentialNoteFungibleTokenAllowlist
 * extension.
 *
 * A client finds its path by recomputing its leaf, so the leaf tag, the
 * preimage layout `(domain, canonical account)` and the tree depth are wire
 * format. Move any of them and every listed account loses its path. This
 * suite pins absolute values and the published surface, as the core's does.
 *
 * A FAILURE HERE IS NOT A TEST TO FIX. Revert, or accept deliberately and
 * regenerate in the same commit; post-release it is a migration.
 *
 * PROVENANCE. Every value below was recorded under compiler 0.36.0 (language
 * 0.28.0, runtime 0.21.0), the CI compiler.
 */

import { readdirSync, readFileSync } from 'node:fs';
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
  pureCircuits as allowlist,
  type Circuits,
  type Ledger,
  type ProvableCircuits,
} from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenAllowlist/contract/index.js';
import {
  type Circuits as ComposedCircuits,
  type Ledger as ComposedLedger,
  type ProvableCircuits as ComposedProvableCircuits,
  pureCircuits as composed,
} from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenAllowlisted/contract/index.js';
import {
  ConfidentialNoteFungibleTokenAllowlistSimulator,
  type Identifier,
} from './simulators/ConfidentialNoteFungibleTokenAllowlistSimulator.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const bytes32 = (label: string): Uint8Array => {
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode(label));
  return bytes;
};

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

const ZERO = new Uint8Array(32);
const GOLDEN = bytes32('CNFT:allowlist:golden');

const KEY_ACCOUNT: Identifier = {
  is_left: true,
  left: GOLDEN,
  right: { bytes: ZERO },
};

const CONTRACT_ACCOUNT: Identifier = {
  is_left: false,
  left: ZERO,
  right: { bytes: GOLDEN },
};

/** `leafOf(KEY_ACCOUNT)`. */
const PINNED_KEY_LEAF =
  'b18953c8f56b940b6458ae45ae55c7d5717d7612870bb33b29a29715868dc193';

/** `leafOf(CONTRACT_ACCOUNT)`. */
const PINNED_CONTRACT_LEAF =
  '975af537db26848a926d1cc85e60e5a700dbe525fa0d0a4fa3cf4d72eb7ff04c';

const sourceOf = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

const EXTENSION_SOURCE = sourceOf(
  '../ConfidentialNoteFungibleTokenAllowlist.compact',
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
      file !== 'extensions/ConfidentialNoteFungibleTokenAllowlist.compact',
  )
  .map((file) => readFileSync(new URL(file, TOKEN_DIR), 'utf8'));

/** Source lines with doc and line comments dropped: header examples are not tags. */
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

/** The distinct `pad(32, "...")` literals in a source's code, in order of appearance. */
const tagsOf = (source: string): string[] => [
  ...new Set(
    codeLines(source).flatMap((line) =>
      [...line.matchAll(/pad\(32, "([^"]+)"\)/g)].map(([, tag]) => tag),
    ),
  ),
];

// ---------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenAllowlist compatibility: wire format', () => {
  it('should hash a key-arm account to the pinned leaf', () => {
    expect(hex(allowlist.leafOf(KEY_ACCOUNT))).toBe(PINNED_KEY_LEAF);
  });

  it('should hash a contract-arm account to the pinned leaf', () => {
    expect(hex(allowlist.leafOf(CONTRACT_ACCOUNT))).toBe(PINNED_CONTRACT_LEAF);
  });

  it('should hash to the same leaves in the composed mock', () => {
    expect(hex(composed.leafOf(KEY_ACCOUNT))).toBe(PINNED_KEY_LEAF);
    expect(hex(composed.leafOf(CONTRACT_ACCOUNT))).toBe(PINNED_CONTRACT_LEAF);
  });

  it('should keep the pinned domain tag', () => {
    expect(tagsOf(EXTENSION_SOURCE)).toStrictEqual(['CNFT:allowlist:leaf']);
  });

  it('should share none of its tags with another source under contracts/src/token', () => {
    const others = new Set(OTHER_SOURCES.flatMap(tagsOf));

    expect(others.size).toBeGreaterThan(0);
    expect(
      tagsOf(EXTENSION_SOURCE).filter((tag) => others.has(tag)),
    ).toStrictEqual([]);
  });

  describe('deployed', () => {
    let list: ConfidentialNoteFungibleTokenAllowlistSimulator;

    beforeEach(async () => {
      list = await ConfidentialNoteFungibleTokenAllowlistSimulator.create();
    });

    // On live this proves the deployed bytecode writes the leaf a client
    // recomputes from the local artifact.
    it('should insert the pinned leaf into the tree and the member set', async () => {
      await list._allow(KEY_ACCOUNT);
      const state = await list.getPublicState();
      const leaf = Buffer.from(PINNED_KEY_LEAF, 'hex');

      expect(state.Allowlist__members.member(leaf)).toBe(true);
      expect(state.Allowlist__allowed.findPathForLeaf(leaf)).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Published surface: the extension alone
// ---------------------------------------------------------------------------

const TREE_SLOT = {
  storage: 'HistoricMerkleTree',
  depth: 32,
  type: { 'type-name': 'Bytes', length: 32 },
};

const SET_SLOT = {
  storage: 'Set',
  type: { 'type-name': 'Bytes', length: 32 },
};

describe('ConfidentialNoteFungibleTokenAllowlist compatibility: published surface', () => {
  const contractInfo = () =>
    readContractInfo(
      'token/extensions/test/mocks/MockConfidentialNoteFungibleTokenAllowlist',
    );

  it('should keep the pinned ledger layout', () => {
    expect(ledgerSlots(contractInfo())).toStrictEqual([
      { name: '_allowed', index: 0, exported: true, ...TREE_SLOT },
      { name: '_members', index: 1, exported: true, ...SET_SLOT },
    ]);
  });

  const SURFACE: Exhaustive<
    NameOf<Circuits<never>>,
    Pick<CircuitSurface, 'pure' | 'proof'>
  > = {
    _allow: { pure: false, proof: true },
    _disallow: { pure: false, proof: true },
    assertAllowed: { pure: false, proof: true },
    leafOf: { pure: true, proof: false },
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
      _allow: true,
      _disallow: true,
      assertAllowed: true,
    };

    expect(provable).toStrictEqual(Object.keys(declared).sort());
  });

  it('should export exactly the slots the generated Ledger type exposes', () => {
    const exported = ledgerSlots(contractInfo())
      .filter(({ exported }) => exported)
      .map(({ name }) => `Allowlist_${name}`);

    const declared: Exhaustive<NameOf<Ledger>> = {
      Allowlist__allowed: true,
      Allowlist__members: true,
    };

    expect(exported.sort()).toStrictEqual(Object.keys(declared).sort());
  });
});

// ---------------------------------------------------------------------------
// Published surface: composed with the core
// ---------------------------------------------------------------------------

/**
 * The composition appends two slots after the core's three. A client reads
 * the list by those indices, so the core's layout is re-pinned here in full.
 */
describe('ConfidentialNoteFungibleTokenAllowlist compatibility: composed surface', () => {
  const contractInfo = () =>
    readContractInfo(
      'token/extensions/test/mocks/MockConfidentialNoteFungibleTokenAllowlisted',
    );

  it('should keep the pinned ledger layout', () => {
    expect(ledgerSlots(contractInfo())).toStrictEqual([
      { name: '_commitments', index: 0, exported: true, ...TREE_SLOT },
      { name: '_nullifiers', index: 1, exported: true, ...SET_SLOT },
      { name: '_issuedNonces', index: 2, exported: true, ...SET_SLOT },
      { name: '_allowed', index: 3, exported: true, ...TREE_SLOT },
      { name: '_members', index: 4, exported: true, ...SET_SLOT },
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
    _allow: { pure: false, proof: true },
    _disallow: { pure: false, proof: true },
    burn: { pure: false, proof: true },
    commitOf: { pure: true, proof: false },
    deriveIdentifier: { pure: true, proof: false },
    leafOf: { pure: true, proof: false },
    mint: { pure: false, proof: true },
    nullifierOf: { pure: true, proof: false },
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
      _allow: true,
      _disallow: true,
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
        name === '_allowed' || name === '_members'
          ? `Allowlist_${name}`
          : `Core_${name}`,
      );

    const declared: Exhaustive<NameOf<ComposedLedger>> = {
      Allowlist__allowed: true,
      Allowlist__members: true,
      Core__commitments: true,
      Core__issuedNonces: true,
      Core__nullifiers: true,
    };

    expect(exported.sort()).toStrictEqual(Object.keys(declared).sort());
  });
});
