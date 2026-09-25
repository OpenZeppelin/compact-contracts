import path from 'node:path';
import { BlockLimitError } from '@openzeppelin/compact-deployer/errors';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Spies for everything buildContext delegates to, so it runs with no node and
// no artifact on disk. compact.toml is the real one.
const {
  registerSpy,
  createContextSpy,
  prepareSpy,
  deploySpy,
  disposeSpy,
  ensureSigningKeySpy,
} = vi.hoisted(() => {
  const deploySpy = vi.fn(async () => ({
    address: 'abc123',
    fragments: 1,
    circuits: 7,
  }));
  const disposeSpy = vi.fn(async () => {});
  return {
    registerSpy: vi.fn(),
    createContextSpy: vi.fn((_options: unknown) => ({ liveContext: true })),
    prepareSpy: vi.fn(async () => ({
      deploy: deploySpy,
      [Symbol.asyncDispose]: disposeSpy,
    })),
    deploySpy,
    disposeSpy,
    ensureSigningKeySpy: vi.fn(),
  };
});

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
vi.mock('@openzeppelin/compact-deployer/deployer', () => ({
  Deployer: { prepare: prepareSpy },
}));
vi.mock('../signingKey.js', () => ({ ensureSigningKey: ensureSigningKeySpy }));
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

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');

// What `localEnv()` builds from the default ports, as compact.toml declares.
const LOCAL_ENV = {
  networkId: 'undeployed',
  indexer: 'http://127.0.0.1:8088/api/v4/graphql',
  indexerWS: 'ws://127.0.0.1:8088/api/v4/graphql/ws',
  node: 'http://127.0.0.1:9944',
  nodeWS: 'ws://127.0.0.1:9944',
  proofServer: 'http://127.0.0.1:6300',
};

// register() + the artifactName guard use neither the pool, env, logger nor loader.
const guardBackend = () =>
  new LiveSimulatorBackend(
    undefined as never,
    undefined as never,
    undefined as never,
  );

// A fake pool + injected loader so the deploy path touches no node/artifact.
const ENCRYPTION_KEYS = new Map([['pk-deployer', 'epk-deployer']]);
const fakePool = {
  ensureReady: vi.fn(async () => {}),
  isKnownAlias: (a?: string | null) => a === 'SIGNER1' || a === 'deployer',
  walletFor: (a?: string | null) => ({ wallet: a }),
  encryptionKeysByCoinKey: () => ENCRYPTION_KEYS,
};
const fakeLogger = { info: vi.fn() };
const loadContract = vi.fn(async () => ({ Contract: class {} }));
const deployBackend = (env: object = LOCAL_ENV) =>
  new LiveSimulatorBackend(
    fakePool as never,
    env as never,
    fakeLogger as never,
    loadContract as never,
  );

const WITNESSES = { witness: true };

const REQUEST = {
  config: {
    artifactName: 'MockOwnable',
    witnessesFactory: () => WITNESSES,
    defaultPrivateState: () => 'ps0',
    contractArgs: (...a: unknown[]) => a,
  },
  options: {},
  contractArgs: ['arg0'] as unknown[],
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

    it('deploys through compact-deployer with the deployer wallet', async () => {
      const buildContext = capturedBuildContext(deployBackend());
      const ctx = await buildContext(REQUEST);

      expect(prepareSpy).toHaveBeenCalledTimes(1);
      expect(prepareSpy).toHaveBeenCalledWith({
        contract: 'MockOwnable',
        args: ['arg0'],
        initialPrivateState: 'ps0',
        witnesses: WITNESSES,
        walletProvider: { wallet: 'deployer' },
        privateStateProvider: { inMemory: true },
        logger: fakeLogger,
        network: 'local',
        configPath: path.join(REPO_ROOT, 'compact.toml'),
        record: false,
      });
      expect(disposeSpy).toHaveBeenCalledTimes(1);
      expect(createContextSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          contractAddress: 'abc123',
          privateStateId: 'MockOwnable-ps',
        }),
      );
      expect(ctx).toStrictEqual({ liveContext: true });
    });

    it("passes every pooled wallet's encryption key to the live context", async () => {
      const buildContext = capturedBuildContext(deployBackend());
      await buildContext(REQUEST);

      expect(createContextSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          scopedTransactionOptions: {
            additionalCoinEncPublicKeyMappings: ENCRYPTION_KEYS,
          },
        }),
      );
    });

    it('creates the compact.toml signing key before the deploy', async () => {
      const buildContext = capturedBuildContext(deployBackend());
      await buildContext(REQUEST);

      expect(ensureSigningKeySpy).toHaveBeenCalledExactlyOnceWith(
        path.join(REPO_ROOT, 'deploy', 'local.signingkey'),
      );
      expect(ensureSigningKeySpy.mock.invocationCallOrder[0]).toBeLessThan(
        prepareSpy.mock.invocationCallOrder[0],
      );
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

    it('rejects an artifact that no compact.toml entry covers', async () => {
      const buildContext = capturedBuildContext(deployBackend());
      await expect(
        buildContext({
          ...REQUEST,
          config: { ...REQUEST.config, artifactName: 'Probe' },
        }),
      ).rejects.toThrow(/^Contract "Probe" not defined/);
      expect(prepareSpy).not.toHaveBeenCalled();
    });

    it('rejects a stack whose endpoints differ from compact.toml', async () => {
      const buildContext = capturedBuildContext(
        deployBackend({
          ...LOCAL_ENV,
          indexer: 'http://127.0.0.1:18088/api/v4/graphql',
        }),
      );
      await expect(buildContext(REQUEST)).rejects.toThrow(
        'live backend: compact.toml [networks.local] does not match the live ' +
          'stack: indexer is http://127.0.0.1:8088/api/v4/graphql, harness ' +
          'uses http://127.0.0.1:18088/api/v4/graphql',
      );
      expect(prepareSpy).not.toHaveBeenCalled();
    });
  });

  describe('deploy retry', () => {
    it('retries once on a transient submission error', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      try {
        deploySpy
          .mockRejectedValueOnce(new Error('Transaction submission error'))
          .mockResolvedValueOnce({
            address: 'retried-ok',
            fragments: 1,
            circuits: 7,
          });
        const buildContext = capturedBuildContext(deployBackend());
        const pending = buildContext(REQUEST);
        await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
        await vi.advanceTimersByTimeAsync(1500); // cover the jittered backoff
        await pending;
        expect(prepareSpy).toHaveBeenCalledTimes(2);
        expect(disposeSpy).toHaveBeenCalledTimes(2);
        expect(createContextSpy).toHaveBeenCalledWith(
          expect.objectContaining({ contractAddress: 'retried-ok' }),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not retry a deterministic node rejection (RPC 1010)', async () => {
      const rejection = new Error(
        '1010: Invalid Transaction: Custom error: 103',
      );
      deploySpy.mockRejectedValueOnce(rejection);
      const buildContext = capturedBuildContext(deployBackend());
      await expect(buildContext(REQUEST)).rejects.toBe(rejection);
      expect(prepareSpy).toHaveBeenCalledTimes(1);
      expect(disposeSpy).toHaveBeenCalledTimes(1);
    });

    it('does not retry when 1010 is nested in the cause chain', async () => {
      const rpc = new Error('1010: Invalid Transaction: Custom error: 103');
      const inner = new Error('Transaction submission failed', { cause: rpc });
      const top = new Error('Transaction submission error', { cause: inner });
      deploySpy.mockRejectedValueOnce(top);
      const buildContext = capturedBuildContext(deployBackend());
      await expect(buildContext(REQUEST)).rejects.toBe(top);
      expect(prepareSpy).toHaveBeenCalledTimes(1);
    });

    it('does not retry a FiberFailure whose 1010 is only in toString()', async () => {
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
      expect(prepareSpy).toHaveBeenCalledTimes(1);
    });

    it('does not retry a block-limit refusal at one circuit per transaction', async () => {
      const refusal = new BlockLimitError(
        'Deploy tx was refused by the node as too large for one block at 1 ' +
          'circuit(s): 1010: Invalid Transaction: Transaction would exhaust ' +
          'the block limits',
      );
      deploySpy.mockRejectedValueOnce(refusal);
      const buildContext = capturedBuildContext(deployBackend());
      await expect(buildContext(REQUEST)).rejects.toBe(refusal);
      expect(prepareSpy).toHaveBeenCalledTimes(1);
    });
  });
});
