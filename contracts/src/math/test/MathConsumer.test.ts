import { beforeAll, describe, expect, test } from 'vitest';
import { MathConsumerSimulator } from './simulators/MathConsumerSimulator.js';

// The same honest cases can run through the dry or live simulator backend.
describe('Math guide consumer', () => {
  let consumer: MathConsumerSimulator;
  beforeAll(async () => {
    consumer = await MathConsumerSimulator.create();
  });

  test.each([
    [0n, 9n, 0n],
    [4n, 9n, 6n],
    [2n, 3n, 2n],
    [(1n << 64n) - 1n, (1n << 64n) - 1n, (1n << 64n) - 1n],
  ])('stores the root for %s and %s', async (a, b, root) => {
    expect(await consumer.update(a, b)).toBe(root);
    expect((await consumer.getPublicState()).liquidity).toBe(root);
  });
});
