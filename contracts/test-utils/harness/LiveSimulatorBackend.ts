import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CompiledContract,
  type Contract as ContractNs,
} from '@midnight-ntwrk/compact-js';
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
import { CompactConfig } from '@openzeppelin/compact-deployer/config/compact-config';
import type { NetworkConfig } from '@openzeppelin/compact-deployer/config/schema';
import {
  Deployer,
  type DeployerOptions,
  type DeployResult,
} from '@openzeppelin/compact-deployer/deployer';
import {
  createLiveContext,
  type LiveBackendRequest,
  type LiveContext,
  registerLiveBackend,
} from '@openzeppelin/compact-simulator';
import { ensureSigningKey } from './signingKey.js';
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

/** The repo-root `compact.toml` every live deploy reads its settings from. */
const COMPACT_TOML = path.resolve(currentDir, '..', '..', '..', 'compact.toml');

/** The `compact.toml` network that describes the local stack. */
const NETWORK = 'local';

/**
 * The contract deployed here is chosen at runtime (by `artifactName`), so its
 * concrete type is unknowable at compile time. We model it as the library's own
 * "any contract" type and pin every piece (compiled contract, providers) to it:
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

/** Where the deployer writes its per-deploy progress. */
export type DeployLogger = DeployerOptions['logger'];

/** The `Deployer.prepare` options that vary per deploy. */
type DeployRequest = Pick<
  DeployerOptions,
  | 'contract'
  | 'args'
  | 'initialPrivateState'
  | 'witnesses'
  | 'walletProvider'
  | 'privateStateProvider'
  | 'logger'
>;

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

/**
 * Throws unless `compact.toml` describes the stack the harness talks to. The
 * deployer reads its endpoints from the file, the harness from `network.ts`.
 */
function assertSameStack(
  network: NetworkConfig,
  env: LocalTestConfiguration,
): void {
  const fields: [string, string | undefined, string][] = [
    ['network_id', network.network_id, env.networkId],
    ['indexer', network.indexer, env.indexer],
    ['indexer_ws', network.indexer_ws, env.indexerWS],
    ['node', network.node, env.node],
    ['node_ws', network.node_ws, env.nodeWS],
    ['proof_server', network.proof_server, env.proofServer],
  ];
  const diffs = fields
    .filter(([, file, harness]) => file !== harness)
    .map(
      ([key, file, harness]) => `${key} is ${file}, harness uses ${harness}`,
    );
  if (diffs.length > 0) {
    throw new Error(
      `live backend: compact.toml [networks.${NETWORK}] does not match the ` +
        `live stack: ${diffs.join('; ')}`,
    );
  }
}

const DETERMINISTIC_REJECTION = /1010: Invalid Transaction/;

/**
 * Whether `err` is a deterministic node rejection (RPC 1010 "Invalid
 * Transaction") that would fail identically on a retry — e.g. a shielded spend
 * the ledger rejects against stale node state (`Custom error: 103`). Retrying
 * only doubles the proving cost and the log noise.
 *
 * The 1010 text can hide behind an effect `FiberFailure` (which keeps its cause
 * chain behind a Symbol and only renders it via `toString()`) or a plain
 * `cause` / `AggregateError.errors` chain, so walk both: test `String(e)` (picks
 * up a custom `toString`) and each `Error`'s `message`, following `cause` and
 * `errors`. Cycle-safe.
 */
function isDeterministicRejection(err: unknown): boolean {
  const seen = new Set<unknown>();
  const queue: unknown[] = [err];
  while (queue.length > 0) {
    const e = queue.pop();
    if (e == null || seen.has(e)) continue;
    seen.add(e);
    if (DETERMINISTIC_REJECTION.test(String(e))) return true;
    if (e instanceof Error) {
      if (DETERMINISTIC_REJECTION.test(e.message)) return true;
      queue.push(e.cause);
      const { errors } = e as { errors?: unknown };
      if (Array.isArray(errors)) queue.push(...errors);
    }
  }
  return false;
}

/**
 * Deploy through `@openzeppelin/compact-deployer`, which reads the contract's
 * `compact.toml` entry and splits a deploy too large for one block across
 * several transactions. It keeps no deployments ledger, so every call deploys a
 * new contract.
 *
 * Retried once on failure with a jittered backoff. With parallel workers, several
 * deploys can contend for one block and the node may bounce a submission
 * ("Transaction submission error"); a single retry absorbs that race (and the
 * occasional transient submit flake). The jitter keeps contending workers from
 * retrying in lockstep.
 *
 * A deterministic node rejection (RPC 1010 "Invalid Transaction") is NOT retried
 * — it would fail identically. See {@link isDeterministicRejection}.
 */
async function deployArtifact(request: DeployRequest): Promise<DeployResult> {
  const deploy = async () => {
    const deployer = await Deployer.prepare({
      ...request,
      network: NETWORK,
      configPath: COMPACT_TOML,
      record: false,
    });
    // TODO: use `await using` once vitest's oxc transform targets node24.
    try {
      return await deployer.deploy();
    } finally {
      await deployer[Symbol.asyncDispose]();
    }
  };
  return deploy().catch(async (err: unknown) => {
    if (isDeterministicRejection(err)) throw err;
    await new Promise((resolve) => {
      setTimeout(resolve, 500 + Math.floor(Math.random() * 1000));
    });
    return deploy();
  });
}

export class LiveSimulatorBackend {
  private registered = false;
  private config: Promise<CompactConfig> | undefined;

  constructor(
    private readonly pool: WalletPool,
    private readonly env: LocalTestConfiguration,
    private readonly logger: DeployLogger,
    // Seam for tests: how a contract module is loaded from its artifact name.
    private readonly loadContract: LoadContract = importArtifact,
  ) {}

  /** Register with the simulator. Idempotent per worker. */
  register(): void {
    if (this.registered) return;
    this.registered = true;
    registerLiveBackend((req) => this.buildContext(req));
  }

  /** `compact.toml`, loaded once and checked against this harness's stack. */
  private loadConfig(): Promise<CompactConfig> {
    this.config ??= CompactConfig.load(COMPACT_TOML).then((config) => {
      assertSameStack(config.network(NETWORK), this.env);
      return config;
    });
    return this.config;
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
    const config = await this.loadConfig();
    const entry = config.contract(name);
    const privateStateId = entry.private_state_id;
    if (privateStateId === undefined) {
      throw new Error(
        `live backend: compact.toml gives "${name}" no private_state_id`,
      );
    }
    // The loaded constructor is the one genuinely-untyped value; the loader
    // pins it to a precise constructor type so `Contract.Any` flows from here.
    const { Contract: ctor } = await this.loadContract(name);
    const witnesses = req.config.witnessesFactory();
    const compiled = compileArtifact(name, ctor, witnesses);

    await this.pool.ensureReady();
    ensureSigningKey(path.resolve(config.rootDir, entry.signing_key_file));
    const shared = this.sharedProviders(name);
    const providersFor = makeProvidersFor(this.pool, shared);

    // The deploy is always signed by the deployer.
    const deployed = await deployArtifact({
      contract: name,
      args: req.config.contractArgs(...req.contractArgs),
      initialPrivateState:
        req.options.privateState ?? req.config.defaultPrivateState(),
      witnesses: (witnesses ?? {}) as object,
      walletProvider: this.pool.walletFor('deployer'),
      privateStateProvider: shared.privateStateProvider,
      logger: this.logger,
    });
    this.logger.info(
      {
        contract: name,
        address: deployed.address,
        fragments: deployed.fragments,
        circuits: deployed.circuits,
      },
      'Live deploy',
    );

    // The simulator assembles the LiveContext: per-alias `findDeployedContract`
    // handle cache, indexer-lag-absorbing public read, private-state read. Each
    // alias routes to its own wallet's providers so caller identity varies.
    return createLiveContext({
      contractAddress: deployed.address,
      providersFor,
      compiledContract: compiled,
      privateStateId,
      publicDataProvider: shared.publicDataProvider,
      privateStateProvider: shared.privateStateProvider,
    });
  }
}
