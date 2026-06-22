import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockSignerManager,
} from '../../../../artifacts/MockSignerManager/contract/index.js';
import {
  SignerManagerPrivateState,
  SignerManagerWitnesses,
} from '../witnesses/SignerManagerWitnesses.js';

/**
 * Type constructor args
 */
type SignerManagerArgs = readonly [
  signers: Uint8Array[],
  thresh: bigint,
  isInit: boolean,
];

const SignerManagerSimulatorBase = createSimulator<
  SignerManagerPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof SignerManagerWitnesses>,
  MockSignerManager<SignerManagerPrivateState>,
  SignerManagerArgs
>({
  contractFactory: (witnesses) => new MockSignerManager<SignerManagerPrivateState>(witnesses),
  defaultPrivateState: () => SignerManagerPrivateState,
  contractArgs: (signers, thresh, isInit) => [signers, thresh, isInit],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => SignerManagerWitnesses(),
  artifactName: 'MockSignerManager',
});

/**
 * SignerManager Simulator
 */
export class SignerManagerSimulator extends SignerManagerSimulatorBase {
  static async create(
    signers: Uint8Array[],
    thresh: bigint,
    isInit: boolean,
    options: SimulatorOptions<
      SignerManagerPrivateState,
      ReturnType<typeof SignerManagerWitnesses>
    > = {},
  ): Promise<SignerManagerSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [signers, thresh, isInit],
      options,
    ) as Promise<SignerManagerSimulator>;
  }

  public initialize(signers: Uint8Array[], thresh: bigint): Promise<[]> {
    return this.circuits.impure.initialize(signers, thresh);
  }

  public assertSigner(caller: Uint8Array): Promise<[]> {
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

  public isSigner(account: Uint8Array): Promise<boolean> {
    return this.circuits.impure.isSigner(account);
  }

  public _addSigner(signer: Uint8Array): Promise<[]> {
    return this.circuits.impure._addSigner(signer);
  }

  public _removeSigner(signer: Uint8Array): Promise<[]> {
    return this.circuits.impure._removeSigner(signer);
  }

  public _changeThreshold(newThreshold: bigint): Promise<[]> {
    return this.circuits.impure._changeThreshold(newThreshold);
  }

  public _setThreshold(newThreshold: bigint): Promise<[]> {
    return this.circuits.impure._setThreshold(newThreshold);
  }
}
