#!/usr/bin/env node

import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import { CompactCompiler } from './Compiler.js';
import {
  type CompilationError,
  isPromisifiedChildProcessError,
} from './types/errors.js';

/**
 * Executes the Compact compiler CLI with improved error handling and user feedback.
 *
 * Error Handling Architecture:
 *
 * This CLI follows a layered error handling approach:
 *
 * - Business logic (Compiler.ts) throws structured errors with context.
 * - CLI layer (runCompiler.ts) handles all user-facing error presentation.
 * - Custom error types (types/errors.ts) provide semantic meaning and context.
 *
 * Benefits: Better testability, consistent UI, separation of concerns.
 *
 * Note: This compiler uses fail-fast error handling.
 * Compilation stops on the first error encountered.
 * This provides immediate feedback but doesn't attempt to compile remaining files after a failure.
 *
 * @example Individual module compilation
 * ```bash
 * npx compact-compiler --dir security --skip-zk
 * turbo compact:access -- --skip-zk
 * turbo compact:security -- --skip-zk --other-flag
 * ```
 *
 * @example Full compilation with environment variables
 * ```bash
 * SKIP_ZK=true turbo compact
 * turbo compact
 * ```
 *
 * @example Version specification
 * ```bash
 * npx compact-compiler --dir security --skip-zk +0.25.0
 * ```
 */
async function runCompiler(): Promise<void> {
  const spinner = ora(chalk.blue('[COMPILE] Compact compiler started')).info();

  try {
    const args = process.argv.slice(2);
    const compiler = CompactCompiler.fromArgs(args);
    await compiler.compile();
  } catch (error) {
    handleError(error, spinner);
    process.exit(1);
  }
}

/**
 * Centralized error handling with specific error types and user-friendly messages.
 *
 * Handles different error types with appropriate user feedback:
 *
 * - `CompactCliNotFoundError`: Shows installation instructions.
 * - `DirectoryNotFoundError`: Shows available directories.
 * - `CompilationError`: Shows file-specific error details with context.
 * - Environment validation errors: Shows troubleshooting tips.
 * - Argument parsing errors: Shows usage help.
 * - Generic errors: Shows general troubleshooting guidance.
 *
 * @param error - The error that occurred during compilation
 * @param spinner - Ora spinner instance for consistent UI messaging
 */
function handleError(error: unknown, spinner: Ora): void {
  // CompactCliNotFoundError
  if (error instanceof Error && error.name === 'CompactCliNotFoundError') {
    spinner.fail(chalk.red(`[COMPILE] Error: ${error.message}`));
    spinner.info(
      chalk.blue(
        `[COMPILE] Install with: curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh`,
      ),
    );
    return;
  }

  // DirectoryNotFoundError
  if (error instanceof Error && error.name === 'DirectoryNotFoundError') {
    spinner.fail(chalk.red(`[COMPILE] Error: ${error.message}`));
    showAvailableDirectories();
    return;
  }

  // CompilationError
  if (error instanceof Error && error.name === 'CompilationError') {
    // The compilation error details (file name, stdout/stderr) are already displayed
    // by `compileFile`; therefore, this just handles the final err state
    const compilationError = error as CompilationError;
    spinner.fail(
      chalk.red(
        `[COMPILE] Compilation failed for file: ${compilationError.file || 'unknown'}`,
      ),
    );

    if (isPromisifiedChildProcessError(compilationError.cause)) {
      const execError = compilationError.cause;
      if (
        execError.stderr &&
        !execError.stderr.includes('stdout') &&
        !execError.stderr.includes('stderr')
      ) {
        console.log(
          chalk.red(`    Additional error details: ${execError.stderr}`),
        );
      }
    }
    return;
  }

  // Env validation errors (non-CLI errors)
  if (isPromisifiedChildProcessError(error)) {
    spinner.fail(
      chalk.red(`[COMPILE] Environment validation failed: ${error.message}`),
    );
    console.log(chalk.gray('\nTroubleshooting:'));
    console.log(
      chalk.gray('  • Check that Compact CLI is installed and in PATH'),
    );
    console.log(chalk.gray('  • Verify the specified Compact version exists'));
    console.log(chalk.gray('  • Ensure you have proper permissions'));
    return;
  }

  // Arg parsing
  const errorMessage = error instanceof Error ? error.message : String(error);
  if (errorMessage.includes('--dir flag requires a directory name')) {
    spinner.fail(
      chalk.red('[COMPILE] Error: --dir flag requires a directory name'),
    );
    showUsageHelp();
    return;
  }

  // Unexpected errors
  spinner.fail(chalk.red(`[COMPILE] Unexpected error: ${errorMessage}`));
  console.log(chalk.gray('\nIf this error persists, please check:'));
  console.log(chalk.gray('  • Compact CLI is installed and in PATH'));
  console.log(chalk.gray('  • Source files exist and are readable'));
  console.log(chalk.gray('  • Specified Compact version exists'));
  console.log(chalk.gray('  • File system permissions are correct'));
}

/**
 * Shows available directories when `DirectoryNotFoundError` occurs.
 */
function showAvailableDirectories(): void {
  console.log(chalk.yellow('\nAvailable directories:'));
  console.log(
    chalk.yellow('  --dir access    # Compile access control contracts'),
  );
  console.log(chalk.yellow('  --dir archive   # Compile archive contracts'));
  console.log(chalk.yellow('  --dir security  # Compile security contracts'));
  console.log(chalk.yellow('  --dir token     # Compile token contracts'));
  console.log(chalk.yellow('  --dir utils     # Compile utility contracts'));
}

/**
 * Shows usage help with examples for different scenarios.
 */
function showUsageHelp(): void {
  console.log(chalk.yellow('\nUsage: compact-compiler [options]'));
  console.log(chalk.yellow('\nOptions:'));
  console.log(
    chalk.yellow(
      '  --dir <directory> Compile specific directory (access, archive, security, token, utils)',
    ),
  );
  console.log(
    chalk.yellow('  --skip-zk         Skip zero-knowledge proof generation'),
  );
  console.log(
    chalk.yellow(
      '  +<version>        Use specific toolchain version (e.g., +0.25.0)',
    ),
  );
  console.log(chalk.yellow('\nExamples:'));
  console.log(
    chalk.yellow(
      '  compact-compiler                           # Compile all files',
    ),
  );
  console.log(
    chalk.yellow(
      '  compact-compiler --dir security             # Compile security directory',
    ),
  );
  console.log(
    chalk.yellow(
      '  compact-compiler --dir access --skip-zk     # Compile access with flags',
    ),
  );
  console.log(
    chalk.yellow(
      '  SKIP_ZK=true compact-compiler --dir token   # Use environment variable',
    ),
  );
  console.log(
    chalk.yellow(
      '  compact-compiler --skip-zk +0.25.0          # Use specific version',
    ),
  );
  console.log(chalk.yellow('\nTurbo integration:'));
  console.log(
    chalk.yellow('  turbo compact                               # Full build'),
  );
  console.log(
    chalk.yellow(
      '  turbo compact:security -- --skip-zk         # Directory with flags',
    ),
  );
  console.log(
    chalk.yellow(
      '  SKIP_ZK=true turbo compact                  # Environment variables',
    ),
  );
}

runCompiler();
