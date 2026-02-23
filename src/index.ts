import express from 'express';
import { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { config } from './config.js';
import { authMiddleware } from './auth/middleware.js';
import wellKnownRouter from './routes/well-known.js';
import { healthRouter } from './routes/health.js';
import { createApiDocsRouter } from './routes/api-docs.js';
import { createMcpServer } from './mcp/server.js';
import { standardRateLimiter, writeRateLimiter, rateLimitConfig } from './middleware/rate-limiter.js';
import { securityMiddleware, errorHandler } from './middleware/security.js';
import { corsMiddleware, requestIdMiddleware } from './middleware/cors.js';
import { csrfMiddleware } from './middleware/csrf.js';
import { initUsageTracker, closeUsageTracker } from './services/usage-tracker.js';
import { initAuditLogger, closeAuditLogger, logAuthEvent, logMcpToolCall } from './services/audit-logger.js';
import { logger } from './services/logger.js';
import { closePool, getPool } from './db/query-builder.js';
import { startPoolMonitoring, collectPoolStats, checkPoolHealth } from './services/pool-monitor.js';
import { initializeCache, shutdownCache, getCache } from './services/cache.js';
import { initializeRequestQueue, getRequestQueue } from './services/request-queue.js';
import { initializeApm, getApm, apmMiddleware } from './services/apm.js';
import { initializeAlerting, getAlerting } from './services/alerting.js';
import type { Request, Response } from 'express';

// Initialize core services
initUsageTracker(config.databaseUrl);
initAuditLogger();

// Initialize APM
initializeApm({
  enabled: process.env.APM_ENABLED !== 'false',
  serviceName: 'atomic-crm-mcp',
  environment: process.env.NODE_ENV || 'development',
  sampleRate: parseFloat(process.env.APM_SAMPLE_RATE || '1.0'),
});

// Initialize alerting
const alerting = initializeAlerting({
  enabled: true,
  throttleMs: 60000,
});

// Initialize request queue
initializeRequestQueue({
  maxConcurrent: parseInt(process.env.QUEUE_MAX_CONCURRENT || '10'),
  maxQueueSize: parseInt(process.env.QUEUE_MAX_SIZE || '1000'),
  timeoutMs: parseInt(process.env.QUEUE_TIMEOUT || '30000'),
});

const app = express();

// Apply request ID middleware first for tracing
app.use(requestIdMiddleware);

// Apply CORS middleware
app.use(corsMiddleware);

// Apply APM middleware for request tracking
app.use(apmMiddleware);

// Apply security middleware (headers, input validation, logging)
app.use(securityMiddleware);

// Parse JSON bodies
app.use(express.json());

// Health check endpoints (no rate limiting, no auth required)
app.use('/health', healthRouter);

// API documentation (Swagger UI)
app.use('/api-docs', createApiDocsRouter());

// Apply standard rate limiter to all other routes
app.use(standardRateLimiter);

// Apply CSRF protection for non-MCP routes
app.use(csrfMiddleware);

// Well-known endpoints for OAuth discovery
app.use('/.well-known', wellKnownRouter);

// Session storage for MCP transports
const transports: Map<string, { transport: StreamableHTTPServerTransport; userToken: string }> = new Map();

// MCP endpoint with authentication
app.all('/mcp', authMiddleware, async (req: Request, res: Response) => {
  const startTime = Date.now();
  const apm = getApm();

  if (!req.auth) {
    logAuthEvent('AUTH_FAILED_LOGIN', undefined, false, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      errorMessage: 'No auth provided',
    });
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  // Log successful authentication
  logAuthEvent('AUTH_TOKEN_REFRESH', req.auth.userId, true, {
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  const authHeader = req.headers.authorization;
  const userToken = authHeader?.substring(7) || '';

  let transportInfo = sessionId ? transports.get(sessionId) : undefined;

  if (!transportInfo) {
    const server = createMcpServer({
      authInfo: req.auth,
      userToken,
    });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });

    await server.connect(transport);

    transportInfo = { transport, userToken };
  }

  try {
    const nodeReq = req as unknown as IncomingMessage;
    const nodeRes = res as unknown as ServerResponse;

    await transportInfo.transport.handleRequest(nodeReq, nodeRes, req.body);

    // Store transport after first request when session ID is generated
    if (transportInfo.transport.sessionId && !sessionId) {
      transports.set(transportInfo.transport.sessionId, transportInfo);
      logger.info('MCP session created', { sessionId: transportInfo.transport.sessionId });
    }

    // Log MCP tool call
    const duration = Date.now() - startTime;
    if (req.body?.method && req.body.method !== 'initialize') {
      logMcpToolCall(req.body.method, req.auth.userId, true, {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        duration,
      });
    }
  } catch (error) {
    logger.error('Error handling MCP request', error instanceof Error ? error : new Error(String(error)));
    logMcpToolCall('unknown', req.auth?.userId || 'unknown', false, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// MCP session termination
app.delete('/mcp', async (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string;

  if (sessionId && transports.has(sessionId)) {
    const transportInfo = transports.get(sessionId)!;
    await transportInfo.transport.close();
    transports.delete(sessionId);
    logger.info('MCP session terminated', { sessionId });
  }

  res.status(200).json({ message: 'Session terminated' });
});

// Apply global error handler (must be last)
app.use(errorHandler);

// Start server
const server = app.listen(config.port, () => {
  logger.info(`MCP Server started`, {
    port: config.port,
    url: config.mcpServerUrl,
    protectedResource: `${config.mcpServerUrl}/.well-known/oauth-protected-resource`,
    authUrl: config.supabase.authUrl,
    rateLimit: `${rateLimitConfig.maxRequests} requests per ${rateLimitConfig.windowMinutes} minutes`,
  });
  
  console.log(`MCP Server running on ${config.mcpServerUrl}`);
  console.log(`Protected Resource Metadata: ${config.mcpServerUrl}/.well-known/oauth-protected-resource`);
  console.log(`Supabase Auth URL: ${config.supabase.authUrl}`);
  console.log(`Rate Limiting: ${rateLimitConfig.maxRequests} requests per ${rateLimitConfig.windowMinutes} minutes`);
  console.log(`Usage Tracking: Enabled`);
  console.log(`Audit Logging: Enabled`);
  console.log(`Health Check: ${config.mcpServerUrl}/health`);
  console.log(`API Documentation: ${config.mcpServerUrl}/api-docs`);
  console.log(`APM: Enabled`);
  console.log(`Alerting: Enabled`);

  // Start pool monitoring
  try {
    const pool = getPool();
    const poolMonitorInterval = startPoolMonitoring(
      pool,
      parseInt(process.env.DB_POOL_MAX || '10') * 2, // Monitor interval
      parseInt(process.env.DB_POOL_MAX || '10')
    );
    logger.info('Database pool monitoring started');
  } catch (error) {
    logger.warn('Could not start pool monitoring', { error: error instanceof Error ? error.message : String(error) });
  }

  // Initialize Redis cache if configured
  if (process.env.REDIS_URL) {
    initializeCache(process.env.REDIS_URL, {
      enabled: true,
      defaultTtl: 300,
    })
      .then(() => logger.info('Redis cache connected'))
      .catch((error) => logger.warn('Redis cache connection failed', { error: error instanceof Error ? error.message : String(error) }));
  }
});

// Graceful shutdown
async function shutdown(signal: string) {
  logger.info(`Received ${signal}, starting graceful shutdown...`);
  console.log(`${signal} received, closing server...`);

  // Close all MCP transports
  for (const [sessionId, transportInfo] of transports.entries()) {
    try {
      await transportInfo.transport.close();
      logger.debug('Transport closed', { sessionId });
    } catch (error) {
      logger.error('Error closing transport', error instanceof Error ? error : new Error(String(error)));
    }
  }
  transports.clear();

  // Close service connections
  await closeUsageTracker();
  await closeAuditLogger();
  await closePool();
  await shutdownCache();

  // Close HTTP server
  server.close(() => {
    logger.info('Server closed, exiting');
    console.log('Server closed');
    process.exit(0);
  });

  // Force exit after timeout
  setTimeout(() => {
    logger.warn('Forced shutdown after timeout');
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.fatal('Uncaught exception', error);
  console.error('Uncaught exception:', error);
  shutdown('uncaughtException');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.fatal('Unhandled promise rejection', reason instanceof Error ? reason : new Error(String(reason)));
  console.error('Unhandled promise rejection:', reason);
});
