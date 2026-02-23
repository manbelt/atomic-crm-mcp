import { describe, it, expect } from "vitest";
import {
  ApplicationError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  DatabaseError,
  ConfigurationError,
  ExternalServiceError,
  TimeoutError,
  isOperationalError,
  toApplicationError,
  errorResult,
  successResult,
} from "../errors/index.js";

describe("Error Classes", () => {
  describe("ApplicationError", () => {
    it("should create error with all properties", () => {
      class TestError extends ApplicationError {
        constructor() {
          super("Test message", "TEST_ERROR", 400, true, { key: "value" });
        }
      }

      const error = new TestError();

      expect(error.message).toBe("Test message");
      expect(error.code).toBe("TEST_ERROR");
      expect(error.httpStatus).toBe(400);
      expect(error.isOperational).toBe(true);
      expect(error.details).toEqual({ key: "value" });
      expect(error.name).toBe("TestError");
    });

    it("should serialize to JSON correctly", () => {
      class TestError extends ApplicationError {
        constructor() {
          super("Test message", "TEST_ERROR", 400, true, { key: "value" });
        }
      }

      const error = new TestError();
      const json = error.toJSON();

      expect(json).toEqual({
        error: "TestError",
        code: "TEST_ERROR",
        message: "Test message",
        details: { key: "value" },
      });
    });
  });

  describe("ValidationError", () => {
    it("should create validation error with correct properties", () => {
      const error = new ValidationError("Invalid input", { field: "email" });

      expect(error.message).toBe("Invalid input");
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.httpStatus).toBe(400);
      expect(error.isOperational).toBe(true);
      expect(error.details).toEqual({ field: "email" });
    });
  });

  describe("AuthenticationError", () => {
    it("should create with default message", () => {
      const error = new AuthenticationError();

      expect(error.message).toBe("Authentication required");
      expect(error.code).toBe("AUTHENTICATION_ERROR");
      expect(error.httpStatus).toBe(401);
    });

    it("should create with custom message", () => {
      const error = new AuthenticationError("Token expired");

      expect(error.message).toBe("Token expired");
    });
  });

  describe("AuthorizationError", () => {
    it("should create with default message", () => {
      const error = new AuthorizationError();

      expect(error.message).toBe("Access denied");
      expect(error.code).toBe("AUTHORIZATION_ERROR");
      expect(error.httpStatus).toBe(403);
    });
  });

  describe("NotFoundError", () => {
    it("should create with resource name only", () => {
      const error = new NotFoundError("Contact");

      expect(error.message).toBe("Contact not found");
      expect(error.code).toBe("NOT_FOUND");
      expect(error.httpStatus).toBe(404);
      expect(error.details).toEqual({ resource: "Contact", identifier: undefined });
    });

    it("should create with resource and identifier", () => {
      const error = new NotFoundError("Contact", 123);

      expect(error.message).toBe("Contact with identifier '123' not found");
      expect(error.details).toEqual({ resource: "Contact", identifier: 123 });
    });
  });

  describe("ConflictError", () => {
    it("should create conflict error", () => {
      const error = new ConflictError("Email already exists", { email: "test@example.com" });

      expect(error.message).toBe("Email already exists");
      expect(error.code).toBe("CONFLICT");
      expect(error.httpStatus).toBe(409);
    });
  });

  describe("RateLimitError", () => {
    it("should create without retry after", () => {
      const error = new RateLimitError();

      expect(error.message).toBe("Rate limit exceeded. Please try again later.");
      expect(error.code).toBe("RATE_LIMIT_EXCEEDED");
      expect(error.httpStatus).toBe(429);
    });

    it("should create with retry after", () => {
      const error = new RateLimitError(60);

      expect(error.message).toBe("Rate limit exceeded. Retry after 60 seconds.");
      expect(error.retryAfter).toBe(60);
      expect(error.toJSON()).toHaveProperty("retryAfter", 60);
    });
  });

  describe("DatabaseError", () => {
    it("should create with default message", () => {
      const error = new DatabaseError();

      expect(error.message).toBe("Database operation failed");
      expect(error.code).toBe("DATABASE_ERROR");
      expect(error.httpStatus).toBe(500);
      expect(error.isOperational).toBe(false);
    });
  });

  describe("ExternalServiceError", () => {
    it("should create with service name", () => {
      const error = new ExternalServiceError("Stripe");

      expect(error.message).toBe("External service 'Stripe' is unavailable");
      expect(error.code).toBe("EXTERNAL_SERVICE_ERROR");
      expect(error.httpStatus).toBe(502);
      expect(error.details).toEqual({ service: "Stripe" });
    });
  });

  describe("TimeoutError", () => {
    it("should create with operation and timeout", () => {
      const error = new TimeoutError("query", 5000);

      expect(error.message).toBe("Operation 'query' timed out after 5000ms");
      expect(error.code).toBe("TIMEOUT_ERROR");
      expect(error.httpStatus).toBe(504);
      expect(error.details).toEqual({ operation: "query", timeout: 5000 });
    });
  });
});

describe("Error Utilities", () => {
  describe("isOperationalError", () => {
    it("should return true for operational errors", () => {
      expect(isOperationalError(new ValidationError("test"))).toBe(true);
      expect(isOperationalError(new AuthenticationError())).toBe(true);
      expect(isOperationalError(new NotFoundError("Resource"))).toBe(true);
    });

    it("should return false for non-operational errors", () => {
      expect(isOperationalError(new DatabaseError())).toBe(false);
      expect(isOperationalError(new Error("test"))).toBe(false);
    });
  });

  describe("toApplicationError", () => {
    it("should return ApplicationError as-is", () => {
      const error = new ValidationError("test");
      const result = toApplicationError(error);

      expect(result).toBe(error);
    });

    it("should convert generic Error to DatabaseError", () => {
      const error = new Error("Something went wrong");
      const result = toApplicationError(error);

      expect(result).toBeInstanceOf(DatabaseError);
      expect(result.message).toBe("Something went wrong");
    });

    it("should convert non-Error to DatabaseError", () => {
      const result = toApplicationError("string error");

      expect(result).toBeInstanceOf(DatabaseError);
      expect(result.message).toBe("string error");
    });
  });

  describe("Result types", () => {
    it("should create error result", () => {
      const result = errorResult("Something failed", "ERROR_CODE", { detail: "info" });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Something failed");
      expect(result.code).toBe("ERROR_CODE");
      expect(result.details).toEqual({ detail: "info" });
    });

    it("should create success result", () => {
      const result = successResult({ id: 1, name: "test" });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ id: 1, name: "test" });
    });
  });
});
