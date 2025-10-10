#!/usr/bin/env node

import { exec as execCallback } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import {
  CompactCliNotFoundError,
  DirectoryNotFoundError,
  isPromisifiedChildProcessError,
} from './types/errors.ts';

/**
 * Default source directory containing .compact files.
 * All Compact operations expect source files to be in this directory.
 */
export const SRC_DIR: string = 'src';

/**
 * Default output directory for compiled artifacts.
 * Compilation results are written to subdirectories within this path.
 */
export const ARTIFACTS_DIR: string = 'artifacts';

/**
 * Function signature for executing shell commands.
 *
 * Enables dependency injection for testing and allows customization
 * of command execution behavior across different environments.
 *
 * @param command - The shell command to execute
 * @returns Promise resolving to command output with stdout and stderr
 */
export type ExecFunction = (
  command: string,
) => Promise<{ stdout: string; stderr: string }>;

/**
 * Abstract base class for validating Compact CLI environment.
 *
 * Provides common validation logic shared across different Compact operations
 * (compilation, formatting, etc.). Subclasses extend this with operation-specific
 * validation requirements.
 *
 * @example
 * ```typescript
 * class CompilerValidator extends BaseEnvironmentValidator {
 *   async validate(version?: string) {
 *     const { devToolsVersion } = await this.validateBase();
 *     const toolchainVersion = await this.getToolchainVersion(version);
 *     return { devToolsVersion, toolchainVersion };
 *   }
 * }
 * ```
 */
export abstract class BaseEnvironmentValidator {
  protected execFn: ExecFunction;

  /**
   * @param execFn - Command execution function (defaults to promisified child_process.exec)
   */
  constructor(execFn: ExecFunction = promisify(execCallback)) {
    this.execFn = execFn;
  }

  /**
   * Tests whether the Compact CLI is available in the system PATH.
   *
   * @returns Promise resolving to true if CLI is accessible, false otherwise
   */
  async checkCompactAvailable(): Promise<boolean> {
    try {
      await this.execFn('compact --version');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Retrieves the version string of the installed Compact developer tools.
   *
   * @returns Promise resolving to the trimmed version output
   * @throws Error if the version command fails
   */
  async getDevToolsVersion(): Promise<string> {
    const { stdout } = await this.execFn('compact --version');
    return stdout.trim();
  }

  /**
   * Performs base environment validation that all operations require.
   *
   * Verifies CLI availability and retrieves version information.
   * Subclasses should call this before performing operation-specific validation.
   *
   * @returns Promise resolving to base validation results
   * @throws CompactCliNotFoundError if CLI is not available in PATH
   */
  async validateBase(): Promise<{ devToolsVersion: string }> {
    const isAvailable = await this.checkCompactAvailable();
    if (!isAvailable) {
      throw new CompactCliNotFoundError(
        "'compact' CLI not found in PATH. Please install the Compact developer tools.",
      );
    }

    const devToolsVersion = await this.getDevToolsVersion();
    return { devToolsVersion };
  }

  /**
   * Operation-specific validation logic.
   *
   * Subclasses must implement this to perform validation requirements
   * specific to their operation (e.g., checking formatter availability,
   * validating compiler versions).
   *
   * @param args - Variable arguments for operation-specific validation
   * @returns Promise resolving to operation-specific validation results
   */
  abstract validate(...args: any[]): Promise<any>;
}

/**
 * Service for discovering .compact files within a directory tree.
 *
 * Recursively scans directories and returns relative paths to all .compact files
 * found. Used by both compilation and formatting operations to identify
 * target files for processing.
 *
 * @example
 * ```typescript
 * const discovery = new FileDiscovery();
 * const files = await discovery.getCompactFiles('src/contracts');
 * // Returns: ['Token.compact', 'security/AccessControl.compact']
 * ```
 */
export class FileDiscovery {
  /**
   * Recursively discovers all .compact files within a directory.
   *
   * Returns paths relative to SRC_DIR for consistent processing across
   * different operations. Gracefully handles access errors by logging
   * warnings and continuing with remaining files.
   *
   * @param dir - Directory path to search (can be relative or absolute)
   * @returns Promise resolving to array of relative file paths from SRC_DIR
   *
   * @example
   * ```typescript
   * // Search in specific subdirectory
   * const files = await discovery.getCompactFiles('src/contracts');
   *
   * // Search entire source tree
   * const allFiles = await discovery.getCompactFiles('src');
   * ```
   */
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
          // biome-ignore lint/suspicious/noConsole: Displaying path
          console.warn(`Error accessing ${fullPath}:`, err);
          return [];
        }
      });

      const results = await Promise.all(filePromises);
      return results.flat();
    } catch (err) {
      // biome-ignore lint/suspicious/noConsole: Displaying dir
      console.error(`Failed to read dir: ${dir}`, err);
      return [];
    }
  }
}

/**
 * Abstract base class for services that execute Compact CLI commands.
 *
 * Provides common patterns for command execution and error handling.
 * Subclasses implement operation-specific command construction while
 * inheriting consistent error handling and logging behavior.
 *
 * @example
 * ```typescript
 * class FormatterService extends BaseCompactService {
 *   async formatFiles(files: string[]) {
 *     const command = `compact format ${files.join(' ')}`;
 *     return this.executeCompactCommand(command, 'Failed to format files');
 *   }
 *
 *   protected createError(message: string, cause?: unknown): Error {
 *     return new FormatterError(message, cause);
 *   }
 * }
 * ```
 */
export abstract class BaseCompactService {
  protected execFn: ExecFunction;

  /**
   * @param execFn - Command execution function (defaults to promisified child_process.exec)
   */
  constructor(execFn: ExecFunction = promisify(execCallback)) {
    this.execFn = execFn;
  }

  /**
   * Executes a Compact CLI command with consistent error handling.
   *
   * Catches execution errors and wraps them in operation-specific error types
   * using the createError method. Provides consistent error context across
   * different operations.
   *
   * @param command - The complete command string to execute
   * @param errorContext - Human-readable context for error messages
   * @returns Promise resolving to command output
   * @throws Operation-specific error (created by subclass createError method)
   *
   * @example
   * ```typescript
   * // In a subclass:
   * const result = await this.executeCompactCommand(
   *   'compact format --check src/',
   *   'Failed to check formatting'
   * );
   * ```
   */
  protected async executeCompactCommand(
    command: string,
    errorContext: string,
  ): Promise<{ stdout: string; stderr: string }> {
    try {
      return await this.execFn(command);
    } catch (error: unknown) {
      let message: string;
      if (error instanceof Error) {
        message = error.message;
      } else {
        message = String(error);
      }

      throw this.createError(`${errorContext}: ${message}`, error);
    }
  }

  /**
   * Creates operation-specific error instances.
   *
   * Subclasses must implement this to return appropriate error types
   * (e.g., FormatterError, CompilationError) that provide operation-specific
   * context and error handling behavior.
   *
   * @dev Mostly for edge cases that aren't picked up by the dev tool error handling.
   *
   * @param message - Error message describing what failed
   * @param cause - Original error that triggered this failure (optional)
   * @returns Error instance appropriate for the operation
   */
  protected abstract createError(message: string, cause?: unknown): Error;
}

/**
 * Shared UI utilities for consistent styling across Compact operations.
 *
 * Provides common output formatting, progress indicators, and user feedback
 * patterns. Ensures all Compact tools have consistent visual appearance
 * and behavior.
 */
export const SharedUIService = {
  /**
   * Formats command output with consistent indentation and coloring.
   *
   * Filters empty lines and adds 4-space indentation to create visually
   * distinct output sections. Used for displaying stdout/stderr from
   * Compact CLI commands.
   *
   * @param output - Raw output text to format
   * @param colorFn - Chalk color function for styling the output
   *
   * @example
   * ```typescript
   * SharedUIService.printOutput(result.stdout, chalk.cyan);
   * SharedUIService.printOutput(result.stderr, chalk.red);
   * ```
   */
  printOutput(output: string, colorFn: (text: string) => string): void {
    const lines = output
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => `    ${line}`);
    console.log(colorFn(lines.join('\n')));
  },

  /**
   * Displays base environment information common to all operations.
   *
   * Shows developer tools version and optional target directory.
   * Called by operation-specific UI services to provide consistent
   * environment context.
   *
   * @param operation - Operation name for message prefixes (e.g., 'COMPILE', 'FORMAT')
   * @param devToolsVersion - Version string of installed Compact tools
   * @param targetDir - Optional target directory being processed
   */
  displayBaseEnvInfo(
    operation: string,
    devToolsVersion: string,
    targetDir?: string,
  ): void {
    const spinner = ora();

    if (targetDir) {
      spinner.info(chalk.blue(`[${operation}] TARGET_DIR: ${targetDir}`));
    }

    spinner.info(
      chalk.blue(`[${operation}] Compact developer tools: ${devToolsVersion}`),
    );
  },

  /**
   * Displays operation start message with file count and location.
   *
   * Provides user feedback when beginning to process multiple files.
   * Shows count of files found and optional location context.
   *
   * @param operation - Operation name for message prefixes
   * @param action - Action being performed (e.g., 'compile', 'format', 'check formatting for')
   * @param fileCount - Number of files being processed
   * @param targetDir - Optional directory being processed
   */
  showOperationStart(
    operation: string,
    action: string,
    fileCount: number,
    targetDir?: string,
  ): void {
    const searchLocation = targetDir ? ` in ${targetDir}/` : '';
    const spinner = ora();
    spinner.info(
      chalk.blue(
        `[${operation}] Found ${fileCount} .compact file(s) to ${action}${searchLocation}`,
      ),
    );
  },

  /**
   * Displays warning when no .compact files are found in target location.
   *
   * Provides clear feedback about search location and reminds users
   * where files are expected to be located.
   *
   * @param operation - Operation name for message prefixes
   * @param targetDir - Optional directory that was searched
   */
  showNoFiles(operation: string, targetDir?: string): void {
    const searchLocation = targetDir ? `${targetDir}/` : 'src/';
    const spinner = ora();
    spinner.warn(
      chalk.yellow(
        `[${operation}] No .compact files found in ${searchLocation}.`,
      ),
    );
  },

  /**
   * Shows available directory options when DirectoryNotFoundError occurs.
   *
   * Provides helpful context about valid directory names that can be
   * used with the --dir flag. Displayed after directory not found errors.
   *
   * @param operation - Operation name for contextualized help text
   */
  showAvailableDirectories(operation: string): void {
    console.log(chalk.yellow('\nAvailable directories:'));
    console.log(
      chalk.yellow(`  --dir access    # ${operation} access control contracts`),
    );
    console.log(
      chalk.yellow(`  --dir archive   # ${operation} archive contracts`),
    );
    console.log(
      chalk.yellow(`  --dir security  # ${operation} security contracts`),
    );
    console.log(
      chalk.yellow(`  --dir token     # ${operation} token contracts`),
    );
    console.log(
      chalk.yellow(`  --dir utils     # ${operation} utility contracts`),
    );
  },
};

/**
 * Abstract base class for Compact operations (compilation, formatting, etc.).
 *
 * Provides common infrastructure for file discovery, directory validation,
 * and argument parsing. Subclasses implement operation-specific logic while
 * inheriting shared patterns for working with .compact files.
 *
 * @example
 * ```typescript
 * class CompactFormatter extends BaseCompactOperation {
 *   constructor(writeMode = false, targets: string[] = [], execFn?: ExecFunction) {
 *     super(targets[0]); // Extract targetDir from targets
 *     // ... operation-specific setup
 *   }
 *
 *   async format() {
 *     await this.validateEnvironment();
 *     const { files } = await this.discoverFiles();
 *     // ... process files
 *   }
 * }
 * ```
 */
export abstract class BaseCompactOperation {
  protected readonly fileDiscovery: FileDiscovery;
  protected readonly targetDir?: string;

  /**
   * @param targetDir - Optional subdirectory within src/ to limit operation scope
   */
  constructor(targetDir?: string) {
    this.targetDir = targetDir;
    this.fileDiscovery = new FileDiscovery();
  }

  /**
   * Validates that the target directory exists (if specified).
   *
   * Only performs validation when targetDir is set. Throws DirectoryNotFoundError
   * if the specified directory doesn't exist, providing clear user feedback.
   *
   * @param searchDir - Full path to the directory that should exist
   * @throws DirectoryNotFoundError if targetDir is set but directory doesn't exist
   */
  protected validateTargetDirectory(searchDir: string): void {
    if (this.targetDir && !existsSync(searchDir)) {
      throw new DirectoryNotFoundError(
        `Target directory ${searchDir} does not exist`,
        searchDir,
      );
    }
  }

  /**
   * Determines the directory to search based on target configuration.
   *
   * @returns Full path to search directory (either SRC_DIR or SRC_DIR/targetDir)
   */
  protected getSearchDirectory(): string {
    return this.targetDir ? join(SRC_DIR, this.targetDir) : SRC_DIR;
  }

  /**
   * Discovers .compact files and handles common validation/feedback.
   *
   * Performs the complete file discovery workflow: validates directories,
   * discovers files, and handles empty results with appropriate user feedback.
   *
   * @returns Promise resolving to discovered files and search directory
   *
   * @example
   * ```typescript
   * const { files, searchDir } = await this.discoverFiles();
   * if (files.length === 0) return; // Already handled by showNoFiles()
   *
   * // Process discovered files...
   * ```
   */
  protected async discoverFiles(): Promise<{
    files: string[];
    searchDir: string;
  }> {
    const searchDir = this.getSearchDirectory();
    this.validateTargetDirectory(searchDir);

    const files = await this.fileDiscovery.getCompactFiles(searchDir);

    if (files.length === 0) {
      this.showNoFiles();
      return { files: [], searchDir };
    }

    return { files, searchDir };
  }

  /**
   * Validates the environment for this operation.
   *
   * Subclasses implement operation-specific validation (CLI availability,
   * tool versions, feature availability, etc.).
   */
  abstract validateEnvironment(): Promise<void>;

  /**
   * Displays operation-specific "no files found" message.
   *
   * Subclasses implement this to provide operation-appropriate messaging
   * when no .compact files are discovered.
   */
  abstract showNoFiles(): void;

  /**
   * Parses common command-line arguments shared across operations.
   *
   * Extracts --dir flag and returns remaining arguments for operation-specific
   * parsing. Provides consistent argument handling patterns across all tools.
   *
   * @param args - Raw command-line arguments array
   * @returns Parsed base arguments and remaining args for further processing
   * @throws Error if --dir flag is malformed
   *
   * @example
   * ```typescript
   * static fromArgs(args: string[]) {
   *   const { targetDir, remainingArgs } = this.parseBaseArgs(args);
   *
   *   // Process operation-specific flags from remainingArgs
   *   let writeMode = false;
   *   for (const arg of remainingArgs) {
   *     if (arg === '--write') writeMode = true;
   *   }
   *
   *   return new MyOperation(targetDir, writeMode);
   * }
   * ```
   */
  protected static parseBaseArgs(args: string[]): {
    targetDir?: string;
    remainingArgs: string[];
  } {
    let targetDir: string | undefined;
    const remainingArgs: string[] = [];

    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--dir') {
        const dirNameExists =
          i + 1 < args.length && !args[i + 1].startsWith('--');
        if (dirNameExists) {
          targetDir = args[i + 1];
          i++;
        } else {
          throw new Error('--dir flag requires a directory name');
        }
      } else {
        remainingArgs.push(args[i]);
      }
    }

    return { targetDir, remainingArgs };
  }
}

/**
 * Centralized error handling for CLI applications.
 *
 * Provides consistent error presentation and user guidance across all
 * Compact tools. Handles common error types with appropriate messaging
 * and recovery suggestions.
 */
export const BaseErrorHandler = {
  /**
   * Handles common error types that can occur across all operations.
   *
   * Processes errors that are shared between compilation, formatting, and
   * other operations. Returns true if the error was handled, false if
   * operation-specific handling is needed.
   *
   * @param error - Error that occurred during operation
   * @param spinner - Ora spinner instance for consistent UI messaging
   * @param operation - Operation name for contextualized error messages
   * @returns true if error was handled, false if caller should handle it
   *
   * @example
   * ```typescript
   * function handleError(error: unknown, spinner: Ora) {
   *   if (BaseErrorHandler.handleCommonErrors(error, spinner, 'COMPILE')) {
   *     return; // Error was handled
   *   }
   *
   *   // Handle operation-specific errors...
   * }
   * ```
   */
  handleCommonErrors(error: unknown, spinner: Ora, operation: string): boolean {
    // CompactCliNotFoundError
    if (error instanceof Error && error.name === 'CompactCliNotFoundError') {
      spinner.fail(chalk.red(`[${operation}] Error: ${error.message}`));
      spinner.info(
        chalk.blue(
          `[${operation}] Install with: curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh`,
        ),
      );
      return true;
    }

    // DirectoryNotFoundError
    if (error instanceof Error && error.name === 'DirectoryNotFoundError') {
      spinner.fail(chalk.red(`[${operation}] Error: ${error.message}`));
      SharedUIService.showAvailableDirectories(operation);
      return true;
    }

    // Environment validation errors
    if (isPromisifiedChildProcessError(error)) {
      spinner.fail(
        chalk.red(
          `[${operation}] Environment validation failed: ${error.message}`,
        ),
      );
      console.log(chalk.gray('\nTroubleshooting:'));
      console.log(
        chalk.gray('  • Check that Compact CLI is installed and in PATH'),
      );
      console.log(
        chalk.gray('  • Verify the specified Compact version exists'),
      );
      console.log(chalk.gray('  • Ensure you have proper permissions'));
      return true;
    }

    // Argument parsing errors
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('--dir flag requires a directory name')) {
      spinner.fail(
        chalk.red(`[${operation}] Error: --dir flag requires a directory name`),
      );
      return false; // Let specific handler show usage
    }

    return false; // Not handled, let specific handler deal with it
  },

  /**
   * Handles unexpected errors with generic troubleshooting guidance.
   *
   * Provides fallback error handling for errors not covered by common
   * error types. Shows general troubleshooting steps that apply to
   * most Compact operations.
   *
   * @param error - Unexpected error that occurred
   * @param spinner - Ora spinner instance for consistent UI messaging
   * @param operation - Operation name for contextualized error messages
   */
  handleUnexpectedError(error: unknown, spinner: Ora, operation: string): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    spinner.fail(chalk.red(`[${operation}] Unexpected error: ${errorMessage}`));

    console.log(chalk.gray('\nIf this error persists, please check:'));
    console.log(chalk.gray('  • Compact CLI is installed and in PATH'));
    console.log(chalk.gray('  • Source files exist and are readable'));
    console.log(chalk.gray('  • File system permissions are correct'));
  },
};
