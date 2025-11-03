'use strict';
const __compactRuntime = require('@midnight-ntwrk/compact-runtime');
const expectedRuntimeVersionString = '0.8.1';
const expectedRuntimeVersion = expectedRuntimeVersionString.split('-')[0].split('.').map(Number);
const actualRuntimeVersion = __compactRuntime.versionString.split('-')[0].split('.').map(Number);
if (expectedRuntimeVersion[0] != actualRuntimeVersion[0]
     || (actualRuntimeVersion[0] == 0 && expectedRuntimeVersion[1] != actualRuntimeVersion[1])
     || expectedRuntimeVersion[1] > actualRuntimeVersion[1]
     || (expectedRuntimeVersion[1] == actualRuntimeVersion[1] && expectedRuntimeVersion[2] > actualRuntimeVersion[2]))
   throw new __compactRuntime.CompactError(`Version mismatch: compiled code expects ${expectedRuntimeVersionString}, runtime is ${__compactRuntime.versionString}`);
{ const MAX_FIELD = 52435875175126190479447740508185965837690552500527637822603658699938581184512n;
  if (__compactRuntime.MAX_FIELD !== MAX_FIELD)
     throw new __compactRuntime.CompactError(`compiler thinks maximum field value is ${MAX_FIELD}; run time thinks it is ${__compactRuntime.MAX_FIELD}`)
}

const _descriptor_0 = new __compactRuntime.CompactTypeBoolean();

const _descriptor_1 = new __compactRuntime.CompactTypeBytes(32);

class _ZswapCoinPublicKey_0 {
  alignment() {
    return _descriptor_1.alignment();
  }
  fromValue(value_0) {
    return {
      bytes: _descriptor_1.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0.bytes);
  }
}

const _descriptor_2 = new _ZswapCoinPublicKey_0();

class _ContractAddress_0 {
  alignment() {
    return _descriptor_1.alignment();
  }
  fromValue(value_0) {
    return {
      bytes: _descriptor_1.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0.bytes);
  }
}

const _descriptor_3 = new _ContractAddress_0();

class _Either_0 {
  alignment() {
    return _descriptor_0.alignment().concat(_descriptor_2.alignment().concat(_descriptor_3.alignment()));
  }
  fromValue(value_0) {
    return {
      is_left: _descriptor_0.fromValue(value_0),
      left: _descriptor_2.fromValue(value_0),
      right: _descriptor_3.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_0.toValue(value_0.is_left).concat(_descriptor_2.toValue(value_0.left).concat(_descriptor_3.toValue(value_0.right)));
  }
}

const _descriptor_4 = new _Either_0();

const _descriptor_5 = new __compactRuntime.CompactTypeUnsignedInteger(65535n, 2);

const _descriptor_6 = new __compactRuntime.CompactTypeUnsignedInteger(18446744073709551615n, 8);

const _descriptor_7 = new __compactRuntime.CompactTypeVector(2, _descriptor_1);

const _descriptor_8 = new __compactRuntime.CompactTypeVector(4, _descriptor_1);

const _descriptor_9 = new __compactRuntime.CompactTypeUnsignedInteger(255n, 1);

const _descriptor_10 = new __compactRuntime.CompactTypeUnsignedInteger(340282366920938463463374607431768211455n, 16);

class Contract {
  witnesses;
  constructor(...args_0) {
    if (args_0.length !== 1) {
      throw new __compactRuntime.CompactError(`Contract constructor: expected 1 argument, received ${args_0.length}`);
    }
    const witnesses_0 = args_0[0];
    if (typeof(witnesses_0) !== 'object') {
      throw new __compactRuntime.CompactError('first (witnesses) argument to Contract constructor is not an object');
    }
    if (typeof(witnesses_0.secretNonce) !== 'function') {
      throw new __compactRuntime.CompactError('first (witnesses) argument to Contract constructor does not contain a function-valued field named secretNonce');
    }
    this.witnesses = witnesses_0;
    this.circuits = {
      owner: (...args_1) => {
        if (args_1.length !== 1) {
          throw new __compactRuntime.CompactError(`owner: expected 1 argument (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.originalState != undefined && contextOrig_0.transactionContext != undefined)) {
          __compactRuntime.type_error('owner',
                                      'argument 1 (as invoked from Typescript)',
                                      'SampleZOwnable.compact line 21 char 1',
                                      'CircuitContext',
                                      contextOrig_0)
        }
        const context = { ...contextOrig_0 };
        const partialProofData = {
          input: { value: [], alignment: [] },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = this._owner_0(context, partialProofData);
        partialProofData.output = { value: _descriptor_1.toValue(result_0), alignment: _descriptor_1.alignment() };
        return { result: result_0, context: context, proofData: partialProofData };
      },
      transferOwnership: (...args_1) => {
        if (args_1.length !== 2) {
          throw new __compactRuntime.CompactError(`transferOwnership: expected 2 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const newOwnerId_0 = args_1[1];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.originalState != undefined && contextOrig_0.transactionContext != undefined)) {
          __compactRuntime.type_error('transferOwnership',
                                      'argument 1 (as invoked from Typescript)',
                                      'SampleZOwnable.compact line 25 char 1',
                                      'CircuitContext',
                                      contextOrig_0)
        }
        if (!(newOwnerId_0.buffer instanceof ArrayBuffer && newOwnerId_0.BYTES_PER_ELEMENT === 1 && newOwnerId_0.length === 32)) {
          __compactRuntime.type_error('transferOwnership',
                                      'argument 1 (argument 2 as invoked from Typescript)',
                                      'SampleZOwnable.compact line 25 char 1',
                                      'Bytes<32>',
                                      newOwnerId_0)
        }
        const context = { ...contextOrig_0 };
        const partialProofData = {
          input: {
            value: _descriptor_1.toValue(newOwnerId_0),
            alignment: _descriptor_1.alignment()
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = this._transferOwnership_0(context,
                                                   partialProofData,
                                                   newOwnerId_0);
        partialProofData.output = { value: [], alignment: [] };
        return { result: result_0, context: context, proofData: partialProofData };
      },
      renounceOwnership: (...args_1) => {
        if (args_1.length !== 1) {
          throw new __compactRuntime.CompactError(`renounceOwnership: expected 1 argument (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.originalState != undefined && contextOrig_0.transactionContext != undefined)) {
          __compactRuntime.type_error('renounceOwnership',
                                      'argument 1 (as invoked from Typescript)',
                                      'SampleZOwnable.compact line 31 char 1',
                                      'CircuitContext',
                                      contextOrig_0)
        }
        const context = { ...contextOrig_0 };
        const partialProofData = {
          input: { value: [], alignment: [] },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = this._renounceOwnership_0(context, partialProofData);
        partialProofData.output = { value: [], alignment: [] };
        return { result: result_0, context: context, proofData: partialProofData };
      },
      assertOnlyOwner: (...args_1) => {
        if (args_1.length !== 1) {
          throw new __compactRuntime.CompactError(`assertOnlyOwner: expected 1 argument (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.originalState != undefined && contextOrig_0.transactionContext != undefined)) {
          __compactRuntime.type_error('assertOnlyOwner',
                                      'argument 1 (as invoked from Typescript)',
                                      'SampleZOwnable.compact line 36 char 1',
                                      'CircuitContext',
                                      contextOrig_0)
        }
        const context = { ...contextOrig_0 };
        const partialProofData = {
          input: { value: [], alignment: [] },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = this._assertOnlyOwner_0(context, partialProofData);
        partialProofData.output = { value: [], alignment: [] };
        return { result: result_0, context: context, proofData: partialProofData };
      },
      _computeOwnerCommitment: (...args_1) => {
        if (args_1.length !== 3) {
          throw new __compactRuntime.CompactError(`_computeOwnerCommitment: expected 3 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const id_0 = args_1[1];
        const counter_0 = args_1[2];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.originalState != undefined && contextOrig_0.transactionContext != undefined)) {
          __compactRuntime.type_error('_computeOwnerCommitment',
                                      'argument 1 (as invoked from Typescript)',
                                      'SampleZOwnable.compact line 47 char 1',
                                      'CircuitContext',
                                      contextOrig_0)
        }
        if (!(id_0.buffer instanceof ArrayBuffer && id_0.BYTES_PER_ELEMENT === 1 && id_0.length === 32)) {
          __compactRuntime.type_error('_computeOwnerCommitment',
                                      'argument 1 (argument 2 as invoked from Typescript)',
                                      'SampleZOwnable.compact line 47 char 1',
                                      'Bytes<32>',
                                      id_0)
        }
        if (!(typeof(counter_0) === 'bigint' && counter_0 >= 0n && counter_0 <= 18446744073709551615n)) {
          __compactRuntime.type_error('_computeOwnerCommitment',
                                      'argument 2 (argument 3 as invoked from Typescript)',
                                      'SampleZOwnable.compact line 47 char 1',
                                      'Uint<0..18446744073709551615>',
                                      counter_0)
        }
        const context = { ...contextOrig_0 };
        const partialProofData = {
          input: {
            value: _descriptor_1.toValue(id_0).concat(_descriptor_6.toValue(counter_0)),
            alignment: _descriptor_1.alignment().concat(_descriptor_6.alignment())
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = this.__computeOwnerCommitment_0(context,
                                                         partialProofData,
                                                         id_0,
                                                         counter_0);
        partialProofData.output = { value: _descriptor_1.toValue(result_0), alignment: _descriptor_1.alignment() };
        return { result: result_0, context: context, proofData: partialProofData };
      },
      _computeOwnerId(context, ...args_1) {
        return { result: pureCircuits._computeOwnerId(...args_1), context };
      }
    };
    this.impureCircuits = {
      owner: this.circuits.owner,
      transferOwnership: this.circuits.transferOwnership,
      renounceOwnership: this.circuits.renounceOwnership,
      assertOnlyOwner: this.circuits.assertOnlyOwner,
      _computeOwnerCommitment: this.circuits._computeOwnerCommitment
    };
  }
  initialState(...args_0) {
    if (args_0.length !== 3) {
      throw new __compactRuntime.CompactError(`Contract state constructor: expected 3 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const constructorContext_0 = args_0[0];
    const ownerId_0 = args_0[1];
    const instanceSalt_0 = args_0[2];
    if (typeof(constructorContext_0) !== 'object') {
      throw new __compactRuntime.CompactError(`Contract state constructor: expected 'constructorContext' in argument 1 (as invoked from Typescript) to be an object`);
    }
    if (!('initialPrivateState' in constructorContext_0)) {
      throw new __compactRuntime.CompactError(`Contract state constructor: expected 'initialPrivateState' in argument 1 (as invoked from Typescript)`);
    }
    if (!('initialZswapLocalState' in constructorContext_0)) {
      throw new __compactRuntime.CompactError(`Contract state constructor: expected 'initialZswapLocalState' in argument 1 (as invoked from Typescript)`);
    }
    if (typeof(constructorContext_0.initialZswapLocalState) !== 'object') {
      throw new __compactRuntime.CompactError(`Contract state constructor: expected 'initialZswapLocalState' in argument 1 (as invoked from Typescript) to be an object`);
    }
    if (!(ownerId_0.buffer instanceof ArrayBuffer && ownerId_0.BYTES_PER_ELEMENT === 1 && ownerId_0.length === 32)) {
      __compactRuntime.type_error('Contract state constructor',
                                  'argument 1 (argument 2 as invoked from Typescript)',
                                  'SampleZOwnable.compact line 15 char 1',
                                  'Bytes<32>',
                                  ownerId_0)
    }
    if (!(instanceSalt_0.buffer instanceof ArrayBuffer && instanceSalt_0.BYTES_PER_ELEMENT === 1 && instanceSalt_0.length === 32)) {
      __compactRuntime.type_error('Contract state constructor',
                                  'argument 2 (argument 3 as invoked from Typescript)',
                                  'SampleZOwnable.compact line 15 char 1',
                                  'Bytes<32>',
                                  instanceSalt_0)
    }
    const state_0 = new __compactRuntime.ContractState();
    let stateValue_0 = __compactRuntime.StateValue.newArray();
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    state_0.data = stateValue_0;
    state_0.setOperation('owner', new __compactRuntime.ContractOperation());
    state_0.setOperation('transferOwnership', new __compactRuntime.ContractOperation());
    state_0.setOperation('renounceOwnership', new __compactRuntime.ContractOperation());
    state_0.setOperation('assertOnlyOwner', new __compactRuntime.ContractOperation());
    state_0.setOperation('_computeOwnerCommitment', new __compactRuntime.ContractOperation());
    const context = {
      originalState: state_0,
      currentPrivateState: constructorContext_0.initialPrivateState,
      currentZswapLocalState: constructorContext_0.initialZswapLocalState,
      transactionContext: new __compactRuntime.QueryContext(state_0.data, __compactRuntime.dummyContractAddress())
    };
    const partialProofData = {
      input: { value: [], alignment: [] },
      output: undefined,
      publicTranscript: [],
      privateTranscriptOutputs: []
    };
    Contract._query(context,
                    partialProofData,
                    [
                     { push: { storage: false,
                               value: __compactRuntime.StateValue.newCell({ value: _descriptor_9.toValue(0n),
                                                                            alignment: _descriptor_9.alignment() }).encode() } },
                     { push: { storage: true,
                               value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(new Uint8Array(32)),
                                                                            alignment: _descriptor_1.alignment() }).encode() } },
                     { ins: { cached: false, n: 1 } }]);
    Contract._query(context,
                    partialProofData,
                    [
                     { push: { storage: false,
                               value: __compactRuntime.StateValue.newCell({ value: _descriptor_9.toValue(1n),
                                                                            alignment: _descriptor_9.alignment() }).encode() } },
                     { push: { storage: true,
                               value: __compactRuntime.StateValue.newCell({ value: _descriptor_6.toValue(0n),
                                                                            alignment: _descriptor_6.alignment() }).encode() } },
                     { ins: { cached: false, n: 1 } }]);
    Contract._query(context,
                    partialProofData,
                    [
                     { push: { storage: false,
                               value: __compactRuntime.StateValue.newCell({ value: _descriptor_9.toValue(2n),
                                                                            alignment: _descriptor_9.alignment() }).encode() } },
                     { push: { storage: true,
                               value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(new Uint8Array(32)),
                                                                            alignment: _descriptor_1.alignment() }).encode() } },
                     { ins: { cached: false, n: 1 } }]);
    __compactRuntime.assert(!this._equal_0(ownerId_0, new Uint8Array(32)),
                            'SampleZOwnable: invalid id');
    Contract._query(context,
                    partialProofData,
                    [
                     { push: { storage: false,
                               value: __compactRuntime.StateValue.newCell({ value: _descriptor_9.toValue(2n),
                                                                            alignment: _descriptor_9.alignment() }).encode() } },
                     { push: { storage: true,
                               value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(instanceSalt_0),
                                                                            alignment: _descriptor_1.alignment() }).encode() } },
                     { ins: { cached: false, n: 1 } }]);
    this.__transferOwnership_0(context, partialProofData, ownerId_0);
    state_0.data = context.transactionContext.state;
    return {
      currentContractState: state_0,
      currentPrivateState: context.currentPrivateState,
      currentZswapLocalState: context.currentZswapLocalState
    }
  }
  _persistentHash_0(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_8, value_0);
    return result_0;
  }
  _persistentHash_1(value_0) {
    const result_0 = __compactRuntime.persistentHash(_descriptor_7, value_0);
    return result_0;
  }
  _ownPublicKey_0(context, partialProofData) {
    const result_0 = __compactRuntime.ownPublicKey(context);
    partialProofData.privateTranscriptOutputs.push({
      value: _descriptor_2.toValue(result_0),
      alignment: _descriptor_2.alignment()
    });
    return result_0;
  }
  _secretNonce_0(context, partialProofData) {
    const witnessContext_0 = __compactRuntime.witnessContext(ledger(context.transactionContext.state), context.currentPrivateState, context.transactionContext.address);
    const [nextPrivateState_0, result_0] = this.witnesses.secretNonce(witnessContext_0);
    context.currentPrivateState = nextPrivateState_0;
    if (!(result_0.buffer instanceof ArrayBuffer && result_0.BYTES_PER_ELEMENT === 1 && result_0.length === 32)) {
      __compactRuntime.type_error('secretNonce',
                                  'return value',
                                  'SampleZOwnable.compact line 13 char 1',
                                  'Bytes<32>',
                                  result_0)
    }
    partialProofData.privateTranscriptOutputs.push({
      value: _descriptor_1.toValue(result_0),
      alignment: _descriptor_1.alignment()
    });
    return result_0;
  }
  _owner_0(context, partialProofData) {
    return _descriptor_1.fromValue(Contract._query(context,
                                                   partialProofData,
                                                   [
                                                    { dup: { n: 0 } },
                                                    { idx: { cached: false,
                                                             pushPath: false,
                                                             path: [
                                                                    { tag: 'value',
                                                                      value: { value: _descriptor_9.toValue(0n),
                                                                               alignment: _descriptor_9.alignment() } }] } },
                                                    { popeq: { cached: false,
                                                               result: undefined } }]).value);
  }
  _transferOwnership_0(context, partialProofData, newOwnerId_0) {
    this._assertOnlyOwner_0(context, partialProofData);
    __compactRuntime.assert(!this._equal_1(newOwnerId_0, new Uint8Array(32)),
                            'SampleZOwnable: invalid id');
    this.__transferOwnership_0(context, partialProofData, newOwnerId_0);
    return [];
  }
  _renounceOwnership_0(context, partialProofData) {
    this._assertOnlyOwner_0(context, partialProofData);
    Contract._query(context,
                    partialProofData,
                    [
                     { push: { storage: false,
                               value: __compactRuntime.StateValue.newCell({ value: _descriptor_9.toValue(0n),
                                                                            alignment: _descriptor_9.alignment() }).encode() } },
                     { push: { storage: true,
                               value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(new Uint8Array(32)),
                                                                            alignment: _descriptor_1.alignment() }).encode() } },
                     { ins: { cached: false, n: 1 } }]);
    return [];
  }
  _assertOnlyOwner_0(context, partialProofData) {
    const nonce_0 = this._secretNonce_0(context, partialProofData);
    const callerAsEither_0 = { is_left: true,
                               left:
                                 this._ownPublicKey_0(context, partialProofData),
                               right:
                                 { bytes:
                                     new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) } };
    const id_0 = this.__computeOwnerId_0(callerAsEither_0, nonce_0);
    __compactRuntime.assert(this._equal_2(_descriptor_1.fromValue(Contract._query(context,
                                                                                  partialProofData,
                                                                                  [
                                                                                   { dup: { n: 0 } },
                                                                                   { idx: { cached: false,
                                                                                            pushPath: false,
                                                                                            path: [
                                                                                                   { tag: 'value',
                                                                                                     value: { value: _descriptor_9.toValue(0n),
                                                                                                              alignment: _descriptor_9.alignment() } }] } },
                                                                                   { popeq: { cached: false,
                                                                                              result: undefined } }]).value),
                                          this.__computeOwnerCommitment_0(context,
                                                                          partialProofData,
                                                                          id_0,
                                                                          _descriptor_6.fromValue(Contract._query(context,
                                                                                                                  partialProofData,
                                                                                                                  [
                                                                                                                   { dup: { n: 0 } },
                                                                                                                   { idx: { cached: false,
                                                                                                                            pushPath: false,
                                                                                                                            path: [
                                                                                                                                   { tag: 'value',
                                                                                                                                     value: { value: _descriptor_9.toValue(1n),
                                                                                                                                              alignment: _descriptor_9.alignment() } }] } },
                                                                                                                   { popeq: { cached: true,
                                                                                                                              result: undefined } }]).value))),
                            'SampleZOwnable: caller is not the owner');
    return [];
  }
  __computeOwnerCommitment_0(context, partialProofData, id_0, counter_0) {
    return this._persistentHash_0([id_0,
                                   _descriptor_1.fromValue(Contract._query(context,
                                                                           partialProofData,
                                                                           [
                                                                            { dup: { n: 0 } },
                                                                            { idx: { cached: false,
                                                                                     pushPath: false,
                                                                                     path: [
                                                                                            { tag: 'value',
                                                                                              value: { value: _descriptor_9.toValue(2n),
                                                                                                       alignment: _descriptor_9.alignment() } }] } },
                                                                            { popeq: { cached: false,
                                                                                       result: undefined } }]).value),
                                   __compactRuntime.convert_bigint_to_Uint8Array(32,
                                                                                 counter_0),
                                   new Uint8Array([83, 97, 109, 112, 108, 101, 90, 79, 119, 110, 97, 98, 108, 101, 58, 115, 104, 105, 101, 108, 100, 58, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])]);
  }
  __computeOwnerId_0(pk_0, nonce_0) {
    __compactRuntime.assert(pk_0.is_left,
                            'SampleZOwnable: contract address owners are not yet supported');
    return this._persistentHash_1([pk_0.left.bytes, nonce_0]);
  }
  __transferOwnership_0(context, partialProofData, newOwnerId_0) {
    const tmp_0 = 1n;
    Contract._query(context,
                    partialProofData,
                    [
                     { idx: { cached: false,
                              pushPath: true,
                              path: [
                                     { tag: 'value',
                                       value: { value: _descriptor_9.toValue(1n),
                                                alignment: _descriptor_9.alignment() } }] } },
                     { addi: { immediate: parseInt(__compactRuntime.valueToBigInt(
                                            { value: _descriptor_5.toValue(tmp_0),
                                              alignment: _descriptor_5.alignment() }
                                              .value
                                          )) } },
                     { ins: { cached: true, n: 1 } }]);
    const tmp_1 = this.__computeOwnerCommitment_0(context,
                                                  partialProofData,
                                                  newOwnerId_0,
                                                  _descriptor_6.fromValue(Contract._query(context,
                                                                                          partialProofData,
                                                                                          [
                                                                                           { dup: { n: 0 } },
                                                                                           { idx: { cached: false,
                                                                                                    pushPath: false,
                                                                                                    path: [
                                                                                                           { tag: 'value',
                                                                                                             value: { value: _descriptor_9.toValue(1n),
                                                                                                                      alignment: _descriptor_9.alignment() } }] } },
                                                                                           { popeq: { cached: true,
                                                                                                      result: undefined } }]).value));
    Contract._query(context,
                    partialProofData,
                    [
                     { push: { storage: false,
                               value: __compactRuntime.StateValue.newCell({ value: _descriptor_9.toValue(0n),
                                                                            alignment: _descriptor_9.alignment() }).encode() } },
                     { push: { storage: true,
                               value: __compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue(tmp_1),
                                                                            alignment: _descriptor_1.alignment() }).encode() } },
                     { ins: { cached: false, n: 1 } }]);
    return [];
  }
  _equal_0(x0, y0) {
    if (!x0.every((x, i) => y0[i] === x)) { return false; }
    return true;
  }
  _equal_1(x0, y0) {
    if (!x0.every((x, i) => y0[i] === x)) { return false; }
    return true;
  }
  _equal_2(x0, y0) {
    if (!x0.every((x, i) => y0[i] === x)) { return false; }
    return true;
  }
  static _query(context, partialProofData, prog) {
    var res;
    try {
      res = context.transactionContext.query(prog, __compactRuntime.CostModel.dummyCostModel());
    } catch (err) {
      throw new __compactRuntime.CompactError(err.toString());
    }
    context.transactionContext = res.context;
    var reads = res.events.filter((e) => e.tag === 'read');
    var i = 0;
    partialProofData.publicTranscript = partialProofData.publicTranscript.concat(prog.map((op) => {
      if(typeof(op) === 'object' && 'popeq' in op) {
        return { popeq: {
          ...op.popeq,
          result: reads[i++].content,
        } };
      } else {
        return op;
      }
    }));
    if(res.events.length == 1 && res.events[0].tag === 'read') {
      return res.events[0].content;
    } else {
      return res.events;
    }
  }
}
function ledger(state) {
  const context = {
    originalState: state,
    transactionContext: new __compactRuntime.QueryContext(state, __compactRuntime.dummyContractAddress())
  };
  const partialProofData = {
    input: { value: [], alignment: [] },
    output: undefined,
    publicTranscript: [],
    privateTranscriptOutputs: []
  };
  return {
    get _ownerCommitment() {
      return _descriptor_1.fromValue(Contract._query(context,
                                                     partialProofData,
                                                     [
                                                      { dup: { n: 0 } },
                                                      { idx: { cached: false,
                                                               pushPath: false,
                                                               path: [
                                                                      { tag: 'value',
                                                                        value: { value: _descriptor_9.toValue(0n),
                                                                                 alignment: _descriptor_9.alignment() } }] } },
                                                      { popeq: { cached: false,
                                                                 result: undefined } }]).value);
    },
    get _counter() {
      return _descriptor_6.fromValue(Contract._query(context,
                                                     partialProofData,
                                                     [
                                                      { dup: { n: 0 } },
                                                      { idx: { cached: false,
                                                               pushPath: false,
                                                               path: [
                                                                      { tag: 'value',
                                                                        value: { value: _descriptor_9.toValue(1n),
                                                                                 alignment: _descriptor_9.alignment() } }] } },
                                                      { popeq: { cached: true,
                                                                 result: undefined } }]).value);
    },
    get _instanceSalt() {
      return _descriptor_1.fromValue(Contract._query(context,
                                                     partialProofData,
                                                     [
                                                      { dup: { n: 0 } },
                                                      { idx: { cached: false,
                                                               pushPath: false,
                                                               path: [
                                                                      { tag: 'value',
                                                                        value: { value: _descriptor_9.toValue(2n),
                                                                                 alignment: _descriptor_9.alignment() } }] } },
                                                      { popeq: { cached: false,
                                                                 result: undefined } }]).value);
    }
  };
}
const _emptyContext = {
  originalState: new __compactRuntime.ContractState(),
  transactionContext: new __compactRuntime.QueryContext(new __compactRuntime.ContractState().data, __compactRuntime.dummyContractAddress())
};
const _dummyContract = new Contract({ secretNonce: (...args) => undefined });
const pureCircuits = {
  _computeOwnerId: (...args_0) => {
    if (args_0.length !== 2) {
      throw new __compactRuntime.CompactError(`_computeOwnerId: expected 2 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const pk_0 = args_0[0];
    const nonce_0 = args_0[1];
    if (!(typeof(pk_0) === 'object' && typeof(pk_0.is_left) === 'boolean' && typeof(pk_0.left) === 'object' && pk_0.left.bytes.buffer instanceof ArrayBuffer && pk_0.left.bytes.BYTES_PER_ELEMENT === 1 && pk_0.left.bytes.length === 32 && typeof(pk_0.right) === 'object' && pk_0.right.bytes.buffer instanceof ArrayBuffer && pk_0.right.bytes.BYTES_PER_ELEMENT === 1 && pk_0.right.bytes.length === 32)) {
      __compactRuntime.type_error('_computeOwnerId',
                                  'argument 1',
                                  'SampleZOwnable.compact line 61 char 1',
                                  'struct Either<is_left: Boolean, left: struct ZswapCoinPublicKey<bytes: Bytes<32>>, right: struct ContractAddress<bytes: Bytes<32>>>',
                                  pk_0)
    }
    if (!(nonce_0.buffer instanceof ArrayBuffer && nonce_0.BYTES_PER_ELEMENT === 1 && nonce_0.length === 32)) {
      __compactRuntime.type_error('_computeOwnerId',
                                  'argument 2',
                                  'SampleZOwnable.compact line 61 char 1',
                                  'Bytes<32>',
                                  nonce_0)
    }
    return _dummyContract.__computeOwnerId_0(pk_0, nonce_0);
  }
};
const contractReferenceLocations = { tag: 'publicLedgerArray', indices: { } };
exports.Contract = Contract;
exports.ledger = ledger;
exports.pureCircuits = pureCircuits;
exports.contractReferenceLocations = contractReferenceLocations;
//# sourceMappingURL=index.cjs.map
