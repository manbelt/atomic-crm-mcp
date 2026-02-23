import { Pool } from "pg";
import { config } from "../config.js";
import { logger } from "./logger.js";

/**
 * Audit Logger Service
 * 
 * Records security-relevant events for compliance and forensic analysis.
 * All audit logs are immutable and stored in the database.
 */

export type AuditEventType =
  | "AUTH_LOGIN"
  | "AUTH_LOGOUT"
  | "AUTH_TOKEN_REFRESH"
  | "AUTH_TOKEN_INVALID"
  | "AUTH_MFA_ENABLED"
  | "AUTH_MFA_DISABLED"
  | "AUTH_PASSWORD_CHANGE"
  | "AUTH_PASSWORD_RESET"
  | "AUTH_SSO_LOGIN"
  | "AUTH_FAILED_LOGIN"
  | "DATA_CREATE"
  | "DATA_READ"
  | "DATA_UPDATE"
  | "DATA_DELETE"
  | "DATA_EXPORT"
  | "DATA_IMPORT"
  | "DATA_MERGE"
  | "PERMISSION_GRANTED"
  | "PERMISSION_REVOKED"
  | "PERMISSION_DENIED"
  | "RATE_LIMIT_EXCEEDED"
  | "SECURITY_VIOLATION"
  | "CONFIG_CHANGE"
  | "API_KEY_CREATED"
  | "API_KEY_REVOKED"
  | "MCP_TOOL_CALL";

export type AuditSeverity = "info" | "warning" | "critical";

export interface AuditEvent {
  eventType: AuditEventType;
  severity: AuditSeverity;
  userId?: string;
  userEmail?: string;
  ipAddress?: string;
  userAgent?: string;
  resource?: string;
  resourceId?: string;
  action?: string;
  details?: Record<string, unknown>;
  success: boolean;
  errorMessage?: string;
}

// Database connection pool for audit logging
let pool: Pool | null = null;

/**
 * Initialize the audit logger
 */
export function initAuditLogger(): void {
  if (pool) {
    return;
  }

  pool = new Pool({
    connectionString: config.databaseUrl,
    max: 3, // Small pool for audit logging
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  pool.on("error", (err) => {
    logger.error("Audit logger database pool error", err);
  });
}

/**
 * Close the audit logger connection pool
 */
export async function closeAuditLogger(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Log an audit event
 */
export async function logAuditEvent(event: AuditEvent): Promise<void> {
  // Always log to console first for immediate visibility
  logger.audit(
    event.eventType,
    event.resource || "system",
    event.userId,
    {
      severity: event.severity,
      success: event.success,
      ipAddress: event.ipAddress,
      resource: event.resource,
      resourceId: event.resourceId,
      action: event.action,
    }
  );

  // Try to persist to database
  if (!pool) {
    logger.warn("Audit logger not initialized, event not persisted to database");
    return;
  }

  try {
    await pool.query(
      `INSERT INTO audit_log (
        event_type,
        severity,
        user_id,
        user_email,
        ip_address,
        user_agent,
        resource,
        resource_id,
        action,
        details,
        success,
        error_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        event.eventType,
        event.severity,
        event.userId || null,
        event.userEmail || null,
        event.ipAddress || null,
        event.userAgent || null,
        event.resource || null,
        event.resourceId || null,
        event.action || null,
        event.details ? JSON.stringify(event.details) : null,
        event.success,
        event.errorMessage || null,
      ]
    );
  } catch (error) {
    // Don't fail the request if audit logging fails
    logger.error("Failed to persist audit event to database", error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Log authentication event
 */
export function logAuthEvent(
  eventType: AuditEventType,
  userId: string | undefined,
  success: boolean,
  options: {
    ipAddress?: string;
    userAgent?: string;
    userEmail?: string;
    errorMessage?: string;
  } = {}
): void {
  logAuditEvent({
    eventType,
    severity: success ? "info" : "warning",
    userId,
    userEmail: options.userEmail,
    ipAddress: options.ipAddress,
    userAgent: options.userAgent,
    resource: "authentication",
    success,
    errorMessage: options.errorMessage,
  }).catch((err) => {
    logger.error("Failed to log auth event", err);
  });
}

/**
 * Log data access event
 */
export function logDataEvent(
  action: "create" | "read" | "update" | "delete" | "export" | "import" | "merge",
  resource: string,
  resourceId: string | undefined,
  userId: string,
  options: {
    ipAddress?: string;
    userAgent?: string;
    details?: Record<string, unknown>;
    success?: boolean;
    errorMessage?: string;
  } = {}
): void {
  const eventTypeMap: Record<string, AuditEventType> = {
    create: "DATA_CREATE",
    read: "DATA_READ",
    update: "DATA_UPDATE",
    delete: "DATA_DELETE",
    export: "DATA_EXPORT",
    import: "DATA_IMPORT",
    merge: "DATA_MERGE",
  };

  logAuditEvent({
    eventType: eventTypeMap[action],
    severity: action === "delete" ? "warning" : "info",
    userId,
    ipAddress: options.ipAddress,
    userAgent: options.userAgent,
    resource,
    resourceId,
    action,
    details: options.details,
    success: options.success ?? true,
    errorMessage: options.errorMessage,
  }).catch((err) => {
    logger.error("Failed to log data event", err);
  });
}

/**
 * Log MCP tool call
 */
export function logMcpToolCall(
  toolName: string,
  userId: string,
  success: boolean,
  options: {
    ipAddress?: string;
    userAgent?: string;
    duration?: number;
    errorMessage?: string;
    params?: Record<string, unknown>;
  } = {}
): void {
  logAuditEvent({
    eventType: "MCP_TOOL_CALL",
    severity: success ? "info" : "warning",
    userId,
    ipAddress: options.ipAddress,
    userAgent: options.userAgent,
    resource: "mcp_tool",
    resourceId: toolName,
    action: "call",
    details: {
      duration: options.duration,
      params: options.params ? sanitizeParams(options.params) : undefined,
    },
    success,
    errorMessage: options.errorMessage,
  }).catch((err) => {
    logger.error("Failed to log MCP tool call", err);
  });
}

/**
 * Log security violation
 */
export function logSecurityViolation(
  violation: string,
  userId: string | undefined,
  options: {
    ipAddress?: string;
    userAgent?: string;
    details?: Record<string, unknown>;
  } = {}
): void {
  logAuditEvent({
    eventType: "SECURITY_VIOLATION",
    severity: "critical",
    userId,
    ipAddress: options.ipAddress,
    userAgent: options.userAgent,
    resource: "security",
    action: violation,
    details: options.details,
    success: false,
    errorMessage: violation,
  }).catch((err) => {
    logger.error("Failed to log security violation", err);
  });
}

/**
 * Log rate limit exceeded
 */
export function logRateLimitExceeded(
  userId: string | undefined,
  ipAddress: string | undefined,
  endpoint: string
): void {
  logAuditEvent({
    eventType: "RATE_LIMIT_EXCEEDED",
    severity: "warning",
    userId,
    ipAddress,
    resource: endpoint,
    action: "rate_limit",
    success: false,
    errorMessage: "Rate limit exceeded",
  }).catch((err) => {
    logger.error("Failed to log rate limit event", err);
  });
}

/**
 * Sanitize parameters for logging (remove sensitive data)
 */
function sanitizeParams(params: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = ["password", "token", "secret", "key", "auth", "credential", "api_key"];
  
  const sanitized: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(params)) {
    const lowerKey = key.toLowerCase();
    
    if (sensitiveKeys.some((sk) => lowerKey.includes(sk))) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "string" && value.length > 100) {
      sanitized[key] = value.substring(0, 100) + "...";
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizeParams(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}

/**
 * Query audit logs (for admin purposes)
 */
export async function queryAuditLogs(options: {
  userId?: string;
  eventType?: AuditEventType;
  resource?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}): Promise<{ success: boolean; data?: any[]; error?: string }> {
  if (!pool) {
    return { success: false, error: "Audit logger not initialized" };
  }

  try {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (options.userId) {
      conditions.push(`user_id = $${paramIndex++}`);
      params.push(options.userId);
    }

    if (options.eventType) {
      conditions.push(`event_type = $${paramIndex++}`);
      params.push(options.eventType);
    }

    if (options.resource) {
      conditions.push(`resource = $${paramIndex++}`);
      params.push(options.resource);
    }

    if (options.startDate) {
      conditions.push(`created_at >= $${paramIndex++}`);
      params.push(options.startDate);
    }

    if (options.endDate) {
      conditions.push(`created_at <= $${paramIndex++}`);
      params.push(options.endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = options.limit || 100;
    const offset = options.offset || 0;

    params.push(limit, offset);

    const result = await pool.query(
      `SELECT * FROM audit_log ${whereClause} ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      params
    );

    return { success: true, data: result.rows };
  } catch (error) {
    logger.error("Failed to query audit logs", error instanceof Error ? error : new Error(String(error)));
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
