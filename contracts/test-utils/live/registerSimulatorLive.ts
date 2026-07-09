import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CompiledContract,
  type Contract as ContractNs,
} from '@midnight-ntwrk/compact-js';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import {
  createLogger,
  initializeMidnightProviders,
  LocalTestConfiguration,
  MidnightWalletProvider,
} from '@midnight-ntwrk/testkit-js';
import {
  createLiveContext,
  type LiveBackendRequest,
  type LiveContext,
  registerLiveBackend,
} from '@openzeppelin/compact-simulator';

/**
 * Wires the `@openzeppelin/compact-simulator` live backend to the local stack
 * (`make env-up`) using `@midnight-ntwrk/testkit-js` as the driver: testkit
 * owns the wallet (genesis-mint seed, dust bootstrap) and provider wiring; the
 * simulator's `createLiveContext` owns the per-alias handle cache and the
 * indexer-lag-absorbing reads. Registered once from the `test:live` setup file,
 * so a migrated spec's `await Sim.create()` deploys the contract named by
 * `SimulatorConfig.artifactName` and runs unchanged on both
 * `MIDNIGHT_BACKEND=dry` and `=live`.
 *
 * Deploy-per-`create()` gives each test a fresh contract, matching the unit
 * specs' `beforeEach`-fresh-state assumption.
 */

const currentDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * The prefunded dev-preset wallet pool. `midnight-node --preset=dev` funds seeds
 * `0x..01`–`0x..04` with NIGHT (dust) + shielded coins. `deployer` pays for every
 * deploy and is the default caller; `SIGNER1`–`SIGNER3` back distinct on-chain
 * identities, so a multisig spec's `.as('SIGNER1')` submits from a wallet whose
 * `ownPublicKey()` differs from the others (the only way to exercise multi-signer
 * authorization on live — a single wallet can't impersonate three signers).
 * Override the deployer slot via `MIDNIGHT_WALLET_SEED`.
 */
const seed = (lastByte: number): string => `${'0'.repeat(63)}${lastByte}`;
const WALLET_SEEDS: Readonly<Record<string, string>> = {
  deployer: process.env.MIDNIGHT_WALLET_SEED ?? seed(1),
  SIGNER1: seed(2),
  SIGNER2: seed(3),
  SIGNER3: seed(4),
};

/** The env var carrying an alias's coin public key (e.g. `MIDNIGHT_SIGNER1_COIN_PK`,
 * `MIDNIGHT_DEPLOYER_COIN_PK`). Specs read these to build a live signer set. */
const coinPkEnv = (alias: string): string =>
  `MIDNIGHT_${alias === 'deployer' ? 'DEPLOYER' : alias}_COIN_PK`;

/**
 * Fixed ports of the local stack (`local-env.yml`). `LocalTestConfiguration`
 * builds the `127.0.0.1` `/api/v4/graphql` URLs from these; override per port
 * for a relocated stack.
 */
const PORTS = {
  indexer: Number(process.env.MIDNIGHT_INDEXER_PORT ?? 8088),
  node: Number(process.env.MIDNIGHT_NODE_PORT ?? 9944),
  proofServer: Number(process.env.MIDNIGHT_PROOF_SERVER_PORT ?? 6300),
};

const logger = createLogger('logs/live-harness.log');

/** Absolute path to `contracts/artifacts/<name>/` (the ZK keys + zkir root). */
function moduleRootPath(name: string): string {
  // this harness lives at contracts/test-utils/live/;
  // artifacts live at        contracts/artifacts/<name>/
  return path.resolve(currentDir, '..', '..', 'artifacts', name);
}

let env: LocalTestConfiguration | undefined;
const wallets = new Map<string, MidnightWalletProvider>();
let readyPromise: Promise<void> | undefined;
let deployCounter = 0;

function getEnv(): LocalTestConfiguration {
  if (!env) env = new LocalTestConfiguration(PORTS);
  return env;
}

/**
 * Builds and starts one pooled wallet. `start(true)` syncs it and registers its
 * NIGHT UTXOs for dust generation, so its first tx has spendable dust (no
 * transient `InvalidDustSpendProof`). Publishes the wallet's coin public key
 * (`MIDNIGHT_<ALIAS>_COIN_PK`) so specs can target a recipient/signer whose
 * encryption key the node can resolve (its own — a fabricated test key has none).
 */
async function buildWallet(alias: string): Promise<void> {
  const wallet = await MidnightWalletProvider.build(
    logger,
    getEnv(),
    WALLET_SEEDS[alias],
  );
  await wallet.start(true);
  process.env[coinPkEnv(alias)] = String(wallet.getCoinPublicKey());
  wallets.set(alias, wallet);
}

/**
 * Builds, syncs, and publishes the coin public key of every pooled wallet
 * (`deployer` + `SIGNER1`–`SIGNER3`) once per worker, concurrently. Call from the
 * live setup file so specs can read the keys at module load (e.g. a forwarder's
 * parent key, or a multisig's live signer set) and `providersFor` can resolve a
 * wallet synchronously per call. Idempotent; a no-op-cost await after the first.
 */
export function ensureLiveSignersReady(): Promise<void> {
  if (!readyPromise) {
    readyPromise = Promise.all(Object.keys(WALLET_SEEDS).map(buildWallet)).then(
      () => undefined,
    );
  }
  return readyPromise;
}

/** Back-compat alias: the deployer key is published as part of the pool. */
export const ensureLiveDeployerReady = ensureLiveSignersReady;

/**
 * The already-built wallet for `alias` (requires {@link ensureLiveSignersReady}).
 * An unknown alias falls back to the deployer, so `.as('OTHER')` acts as a funded
 * non-signer caller rather than erroring.
 */
function walletFor(alias: string | null | undefined): MidnightWalletProvider {
  const wallet =
    (alias ? wallets.get(alias) : undefined) ?? wallets.get('deployer');
  if (!wallet) {
    throw new Error(
      'live wallets not initialized — call ensureLiveSignersReady() in the test:live setup',
    );
  }
  return wallet;
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

async function buildLiveContext(
  req: LiveBackendRequest,
): Promise<LiveContext<unknown>> {
  const name = req.config.artifactName;
  if (!name) {
    throw new Error(
      'live backend: SimulatorConfig.artifactName is required to deploy on live',
    );
  }

  // The dynamically-imported constructor is the one genuinely-untyped value;
  // bind it to a precise constructor type so `Contract.Any` flows from here.
  const contractEntry = pathToFileURL(
    path.join(moduleRootPath(name), 'contract', 'index.js'),
  ).href;
  const mod = await import(contractEntry);
  const ctor: new (...args: unknown[]) => AnyContract = mod.Contract;

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

  await ensureLiveSignersReady();
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
    const key = alias && WALLET_SEEDS[alias] ? alias : 'deployer';
    let providers = providersByAlias.get(key);
    if (!providers) {
      providers = initializeMidnightProviders<
        ContractNs.ProvableCircuitId<AnyContract>,
        ContractNs.PrivateState<AnyContract>
      >(walletFor(key), getEnv(), {
        // Unique per (contract, alias) so each test/caller gets an isolated store.
        privateStateStoreName: `${name}-${key}-${++deployCounter}`,
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

let registered = false;

/** Registers the live backend. Idempotent per worker. */
export function registerSimulatorLiveBackend(): void {
  if (registered) return;
  registered = true;
  registerLiveBackend(buildLiveContext);
}
