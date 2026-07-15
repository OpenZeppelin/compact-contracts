import type { JubjubPoint } from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockAudit,
} from '../../../../artifacts/MockConfidentialNoteTokenAudit/contract/index.js';
import {
  type ConfidentialNoteTokenAuditPrivateState,
  ConfidentialNoteTokenAuditWitnesses,
  ConfidentialNoteTokenAuditPrivateState as PrivateState,
} from '../witnesses/ConfidentialNoteTokenAuditWitnesses.js';

const ConfidentialNoteTokenAuditSimulatorBase = createSimulator<
  ConfidentialNoteTokenAuditPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ConfidentialNoteTokenAuditWitnesses>,
  MockAudit<ConfidentialNoteTokenAuditPrivateState>,
  readonly []
>({
  contractFactory: (witnesses) =>
    new MockAudit<ConfidentialNoteTokenAuditPrivateState>(witnesses),
  defaultPrivateState: () => PrivateState.generate(),
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ConfidentialNoteTokenAuditWitnesses(),
  artifactName: 'MockConfidentialNoteTokenAudit',
});

export class ConfidentialNoteTokenAuditSimulator extends ConfidentialNoteTokenAuditSimulatorBase {
  static async create(
    options: SimulatorOptions<
      ConfidentialNoteTokenAuditPrivateState,
      ReturnType<typeof ConfidentialNoteTokenAuditWitnesses>
    > = {},
  ): Promise<ConfidentialNoteTokenAuditSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create keeps subclass `this`
    return super.create(
      [],
      options,
    ) as Promise<ConfidentialNoteTokenAuditSimulator>;
  }

  public initialize(auditKey: JubjubPoint): Promise<[]> {
    return this.circuits.impure.initialize(auditKey);
  }

  public emitAuditedOutput(
    ownerPk: bigint,
    value: bigint,
    slot: Uint8Array,
  ): Promise<bigint> {
    return this.circuits.impure._emitAuditedOutput(ownerPk, value, slot);
  }

  public readonly privateState = {
    set: async (
      partial: Partial<ConfidentialNoteTokenAuditPrivateState>,
    ): Promise<ConfidentialNoteTokenAuditPrivateState> => {
      const updated = { ...(await this.getPrivateState()), ...partial };
      this.setPrivateState(updated);
      return updated;
    },
  };
}
