/**
 * Vercel Serverless Function Entry Point
 * 
 * This file exports the Express app as a Vercel serverless function.
 * It handles serverless-specific concerns like:
 * - Connection pooling for PostgreSQL (using Supabase connection pooler)
 * - Redis for serverless (Upstash or similar HTTP-based Redis)
 * - Stateless session management
 */

import {
  IncomingMessage,
  ServerResponse,
} from 'node:http';
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { config } from '../src/config.js';
import { authMiddleware } from '../src/auth/middleware.js';
import wellKnownRouter from '../src/routes/well-known.js';
import { healthRouter } from '../src/routes/health.js';
import { createApiDocsRouter } from '../src/routes/api-docs.js';
import { createMcpServer } from '../src/mcp/server.js';
import { standardRateLimiter } from '../src/middleware/rate-limiter.js';
import { securityMiddleware, errorHandler } from '../src/middleware/security.js';
import { corsMiddleware, requestIdMiddleware } from '../src/middleware/cors.js';
import { csrfMiddleware } from '../src/middleware/csrf.js';
import { initUsageTracker } from '../src/services/usage-tracker.js';
import { initAuditLogger, logAuthEvent, logMcpToolCall } from '../src/services/audit-logger.js';
import { logger } from '../src/services/logger.js';
import { initializeCache } from '../src/services/cache.js';
import { initializeRequestQueue } from '../src/services/request-queue.js';
import { initializeApm, apmMiddleware } from '../src/services/apm.js';
import { initializeAlerting } from '../src/services/alerting.js';

// Track initialization state
let isInitialized = false;

// Session storage for MCP transports (in-memory, will be reset on cold starts)
const transports: Map<string, { transport: StreamableHTTPServerTransport; userToken: string }> = new Map();

/**
 * Initialize services once (singleton pattern for serverless)
 */
function initializeServices() {
  if (isInitialized) return;
  
  // Initialize core services
  initUsageTracker(config.databaseUrl);
  initAuditLogger();

  // Initialize APM
  initializeApm({
    enabled: process.env.APM_ENABLED !== 'false',
    serviceName: 'atomic-crm-mcp',
    environment: process.env.NODE_ENV || 'production',
    sampleRate: parseFloat(process.env.APM_SAMPLE_RATE || '1.0'),
  });

  // Initialize alerting
  initializeAlerting({
    enabled: true,
    throttleMs: 60000,
  });

  // Initialize request queue
  initializeRequestQueue({
    maxConcurrent: parseInt(process.env.QUEUE_MAX_CONCURRENT || '10'),
    maxQueueSize: parseInt(process.env.QUEUE_MAX_SIZE || '1000'),
    timeoutMs: parseInt(process.env.QUEUE_TIMEOUT || '30000'),
  });

  // Initialize Redis cache if configured (use Upstash for serverless)
  if (process.env.REDIS_URL) {
    initializeCache(process.env.REDIS_URL, {
      enabled: true,
      defaultTtl: 300,
    }).catch((error) => {
      logger.warn('Redis cache connection failed', { error: error instanceof Error ? error.message : String(error) });
    });
  }

  isInitialized = true;
  logger.info('Serverless services initialized');
}

/**
 * Create and configure the Express app
 */
function createApp(): express.Application {
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

  // MCP endpoint with authentication
  app.all('/mcp', authMiddleware, async (req, res) => {
    const startTime = Date.now();

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
  app.delete('/mcp', async (req, res) => {
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

  return app;
}

// Initialize services on module load
initializeServices();

// Create the Express app
const app = createApp();

/**
 * Vercel serverless function handler
 * 
 * This exports the Express app as a Vercel serverless function.
 * Vercel will automatically handle the request/response cycle.
 * 
 * @param req - Vercel request object (extends Node.js IncomingMessage)
 * @param res - Vercel response object (extends Node.js ServerResponse)
 */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  return new Promise<void>((resolve, reject) => {
    // Add Express-compatible properties to the request
    const expressReq = Object.assign(req, {
      ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      protocol: req.headers['x-forwarded-proto'] || 'https',
      secure: req.headers['x-forwarded-proto'] === 'https',
      originalUrl: req.url,
    });

    // Handle the request with Express
    // The third argument is the 'next' function that Express calls when middleware is done
    app(expressReq as unknown as express.Request, res as unknown as express.Response, (err?: unknown) => {
      if (err) {
        logger.error('Error in Vercel handler', err instanceof Error ? err : new Error(String(err)));
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
        reject(err);
      } else {
        resolve();
      }
    });
  });
}
