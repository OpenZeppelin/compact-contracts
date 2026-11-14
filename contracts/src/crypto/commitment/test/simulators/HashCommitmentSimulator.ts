import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockHashCommitment,
} from '../../../../../artifacts/crypto/commitment/test/mocks/MockHashCommitment/contract/index.js';

// The HashCommitment module is stateless and declares no witnesses, so the
// private state and witness set are both empty.
export type HashCommitmentPrivateState = Record<string, never>;
export const HashCommitmentPrivateState: HashCommitmentPrivateState = {};
export const HashCommitmentWitnesses = () => ({});

/**
 * Type constructor args
 */
type HashCommitmentArgs = readonly [];

const HashCommitmentSimulatorBase = createSimulator<
  HashCommitmentPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof HashCommitmentWitnesses>,
  MockHashCommitment<HashCommitmentPrivateState>,
  HashCommitmentArgs
>({
  contractFactory: (witnesses) =>
    new MockHashCommitment<HashCommitmentPrivateState>(witnesses),
  defaultPrivateState: () => HashCommitmentPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => HashCommitmentWitnesses(),
  artifactName: 'MockHashCommitment',
});

/**
 * HashCommitment Simulator
 *
 * Each method is a thin pass-through to the mock's matching circuit. The
 * `refCommit*` methods commit to a flat `{ domain, message }`, and the
 * `refHash*` methods hash `{ randomness, domain, message }`, neither going
 * through `HashCommitment`.
 */
export class HashCommitmentSimulator extends HashCommitmentSimulatorBase {
  static async create(
    options: SimulatorOptions<
      HashCommitmentPrivateState,
      ReturnType<typeof HashCommitmentWitnesses>
    > = {},
  ): Promise<HashCommitmentSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<HashCommitmentSimulator>;
  }

  /** @description `HashCommitment.commit` over a `Bytes<32>` message. */
  public commitOfBytes(
    domain: Uint8Array,
    message: Uint8Array,
    randomness: Uint8Array,
  ): Promise<Uint8Array> {
    return this.circuits.impure.commitOfBytes(domain, message, randomness);
  }

  /** @description `HashCommitment.commit` over a `Field` message. */
  public commitOfField(
    domain: Uint8Array,
    message: bigint,
    randomness: Uint8Array,
  ): Promise<Uint8Array> {
    return this.circuits.impure.commitOfField(domain, message, randomness);
  }

  /** @description `persistentCommit` reference for {@link commitOfBytes}. */
  public refCommitOfBytes(
    domain: Uint8Array,
    message: Uint8Array,
    randomness: Uint8Array,
  ): Promise<Uint8Array> {
    return this.circuits.impure.refCommitOfBytes(domain, message, randomness);
  }

  /** @description `persistentCommit` reference for {@link commitOfField}. */
  public refCommitOfField(
    domain: Uint8Array,
    message: bigint,
    randomness: Uint8Array,
  ): Promise<Uint8Array> {
    return this.circuits.impure.refCommitOfField(domain, message, randomness);
  }

  /** @description `persistentHash` reference for {@link commitOfBytes}. */
  public refHashOfBytes(
    domain: Uint8Array,
    message: Uint8Array,
    randomness: Uint8Array,
  ): Promise<Uint8Array> {
    return this.circuits.impure.refHashOfBytes(domain, message, randomness);
  }

  /** @description `persistentHash` reference for {@link commitOfField}. */
  public refHashOfField(
    domain: Uint8Array,
    message: bigint,
    randomness: Uint8Array,
  ): Promise<Uint8Array> {
    return this.circuits.impure.refHashOfField(domain, message, randomness);
  }
}
