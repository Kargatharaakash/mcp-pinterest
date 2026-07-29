[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/terryso-mcp-pinterest-badge.png)](https://mseep.ai/app/terryso-mcp-pinterest)

# Pinterest MCP Server

[![npm version](https://badge.fury.io/js/pinterest-mcp-server.svg)](https://badge.fury.io/js/pinterest-mcp-server)
![NPM Downloads](https://img.shields.io/npm/dw/pinterest-mcp-server)
[![smithery badge](https://smithery.ai/badge/@terryso/mcp-pinterest)](https://smithery.ai/server/@terryso/mcp-pinterest)
[![Verified on MseeP](https://mseep.ai/badge.svg)](https://mseep.ai/app/23da55f4-6d6a-4dc9-af31-cd6073eb1b27)

A Model Context Protocol (MCP) server for Pinterest image search and information retrieval.

## Features

- Search for images on Pinterest by keywords
- Retrieve detailed information about Pinterest images
- Seamless integration with Cursor IDE, Claude Desktop, and Remote MCP clients
- Dual transport modes: Stdio (Local IDEs) and HTTP/SSE (Remote Hosting / Render)
- API Key Bearer Authentication for cloud deployment
- Support for headless browser mode
- Configurable search result limits and filename templates
- Search and download images directly to local storage

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- [Cursor IDE](https://cursor.sh/) or [Claude Desktop](https://claude.ai/) for MCP integration

## Installation & Deployment

### 🚀 Deploying to Render (Remote MCP Server over HTTP/SSE)

You can host this Pinterest MCP server as a secure remote service on Render, Railway, or Fly.io with **Bearer API Key authentication**.

1. Connect your repository to **Render** or use the included `render.yaml` blueprint.
2. Set Environment Variables:
   - `PORT`: `3000` (or leave default set by Render)
   - `API_KEY`: `your_super_secret_key_here` (Secret key required for client requests)
   - `MCP_PINTEREST_DOWNLOAD_DIR`: `/tmp/downloads`
3. Health check URL: `GET /health` (Returns `200 OK`)
4. SSE connection URL: `GET /sse` (Requires `Authorization: Bearer <API_KEY>` header or `x-api-key` header)

#### Client Request Example with Bearer Key

```http
GET /sse HTTP/1.1
Host: pinterest-mcp.onrender.com
Authorization: Bearer your_super_secret_key_here
```

Unauthenticated requests receive `401 Unauthorized` responses.

---

### Local Installation via NPX (Recommended for Local Use)

```bash
npx pinterest-mcp-server
```

Command-line options:

```bash
# Specify download directory
npx pinterest-mcp-server --downloadDir /path/to/downloads

# Specify filename template
npx pinterest-mcp-server --filenameTemplate "pinterest_{id}"

# Specify both options
npx pinterest-mcp-server --downloadDir ./images --filenameTemplate "pinterest_{id}"
```

### Global Installation

```bash
npm install -g pinterest-mcp-server
pinterest-mcp-server --downloadDir /path/to/downloads
```

### Manual Installation

1. Clone repository:
   ```bash
   git clone https://github.com/terryso/mcp-pinterest.git pinterest-mcp-server
   cd pinterest-mcp-server
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build server:
   ```bash
   npm run build
   ```

4. Start server:
   ```bash
   npm start
   ```

## Configuring as MCP Server in Cursor

1. Open Cursor IDE
2. Go to **Settings (⚙️) > Extensions > MCP**
3. Click **Add Server**
4. Enter configuration:
   - Name: `Pinterest MCP`
   - Type: `Command`
   - Command: `node`
   - Args: `["/path/to/mcp-pinterest/dist/pinterest-mcp-server.js"]`

Or edit your Cursor MCP config file (`~/.cursor/mcp.json`):
```json
{
  "pinterest": {
    "command": "node",
    "args": ["/path/to/mcp-pinterest/dist/pinterest-mcp-server.js"]
  }
}
```

### Environment Variables Configuration Example

```json
{
  "pinterest": {
    "command": "npx",
    "env": {
      "MCP_PINTEREST_DOWNLOAD_DIR": "/Users/user/Desktop/Images",
      "MCP_PINTEREST_FILENAME_TEMPLATE": "pin_{imageId}_{timestamp}.{fileExtension}",
      "MCP_PINTEREST_PROXY_SERVER": "http://127.0.0.1:7890"
    },
    "args": ["pinterest-mcp-server"]
  }
}
```

## Available MCP Tools

- `pinterest_health_check`: System metrics, memory usage, Chromium binary status, and write diagnostics
  - No required parameters.

- `pinterest_search`: Search for images on Pinterest by keyword with persistent browser pool
  - `keyword`: Search term (required)
  - `limit`: Number of images to return (default: 10)
  - `headless`: Whether to use headless browser mode (default: true)

- `pinterest_get_similar_pins`: Deep visual recommendation engine for a target Pin URL or Pin ID
  - `pin_url_or_id`: Pinterest Pin URL (e.g. `https://www.pinterest.com/pin/11822017768403505/`) or numeric Pin ID (required)
  - `limit`: Number of recommended pins to return (default: 10)
  - `headless`: Whether to use headless browser mode (default: true)

- `pinterest_get_image_info`: Retrieve detailed information for a Pinterest image
  - `image_url`: Image URL (required)

- `pinterest_search_and_download`: Search and download Pinterest images directly to disk
  - `keyword`: Search term (required)
  - `limit`: Number of images (default: 10)
  - `headless`: Whether to use headless browser mode (default: true)

## Environment Variables Reference

| Variable | Description | Default |
|---|---|---|
| `PORT` / `HTTP_PORT` | HTTP Port for SSE server mode | (Stdio mode if unassigned) |
| `API_KEY` / `MCP_API_KEY` | Secret API key for HTTP/SSE authentication | (No auth if empty) |
| `MCP_PINTEREST_DOWNLOAD_DIR` | Root directory for downloads | `../downloads` |
| `MCP_PINTEREST_FILENAME_TEMPLATE` | Template for downloaded file names | `pinterest_{imageId}.{fileExtension}` |
| `MCP_PINTEREST_PROXY_SERVER` | Optional proxy server (`http://host:port`) | None |
| `PUPPETEER_EXECUTABLE_PATH` | Path to custom Chrome/Chromium binary | System default |

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

<!-- Deployed: 2026-07-29 -->
