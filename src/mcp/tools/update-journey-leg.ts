import { z } from "zod";
import { executeParameterizedQuery, isValidTable } from "../../db/query-builder.js";
import type { McpContext } from "../server.js";

/**
 * Valid leg types
 */
const LEG_TYPES = [
  "airport_arrival",
  "airport_departure",
  "train_arrival",
  "train_departure",
  "point_to_point",
  "hourly",
  "tour_stop",
] as const;

/**
 * Valid transport modes
 */
const TRANSPORT_MODES = ["flight", "train", "none"] as const;

/**
 * Input schema for updating a journey leg
 */
const UpdateJourneyLegSchema = z.object({
  id: z.string().uuid().describe("UUID of the journey leg to update"),
  leg_order: z.number().int().min(1).optional().describe("Order of the leg in the journey"),
  leg_type: z.enum(LEG_TYPES).optional().describe("Type of journey leg"),
  pickup_datetime: z.string().optional().describe("Pickup datetime (ISO 8601 format)"),
  pickup_timezone: z.string().optional().describe("Timezone for pickup time"),
  pickup_location_text: z.string().min(1).max(500).optional().describe("Pickup location description"),
  dropoff_location_text: z.string().max(500).optional().describe("Dropoff location description"),
  transport_mode: z.enum(TRANSPORT_MODES).optional().describe("Mode of transport"),
  carrier_or_operator: z.string().max(100).optional().describe("Carrier/operator name"),
  transport_number: z.string().max(50).optional().describe("Flight number or train number"),
  origin_code: z.string().max(10).optional().describe("Origin airport/station code"),
  destination_code: z.string().max(10).optional().describe("Destination airport/station code"),
  terminal: z.string().max(20).optional().describe("Terminal"),
  gate: z.string().max(20).optional().describe("Gate"),
  platform: z.string().max(20).optional().describe("Platform"),
  meet_point_instructions: z.string().max(1000).optional().describe("Meet point instructions"),
  driver_notes: z.string().max(2000).optional().describe("Driver notes"),
  dispatch_notes: z.string().max(2000).optional().describe("Dispatch notes"),
});

/**
 * Sanitize a string for database
 */
function sanitizeString(str: string | undefined, maxLength: number): string | null {
  if (str === undefined) return undefined as any;
  if (!str) return null;
  const trimmed = str.trim();
  return trimmed.length > 0 ? trimmed.substring(0, maxLength) : null;
}

/**
 * Updates a journey leg
 */
async function updateJourneyLeg(
  params: z.infer<typeof UpdateJourneyLegSchema>,
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

    // Verify the journey leg exists and user has access to the deal
    const legCheck = await executeParameterizedQuery(
      `SELECT jl.id, jl.deal_id, jl.transport_mode 
       FROM deal_journey_legs jl
       JOIN deals d ON jl.deal_id = d.id
       WHERE jl.id = $1::uuid AND d.sales_id IN (SELECT id FROM sales WHERE user_id = $2)`,
      [params.id, context.authInfo.userId],
      context
    );

    if (!legCheck.success || !legCheck.data?.length) {
      return {
        success: false,
        error: "Journey leg not found or access denied",
      };
    }

    const existingLeg = legCheck.data[0];

    // Validate: transport_number required when transport_mode is flight or train
    const transportMode = params.transport_mode || existingLeg.transport_mode;
    if (
      (transportMode === "flight" || transportMode === "train") &&
      !params.transport_number
    ) {
      // Check if there's an existing transport_number
      const existingTransportCheck = await executeParameterizedQuery(
        `SELECT transport_number FROM deal_journey_legs WHERE id = $1::uuid`,
        [params.id],
        context
      );
      
      if (!existingTransportCheck.success || !existingTransportCheck.data?.[0]?.transport_number) {
        return {
          success: false,
          error: `transport_number is required when transport_mode is ${transportMode}`,
        };
      }
    }

    // Build dynamic update query
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (params.leg_order !== undefined) {
      updates.push(`leg_order = $${paramIndex++}`);
      values.push(params.leg_order);
    }
    if (params.leg_type !== undefined) {
      updates.push(`leg_type = $${paramIndex++}`);
      values.push(params.leg_type);
    }
    if (params.pickup_datetime !== undefined) {
      updates.push(`pickup_datetime = $${paramIndex++}`);
      values.push(params.pickup_datetime);
    }
    if (params.pickup_timezone !== undefined) {
      updates.push(`pickup_timezone = $${paramIndex++}`);
      values.push(params.pickup_timezone);
    }
    if (params.pickup_location_text !== undefined) {
      updates.push(`pickup_location_text = $${paramIndex++}`);
      values.push(sanitizeString(params.pickup_location_text, 500));
    }
    if (params.dropoff_location_text !== undefined) {
      updates.push(`dropoff_location_text = $${paramIndex++}`);
      values.push(sanitizeString(params.dropoff_location_text, 500));
    }
    if (params.transport_mode !== undefined) {
      updates.push(`transport_mode = $${paramIndex++}`);
      values.push(params.transport_mode);
    }
    if (params.carrier_or_operator !== undefined) {
      updates.push(`carrier_or_operator = $${paramIndex++}`);
      values.push(sanitizeString(params.carrier_or_operator, 100));
    }
    if (params.transport_number !== undefined) {
      updates.push(`transport_number = $${paramIndex++}`);
      values.push(sanitizeString(params.transport_number, 50));
    }
    if (params.origin_code !== undefined) {
      updates.push(`origin_code = $${paramIndex++}`);
      values.push(sanitizeString(params.origin_code, 10));
    }
    if (params.destination_code !== undefined) {
      updates.push(`destination_code = $${paramIndex++}`);
      values.push(sanitizeString(params.destination_code, 10));
    }
    if (params.terminal !== undefined) {
      updates.push(`terminal = $${paramIndex++}`);
      values.push(sanitizeString(params.terminal, 20));
    }
    if (params.gate !== undefined) {
      updates.push(`gate = $${paramIndex++}`);
      values.push(sanitizeString(params.gate, 20));
    }
    if (params.platform !== undefined) {
      updates.push(`platform = $${paramIndex++}`);
      values.push(sanitizeString(params.platform, 20));
    }
    if (params.meet_point_instructions !== undefined) {
      updates.push(`meet_point_instructions = $${paramIndex++}`);
      values.push(sanitizeString(params.meet_point_instructions, 1000));
    }
    if (params.driver_notes !== undefined) {
      updates.push(`driver_notes = $${paramIndex++}`);
      values.push(sanitizeString(params.driver_notes, 2000));
    }
    if (params.dispatch_notes !== undefined) {
      updates.push(`dispatch_notes = $${paramIndex++}`);
      values.push(sanitizeString(params.dispatch_notes, 2000));
    }

    if (updates.length === 0) {
      return {
        success: false,
        error: "No fields to update",
      };
    }

    updates.push(`updated_at = NOW()`);

    const updateSql = `
      UPDATE deal_journey_legs
      SET ${updates.join(", ")}
      WHERE id = $${paramIndex++}::uuid
      RETURNING id, deal_id, leg_order, leg_type, pickup_datetime, pickup_timezone,
                pickup_location_text, dropoff_location_text,
                transport_mode, carrier_or_operator, transport_number,
                origin_code, destination_code,
                terminal, gate, platform,
                meet_point_instructions, driver_notes, dispatch_notes,
                created_at, updated_at
    `;
    values.push(params.id);

    const result = await executeParameterizedQuery(updateSql, values, context);

    if (!result.success) {
      return {
        success: false,
        error: "Failed to update journey leg",
      };
    }

    return {
      success: true,
      data: result.data?.[0],
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export const update_deal_journey_leg = {
  definition: {
    description: "Updates an existing journey leg",
    inputSchema: UpdateJourneyLegSchema,
  },
  handler: updateJourneyLeg,
};
