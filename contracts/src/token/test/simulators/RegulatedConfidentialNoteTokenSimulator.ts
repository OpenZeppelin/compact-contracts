import type { JubjubPoint } from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as RegulatedCNT,
} from '../../../../artifacts/RegulatedConfidentialNoteToken/contract/index.js';
import {
  type Note,
  RegulatedConfidentialNoteTokenPrivateState as PrivateState,
  type RegulatedConfidentialNoteTokenPrivateState,
  RegulatedConfidentialNoteTokenWitnesses,
} from '../witnesses/RegulatedConfidentialNoteTokenWitnesses.js';

type RegulatedConfidentialNoteTokenArgs = readonly [
  issuerPk: bigint,
  authorityPk: bigint,
  auditKey: JubjubPoint,
  supplyKey: JubjubPoint,
];

const RegulatedConfidentialNoteTokenSimulatorBase = createSimulator<
  RegulatedConfidentialNoteTokenPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof RegulatedConfidentialNoteTokenWitnesses>,
  RegulatedCNT<RegulatedConfidentialNoteTokenPrivateState>,
  RegulatedConfidentialNoteTokenArgs
>({
  contractFactory: (witnesses) =>
    new RegulatedCNT<RegulatedConfidentialNoteTokenPrivateState>(witnesses),
  defaultPrivateState: () => PrivateState.generate(),
  contractArgs: (issuerPk, authorityPk, auditKey, supplyKey) => [
    issuerPk,
    authorityPk,
    auditKey,
    supplyKey,
  ],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => RegulatedConfidentialNoteTokenWitnesses(),
  artifactName: 'RegulatedConfidentialNoteToken',
});

export class RegulatedConfidentialNoteTokenSimulator extends RegulatedConfidentialNoteTokenSimulatorBase {
  static async create(
    issuerPk: bigint,
    authorityPk: bigint,
    auditKey: JubjubPoint,
    supplyKey: JubjubPoint,
    options: SimulatorOptions<
      RegulatedConfidentialNoteTokenPrivateState,
      ReturnType<typeof RegulatedConfidentialNoteTokenWitnesses>
    > = {},
  ): Promise<RegulatedConfidentialNoteTokenSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create keeps subclass `this`
    return super.create(
      [issuerPk, authorityPk, auditKey, supplyKey],
      options,
    ) as Promise<RegulatedConfidentialNoteTokenSimulator>;
  }

  public mint(
    recipientPk: bigint,
    recipientEncPk: JubjubPoint,
    value: bigint,
  ): Promise<[]> {
    return this.circuits.impure.mint(recipientPk, recipientEncPk, value);
  }

  public transfer(
    recipientPk: bigint,
    recipientEncPk: JubjubPoint,
    senderEncPk: JubjubPoint,
    value: bigint,
  ): Promise<[]> {
    return this.circuits.impure.transfer(
      recipientPk,
      recipientEncPk,
      senderEncPk,
      value,
    );
  }

  public burn(senderEncPk: JubjubPoint, value: bigint): Promise<[]> {
    return this.circuits.impure.burn(senderEncPk, value);
  }

  public seize(
    targetOwnerPk: bigint,
    recoveryPk: bigint,
    recoveryEncPk: JubjubPoint,
  ): Promise<[]> {
    return this.circuits.impure.seize(targetOwnerPk, recoveryPk, recoveryEncPk);
  }

  public attestSupply(total: bigint): Promise<[]> {
    return this.circuits.impure.attestSupply(total);
  }

  public readonly privateState = {
    // Configure the caller's identity and the note being spent next.
    set: async (
      partial: Partial<RegulatedConfidentialNoteTokenPrivateState>,
    ): Promise<RegulatedConfidentialNoteTokenPrivateState> => {
      const updated = { ...(await this.getPrivateState()), ...partial };
      this.setPrivateState(updated);
      return updated;
    },
  };

  public setInputNote(note: Note) {
    return this.privateState.set({ inputNote: note });
  }
}
