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
  return error instanceof Error && 'stdout' in error && 'stderr' in error;
}
