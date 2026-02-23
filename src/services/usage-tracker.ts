import { Pool } from "pg";
import type { AuthInfo } from "../auth/jwt-validator.js";

/**
 * Usage Tracker Service
 * 
 * Tracks MCP tool usage for analytics, rate limiting support, and auditing.
 * Records each tool call with user ID, tool name, parameters, and execution metrics.
 */

// Database connection pool (initialized from config)
let pool: Pool | null = null;

export interface UsageRecord {
  userId: string;
  toolName: string;
  paramsSummary?: string;
  success: boolean;
  errorMessage?: string;
  durationMs?: number;
  ipAddress?: string;
  userAgent?: string;
}

export interface UsageStats {
  toolName: string;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  avgDurationMs: number | null;
  lastCalled: Date | null;
}

export interface DailyUsage {
  date: string;
  totalCalls: number;
  uniqueTools: number;
}

/**
 * Initialize the usage tracker with database connection
 */
export function initUsageTracker(databaseUrl: string): void {
  if (pool) {
    return; // Already initialized
  }

  pool = new Pool({
    connectionString: databaseUrl,
    max: 5, // Small pool for usage tracking
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  // Handle pool errors
  pool.on("error", (err) => {
    console.error("Usage tracker database pool error:", err);
  });
}

/**
 * Close the database connection pool
 */
export async function closeUsageTracker(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Record a tool usage event
 */
export async function recordUsage(record: UsageRecord): Promise<void> {
  if (!pool) {
    console.warn("Usage tracker not initialized, skipping usage recording");
    return;
  }

  try {
    await pool.query(
      `INSERT INTO mcp_usage (
        user_id,
        tool_name,
        params_summary,
        success,
        error_message,
        duration_ms,
        ip_address,
        user_agent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        record.userId,
        record.toolName,
        record.paramsSummary || null,
        record.success,
        record.errorMessage || null,
        record.durationMs || null,
        record.ipAddress || null,
        record.userAgent || null,
      ]
    );
  } catch (error) {
    // Log error but don't fail the request
    console.error("Failed to record usage:", error);
  }
}

/**
 * Get usage statistics for a user
 */
export async function getUsageStats(
  userId: string,
  days: number = 30
): Promise<UsageStats[]> {
  if (!pool) {
    console.warn("Usage tracker not initialized");
    return [];
  }

  try {
    const result = await pool.query(
      `SELECT * FROM get_mcp_usage_stats($1, $2)`,
      [userId, days]
    );

    return result.rows.map((row) => ({
      toolName: row.tool_name,
      totalCalls: parseInt(row.total_calls),
      successfulCalls: parseInt(row.successful_calls),
      failedCalls: parseInt(row.failed_calls),
      avgDurationMs: row.avg_duration_ms
        ? parseFloat(row.avg_duration_ms)
        : null,
      lastCalled: row.last_called,
    }));
  } catch (error) {
    console.error("Failed to get usage stats:", error);
    return [];
  }
}

/**
 * Get daily usage counts for a user
 */
export async function getDailyUsage(
  userId: string,
  days: number = 7
): Promise<DailyUsage[]> {
  if (!pool) {
    console.warn("Usage tracker not initialized");
    return [];
  }

  try {
    const result = await pool.query(
      `SELECT * FROM get_mcp_daily_usage($1, $2)`,
      [userId, days]
    );

    return result.rows.map((row) => ({
      date: row.date.toISOString().split("T")[0],
      totalCalls: parseInt(row.total_calls),
      uniqueTools: parseInt(row.unique_tools),
    }));
  } catch (error) {
    console.error("Failed to get daily usage:", error);
    return [];
  }
}

/**
 * Get total call count for a user in a time window (for rate limiting)
 */
export async function getCallCount(
  userId: string,
  windowMinutes: number
): Promise<number> {
  if (!pool) {
    return 0;
  }

  try {
    const result = await pool.query(
      `SELECT COUNT(*) as count
       FROM mcp_usage
       WHERE user_id = $1
         AND created_at >= NOW() - ($2 || ' minutes')::INTERVAL`,
      [userId, windowMinutes]
    );

    return parseInt(result.rows[0]?.count || "0");
  } catch (error) {
    console.error("Failed to get call count:", error);
    return 0;
  }
}

/**
 * Sanitize parameters for logging (remove sensitive data)
 */
export function sanitizeParams(params: Record<string, any>): string {
  const sensitiveKeys = ["password", "token", "secret", "key", "auth", "credential"];
  
  const sanitized: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(params)) {
    const lowerKey = key.toLowerCase();
    
    // Check if key contains sensitive words
    if (sensitiveKeys.some((sk) => lowerKey.includes(sk))) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "string" && value.length > 100) {
      // Truncate long strings
      sanitized[key] = value.substring(0, 100) + "...";
    } else if (typeof value === "object" && value !== null) {
      // Recursively sanitize nested objects
      sanitized[key] = JSON.parse(sanitizeParams(value));
    } else {
      sanitized[key] = value;
    }
  }
  
  return JSON.stringify(sanitized);
}

/**
 * Higher-order function to wrap tool handlers with usage tracking
 */
export function withUsageTracking<TParams, TResult>(
  toolName: string,
  handler: (params: TParams, context: { authInfo: AuthInfo; userToken: string }) => Promise<TResult>,
  options: {
    getParamsSummary?: (params: TParams) => string;
  } = {}
): (params: TParams, context: { authInfo: AuthInfo; userToken: string }) => Promise<TResult> {
  return async (params: TParams, context: { authInfo: AuthInfo; userToken: string }) => {
    const startTime = Date.now();
    let success = true;
    let errorMessage: string | undefined;

    try {
      const result = await handler(params, context);
      return result;
    } catch (error) {
      success = false;
      errorMessage = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      const durationMs = Date.now() - startTime;

      // Record usage asynchronously (don't block the response)
      recordUsage({
        userId: context.authInfo.userId,
        toolName,
        paramsSummary: options.getParamsSummary
          ? options.getParamsSummary(params)
          : sanitizeParams(params as Record<string, any>),
        success,
        errorMessage,
        durationMs,
      }).catch((err) => {
        console.error("Failed to record usage:", err);
      });
    }
  };
}
