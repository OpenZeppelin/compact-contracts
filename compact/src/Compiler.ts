#!/usr/bin/env node

import { exec as execCallback } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import { isPromisifiedChildProcessError } from './types/errors.ts';

const DIRNAME: string = dirname(fileURLToPath(import.meta.url));
const SRC_DIR: string = 'src';
const ARTIFACTS_DIR: string = 'src/artifacts';
const COMPACT_HOME: string =
  process.env.COMPACT_HOME ?? resolve(DIRNAME, '../compactc');
const COMPACTC_PATH: string = join(COMPACT_HOME, 'compactc');

/**
 * A class to handle compilation of `.compact` files using the `compactc` compiler.
 * Provides progress feedback and colored output for success and error states.
 *
 * @example
 * ```typescript
 * const compiler = new CompactCompiler('--skip-zk');
 * compiler.compile().catch(err => console.error(err));
 * ```
 *
 * @example Successful Compilation Output
 * ```
 * ℹ [COMPILE] Found 2 .compact file(s) to compile
 * ✔ [COMPILE] [1/2] Compiled AccessControl.compact
 *     Compactc version: 0.22.0
 * ✔ [COMPILE] [2/2] Compiled MockAccessControl.compact
 *     Compactc version: 0.22.0
 *     Compiling circuit "src/artifacts/MockAccessControl/zkir/grantRole.zkir"... (skipped proving keys)
 * ```
 *
 * @example Failed Compilation Output
 * ```
 * ℹ [COMPILE] Found 2 .compact file(s) to compile
 * ✖ [COMPILE] [1/2] Failed AccessControl.compact
 *     Compactc version: 0.22.0
 *     Error: Expected ';' at line 5 in AccessControl.compact
 * ```
 */
export class CompactCompiler {
  /** Stores the compiler flags passed via command-line arguments */
  private readonly flags: string;

  /**
   * Constructs a new CompactCompiler instance, validating the `compactc` binary path.
   *
   * @param flags - Space-separated string of `compactc` flags (e.g., "--skip-zk --no-communications-commitment")
   * @throws {Error} If the `compactc` binary is not found at the resolved path
   */
  constructor(flags: string) {
    this.flags = flags.trim();
    const spinner = ora();

    spinner.info(chalk.blue(`[COMPILE] COMPACT_HOME: ${COMPACT_HOME}`));
    spinner.info(chalk.blue(`[COMPILE] COMPACTC_PATH: ${COMPACTC_PATH}`));

    if (!existsSync(COMPACTC_PATH)) {
      spinner.fail(
        chalk.red(
          `[COMPILE] Error: compactc not found at ${COMPACTC_PATH}. Set COMPACT_HOME to the compactc binary path.`,
        ),
      );
      throw new Error(`compactc not found at ${COMPACTC_PATH}`);
    }
  }

  /**
   * Compiles all `.compact` files in the source directory and its subdirectories (e.g., `src/test/mock/`).
   * Scans the `src` directory recursively for `.compact` files, compiles each one using `compactc`,
   * and displays progress with a spinner and colored output.
   *
   * @returns A promise that resolves when all files are compiled successfully
   * @throws {Error} If compilation fails for any file
   */
  public async compile(): Promise<void> {
    const compactFiles: string[] = await this.getCompactFiles(SRC_DIR);

    const spinner = ora();
    if (compactFiles.length === 0) {
      spinner.warn(chalk.yellow('[COMPILE] No .compact files found.'));
      return;
    }

    spinner.info(
      chalk.blue(
        `[COMPILE] Found ${compactFiles.length} .compact file(s) to compile`,
      ),
    );

    for (const [index, file] of compactFiles.entries()) {
      await this.compileFile(file, index, compactFiles.length);
    }
  }

  /**
   * Recursively scans directory and returns an array of relative paths to `.compact`
   * files found within it.
   *
   * @param dir - The absolute or relative path to the directory to scan.
   * @returns A promise that resolves to an array of relative paths from `SRC_DIR`
   * to each `.compact` file.
   *
   * @throws Will log an error if a dir cannot be read or if a file or subdir
   * fails to be accessed. It will not reject the promise. Errors are handled
   * internally and skipped.
   */
  private async getCompactFiles(dir: string): Promise<string[]> {
    try {
      const dirents = await readdir(dir, { withFileTypes: true });
      const filePromises = dirents.map(async (entry) => {
        const fullPath = join(dir, entry.name);
        try {
          if (entry.isDirectory()) {
            return await this.getCompactFiles(fullPath);
          }

          if (entry.isFile() && fullPath.endsWith('.compact')) {
            return [relative(SRC_DIR, fullPath)];
          }
          return [];
        } catch (err) {
          console.warn(`Error accessing ${fullPath}:`, err);
          return [];
        }
      });

      const results = await Promise.all(filePromises);
      return results.flat();
    } catch (err) {
      console.error(`Failed to read dir: ${dir}`, err);
      return [];
    }
  }

  /**
   * Compiles a single `.compact` file.
   * Executes the `compactc` compiler with the provided flags, input file, and output directory.
   *
   * @param file - Relative path of the `.compact` file to compile (e.g., "test/mock/MockFile.compact")
   * @param index - Current file index (0-based) for progress display
   * @param total - Total number of files to compile for progress display
   * @returns A promise that resolves when the file is compiled successfully
   * @throws {Error} If compilation fails
   */
  private async compileFile(
    file: string,
    index: number,
    total: number,
  ): Promise<void> {
    const execAsync = promisify(execCallback);
    const inputPath: string = join(SRC_DIR, file);
    const outputDir: string = join(ARTIFACTS_DIR, basename(file, '.compact'));
    const step: string = `[${index + 1}/${total}]`;
    const spinner: Ora = ora(
      chalk.blue(`[COMPILE] ${step} Compiling ${file}`),
    ).start();

    try {
      const command: string =
        `${COMPACTC_PATH} ${this.flags} "${inputPath}" "${outputDir}"`.trim();
      spinner.text = chalk.blue(`[COMPILE] ${step} Running: ${command}`);
      const { stdout, stderr }: { stdout: string; stderr: string } =
        await execAsync(command);
      spinner.succeed(chalk.green(`[COMPILE] ${step} Compiled ${file}`));
      this.printOutput(stdout, chalk.cyan);
      this.printOutput(stderr, chalk.yellow);
    } catch (error: unknown) {
      spinner.fail(chalk.red(`[COMPILE] ${step} Failed ${file}`));
      if (isPromisifiedChildProcessError(error)) {
        this.printOutput(error.stdout, chalk.cyan);
        this.printOutput(error.stderr, chalk.red);
      }
      throw error;
    }
  }

  /**
   * Prints compiler output with indentation and specified color.
   *
   * @param output - The compiler output string to print (stdout or stderr)
   * @param colorFn - Chalk color function to style the output (e.g., `chalk.cyan` for success, `chalk.red` for errors)
   */
  private printOutput(output: string, colorFn: (text: string) => string): void {
    const lines: string[] = output
      .split('\n')
      .filter((line: string): boolean => line.trim() !== '')
      .map((line: string): string => `    ${line}`);
    // biome-ignore lint/suspicious/noConsoleLog: needed for debugging
    console.log(colorFn(lines.join('\n')));
  }
}
