#!/usr/bin/env node
/**
 * Point d’entrée MCP stdio — Cursor / Claude Desktop.
 * Logs uniquement sur stderr (stdout = JSON-RPC).
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createNeyaMcpServer } from './server.js';

async function main() {
  const server = createNeyaMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[neya-erp-mcp] connecté → ${process.env.NEYA_ERP_URL || 'https://erp.neyafurniture.ca'}`);
}

main().catch((err) => {
  console.error('[neya-erp-mcp] fatal:', err);
  process.exit(1);
});
