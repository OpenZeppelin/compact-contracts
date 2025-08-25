#!/usr/bin/env node

import chalk from 'chalk';
import ora from 'ora';
import { CompactCompiler } from './Compiler.js';

/**
 * Executes the Compact compiler CLI.
 * Compiles `.compact` files using the `CompactCompiler` class with provided flags.
 *
 * Supports both CLI flags and environment variables for common development flags.
 * Environment variables take precedence and are useful when using with Turbo monorepo tasks.
 *
 * @example CLI usage with flags
 * ```bash
 * npx compact-compiler --skip-zk
 * ```
 *
 * @example Compile specific directory with CLI flags
 * ```bash
 * npx compact-compiler --dir access --skip-zk
 * ```
 *
 * @example Environment variable usage (recommended with Turbo)
 * ```bash
 * SKIP_ZK=true npx compact-compiler --dir access
 * ```
 *
 * @example Turbo monorepo usage
 * ```bash
 * # Compile specific module with skip-zk for development
 * SKIP_ZK=true turbo compact:access
 *
 * # Full build with skip-zk
 * SKIP_ZK=true turbo compact
 *
 * # Normal compilation without flags
 * turbo compact:access
 * ```
 *
 * Environment Variables:
 * - `SKIP_ZK=true`: Adds --skip-zk flag to compilation (skips zero-knowledge proof generation for faster development builds)
 *
 * Expected output:
 * ```
 * ℹ [COMPILE] Compact compiler started
 * ℹ [COMPILE] COMPACT_HOME: /path/to/compactc
 * ℹ [COMPILE] COMPACTC_PATH: /path/to/compactc/compactc
 * ℹ [COMPILE] TARGET_DIR: accesss:compact:access:
 * ℹ [COMPILE] Found 4 .compact file(s) to compile in access/
 * ✔ [COMPILE] [1/4] Compiled access/AccessControl.compact
 * ✔ [COMPILE] [2/4] Compiled access/Ownable.compact
 * ✔ [COMPILE] [3/4] Compiled access/test/mocks/MockAccessControl.compact
 * ✔ [COMPILE] [4/4] Compiled access/test/mocks/MockOwnable.compact
 *     Compactc version: 0.24.0
 * ```
 */
async function runCompiler(): Promise<void> {
  const spinner = ora(chalk.blue('[COMPILE] Compact Compiler started')).info();

  try {
    const args = process.argv.slice(2);

    // Parse arguments more robustly
    let targetDir: string | undefined;
    const compilerFlags: string[] = [];

    // Handle common development flags via environment variables
    // This is especially useful when using with Turbo monorepo tasks
    if (process.env.SKIP_ZK === 'true') {
      compilerFlags.push('--skip-zk');
    }

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--dir') {
        if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
          targetDir = args[i + 1];
          i++; // Skip the next argument (directory name)
        } else {
          spinner.fail(
            chalk.red('[COMPILE] Error: --dir flag requires a directory name'),
          );
          console.log(
            chalk.yellow(
              'Usage: compact-compiler --dir <directory> [other-flags]',
            ),
          );
          console.log(
            chalk.yellow('Example: compact-compiler --dir access --skip-zk'),
          );
          console.log(
            chalk.yellow('Example: SKIP_ZK=true compact-compiler --dir access'),
          );
          process.exit(1);
        }
      } else {
        // All other arguments are compiler flags
        compilerFlags.push(args[i]);
      }
    }

    const compiler = new CompactCompiler(compilerFlags.join(' '), targetDir);
    await compiler.compile();
  } catch (err) {
    spinner.fail(
      chalk.red('[COMPILE] Unexpected error:', (err as Error).message),
    );
    process.exit(1);
  }
}

runCompiler();
