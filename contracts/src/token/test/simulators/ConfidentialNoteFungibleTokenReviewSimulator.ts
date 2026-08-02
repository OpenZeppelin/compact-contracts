import type { JubjubPoint } from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockReview,
} from '../../../../artifacts/MockConfidentialNoteFungibleTokenReview/contract/index.js';
import {
  type ConfidentialNoteFungibleTokenReviewPrivateState,
  ConfidentialNoteFungibleTokenReviewWitnesses,
  ConfidentialNoteFungibleTokenReviewPrivateState as PrivateState,
} from '../witnesses/ConfidentialNoteFungibleTokenReviewWitnesses.js';

const ConfidentialNoteFungibleTokenReviewSimulatorBase = createSimulator<
  ConfidentialNoteFungibleTokenReviewPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ConfidentialNoteFungibleTokenReviewWitnesses>,
  MockReview<ConfidentialNoteFungibleTokenReviewPrivateState>,
  readonly []
>({
  contractFactory: (witnesses) =>
    new MockReview<ConfidentialNoteFungibleTokenReviewPrivateState>(witnesses),
  defaultPrivateState: () => PrivateState.generate(),
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ConfidentialNoteFungibleTokenReviewWitnesses(),
  artifactName: 'MockConfidentialNoteFungibleTokenReview',
});

export class ConfidentialNoteFungibleTokenReviewSimulator extends ConfidentialNoteFungibleTokenReviewSimulatorBase {
  static async create(
    options: SimulatorOptions<
      ConfidentialNoteFungibleTokenReviewPrivateState,
      ReturnType<typeof ConfidentialNoteFungibleTokenReviewWitnesses>
    > = {},
  ): Promise<ConfidentialNoteFungibleTokenReviewSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create keeps subclass `this`
    return super.create(
      [],
      options,
    ) as Promise<ConfidentialNoteFungibleTokenReviewSimulator>;
  }

  public addReviewer(reviewerKey: JubjubPoint): Promise<[]> {
    return this.circuits.impure._addReviewer(reviewerKey);
  }

  public removeReviewer(reviewerKey: JubjubPoint): Promise<[]> {
    return this.circuits.impure._removeReviewer(reviewerKey);
  }

  public emitReviewRecord(
    reviewerKey: JubjubPoint,
    ownerPk: bigint,
    value: bigint,
    nonce: bigint,
    slot: Uint8Array,
  ): Promise<[]> {
    return this.circuits.impure._emitReviewRecord(
      reviewerKey,
      ownerPk,
      value,
      nonce,
      slot,
    );
  }

  public readonly privateState = {
    set: async (
      partial: Partial<ConfidentialNoteFungibleTokenReviewPrivateState>,
    ): Promise<ConfidentialNoteFungibleTokenReviewPrivateState> => {
      const updated = { ...(await this.getPrivateState()), ...partial };
      this.setPrivateState(updated);
      return updated;
    },
  };
}
