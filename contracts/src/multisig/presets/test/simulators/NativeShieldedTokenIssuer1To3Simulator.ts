import type { Secp256k1Point } from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import type { EcdsaSignature } from '#test-utils/fixtures/ecdsa.js';
import {
  ledger,
  Contract as MockNativeShieldedTokenIssuer1To3,
  pureCircuits,
  type ShieldedCoinInfo,
  type ZswapCoinPublicKey,
} from '../../../../../artifacts/MockNativeShieldedTokenIssuer1To3/contract/index.js';
import {
  EmptyPrivateState,
  emptyWitnesses,
} from '../../../test/EmptyWitnesses.js';

type NativeShieldedTokenIssuerArgs = readonly [
  instanceSalt: Uint8Array,
  tokenDomain: Uint8Array,
  name: string,
  symbol: string,
  decimals: bigint,
  signerCommitments: Uint8Array[],
];

const NativeShieldedTokenIssuer1To3SimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  MockNativeShieldedTokenIssuer1To3<EmptyPrivateState>,
  NativeShieldedTokenIssuerArgs
>({
  contractFactory: (witnesses) =>
    new MockNativeShieldedTokenIssuer1To3<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: (
    instanceSalt,
    tokenDomain,
    name,
    symbol,
    decimals,
    signerCommitments,
  ) => [instanceSalt, tokenDomain, name, symbol, decimals, signerCommitments],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
  artifactName: 'MockNativeShieldedTokenIssuer1To3',
});

export class NativeShieldedTokenIssuer1To3Simulator extends NativeShieldedTokenIssuer1To3SimulatorBase {
  static async create(
    instanceSalt: Uint8Array,
    tokenDomain: Uint8Array,
    name: string,
    symbol: string,
    decimals: bigint,
    signerCommitments: Uint8Array[],
    options: SimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ): Promise<NativeShieldedTokenIssuer1To3Simulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [instanceSalt, tokenDomain, name, symbol, decimals, signerCommitments],
      options,
    ) as Promise<NativeShieldedTokenIssuer1To3Simulator>;
  }

  public mint(
    amount: bigint,
    recipient: ZswapCoinPublicKey,
    pubkeys: Secp256k1Point[],
    signatures: EcdsaSignature[],
  ): Promise<ShieldedCoinInfo> {
    return this.circuits.impure.mint(amount, recipient, pubkeys, signatures);
  }

  public getNonce(): Promise<bigint> {
    return this.circuits.impure.getNonce();
  }

  public tokenColor(): Promise<Uint8Array> {
    return this.circuits.impure.tokenColor();
  }

  public getThreshold(): Promise<bigint> {
    return this.circuits.impure.getThreshold();
  }
}

export function calculateSignerId(
  pk: Secp256k1Point,
  salt: Uint8Array,
): Uint8Array {
  return pureCircuits._calculateSignerId(pk, salt);
}
