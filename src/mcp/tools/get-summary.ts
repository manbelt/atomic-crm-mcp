import { z } from "zod";
import { executeRawQuery } from "../../db/query-builder.js";
import type { McpContext } from "../server.js";

/**
 * Get dashboard summary tool
 * 
 * Returns key metrics for the CRM dashboard including:
 * - Total counts (contacts, companies, deals, tasks)
 * - Deal pipeline summary (total value, stage breakdown)
 * - Recent activity
 * - Upcoming tasks
 */

async function getSummary(
  context: McpContext
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    // Get counts - using safe static queries
    const contactsCount = await executeRawQuery(
      `SELECT COUNT(*) as total FROM contacts`,
      context
    );

    const companiesCount = await executeRawQuery(
      `SELECT COUNT(*) as total FROM companies`,
      context
    );

    const dealsCount = await executeRawQuery(
      `SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE archived_at IS NULL) as active,
        COALESCE(SUM(amount) FILTER (WHERE archived_at IS NULL), 0) as total_value
      FROM deals`,
      context
    );

    const tasksCount = await executeRawQuery(
      `SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE done_date IS NULL) as pending,
        COUNT(*) FILTER (WHERE done_date IS NULL AND due_date < NOW()) as overdue
      FROM tasks`,
      context
    );

    // Get deals by stage
    const dealsByStage = await executeRawQuery(
      `SELECT 
        stage,
        COUNT(*) as count,
        COALESCE(SUM(amount), 0) as total_amount
      FROM deals
      WHERE archived_at IS NULL
      GROUP BY stage
      ORDER BY count DESC`,
      context
    );

    // Get upcoming tasks (due in next 7 days)
    const upcomingTasks = await executeRawQuery(
      `SELECT 
        t.id,
        t.type,
        t.text,
        t.due_date,
        c.first_name,
        c.last_name
      FROM tasks t
      LEFT JOIN contacts c ON t.contact_id = c.id
      WHERE t.done_date IS NULL
        AND t.due_date >= NOW()
        AND t.due_date <= NOW() + INTERVAL '7 days'
      ORDER BY t.due_date ASC
      LIMIT 5`,
      context
    );

    // Get recent contacts
    const recentContacts = await executeRawQuery(
      `SELECT 
        id,
        first_name,
        last_name,
        title,
        status,
        first_seen
      FROM contacts
      ORDER BY first_seen DESC
      LIMIT 5`,
      context
    );

    // Build summary object
    const summary = {
      counts: {
        contacts: parseInt(contactsCount.data?.[0]?.total || "0"),
        companies: parseInt(companiesCount.data?.[0]?.total || "0"),
        deals: {
          total: parseInt(dealsCount.data?.[0]?.total || "0"),
          active: parseInt(dealsCount.data?.[0]?.active || "0"),
          totalValue: parseFloat(dealsCount.data?.[0]?.total_value || "0"),
        },
        tasks: {
          total: parseInt(tasksCount.data?.[0]?.total || "0"),
          pending: parseInt(tasksCount.data?.[0]?.pending || "0"),
          overdue: parseInt(tasksCount.data?.[0]?.overdue || "0"),
        },
      },
      pipeline: {
        stages: dealsByStage.data?.map((row: any) => ({
          stage: row.stage,
          count: parseInt(row.count),
          totalAmount: parseFloat(row.total_amount || "0"),
        })) || [],
      },
      upcomingTasks: upcomingTasks.data?.map((row: any) => ({
        id: row.id,
        type: row.type,
        text: row.text,
        dueDate: row.due_date,
        contact: row.first_name ? `${row.first_name} ${row.last_name}` : null,
      })) || [],
      recentContacts: recentContacts.data?.map((row: any) => ({
        id: row.id,
        name: `${row.first_name} ${row.last_name}`,
        title: row.title,
        status: row.status,
        firstSeen: row.first_seen,
      })) || [],
    };

    return {
      success: true,
      data: summary,
    };
  } catch (error) {
    console.error("Get summary error:", error instanceof Error ? error.message : "Unknown error");
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const get_summary = {
  definition: {
    description: `Get a summary of key metrics from the Atomic CRM dashboard.

Returns:
- **Counts**: Total contacts, companies, deals (total/active), tasks (total/pending/overdue)
- **Pipeline**: Deals by stage with counts and total amounts
- **Upcoming Tasks**: Tasks due in the next 7 days (max 5)
- **Recent Contacts**: Last 5 contacts added to the CRM

Use this tool to get a quick overview of the CRM state, for dashboard displays, or to understand the current sales pipeline.

Parameters: None

Example:
- Get summary: {}`,
    inputSchema: z.object({}),
  },
  handler: async (_params: {}, context: McpContext) => {
    const result = await getSummary(context);

    return {
      content: [
        {
          type: "text" as const,
          text: result.success
            ? JSON.stringify(result.data, null, 2)
            : `Error getting summary: ${result.error}`,
        },
      ],
      isError: !result.success,
    };
  },
};
