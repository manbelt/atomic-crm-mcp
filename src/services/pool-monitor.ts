import type { Pool } from "pg";
import { logger } from "./logger.js";

/**
 * Pool statistics interface
 */
export interface PoolStats {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  activeCount: number;
  maxConnections: number;
  utilizationPercent: number;
  timestamp: string;
}

/**
 * Pool health status
 */
export interface PoolHealthStatus {
  healthy: boolean;
  status: "healthy" | "degraded" | "critical";
  message: string;
  stats: PoolStats;
  recommendations: string[];
}

/**
 * Thresholds for pool health monitoring
 */
const THRESHOLDS = {
  utilization: {
    degraded: 70, // 70% utilization triggers degraded
    critical: 90, // 90% utilization triggers critical
  },
  waiting: {
    degraded: 5, // 5 waiting connections triggers degraded
    critical: 20, // 20 waiting connections triggers critical
  },
};

/**
 * Collect statistics from a PostgreSQL connection pool
 */
export function collectPoolStats(pool: Pool, maxConnections: number = 10): PoolStats {
  const totalCount = pool.totalCount;
  const idleCount = pool.idleCount;
  const waitingCount = pool.waitingCount;
  const activeCount = totalCount - idleCount;
  const utilizationPercent = Math.round((activeCount / maxConnections) * 100);

  return {
    totalCount,
    idleCount,
    waitingCount,
    activeCount,
    maxConnections,
    utilizationPercent,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Check pool health based on collected statistics
 */
export function checkPoolHealth(stats: PoolStats): PoolHealthStatus {
  const recommendations: string[] = [];
  let status: "healthy" | "degraded" | "critical" = "healthy";
  let message = "Connection pool is operating normally";

  // Check utilization
  if (stats.utilizationPercent >= THRESHOLDS.utilization.critical) {
    status = "critical";
    message = `Critical: Pool utilization at ${stats.utilizationPercent}%`;
    recommendations.push("Consider increasing max pool connections");
    recommendations.push("Check for connection leaks");
    recommendations.push("Review long-running queries");
  } else if (stats.utilizationPercent >= THRESHOLDS.utilization.degraded) {
    status = "degraded";
    message = `Warning: Pool utilization at ${stats.utilizationPercent}%`;
    recommendations.push("Monitor for increasing load");
    recommendations.push("Consider connection pooling optimization");
  }

  // Check waiting connections
  if (stats.waitingCount >= THRESHOLDS.waiting.critical) {
    status = "critical";
    message = `Critical: ${stats.waitingCount} connections waiting`;
    recommendations.push("Immediate action required: Scale up or optimize queries");
  } else if (stats.waitingCount >= THRESHOLDS.waiting.degraded) {
    if (status !== "critical") {
      status = "degraded";
    }
    message = `Warning: ${stats.waitingCount} connections waiting`;
    recommendations.push("Monitor query performance");
  }

  // Check for potential connection leaks
  if (stats.totalCount > stats.maxConnections) {
    status = "critical";
    message = "Pool size exceeds configured maximum - possible leak";
    recommendations.push("Investigate connection leak immediately");
  }

  return {
    healthy: status === "healthy",
    status,
    message,
    stats,
    recommendations,
  };
}

/**
 * Log pool statistics for monitoring
 */
export function logPoolStats(pool: Pool, maxConnections: number = 10): void {
  const stats = collectPoolStats(pool, maxConnections);
  const health = checkPoolHealth(stats);

  if (health.status === "critical") {
    logger.error("Database pool critical", undefined, { poolStats: stats, recommendations: health.recommendations });
  } else if (health.status === "degraded") {
    logger.warn("Database pool degraded", { poolStats: stats, recommendations: health.recommendations });
  } else {
    logger.info("Database pool stats", { poolStats: stats });
  }
}

/**
 * Start periodic pool monitoring
 */
export function startPoolMonitoring(
  pool: Pool,
  intervalMs: number = 30000,
  maxConnections: number = 10
): NodeJS.Timeout {
  logger.info("Starting database pool monitoring", { intervalMs, maxConnections });

  // Log initial stats
  logPoolStats(pool, maxConnections);

  // Set up periodic monitoring
  const interval = setInterval(() => {
    logPoolStats(pool, maxConnections);
  }, intervalMs);

  return interval;
}

/**
 * Pool monitoring configuration
 */
export interface PoolMonitoringConfig {
  enabled: boolean;
  intervalMs: number;
  maxConnections: number;
  alertThresholds: {
    utilizationDegraded: number;
    utilizationCritical: number;
    waitingDegraded: number;
    waitingCritical: number;
  };
}

/**
 * Default pool monitoring configuration
 */
export const DEFAULT_POOL_MONITORING_CONFIG: PoolMonitoringConfig = {
  enabled: true,
  intervalMs: 30000, // 30 seconds
  maxConnections: 10,
  alertThresholds: {
    utilizationDegraded: THRESHOLDS.utilization.degraded,
    utilizationCritical: THRESHOLDS.utilization.critical,
    waitingDegraded: THRESHOLDS.waiting.degraded,
    waitingCritical: THRESHOLDS.waiting.critical,
  },
};
