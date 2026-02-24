import { z } from "zod";
import { executeParameterizedQuery, isValidTable } from "../../db/query-builder.js";
import type { McpContext } from "../server.js";

/**
 * Input schema for creating a note
 */
const CreateNoteSchema = z.object({
  content: z.string().min(1).max(10000).describe("Note content/text"),
  contact_id: z.string().uuid().optional().describe("UUID of the contact to associate the note with"),
  deal_id: z.number().int().positive().optional().describe("ID of the deal to associate the note with"),
  type: z.string().max(50).optional().default("general").describe("Note type (general, call, meeting, email)"),
});

/**
 * Creates a new note in the CRM
 */
async function createNote(
  params: z.infer<typeof CreateNoteSchema>,
  context: McpContext
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    // Validate that at least one association is provided
    if (!params.contact_id && !params.deal_id) {
      return {
        success: false,
        error: "Either contact_id or deal_id must be provided",
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

    // Determine which table to insert into based on association
    if (params.contact_id) {
      // Insert into contactNotes
      const insertSql = `
        INSERT INTO contactNotes (
          contact_id,
          text,
          type,
          sales_id,
          created_at
        ) VALUES (
          $1, $2, $3, $4, NOW()
        )
        RETURNING id, contact_id, text, type, created_at
      `;

      const result = await executeParameterizedQuery(
        insertSql,
        [params.contact_id, params.content, params.type || "general", salesId],
        context
      );

      if (!result.success) {
        return {
          success: false,
          error: result.error || "Failed to create contact note",
        };
      }

      console.log(`Contact note created for contact ${params.contact_id} by user ${context.authInfo.userId}`);

      return {
        success: true,
        data: result.data?.[0],
      };
    } else if (params.deal_id) {
      // Insert into dealNotes
      const insertSql = `
        INSERT INTO dealNotes (
          deal_id,
          text,
          type,
          sales_id,
          created_at
        ) VALUES (
          $1, $2, $3, $4, NOW()
        )
        RETURNING id, deal_id, text, type, created_at
      `;

      const result = await executeParameterizedQuery(
        insertSql,
        [params.deal_id, params.content, params.type || "general", salesId],
        context
      );

      if (!result.success) {
        return {
          success: false,
          error: result.error || "Failed to create deal note",
        };
      }

      console.log(`Deal note created for deal ${params.deal_id} by user ${context.authInfo.userId}`);

      return {
        success: true,
        data: result.data?.[0],
      };
    }

    return {
      success: false,
      error: "No valid association provided",
    };
  } catch (error) {
    console.error("Create note error:", error instanceof Error ? error.message : "Unknown error");
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const create_note = {
  definition: {
    description: `Create a new note in the Atomic CRM.

Use this tool when you need to add a note to a contact or deal. Notes can be used to track interactions, meetings, calls, or any other relevant information.

Required fields:
- content: The note text/content (1-10000 characters)

Association (at least one required):
- contact_id: UUID of the contact to associate the note with
- deal_id: ID of the deal to associate the note with

Optional fields:
- type: Note type (general, call, meeting, email) - defaults to 'general'

Examples:
- Create a contact note: { "content": "Had a great call with the client", "contact_id": "uuid-here", "type": "call" }
- Create a deal note: { "content": "Client requested proposal revision", "deal_id": 123, "type": "email" }`,
    inputSchema: CreateNoteSchema,
  },
  handler: async (params: z.infer<typeof CreateNoteSchema>, context: McpContext) => {
    const result = await createNote(params, context);

    return {
      content: [
        {
          type: "text" as const,
          text: result.success
            ? `Note created successfully:\n${JSON.stringify(result.data, null, 2)}`
            : `Error creating note: ${result.error}`,
        },
      ],
      isError: !result.success,
    };
  },
};
