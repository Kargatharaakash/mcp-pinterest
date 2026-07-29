# Pinterest MCP Server - Architecture Documentation

## 1. System Overview

Pinterest MCP Server is a Model Context Protocol (MCP) compliant server providing Pinterest image search and downloading capabilities for AI applications. The server allows MCP clients (such as IDE extensions, AI tools, chat interfaces) to interact with Pinterest via standardized interfaces to search for images, retrieve metadata, and download images to local storage.

### 1.1 Key Features

*   Standardized interface based on Model Context Protocol (MCP)
*   Search public Pinterest content without user authentication
*   Keyword search and batch image downloading
*   Metadata retrieval for images
*   Dual transport modes: Stdio (Local desktop/IDE) and HTTP/SSE (Remote hosting / Render)
*   Bearer API key security middleware for cloud deployment
*   Integratable into any MCP-compatible AI host (Claude, Cursor, custom agents)

## 2. Tech Stack

*   **Language**: TypeScript / JavaScript (Node.js)
*   **Core Framework**: Model Context Protocol SDK (`@modelcontextprotocol/sdk`)
*   **Web Framework**: Express & Cors (for SSE Remote MCP server mode)
*   **Dependencies**:
    *   `puppeteer-core`: Headless browser automation for fetching Pinterest search results
    *   `axios`: HTTP client for reliable image file downloads
    *   `cheerio`: HTML parsing library
*   **Development Tools**:
    *   TypeScript
    *   Jest (Testing framework)
    *   ts-node-dev (Hot-reloading during development)

## 3. System Architecture

### 3.1 Component Architecture

The Pinterest MCP Server follows a modular design consisting of the following primary components:

```
┌────────────────────────────────────────┐
│           Pinterest MCP Server          │
│                                        │
│  ┌────────────┐       ┌──────────────┐ │       ┌─────────────┐
│  │   MCP      │       │  Pinterest   │ │       │             │
│  │  Server    │<─────>│   Scraper    │ │<─────>│  Pinterest  │
│  │ Interface  │       │              │ │       │  Website    │
│  └────────────┘       └──────────────┘ │       │             │
│         │                     │        │       └─────────────┘
│         │                     │        │
│         ▼                     ▼        │
│  ┌────────────┐       ┌──────────────┐ │       ┌─────────────┐
│  │  Auth &    │       │   Image      │ │       │             │
│  │   Tools    │<─────>│  Download    │ │<─────>│   Local     │
│  │  Handler   │       │   Module     │ │       │ File System │
│  └────────────┘       └──────────────┘ │       │             │
│                                        │       └─────────────┘
└────────────────────────────────────────┘
```

#### 3.1.1 MCP Server Interface

*   **Responsibility**: Implements MCP protocol, manages client connections (stdio / SSE), handles tool registration and request dispatching.
*   **Primary File**: `pinterest-mcp-server.ts`
*   **Class**: `PinterestMcpServer`
*   **Features**:
    *   Creates and configures MCP server instances
    *   Handles tool listing and invocation requests
    *   Routes tool requests to handlers
    *   Enforces Bearer API Key security on SSE endpoints
    *   Exposes `/health` probe for container monitoring (Render / Kubernetes)

#### 3.1.2 Pinterest Scraper Module

*   **Responsibility**: Interacts with Pinterest, executes search queries, extracts high-resolution image URLs.
*   **Primary File**: `pinterest-scraper.js`
*   **Class**: `PinterestScraper`
*   **Features**:
    *   Launches and manages headless browser instances
    *   Navigates Pinterest search pages
    *   Auto-scrolls to retrieve target image count
    *   Converts thumbnail URLs to high-resolution original images

#### 3.1.3 Download Module

*   **Responsibility**: Downloads image buffers to target storage with exponential backoff retries.
*   **Primary File**: `src/pinterest-download.js`
*   **Functions**: `downloadImage`, `batchDownload`

#### 3.1.4 Tool Handlers

*   **Responsibility**: Validates input parameters, executes business logic, formats MCP response objects.
*   **Methods**: `handlePinterestSearch`, `handlePinterestGetImageInfo`, `handlePinterestSearchAndDownload`

## 4. Security & Deployment

### 4.1 Bearer API Key Authentication (Option 1)

When hosted on public cloud providers (Render, Railway, Fly.io):
*   `API_KEY` or `MCP_API_KEY` environment variable defines the secret key.
*   `Authorization: Bearer <API_KEY>` or `x-api-key: <API_KEY>` header required for `/sse` and `/messages` requests.
*   Unauthenticated requests receive HTTP status `401 Unauthorized`.
*   Public health endpoint `GET /health` returns HTTP status `200 OK` for platform health checks.