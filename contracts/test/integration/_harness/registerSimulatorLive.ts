import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import {
  type LiveBackendRequest,
  type LiveContext,
  registerLiveBackend,
} from '@openzeppelin/compact-simulator';
import { contractAssetsPath, deployModule, moduleRootPath } from './deploy.js';
import {
  type LocalNetworkConfig,
  networkConfig,
  setupNetwork,
} from './network.js';
import type { OwnWalletProvider } from './ownWallet.js';
import { buildProviders } from './providers.js';
import { buildWallet } from './wallet.js';

/**
 * Wires the `@openzeppelin/compact-simulator` live backend to this repo's local
 * stack (`make env-up`). Registered once (from the `test:live` setup file);
 * afterwards a migrated spec's `await Sim.create()` deploys the contract named by
 * `SimulatorConfig.artifactName`, attaches, and returns a `LiveContext` — so the
 * same spec file runs unchanged on both `MIDNIGHT_BACKEND=dry` and `=live`.
 *
 * Deploy-per-`create()` gives each test a fresh contract (true isolation), which
 * the unit specs assume (they rely on `beforeEach`-fresh state).
 */

let env: LocalNetworkConfig | undefined;
let deployerPromise: Promise<OwnWalletProvider> | undefined;
let deployCounter = 0;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function getDeployer(): Promise<OwnWalletProvider> {
  if (!env) {
    setupNetwork();
    env = networkConfig();
  }
  if (!deployerPromise) {
    deployerPromise = (async () => {
      const wallet = await buildWallet(env as LocalNetworkConfig);
      // `buildWallet` waits for *shielded* sync; the deploy tx is paid in DUST,
      // so also wait for the dust wallet to sync — otherwise the first tx builds
      // a stale dust spend proof (node rejects with InvalidDustSpendProof).
      const dust = (
        wallet.facade as {
          dust?: { waitForSyncedState?: () => Promise<unknown> };
        }
      ).dust;
      if (typeof dust?.waitForSyncedState === 'function') {
        await dust.waitForSyncedState();
      }
      return wallet;
    })();
  }
  return deployerPromise;
}

async function buildLiveContext(
  req: LiveBackendRequest,
): Promise<LiveContext<unknown>> {
  const name = req.config.artifactName;
  if (!name) {
    throw new Error(
      'live backend: SimulatorConfig.artifactName is required to deploy on live',
    );
  }

  const contractEntry = pathToFileURL(
    path.join(moduleRootPath(name), 'contract', 'index.js'),
  ).href;
  const mod = await import(contractEntry);
  const ContractClass = mod.Contract;

  const witnesses = req.config.witnessesFactory();
  const compiled = CompiledContract.make(name, ContractClass).pipe(
    CompiledContract.withWitnesses((witnesses ?? {}) as never),
    CompiledContract.withCompiledFileAssets(contractAssetsPath(name)),
  );

  const deployer = await getDeployer();
  const psId = `${name}-ps`;
  const storeName = `${name}-${++deployCounter}`;
  // biome-ignore lint/suspicious/noExplicitAny: harness threads opaque midnight-js generics
  const providers = buildProviders(
    deployer,
    moduleRootPath(name),
    storeName,
  ) as any;

  const initialPS =
    req.options.privateState ?? req.config.defaultPrivateState();
  const args = req.config.contractArgs(...req.contractArgs);

  // Retry: a freshly-started dev node may still be ramping dust generation, and
  // the dust wallet's view can lag, yielding a transient InvalidDustSpendProof.
  let deployed: Awaited<ReturnType<typeof deployModule>> | undefined;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      // biome-ignore lint/suspicious/noExplicitAny: args shape is contract-specific
      deployed = await deployModule(
        providers,
        compiled,
        psId,
        initialPS,
        args as any,
      );
      break;
    } catch (err) {
      lastErr = err;
      await sleep(5000);
    }
  }
  if (!deployed) {
    throw new Error(
      `deploy of ${name} failed after retries: ${String(lastErr)}`,
    );
  }
  const address = deployed.deployTxData.public.contractAddress;

  return {
    contractAddress: address,
    handleFor: async () => ({
      // biome-ignore lint/suspicious/noExplicitAny: callTx is the midnight-js handle
      callTx: deployed.callTx as any,
    }),
    async queryLedger() {
      for (let attempt = 0; attempt < 15; attempt++) {
        const cs =
          await providers.publicDataProvider.queryContractState(address);
        if (cs != null) return cs.data;
        await sleep(400);
      }
      throw new Error(`no contract state at ${address} after retries`);
    },
    async queryPrivateState() {
      const ps = await providers.privateStateProvider.get(psId);
      return ps ?? initialPS;
    },
  };
}

let registered = false;

/** Registers the live backend. Idempotent per worker. */
export function registerSimulatorLiveBackend(): void {
  if (registered) return;
  registered = true;
  registerLiveBackend((req) => buildLiveContext(req));
}
