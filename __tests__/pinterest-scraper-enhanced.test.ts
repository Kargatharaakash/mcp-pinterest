/**
 * Enhanced Pinterest Scraper Test Suite
 */

import { jest, describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import fs from 'fs';
import sinon from 'sinon';
import puppeteer from 'puppeteer-core';
import PinterestScraper from '../pinterest-scraper.js';

describe('Enhanced PinterestScraper Test Suite', () => {
  let scraper: PinterestScraper;
  let writeFileSyncStub: sinon.SinonStub;
  let fetchStub: sinon.SinonStub;
  let existsSyncStub: sinon.SinonStub;
  let sandbox: sinon.SinonSandbox;
  
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    writeFileSyncStub = sandbox.stub(fs, 'writeFileSync');
    existsSyncStub = sandbox.stub(fs, 'existsSync').returns(true);
    
    fetchStub = sandbox.stub(global, 'fetch').resolves({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3, 4]).buffer)
    } as Response);
    
    const mockBrowser = {
      newPage: sinon.stub().resolves({
        setViewport: sinon.stub().resolves(undefined),
        setUserAgent: sinon.stub().resolves(undefined),
        setDefaultNavigationTimeout: sinon.stub(),
        setDefaultTimeout: sinon.stub(),
        setRequestInterception: sinon.stub().resolves(undefined),
        on: sinon.stub(),
        goto: sinon.stub().resolves(undefined),
        waitForSelector: sinon.stub().resolves(undefined),
        evaluate: sinon.stub().resolves([
          { title: 'Test Image 1', image_url: 'https://i.pinimg.com/236x/test1.jpg', link: 'https://pinterest.com/pin/1' },
          { title: 'Test Image 2', image_url: 'https://i.pinimg.com/236x/test2.jpg', link: 'https://pinterest.com/pin/2' }
        ]),
        removeAllListeners: sinon.stub()
      }),
      close: sinon.stub().resolves(undefined),
      process: sinon.stub(),
      createBrowserContext: sinon.stub(),
      browserContexts: [],
      defaultBrowserContext: sinon.stub(),
      version: sinon.stub().returns('1.0.0'),
      userAgent: sinon.stub().returns('Mozilla/5.0'),
      wsEndpoint: sinon.stub().returns('ws://localhost:1234'),
      target: sinon.stub(),
      targets: sinon.stub().returns([]),
      waitForTarget: sinon.stub(),
      pages: sinon.stub().resolves([])
    };
    
    sandbox.stub(puppeteer, 'launch').resolves(mockBrowser as any);
    scraper = new PinterestScraper();
  });
  
  afterEach(() => {
    sandbox.restore();
  });
  
  describe('Constructor & Initialization', () => {
    it('should initialize properties correctly', () => {
      expect(scraper.baseUrl).toBe('https://www.pinterest.com');
      expect(scraper.searchUrl).toBe('https://www.pinterest.com/search/pins/?q=');
      expect(scraper.chromePaths).toBeDefined();
    });
  });
  
  describe('search Method', () => {
    it('should return search results', async () => {
      const signal = null as unknown as AbortSignal;
      const results = await scraper.search('test keyword', 10, true, signal);
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
    });
    
    it('should handle empty keyword', async () => {
      const signal = null as unknown as AbortSignal;
      const results = await scraper.search('', 10, true, signal);
      expect(Array.isArray(results)).toBe(true);
    });
    
    it('should use default parameters', async () => {
      const signal = null as unknown as AbortSignal;
      const results = await scraper.search('test keyword', 10, true, signal);
      expect(Array.isArray(results)).toBe(true);
    });
    
    it('should handle cancellation signal', async () => {
      const controller = new AbortController();
      const signal = controller.signal;
      controller.abort();
      
      try {
        await scraper.search('test keyword', 10, true, signal);
        expect(true).toBe(false);
      } catch (error: any) {
        expect(error.message).toContain('Operation cancelled');
      }
    });
  });
  
  describe('search Method Advanced Scenarios', () => {
    it('should handle invalid arguments', async () => {
      const signal = null as unknown as AbortSignal;
      const results = await scraper.search(null as any, -1, true, signal);
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });
  });
  
  describe('autoScroll Method', () => {
    it('should perform auto scrolling', async () => {
      const mockPage = {
        evaluate: sinon.stub().resolves(undefined)
      };
      
      const signal = null as unknown as AbortSignal;
      await scraper.autoScroll(mockPage as any, 2000, signal);
      expect(mockPage.evaluate.called).toBe(true);
    });
    
    it('should handle cancellation signal', async () => {
      const mockPage = {
        evaluate: sinon.stub().resolves(undefined)
      };
      
      const controller = new AbortController();
      const signal = controller.signal;
      controller.abort();
      
      try {
        await scraper.autoScroll(mockPage as any, 2000, signal);
        expect(true).toBe(false);
      } catch (error: any) {
        expect(error.message).toContain('Operation cancelled');
      }
    });
    
    it('should handle page execution error', async () => {
      const mockPage = {
        evaluate: sinon.stub().rejects(new Error('Page execution error'))
      };
      
      const signal = null as unknown as AbortSignal;
      try {
        await scraper.autoScroll(mockPage as any, 2000, signal);
        expect(true).toBe(false);
      } catch (error: any) {
        expect(error.message).toBe('Page execution error');
      }
    });
  });
  
  describe('downloadImage Method', () => {
    it('should successfully download image', async () => {
      const signal = null as unknown as AbortSignal;
      const success = await scraper.downloadImage('https://i.pinimg.com/originals/test.jpg', '/tmp/test.jpg', signal);
      expect(success).toBe(true);
    });

    it('should handle empty URL or path', async () => {
      const signal = null as unknown as AbortSignal;
      const success = await scraper.downloadImage('', '/tmp/test.jpg', signal);
      expect(success).toBe(false);
    });

    it('should handle HTTP error response', async () => {
      fetchStub.resolves({ ok: false, status: 500 } as Response);
      const signal = null as unknown as AbortSignal;
      const success = await scraper.downloadImage('https://i.pinimg.com/originals/test.jpg', '/tmp/test.jpg', signal);
      expect(success).toBe(false);
    });

    it('should handle network fetch rejection', async () => {
      fetchStub.rejects(new Error('Network error'));
      const signal = null as unknown as AbortSignal;
      const success = await scraper.downloadImage('https://i.pinimg.com/originals/test.jpg', '/tmp/test.jpg', signal);
      expect(success).toBe(false);
    });

    it('should handle file write throw', async () => {
      writeFileSyncStub.throws(new Error('Write error'));
      const signal = null as unknown as AbortSignal;
      const success = await scraper.downloadImage('https://i.pinimg.com/originals/test.jpg', '/tmp/test.jpg', signal);
      expect(success).toBe(false);
    });

    it('should handle pre-aborted signal', async () => {
      const controller = new AbortController();
      controller.abort();
      const success = await scraper.downloadImage('https://i.pinimg.com/originals/test.jpg', '/tmp/test.jpg', controller.signal);
      expect(success).toBe(false);
    });
  });

  describe('transformImageUrl Method', () => {
    it('should convert thumbnail URLs to original resolution', () => {
      expect(scraper.transformImageUrl('https://i.pinimg.com/236x/test.jpg')).toBe('https://i.pinimg.com/originals/test.jpg');
    });

    it('should handle custom dimensions', () => {
      expect(scraper.transformImageUrl('https://i.pinimg.com/150x150/test.jpg')).toBe('https://i.pinimg.com/originals/test.jpg');
    });

    it('should preserve original image URLs', () => {
      expect(scraper.transformImageUrl('https://i.pinimg.com/originals/test.jpg')).toBe('https://i.pinimg.com/originals/test.jpg');
    });

    it('should handle empty input', () => {
      expect(scraper.transformImageUrl('')).toBe('');
    });
  });
});