import type { Request, Response, NextFunction } from "express";

/**
 * CORS Middleware
 * 
 * Configures Cross-Origin Resource Sharing for the MCP server.
 * Allows authorized origins to make requests to the API.
 */

// Allowed origins (configure via environment variable)
const getAllowedOrigins = (): string[] => {
  const envOrigins = process.env.ALLOWED_ORIGINS || "";
  
  // Default localhost origins for development
  const defaultOrigins = [
    "http://localhost:3000",
    "http://localhost:5173", // Vite dev server
    "http://localhost:4173", // Vite preview
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
  ];
  
  // Parse environment origins (comma-separated)
  const envOriginList = envOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  
  // In production, only use configured origins
  if (process.env.NODE_ENV === "production") {
    return envOriginList.length > 0 ? envOriginList : [];
  }
  
  // In development, include default localhost origins
  return [...new Set([...defaultOrigins, ...envOriginList])];
};

/**
 * CORS middleware handler
 */
export function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  const allowedOrigins = getAllowedOrigins();
  
  // Check if origin is allowed
  const isAllowed = origin && (
    allowedOrigins.includes(origin) ||
    // Allow same-origin requests (no origin header)
    !origin
  );
  
  if (origin && isAllowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else if (allowedOrigins.length > 0 && !origin) {
    // For same-origin requests, allow the first configured origin
    res.setHeader("Access-Control-Allow-Origin", allowedOrigins[0]);
  }
  
  // Allow credentials (cookies, authorization headers)
  res.setHeader("Access-Control-Allow-Credentials", "true");
  
  // Allowed methods
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS"
  );
  
  // Allowed headers
  res.setHeader(
    "Access-Control-Allow-Headers",
    [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
      "Origin",
      "mcp-session-id",
      "X-Request-Id",
    ].join(", ")
  );
  
  // Expose headers to client
  res.setHeader(
    "Access-Control-Expose-Headers",
    [
      "X-Request-Id",
      "X-RateLimit-Limit",
      "X-RateLimit-Remaining",
      "X-RateLimit-Reset",
    ].join(", ")
  );
  
  // Cache preflight response for 1 hour
  res.setHeader("Access-Control-Max-Age", "3600");
  
  // Handle preflight requests
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  
  next();
}

/**
 * Request ID middleware
 * Adds a unique identifier to each request for tracing
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Use existing request ID from header or generate new one
  const existingId = req.headers["x-request-id"] as string | undefined;
  const requestId = existingId || crypto.randomUUID();
  
  // Set on request for use in handlers
  (req as any).requestId = requestId;
  
  // Set on response header
  res.setHeader("X-Request-Id", requestId);
  
  next();
}

/**
 * Get request ID from request object
 */
export function getRequestId(req: Request): string | undefined {
  return (req as any).requestId;
}
