import { z } from "zod";
import { executeParameterizedQuery, isValidTable } from "../../db/query-builder.js";
import type { McpContext } from "../server.js";

/**
 * Input schema for getting deal journey legs
 */
const GetDealJourneyLegsSchema = z.object({
  deal_id: z.union([z.string(), z.number()]).describe("ID of the deal to list journey legs for (bigint)"),
});

/**
 * Gets all journey legs for a deal, ordered by leg_order
 */
async function getDealJourneyLegs(
  params: z.infer<typeof GetDealJourneyLegsSchema>,
  context: McpContext
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    // Validate table exists
    if (!isValidTable("deal_journey_legs") || !isValidTable("deals")) {
      return {
        success: false,
        error: "Invalid table configuration",
      };
    }

    // Convert deal_id to number if it's a string
    const dealId = typeof params.deal_id === 'string' ? parseInt(params.deal_id, 10) : params.deal_id;

    if (isNaN(dealId)) {
      return {
        success: false,
        error: "Invalid deal_id: must be a valid number",
      };
    }

    // Verify the user has access to this deal
    const dealCheck = await executeParameterizedQuery(
      `SELECT id FROM deals WHERE id = $1 AND sales_id IN (SELECT id FROM sales WHERE user_id = $2)`,
      [dealId, context.authInfo.userId],
      context
    );

    if (!dealCheck.success || !dealCheck.data?.length) {
      return {
        success: false,
        error: "Deal not found or access denied",
      };
    }

    // Get journey legs ordered by leg_order
    const result = await executeParameterizedQuery(
      `SELECT 
        id, deal_id, leg_order, leg_type,
        pickup_datetime, pickup_timezone,
        pickup_location_text, dropoff_location_text,
        transport_mode, carrier_or_operator, transport_number,
        origin_code, destination_code,
        terminal, gate, platform,
        meet_point_instructions, driver_notes, dispatch_notes,
        created_at, updated_at
      FROM deal_journey_legs 
      WHERE deal_id = $1 
      ORDER BY leg_order ASC`,
      [dealId],
      context
    );

    if (!result.success) {
      return {
        success: false,
        error: "Failed to fetch journey legs",
      };
    }

    return {
      success: true,
      data: result.data || [],
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export const get_deal_journey_legs = {
  definition: {
    description: "Gets all journey legs for a specific deal, ordered by leg order",
    inputSchema: GetDealJourneyLegsSchema,
  },
  handler: getDealJourneyLegs,
};
