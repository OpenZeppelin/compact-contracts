import { CompiledContract } from '@midnight-ntwrk/compact-js';
import type { Contract as ContractNs } from '@midnight-ntwrk/compact-js';
import {
  type FoundContract,
  findDeployedContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { MidnightWalletProvider } from '@midnight-ntwrk/testkit-js';
import { requireLivePool } from '../../../test-utils/harness/livePool.js';
import {
  Contract as TestTokenV1,
  type Ledger as TestTokenV1Ledger,
  ledger as testTokenV1Ledger,
} from '../../../artifacts/TestTokenV1/contract/index.js';
import { contractAssetsPath, deployModule } from '../_harness/deploy.js';
import {
  DEFAULT_ADMIN_ROLE,
  eitherFor,
  secretKeyFor,
  type TestTokenPrivateState,
  testTokenWitnesses,
} from '../_harness/identity.js';
import {
  buildProviders,
  makePrivateStateProvider,
} from '../_harness/providers.js';

export const TESTTOKEN_V1_ARTIFACT = 'TestTokenV1';

/** The private-state slot holding `alias`' identity for this contract. */
export const privateStateIdFor = (alias: string): string =>
  `${TESTTOKEN_V1_ARTIFACT}-${alias.toLowerCase()}`;

/** `alias`' private state — the secret key its witnesses answer with. */
export const privateStateFor = (alias: string): TestTokenPrivateState => ({
  secretKey: secretKeyFor(alias),
});

export type TestTokenV1Contract = TestTokenV1<TestTokenPrivateState>;
export type TestTokenV1CircuitKeys =
  ContractNs.ProvableCircuitId<TestTokenV1Contract>;
export type TestTokenV1Providers = MidnightProviders<
  TestTokenV1CircuitKeys,
  string,
  TestTokenPrivateState
>;
export type TestTokenV1Handle =
  | Awaited<ReturnType<typeof deployModule<TestTokenV1Contract>>>
  | FoundContract<TestTokenV1Contract>;

export const compiledTestTokenV1 = CompiledContract.make(
  TESTTOKEN_V1_ARTIFACT,
  TestTokenV1<TestTokenPrivateState>,
).pipe(
  CompiledContract.withWitnesses(testTokenWitnesses() as never),
  CompiledContract.withCompiledFileAssets(
    contractAssetsPath(TESTTOKEN_V1_ARTIFACT),
  ),
);

export interface DeployTestTokenV1Opts {
  name?: string;
  symbol?: string;
  decimals?: number;
  /** Grant `DEFAULT_ADMIN_ROLE` to the `ADMIN` alias after deploy. Default `true`. */
  bootstrapAdmin?: boolean;
}

export interface TestTokenV1Kit {
  /** The deploying handle, holding the CMA signing key. */
  deployed: Awaited<ReturnType<typeof deployModule<TestTokenV1Contract>>>;
  /** The provider bundle every alias and maintenance helper shares. */
  providers: TestTokenV1Providers;
  /** The funded wallet paying for every call, borrowed from the worker's pool. */
  wallet: MidnightWalletProvider;
  readonly contractAddress: string;
  /** Latest public ledger, read through the indexer. */
  readLedger(): Promise<TestTokenV1Ledger>;
  /**
   * A handle whose witnesses answer with `alias`' secret key, so circuits see
   * `alias` as the caller. Every alias submits from the same funded wallet.
   */
  as(alias: string): Promise<TestTokenV1Handle>;
  teardown(): Promise<void>;
}

/** Deploy a fresh TestTokenV1 to the local node. */
export async function deployTestTokenV1(
  opts: DeployTestTokenV1Opts = {},
): Promise<TestTokenV1Kit> {
  const wallet = requireLivePool().walletFor('deployer');

  // One store per deployment, shared by every alias: `deployContract` files the
  // CMA signing key here under the contract address, and the maintenance
  // helpers read it back.
  const privateStateProvider = makePrivateStateProvider<
    string,
    TestTokenPrivateState
  >();
  // Every alias shares one provider bundle — they differ only in the private
  // state `findDeployedContract` binds, and all pay from the same wallet.
  const providers = buildProviders<
    TestTokenV1CircuitKeys,
    string,
    TestTokenPrivateState
  >(wallet, TESTTOKEN_V1_ARTIFACT, privateStateProvider);

  const deployed = await deployModule<TestTokenV1Contract>(
    providers,
    compiledTestTokenV1,
    privateStateIdFor('deployer'),
    privateStateFor('deployer'),
    [
      opts.name ?? 'TestToken',
      opts.symbol ?? 'TT',
      BigInt(opts.decimals ?? 6),
      eitherFor('deployer'),
    ] as ContractNs.InitializeParameters<TestTokenV1Contract>,
  );

  const contractAddress = deployed.deployTxData.public.contractAddress;

  // Deduped per alias so parallel `as(alias)` calls share one lookup.
  const handles = new Map<string, Promise<TestTokenV1Handle>>();
  const findAs = (alias: string) =>
    // No `signingKey`: passing one would overwrite the CMA key `deployContract`
    // stored, and the rotation specs assert on that key.
    findDeployedContract<TestTokenV1Contract>(providers, {
      compiledContract: compiledTestTokenV1,
      contractAddress,
      privateStateId: privateStateIdFor(alias),
      initialPrivateState: privateStateFor(alias),
    });

  const kit: TestTokenV1Kit = {
    deployed,
    providers,
    wallet,
    contractAddress,

    async readLedger(): Promise<TestTokenV1Ledger> {
      const state =
        await providers.publicDataProvider.queryContractState(contractAddress);
      if (!state) {
        throw new Error(`readLedger: no ContractState for ${contractAddress}`);
      }
      return testTokenV1Ledger(state.data);
    },

    as(alias: string): Promise<TestTokenV1Handle> {
      let handle = handles.get(alias);
      if (!handle) {
        handle = findAs(alias);
        handles.set(alias, handle);
      }
      return handle;
    },

    async teardown(): Promise<void> {
      // The wallet belongs to the worker's pool; `live.globalSetup` stops it.
      handles.clear();
    },
  };

  if (opts.bootstrapAdmin !== false) {
    await deployed.callTx._grantRole(DEFAULT_ADMIN_ROLE, eitherFor('ADMIN'));
  }

  return kit;
}
