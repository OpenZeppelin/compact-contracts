/**
 * Privacy claims for the ConfidentialNoteFungibleTokenMetadata extension.
 *
 * The module holds three public constants and takes no per-call data, so the
 * claims are on the source: what it discloses, what it declares, and that no
 * circuit but `initialize` writes a field.
 */

import { readFileSync } from 'node:fs';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { describe, expect, it } from 'vitest';

const EXTENSION_SOURCE = readFileSync(
  new URL('../ConfidentialNoteFungibleTokenMetadata.compact', import.meta.url),
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

const CODE = codeLines(EXTENSION_SOURCE);

describe.skipIf(isLiveBackend())(
  'ConfidentialNoteFungibleTokenMetadata privacy: the disclose surface',
  () => {
    it('should disclose only the three constructor arguments', () => {
      const sites = CODE.filter((line) => line.includes('disclose('));

      expect(sites).toStrictEqual([
        '_name = disclose(name_);',
        '_symbol = disclose(symbol_);',
        '_decimals = disclose(decimals_);',
      ]);
    });

    it('should not disclose a witness value directly', () => {
      expect(EXTENSION_SOURCE).not.toMatch(/disclose\(\s*wit_/);
    });

    it('should declare the flag and three sealed fields only', () => {
      const ledgerFields = CODE.filter((line) =>
        /^export (sealed )?ledger /.test(line),
      );

      expect(ledgerFields).toStrictEqual([
        'export ledger _isInitialized: Boolean;',
        'export sealed ledger _name: Opaque<"string">;',
        'export sealed ledger _symbol: Opaque<"string">;',
        'export sealed ledger _decimals: Uint<8>;',
      ]);
    });

    // A getter that wrote a field would not compile against `sealed`; this
    // pins the one write site of each anyway.
    it('should write each field at one site', () => {
      const writes = CODE.filter((line) =>
        /^_(isInitialized|name|symbol|decimals) = /.test(line),
      );

      expect(writes).toStrictEqual([
        '_isInitialized = true;',
        '_name = disclose(name_);',
        '_symbol = disclose(symbol_);',
        '_decimals = disclose(decimals_);',
      ]);
    });

    it('should assert only the two init reasons', () => {
      const reasons = new Set(
        [
          ...CODE.join('\n').matchAll(
            /"ConfidentialNoteFungibleTokenMetadata: ([^"]+)"/g,
          ),
        ].map((match) => match[1]),
      );

      expect(reasons).toStrictEqual(
        new Set(['contract already initialized', 'contract not initialized']),
      );
    });

    it('should keep the extension free of branches and loops', () => {
      const branching = CODE.filter(
        (line) => /\bif\s*\(/.test(line) || /\bfor\s*\(/.test(line),
      );

      expect(branching).toStrictEqual([]);
    });
  },
);
