# notion-mcp

[![npm version](https://img.shields.io/npm/v/@west10tech/notion-mcp.svg)](https://www.npmjs.com/package/@west10tech/notion-mcp)
[![Coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/gcaliene/85580419c40e9163928d29b56df2e00c/raw/coverage.json)]()

MCP server with full Notion capabilities (23 tools)

**npm:** https://www.npmjs.com/package/@west10tech/notion-mcp

## Available Tools

This MCP server provides 23 tools:

### Database Tools
- **notion_get_database**: Get database by ID
- **notion_query_database**: Query database pages
- **notion_create_database**: Create a new database
- **notion_update_database**: Update database properties

### Page Tools
- **notion_get_page**: Get page by ID
- **notion_create_page**: Create a new page
- **notion_update_page**: Update page properties
- **notion_get_page_property**: Get page property by ID

### Block Tools
- **notion_get_block_children**: Get block children
- **notion_append_block_children**: Append blocks to a parent block
- **notion_get_block**: Get block by ID
- **notion_update_block**: Update block content
- **notion_delete_block**: Delete a block

### User Tools
- **notion_list_users**: List all users
- **notion_get_user**: Get user by ID
- **notion_get_me**: Get current bot user

### Search & Comments
- **notion_search**: Search pages and databases
- **notion_create_comment**: Create a comment on a page or block
- **notion_get_comments**: Get comments for a page or block

### Template Tools
- **notion_create_page_from_template**: Create a new page by copying blocks from a template page
- **notion_create_database_from_template**: Create a new database by copying schema from a template database

### Duplication Tools
- **notion_duplicate_page**: Duplicate an existing page with its content blocks
- **notion_duplicate_database**: Duplicate an existing database with its schema

## Installation

```bash
npm install @west10tech/notion-mcp
```

## Environment Setup

Create a `.env` file with the following variables:

```env
NOTION_ACCESS_TOKEN=your_notion_access_token_here
```

## Getting a Notion API Key

1. Go to [https://www.notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click **"New integration"**
3. Give it a name (e.g. "MCP Server") and select the workspace
4. Under **Capabilities**, enable the permissions your integration needs (read content, update content, etc.)
5. Click **Submit** and copy the **Internal Integration Secret** — this is your `NOTION_ACCESS_TOKEN`
6. **Important:** Share pages/databases with your integration by clicking the `...` menu on a page → **Connections** → select your integration

## Usage

### Running the server (stdio)

```bash
# Development mode
npm run dev

# Production mode
npm run build && npm start
```

### Running with HTTP/SSE transport

```bash
# Start with HTTP transport
TRANSPORT_MODE=http PORT=3000 npm start
```

Environment variables for HTTP mode:

| Variable | Default | Description |
|----------|---------|-------------|
| `TRANSPORT_MODE` | `stdio` | Set to `http` for HTTP/SSE transport |
| `PORT` | `3000` | HTTP server port |
| `CORS_ORIGIN` | `*` | Allowed CORS origin |

HTTP endpoints:
- `POST /` — MCP JSON-RPC messages
- `GET /health` — Health check (`{"status":"ok","server":"notion-mcp"}`)

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

## Template & Duplication Workflows

### Creating a page from a template

Use `notion_create_page_from_template` to copy the block structure of an existing page:

```json
{
  "template_page_id": "abc123...",
  "parent": { "page_id": "def456..." },
  "title": "My New Page"
}
```

This reads all blocks from the template page and creates a new page with the same content.

### Creating a database from a template

Use `notion_create_database_from_template` to copy the property schema of an existing database:

```json
{
  "template_database_id": "abc123...",
  "parent": { "page_id": "def456..." },
  "title": "My New Database"
}
```

### Duplicating a page

Use `notion_duplicate_page` to create an exact copy of a page (properties + blocks):

```json
{
  "page_id": "abc123...",
  "title": "Custom Title"
}
```

If no title is provided, defaults to "Copy of {original title}". If no parent is provided, uses the same parent as the original.

### Duplicating a database

Use `notion_duplicate_database` to copy a database's schema:

```json
{
  "database_id": "abc123...",
  "title": "My Copy"
}
```

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
- Template and duplication operations

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

### TypeScript Types

All tool parameters are fully typed. Import types from `@west10tech/notion-mcp/types`:

- `GetDatabaseParams`, `QueryDatabaseParams`, `CreateDatabaseParams`, `UpdateDatabaseParams`
- `GetPageParams`, `CreatePageParams`, `UpdatePageParams`, `GetPagePropertyParams`
- `GetBlockChildrenParams`, `AppendBlockChildrenParams`, `GetBlockParams`, `UpdateBlockParams`, `DeleteBlockParams`
- `ListUsersParams`, `GetUserParams`
- `SearchParams`, `CreateCommentParams`, `GetCommentsParams`
- `CreatePageFromTemplateParams`, `CreateDatabaseFromTemplateParams`
- `DuplicatePageParams`, `DuplicateDatabaseParams`
- `ToolResponse`
