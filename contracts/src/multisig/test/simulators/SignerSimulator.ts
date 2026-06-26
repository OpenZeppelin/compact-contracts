import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockSigner,
} from '../../../../artifacts/MockSigner/contract/index.js';
import {
  SignerPrivateState,
  SignerWitnesses,
} from '../witnesses/SignerWitnesses.js';

/**
 * Type constructor args
 */
type SignerArgs = readonly [
  signers: Uint8Array[],
  thresh: bigint,
  isInit: boolean,
];

const SignerSimulatorBase = createSimulator<
  SignerPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof SignerWitnesses>,
  MockSigner<SignerPrivateState>,
  SignerArgs
>({
  contractFactory: (witnesses) => new MockSigner<SignerPrivateState>(witnesses),
  defaultPrivateState: () => SignerPrivateState,
  contractArgs: (signers, thresh, isInit) => [signers, thresh, isInit],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => SignerWitnesses(),
  artifactName: 'MockSigner',
});

/**
 * Signer Simulator
 */
export class SignerSimulator extends SignerSimulatorBase {
  static async create(
    signers: Uint8Array[],
    thresh: bigint,
    isInit: boolean,
    options: SimulatorOptions<
      SignerPrivateState,
      ReturnType<typeof SignerWitnesses>
    > = {},
  ): Promise<SignerSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [signers, thresh, isInit],
      options,
    ) as Promise<SignerSimulator>;
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
