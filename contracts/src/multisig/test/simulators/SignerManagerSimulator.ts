import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin-compact/contracts-simulator';
import {
  type ContractAddress,
  type Either,
  ledger,
  Contract as MockSignerManager,
  type ZswapCoinPublicKey,
} from '../../../../artifacts/MockSignerManager/contract/index.js';
import {
  SignerManagerPrivateState,
  SignerManagerWitnesses,
} from '../../witnesses/SignerManagerWitness.js';

/**
 * Type constructor args
 */
type SignerManagerArgs = readonly [
  signers: Either<ZswapCoinPublicKey, ContractAddress>[],
  thresh: bigint,
];

const SignerManagerSimulatorBase = createSimulator<
  SignerManagerPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof SignerManagerWitnesses>,
  MockSignerManager<SignerManagerPrivateState>,
  SignerManagerArgs
>({
  contractFactory: (witnesses) =>
    new MockSignerManager<SignerManagerPrivateState>(witnesses),
  defaultPrivateState: () => SignerManagerPrivateState,
  contractArgs: (signers, thresh) => [signers, thresh],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => SignerManagerWitnesses(),
});

/**
 * SignerManager Simulator
 */
export class SignerManagerSimulator extends SignerManagerSimulatorBase {
  constructor(
    signers: Either<ZswapCoinPublicKey, ContractAddress>[],
    thresh: bigint,
    options: BaseSimulatorOptions<
      SignerManagerPrivateState,
      ReturnType<typeof SignerManagerWitnesses>
    > = {},
  ) {
    super([signers, thresh], options);
  }

  public assertSigner(caller: Either<ZswapCoinPublicKey, ContractAddress>) {
    return this.circuits.impure.assertSigner(caller);
  }

  public assertThresholdMet(approvalCount: bigint) {
    return this.circuits.impure.assertThresholdMet(approvalCount);
  }

  public getSignerCount(): bigint {
    return this.circuits.impure.getSignerCount();
  }

  public getThreshold(): bigint {
    return this.circuits.impure.getThreshold();
  }

  public isSigner(
    account: Either<ZswapCoinPublicKey, ContractAddress>,
  ): boolean {
    return this.circuits.impure.isSigner(account);
  }

  public _addSigner(signer: Either<ZswapCoinPublicKey, ContractAddress>) {
    return this.circuits.impure._addSigner(signer);
  }

  public _removeSigner(signer: Either<ZswapCoinPublicKey, ContractAddress>) {
    return this.circuits.impure._removeSigner(signer);
  }

  public _changeThreshold(newThreshold: bigint) {
    return this.circuits.impure._changeThreshold(newThreshold);
  }
}
