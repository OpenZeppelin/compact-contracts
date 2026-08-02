import type { JubjubPoint } from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockAudit,
} from '../../../../artifacts/MockConfidentialNoteFungibleTokenAudit/contract/index.js';
import {
  type ConfidentialNoteFungibleTokenAuditPrivateState,
  ConfidentialNoteFungibleTokenAuditWitnesses,
  ConfidentialNoteFungibleTokenAuditPrivateState as PrivateState,
} from '../witnesses/ConfidentialNoteFungibleTokenAuditWitnesses.js';

const ConfidentialNoteFungibleTokenAuditSimulatorBase = createSimulator<
  ConfidentialNoteFungibleTokenAuditPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ConfidentialNoteFungibleTokenAuditWitnesses>,
  MockAudit<ConfidentialNoteFungibleTokenAuditPrivateState>,
  readonly []
>({
  contractFactory: (witnesses) =>
    new MockAudit<ConfidentialNoteFungibleTokenAuditPrivateState>(witnesses),
  defaultPrivateState: () => PrivateState.generate(),
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ConfidentialNoteFungibleTokenAuditWitnesses(),
  artifactName: 'MockConfidentialNoteFungibleTokenAudit',
});

export class ConfidentialNoteFungibleTokenAuditSimulator extends ConfidentialNoteFungibleTokenAuditSimulatorBase {
  static async create(
    options: SimulatorOptions<
      ConfidentialNoteFungibleTokenAuditPrivateState,
      ReturnType<typeof ConfidentialNoteFungibleTokenAuditWitnesses>
    > = {},
  ): Promise<ConfidentialNoteFungibleTokenAuditSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create keeps subclass `this`
    return super.create(
      [],
      options,
    ) as Promise<ConfidentialNoteFungibleTokenAuditSimulator>;
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

  public rotateAuditKey(newKey: JubjubPoint): Promise<[]> {
    return this.circuits.impure._rotateAuditKey(newKey);
  }

  public readonly privateState = {
    set: async (
      partial: Partial<ConfidentialNoteFungibleTokenAuditPrivateState>,
    ): Promise<ConfidentialNoteFungibleTokenAuditPrivateState> => {
      const updated = { ...(await this.getPrivateState()), ...partial };
      this.setPrivateState(updated);
      return updated;
    },
  };
}
