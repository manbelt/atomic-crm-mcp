import { z } from "zod";
import { executeParameterizedQuery, isValidTable } from "../../db/query-builder.js";
import type { McpContext } from "../server.js";

/**
 * Input schema for deleting a task
 */
const DeleteTaskSchema = z.object({
  id: z.number().int().positive().describe("ID of the task to delete"),
});

/**
 * Deletes a task from the CRM
 */
async function deleteTask(
  params: z.infer<typeof DeleteTaskSchema>,
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

    // Verify the task belongs to this user and get its info
    const checkResult = await executeParameterizedQuery(
      `SELECT id, title, status FROM tasks WHERE id = $1 AND sales_id = $2`,
      [params.id, salesId],
      context
    );

    if (!checkResult.success || !checkResult.data?.length) {
      return {
        success: false,
        error: "Task not found or access denied",
      };
    }

    const taskInfo = checkResult.data[0];

    // Delete the task
    const deleteResult = await executeParameterizedQuery(
      `DELETE FROM tasks WHERE id = $1 AND sales_id = $2 RETURNING id`,
      [params.id, salesId],
      context
    );

    if (!deleteResult.success) {
      return {
        success: false,
        error: deleteResult.error || "Failed to delete task",
      };
    }

    console.log(`Task deleted: ${params.id} by user ${context.authInfo.userId}`);

    return {
      success: true,
      data: {
        id: params.id,
        deleted: true,
        task: taskInfo,
      },
    };
  } catch (error) {
    console.error("Delete task error:", error instanceof Error ? error.message : "Unknown error");
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const delete_task = {
  definition: {
    description: `Delete a task from the Atomic CRM.

Use this tool when you need to permanently remove a task from the CRM.

Required fields:
- id: ID of the task to delete

Note: You can only delete tasks that belong to you.

Example:
- Delete a task: { "id": 123 }`,
    inputSchema: DeleteTaskSchema,
  },
  handler: async (params: z.infer<typeof DeleteTaskSchema>, context: McpContext) => {
    const result = await deleteTask(params, context);

    return {
      content: [
        {
          type: "text" as const,
          text: result.success
            ? `Task deleted successfully:\n${JSON.stringify(result.data, null, 2)}`
            : `Error deleting task: ${result.error}`,
        },
      ],
      isError: !result.success,
    };
  },
};
