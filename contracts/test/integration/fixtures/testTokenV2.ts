import { CompiledContract } from '@midnight-ntwrk/compact-js';
import type { Contract as ContractNs } from '@midnight-ntwrk/compact-js';
import {
  type DeployedContract,
  type FoundContract,
  findDeployedContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import type {
  MidnightProviders,
  VerifierKey,
} from '@midnight-ntwrk/midnight-js-types';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import {
  Contract as TestTokenV2,
  type Ledger as TestTokenV2Ledger,
} from '../../../artifacts/TestTokenV2/contract/index.js';
import {
  contractAssetsPath,
  moduleRootPath,
} from '../_harness/deploy.js';
import { buildProviders } from '../_harness/providers.js';
import {
  TestTokenV1PrivateState,
  TestTokenV1PrivateStateId,
  type TestTokenV1Kit,
} from './testTokenV1.js';

/**
 * Helper for the upgrade specs.
 *
 * V2 is never DEPLOYED separately. Instead the integration suite deploys V1,
 * then rotates V1's verifier keys to V2's via `circuitMaintenanceTx` calls.
 * This file exposes:
 *
 *   - `compiledTestTokenV2`  — the V2 `CompiledContract`, used to look up
 *     V2-specific verifier keys.
 *   - `v2VerifierKey(name)`  — async getter that returns the V2 VK for a
 *     given circuit name (so specs can pass it into `insertVerifierKey`).
 *   - `bindAsV2(kit)`        — re-finds the deployed V1 contract address
 *     using V2's compiled-contract + zk-config so subsequent `callTx.foo()`
 *     proves against V2's prover keys (the chain verifies against whatever
 *     VK is currently installed at that circuit slot).
 *
 * Same private-state shape as V1 (Compact CMA can't change ledger layout).
 */

export type TestTokenV2Contract = TestTokenV2<TestTokenV1PrivateState>;
export type TestTokenV2CircuitKeys = ContractNs.ProvableCircuitId<TestTokenV2Contract>;
export type TestTokenV2Providers = MidnightProviders<
  TestTokenV2CircuitKeys,
  typeof TestTokenV1PrivateStateId,
  TestTokenV1PrivateState
>;
export type TestTokenV2Handle =
  | DeployedContract<TestTokenV2Contract>
  | FoundContract<TestTokenV2Contract>;

export const compiledTestTokenV2 = CompiledContract.make(
  'TestTokenV2',
  TestTokenV2<TestTokenV1PrivateState>,
).pipe(
  CompiledContract.withWitnesses({} as never),
  CompiledContract.withCompiledFileAssets(contractAssetsPath('TestTokenV2')),
);

export type { TestTokenV2Ledger };

/**
 * Read V2's verifier key for `circuitName` directly from the compiled
 * artifacts on disk. Use this in specs to feed `insertVerifierKey(...)` when
 * upgrading a V1 contract to V2's behaviour for that circuit.
 */
export async function v2VerifierKey(
  circuitName: TestTokenV2CircuitKeys,
): Promise<VerifierKey> {
  const provider = new NodeZkConfigProvider<TestTokenV2CircuitKeys>(
    moduleRootPath('TestTokenV2'),
  );
  return provider.getVerifierKey(circuitName);
}

/**
 * Re-find the (V1-deployed) contract using V2's compiled-contract bundle, so
 * subsequent `callTx.foo(...)` invocations prove against V2's prover keys.
 *
 * The on-chain authority verifies against whichever VK is installed at that
 * circuit slot — so this only succeeds if the spec has already rotated the
 * relevant V1 → V2 VK before calling.
 *
 * Caller must pass an `alias` — V2's pause/unpause require admin role.
 */
export async function bindAsV2(
  kit: TestTokenV1Kit,
  alias: string,
): Promise<TestTokenV2Handle> {
  const aliasWallet = await kit.signers.signerFor(alias);
  const v2Providers = buildProviders<
    TestTokenV2CircuitKeys,
    typeof TestTokenV1PrivateStateId,
    TestTokenV1PrivateState
  >(
    aliasWallet,
    moduleRootPath('TestTokenV2'),
    `testTokenV2-${alias.toLowerCase()}-${Date.now()}`,
  ) as TestTokenV2Providers;
  return findDeployedContract<TestTokenV2Contract>(v2Providers, {
    compiledContract: compiledTestTokenV2,
    contractAddress: kit.contractAddress,
    privateStateId: TestTokenV1PrivateStateId,
    initialPrivateState: TestTokenV1PrivateState,
  });
}
