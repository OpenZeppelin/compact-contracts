import { beforeEach, describe, expect, it } from 'vitest';
import type {
  IWitnessWitnesses,
  WitnessPrivateState,
} from '../fixtures/sampleContracts/witnesses/WitnessWitnesses';
import { WitnessSimulator } from './WitnessSimulator';

const VAL1 = 3n;
const VAL2 = 7n;
const BYTES_OVERRIDE = new Uint8Array(32).fill(1);
const FIELD_OVERRIDE = 222n;
const UINT_OVERRIDE = 333n;

const overrideWitnesses = (): IWitnessWitnesses<WitnessPrivateState> => ({
  wit_secretBytes(ctx) {
    return [ctx.privateState, BYTES_OVERRIDE];
  },
  wit_secretFieldPlusArg(ctx) {
    return [ctx.privateState, FIELD_OVERRIDE];
  },
  wit_secretUintPlusArgs(ctx) {
    return [ctx.privateState, UINT_OVERRIDE];
  },
});

let contract: WitnessSimulator;

describe('witness/private state overrides', () => {
  beforeEach(() => {
    contract = new WitnessSimulator();
  });

  describe('witness overrides', () => {
    it('should have default public state values', () => {
      expect(contract.getPublicState()._valBytes).toEqual(
        new Uint8Array(32).fill(0),
      );
      expect(contract.getPublicState()._valField).toEqual(0n);
      expect(contract.getPublicState()._valUint).toEqual(0n);
    });

    it('should set values according to witness logic', () => {
      // Private state
      const psBytes = contract.getPrivateState().secretBytes;
      const psField = contract.getPrivateState().secretField;
      const psUint = contract.getPrivateState().secretUint;

      // Set values
      contract.setBytes();
      contract.setField(VAL1);
      contract.setUint(VAL1, VAL2);

      // Check values
      expect(contract.getPublicState()._valBytes).toEqual(
        new Uint8Array(psBytes),
      );
      expect(contract.getPublicState()._valField).toEqual(psField + VAL1);
      expect(contract.getPublicState()._valUint).toEqual(psUint + VAL1 + VAL2);
    });

    it('should override all witnesses', () => {
      // Private state
      const psBytes = contract.getPrivateState().secretBytes;
      const psField = contract.getPrivateState().secretField;
      const psUint = contract.getPrivateState().secretUint;

      // Override entire object
      contract.witnesses = overrideWitnesses();

      // Set values
      contract.setBytes();
      contract.setField(VAL1);
      contract.setUint(VAL1, VAL2);

      // Check bytes
      expect(contract.getPublicState()._valBytes).toEqual(BYTES_OVERRIDE);
      expect(contract.getPublicState()._valBytes).not.toEqual(
        new Uint8Array(psBytes),
      );

      // Check field
      expect(contract.getPublicState()._valField).toEqual(FIELD_OVERRIDE);
      expect(contract.getPublicState()._valField).not.toEqual(psField + VAL1);

      // Check uint
      expect(contract.getPublicState()._valUint).toEqual(UINT_OVERRIDE);
      expect(contract.getPublicState()._valUint).not.toEqual(
        psUint + VAL1 + VAL2,
      );
    });

    describe('when overriding individual witnesses', () => {
      it('should override wit_secretBytes', () => {
        // Private state
        const psBytes = contract.getPrivateState().secretBytes;
        const psField = contract.getPrivateState().secretField;
        const psUint = contract.getPrivateState().secretUint;

        contract.overrideWitness('wit_secretBytes', (ctx) => {
          return [ctx.privateState, BYTES_OVERRIDE];
        });

        // Set all values
        contract.setBytes();
        contract.setField(VAL1);
        contract.setUint(VAL1, VAL2);

        // Check bytes override
        expect(contract.getPublicState()._valBytes).toEqual(BYTES_OVERRIDE);
        expect(contract.getPublicState()._valBytes).not.toEqual(
          new Uint8Array(psBytes),
        );

        // Check other witnesses remain unchanged
        expect(contract.getPublicState()._valField).toEqual(psField + VAL1);
        expect(contract.getPublicState()._valUint).toEqual(
          psUint + VAL1 + VAL2,
        );
      });

      it('should override wit_secretFieldPlusArg', () => {
        // Private state
        const psBytes = contract.getPrivateState().secretBytes;
        const _psField = contract.getPrivateState().secretField;
        const psUint = contract.getPrivateState().secretUint;

        contract.overrideWitness('wit_secretFieldPlusArg', (ctx) => {
          return [ctx.privateState, FIELD_OVERRIDE];
        });

        // Set all values
        contract.setBytes();
        contract.setField(VAL1);
        contract.setUint(VAL1, VAL2);

        // Check field override
        expect(contract.getPublicState()._valField).toEqual(FIELD_OVERRIDE);
        expect(contract.getPublicState()._valField).not.toEqual(VAL1);

        // Check other witnesses remain unchanged
        expect(contract.getPublicState()._valBytes).toEqual(
          new Uint8Array(psBytes),
        );
        expect(contract.getPublicState()._valUint).toEqual(
          psUint + VAL1 + VAL2,
        );
      });

      it('should override wit_secretUintPlusArgs', () => {
        // Private state
        const psBytes = contract.getPrivateState().secretBytes;
        const psField = contract.getPrivateState().secretField;
        const psUint = contract.getPrivateState().secretUint;

        contract.overrideWitness('wit_secretUintPlusArgs', (ctx) => {
          return [ctx.privateState, UINT_OVERRIDE];
        });

        // Set all values
        contract.setBytes();
        contract.setField(VAL1);
        contract.setUint(VAL1, VAL2);

        // Check uint override
        expect(contract.getPublicState()._valUint).toEqual(UINT_OVERRIDE);
        expect(contract.getPublicState()._valUint).not.toEqual(
          psUint + VAL1 + VAL2,
        );

        // Check other witnesses remain unchanged
        expect(contract.getPublicState()._valBytes).toEqual(
          new Uint8Array(psBytes),
        );
        expect(contract.getPublicState()._valField).toEqual(psField + VAL1);
      });
    });
  });

  describe('private state overrides', () => {
    it('should match ps ', () => {
      // Private state
      const _psBytes = contract.getPrivateState().secretBytes;
      const _psField = contract.getPrivateState().secretField;
      const _psUint = contract.getPrivateState().secretUint;
    });

    it('should override the entire private state', () => {});
  });
});
