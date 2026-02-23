import rateLimit from "express-rate-limit";
import type { Request, Response } from "express";

/**
 * Rate limiter configuration for MCP server
 * 
 * Provides protection against abuse by limiting the number of requests
 * per IP address within a time window.
 */

// Rate limit window in minutes
const RATE_LIMIT_WINDOW_MINUTES = parseInt(
  process.env.RATE_LIMIT_WINDOW_MINUTES || "15",
  10
);

// Maximum requests per window per IP
const RATE_LIMIT_MAX_REQUESTS = parseInt(
  process.env.RATE_LIMIT_MAX_REQUESTS || "100",
  10
);

// Skip rate limiting for certain conditions
const skipRateLimit = (req: Request): boolean => {
  // Skip in development mode if configured
  if (process.env.NODE_ENV === "development" && process.env.SKIP_RATE_LIMIT === "true") {
    return true;
  }
  
  // Skip for health check endpoints
  if (req.path === "/health" || req.path === "/.well-known/*") {
    return true;
  }
  
  return false;
};

// Custom handler for when rate limit is exceeded
const rateLimitExceededHandler = (req: Request, res: Response): void => {
  res.status(429).json({
    error: "Too Many Requests",
    message: `Rate limit exceeded. Maximum ${RATE_LIMIT_MAX_REQUESTS} requests per ${RATE_LIMIT_WINDOW_MINUTES} minutes.`,
    retryAfter: res.getHeader("Retry-After"),
  });
};

// Key generator for rate limiting
// Uses X-Forwarded-For header if behind a proxy, otherwise falls back to IP
const keyGenerator = (req: Request): string => {
  const forwarded = req.headers["x-forwarded-for"];
  
  if (typeof forwarded === "string") {
    // Take the first IP in the chain (original client IP)
    return forwarded.split(",")[0].trim();
  }
  
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0].trim();
  }
  
  // Fall back to socket address
  return req.ip || req.socket.remoteAddress || "unknown";
};

// Standard rate limiter for general API endpoints
export const standardRateLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  max: RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true, // Return rate limit info in RateLimit-* headers
  legacyHeaders: false, // Disable X-RateLimit-* headers
  skip: skipRateLimit,
  handler: rateLimitExceededHandler,
  keyGenerator,
  message: {
    error: "Too Many Requests",
    message: `Rate limit exceeded. Maximum ${RATE_LIMIT_MAX_REQUESTS} requests per ${RATE_LIMIT_WINDOW_MINUTES} minutes.`,
  },
});

// Stricter rate limiter for write operations (POST, PUT, DELETE)
export const writeRateLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  max: Math.floor(RATE_LIMIT_MAX_REQUESTS / 4), // 1/4 of standard limit
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipRateLimit,
  handler: rateLimitExceededHandler,
  keyGenerator,
  message: {
    error: "Too Many Requests",
    message: `Write rate limit exceeded. Maximum ${Math.floor(RATE_LIMIT_MAX_REQUESTS / 4)} write operations per ${RATE_LIMIT_WINDOW_MINUTES} minutes.`,
  },
});

// Very strict rate limiter for authentication endpoints
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Only 10 auth attempts per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipRateLimit,
  handler: rateLimitExceededHandler,
  keyGenerator,
  message: {
    error: "Too Many Requests",
    message: "Too many authentication attempts. Please try again later.",
  },
});

// Export configuration for documentation
export const rateLimitConfig = {
  windowMinutes: RATE_LIMIT_WINDOW_MINUTES,
  maxRequests: RATE_LIMIT_MAX_REQUESTS,
  writeMaxRequests: Math.floor(RATE_LIMIT_MAX_REQUESTS / 4),
  authMaxRequests: 10,
};
