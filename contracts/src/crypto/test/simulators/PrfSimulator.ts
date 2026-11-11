import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockPrf,
} from '../../../../artifacts/crypto/test/mocks/MockPrf/contract/index.js';

// The Prf module is stateless and declares no witnesses, so the private state
// and witness set are both empty.
export type PrfPrivateState = Record<string, never>;
export const PrfPrivateState: PrfPrivateState = {};
export const PrfWitnesses = () => ({});

/**
 * Type constructor args
 */
type PrfArgs = readonly [];

const PrfSimulatorBase = createSimulator<
  PrfPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof PrfWitnesses>,
  MockPrf<PrfPrivateState>,
  PrfArgs
>({
  contractFactory: (witnesses) => new MockPrf<PrfPrivateState>(witnesses),
  defaultPrivateState: () => PrfPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => PrfWitnesses(),
  artifactName: 'MockPrf',
});

/**
 * Prf Simulator
 *
 * Each method is a thin pass-through to the mock's matching circuit. The
 * `ref*` methods hash a hand-written copy of the layout without going through
 * `Prf`.
 */
export class PrfSimulator extends PrfSimulatorBase {
  static async create(
    options: SimulatorOptions<
      PrfPrivateState,
      ReturnType<typeof PrfWitnesses>
    > = {},
  ): Promise<PrfSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<PrfSimulator>;
  }

  /** @description `Prf.prf` over a `Bytes<32>` input. */
  public prfOfBytes(
    domain: Uint8Array,
    input: Uint8Array,
    key: Uint8Array,
  ): Promise<Uint8Array> {
    return this.circuits.impure.prfOfBytes(domain, input, key);
  }

  /** @description `Prf.prfField` over a `Bytes<32>` input. */
  public prfFieldOfBytes(
    domain: Uint8Array,
    input: Uint8Array,
    key: Uint8Array,
  ): Promise<bigint> {
    return this.circuits.impure.prfFieldOfBytes(domain, input, key);
  }

  /** @description `Prf.prf` over a `Field` input. */
  public prfOfField(
    domain: Uint8Array,
    input: bigint,
    key: Uint8Array,
  ): Promise<Uint8Array> {
    return this.circuits.impure.prfOfField(domain, input, key);
  }

  /** @description `Prf.prfField` over a `Field` input. */
  public prfFieldOfField(
    domain: Uint8Array,
    input: bigint,
    key: Uint8Array,
  ): Promise<bigint> {
    return this.circuits.impure.prfFieldOfField(domain, input, key);
  }

  /** @description Reference for {@link prfOfBytes}. */
  public refPrfOfBytes(
    domain: Uint8Array,
    input: Uint8Array,
    key: Uint8Array,
  ): Promise<Uint8Array> {
    return this.circuits.impure.refPrfOfBytes(domain, input, key);
  }

  /** @description Reference for {@link prfFieldOfBytes}. */
  public refPrfFieldOfBytes(
    domain: Uint8Array,
    input: Uint8Array,
    key: Uint8Array,
  ): Promise<bigint> {
    return this.circuits.impure.refPrfFieldOfBytes(domain, input, key);
  }

  /** @description Reference for {@link prfOfField}. */
  public refPrfOfField(
    domain: Uint8Array,
    input: bigint,
    key: Uint8Array,
  ): Promise<Uint8Array> {
    return this.circuits.impure.refPrfOfField(domain, input, key);
  }

  /** @description Reference for {@link prfFieldOfField}. */
  public refPrfFieldOfField(
    domain: Uint8Array,
    input: bigint,
    key: Uint8Array,
  ): Promise<bigint> {
    return this.circuits.impure.refPrfFieldOfField(domain, input, key);
  }
}
