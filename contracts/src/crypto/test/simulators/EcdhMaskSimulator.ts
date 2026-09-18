// SPDX-License-Identifier: MIT
// OpenZeppelin Compact Contracts v0.4.0-alpha.1 (crypto/test/simulators/EcdhMaskSimulator.ts)

import type { JubjubPoint } from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type EcdhMask_Ciphertext as Ciphertext,
  ledger,
  Contract as MockEcdhMask,
  type Ecdh_SharedSecret as SharedSecret,
} from '../../../../artifacts/MockEcdhMask/contract/index.js';

export type { Ciphertext, SharedSecret };

type EmptyPrivateState = Record<string, never>;
const EmptyPrivateState: EmptyPrivateState = {};
const emptyWitnesses = () => ({});

const EcdhMaskSimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  MockEcdhMask<EmptyPrivateState>,
  readonly []
>({
  contractFactory: (witnesses) =>
    new MockEcdhMask<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
  artifactName: 'MockEcdhMask',
});

export class EcdhMaskSimulator extends EcdhMaskSimulatorBase {
  static async create(
    options: SimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ): Promise<EcdhMaskSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<EcdhMaskSimulator>;
  }

  public kdf(sShared: JubjubPoint, domain: Uint8Array): Promise<bigint> {
    return this.circuits.impure.kdf(sShared, domain);
  }

  public encrypt(
    recipientPk: JubjubPoint,
    value: bigint,
    e: bigint,
    domain: Uint8Array,
  ): Promise<Ciphertext> {
    return this.circuits.impure.encrypt(recipientPk, value, e, domain);
  }

  public decrypt(
    ciphertext: Ciphertext,
    ekScalar: bigint,
    domain: Uint8Array,
  ): Promise<bigint> {
    return this.circuits.impure.decrypt(ciphertext, ekScalar, domain);
  }

  public fieldKdf(sShared: JubjubPoint, domain: Uint8Array): Promise<bigint> {
    return this.circuits.impure.fieldKdf(sShared, domain);
  }

  public encryptField(
    recipientPk: JubjubPoint,
    m: bigint,
    e: bigint,
    domain: Uint8Array,
  ): Promise<Ciphertext> {
    return this.circuits.impure.encryptField(recipientPk, m, e, domain);
  }

  public decryptField(
    ciphertext: Ciphertext,
    ekScalar: bigint,
    domain: Uint8Array,
  ): Promise<bigint> {
    return this.circuits.impure.decryptField(ciphertext, ekScalar, domain);
  }

  public deriveShared(
    recipientPk: JubjubPoint,
    e: bigint,
  ): Promise<SharedSecret> {
    return this.circuits.impure.deriveShared(recipientPk, e);
  }

  public recoverShared(
    ephemeralPk: JubjubPoint,
    ekScalar: bigint,
  ): Promise<JubjubPoint> {
    return this.circuits.impure.recoverShared(ephemeralPk, ekScalar);
  }
}
