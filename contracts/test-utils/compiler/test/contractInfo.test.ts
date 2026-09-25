/**
 * NO COMPILED ARTIFACT REQUIRED: `test:harness` has no `compile` dependency, so
 * nothing here may read a real build. The happy path writes its own throwaway
 * artifact instead, which still exercises the likeliest breakage, the relative path
 * resolved against this module's location. `contracts/artifacts` is gitignored.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type CircuitInfo,
  type ContractInfo,
  circuitSurface,
  ledgerSlots,
  parseContractInfo,
  readContractInfo,
} from '../contractInfo.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A circuit entry carrying the noise `circuitSurface` is meant to drop. */
const circuit = (name: string, pure: boolean, proof: boolean): CircuitInfo => ({
  name,
  pure,
  proof,
  arguments: [{ name: 'value', type: { 'type-name': 'Field' } }],
  'result-type': { 'type-name': 'Field' },
});

const contractInfo = (circuits: CircuitInfo[]): ContractInfo => ({
  'compiler-version': '0.31.1',
  'language-version': '0.23.0',
  'runtime-version': '0.16.0',
  circuits,
  witnesses: [],
  contracts: [],
  ledger: [
    {
      name: '_things',
      index: 0,
      exported: true,
      storage: 'Set',
      type: { 'type-name': 'Bytes', length: 32 },
    },
  ],
});

// ---------------------------------------------------------------------------
// circuitSurface
// ---------------------------------------------------------------------------

describe('circuitSurface', () => {
  it('should keep only the three fields that decide callability', () => {
    const surface = circuitSurface(
      contractInfo([circuit('only', false, true)]),
    );

    // Asserted whole, so an added field fails rather than passing unnoticed.
    expect(surface).toStrictEqual([{ name: 'only', pure: false, proof: true }]);
  });

  it('should sort by name, so source reordering is not a change', () => {
    const declarationOrder = contractInfo([
      circuit('transfer', false, true),
      circuit('_burn', false, true),
      circuit('commitOf', true, false),
    ]);

    expect(circuitSurface(declarationOrder).map(({ name }) => name)).toEqual([
      '_burn',
      'commitOf',
      'transfer',
    ]);
  });

  it('should preserve each circuit own pure and proof flags', () => {
    const mixed = contractInfo([
      circuit('a_pure', true, false),
      circuit('b_provable', false, true),
      // Impure but unprovable: reads witnesses, touches no ledger state.
      circuit('c_local', false, false),
    ]);

    expect(circuitSurface(mixed)).toStrictEqual([
      { name: 'a_pure', pure: true, proof: false },
      { name: 'b_provable', pure: false, proof: true },
      { name: 'c_local', pure: false, proof: false },
    ]);
  });

  it('should return an empty surface for a contract with no circuits', () => {
    expect(circuitSurface(contractInfo([]))).toStrictEqual([]);
  });
});

// ---------------------------------------------------------------------------
// readContractInfo
// ---------------------------------------------------------------------------

describe('readContractInfo', () => {
  const FIXTURE = '__ContractInfoReaderFixture__';
  const fixtureRoot = new URL(
    `../../../artifacts/${FIXTURE}/`,
    import.meta.url,
  );
  const written = contractInfo([circuit('roundTripped', false, true)]);

  beforeAll(() => {
    mkdirSync(new URL('compiler/', fixtureRoot), { recursive: true });
    writeFileSync(
      new URL('compiler/contract-info.json', fixtureRoot),
      JSON.stringify(written),
      'utf8',
    );
  });

  afterAll(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it('should resolve an artifact by name and parse its metadata', () => {
    // The point of the round trip: the module resolves this path against its own
    // location, which no unit test of a pure function would catch breaking.
    expect(readContractInfo(FIXTURE)).toStrictEqual(written);
  });

  it('should compose with circuitSurface on what it read', () => {
    expect(circuitSurface(readContractInfo(FIXTURE))).toStrictEqual([
      { name: 'roundTripped', pure: false, proof: true },
    ]);
  });

  it('should explain what to do when the artifact is not built', () => {
    // The likely cause of this failure is a missing compile, not a typo, so the
    // message has to say so rather than surface a bare ENOENT.
    expect(() => readContractInfo('NoSuchArtifactAnywhere')).toThrowError(
      /no compiler metadata for 'NoSuchArtifactAnywhere'.*Compile the contract first/s,
    );
  });

  it('should keep the underlying filesystem error as the cause', () => {
    try {
      readContractInfo('NoSuchArtifactAnywhere');
      expect.unreachable('expected a throw');
    } catch (error) {
      expect((error as Error).cause).toMatchObject({ code: 'ENOENT' });
    }
  });
});

// ---------------------------------------------------------------------------
// Validating the JSON against the declared unions
// ---------------------------------------------------------------------------

/**
 * A tag the compiler has never emitted stands in for one a future compiler
 * might. Reaching a use site as `undefined` is the failure being prevented.
 */
describe('parseContractInfo', () => {
  const json = (info: unknown): string => JSON.stringify(info);

  it('should reject an unrecognized type-name and name the union to extend', () => {
    const base = contractInfo([circuit('c', false, true)]);

    expect(() =>
      parseContractInfo(
        json({
          ...base,
          circuits: [
            {
              ...base.circuits[0],
              'result-type': { 'type-name': 'Quaternion' },
            },
          ],
        }),
        'Fixture',
      ),
    ).toThrowError(
      /unrecognized type-name 'Quaternion'.*add the variant to CompactTypeName/s,
    );
  });

  it('should reject a type-name nested inside a struct', () => {
    // The walk has to reach descriptors nested through structs, vectors and map
    // values, not just the top level of each circuit.
    const base = contractInfo([circuit('c', false, true)]);

    expect(() =>
      parseContractInfo(
        json({
          ...base,
          circuits: [
            {
              ...base.circuits[0],
              'result-type': {
                'type-name': 'Struct',
                name: 'Wrapper',
                elements: [
                  { name: 'inner', type: { 'type-name': 'Quaternion' } },
                ],
              },
            },
          ],
        }),
        'Fixture',
      ),
    ).toThrowError(/unrecognized type-name 'Quaternion'/);
  });

  it('should reject an unrecognized ledger storage kind', () => {
    expect(() =>
      parseContractInfo(
        json({
          ...contractInfo([]),
          ledger: [
            {
              name: '_thing',
              index: 0,
              exported: true,
              storage: 'Trie',
              type: { 'type-name': 'Field' },
            },
          ],
        }),
        'Fixture',
      ),
    ).toThrowError(
      /unrecognized ledger storage 'Trie'.*add the variant to LedgerStorage/s,
    );
  });

  it('should reject metadata missing a required key', () => {
    const { ledger: _dropped, ...withoutLedger } = contractInfo([]);

    expect(() =>
      parseContractInfo(json(withoutLedger), 'Fixture'),
    ).toThrowError(/missing or non-array 'ledger'/);
  });

  it('should not report a validation failure as a missing build', () => {
    // Both failures reach a caller through the same function; conflating them
    // would send a reader off to recompile a contract that is already built.
    let message = '';
    try {
      parseContractInfo(
        json({
          ...contractInfo([]),
          ledger: [
            {
              name: '_thing',
              index: 0,
              exported: true,
              storage: 'Trie',
              type: { 'type-name': 'Field' },
            },
          ],
        }),
        'Fixture',
      );
      expect.unreachable('expected a throw');
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toMatch(/unrecognized ledger storage/);
    expect(message).not.toMatch(/Compile the contract first/);
  });

  it('should accept metadata that uses every declared tag', () => {
    const parsed = parseContractInfo(
      json({
        ...contractInfo([circuit('c', false, true)]),
        ledger: [
          {
            name: '_cell',
            index: 0,
            exported: true,
            storage: 'Cell',
            type: { 'type-name': 'Boolean' },
          },
          { name: '_count', index: 1, exported: false, storage: 'Counter' },
          {
            name: '_tree',
            index: 2,
            exported: true,
            storage: 'HistoricMerkleTree',
            depth: 32,
            type: { 'type-name': 'Bytes', length: 32 },
          },
          {
            name: '_map',
            index: 3,
            exported: true,
            storage: 'Map',
            key: { 'type-name': 'Uint', maxval: 255 },
            value: {
              'type-name': 'Vector',
              length: 2,
              type: { 'type-name': 'Opaque', tsType: 'string' },
            },
          },
        ],
      }),
      'Fixture',
    );

    expect(ledgerSlots(parsed)).toHaveLength(4);
  });

  it('should explain what to do when the text is not JSON', () => {
    expect(() => parseContractInfo('{ not json', 'Fixture')).toThrowError(
      /unreadable compiler metadata for 'Fixture'.*Compile the contract first/s,
    );
  });
});
