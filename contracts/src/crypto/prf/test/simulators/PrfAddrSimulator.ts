import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockPrfAddr,
} from '../../../../../artifacts/crypto/prf/test/mocks/MockPrfAddr/contract/index.js';

// The PrfAddr module is stateless and declares no witnesses, so the private
// state and witness set are both empty.
export type PrfAddrPrivateState = Record<string, never>;
export const PrfAddrPrivateState: PrfAddrPrivateState = {};
export const PrfAddrWitnesses = () => ({});

/**
 * Type constructor args
 */
type PrfAddrArgs = readonly [];

const PrfAddrSimulatorBase = createSimulator<
  PrfAddrPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof PrfAddrWitnesses>,
  MockPrfAddr<PrfAddrPrivateState>,
  PrfAddrArgs
>({
  contractFactory: (witnesses) =>
    new MockPrfAddr<PrfAddrPrivateState>(witnesses),
  defaultPrivateState: () => PrfAddrPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => PrfAddrWitnesses(),
  artifactName: 'MockPrfAddr',
});

/**
 * PrfAddr Simulator
 *
 * Each method is a thin pass-through to the mock's matching circuit.
 * `refDerivePk` hashes a flat `{ domain, salt, sk }` without going through
 * `PrfAddr`.
 */
export class PrfAddrSimulator extends PrfAddrSimulatorBase {
  static async create(
    options: SimulatorOptions<
      PrfAddrPrivateState,
      ReturnType<typeof PrfAddrWitnesses>
    > = {},
  ): Promise<PrfAddrSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<PrfAddrSimulator>;
  }

  /** @description `PrfAddr.derivePk`. */
  public derivePk(
    domain: Uint8Array,
    salt: Uint8Array,
    sk: Uint8Array,
  ): Promise<bigint> {
    return this.circuits.impure.derivePk(domain, salt, sk);
  }

  /** @description Reference for {@link derivePk}. */
  public refDerivePk(
    domain: Uint8Array,
    salt: Uint8Array,
    sk: Uint8Array,
  ): Promise<bigint> {
    return this.circuits.impure.refDerivePk(domain, salt, sk);
  }
}
