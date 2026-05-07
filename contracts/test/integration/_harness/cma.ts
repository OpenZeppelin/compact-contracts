import type { Contract as ContractNs } from '@midnight-ntwrk/compact-js';
import {
  type ContractMaintenanceAuthority,
  type ContractState,
  sampleSigningKey,
  signData,
  type SigningKey,
} from '@midnight-ntwrk/compact-runtime';
import {
  Intent,
  MaintenanceUpdate,
  type SingleUpdate,
  Transaction,
} from '@midnight-ntwrk/ledger-v8';
import {
  submitTx,
  type DeployedContract,
  type FoundContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import {
  asContractAddress,
  type FinalizedTxData,
  type MidnightProviders,
  type VerifierKey,
} from '@midnight-ntwrk/midnight-js-types';
import { ttlOneHour } from '@midnight-ntwrk/midnight-js-utils';

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
/** Either a freshly deployed contract or one rebound via `findDeployedContract`. */
type AnyDeployed<C extends ContractNs.Any> =
  | DeployedContract<C>
  | FoundContract<C>;

export async function rotateCircuitVK<C extends ContractNs.Any>(
  providers: AnyProviders,
  deployed: AnyDeployed<C>,
  circuitName: ContractNs.ProvableCircuitId<C>,
  newVk?: VerifierKey,
): Promise<void> {
  const vk =
    newVk ?? (await providers.zkConfigProvider.getVerifierKey(circuitName));
  const tx = deployed.circuitMaintenanceTx[circuitName];
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
export async function rotateAuthority<C extends ContractNs.Any>(
  deployed: AnyDeployed<C>,
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
export async function freeze<C extends ContractNs.Any>(
  deployed: AnyDeployed<C>,
): Promise<void> {
  const abandoned = sampleSigningKey();
  await deployed.contractMaintenanceTx.replaceAuthority(abandoned);
  // Intentionally drop `abandoned` — no reference is retained anywhere.
}

/**
 * Submit a `MaintenanceUpdate` carrying *N* `SingleUpdate`s in a single tx.
 *
 * The SDK's public maintenance API (`circuitMaintenanceTx.X.removeVerifierKey()`,
 * `contractMaintenanceTx.replaceAuthority(...)`, etc.) wraps exactly one
 * `SingleUpdate` per tx — there's no public path to bundle multiple changes.
 * To probe protocol-level questions like "what does the chain do with two
 * `ReplaceAuthority`s in one bundle?" or "would the chain accept two
 * `VerifierKeyInsert`s on the same operation if we bypass the SDK guard?",
 * we have to drop down to the raw ledger-v8 classes and submit by hand.
 *
 * The flow mirrors what the SDK's internal `unprovenTxFromContractUpdates`
 * (at `node_modules/@midnight-ntwrk/midnight-js-contracts/dist/index.mjs`)
 * does, with manual signing in place of the contract-executable's
 * `addOrReplaceContractOperation` / `removeContractOperation` calls:
 *
 *   1. Read the current CMA counter (replay protection — must match
 *      on-chain at submission time).
 *   2. Construct `new MaintenanceUpdate(addr, singleUpdates, counter)`.
 *   3. Sign `mu.dataToSign` with the contract's signing key (looked up
 *      from `providers.privateStateProvider`).
 *   4. Attach the signature at committee index 0n (single-signer CMA — every
 *      contract this harness deploys has a one-key authority).
 *   5. Wrap in `Intent.new(ttl).addMaintenanceUpdate(signed)`.
 *   6. Wrap that in `Transaction.fromParts(networkId, undefined, undefined, intent)`.
 *   7. Submit via `submitTx(providers, { unprovenTx })`.
 *
 * Counter caveat: a `MaintenanceUpdate` carrying *N* `SingleUpdate`s only
 * occupies counter value *C*. Whether the chain advances the on-chain
 * counter by 1 (one tx = one increment) or by N (one increment per
 * SingleUpdate) is itself an open question — observe via `readCmaCounter`
 * before/after to find out.
 *
 * @param counterOverride — optional. By default the helper reads the current
 *   on-chain counter and signs against it. Pass an explicit value here when
 *   the test wants to *forge* a stale counter (e.g., the staleCounter spec
 *   that asserts replay-protection rejection): the MU is built with the
 *   given counter and signed accordingly, so the chain sees a
 *   counter-mismatch.
 *
 * @returns the `FinalizedTxData` from `submitTx`. Throws on submission
 *          failure (`TxFailedError` from the SDK or wrapped variants — see
 *          existing patterns in `specs/cma/`).
 *
 * @example
 *   await submitRawMaintenanceUpdate(kit.providers, kit.contractAddress, [
 *     new ReplaceAuthority(authA),
 *     new ReplaceAuthority(authB),
 *   ]);
 */
export async function submitRawMaintenanceUpdate(
  providers: AnyProviders,
  contractAddress: string,
  updates: SingleUpdate[],
  counterOverride?: bigint,
): Promise<FinalizedTxData> {
  const [signingKey, freshCounter] = await Promise.all([
    providers.privateStateProvider.getSigningKey(contractAddress),
    readCmaCounter(providers, contractAddress),
  ]);
  const counter = counterOverride ?? freshCounter;
  if (!signingKey) {
    throw new Error(
      `submitRawMaintenanceUpdate: no signing key for contract ${contractAddress} in privateStateProvider`,
    );
  }

  const mu = new MaintenanceUpdate(
    asContractAddress(contractAddress),
    updates,
    counter,
  );
  const signature = signData(signingKey, mu.dataToSign);
  const signed = mu.addSignature(0n, signature);

  const intent = Intent.new(ttlOneHour()).addMaintenanceUpdate(signed);
  const unprovenTx = Transaction.fromParts(
    getNetworkId(),
    undefined,
    undefined,
    intent,
  );
  // `submitTx`'s providers type is generic over a contract type, but the
  // call only reads provider plumbing (publicData, wallet) that's identical
  // for any contract. The cast just unifies the generic so `AnyProviders`
  // satisfies the parameter.
  return submitTx(providers as Parameters<typeof submitTx>[0], {
    unprovenTx,
  });
}
