import { z } from "zod";
import { executeParameterizedQuery, isValidTable } from "../../db/query-builder.js";
import type { McpContext } from "../server.js";

/**
 * Input schema for creating a company
 */
const CreateCompanySchema = z.object({
  name: z.string().min(1).max(200).describe("Company name"),
  website: z.string().url().max(500).optional().describe("Company website URL"),
  phone: z.string().max(50).optional().describe("Main company phone number"),
  address: z.string().max(500).optional().describe("Street address"),
  city: z.string().max(100).optional().describe("City"),
  state: z.string().max(100).optional().describe("State/Province"),
  country: z.string().max(100).optional().describe("Country"),
  zip_code: z.string().max(20).optional().describe("Postal/ZIP code"),
  industry: z.string().max(100).optional().describe("Industry sector"),
  size: z.string().max(50).optional().describe("Company size (e.g., '1-10', '11-50', '51-200')"),
  revenue: z.number().int().positive().optional().describe("Annual revenue in dollars"),
  description: z.string().max(2000).optional().describe("Company description"),
  linkedin_url: z.string().url().max(500).optional().describe("LinkedIn company page URL"),
  twitter_url: z.string().url().max(500).optional().describe("Twitter/X profile URL"),
  facebook_url: z.string().url().max(500).optional().describe("Facebook page URL"),
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
 * Creates a new company in the CRM
 */
async function createCompany(
  params: z.infer<typeof CreateCompanySchema>,
  context: McpContext
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    // Validate table name
    if (!isValidTable("sales") || !isValidTable("companies")) {
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

    // Insert the company
    const insertSql = `
      INSERT INTO companies (
        name,
        website,
        phone,
        address,
        city,
        state,
        country,
        zip_code,
        industry,
        size,
        revenue,
        description,
        linkedin_url,
        twitter_url,
        facebook_url,
        sales_id,
        created_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), NOW()
      )
      RETURNING id, name, website, industry, size, created_at
    `;

    const insertParams = [
      params.name,
      params.website || null,
      params.phone || null,
      params.address || null,
      params.city || null,
      params.state || null,
      params.country || null,
      params.zip_code || null,
      params.industry || null,
      params.size || null,
      params.revenue || null,
      params.description || null,
      params.linkedin_url || null,
      params.twitter_url || null,
      params.facebook_url || null,
      salesId,
    ];

    const result = await executeParameterizedQuery(insertSql, insertParams, context);

    if (!result.success) {
      return {
        success: false,
        error: result.error || "Failed to create company",
      };
    }

    console.log(`Company created: ${sanitizeForLog(params.name)} by user ${context.authInfo.userId}`);

    return {
      success: true,
      data: result.data?.[0],
    };
  } catch (error) {
    console.error("Create company error:", error instanceof Error ? error.message : "Unknown error");
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const create_company = {
  definition: {
    description: `Create a new company in the Atomic CRM.

Use this tool when you need to add a new company to the CRM. The company will be automatically associated with the authenticated user as the owner.

Required fields:
- name: Company name (1-200 characters)

Optional fields:
- website: Company website URL
- phone: Main company phone number
- address: Street address
- city: City
- state: State/Province
- country: Country
- zip_code: Postal/ZIP code
- industry: Industry sector
- size: Company size (e.g., '1-10', '11-50', '51-200')
- revenue: Annual revenue in dollars
- description: Company description
- linkedin_url: LinkedIn company page URL
- twitter_url: Twitter/X profile URL
- facebook_url: Facebook page URL

Example:
- Create a basic company: { "name": "Acme Corp" }
- Create with details: { "name": "Tech Inc", "website": "https://techinc.com", "industry": "Technology", "size": "51-200" }`,
    inputSchema: CreateCompanySchema,
  },
  handler: async (params: z.infer<typeof CreateCompanySchema>, context: McpContext) => {
    const result = await createCompany(params, context);

    return {
      content: [
        {
          type: "text" as const,
          text: result.success
            ? `Company created successfully:\n${JSON.stringify(result.data, null, 2)}`
            : `Error creating company: ${result.error}`,
        },
      ],
      isError: !result.success,
    };
  },
};
