import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { get_schema } from "./tools/get-schema.js";
import { query } from "./tools/query.js";
import { create_contact } from "./tools/create-contact.js";
import { search_contacts } from "./tools/search-contacts.js";
import { get_summary } from "./tools/get-summary.js";
import { create_deal } from "./tools/create-deal.js";
import { create_task } from "./tools/create-task.js";
import { recordUsage, sanitizeParams } from "../services/usage-tracker.js";
import type { AuthInfo } from "../auth/jwt-validator.js";

export interface McpContext {
  authInfo: AuthInfo;
  userToken: string;
}

export function createMcpServer(context: McpContext) {
  const server = new McpServer(
    { name: "atomic-crm", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  // Register all tools
  const tools = { 
    get_schema, 
    query, 
    create_contact, 
    search_contacts, 
    get_summary,
    create_deal,
    create_task,
  };
  
  for (const [name, tool] of Object.entries(tools)) {
    server.registerTool(name, tool.definition, async (params: any) => {
      const startTime = Date.now();
      let success = true;
      let errorMessage: string | undefined;

      try {
        const result = await tool.handler(params, context);
        return result;
      } catch (error) {
        success = false;
        errorMessage = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        // Record usage asynchronously (don't block the response)
        const durationMs = Date.now() - startTime;
        recordUsage({
          userId: context.authInfo.userId,
          toolName: name,
          paramsSummary: sanitizeParams(params),
          success,
          errorMessage,
          durationMs,
        }).catch((err) => {
          console.error("Failed to record usage:", err);
        });
      }
    });
  }

  return server;
}
