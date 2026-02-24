import { z } from "zod";
import { executeParameterizedQuery, isValidTable } from "../../db/query-builder.js";
import type { McpContext } from "../server.js";

/**
 * Input schema for updating a company
 */
const UpdateCompanySchema = z.object({
  id: z.number().int().positive().describe("ID of the company to update"),
  name: z.string().min(1).max(200).optional().describe("Company name"),
  website: z.string().url().max(500).nullable().optional().describe("Company website URL"),
  phone: z.string().max(50).nullable().optional().describe("Main company phone number"),
  address: z.string().max(500).nullable().optional().describe("Street address"),
  city: z.string().max(100).nullable().optional().describe("City"),
  state: z.string().max(100).nullable().optional().describe("State/Province"),
  country: z.string().max(100).nullable().optional().describe("Country"),
  zip_code: z.string().max(20).nullable().optional().describe("Postal/ZIP code"),
  industry: z.string().max(100).nullable().optional().describe("Industry sector"),
  size: z.string().max(50).nullable().optional().describe("Company size"),
  revenue: z.number().int().positive().nullable().optional().describe("Annual revenue in dollars"),
  description: z.string().max(2000).nullable().optional().describe("Company description"),
  linkedin_url: z.string().url().max(500).nullable().optional().describe("LinkedIn company page URL"),
  twitter_url: z.string().url().max(500).nullable().optional().describe("Twitter/X profile URL"),
  facebook_url: z.string().url().max(500).nullable().optional().describe("Facebook page URL"),
});

/**
 * Updates an existing company in the CRM
 */
async function updateCompany(
  params: z.infer<typeof UpdateCompanySchema>,
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

    // Verify the company belongs to this user
    const checkResult = await executeParameterizedQuery(
      `SELECT id FROM companies WHERE id = $1 AND sales_id = $2`,
      [params.id, salesId],
      context
    );

    if (!checkResult.success || !checkResult.data?.length) {
      return {
        success: false,
        error: "Company not found or access denied",
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
    if (params.website !== undefined) {
      updates.push(`website = $${paramIndex++}`);
      values.push(params.website);
    }
    if (params.phone !== undefined) {
      updates.push(`phone = $${paramIndex++}`);
      values.push(params.phone);
    }
    if (params.address !== undefined) {
      updates.push(`address = $${paramIndex++}`);
      values.push(params.address);
    }
    if (params.city !== undefined) {
      updates.push(`city = $${paramIndex++}`);
      values.push(params.city);
    }
    if (params.state !== undefined) {
      updates.push(`state = $${paramIndex++}`);
      values.push(params.state);
    }
    if (params.country !== undefined) {
      updates.push(`country = $${paramIndex++}`);
      values.push(params.country);
    }
    if (params.zip_code !== undefined) {
      updates.push(`zip_code = $${paramIndex++}`);
      values.push(params.zip_code);
    }
    if (params.industry !== undefined) {
      updates.push(`industry = $${paramIndex++}`);
      values.push(params.industry);
    }
    if (params.size !== undefined) {
      updates.push(`size = $${paramIndex++}`);
      values.push(params.size);
    }
    if (params.revenue !== undefined) {
      updates.push(`revenue = $${paramIndex++}`);
      values.push(params.revenue);
    }
    if (params.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(params.description);
    }
    if (params.linkedin_url !== undefined) {
      updates.push(`linkedin_url = $${paramIndex++}`);
      values.push(params.linkedin_url);
    }
    if (params.twitter_url !== undefined) {
      updates.push(`twitter_url = $${paramIndex++}`);
      values.push(params.twitter_url);
    }
    if (params.facebook_url !== undefined) {
      updates.push(`facebook_url = $${paramIndex++}`);
      values.push(params.facebook_url);
    }

    if (updates.length === 0) {
      return {
        success: false,
        error: "No fields provided to update",
      };
    }

    // Add updated_at
    updates.push(`updated_at = NOW()`);

    // Add the company id and sales_id for WHERE clause
    values.push(params.id);
    values.push(salesId);

    const updateSql = `
      UPDATE companies 
      SET ${updates.join(", ")}
      WHERE id = $${paramIndex} AND sales_id = $${paramIndex + 1}
      RETURNING id, name, website, industry, size, updated_at
    `;

    const result = await executeParameterizedQuery(updateSql, values, context);

    if (!result.success) {
      return {
        success: false,
        error: result.error || "Failed to update company",
      };
    }

    console.log(`Company updated: ${params.id} by user ${context.authInfo.userId}`);

    return {
      success: true,
      data: result.data?.[0],
    };
  } catch (error) {
    console.error("Update company error:", error instanceof Error ? error.message : "Unknown error");
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const update_company = {
  definition: {
    description: `Update an existing company in the Atomic CRM.

Use this tool when you need to modify an existing company's information. Only provide the fields you want to update.

Required fields:
- id: ID of the company to update

Optional fields (only include those you want to change):
- name: Company name
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

Note: You can only update companies that belong to you.

Example:
- Update website: { "id": 123, "website": "https://newsite.com" }
- Update industry: { "id": 123, "industry": "Technology", "size": "51-200" }`,
    inputSchema: UpdateCompanySchema,
  },
  handler: async (params: z.infer<typeof UpdateCompanySchema>, context: McpContext) => {
    const result = await updateCompany(params, context);

    return {
      content: [
        {
          type: "text" as const,
          text: result.success
            ? `Company updated successfully:\n${JSON.stringify(result.data, null, 2)}`
            : `Error updating company: ${result.error}`,
        },
      ],
      isError: !result.success,
    };
  },
};
