import { describe, expect, it } from 'vitest';
import {
  DETERMINISTIC_FAILURES,
  deterministicCause,
} from '../deterministic.ts';

/** Dry unit tests for `deterministic.ts`: matching failure messages to a cause. */

describe('deterministicCause', () => {
  it('names the cause when every failed test matches a pattern', () => {
    expect(
      deterministicCause([
        ['Error: Transaction would exhaust the block limits'],
      ]),
    ).toBe('block limits');
  });

  it('joins distinct causes in pattern order', () => {
    expect(
      deterministicCause([
        ['Error: Custom error: 186'],
        ['Error: Transaction would exhaust the block limits'],
      ]),
    ).toBe('block limits + unclaimed shielded output (err 186)');
  });

  it('reports nothing when any failed test does not match', () => {
    expect(
      deterministicCause([
        ['Error: Transaction would exhaust the block limits'],
        ['AssertionError: expected 1 to be 2'],
      ]),
    ).toBeUndefined();
  });

  it('ignores a matcher failure that quotes a fingerprint', () => {
    expect(
      deterministicCause([
        [
          "AssertionError: expected 'Error: Custom error: 103' to contain 'Custom error: 186'\n" +
            '    at /contracts/src/token/test/Token.live.test.ts:42:21',
        ],
      ]),
    ).toBeUndefined();
  });

  it('counts a thrown fingerprint beside a matcher failure', () => {
    expect(
      deterministicCause([
        [
          "AssertionError: expected 'Error: Custom error: 186' to be undefined",
          'Error: Custom error: 186\n    at _mint…',
        ],
      ]),
    ).toBe('unclaimed shielded output (err 186)');
  });

  it('reports nothing for a message-less failure', () => {
    expect(deterministicCause([[]])).toBeUndefined();
  });

  it('reports nothing when no test failed at assertion level', () => {
    expect(deterministicCause([])).toBeUndefined();
  });

  it('keeps every pattern paired with a cause name', () => {
    // The verdict line prints the cause, so an unnamed pattern would render
    // as `deterministic: undefined`.
    for (const d of DETERMINISTIC_FAILURES) {
      expect(d.cause.length).toBeGreaterThan(0);
      expect(d.pattern).toBeInstanceOf(RegExp);
    }
  });
});
