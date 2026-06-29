import type { JubjubPoint } from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
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
  artifactName: 'MockElGamal',
});

/**
 * ElGamal Simulator
 *
 * Every ElGamal circuit is pure (no ledger, no witnesses), so each method is a
 * thin pass-through to the compiled pure circuit.
 */
export class ElGamalSimulator extends ElGamalSimulatorBase {
  static async create(
    options: SimulatorOptions<
      ElGamalPrivateState,
      ReturnType<typeof ElGamalWitnesses>
    > = {},
  ): Promise<ElGamalSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<ElGamalSimulator>;
  }

  /**
   * @description Maps a 32-byte secret to a valid Jubjub scalar.
   */
  public secretToScalar(secret: Uint8Array): Promise<bigint> {
    return this.circuits.pure.secretToScalar(secret);
  }

  /**
   * @description Derives the ElGamal public key `pk = g^secretToScalar(ek)`.
   */
  public derivePk(ek: Uint8Array): Promise<JubjubPoint> {
    return this.circuits.pure.derivePk(ek);
  }

  /**
   * @description Deterministically expands `seed` into a Jubjub scalar tagged
   * by `tag`.
   */
  public expandRandomness(seed: Uint8Array, tag: Uint8Array): Promise<bigint> {
    return this.circuits.pure.expandRandomness(seed, tag);
  }

  /**
   * @description The identity ciphertext `Enc(0)`.
   */
  public encryptZero(): Promise<Ciphertext> {
    return this.circuits.pure.encryptZero();
  }

  /**
   * @description Encrypts an arbitrary message point `m` under `pk` with
   * randomness `r`: `(g^r, pk^r * m)`.
   */
  public encryptPoint(
    pk: JubjubPoint,
    m: JubjubPoint,
    r: bigint,
  ): Promise<Ciphertext> {
    return this.circuits.pure.encryptPoint(pk, m, r);
  }

  /**
   * @description Encrypts `value` under `pk` with randomness `r`.
   */
  public encrypt(
    pk: JubjubPoint,
    value: bigint,
    r: bigint,
  ): Promise<Ciphertext> {
    return this.circuits.pure.encrypt(pk, value, r);
  }

  /**
   * @description Negates a ciphertext componentwise (encrypts `-v`).
   */
  public negate(ct: Ciphertext): Promise<Ciphertext> {
    return this.circuits.pure.negate(ct);
  }

  /**
   * @description Homomorphically adds two ciphertexts: `Enc(a) + Enc(b)`.
   */
  public add(a: Ciphertext, b: Ciphertext): Promise<Ciphertext> {
    return this.circuits.pure.add(a, b);
  }

  /**
   * @description Homomorphically subtracts two ciphertexts: `Enc(a) - Enc(b)`.
   */
  public sub(a: Ciphertext, b: Ciphertext): Promise<Ciphertext> {
    return this.circuits.pure.sub(a, b);
  }

  /**
   * @description Homomorphically scales the plaintext of `ct` by public scalar
   * `k`: `Enc(v)` becomes `Enc(k * v)`.
   */
  public scalarMul(ct: Ciphertext, k: bigint): Promise<Ciphertext> {
    return this.circuits.pure.scalarMul(ct, k);
  }

  /**
   * @description Homomorphically adds `value` to the plaintext of `old`.
   */
  public addEncrypted(
    old: Ciphertext,
    pk: JubjubPoint,
    value: bigint,
    r: bigint,
  ): Promise<Ciphertext> {
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
  ): Promise<Ciphertext> {
    return this.circuits.pure.subEncrypted(old, pk, value, r);
  }

  /**
   * @description Rerandomizes `ct` under `pk` with fresh randomness `r`,
   * preserving the plaintext.
   */
  public rerandomize(
    ct: Ciphertext,
    pk: JubjubPoint,
    r: bigint,
  ): Promise<Ciphertext> {
    return this.circuits.pure.rerandomize(ct, pk, r);
  }

  /**
   * @description Asserts `ek` is the secret for `pk`. Throws on mismatch.
   */
  public assertKeyPair(pk: JubjubPoint, ek: Uint8Array): Promise<[]> {
    return this.circuits.pure.assertKeyPair(pk, ek);
  }

  /**
   * @description Asserts `ct` decrypts under `(pk, ek)` to the message point
   * `m` and that `ek` is the secret for `pk`. Throws if either check fails.
   */
  public assertDecryptsToPoint(
    ct: Ciphertext,
    pk: JubjubPoint,
    ek: Uint8Array,
    m: JubjubPoint,
  ): Promise<[]> {
    return this.circuits.pure.assertDecryptsToPoint(ct, pk, ek, m);
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
  ): Promise<[]> {
    return this.circuits.pure.assertDecryptsTo(ct, pk, ek, claimedValue);
  }
}
