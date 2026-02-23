import type { Request, Response, NextFunction } from "express";

/**
 * Security Middleware
 * 
 * Provides input validation, error sanitization, and security headers
 * to protect against common web vulnerabilities.
 */

/**
 * Security headers middleware
 * Adds security-related headers to all responses
 */
export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  // Prevent clickjacking
  res.setHeader("X-Frame-Options", "DENY");
  
  // Prevent MIME type sniffing
  res.setHeader("X-Content-Type-Options", "nosniff");
  
  // Enable XSS protection in browsers
  res.setHeader("X-XSS-Protection", "1; mode=block");
  
  // Referrer policy
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  
  // Content Security Policy for API
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'"
  );
  
  // Permissions Policy (formerly Feature Policy)
  res.setHeader(
    "Permissions-Policy",
    "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()"
  );
  
  next();
}

/**
 * Input validation middleware
 * Validates request body size and structure
 */
export function validateInput(req: Request, res: Response, next: NextFunction): void {
  // Check content type for POST/PUT/PATCH requests
  if (["POST", "PUT", "PATCH"].includes(req.method)) {
    const contentType = req.headers["content-type"];
    
    if (!contentType || !contentType.includes("application/json")) {
      res.status(415).json({
        error: "Unsupported Media Type",
        message: "Content-Type must be application/json",
      });
      return;
    }
  }
  
  // Validate body size (max 1MB)
  const contentLength = parseInt(req.headers["content-length"] || "0", 10);
  const maxSize = parseInt(process.env.MAX_REQUEST_SIZE || "1048576", 10); // 1MB default
  
  if (contentLength > maxSize) {
    res.status(413).json({
      error: "Payload Too Large",
      message: `Request body exceeds maximum size of ${maxSize} bytes`,
    });
    return;
  }
  
  next();
}

/**
 * Sanitize error messages before sending to client
 * Removes sensitive information from error responses
 */
export function sanitizeError(error: Error): { message: string; code?: string } {
  // List of patterns that might expose sensitive information
  const sensitivePatterns = [
    /password/i,
    /secret/i,
    /key/i,
    /token/i,
    /auth/i,
    /credential/i,
    /connection string/i,
    /database/i,
    /sql/i,
    /jwt/i,
    /private/i,
  ];
  
  // Check if error message contains sensitive information
  const message = error.message || "An unexpected error occurred";
  const containsSensitive = sensitivePatterns.some((pattern) => pattern.test(message));
  
  if (containsSensitive) {
    return {
      message: "An internal error occurred. Please try again later.",
      code: "INTERNAL_ERROR",
    };
  }
  
  // Return sanitized message
  return {
    message: message.slice(0, 500), // Limit message length
    code: (error as any).code || "ERROR",
  };
}

/**
 * Global error handler middleware
 * Catches all errors and returns sanitized responses
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Log error for debugging (in production, use proper logging)
  console.error(`Error processing request to ${req.method} ${req.path}:`, err);
  
  // Handle specific error types
  if (err.name === "SyntaxError" && "body" in err) {
    res.status(400).json({
      error: "Bad Request",
      message: "Invalid JSON in request body",
    });
    return;
  }
  
  if (err.name === "UnauthorizedError" || err.message.includes("jwt")) {
    const sanitized = sanitizeError(err);
    res.status(401).json({
      error: "Unauthorized",
      message: sanitized.message,
    });
    return;
  }
  
  if (err.name === "ForbiddenError" || err.message.includes("permission")) {
    const sanitized = sanitizeError(err);
    res.status(403).json({
      error: "Forbidden",
      message: sanitized.message,
    });
    return;
  }
  
  if (err.name === "NotFoundError") {
    res.status(404).json({
      error: "Not Found",
      message: err.message || "Resource not found",
    });
    return;
  }
  
  if (err.name === "ValidationError") {
    res.status(422).json({
      error: "Validation Error",
      message: err.message,
    });
    return;
  }
  
  // Rate limit errors
  if (err.name === "RateLimitExceeded" || err.message.includes("rate limit")) {
    res.status(429).json({
      error: "Too Many Requests",
      message: "Rate limit exceeded. Please try again later.",
    });
    return;
  }
  
  // Default to 500 Internal Server Error
  const sanitized = sanitizeError(err);
  res.status(500).json({
    error: "Internal Server Error",
    message: sanitized.message,
    code: sanitized.code,
  });
}

/**
 * Request validation schema for MCP requests
 */
export interface McpRequestSchema {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * Validate MCP request structure
 */
export function validateMcpRequest(req: Request, res: Response, next: NextFunction): void {
  const body = req.body as McpRequestSchema;
  
  // Check required fields
  if (!body || typeof body !== "object") {
    res.status(400).json({
      error: "Bad Request",
      message: "Request body must be a JSON object",
    });
    return;
  }
  
  // Validate JSON-RPC version
  if (body.jsonrpc && body.jsonrpc !== "2.0") {
    res.status(400).json({
      error: "Bad Request",
      message: "Unsupported JSON-RPC version. Must be 2.0",
    });
    return;
  }
  
  // Validate method
  if (body.method && typeof body.method !== "string") {
    res.status(400).json({
      error: "Bad Request",
      message: "Method must be a string",
    });
    return;
  }
  
  // Validate params
  if (body.params !== undefined && typeof body.params !== "object") {
    res.status(400).json({
      error: "Bad Request",
      message: "Params must be an object",
    });
    return;
  }
  
  next();
}

/**
 * Request logging middleware
 * Logs all incoming requests for debugging and auditing
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const requestId = crypto.randomUUID().slice(0, 8);
  
  // Log request
  console.log(`[${requestId}] ${req.method} ${req.path}`);
  
  // Log response on finish
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(
      `[${requestId}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`
    );
  });
  
  next();
}

/**
 * Combine all security middleware into a single array
 */
export const securityMiddleware = [
  requestLogger,
  securityHeaders,
  validateInput,
];
