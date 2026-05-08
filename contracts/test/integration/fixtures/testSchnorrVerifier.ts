import { CompiledContract } from '@midnight-ntwrk/compact-js';
import type { Contract as ContractNs } from '@midnight-ntwrk/compact-js';
import {
  type DeployedContract,
  type FoundContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { MidnightWalletProvider } from '@midnight-ntwrk/testkit-js';
import {
  Contract as TestSchnorrVerifier,
  type Ledger as TestSchnorrVerifierLedger,
  ledger as schnorrLedger,
} from '../../../artifacts/TestSchnorrVerifier/contract/index.js';
import {
  contractAssetsPath,
  deployModule,
  moduleRootPath,
} from '../_harness/deploy.js';
import { networkConfig, setupNetwork } from '../_harness/network.js';
import { buildProviders } from '../_harness/providers.js';
import { buildWallet } from '../_harness/wallet.js';

/**
 * TestSchnorrVerifier wraps the `crypto/Schnorr` verifier in a deployable
 * contract so its behaviour can be probed end-to-end against a real local
 * Midnight node. The wrapped circuits are pure (no ledger reads, no witnesses)
 * but the wrapper writes a public boolean to the ledger so the spec can
 * read back the verify result through the indexer.
 */
export type TestSchnorrVerifierPrivateState = Record<string, never>;
export const TestSchnorrVerifierPrivateState: TestSchnorrVerifierPrivateState = {};
export const TestSchnorrVerifierPrivateStateId = 'testSchnorrVerifierPrivateState';

export type TestSchnorrVerifierContract =
  TestSchnorrVerifier<TestSchnorrVerifierPrivateState>;
export type TestSchnorrVerifierCircuitKeys =
  ContractNs.ProvableCircuitId<TestSchnorrVerifierContract>;
export type TestSchnorrVerifierProviders = MidnightProviders<
  TestSchnorrVerifierCircuitKeys,
  typeof TestSchnorrVerifierPrivateStateId,
  TestSchnorrVerifierPrivateState
>;
export type DeployedTestSchnorrVerifier =
  DeployedContract<TestSchnorrVerifierContract>;
export type TestSchnorrVerifierHandle =
  | DeployedTestSchnorrVerifier
  | FoundContract<TestSchnorrVerifierContract>;

export const compiledTestSchnorrVerifier = CompiledContract.make(
  'TestSchnorrVerifier',
  TestSchnorrVerifier<TestSchnorrVerifierPrivateState>,
).pipe(
  CompiledContract.withWitnesses({} as never),
  CompiledContract.withCompiledFileAssets(
    contractAssetsPath('TestSchnorrVerifier'),
  ),
);

export interface TestSchnorrVerifierKit {
  deployed: DeployedTestSchnorrVerifier;
  providers: TestSchnorrVerifierProviders;
  wallet: MidnightWalletProvider;
  readonly contractAddress: string;
  readLedger(): Promise<TestSchnorrVerifierLedger>;
  teardown(): Promise<void>;
}

/**
 * Deploy a fresh `TestSchnorrVerifier` to the local node and return a kit.
 * No constructor arguments — the contract has no initialisable state.
 */
export async function deployTestSchnorrVerifier(): Promise<TestSchnorrVerifierKit> {
  setupNetwork();
  const env = networkConfig();
  const wallet = await buildWallet(env);

  const providers = buildProviders<
    TestSchnorrVerifierCircuitKeys,
    typeof TestSchnorrVerifierPrivateStateId,
    TestSchnorrVerifierPrivateState
  >(
    wallet,
    moduleRootPath('TestSchnorrVerifier'),
    `testSchnorrVerifier-${Date.now()}`,
  ) as TestSchnorrVerifierProviders;

  const deployed = await deployModule<TestSchnorrVerifierContract>(
    providers,
    compiledTestSchnorrVerifier,
    TestSchnorrVerifierPrivateStateId,
    TestSchnorrVerifierPrivateState,
    [] as ContractNs.InitializeParameters<TestSchnorrVerifierContract>,
  );

  const contractAddress = deployed.deployTxData.public.contractAddress;

  return {
    deployed,
    providers,
    wallet,
    contractAddress,

    async readLedger(): Promise<TestSchnorrVerifierLedger> {
      const state = await providers.publicDataProvider.queryContractState(
        contractAddress,
      );
      if (!state) {
        throw new Error(
          `readLedger: no ContractState available for ${contractAddress}`,
        );
      }
      return schnorrLedger(state.data);
    },

    async teardown(): Promise<void> {
      await wallet.stop();
    },
  };
}
