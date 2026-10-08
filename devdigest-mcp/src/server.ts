import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TOOL_NAME, TOOL_CONFIG, getBlastRadius } from './tools/get-blast-radius.js';

export function createServer(): McpServer {
  const server = new McpServer({ name: 'devdigest', version: '0.0.0' });
  server.registerTool(TOOL_NAME, TOOL_CONFIG, (args) => getBlastRadius(args));
  return server;
}
