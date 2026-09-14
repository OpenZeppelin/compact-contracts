import type { JubjubPoint } from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type EcdhMask_Ciphertext as Ciphertext,
  ledger,
  Contract as MockEcdhMask,
} from '../../../../artifacts/MockEcdhMask/contract/index.js';

export type { Ciphertext };

// The EcdhMask module is stateless and declares no witnesses, so the private
// state and witness set are both empty.
export type EcdhMaskPrivateState = Record<string, never>;
export const EcdhMaskPrivateState: EcdhMaskPrivateState = {};
export const EcdhMaskWitnesses = () => ({});

/**
 * Type constructor args
 */
type EcdhMaskArgs = readonly [];

const EcdhMaskSimulatorBase = createSimulator<
  EcdhMaskPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof EcdhMaskWitnesses>,
  MockEcdhMask<EcdhMaskPrivateState>,
  EcdhMaskArgs
>({
  contractFactory: (witnesses) =>
    new MockEcdhMask<EcdhMaskPrivateState>(witnesses),
  defaultPrivateState: () => EcdhMaskPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => EcdhMaskWitnesses(),
  artifactName: 'MockEcdhMask',
});

/**
 * EcdhMask Simulator
 *
 * Each method is a thin pass-through to the mock's matching circuit.
 */
export class EcdhMaskSimulator extends EcdhMaskSimulatorBase {
  static async create(
    options: SimulatorOptions<
      EcdhMaskPrivateState,
      ReturnType<typeof EcdhMaskWitnesses>
    > = {},
  ): Promise<EcdhMaskSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<EcdhMaskSimulator>;
  }

  /**
   * @description Derives the masking field element from the ECDH shared point
   * and a domain-separation tag.
   */
  public kdf(sShared: JubjubPoint, domain: Uint8Array): Promise<bigint> {
    return this.circuits.impure.kdf(sShared, domain);
  }

  /**
   * @description Masks `value` for `recipientPk` under ephemeral scalar `e`.
   * `e` must be fresh per ciphertext.
   */
  public encrypt(
    recipientPk: JubjubPoint,
    value: bigint,
    e: bigint,
    domain: Uint8Array,
  ): Promise<Ciphertext> {
    return this.circuits.impure.encrypt(recipientPk, value, e, domain);
  }

  /**
   * @description Recovers the masked value using the recipient's secret scalar.
   * `domain` must match the one used to encrypt.
   */
  public decrypt(
    ciphertext: Ciphertext,
    ekScalar: bigint,
    domain: Uint8Array,
  ): Promise<bigint> {
    return this.circuits.impure.decrypt(ciphertext, ekScalar, domain);
  }
}
