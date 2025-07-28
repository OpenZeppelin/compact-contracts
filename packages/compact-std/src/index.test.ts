import { describe, expectTypeOf, it } from 'vitest';
import type {
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
} from './index';

describe('@midnight-dapps/compact-std', () => {
  it('should export Maybe type correctly', () => {
    const maybeNumber: Maybe<number> = { is_some: true, value: 42 };
    expectTypeOf(maybeNumber).toEqualTypeOf<{
      is_some: boolean;
      value: number;
    }>();
  });

  it('should export Either type correctly', () => {
    const eitherStringNumber: Either<string, number> = {
      is_left: true,
      left: 'test',
      right: 0,
    };
    expectTypeOf(eitherStringNumber).toEqualTypeOf<{
      is_left: boolean;
      left: string;
      right: number;
    }>();
  });

  it('should export CurvePoint type correctly', () => {
    const curvePoint: CurvePoint = { x: BigInt(1), y: BigInt(2) };
    expectTypeOf(curvePoint).toEqualTypeOf<{ x: bigint; y: bigint }>();
  });

  it('should export MerkleTreeDigest type correctly', () => {
    const digest: MerkleTreeDigest = { field: BigInt(123) };
    expectTypeOf(digest).toEqualTypeOf<{ field: bigint }>();
  });

  it('should export MerkleTreePathEntry type correctly', () => {
    const entry: MerkleTreePathEntry = {
      sibling: { field: BigInt(456) },
      goes_left: false,
    };
    expectTypeOf(entry).toEqualTypeOf<{
      sibling: { field: bigint };
      goes_left: boolean;
    }>();
  });

  it('should export MerkleTreePath type correctly', () => {
    const path: MerkleTreePath<Uint8Array> = {
      leaf: new Uint8Array([1, 2, 3]),
      path: [{ sibling: { field: BigInt(789) }, goes_left: true }],
    };
    expectTypeOf(path).toEqualTypeOf<{
      leaf: Uint8Array;
      path: { sibling: { field: bigint }; goes_left: boolean }[];
    }>();
  });

  it('should export ContractAddress type correctly', () => {
    const address: ContractAddress = { bytes: new Uint8Array(32) };
    expectTypeOf(address).toEqualTypeOf<{ bytes: Uint8Array }>();
  });

  it('should export CoinInfo type correctly', () => {
    const coin: CoinInfo = {
      nonce: new Uint8Array(32),
      color: new Uint8Array(32),
      value: BigInt(100),
    };
    expectTypeOf(coin).toEqualTypeOf<{
      nonce: Uint8Array;
      color: Uint8Array;
      value: bigint;
    }>();
  });

  it('should export QualifiedCoinInfo type correctly', () => {
    const qualifiedCoin: QualifiedCoinInfo = {
      nonce: new Uint8Array(32),
      color: new Uint8Array(32),
      value: BigInt(200),
      mt_index: BigInt(1),
    };
    expectTypeOf(qualifiedCoin).toEqualTypeOf<{
      nonce: Uint8Array;
      color: Uint8Array;
      value: bigint;
      mt_index: bigint;
    }>();
  });

  it('should export ZswapCoinPublicKey type correctly', () => {
    const pubKey: ZswapCoinPublicKey = { bytes: new Uint8Array(32) };
    expectTypeOf(pubKey).toEqualTypeOf<{ bytes: Uint8Array }>();
  });

  it('should export SendResult type correctly', () => {
    const result: SendResult = {
      change: {
        is_some: false,
        value: {
          nonce: new Uint8Array(32),
          color: new Uint8Array(32),
          value: BigInt(0),
        },
      },
      sent: {
        nonce: new Uint8Array(32),
        color: new Uint8Array(32),
        value: BigInt(50),
      },
    };
    expectTypeOf(result).toEqualTypeOf<{
      change: Maybe<CoinInfo>;
      sent: CoinInfo;
    }>();
  });
});
