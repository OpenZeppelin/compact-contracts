/**
 * Test setup script that compiles sample contracts before running tests.
 * Runs once before all tests via Vitest's globalSetup.
 */

import { exec, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SAMPLE_CONTRACTS_DIR = join(__dirname, 'fixtures', 'sample-contracts');
const ARTIFACTS_DIR = join(__dirname, 'fixtures', 'artifacts');

const CONTRACT_FILES = [
  'Simple.compact',
  'Witness.compact',
  'SampleZOwnable.compact',
];

function isSpawnSyncRet(
  err: unknown,
): err is SpawnSyncReturns<string | Buffer> {
  if (typeof err !== 'object' || err === null) {
    return false;
  }

  const typedErr = err as Partial<SpawnSyncReturns<string | Buffer>> &
    Record<string, unknown>;

  const okErr = typedErr.error instanceof Error;
  const okStdout =
    typeof typedErr.stdout === 'string' || Buffer.isBuffer(typedErr.stdout);
  const okStderr =
    typeof typedErr.stderr === 'string' || Buffer.isBuffer(typedErr.stderr);
  const okStatus =
    typeof typedErr.status === 'number' || typedErr.status === null;

  return okErr && okStdout && okStderr && okStatus;
}

async function compileContract(contractFile: string): Promise<void> {
  const inputPath = join(SAMPLE_CONTRACTS_DIR, contractFile);
  const contractName = contractFile.replace('.compact', '');
  const outputDir = join(ARTIFACTS_DIR, contractName);
  const contractArtifact = join(outputDir, 'contract', 'index.js');

  // Skip if artifact already exists and is newer than source
  if (existsSync(contractArtifact) && existsSync(inputPath)) {
    const artifactTime = statSync(contractArtifact).mtime;
    const sourceTime = statSync(inputPath).mtime;
    if (artifactTime >= sourceTime) {
      console.log(`✓ ${contractFile} (already compiled)`);
      return; // Already compiled and up to date
    }
  }

  if (!existsSync(inputPath)) {
    throw new Error(`Contract file not found: ${inputPath}`);
  }

  // Ensure output directory and keys subdirectory exist
  mkdirSync(outputDir, { recursive: true });
  mkdirSync(join(outputDir, 'keys'), { recursive: true });

  const command = `compact compile --skip-zk "${inputPath}" "${outputDir}"`;
  try {
    await execAsync(command);
  } catch (err: unknown) {
    if (!isSpawnSyncRet(err)) {
      throw err;
    }

    if (err.status === 127) {
      throw new Error(
        '`compact` not found (exit code 127). Is it installed and on PATH?',
      );
    }

    throw err;
  }

  console.log(`✓ Compiled ${contractFile}`);
}

async function setup(): Promise<void> {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });

  // Compile each contract sequentially
  for (const contractFile of CONTRACT_FILES) {
    await compileContract(contractFile);
  }
}

// Export setup function for Vitest's globalSetup
export default async function globalSetup(): Promise<void> {
  try {
    await setup();
  } catch (error) {
    console.log(`❌ Setup failed: ${error}`);
    process.exit(1);
  }
}
