#!/usr/bin/env node

import chalk from 'chalk';
import ora from 'ora';
import { CompactCompiler } from './Compiler.js';

/**
 * Executes the Compact compiler CLI.
 * Compiles `.compact` files using the `CompactCompiler` class with provided flags.
 *
 * @example
 * ```bash
 * npx compact-compiler --skip-zk
 * ```
 *
 * @example Compile specific directory
 * ```bash
 * npx compact-compiler --dir security --skip-zk
 * ```
 *
 * Expected output:
 * ```
 * ℹ [COMPILE] Compact compiler started
 * ℹ [COMPILE] COMPACT_HOME: /path/to/compactc
 * ℹ [COMPILE] COMPACTC_PATH: /path/to/compactc/compactc
 * ℹ [COMPILE] TARGET_DIR: security
 * ℹ [COMPILE] Found 1 .compact file(s) to compile in security/
 * ✔ [COMPILE] [1/1] Compiled security/AccessControl.compact
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
            chalk.yellow('Example: compact-compiler --dir security --skip-zk'),
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
