import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockEcdsaSignerManager,
  pureCircuits,
} from '../../../../artifacts/MockEcdsaSignerManager/contract/index.js';
import { EmptyPrivateState, emptyWitnesses } from '../EmptyWitnesses.js';

/**
 * Type constructor args
 */
type EcdsaSignerManagerArgs = readonly [
  salt: Uint8Array,
  signers: Uint8Array[],
  thresh: bigint,
];

const EcdsaSignerManagerSimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  MockEcdsaSignerManager<EmptyPrivateState>,
  EcdsaSignerManagerArgs
>({
  contractFactory: (witnesses) =>
    new MockEcdsaSignerManager<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: (salt, signers, thresh) => [salt, signers, thresh],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
});

/**
 * EcdsaSignerManager Simulator
 */
export class EcdsaSignerManagerSimulator extends EcdsaSignerManagerSimulatorBase {
  constructor(
    salt: Uint8Array,
    signers: Uint8Array[],
    thresh: bigint,
    options: BaseSimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ) {
    super([salt, signers, thresh], options);
  }

  /**
   * Pure commitment derivation — callable without a deployed instance.
   */
  public static calculateSignerId(pk: Uint8Array, salt: Uint8Array): Uint8Array {
    return pureCircuits._calculateSignerId(pk, salt);
  }

  public verify(
    msgHash: Uint8Array,
    pubkeys: [Uint8Array, Uint8Array],
    signatures: [Uint8Array, Uint8Array],
  ) {
    return this.circuits.impure.verify(msgHash, pubkeys, signatures);
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
}
