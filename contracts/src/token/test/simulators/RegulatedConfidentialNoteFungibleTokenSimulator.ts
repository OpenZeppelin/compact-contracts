import type { JubjubPoint } from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as RegulatedToken,
} from '../../../../artifacts/MockRegulatedConfidentialNoteFungibleToken/contract/index.js';
import {
  type Note,
  RegulatedConfidentialNoteFungibleTokenPrivateState as PrivateState,
  type RegulatedConfidentialNoteFungibleTokenPrivateState,
  RegulatedConfidentialNoteFungibleTokenWitnesses,
} from '../witnesses/RegulatedConfidentialNoteFungibleTokenWitnesses.js';

type RegulatedConfidentialNoteFungibleTokenArgs = readonly [
  issuerPk: bigint,
  authorityPk: bigint,
  auditKey: JubjubPoint,
  supplyKey: JubjubPoint,
];

const RegulatedConfidentialNoteFungibleTokenSimulatorBase = createSimulator<
  RegulatedConfidentialNoteFungibleTokenPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof RegulatedConfidentialNoteFungibleTokenWitnesses>,
  RegulatedToken<RegulatedConfidentialNoteFungibleTokenPrivateState>,
  RegulatedConfidentialNoteFungibleTokenArgs
>({
  contractFactory: (witnesses) =>
    new RegulatedToken<RegulatedConfidentialNoteFungibleTokenPrivateState>(
      witnesses,
    ),
  defaultPrivateState: () => PrivateState.generate(),
  contractArgs: (issuerPk, authorityPk, auditKey, supplyKey) => [
    issuerPk,
    authorityPk,
    auditKey,
    supplyKey,
  ],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => RegulatedConfidentialNoteFungibleTokenWitnesses(),
  artifactName: 'MockRegulatedConfidentialNoteFungibleToken',
});

export class RegulatedConfidentialNoteFungibleTokenSimulator extends RegulatedConfidentialNoteFungibleTokenSimulatorBase {
  static async create(
    issuerPk: bigint,
    authorityPk: bigint,
    auditKey: JubjubPoint,
    supplyKey: JubjubPoint,
    options: SimulatorOptions<
      RegulatedConfidentialNoteFungibleTokenPrivateState,
      ReturnType<typeof RegulatedConfidentialNoteFungibleTokenWitnesses>
    > = {},
  ): Promise<RegulatedConfidentialNoteFungibleTokenSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create keeps subclass `this`
    return super.create(
      [issuerPk, authorityPk, auditKey, supplyKey],
      options,
    ) as Promise<RegulatedConfidentialNoteFungibleTokenSimulator>;
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

  public rotateIssuer(newIssuerPk: bigint): Promise<[]> {
    return this.circuits.impure.rotateIssuer(newIssuerPk);
  }

  public rotateAuthority(newAuthorityPk: bigint): Promise<[]> {
    return this.circuits.impure.rotateAuthority(newAuthorityPk);
  }

  public rotateAuditKey(newKey: JubjubPoint): Promise<[]> {
    return this.circuits.impure.rotateAuditKey(newKey);
  }

  public rotateSupplyKey(newKey: JubjubPoint, total: bigint): Promise<[]> {
    return this.circuits.impure.rotateSupplyKey(newKey, total);
  }

  public readonly privateState = {
    // Configure the caller's identity and the note being spent next.
    set: async (
      partial: Partial<RegulatedConfidentialNoteFungibleTokenPrivateState>,
    ): Promise<RegulatedConfidentialNoteFungibleTokenPrivateState> => {
      const updated = { ...(await this.getPrivateState()), ...partial };
      this.setPrivateState(updated);
      return updated;
    },
  };

  public setInputNote(note: Note) {
    return this.privateState.set({ inputNote: note });
  }
}
