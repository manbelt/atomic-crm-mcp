import pg from "pg";
import { decodeJwt } from "jose";
import { config } from "../config.js";
import type { AuthInfo } from "../auth/jwt-validator.js";

// Re-export utilities from query-utils for backward compatibility
export {
  buildInClause,
  buildSetClause,
  buildInsertStatement,
  buildWhereClause,
  isValidTable,
  isValidColumn,
  escapeLikePattern,
  buildTsQuery,
} from "./query-utils.js";

const { Pool } = pg;

/**
 * Database connection pool singleton
 */
let pool: pg.Pool | null = null;

/**
 * Get or create the database connection pool
 */
export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on("error", (err) => {
      console.error("Database pool error:", err);
    });
  }
  return pool;
}

/**
 * Close the database connection pool
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Query context for executing parameterized queries
 */
export interface QueryContext {
  authInfo: AuthInfo;
  userToken: string;
}

/**
 * Execute a parameterized query with RLS context
 * 
 * @param sql - SQL query with $1, $2, etc. placeholders
 * @param params - Array of parameter values
 * @param context - Authentication context
 * @returns Query result
 */
export async function executeParameterizedQuery(
  sql: string,
  params: unknown[],
  context: QueryContext
): Promise<{ success: boolean; data?: any[]; error?: string }> {
  const pool = getPool();
  let client: pg.PoolClient | null = null;

  try {
    client = await pool.connect();
    const jwtClaims = decodeJwt(context.userToken);

    await client.query("BEGIN");

    // Set RLS role
    await client.query(`SET LOCAL role = 'authenticated'`);

    // Set JWT claims for RLS (requires escaping for SET command)
    // Note: SET doesn't support parameterized queries, so we must escape carefully
    const claimsJson = JSON.stringify(jwtClaims)
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "''");
    await client.query(`SET LOCAL request.jwt.claims = '${claimsJson}'`);

    // Execute the parameterized query
    const result = await client.query(sql, params);

    await client.query("COMMIT");

    return {
      success: true,
      data: result.rows,
    };
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Rollback error:", rollbackError);
      }
    }

    const errorMessage = formatError(error);
    console.error("Query execution error:", errorMessage);

    return {
      success: false,
      error: errorMessage,
    };
  } finally {
    if (client) {
      client.release();
    }
  }
}

/**
 * Execute a raw SQL query (for schema introspection only)
 * Use with caution - no parameterization
 */
export async function executeRawQuery(
  sql: string,
  context: QueryContext
): Promise<{ success: boolean; data?: any[]; error?: string }> {
  const pool = getPool();
  let client: pg.PoolClient | null = null;

  try {
    client = await pool.connect();
    const jwtClaims = decodeJwt(context.userToken);

    await client.query("BEGIN");
    await client.query(`SET LOCAL role = 'authenticated'`);

    const claimsJson = JSON.stringify(jwtClaims)
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "''");
    await client.query(`SET LOCAL request.jwt.claims = '${claimsJson}'`);

    const result = await client.query(sql);

    await client.query("COMMIT");

    return {
      success: true,
      data: result.rows,
    };
  } catch (error) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Rollback error:", rollbackError);
      }
    }

    const errorMessage = formatError(error);
    console.error("Raw query execution error:", errorMessage);

    return {
      success: false,
      error: errorMessage,
    };
  } finally {
    if (client) {
      client.release();
    }
  }
}

/**
 * Format error for consistent error messages
 */
function formatError(error: unknown): string {
  if (error instanceof AggregateError && error.errors.length > 0) {
    return error.errors
      .map((e) => (e instanceof Error ? e.message : String(e)))
      .join("; ");
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
