import { z } from "zod";
import { executeParameterizedQuery, isValidTable } from "../../db/query-builder.js";
import type { McpContext } from "../server.js";

/**
 * Input schema for deleting a contact
 */
const DeleteContactSchema = z.object({
  id: z.string().uuid().describe("UUID of the contact to delete"),
});

/**
 * Deletes a contact from the CRM
 */
async function deleteContact(
  params: z.infer<typeof DeleteContactSchema>,
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

    // Verify the contact belongs to this user and get its info
    const checkResult = await executeParameterizedQuery(
      `SELECT id, first_name, last_name FROM contacts WHERE id = $1 AND sales_id = $2`,
      [params.id, salesId],
      context
    );

    if (!checkResult.success || !checkResult.data?.length) {
      return {
        success: false,
        error: "Contact not found or access denied",
      };
    }

    const contactInfo = checkResult.data[0];

    // Delete associated notes first
    await executeParameterizedQuery(
      `DELETE FROM contactNotes WHERE contact_id = $1`,
      [params.id],
      context
    );

    // Delete associated deal contacts
    await executeParameterizedQuery(
      `DELETE FROM deal_contacts WHERE contact_id = $1`,
      [params.id],
      context
    );

    // Delete the contact
    const deleteResult = await executeParameterizedQuery(
      `DELETE FROM contacts WHERE id = $1 AND sales_id = $2 RETURNING id`,
      [params.id, salesId],
      context
    );

    if (!deleteResult.success) {
      return {
        success: false,
        error: deleteResult.error || "Failed to delete contact",
      };
    }

    console.log(`Contact deleted: ${params.id} by user ${context.authInfo.userId}`);

    return {
      success: true,
      data: {
        id: params.id,
        deleted: true,
        contact: contactInfo,
      },
    };
  } catch (error) {
    console.error("Delete contact error:", error instanceof Error ? error.message : "Unknown error");
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const delete_contact = {
  definition: {
    description: `Delete a contact from the Atomic CRM.

Use this tool when you need to permanently remove a contact from the CRM.

Required fields:
- id: UUID of the contact to delete

Note: This will also delete all associated notes and remove the contact from any deals. You can only delete contacts that belong to you.

Example:
- Delete a contact: { "id": "uuid-here" }`,
    inputSchema: DeleteContactSchema,
  },
  handler: async (params: z.infer<typeof DeleteContactSchema>, context: McpContext) => {
    const result = await deleteContact(params, context);

    return {
      content: [
        {
          type: "text" as const,
          text: result.success
            ? `Contact deleted successfully:\n${JSON.stringify(result.data, null, 2)}`
            : `Error deleting contact: ${result.error}`,
        },
      ],
      isError: !result.success,
    };
  },
};
