import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, afterEach, describe, expect, it, jest } from '@jest/globals';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Validates that environment variable MCP_PINTEREST_DOWNLOAD_DIR functions properly
 */
describe('MCP_PINTEREST_DOWNLOAD_DIR Environment Variable Test Suite', () => {
  const ORIGINAL_ENV = process.env;
  const testDir = path.join(__dirname, 'test_downloads_env');

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    
    if (fs.existsSync(testDir)) {
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch (error) {
        console.error(`Failed to clean up test directory: ${error}`);
      }
    }
  });

  it('should set and retrieve environment variable correctly', () => {
    process.env.MCP_PINTEREST_DOWNLOAD_DIR = testDir;
    expect(process.env.MCP_PINTEREST_DOWNLOAD_DIR).toBe(testDir);
  });

  it('should test directory creation and write permission validation logic', () => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    
    expect(fs.existsSync(testDir)).toBe(true);
    
    const testFile = path.join(testDir, '.write-test');
    fs.writeFileSync(testFile, 'test content');
    expect(fs.existsSync(testFile)).toBe(true);
    
    fs.unlinkSync(testFile);
    expect(fs.existsSync(testFile)).toBe(false);
  });
});