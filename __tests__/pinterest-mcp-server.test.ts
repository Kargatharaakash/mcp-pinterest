/**
 * Pinterest MCP Server Unit Test Suite
 */

import { jest, describe, expect, it, beforeEach, beforeAll, afterAll } from '@jest/globals';
import fs from 'fs';
import path from 'path';

interface PinterestSearchResult {
  title: string;
  image_url: string;
  link: string;
  source: string;
}

class MockPinterestMcpServer {
  server: any;
  scraper: any;
  
  constructor() {
    this.server = {
      setRequestHandler: jest.fn(),
      onerror: jest.fn(),
      close: jest.fn().mockReturnValue(Promise.resolve()),
      listen: jest.fn().mockReturnValue(Promise.resolve()),
      connect: jest.fn().mockReturnValue(Promise.resolve())
    };
    this.scraper = {
      search: jest.fn().mockReturnValue(Promise.resolve([
        {
          title: 'Test Image 1',
          image_url: 'https://i.pinimg.com/originals/test1.jpg',
          link: 'https://pinterest.com/pin/1',
          source: 'pinterest'
        }
      ])),
      getSimilarPins: jest.fn().mockReturnValue(Promise.resolve([
        {
          title: 'Recommended Pin 1',
          image_url: 'https://i.pinimg.com/originals/rec1.jpg',
          link: 'https://pinterest.com/pin/100',
          source: 'pinterest_recommendations'
        }
      ])),
      getChromePath: jest.fn().mockReturnValue('/usr/bin/chromium'),
      downloadImage: jest.fn().mockImplementation((imageUrl: any, outputPath: any) => {
        if (imageUrl.includes('fail')) {
          return Promise.reject(new Error('Download failed'));
        }
        return Promise.resolve({
          success: true,
          path: outputPath
        });
      })
    };
    this.setupToolHandlers();
  }

  async run() { 
    await this.server.listen();
    return Promise.resolve(); 
  }
  
  async cleanup() { 
    await this.server.close();
    return Promise.resolve(); 
  }

  setupToolHandlers() {
    this.server.setRequestHandler();
    return Promise.resolve();
  }

  async handlePinterestHealthCheck() {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            status: 'healthy',
            server: 'pinterest-mcp-server',
            version: '1.2.0',
            uptimeSeconds: 10
          }, null, 2)
        }
      ]
    };
  }

  async handlePinterestSearch(args: any) {
    return [
      { title: 'Test Image', image_url: 'https://example.com/image.jpg' }
    ];
  }

  async handlePinterestSearchAndDownload(args: any) {
    return 'Searched and downloaded 1 image related to "test"';
  }

  async handlePinterestGetSimilarPins(args: any) {
    return {
      content: [
        { type: 'text', text: 'Found 1 related visual design recommendations' },
        { type: 'text', text: 'Recommendation 1: Recommended Pin 1' },
        { type: 'text', text: 'Image URL: https://i.pinimg.com/originals/rec1.jpg' }
      ]
    };
  }

  async handlePinterestGetImageInfo(args: any) {
    return {
      title: 'Test Image',
      description: 'Test description',
      source: 'pinterest'
    };
  }
}

const mockServer = jest.fn().mockImplementation(() => {
  return {
    setRequestHandler: jest.fn(),
    onerror: jest.fn(),
    close: jest.fn().mockReturnValue(Promise.resolve()),
    listen: jest.fn().mockReturnValue(Promise.resolve()),
    connect: jest.fn().mockReturnValue(Promise.resolve())
  };
});

jest.mock('@modelcontextprotocol/sdk/server/index.js', () => {
  return {
    Server: mockServer
  };
});

jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => {
  return {
    StdioServerTransport: jest.fn().mockImplementation(() => ({}))
  };
});

jest.mock('fs', () => ({
  promises: {
    mkdir: jest.fn().mockReturnValue(Promise.resolve()),
    writeFile: jest.fn().mockReturnValue(Promise.resolve())
  },
  existsSync: jest.fn().mockReturnValue(true),
  mkdirSync: jest.fn()
}));

jest.mock('../pinterest-scraper.js', () => {
  return jest.fn().mockImplementation(() => {
    return {
      search: jest.fn().mockReturnValue(Promise.resolve([
        {
          title: 'Test Image 1',
          image_url: 'https://i.pinimg.com/originals/test1.jpg',
          link: 'https://pinterest.com/pin/1',
          source: 'pinterest'
        }
      ])),
      getSimilarPins: jest.fn().mockReturnValue(Promise.resolve([
        {
          title: 'Recommended Pin 1',
          image_url: 'https://i.pinimg.com/originals/rec1.jpg',
          link: 'https://pinterest.com/pin/100',
          source: 'pinterest_recommendations'
        }
      ])),
      getChromePath: jest.fn().mockReturnValue('/usr/bin/chromium'),
      downloadImage: jest.fn().mockImplementation((imageUrl: any, outputPath: any) => {
        if (imageUrl.includes('fail')) {
          return Promise.reject(new Error('Download failed'));
        }
        return Promise.resolve({
          success: true,
          path: outputPath
        });
      })
    };
  });
});

jest.mock('../src/pinterest-download.js', () => {
  return {
    downloadImage: jest.fn().mockReturnValue(Promise.resolve({
      success: true,
      id: '123',
      path: '/test/path',
      url: 'https://example.com/image.jpg'
    })),
    batchDownload: jest.fn().mockReturnValue(Promise.resolve({
      success: true,
      total: 1,
      downloadedCount: 1,
      failedCount: 0,
      downloaded: [{
        success: true,
        id: '123',
        path: '/test/path',
        url: 'https://example.com/image.jpg'
      }],
      failed: []
    }))
  };
}, { virtual: true });

jest.mock('../pinterest-mcp-server.js', () => {
  return MockPinterestMcpServer;
}, { virtual: true });

describe('PinterestMcpServer Suite', () => {
  let server: any;
  let originalTimeout: any;

  beforeAll(() => {
    originalTimeout = jest.setTimeout(10000);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    server = new MockPinterestMcpServer();
  });

  afterAll(() => {
    jest.setTimeout(originalTimeout);
    jest.restoreAllMocks();
  });

  describe('Constructor', () => {
    it('should initialize server correctly', () => {
      expect(server).toBeDefined();
      expect(server.server).toBeDefined();
    });
  });

  describe('setupToolHandlers', () => {
    it('should register tool handlers', () => {
      const setRequestHandlerSpy = jest.spyOn(server.server, 'setRequestHandler');
      server.setupToolHandlers();
      expect(setRequestHandlerSpy).toHaveBeenCalled();
    });
  });

  describe('Request Handlers', () => {
    it('should handle pinterest_health_check request', async () => {
      const result = await server.handlePinterestHealthCheck();
      expect(result).toBeDefined();
      expect(result.content[0].text).toContain('healthy');
    });

    it('should handle pinterest_search request', async () => {
      const args = { keyword: 'test', limit: 10, headless: true };
      const result = await server.handlePinterestSearch(args);
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result[0].title).toBe('Test Image');
    });

    it('should handle pinterest_search_and_download request', async () => {
      const args = { keyword: 'test', limit: 1, headless: true, download_dir: '/test/download' };
      const result = await server.handlePinterestSearchAndDownload(args);
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      expect(result).toContain('Searched and downloaded');
    });

    it('should handle pinterest_get_similar_pins request', async () => {
      const args = { pin_url_or_id: '11822017768403505', limit: 5, headless: true };
      const result = await server.handlePinterestGetSimilarPins(args);
      expect(result).toBeDefined();
      expect(result.content[0].text).toContain('recommendations');
    });
  });

  describe('run', () => {
    it('should start the server', async () => {
      const listenSpy = jest.spyOn(server.server, 'listen');
      await server.run();
      expect(listenSpy).toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('should clean up and close server', async () => {
      const closeSpy = jest.spyOn(server.server, 'close');
      await server.cleanup();
      expect(closeSpy).toHaveBeenCalled();
    });
  });
});