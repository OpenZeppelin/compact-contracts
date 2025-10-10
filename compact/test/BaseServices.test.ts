import { join } from 'node:path';
import ora from 'ora';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import {
  BaseCompactOperation,
  BaseCompactService,
  BaseEnvironmentValidator,
  BaseErrorHandler,
  FileDiscovery,
  SharedUIService,
  SRC_DIR,
} from '../src/BaseServices.js';
import {
  CompactCliNotFoundError,
  DirectoryNotFoundError,
} from '../src/types/errors.js';

// Mock dependencies
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
}));

vi.mock('chalk', () => ({
  default: {
    blue: vi.fn((text) => text),
    yellow: vi.fn((text) => text),
    red: vi.fn((text) => text),
    gray: vi.fn((text) => text),
  },
}));

vi.mock('ora', () => ({
  default: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    fail: vi.fn(),
  })),
}));

// Mock spinner
const mockSpinner = {
  start: () => ({ succeed: vi.fn(), fail: vi.fn(), text: '' }),
  info: vi.fn(),
  warn: vi.fn(),
  fail: vi.fn(),
  succeed: vi.fn(),
};

// Impls for abstract classes
class TestEnvironmentValidator extends BaseEnvironmentValidator {
  async validate(): Promise<{ devToolsVersion: string }> {
    return this.validateBase();
  }
}

class TestCompactService extends BaseCompactService {
  async testCommand(
    command: string,
  ): Promise<{ stdout: string; stderr: string }> {
    return this.executeCompactCommand(command, 'Test operation failed');
  }

  protected createError(message: string, _cause?: unknown): Error {
    return new Error(message);
  }
}

class TestCompactOperation extends BaseCompactOperation {
  async validateEnvironment(): Promise<void> {}

  showNoFiles(): void {
    SharedUIService.showNoFiles('TEST', this.targetDir);
  }
}

describe('BaseEnvironmentValidator', () => {
  let validator: TestEnvironmentValidator;
  let mockExec: Mock;

  beforeEach(() => {
    mockExec = vi.fn();
    validator = new TestEnvironmentValidator(mockExec);
  });

  describe('checkCompactAvailable', () => {
    it('returns true when compact CLI is available', async () => {
      mockExec.mockResolvedValue({ stdout: 'compact 0.2.0', stderr: '' });

      const result = await validator.checkCompactAvailable();

      expect(result).toBe(true);
      expect(mockExec).toHaveBeenCalledWith('compact --version');
    });

    it('returns false when compact CLI is not available', async () => {
      mockExec.mockRejectedValue(new Error('Command not found'));

      const result = await validator.checkCompactAvailable();

      expect(result).toBe(false);
    });
  });

  describe('getDevToolsVersion', () => {
    it('returns trimmed version string', async () => {
      mockExec.mockResolvedValue({ stdout: '  compact 0.2.0  \n', stderr: '' });

      const version = await validator.getDevToolsVersion();

      expect(version).toBe('compact 0.2.0');
    });
  });

  describe('validateBase', () => {
    it('returns version when CLI is available', async () => {
      mockExec.mockResolvedValue({ stdout: 'compact 0.2.0', stderr: '' });

      const result = await validator.validateBase();

      expect(result).toEqual({ devToolsVersion: 'compact 0.2.0' });
    });

    it('throws CompactCliNotFoundError when CLI is not available', async () => {
      mockExec.mockRejectedValue(new Error('Command not found'));

      await expect(validator.validateBase()).rejects.toThrow(
        CompactCliNotFoundError,
      );
    });
  });
});

describe('FileDiscovery', () => {
  let fileDiscovery: FileDiscovery;
  let mockReaddir: Mock;

  beforeEach(async () => {
    fileDiscovery = new FileDiscovery();
    mockReaddir = vi.mocked(await import('node:fs/promises')).readdir;
  });

  it('discovers .compact files recursively', async () => {
    mockReaddir
      .mockResolvedValueOnce([
        {
          name: 'MyToken.compact',
          isFile: () => true,
          isDirectory: () => false,
        },
        { name: 'access', isFile: () => false, isDirectory: () => true },
      ] as any)
      .mockResolvedValueOnce([
        {
          name: 'AccessControl.compact',
          isFile: () => true,
          isDirectory: () => false,
        },
      ] as any);

    const files = await fileDiscovery.getCompactFiles('src');

    expect(files).toEqual(['MyToken.compact', 'access/AccessControl.compact']);
  });

  it('filters out non-compact files', async () => {
    mockReaddir.mockResolvedValue([
      { name: 'MyToken.compact', isFile: () => true, isDirectory: () => false },
      { name: 'README.md', isFile: () => true, isDirectory: () => false },
      { name: 'package.json', isFile: () => true, isDirectory: () => false },
    ] as any);

    const files = await fileDiscovery.getCompactFiles('src');

    expect(files).toEqual(['MyToken.compact']);
  });

  it('handles empty directories', async () => {
    mockReaddir.mockResolvedValue([]);

    const files = await fileDiscovery.getCompactFiles('src');

    expect(files).toEqual([]);
  });

  it('handles readdir errors gracefully', async () => {
    mockReaddir.mockRejectedValue(new Error('You shall not pass!'));

    const files = await fileDiscovery.getCompactFiles('src');

    expect(files).toEqual([]);
  });
});

describe('BaseCompactService', () => {
  let service: TestCompactService;
  let mockExec: Mock;

  beforeEach(() => {
    mockExec = vi.fn();
    service = new TestCompactService(mockExec);
  });

  it('executes command successfully', async () => {
    const expectedResult = { stdout: 'Success', stderr: '' };
    mockExec.mockResolvedValue(expectedResult);

    const result = await service.testCommand('compact test');

    expect(result).toEqual(expectedResult);
    expect(mockExec).toHaveBeenCalledWith('compact test');
  });

  it('handles command execution errors', async () => {
    const errMsg = 'Command failed';
    mockExec.mockRejectedValue(new Error(errMsg));

    await expect(service.testCommand('compact test')).rejects.toThrow(
      `Test operation failed: ${errMsg}`,
    );
  });

  it('handles non-Error rejections', async () => {
    const otherMsg = 'String error';
    mockExec.mockRejectedValue(otherMsg);

    await expect(service.testCommand('compact test')).rejects.toThrow(
      `Test operation failed: ${otherMsg}`,
    );
  });
});

describe('SharedUIService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('printOutput', () => {
    it('formats output with indentation', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const colorFn = (text: string) => `colored: ${text}`;

      // Split, filter, map
      SharedUIService.printOutput('line1\nline2\n\nline3', colorFn);

      expect(consoleSpy).toHaveBeenCalledWith(
        'colored:     line1\n    line2\n    line3',
      );
      consoleSpy.mockRestore();
    });

    it('filters empty lines', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const colorFn = (text: string) => text;

      SharedUIService.printOutput('line1\n\n\nline2', colorFn);

      expect(consoleSpy).toHaveBeenCalledWith('    line1\n    line2');
      consoleSpy.mockRestore();
    });
  });

  describe('displayBaseEnvInfo', () => {
    const testData = {
      operation: 'TEST',
      version: 'compact 0.2.0',
      targetDir: 'security',
    };
    const { operation, version, targetDir } = testData;

    it('displays environment info with target directory', () => {
      vi.mocked(ora).mockReturnValue(mockSpinner as any);

      SharedUIService.displayBaseEnvInfo(operation, version, targetDir);

      expect(ora).toHaveBeenCalled();
      expect(mockSpinner.info).toHaveBeenCalledTimes(2);
      expect(mockSpinner.info).toHaveBeenNthCalledWith(
        1,
        `[${operation}] TARGET_DIR: ${targetDir}`,
      );
      expect(mockSpinner.info).toHaveBeenNthCalledWith(
        2,
        `[${operation}] Compact developer tools: ${version}`,
      );
    });

    it('displays environment info without target directory', () => {
      vi.mocked(ora).mockReturnValue(mockSpinner as any);

      SharedUIService.displayBaseEnvInfo(operation, version);

      expect(ora).toHaveBeenCalled();
      expect(mockSpinner.info).toHaveBeenCalledExactlyOnceWith(
        `[${operation}] Compact developer tools: ${version}`,
      );
    });
  });

  describe('showOperationStart', () => {
    const testData = {
      operation: 'TEST',
      action: 'compact 0.2.0',
      fileCount: 5,
      targetDir: 'security',
    };
    const { operation, action, fileCount, targetDir } = testData;

    it('displays operation start message with targetDir', () => {
      vi.mocked(ora).mockReturnValue(mockSpinner as any);

      SharedUIService.showOperationStart(
        operation,
        action,
        fileCount,
        targetDir,
      );
      expect(ora).toHaveBeenCalled();
      expect(mockSpinner.info).toHaveBeenCalledExactlyOnceWith(
        `[${operation}] Found ${fileCount} .compact file(s) to ${action} in ${targetDir}/`,
      );
    });

    it('displays operation start message without targetDir', () => {
      const mockSpinner = { info: vi.fn() };
      vi.mocked(ora).mockReturnValue(mockSpinner as any);

      SharedUIService.showOperationStart(operation, action, fileCount);

      expect(ora).toHaveBeenCalled();
      expect(mockSpinner.info).toHaveBeenCalledExactlyOnceWith(
        `[${operation}] Found ${fileCount} .compact file(s) to ${action}`,
      );
    });
  });

  describe('showNoFiles', () => {
    const testData = {
      operation: 'TEST',
      targetDir: 'security',
    };
    const { operation, targetDir } = testData;

    it('shows no files warning with targetDir', () => {
      vi.mocked(ora).mockReturnValue(mockSpinner as any);

      SharedUIService.showNoFiles(operation, targetDir);

      expect(ora).toHaveBeenCalled();
      expect(mockSpinner.warn).toHaveBeenCalledExactlyOnceWith(
        `[${operation}] No .compact files found in ${targetDir}/.`,
      );
    });

    it('shows no files warning without targetDir', () => {
      vi.mocked(ora).mockReturnValue(mockSpinner as any);

      SharedUIService.showNoFiles(operation);

      expect(ora).toHaveBeenCalled();
      expect(mockSpinner.warn).toHaveBeenCalledExactlyOnceWith(
        `[${operation}] No .compact files found in src/.`,
      );
    });
  });

  describe('showAvailableDirectories', () => {
    it('shows available directories', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const operation = 'TEST';

      SharedUIService.showAvailableDirectories(operation);

      expect(consoleSpy).toHaveBeenNthCalledWith(1, '\nAvailable directories:');
      expect(consoleSpy).toHaveBeenNthCalledWith(
        2,
        `  --dir access    # ${operation} access control contracts`,
      );
      expect(consoleSpy).toHaveBeenNthCalledWith(
        3,
        `  --dir archive   # ${operation} archive contracts`,
      );
      expect(consoleSpy).toHaveBeenNthCalledWith(
        4,
        `  --dir security  # ${operation} security contracts`,
      );
      expect(consoleSpy).toHaveBeenNthCalledWith(
        5,
        `  --dir token     # ${operation} token contracts`,
      );
      expect(consoleSpy).toHaveBeenNthCalledWith(
        6,
        `  --dir utils     # ${operation} utility contracts`,
      );
      consoleSpy.mockRestore();
    });
  });
});

describe('BaseCompactOperation', () => {
  let operation: TestCompactOperation;
  let mockExistsSync: Mock;

  beforeEach(async () => {
    operation = new TestCompactOperation('security');
    mockExistsSync = vi.mocked(await import('node:fs')).existsSync;
  });

  describe('validateTargetDirectory', () => {
    it('passes when target directory exists', () => {
      mockExistsSync.mockReturnValue(true);

      expect(() =>
        operation['validateTargetDirectory']('src/security'),
      ).not.toThrow();
    });

    it('throws when target directory does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      const missingDir = 'src/missingDir';
      const expErr = new DirectoryNotFoundError(
        `Target directory ${missingDir} does not exist`,
        missingDir,
      );

      expect(() => operation['validateTargetDirectory'](missingDir)).toThrow(
        expErr,
      );
    });

    it('does not validate when no target directory is set', () => {
      const noTargetOperation = new TestCompactOperation();
      mockExistsSync.mockReturnValue(false);

      expect(() =>
        noTargetOperation['validateTargetDirectory']('src'),
      ).not.toThrow();
    });
  });

  describe('getSearchDirectory', () => {
    it('returns targetDir path when set', () => {
      const result = operation['getSearchDirectory']();
      expect(result).toBe(join(SRC_DIR, 'security'));
    });

    it('returns SRC_DIR when no targetDir', () => {
      const noTargetOperation = new TestCompactOperation();
      const result = noTargetOperation['getSearchDirectory']();
      expect(result).toBe(SRC_DIR);
    });
  });

  describe('parseBaseArgs', () => {
    it('parses --dir argument correctly', () => {
      const args = ['--dir', 'security', '--other-flag'];

      const result = BaseCompactOperation['parseBaseArgs'](args);

      expect(result).toEqual({
        targetDir: 'security',
        remainingArgs: ['--other-flag'],
      });
    });

    it('throws error when --dir has no value', () => {
      const args = ['--dir'];

      expect(() => BaseCompactOperation['parseBaseArgs'](args)).toThrow(
        '--dir flag requires a directory name',
      );
    });

    it('throws error when --dir value starts with --', () => {
      const args = ['--dir', '--other-flag'];

      expect(() => BaseCompactOperation['parseBaseArgs'](args)).toThrow(
        '--dir flag requires a directory name',
      );
    });

    it('handles arguments without --dir', () => {
      const args = ['--flag1', 'value1', '--flag2'];

      const result = BaseCompactOperation['parseBaseArgs'](args);

      expect(result).toEqual({
        targetDir: undefined,
        remainingArgs: ['--flag1', 'value1', '--flag2'],
      });
    });
  });
});

describe('BaseErrorHandler', () => {
  let mockSpinner: any;

  beforeEach(() => {
    mockSpinner = {
      fail: vi.fn(),
      info: vi.fn(),
    };
  });

  describe('handleCommonErrors', () => {
    const operation = 'TEST';

    it('handles CompactCliNotFoundError', () => {
      const error = new CompactCliNotFoundError('CLI not found');
      const result = BaseErrorHandler.handleCommonErrors(
        error,
        mockSpinner,
        operation,
      );

      expect(result).toBe(true);
      expect(mockSpinner.fail).toHaveBeenCalledWith(
        expect.stringContaining(`[${operation}] Error: CLI not found`),
      );
      expect(mockSpinner.info).toHaveBeenCalledWith(
        expect.stringContaining(`[${operation}] Install with:`),
      );
    });

    it('handles DirectoryNotFoundError', () => {
      const error = new DirectoryNotFoundError('Directory not found', '/path');

      const result = BaseErrorHandler.handleCommonErrors(
        error,
        mockSpinner,
        operation,
      );

      expect(result).toBe(true);
      expect(mockSpinner.fail).toHaveBeenCalledWith(
        expect.stringContaining(`[${operation}] Error: Directory not found`),
      );
    });

    it('handles promisified child process errors', () => {
      const error = Object.assign(new Error('Command failed'), {
        stdout: 'stdout',
        stderr: 'stderr',
        code: 1,
      });

      const result = BaseErrorHandler.handleCommonErrors(
        error,
        mockSpinner,
        operation,
      );

      expect(result).toBe(true);
      expect(mockSpinner.fail).toHaveBeenCalledExactlyOnceWith(
        expect.stringContaining(`[${operation}] Environment validation failed`),
      );
    });

    it('handles --dir argument parsing errors', () => {
      const error = new Error('--dir flag requires a directory name');

      const result = BaseErrorHandler.handleCommonErrors(
        error,
        mockSpinner,
        operation,
      );

      expect(result).toBe(false); // Should let specific handler show usage
      expect(mockSpinner.fail).toHaveBeenCalledWith(
        expect.stringContaining(
          `[${operation}] Error: --dir flag requires a directory name`,
        ),
      );
    });

    it('returns false for unhandled errors', () => {
      const error = new Error('Some other error');

      const result = BaseErrorHandler.handleCommonErrors(
        error,
        mockSpinner,
        operation,
      );

      expect(result).toBe(false);
    });
  });

  describe('handleUnexpectedError', () => {
    const operation = 'TEST';

    it('handles Error objects', () => {
      const error = new Error('Unexpected error');

      BaseErrorHandler.handleUnexpectedError(error, mockSpinner, operation);

      expect(mockSpinner.fail).toHaveBeenCalledWith(
        expect.stringContaining(
          `[${operation}] Unexpected error: Unexpected error`,
        ),
      );
    });

    it('handles non-Error values', () => {
      const error = 'String error';

      BaseErrorHandler.handleUnexpectedError(error, mockSpinner, operation);

      expect(mockSpinner.fail).toHaveBeenCalledWith(
        expect.stringContaining(
          `[${operation}] Unexpected error: String error`,
        ),
      );
    });

    it('displays troubleshooting information', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const error = new Error('Test error');

      BaseErrorHandler.handleUnexpectedError(error, mockSpinner, operation);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('If this error persists'),
      );
      consoleSpy.mockRestore();
    });
  });
});
