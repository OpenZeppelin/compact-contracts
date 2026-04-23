import {
  type NetworkId,
  setNetworkId,
} from '@midnight-ntwrk/midnight-js-network-id';
import {
  TEST_MNEMONIC,
  type EnvironmentConfiguration,
} from '@midnight-ntwrk/testkit-js';

/**
 * Prefunded wallet mnemonic for the local `undeployed` network.
 * Matches testkit-js' exported `TEST_MNEMONIC` — "abandon × 23 diesel",
 * the canonical BIP39 test seed recognised by `midnight-node --preset=dev`
 * as the genesis-funded account.
 */
export const LOCAL_WALLET_MNEMONIC = TEST_MNEMONIC;

/**
 * Default endpoints for the local stack brought up by `make env-up`.
 * Each is overridable via a MIDNIGHT_* env var so CI / other hosts
 * can point the same harness at a relocated stack.
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
 * or wallet is constructed. Idempotent.
 */
let networkIdSet = false;
export function setupNetwork(): void {
  if (networkIdSet) return;
  setNetworkId(
    (process.env.MIDNIGHT_NETWORK_ID ?? 'undeployed') as NetworkId,
  );
  networkIdSet = true;
}
