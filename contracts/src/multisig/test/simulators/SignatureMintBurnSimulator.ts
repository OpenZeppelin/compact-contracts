import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  pureCircuits,
  Contract as MockSignatureMintBurn,
  type ZswapCoinPublicKey,
} from '../../../../artifacts/MockSignatureMintBurn/contract/index.js';
import { EmptyPrivateState, emptyWitnesses } from '../EmptyWitnesses.js';

type SignatureMintBurnArgs = readonly [
  instanceSalt: Uint8Array,
  initCoinNonce: Uint8Array,
  tokenDomain: Uint8Array,
  signerCommitments: Uint8Array[],
];

const SignatureMintBurnSimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  MockSignatureMintBurn<EmptyPrivateState>,
  SignatureMintBurnArgs
>({
  contractFactory: (witnesses) =>
    new MockSignatureMintBurn<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: (instanceSalt, initCoinNonce, tokenDomain, signerCommitments) => [
    instanceSalt,
    initCoinNonce,
    tokenDomain,
    signerCommitments,
  ],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
});

export class SignatureMintBurnSimulator extends SignatureMintBurnSimulatorBase {
  constructor(
    instanceSalt: Uint8Array,
    initCoinNonce: Uint8Array,
    tokenDomain: Uint8Array,
    signerCommitments: Uint8Array[],
    options: BaseSimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ) {
    super(
      [instanceSalt, initCoinNonce, tokenDomain, signerCommitments],
      options,
    );
  }

  public _calculateSignerId(pk: Uint8Array, salt: Uint8Array): Uint8Array {
    return this.circuits.pure._calculateSignerId(pk, salt);
  }

  public mint(
    amount: bigint,
    recipient: Either<ZswapCoinPublicKey, ContractAddress>,
    pubkeys: Uint8Array[],
    signatures: Uint8Array[],
  ) {
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
  ) {
    return this.circuits.impure.burn(coin, amount, pubkeys, signatures);
  }

  public getNonce(): bigint {
    return this.circuits.impure.getNonce();
  }

  public getTokenDomain(): Uint8Array {
    return this.circuits.impure.getTokenDomain();
  }

  public getTokenType(): Uint8Array {
    return this.circuits.impure.getTokenType();
  }

  public getSignerCount(): bigint {
    return this.circuits.impure.getSignerCount();
  }

  public getThreshold(): bigint {
    return this.circuits.impure.getThreshold();
  }

  public isSigner(commitment: Uint8Array): boolean {
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
