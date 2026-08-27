import type { Contract as ContractNs } from '@midnight-ntwrk/compact-js';
import {
  type ContractMaintenanceAuthority,
  type ContractState,
  type SigningKey,
  sampleSigningKey,
  signData,
} from '@midnight-ntwrk/compact-runtime';
import {
  Intent,
  MaintenanceUpdate,
  type SingleUpdate,
  Transaction,
} from '@midnight-ntwrk/ledger-v8';
import {
  type DeployedContract,
  type FoundContract,
  submitTx,
} from '@midnight-ntwrk/midnight-js-contracts';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import {
  asContractAddress,
  type FinalizedTxData,
  type MidnightProviders,
  type VerifierKey,
} from '@midnight-ntwrk/midnight-js-types';

/**
 * Query helpers and upgrade-path wrappers over the Contract Maintenance
 * Authority primitives in `@midnight-ntwrk/midnight-js-contracts`, plus one
 * raw-ledger escape hatch for the multi-update bundles the SDK cannot express.
 */

/** Providers for a contract whose concrete type the helper does not care about. */
type AnyProviders = MidnightProviders<any, any, any>;

/** Either a freshly deployed contract or one rebound via `findDeployedContract`. */
type AnyDeployed<C extends ContractNs.Any> =
  | DeployedContract<C>
  | FoundContract<C>;

/** A `MaintenanceUpdate` intent stays valid for an hour. */
const TTL_ONE_HOUR_MS = 60 * 60 * 1000;

/** The expiry every maintenance intent in this suite carries. */
export const maintenanceTtl = (): Date =>
  new Date(Date.now() + TTL_ONE_HOUR_MS);

/** Single-signer CMA: the only committee slot a signature can occupy. */
const SOLE_COMMITTEE_INDEX = 0n;

/** On-chain `ContractState`, or `undefined` while the indexer is still behind. */
export async function readContractState(
  providers: AnyProviders,
  address: string,
): Promise<ContractState | undefined> {
  const state = await providers.publicDataProvider.queryContractState(address);
  return state ?? undefined;
}

/**
 * On-chain `ContractState`, or a throw.
 *
 * A spec asserting that a slot is empty must not pass because the read came
 * back empty — `state?.operation(op)` is `undefined` either way.
 */
export async function requireContractState(
  providers: AnyProviders,
  address: string,
): Promise<ContractState> {
  const state = await readContractState(providers, address);
  if (!state) {
    throw new Error(`requireContractState: no ContractState for ${address}`);
  }
  return state;
}

/** The contract's current maintenance authority. Throws if the indexer has no record. */
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

/** The authority flattened to plain values, so a spec can compare it whole. */
export interface AuthoritySnapshot {
  committee: string[];
  threshold: number;
  counter: bigint;
}

/**
 * The authority as a comparable value.
 *
 * Asserting `committee.length` alone would accept a swap to a *different*
 * single-key committee, which is exactly what a rejected update must not do.
 */
export async function readAuthoritySnapshot(
  providers: AnyProviders,
  address: string,
): Promise<AuthoritySnapshot> {
  const auth = await readAuthority(providers, address);
  return {
    committee: [...auth.committee],
    threshold: auth.threshold,
    counter: auth.counter,
  };
}

/** The replay-protection counter each accepted `MaintenanceUpdate` advances. */
export async function readCmaCounter(
  providers: AnyProviders,
  address: string,
): Promise<bigint> {
  const auth = await readAuthority(providers, address);
  return auth.counter;
}

/**
 * Remove and re-insert one circuit's verifier key, in two txs.
 *
 * `newVk` defaults to the circuit's current key — a round-trip that exercises
 * the pathway without changing behaviour. Pass the other version's key to make
 * the rotation observable. Advances the CMA counter by 2.
 */
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
      `rotateCircuitVK: deployed contract has no circuit named '${String(circuitName)}'`,
    );
  }
  await tx.removeVerifierKey();
  await tx.insertVerifierKey(vk);
}

/**
 * Install `newAuthority` as the contract's maintenance authority, signed by the
 * key the handle currently holds. The SDK updates that handle's key in place.
 */
export async function rotateAuthority<C extends ContractNs.Any>(
  deployed: AnyDeployed<C>,
  newAuthority: SigningKey,
): Promise<SigningKey> {
  await deployed.contractMaintenanceTx.replaceAuthority(newAuthority);
  return newAuthority;
}

/**
 * Freeze maintenance by rotating to a key that is generated and immediately
 * discarded: no caller can sign a further update.
 *
 * This is not the protocol's empty-committee authority — `replaceAuthority`
 * takes a single `SigningKey`, not a full `ContractMaintenanceAuthority`. See
 * {@link submitRawMaintenanceUpdate} for the ledger-level route.
 */
export async function freeze<C extends ContractNs.Any>(
  deployed: AnyDeployed<C>,
): Promise<void> {
  await deployed.contractMaintenanceTx.replaceAuthority(sampleSigningKey());
}

/**
 * Submit a `MaintenanceUpdate` carrying N `SingleUpdate`s in one tx.
 *
 * The SDK's maintenance API wraps exactly one `SingleUpdate` per tx, so probing
 * bundle semantics (ordering, duplicate operations, mixed update kinds) means
 * building the ledger objects and signing by hand.
 *
 * @param counterOverride Forge a counter the chain will reject, for the
 *   replay-protection specs. Defaults to the current on-chain value.
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
  if (!signingKey) {
    throw new Error(
      `submitRawMaintenanceUpdate: no signing key for ${contractAddress} in the private-state provider`,
    );
  }

  const update = new MaintenanceUpdate(
    asContractAddress(contractAddress),
    updates,
    counterOverride ?? freshCounter,
  );
  const signed = update.addSignature(
    SOLE_COMMITTEE_INDEX,
    signData(signingKey, update.dataToSign),
  );

  const intent = Intent.new(maintenanceTtl());
  const unprovenTx = Transaction.fromParts(
    getNetworkId(),
    undefined,
    undefined,
    intent.addMaintenanceUpdate(signed),
  );
  // `submitTx` is generic over a contract type but only reads provider plumbing
  // that is identical for any contract; the cast unifies the generic.
  return submitTx(providers as Parameters<typeof submitTx>[0], { unprovenTx });
}
