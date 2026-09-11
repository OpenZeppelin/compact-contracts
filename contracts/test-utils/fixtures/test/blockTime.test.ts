import { describe, expect, it } from 'vitest';
import { setBlockTime } from '../blockTime.js';

/**
 * These exercise the fixture's coupling checks with stand-in objects rather than
 * a real simulator. The point is the failure modes: a silently ignored write
 * leaves the clock at 0, and several time-dependent specs still pass at 0, so
 * "did nothing" must be indistinguishable from "threw".
 */

const dryLike = (secondsSinceEpoch: bigint) => ({
  _backend: {
    sim: {
      circuitContext: {
        currentQueryContext: {
          block: { secondsSinceEpoch, parentBlockHash: 'abc' },
        },
      },
    },
  },
});

describe('setBlockTime', () => {
  it('should write the block time', () => {
    const sim = dryLike(0n);
    setBlockTime(sim, 1_000n);
    expect(
      sim._backend.sim.circuitContext.currentQueryContext.block
        .secondsSinceEpoch,
    ).toEqual(1_000n);
  });

  it('should preserve the other block fields', () => {
    const sim = dryLike(0n);
    setBlockTime(sim, 1_000n);
    expect(
      sim._backend.sim.circuitContext.currentQueryContext.block.parentBlockHash,
    ).toEqual('abc');
  });

  it('should throw when there is no query context (the live backend)', () => {
    expect(() => {
      setBlockTime({ _backend: { pureSim: {} } }, 1_000n);
    }).toThrow('no in-memory query context');
  });

  it('should throw when `block` is renamed', () => {
    const sim = {
      _backend: {
        sim: {
          circuitContext: {
            currentQueryContext: { blockInfo: { secondsSinceEpoch: 0n } },
          },
        },
      },
    };
    expect(() => {
      setBlockTime(sim, 1_000n);
    }).toThrow('block.secondsSinceEpoch');
  });

  it('should throw when `secondsSinceEpoch` is renamed', () => {
    const sim = {
      _backend: {
        sim: {
          circuitContext: {
            currentQueryContext: { block: { blockSeconds: 0n } },
          },
        },
      },
    };
    expect(() => {
      setBlockTime(sim, 1_000n);
    }).toThrow('block.secondsSinceEpoch');
  });

  it('should throw when the field is no longer a bigint', () => {
    const sim = {
      _backend: {
        sim: {
          circuitContext: {
            currentQueryContext: { block: { secondsSinceEpoch: 0 } },
          },
        },
      },
    };
    expect(() => {
      setBlockTime(sim, 1_000n);
    }).toThrow('block.secondsSinceEpoch');
  });

  it('should throw when the write is silently dropped', () => {
    const block = { secondsSinceEpoch: 0n };
    const ctx = { block };
    // A context that ignores writes to `block`, as a read-only wasm-backed
    // property would.
    Object.defineProperty(ctx, 'block', { get: () => block, set: () => {} });
    const sim = {
      _backend: { sim: { circuitContext: { currentQueryContext: ctx } } },
    };

    expect(() => {
      setBlockTime(sim, 1_000n);
    }).toThrow('did not take effect');
  });
});
