import {
  type ContractMaintenanceAuthority,
  type ContractState,
  sampleSigningKey,
  type SigningKey,
} from '@midnight-ntwrk/compact-runtime';
import type { DeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';

/**
 * Query helpers and upgrade-path wrappers around the CMA primitives exposed by
 * `@midnight-ntwrk/midnight-js-contracts`. These are intentionally thin — the
 * plan calls for growing this file one helper at a time, as specs demand them.
 *
 * Today covered:
 *   - rotateCircuitVK       : `remove + insert` round-trip on a single circuit
 *   - readCmaCounter        : current replay-protection counter
 *   - readContractState     : raw on-chain state (for assertions on authority etc.)
 *
 * Planned next (Milestone 2 companion specs):
 *   - rotateAuthority(newSigningKey)
 *   - freeze() (rotate to the empty / ∅ authority)
 *   - readAuthority() helper returning `{ committee, threshold, counter }`
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyProviders = MidnightProviders<any, any, any>;

/**
 * Fetch the on-chain `ContractState` for a deployed contract address via the
 * indexer. Returns `undefined` if the indexer hasn't seen the address yet
 * (e.g. race right after deploy before the indexer catches up).
 */
export async function readContractState(
  providers: AnyProviders,
  address: string,
): Promise<ContractState | undefined> {
  const state = await providers.publicDataProvider.queryContractState(address);
  return state ?? undefined;
}

/**
 * Read the current `ContractMaintenanceAuthority` for a contract. Throws if
 * the indexer has no record — callers are expected to have just deployed or
 * updated the contract.
 */
export async function readAuthority(
  providers: AnyProviders,
  address: string,
): Promise<ContractMaintenanceAuthority> {
  const state = await readContractState(providers, address);
  if (!state) {
    throw new Error(
      `readAuthority: no ContractState available for ${address} yet`,
    );
  }
  return state.maintenanceAuthority;
}

/**
 * Convenience over `readAuthority(...).counter` — the monotonically increasing
 * replay-protection counter bumped by each successful `SingleUpdate`.
 */
export async function readCmaCounter(
  providers: AnyProviders,
  address: string,
): Promise<bigint> {
  const auth = await readAuthority(providers, address);
  return auth.counter;
}

/**
 * Remove + re-insert the current verifier key for a single circuit.
 *
 * The default `newVk` parameter is the *current* VK fetched from the
 * `ZKConfigProvider` — i.e. a round-trip that exercises the CMA pathway
 * without actually changing on-chain behaviour. Pass an explicit `newVk` for
 * tests that want to observe a genuine behavioural change.
 *
 * Each call causes the CMA counter to advance by exactly 2 (one SingleUpdate
 * for the remove, one for the insert).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function rotateCircuitVK(
  providers: AnyProviders,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deployed: DeployedContract<any>,
  circuitName: string,
  newVk?: Uint8Array,
): Promise<void> {
  const vk =
    newVk ??
    (await providers.zkConfigProvider.getVerifierKey(circuitName));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tx = (deployed.circuitMaintenanceTx as any)[circuitName];
  if (!tx) {
    throw new Error(
      `rotateCircuitVK: deployed contract has no circuit named '${circuitName}'`,
    );
  }
  await tx.removeVerifierKey();
  await tx.insertVerifierKey(vk);
}

/**
 * Replace the contract's maintenance authority with `newAuthority`. Signed by
 * the current authority key stored in the deployed contract's providers.
 *
 * @returns the `SigningKey` that was installed (so tests can re-sign with it
 *          or assert its bytes).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function rotateAuthority(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deployed: DeployedContract<any>,
  newAuthority: SigningKey,
): Promise<SigningKey> {
  await deployed.contractMaintenanceTx.replaceAuthority(newAuthority);
  return newAuthority;
}

/**
 * Functional equivalent of "freeze the contract" for single-signer CMAs:
 * generate a fresh random `SigningKey`, install it as the new authority, then
 * deliberately throw away the bytes. Because the current `DeployedContract`'s
 * signer is still the *old* key, every subsequent `MaintenanceUpdate` the
 * SDK tries to sign will fail verification on-chain — nobody can update again.
 *
 * This is NOT the protocol-level empty-authority state documented in the
 * research report. It's the strongest effect achievable from the high-level
 * midnight-js-contracts 4.x surface, which takes a single `SigningKey` rather
 * than a full `ContractMaintenanceAuthority` with `committee=[]`. Once the
 * ledger-level `MaintenanceUpdate` constructor becomes ergonomic in our
 * harness, swap this out for a real empty-authority call.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function freeze(deployed: DeployedContract<any>): Promise<void> {
  const abandoned = sampleSigningKey();
  await deployed.contractMaintenanceTx.replaceAuthority(abandoned);
  // Intentionally drop `abandoned` — no reference is retained anywhere.
}
