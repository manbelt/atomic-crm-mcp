import { z } from "zod";
import { executeParameterizedQuery, isValidTable } from "../../db/query-builder.js";
import type { McpContext } from "../server.js";

/**
 * Input schema for deleting a journey leg
 */
const DeleteJourneyLegSchema = z.object({
  id: z.string().uuid().describe("UUID of the journey leg to delete"),
});

/**
 * Deletes a journey leg
 */
async function deleteJourneyLeg(
  params: z.infer<typeof DeleteJourneyLegSchema>,
  context: McpContext
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    // Validate table exists
    if (!isValidTable("deal_journey_legs")) {
      return {
        success: false,
        error: "Invalid table configuration",
      };
    }

    // Verify the journey leg exists and user has access to the deal
    const legCheck = await executeParameterizedQuery(
      `SELECT jl.id 
       FROM deal_journey_legs jl
       JOIN deals d ON jl.deal_id = d.id
       WHERE jl.id = $1 AND d.sales_id IN (SELECT id FROM sales WHERE user_id = $2)`,
      [params.id, context.authInfo.userId],
      context
    );

    if (!legCheck.success || !legCheck.data?.length) {
      return {
        success: false,
        error: "Journey leg not found or access denied",
      };
    }

    // Delete the journey leg
    const result = await executeParameterizedQuery(
      `DELETE FROM deal_journey_legs WHERE id = $1 RETURNING id`,
      [params.id],
      context
    );

    if (!result.success) {
      return {
        success: false,
        error: "Failed to delete journey leg",
      };
    }

    return {
      success: true,
      data: { id: params.id, deleted: true },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export const delete_journey_leg = {
  definition: {
    description: "Deletes a journey leg",
    inputSchema: DeleteJourneyLegSchema,
  },
  handler: deleteJourneyLeg,
};
