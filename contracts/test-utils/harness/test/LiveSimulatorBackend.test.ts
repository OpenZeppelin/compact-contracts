import { beforeEach, describe, expect, it, vi } from 'vitest';

// Spies for everything buildContext delegates to, so it runs with no node and
// no artifact on disk.
const { registerSpy, createContextSpy, deploySpy } = vi.hoisted(() => ({
  registerSpy: vi.fn(),
  createContextSpy: vi.fn(() => ({ liveContext: true })),
  deploySpy: vi.fn(async () => ({
    deployTxData: { public: { contractAddress: 'abc123' } },
  })),
}));

vi.mock('@openzeppelin/compact-simulator', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@openzeppelin/compact-simulator')>();
  return {
    ...actual,
    registerLiveBackend: registerSpy,
    createLiveContext: createContextSpy,
  };
});
vi.mock('@midnight-ntwrk/compact-js', () => ({
  CompiledContract: {
    make: vi.fn(() => ({ pipe: vi.fn(() => ({ compiled: true })) })),
    withWitnesses: vi.fn(() => 'with-witnesses'),
    withCompiledFileAssets: vi.fn(() => 'with-assets'),
  },
}));
vi.mock('@midnight-ntwrk/midnight-js-contracts', () => ({
  deployContract: deploySpy,
}));
vi.mock('@midnight-ntwrk/testkit-js', () => ({
  inMemoryPrivateStateProvider: vi.fn(() => ({ inMemory: true })),
}));
vi.mock('@midnight-ntwrk/midnight-js-indexer-public-data-provider', () => ({
  indexerPublicDataProvider: vi.fn(() => ({ publicData: true })),
}));
vi.mock('@midnight-ntwrk/midnight-js-http-client-proof-provider', () => ({
  httpClientProofProvider: vi.fn(() => ({ proof: true })),
}));
vi.mock('@midnight-ntwrk/midnight-js-node-zk-config-provider', () => ({
  NodeZkConfigProvider: class {
    constructor(readonly dir: string) {}
  },
}));

import { LiveSimulatorBackend } from '../LiveSimulatorBackend.js';

// register() + the artifactName guard use neither the pool, env, nor loader.
const guardBackend = () =>
  new LiveSimulatorBackend(undefined as never, undefined as never);

// A fake pool + injected loader so the deploy path touches no node/artifact.
const fakePool = {
  ensureReady: vi.fn(async () => {}),
  isKnownAlias: (a?: string | null) => a === 'SIGNER1' || a === 'deployer',
  walletFor: (a?: string | null) => ({ wallet: a }),
};
const loadContract = vi.fn(async () => ({ Contract: class {} }));
const deployBackend = () =>
  new LiveSimulatorBackend(
    fakePool as never,
    {} as never,
    loadContract as never,
  );

const REQUEST = {
  config: {
    artifactName: 'Probe',
    witnessesFactory: () => ({}),
    defaultPrivateState: () => 'ps0',
    contractArgs: (...a: unknown[]) => a,
  },
  options: {},
  contractArgs: [] as unknown[],
};

/** register the backend and return the callback it handed the simulator. */
function capturedBuildContext(
  b: LiveSimulatorBackend,
): (req: unknown) => Promise<unknown> {
  b.register();
  return registerSpy.mock.calls.at(-1)?.[0] as (
    req: unknown,
  ) => Promise<unknown>;
}

describe('LiveSimulatorBackend', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('register', () => {
    it('should register with the live backend on the first call', () => {
      guardBackend().register();
      expect(registerSpy).toHaveBeenCalledTimes(1);
      expect(typeof registerSpy.mock.calls[0][0]).toBe('function');
    });

    it('should not register again on a second call (idempotent)', () => {
      const b = guardBackend();
      b.register();
      b.register();
      expect(registerSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('buildContext', () => {
    it('should reject a request that is missing an artifactName', async () => {
      const buildContext = capturedBuildContext(guardBackend());
      await expect(
        buildContext({ config: { artifactName: undefined } }),
      ).rejects.toThrow(/artifactName is required/);
    });

    it('should deploy with the deployer wallet and return the live context', async () => {
      const buildContext = capturedBuildContext(deployBackend());
      const ctx = await buildContext(REQUEST);

      expect(deploySpy).toHaveBeenCalledTimes(1);
      const deployProviders = deploySpy.mock.calls[0][0] as {
        walletProvider: { wallet: string };
      };
      expect(deployProviders.walletProvider).toEqual({ wallet: 'deployer' });

      expect(createContextSpy).toHaveBeenCalledWith(
        expect.objectContaining({ contractAddress: 'abc123' }),
      );
      expect(ctx).toEqual({ liveContext: true });
    });

    it('should route an unknown caller alias to the deployer wallet', async () => {
      const buildContext = capturedBuildContext(deployBackend());
      await buildContext(REQUEST);

      const { providersFor } = createContextSpy.mock.calls[0][0] as {
        providersFor: (a?: string | null) => {
          walletProvider: { wallet: string };
        };
      };
      expect(providersFor('OTHER').walletProvider).toEqual({
        wallet: 'deployer',
      });
      expect(providersFor('SIGNER1').walletProvider).toEqual({
        wallet: 'SIGNER1',
      });
    });
  });

  describe('deploy retry', () => {
    it('should retry once on a transient submission error', async () => {
      vi.useFakeTimers();
      try {
        deploySpy
          .mockRejectedValueOnce(new Error('Transaction submission error'))
          .mockResolvedValueOnce({
            deployTxData: { public: { contractAddress: 'retried-ok' } },
          });
        const buildContext = capturedBuildContext(deployBackend());
        const pending = buildContext(REQUEST);
        await vi.advanceTimersByTimeAsync(1500); // cover the jittered backoff
        await pending;
        expect(deploySpy).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('should not retry a deterministic node rejection (RPC 1010)', async () => {
      const rejection = new Error(
        '1010: Invalid Transaction: Custom error: 103',
      );
      deploySpy.mockRejectedValueOnce(rejection);
      const buildContext = capturedBuildContext(deployBackend());
      await expect(buildContext(REQUEST)).rejects.toBe(rejection);
      expect(deploySpy).toHaveBeenCalledTimes(1);
    });

    it('should not retry when 1010 is nested in the cause chain', async () => {
      const rpc = new Error('1010: Invalid Transaction: Custom error: 103');
      const inner = new Error('Transaction submission failed', { cause: rpc });
      const top = new Error('Transaction submission error', { cause: inner });
      deploySpy.mockRejectedValueOnce(top);
      const buildContext = capturedBuildContext(deployBackend());
      await expect(buildContext(REQUEST)).rejects.toBe(top);
      expect(deploySpy).toHaveBeenCalledTimes(1);
    });

    it('should not retry a FiberFailure whose 1010 is only in toString()', async () => {
      // effect's FiberFailure hides its cause behind a Symbol; the 1010 text is
      // reachable only via toString(), not `.message` or `.cause`.
      const fiberFailure = {
        message: 'Transaction submission error',
        toString: () =>
          'FiberFailure: 1010: Invalid Transaction: Custom error: 103',
      };
      deploySpy.mockRejectedValueOnce(fiberFailure);
      const buildContext = capturedBuildContext(deployBackend());
      await expect(buildContext(REQUEST)).rejects.toBe(fiberFailure);
      expect(deploySpy).toHaveBeenCalledTimes(1);
    });
  });
});
