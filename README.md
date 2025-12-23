# notion-mcp

[![npm version](https://img.shields.io/npm/v/@west10tech/notion-mcp.svg)](https://www.npmjs.com/package/@west10tech/notion-mcp)

MCP server with full Notion capabilities (20 endpoints)

**npm:** https://www.npmjs.com/package/@west10tech/notion-mcp

This MCP server includes the following integrations:

## Available Tools

This MCP server provides 20 tools across 1 integrations:

### Notion Tools
- **notion_list_databases**: ⚠️ DEPRECATED: This endpoint is deprecated by Notion API. Use the search endpoint with database filter instead.
- **notion_get_database**: Get database by ID
- **notion_query_database**: Query database pages
- **notion_create_database**: Create a new database
- **notion_update_database**: Update database properties
- **notion_get_page**: Get page by ID
- **notion_create_page**: Create a new page. Note: Creating pages directly in workspace root requires special permissions - use database or page parents instead.
- **notion_update_page**: Update page properties
- **notion_get_page_property**: Get page property by ID
- **notion_get_block_children**: Get block children
- **notion_append_block_children**: Append blocks to a parent block
- **notion_get_block**: Get block by ID
- **notion_update_block**: Update block content
- **notion_delete_block**: Delete a block
- **notion_list_users**: List all users
- **notion_get_user**: Get user by ID
- **notion_get_me**: Get current bot user
- **notion_search**: Search pages and databases
- **notion_create_comment**: Create a comment on a page or block
- **notion_get_comments**: Get comments for a page or block

## Installation

```bash
npm install @west10tech/notion-mcp
```

## Environment Setup

Create a `.env` file with the following variables:

```env
NOTION_ACCESS_TOKEN=your_notion_access_token_here
```

## Usage

### Running the server

```bash
# Development mode
npm run dev

# Production mode
npm run build && npm start
```

### Using with Claude Desktop

Add this to your Claude Desktop configuration:

```json
{
  "mcpServers": {
    "notion-mcp": {
      "command": "npx",
      "args": ["@west10tech/notion-mcp"],
      "env": {
        "NOTION_ACCESS_TOKEN": "your_notion_access_token_here"
      }
    }
  }
}
```

## Instructions for Fetching API Keys/Tokens
- **COMING SOON**

## Advanced Features

### Request Cancellation

This MCP server supports request cancellation according to the [MCP cancellation specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/utilities/cancellation). Clients can cancel in-progress requests by sending a `notifications/cancelled` message with the request ID.

When a request is cancelled:
- The server immediately stops processing the request
- Any ongoing API calls are aborted
- Resources are cleaned up
- No response is sent for the cancelled request

### Progress Notifications

The server supports progress notifications for long-running operations according to the [MCP progress specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/utilities/progress). 

To receive progress updates:
1. Include a `progressToken` in your request metadata
2. The server will send `notifications/progress` messages with:
   - Current progress value
   - Total value (when known)
   - Human-readable status messages

Progress is reported for:
- Multi-step operations
- Batch processing
- Long-running API calls
- File uploads/downloads

Example progress notification:
```json
{
  "method": "notifications/progress",
  "params": {
    "progressToken": "operation-123",
    "progress": 45,
    "total": 100,
    "message": "Processing item 45 of 100..."
  }
}
```
