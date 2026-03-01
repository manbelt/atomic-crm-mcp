import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { get_schema } from "./tools/get-schema.js";
import { query } from "./tools/query.js";
import { create_contact } from "./tools/create-contact.js";
import { search_contacts } from "./tools/search-contacts.js";
import { get_summary } from "./tools/get-summary.js";
import { create_deal } from "./tools/create-deal.js";
import { create_task } from "./tools/create-task.js";
import { create_company } from "./tools/create-company.js";
import { create_note } from "./tools/create-note.js";
import { update_contact } from "./tools/update-contact.js";
import { update_deal } from "./tools/update-deal.js";
import { update_task } from "./tools/update-task.js";
import { update_company } from "./tools/update-company.js";
import { delete_contact } from "./tools/delete-contact.js";
import { delete_deal } from "./tools/delete-deal.js";
import { delete_task } from "./tools/delete-task.js";
import { delete_company } from "./tools/delete-company.js";
import { get_deal_journey_legs } from "./tools/get-deal-journey-legs.js";
import { create_deal_journey_leg } from "./tools/create-journey-leg.js";
import { update_deal_journey_leg } from "./tools/update-journey-leg.js";
import { delete_deal_journey_leg } from "./tools/delete-journey-leg.js";
import { reorder_deal_journey_leg } from "./tools/reorder-journey-leg.js";
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
    // Read operations
    get_schema, 
    query, 
    search_contacts, 
    get_summary,
    get_deal_journey_legs,
    // Create operations
    create_contact,
    create_deal,
    create_task,
    create_company,
    create_note,
    create_deal_journey_leg,
    // Update operations
    update_contact,
    update_deal,
    update_task,
    update_company,
    update_deal_journey_leg,
    // Delete operations
    delete_contact,
    delete_deal,
    delete_task,
    delete_company,
    delete_deal_journey_leg,
    // Reorder operations
    reorder_deal_journey_leg,
  };
  
  for (const [name, tool] of Object.entries(tools)) {
    server.registerTool(name, tool.definition, async (params: any) => {
      const startTime = Date.now();
      let success = true;
      let errorMessage: string | undefined;

      try {
        const result = await tool.handler(params, context);
        // Wrap the result in MCP-compliant format with content array
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        success = false;
        errorMessage = error instanceof Error ? error.message : String(error);
        // Return error in MCP-compliant format instead of throwing
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: false, error: errorMessage }, null, 2),
            },
          ],
          isError: true,
        };
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
