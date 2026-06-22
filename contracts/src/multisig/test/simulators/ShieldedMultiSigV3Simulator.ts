import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type ContractAddress,
  type Either,
  ledger,
  pureCircuits,
  Contract as ShieldedMultiSigV3Contract,
  type ZswapCoinPublicKey,
} from '../../../../artifacts/ShieldedMultiSigV3/contract/index.js';
import {
  ShieldedMultiSigV3PrivateState,
  ShieldedMultiSigV3Witnesses,
} from '../witnesses/ShieldedMultiSigV3Witnesses.js';

type ShieldedMultiSigV3Args = readonly [
  instanceSalt: Uint8Array,
  initCoinNonce: Uint8Array,
  tokenDomain: Uint8Array,
  signerCommitments: Uint8Array[],
];

const ShieldedMultiSigV3SimulatorBase = createSimulator<
  ShieldedMultiSigV3PrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ShieldedMultiSigV3Witnesses>,
  ShieldedMultiSigV3Contract<ShieldedMultiSigV3PrivateState>,
  ShieldedMultiSigV3Args
>({
  contractFactory: (witnesses) =>
    new ShieldedMultiSigV3Contract<ShieldedMultiSigV3PrivateState>(witnesses),
  defaultPrivateState: () => ShieldedMultiSigV3PrivateState,
  contractArgs: (
    instanceSalt,
    initCoinNonce,
    tokenDomain,
    signerCommitments,
  ) => [instanceSalt, initCoinNonce, tokenDomain, signerCommitments],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ShieldedMultiSigV3Witnesses(),
  artifactName: 'ShieldedMultiSigV3',
});

export class ShieldedMultiSigV3Simulator extends ShieldedMultiSigV3SimulatorBase {
  static async create(
    instanceSalt: Uint8Array,
    initCoinNonce: Uint8Array,
    tokenDomain: Uint8Array,
    signerCommitments: Uint8Array[],
    options: SimulatorOptions<
      ShieldedMultiSigV3PrivateState,
      ReturnType<typeof ShieldedMultiSigV3Witnesses>
    > = {},
  ): Promise<ShieldedMultiSigV3Simulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [instanceSalt, initCoinNonce, tokenDomain, signerCommitments],
      options,
    ) as Promise<ShieldedMultiSigV3Simulator>;
  }

  public _calculateSignerId(
    pk: Uint8Array,
    salt: Uint8Array,
  ): Promise<Uint8Array> {
    return this.circuits.pure._calculateSignerId(pk, salt);
  }

  public mint(
    amount: bigint,
    recipient: Either<ZswapCoinPublicKey, ContractAddress>,
    pubkeys: Uint8Array[],
    signatures: Uint8Array[],
  ): Promise<[]> {
    return this.circuits.impure.mint(amount, recipient, pubkeys, signatures);
  }

  public burn(
    coin: {
      nonce: Uint8Array;
      color: Uint8Array;
      value: bigint;
      mt_index: bigint;
    },
    amount: bigint,
    pubkeys: Uint8Array[],
    signatures: Uint8Array[],
  ): Promise<[]> {
    return this.circuits.impure.burn(coin, amount, pubkeys, signatures);
  }

  public getNonce(): Promise<bigint> {
    return this.circuits.impure.getNonce();
  }

  public getTokenDomain(): Promise<Uint8Array> {
    return this.circuits.impure.getTokenDomain();
  }

  public getTokenType(): Promise<Uint8Array> {
    return this.circuits.impure.getTokenType();
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
  pk: Uint8Array,
  salt: Uint8Array,
): Uint8Array {
  return pureCircuits._calculateSignerId(pk, salt);
}
