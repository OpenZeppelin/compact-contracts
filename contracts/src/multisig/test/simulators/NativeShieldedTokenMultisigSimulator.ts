import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type ContractAddress,
  type Either,
  ledger,
  Contract as NativeShieldedTokenMultisigContract,
  pureCircuits,
  type ZswapCoinPublicKey,
} from '../../../../artifacts/NativeShieldedTokenMultisig/contract/index.js';
import { EmptyPrivateState, emptyWitnesses } from '../EmptyWitnesses.js';

type NativeShieldedTokenMultisigArgs = readonly [
  instanceSalt: Uint8Array,
  initCoinNonce: Uint8Array,
  tokenDomain: Uint8Array,
  signerCommitments: Uint8Array[],
];

const NativeShieldedTokenMultisigSimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  NativeShieldedTokenMultisigContract<EmptyPrivateState>,
  NativeShieldedTokenMultisigArgs
>({
  contractFactory: (witnesses) =>
    new NativeShieldedTokenMultisigContract<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: (
    instanceSalt,
    initCoinNonce,
    tokenDomain,
    signerCommitments,
  ) => [instanceSalt, initCoinNonce, tokenDomain, signerCommitments],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
  artifactName: 'NativeShieldedTokenMultisig',
});

export class NativeShieldedTokenMultisigSimulator extends NativeShieldedTokenMultisigSimulatorBase {
  static async create(
    instanceSalt: Uint8Array,
    initCoinNonce: Uint8Array,
    tokenDomain: Uint8Array,
    signerCommitments: Uint8Array[],
    options: SimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ): Promise<NativeShieldedTokenMultisigSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [instanceSalt, initCoinNonce, tokenDomain, signerCommitments],
      options,
    ) as Promise<NativeShieldedTokenMultisigSimulator>;
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
