import {
  CompactTypeBytes,
  CompactTypeVector,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import { expectRejection } from '#test-utils/assertions/rejection.js';
import * as utils from '#test-utils/fixtures/address.js';
import {
  type Caller,
  ConfidentialNoteFungibleTokenAuthorityCallerSimulator,
} from './simulators/ConfidentialNoteFungibleTokenAuthorityCallerSimulator.js';
import {
  ConfidentialNoteFungibleTokenAuthoritySimulator,
  type Identifier,
} from './simulators/ConfidentialNoteFungibleTokenAuthoritySimulator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createTestSK = (label: string): Uint8Array => {
  const sk = new Uint8Array(32);
  sk.set(new TextEncoder().encode(label).slice(0, 32));
  return sk;
};

/** The mock's account id: `AuthPrfPseudonym` under the salt `MockAuthority`. */
const buildAccountIdHash = (sk: Uint8Array): Uint8Array =>
  persistentHash(new CompactTypeVector(3, new CompactTypeBytes(32)), [
    createTestSK('AuthPrfPseudonym:identifier'),
    createTestSK('MockAuthority'),
    sk,
  ]);

const zeroBytes = utils.zeroUint8Array();
const DIRT = new Uint8Array(32).fill(0xff);

const eitherAccountId = (accountId: Uint8Array): Identifier => ({
  is_left: true,
  left: accountId,
  right: { bytes: zeroBytes },
});

const eitherContract = (address: string): Identifier => ({
  is_left: false,
  left: zeroBytes,
  right: utils.encodeToAddress(address),
});

const makeUser = (label: string) => {
  const secretKey = createTestSK(label);
  const accountId = buildAccountIdHash(secretKey);
  return { secretKey, accountId, either: eitherAccountId(accountId) };
};

const AUTHORITY = makeUser('AUTHORITY');
const NEW_AUTHORITY = makeUser('NEW_AUTHORITY');
const UNAUTHORIZED = makeUser('UNAUTHORIZED');

const AUTHORITY_CONTRACT = eitherContract('AUTHORITY_CONTRACT');

const ZERO_ACCOUNT = eitherAccountId(zeroBytes);
/** The default `Either`: what an unset `_authority` reads as. */
const ZERO_CONTRACT: Identifier = {
  is_left: false,
  left: zeroBytes,
  right: { bytes: zeroBytes },
};

/** `id` with junk in its inactive arm. */
const nonCanonical = (id: Identifier): Identifier =>
  id.is_left ? { ...id, right: { bytes: DIRT } } : { ...id, left: DIRT };

const isInit = 1n;
const isBadInit = 0n;
const isDoubleInit = 2n;

const NOT_INITIALIZED =
  'ConfidentialNoteFungibleTokenAuthority: contract not initialized';
const ALREADY_INITIALIZED =
  'ConfidentialNoteFungibleTokenAuthority: contract already initialized';
const NOT_AUTHORITY =
  'ConfidentialNoteFungibleTokenAuthority: caller is not the authority';
const CONTRACT_AUTHORITY =
  'ConfidentialNoteFungibleTokenAuthority: contract authority';
const ZERO_AUTHORITY = 'ConfidentialNoteFungibleTokenAuthority: zero authority';

/** Rejected new ids, with the reason each fails. Kind is checked first. */
const invalidIds = [
  ['a contract address', AUTHORITY_CONTRACT, CONTRACT_AUTHORITY],
  ['the zero contract address', ZERO_CONTRACT, CONTRACT_AUTHORITY],
  [
    'a contract address with a key-arm payload',
    nonCanonical(AUTHORITY_CONTRACT),
    CONTRACT_AUTHORITY,
  ],
  ['the zero key', ZERO_ACCOUNT, ZERO_AUTHORITY],
  [
    'the zero key with a non-zero contract arm',
    nonCanonical(ZERO_ACCOUNT),
    ZERO_AUTHORITY,
  ],
] as const;

let authority: ConfidentialNoteFungibleTokenAuthoritySimulator;

const createAuthority = (
  initial: Identifier,
  inits: bigint,
  sk: Uint8Array = AUTHORITY.secretKey,
) =>
  ConfidentialNoteFungibleTokenAuthoritySimulator.create(initial, inits, {
    privateState: { secretKey: sk },
  });

/** The module's ledger fields, in a form `toStrictEqual` compares. */
const fieldsOf = async (
  sim: {
    getPublicState: () => Promise<{
      Authority__isInitialized: boolean;
      Authority__authority: Identifier;
    }>;
  } = authority,
) => {
  const state = await sim.getPublicState();
  return {
    isInitialized: state.Authority__isInitialized,
    authority: state.Authority__authority,
  };
};

// ---------------------------------------------------------------------------
// Before initialized
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenAuthority: before initialized', () => {
  it('should initialize', async () => {
    authority = await createAuthority(AUTHORITY.either, isInit);

    expect(await authority.authority()).toStrictEqual(AUTHORITY.either);
    expect(await fieldsOf()).toStrictEqual({
      isInitialized: true,
      authority: AUTHORITY.either,
    });
  });

  it('should fail to initialize twice', async () => {
    await expectRejection(
      createAuthority(AUTHORITY.either, isDoubleInit),
      ALREADY_INITIALIZED,
    );
  });

  it.each(invalidIds)(
    'should fail to initialize with %s',
    async (_, id, reason) => {
      await expectRejection(createAuthority(id, isInit), reason);
    },
  );

  it('should canonicalize the initial authority', async () => {
    authority = await createAuthority(nonCanonical(AUTHORITY.either), isInit);

    expect(await authority.authority()).toStrictEqual(AUTHORITY.either);
  });

  describe('with initialize skipped', () => {
    beforeEach(async () => {
      authority = await createAuthority(AUTHORITY.either, isBadInit);
    });

    it('should leave the flag unset and the authority at the default', async () => {
      expect(await fieldsOf()).toStrictEqual({
        isInitialized: false,
        authority: ZERO_CONTRACT,
      });
    });

    type FailingCircuits = [
      method: keyof ConfidentialNoteFungibleTokenAuthoritySimulator,
      args: unknown[],
    ];
    const circuitsToFail: FailingCircuits[] = [
      ['authority', []],
      ['assertOnlyAuthority', []],
      ['transferAuthority', [NEW_AUTHORITY.either]],
      ['_transferAuthority', [NEW_AUTHORITY.either]],
    ];
    it.each(circuitsToFail)(
      'should fail when calling circuit "%s"',
      async (circuitName, args) => {
        await expectRejection(
          (authority[circuitName] as (...args: unknown[]) => Promise<unknown>)(
            ...args,
          ),
          NOT_INITIALIZED,
        );
        expect(await fieldsOf()).toStrictEqual({
          isInitialized: false,
          authority: ZERO_CONTRACT,
        });
      },
    );

    it('should check the flag before the new id in _transferAuthority', async () => {
      await expectRejection(
        authority._transferAuthority(AUTHORITY_CONTRACT),
        NOT_INITIALIZED,
      );
    });
  });
});

// ---------------------------------------------------------------------------
// When initialized
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenAuthority: when initialized', () => {
  beforeEach(async () => {
    authority = await createAuthority(AUTHORITY.either, isInit);
  });

  describe('authority', () => {
    it('should return the stored id', async () => {
      expect(await authority.authority()).toStrictEqual(
        (await fieldsOf()).authority,
      );
    });

    it('should leave the ledger unchanged', async () => {
      const before = await fieldsOf();
      await authority.authority();
      expect(await fieldsOf()).toStrictEqual(before);
    });
  });

  describe('assertOnlyAuthority', () => {
    it('should let the authority through', async () => {
      await authority.assertOnlyAuthority();
    });

    it('should fail for another secret', async () => {
      await authority.privateState.injectSecretKey(UNAUTHORIZED.secretKey);
      await expectRejection(authority.assertOnlyAuthority(), NOT_AUTHORITY);
    });

    it('should leave the ledger unchanged', async () => {
      const before = await fieldsOf();
      await authority.assertOnlyAuthority();
      expect(await fieldsOf()).toStrictEqual(before);
    });
  });

  describe('transferAuthority', () => {
    it('should hand the role over', async () => {
      await authority.transferAuthority(NEW_AUTHORITY.either);
      expect(await fieldsOf()).toStrictEqual({
        isInitialized: true,
        authority: NEW_AUTHORITY.either,
      });

      // The old authority is out.
      await expectRejection(authority.assertOnlyAuthority(), NOT_AUTHORITY);

      // A stranger is still out.
      await authority.privateState.injectSecretKey(UNAUTHORIZED.secretKey);
      await expectRejection(authority.assertOnlyAuthority(), NOT_AUTHORITY);

      // The new authority is in.
      await authority.privateState.injectSecretKey(NEW_AUTHORITY.secretKey);
      await authority.assertOnlyAuthority();
    });

    it('should fail when a stranger hands the role over', async () => {
      await authority.privateState.injectSecretKey(UNAUTHORIZED.secretKey);
      await expectRejection(
        authority.transferAuthority(UNAUTHORIZED.either),
        NOT_AUTHORITY,
      );
      expect(await authority.authority()).toStrictEqual(AUTHORITY.either);
    });

    it.each(invalidIds)('should check the caller before %s', async (_, id) => {
      await authority.privateState.injectSecretKey(UNAUTHORIZED.secretKey);
      await expectRejection(authority.transferAuthority(id), NOT_AUTHORITY);
      expect(await authority.authority()).toStrictEqual(AUTHORITY.either);
    });

    it.each(invalidIds)(
      'should fail when handing over to %s',
      async (_, id, reason) => {
        await expectRejection(authority.transferAuthority(id), reason);
        expect(await fieldsOf()).toStrictEqual({
          isInitialized: true,
          authority: AUTHORITY.either,
        });
      },
    );

    it('should store a non-canonical new id canonical', async () => {
      await authority.transferAuthority(nonCanonical(NEW_AUTHORITY.either));
      expect(await authority.authority()).toStrictEqual(NEW_AUTHORITY.either);
    });

    it('should accept a handover to the current id and change nothing', async () => {
      const before = await fieldsOf();
      await authority.transferAuthority(AUTHORITY.either);

      expect(await fieldsOf()).toStrictEqual(before);
      await authority.assertOnlyAuthority();
    });

    it('should hand over repeatedly', async () => {
      await authority.transferAuthority(NEW_AUTHORITY.either);

      await authority.privateState.injectSecretKey(NEW_AUTHORITY.secretKey);
      await authority.transferAuthority(AUTHORITY.either);

      await authority.privateState.injectSecretKey(AUTHORITY.secretKey);
      await authority.transferAuthority(NEW_AUTHORITY.either);

      expect(await authority.authority()).toStrictEqual(NEW_AUTHORITY.either);
    });
  });

  describe('_transferAuthority', () => {
    // The mock re-exports it ungated, so a stranger reaches it.
    it('should set the authority for any caller', async () => {
      await authority.privateState.injectSecretKey(UNAUTHORIZED.secretKey);
      await authority._transferAuthority(NEW_AUTHORITY.either);
      expect(await fieldsOf()).toStrictEqual({
        isInitialized: true,
        authority: NEW_AUTHORITY.either,
      });

      await authority.privateState.injectSecretKey(AUTHORITY.secretKey);
      await expectRejection(authority.assertOnlyAuthority(), NOT_AUTHORITY);

      await authority.privateState.injectSecretKey(NEW_AUTHORITY.secretKey);
      await authority.assertOnlyAuthority();
    });

    it.each(invalidIds)(
      'should fail when setting %s',
      async (_, id, reason) => {
        await expectRejection(authority._transferAuthority(id), reason);
        expect(await fieldsOf()).toStrictEqual({
          isInitialized: true,
          authority: AUTHORITY.either,
        });
      },
    );

    it('should store a non-canonical new id canonical', async () => {
      await authority._transferAuthority(nonCanonical(NEW_AUTHORITY.either));
      expect(await authority.authority()).toStrictEqual(NEW_AUTHORITY.either);
    });

    it('should accept the current id and change nothing', async () => {
      const before = await fieldsOf();
      await authority._transferAuthority(AUTHORITY.either);
      expect(await fieldsOf()).toStrictEqual(before);
    });

    it('should let the last of several writes win', async () => {
      await authority._transferAuthority(NEW_AUTHORITY.either);
      await authority._transferAuthority(UNAUTHORIZED.either);
      expect(await authority.authority()).toStrictEqual(UNAUTHORIZED.either);
    });
  });
});

// ---------------------------------------------------------------------------
// Simulator wiring
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenAuthority: simulator wiring', () => {
  it('should construct with a generated private state when none is supplied', async () => {
    const sim = await ConfidentialNoteFungibleTokenAuthoritySimulator.create(
      AUTHORITY.either,
      isInit,
    );
    const sk = await sim.privateState.getCurrentSecretKey();

    expect(sk).toBeInstanceOf(Uint8Array);
    expect(sk.length).toBe(32);
  });

  it('should return the injected secret key', async () => {
    authority = await createAuthority(AUTHORITY.either, isInit);
    await authority.privateState.injectSecretKey(NEW_AUTHORITY.secretKey);

    expect(await authority.privateState.getCurrentSecretKey()).toEqual(
      NEW_AUTHORITY.secretKey,
    );
  });

  it('should throw when the secret key is undefined', async () => {
    const sim = await ConfidentialNoteFungibleTokenAuthoritySimulator.create(
      AUTHORITY.either,
      isInit,
      { privateState: { secretKey: undefined as unknown as Uint8Array } },
    );

    await expectRejection(
      sim.privateState.getCurrentSecretKey(),
      'Missing secret key',
    );
  });
});

// ---------------------------------------------------------------------------
// Abnormal callers
// ---------------------------------------------------------------------------

const callerOf = (identifier: Identifier): Caller => ({ identifier });

const AUTHORITY_CALLER = callerOf(AUTHORITY.either);

/** Callers a composer could hand-build, none equal to the stored id. */
const abnormalCallers = [
  ['zero account', callerOf(ZERO_ACCOUNT)],
  ['default Either', callerOf(ZERO_CONTRACT)],
  [
    "contract arm carrying the authority's bytes",
    callerOf({
      is_left: false,
      left: AUTHORITY.accountId,
      right: { bytes: AUTHORITY.accountId },
    }),
  ],
  [
    "authority's bytes with a non-zero inactive arm",
    callerOf(nonCanonical(AUTHORITY.either)),
  ],
  ['another key', callerOf(UNAUTHORIZED.either)],
] as const;

// The Authority mock authenticates inside, so its caller is always a derived
// key. This mock takes the caller as an argument, so a spec can act as any.
describe('ConfidentialNoteFungibleTokenAuthority: a hand-built caller', () => {
  let authorityCaller: ConfidentialNoteFungibleTokenAuthorityCallerSimulator;

  describe('when initialized', () => {
    beforeEach(async () => {
      authorityCaller =
        await ConfidentialNoteFungibleTokenAuthorityCallerSimulator.create(
          AUTHORITY.either,
          isInit,
        );
    });

    it('should let a caller carrying the stored id through', async () => {
      await authorityCaller.assertOnlyAuthority(AUTHORITY_CALLER);
    });

    it.each(abnormalCallers)(
      'should reject the %s in assertOnlyAuthority',
      async (_, caller) => {
        await expectRejection(
          authorityCaller.assertOnlyAuthority(caller),
          NOT_AUTHORITY,
        );
      },
    );

    it.each(abnormalCallers)(
      'should reject the %s in transferAuthority',
      async (_, caller) => {
        await expectRejection(
          authorityCaller.transferAuthority(caller, NEW_AUTHORITY.either),
          NOT_AUTHORITY,
        );
        expect(await fieldsOf(authorityCaller)).toStrictEqual({
          isInitialized: true,
          authority: AUTHORITY.either,
        });
      },
    );

    it('should move the check to the new id after a handover', async () => {
      await authorityCaller.transferAuthority(
        AUTHORITY_CALLER,
        NEW_AUTHORITY.either,
      );

      await expectRejection(
        authorityCaller.assertOnlyAuthority(AUTHORITY_CALLER),
        NOT_AUTHORITY,
      );
      await authorityCaller.assertOnlyAuthority(callerOf(NEW_AUTHORITY.either));
    });
  });

  describe('with initialize skipped', () => {
    beforeEach(async () => {
      authorityCaller =
        await ConfidentialNoteFungibleTokenAuthorityCallerSimulator.create(
          AUTHORITY.either,
          isBadInit,
        );
    });

    // The caller equals the unset authority, so only the flag stops it.
    it('should hand-build a caller equal to the unset authority', async () => {
      expect((await fieldsOf(authorityCaller)).authority).toStrictEqual(
        callerOf(ZERO_CONTRACT).identifier,
      );
    });

    it('should reject the default caller in assertOnlyAuthority', async () => {
      await expectRejection(
        authorityCaller.assertOnlyAuthority(callerOf(ZERO_CONTRACT)),
        NOT_INITIALIZED,
      );
    });

    it('should reject the default caller in transferAuthority', async () => {
      await expectRejection(
        authorityCaller.transferAuthority(
          callerOf(ZERO_CONTRACT),
          NEW_AUTHORITY.either,
        ),
        NOT_INITIALIZED,
      );
      expect(await fieldsOf(authorityCaller)).toStrictEqual({
        isInitialized: false,
        authority: ZERO_CONTRACT,
      });
    });

    it('should fail to read the authority', async () => {
      await expectRejection(authorityCaller.authority(), NOT_INITIALIZED);
    });
  });
});
