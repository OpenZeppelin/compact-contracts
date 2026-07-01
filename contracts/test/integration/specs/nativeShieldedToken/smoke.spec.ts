import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
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
 *        - DerivedNonce: `_counter = 0`.
 *
 * If this passes, every subsequent native-token spec can assume the harness is
 * wired correctly.
 *
 * Verifies that the domain is present for color derivation, the supply and
 * derived-nonce counters start at 0, the immutable metadata is set, and the
 * contract is initialized after the constructor.
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

  it('should set _isInitialized to true after the constructor', async () => {
    // Initialization lives in NativeShieldedTokenCore behind a prefixed import,
    // so it is read through the circuit rather than the typed ledger.
    const initialized = (await kit.deployed.callTx.isInitialized()).private
      .result;
    expect(initialized).toBe(true);
  });

  it('should round-trip immutable metadata name / symbol / decimals', async () => {
    // Metadata also lives in the core module — read via circuits.
    expect((await kit.deployed.callTx.name()).private.result).toBe(
      'Native Shielded Token',
    );
    expect((await kit.deployed.callTx.symbol()).private.result).toBe('NST');
    expect((await kit.deployed.callTx.decimals()).private.result).toBe(6n);
  });

  it('should store the deployed domain separator', async () => {
    const ledger = await kit.readLedger();
    expect(ledger.NativeShieldedToken__domain).toBeInstanceOf(Uint8Array);
    expect(ledger.NativeShieldedToken__domain.length).toBe(32);
    expect(ledger.NativeShieldedToken__domain).toEqual(kit.domain);
  });

  it('should start with totalMinted = totalBurned = 0', async () => {
    // Supply totals live in NativeShieldedTokenSupplyCore behind a prefixed
    // import — read through the extension circuits.
    expect((await kit.deployed.callTx.totalMinted()).private.result).toBe(0n);
    expect((await kit.deployed.callTx.totalBurned()).private.result).toBe(0n);
  });

  it('should start the derived-nonce counter at 0', async () => {
    const ledger = await kit.readLedger();
    // The derived-nonce extension is counter-only: no seed field, the counter
    // starts at 0 and advances by 1 per derived mint (see mint.spec).
    expect(ledger.NativeShieldedTokenDerivedNonce__counter).toBe(0n);
  });
});
