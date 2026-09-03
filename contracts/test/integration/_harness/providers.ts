import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import {
  inMemoryPrivateStateProvider,
  type MidnightWalletProvider,
} from '@midnight-ntwrk/testkit-js';
import { localEnv } from '../../../test-utils/harness/network.js';
import { moduleRootPath } from './deploy.js';

/**
 * A provider bundle for one deployment of `artifactName`, paying from `wallet`.
 *
 * The private-state provider is in-memory and passed in by the caller, so every
 * alias of one deployment shares a store: `deployContract` writes the CMA
 * signing key there and the maintenance helpers read it back. testkit's on-disk
 * default cannot serve that — it scopes state by the wallet's coin public key
 * and allows a single handle on the directory.
 */
export function buildProviders<
  CircuitKey extends string,
  PrivateStateId extends string,
  PrivateState,
>(
  wallet: MidnightWalletProvider,
  artifactName: string,
  privateStateProvider: MidnightProviders<
    CircuitKey,
    PrivateStateId,
    PrivateState
  >['privateStateProvider'],
): MidnightProviders<CircuitKey, PrivateStateId, PrivateState> {
  const env = localEnv();
  const zkConfigProvider = new NodeZkConfigProvider<CircuitKey>(
    moduleRootPath(artifactName),
  );
  return {
    privateStateProvider,
    publicDataProvider: indexerPublicDataProvider(env.indexer, env.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(env.proofServer, zkConfigProvider),
    walletProvider: wallet,
    midnightProvider: wallet,
  };
}

/** The shared in-memory private-state store for one deployment. */
export function makePrivateStateProvider<
  PrivateStateId extends string,
  PrivateState,
>() {
  return inMemoryPrivateStateProvider<PrivateStateId, PrivateState>();
}
