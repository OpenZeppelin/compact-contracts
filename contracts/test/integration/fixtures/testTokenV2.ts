import { CompiledContract } from '@midnight-ntwrk/compact-js';
import type { Contract as ContractNs } from '@midnight-ntwrk/compact-js';
import {
  createCircuitCallTxInterface,
  createCircuitMaintenanceTxInterfaces,
  createContractMaintenanceTxInterface,
  type FoundContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import type {
  MidnightProviders,
  VerifierKey,
} from '@midnight-ntwrk/midnight-js-types';
import {
  Contract as TestTokenV2,
  type Ledger as TestTokenV2Ledger,
} from '../../../artifacts/TestTokenV2/contract/index.js';
import { contractAssetsPath, moduleRootPath } from '../_harness/deploy.js';
import {
  type TestTokenPrivateState,
  testTokenWitnesses,
} from '../_harness/identity.js';
import { buildProviders } from '../_harness/providers.js';
import {
  privateStateFor,
  privateStateIdFor,
  type TestTokenV1Kit,
} from './testTokenV1.js';

/**
 * V2 is never deployed. The upgrade specs deploy V1 and rotate individual
 * verifier keys to V2's, so this module only supplies V2's keys and a
 * V2-shaped handle on the V1 contract.
 *
 * V2 keeps V1's ledger layout and private state — CMA can change verifier
 * keys, not state shape.
 */

export const TESTTOKEN_V2_ARTIFACT = 'TestTokenV2';

export type TestTokenV2Contract = TestTokenV2<TestTokenPrivateState>;
export type TestTokenV2CircuitKeys =
  ContractNs.ProvableCircuitId<TestTokenV2Contract>;
export type TestTokenV2Providers = MidnightProviders<
  TestTokenV2CircuitKeys,
  string,
  TestTokenPrivateState
>;
export type TestTokenV2Handle = FoundContract<TestTokenV2Contract>;
export type { TestTokenV2Ledger };

export const compiledTestTokenV2 = CompiledContract.make(
  TESTTOKEN_V2_ARTIFACT,
  TestTokenV2<TestTokenPrivateState>,
).pipe(
  CompiledContract.withWitnesses(testTokenWitnesses() as never),
  CompiledContract.withCompiledFileAssets(
    contractAssetsPath(TESTTOKEN_V2_ARTIFACT),
  ),
);

/** V2's verifier key for `circuitName`, to feed `insertVerifierKey`. */
export async function v2VerifierKey(
  circuitName: TestTokenV2CircuitKeys,
): Promise<VerifierKey> {
  return new NodeZkConfigProvider<TestTokenV2CircuitKeys>(
    moduleRootPath(TESTTOKEN_V2_ARTIFACT),
  ).getVerifierKey(circuitName);
}

/**
 * A V2-typed handle on the V1-deployed contract, bound as `alias`.
 *
 * `findDeployedContract<V2>` validates V2's whole verifier-key set against
 * the chain, which would force a spec to rotate every V2-divergent circuit
 * before binding — including ones it does not exercise. This assembles the
 * same surface without that check, so each spec rotates only what it tests
 * and a mismatched key surfaces at the call it belongs to.
 */
export async function bindAsV2(
  kit: TestTokenV1Kit,
  alias: string,
): Promise<TestTokenV2Handle> {
  // V2's own proving keys, over the deployment's shared private state.
  const providers = buildProviders<
    TestTokenV2CircuitKeys,
    string,
    TestTokenPrivateState
  >(kit.wallet, TESTTOKEN_V2_ARTIFACT, kit.providers.privateStateProvider);

  // The side effects `findDeployedContract` would have applied: the call and
  // maintenance interfaces read the address, the alias' private state, and the
  // authority signing key straight off the provider.
  providers.privateStateProvider.setContractAddress(kit.contractAddress);
  await providers.privateStateProvider.set(
    privateStateIdFor(alias),
    privateStateFor(alias),
  );

  return {
    deployTxData: {} as TestTokenV2Handle['deployTxData'],
    callTx: createCircuitCallTxInterface(
      providers,
      compiledTestTokenV2,
      kit.contractAddress,
      privateStateIdFor(alias),
    ),
    circuitMaintenanceTx: createCircuitMaintenanceTxInterfaces(
      providers,
      compiledTestTokenV2,
      kit.contractAddress,
    ),
    contractMaintenanceTx: createContractMaintenanceTxInterface(
      providers,
      compiledTestTokenV2,
      kit.contractAddress,
    ),
  };
}
