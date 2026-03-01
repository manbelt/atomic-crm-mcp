import { z } from "zod";
import { executeParameterizedQuery, isValidTable } from "../../db/query-builder.js";
import type { McpContext } from "../server.js";

/**
 * Input schema for listing journey legs
 */
const ListJourneyLegsSchema = z.object({
  deal_id: z.number().int().positive().describe("ID of the deal to list journey legs for"),
});

/**
 * Lists all journey legs for a deal, ordered by leg_order
 */
async function listJourneyLegs(
  params: z.infer<typeof ListJourneyLegsSchema>,
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

    // Verify the user has access to this deal
    const dealCheck = await executeParameterizedQuery(
      `SELECT id FROM deals WHERE id = $1 AND sales_id IN (SELECT id FROM sales WHERE user_id = $2)`,
      [params.deal_id, context.authInfo.userId],
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
        scheduled_departure_datetime, scheduled_arrival_datetime,
        pickup_location_text, dropoff_location_text,
        transport_mode, carrier, transport_number,
        origin_code, destination_code,
        terminal, gate, platform,
        meet_point_instructions, driver_notes, dispatch_notes,
        created_at, updated_at
      FROM deal_journey_legs 
      WHERE deal_id = $1 
      ORDER BY leg_order ASC`,
      [params.deal_id],
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

export const list_journey_legs = {
  definition: {
    description: "Lists all journey legs for a specific deal, ordered by leg order",
    inputSchema: ListJourneyLegsSchema,
  },
  handler: listJourneyLegs,
};
