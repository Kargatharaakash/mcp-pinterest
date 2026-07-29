#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
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
        }
      ]
    }));

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
          const thumbnailPatterns = ['/60x60/', '/236x/', '/474x/', '/736x/'];
          let needsFix = false;
          
          for (const pattern of thumbnailPatterns) {
            if (result.image_url.includes(pattern)) {
              needsFix = true;
              break;
            }
          }
          
          if (!needsFix && result.image_url.match(/\/\d+x\d*\//)) {
            needsFix = true;
          }
          
          if (needsFix) {
            result.image_url = result.image_url.replace(/\/\d+x\d*\//, '/originals/');
          }
        }
      }
      
      const contentItems: Array<{type: string; text: string}> = [
        {
          type: 'text',
          text: `Found ${validResults.length} images related to "${keyword}" on Pinterest`
        }
      ];
      
      validResults.forEach((result, index) => {
        contentItems.push({
          type: 'text',
          text: `Image ${index + 1}: ${result.title || 'No title'}`
        });
        
        contentItems.push({
          type: 'text',
          text: `Link: ${result.image_url || 'No link'}`
        });
        
        if (result.link && result.link !== result.image_url) {
          contentItems.push({
            type: 'text',
            text: `Original page: ${result.link}`
          });
        }
        
        if (index < validResults.length - 1) {
          contentItems.push({
            type: 'text',
            text: `---`
          });
        }
      });
      
      return {
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

      const contentItems: Array<{type: string; text: string}> = [
        {
          type: 'text',
          text: `Found ${results.length} related visual design recommendations for pin: "${pinUrlOrId}"`
        }
      ];

      results.forEach((item: any, index: number) => {
        contentItems.push({
          type: 'text',
          text: `Recommendation ${index + 1}: ${item.title || 'Related Pin'}`
        });

        contentItems.push({
          type: 'text',
          text: `Image URL: ${item.image_url}`
        });

        contentItems.push({
          type: 'text',
          text: `Pin Link: ${item.link}`
        });

        if (index < results.length - 1) {
          contentItems.push({
            type: 'text',
            text: `---`
          });
        }
      });

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
      res.setHeader('X-Accel-Buffering', 'no');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      this.authenticateMiddleware(req, res, () => {
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
              capabilities: { tools: {} },
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