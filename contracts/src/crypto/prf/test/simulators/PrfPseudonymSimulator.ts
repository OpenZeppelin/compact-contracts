import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockPrfPseudonym,
} from '../../../../../artifacts/crypto/prf/test/mocks/MockPrfPseudonym/contract/index.js';

// The PrfPseudonym module is stateless and declares no witnesses, so the
// private state and witness set are both empty.
export type PrfPseudonymPrivateState = Record<string, never>;
export const PrfPseudonymPrivateState: PrfPseudonymPrivateState = {};
export const PrfPseudonymWitnesses = () => ({});

/**
 * Type constructor args
 */
type PrfPseudonymArgs = readonly [];

const PrfPseudonymSimulatorBase = createSimulator<
  PrfPseudonymPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof PrfPseudonymWitnesses>,
  MockPrfPseudonym<PrfPseudonymPrivateState>,
  PrfPseudonymArgs
>({
  contractFactory: (witnesses) =>
    new MockPrfPseudonym<PrfPseudonymPrivateState>(witnesses),
  defaultPrivateState: () => PrfPseudonymPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => PrfPseudonymWitnesses(),
  artifactName: 'MockPrfPseudonym',
});

/**
 * PrfPseudonym Simulator
 *
 * Each method is a thin pass-through to the mock's matching circuit. The
 * `ref*` methods hash a flat `{ domain, salt, sk }`, the salt's fields
 * inlined, without going through `PrfPseudonym`.
 */
export class PrfPseudonymSimulator extends PrfPseudonymSimulatorBase {
  static async create(
    options: SimulatorOptions<
      PrfPseudonymPrivateState,
      ReturnType<typeof PrfPseudonymWitnesses>
    > = {},
  ): Promise<PrfPseudonymSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<PrfPseudonymSimulator>;
  }

  /** @description `PrfPseudonym.derivePseudonym`. */
  public derivePseudonym(
    domain: Uint8Array,
    salt: Uint8Array,
    sk: Uint8Array,
  ): Promise<Uint8Array> {
    return this.circuits.impure.derivePseudonym(domain, salt, sk);
  }

  /** @description `PrfPseudonym.derivePseudonym` under a `[Bytes<32>, Bytes<32>]` salt. */
  public derivePseudonymOfTuple(
    domain: Uint8Array,
    salt: [Uint8Array, Uint8Array],
    sk: Uint8Array,
  ): Promise<Uint8Array> {
    return this.circuits.impure.derivePseudonymOfTuple(domain, salt, sk);
  }

  /** @description Reference for {@link derivePseudonym}. */
  public refDerivePk(
    domain: Uint8Array,
    salt: Uint8Array,
    sk: Uint8Array,
  ): Promise<Uint8Array> {
    return this.circuits.impure.refDerivePk(domain, salt, sk);
  }

  /** @description Reference for {@link derivePseudonymOfTuple}. */
  public refDerivePkOfTuple(
    domain: Uint8Array,
    salt: [Uint8Array, Uint8Array],
    sk: Uint8Array,
  ): Promise<Uint8Array> {
    return this.circuits.impure.refDerivePkOfTuple(domain, salt, sk);
  }
}
