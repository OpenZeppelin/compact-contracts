#!/usr/bin/env node

import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import { CompactCompiler } from './Compiler.js';

/**
 * Executes the Compact compiler CLI with improved error handling and user feedback.
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
 * npx compact-compiler --dir security --skip-zk +0.24.0
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
 */
function handleError(error: unknown, spinner: Ora): void {
  if (error instanceof Error && error.name === 'CompactCliNotFoundError') {
    // Error already handled by validateEnvironment, just exit
    return;
  }

  if (error instanceof Error && error.name === 'DirectoryNotFoundError') {
    spinner.fail(chalk.red(`[COMPILE] Error: ${error.message}`));
    console.log(chalk.yellow('Available directories:'));
    console.log(
      chalk.yellow(' --dir access # Compile access control contracts'),
    );
    console.log(chalk.yellow('  --dir archive   # Compile archive contracts'));
    console.log(chalk.yellow('  --dir security  # Compile security contracts'));
    console.log(chalk.yellow('  --dir token     # Compile token contracts'));
    console.log(chalk.yellow('  --dir utils     # Compile utility contracts'));
    return;
  }

  if (error instanceof Error && error.name === 'CompilationError') {
    // Compilation errors are already handled by the compiler with detailed output
    return;
  }

  const errorMessage = error instanceof Error ? error.message : String(error);

  // Handle argument parsing errors
  if (errorMessage.includes('--dir flag requires a directory name')) {
    spinner.fail(
      chalk.red('[COMPILE] Error: --dir flag requires a directory name'),
    );
    showUsageHelp();
    return;
  }

  // Handle unexpected errors
  spinner.fail(chalk.red(`[COMPILE] Unexpected error: ${errorMessage}`));
  console.log(chalk.gray('\nIf this error persists, please check:'));
  console.log(chalk.gray('  • Compact CLI is installed and in PATH'));
  console.log(chalk.gray('  • Source files exist and are readable'));
  console.log(chalk.gray('  • Specified Compact version exists'));
  console.log(chalk.gray('  • File system permissions are correct'));
}

/**
 * Shows usage help with examples for different scenarios.
 */
function showUsageHelp(): void {
  console.log(chalk.yellow('\nUsage: compact-compiler [options]'));
  console.log(chalk.yellow('\nOptions:'));
  console.log(
    chalk.yellow(
      ' --dir <directory> Compile specific directory (access, archive, security, token, utils)',
    ),
  );
  console.log(chalk.yellow(' --skip-zk Skip zero-knowledge proof generation'));
  console.log(
    chalk.yellow(' +<version> Use specific toolchain version (e.g., +0.24.0)'),
  );
  console.log(chalk.yellow('\nExamples:'));
  console.log(chalk.yellow('  compact-compiler # Compile all files'));
  console.log(
    chalk.yellow(
      '  compact-compiler --dir security # Compile security directory',
    ),
  );
  console.log(
    chalk.yellow(
      '  compact-compiler --dir access --skip-zk # Compile access with flags',
    ),
  );
  console.log(
    chalk.yellow(
      '  SKIP_ZK=true compact-compiler --dir token # Use environment variable',
    ),
  );
  console.log(
    chalk.yellow('  compact-compiler --skip-zk +0.24.0 # Use specific version'),
  );
  console.log(chalk.yellow('\nTurbo integration:'));
  console.log(chalk.yellow(' turbo compact # Full build'));
  console.log(
    chalk.yellow(
      '  turbo compact:security -- --skip-zk # Directory with flags',
    ),
  );
  console.log(
    chalk.yellow('  SKIP_ZK=true turbo compact # Environment variables'),
  );
}

runCompiler();
