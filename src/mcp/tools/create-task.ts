import { z } from "zod";
import { executeParameterizedQuery, isValidTable } from "../../db/query-builder.js";
import type { McpContext } from "../server.js";

/**
 * Input schema for creating a task
 */
const CreateTaskSchema = z.object({
  title: z.string().min(1).max(200).describe("Task title/summary"),
  description: z.string().max(5000).optional().describe("Task description/details"),
  contact_id: z.string().uuid().optional().describe("UUID of the associated contact"),
  company_id: z.number().int().positive().optional().describe("ID of the associated company"),
  deal_id: z.number().int().positive().optional().describe("ID of the associated deal"),
  due_date: z.string().optional().describe("Due date (ISO format: YYYY-MM-DD)"),
  status: z.string().max(50).optional().default("pending").describe("Task status (pending, in_progress, done, cancelled)"),
  priority: z.string().max(20).optional().default("medium").describe("Task priority (low, medium, high, urgent)"),
  type: z.string().max(50).optional().describe("Task type (call, email, meeting, follow_up, other)"),
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
 * Creates a new task in the CRM
 */
async function createTask(
  params: z.infer<typeof CreateTaskSchema>,
  context: McpContext
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    // Validate table name
    if (!isValidTable("sales") || !isValidTable("tasks")) {
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

    // Insert the task
    const insertSql = `
      INSERT INTO tasks (
        title,
        description,
        contact_id,
        company_id,
        deal_id,
        due_date,
        status,
        priority,
        type,
        sales_id,
        created_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10, NOW(), NOW()
      )
      RETURNING id, title, status, priority, due_date, created_at
    `;

    const insertParams = [
      params.title,
      params.description || null,
      params.contact_id || null,
      params.company_id || null,
      params.deal_id || null,
      params.due_date || null,
      params.status || "pending",
      params.priority || "medium",
      params.type || null,
      salesId,
    ];

    const result = await executeParameterizedQuery(insertSql, insertParams, context);

    if (!result.success) {
      return {
        success: false,
        error: result.error || "Failed to create task",
      };
    }

    console.log(`Task created: ${sanitizeForLog(params.title)} by user ${context.authInfo.userId}`);

    return {
      success: true,
      data: result.data?.[0],
    };
  } catch (error) {
    console.error("Create task error:", error instanceof Error ? error.message : "Unknown error");
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const create_task = {
  definition: {
    description: `Create a new task in the Atomic CRM.

Use this tool when you need to add a new task/to-do to the CRM. The task will be automatically associated with the authenticated user as the owner.

Required fields:
- title: Task title/summary (1-200 characters)

Optional fields:
- description: Task description/details
- contact_id: UUID of an existing contact to associate
- company_id: ID of an existing company to associate
- deal_id: ID of an existing deal to associate
- due_date: Due date (ISO format: YYYY-MM-DD)
- status: Task status (defaults to 'pending')
  - pending: Not started
  - in_progress: Currently working on
  - done: Completed
  - cancelled: Cancelled
- priority: Task priority (defaults to 'medium')
  - low: Low priority
  - medium: Medium priority
  - high: High priority
  - urgent: Urgent
- type: Task type
  - call: Phone call
  - email: Email
  - meeting: Meeting
  - follow_up: Follow up
  - other: Other

The task will be created with:
- sales_id set to the authenticated user
- created_at and updated_at set to current time

Example:
- Create a basic task: { "title": "Follow up with client" }
- Create with details: { "title": "Call John", "contact_id": "uuid-here", "due_date": "2026-03-01", "priority": "high", "type": "call" }`,
    inputSchema: CreateTaskSchema,
  },
  handler: async (params: z.infer<typeof CreateTaskSchema>, context: McpContext) => {
    const result = await createTask(params, context);

    return {
      content: [
        {
          type: "text" as const,
          text: result.success
            ? `Task created successfully:\n${JSON.stringify(result.data, null, 2)}`
            : `Error creating task: ${result.error}`,
        },
      ],
      isError: !result.success,
    };
  },
};
