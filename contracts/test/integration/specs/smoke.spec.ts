import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  deployTestTokenV1,
  type TestTokenV1Kit,
} from '../fixtures/testTokenV1.js';

/**
 * The composed mock deploys and every module's ledger reads back. The CMA and
 * upgrade specs all build on this, so a failure here means the harness is
 * wrong rather than the upgrade path.
 */
describe.runIf(isLiveBackend())('Smoke — TestToken deploy', () => {
  let v1: TestTokenV1Kit;

  beforeAll(async () => {
    v1 = await deployTestTokenV1({
      name: 'TestToken',
      symbol: 'TT',
      decimals: 6,
    });
  });

  afterAll(async () => {
    await v1?.teardown();
  });

  it('deploys to the local node', () => {
    expect(v1.contractAddress).toMatch(/^[0-9a-f]+$/);
  });

  it('reads back every composed module’s initial ledger', async () => {
    const ledger = await v1.readLedger();
    expect({
      initialized: ledger.Initializable__isInitialized,
      paused: ledger.Pausable__isPaused,
      name: ledger.FungibleToken__name,
      symbol: ledger.FungibleToken__symbol,
      decimals: ledger.FungibleToken__decimals,
      totalSupply: ledger.FungibleToken__totalSupply,
    }).toStrictEqual({
      initialized: true,
      paused: false,
      name: 'TestToken',
      symbol: 'TT',
      decimals: 6n,
      totalSupply: 0n,
    });
  });
});
