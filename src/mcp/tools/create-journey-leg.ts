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
 * Input schema for creating a journey leg
 */
const CreateJourneyLegSchema = z.object({
  deal_id: z.union([z.string(), z.number()]).describe("ID of the deal to add journey leg to (bigint)"),
  leg_order: z.number().int().min(1).optional().default(1).describe("Order of the leg in the journey"),
  leg_type: z.enum(LEG_TYPES).describe("Type of journey leg"),
  pickup_datetime: z.string().describe("Pickup datetime (ISO 8601 format)"),
  pickup_timezone: z.string().optional().default("Europe/Paris").describe("Timezone for pickup time"),
  pickup_location_text: z.string().min(1).max(500).describe("Pickup location description"),
  dropoff_location_text: z.string().max(500).optional().describe("Dropoff location description"),
  transport_mode: z.enum(TRANSPORT_MODES).optional().default("none").describe("Mode of transport"),
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
  if (!str) return null;
  const trimmed = str.trim();
  return trimmed.length > 0 ? trimmed.substring(0, maxLength) : null;
}

/**
 * Creates a new journey leg for a deal
 */
async function createJourneyLeg(
  params: z.infer<typeof CreateJourneyLegSchema>,
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

    // Validate: transport_number required when transport_mode is flight or train
    if (
      (params.transport_mode === "flight" || params.transport_mode === "train") &&
      !params.transport_number
    ) {
      return {
        success: false,
        error: `transport_number is required when transport_mode is ${params.transport_mode}`,
      };
    }

    // Validate: dropoff_location_text required for certain leg types
    const legTypesRequiringDropoff = [
      "airport_arrival",
      "airport_departure",
      "train_arrival",
      "train_departure",
      "point_to_point",
    ];
    
    if (
      legTypesRequiringDropoff.includes(params.leg_type) &&
      !params.dropoff_location_text
    ) {
      return {
        success: false,
        error: `dropoff_location_text is required when leg_type is ${params.leg_type}`,
      };
    }

    // If no leg_order provided, get the next available order
    let legOrder = params.leg_order;
    if (!legOrder || legOrder === 1) {
      const maxOrderResult = await executeParameterizedQuery(
        `SELECT COALESCE(MAX(leg_order), 0) + 1 as next_order FROM deal_journey_legs WHERE deal_id = $1`,
        [dealId],
        context
      );
      legOrder = maxOrderResult.success ? maxOrderResult.data?.[0]?.next_order ?? 1 : 1;
    }

    // Build the insert query
    const insertSql = `
      INSERT INTO deal_journey_legs (
        deal_id, leg_order, leg_type,
        pickup_datetime, pickup_timezone,
        pickup_location_text, dropoff_location_text,
        transport_mode, carrier_or_operator, transport_number,
        origin_code, destination_code,
        terminal, gate, platform,
        meet_point_instructions, driver_notes, dispatch_notes,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW(), NOW()
      )
      RETURNING id, deal_id, leg_order, leg_type, pickup_datetime, pickup_timezone,
                pickup_location_text, dropoff_location_text,
                transport_mode, carrier_or_operator, transport_number,
                origin_code, destination_code,
                terminal, gate, platform,
                meet_point_instructions, driver_notes, dispatch_notes,
                created_at, updated_at
    `;

    const result = await executeParameterizedQuery(
      insertSql,
      [
        dealId,
        legOrder,
        params.leg_type,
        params.pickup_datetime,
        params.pickup_timezone,
        sanitizeString(params.pickup_location_text, 500),
        sanitizeString(params.dropoff_location_text, 500),
        params.transport_mode,
        sanitizeString(params.carrier_or_operator, 100),
        sanitizeString(params.transport_number, 50),
        sanitizeString(params.origin_code, 10),
        sanitizeString(params.destination_code, 10),
        sanitizeString(params.terminal, 20),
        sanitizeString(params.gate, 20),
        sanitizeString(params.platform, 20),
        sanitizeString(params.meet_point_instructions, 1000),
        sanitizeString(params.driver_notes, 2000),
        sanitizeString(params.dispatch_notes, 2000),
      ],
      context
    );

    if (!result.success) {
      return {
        success: false,
        error: "Failed to create journey leg",
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

export const create_deal_journey_leg = {
  definition: {
    description: "Creates a new journey leg for a deal with pickup/dropoff details",
    inputSchema: CreateJourneyLegSchema,
  },
  handler: createJourneyLeg,
};
