import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockEcdsaSignerManagerSmallSet,
} from '../../../../artifacts/MockEcdsaSignerManagerSmallSet/contract/index.js';
import type { ApprovalSlot } from '../EcdsaTestUtils.js';
import { EmptyPrivateState, emptyWitnesses } from '../EmptyWitnesses.js';

type EcdsaSignerManagerSmallSetArgs = readonly [
  instanceSalt: Uint8Array,
  signerCommitments: Uint8Array[],
  threshold: bigint,
  soloSigner: boolean,
];

const EcdsaSignerManagerSmallSetSimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  MockEcdsaSignerManagerSmallSet<EmptyPrivateState>,
  EcdsaSignerManagerSmallSetArgs
>({
  contractFactory: (witnesses) =>
    new MockEcdsaSignerManagerSmallSet<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: (instanceSalt, signerCommitments, threshold, soloSigner) => [
    instanceSalt,
    signerCommitments,
    threshold,
    soloSigner,
  ],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
  artifactName: 'MockEcdsaSignerManagerSmallSet',
});

/** One- or two-signer deploys at approval widths 1 and 2. */
export class EcdsaSignerManagerSmallSetSimulator extends EcdsaSignerManagerSmallSetSimulatorBase {
  static async create(
    instanceSalt: Uint8Array,
    signerCommitments: Uint8Array[],
    threshold: bigint,
    soloSigner = false,
    options: SimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ): Promise<EcdsaSignerManagerSmallSetSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [instanceSalt, signerCommitments, threshold, soloSigner],
      options,
    ) as Promise<EcdsaSignerManagerSmallSetSimulator>;
  }

  public assertApprovals(
    msgHash: Uint8Array,
    approvals: ApprovalSlot[],
  ): Promise<[]> {
    return this.circuits.impure.assertApprovals(msgHash, approvals);
  }

  public assertSoloApproval(
    msgHash: Uint8Array,
    approvals: ApprovalSlot[],
  ): Promise<[]> {
    return this.circuits.impure.assertSoloApproval(msgHash, approvals);
  }

  public getSignerCount(): Promise<bigint> {
    return this.circuits.impure.getSignerCount();
  }

  public getThreshold(): Promise<bigint> {
    return this.circuits.impure.getThreshold();
  }
}
