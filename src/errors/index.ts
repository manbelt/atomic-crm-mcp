/**
 * Custom Error Classes for Atomic CRM MCP Server
 * 
 * Provides structured error handling with error codes, HTTP status codes,
 * and serialization for consistent API responses.
 */

/**
 * Base application error class
 */
export abstract class ApplicationError extends Error {
  public readonly code: string;
  public readonly httpStatus: number;
  public readonly isOperational: boolean;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    httpStatus: number,
    isOperational: boolean = true,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.httpStatus = httpStatus;
    this.isOperational = isOperational;
    this.details = details;

    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
    
    // Capture stack trace (exclude constructor from stack)
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Serialize error for API response
   */
  toJSON(): Record<string, unknown> {
    return {
      error: this.name,
      code: this.code,
      message: this.message,
      ...(this.details && { details: this.details }),
    };
  }
}

/**
 * Validation Error (400 Bad Request)
 */
export class ValidationError extends ApplicationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, true, details);
  }
}

/**
 * Authentication Error (401 Unauthorized)
 */
export class AuthenticationError extends ApplicationError {
  constructor(message: string = 'Authentication required', details?: Record<string, unknown>) {
    super(message, 'AUTHENTICATION_ERROR', 401, true, details);
  }
}

/**
 * Authorization Error (403 Forbidden)
 */
export class AuthorizationError extends ApplicationError {
  constructor(message: string = 'Access denied', details?: Record<string, unknown>) {
    super(message, 'AUTHORIZATION_ERROR', 403, true, details);
  }
}

/**
 * Not Found Error (404 Not Found)
 */
export class NotFoundError extends ApplicationError {
  constructor(resource: string, identifier?: string | number) {
    const message = identifier 
      ? `${resource} with identifier '${identifier}' not found`
      : `${resource} not found`;
    super(message, 'NOT_FOUND', 404, true, { resource, identifier });
  }
}

/**
 * Conflict Error (409 Conflict)
 */
export class ConflictError extends ApplicationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFLICT', 409, true, details);
  }
}

/**
 * Rate Limit Error (429 Too Many Requests)
 */
export class RateLimitError extends ApplicationError {
  public readonly retryAfter?: number;

  constructor(retryAfter?: number) {
    const message = retryAfter 
      ? `Rate limit exceeded. Retry after ${retryAfter} seconds.`
      : 'Rate limit exceeded. Please try again later.';
    super(message, 'RATE_LIMIT_EXCEEDED', 429, true);
    this.retryAfter = retryAfter;
  }

  toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      ...(this.retryAfter && { retryAfter: this.retryAfter }),
    };
  }
}

/**
 * Database Error (500 Internal Server Error)
 */
export class DatabaseError extends ApplicationError {
  constructor(message: string = 'Database operation failed', details?: Record<string, unknown>) {
    super(message, 'DATABASE_ERROR', 500, false, details);
  }
}

/**
 * Configuration Error (500 Internal Server Error)
 */
export class ConfigurationError extends ApplicationError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFIGURATION_ERROR', 500, false, details);
  }
}

/**
 * External Service Error (502 Bad Gateway)
 */
export class ExternalServiceError extends ApplicationError {
  constructor(service: string, message?: string) {
    super(
      message || `External service '${service}' is unavailable`,
      'EXTERNAL_SERVICE_ERROR',
      502,
      false,
      { service }
    );
  }
}

/**
 * Timeout Error (504 Gateway Timeout)
 */
export class TimeoutError extends ApplicationError {
  constructor(operation: string, timeout: number) {
    super(
      `Operation '${operation}' timed out after ${timeout}ms`,
      'TIMEOUT_ERROR',
      504,
      false,
      { operation, timeout }
    );
  }
}

/**
 * Check if error is an operational error (safe to expose to client)
 */
export function isOperationalError(error: Error): boolean {
  if (error instanceof ApplicationError) {
    return error.isOperational;
  }
  return false;
}

/**
 * Convert unknown error to ApplicationError
 */
export function toApplicationError(error: unknown): ApplicationError {
  if (error instanceof ApplicationError) {
    return error;
  }

  if (error instanceof Error) {
    // Check for specific error types
    if (error.name === 'ValidationError') {
      return new ValidationError(error.message);
    }
    if (error.name === 'UnauthorizedError' || error.message.includes('jwt')) {
      return new AuthenticationError(error.message);
    }
    if (error.name === 'ForbiddenError') {
      return new AuthorizationError(error.message);
    }
    if (error.name === 'NotFoundError') {
      return new NotFoundError('Resource');
    }

    // Generic internal error
    return new DatabaseError(error.message);
  }

  return new DatabaseError(String(error));
}

/**
 * Error result type for operations
 */
export interface ErrorResult {
  success: false;
  error: string;
  code?: string;
  details?: Record<string, unknown>;
}

/**
 * Success result type for operations
 */
export interface SuccessResult<T = unknown> {
  success: true;
  data: T;
}

/**
 * Result type for operations that can fail
 */
export type Result<T = unknown> = SuccessResult<T> | ErrorResult;

/**
 * Create an error result
 */
export function errorResult(
  error: string,
  code?: string,
  details?: Record<string, unknown>
): ErrorResult {
  return {
    success: false,
    error,
    code,
    details,
  };
}

/**
 * Create a success result
 */
export function successResult<T>(data: T): SuccessResult<T> {
  return {
    success: true,
    data,
  };
}
