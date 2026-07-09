import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { describe, expect, it } from 'vitest';
import {
  contractOwner,
  getQualifiedShieldedCoinInfo,
  type ShieldedOwner,
} from '../NativeShieldedTokenTracker.js';

/**
 * Dry surface of the coin tracker — the backend-aware helpers specs call.
 *
 * `contractOwner` and the dry branch of `getQualifiedShieldedCoinInfo` are pure
 * (no indexer). The live index recovery (`decodeOutput` / `resolve` against the
 * indexer's event stream) needs a real serialized event and a running node, so
 * it's exercised by the live path, not here.
 */
describe('coin tracker (dry surface)', () => {
  describe('contractOwner', () => {
    it('should map a deployed simulator to its contract-address owner', () => {
      const owner = contractOwner({
        _backend: { contractAddress: 'deadbeef' },
      });
      expect(owner).toStrictEqual({ kind: 'contract', address: 'deadbeef' });
    });
  });

  // These assert the *dry* passthrough (a placeholder `mt_index` of `0n`, no
  // indexer). On the live backend `getQualifiedShieldedCoinInfo` instead resolves
  // a real commitment, so the dry assertions don't apply — the live path is
  // exercised by the contract live specs, not here.
  describe.skipIf(isLiveBackend())(
    'getQualifiedShieldedCoinInfo (dry backend)',
    () => {
      const coin = {
        nonce: new Uint8Array(32).fill(7),
        color: new Uint8Array(32).fill(1),
        value: 1000n,
      };

      it('should return the coin with a placeholder mt_index of 0n', async () => {
        const owner: ShieldedOwner = { kind: 'contract', address: 'abc' };
        const qualified = await getQualifiedShieldedCoinInfo(owner, coin);
        expect(qualified).toStrictEqual({ ...coin, mt_index: 0n });
      });

      it('should not consult the indexer for a wallet owner on the dry backend', async () => {
        // No indexer is running here; a dry resolve must be a pure passthrough.
        const owner: ShieldedOwner = { kind: 'wallet', coinPublicKey: 'pk' };
        const qualified = await getQualifiedShieldedCoinInfo(owner, coin);
        expect(qualified.mt_index).toBe(0n);
        expect(qualified.value).toBe(1000n);
      });
    },
  );
});
