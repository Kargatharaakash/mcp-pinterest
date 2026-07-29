#!/usr/bin/env node

/**
 * CLI script for starting Pinterest MCP Server via npx / CLI
 */

// Parse command line arguments
const args = process.argv.slice(2);
const options = {};

for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const key = args[i].slice(2);
    const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
    options[key] = value;
    if (value !== true) i++;
  }
}

const port = options.port || process.env.PORT || 3000;

console.log('🚀 Starting Pinterest MCP Server...');
console.log('📋 Server configuration:', options);

if (options.downloadDir) {
  process.env.MCP_PINTEREST_DOWNLOAD_DIR = options.downloadDir;
}

if (options.filenameTemplate) {
  process.env.MCP_PINTEREST_FILENAME_TEMPLATE = options.filenameTemplate;
}

// Import and run server
import('../dist/pinterest-mcp-server.js')
  .then(() => {
    console.log(`✅ Server initialization triggered. Port: ${port}`);
  })
  .catch(error => {
    console.error('❌ Server failed to start:', error);
    process.exit(1);
  });