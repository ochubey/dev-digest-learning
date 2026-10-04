#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

// stdout carries the MCP protocol: log to stderr only.
await createServer().connect(new StdioServerTransport());
console.error('devdigest-mcp ready (stdio)');
