import { z } from "zod";
import { executeParameterizedQuery, isValidTable } from "../../db/query-builder.js";
import type { McpContext } from "../server.js";

/**
 * Input schema for deleting a deal
 */
const DeleteDealSchema = z.object({
  id: z.number().int().positive().describe("ID of the deal to delete"),
});

/**
 * Deletes a deal from the CRM
 */
async function deleteDeal(
  params: z.infer<typeof DeleteDealSchema>,
  context: McpContext
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    // Get the sales_id from the authenticated user
    const salesResult = await executeParameterizedQuery(
      `SELECT id FROM sales WHERE user_id = $1`,
      [context.authInfo.userId],
      context
    );

    if (!salesResult.success || !salesResult.data?.length) {
      return {
        success: false,
        error: "Unable to find sales record for authenticated user",
      };
    }

    const salesId = salesResult.data[0].id;

    // Verify the deal belongs to this user and get its info
    const checkResult = await executeParameterizedQuery(
      `SELECT id, name, stage FROM deals WHERE id = $1 AND sales_id = $2`,
      [params.id, salesId],
      context
    );

    if (!checkResult.success || !checkResult.data?.length) {
      return {
        success: false,
        error: "Deal not found or access denied",
      };
    }

    const dealInfo = checkResult.data[0];

    // Delete associated notes first
    await executeParameterizedQuery(
      `DELETE FROM dealNotes WHERE deal_id = $1`,
      [params.id],
      context
    );

    // Delete associated contact associations
    await executeParameterizedQuery(
      `DELETE FROM deal_contacts WHERE deal_id = $1`,
      [params.id],
      context
    );

    // Delete the deal
    const deleteResult = await executeParameterizedQuery(
      `DELETE FROM deals WHERE id = $1 AND sales_id = $2 RETURNING id`,
      [params.id, salesId],
      context
    );

    if (!deleteResult.success) {
      return {
        success: false,
        error: deleteResult.error || "Failed to delete deal",
      };
    }

    console.log(`Deal deleted: ${params.id} by user ${context.authInfo.userId}`);

    return {
      success: true,
      data: {
        id: params.id,
        deleted: true,
        deal: dealInfo,
      },
    };
  } catch (error) {
    console.error("Delete deal error:", error instanceof Error ? error.message : "Unknown error");
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const delete_deal = {
  definition: {
    description: `Delete a deal from the Atomic CRM.

Use this tool when you need to permanently remove a deal from the CRM.

Required fields:
- id: ID of the deal to delete

Note: This will also delete all associated notes and contact associations. You can only delete deals that belong to you.

Example:
- Delete a deal: { "id": 123 }`,
    inputSchema: DeleteDealSchema,
  },
  handler: async (params: z.infer<typeof DeleteDealSchema>, context: McpContext) => {
    const result = await deleteDeal(params, context);

    return {
      content: [
        {
          type: "text" as const,
          text: result.success
            ? `Deal deleted successfully:\n${JSON.stringify(result.data, null, 2)}`
            : `Error deleting deal: ${result.error}`,
        },
      ],
      isError: !result.success,
    };
  },
};
