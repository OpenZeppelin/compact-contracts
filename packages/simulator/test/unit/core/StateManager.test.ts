import {
  ChargedState,
  type CircuitContext,
  dummyContractAddress,
  type EncodedQualifiedShieldedCoinInfo,
  type EncodedZswapLocalState,
  encodeQualifiedShieldedCoinInfo,
  type QualifiedShieldedCoinInfo,
  QueryContext,
  sampleRawTokenType,
} from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import { CircuitContextManager } from '../../../src/core/CircuitContextManager';
import { Contract as MockSimple } from '../../fixtures/artifacts/Simple/contract/index.js';
import {
  type SimplePrivateState,
  SimpleWitnesses,
} from '../../fixtures/sample-contracts/witnesses/SimpleWitnesses';
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
      expect(ctx.currentQueryContext).toBeInstanceOf(QueryContext);
      expect(ctx.currentQueryContext).toHaveProperty('__wbg_ptr');
      expect((ctx.currentQueryContext as any).__wbg_ptr).toBeTypeOf('number');
    });

    it('should set tx ctx', () => {
      // Need to go deeper
      expect(ctx.currentQueryContext).toBeInstanceOf(QueryContext);
      expect(ctx.currentQueryContext.address).toEqual(dummyContractAddress());
      expect(ctx.currentQueryContext.state).toBeInstanceOf(ChargedState);
      expect(ctx.currentQueryContext.state).toHaveProperty('__wbg_ptr');
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

      const qualCoin: QualifiedShieldedCoinInfo = {
        type: sampleRawTokenType(),
        nonce: toHexPadded('nonce'),
        value: 123n,
        mt_index: 987n,
      };
      const encQualCoin: EncodedQualifiedShieldedCoinInfo =
        encodeQualifiedShieldedCoinInfo(qualCoin);

      // zswap local state
      const zswapLocalState_1: EncodedZswapLocalState = {
        coinPublicKey: {
          bytes: Uint8Array.from(Buffer.from(toHexPadded('goldenFace'), 'hex')),
        },
        currentIndex: 555n,
        inputs: [encQualCoin],
        outputs: [],
      };

      // Query ctx
      const modifiedTxCtx: QueryContext = {
        ...ctx.currentQueryContext,
        address: encodeToAddress('otherAddress'),
      } as unknown as QueryContext;

      // Build new ctx
      const newCtx: CircuitContext<SimplePrivateState> = {
        currentQueryContext: modifiedTxCtx,
        currentPrivateState: initialPrivateState,
        currentZswapLocalState: zswapLocalState_1,
        costModel: ctx.costModel,
      };

      circuitCtxManager.setContext(newCtx);
      expect(circuitCtxManager.getContext()).toEqual(newCtx);
      expect(circuitCtxManager.getContext()).not.toEqual(oldCtx);
    });
  });
});
