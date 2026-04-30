import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deployTestToken, type TestTokenKit } from '../fixtures/testToken.js';

/**
 * Smoke spec — proves the integration harness works end-to-end against the
 * composite `TestToken` mock:
 *   1. the local node / indexer / proof server are reachable,
 *   2. the composite contract deploys (5 module circuits all compiled and
 *      wired through the constructor),
 *   3. its initial public ledger is queryable across every composed module:
 *        - Initializable: `_isInitialized = true`  (constructor called it),
 *        - Pausable:      `_isPaused = false`      (default),
 *        - FungibleToken: name/symbol/decimals roundtrip; supply = 0,
 *        - AccessControl: `DEFAULT_ADMIN_ROLE` field readable (zero bytes).
 *
 * If this passes, every subsequent CMA spec can assume the composite-mock
 * harness is wired correctly.
 */
describe('Smoke — TestToken (composite) deploy + initial ledger', () => {
  let kit: TestTokenKit;

  beforeAll(async () => {
    kit = await deployTestToken({
      name: 'TestToken',
      symbol: 'TT',
      decimals: 6,
    });
  });

  afterAll(async () => {
    await kit?.teardown();
  });

  it('should deploy TestToken to the local node', () => {
    expect(kit.contractAddress).toMatch(/^[0-9a-f]+$/);
  });

  it('should set Initializable.isInitialized to true after the constructor', async () => {
    const ledger = await kit.readLedger();
    expect(ledger.Initializable__isInitialized).toBe(true);
  });

  it('should start with Pausable.isPaused = false', async () => {
    const ledger = await kit.readLedger();
    expect(ledger.Pausable__isPaused).toBe(false);
  });

  it('should round-trip FungibleToken name / symbol / decimals', async () => {
    const ledger = await kit.readLedger();
    expect(ledger.FungibleToken__name).toBe('TestToken');
    expect(ledger.FungibleToken__symbol).toBe('TT');
    expect(ledger.FungibleToken__decimals).toBe(6n);
  });

  it('should start with FungibleToken.totalSupply = 0', async () => {
    const ledger = await kit.readLedger();
    expect(ledger.FungibleToken__totalSupply).toBe(0n);
  });

  it('should expose AccessControl.DEFAULT_ADMIN_ROLE as a 32-byte ledger field', async () => {
    const ledger = await kit.readLedger();
    // Ledger field default is the all-zeros 32-byte role id; we just verify
    // it deserialises to a 32-byte Uint8Array (further specs will exercise
    // grantRole/_grantRole behaviour).
    expect(ledger.AccessControl_DEFAULT_ADMIN_ROLE).toBeInstanceOf(Uint8Array);
    expect(ledger.AccessControl_DEFAULT_ADMIN_ROLE.length).toBe(32);
  });
});
