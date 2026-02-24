import { z } from "zod";
import { executeParameterizedQuery, isValidTable } from "../../db/query-builder.js";
import type { McpContext } from "../server.js";

/**
 * Input schema for deleting a company
 */
const DeleteCompanySchema = z.object({
  id: z.number().int().positive().describe("ID of the company to delete"),
});

/**
 * Deletes a company from the CRM
 */
async function deleteCompany(
  params: z.infer<typeof DeleteCompanySchema>,
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

    // Verify the company belongs to this user and get its info
    const checkResult = await executeParameterizedQuery(
      `SELECT id, name, industry FROM companies WHERE id = $1 AND sales_id = $2`,
      [params.id, salesId],
      context
    );

    if (!checkResult.success || !checkResult.data?.length) {
      return {
        success: false,
        error: "Company not found or access denied",
      };
    }

    const companyInfo = checkResult.data[0];

    // Check for associated contacts
    const contactsResult = await executeParameterizedQuery(
      `SELECT COUNT(*) as count FROM contacts WHERE company_id = $1`,
      [params.id],
      context
    );

    const contactCount = contactsResult.data?.[0]?.count ?? 0;
    if (contactsResult.success && contactCount > 0) {
      return {
        success: false,
        error: `Cannot delete company: ${contactCount} contacts are associated with this company. Remove or reassign contacts first.`,
      };
    }

    // Check for associated deals
    const dealsResult = await executeParameterizedQuery(
      `SELECT COUNT(*) as count FROM deals WHERE company_id = $1`,
      [params.id],
      context
    );

    const dealCount = dealsResult.data?.[0]?.count ?? 0;
    if (dealsResult.success && dealCount > 0) {
      return {
        success: false,
        error: `Cannot delete company: ${dealCount} deals are associated with this company. Remove or reassign deals first.`,
      };
    }

    // Delete the company
    const deleteResult = await executeParameterizedQuery(
      `DELETE FROM companies WHERE id = $1 AND sales_id = $2 RETURNING id`,
      [params.id, salesId],
      context
    );

    if (!deleteResult.success) {
      return {
        success: false,
        error: deleteResult.error || "Failed to delete company",
      };
    }

    console.log(`Company deleted: ${params.id} by user ${context.authInfo.userId}`);

    return {
      success: true,
      data: {
        id: params.id,
        deleted: true,
        company: companyInfo,
      },
    };
  } catch (error) {
    console.error("Delete company error:", error instanceof Error ? error.message : "Unknown error");
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const delete_company = {
  definition: {
    description: `Delete a company from the Atomic CRM.

Use this tool when you need to permanently remove a company from the CRM.

Required fields:
- id: ID of the company to delete

Note: You cannot delete a company that has associated contacts or deals. Remove or reassign those first. You can only delete companies that belong to you.

Example:
- Delete a company: { "id": 123 }`,
    inputSchema: DeleteCompanySchema,
  },
  handler: async (params: z.infer<typeof DeleteCompanySchema>, context: McpContext) => {
    const result = await deleteCompany(params, context);

    return {
      content: [
        {
          type: "text" as const,
          text: result.success
            ? `Company deleted successfully:\n${JSON.stringify(result.data, null, 2)}`
            : `Error deleting company: ${result.error}`,
        },
      ],
      isError: !result.success,
    };
  },
};
