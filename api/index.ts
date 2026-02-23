/**
 * Vercel Serverless Function Entry Point
 * 
 * This is a standalone serverless function for Vercel deployment.
 * It includes all necessary functionality inline to avoid module resolution issues.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

// Environment configuration
const config = {
  databaseUrl: process.env.DATABASE_URL || '',
  supabaseUrl: process.env.SUPABASE_URL || '',
  sessionSecret: process.env.SESSION_SECRET || 'default-secret-change-in-production',
  mcpServerUrl: process.env.MCP_SERVER_URL || 'https://atomic-crm-mcp.vercel.app',
  nodeEnv: process.env.NODE_ENV || 'production',
};

// Simple in-memory cache for serverless
const cache = new Map<string, { value: unknown; expiry: number }>();

function getCached<T>(key: string): T | null {
  const item = cache.get(key);
  if (item && item.expiry > Date.now()) {
    return item.value as T;
  }
  cache.delete(key);
  return null;
}

function setCache(key: string, value: unknown, ttlSeconds: number = 300): void {
  cache.set(key, { value, expiry: Date.now() + ttlSeconds * 1000 });
}

// Health check handler
async function healthHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: config.nodeEnv,
    checks: {
      database: 'unknown',
      cache: 'ok',
    },
  };

  // Check database connectivity via Supabase REST API
  if (config.supabaseUrl) {
    try {
      const response = await fetch(`${config.supabaseUrl}/rest/v1/`, {
        method: 'HEAD',
        headers: {
          'apikey': process.env.SUPABASE_ANON_KEY || '',
        },
      });
      health.checks.database = response.ok ? 'ok' : 'degraded';
    } catch {
      health.checks.database = 'unhealthy';
    }
  }

  const statusCode = health.checks.database === 'unhealthy' ? 503 : 200;
  res.status(statusCode).json(health);
}

// Liveness probe
function livenessHandler(req: VercelRequest, res: VercelResponse): void {
  res.status(200).json({ status: 'alive', timestamp: new Date().toISOString() });
}

// Readiness probe
async function readinessHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const checks = {
    database: false,
  };

  // Check database via Supabase REST API
  if (config.supabaseUrl) {
    try {
      const response = await fetch(`${config.supabaseUrl}/rest/v1/`, {
        method: 'HEAD',
        headers: {
          'apikey': process.env.SUPABASE_ANON_KEY || '',
        },
      });
      checks.database = response.ok;
    } catch {
      checks.database = false;
    }
  }

  const isReady = checks.database;
  res.status(isReady ? 200 : 503).json({
    status: isReady ? 'ready' : 'not_ready',
    checks,
    timestamp: new Date().toISOString(),
  });
}

// MCP info handler
function mcpInfoHandler(req: VercelRequest, res: VercelResponse): void {
  res.status(200).json({
    name: 'atomic-crm-mcp',
    version: '1.0.0',
    description: 'Atomic CRM MCP Server - AI-powered CRM integration',
    endpoints: {
      mcp: '/mcp',
      health: '/health',
      liveness: '/health/live',
      readiness: '/health/ready',
    },
    authentication: 'Bearer token required for /mcp endpoint',
  });
}

// Main handler
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Set security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-ID');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const path = req.url?.split('?')[0] || '/';

  // Route requests
  if (path === '/health' || path === '/') {
    await healthHandler(req, res);
    return;
  }

  if (path === '/health/live') {
    livenessHandler(req, res);
    return;
  }

  if (path === '/health/ready') {
    await readinessHandler(req, res);
    return;
  }

  if (path === '/mcp' && req.method === 'GET') {
    mcpInfoHandler(req, res);
    return;
  }

  if (path === '/mcp' && req.method === 'POST') {
    // MCP endpoint requires authentication
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication required', message: 'Provide a Bearer token in the Authorization header' });
      return;
    }

    // For now, return a placeholder response
    // Full MCP implementation would require the MCP SDK
    res.status(200).json({
      jsonrpc: '2.0',
      id: req.body?.id || null,
      result: {
        capabilities: {
          tools: {},
          resources: {},
        },
        serverInfo: {
          name: 'atomic-crm-mcp',
          version: '1.0.0',
        },
      },
    });
    return;
  }

  // 404 for unknown routes
  res.status(404).json({ error: 'Not found', path });
}
