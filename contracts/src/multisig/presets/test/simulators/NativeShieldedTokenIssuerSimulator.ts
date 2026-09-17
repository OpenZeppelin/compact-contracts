import type { Secp256k1Point } from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import type { EcdsaSignature } from '#test-utils/fixtures/ecdsa.js';
import {
  type ContractAddress,
  type Either,
  ledger,
  type Maybe,
  Contract as MockNativeShieldedTokenIssuer,
  pureCircuits,
  type QualifiedShieldedCoinInfo,
  type ShieldedCoinInfo,
  type ZswapCoinPublicKey,
} from '../../../../../artifacts/MockNativeShieldedTokenIssuer/contract/index.js';
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
  isInit: boolean,
];

const NativeShieldedTokenIssuerSimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  MockNativeShieldedTokenIssuer<EmptyPrivateState>,
  NativeShieldedTokenIssuerArgs
>({
  contractFactory: (witnesses) =>
    new MockNativeShieldedTokenIssuer<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: (
    instanceSalt,
    tokenDomain,
    name,
    symbol,
    decimals,
    signerCommitments,
    isInit,
  ) => [
    instanceSalt,
    tokenDomain,
    name,
    symbol,
    decimals,
    signerCommitments,
    isInit,
  ],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
  artifactName: 'MockNativeShieldedTokenIssuer',
});

export class NativeShieldedTokenIssuerSimulator extends NativeShieldedTokenIssuerSimulatorBase {
  static async create(
    instanceSalt: Uint8Array,
    tokenDomain: Uint8Array,
    name: string,
    symbol: string,
    decimals: bigint,
    signerCommitments: Uint8Array[],
    isInit: boolean,
    options: SimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ): Promise<NativeShieldedTokenIssuerSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [
        instanceSalt,
        tokenDomain,
        name,
        symbol,
        decimals,
        signerCommitments,
        isInit,
      ],
      options,
    ) as Promise<NativeShieldedTokenIssuerSimulator>;
  }

  public _calculateSignerId(
    pk: Secp256k1Point,
    salt: Uint8Array,
  ): Promise<Uint8Array> {
    return this.circuits.pure._calculateSignerId(pk, salt);
  }

  public mint(
    amount: bigint,
    recipient: Either<ZswapCoinPublicKey, ContractAddress>,
    pubkeys: Secp256k1Point[],
    signatures: EcdsaSignature[],
  ): Promise<ShieldedCoinInfo> {
    return this.circuits.impure.mint(amount, recipient, pubkeys, signatures);
  }

  public burn(
    coin: QualifiedShieldedCoinInfo,
    amount: bigint,
    pubkeys: Secp256k1Point[],
    signatures: EcdsaSignature[],
  ): Promise<Maybe<ShieldedCoinInfo>> {
    return this.circuits.impure.burn(coin, amount, pubkeys, signatures);
  }

  public getNonce(): Promise<bigint> {
    return this.circuits.impure.getNonce();
  }

  public name(): Promise<string> {
    return this.circuits.impure.name();
  }

  public symbol(): Promise<string> {
    return this.circuits.impure.symbol();
  }

  public decimals(): Promise<bigint> {
    return this.circuits.impure.decimals();
  }

  public tokenColor(): Promise<Uint8Array> {
    return this.circuits.impure.tokenColor();
  }

  public getSignerCount(): Promise<bigint> {
    return this.circuits.impure.getSignerCount();
  }

  public getThreshold(): Promise<bigint> {
    return this.circuits.impure.getThreshold();
  }

  public isSigner(commitment: Uint8Array): Promise<boolean> {
    return this.circuits.impure.isSigner(commitment);
  }
}

// Computes signer commitment from `pk`, `salt`, and
// domain ("multisig:signer:"). Pure standalone circuit so commitments can be
// calculated before contract instantiation.
export function calculateSignerId(
  pk: Secp256k1Point,
  salt: Uint8Array,
): Uint8Array {
  return pureCircuits._calculateSignerId(pk, salt);
}
