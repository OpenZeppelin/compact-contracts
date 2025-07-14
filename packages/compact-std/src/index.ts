/**
 * @module @midnight-dapps/compact-stdlib
 * @description Re-exports custom structs from CompactStandardLibrary for use in TypeScript code.
 * Excludes standard runtime types from @midnight-ntwrk/compact-runtime.
 */
export type {
  Maybe,
  Either,
  CurvePoint,
  MerkleTreeDigest,
  MerkleTreePathEntry,
  MerkleTreePath,
  ContractAddress,
  CoinInfo,
  QualifiedCoinInfo,
  ZswapCoinPublicKey,
  SendResult,
} from './artifacts/Index/contract/index.cjs';
