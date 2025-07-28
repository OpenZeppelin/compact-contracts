/**
 * @module @midnight-dapps/compact-stdlib
 * @description Re-exports custom structs from CompactStandardLibrary for use in TypeScript code.
 * Excludes standard runtime types from @midnight-ntwrk/compact-runtime.
 */
export type {
  CoinInfo,
  ContractAddress,
  CurvePoint,
  Either,
  Maybe,
  MerkleTreeDigest,
  MerkleTreePath,
  MerkleTreePathEntry,
  QualifiedCoinInfo,
  SendResult,
  ZswapCoinPublicKey,
} from './artifacts/Index/contract/index.cjs';
