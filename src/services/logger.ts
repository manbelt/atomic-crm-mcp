/**
 * Structured Logging Service for Atomic CRM MCP Server
 * 
 * Provides JSON-formatted logging with correlation IDs, log levels,
 * and configurable output for production observability.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  service: string;
  correlationId?: string;
  userId?: string;
  requestId?: string;
  duration?: number;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  metadata?: Record<string, unknown>;
}

/**
 * Logger configuration
 */
interface LoggerConfig {
  service: string;
  level: LogLevel;
  includeStack: boolean;
  output: 'json' | 'pretty';
}

// Default configuration
const defaultConfig: LoggerConfig = {
  service: 'atomic-crm-mcp',
  level: (process.env.LOG_LEVEL as LogLevel) || 'info',
  includeStack: process.env.NODE_ENV === 'development',
  output: process.env.NODE_ENV === 'development' ? 'pretty' : 'json',
};

// Log level priority for filtering
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

/**
 * Logger class with structured output
 */
export class Logger {
  private config: LoggerConfig;
  private correlationId?: string;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
  }

  /**
   * Set correlation ID for request tracing
   */
  setCorrelationId(id: string | undefined): void {
    this.correlationId = id;
  }

  /**
   * Get current correlation ID
   */
  getCorrelationId(): string | undefined {
    return this.correlationId;
  }

  /**
   * Create child logger with same configuration
   */
  child(metadata: Record<string, unknown>): ChildLogger {
    return new ChildLogger(this, metadata);
  }

  /**
   * Check if log level should be output
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.config.level];
  }

  /**
   * Format and output log entry
   */
  private log(entry: Omit<LogEntry, 'timestamp' | 'service' | 'correlationId'> & { metadata?: Record<string, unknown> }): void {
    if (!this.shouldLog(entry.level)) {
      return;
    }

    const fullEntry: LogEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
      service: this.config.service,
      correlationId: this.correlationId,
    };

    if (this.config.output === 'pretty') {
      this.outputPretty(fullEntry);
    } else {
      this.outputJson(fullEntry);
    }
  }

  /**
   * Output JSON format (for production)
   */
  private outputJson(entry: LogEntry): void {
    console.log(JSON.stringify(entry));
  }

  /**
   * Output pretty format (for development)
   */
  private outputPretty(entry: LogEntry): void {
    const levelColors: Record<LogLevel, string> = {
      debug: '\x1b[36m', // cyan
      info: '\x1b[32m',  // green
      warn: '\x1b[33m',  // yellow
      error: '\x1b[31m', // red
      fatal: '\x1b[35m', // magenta
    };
    const reset = '\x1b[0m';
    const color = levelColors[entry.level];

    const prefix = `${color}[${entry.level.toUpperCase().padEnd(5)}]${reset} ${entry.timestamp}`;
    let message = `${prefix} ${entry.message}`;

    if (entry.correlationId) {
      message += ` [${entry.correlationId}]`;
    }

    if (entry.userId) {
      message += ` (user: ${entry.userId})`;
    }

    if (entry.duration !== undefined) {
      message += ` (${entry.duration}ms)`;
    }

    console.log(message);

    if (entry.metadata && Object.keys(entry.metadata).length > 0) {
      console.log('  Metadata:', entry.metadata);
    }

    if (entry.error && this.config.includeStack) {
      console.log(`  Error: ${entry.error.name}: ${entry.error.message}`);
      if (entry.error.stack) {
        console.log('  Stack:', entry.error.stack);
      }
    }
  }

  /**
   * Log debug message
   */
  debug(message: string, metadata?: Record<string, unknown>): void {
    this.log({ level: 'debug', message, metadata });
  }

  /**
   * Log info message
   */
  info(message: string, metadata?: Record<string, unknown>): void {
    this.log({ level: 'info', message, metadata });
  }

  /**
   * Log warning message
   */
  warn(message: string, metadata?: Record<string, unknown>): void {
    this.log({ level: 'warn', message, metadata });
  }

  /**
   * Log error message
   */
  error(message: string, error?: Error, metadata?: Record<string, unknown>): void {
    this.log({
      level: 'error',
      message,
      error: error ? {
        name: error.name,
        message: error.message,
        stack: this.config.includeStack ? error.stack : undefined,
      } : undefined,
      metadata,
    });
  }

  /**
   * Log fatal message (application should exit)
   */
  fatal(message: string, error?: Error, metadata?: Record<string, unknown>): void {
    this.log({
      level: 'fatal',
      message,
      error: error ? {
        name: error.name,
        message: error.message,
        stack: this.config.includeStack ? error.stack : undefined,
      } : undefined,
      metadata,
    });
  }

  /**
   * Log operation with timing
   */
  async withTiming<T>(
    operation: string,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      const duration = Date.now() - start;
      this.debug(`Operation completed: ${operation}`, { ...metadata, duration });
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      this.error(
        `Operation failed: ${operation}`,
        error instanceof Error ? error : new Error(String(error)),
        { ...metadata, duration }
      );
      throw error;
    }
  }

  /**
   * Log HTTP request
   */
  request(method: string, path: string, userId?: string, metadata?: Record<string, unknown>): void {
    this.info(`HTTP ${method} ${path}`, { userId, ...metadata });
  }

  /**
   * Log HTTP response
   */
  response(method: string, path: string, statusCode: number, duration: number, metadata?: Record<string, unknown>): void {
    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    this.log({
      level,
      message: `HTTP ${method} ${path} ${statusCode}`,
      duration,
      metadata: { statusCode, ...metadata },
    });
  }

  /**
   * Log security event
   */
  security(event: string, metadata?: Record<string, unknown>): void {
    this.warn(`Security: ${event}`, { security: true, ...metadata });
  }

  /**
   * Log audit event
   */
  audit(action: string, resource: string, userId?: string, metadata?: Record<string, unknown>): void {
    this.info(`Audit: ${action} on ${resource}`, {
      audit: true,
      action,
      resource,
      userId,
      ...metadata,
    });
  }
}

/**
 * Child logger with preset metadata
 */
class ChildLogger extends Logger {
  private parent: Logger;
  private presetMetadata: Record<string, unknown>;

  constructor(parent: Logger, metadata: Record<string, unknown>) {
    super();
    this.parent = parent;
    this.presetMetadata = metadata;
  }

  private mergeMetadata(metadata?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!metadata) return this.presetMetadata;
    return { ...this.presetMetadata, ...metadata };
  }

  debug(message: string, metadata?: Record<string, unknown>): void {
    this.parent.debug(message, this.mergeMetadata(metadata));
  }

  info(message: string, metadata?: Record<string, unknown>): void {
    this.parent.info(message, this.mergeMetadata(metadata));
  }

  warn(message: string, metadata?: Record<string, unknown>): void {
    this.parent.warn(message, this.mergeMetadata(metadata));
  }

  error(message: string, error?: Error, metadata?: Record<string, unknown>): void {
    this.parent.error(message, error, this.mergeMetadata(metadata));
  }

  fatal(message: string, error?: Error, metadata?: Record<string, unknown>): void {
    this.parent.fatal(message, error, this.mergeMetadata(metadata));
  }
}

// Export singleton instance
export const logger = new Logger();

/**
 * Create a request-scoped logger
 */
export function createRequestLogger(requestId: string, userId?: string): Logger {
  const requestLogger = new Logger();
  requestLogger.setCorrelationId(requestId);
  return requestLogger;
}
