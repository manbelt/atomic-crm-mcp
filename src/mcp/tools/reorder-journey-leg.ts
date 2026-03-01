import { z } from "zod";
import { isValidTable, getPool } from "../../db/query-builder.js";
import type { McpContext } from "../server.js";
import { decodeJwt } from "jose";

/**
 * Input schema for reordering a journey leg
 */
const ReorderJourneyLegSchema = z.object({
  deal_id: z.union([z.string(), z.number()]).describe("ID of the deal (bigint)"),
  leg_id: z.string().uuid().describe("UUID of the journey leg to reorder"),
  new_leg_order: z.number().int().min(1).describe("New order position for the leg"),
});

/**
 * Reorders a journey leg within a deal
 * Uses a single transaction to reorder all affected legs atomically
 */
async function reorderJourneyLeg(
  params: z.infer<typeof ReorderJourneyLegSchema>,
  context: McpContext
): Promise<{ success: boolean; data?: any; error?: string }> {
  const pool = getPool();
  let client = null;

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

    client = await pool.connect();
    const jwtClaims = decodeJwt(context.userToken);

    // Start transaction
    await client.query("BEGIN");

    // Set RLS role
    await client.query(`SET LOCAL role = 'authenticated'`);

    // Set JWT claims for RLS
    const claimsJson = JSON.stringify(jwtClaims)
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "''");
    await client.query(`SET LOCAL request.jwt.claims = '${claimsJson}'`);

    // Verify the user has access to this deal
    const dealCheck = await client.query(
      `SELECT id FROM deals WHERE id = $1 AND sales_id IN (SELECT id FROM sales WHERE user_id = $2)`,
      [dealId, context.authInfo.userId]
    );

    if (!dealCheck.rows.length) {
      await client.query("ROLLBACK");
      return {
        success: false,
        error: "Deal not found or access denied",
      };
    }

    // Verify the leg exists and belongs to this deal
    const legCheck = await client.query(
      `SELECT id, leg_order FROM deal_journey_legs WHERE id = $1::uuid AND deal_id = $2`,
      [params.leg_id, dealId]
    );

    if (!legCheck.rows.length) {
      await client.query("ROLLBACK");
      return {
        success: false,
        error: "Journey leg not found or does not belong to this deal",
      };
    }

    const currentOrder = legCheck.rows[0].leg_order;
    const newOrder = params.new_leg_order;

    // If the order hasn't changed, return early
    if (currentOrder === newOrder) {
      await client.query("COMMIT");
      return {
        success: true,
        data: { 
          id: params.leg_id, 
          deal_id: dealId, 
          leg_order: newOrder,
          message: "Leg already at requested position" 
        },
      };
    }

    // Get total number of legs for this deal
    const countResult = await client.query(
      `SELECT COUNT(*) as total FROM deal_journey_legs WHERE deal_id = $1`,
      [dealId]
    );

    const totalLegs = parseInt(countResult.rows[0].total, 10);

    // Validate new_leg_order is within bounds
    if (newOrder < 1 || newOrder > totalLegs) {
      await client.query("ROLLBACK");
      return {
        success: false,
        error: `new_leg_order must be between 1 and ${totalLegs}. Provided: ${newOrder}`,
      };
    }

    // Perform the reorder using a single atomic UPDATE with CASE
    // This handles moving the leg up or down in the order
    if (newOrder > currentOrder) {
      // Moving down: decrement orders of legs between old and new position
      await client.query(
        `UPDATE deal_journey_legs 
         SET leg_order = leg_order - 1, updated_at = NOW()
         WHERE deal_id = $1 
           AND leg_order > $2 
           AND leg_order <= $3`,
        [dealId, currentOrder, newOrder]
      );
    } else {
      // Moving up: increment orders of legs between new and old position
      await client.query(
        `UPDATE deal_journey_legs 
         SET leg_order = leg_order + 1, updated_at = NOW()
         WHERE deal_id = $1 
           AND leg_order >= $2 
           AND leg_order < $3`,
        [dealId, newOrder, currentOrder]
      );
    }

    // Set the moved leg to its new order
    await client.query(
      `UPDATE deal_journey_legs 
       SET leg_order = $1, updated_at = NOW()
       WHERE id = $2::uuid`,
      [newOrder, params.leg_id]
    );

    // Fetch the updated legs to return
    const updatedLegsResult = await client.query(
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
      [dealId]
    );

    // Commit transaction
    await client.query("COMMIT");

    return {
      success: true,
      data: updatedLegsResult.rows,
    };
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Rollback error:", rollbackError);
      }
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  } finally {
    if (client) {
      client.release();
    }
  }
}

export const reorder_deal_journey_leg = {
  definition: {
    description: "Reorders a journey leg within a deal. All other legs are automatically adjusted to maintain contiguous ordering. Uses transaction-safe atomic updates.",
    inputSchema: ReorderJourneyLegSchema,
  },
  handler: reorderJourneyLeg,
};
