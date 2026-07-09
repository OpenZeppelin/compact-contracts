import { beforeEach, describe, expect, it, vi } from 'vitest';

// Spies for everything buildContext delegates to, so it runs with no node and
// no artifact on disk.
const { registerSpy, createContextSpy, deploySpy, initProvidersSpy } =
  vi.hoisted(() => ({
    registerSpy: vi.fn(),
    createContextSpy: vi.fn(() => ({ liveContext: true })),
    deploySpy: vi.fn(async () => ({
      deployTxData: { public: { contractAddress: 'abc123' } },
    })),
    initProvidersSpy: vi.fn(
      (
        wallet: unknown,
        _env: unknown,
        opts: { privateStateStoreName: string },
      ) => ({
        walletProvider: wallet,
        publicDataProvider: `pub:${opts.privateStateStoreName}`,
        privateStateProvider: `priv:${opts.privateStateStoreName}`,
      }),
    ),
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
  initializeMidnightProviders: initProvidersSpy,
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
});
