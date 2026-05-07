import {
  sampleSigningKey,
  signatureVerifyingKey,
  signData,
} from '@midnight-ntwrk/compact-runtime';
import {
  ContractMaintenanceAuthority,
  Intent,
  MaintenanceUpdate,
  ReplaceAuthority,
  Transaction,
} from '@midnight-ntwrk/ledger-v8';
import { submitTx } from '@midnight-ntwrk/midnight-js-contracts';
import { getNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { asContractAddress } from '@midnight-ntwrk/midnight-js-types';
import { ttlOneHour } from '@midnight-ntwrk/midnight-js-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  readAuthority,
  readCmaCounter,
} from '../../_harness/cma.js';
import {
  deployTestTokenV1,
  type TestTokenV1Kit,
} from '../../fixtures/testTokenV1.js';

/**
 * Spec: is a `MaintenanceUpdate` signature bound to its target contract
 * address, or could a signature valid on contract A be replayed against
 * contract B?
 *
 * Why this matters: if the chain doesn't enforce address binding on the
 * signed payload, an attacker who captures any single maintenance signature
 * from contract A could replay it against an unrelated contract B (assuming
 * matching counter), trivially compromising B. This is one of the most
 * security-relevant invariants in the upgrade pathway.
 *
 * **Pinned outcome:** chain rejects. The `dataToSign` payload includes the
 * target contract's address, so a signature valid for A's `dataToSign`
 * decodes to a different byte sequence than B's `dataToSign` for the same
 * updates+counter. B's authority committee verification fails. Whatever
 * the substrate-level error code, the SDK surfaces a `SubmissionError`
 * rejection.
 *
 * Test design:
 *   1. Deploy two independent contracts, A and B (each gets its own
 *      authority key from the `deployTestTokenV1` fixture).
 *   2. Capture A's signing key from A's `privateStateProvider`.
 *   3. Build a `MaintenanceUpdate` whose target address is **B's**, signed
 *      with **A's** key. We have to inline the build/sign/submit dance
 *      here rather than use `submitRawMaintenanceUpdate`, because the
 *      helper looks up the signing key by the *given* address — if we
 *      passed B's address it would correctly fetch B's key and the test
 *      would tautologically succeed.
 *   4. Submit. Expect rejection.
 */
describe("TestToken — A's signature on a MaintenanceUpdate addressed to B is rejected", () => {
  let v1A: TestTokenV1Kit;
  let v1B: TestTokenV1Kit;

  beforeAll(async () => {
    v1A = await deployTestTokenV1();
    v1B = await deployTestTokenV1();
  });

  afterAll(async () => {
    await v1A?.teardown();
    await v1B?.teardown();
  });

  it("should reject a tx whose MaintenanceUpdate is addressed to B but signed with A's key", async () => {
    // Capture A's signing key explicitly. `submitRawMaintenanceUpdate`
    // would look up by-address, defeating the cross-contract replay setup;
    // we need to *force* the wrong-key signing.
    const aSigningKey = await v1A.providers.privateStateProvider.getSigningKey(
      v1A.contractAddress,
    );
    if (!aSigningKey) {
      throw new Error(
        `crossContractReplay setup: no signing key for kitA at ${v1A.contractAddress}`,
      );
    }

    // Counter must match B's on-chain expectation, otherwise the test
    // conflates address-binding rejection with stale-counter rejection.
    const bCounter = await readCmaCounter(v1B.providers, v1B.contractAddress);

    // Benign payload: replace B's authority with a fresh sampled key. The
    // SU itself is structurally valid; we expect the chain to reject on
    // signature verification *before* applying the SU.
    const decoyKey = sampleSigningKey();
    const decoyAuth = new ContractMaintenanceAuthority(
      [signatureVerifyingKey(decoyKey)],
      1,
    );

    // Build the MU pointing at B's address, signed with A's key.
    const mu = new MaintenanceUpdate(
      asContractAddress(v1B.contractAddress),
      [new ReplaceAuthority(decoyAuth)],
      bCounter,
    );
    const signature = signData(aSigningKey, mu.dataToSign);
    const signed = mu.addSignature(0n, signature);

    const intent = Intent.new(ttlOneHour()).addMaintenanceUpdate(signed);
    const unprovenTx = Transaction.fromParts(
      getNetworkId(),
      undefined,
      undefined,
      intent,
    );

    // Submit via B's providers (B is the contract whose authority we're
    // attempting to overwrite). B's authority committee won't recognise
    // A's signature — the chain rejects.
    await expect(
      submitTx(
        v1B.providers as Parameters<typeof submitTx>[0],
        { unprovenTx },
      ),
    ).rejects.toThrow(/SubmissionError|Transaction submission error/);

    // Sanity: B's authority is unchanged from deploy. The cross-contract
    // attack didn't take effect.
    const bAuthAfter = await readAuthority(v1B.providers, v1B.contractAddress);
    expect(bAuthAfter.committee.length).toBe(1);
  });
});
