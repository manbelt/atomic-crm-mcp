import { z } from "zod";
import { executeParameterizedQuery, isValidTable } from "../../db/query-builder.js";
import type { McpContext } from "../server.js";

/**
 * Input schema for updating a contact
 */
const UpdateContactSchema = z.object({
  id: z.string().uuid().describe("UUID of the contact to update"),
  first_name: z.string().min(1).max(100).optional().describe("Contact's first name"),
  last_name: z.string().min(1).max(100).optional().describe("Contact's last name"),
  email: z.string().email().max(255).optional().describe("Primary email address"),
  phone: z.string().max(50).optional().describe("Primary phone number"),
  title: z.string().max(100).optional().describe("Job title/position"),
  company_id: z.number().int().positive().nullable().optional().describe("ID of the associated company (null to remove)"),
  linkedin_url: z.string().url().max(500).nullable().optional().describe("LinkedIn profile URL"),
  background: z.string().max(5000).nullable().optional().describe("Background notes about the contact"),
  status: z.string().max(50).optional().describe("Contact status (lead, active, inactive)"),
  gender: z.string().max(20).nullable().optional().describe("Contact's gender"),
  has_newsletter: z.boolean().optional().describe("Whether subscribed to newsletter"),
  tags: z.array(z.number().int().positive()).max(20).optional().describe("Array of tag IDs to associate"),
});

/**
 * Updates an existing contact in the CRM
 */
async function updateContact(
  params: z.infer<typeof UpdateContactSchema>,
  context: McpContext
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    // Validate table name
    if (!isValidTable("contacts")) {
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

    // Verify the contact belongs to this user
    const checkResult = await executeParameterizedQuery(
      `SELECT id FROM contacts WHERE id = $1 AND sales_id = $2`,
      [params.id, salesId],
      context
    );

    if (!checkResult.success || !checkResult.data?.length) {
      return {
        success: false,
        error: "Contact not found or access denied",
      };
    }

    // Build dynamic update query
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (params.first_name !== undefined) {
      updates.push(`first_name = $${paramIndex++}`);
      values.push(params.first_name);
    }
    if (params.last_name !== undefined) {
      updates.push(`last_name = $${paramIndex++}`);
      values.push(params.last_name);
    }
    if (params.email !== undefined) {
      const emailJsonb = params.email
        ? JSON.stringify([{ email: params.email, type: "Work" }])
        : "[]";
      updates.push(`email_jsonb = $${paramIndex++}::jsonb`);
      values.push(emailJsonb);
    }
    if (params.phone !== undefined) {
      const phoneJsonb = params.phone
        ? JSON.stringify([{ number: params.phone, type: "Work" }])
        : "[]";
      updates.push(`phone_jsonb = $${paramIndex++}::jsonb`);
      values.push(phoneJsonb);
    }
    if (params.title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(params.title);
    }
    if (params.company_id !== undefined) {
      updates.push(`company_id = $${paramIndex++}`);
      values.push(params.company_id);
    }
    if (params.linkedin_url !== undefined) {
      updates.push(`linkedin_url = $${paramIndex++}`);
      values.push(params.linkedin_url);
    }
    if (params.background !== undefined) {
      updates.push(`background = $${paramIndex++}`);
      values.push(params.background);
    }
    if (params.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(params.status);
    }
    if (params.gender !== undefined) {
      updates.push(`gender = $${paramIndex++}`);
      values.push(params.gender);
    }
    if (params.has_newsletter !== undefined) {
      updates.push(`has_newsletter = $${paramIndex++}`);
      values.push(params.has_newsletter);
    }
    if (params.tags !== undefined) {
      updates.push(`tags = $${paramIndex++}`);
      values.push(params.tags);
    }

    if (updates.length === 0) {
      return {
        success: false,
        error: "No fields provided to update",
      };
    }

    // Add updated_at
    updates.push(`last_seen = NOW()`);

    // Add the contact id and sales_id for WHERE clause
    values.push(params.id);
    values.push(salesId);

    const updateSql = `
      UPDATE contacts 
      SET ${updates.join(", ")}
      WHERE id = $${paramIndex} AND sales_id = $${paramIndex + 1}
      RETURNING id, first_name, last_name, title, status, updated_at
    `;

    const result = await executeParameterizedQuery(updateSql, values, context);

    if (!result.success) {
      return {
        success: false,
        error: result.error || "Failed to update contact",
      };
    }

    console.log(`Contact updated: ${params.id} by user ${context.authInfo.userId}`);

    return {
      success: true,
      data: result.data?.[0],
    };
  } catch (error) {
    console.error("Update contact error:", error instanceof Error ? error.message : "Unknown error");
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const update_contact = {
  definition: {
    description: `Update an existing contact in the Atomic CRM.

Use this tool when you need to modify an existing contact's information. Only provide the fields you want to update.

Required fields:
- id: UUID of the contact to update

Optional fields (only include those you want to change):
- first_name: Contact's first name
- last_name: Contact's last name
- email: Primary email address
- phone: Primary phone number
- title: Job title or position
- company_id: ID of an existing company to associate (null to remove)
- linkedin_url: LinkedIn profile URL (null to remove)
- background: Notes about the contact
- status: Contact status (lead, active, inactive)
- gender: Contact's gender
- has_newsletter: Newsletter subscription status
- tags: Array of tag IDs to associate

Note: You can only update contacts that belong to you.

Example:
- Update email: { "id": "uuid-here", "email": "newemail@example.com" }
- Change status: { "id": "uuid-here", "status": "active" }`,
    inputSchema: UpdateContactSchema,
  },
  handler: async (params: z.infer<typeof UpdateContactSchema>, context: McpContext) => {
    const result = await updateContact(params, context);

    return {
      content: [
        {
          type: "text" as const,
          text: result.success
            ? `Contact updated successfully:\n${JSON.stringify(result.data, null, 2)}`
            : `Error updating contact: ${result.error}`,
        },
      ],
      isError: !result.success,
    };
  },
};
