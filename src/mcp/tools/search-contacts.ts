import { z } from "zod";
import { executeParameterizedQuery } from "../../db/query-builder.js";
import type { McpContext } from "../server.js";

/**
 * Input schema for searching contacts
 */
const SearchContactsSchema = z.object({
  query: z.string().min(2).max(200).describe("Search query string (searches name, email, company)"),
  limit: z.number().min(1).max(50).default(10).describe("Maximum number of results to return"),
  status: z.string().max(50).optional().describe("Filter by contact status"),
  company_id: z.number().int().positive().optional().describe("Filter by company ID"),
});

/**
 * Search contacts by name, email, or company using parameterized queries
 */
async function searchContacts(
  params: z.infer<typeof SearchContactsSchema>,
  context: McpContext
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    // Build the search query with parameterized inputs
    // Using websearch_to_tsquery for safe full-text search
    const searchTerms = params.query;
    
    // Base query with parameterized search
    let sql = `
      SELECT 
        c.id,
        c.first_name,
        c.last_name,
        c.title,
        c.email_jsonb,
        c.phone_jsonb,
        c.status,
        c.first_seen,
        c.last_seen,
        c.linkedin_url,
        co.name as company_name,
        co.id as company_id,
        s.first_name as sales_first_name,
        s.last_name as sales_last_name
      FROM contacts c
      LEFT JOIN companies co ON c.company_id = co.id
      LEFT JOIN sales s ON c.sales_id = s.id
      WHERE to_tsvector('english', 
        coalesce(c.first_name, '') || ' ' || 
        coalesce(c.last_name, '') || ' ' ||
        coalesce(c.email_jsonb::text, '')
      ) @@ websearch_to_tsquery('english', $1)
    `;
    
    const queryParams: unknown[] = [searchTerms];
    let paramIndex = 2;

    // Add optional status filter
    if (params.status) {
      sql += ` AND c.status = $${paramIndex}`;
      queryParams.push(params.status);
      paramIndex++;
    }

    // Add optional company_id filter
    if (params.company_id) {
      sql += ` AND c.company_id = $${paramIndex}`;
      queryParams.push(params.company_id);
      paramIndex++;
    }

    // Add ordering and limit
    sql += `
      ORDER BY ts_rank(to_tsvector('english', 
        coalesce(c.first_name, '') || ' ' || 
        coalesce(c.last_name, '') || ' ' ||
        coalesce(c.email_jsonb::text, '')
      ), websearch_to_tsquery('english', $1)) DESC
      LIMIT $${paramIndex}
    `;
    queryParams.push(params.limit);

    const result = await executeParameterizedQuery(sql, queryParams, context);

    if (!result.success) {
      return {
        success: false,
        error: result.error || "Search failed",
      };
    }

    // Format results for better readability
    const formattedResults = result.data?.map((row: any) => ({
      id: row.id,
      name: `${row.first_name} ${row.last_name}`,
      title: row.title,
      email: row.email_jsonb?.[0]?.email || null,
      phone: row.phone_jsonb?.[0]?.number || null,
      status: row.status,
      company: row.company_name ? {
        id: row.company_id,
        name: row.company_name,
      } : null,
      sales_rep: row.sales_first_name ? `${row.sales_first_name} ${row.sales_last_name}` : null,
      linkedin_url: row.linkedin_url,
      first_seen: row.first_seen,
      last_seen: row.last_seen,
    }));

    return {
      success: true,
      data: {
        total: formattedResults?.length || 0,
        query: params.query,
        results: formattedResults,
      },
    };
  } catch (error) {
    console.error("Search contacts error:", error instanceof Error ? error.message : "Unknown error");
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const search_contacts = {
  definition: {
    description: `Search for contacts in the Atomic CRM by name, email, or company name.

This tool performs a full-text search across contacts and returns matching results with related company and sales rep information.

Use this tool when:
- Looking up a contact by name
- Finding contacts by email address
- Searching contacts at a specific company
- Finding contacts by partial information

Parameters:
- query (required): Search string (minimum 2 characters). Searches across first name, last name, and email.
- limit (optional): Maximum results to return (default: 10, max: 50)
- status (optional): Filter results by contact status
- company_id (optional): Filter results by company ID

Examples:
- Search by name: { "query": "John Smith" }
- Search by email: { "query": "john@example.com" }
- Search with filters: { "query": "CEO", "status": "active", "limit": 5 }

Results include:
- Contact ID, name, title, email, phone
- Company information (if associated)
- Sales rep name
- Status and dates`,
    inputSchema: SearchContactsSchema,
  },
  handler: async (params: z.infer<typeof SearchContactsSchema>, context: McpContext) => {
    const result = await searchContacts(params, context);

    return {
      content: [
        {
          type: "text" as const,
          text: result.success
          ? JSON.stringify(result.data, null, 2)
          : `Search failed: ${result.error}`,
        },
      ],
      isError: !result.success,
    };
  },
};
