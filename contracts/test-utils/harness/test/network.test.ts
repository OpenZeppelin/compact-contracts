import { LocalTestConfiguration } from '@midnight-ntwrk/testkit-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { localEnv } from '../network.js';

describe('network config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  describe('PORTS', () => {
    it('should default to the local stack ports', async () => {
      // Clear any real overrides so a dev/CI env with MIDNIGHT_*_PORT set does
      // not fail this default assertion; re-import so PORTS re-evaluates.
      vi.stubEnv('MIDNIGHT_INDEXER_PORT', undefined);
      vi.stubEnv('MIDNIGHT_NODE_PORT', undefined);
      vi.stubEnv('MIDNIGHT_PROOF_SERVER_PORT', undefined);
      vi.resetModules();
      const { PORTS: defaults } = await import('../network.js');
      expect(defaults).toStrictEqual({
        indexer: 8088,
        node: 9944,
        proofServer: 6300,
      });
    });

    it('should override each port from its env var', async () => {
      vi.stubEnv('MIDNIGHT_INDEXER_PORT', '18088');
      vi.stubEnv('MIDNIGHT_NODE_PORT', '19944');
      vi.stubEnv('MIDNIGHT_PROOF_SERVER_PORT', '16300');
      vi.resetModules();
      const { PORTS: overridden } = await import('../network.js');
      expect(overridden).toStrictEqual({
        indexer: 18088,
        node: 19944,
        proofServer: 16300,
      });
    });
  });

  describe('localEnv', () => {
    it('should build a testkit LocalTestConfiguration', () => {
      expect(localEnv()).toBeInstanceOf(LocalTestConfiguration);
    });

    it('should return a fresh config each call', () => {
      expect(localEnv()).not.toBe(localEnv());
    });
  });
});
