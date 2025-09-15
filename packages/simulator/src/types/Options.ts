import type {
  CoinPublicKey,
  ContractAddress,
} from '@midnight-ntwrk/compact-runtime';

/**
 * Base configuration options for simulator constructors.
 *
 * @template P - Private state type
 * @template W - Witnesses type
 */
export type BaseSimulatorOptions<P, W> = {
  /** Initial private state (uses default if not provided) */
  privateState?: P;
  /** Witness functions (uses default if not provided) */
  witnesses?: W;
  /** Coin public key for transactions */
  coinPK?: CoinPublicKey;
  /** Contract deployment address */
  contractAddress?: ContractAddress;
};
