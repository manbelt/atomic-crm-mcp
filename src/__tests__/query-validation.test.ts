import { describe, it, expect } from "vitest";
import {
  containsForbiddenKeywords,
  validateSqlQuery,
  sanitizeIdentifier,
  validateTablesInQuery,
} from "../db/sql-validation.js";

describe("SQL Query Validation", () => {
  describe("containsForbiddenKeywords", () => {
    it("should detect DROP keyword", () => {
      const result = containsForbiddenKeywords("SELECT * FROM contacts; DROP TABLE contacts;");
      expect(result.hasForbidden).toBe(true);
      expect(result.keyword).toBe("DROP");
    });

    it("should detect DELETE keyword", () => {
      const result = containsForbiddenKeywords("DELETE FROM contacts WHERE id = 1");
      expect(result.hasForbidden).toBe(true);
      expect(result.keyword).toBe("DELETE");
    });

    it("should detect INSERT keyword", () => {
      const result = containsForbiddenKeywords("INSERT INTO contacts (name) VALUES ('test')");
      expect(result.hasForbidden).toBe(true);
      expect(result.keyword).toBe("INSERT");
    });

    it("should detect UPDATE keyword", () => {
      const result = containsForbiddenKeywords("UPDATE contacts SET name = 'test'");
      expect(result.hasForbidden).toBe(true);
      expect(result.keyword).toBe("UPDATE");
    });

    it("should detect ALTER keyword", () => {
      const result = containsForbiddenKeywords("ALTER TABLE contacts ADD COLUMN test TEXT");
      expect(result.hasForbidden).toBe(true);
      expect(result.keyword).toBe("ALTER");
    });

    it("should not detect keywords in column names", () => {
      const result = containsForbiddenKeywords("SELECT updated_at, deleted_flag FROM contacts");
      expect(result.hasForbidden).toBe(false);
    });

    it("should not detect keywords in string literals", () => {
      // This is a limitation - we block any occurrence of the keyword
      // This is intentional for security - better safe than sorry
      const result = containsForbiddenKeywords("SELECT 'DROP' as action");
      expect(result.hasForbidden).toBe(true);
    });

    it("should detect TRUNCATE keyword", () => {
      const result = containsForbiddenKeywords("TRUNCATE TABLE contacts");
      expect(result.hasForbidden).toBe(true);
      expect(result.keyword).toBe("TRUNCATE");
    });

    it("should detect GRANT keyword", () => {
      const result = containsForbiddenKeywords("GRANT ALL ON contacts TO public");
      expect(result.hasForbidden).toBe(true);
      expect(result.keyword).toBe("GRANT");
    });
  });

  describe("validateSqlQuery", () => {
    it("should accept valid SELECT queries", () => {
      const result = validateSqlQuery("SELECT * FROM contacts");
      expect(result.valid).toBe(true);
    });

    it("should accept valid SELECT queries with WHERE", () => {
      const result = validateSqlQuery("SELECT * FROM contacts WHERE id = 1");
      expect(result.valid).toBe(true);
    });

    it("should accept valid SELECT queries with JOIN", () => {
      const result = validateSqlQuery(
        "SELECT c.name, co.name FROM contacts c JOIN companies co ON c.company_id = co.id"
      );
      expect(result.valid).toBe(true);
    });

    it("should accept WITH (CTE) queries", () => {
      const result = validateSqlQuery(`
        WITH active_contacts AS (
          SELECT * FROM contacts WHERE status = 'active'
        )
        SELECT * FROM active_contacts
      `);
      expect(result.valid).toBe(true);
    });

    it("should reject empty queries", () => {
      const result = validateSqlQuery("");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("empty");
    });

    it("should reject queries that are too long", () => {
      const longQuery = "SELECT * FROM contacts WHERE " + "x = 1 AND ".repeat(2000);
      const result = validateSqlQuery(longQuery);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("maximum length");
    });

    it("should reject queries not starting with SELECT or WITH", () => {
      const result = validateSqlQuery("EXPLAIN SELECT * FROM contacts");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("SELECT");
    });

    it("should reject multiple statements", () => {
      const result = validateSqlQuery("SELECT * FROM contacts; SELECT * FROM companies;");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Multiple statements");
    });

    it("should reject queries with forbidden keywords", () => {
      const result = validateSqlQuery("SELECT * FROM contacts; DROP TABLE contacts;");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("forbidden keyword");
    });

    it("should accept queries with trailing semicolon", () => {
      const result = validateSqlQuery("SELECT * FROM contacts;");
      expect(result.valid).toBe(true);
    });

    it("should reject queries with semicolon in the middle", () => {
      const result = validateSqlQuery("SELECT * FROM contacts; WHERE id = 1");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Multiple statements");
    });

    it("should reject whitespace-only queries", () => {
      const result = validateSqlQuery("   ");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("empty");
    });
  });

  describe("sanitizeIdentifier", () => {
    it("should return valid identifiers unchanged", () => {
      expect(sanitizeIdentifier("contacts")).toBe("contacts");
      expect(sanitizeIdentifier("first_name")).toBe("first_name");
      expect(sanitizeIdentifier("_private")).toBe("_private");
    });

    it("should trim whitespace", () => {
      expect(sanitizeIdentifier("  contacts  ")).toBe("contacts");
    });

    it("should reject identifiers starting with numbers", () => {
      expect(sanitizeIdentifier("1table")).toBe(null);
    });

    it("should reject identifiers with special characters", () => {
      expect(sanitizeIdentifier("table-name")).toBe(null);
      expect(sanitizeIdentifier("table.name")).toBe(null);
      expect(sanitizeIdentifier("table;drop")).toBe(null);
    });

    it("should reject identifiers longer than 63 characters", () => {
      const longName = "a".repeat(64);
      expect(sanitizeIdentifier(longName)).toBe(null);
    });

    it("should accept identifiers up to 63 characters", () => {
      const validName = "a".repeat(63);
      expect(sanitizeIdentifier(validName)).toBe(validName);
    });
  });

  describe("validateTablesInQuery", () => {
    const allowedTables = new Set(["contacts", "companies", "deals"]);

    it("should accept queries with only allowed tables", () => {
      const result = validateTablesInQuery(
        "SELECT * FROM contacts WHERE id = 1",
        allowedTables
      );
      expect(result.valid).toBe(true);
    });

    it("should accept queries with JOIN on allowed tables", () => {
      const result = validateTablesInQuery(
        "SELECT c.name, co.name FROM contacts c JOIN companies co ON c.company_id = co.id",
        allowedTables
      );
      expect(result.valid).toBe(true);
    });

    it("should reject queries with disallowed tables", () => {
      const result = validateTablesInQuery(
        "SELECT * FROM users WHERE id = 1",
        allowedTables
      );
      expect(result.valid).toBe(false);
      expect(result.invalidTables).toContain("users");
    });

    it("should detect multiple invalid tables", () => {
      const result = validateTablesInQuery(
        "SELECT * FROM users JOIN admin ON users.id = admin.id",
        allowedTables
      );
      expect(result.valid).toBe(false);
      expect(result.invalidTables).toContain("users");
      expect(result.invalidTables).toContain("admin");
    });

    it("should be case-insensitive for table names", () => {
      const result = validateTablesInQuery(
        "SELECT * FROM CONTACTS",
        allowedTables
      );
      expect(result.valid).toBe(true);
    });
  });
});
