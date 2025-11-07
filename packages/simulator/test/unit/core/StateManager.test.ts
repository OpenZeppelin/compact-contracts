import {
  type CircuitContext,
  ContractState,
  dummyContractAddress,
  type EncodedQualifiedCoinInfo,
  type EncodedZswapLocalState,
  encodeQualifiedCoinInfo,
  type QualifiedCoinInfo,
  QueryContext,
  StateValue,
  sampleTokenType,
} from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import { CircuitContextManager } from '../../../src/core/CircuitContextManager';
import {
  type SimplePrivateState,
  SimpleWitnesses,
} from '../../fixtures/sample-contracts/witnesses/SimpleWitnesses';
import { Contract as MockSimple } from '../../fixtures/test-artifacts/Simple/contract/index.cjs';
import { encodeToAddress, toHexPadded } from '../../fixtures/utils/address';

// Constants
const DEPLOYER = 'DEPLOYER';
const deployer = toHexPadded(DEPLOYER);

// Mut vars
let mockContract: MockSimple<SimplePrivateState>;
let initialPrivateState: SimplePrivateState;
let circuitCtxManager: CircuitContextManager<SimplePrivateState>;
let ctx: CircuitContext<SimplePrivateState>;

describe('CircuitContextManager', () => {
  /**
   * Parametrize me!
   */
  describe('constructor', () => {
    beforeEach(() => {
      mockContract = new MockSimple<SimplePrivateState>(SimpleWitnesses());
      initialPrivateState = {};

      circuitCtxManager = new CircuitContextManager(
        mockContract,
        initialPrivateState,
        deployer,
        dummyContractAddress(),
      );

      ctx = circuitCtxManager.getContext();
    });

    it('should set private state', () => {
      expect(ctx.currentPrivateState).toEqual(initialPrivateState);
    });

    it('should set zswap local state', () => {
      const expectedZswapState: EncodedZswapLocalState = {
        coinPublicKey: {
          bytes: Uint8Array.from(Buffer.from(toHexPadded(DEPLOYER), 'hex')),
        },
        currentIndex: 0n,
        inputs: [],
        outputs: [],
      };
      expect(ctx.currentZswapLocalState).toEqual(expectedZswapState);
    });

    it('should set original state', () => {
      expect(ctx.originalState).toBeInstanceOf(ContractState);
      expect(ctx.originalState).toHaveProperty('__wbg_ptr');
      expect((ctx.originalState as any).__wbg_ptr).toBeTypeOf('number');
    });

    it('should set tx ctx', () => {
      // Need to go deeper
      expect(ctx.transactionContext).toBeInstanceOf(QueryContext);
      expect(ctx.transactionContext.address).toEqual(dummyContractAddress());
      expect(ctx.transactionContext.state).toBeInstanceOf(StateValue);
      expect(ctx.transactionContext.state).toHaveProperty('__wbg_ptr');
    });
  });

  describe('setContext', () => {
    beforeEach(() => {
      mockContract = new MockSimple<SimplePrivateState>(SimpleWitnesses());
      initialPrivateState = {};

      circuitCtxManager = new CircuitContextManager(
        mockContract,
        initialPrivateState,
        deployer,
        dummyContractAddress(),
      );

      ctx = circuitCtxManager.getContext();
    });

    /**
     * Improve me
     */
    it('should set new ctx', () => {
      const oldCtx = circuitCtxManager.getContext();

      const qualCoin: QualifiedCoinInfo = {
        type: sampleTokenType(),
        nonce: toHexPadded('nonce'),
        value: 123n,
        mt_index: 987n,
      };
      const encQualCoin: EncodedQualifiedCoinInfo =
        encodeQualifiedCoinInfo(qualCoin);

      // zswap local state
      const zswapLocalState_1: EncodedZswapLocalState = {
        coinPublicKey: {
          bytes: Uint8Array.from(Buffer.from(toHexPadded('goldenFace'), 'hex')),
        },
        currentIndex: 555n,
        inputs: [encQualCoin],
        outputs: [],
      };

      // OG state
      const NEW_OG_STATE: ContractState = new ContractState();

      // Query ctx
      const modifiedTxCtx: QueryContext = {
        ...ctx.transactionContext,
        address: encodeToAddress('otherAddress'),
      } as unknown as QueryContext;

      // Build new ctx
      const newCtx: CircuitContext<SimplePrivateState> = {
        originalState: NEW_OG_STATE,
        currentPrivateState: initialPrivateState,
        currentZswapLocalState: zswapLocalState_1,
        transactionContext: modifiedTxCtx,
      };

      circuitCtxManager.setContext(newCtx);
      expect(circuitCtxManager.getContext()).toEqual(newCtx);
      expect(circuitCtxManager.getContext()).not.toEqual(oldCtx);
    });
  });
});
