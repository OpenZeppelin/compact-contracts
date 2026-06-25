import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockSignerManager,
} from '../../../../artifacts/MockSignerManager/contract/index.js';
import { EmptyPrivateState, emptyWitnesses } from '../EmptyWitnesses.js';

/**
 * Type constructor args
 */
type SignerManagerArgs = readonly [
  signers: Uint8Array[],
  thresh: bigint,
  isInit: boolean,
];

const SignerManagerSimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  MockSignerManager<EmptyPrivateState>,
  SignerManagerArgs
>({
  contractFactory: (witnesses) => new MockSignerManager<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: (signers, thresh, isInit) => [signers, thresh, isInit],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
});

/**
 * Signer Simulator
 */
export class SignerManagerSimulator extends SignerManagerSimulatorBase {
  constructor(
    signers: Uint8Array[],
    thresh: bigint,
    isInit: boolean,
    options: BaseSimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ) {
    super([signers, thresh, isInit], options);
  }

  public initialize(signers: Uint8Array[], thresh: bigint) {
    return this.circuits.impure.initialize(signers, thresh);
  }

  public assertSigner(caller: Uint8Array) {
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

  public isSigner(account: Uint8Array): boolean {
    return this.circuits.impure.isSigner(account);
  }

  public _addSigner(signer: Uint8Array) {
    return this.circuits.impure._addSigner(signer);
  }

  public _removeSigner(signer: Uint8Array) {
    return this.circuits.impure._removeSigner(signer);
  }

  public _changeThreshold(newThreshold: bigint) {
    return this.circuits.impure._changeThreshold(newThreshold);
  }

  public _setThreshold(newThreshold: bigint) {
    return this.circuits.impure._setThreshold(newThreshold);
  }
}
