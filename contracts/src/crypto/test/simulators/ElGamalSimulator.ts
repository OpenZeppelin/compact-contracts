import type { JubjubPoint } from '@midnight-ntwrk/compact-runtime';
import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin/compact-simulator';
import {
  type ElGamal_Ciphertext as Ciphertext,
  ledger,
  Contract as MockElGamal,
} from '../../../../artifacts/MockElGamal/contract/index.js';
import {
  ElGamalPrivateState,
  ElGamalWitnesses,
} from '../witnesses/ElGamalWitnesses.js';

export type { Ciphertext };

/**
 * Type constructor args
 */
type ElGamalArgs = readonly [];

const ElGamalSimulatorBase = createSimulator<
  ElGamalPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ElGamalWitnesses>,
  MockElGamal<ElGamalPrivateState>,
  ElGamalArgs
>({
  contractFactory: (witnesses) =>
    new MockElGamal<ElGamalPrivateState>(witnesses),
  defaultPrivateState: () => ElGamalPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ElGamalWitnesses(),
});

/**
 * ElGamal Simulator
 *
 * Every ElGamal circuit is pure (no ledger, no witnesses), so each method is a
 * thin pass-through to the compiled pure circuit.
 */
export class ElGamalSimulator extends ElGamalSimulatorBase {
  constructor(
    options: BaseSimulatorOptions<
      ElGamalPrivateState,
      ReturnType<typeof ElGamalWitnesses>
    > = {},
  ) {
    super([], options);
  }

  /**
   * @description Maps a 32-byte secret to a valid Jubjub scalar.
   */
  public secretToScalar(secret: Uint8Array): bigint {
    return this.circuits.pure.secretToScalar(secret);
  }

  /**
   * @description Derives the ElGamal public key `pk = g^secretToScalar(ek)`.
   */
  public derivePk(ek: Uint8Array): JubjubPoint {
    return this.circuits.pure.derivePk(ek);
  }

  /**
   * @description Deterministically expands `seed` into a Jubjub scalar tagged
   * by `tag`.
   */
  public expandRandomness(seed: Uint8Array, tag: Uint8Array): bigint {
    return this.circuits.pure.expandRandomness(seed, tag);
  }

  /**
   * @description The identity ciphertext `Enc(0)`.
   */
  public encryptZero(): Ciphertext {
    return this.circuits.pure.encryptZero();
  }

  /**
   * @description Encrypts `value` under `pk` with randomness `r`.
   */
  public encrypt(pk: JubjubPoint, value: bigint, r: bigint): Ciphertext {
    return this.circuits.pure.encrypt(pk, value, r);
  }

  /**
   * @description Homomorphically adds `value` to the plaintext of `old`.
   */
  public addEncrypted(
    old: Ciphertext,
    pk: JubjubPoint,
    value: bigint,
    r: bigint,
  ): Ciphertext {
    return this.circuits.pure.addEncrypted(old, pk, value, r);
  }

  /**
   * @description Homomorphically subtracts `value` from the plaintext of `old`.
   */
  public subEncrypted(
    old: Ciphertext,
    pk: JubjubPoint,
    value: bigint,
    r: bigint,
  ): Ciphertext {
    return this.circuits.pure.subEncrypted(old, pk, value, r);
  }

  /**
   * @description Asserts `ct` decrypts under `(pk, ek)` to `claimedValue` and
   * that `ek` is the secret for `pk`. Throws if either check fails.
   */
  public assertDecryptsTo(
    ct: Ciphertext,
    pk: JubjubPoint,
    ek: Uint8Array,
    claimedValue: bigint,
  ): void {
    this.circuits.pure.assertDecryptsTo(ct, pk, ek, claimedValue);
  }
}
