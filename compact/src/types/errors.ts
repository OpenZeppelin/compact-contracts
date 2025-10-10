/**
 * A custom error that describes the shape of an error returned from a promisfied
 * child_process.exec
 *
 * @interface PromisifiedChildProcessError
 * @typedef {PromisifiedChildProcessError}
 * @extends {Error}
 *
 * @prop {string} stdout stdout of a child process
 * @prop {string} stderr stderr of a child process
 */
export interface PromisifiedChildProcessError extends Error {
  code?: number;
  stdout: string;
  stderr: string;
}

/**
 * A type guard function for PromisifiedChildProcessError
 *
 * @param {unknown} error - An error caught in a try catch block
 * @returns {error is PromisifiedChildProcessError} - Informs TS compiler if the understood
 * type is a PromisifiedChildProcessError
 */
export function isPromisifiedChildProcessError(
  error: unknown,
): error is PromisifiedChildProcessError {
  return (
    error instanceof Error &&
    typeof (error as any).stdout === 'string' &&
    typeof (error as any).stderr === 'string'
  );
}

/**
 * Custom error thrown when the Compact CLI is not found in the system PATH.
 * This error indicates that the Compact developer tools are not installed
 * or not properly configured in the environment.
 *
 * @class CompactCliNotFoundError
 * @extends Error
 */
export class CompactCliNotFoundError extends Error {
  /**
   * Creates a new CompactCliNotFoundError instance.
   *
   * @param message - Error message describing the CLI availability issue
   */
  constructor(message: string) {
    super(message);
    this.name = 'CompactCliNotFoundError';
  }
}

/**
 * Custom error thrown when compilation of a .compact file fails.
 * Contains additional context about which file failed to compile,
 * making it easier to identify and debug compilation issues.
 *
 * @class CompilationError
 * @extends Error
 */
export class CompilationError extends Error {
  public readonly file?: string;
  public readonly cause?: unknown;
  /**
   * Creates a new CompilationError instance.
   *
   * @param message - Error message describing the compilation failure
   * @param file - Optional relative path to the file that failed to compile
   */
  constructor(message: string, file?: string, cause?: unknown) {
    super(message, { cause });

    this.file = file;
    this.name = 'CompilationError';
    this.file = file;
    this.cause = cause;
  }
}

/**
 * Custom error thrown when a specified target directory does not exist.
 * Provides specific information about which directory was not found,
 * helping users correct path-related issues.
 *
 * @class DirectoryNotFoundError
 * @extends Error
 */
export class DirectoryNotFoundError extends Error {
  public readonly directory: string;

  /**
   * Creates a new DirectoryNotFoundError instance.
   *
   * @param message - Error message describing the directory issue
   * @param directory - The directory path that was not found
   */
  constructor(message: string, directory: string) {
    super(message);
    this.directory = directory;
    this.name = 'DirectoryNotFoundError';
  }
}

/**
 * Error thrown when the formatter is not available.
 * This typically occurs when the Compact compiler version is too old (< 0.25.0).
 */
export class FormatterNotAvailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormatterNotAvailableError';
  }
}

/**
 * Error thrown when formatting operations fail.
 * Includes the specific target (file or directory) that failed for context.
 */
export class FormatterError extends Error {
  /** The target file or directory that failed to format */
  public readonly target?: string;
  /** The underlying cause of the formatting failure */
  public readonly cause?: unknown;

  constructor(message: string, target?: string, cause?: unknown) {
    super(message);
    this.name = 'FormatterError';
    this.target = target;
    this.cause = cause;
  }
}
