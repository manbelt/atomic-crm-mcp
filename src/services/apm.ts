import { logger } from "./logger.js";

/**
 * APM configuration
 */
export interface ApmConfig {
  enabled: boolean;
  serviceName: string;
  environment: string;
  sampleRate: number;
  captureExceptions: boolean;
  captureMetrics: boolean;
}

/**
 * Default APM configuration
 */
export const DEFAULT_APM_CONFIG: ApmConfig = {
  enabled: true,
  serviceName: "atomic-crm-mcp",
  environment: process.env.NODE_ENV || "development",
  sampleRate: 1.0,
  captureExceptions: true,
  captureMetrics: true,
};

/**
 * Span represents a unit of work in APM
 */
export interface Span {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  metadata: Record<string, unknown>;
  status: "success" | "error";
  errorMessage?: string;
}

/**
 * Transaction represents a complete request/response cycle
 */
export interface Transaction {
  id: string;
  name: string;
  type: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  spans: Span[];
  metadata: Record<string, unknown>;
  status: "success" | "error";
}

/**
 * Metrics for APM reporting
 */
export interface ApmMetrics {
  requestCount: number;
  errorCount: number;
  avgResponseTime: number;
  p50ResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  throughput: number;
}

/**
 * APM service for performance monitoring
 */
export class ApmService {
  private config: ApmConfig;
  private currentTransaction: Transaction | null = null;
  private responseTimes: number[] = [];
  private requestCount: number = 0;
  private errorCount: number = 0;
  private lastMetricsTime: number = Date.now();

  constructor(config: Partial<ApmConfig> = {}) {
    this.config = { ...DEFAULT_APM_CONFIG, ...config };
  }

  /**
   * Start a new transaction
   */
  startTransaction(name: string, type: string, metadata: Record<string, unknown> = {}): Transaction {
    const transaction: Transaction = {
      id: this.generateId(),
      name,
      type,
      startTime: Date.now(),
      spans: [],
      metadata,
      status: "success",
    };

    this.currentTransaction = transaction;
    return transaction;
  }

  /**
   * End the current transaction
   */
  endTransaction(status: "success" | "error" = "success"): Transaction | null {
    if (!this.currentTransaction) {
      return null;
    }

    this.currentTransaction.endTime = Date.now();
    this.currentTransaction.duration = this.currentTransaction.endTime - this.currentTransaction.startTime;
    this.currentTransaction.status = status;

    // Track metrics
    this.requestCount++;
    if (status === "error") {
      this.errorCount++;
    }
    this.responseTimes.push(this.currentTransaction.duration);

    // Log transaction
    if (this.config.enabled) {
      logger.info("APM Transaction", {
        transaction: {
          id: this.currentTransaction.id,
          name: this.currentTransaction.name,
          type: this.currentTransaction.type,
          duration: this.currentTransaction.duration,
          status: this.currentTransaction.status,
          spanCount: this.currentTransaction.spans.length,
        },
      });
    }

    const completed = this.currentTransaction;
    this.currentTransaction = null;
    return completed;
  }

  /**
   * Start a new span within the current transaction
   */
  startSpan(name: string, metadata: Record<string, unknown> = {}): Span | null {
    if (!this.currentTransaction) {
      return null;
    }

    const span: Span = {
      name,
      startTime: Date.now(),
      metadata,
      status: "success",
    };

    return span;
  }

  /**
   * End a span
   */
  endSpan(span: Span, status: "success" | "error" = "success", errorMessage?: string): void {
    span.endTime = Date.now();
    span.duration = span.endTime - span.startTime;
    span.status = status;
    span.errorMessage = errorMessage;

    if (this.currentTransaction) {
      this.currentTransaction.spans.push(span);
    }
  }

  /**
   * Record an exception
   */
  recordException(error: Error, metadata: Record<string, unknown> = {}): void {
    if (!this.config.captureExceptions) {
      return;
    }

    logger.error("APM Exception", error, {
      exception: {
        type: error.name,
        message: error.message,
        stack: error.stack,
        metadata,
      },
    });

    if (this.currentTransaction) {
      this.currentTransaction.status = "error";
    }
  }

  /**
   * Get current metrics
   */
  getMetrics(): ApmMetrics {
    const now = Date.now();
    const elapsed = (now - this.lastMetricsTime) / 1000; // seconds

    // Calculate percentiles
    const sorted = [...this.responseTimes].sort((a, b) => a - b);
    const p50 = this.percentile(sorted, 50);
    const p95 = this.percentile(sorted, 95);
    const p99 = this.percentile(sorted, 99);
    const avg = sorted.length > 0 ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0;

    return {
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      avgResponseTime: Math.round(avg),
      p50ResponseTime: Math.round(p50),
      p95ResponseTime: Math.round(p95),
      p99ResponseTime: Math.round(p99),
      throughput: Math.round(this.requestCount / elapsed),
    };
  }

  /**
   * Reset metrics (call after reporting)
   */
  resetMetrics(): void {
    this.requestCount = 0;
    this.errorCount = 0;
    this.responseTimes = [];
    this.lastMetricsTime = Date.now();
  }

  /**
   * Calculate percentile of sorted array
   */
  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)] || 0;
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

/**
 * Singleton APM instance
 */
let apmInstance: ApmService | null = null;

/**
 * Initialize APM service
 */
export function initializeApm(config?: Partial<ApmConfig>): ApmService {
  if (!apmInstance) {
    apmInstance = new ApmService(config);
  }
  return apmInstance;
}

/**
 * Get APM instance
 */
export function getApm(): ApmService | null {
  return apmInstance;
}

/**
 * Express middleware for APM
 */
export function apmMiddleware(req: any, res: any, next: any): void {
  const apm = getApm();
  
  if (!apm) {
    next();
    return;
  }

  const transaction = apm.startTransaction(
    `${req.method} ${req.path}`,
    "request",
    {
      method: req.method,
      path: req.path,
      query: req.query,
      userAgent: req.headers["user-agent"],
      ip: req.ip,
    }
  );

  // Store transaction on request for later use
  req.apmTransaction = transaction;

  // End transaction on response finish
  res.on("finish", () => {
    const status = res.statusCode >= 400 ? "error" : "success";
    apm.endTransaction(status);
  });

  next();
}

/**
 * Decorator for instrumenting functions
 */
export function instrument(name: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const apm = getApm();
      
      if (!apm) {
        return originalMethod.apply(this, args);
      }

      const span = apm.startSpan(name);
      
      try {
        const result = await originalMethod.apply(this, args);
        if (span) {
          apm.endSpan(span, "success");
        }
        return result;
      } catch (error) {
        if (span) {
          apm.endSpan(span, "error", error instanceof Error ? error.message : String(error));
        }
        throw error;
      }
    };

    return descriptor;
  };
}
