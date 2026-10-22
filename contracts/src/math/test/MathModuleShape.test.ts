import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

/**
 * Source checks of the eight math modules (INV-13, INV-16).
 *
 * The library keeps no state and discloses nothing: a module declares no
 * ledger field, calls no `disclose()`, no kernel operation and no hash. Each
 * assertion message is a string literal with the module prefix, so a
 * consumer can match it, and the set of messages is fixed (D1: the only
 * change from the source library is the L-06 message).
 *
 * The checks read the source files only, so they run on the dry backend.
 */

const MODULES = [
  'Types',
  'Pack',
  'Bytes8',
  'Uint64',
  'Uint128',
  'Uint256',
  'Bytes32',
  'Field255',
] as const;

const MESSAGES: Record<(typeof MODULES)[number], string[]> = {
  Types: [],
  Pack: ['Pack: unpack verification failed'],
  Bytes8: [],
  Uint64: [
    'Uint64: addition overflow',
    'Uint64: division by zero',
    'Uint64: division invalid',
    'Uint64: multiplication overflow',
    'Uint64: remainder error',
    'Uint64: sqrt overestimate',
    'Uint64: sqrt underestimate',
    'Uint64: subtraction underflow',
    'Uint64: toUnpackedBytes verification failed',
  ],
  Uint128: [
    'Uint128: addition overflow',
    'Uint128: conversion invalid',
    'Uint128: division by zero',
    'Uint128: division invalid',
    'Uint128: division product overflow',
    'Uint128: multiplication overflow',
    'Uint128: remainder error',
    'Uint128: sqrt overestimate',
    'Uint128: sqrt underestimate',
    'Uint128: subtraction underflow',
    'Uint128: unexpected multiplication overflow',
  ],
  Uint256: [],
  Bytes32: [],
  Field255: [],
};

const source = (module: string): string =>
  readFileSync(new URL(`../${module}.compact`, import.meta.url), 'utf8');

/** Removes `//` and `/* *\/` comments. String literals stay unchanged. */
const stripComments = (text: string): string => {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '"') {
      const end = text.indexOf('"', i + 1);
      out += text.slice(i, end + 1);
      i = end + 1;
    } else if (text.startsWith('//', i)) {
      i = text.indexOf('\n', i);
      if (i < 0) break;
    } else if (text.startsWith('/*', i)) {
      i = text.indexOf('*/', i) + 2;
    } else {
      out += text[i++];
    }
  }
  return out;
};

/** Returns the message argument of every `assert(...)` call, as written. */
const assertMessages = (code: string): string[] => {
  const messages: string[] = [];
  for (const match of code.matchAll(/\bassert\(/g)) {
    let depth = 1;
    let i = (match.index ?? 0) + match[0].length;
    let lastComma = -1;
    const start = i;
    for (; i < code.length && depth > 0; i++) {
      const c = code[i];
      if (c === '"') {
        i = code.indexOf('"', i + 1);
      } else if (c === '(') {
        depth++;
      } else if (c === ')') {
        depth--;
      } else if (c === ',' && depth === 1) {
        lastComma = i;
      }
    }
    messages.push(
      code.slice(lastComma < 0 ? start : lastComma + 1, i - 1).trim(),
    );
  }
  return messages;
};

describe('math module shape', () => {
  describe.each(MODULES)('%s', (module) => {
    const code = stripComments(source(module));

    test('declares no ledger state and calls no disclose, kernel or hash', () => {
      expect(code).not.toMatch(/\bledger\b/);
      expect(code).not.toMatch(/\bdisclose\s*\(/);
      expect(code).not.toMatch(/\bkernel\./);
      expect(code).not.toMatch(
        /\b(persistentHash|transientHash|persistentCommit|transientCommit)\b/,
      );
    });

    test('uses constant assertion messages with the module prefix', () => {
      const messages = assertMessages(code);
      for (const message of messages) {
        expect(message).toMatch(new RegExp(`^"${module}: [^"]+"$`));
      }
      const unique = [...new Set(messages.map((m) => m.slice(1, -1)))].sort();
      expect(unique).toEqual(MESSAGES[module]);
    });
  });
});
