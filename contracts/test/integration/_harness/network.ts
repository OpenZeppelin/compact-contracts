import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import {
  type NetworkId,
  setNetworkId,
} from '@midnight-ntwrk/midnight-js-network-id';

/**
 * Genesis wallet seed for the local `undeployed` network.
 * Pre-funded at genesis; all integration tests use this as the default signer.
 * Mirrors the constant used in midnight-apps for consistency.
 */
export const GENESIS_WALLET_SEED =
  '0000000000000000000000000000000000000000000000000000000000000001';

/**
 * Default endpoints for the local stack brought up by `make env-up`.
 * Each is overridable via a MIDNIGHT_* env var so CI can point at a
 * relocated stack without code changes.
 */
export function networkConfig(): EnvironmentConfiguration {
  return {
    walletNetworkId: 'undeployed',
    networkId: 'undeployed' as NetworkId,
    indexer:
      process.env.MIDNIGHT_INDEXER_URL ??
      'http://127.0.0.1:8088/api/v4/graphql',
    indexerWS:
      process.env.MIDNIGHT_INDEXER_WS_URL ??
      'ws://127.0.0.1:8088/api/v4/graphql/ws',
    node: process.env.MIDNIGHT_NODE_URL ?? 'http://127.0.0.1:9944',
    nodeWS: 'ws://127.0.0.1:9944',
    proofServer:
      process.env.MIDNIGHT_PROOF_SERVER_URL ?? 'http://127.0.0.1:6300',
    faucet: undefined as unknown as string,
  };
}

/**
 * Set the process-wide network id. Must be called once before any provider
 * or wallet is constructed. Idempotent; safe to call from multiple suites.
 */
let networkIdSet = false;
export function setupNetwork(): void {
  if (networkIdSet) return;
  setNetworkId(
    (process.env.MIDNIGHT_NETWORK_ID ?? 'undeployed') as NetworkId,
  );
  networkIdSet = true;
}
