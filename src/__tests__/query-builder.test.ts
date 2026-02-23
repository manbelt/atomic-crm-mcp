import { describe, it, expect } from "vitest";
import {
  buildInClause,
  buildSetClause,
  buildInsertStatement,
  buildWhereClause,
  isValidTable,
  isValidColumn,
  escapeLikePattern,
  buildTsQuery,
} from "../db/query-utils.js";

describe("Query Builder Utilities", () => {
  describe("buildInClause", () => {
    it("should generate correct placeholders for values", () => {
      const result = buildInClause([1, 2, 3], 1);
      expect(result.placeholders).toBe("$1, $2, $3");
      expect(result.params).toEqual([1, 2, 3]);
    });

    it("should start from specified index", () => {
      const result = buildInClause(["a", "b"], 5);
      expect(result.placeholders).toBe("$5, $6");
      expect(result.params).toEqual(["a", "b"]);
    });

    it("should handle empty array", () => {
      const result = buildInClause([], 1);
      expect(result.placeholders).toBe("");
      expect(result.params).toEqual([]);
    });

    it("should handle single value", () => {
      const result = buildInClause([42], 1);
      expect(result.placeholders).toBe("$1");
      expect(result.params).toEqual([42]);
    });
  });

  describe("buildSetClause", () => {
    it("should generate correct SET clause", () => {
      const result = buildSetClause({ name: "John", age: 30 }, 1);
      expect(result.clause).toBe("name = $1, age = $2");
      expect(result.params).toEqual(["John", 30]);
    });

    it("should start from specified index", () => {
      const result = buildSetClause({ status: "active" }, 3);
      expect(result.clause).toBe("status = $3");
      expect(result.params).toEqual(["active"]);
    });

    it("should handle null values", () => {
      const result = buildSetClause({ name: null }, 1);
      expect(result.params).toEqual([null]);
    });

    it("should filter out invalid column names", () => {
      const result = buildSetClause({ "invalid-column": "test", valid_name: "ok" }, 1);
      expect(result.clause).toBe("valid_name = $1");
      expect(result.params).toEqual(["ok"]);
    });
  });

  describe("buildInsertStatement", () => {
    it("should generate correct INSERT statement", () => {
      const result = buildInsertStatement("contacts", {
        first_name: "John",
        last_name: "Doe",
      });
      
      expect(result.sql).toBe(
        "INSERT INTO contacts (first_name, last_name) VALUES ($1, $2)"
      );
      expect(result.params).toEqual(["John", "Doe"]);
    });

    it("should handle single column", () => {
      const result = buildInsertStatement("tags", { name: "VIP" });
      
      expect(result.sql).toBe("INSERT INTO tags (name) VALUES ($1)");
      expect(result.params).toEqual(["VIP"]);
    });

    it("should filter out invalid column names", () => {
      const result = buildInsertStatement("contacts", {
        "invalid;column": "bad",
        first_name: "John",
      });
      
      expect(result.sql).toBe("INSERT INTO contacts (first_name) VALUES ($1)");
      expect(result.params).toEqual(["John"]);
    });
  });

  describe("buildWhereClause", () => {
    it("should generate correct WHERE clause with AND", () => {
      const result = buildWhereClause({ status: "active", type: "lead" }, 1);
      expect(result.clause).toBe("status = $1 AND type = $2");
      expect(result.params).toEqual(["active", "lead"]);
    });

    it("should generate correct WHERE clause with OR", () => {
      const result = buildWhereClause({ status: "active", type: "lead" }, 1, "OR");
      expect(result.clause).toBe("status = $1 OR type = $2");
      expect(result.params).toEqual(["active", "lead"]);
    });

    it("should handle null values with IS NULL", () => {
      const result = buildWhereClause({ deleted_at: null }, 1);
      expect(result.clause).toBe("deleted_at IS NULL");
      expect(result.params).toEqual([]);
    });
  });

  describe("isValidTable", () => {
    it("should return true for valid tables", () => {
      expect(isValidTable("contacts")).toBe(true);
      expect(isValidTable("companies")).toBe(true);
      expect(isValidTable("deals")).toBe(true);
      expect(isValidTable("tasks")).toBe(true);
      expect(isValidTable("sales")).toBe(true);
    });

    it("should return true for summary views", () => {
      expect(isValidTable("contacts_summary")).toBe(true);
      expect(isValidTable("companies_summary")).toBe(true);
    });

    it("should return false for invalid tables", () => {
      expect(isValidTable("users")).toBe(false);
      expect(isValidTable("admin")).toBe(false);
      expect(isValidTable("pg_catalog")).toBe(false);
      expect(isValidTable("information_schema")).toBe(false);
    });

    it("should be case-insensitive", () => {
      expect(isValidTable("CONTACTS")).toBe(true);
      expect(isValidTable("Contacts")).toBe(true);
    });
  });

  describe("isValidColumn", () => {
    it("should return true for valid column names", () => {
      expect(isValidColumn("id")).toBe(true);
      expect(isValidColumn("first_name")).toBe(true);
      expect(isValidColumn("createdAt")).toBe(true);
      expect(isValidColumn("email_jsonb")).toBe(true);
    });

    it("should return false for invalid column names", () => {
      expect(isValidColumn("")).toBe(false);
      expect(isValidColumn("1column")).toBe(false);
      expect(isValidColumn("column-name")).toBe(false);
      expect(isValidColumn("column.name")).toBe(false);
      expect(isValidColumn("column;drop")).toBe(false);
    });

    it("should reject SQL injection attempts", () => {
      expect(isValidColumn("id; DROP TABLE users")).toBe(false);
      expect(isValidColumn("id' OR '1'='1")).toBe(false);
      expect(isValidColumn("id\" OR \"1\"=\"1")).toBe(false);
    });

    it("should reject columns longer than 63 characters", () => {
      const longName = "a".repeat(64);
      expect(isValidColumn(longName)).toBe(false);
    });
  });

  describe("escapeLikePattern", () => {
    it("should escape special LIKE characters", () => {
      expect(escapeLikePattern("100%")).toBe("100\\%");
      expect(escapeLikePattern("test_value")).toBe("test\\_value");
      expect(escapeLikePattern("path\\to\\file")).toBe("path\\\\to\\\\file");
    });

    it("should handle strings without special characters", () => {
      expect(escapeLikePattern("normal")).toBe("normal");
    });
  });

  describe("buildTsQuery", () => {
    it("should build tsquery from single word", () => {
      expect(buildTsQuery("test")).toBe("test:*");
    });

    it("should build tsquery from multiple words", () => {
      expect(buildTsQuery("john doe")).toBe("john:* & doe:*");
    });

    it("should handle extra whitespace", () => {
      expect(buildTsQuery("  john   doe  ")).toBe("john:* & doe:*");
    });

    it("should handle empty string", () => {
      expect(buildTsQuery("")).toBe("");
    });
  });
});
