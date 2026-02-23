import { z } from "zod";
import { executeParameterizedQuery, isValidTable } from "../../db/query-builder.js";
import type { McpContext } from "../server.js";

/**
 * Input schema for creating a contact
 */
const CreateContactSchema = z.object({
  first_name: z.string().min(1).max(100).describe("Contact's first name"),
  last_name: z.string().min(1).max(100).describe("Contact's last name"),
  email: z.string().email().max(255).optional().describe("Primary email address"),
  phone: z.string().max(50).optional().describe("Primary phone number"),
  title: z.string().max(100).optional().describe("Job title/position"),
  company_id: z.number().int().positive().optional().describe("ID of the associated company"),
  linkedin_url: z.string().url().max(500).optional().describe("LinkedIn profile URL"),
  background: z.string().max(5000).optional().describe("Background notes about the contact"),
  status: z.string().max(50).optional().default("lead").describe("Contact status (lead, active, inactive)"),
  gender: z.string().max(20).optional().describe("Contact's gender"),
  has_newsletter: z.boolean().optional().default(false).describe("Whether subscribed to newsletter"),
  tags: z.array(z.number().int().positive()).max(20).optional().describe("Array of tag IDs to associate"),
});

/**
 * Sanitize a string for logging (remove potential PII)
 */
function sanitizeForLog(str: string, maxLength: number = 50): string {
  if (!str) return "";
  const sanitized = str.substring(0, maxLength);
  return sanitized.length < str.length ? `${sanitized}...` : sanitized;
}

/**
 * Creates a new contact in the CRM using parameterized queries
 */
async function createContact(
  params: z.infer<typeof CreateContactSchema>,
  context: McpContext
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    // Validate table name (defense in depth)
    if (!isValidTable("sales") || !isValidTable("contacts")) {
      return {
        success: false,
        error: "Invalid table configuration",
      };
    }

    // Get the sales_id from the authenticated user using parameterized query
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

    // Build email_jsonb if email provided
    const emailJsonb = params.email
      ? JSON.stringify([{ email: params.email, type: "Work" }])
      : "[]";

    // Build phone_jsonb if phone provided
    const phoneJsonb = params.phone
      ? JSON.stringify([{ number: params.phone, type: "Work" }])
      : "[]";

    // Build tags array
    const tagsArray = params.tags && params.tags.length > 0
      ? params.tags
      : [];

    // Insert the contact using parameterized query
    const insertSql = `
      INSERT INTO contacts (
        first_name,
        last_name,
        title,
        company_id,
        email_jsonb,
        phone_jsonb,
        linkedin_url,
        background,
        status,
        gender,
        has_newsletter,
        tags,
        sales_id,
        first_seen,
        last_seen
      ) VALUES (
        $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW()
      )
      RETURNING id, first_name, last_name, title, status, created_at
    `;

    const insertParams = [
      params.first_name,
      params.last_name,
      params.title || null,
      params.company_id || null,
      emailJsonb,
      phoneJsonb,
      params.linkedin_url || null,
      params.background || null,
      params.status || "lead",
      params.gender || null,
      params.has_newsletter ?? false,
      tagsArray,
      salesId,
    ];

    const result = await executeParameterizedQuery(insertSql, insertParams, context);

    if (!result.success) {
      return {
        success: false,
        error: result.error || "Failed to create contact",
      };
    }

    // Log successful creation (sanitized)
    console.log(`Contact created: ${sanitizeForLog(params.first_name)} ${sanitizeForLog(params.last_name)} by user ${context.authInfo.userId}`);

    return {
      success: true,
      data: result.data?.[0],
    };
  } catch (error) {
    console.error("Create contact error:", error instanceof Error ? error.message : "Unknown error");
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const create_contact = {
  definition: {
    description: `Create a new contact in the Atomic CRM.

Use this tool when you need to add a new contact to the CRM. The contact will be automatically associated with the authenticated user as the owner.

Required fields:
- first_name: Contact's first name (1-100 characters)
- last_name: Contact's last name (1-100 characters)

Optional fields:
- email: Primary email address (will be stored as Work email)
- phone: Primary phone number (will be stored as Work phone)
- title: Job title or position
- company_id: ID of an existing company to associate
- linkedin_url: LinkedIn profile URL
- background: Notes about the contact
- status: Contact status (defaults to 'lead')
- gender: Contact's gender
- has_newsletter: Newsletter subscription status
- tags: Array of tag IDs to associate

The contact will be created with:
- first_seen and last_seen set to current time
- sales_id set to the authenticated user

Example:
- Create a basic contact: { "first_name": "John", "last_name": "Doe" }
- Create with email: { "first_name": "Jane", "last_name": "Smith", "email": "jane@example.com", "title": "CEO" }`,
    inputSchema: CreateContactSchema,
  },
  handler: async (params: z.infer<typeof CreateContactSchema>, context: McpContext) => {
    const result = await createContact(params, context);

    return {
      content: [
        {
          type: "text" as const,
          text: result.success
            ? `Contact created successfully:\n${JSON.stringify(result.data, null, 2)}`
            : `Error creating contact: ${result.error}`,
        },
      ],
      isError: !result.success,
    };
  },
};
