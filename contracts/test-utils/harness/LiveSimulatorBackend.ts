import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CompiledContract,
  type Contract as ContractNs,
} from '@midnight-ntwrk/compact-js';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import {
  initializeMidnightProviders,
  type LocalTestConfiguration,
} from '@midnight-ntwrk/testkit-js';
import {
  createLiveContext,
  type LiveBackendRequest,
  type LiveContext,
  registerLiveBackend,
} from '@openzeppelin/compact-simulator';
import type { WalletPool } from './WalletPool.js';

/**
 * Bridges the `@openzeppelin/compact-simulator` live backend to the local stack:
 * on each `Sim.create()` it deploys the requested artifact (signed by the
 * deployer) and returns a `LiveContext` whose per-alias providers route each
 * caller's calls through that signer's wallet.
 *
 * Deploy-per-`create()` gives each test a fresh contract, matching the unit
 * specs' `beforeEach`-fresh-state assumption.
 */

const currentDir = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path to `contracts/artifacts/<name>/` (the ZK keys + zkir root). */
function moduleRootPath(name: string): string {
  // this harness lives at contracts/test-utils/harness/;
  // artifacts live at        contracts/artifacts/<name>/
  return path.resolve(currentDir, '..', '..', 'artifacts', name);
}

/**
 * The contract deployed here is chosen at runtime (by `artifactName`), so its
 * concrete type is unknowable at compile time. We model it as the library's own
 * "any contract" type and pin every piece (compiled contract, providers, deploy
 * options) to it, so `deployContract` infers `C = Contract.Any` consistently —
 * `CompiledContract` is invariant in `C`, so provider and compiled types must
 * agree exactly.
 */
type AnyContract = ContractNs.Any;

/** The compiled artifact's module shape — its generated `Contract` constructor. */
type ContractModule = { Contract: new (...args: unknown[]) => AnyContract };

/** Loads a compiled contract module by artifact name. Injectable for tests. */
export type LoadContract = (name: string) => Promise<ContractModule>;

/** Default loader: dynamic-import the artifact's generated `contract/index.js`. */
const importArtifact: LoadContract = (name) =>
  import(
    pathToFileURL(path.join(moduleRootPath(name), 'contract', 'index.js')).href
  ) as Promise<ContractModule>;

export class LiveSimulatorBackend {
  private deployCounter = 0;
  private registered = false;

  constructor(
    private readonly pool: WalletPool,
    private readonly env: LocalTestConfiguration,
    // Seam for tests: how a contract module is loaded from its artifact name.
    private readonly loadContract: LoadContract = importArtifact,
  ) {}

  /** Register with the simulator. Idempotent per worker. */
  register(): void {
    if (this.registered) return;
    this.registered = true;
    registerLiveBackend((req) => this.buildContext(req));
  }

  private async buildContext(
    req: LiveBackendRequest,
  ): Promise<LiveContext<unknown>> {
    const name = req.config.artifactName;
    if (!name) {
      throw new Error(
        'live backend: SimulatorConfig.artifactName is required to deploy on live',
      );
    }

    // The loaded constructor is the one genuinely-untyped value; the loader
    // pins it to a precise constructor type so `Contract.Any` flows from here.
    const { Contract: ctor } = await this.loadContract(name);

    const witnesses = req.config.witnessesFactory();
    const compiled = CompiledContract.make(name, ctor).pipe(
      // The first `.pipe` combinator sees the compiled contract's full unresolved
      // requirement union (witnesses + assets path), which the effect builder's
      // phantom-context type narrows to `never`; the assets step below then reads
      // cleanly. This single cast is intrinsic to the builder's typing.
      CompiledContract.withWitnesses((witnesses ?? {}) as never),
      CompiledContract.withCompiledFileAssets(
        path.join(moduleRootPath(name), 'contract'),
      ),
    );

    await this.pool.ensureReady();
    const privateStateId = `${name}-ps`;

    // Providers per caller alias: each pooled wallet gets its own private-state
    // store for this contract, so `.as('SIGNER1')` submits calls from SIGNER1's
    // wallet (its `ownPublicKey()`) while an unknown alias falls back to the
    // deployer. Built lazily and cached per alias within this deployment.
    const providersByAlias = new Map<
      string,
      ReturnType<
        typeof initializeMidnightProviders<
          ContractNs.ProvableCircuitId<AnyContract>,
          ContractNs.PrivateState<AnyContract>
        >
      >
    >();
    const providersFor = (alias?: string | null) => {
      const key = this.pool.isKnownAlias(alias)
        ? (alias as string)
        : 'deployer';
      let providers = providersByAlias.get(key);
      if (!providers) {
        providers = initializeMidnightProviders<
          ContractNs.ProvableCircuitId<AnyContract>,
          ContractNs.PrivateState<AnyContract>
        >(this.pool.walletFor(key), this.env, {
          // Unique per (contract, alias) so each test/caller gets an isolated store.
          privateStateStoreName: `${name}-${key}-${++this.deployCounter}`,
          zkConfigPath: moduleRootPath(name),
        });
        providersByAlias.set(key, providers);
      }
      return providers;
    };

    // The deploy is always signed by the deployer.
    const providers = providersFor('deployer');
    const initialPrivateState =
      req.options.privateState ?? req.config.defaultPrivateState();
    const args = req.config.contractArgs(...req.contractArgs);

    const deployed = await deployContract(providers, {
      compiledContract: compiled,
      privateStateId,
      initialPrivateState,
      args,
    });
    const contractAddress = deployed.deployTxData.public.contractAddress;

    // The simulator assembles the LiveContext: per-alias `findDeployedContract`
    // handle cache, indexer-lag-absorbing public read, private-state read. Each
    // alias routes to its own wallet's providers so caller identity varies.
    return createLiveContext({
      contractAddress,
      providersFor,
      compiledContract: compiled,
      privateStateId,
      publicDataProvider: providers.publicDataProvider,
      privateStateProvider: providers.privateStateProvider,
    });
  }
}
