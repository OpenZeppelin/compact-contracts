import {
  type NetworkId,
  setNetworkId,
} from '@midnight-ntwrk/midnight-js-network-id';

/**
 * Endpoint configuration for the local stack. Replaces testkit-js'
 * `EnvironmentConfiguration` — a plain struct of URLs we own, structurally
 * compatible with `OwnWalletProvider`'s `OwnNetworkConfig`.
 */
export interface LocalNetworkConfig {
  readonly walletNetworkId: NetworkId;
  readonly networkId: string;
  readonly indexer: string;
  readonly indexerWS: string;
  readonly node: string;
  readonly nodeWS: string;
  readonly proofServer: string;
  readonly faucet: string | undefined;
}

/**
 * Prefunded wallet mnemonic for the local `undeployed` network — the canonical
 * BIP39 test seed ("abandon" × 23 + "diesel") that `midnight-node --preset=dev`
 * recognises as the genesis-funded account. Inlined so the harness no longer
 * depends on testkit-js' `TEST_MNEMONIC`.
 */
export const LOCAL_WALLET_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon diesel';

/**
 * Default endpoints for the local stack brought up by `make env-up`.
 * Each is overridable via a MIDNIGHT_* env var so CI / other hosts
 * can point the same harness at a relocated stack.
 */
export function networkConfig(): LocalNetworkConfig {
  return {
    walletNetworkId: 'undeployed' as NetworkId,
    networkId: 'undeployed',
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
    faucet: undefined,
  };
}

/**
 * Set the process-wide network id. Must be called once before any provider
 * or wallet is constructed. Idempotent.
 */
let networkIdSet = false;
export function setupNetwork(): void {
  if (networkIdSet) return;
  setNetworkId((process.env.MIDNIGHT_NETWORK_ID ?? 'undeployed') as NetworkId);
  networkIdSet = true;
}
