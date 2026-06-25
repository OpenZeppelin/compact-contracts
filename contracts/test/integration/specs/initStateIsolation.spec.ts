import { describe, expect, it } from 'vitest';
import { ComposedTokensSimulator } from '../fixtures/composedTokens.js';
import { SharedInitCollisionSimulator } from '../fixtures/sharedInitCollision.js';

/**
 * Integration spec for issue #556 (compiler#270).
 *
 * Two composed contracts, both built from two modules living in the SAME
 * directory:
 *
 *  - `SharedInitCollision` — both modules import the shared, stateful
 *    `Initializable`. This reproduces the compiler bug: the transitive
 *    `_isInitialized` ledger state is deduplicated into ONE slot, so the two
 *    modules' initialization flags are entangled.
 *
 *  - `ComposedTokens` — the production FungibleToken + NonFungibleToken, each of
 *    which now owns its `_isInitialized` flag. This proves the fix: the two
 *    initializations are independent.
 *
 * The first block documents the bug (and would have to be deleted/inverted if
 * the compiler ever isolates transitive ledger state); the second block guards
 * the fix against regression.
 */

describe('Initializable state isolation (#556)', () => {
  describe('the bug — shared Initializable across same-directory modules', () => {
    it('should treat module B as initialized after only module A is initialized', () => {
      const c = new SharedInitCollisionSimulator();

      // Only module A is initialized.
      c.initA();

      // BUG: module B was never initialized, yet its init-guard passes,
      // because both modules share a single `_isInitialized` ledger slot.
      expect(() => c.checkB()).not.toThrow();
    });

    it('should not allow module B to initialize once module A has set the shared slot', () => {
      const c = new SharedInitCollisionSimulator();
      c.initA();

      // BUG: B can never be initialized — the shared slot is already set.
      expect(() => c.initB()).toThrow('Initializable: contract already initialized');
    });
  });

  describe('the fix — per-module flags keep production modules isolated', () => {
    it('should not initialize NonFungibleToken when only FungibleToken is initialized', () => {
      const c = new ComposedTokensSimulator(true, false);

      // FT is usable.
      expect(() => c.ftName()).not.toThrow();
      // NFT is independently still uninitialized.
      expect(() => c.nftName()).toThrow(
        'NonFungibleToken: contract not initialized',
      );
    });

    it('should not initialize FungibleToken when only NonFungibleToken is initialized', () => {
      const c = new ComposedTokensSimulator(false, true);

      expect(() => c.nftName()).not.toThrow();
      expect(() => c.ftName()).toThrow('FungibleToken: contract not initialized');
    });

    it('should initialize each module independently', () => {
      const c = new ComposedTokensSimulator(true, true);

      expect(() => c.ftName()).not.toThrow();
      expect(() => c.nftName()).not.toThrow();
    });
  });
});
