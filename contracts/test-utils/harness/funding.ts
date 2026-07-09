import { unshieldedToken } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import {
  type LocalTestConfiguration,
  type MidnightWalletProvider,
  syncWallet,
  waitForFunds,
} from '@midnight-ntwrk/testkit-js';
import { UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';

/**
 * Deployer-funds-signer top-up for the local `undeployed` devnet.
 *
 * The dev preset only genesis-funds three of the pool's four seeds, so the
 * fourth signer starts with zero NIGHT and cannot pay tx fees. This transfers
 * NIGHT from the (genesis-funded) deployer to that signer, registers it for dust
 * generation, and waits for the dust to appear — after which the signer can pay
 * for its own multisig transactions. Verified end-to-end on the live stack: dust
 * bootstraps within one block of the registration.
 *
 * Only the testkit-aware layer uses this; the pool and its unit tests stay
 * testkit-free (the funder is wired in by `live.setup.ts`).
 */

/** The pino logger testkit's providers expect. */
type LiveLogger = Parameters<typeof MidnightWalletProvider.withWallet>[0];

/**
 * NIGHT moved to a topped-up signer. Sized well above the fee overhead so the
 * signer generates ample dust for a spec's worth of proofs, while leaving the
 * deployer the bulk of its genesis grant for the deploys it keeps paying for.
 */
export const SIGNER_TOPUP_NIGHT = 50_000_000_000_000n; // 5e13

/** The NIGHT raw token type (the native unshielded token). */
const nightRaw = () => unshieldedToken().raw;

/** The target provider's unshielded address as the SDK's `UnshieldedAddress`. */
function receiverAddressOf(target: MidnightWalletProvider): UnshieldedAddress {
  const bech32 = target.unshieldedKeystore.getBech32Address();
  return bech32.decode(
    UnshieldedAddress,
    (bech32 as unknown as { network: string }).network,
  );
}

/** Transfer `amount` NIGHT from `from` to `to`'s unshielded address; returns the tx id. */
async function transferNight(
  from: MidnightWalletProvider,
  to: MidnightWalletProvider,
  amount: bigint,
): Promise<string> {
  const ttl = new Date(Date.now() + 30 * 60 * 1000);
  const recipe = await from.wallet.transferTransaction(
    [
      {
        type: 'unshielded',
        outputs: [
          { type: nightRaw(), receiverAddress: receiverAddressOf(to), amount },
        ],
      },
    ],
    {
      shieldedSecretKeys: from.zswapSecretKeys,
      dustSecretKey: from.dustSecretKey,
    },
    { ttl, payFees: true },
  );
  // Spending unshielded UTXOs needs the owner's signature before finalizing.
  const signed = await from.wallet.signRecipe(recipe, (payload) =>
    from.unshieldedKeystore.signData(payload),
  );
  const finalized = await from.wallet.finalizeRecipe(signed);
  return from.wallet.submitTransaction(finalized);
}

// Transfers from the shared deployer are serialized so concurrent top-ups (one
// per unfunded signer, built in parallel) don't race on the deployer's UTXOs.
let transferQueue: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = transferQueue.then(fn, fn);
  transferQueue = run.catch(() => undefined);
  return run;
}

async function nightBalance(p: MidnightWalletProvider): Promise<bigint> {
  return (await syncWallet(p.wallet)).unshielded.balances[nightRaw()] ?? 0n;
}
async function dustBalance(p: MidnightWalletProvider): Promise<bigint> {
  return (await syncWallet(p.wallet)).dust.balance(new Date());
}

/**
 * Fund `target` from `deployer` and wait until it holds spendable dust. Transfers
 * {@link SIGNER_TOPUP_NIGHT}, waits for the UTXO to arrive, registers it for dust
 * generation (via `waitForFunds`), then polls until the dust balance is non-zero.
 * Returns the target's dust balance. Throws if the dust never appears.
 */
export async function fundFromDeployer(
  deployer: MidnightWalletProvider,
  target: MidnightWalletProvider,
  env: LocalTestConfiguration,
  logger: LiveLogger,
  {
    amount = SIGNER_TOPUP_NIGHT,
    retries = 30,
    delayMs = 2000,
  }: { amount?: bigint; retries?: number; delayMs?: number } = {},
): Promise<bigint> {
  const txId = await serialize(() => transferNight(deployer, target, amount));
  logger.info(`top-up: sent ${amount} NIGHT to a signer (tx ${txId})`);

  // Wait for the NIGHT to land before registering it for dust.
  for (let i = 0; i < retries; i++) {
    if ((await nightBalance(target)) > 0n) break;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  // Registers the freshly-received NIGHT UTXO for dust generation.
  await waitForFunds(target.wallet, env, true, target.unshieldedKeystore);

  // Dust appears a block after registration; poll until it does.
  for (let i = 0; i < retries; i++) {
    const dust = await dustBalance(target);
    if (dust > 0n) {
      logger.info(`top-up: signer now holds dust ${dust}`);
      return dust;
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `top-up: signer received NIGHT but generated no dust within ${(retries * delayMs) / 1000}s`,
  );
}
