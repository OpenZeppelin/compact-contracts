#!/usr/bin/env node

import { exec as execCallback } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { promisify } from 'node:util';
import chalk from 'chalk';
import ora from 'ora';
import { isPromisifiedChildProcessError, CompactCliNotFoundError, CompilationError, DirectoryNotFoundError } from './types/errors.ts';

const SRC_DIR: string = 'src';
const ARTIFACTS_DIR: string = 'artifacts';

export interface ExecFunction {
  (command: string): Promise<{ stdout: string; stderr: string }>;
}

export class EnvironmentValidator {
  private execFn: ExecFunction;

  constructor(execFn: ExecFunction = promisify(execCallback)) {
    this.execFn = execFn;
  }

  async checkCompactAvailable(): Promise<boolean> {
    try {
      await this.execFn('compact --version');
      return true;
    } catch {
      return false;
    }
  }

  async getDevToolsVersion(): Promise<string> {
    const { stdout } = await this.execFn('compact --version');
    return stdout.trim();
  }

  async getToolchainVersion(version?: string): Promise<string> {
    const versionFlag = version ? `+${version}` : '';
    const { stdout } = await this.execFn(`compact compile ${versionFlag} --version`);
    return stdout.trim();
  }

  async validate(version?: string): Promise<void> {
    const isAvailable = await this.checkCompactAvailable();
    if (!isAvailable) {
      throw new CompactCliNotFoundError(
        "'compact' CLI not found in PATH. Please install the Compact developer tools."
      );
    }

    // Get version info to verify CLI is working
    await this.getDevToolsVersion();
    await this.getToolchainVersion(version);
  }
}

export class FileDiscovery {
  async getCompactFiles(dir: string): Promise<string[]> {
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
}

export class CompilerService {
  private execFn: ExecFunction;

  constructor(execFn: ExecFunction = promisify(execCallback)) {
    this.execFn = execFn;
  }

  async compileFile(
    file: string,
    flags: string,
    version?: string,
  ): Promise<{ stdout: string; stderr: string }> {
    const inputPath = join(SRC_DIR, file);
    const outputDir = join(ARTIFACTS_DIR, basename(file, '.compact'));

    const versionFlag = version ? `+${version}` : '';
    const flagsStr = flags ? ` ${flags}` : '';
    const command = `compact compile${versionFlag ? ` ${versionFlag}` : ''}${flagsStr} "${inputPath}" "${outputDir}"`;

    try {
      return await this.execFn(command);
    } catch (error: unknown) {
      let message: string;

      if (error instanceof Error) {
        message = error.message;
      } else {
        message = String(error); // fallback for strings, objects, numbers, etc.
      }

      throw new CompilationError(`Failed to compile ${file}: ${message}`, file);
    }
  }
}

export class UIService {
  static printOutput(output: string, colorFn: (text: string) => string): void {
    const lines = output
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => `    ${line}`);
    console.log(colorFn(lines.join('\n')));
  }

  static showEnvironmentInfo(
    devToolsVersion: string,
    toolchainVersion: string,
    targetDir?: string,
    version?: string,
  ): void {
    const spinner = ora();

    if (targetDir) {
      spinner.info(chalk.blue(`[COMPILE] TARGET_DIR: ${targetDir}`));
    }

    spinner.info(chalk.blue(`[COMPILE] Compact developer tools: ${devToolsVersion}`));
    spinner.info(chalk.blue(`[COMPILE] Compact toolchain: ${toolchainVersion}`));

    if (version) {
      spinner.info(chalk.blue(`[COMPILE] Using toolchain version: ${version}`));
    }
  }

  static showCompilationStart(fileCount: number, targetDir?: string): void {
    const searchLocation = targetDir ? ` in ${targetDir}/` : '';
    const spinner = ora();
    spinner.info(
      chalk.blue(
        `[COMPILE] Found ${fileCount} .compact file(s) to compile${searchLocation}`,
      ),
    );
  }

  static showNoFiles(targetDir?: string): void {
    const searchLocation = targetDir ? `${targetDir}/` : '';
    const spinner = ora();
    spinner.warn(
      chalk.yellow(`[COMPILE] No .compact files found in ${searchLocation}.`),
    );
  }
}

/**
 * Main compiler class with improved separation of concerns and testability.
 */
export class CompactCompiler {
  private readonly environmentValidator: EnvironmentValidator;
  private readonly fileDiscovery: FileDiscovery;
  private readonly compilerService: CompilerService;

  private readonly flags: string;
  private readonly targetDir?: string;
  private readonly version?: string;

  constructor(
    flags: string = '',
    targetDir?: string,
    version?: string,
    execFn?: ExecFunction,
  ) {
    this.flags = flags.trim();
    this.targetDir = targetDir;
    this.version = version;
    this.environmentValidator = new EnvironmentValidator(execFn);
    this.fileDiscovery = new FileDiscovery();
    this.compilerService = new CompilerService(execFn);
  }

  /**
   * Factory method to create a CompactCompiler from command-line arguments.
   */
  static fromArgs(args: string[], env: NodeJS.ProcessEnv = process.env): CompactCompiler {
    let targetDir: string | undefined;
    let flags: string[] = [];
    let version: string | undefined;

    if (env.SKIP_ZK === 'true') {
      flags.push('--skip-zk');
    }

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--dir') {
        const dirNameExists = i + 1 < args.length && !args[i + 1].startsWith('--');
        if (dirNameExists) {
          targetDir = args[i + 1];
          i++;
        } else {
          throw new Error('--dir flag requires a directory name');
        }
      } else if (args[i].startsWith('+')) {
        version = args[i].slice(1);
      } else {
        flags.push(args[i]);
      }
    }

    return new CompactCompiler(flags.join(' '), targetDir, version);
  }

  /**
   * Validates the environment and shows version information.
   */
  async validateEnvironment(): Promise<void> {
    try {
      await this.environmentValidator.validate(this.version);

      const devToolsVersion = await this.environmentValidator.getDevToolsVersion();
      const toolchainVersion = await this.environmentValidator.getToolchainVersion(this.version);

      UIService.showEnvironmentInfo(devToolsVersion, toolchainVersion, this.targetDir, this.version);
    } catch (error) {
      const spinner = ora();

      if (error instanceof CompactCliNotFoundError) {
        spinner.fail(chalk.red(`[COMPILE] Error: ${error.message}`));
        spinner.info(
          chalk.blue(
            `[COMPILE] Install with: curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh`,
          ),
        );
      } else if (isPromisifiedChildProcessError(error)) {
        spinner.fail(chalk.red(`[COMPILE] Environment validation failed: ${error.message}`));
      } else if(error instanceof Error){
        spinner.fail(chalk.red(`[COMPILE] Unexpected error: ${error.message}`));
      } else {
        spinner.fail(chalk.red('An unknown, non-Error value was thrown.'));
      }

      throw error;
    }
  }

  /**
   * Main compilation method.
   */
  async compile(): Promise<void> {
    await this.validateEnvironment();

    const searchDir = this.targetDir ? join(SRC_DIR, this.targetDir) : SRC_DIR;

    // Validate target directory exists
    if (this.targetDir && !existsSync(searchDir)) {
      const spinner = ora();
      spinner.fail(
        chalk.red(`[COMPILE] Error: Target directory ${searchDir} does not exist.`),
      );
      throw new DirectoryNotFoundError(
        `Target directory ${searchDir} does not exist`,
        searchDir,
      );
    }

    const compactFiles = await this.fileDiscovery.getCompactFiles(searchDir);

    if (compactFiles.length === 0) {
      UIService.showNoFiles(this.targetDir);
      return;
    }

    UIService.showCompilationStart(compactFiles.length, this.targetDir);

    for (const [index, file] of compactFiles.entries()) {
      await this.compileFile(file, index, compactFiles.length);
    }
  }

  /**
   * Compiles a single file with progress reporting.
   */
  private async compileFile(file: string, index: number, total: number): Promise<void> {
    const step = `[${index + 1}/${total}]`;
    const spinner = ora(chalk.blue(`[COMPILE] ${step} Compiling ${file}`)).start();

    try {
      const result = await this.compilerService.compileFile(file, this.flags, this.version);

      spinner.succeed(chalk.green(`[COMPILE] ${step} Compiled ${file}`));
      UIService.printOutput(result.stdout, chalk.cyan);
      UIService.printOutput(result.stderr, chalk.yellow);
    } catch (error) {
      spinner.fail(chalk.red(`[COMPILE] ${step} Failed ${file}`));

      if (error instanceof CompilationError && isPromisifiedChildProcessError(error.cause)) {
        const execError = error.cause;
        UIService.printOutput(execError.stdout, chalk.cyan);
        UIService.printOutput(execError.stderr, chalk.red);
      }

      throw error;
    }
  }
}
