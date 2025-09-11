import { join } from 'node:path';
import ora from 'ora';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { SRC_DIR } from '../src/BaseServices.js';
import {
  CompactFormatter,
  FormatterEnvironmentValidator,
  FormatterService,
  FormatterUIService,
} from '../src/Formatter.js';
import { FormatterError } from '../src/types/errors.js';

// Mock dependencies
vi.mock('chalk', () => ({
  default: {
    blue: vi.fn((text) => text),
    green: vi.fn((text) => text),
    red: vi.fn((text) => text),
    yellow: vi.fn((text) => text),
    cyan: vi.fn((text) => text),
    white: vi.fn((text) => text),
  },
}));

vi.mock('ora', () => ({
  default: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn(),
    fail: vi.fn(),
    info: vi.fn(),
  })),
}));

describe('FormatterEnvironmentValidator', () => {
  let validator: FormatterEnvironmentValidator;
  let mockExec: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExec = vi.fn();
    validator = new FormatterEnvironmentValidator(mockExec);
  });

  describe('checkFormatterAvailable', () => {
    it('succeeds when formatter is available', async () => {
      mockExec.mockResolvedValue({ stdout: 'Format help text', stderr: '' });

      await expect(validator.checkFormatterAvailable()).resolves.not.toThrow();
      expect(mockExec).toHaveBeenCalledWith('compact help format');
    });

    it('throws FormatterNotAvailableError when formatter not available', async () => {
      const error = Object.assign(new Error('Command failed'), {
        stderr: 'formatter not available',
        stdout: '',
        code: 1,
      });

      mockExec.mockRejectedValue(error);
      await expect(validator.checkFormatterAvailable()).rejects.toThrow(
        'Formatter not available',
      );
    });
  });

  describe('validate', () => {
    it('returns dev tools version when validation succeeds', async () => {
      const devToolsVersion = 'compact 0.2.0';

      mockExec
        .mockResolvedValueOnce({ stdout: devToolsVersion, stderr: '' }) // checkCompactAvailable
        .mockResolvedValueOnce({ stdout: devToolsVersion, stderr: '' }) // getDevToolsVersion
        .mockResolvedValueOnce({ stdout: 'Format help', stderr: '' }); // checkFormatterAvailable

      const result = await validator.validate();

      expect(result).toEqual({ devToolsVersion });
    });
  });
});

describe('FormatterService', () => {
  let service: FormatterService;
  let mockExec: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExec = vi.fn();
    service = new FormatterService(mockExec);
  });

  describe('format', () => {
    it('constructs command for check mode', async () => {
      const targets = ['security'];
      const response = { stdout: 'Check complete', stderr: '' };

      mockExec.mockResolvedValue(response);

      const result = await service.format(targets, true);

      expect(result).toEqual(response);
      expect(mockExec).toHaveBeenCalledWith(
        'compact format --check "security"',
      );
    });

    it('constructs command for write mode', async () => {
      const targets = ['security'];
      const response = { stdout: 'Format complete', stderr: '' };

      mockExec.mockResolvedValue(response);

      await service.format(targets, false);

      expect(mockExec).toHaveBeenCalledWith('compact format "security"');
    });

    it('constructs command without targets', async () => {
      mockExec.mockResolvedValue({ stdout: '', stderr: '' });

      await service.format([], false);

      expect(mockExec).toHaveBeenCalledWith('compact format');
    });

    it('constructs command with multiple targets', async () => {
      const targets = ['src/contracts', 'src/utils'];
      mockExec.mockResolvedValue({ stdout: '', stderr: '' });

      await service.format(targets, false);

      expect(mockExec).toHaveBeenCalledWith(
        'compact format "src/contracts" "src/utils"',
      );
    });

    it('throws FormatterError on failure', async () => {
      mockExec.mockRejectedValue(new Error('Format failed'));

      await expect(service.format(['security'], false)).rejects.toThrow(
        FormatterError,
      );
    });
  });

  describe('createError', () => {
    it('creates FormatterError', () => {
      const message = 'Failed to format';
      const error = service['createError'](message);

      expect(error).toBeInstanceOf(FormatterError);
      expect(error.message).toBe(message);
    });
  });
});

describe('FormatterUIService', () => {
  let mockSpinner: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSpinner = {
      info: vi.fn(),
      succeed: vi.fn(),
      fail: vi.fn(),
    };
    vi.mocked(ora).mockReturnValue(mockSpinner);
  });

  describe('displayEnvInfo', () => {
    it('displays environment information', () => {
      const devToolsVersion = 'compact 0.2.0';
      const targetDir = 'security';

      FormatterUIService.displayEnvInfo(devToolsVersion, targetDir);

      expect(mockSpinner.info).toHaveBeenCalledWith(
        '[FORMAT] TARGET_DIR: security',
      );
      expect(mockSpinner.info).toHaveBeenCalledWith(
        '[FORMAT] Compact developer tools: compact 0.2.0',
      );
    });
  });
});

describe('CompactFormatter', () => {
  let formatter: CompactFormatter;
  let mockExec: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExec = vi.fn();
  });

  describe('constructor', () => {
    it('creates instance with default parameters', () => {
      formatter = new CompactFormatter();

      expect(formatter.testCheckMode).toBe(true);
      expect(formatter.testSpecificFiles).toEqual([]);
    });

    it('creates instance with parameters', () => {
      const checkMode = false;
      const specificFiles = ['Token.compact'];
      const targetDir = 'security';

      formatter = new CompactFormatter(
        checkMode,
        specificFiles,
        targetDir,
        mockExec,
      );

      expect(formatter.testCheckMode).toBe(checkMode);
      expect(formatter.testSpecificFiles).toEqual(specificFiles);
    });
  });

  describe('fromArgs', () => {
    it('parses check mode', () => {
      formatter = CompactFormatter.fromArgs(['--check']);

      expect(formatter.testCheckMode).toBe(true);
    });

    it('parses specific files', () => {
      const args = ['Token.compact', 'AccessControl.compact'];
      formatter = CompactFormatter.fromArgs(args);

      expect(formatter.testSpecificFiles).toEqual(args);
    });

    it('parses directory and check mode', () => {
      formatter = CompactFormatter.fromArgs(['--dir', 'security', '--check']);

      expect(formatter.testCheckMode).toBe(true);
    });
  });

  describe('validateEnvironment', () => {
    it('validates environment successfully', async () => {
      const devToolsVersion = 'compact 0.2.0';

      mockExec
        .mockResolvedValueOnce({ stdout: devToolsVersion, stderr: '' })
        .mockResolvedValueOnce({ stdout: devToolsVersion, stderr: '' })
        .mockResolvedValueOnce({ stdout: 'Format help', stderr: '' });

      const displaySpy = vi
        .spyOn(FormatterUIService, 'displayEnvInfo')
        .mockImplementation(() => {});

      formatter = new CompactFormatter(false, [], 'security', mockExec);

      await formatter.validateEnvironment();

      expect(displaySpy).toHaveBeenCalledWith(devToolsVersion, 'security');
      displaySpy.mockRestore();
    });
  });

  describe('format', () => {
    it('formats specific files', async () => {
      const specificFiles = ['Token.compact'];
      formatter = new CompactFormatter(
        false,
        specificFiles,
        undefined,
        mockExec,
      );

      // Mock environment validation
      mockExec
        .mockResolvedValueOnce({ stdout: 'compact 0.2.0', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'compact 0.2.0', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'Format help', stderr: '' })
        // Mock format command
        .mockResolvedValueOnce({ stdout: 'Formatted', stderr: '' });

      const displaySpy = vi
        .spyOn(FormatterUIService, 'displayEnvInfo')
        .mockImplementation(() => {});

      await formatter.format();

      // Should call format with the specific file path
      expect(mockExec).toHaveBeenCalledWith(
        `compact format "${join(SRC_DIR, 'Token.compact')}"`,
      );
      displaySpy.mockRestore();
    });
  });
});
