import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import { generateFileName, DEFAULT_FILENAME_TEMPLATE } from './filename-template.js';

// Get proxy configuration from environment variable
const PROXY_SERVER = process.env.MCP_PINTEREST_PROXY_SERVER || '';
const PROXY_ENABLED = !!PROXY_SERVER;

// Configure axios timeout and headers
const axiosConfig = {
  timeout: 30000, // 30 second timeout
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
  }
};

// Add proxy configuration if enabled
if (PROXY_ENABLED) {
  const proxyMatch = PROXY_SERVER.match(/^(https?|socks[45]):\/\/([^:]+):(\d+)/i);
  
  if (proxyMatch) {
    const [, protocol, host, port] = proxyMatch;
    console.log(`Using download proxy: ${protocol}://${host}:${port}`);
    
    axiosConfig.proxy = {
      protocol,
      host,
      port: Number.parseInt(port, 10)
    };
  } else {
    console.warn(`Invalid proxy format: ${PROXY_SERVER}. Format should be "http://host:port" or "socks5://host:port"`);
  }
}

/**
 * Download a Pinterest image to specified directory with retry mechanism
 * @param {Object} pinterestResult - Pinterest search result object
 * @param {string} pinterestResult.id - Image ID
 * @param {string} pinterestResult.image_url - Image URL
 * @param {string} downloadDir - Target directory path
 * @param {Object} [options] - Optional settings
 * @param {string} [options.filenameTemplate=DEFAULT_FILENAME_TEMPLATE] - Filename template
 * @param {number} [options.maxRetries=3] - Maximum retries
 * @param {number} [options.index] - Batch download index
 * @returns {Promise<Object>} Download result
 */
export async function downloadImage(pinterestResult, downloadDir, options = {}) {
  const {
    filenameTemplate = DEFAULT_FILENAME_TEMPLATE,
    maxRetries = 3,
    index
  } = options;
  
  let retries = 0;
  let lastError = null;

  while (retries <= maxRetries) {
    try {
      // Ensure download directory exists
      if (!fs.existsSync(downloadDir)) {
        await fs.promises.mkdir(downloadDir, { recursive: true });
      }

      // Extract image ID from URL if missing
      let imageId = pinterestResult.id;
      if (!imageId) {
        const urlParts = pinterestResult.image_url.split('/');
        imageId = urlParts[urlParts.length - 1].split('.')[0];
      }

      // Extract file extension
      const fileExtension = pinterestResult.image_url.split('.').pop().split('?')[0] || 'jpg';
      
      // Generate filename using template
      const fileName = generateFileName(filenameTemplate, {
        imageId,
        fileExtension,
        index
      });
      
      const outputPath = path.join(downloadDir, fileName);

      // Download image using configured axios instance
      const requestConfig = {
        ...axiosConfig,
        responseType: 'arraybuffer'
      };
      
      const response = await axios.get(pinterestResult.image_url, requestConfig);

      // Save image buffer to file
      await fs.promises.writeFile(outputPath, Buffer.from(response.data));

      return {
        success: true,
        id: imageId,
        path: outputPath,
        url: pinterestResult.image_url
      };
    } catch (error) {
      lastError = error;
      
      // Determine if error is retryable
      const isRetryableError = error.code === 'ECONNABORTED' || 
                               error.code === 'ETIMEDOUT' || 
                               error.message.includes('Connection closed') ||
                               error.message.includes('timeout') ||
                               (error.response && error.response.status >= 500);
                               
      if (isRetryableError && retries < maxRetries) {
        const delay = 2 ** retries * 1000;
        if (process.env.NODE_ENV !== 'test') {
          console.log(`Download retry (${retries + 1}/${maxRetries}) delay ${delay}ms: ${pinterestResult.image_url}`);
        }
        await new Promise(resolve => setTimeout(resolve, delay));
        retries++;
      } else {
        if (process.env.NODE_ENV !== 'test') {
          console.error(`Failed to download image (retried ${retries} times): ${error.message}`);
        }
        throw error;
      }
    }
  }
  
  throw lastError;
}

/**
 * Batch download Pinterest images
 * @param {Array} results - Array of Pinterest search result objects
 * @param {string} downloadDir - Target directory path
 * @param {Object} [options] - Optional settings
 * @param {string} [options.filenameTemplate=DEFAULT_FILENAME_TEMPLATE] - Filename template
 * @param {number} [options.maxRetries=3] - Maximum retries
 * @returns {Promise<Object>} Batch download summary
 */
export async function batchDownload(results, downloadDir, options = {}) {
  const {
    filenameTemplate = DEFAULT_FILENAME_TEMPLATE,
    maxRetries = 3
  } = options;
  
  if (!fs.existsSync(downloadDir)) {
    await fs.promises.mkdir(downloadDir, { recursive: true });
  }

  const downloadResults = {
    success: true,
    total: results.length,
    downloadedCount: 0,
    failedCount: 0,
    downloaded: [],
    failed: []
  };

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    try {
      if (result?.image_url) {
        const downloadResult = await downloadImage(result, downloadDir, {
          filenameTemplate,
          maxRetries,
          index: i + 1
        });
        downloadResults.downloaded.push(downloadResult);
        downloadResults.downloadedCount++;
      }
    } catch (error) {
      downloadResults.failed.push({
        url: result?.image_url ?? 'unknown',
        error: error.message
      });
      downloadResults.failedCount++;
    }
  }

  return downloadResults;
}