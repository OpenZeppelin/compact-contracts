import { LocalTestConfiguration } from '@midnight-ntwrk/testkit-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { localEnv, PORTS } from '../network.js';

describe('network config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  describe('PORTS', () => {
    it('should default to the local stack ports', () => {
      expect(PORTS).toStrictEqual({
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
