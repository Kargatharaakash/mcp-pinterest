import { PinterestMcpServer } from '../pinterest-mcp-server.js';

/**
 * Start the Pinterest MCP Server
 * @param options Server configuration options
 * @returns Promise resolving when the server starts
 */
export async function startServer(options: any = {}) {
  // Instantiate Pinterest MCP Server
  const server = new PinterestMcpServer();
  
  // Apply options if provided
  if (options) {
    if (options.downloadDir) {
      process.env.MCP_PINTEREST_DOWNLOAD_DIR = options.downloadDir;
    }
    if (options.filenameTemplate) {
      process.env.MCP_PINTEREST_FILENAME_TEMPLATE = options.filenameTemplate;
    }
  }
  
  // Start server
  return server.run();
}

// Start server if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer()
    .then(() => console.log('Server started successfully'))
    .catch(err => {
      console.error('Failed to start server:', err);
      process.exit(1);
    });
}