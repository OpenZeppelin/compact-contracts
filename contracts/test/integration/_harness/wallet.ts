import { DustSecretKey, ZswapSecretKeys } from '@midnight-ntwrk/ledger-v8';
import {
  DEFAULT_DUST_OPTIONS,
  type EnvironmentConfiguration,
  FluentWalletBuilder,
  MidnightWalletProvider,
  type DustWalletOptions,
} from '@midnight-ntwrk/testkit-js';
import pino, { type Logger } from 'pino';
import { LOCAL_WALLET_MNEMONIC } from './network.js';

let sharedLogger: Logger | undefined;
function testLogger(): Logger {
  if (!sharedLogger) {
    sharedLogger = pino({ level: process.env.LOG_LEVEL ?? 'warn' });
  }
  return sharedLogger;
}

/**
 * Build a wallet from a BIP39 mnemonic and wrap it as `MidnightWalletProvider`
 * (which implements both `MidnightProvider` and `WalletProvider` expected by
 * `@midnight-ntwrk/midnight-js-contracts#deployContract`).
 *
 * Default mnemonic is the prefunded genesis account on `midnight-node --preset=dev`.
 * Tests that need per-signer isolation pass their own BIP39 phrase.
 */
export async function buildWallet(
  env: EnvironmentConfiguration,
  mnemonic: string = LOCAL_WALLET_MNEMONIC,
): Promise<MidnightWalletProvider> {
  const dustOptions: DustWalletOptions = {
    ...DEFAULT_DUST_OPTIONS,
    // Local/undeployed needs a wide fee overhead to cover dust fees at genesis.
    additionalFeeOverhead:
      env.walletNetworkId === 'undeployed'
        ? 500_000_000_000_000_000n
        : DEFAULT_DUST_OPTIONS.additionalFeeOverhead,
  };

  const { wallet, seeds, keystore } = await FluentWalletBuilder.forEnvironment(
    env,
  )
    .withDustOptions(dustOptions)
    .withMnemonic(mnemonic)
    .buildWithoutStarting();

  const provider = await MidnightWalletProvider.withWallet(
    testLogger(),
    env,
    wallet,
    ZswapSecretKeys.fromSeed(seeds.shielded),
    DustSecretKey.fromSeed(seeds.dust),
    keystore,
  );
  await provider.start(true);
  return provider;
}
