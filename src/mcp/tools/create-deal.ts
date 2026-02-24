import { z } from "zod";
import { executeParameterizedQuery, isValidTable } from "../../db/query-builder.js";
import type { McpContext } from "../server.js";

/**
 * Input schema for creating a deal
 */
const CreateDealSchema = z.object({
  name: z.string().min(1).max(200).describe("Deal name/title"),
  company_id: z.number().int().positive().optional().describe("ID of the associated company"),
  contact_ids: z.array(z.string().uuid()).max(10).optional().describe("Array of contact UUIDs to associate"),
  stage: z.string().max(50).optional().default("opportunity").describe("Deal stage (opportunity, proposal, negotiation, won, lost)"),
  category: z.string().max(100).optional().describe("Deal category/type"),
  amount: z.number().int().positive().optional().describe("Deal amount in cents (e.g., 10000 = $100.00)"),
  description: z.string().max(5000).optional().describe("Deal description/notes"),
  expected_closing_date: z.string().optional().describe("Expected closing date (ISO format: YYYY-MM-DD)"),
});

/**
 * Sanitize a string for logging
 */
function sanitizeForLog(str: string, maxLength: number = 50): string {
  if (!str) return "";
  const sanitized = str.substring(0, maxLength);
  return sanitized.length < str.length ? `${sanitized}...` : sanitized;
}

/**
 * Creates a new deal in the CRM
 */
async function createDeal(
  params: z.infer<typeof CreateDealSchema>,
  context: McpContext
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    // Validate table name
    if (!isValidTable("sales") || !isValidTable("deals")) {
      return {
        success: false,
        error: "Invalid table configuration",
      };
    }

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

    // Get company name if company_id provided
    let companyName = null;
    if (params.company_id) {
      const companyResult = await executeParameterizedQuery(
        `SELECT name FROM companies WHERE id = $1`,
        [params.company_id],
        context
      );
      if (companyResult.success && companyResult.data?.length) {
        companyName = companyResult.data[0].name;
      }
    }

    // Get the max index for this stage to place new deal at the end
    const indexResult = await executeParameterizedQuery(
      `SELECT COALESCE(MAX(index), -1) + 1 as next_index FROM deals WHERE stage = $1 AND sales_id = $2`,
      [params.stage || "opportunity", salesId],
      context
    );
    const nextIndex = indexResult.success ? indexResult.data?.[0]?.next_index ?? 0 : 0;

    // Insert the deal
    const insertSql = `
      INSERT INTO deals (
        name,
        company_id,
        contact_ids,
        stage,
        category,
        amount,
        description,
        expected_closing_date,
        sales_id,
        index,
        company_name,
        created_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW()
      )
      RETURNING id, name, stage, amount, company_id, created_at
    `;

    const insertParams = [
      params.name,
      params.company_id || null,
      params.contact_ids || [],
      params.stage || "opportunity",
      params.category || null,
      params.amount || null,
      params.description || null,
      params.expected_closing_date || null,
      salesId,
      nextIndex,
      companyName,
    ];

    const result = await executeParameterizedQuery(insertSql, insertParams, context);

    if (!result.success) {
      return {
        success: false,
        error: result.error || "Failed to create deal",
      };
    }

    console.log(`Deal created: ${sanitizeForLog(params.name)} by user ${context.authInfo.userId}`);

    return {
      success: true,
      data: result.data?.[0],
    };
  } catch (error) {
    console.error("Create deal error:", error instanceof Error ? error.message : "Unknown error");
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const create_deal = {
  definition: {
    description: `Create a new deal in the Atomic CRM.

Use this tool when you need to add a new deal/opportunity to the CRM. The deal will be automatically associated with the authenticated user as the owner.

Required fields:
- name: Deal name/title (1-200 characters)

Optional fields:
- company_id: ID of an existing company to associate
- contact_ids: Array of contact UUIDs to associate (max 10)
- stage: Deal stage (defaults to 'opportunity')
  - opportunity: Initial stage
  - proposal: Proposal sent
  - negotiation: In negotiation
  - won: Deal closed/won
  - lost: Deal lost
- category: Deal category/type
- amount: Deal amount in cents (e.g., 10000 = $100.00)
- description: Deal description/notes
- expected_closing_date: Expected closing date (ISO format: YYYY-MM-DD)

The deal will be created with:
- sales_id set to the authenticated user
- created_at and updated_at set to current time
- index set to place at end of stage column

Example:
- Create a basic deal: { "name": "New Software License" }
- Create with details: { "name": "Enterprise Deal", "company_id": 1, "amount": 500000, "stage": "proposal" }`,
    inputSchema: CreateDealSchema,
  },
  handler: async (params: z.infer<typeof CreateDealSchema>, context: McpContext) => {
    const result = await createDeal(params, context);

    return {
      content: [
        {
          type: "text" as const,
          text: result.success
            ? `Deal created successfully:\n${JSON.stringify(result.data, null, 2)}`
            : `Error creating deal: ${result.error}`,
        },
      ],
      isError: !result.success,
    };
  },
};
