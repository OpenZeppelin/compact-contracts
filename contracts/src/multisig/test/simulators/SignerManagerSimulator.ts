import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type ContractAddress,
  type Either,
  ledger,
  Contract as MockSignerManager,
  type ZswapCoinPublicKey,
} from '../../../../artifacts/MockSignerManager/contract/index.js';
import { EmptyPrivateState, emptyWitnesses } from '../EmptyWitnesses.js';

/**
 * A fixed set of exactly three signers, matching the
 * `Vector<3, Either<ZswapCoinPublicKey, ContractAddress>>` the underlying
 * `MockSignerManager` constructor expects.
 */
export type SignerSet = readonly [
  Either<ZswapCoinPublicKey, ContractAddress>,
  Either<ZswapCoinPublicKey, ContractAddress>,
  Either<ZswapCoinPublicKey, ContractAddress>,
];

/**
 * Type constructor args
 */
type SignerManagerArgs = readonly [signers: SignerSet, thresh: bigint];

const SignerManagerSimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  MockSignerManager<EmptyPrivateState>,
  SignerManagerArgs
>({
  contractFactory: (witnesses) =>
    new MockSignerManager<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: (signers, thresh) => [signers, thresh],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
  artifactName: 'MockSignerManager',
});

/**
 * SignerManager Simulator
 */
export class SignerManagerSimulator extends SignerManagerSimulatorBase {
  static async create(
    signers: SignerSet,
    thresh: bigint,
    options: SimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ): Promise<SignerManagerSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [signers, thresh],
      options,
    ) as Promise<SignerManagerSimulator>;
  }

  public assertSigner(
    caller: Either<ZswapCoinPublicKey, ContractAddress>,
  ): Promise<[]> {
    return this.circuits.impure.assertSigner(caller);
  }

  public assertThresholdMet(approvalCount: bigint): Promise<[]> {
    return this.circuits.impure.assertThresholdMet(approvalCount);
  }

  public getSignerCount(): Promise<bigint> {
    return this.circuits.impure.getSignerCount();
  }

  public getThreshold(): Promise<bigint> {
    return this.circuits.impure.getThreshold();
  }

  public isSigner(
    account: Either<ZswapCoinPublicKey, ContractAddress>,
  ): Promise<boolean> {
    return this.circuits.impure.isSigner(account);
  }

  public _addSigner(
    signer: Either<ZswapCoinPublicKey, ContractAddress>,
  ): Promise<[]> {
    return this.circuits.impure._addSigner(signer);
  }

  public _removeSigner(
    signer: Either<ZswapCoinPublicKey, ContractAddress>,
  ): Promise<[]> {
    return this.circuits.impure._removeSigner(signer);
  }

  public _changeThreshold(newThreshold: bigint): Promise<[]> {
    return this.circuits.impure._changeThreshold(newThreshold);
  }
}
