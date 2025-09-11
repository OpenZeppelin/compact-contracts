#!/usr/bin/env node

import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import { BaseErrorHandler } from './BaseServices.js';
import { CompactCompiler } from './Compiler.js';
import {
  type CompilationError,
  isPromisifiedChildProcessError,
} from './types/errors.js';

/**
 * Main entry point for the Compact compiler CLI application.
 *
 * Orchestrates the complete compilation workflow from command-line argument
 * parsing through execution and error handling. Provides user-friendly feedback
 * and comprehensive error reporting for compilation operations.
 *
 * The function handles the full lifecycle:
 *
 * 1. Parses command-line arguments into compiler configuration.
 * 2. Executes the compilation process with progress indicators.
 * 3. Handles errors with detailed, actionable feedback.
 * 4. Exits with appropriate status codes for CI/CD integration.
 *
 * @example
 * ```bash
 * # Called from command line as:
 * compact-compiler --dir ./contracts/src/security --skip-zk +0.24.0
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
 * Comprehensive error handler for compilation-specific failures.
 *
 * Provides layered error handling that first attempts common error resolution
 * before falling back to compilation-specific error types. Ensures users receive
 * actionable feedback for all failure scenarios with appropriate visual styling
 * and contextual information.
 *
 * Error handling priority:
 *
 * 1. Common errors (CLI not found, directory issues, environment problems).
 * 2. Compilation-specific errors (file compilation failures).
 * 3. Argument parsing errors (malformed command-line usage).
 * 4. Unexpected errors (with troubleshooting guidance).
 *
 * @param error - The error that occurred during compilation
 * @param spinner - Ora spinner instance for consistent UI feedback
 *
 * @example
 * ```typescript
 * // This function handles errors like:
 * // - CompilationError: Failed to compile Token.compact
 * // - CompactCliNotFoundError: 'compact' CLI not found in PATH
 * // - DirectoryNotFoundError: Target directory contracts/ does not exist
 * ```
 */
function handleError(error: unknown, spinner: Ora): void {
  // Try common error handling first
  if (BaseErrorHandler.handleCommonErrors(error, spinner, 'COMPILE')) {
    return;
  }

  // CompilationError - specific to compilation
  if (error instanceof Error && error.name === 'CompilationError') {
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

  // Argument parsing specific to compilation
  const errorMessage = error instanceof Error ? error.message : String(error);
  if (errorMessage.includes('--dir flag requires a directory name')) {
    showUsageHelp();
    return;
  }

  // Unexpected errors
  BaseErrorHandler.handleUnexpectedError(error, spinner, 'COMPILE');
}

/**
 * Displays comprehensive usage help for the Compact compiler CLI.
 *
 * Provides detailed documentation of all available command-line options,
 * practical usage examples, and integration patterns. Helps users understand
 * both basic and advanced compilation scenarios, including environment variable
 * usage and toolchain version management.
 *
 * The help includes:
 *
 * - Complete option descriptions with parameter details.
 * - Practical examples for common compilation tasks.
 * - Integration patterns with build tools like Turbo.
 * - Environment variable configuration options.
 *
 * @example
 * ```typescript
 * // Called automatically when argument parsing fails:
 * // compact-compiler --dir  # Missing directory name
 * // Shows full usage help to guide correct usage
 * ```
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
      '  compact-compiler                            # Compile all files',
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
