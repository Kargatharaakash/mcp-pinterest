/**
 * Pinterest Scraper Code Coverage Test Suite
 */

import { jest, describe, it, expect, beforeEach, afterEach, afterAll } from '@jest/globals';
import sinon from 'sinon';
import fs from 'fs';
import puppeteer from 'puppeteer-core';
import PinterestScraper from '../pinterest-scraper.js';

describe('PinterestScraper Code Coverage Tests', () => {
  let scraper;
  let sandbox;
  
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    
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
        removeAllListeners: sinon.stub(),
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
    
    sandbox.stub(puppeteer, 'launch').resolves(mockBrowser);
    sandbox.stub(fs, 'writeFileSync');
    sandbox.stub(fs, 'existsSync').returns(true);
    sandbox.stub(fs, 'mkdirSync');
    
    global.originalFetch = global.fetch;
    global.fetch = sandbox.stub().resolves({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(Buffer.from('Test Image Data').buffer)
    });
    
    scraper = new PinterestScraper();
  });
  
  afterEach(() => {
    sandbox.restore();
    if (global.originalFetch) {
      global.fetch = global.originalFetch;
    }
  });
  
  describe('Constructor', () => {
    it('should initialize properties correctly', () => {
      expect(scraper.baseUrl).toBe('https://www.pinterest.com');
      expect(scraper.searchUrl).toBe('https://www.pinterest.com/search/pins/?q=');
      expect(scraper.chromePaths).toBeDefined();
      expect(Object.keys(scraper.chromePaths)).toContain('mac');
      expect(Object.keys(scraper.chromePaths)).toContain('linux');
      expect(Object.keys(scraper.chromePaths)).toContain('win');
    });
  });
  
  describe('search method', () => {
    it('should return search results', async () => {
      const results = await scraper.search('test keyword', 10, true, null);
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
    });
    
    it('should handle empty keyword', async () => {
      const results = await scraper.search('', 10, true, null);
      expect(Array.isArray(results)).toBe(true);
    });
    
    it('should handle search with cancellation signal', async () => {
      const controller = new AbortController();
      const signal = controller.signal;
      controller.abort();
      
      await expect(async () => {
        await scraper.search('test', 10, true, signal);
      }).rejects.toThrow('Operation cancelled');
    });
    
    it('should handle errors during search', async () => {
      sandbox.restore();
      sandbox = sinon.createSandbox();
      sandbox.stub(puppeteer, 'launch').rejects(new Error('Launch failed'));
      
      const results = await scraper.search('test', 10, true, null);
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });
    
    it('should handle page creation failure', async () => {
      sandbox.restore();
      sandbox = sinon.createSandbox();
      const mockBrowser = {
        newPage: sinon.stub().rejects(new Error('Page creation failed')),
        close: sinon.stub().resolves(undefined)
      };
      sandbox.stub(puppeteer, 'launch').resolves(mockBrowser);
      
      const results = await scraper.search('test', 10, true, null);
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });
    
    it('should handle page navigation failure', async () => {
      sandbox.restore();
      sandbox = sinon.createSandbox();
      const mockBrowser = {
        newPage: sinon.stub().resolves({
          setViewport: sinon.stub().resolves(undefined),
          setUserAgent: sinon.stub().resolves(undefined),
          setDefaultNavigationTimeout: sinon.stub(),
          setDefaultTimeout: sinon.stub(),
          setRequestInterception: sinon.stub().resolves(undefined),
          on: sinon.stub(),
          goto: sinon.stub().rejects(new Error('Navigation failed')),
          removeAllListeners: sinon.stub()
        }),
        close: sinon.stub().resolves(undefined)
      };
      sandbox.stub(puppeteer, 'launch').resolves(mockBrowser);
      
      const results = await scraper.search('test', 10, true, null);
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });
    
    it('should handle image extraction failure', async () => {
      sandbox.restore();
      sandbox = sinon.createSandbox();
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
          evaluate: sinon.stub().rejects(new Error('Extraction failed')),
          removeAllListeners: sinon.stub()
        }),
        close: sinon.stub().resolves(undefined)
      };
      sandbox.stub(puppeteer, 'launch').resolves(mockBrowser);
      
      const results = await scraper.search('test', 10, true, null);
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });
    
    it('should handle non-array evaluation results', async () => {
      sandbox.restore();
      sandbox = sinon.createSandbox();
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
          evaluate: sinon.stub().resolves("non-array result"),
          removeAllListeners: sinon.stub()
        }),
        close: sinon.stub().resolves(undefined)
      };
      sandbox.stub(puppeteer, 'launch').resolves(mockBrowser);
      
      const results = await scraper.search('test', 10, true, null);
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });
  });
  
  describe('autoScroll method', () => {
    it('should execute page scrolling', async () => {
      const mockPage = {
        evaluate: sinon.stub().resolves(undefined)
      };
      
      await scraper.autoScroll(mockPage, 2000, null);
      expect(mockPage.evaluate.called).toBe(true);
    });
    
    it('should respond to cancellation signal', async () => {
      const mockPage = {
        evaluate: sinon.stub().resolves(undefined)
      };
      
      const controller = new AbortController();
      const signal = controller.signal;
      controller.abort();
      
      await expect(async () => {
        await scraper.autoScroll(mockPage, 2000, signal);
      }).rejects.toThrow('Operation cancelled');
    });
  });
  
  describe('downloadImage method', () => {
    it('should successfully download image', async () => {
      const success = await scraper.downloadImage('https://i.pinimg.com/originals/test.jpg', '/tmp/test.jpg', null);
      expect(success).toBe(true);
      expect(global.fetch.called).toBe(true);
    });
    
    it('should handle response errors', async () => {
      global.fetch = sandbox.stub().resolves({
        ok: false,
        status: 404
      });
      
      const success = await scraper.downloadImage('https://example.com/error.jpg', '/tmp/error.jpg', null);
      expect(success).toBe(false);
    });
    
    it('should handle network errors', async () => {
      global.fetch = sandbox.stub().rejects(new Error('Network error'));
      
      const success = await scraper.downloadImage('https://example.com/network-error.jpg', '/tmp/network-error.jpg', null);
      expect(success).toBe(false);
    });
    
    it('should handle cancellation signal', async () => {
      const controller = new AbortController();
      const signal = controller.signal;
      controller.abort();
      
      const success = await scraper.downloadImage('https://example.com/cancelled.jpg', '/tmp/cancelled.jpg', signal);
      expect(success).toBe(false);
    });
    
    it('should handle write errors', async () => {
      sandbox.restore();
      sandbox = sinon.createSandbox();
      
      sandbox.stub(puppeteer, 'launch').resolves({
        newPage: sinon.stub().resolves({
          setViewport: sinon.stub().resolves(undefined),
          evaluate: sinon.stub().resolves(undefined)
        }),
        close: sinon.stub().resolves(undefined)
      });
      
      sandbox.stub(fs, 'existsSync').returns(true);
      sandbox.stub(fs, 'mkdirSync');
      sandbox.stub(fs, 'writeFileSync').throws(new Error('Write error'));
      
      global.fetch = sandbox.stub().resolves({
        ok: true,
        status: 200,
        arrayBuffer: () => Promise.resolve(Buffer.from('Test image data').buffer)
      });
      
      const success = await scraper.downloadImage('https://example.com/write-error.jpg', '/tmp/write-error.jpg', null);
      expect(success).toBe(false);
    });
  });
  
  describe('transformImageUrl method', () => {
    it('should transform thumbnail URL to 736x size', () => {
      expect(scraper.transformImageUrl('https://i.pinimg.com/236x/ab/cd/ef.jpg'))
        .toBe('https://i.pinimg.com/736x/ab/cd/ef.jpg');
    });

    it('should handle custom size formats', () => {
      expect(scraper.transformImageUrl('https://i.pinimg.com/123x456/ab/cd/ef.jpg'))
        .toBe('https://i.pinimg.com/736x/ab/cd/ef.jpg');
    });
    
    it('should keep non-thumbnail URLs unchanged', () => {
      const origUrl = 'https://example.com/image.jpg';
      expect(scraper.transformImageUrl(origUrl)).toBe(origUrl);
    });
    
    it('should handle empty URLs', () => {
      expect(scraper.transformImageUrl(null)).toBeNull();
      expect(scraper.transformImageUrl(undefined)).toBeUndefined();
      expect(scraper.transformImageUrl('')).toBe('');
    });
  });
});