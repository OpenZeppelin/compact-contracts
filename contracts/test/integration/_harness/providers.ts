import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { TestWalletProvider } from './wallet.js';

/**
 * Build a fully-wired `MidnightProviders` bundle for a given compiled contract's
 * artifact directory. Each module test passes its own `<ModuleName>` so the
 * ZK config provider reads that module's keys.
 *
 * Shape ported from midnight-apps/packages/lunarswap-cli/src/api/providers.ts.
 *
 * @param wallet        A started `TestWalletProvider`
 * @param artifactPath  Absolute path to `contracts/artifacts/<ModuleName>/contract`
 *                      (the directory containing `contract-info.json` etc.)
 * @param privateStateStoreName  LevelDB namespace, unique per test contract
 * @param circuitKeys   Type parameter carrying the module's circuit union
 */
export function buildProviders<
  CircuitKey extends string,
  PrivateStateId extends string,
  PrivateState,
>(
  wallet: TestWalletProvider,
  artifactPath: string,
  privateStateStoreName: string,
): MidnightProviders<CircuitKey, PrivateStateId, PrivateState> {
  const zkConfigProvider = new NodeZkConfigProvider<CircuitKey>(artifactPath);

  const privateStateConfig = {
    privateStateStoreName,
    accountId: wallet.getCoinPublicKey(),
    privateStoragePasswordProvider: () =>
      `${wallet.getEncryptionPublicKey() as string}A!`,
  } as Parameters<typeof levelPrivateStateProvider<PrivateStateId>>[0];

  return {
    privateStateProvider:
      levelPrivateStateProvider<PrivateStateId>(privateStateConfig),
    publicDataProvider: indexerPublicDataProvider(
      wallet.env.indexer,
      wallet.env.indexerWS,
    ),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(
      wallet.env.proofServer,
      zkConfigProvider,
    ),
    walletProvider: wallet,
    midnightProvider: wallet,
  };
}
