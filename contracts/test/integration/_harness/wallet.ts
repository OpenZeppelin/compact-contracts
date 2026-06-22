import { LOCAL_WALLET_MNEMONIC, type LocalNetworkConfig } from './network.js';
import { OwnWalletProvider } from './ownWallet.js';

/**
 * Build (and start) a wallet provider from a BIP39 mnemonic, with no testkit-js
 * dependency. `OwnWalletProvider` implements both `MidnightProvider` and
 * `WalletProvider` expected by `@midnight-ntwrk/midnight-js-contracts#deployContract`.
 *
 * Default mnemonic is the prefunded genesis account on `midnight-node --preset=dev`.
 * Tests that need per-signer isolation pass their own BIP39 phrase.
 */
export async function buildWallet(
  env: LocalNetworkConfig,
  mnemonic: string = LOCAL_WALLET_MNEMONIC,
): Promise<OwnWalletProvider> {
  return OwnWalletProvider.build(env, { mnemonic }, { waitForFunds: true });
}
