import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";

/**
 * CSRF Protection Middleware
 * 
 * Implements double-submit cookie pattern for stateless CSRF protection.
 * This is suitable for APIs that don't use server-side sessions.
 */

/**
 * CSRF token configuration
 */
const CSRF_TOKEN_LENGTH = 32;
const CSRF_HEADER_NAME = "x-csrf-token";
const CSRF_COOKIE_NAME = "csrf_token";
const CSRF_COOKIE_OPTIONS = {
  httpOnly: false, // Must be accessible to JavaScript
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
  maxAge: 60 * 60 * 1000, // 1 hour
};

/**
 * Generate a cryptographically secure CSRF token
 */
export function generateCsrfToken(): string {
  return crypto.randomBytes(CSRF_TOKEN_LENGTH).toString("hex");
}

/**
 * Hash a token for comparison (prevents timing attacks)
 */
function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Set CSRF token cookie and header
 * Call this for GET requests that will lead to state-changing operations
 */
export function setCsrfToken(req: Request, res: Response, next: NextFunction): void {
  const token = generateCsrfToken();
  
  // Set cookie
  res.cookie(CSRF_COOKIE_NAME, token, CSRF_COOKIE_OPTIONS);
  
  // Also set as header for API clients
  res.setHeader("X-CSRF-Token", token);
  
  // Store in locals for potential use
  res.locals.csrfToken = token;
  
  next();
}

/**
 * Validate CSRF token for state-changing requests
 * Requires the client to send the token in a header matching the cookie
 */
export function validateCsrfToken(req: Request, res: Response, next: NextFunction): void {
  // Skip CSRF for safe methods
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  // Skip CSRF for MCP endpoints (they use Bearer token auth)
  if (req.path.startsWith("/mcp") || req.path.startsWith("/.well-known")) {
    return next();
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = req.headers[CSRF_HEADER_NAME];

  // Check if tokens exist
  if (!cookieToken || !headerToken) {
    res.status(403).json({
      error: "CSRF Token Missing",
      message: "CSRF token is required for this request",
      code: "CSRF_TOKEN_MISSING",
    });
    return;
  }

  // Validate token format (must be hex string of correct length)
  const tokenRegex = /^[a-f0-9]{64}$/;
  if (!tokenRegex.test(cookieToken) || !tokenRegex.test(headerToken as string)) {
    res.status(403).json({
      error: "CSRF Token Invalid",
      message: "CSRF token has invalid format",
      code: "CSRF_TOKEN_INVALID",
    });
    return;
  }

  // Compare tokens using constant-time comparison
  // Use hashed comparison to prevent timing attacks
  const cookieHash = hashToken(cookieToken);
  const headerHash = hashToken(headerToken as string);

  if (!crypto.timingSafeEqual(Buffer.from(cookieHash), Buffer.from(headerHash))) {
    res.status(403).json({
      error: "CSRF Token Mismatch",
      message: "CSRF token does not match",
      code: "CSRF_TOKEN_MISMATCH",
    });
    return;
  }

  next();
}

/**
 * Combined CSRF middleware that sets and validates tokens
 */
export function csrfMiddleware(req: Request, res: Response, next: NextFunction): void {
  // For safe methods, set the token
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return setCsrfToken(req, res, next);
  }

  // For unsafe methods, validate the token
  return validateCsrfToken(req, res, next);
}

/**
 * Optional: Origin-based CSRF protection for APIs
 * Validates that the Origin or Referer header matches allowed origins
 */
export function originCheck(req: Request, res: Response, next: NextFunction): void {
  // Skip for safe methods
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  const origin = req.headers.origin || req.headers.referer;
  
  if (!origin) {
    // Some browsers don't send Origin for same-origin requests
    // This is acceptable for same-origin scenarios
    return next();
  }

  try {
    const originUrl = new URL(origin);
    const allowedOrigins = getAllowedOrigins();

    // Check if origin is allowed
    const isAllowed = allowedOrigins.some(
      (allowed) => allowed === originUrl.origin || allowed === originUrl.hostname
    );

    if (!isAllowed) {
      res.status(403).json({
        error: "Origin Not Allowed",
        message: "Request origin is not allowed",
        code: "ORIGIN_NOT_ALLOWED",
      });
      return;
    }
  } catch {
    res.status(403).json({
      error: "Invalid Origin",
      message: "Request has invalid origin header",
      code: "INVALID_ORIGIN",
    });
    return;
  }

  next();
}

/**
 * Get allowed origins from environment
 */
function getAllowedOrigins(): string[] {
  const envOrigins = process.env.ALLOWED_ORIGINS || "";
  
  const defaultOrigins = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:4173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
  ];

  const envOriginList = envOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  if (process.env.NODE_ENV === "production") {
    return envOriginList.length > 0 ? envOriginList : [];
  }

  return [...new Set([...defaultOrigins, ...envOriginList])];
}

/**
 * Export configuration for documentation
 */
export const csrfConfig = {
  headerName: CSRF_HEADER_NAME,
  cookieName: CSRF_COOKIE_NAME,
  cookieOptions: CSRF_COOKIE_OPTIONS,
};
