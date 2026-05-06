import { CompiledContract } from '@midnight-ntwrk/compact-js';
import type { Contract as ContractNs } from '@midnight-ntwrk/compact-js';
import {
  createCircuitCallTxInterface,
  createCircuitMaintenanceTxInterfaces,
  createContractMaintenanceTxInterface,
  type FoundContract,
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
 *     V2-specific verifier keys and to type the V2 handle.
 *   - `v2VerifierKey(name)`  — async getter that returns the V2 VK for a
 *     given circuit name (so specs can pass it into `insertVerifierKey`).
 *   - `bindAsV2(kit, alias)` — returns a V2-typed handle for the V1-deployed
 *     contract WITHOUT running the SDK's strict whole-VK-set check (see
 *     `bindAsV2`'s docstring for why and how).
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
// `bindAsV2` returns a manually-built handle that mirrors the shape of
// `FoundContract<V2>` (callTx, circuitMaintenanceTx, contractMaintenanceTx).
// We keep the type alias to make the spec signatures expressive.
export type TestTokenV2Handle = FoundContract<TestTokenV2Contract>;

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
 * Build a V2-typed handle (`callTx` + `circuitMaintenanceTx` + `contractMaintenanceTx`)
 * for the V1-deployed contract, WITHOUT running `findDeployedContract<V2>`'s
 * strict whole-VK-set check.
 *
 * Why we skip the strict check: `findDeployedContract` walks every circuit
 * in V2's compiled set and rejects the bind if any on-chain VK is missing
 * or doesn't match V2's expected VK. That's the right safety net for
 * production code, but it forces an upgrade spec to rotate EVERY V2-divergent
 * circuit before binding — even ones the test doesn't care about — which
 * obscures what each test actually changes on chain.
 *
 * Each describe rotates exactly the circuit(s) it tests via
 * `kit.deployed.circuitMaintenanceTx.<name>.{remove,insert}VerifierKey(...)`
 * (or `v2Handle.circuitMaintenanceTx.<name>.insertVerifierKey(...)` for
 * V2-only circuits like `mintBatch`). The handle returned here is callable
 * for ANY circuit V2 declares; whether a given call succeeds depends on
 * whether the on-chain VK actually matches V2's prover key — which is
 * exactly what the test is asserting.
 *
 * Caller must pass an `alias`. `'GENESIS'` resolves to the deployer wallet
 * (built from the funded test mnemonic, lives on `kit.wallet`); every other
 * alias comes from the shared signer pool.
 */
export async function bindAsV2(
  kit: TestTokenV1Kit,
  alias: string,
): Promise<TestTokenV2Handle> {
  const aliasWallet =
    alias === 'GENESIS' ? kit.wallet : await kit.signers.signerFor(alias);

  const v2Providers = buildProviders<
    TestTokenV2CircuitKeys,
    typeof TestTokenV1PrivateStateId,
    TestTokenV1PrivateState
  >(
    aliasWallet,
    moduleRootPath('TestTokenV2'),
    `testTokenV2-${alias.toLowerCase()}-${Date.now()}`,
  ) as TestTokenV2Providers;

  // Replicate the privateStateProvider side-effects that `findDeployedContract`
  // would have performed:
  //   1. setContractAddress — many call/maintenance paths look up the
  //      "current" contract address from the provider.
  //   2. set(privateStateId, ...) — `createCircuitCallTxInterface` queries
  //      the private state by ID before each call; a missing entry trips
  //      the "No private state found at private state ID …" error. Empty
  //      record is correct: V2's witnesses are `never`.
  //   3. setSigningKey — maintenance txs (insert/remove VK) need the
  //      contract's authority signing key.
  v2Providers.privateStateProvider.setContractAddress(kit.contractAddress);
  await v2Providers.privateStateProvider.set(
    TestTokenV1PrivateStateId,
    TestTokenV1PrivateState,
  );
  const signingKey = await kit.providers.privateStateProvider.getSigningKey(
    kit.contractAddress,
  );
  if (signingKey) {
    await v2Providers.privateStateProvider.setSigningKey(
      kit.contractAddress,
      signingKey,
    );
  }

  // Build the same surface `findDeployedContract` would have returned,
  // minus the strict VK-set validation. `deployTxData` is left empty
  // because the upgrade specs don't read it.
  const callTx = createCircuitCallTxInterface(
    v2Providers,
    compiledTestTokenV2,
    kit.contractAddress,
    TestTokenV1PrivateStateId,
  );
  const circuitMaintenanceTx = createCircuitMaintenanceTxInterfaces(
    v2Providers,
    compiledTestTokenV2,
    kit.contractAddress,
  );
  const contractMaintenanceTx = createContractMaintenanceTxInterface(
    v2Providers,
    compiledTestTokenV2,
    kit.contractAddress,
  );

  return {
    deployTxData: {} as TestTokenV2Handle['deployTxData'],
    callTx,
    circuitMaintenanceTx,
    contractMaintenanceTx,
  };
}
