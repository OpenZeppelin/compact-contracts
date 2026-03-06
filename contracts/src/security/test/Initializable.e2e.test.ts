import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import {
  createLogger,
  expectSuccessfulCallTx,
  expectSuccessfulDeployTx,
  getTestEnvironment,
  initializeMidnightProviders,
  type EnvironmentConfiguration,
  type MidnightWalletProvider,
  type TestEnvironment,
} from '@midnight-ntwrk/testkit-js';
import path from 'path';
import { WebSocket } from 'ws';

import * as CompiledInitializable from '../../../artifacts/MockInitializable/contract/index.js';
import { CompiledContract, Contract } from '@midnight-ntwrk/compact-js';

// Apollo requires a global WebSocket in Node.js
// @ts-expect-error: WebSocket global assignment for Apollo
globalThis.WebSocket = WebSocket;

// ─── Types ───────────────────────────────────────────────────────────────────
type InitializableContract = CompiledInitializable.Contract<undefined>;
type InitializableCircuits = Contract.ImpureCircuitId<InitializableContract>;
const InitializablePrivateStateId = 'initializablePrivateState';
type InitializableProviders = MidnightProviders<InitializableCircuits>;

// ─── Configuration ───────────────────────────────────────────────────────────

const zkConfigPath = path.resolve(import.meta.dirname, '..', '..', '..', 'artifacts', 'MockInitializable');

const logger = createLogger(
  path.resolve(import.meta.dirname, '..', 'logs', 'tests', `initializable_${new Date().toISOString()}.log`)
);

export const CompiledInitializableContract = CompiledContract.make<CompiledInitializable.Contract>(
  'Initializable',
  CompiledInitializable.Contract
).pipe(
  CompiledContract.withVacantWitnesses,
  CompiledContract.withCompiledFileAssets('../../../artifacts/MockInitializable')
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

// const getLedgerState = async (providers: CounterProviders, contractAddress: string): Promise<bigint | null> => {
//   const contractState = await providers.publicDataProvider.queryContractState(contractAddress);
//   return contractState != null ? CompiledCounter.ledger(contractState.data).round : null;
// };

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('Initializable contract', () => {
  let testEnvironment: TestEnvironment;
  let environmentConfiguration: EnvironmentConfiguration;
  let wallet: MidnightWalletProvider;
  let providers: InitializableProviders;

  beforeEach(() => {
    logger.info(`Running test: ${expect.getState().currentTestName}`);
  });

  beforeAll(async () => {
    testEnvironment = getTestEnvironment(logger);
    environmentConfiguration = await testEnvironment.start();

    wallet = await testEnvironment.getMidnightWalletProvider();

    providers = initializeMidnightProviders(wallet, environmentConfiguration, {
      // Unique store name per run prevents state leaking between parallel test suites
      privateStateStoreName: `initializable-test-${Date.now()}`,
      zkConfigPath,
    });
  });

  afterAll(async () => {
    await testEnvironment.shutdown();
  });

  // ─── Deploy ──────────────────────────────────────────────────────────────

  describe.only('deployContract', () => {
    it('deploys with the correct initial ledger and private state [@slow]', async () => {
      // Arrange
      const initialPrivateState = {};

      // Act
      const deployed = await deployContract(providers, {
        compiledContract: CompiledInitializableContract,
        privateStateId: InitializablePrivateStateId,
        initialPrivateState,
      });

      // Assert – transaction succeeded and on-chain state is consistent
      await expectSuccessfulDeployTx(providers, deployed.deployTxData, {
        compiledContract: CompiledInitializableContract,
        privateStateId: InitializablePrivateStateId,
        initialPrivateState,
      });

      // const ledgerState = await getLedgerState(
      //   providers,
      //   deployed.deployTxData.public.contractAddress
      // );
      // expect(ledgerState).toBe(0n);

      // const privateState = await providers.privateStateProvider.get(CounterPrivateStateId);
      // expect(privateState?.privateCounter).toBe(0);
    }, 6 * 60_000);
  });

  // ─── Circuits ────────────────────────────────────────────────────────────

  describe('increment circuit', () => {
    it('increments both ledger round and private counter [@slow]', async () => {
      // Arrange
      const deployed = await deployContract(providers, {
        compiledContract: CompiledCounterContract,
        privateStateId: CounterPrivateStateId,
        initialPrivateState: createInitialPrivateState(0),
      });
      const { contractAddress } = deployed.deployTxData.public;
      const roundBefore = await getLedgerState(providers, contractAddress);

      // Act
      const callTxData = await deployed.callTx.increment();

      // Assert
      await expectSuccessfulCallTx(providers, callTxData, { privateStateId: CounterPrivateStateId });

      const roundAfter = await getLedgerState(providers, contractAddress);
      expect(roundAfter).toBe((roundBefore ?? 0n) + 1n);

      const privateState = await providers.privateStateProvider.get(CounterPrivateStateId);
      expect(privateState?.privateCounter).toBe(1);
    }, 6 * 60_000);
  });

  describe('decrement circuit', () => {
    it('decrements the ledger round by the given amount [@slow]', async () => {
      // Arrange – deploy at round 0 then increment twice so there is room to decrement
      const deployed = await deployContract(providers, {
        compiledContract: CompiledCounterContract,
        privateStateId: CounterPrivateStateId,
        initialPrivateState: createInitialPrivateState(0),
      });
      await deployed.callTx.increment();
      await deployed.callTx.increment();
      const { contractAddress } = deployed.deployTxData.public;
      const roundBefore = await getLedgerState(providers, contractAddress);

      // Act
      const callTxData = await deployed.callTx.decrement(1n);

      // Assert
      await expectSuccessfulCallTx(providers, callTxData);

      const roundAfter = await getLedgerState(providers, contractAddress);
      expect(roundAfter).toBe((roundBefore ?? 2n) - 1n);
    }, 10 * 60_000);
  });

  describe('reset circuit', () => {
    it('resets the ledger round to zero [@slow]', async () => {
      // Arrange
      const deployed = await deployContract(providers, {
        compiledContract: CompiledCounterContract,
        privateStateId: CounterPrivateStateId,
        initialPrivateState: createInitialPrivateState(0),
      });
      await deployed.callTx.increment();
      const { contractAddress } = deployed.deployTxData.public;

      // Act
      const callTxData = await deployed.callTx.reset();

      // Assert
      await expectSuccessfulCallTx(providers, callTxData);

      const roundAfter = await getLedgerState(providers, contractAddress);
      expect(roundAfter).toBe(0n);
    }, 10 * 60_000);
  });

  // ─── findDeployedContract ─────────────────────────────────────────────────

  describe('findDeployedContract', () => {
    it('re-attaches to an already-deployed contract [@slow]', async () => {
      // Arrange – deploy once and record its address
      const deployed = await deployContract(providers, {
        compiledContract: CompiledCounterContract,
        privateStateId: CounterPrivateStateId,
        initialPrivateState: createInitialPrivateState(0),
      });
      const { contractAddress } = deployed.deployTxData.public;

      // Act – find the same contract by address
      const found = await findDeployedContract(providers, {
        compiledContract: CompiledCounterContract,
        contractAddress,
        privateStateId: CounterPrivateStateId,
      });

      // Assert – can still call circuits through the re-attached handle
      const callTxData = await found.callTx.increment();
      await expectSuccessfulCallTx(providers, callTxData);

      const ledgerState = await getLedgerState(providers, contractAddress);
      expect(ledgerState).toBe(1n);
    }, 10 * 60_000);
  });
});
