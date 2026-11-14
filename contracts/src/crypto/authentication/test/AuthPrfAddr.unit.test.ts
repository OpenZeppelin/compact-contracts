import { readFileSync } from 'node:fs';
import {
  CompactTypeBytes,
  CompactTypeVector,
  persistentHash,
  sampleContractAddress,
} from '@midnight-ntwrk/compact-runtime';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  circuitSurface,
  readContractInfo,
} from '#test-utils/compiler/contractInfo.js';
import { pureCircuits } from '../../../../artifacts/crypto/authentication/test/mocks/MockAuthPrfAddr/contract/index.js';
import {
  type Account,
  AuthPrfAddrSimulator,
} from './simulators/AuthPrfAddrSimulator.js';
import { AuthPrfAddrPrivateState } from './witnesses/AuthPrfAddrWitnesses.js';

/** Deterministic 32 bytes from a label; also Compact's `pad(32, label)`. */
const bytes32 = (label: string): Uint8Array => {
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode(label));
  return bytes;
};

const TAG = bytes32('AuthPrfAddr:account');
const SALT = bytes32('salt');
const OTHER_SALT = bytes32('other salt');
const SK = bytes32('key');
const OTHER_SK = bytes32('other key');
const ZERO = new Uint8Array(32);

const ARTIFACT = 'crypto/authentication/test/mocks/MockAuthPrfAddr';

const AUTH_SOURCE = readFileSync(
  new URL('../AuthPrfAddr.compact', import.meta.url),
  'utf8',
);
const MOCK_SOURCE = readFileSync(
  new URL('./mocks/MockAuthPrfAddr.compact', import.meta.url),
  'utf8',
);

/** `left(persistentHash([tag, salt, sk]))`, the account `deriveAccount` returns. */
const buildAccount = (sk: Uint8Array, salt: Uint8Array): Account => ({
  is_left: true,
  left: persistentHash(new CompactTypeVector(3, new CompactTypeBytes(32)), [
    TAG,
    salt,
    sk,
  ]),
  right: { bytes: ZERO },
});

/** Source lines with doc and line comments dropped. */
const codeLines = (source: string): string[] =>
  source
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        !line.startsWith('*') &&
        !line.startsWith('/*') &&
        !line.startsWith('//'),
    );

let auth: AuthPrfAddrSimulator;

describe('AuthPrfAddr', () => {
  beforeAll(async () => {
    auth = await AuthPrfAddrSimulator.create({
      privateState: AuthPrfAddrPrivateState.withSecretKey(SK),
    });
  });

  describe('deriveAccount', () => {
    it('should match the persistentHash derivation', async () => {
      for (const label of ['ALICE_SK', 'BOB_SK', 'CHARLIE_SK']) {
        const sk = bytes32(label);

        expect(await auth.deriveAccount(sk, SALT)).toEqual(
          buildAccount(sk, SALT),
        );
      }
    });

    it('should return a left account with a zero right arm', async () => {
      const account = await auth.deriveAccount(SK, SALT);

      expect(account.is_left).toBe(true);
      expect(account.right).toEqual({ bytes: ZERO });
    });

    it('should be deterministic for the same secret key and salt', async () => {
      expect(await auth.deriveAccount(SK, SALT)).toEqual(
        await auth.deriveAccount(SK, SALT),
      );
    });

    it('should produce distinct accounts for distinct keys', async () => {
      const accounts = await Promise.all(
        ['A', 'B', 'C'].map((label) =>
          auth.deriveAccount(bytes32(label), SALT),
        ),
      );

      for (let i = 0; i < accounts.length; i++) {
        for (let j = i + 1; j < accounts.length; j++) {
          expect(accounts[i]).not.toEqual(accounts[j]);
        }
      }
    });

    it('should produce a different account with a different salt', async () => {
      expect(await auth.deriveAccount(SK, OTHER_SALT)).not.toEqual(
        await auth.deriveAccount(SK, SALT),
      );
    });

    // No guard: an all-zero secret key still derives.
    it('should accept a zero-byte secret key', async () => {
      expect(await auth.deriveAccount(ZERO, SALT)).toEqual(
        buildAccount(ZERO, SALT),
      );
    });
  });

  describe('authenticate', () => {
    it("should return a Caller holding the witness key's account", async () => {
      expect(await auth.authenticate(SALT)).toEqual({
        account: buildAccount(SK, SALT),
      });
    });

    it('should equal deriveAccount over the witness key', async () => {
      expect((await auth.authenticate(SALT)).account).toEqual(
        await auth.deriveAccount(SK, SALT),
      );
    });

    it('should produce a different account for a different secret key', async () => {
      const other = await AuthPrfAddrSimulator.create({
        privateState: AuthPrfAddrPrivateState.withSecretKey(OTHER_SK),
      });
      const fromOther = await other.authenticate(SALT);

      expect(fromOther).toEqual({ account: buildAccount(OTHER_SK, SALT) });
      expect(fromOther).not.toEqual(await auth.authenticate(SALT));
    });

    it('should produce a different account with a different salt', async () => {
      expect(await auth.authenticate(OTHER_SALT)).not.toEqual(
        await auth.authenticate(SALT),
      );
    });
  });

  describe('authenticateForThisContract', () => {
    const selfAddress = (sim: AuthPrfAddrSimulator): Uint8Array =>
      Uint8Array.from(Buffer.from(sim.contractAddress, 'hex'));

    it("should equal authenticate under the contract's own address", async () => {
      const address = selfAddress(auth);

      expect(await auth.authenticateForThisContract()).toEqual(
        await auth.authenticate(address),
      );
      expect(await auth.authenticateForThisContract()).toEqual({
        account: buildAccount(SK, address),
      });
    });

    // Dry deploys every instance at one dummy address unless given another.
    it('should produce a different account on another deployment', async () => {
      const other = await AuthPrfAddrSimulator.create({
        privateState: AuthPrfAddrPrivateState.withSecretKey(SK),
        ...(isLiveBackend()
          ? {}
          : { contractAddress: sampleContractAddress() }),
      });

      expect(selfAddress(other)).not.toEqual(selfAddress(auth));
      expect(await other.authenticateForThisContract()).toEqual({
        account: buildAccount(SK, selfAddress(other)),
      });
      expect(await other.authenticateForThisContract()).not.toEqual(
        await auth.authenticateForThisContract(),
      );
    });
  });

  describe('IAuthenticator', () => {
    it('should declare that the mock implements IAuthenticator', () => {
      expect(codeLines(MOCK_SOURCE)).toContain(
        'contract implements IAuthenticator;',
      );
    });

    it('should expose authenticate(salt: Bytes<32>): Caller', () => {
      const authenticate = readContractInfo(ARTIFACT).circuits.find(
        ({ name }) => name === 'authenticate',
      );

      expect(authenticate?.arguments).toStrictEqual([
        { name: 'salt', type: { 'type-name': 'Bytes', length: 32 } },
      ]);
      expect(authenticate?.['result-type']).toMatchObject({
        'type-name': 'Struct',
        name: 'Caller',
        elements: [{ name: 'account' }],
      });
    });
  });

  describe('purity', () => {
    it('should keep deriveAccount pure and both authenticate circuits provable', () => {
      expect(circuitSurface(readContractInfo(ARTIFACT))).toStrictEqual([
        { name: 'authenticate', pure: false, proof: true },
        { name: 'authenticateForThisContract', pure: false, proof: true },
        { name: 'deriveAccount', pure: true, proof: false },
      ]);
    });

    // Called with no deployment and no contract state.
    it('should run deriveAccount off-chain to the same account', async () => {
      expect(pureCircuits.deriveAccount(SK, SALT)).toEqual(
        await auth.deriveAccount(SK, SALT),
      );
    });

    it('should declare one witness and hold no ledger or assert', () => {
      const code = codeLines(AUTH_SOURCE);

      expect(code.filter((line) => /\bwitness\b/.test(line))).toStrictEqual([
        'witness wit_AuthPrfAddrSK(): Bytes<32>;',
      ]);
      expect(code.filter((line) => /\bledger\b/.test(line))).toStrictEqual([]);
      expect(code.join('\n')).not.toMatch(/\bassert\(/);
    });

    // The mock's call counter is unexported, so a reader sees no state.
    it('should leave the mock with no exported ledger state', async () => {
      await auth.authenticate(SALT);

      expect(await auth.getPublicState()).toStrictEqual({});
    });
  });
});
