import { z } from "zod";
import { executeParameterizedQuery, isValidTable } from "../../db/query-builder.js";
import type { McpContext } from "../server.js";

/**
 * Input schema for updating a deal
 */
const UpdateDealSchema = z.object({
  id: z.number().int().positive().describe("ID of the deal to update"),
  name: z.string().min(1).max(200).optional().describe("Deal name/title"),
  company_id: z.number().int().positive().nullable().optional().describe("ID of the associated company"),
  contact_ids: z.array(z.string().uuid()).max(10).optional().describe("Array of contact UUIDs to associate"),
  stage: z.string().max(50).optional().describe("Deal stage (opportunity, proposal, negotiation, closed-won, closed-lost)"),
  amount: z.number().int().positive().nullable().optional().describe("Deal amount in cents"),
  expected_close_date: z.string().nullable().optional().describe("Expected close date (YYYY-MM-DD)"),
  description: z.string().max(5000).nullable().optional().describe("Deal description"),
  probability: z.number().int().min(0).max(100).optional().describe("Win probability percentage (0-100)"),
});

/**
 * Updates an existing deal in the CRM
 */
async function updateDeal(
  params: z.infer<typeof UpdateDealSchema>,
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

    // Verify the deal belongs to this user
    const checkResult = await executeParameterizedQuery(
      `SELECT id FROM deals WHERE id = $1 AND sales_id = $2`,
      [params.id, salesId],
      context
    );

    if (!checkResult.success || !checkResult.data?.length) {
      return {
        success: false,
        error: "Deal not found or access denied",
      };
    }

    // Build dynamic update query
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (params.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(params.name);
    }
    if (params.company_id !== undefined) {
      updates.push(`company_id = $${paramIndex++}`);
      values.push(params.company_id);
    }
    if (params.stage !== undefined) {
      updates.push(`stage = $${paramIndex++}`);
      values.push(params.stage);
    }
    if (params.amount !== undefined) {
      updates.push(`amount = $${paramIndex++}`);
      values.push(params.amount);
    }
    if (params.expected_close_date !== undefined) {
      updates.push(`expected_close_date = $${paramIndex++}`);
      values.push(params.expected_close_date);
    }
    if (params.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(params.description);
    }
    if (params.probability !== undefined) {
      updates.push(`probability = $${paramIndex++}`);
      values.push(params.probability);
    }

    if (updates.length === 0 && params.contact_ids === undefined) {
      return {
        success: false,
        error: "No fields provided to update",
      };
    }

    // Add updated_at
    updates.push(`updated_at = NOW()`);

    // Add the deal id and sales_id for WHERE clause
    values.push(params.id);
    values.push(salesId);

    const updateSql = `
      UPDATE deals 
      SET ${updates.join(", ")}
      WHERE id = $${paramIndex} AND sales_id = $${paramIndex + 1}
      RETURNING id, name, stage, amount, probability, updated_at
    `;

    const result = await executeParameterizedQuery(updateSql, values, context);

    if (!result.success) {
      return {
        success: false,
        error: result.error || "Failed to update deal",
      };
    }

    // Handle contact_ids update if provided
    if (params.contact_ids !== undefined) {
      // First delete existing associations
      await executeParameterizedQuery(
        `DELETE FROM deal_contacts WHERE deal_id = $1`,
        [params.id],
        context
      );

      // Then insert new associations
      if (params.contact_ids.length > 0) {
        for (const contactId of params.contact_ids) {
          await executeParameterizedQuery(
            `INSERT INTO deal_contacts (deal_id, contact_id) VALUES ($1, $2)`,
            [params.id, contactId],
            context
          );
        }
      }
    }

    console.log(`Deal updated: ${params.id} by user ${context.authInfo.userId}`);

    return {
      success: true,
      data: result.data?.[0],
    };
  } catch (error) {
    console.error("Update deal error:", error instanceof Error ? error.message : "Unknown error");
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const update_deal = {
  definition: {
    description: `Update an existing deal in the Atomic CRM.

Use this tool when you need to modify an existing deal's information. Only provide the fields you want to update.

Required fields:
- id: ID of the deal to update

Optional fields (only include those you want to change):
- name: Deal name/title
- company_id: ID of the associated company
- contact_ids: Array of contact UUIDs to associate
- stage: Deal stage (opportunity, proposal, negotiation, closed-won, closed-lost)
- amount: Deal amount in cents
- expected_close_date: Expected close date (YYYY-MM-DD format)
- description: Deal description
- probability: Win probability percentage (0-100)

Note: You can only update deals that belong to you.

Example:
- Update stage: { "id": 123, "stage": "proposal" }
- Update amount: { "id": 123, "amount": 500000, "probability": 75 }`,
    inputSchema: UpdateDealSchema,
  },
  handler: async (params: z.infer<typeof UpdateDealSchema>, context: McpContext) => {
    const result = await updateDeal(params, context);

    return {
      content: [
        {
          type: "text" as const,
          text: result.success
            ? `Deal updated successfully:\n${JSON.stringify(result.data, null, 2)}`
            : `Error updating deal: ${result.error}`,
        },
      ],
      isError: !result.success,
    };
  },
};
