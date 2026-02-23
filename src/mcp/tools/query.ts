import { z } from "zod";
import { executeRawQuery } from "../../db/query-builder.js";
import { validateSqlQuery } from "../../db/sql-validation.js";
import type { McpContext } from "../server.js";

/**
 * Execute a read-only SQL query with validation
 */
async function executeReadOnlyQuery(
  sql: string,
  context: McpContext
): Promise<{ success: boolean; data?: any[]; error?: string }> {
  // Validate the query first
  const validation = validateSqlQuery(sql);
  if (!validation.valid) {
    return {
      success: false,
      error: validation.error,
    };
  }

  // Remove trailing semicolon if present
  const cleanSql = sql.trim().replace(/;$/, '');

  // Execute the query
  return executeRawQuery(cleanSql, context);
}

export const query = {
  definition: {
    description: `Query data from the user's Atomic CRM instance using SQL.

IMPORTANT: Before using this tool, you MUST call the get_schema tool first to understand what tables and columns are available in the database.

SECURITY: This tool only accepts SELECT queries. The following operations are forbidden:
- INSERT, UPDATE, DELETE, DROP, TRUNCATE
- ALTER, CREATE, GRANT, REVOKE
- Any DDL or DML operations

Use this tool when the user asks about their CRM data such as:
- Contacts, companies, and deals
- Sales pipeline and forecasting data
- Customer interactions and notes
- Tasks and follow-ups
- Custom fields and metadata

Row Level Security (RLS) is enforced - queries automatically return only data the authenticated user has permission to access.

Note: Use the *_summary views (contacts_summary, companies_summary) for queries that need aggregated data or search capabilities.

Examples:
- "SELECT id, first_name, last_name, email_fts FROM contacts_summary WHERE email_fts LIKE '%@company.com%'"
- "SELECT name, stage, amount FROM deals WHERE created_at > NOW() - INTERVAL '30 days' ORDER BY amount DESC"
- "SELECT COUNT(*) as total_tasks, type FROM tasks WHERE done_date IS NULL GROUP BY type"
- "SELECT c.first_name, c.last_name, co.name as company_name FROM contacts c JOIN companies co ON c.company_id = co.id WHERE co.sector = 'Technology'"`,
    inputSchema: z.object({
      sql: z
        .string()
        .min(1)
        .max(10000)
        .describe(
          "PostgreSQL SELECT query to execute against the Atomic CRM database. Only SELECT queries are allowed. RLS policies are automatically enforced."
        ),
    }),
  },
  handler: async (params: { sql: string }, context: McpContext) => {
    try {
      const result = await executeReadOnlyQuery(params.sql, context);

      return {
        content: [
          {
            type: "text" as const,
            text: result.success
              ? JSON.stringify(result.data, null, 2)
              : `Error: ${result.error}`,
          },
        ],
        isError: !result.success,
      };
    } catch (error) {
      console.error("Tool handler error:", error);
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
        isError: true,
      };
    }
  },
};
