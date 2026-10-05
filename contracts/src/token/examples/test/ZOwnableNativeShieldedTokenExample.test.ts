import {
  createSimulator,
  isLiveBackend,
} from '@openzeppelin/compact-simulator';
import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/fixtures/address.js';
import { shieldedTestKey } from '#test-utils/fixtures/shieldedKey.js';
import {
  Contract as Ex,
  ledger,
} from '../../../../artifacts/ZOwnableNativeShieldedTokenExample/contract/index.js';
import {
  ZOwnablePKPrivateState,
  ZOwnablePKWitnesses,
} from '../../../access/test/witnesses/ZOwnablePKWitnesses.js';
import {
  buildCommitmentFromId,
  createIdHash,
} from '../../presets/test/simulators/ZOwnableNativeShieldedTokenSimulator.js';

type Ledger = ReturnType<typeof ledger>;

type ExampleArgs = readonly [
  Uint8Array,
  Uint8Array,
  Uint8Array,
  string,
  string,
  bigint,
];

const ExampleSimulator = createSimulator<
  ZOwnablePKPrivateState,
  Ledger,
  ReturnType<typeof ZOwnablePKWitnesses>,
  Ex<ZOwnablePKPrivateState>,
  ExampleArgs
>({
  contractFactory: (witnesses) => new Ex<ZOwnablePKPrivateState>(witnesses),
  defaultPrivateState: () => ZOwnablePKPrivateState.generate(),
  contractArgs: (
    ownerId,
    instanceSalt,
    tokenDomain,
    name,
    symbol,
    decimals,
  ) => [ownerId, instanceSalt, tokenDomain, name, symbol, decimals],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ZOwnablePKWitnesses<Ledger>(),
  artifactName: 'ZOwnableNativeShieldedTokenExample',
});

const Z_OWNER = shieldedTestKey('SIGNER1').left;
const INSTANCE_SALT = new Uint8Array(32).fill(0x5a);
const TOKEN_DOMAIN = new Uint8Array(32);
TOKEN_DOMAIN.set(new TextEncoder().encode('zownable-nst:token'));
const NAME = 'Ownable Shielded Token';
const SYMBOL = 'OST';
const DECIMALS = 2n;
const INIT_COUNTER = 1n;

const AT_SELF = isLiveBackend()
  ? {}
  : { contractAddress: utils.toHexPadded('ZOWNABLE_NST_EX') };

describe('ZOwnableNativeShieldedTokenExample', () => {
  let ex: InstanceType<typeof ExampleSimulator>;
  let ownerId: Uint8Array;

  beforeEach(async () => {
    const privateState = ZOwnablePKPrivateState.generate();
    ownerId = createIdHash(Z_OWNER, privateState.secretNonce);
    ex = await ExampleSimulator.create(
      [ownerId, INSTANCE_SALT, TOKEN_DOMAIN, NAME, SYMBOL, DECIMALS],
      { privateState, ...AT_SELF },
    );
  });

  it('surfaces the preset state in ledger()', async () => {
    const state = await ex.getPublicState();
    expect(state._ownerCommitment).toStrictEqual(
      buildCommitmentFromId(ownerId, INSTANCE_SALT, INIT_COUNTER),
    );
    expect(state._counter).toStrictEqual(INIT_COUNTER);
    expect(state._instanceSalt).toStrictEqual(INSTANCE_SALT);
    expect(state._ownableIsInitialized).toStrictEqual(true);
    expect(state._domain).toStrictEqual(TOKEN_DOMAIN);
    expect(state._name).toStrictEqual(NAME);
    expect(state._symbol).toStrictEqual(SYMBOL);
    expect(state._decimals).toStrictEqual(DECIMALS);
    expect(state._isInitialized).toStrictEqual(true);
    expect([...state._totalMinted]).toStrictEqual([]);
    expect([...state._totalBurned]).toStrictEqual([]);
  });

  it('reports the owner the constructor registered', async () => {
    expect(await ex.circuits.impure.owner()).toStrictEqual(
      buildCommitmentFromId(ownerId, INSTANCE_SALT, INIT_COUNTER),
    );
  });
});
