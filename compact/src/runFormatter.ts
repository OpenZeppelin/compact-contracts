#!/usr/bin/env node

import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import { BaseErrorHandler } from './BaseServices.js';
import { CompactFormatter } from './Formatter.js';
import {
  type FormatterError,
  isPromisifiedChildProcessError,
} from './types/errors.js';

/**
 * Main entry point for the Compact formatter CLI binary.
 *
 * This file serves as the executable binary defined in package.json and is
 * invoked through build scripts via Turbo, Yarn, or direct command execution.
 * Acts as a lightweight wrapper around the `compact format` command, providing
 * environment validation and project-specific file discovery before delegating
 * to the underlying formatter tool.
 *
 * The function manages the wrapper lifecycle:
 *
 * 1. Validates environment (CLI availability, formatter compatibility).
 * 2. Discovers files within the project's src/ structure.
 * 3. Constructs and executes appropriate `compact format` commands.
 * 4. Handles environment errors while letting format errors pass through.
 *
 * @example
 * ```bash
 * # Direct binary execution:
 * ./node_modules/.bin/compact-formatter --check --dir security
 * ./node_modules/.bin/compact-formatter Token.compact AccessControl.compact
 *
 * # Via package.json scripts:
 * yarn format
 * yarn format:fix
 *
 * # Via Turbo:
 * turbo format
 * turbo format:fix
 * ```
 */
async function runFormatter(): Promise<void> {
  const spinner = ora(chalk.blue('[FORMAT] Compact formatter started')).info();

  try {
    const args = process.argv.slice(2);
    const formatter = CompactFormatter.fromArgs(args);
    await formatter.format();
  } catch (error) {
    handleError(error, spinner);
    process.exit(1);
  }
}

/**
 * Streamlined error handler focused on environment and setup issues.
 *
 * Since the underlying `compact format` command handles most user-facing errors
 * and feedback (including formatting differences and file processing failures),
 * this handler primarily focuses on environment validation errors and setup
 * issues that prevent the formatter from running.
 *
 * Error handling priority:
 *
 * 1. Common errors (CLI not found, directory issues, permissions).
 * 2. Formatter availability errors (toolchain version compatibility).
 * 3. Argument parsing errors (malformed command-line usage).
 * 4. Formatting errors (let the underlying tool's output show through).
 *
 * @param error - The error that occurred during formatter execution
 * @param spinner - Ora spinner instance for consistent UI feedback
 *
 * @example
 * ```typescript
 * // This function primarily handles setup errors like:
 * // - FormatterNotAvailableError: Formatter requires compiler 0.25.0+
 * // - CompactCliNotFoundError: 'compact' CLI not found in PATH
 * // - DirectoryNotFoundError: Target directory security/ does not exist
 *
 * // Formatting errors from `compact format` are displayed directly
 * ```
 */
function handleError(error: unknown, spinner: Ora): void {
  // Try common error handling first
  if (BaseErrorHandler.handleCommonErrors(error, spinner, 'FORMAT')) {
    return;
  }

  // FormatterNotAvailableError - specific to formatting
  if (error instanceof Error && error.name === 'FormatterNotAvailableError') {
    spinner.fail(chalk.red(`[FORMAT] Error: ${error.message}`));
    spinner.info(chalk.blue('[FORMAT] Update compiler with: compact update'));
    spinner.info(
      chalk.blue('[FORMAT] Update dev tools with: compact self update'),
    );
    return;
  }

  // FormatterError - let the underlying tool's output show through
  if (error instanceof Error && error.name === 'FormatterError') {
    const formatterError = error as FormatterError;

    // For most formatting errors, the underlying `compact format` command
    // already provides good user feedback, so we just show a simple failure message
    spinner.fail(chalk.red('[FORMAT] Formatting operation failed'));

    // Show additional details if available
    if (isPromisifiedChildProcessError(formatterError.cause)) {
      const execError = formatterError.cause;

      // The underlying compact format command output is usually sufficient,
      // but show additional details if they're helpful
      if (execError.stderr && !execError.stderr.includes('compact format')) {
        console.log(chalk.red(`    ${execError.stderr}`));
      }
      if (execError.stdout?.trim()) {
        console.log(chalk.yellow(`    ${execError.stdout}`));
      }
    }
    return;
  }

  // Argument parsing specific to formatting
  const errorMessage = error instanceof Error ? error.message : String(error);
  if (errorMessage.includes('--dir flag requires a directory name')) {
    showUsageHelp();
    return;
  }

  // Unexpected errors
  BaseErrorHandler.handleUnexpectedError(error, spinner, 'FORMAT');
}

/**
 * Displays comprehensive usage documentation for the Compact formatter CLI binary.
 *
 * Provides complete reference documentation for the package.json binary,
 * including all command-line options and integration examples. Emphasizes that
 * this is a wrapper around `compact format` that adds project-specific file
 * discovery and environment validation.
 *
 * The help documentation includes:
 *
 * - Wrapper-specific options (--dir for project structure).
 * - Direct binary execution examples.
 * - Package.json script integration patterns.
 * - Turbo and Yarn workflow examples.
 * - Reference to underlying `compact format` capabilities.
 *
 * @example
 * ```typescript
 * // Automatically displayed when argument parsing fails:
 * // compact-formatter --dir  # Missing directory name
 * // Shows complete usage guide including script integration examples
 * ```
 */
function showUsageHelp(): void {
  console.log(chalk.yellow('\nUsage: compact-formatter [options] [files...]'));
  console.log(chalk.yellow('\nOptions:'));
  console.log(
    chalk.yellow(
      '  --check           Check if files are properly formatted (default)',
    ),
  );
  console.log(
    chalk.yellow('  --write           Write formatting changes to files'),
  );
  console.log(
    chalk.yellow(
      '  --dir <directory> Format specific directory (access, archive, security, token, utils)',
    ),
  );
  console.log(chalk.yellow('\nExamples:'));
  console.log(
    chalk.yellow(
      '  compact-formatter                                    # Check all files (default)',
    ),
  );
  console.log(
    chalk.yellow(
      '  compact-formatter --write                            # Format all files',
    ),
  );
  console.log(
    chalk.yellow(
      '  compact-formatter --write --dir security             # Format security directory',
    ),
  );
  console.log(
    chalk.yellow(
      '  compact-formatter --dir access --check               # Check access directory',
    ),
  );
  console.log(
    chalk.yellow(
      '  compact-formatter --write f1.compact f2.compact      # Format specific files',
    ),
  );
  console.log(
    chalk.yellow(
      '  compact-formatter --check file1.compact              # Check specific file',
    ),
  );
}

runFormatter();
