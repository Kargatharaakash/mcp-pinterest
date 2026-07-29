#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  McpError,
  CallToolRequest,
} from '@modelcontextprotocol/sdk/types.js';
// @ts-ignore
import PinterestScraper from './pinterest-scraper.js';
import { downloadImage, batchDownload } from './src/pinterest-download.js';
import { 
  DEFAULT_FILENAME_TEMPLATE, 
  validateTemplate, 
  generateFileName 
} from './src/filename-template.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default configuration constants
const DEFAULT_SEARCH_LIMIT = 10;
const DEFAULT_SEARCH_KEYWORD = 'landscape';
const DEFAULT_HEADLESS_MODE = true;

// Track server start time for health diagnostics
const SERVER_START_TIME = Date.now();

// Read download directory from environment variables, fallback to default
const ENV_DOWNLOAD_DIR = process.env.MCP_PINTEREST_DOWNLOAD_DIR;
const DEFAULT_DOWNLOAD_DIR = path.join(__dirname, '../downloads');

// Read filename template from environment variables
const ENV_FILENAME_TEMPLATE = process.env.MCP_PINTEREST_FILENAME_TEMPLATE;

// API key for authenticating remote requests (Render / Fly / Railway / Claude Remote MCP)
function getApiKey(): string {
  return process.env.API_KEY || process.env.MCP_API_KEY || '';
}

// Validate download directory accessibility
function validateDownloadDirectory(dirPath: string): boolean {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      console.log(`Created download directory: ${dirPath}`);
    }
    
    const testFile = path.join(dirPath, '.write-test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    return true;
  } catch (error: any) {
    console.error(`Download directory validation failed for ${dirPath}: ${error.message}`);
    return false;
  }
}

// Get valid download directory
function getValidDownloadDirectory(): string {
  if (ENV_DOWNLOAD_DIR) {
    if (validateDownloadDirectory(ENV_DOWNLOAD_DIR)) {
      console.log(`Using configured download directory: ${ENV_DOWNLOAD_DIR}`);
      return ENV_DOWNLOAD_DIR;
    }
    
    console.error('Configured download directory is invalid, exiting.');
    process.exit(1);
  }
  
  if (validateDownloadDirectory(DEFAULT_DOWNLOAD_DIR)) {
    console.log(`Using default download directory: ${DEFAULT_DOWNLOAD_DIR}`);
    return DEFAULT_DOWNLOAD_DIR;
  }
  
  console.error('Default download directory is invalid, exiting.');
  process.exit(1);
}

// Get valid filename template
function getValidFilenameTemplate(): string {
  if (ENV_FILENAME_TEMPLATE) {
    const validationResult = validateTemplate(ENV_FILENAME_TEMPLATE);
    if (validationResult.isValid) {
      console.log(`Using configured filename template: ${ENV_FILENAME_TEMPLATE}`);
      return ENV_FILENAME_TEMPLATE;
    }
    
    console.error(`Configured filename template is invalid: ${validationResult.error}`);
    console.log(`Falling back to default filename template: ${DEFAULT_FILENAME_TEMPLATE}`);
  }
  
  return DEFAULT_FILENAME_TEMPLATE;
}

const CURRENT_DOWNLOAD_DIR = getValidDownloadDirectory();
const CURRENT_FILENAME_TEMPLATE = getValidFilenameTemplate();

/**
 * Download result interface
 */
interface DownloadResult {
  success: boolean;
  total: number;
  downloadedCount: number;
  failedCount: number;
  downloaded: Array<{
    success: boolean;
    id: string;
    path: string;
    url: string;
  }>;
  failed: Array<{
    url: string;
    error: string;
  }>;
}

/**
 * Pinterest MCP Server
 * Implements Model Context Protocol server for Pinterest search and image downloads.
 * Supports both stdio transport (local IDEs) and HTTP/SSE transport with Bearer token security (cloud hosting).
 */
export class PinterestMcpServer {
  private server: Server;
  private scraper: PinterestScraper;
  private sseTransports: Map<string, SSEServerTransport> = new Map();

  constructor() {
    this.server = new Server(
      {
        name: 'pinterest-mcp-server',
        version: '1.2.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    this.scraper = new PinterestScraper();
    this.setupToolHandlers();

    this.server.onerror = (error) => console.error('[MCP Error]', error);
    
    process.on('SIGINT', async () => {
      await this.cleanup();
      process.exit(0);
    });
  }

  private async cleanup(): Promise<void> {
    await this.server.close();
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'pinterest_health_check',
          description: 'Check health, system metrics, Chromium browser status, write permissions, and server status',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'pinterest_search',
          description: 'Search for images on Pinterest by keyword',
          inputSchema: {
            type: 'object',
            properties: {
              keyword: {
                type: 'string',
                description: 'Search keyword',
              },
              limit: {
                type: 'integer',
                description: `Number of images to return (default: ${DEFAULT_SEARCH_LIMIT})`,
                default: DEFAULT_SEARCH_LIMIT,
              },
              headless: {
                type: 'boolean',
                description: `Whether to use headless browser mode (default: ${DEFAULT_HEADLESS_MODE})`,
                default: DEFAULT_HEADLESS_MODE,
              },
            },
            required: ['keyword'],
          },
        },
        {
          name: 'pinterest_get_image_info',
          description: 'Get Pinterest image information',
          inputSchema: {
            type: 'object',
            properties: {
              image_url: {
                type: 'string',
                description: 'Image URL',
              },
            },
            required: ['image_url'],
          },
        },
        {
          name: 'pinterest_search_and_download',
          description: 'Search for images on Pinterest by keyword and download them',
          inputSchema: {
            type: 'object',
            properties: {
              keyword: {
                type: 'string',
                description: 'Search keyword',
              },
              limit: {
                type: 'integer',
                description: `Number of images to return and download (default: ${DEFAULT_SEARCH_LIMIT})`,
                default: DEFAULT_SEARCH_LIMIT,
              },
              headless: {
                type: 'boolean',
                description: `Whether to use headless browser mode (default: ${DEFAULT_HEADLESS_MODE})`,
                default: DEFAULT_HEADLESS_MODE,
              },
            },
            required: ['keyword'],
          },
        },
        {
          name: 'pinterest_get_similar_pins',
          description: 'Open a target Pinterest Pin URL or ID and retrieve "More like this" related visual design recommendations',
          inputSchema: {
            type: 'object',
            properties: {
              pin_url_or_id: {
                type: 'string',
                description: 'Pinterest Pin URL (e.g. https://www.pinterest.com/pin/11822017768403505/) or numeric Pin ID',
              },
              limit: {
                type: 'integer',
                description: `Number of recommended pins to return (default: ${DEFAULT_SEARCH_LIMIT})`,
                default: DEFAULT_SEARCH_LIMIT,
              },
              headless: {
                type: 'boolean',
                description: `Whether to use headless browser mode (default: ${DEFAULT_HEADLESS_MODE})`,
                default: DEFAULT_HEADLESS_MODE,
              },
            },
            required: ['pin_url_or_id'],
          },
        },
        {
          name: 'render_pinterest_gallery',
          description: 'Render a visual image gallery widget inside ChatGPT from Pinterest search results. Always call pinterest_search first, then pass its images array to this tool.',
          inputSchema: {
            type: 'object',
            properties: {
              keyword: {
                type: 'string',
                description: 'The search keyword used (for display purposes)',
              },
              images: {
                type: 'array',
                description: 'Array of image objects from pinterest_search structuredContent.images',
                items: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    proxyUrl: { type: 'string' },
                    directUrl: { type: 'string' },
                    pinLink: { type: 'string' },
                  },
                },
              },
            },
            required: ['images'],
            _meta: {
              ui: {
                resourceUri: 'ui://pinterest-mcp-server/gallery.html',
              },
            },
          },
          _meta: {
            ui: {
              resourceUri: 'ui://pinterest-mcp-server/gallery.html',
            },
          },
        }
      ]
    }));

    // MCP Apps: List UI resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: 'ui://pinterest-mcp-server/gallery.html',
          name: 'Pinterest Image Gallery',
          description: 'Interactive Pinterest image gallery rendered as an iframe inside ChatGPT',
          mimeType: 'text/html;profile=mcp-app',
        },
      ],
    }));

    // MCP Apps: Serve the gallery HTML resource
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      if (request.params.uri !== 'ui://pinterest-mcp-server/gallery.html') {
        throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${request.params.uri}`);
      }

      const galleryHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Pinterest Gallery</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0f0f0f;
    color: #fff;
    min-height: 100vh;
    padding: 16px;
  }
  #header {
    margin-bottom: 16px;
  }
  #keyword {
    font-size: 14px;
    color: #aaa;
    margin-bottom: 4px;
  }
  h1 {
    font-size: 20px;
    font-weight: 700;
    color: #fff;
  }
  #gallery {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 12px;
  }
  .card {
    border-radius: 12px;
    overflow: hidden;
    background: #1a1a1a;
    border: 1px solid #2a2a2a;
    transition: transform 0.2s ease, box-shadow 0.2s ease;
    cursor: pointer;
  }
  .card:hover {
    transform: translateY(-4px);
    box-shadow: 0 12px 32px rgba(0,0,0,0.6);
  }
  .card img {
    width: 100%;
    aspect-ratio: 3/4;
    object-fit: cover;
    display: block;
    background: #222;
  }
  .card-footer {
    padding: 8px 10px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .card-title {
    font-size: 11px;
    color: #ccc;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }
  .pin-link {
    font-size: 11px;
    color: #e60023;
    text-decoration: none;
    margin-left: 6px;
    flex-shrink: 0;
    font-weight: 600;
  }
  .pin-link:hover { text-decoration: underline; }
  #empty {
    text-align: center;
    padding: 48px 16px;
    color: #666;
    font-size: 14px;
  }
  .spinner {
    text-align: center;
    padding: 48px;
    color: #888;
    font-size: 14px;
  }
</style>
</head>
<body>
<div id="header">
  <div id="keyword">Pinterest Search Results</div>
  <h1>Image Gallery</h1>
</div>
<div id="gallery"><div class="spinner">Loading images...</div></div>
<script>
  const gallery = document.getElementById('gallery');
  const keywordEl = document.getElementById('keyword');
  const h1 = document.querySelector('h1');

  function renderGallery(images, keyword) {
    if (!images || images.length === 0) {
      gallery.innerHTML = '<div id="empty">No images found.</div>';
      return;
    }
    if (keyword) {
      keywordEl.textContent = 'Pinterest: ' + keyword;
      h1.textContent = keyword + ' — Image Gallery';
    }
    gallery.innerHTML = images.map((img, i) => {
      const title = img.title || ('Design ' + (i + 1));
      const src = img.proxyUrl || img.directUrl || '';
      const pin = img.pinLink || img.directUrl || '#';
      return \`<div class="card" title="\${title}">
        <img src="\${src}" alt="\${title}" loading="lazy" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'200\' height=\'200\'%3E%3Crect width=\'200\' height=\'200\' fill=\'%23222\'/%3E%3Ctext x=\'100\' y=\'100\' fill=\'%23666\' text-anchor=\'middle\' dy=\'.35em\' font-size=\'12\'%3ENo image%3C/text%3E%3C/svg%3E'">
        <div class="card-footer">
          <span class="card-title">\${title}</span>
          <a class="pin-link" href="\${pin}" target="_blank" rel="noopener">Pin</a>
        </div>
      </div>\`;
    }).join('');
  }

  function handleData(data) {
    if (!data) return;
    const sc = data.structuredContent || (data.params && data.params.structuredContent) || data.params || data;
    const images = sc.images || data.images;
    const keyword = sc.keyword || data.keyword;
    if (images && Array.isArray(images)) {
      renderGallery(images, keyword);
    }
  }

  // 1. Check ChatGPT window.openai bridge directly on load
  if (window.openai) {
    if (window.openai.toolOutput) handleData(window.openai.toolOutput);
    else if (window.openai.toolInput) handleData(window.openai.toolInput);
  }

  // 2. Listen for postMessage without strict window.parent check
  window.addEventListener('message', function(event) {
    const msg = event.data;
    if (!msg) return;

    if (msg.method === 'ui/notifications/tool-result' || msg.method === 'ui/notifications/tool-input') {
      handleData(msg.params);
    } else if (msg.jsonrpc === '2.0' && msg.result) {
      handleData(msg.result);
    } else if (msg.images || (msg.structuredContent && msg.structuredContent.images)) {
      handleData(msg);
    }
  }, { passive: true });

  // 3. Send ui/initialize to the host to signal readiness
  try {
    window.parent.postMessage({ jsonrpc: '2.0', method: 'ui/initialize', id: 1, params: {} }, '*');
  } catch(e) {}
</script>
</body>
</html>`;

      return {
        contents: [
          {
            uri: 'ui://pinterest-mcp-server/gallery.html',
            mimeType: 'text/html;profile=mcp-app',
            text: galleryHtml,
            _meta: {
              ui: {
                prefersBorder: false,
                csp: {
                  connectDomains: ['https://pinterest-mcp-server-62kx.onrender.com'],
                  resourceDomains: ['https://pinterest-mcp-server-62kx.onrender.com', 'https://i.pinimg.com'],
                },
              },
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
      try {
        return await this.executeToolCall(request.params.name, request.params.arguments || request.params.args);
      } catch (error: any) {
        console.error(`[Tool call error] ${request.params.name}:`, error);
        throw new McpError(
          ErrorCode.InternalError,
          `Tool call failed: ${error.message}`
        );
      }
    });
  }

  /**
   * Execute tool call by name
   */
  private async executeToolCall(name: string, args: any) {
    switch (name) {
      case 'pinterest_health_check':
        return await this.handlePinterestHealthCheck();
      case 'pinterest_search':
        return await this.handlePinterestSearch(args);
      case 'pinterest_get_image_info':
        return await this.handlePinterestGetImageInfo(args);
      case 'pinterest_search_and_download':
        return await this.handlePinterestSearchAndDownload(args);
      case 'pinterest_get_similar_pins':
        return await this.handlePinterestGetSimilarPins(args);
      case 'render_pinterest_gallery':
        return await this.handleRenderPinterestGallery(args);
      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}`
        );
    }
  }

  /**
   * Handle MCP Tool health check request
   */
  private async handlePinterestHealthCheck() {
    let chromeStatus = 'available';
    let chromePath = '';
    try {
      chromePath = this.scraper.getChromePath();
    } catch (e: any) {
      chromeStatus = `error: ${e.message}`;
    }

    const isWritable = validateDownloadDirectory(CURRENT_DOWNLOAD_DIR);
    const uptimeSeconds = Math.floor((Date.now() - SERVER_START_TIME) / 1000);
    const memory = process.memoryUsage();

    const healthData = {
      status: 'healthy',
      server: 'pinterest-mcp-server',
      version: '1.2.0',
      uptimeSeconds,
      timestamp: new Date().toISOString(),
      authenticationEnabled: !!getApiKey(),
      downloadDirectory: {
        path: CURRENT_DOWNLOAD_DIR,
        writable: isWritable
      },
      filenameTemplate: CURRENT_FILENAME_TEMPLATE,
      browser: {
        status: chromeStatus,
        executablePath: chromePath
      },
      activeSseSessions: this.sseTransports.size,
      systemMetrics: {
        rssMB: Math.round(memory.rss / (1024 * 1024)),
        heapTotalMB: Math.round(memory.heapTotal / (1024 * 1024)),
        heapUsedMB: Math.round(memory.heapUsed / (1024 * 1024))
      }
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(healthData, null, 2)
        }
      ]
    };
  }

  /**
   * Helper to fetch image binary and convert to base64 for native MCP type: "image" rendering
   */
  private async fetchImageAsBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.pinterest.com/'
        }
      });
      if (!response.ok) return null;
      const contentType = response.headers.get('content-type') || 'image/jpeg';
      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      return {
        data: base64,
        mimeType: contentType.startsWith('image/') ? contentType : 'image/jpeg'
      };
    } catch (e) {
      return null;
    }
  }

  private async handlePinterestSearch(args: any) {
    try {
      let keyword = '';
      let limit = DEFAULT_SEARCH_LIMIT;
      let headless = DEFAULT_HEADLESS_MODE;
      
      if (typeof args === 'string') {
        args = args.replace(/`/g, '"');
      }
      
      if (args) {
        if (typeof args === 'object') {
          if ('keyword' in args && typeof args.keyword === 'string') {
            keyword = args.keyword.trim();
          } else if ('`keyword`' in args) {
            keyword = String(args['`keyword`']).trim();
          }
          
          if ('limit' in args && (typeof args.limit === 'number' || !isNaN(parseInt(String(args.limit))))) {
            limit = typeof args.limit === 'number' ? args.limit : parseInt(String(args.limit), 10);
          } else if ('`limit`' in args) {
            const limitValue = args['`limit`'];
            limit = typeof limitValue === 'number' ? limitValue : parseInt(String(limitValue), 10);
          }
          
          if ('headless' in args && typeof args.headless === 'boolean') {
            headless = args.headless;
          } else if ('`headless`' in args) {
            headless = Boolean(args['`headless`']);
          }
        } else if (typeof args === 'string') {
          try {
            let parsed;
            try {
              parsed = JSON.parse(args);
            } catch (jsonError) {
              const fixedJson = args
                .replace(/'/g, '"')
                .replace(/(\w+):/g, '"$1":');
              parsed = JSON.parse(fixedJson);
            }
            
            if (parsed) {
              if (parsed.keyword && typeof parsed.keyword === 'string') {
                keyword = parsed.keyword.trim();
              }
              
              if (parsed.limit !== undefined) {
                if (typeof parsed.limit === 'number') {
                  limit = parsed.limit;
                } else if (typeof parsed.limit === 'string' && !isNaN(parseInt(parsed.limit))) {
                  limit = parseInt(parsed.limit, 10);
                }
              }
              
              if (parsed.headless !== undefined && typeof parsed.headless === 'boolean') {
                headless = parsed.headless;
              }
            }
          } catch (e) {
            const keywordMatch = args.match(/["`']?keyword["`']?\s*[:=]\s*["`']([^"`']+)["`']/i);
            if (keywordMatch && keywordMatch[1]) {
              keyword = keywordMatch[1].trim();
            }
            
            const limitMatch = args.match(/["`']?limit["`']?\s*[:=]\s*(\d+)/i);
            if (limitMatch && limitMatch[1]) {
              limit = parseInt(limitMatch[1], 10);
            }
          }
        }
      }
      
      if (!keyword) {
        keyword = DEFAULT_SEARCH_KEYWORD;
      }
      
      if (isNaN(limit) || limit <= 0) {
        limit = DEFAULT_SEARCH_LIMIT;
      }
      
      let results = [];
      try {
        const controller = new AbortController();
        results = await this.scraper.search(keyword, limit, headless, controller.signal);
      } catch (searchError) {
        results = [];
      }
      
      const validResults = Array.isArray(results) ? results : [];
      
      for (const result of validResults) {
        if (result.image_url) {
          result.image_url = this.scraper.transformImageUrl(result.image_url);
        }
      }
      
      const contentItems: Array<any> = [
        {
          type: 'text',
          text: `Found ${validResults.length} images related to "${keyword}" on Pinterest:`
        }
      ];
      
      const imagePromises = validResults.map(async (result: any, index: number) => {
        const title = result.title && result.title !== 'Unknown Title' ? result.title : `Design ${index + 1}`;
        const rawImageUrl = this.scraper.transformImageUrl(result.image_url);
        const proxiedImageUrl = `https://pinterest-mcp-server-62kx.onrender.com/image-proxy?url=${encodeURIComponent(rawImageUrl)}`;
        const pinLink = result.link || result.original_page || rawImageUrl;
        const imageBase64 = await this.fetchImageAsBase64(rawImageUrl);

        return {
          index,
          title,
          rawImageUrl,
          proxiedImageUrl,
          pinLink,
          imageBase64
        };
      });

      const processedResults = await Promise.all(imagePromises);

      for (const item of processedResults) {
        if (item.imageBase64) {
          contentItems.push({
            type: 'image',
            data: item.imageBase64.data,
            mimeType: item.imageBase64.mimeType
          });
        }

        contentItems.push({
          type: 'text',
          text: `#### ${item.index + 1}. ${item.title}\n![${item.title}](${item.proxiedImageUrl})\n[View Direct Image](${item.rawImageUrl}) | [View Pin](${item.pinLink})\n---`
        });
      }
      
      const structuredImages = processedResults.map(item => ({
        title: item.title,
        proxyUrl: item.proxiedImageUrl,
        directUrl: item.rawImageUrl,
        pinLink: item.pinLink,
      }));

      return {
        structuredContent: {
          keyword,
          count: validResults.length,
          images: structuredImages,
        },
        content: contentItems
      };
    } catch (error: any) {
      console.error('Pinterest search error:', error);
      return {
        content: [
          {
            type: 'text',
            text: `Error during search: ${error.message}`
          }
        ]
      };
    }
  }

  /**
   * Handle render_pinterest_gallery — returns MCP Apps UI resource for iframe rendering in ChatGPT
   */
  private async handleRenderPinterestGallery(args: any) {
    const images = Array.isArray(args?.images) ? args.images : [];
    const keyword = args?.keyword || 'Pinterest';

    return {
      structuredContent: {
        keyword,
        count: images.length,
        images,
      },
      content: [
        {
          type: 'text',
          text: `Rendering gallery of ${images.length} Pinterest images for "${keyword}".`,
        },
      ],
      _meta: {
        ui: {
          resourceUri: 'ui://pinterest-mcp-server/gallery.html',
        },
      },
    };
  }

  private async handlePinterestGetImageInfo(args: any) {
    try {
      const imageUrl = args.image_url;
      
      return {
        content: [
          {
            type: 'text',
            text: `Pinterest Image Information`,
          },
          {
            type: 'text',
            text: JSON.stringify({
              image_url: imageUrl,
              source: 'Pinterest',
              timestamp: new Date().toISOString(),
            }, null, 2),
          },
        ],
      };
    } catch (error: any) {
      console.error('Error getting Pinterest image info:', error);
      return {
        content: [
          {
            type: 'text',
            text: `Error getting image info: ${error.message}`,
          },
        ],
      };
    }
  }

  private async handlePinterestSearchAndDownload(args: any) {
    try {
      let keyword = '';
      let limit = DEFAULT_SEARCH_LIMIT;
      let headless = DEFAULT_HEADLESS_MODE;
      let downloadDir = CURRENT_DOWNLOAD_DIR;
      
      if (typeof args === 'string') {
        args = args.replace(/`/g, '"');
      }
      
      if (args) {
        if (typeof args === 'object') {
          if ('keyword' in args && typeof args.keyword === 'string') {
            keyword = args.keyword.trim();
          } else if ('`keyword`' in args) {
            keyword = String(args['`keyword`']).trim();
          }
          
          if ('limit' in args && (typeof args.limit === 'number' || !isNaN(parseInt(String(args.limit))))) {
            limit = typeof args.limit === 'number' ? args.limit : parseInt(String(args.limit), 10);
          } else if ('`limit`' in args) {
            const limitValue = args['`limit`'];
            limit = typeof limitValue === 'number' ? limitValue : parseInt(String(limitValue), 10);
          }
          
          if ('headless' in args && typeof args.headless === 'boolean') {
            headless = args.headless;
          } else if ('`headless`' in args) {
            headless = Boolean(args['`headless`']);
          }
        } else if (typeof args === 'string') {
          try {
            let parsed;
            try {
              parsed = JSON.parse(args);
            } catch (jsonError) {
              const fixedJson = args
                .replace(/'/g, '"')
                .replace(/(\w+):/g, '"$1":');
              parsed = JSON.parse(fixedJson);
            }
            
            if (parsed) {
              if (parsed.keyword && typeof parsed.keyword === 'string') {
                keyword = parsed.keyword.trim();
              }
              
              if (parsed.limit !== undefined) {
                if (typeof parsed.limit === 'number') {
                  limit = parsed.limit;
                } else if (typeof parsed.limit === 'string' && !isNaN(parseInt(parsed.limit))) {
                  limit = parseInt(parsed.limit, 10);
                }
              }
              
              if (parsed.headless !== undefined && typeof parsed.headless === 'boolean') {
                headless = parsed.headless;
              }
            }
          } catch (e) {
            const keywordMatch = args.match(/["`']?keyword["`']?\s*[:=]\s*["`']([^"`']+)["`']/i);
            if (keywordMatch && keywordMatch[1]) {
              keyword = keywordMatch[1].trim();
            }
            
            const limitMatch = args.match(/["`']?limit["`']?\s*[:=]\s*(\d+)/i);
            if (limitMatch && limitMatch[1]) {
              limit = parseInt(limitMatch[1], 10);
            }
          }
        }
      }
      
      if (!keyword) {
        keyword = DEFAULT_SEARCH_KEYWORD;
      }
      
      if (isNaN(limit) || limit <= 0) {
        limit = DEFAULT_SEARCH_LIMIT;
      }
      
      downloadDir = CURRENT_DOWNLOAD_DIR;
      const keywordDir = path.join(downloadDir, keyword.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, ''));
      
      try {
        if (!fs.existsSync(keywordDir)) {
          fs.mkdirSync(keywordDir, { recursive: true });
        }
      } catch (dirError: any) {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to create download directory: ${dirError.message}`
            }
          ]
        };
      }
      
      let results = [];
      try {
        const controller = new AbortController();
        results = await this.scraper.search(keyword, limit, headless, controller.signal);
      } catch (searchError) {
        results = [];
      }
      
      const validResults = Array.isArray(results) ? results : [];
      const maxRetries = 3;
      
      const downloadResult = await batchDownload(validResults, keywordDir, {
        filenameTemplate: CURRENT_FILENAME_TEMPLATE,
        maxRetries
      }) as DownloadResult;
      
      const contentItems: Array<{type: string; text: string}> = [
        {
          type: 'text',
          text: `Searched and downloaded ${validResults.length} images related to "${keyword}"`
        },
        {
          type: 'text',
          text: `Success: ${downloadResult.downloadedCount}, Failed: ${downloadResult.failedCount}`
        }
      ];
      
      downloadResult.downloaded.forEach((result, index) => {
        contentItems.push({
          type: 'text',
          text: `Image ${index + 1}: ${validResults[index]?.title || 'Unknown Title'}`
        });
        
        contentItems.push({
          type: 'text',
          text: `Link: ${result.url}`
        });
        
        contentItems.push({
          type: 'text',
          text: `Saved to: ${result.path}`
        });
        
        if (index < downloadResult.downloaded.length - 1) {
          contentItems.push({
            type: 'text',
            text: `---`
          });
        }
      });
      
      if (downloadResult.failedCount > 0) {
        contentItems.push({
          type: 'text',
          text: `--- Failed Downloads ---`
        });
        
        downloadResult.failed.forEach((failed, index) => {
          contentItems.push({
            type: 'text',
            text: `Failed ${index + 1}: ${failed.url}`
          });
          
          contentItems.push({
            type: 'text',
            text: `Error: ${failed.error}`
          });
          
          if (index < downloadResult.failed.length - 1) {
            contentItems.push({
              type: 'text',
              text: `---`
            });
          }
        });
      }
      
      return {
        content: contentItems
      };
    } catch (error: any) {
      console.error('Pinterest search and download error:', error);
      return {
        content: [
          {
            type: 'text',
            text: `Error during search and download: ${error.message}`
          }
        ]
      };
    }
  }

  private async handlePinterestGetSimilarPins(args: any) {
    try {
      let pinUrlOrId = '';
      let limit = DEFAULT_SEARCH_LIMIT;
      let headless = DEFAULT_HEADLESS_MODE;

      if (typeof args === 'string') {
        args = args.replace(/`/g, '"');
      }

      if (args) {
        if (typeof args === 'object') {
          if ('pin_url_or_id' in args && typeof args.pin_url_or_id === 'string') {
            pinUrlOrId = args.pin_url_or_id.trim();
          } else if ('`pin_url_or_id`' in args) {
            pinUrlOrId = String(args['`pin_url_or_id`']).trim();
          }

          if ('limit' in args && (typeof args.limit === 'number' || !isNaN(parseInt(String(args.limit))))) {
            limit = typeof args.limit === 'number' ? args.limit : parseInt(String(args.limit), 10);
          }

          if ('headless' in args && typeof args.headless === 'boolean') {
            headless = args.headless;
          }
        }
      }

      if (!pinUrlOrId) {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: pin_url_or_id parameter is required'
            }
          ]
        };
      }

      const results = await this.scraper.getSimilarPins(pinUrlOrId, limit, headless);

      if (!results || results.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No similar recommendations found for pin: "${pinUrlOrId}"`
            }
          ]
        };
      }

      const contentItems: Array<any> = [
        {
          type: 'text',
          text: `Found ${results.length} related visual design recommendations for pin: "${pinUrlOrId}"`
        }
      ];

      const imagePromises = results.map(async (item: any, index: number) => {
        const title = item.title && item.title !== 'Unknown Title' ? item.title : `Recommendation ${index + 1}`;
        const rawImageUrl = this.scraper.transformImageUrl(item.image_url);
        const proxiedImageUrl = `https://pinterest-mcp-server-62kx.onrender.com/image-proxy?url=${encodeURIComponent(rawImageUrl)}`;
        const imageBase64 = await this.fetchImageAsBase64(rawImageUrl);

        return {
          index,
          title,
          rawImageUrl,
          proxiedImageUrl,
          pinLink: item.link || rawImageUrl,
          imageBase64
        };
      });

      const processedResults = await Promise.all(imagePromises);

      for (const item of processedResults) {
        if (item.imageBase64) {
          contentItems.push({
            type: 'image',
            data: item.imageBase64.data,
            mimeType: item.imageBase64.mimeType
          });
        }

        contentItems.push({
          type: 'text',
          text: `#### ${item.index + 1}. ${item.title}\n![${item.title}](${item.proxiedImageUrl})\n[View Direct Image](${item.rawImageUrl}) | [View Pin](${item.pinLink})\n---`
        });
      }

      return {
        content: contentItems
      };
    } catch (error: any) {
      console.error('Pinterest similar pins error:', error);
      return {
        content: [
          {
            type: 'text',
            text: `Error fetching similar pins: ${error.message}`
          }
        ]
      };
    }
  }

  /**
   * Middleware to enforce API key security for HTTP requests
   */
  private authenticateMiddleware(req: Request, res: Response, next: NextFunction): void {
    const activeApiKey = getApiKey();
    if (!activeApiKey) {
      return next();
    }

    const authHeader = req.headers.authorization;
    const apiKeyHeader = req.headers['x-api-key'] as string;
    const queryApiKey = req.query.api_key as string;

    let providedKey = '';

    if (authHeader) {
      if (authHeader.startsWith('Bearer ')) {
        providedKey = authHeader.substring(7).trim();
      } else {
        providedKey = authHeader.trim();
      }
    } else if (apiKeyHeader) {
      providedKey = apiKeyHeader.trim();
    } else if (queryApiKey) {
      providedKey = queryApiKey.trim();
    }

    if (providedKey === activeApiKey) {
      return next();
    }

    res.status(401).json({
      error: 'Unauthorized: Invalid or missing API key'
    });
  }

  /**
   * Run server in Stdio mode
   */
  async runStdio(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.log('Pinterest MCP Server running via stdio');
  }

  /**
   * Run server in HTTP/SSE mode (for Render, Fly.io, Railway, Claude Remote MCP)
   */
  async runHttp(port: number): Promise<void> {
    const app = express();
    app.use(cors());
    app.use(express.json());

    // Request logging middleware
    app.use((req: Request, res: Response, next: NextFunction) => {
      console.log(`[HTTP Request] ${req.method} ${req.originalUrl} - User-Agent: ${req.headers['user-agent'] || 'none'}`);
      next();
    });

    // Public Image Proxy Endpoint for ChatGPT & Web Apps (Bypasses Referer & AccessDenied blocks)
    app.get('/image-proxy', async (req: Request, res: Response) => {
      try {
        const imageUrl = req.query.url as string;
        if (!imageUrl || (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://'))) {
          res.status(400).send('Invalid or missing image URL parameter');
          return;
        }

        const response = await fetch(imageUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
            'Referer': 'https://www.pinterest.com/'
          }
        });

        if (!response.ok) {
          res.status(response.status).send(`Failed to fetch image: ${response.statusText}`);
          return;
        }

        const contentType = response.headers.get('content-type') || 'image/jpeg';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
        res.setHeader('Access-Control-Allow-Origin', '*');

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        res.send(buffer);
      } catch (error: any) {
        res.status(500).send(`Image proxy error: ${error.message}`);
      }
    });

    // Public health check endpoints for Render, Kubernetes, and Remote MCP gateways
    app.get(['/', '/health', '/ping'], (req: Request, res: Response) => {
      const memory = process.memoryUsage();
      res.json({
        status: 'ok',
        service: 'pinterest-mcp-server',
        version: '1.2.0',
        transport: 'sse',
        authenticated: !!getApiKey(),
        uptimeSeconds: Math.floor((Date.now() - SERVER_START_TIME) / 1000),
        activeSseSessions: this.sseTransports.size,
        memoryUsageMB: {
          rss: Math.round(memory.rss / (1024 * 1024)),
          heapUsed: Math.round(memory.heapUsed / (1024 * 1024))
        }
      });
    });

    // Unified MCP Endpoint (ChatGPT Apps SDK & Spec Compliant)
    app.get(['/mcp', '/sse'], (req: Request, res: Response, next: NextFunction) => {
      this.authenticateMiddleware(req, res, () => {
        // Set SSE headers AFTER auth — must happen before SSEServerTransport.start() writes them
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');

        const protocol = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
        const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'pinterest-mcp-server-62kx.onrender.com';
        const baseUrl = `${protocol}://${host}`;
        
        const apiKeyQuery = req.query.api_key ? `?api_key=${encodeURIComponent(req.query.api_key as string)}` : '';
        const messagesEndpoint = `${baseUrl}/mcp${apiKeyQuery}`;

        const transport = new SSEServerTransport(messagesEndpoint, res);
        this.sseTransports.set(transport.sessionId, transport);
        
        req.on('close', () => {
          this.sseTransports.delete(transport.sessionId);
        });

        this.server.connect(transport);
      });
    });

    // Unified POST Handler for Messages & MCP JSON-RPC
    app.post(['/mcp', '/messages'], async (req: Request, res: Response, next: NextFunction) => {
      const sessionId = req.query.sessionId as string;
      let transport: SSEServerTransport | undefined;
      
      if (sessionId) {
        transport = this.sseTransports.get(sessionId);
      } else {
        transport = this.sseTransports.values().next().value;
      }

      if (transport) {
        await transport.handlePostMessage(req, res);
        return;
      }

      // Stateless HTTP JSON-RPC fallback for direct POST /mcp probes
      if (req.body && req.body.jsonrpc === '2.0') {
        const { method, id, params } = req.body;
        if (method === 'initialize') {
          res.json({
            jsonrpc: '2.0',
            id: id ?? 1,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {}, resources: {} },
              serverInfo: { name: 'pinterest-mcp-server', version: '1.2.0' }
            }
          });
          return;
        } else if (method === 'tools/list') {
          res.json({
            jsonrpc: '2.0',
            id: id ?? 2,
            result: {
              tools: [
                {
                  name: 'pinterest_health_check',
                  description: 'System metrics, memory usage, Chromium binary status, and write diagnostics',
                  inputSchema: { type: 'object', properties: {} }
                },
                {
                  name: 'pinterest_search',
                  description: 'Search for images on Pinterest by keyword with persistent browser pool',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      keyword: { type: 'string', description: 'Search term' },
                      limit: { type: 'number', description: 'Number of images to return' }
                    },
                    required: ['keyword']
                  }
                },
                {
                  name: 'pinterest_get_similar_pins',
                  description: 'Deep visual recommendation engine for a target Pin URL or Pin ID',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      pin_url_or_id: { type: 'string', description: 'Pinterest Pin URL or numeric Pin ID' },
                      limit: { type: 'number', description: 'Number of recommended pins' }
                    },
                    required: ['pin_url_or_id']
                  }
                },
                {
                  name: 'pinterest_get_image_info',
                  description: 'Retrieve detailed information for a Pinterest image',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      image_url: { type: 'string', description: 'Image URL' }
                    },
                    required: ['image_url']
                  }
                },
                {
                  name: 'pinterest_search_and_download',
                  description: 'Search and download Pinterest images directly to disk',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      keyword: { type: 'string', description: 'Search term' },
                      limit: { type: 'number', description: 'Number of images' }
                    },
                    required: ['keyword']
                  }
                },
                {
                  name: 'render_pinterest_gallery',
                  description: 'Render a visual image gallery widget inside ChatGPT. Always call pinterest_search first, then pass its images array here.',
                  inputSchema: {
                    type: 'object',
                    properties: {
                      keyword: { type: 'string', description: 'The search keyword used (for display)' },
                      images: {
                        type: 'array',
                        description: 'Array of image objects from pinterest_search structuredContent.images',
                        items: {
                          type: 'object',
                          properties: {
                            title: { type: 'string' },
                            proxyUrl: { type: 'string' },
                            directUrl: { type: 'string' },
                            pinLink: { type: 'string' }
                          }
                        }
                      }
                    },
                    required: ['images']
                  },
                  _meta: {
                    ui: {
                      resourceUri: 'ui://pinterest-mcp-server/gallery.html'
                    }
                  }
                }
              ]
            }
          });
          return;

        } else if (method === 'tools/call') {
          try {
            const toolResult = await this.executeToolCall(params?.name, params?.arguments || params?.args);
            res.json({
              jsonrpc: '2.0',
              id: id ?? 1,
              result: toolResult
            });
          } catch (err: any) {
            res.json({
              jsonrpc: '2.0',
              id: id ?? 1,
              error: { code: -32603, message: err.message }
            });
          }
          return;
        } else if (method === 'resources/list') {
          res.json({
            jsonrpc: '2.0',
            id: id ?? 1,
            result: {
              resources: [
                {
                  uri: 'ui://pinterest-mcp-server/gallery.html',
                  name: 'Pinterest Image Gallery',
                  description: 'Interactive Pinterest image gallery rendered as an iframe inside ChatGPT',
                  mimeType: 'text/html;profile=mcp-app',
                }
              ]
            }
          });
          return;
        } else if (method === 'resources/read') {
          // Serve the gallery HTML as a ui:// resource for MCP Apps iframe rendering
          const uri = params?.uri;
          if (uri === 'ui://pinterest-mcp-server/gallery.html') {
            const galleryHtml = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Pinterest Gallery</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0f0f0f;color:#fff;padding:16px}#header{margin-bottom:16px}#keyword{font-size:14px;color:#aaa;margin-bottom:4px}h1{font-size:20px;font-weight:700}#gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}.card{border-radius:12px;overflow:hidden;background:#1a1a1a;border:1px solid #2a2a2a;transition:transform .2s ease,box-shadow .2s ease}.card:hover{transform:translateY(-4px);box-shadow:0 12px 32px rgba(0,0,0,.6)}.card img{width:100%;aspect-ratio:3/4;object-fit:cover;display:block;background:#222}.card-footer{padding:8px 10px;display:flex;justify-content:space-between;align-items:center}.card-title{font-size:11px;color:#ccc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1}.pin-link{font-size:11px;color:#e60023;text-decoration:none;margin-left:6px;flex-shrink:0;font-weight:600}.spinner{text-align:center;padding:48px;color:#888;font-size:14px}</style></head><body><div id="header"><div id="keyword">Pinterest Search Results</div><h1>Image Gallery</h1></div><div id="gallery"><div class="spinner">Loading images...</div></div><script>const gallery=document.getElementById('gallery');const keywordEl=document.getElementById('keyword');const h1=document.querySelector('h1');function renderGallery(images,keyword){if(!images||!Array.isArray(images)||images.length===0){gallery.innerHTML='<div style="text-align:center;padding:48px;color:#666">No images found.</div>';return}if(keyword){keywordEl.textContent='Pinterest: '+keyword;h1.textContent=keyword+' \u2014 Image Gallery'}gallery.innerHTML=images.map((img,i)=>{const title=img.title||('Design '+(i+1));const src=img.proxyUrl||img.directUrl||'';const pin=img.pinLink||img.directUrl||'#';return \`<div class="card"><img src="\${src}" alt="\${title}" loading="lazy" onerror="this.style.background='#333'"><div class="card-footer"><span class="card-title">\${title}</span><a class="pin-link" href="\${pin}" target="_blank" rel="noopener">Pin</a></div></div>\`}).join('')}function handleData(data){if(!data)return;const sc=data.structuredContent||(data.params&&data.params.structuredContent)||data.params||data;const images=sc.images||data.images;const keyword=sc.keyword||data.keyword;if(images&&Array.isArray(images)){renderGallery(images,keyword)}}if(window.openai){if(window.openai.toolOutput)handleData(window.openai.toolOutput);else if(window.openai.toolInput)handleData(window.openai.toolInput)}window.addEventListener('message',function(event){const msg=event.data;if(!msg)return;if(msg.method==='ui/notifications/tool-result'||msg.method==='ui/notifications/tool-input'){handleData(msg.params)}else if(msg.jsonrpc==='2.0'&&msg.result){handleData(msg.result)}else if(msg.images||(msg.structuredContent&&msg.structuredContent.images)){handleData(msg)}},{passive:true});try{window.parent.postMessage({jsonrpc:'2.0',method:'ui/initialize',id:1,params:{}},'*')}catch(e){}<\/script></body></html>`;
            res.json({
              jsonrpc: '2.0',
              id: id ?? 1,
              result: {
                contents: [{
                  uri: 'ui://pinterest-mcp-server/gallery.html',
                  mimeType: 'text/html;profile=mcp-app',
                  text: galleryHtml
                }]
              }
            });
          } else {
            res.json({ jsonrpc: '2.0', id: id ?? 1, error: { code: -32602, message: `Unknown resource: ${uri}` } });
          }
          return;
        } else if (method === 'ping' || method === 'notifications/initialized') {
          res.json({ jsonrpc: '2.0', id: id ?? 1, result: {} });
          return;
        }
      }

      res.status(400).json({ error: 'Active SSE connection session not found' });
    });

    app.listen(port, () => {
      console.log(`🚀 Pinterest MCP Server listening in SSE mode on port ${port}`);
      if (getApiKey()) {
        console.log('🔒 API Key authentication is ENABLED');
      } else {
        console.log('⚠️ Warning: API Key authentication is DISABLED (set API_KEY or MCP_API_KEY env var to secure)');
      }
    });
  }

  /**
   * Run server automatically picking transport based on environment
   */
  async run(): Promise<void> {
    const portEnv = process.env.PORT || process.env.HTTP_PORT;
    const transportEnv = process.env.TRANSPORT;

    if (portEnv || transportEnv === 'sse') {
      const port = portEnv ? parseInt(portEnv, 10) : 3000;
      await this.runHttp(port);
    } else {
      await this.runStdio();
    }
  }
}

// Create and start server if executed directly
const server = new PinterestMcpServer();
server.run().catch(error => {
  console.error('Error starting server:', error);
  process.exit(1);
});