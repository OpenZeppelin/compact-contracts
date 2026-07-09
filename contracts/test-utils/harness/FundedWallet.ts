import { DustSecretKey, ZswapSecretKeys } from '@midnight-ntwrk/ledger-v8';
import { unshieldedToken } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import {
  DEFAULT_DUST_OPTIONS,
  FluentWalletBuilder,
  type LocalTestConfiguration,
  MidnightWalletProvider,
  syncWallet,
  waitForFunds,
} from '@midnight-ntwrk/testkit-js';
import { MIN_WALLET_NIGHT, UNDEPLOYED_FEE_OVERHEAD } from './dust.js';
import type { PooledWallet } from './WalletPool.js';

/** The pino logger testkit's providers expect (withWallet's first parameter). */
type LiveLogger = Parameters<typeof MidnightWalletProvider.withWallet>[0];

/**
 * One dust-funded wallet built from a raw seed — the concrete
 * {@link PooledWallet} the live harness injects into the pool.
 *
 * Responsibility: apply the `undeployed` fee overhead (the knob
 * `MidnightWalletProvider.build()` hides) via the lower-level
 * `FluentWalletBuilder`, then run an asserting funds wait so an unfunded or
 * unsynced seed is spotted in seconds rather than hanging ~1h on its first tx.
 *
 * A wallet "can pay fees" when it holds spendable NIGHT (a genesis grant, still
 * unregistered) OR generated dust (NIGHT that has been registered for dust
 * generation — which zeroes the plain NIGHT balance). {@link build} does not
 * itself gate on this: it reports both balances via {@link isFunded} so the
 * composition root can top up an unfunded signer from the deployer before the
 * gate (see `funding.ts`). The deployer itself must be genesis-funded.
 */
export class FundedWallet implements PooledWallet {
  private constructor(
    readonly alias: string,
    readonly provider: MidnightWalletProvider,
    public nightBalance: bigint,
    public dustBalance: bigint,
  ) {}

  /** The wallet's coin public key, encoded for `MIDNIGHT_<ALIAS>_COIN_PK`. */
  get coinPublicKey(): string {
    return String(this.provider.getCoinPublicKey());
  }

  /** Whether the wallet can pay tx fees: spendable NIGHT or generated dust. */
  get isFunded(): boolean {
    return this.nightBalance >= MIN_WALLET_NIGHT || this.dustBalance > 0n;
  }

  stop(): Promise<void> {
    return this.provider.stop();
  }

  /** Re-sync and refresh {@link nightBalance} / {@link dustBalance} (e.g. after a top-up). */
  async refresh(): Promise<void> {
    const state = await syncWallet(this.provider.wallet);
    this.nightBalance = nightOf(state);
    this.dustBalance = state.dust.balance(new Date());
  }

  static async build(
    env: LocalTestConfiguration,
    alias: string,
    walletSeed: string,
    logger: LiveLogger,
  ): Promise<FundedWallet> {
    // `MidnightWalletProvider.build()` exposes no dust options, so go one layer
    // down to set `additionalFeeOverhead` on the dust wallet.
    const { wallet, seeds, keystore } =
      await FluentWalletBuilder.forEnvironment(env)
        .withSeed(walletSeed)
        .withDustOptions({
          ...DEFAULT_DUST_OPTIONS,
          additionalFeeOverhead: UNDEPLOYED_FEE_OVERHEAD,
        })
        .buildWithoutStarting();

    const provider = await MidnightWalletProvider.withWallet(
      logger,
      env,
      wallet,
      ZswapSecretKeys.fromSeed(seeds.shielded),
      DustSecretKey.fromSeed(seeds.dust),
      keystore,
    );

    // Start the facade WITHOUT the provider's fire-and-forget fund wait, then run
    // our own asserting wait so a zero-NIGHT/unsynced seed is spotted fast (the
    // plain `start(true)` logs a `0` balance and proceeds, which is the ~1h hang).
    // `waitForFunds` also registers any NIGHT UTXOs for dust generation.
    await provider.start(false);
    const nightBalance = await waitForFunds(wallet, env, true, keystore);
    const dustBalance = (await syncWallet(wallet)).dust.balance(new Date());
    logger.info(
      `live wallet '${alias}' built — NIGHT ${nightBalance}, dust ${dustBalance}`,
    );

    return new FundedWallet(alias, provider, nightBalance, dustBalance);
  }
}

/** The wallet's spendable NIGHT (the native unshielded token) in a synced state.
 * A wallet that has registered its NIGHT for dust generation reports it here as
 * absent (0n) — its balance has moved into dust. */
function nightOf(state: Awaited<ReturnType<typeof syncWallet>>): bigint {
  return state.unshielded.balances[unshieldedToken().raw] ?? 0n;
}
