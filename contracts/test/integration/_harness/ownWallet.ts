/**
 * Own test wallet provider — a testkit-js-free reconstruction of the wallet
 * stack used by `@midnight-ntwrk/midnight-js-contracts#deployContract`.
 *
 * WHY THIS EXISTS
 * ---------------
 * The integration harness previously leaned on `@midnight-ntwrk/testkit-js`'s
 * `MidnightWalletProvider` / `FluentWalletBuilder`. testkit is a heavy
 * dependency (testcontainers, docker orchestration, a fixed env model) of which
 * we use almost nothing — we run our own local stack via `make env-up`. All
 * testkit gave us here was a thin `WalletProvider`/`MidnightProvider` adapter
 * over `@midnight-ntwrk/wallet-sdk` plus seed-derivation glue.
 *
 * This module reproduces exactly that glue directly on `@midnight-ntwrk/wallet-sdk`,
 * so the harness no longer imports testkit. It is a behavioural drop-in for the
 * old `buildWallet()` (see wallet.ts) and `WalletPool` seed path.
 *
 * The construction mirrors testkit's `WalletFactory` / `FluentWalletBuilder`:
 *   seeds  = role-derived sub-seeds from a BIP39 mnemonic or a raw 32-byte seed
 *   facade = WalletFacade.init({ shielded, unshielded, dust }) over wallet-sdk
 * `balanceTx` / `submitTx` delegate to the facade identically to testkit.
 *
 * The provider deliberately exposes its internals (`facade`, `zswapSecretKeys`,
 * `shielded`) so a future coin-injecting shielded wallet can be slotted in via
 * `WalletFacade.init`'s custom `shielded` initialiser — the seam that unblocks
 * the spend-path (burn / round-trip) integration specs. See
 * `NativeShieldedToken-tests.md` "Own wallet tool".
 */
import {
  DustSecretKey,
  LedgerParameters,
  ZswapSecretKeys,
} from '@midnight-ntwrk/ledger-v8';
import type { NetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import type {
  FinalizedTransaction,
  TransactionId,
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import type {
  MidnightProvider,
  WalletProvider,
} from '@midnight-ntwrk/midnight-js-types';
import {
  createKeystore,
  DustWallet,
  HDWallet,
  InMemoryTransactionHistoryStorage,
  mergeWalletEntries,
  PublicKey,
  type Role,
  Roles,
  ShieldedWallet,
  UnshieldedWallet,
  WalletEntrySchema,
  WalletFacade,
} from '@midnight-ntwrk/wallet-sdk';
import { mnemonicToSeedSync } from '@scure/bip39';
import pino, { type Logger } from 'pino';

/**
 * Minimal endpoint config our wallet needs — a structural subset of the fields
 * `networkConfig()` already returns, with no testkit type dependency.
 */
export interface OwnNetworkConfig {
  readonly walletNetworkId: NetworkId;
  readonly indexer: string;
  readonly indexerWS: string;
  readonly nodeWS: string;
  readonly proofServer: string;
}

/**
 * Wide fee overhead for the local `undeployed` network. Genesis-funded dust at
 * preset-dev needs headroom to cover fees on undeployed; mirrors the value the
 * old testkit-based `buildWallet` passed via `DustWalletOptions`.
 */
const UNDEPLOYED_FEE_OVERHEAD = 500_000_000_000_000_000n;

let sharedLogger: Logger | undefined;
function ownLogger(): Logger {
  if (!sharedLogger) {
    sharedLogger = pino({ level: process.env.LOG_LEVEL ?? 'warn' });
  }
  return sharedLogger;
}

/** The three role sub-seeds derived from a master seed, plus the master. */
interface DerivedSeeds {
  readonly masterSeedHex: string;
  readonly shielded: Uint8Array;
  readonly unshielded: Uint8Array;
  readonly dust: Uint8Array;
}

/** Derive a role key the way testkit's `deriveKeyForRole` does (account 0, key 0). */
function deriveKeyForRole(masterSeedHex: string, role: Role): Uint8Array {
  if (!masterSeedHex || masterSeedHex.length === 0) {
    throw new Error('Own wallet: master seed cannot be empty');
  }
  const result = HDWallet.fromSeed(Buffer.from(masterSeedHex, 'hex'));
  if (result.type !== 'seedOk') {
    throw new Error('Own wallet: invalid seed, failed to create HD wallet');
  }
  const derived = result.hdWallet
    .selectAccount(0)
    .selectRole(role)
    .deriveKeyAt(0);
  if (derived.type !== 'keyDerived') {
    throw new Error(`Own wallet: key derivation failed for role ${role}`);
  }
  return derived.key;
}

function seedsFromMasterHex(masterSeedHex: string): DerivedSeeds {
  return {
    masterSeedHex,
    shielded: deriveKeyForRole(masterSeedHex, Roles.Zswap),
    unshielded: deriveKeyForRole(masterSeedHex, Roles.NightExternal),
    dust: deriveKeyForRole(masterSeedHex, Roles.Dust),
  };
}

function seedsFromMnemonic(mnemonic: string): DerivedSeeds {
  if (!mnemonic || mnemonic.trim().length === 0) {
    throw new Error('Own wallet: mnemonic cannot be empty');
  }
  return seedsFromMasterHex(
    Buffer.from(mnemonicToSeedSync(mnemonic)).toString('hex'),
  );
}

/**
 * Map our endpoint config to the wallet-sdk facade configuration object.
 * Shape lifted from testkit's `mapEnvironmentToConfiguration`.
 */
function facadeConfiguration(env: OwnNetworkConfig) {
  return {
    indexerClientConnection: {
      indexerHttpUrl: env.indexer,
      indexerWsUrl: env.indexerWS,
    },
    provingServerUrl: new URL(env.proofServer),
    networkId: env.walletNetworkId,
    relayURL: new URL(env.nodeWS),
    txHistoryStorage: new InMemoryTransactionHistoryStorage(
      WalletEntrySchema,
      mergeWalletEntries,
    ),
    costParameters: { feeBlocksMargin: 5 },
  };
}

/**
 * `WalletProvider` + `MidnightProvider` over a wallet-sdk `WalletFacade`,
 * with no testkit dependency. `balanceTx`/`submitTx` are byte-for-byte the
 * same delegations testkit's `MidnightWalletProvider` performed.
 */
export class OwnWalletProvider implements WalletProvider, MidnightProvider {
  private constructor(
    readonly env: OwnNetworkConfig,
    readonly facade: WalletFacade,
    readonly zswapSecretKeys: ZswapSecretKeys,
    readonly dustSecretKey: DustSecretKey,
    private readonly unshieldedKeystore: ReturnType<typeof createKeystore>,
  ) {}

  getCoinPublicKey() {
    return this.zswapSecretKeys.coinPublicKey;
  }

  getEncryptionPublicKey() {
    return this.zswapSecretKeys.encryptionPublicKey;
  }

  async balanceTx(
    tx: Parameters<WalletProvider['balanceTx']>[0],
    ttl: Date = ttlOneHour(),
  ): Promise<FinalizedTransaction> {
    const recipe = await this.facade.balanceUnboundTransaction(
      tx,
      {
        shieldedSecretKeys: this.zswapSecretKeys,
        dustSecretKey: this.dustSecretKey,
      },
      { ttl },
    );
    const signed = await this.facade.signRecipe(recipe, (payload) =>
      this.unshieldedKeystore.signData(payload),
    );
    return this.facade.finalizeRecipe(signed);
  }

  submitTx(tx: FinalizedTransaction): Promise<TransactionId> {
    return this.facade.submitTransaction(tx);
  }

  async stop(): Promise<void> {
    await this.facade.stop();
  }

  /** Build a provider from a master seed (hex) or BIP39 mnemonic. */
  static async build(
    env: OwnNetworkConfig,
    keyMaterial: { mnemonic: string } | { seedHex: string },
    options: { waitForFunds?: boolean } = {},
  ): Promise<OwnWalletProvider> {
    const logger = ownLogger();
    const seeds =
      'mnemonic' in keyMaterial
        ? seedsFromMnemonic(keyMaterial.mnemonic)
        : seedsFromMasterHex(keyMaterial.seedHex);

    const config = facadeConfiguration(env);
    const unshieldedKeystore = createKeystore(
      seeds.unshielded,
      env.walletNetworkId,
    );

    const shielded = ShieldedWallet(config).startWithSeed(seeds.shielded);
    const unshielded = UnshieldedWallet({
      ...config,
      txHistoryStorage: new InMemoryTransactionHistoryStorage(
        WalletEntrySchema,
        mergeWalletEntries,
      ),
    }).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore));

    const dustConfig = {
      ...config,
      costParameters: {
        ledgerParams: LedgerParameters.initialParameters(),
        additionalFeeOverhead:
          env.walletNetworkId === 'undeployed' ? UNDEPLOYED_FEE_OVERHEAD : 0n,
        feeBlocksMargin: 5,
      },
    };
    const dust = DustWallet(dustConfig).startWithSeed(
      seeds.dust,
      LedgerParameters.initialParameters().dust,
    );

    const facade = await WalletFacade.init({
      configuration: config,
      shielded: () => shielded,
      unshielded: () => unshielded,
      dust: () => dust,
    });

    const zswapSecretKeys = ZswapSecretKeys.fromSeed(seeds.shielded);
    const dustSecretKey = DustSecretKey.fromSeed(seeds.dust);

    logger.info('Own wallet: starting facade...');
    await facade.start(zswapSecretKeys, dustSecretKey);
    if (options.waitForFunds ?? true) {
      await waitForShieldedSync(facade, logger);
    }

    return new OwnWalletProvider(
      env,
      facade,
      zswapSecretKeys,
      dustSecretKey,
      unshieldedKeystore,
    );
  }
}

function ttlOneHour(): Date {
  return new Date(Date.now() + 60 * 60 * 1000);
}

/**
 * Block until the shielded wallet reports a synced state. The facade's shielded
 * API exposes a `waitForSyncedState`; fall back to a short settle if absent.
 */
async function waitForShieldedSync(
  facade: WalletFacade,
  logger: Logger,
): Promise<void> {
  const shielded = facade.shielded as {
    waitForSyncedState?: (gap?: bigint) => Promise<unknown>;
  };
  if (typeof shielded.waitForSyncedState === 'function') {
    await shielded.waitForSyncedState();
    logger.info('Own wallet: shielded state synced');
  }
}
