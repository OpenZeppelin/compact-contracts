import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_NONCE_SEED,
  deployNativeShieldedTokenV1,
  type NativeShieldedTokenV1Kit,
} from '../../fixtures/nativeShieldedToken.js';

/**
 * Smoke spec — proves the native-shielded-token integration harness works
 * end-to-end against the single deployable (`NativeShieldedTokenV1` = Fungible
 * module + derived-nonce extension):
 *   1. the local node / indexer / proof server are reachable,
 *   2. the contract deploys (both composed modules wired through the
 *      constructor, all circuits compiled with ZK keys),
 *   3. its initial public ledger is queryable:
 *        - NativeShieldedToken: `_isInitialized = true`, metadata round-trips,
 *          `totalMinted = totalBurned = 0`, `_domain` is the deployed value,
 *        - DerivedNonce: `_nonce` seeded (non-zero), `_counter = 0`.
 *
 * If this passes, every subsequent native-token spec can assume the harness is
 * wired correctly.
 *
 * Verifies: INV-1 (domain present for color derivation), INV-2/INV-4 (counters
 * start at 0), INV-13 (chain seeded non-zero), INV-14 (immutable metadata set),
 * INV-15 (initialized after constructor).
 */
describe('Smoke — NativeShieldedTokenV1 deploy + initial ledger', () => {
  let kit: NativeShieldedTokenV1Kit;

  beforeAll(async () => {
    kit = await deployNativeShieldedTokenV1({
      name: 'Native Shielded Token',
      symbol: 'NST',
      decimals: 6,
    });
  });

  afterAll(async () => {
    await kit?.teardown();
  });

  it('should deploy NativeShieldedTokenV1 to the local node', () => {
    expect(kit.contractAddress).toMatch(/^[0-9a-f]+$/);
  });

  it('should set _isInitialized to true after the constructor (INV-15)', async () => {
    const ledger = await kit.readLedger();
    expect(ledger.NativeShieldedToken__isInitialized).toBe(true);
  });

  it('should round-trip immutable metadata name / symbol / decimals (INV-14)', async () => {
    const ledger = await kit.readLedger();
    expect(ledger.NativeShieldedToken__name).toBe('Native Shielded Token');
    expect(ledger.NativeShieldedToken__symbol).toBe('NST');
    expect(ledger.NativeShieldedToken__decimals).toBe(6n);
  });

  it('should store the deployed domain separator (INV-1)', async () => {
    const ledger = await kit.readLedger();
    expect(ledger.NativeShieldedToken__domain).toBeInstanceOf(Uint8Array);
    expect(ledger.NativeShieldedToken__domain.length).toBe(32);
    expect(ledger.NativeShieldedToken__domain).toEqual(kit.domain);
  });

  it('should start with totalMinted = totalBurned = 0 (INV-2, INV-4)', async () => {
    const ledger = await kit.readLedger();
    expect(ledger.NativeShieldedTokenSupply__totalMinted).toBe(0n);
    expect(ledger.NativeShieldedTokenSupply__totalBurned).toBe(0n);
  });

  it('should seed the derived-nonce chain non-zero with counter 0 (INV-13)', async () => {
    const ledger = await kit.readLedger();
    expect(ledger.NativeShieldedTokenDerivedNonce__counter).toBe(0n);
    expect(ledger.NativeShieldedTokenDerivedNonce__nonce).toEqual(
      DEFAULT_NONCE_SEED,
    );
    // Non-zero seed: the all-zero value is indistinguishable from an unseeded
    // chain and is rejected by the extension's `initialize`.
    expect(
      ledger.NativeShieldedTokenDerivedNonce__nonce.some((b) => b !== 0),
    ).toBe(true);
  });
});
