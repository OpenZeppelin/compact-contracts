import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CompiledContract,
  type Contract as ContractNs,
} from '@midnight-ntwrk/compact-js';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import type {
  MidnightProviders,
  PrivateStateId,
} from '@midnight-ntwrk/midnight-js-types';
import {
  inMemoryPrivateStateProvider,
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
type CircuitId = ContractNs.ProvableCircuitId<AnyContract>;
type PrivateState = ContractNs.PrivateState<AnyContract>;

/** The compiled artifact's module shape — its generated `Contract` constructor. */
type ContractModule = { Contract: new (...args: unknown[]) => AnyContract };

/** Loads a compiled contract module by artifact name. Injectable for tests. */
export type LoadContract = (name: string) => Promise<ContractModule>;

/** Default loader: dynamic-import the artifact's generated `contract/index.js`. */
const importArtifact: LoadContract = (name) =>
  import(
    pathToFileURL(path.join(moduleRootPath(name), 'contract', 'index.js')).href
  ) as Promise<ContractModule>;

/** The midnight-js provider bundle, pinned to the runtime-chosen contract. */
type Providers = MidnightProviders<CircuitId, PrivateStateId, PrivateState>;

/** The providers that don't depend on the caller (everything but the wallet). */
type SharedProviders = Omit<Providers, 'walletProvider' | 'midnightProvider'>;

/** Resolves the provider bundle for a caller alias (unknown → deployer). */
type ProvidersFor = (alias?: string | null) => Providers;

/** The compiled + witness-bound contract handle deploy/createLiveContext consume. */
type CompiledArtifact = ReturnType<typeof compileArtifact>;

/** The artifact name to deploy, or throw if the spec set none. */
function requireArtifactName(req: LiveBackendRequest): string {
  const name = req.config.artifactName;
  if (!name) {
    throw new Error(
      'live backend: SimulatorConfig.artifactName is required to deploy on live',
    );
  }
  return name;
}

/** Bind the artifact's constructor to its witnesses and compiled-file assets. */
function compileArtifact(
  name: string,
  ctor: ContractModule['Contract'],
  witnesses: unknown,
) {
  return CompiledContract.make(name, ctor).pipe(
    // The first `.pipe` combinator sees the compiled contract's full unresolved
    // requirement union (witnesses + assets path), which the effect builder's
    // phantom-context type narrows to `never`; the assets step below then reads
    // cleanly. This single cast is intrinsic to the builder's typing.
    CompiledContract.withWitnesses((witnesses ?? {}) as never),
    CompiledContract.withCompiledFileAssets(
      path.join(moduleRootPath(name), 'contract'),
    ),
  );
}

/** Reads on-chain public state + tx status from the indexer. */
function makePublicDataProvider(env: LocalTestConfiguration) {
  return indexerPublicDataProvider(env.indexer, env.indexerWS);
}

/** Loads the artifact's proving keys + zkir from `contracts/artifacts/<name>/`. */
function makeZkConfigProvider(name: string) {
  return new NodeZkConfigProvider<CircuitId>(moduleRootPath(name));
}

/** Proves transactions against the local proof server. */
function makeProofProvider(
  env: LocalTestConfiguration,
  zkConfigProvider: ReturnType<typeof makeZkConfigProvider>,
) {
  return httpClientProofProvider(env.proofServer, zkConfigProvider);
}

/**
 * A single in-memory private-state store, shared across every caller alias so
 * the deploy's initial private state is visible to each `.as(alias)`.
 *
 * testkit's default (a per-provider on-disk LevelDB) cannot serve this: every
 * provider opens the same DB directory (only one handle allowed) AND scopes
 * state by the wallet's coin public key, so a non-deployer signer both fought
 * over the lock and never saw the deployed state. In-memory sidesteps both and
 * keeps the run hermetic — no disk, no stale state across runs.
 */
function makePrivateStateProvider() {
  return inMemoryPrivateStateProvider<PrivateStateId, PrivateState>();
}

/**
 * A per-alias provider resolver over one set of {@link SharedProviders}: each
 * alias reuses the shared providers and swaps in its own wallet, so
 * `.as('SIGNER1')` submits + pays from SIGNER1 (its `ownPublicKey()`) while
 * reading the same private state. An unknown alias falls back to the deployer.
 */
function makeProvidersFor(
  pool: WalletPool,
  shared: SharedProviders,
): ProvidersFor {
  const cache = new Map<string, Providers>();
  return (alias) => {
    const key = pool.isKnownAlias(alias) ? (alias as string) : 'deployer';
    let providers = cache.get(key);
    if (!providers) {
      const wallet = pool.walletFor(key);
      providers = {
        ...shared,
        walletProvider: wallet,
        midnightProvider: wallet,
      };
      cache.set(key, providers);
    }
    return providers;
  };
}

/** Deploy the compiled contract with `providers` and return its address. */
async function deployArtifact(
  providers: Providers,
  compiled: CompiledArtifact,
  privateStateId: string,
  req: LiveBackendRequest,
): Promise<string> {
  const initialPrivateState =
    req.options.privateState ?? req.config.defaultPrivateState();
  const args = req.config.contractArgs(...req.contractArgs);
  const deployed = await deployContract(providers, {
    compiledContract: compiled,
    privateStateId,
    initialPrivateState,
    args,
  });
  return deployed.deployTxData.public.contractAddress;
}

export class LiveSimulatorBackend {
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

  /** Build the caller-independent providers once for one deployment. */
  private sharedProviders(name: string): SharedProviders {
    const zkConfigProvider = makeZkConfigProvider(name);
    return {
      publicDataProvider: makePublicDataProvider(this.env),
      zkConfigProvider,
      proofProvider: makeProofProvider(this.env, zkConfigProvider),
      privateStateProvider: makePrivateStateProvider(),
    };
  }

  /** Deploy the requested artifact and assemble its `LiveContext`. */
  private async buildContext(
    req: LiveBackendRequest,
  ): Promise<LiveContext<unknown>> {
    const name = requireArtifactName(req);
    // The loaded constructor is the one genuinely-untyped value; the loader
    // pins it to a precise constructor type so `Contract.Any` flows from here.
    const { Contract: ctor } = await this.loadContract(name);
    const compiled = compileArtifact(name, ctor, req.config.witnessesFactory());

    await this.pool.ensureReady();
    const privateStateId = `${name}-ps`;
    const shared = this.sharedProviders(name);
    const providersFor = makeProvidersFor(this.pool, shared);

    // The deploy is always signed by the deployer.
    const providers = providersFor('deployer');
    const contractAddress = await deployArtifact(
      providers,
      compiled,
      privateStateId,
      req,
    );

    // The simulator assembles the LiveContext: per-alias `findDeployedContract`
    // handle cache, indexer-lag-absorbing public read, private-state read. Each
    // alias routes to its own wallet's providers so caller identity varies.
    return createLiveContext({
      contractAddress,
      providersFor,
      compiledContract: compiled,
      privateStateId,
      publicDataProvider: shared.publicDataProvider,
      privateStateProvider: shared.privateStateProvider,
    });
  }
}
