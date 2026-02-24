import { z } from "zod";
import { executeParameterizedQuery, isValidTable } from "../../db/query-builder.js";
import type { McpContext } from "../server.js";

/**
 * Input schema for updating a task
 */
const UpdateTaskSchema = z.object({
  id: z.number().int().positive().describe("ID of the task to update"),
  title: z.string().min(1).max(200).optional().describe("Task title/summary"),
  description: z.string().max(5000).nullable().optional().describe("Task description"),
  contact_id: z.string().uuid().nullable().optional().describe("Contact UUID to associate"),
  due_date: z.string().nullable().optional().describe("Due date (ISO 8601 format)"),
  status: z.string().max(50).optional().describe("Task status (pending, in-progress, completed, cancelled)"),
  priority: z.string().max(20).optional().describe("Priority level (low, medium, high, urgent)"),
  assignee_id: z.string().uuid().nullable().optional().describe("User UUID to assign the task to"),
});

/**
 * Updates an existing task in the CRM
 */
async function updateTask(
  params: z.infer<typeof UpdateTaskSchema>,
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

    // Verify the task belongs to this user's organization
    const checkResult = await executeParameterizedQuery(
      `SELECT id FROM tasks WHERE id = $1 AND sales_id = $2`,
      [params.id, salesId],
      context
    );

    if (!checkResult.success || !checkResult.data?.length) {
      return {
        success: false,
        error: "Task not found or access denied",
      };
    }

    // Build dynamic update query
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (params.title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(params.title);
    }
    if (params.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(params.description);
    }
    if (params.contact_id !== undefined) {
      updates.push(`contact_id = $${paramIndex++}`);
      values.push(params.contact_id);
    }
    if (params.due_date !== undefined) {
      updates.push(`due_date = $${paramIndex++}`);
      values.push(params.due_date);
    }
    if (params.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(params.status);
    }
    if (params.priority !== undefined) {
      updates.push(`priority = $${paramIndex++}`);
      values.push(params.priority);
    }
    if (params.assignee_id !== undefined) {
      updates.push(`assignee_id = $${paramIndex++}`);
      values.push(params.assignee_id);
    }

    if (updates.length === 0) {
      return {
        success: false,
        error: "No fields provided to update",
      };
    }

    // Add updated_at
    updates.push(`updated_at = NOW()`);

    // Add the task id and sales_id for WHERE clause
    values.push(params.id);
    values.push(salesId);

    const updateSql = `
      UPDATE tasks 
      SET ${updates.join(", ")}
      WHERE id = $${paramIndex} AND sales_id = $${paramIndex + 1}
      RETURNING id, title, status, priority, due_date, updated_at
    `;

    const result = await executeParameterizedQuery(updateSql, values, context);

    if (!result.success) {
      return {
        success: false,
        error: result.error || "Failed to update task",
      };
    }

    console.log(`Task updated: ${params.id} by user ${context.authInfo.userId}`);

    return {
      success: true,
      data: result.data?.[0],
    };
  } catch (error) {
    console.error("Update task error:", error instanceof Error ? error.message : "Unknown error");
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const update_task = {
  definition: {
    description: `Update an existing task in the Atomic CRM.

Use this tool when you need to modify an existing task's information. Only provide the fields you want to update.

Required fields:
- id: ID of the task to update

Optional fields (only include those you want to change):
- title: Task title/summary
- description: Task description
- contact_id: Contact UUID to associate
- due_date: Due date (ISO 8601 format)
- status: Task status (pending, in-progress, completed, cancelled)
- priority: Priority level (low, medium, high, urgent)
- assignee_id: User UUID to assign the task to

Note: You can only update tasks that belong to you.

Example:
- Mark as completed: { "id": 123, "status": "completed" }
- Update due date: { "id": 123, "due_date": "2024-12-31", "priority": "high" }`,
    inputSchema: UpdateTaskSchema,
  },
  handler: async (params: z.infer<typeof UpdateTaskSchema>, context: McpContext) => {
    const result = await updateTask(params, context);

    return {
      content: [
        {
          type: "text" as const,
          text: result.success
            ? `Task updated successfully:\n${JSON.stringify(result.data, null, 2)}`
            : `Error updating task: ${result.error}`,
        },
      ],
      isError: !result.success,
    };
  },
};
