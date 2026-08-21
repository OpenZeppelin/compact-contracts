import { describe, expect, it } from 'vitest';
import {
  causeChain,
  expectRejection,
  rejectionIncludes,
} from '../rejection.js';

const WITNESS_REASON = 'wit_Path: commitment not found in tree';

/** The shape the live backend produces: the reason two `cause` levels down. */
const liveWrapped = () => {
  const witness = new Error(WITNESS_REASON);
  const runtime = new Error("Error executing circuit 'transfer'", {
    cause: witness,
  });
  return new Error(
    "Unexpected error executing scoped transaction '<unnamed>': ContractRuntimeError: Error executing circuit 'transfer'",
    { cause: runtime },
  );
};

describe('rejection: causeChain', () => {
  it('should render the outermost error first', () => {
    const chain = causeChain(liveWrapped());

    expect(chain[0]).toContain('Unexpected error executing scoped transaction');
    expect(chain[chain.length - 1]).toContain(WITNESS_REASON);
  });

  it('should reach a reason nested two cause levels down', () => {
    expect(causeChain(liveWrapped())).toHaveLength(3);
  });

  it('should follow an AggregateError children', () => {
    const aggregate = new AggregateError(
      [new Error('first'), new Error(WITNESS_REASON)],
      'several failed',
    );

    expect(causeChain(aggregate).join('\n')).toContain(WITNESS_REASON);
  });

  it('should use toString, so a custom renderer is not missed', () => {
    // A FiberFailure keeps its cause behind a Symbol and only renders via
    // toString; `.message` alone would report nothing.
    const opaque = {
      toString: () => `FiberFailure: ${WITNESS_REASON}`,
    };

    expect(causeChain(opaque)).toStrictEqual([
      `FiberFailure: ${WITNESS_REASON}`,
    ]);
  });

  it('should terminate on a cycle', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    (a as { cause?: unknown }).cause = b;

    expect(causeChain(a)).toHaveLength(2);
  });

  it('should render nothing for no error', () => {
    expect(causeChain(undefined)).toStrictEqual([]);
    expect(causeChain(null)).toStrictEqual([]);
  });
});

describe('rejection: rejectionIncludes', () => {
  it('should find a reason at the surface', () => {
    expect(rejectionIncludes(new Error(WITNESS_REASON), WITNESS_REASON)).toBe(
      true,
    );
  });

  it('should find a reason the wrappers buried', () => {
    expect(rejectionIncludes(liveWrapped(), WITNESS_REASON)).toBe(true);
  });

  it('should not report a reason that is absent', () => {
    expect(rejectionIncludes(liveWrapped(), 'note already spent')).toBe(false);
  });
});

describe('rejection: expectRejection', () => {
  it('should accept a rejection carrying the reason at the surface', async () => {
    await expectRejection(
      Promise.reject(new Error(WITNESS_REASON)),
      WITNESS_REASON,
    );
  });

  it('should accept the same reason when the backend wrapped it', async () => {
    await expectRejection(Promise.reject(liveWrapped()), WITNESS_REASON);
  });

  it('should reject a call that resolved instead', async () => {
    await expect(
      expectRejection(Promise.resolve('fine'), WITNESS_REASON),
    ).rejects.toThrow(
      `expected a rejection including "${WITNESS_REASON}", but the call resolved`,
    );
  });

  it('should print the whole chain when the reason is absent', async () => {
    // The diagnostic IS the feature: a backend that wraps differently has to
    // report what it produced, not just "no match".
    await expect(
      expectRejection(Promise.reject(liveWrapped()), 'some other reason'),
    ).rejects.toThrow(/\[0\].*\n.*\[1\].*\n.*\[2\]/s);
  });
});
