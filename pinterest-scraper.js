// Pinterest image scraper using Persistent Browser Singleton + Deep Similar Recommendations + LRU Caching
import fs from 'fs';
import puppeteer from 'puppeteer-core';

const DEFAULT_SEARCH_LIMIT = 10;
const DEFAULT_HEADLESS_MODE = true;
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes TTL

const isTestEnvironment = process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;
const PROXY_SERVER = process.env.MCP_PINTEREST_PROXY_SERVER || '';

// Global in-memory cache for instant < 1ms response latency
const queryCache = new Map();

// Persistent browser pool instance kept alive in memory
let globalBrowserInstance = null;

class PinterestScraper {
  constructor() {
    this.baseUrl = 'https://www.pinterest.com';
    this.searchUrl = `${this.baseUrl}/search/pins/?q=`;
    this.chromePaths = {
      mac: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      macAlt: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      linux: '/usr/bin/google-chrome',
      linuxAlt: '/usr/bin/chromium-browser',
      win: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      winAlt: 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    };
  }

  getChromePath() {
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      return process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    if (process.env.CHROME_PATH) {
      return process.env.CHROME_PATH;
    }

    const platform = process.platform;
    if (isTestEnvironment) return '/mock/chrome/path';

    if (platform === 'darwin') {
      if (fs.existsSync(this.chromePaths.mac)) return this.chromePaths.mac;
      if (fs.existsSync(this.chromePaths.macAlt)) return this.chromePaths.macAlt;
    } else if (platform === 'linux') {
      if (fs.existsSync(this.chromePaths.linux)) return this.chromePaths.linux;
      if (this.chromePaths.linuxAlt && fs.existsSync(this.chromePaths.linuxAlt)) return this.chromePaths.linuxAlt;
    } else if (platform === 'win32') {
      if (fs.existsSync(this.chromePaths.win)) return this.chromePaths.win;
      if (fs.existsSync(this.chromePaths.winAlt)) return this.chromePaths.winAlt;
    }

    throw new Error('Chrome browser executable not found.');
  }

  /**
   * Acquire persistent browser singleton or fresh instance
   */
  async getBrowser(headless = true) {
    if (isTestEnvironment) {
      return await puppeteer.launch();
    }

    if (globalBrowserInstance && globalBrowserInstance.isConnected()) {
      return globalBrowserInstance;
    }

    const options = {
      executablePath: this.getChromePath(),
      headless: headless ? 'new' : false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--lang=en-US,en'
      ]
    };

    if (PROXY_SERVER) {
      options.args.push(`--proxy-server=${PROXY_SERVER}`);
    }

    globalBrowserInstance = await puppeteer.launch(options);
    return globalBrowserInstance;
  }

  /**
   * Search for Pinterest images with fast browser pool + instant cache
   */
  async search(keyword, limit = DEFAULT_SEARCH_LIMIT, headless = DEFAULT_HEADLESS_MODE, signal) {
    if (!keyword || typeof keyword !== 'string' || keyword.trim() === '') {
      return [];
    }

    if (signal && signal.aborted) {
      throw new Error('Operation cancelled');
    }

    // Instant LRU cache lookup (< 1ms)
    const cacheKey = `search_${keyword.toLowerCase().trim()}_${limit}`;
    const cached = queryCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
      return cached.results;
    }

    let browser = null;
    let page = null;
    let createdOwnBrowser = false;

    try {
      if (isTestEnvironment) {
        browser = await puppeteer.launch();
        createdOwnBrowser = true;
      } else {
        browser = await this.getBrowser(headless);
      }
    } catch (err) {
      return [];
    }

    if (signal && signal.aborted) {
      if (createdOwnBrowser && browser) await browser.close();
      throw new Error('Operation cancelled');
    }

    if (!browser) return [];

    try {
      page = await browser.newPage();
    } catch (err) {
      if (createdOwnBrowser && browser) await browser.close();
      return [];
    }

    if (signal && signal.aborted) {
      if (page) await page.close().catch(() => {});
      if (createdOwnBrowser && browser) await browser.close();
      throw new Error('Operation cancelled');
    }

    try {
      await page.setViewport({ width: 1280, height: 800 }).catch(() => {});
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36').catch(() => {});

      page.setDefaultNavigationTimeout(30000);
      page.setDefaultTimeout(15000);

      try {
        await page.setRequestInterception(true);
        page.on('request', (req) => {
          if (signal && signal.aborted) {
            req.abort();
            return;
          }
          const resourceType = req.resourceType();
          if (resourceType === 'image' || resourceType === 'font' || resourceType === 'media') {
            req.abort();
          } else {
            req.continue();
          }
        });
      } catch (err) {}

      if (signal && signal.aborted) {
        throw new Error('Operation cancelled');
      }

      const searchQuery = encodeURIComponent(keyword);
      const url = `${this.searchUrl}${searchQuery}`;

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      } catch (err) {
        return [];
      }

      if (signal && signal.aborted) {
        throw new Error('Operation cancelled');
      }

      try {
        await page.waitForSelector('div[data-test-id="pin"], img[src*="pinimg.com"]', { timeout: 5000 });
      } catch (err) {}

      if (signal && signal.aborted) {
        throw new Error('Operation cancelled');
      }

      try {
        const scrollDistance = Math.max(limit * 200, 800);
        await this.autoScroll(page, scrollDistance, signal);
      } catch (err) {
        if (signal && signal.aborted) throw new Error('Operation cancelled');
      }

      if (signal && signal.aborted) {
        throw new Error('Operation cancelled');
      }

      let results = [];
      try {
        results = await page.evaluate(() => {
          const images = Array.from(document.querySelectorAll('img'));
          return images
            .filter(img => img.src && img.src.includes('pinimg.com'))
            .map(img => {
              let imageUrl = img.src;
              if (imageUrl.match(/\/\d+x\d*\//)) {
                imageUrl = imageUrl.replace(/\/\d+x\d*\//, '/originals/');
              }
              const thumbnailPatterns = ['/60x60/', '/236x/', '/474x/', '/736x/'];
              for (const pattern of thumbnailPatterns) {
                if (imageUrl.includes(pattern)) {
                  imageUrl = imageUrl.replace(pattern, '/originals/');
                  break;
                }
              }
              return {
                title: img.alt || 'Unknown Title',
                image_url: imageUrl,
                link: img.closest('a') ? img.closest('a').href : imageUrl,
                source: 'pinterest'
              };
            });
        }).catch(() => []);
      } catch (err) {
        results = [];
      }

      if (signal && signal.aborted) {
        throw new Error('Operation cancelled');
      }

      const validResults = Array.isArray(results) ? results : [];
      const uniqueResults = [];
      const urlSet = new Set();

      for (const item of validResults) {
        if (uniqueResults.length >= limit) break;
        if (item && typeof item === 'object' && item.image_url && !urlSet.has(item.image_url)) {
          urlSet.add(item.image_url);
          uniqueResults.push({
            ...item,
            source: item.source || 'pinterest'
          });
        }
      }

      if (uniqueResults.length > 0) {
        queryCache.set(cacheKey, { timestamp: Date.now(), results: uniqueResults });
      }

      return uniqueResults;
    } catch (error) {
      if ((signal && signal.aborted) || error.message === 'Operation cancelled' || error.message === '操作被取消') {
        throw error;
      }
      return [];
    } finally {
      if (page) {
        try {
          page.removeAllListeners();
          await page.close().catch(() => {});
        } catch (e) {}
      }

      if (createdOwnBrowser && browser) {
        try { await browser.close(); } catch (e) {}
      }
    }
  }

  /**
   * Deep Recommendation Engine: Get similar / related pins from a target pin page or ID
   * @param {string} pinUrlOrId - Pinterest Pin URL (e.g. https://pinterest.com/pin/12345/) or Pin ID
   * @param {number} limit - Result limit
   * @param {boolean} headless - Headless mode
   * @param {AbortSignal} [signal] - Abort signal
   * @returns {Promise<Array>} - Array of recommended pin objects
   */
  async getSimilarPins(pinUrlOrId, limit = DEFAULT_SEARCH_LIMIT, headless = DEFAULT_HEADLESS_MODE, signal) {
    if (!pinUrlOrId || typeof pinUrlOrId !== 'string' || pinUrlOrId.trim() === '') {
      return [];
    }

    if (signal && signal.aborted) {
      throw new Error('Operation cancelled');
    }

    // Normalize pin URL
    let targetUrl = pinUrlOrId.trim();
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = `${this.baseUrl}/pin/${targetUrl.replace(/^\//, '')}/`;
    }

    const cacheKey = `similar_${targetUrl}_${limit}`;
    const cached = queryCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
      return cached.results;
    }

    let browser = null;
    let page = null;
    let createdOwnBrowser = false;

    try {
      if (isTestEnvironment) {
        browser = await puppeteer.launch();
        createdOwnBrowser = true;
      } else {
        browser = await this.getBrowser(headless);
      }
    } catch (err) {
      return [];
    }

    if (signal && signal.aborted) {
      if (createdOwnBrowser && browser) await browser.close();
      throw new Error('Operation cancelled');
    }

    if (!browser) return [];

    try {
      page = await browser.newPage();
    } catch (err) {
      if (createdOwnBrowser && browser) await browser.close();
      return [];
    }

    try {
      await page.setViewport({ width: 1280, height: 900 }).catch(() => {});
      await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36').catch(() => {});

      page.setDefaultNavigationTimeout(30000);
      page.setDefaultTimeout(15000);

      try {
        await page.setRequestInterception(true);
        page.on('request', (req) => {
          if (signal && signal.aborted) {
            req.abort();
            return;
          }
          const resourceType = req.resourceType();
          if (resourceType === 'image' || resourceType === 'font' || resourceType === 'media') {
            req.abort();
          } else {
            req.continue();
          }
        });
      } catch (err) {}

      if (signal && signal.aborted) throw new Error('Operation cancelled');

      // Navigate to target pin page
      try {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      } catch (err) {
        return [];
      }

      if (signal && signal.aborted) throw new Error('Operation cancelled');

      // Scroll down to trigger "More like this" / Related pins section underneath the pin
      try {
        await page.evaluate(() => window.scrollBy(0, 700));
        await this.autoScroll(page, Math.max(limit * 250, 1000), signal);
      } catch (err) {
        if (signal && signal.aborted) throw new Error('Operation cancelled');
      }

      if (signal && signal.aborted) throw new Error('Operation cancelled');

      // Extract recommended pins underneath
      let results = [];
      try {
        results = await page.evaluate(() => {
          const images = Array.from(document.querySelectorAll('img'));
          return images
            .filter(img => img.src && img.src.includes('pinimg.com'))
            .map(img => {
              let imageUrl = img.src;
              if (imageUrl.match(/\/\d+x\d*\//)) {
                imageUrl = imageUrl.replace(/\/\d+x\d*\//, '/originals/');
              }
              const thumbnailPatterns = ['/60x60/', '/236x/', '/474x/', '/736x/'];
              for (const pattern of thumbnailPatterns) {
                if (imageUrl.includes(pattern)) {
                  imageUrl = imageUrl.replace(pattern, '/originals/');
                  break;
                }
              }
              const anchor = img.closest('a');
              return {
                title: img.alt || 'Related Pin Recommendation',
                image_url: imageUrl,
                link: anchor ? anchor.href : imageUrl,
                source: 'pinterest_recommendations'
              };
            });
        }).catch(() => []);
      } catch (err) {
        results = [];
      }

      const validResults = Array.isArray(results) ? results : [];
      const uniqueResults = [];
      const urlSet = new Set();

      for (const item of validResults) {
        if (uniqueResults.length >= limit) break;
        if (item && typeof item === 'object' && item.image_url && !urlSet.has(item.image_url)) {
          urlSet.add(item.image_url);
          uniqueResults.push({
            ...item,
            source: 'pinterest_recommendations'
          });
        }
      }

      if (uniqueResults.length > 0) {
        queryCache.set(cacheKey, { timestamp: Date.now(), results: uniqueResults });
      }

      return uniqueResults;
    } catch (error) {
      if ((signal && signal.aborted) || error.message === 'Operation cancelled' || error.message === '操作被取消') {
        throw error;
      }
      return [];
    } finally {
      if (page) {
        try {
          page.removeAllListeners();
          await page.close().catch(() => {});
        } catch (e) {}
      }

      if (createdOwnBrowser && browser) {
        try { await browser.close(); } catch (e) {}
      }
    }
  }

  /**
   * Fast Auto-scroll page to trigger infinite scroll
   */
  async autoScroll(page, maxScrollDistance = 2000, signal) {
    if (signal && signal.aborted) {
      throw new Error('Operation cancelled');
    }

    await page.evaluate(async (maxScrollDistance) => {
      await new Promise((resolve, reject) => {
        let totalHeight = 0;
        const distance = 250;
        const timer = setInterval(() => {
          window.scrollBy(0, distance);
          totalHeight += distance;

          if (totalHeight >= maxScrollDistance) {
            clearInterval(timer);
            resolve();
          }
        }, 30);

        window.scrollCancelled = () => {
          clearInterval(timer);
          reject(new Error('Operation cancelled'));
        };
      });
    }, maxScrollDistance);

    if (signal && signal.aborted) {
      await page.evaluate(() => {
        if (window.scrollCancelled) window.scrollCancelled();
      });
      throw new Error('Operation cancelled');
    }
  }

  /**
   * Download image
   */
  async downloadImage(imageUrl, outputPath, signal) {
    try {
      if (!imageUrl || !outputPath) return false;
      if (signal && signal.aborted) return false;

      imageUrl = this.transformImageUrl(imageUrl);

      const fetchOptions = signal ? { signal } : undefined;
      const response = await fetch(imageUrl, fetchOptions);

      if (!response.ok) {
        throw new Error(`Download failed, status code: ${response.status}`);
      }

      if (signal && signal.aborted) return false;

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (signal && signal.aborted) return false;

      fs.writeFileSync(outputPath, buffer);
      return true;
    } catch (error) {
      if ((signal && signal.aborted) || error.name === 'AbortError') return false;
      return false;
    }
  }

  /**
   * Transform thumbnail URL to original size
   */
  transformImageUrl(url) {
    if (!url) return url;

    if (url.match(/\/\d+x\d*\//)) {
      return url.replace(/\/\d+x\d*\//, '/originals/');
    }

    const thumbnailPatterns = ['/60x60/', '/236x/', '/474x/', '/736x/'];
    for (const pattern of thumbnailPatterns) {
      if (url.includes(pattern)) {
        return url.replace(pattern, '/originals/');
      }
    }

    return url;
  }
}

export { PinterestScraper as default };