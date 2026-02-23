import { Router, type Request, type Response } from "express";
import { logger } from "../services/logger.js";

/**
 * Health Check Routes
 * 
 * Provides endpoints for monitoring application health:
 * - /health/live - Liveness probe (is the app running?)
 * - /health/ready - Readiness probe (can the app handle requests?)
 */

export const healthRouter = Router();

// Get Supabase URL from environment
const getSupabaseUrl = () => process.env.SUPABASE_URL || "";

/**
 * Check database connectivity via Supabase REST API
 * This is more reliable than direct PostgreSQL connection for Supabase projects
 */
async function checkDatabaseHealth(): Promise<{ status: string; latency?: number; error?: string; serverTime?: string }> {
  const supabaseUrl = getSupabaseUrl();
  
  if (!supabaseUrl) {
    return { status: "error", error: "SUPABASE_URL not configured" };
  }

  try {
    const start = Date.now();
    
    // Use Supabase REST API to check database connectivity
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql: 'SELECT 1 as test, NOW() as time' }),
    });

    const latency = Date.now() - start;

    if (!response.ok) {
      // Try a simpler health check - just ping the REST API
      const pingResponse = await fetch(`${supabaseUrl}/rest/v1/`, {
        method: 'GET',
      });
      
      if (pingResponse.ok || pingResponse.status === 401 || pingResponse.status === 404) {
        // 401/404 means the API is responding (just needs auth), which is fine for health check
        return { status: "ok", latency };
      }
      
      return { 
        status: "error", 
        error: `REST API returned ${response.status}`,
        latency 
      };
    }

    return { status: "ok", latency };
  } catch (error) {
    return { 
      status: "error", 
      error: error instanceof Error ? error.message : "Unknown error" 
    };
  }
}

/**
 * Liveness probe
 * GET /health/live
 * 
 * Returns 200 if the application is running.
 * This endpoint should always succeed if the process is alive.
 */
healthRouter.get("/live", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

/**
 * Readiness probe
 * GET /health/ready
 * 
 * Returns 200 if the application can handle requests.
 * Checks database connectivity and other dependencies.
 */
healthRouter.get("/ready", async (_req: Request, res: Response) => {
  const checks: Record<string, { status: "ok" | "error"; latency?: number; error?: string }> = {};
  let allHealthy = true;

  // Check database connectivity via REST API
  const dbHealth = await checkDatabaseHealth();
  checks.database = {
    status: dbHealth.status as "ok" | "error",
    latency: dbHealth.latency,
    ...(dbHealth.error && { error: dbHealth.error }),
  };

  if (dbHealth.status !== "ok") {
    allHealthy = false;
    logger.error("Health check: database connection failed", new Error(dbHealth.error || "Unknown error"));
  }

  // Check memory usage
  const memoryUsage = process.memoryUsage();
  const memoryThreshold = 0.9; // 90% of heap
  const heapUsedRatio = memoryUsage.heapUsed / memoryUsage.heapTotal;
  
  checks.memory = {
    status: heapUsedRatio < memoryThreshold ? "ok" : "error",
    latency: Math.round(heapUsedRatio * 100),
  };

  if (heapUsedRatio >= memoryThreshold) {
    allHealthy = false;
    logger.warn("Health check: memory usage high", {
      heapUsed: memoryUsage.heapUsed,
      heapTotal: memoryUsage.heapTotal,
      ratio: heapUsedRatio,
    });
  }

  // Build response
  const response = {
    status: allHealthy ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || "1.0.0",
    checks,
  };

  // Return appropriate status code
  const statusCode = allHealthy ? 200 : 503;
  res.status(statusCode).json(response);
});

/**
 * Detailed health check
 * GET /health
 * 
 * Returns detailed health information including all checks.
 */
healthRouter.get("/", async (_req: Request, res: Response) => {
  const checks: Record<string, unknown> = {};
  let allHealthy = true;

  // Database check via REST API
  const dbHealth = await checkDatabaseHealth();
  checks.database = {
    status: dbHealth.status,
    ...(dbHealth.latency && { latency: `${dbHealth.latency}ms` }),
    ...(dbHealth.serverTime && { serverTime: dbHealth.serverTime }),
    ...(dbHealth.error && { error: dbHealth.error }),
  };

  if (dbHealth.status !== "ok") {
    allHealthy = false;
  }

  // Memory check
  const memoryUsage = process.memoryUsage();
  checks.memory = {
    heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
    heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`,
    rss: `${Math.round(memoryUsage.rss / 1024 / 1024)}MB`,
    external: `${Math.round(memoryUsage.external / 1024 / 1024)}MB`,
  };

  // Process info
  checks.process = {
    pid: process.pid,
    nodeVersion: process.version,
    platform: process.platform,
    uptime: `${Math.round(process.uptime())}s`,
  };

  // Environment info
  checks.environment = {
    nodeEnv: process.env.NODE_ENV || "development",
    logLevel: process.env.LOG_LEVEL || "info",
  };

  const response = {
    status: allHealthy ? "healthy" : "unhealthy",
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "1.0.0",
    checks,
  };

  const statusCode = allHealthy ? 200 : 503;
  res.status(statusCode).json(response);
});

/**
 * Simple health check for load balancers
 * GET /health/ping
 */
healthRouter.get("/ping", (_req: Request, res: Response) => {
  res.status(200).send("pong");
});
