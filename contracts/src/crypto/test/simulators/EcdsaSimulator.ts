import type { Secp256k1Point } from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import type { EcdsaSignature } from '#test-utils/fixtures/ecdsa.js';
import {
  ledger,
  Contract as MockEcdsa,
  pureCircuits,
} from '../../../../artifacts/MockEcdsa/contract/index.js';

// The Ecdsa module is stateless and declares no witnesses, so the private
// state and witness set are both empty.
export type EcdsaPrivateState = Record<string, never>;
export const EcdsaPrivateState: EcdsaPrivateState = {};
export const EcdsaWitnesses = () => ({});

/**
 * Type constructor args
 */
type EcdsaArgs = readonly [];

const EcdsaSimulatorBase = createSimulator<
  EcdsaPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof EcdsaWitnesses>,
  MockEcdsa<EcdsaPrivateState>,
  EcdsaArgs
>({
  contractFactory: (witnesses) => new MockEcdsa<EcdsaPrivateState>(witnesses),
  defaultPrivateState: () => EcdsaPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => EcdsaWitnesses(),
  artifactName: 'MockEcdsa',
});

/**
 * Ecdsa Simulator
 */
export class EcdsaSimulator extends EcdsaSimulatorBase {
  static async create(
    options: SimulatorOptions<
      EcdsaPrivateState,
      ReturnType<typeof EcdsaWitnesses>
    > = {},
  ): Promise<EcdsaSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<EcdsaSimulator>;
  }

  /**
   * @description Whether `s <= n/2`, the canonical half of the scalar range.
   * Pure, so callers can classify a signature without a deploy.
   */
  public static isLowS(s: bigint): boolean {
    return pureCircuits.isLowS(s);
  }

  /**
   * @description Asserts `sig` is in canonical low-s form. Throws otherwise.
   */
  public assertLowS(sig: EcdsaSignature): Promise<[]> {
    return this.circuits.impure.assertLowS(sig);
  }

  /**
   * @description Verifies `sig` over `msgHash` under `pk` and rejects the
   * high-s encoding. Returns false rather than throwing.
   */
  public secp256k1EcdsaVerifyLowS(
    msgHash: Uint8Array,
    sig: EcdsaSignature,
    pk: Secp256k1Point,
  ): Promise<boolean> {
    return this.circuits.impure.secp256k1EcdsaVerifyLowS(msgHash, sig, pk);
  }
}
