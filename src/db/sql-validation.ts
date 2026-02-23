/**
 * SQL validation utilities that don't require database connection
 * These can be safely imported in tests without environment variables
 */

/**
 * SQL keywords that are not allowed in user queries for security
 */
const FORBIDDEN_KEYWORDS = [
  'DROP', 'DELETE', 'TRUNCATE', 'ALTER', 'CREATE', 'GRANT', 'REVOKE',
  'INSERT', 'UPDATE', 'MERGE', 'COPY', 'VACUUM', 'REINDEX',
  'EXECUTE', 'PREPARE', 'DEALLOCATE', 'DISCARD',
  'LOAD', 'SET', 'RESET', 'LOCK', 'CLUSTER',
  'COMMENT ON', 'SECURITY LABEL', 'IMPORT FOREIGN SCHEMA',
];

/**
 * Maximum allowed query length
 */
const MAX_QUERY_LENGTH = 10000;

/**
 * Check if SQL contains forbidden keywords
 * @param sql - SQL query string
 * @returns Object indicating if forbidden keywords were found
 */
export function containsForbiddenKeywords(sql: string): { hasForbidden: boolean; keyword?: string } {
  const upperSql = sql.toUpperCase();
  
  for (const keyword of FORBIDDEN_KEYWORDS) {
    // Check for keyword as a standalone word (not part of another word)
    const regex = new RegExp(`\\b${keyword.replace(/\s+/g, '\\s+')}\\b`, 'i');
    if (regex.test(upperSql)) {
      return { hasForbidden: true, keyword };
    }
  }
  
  return { hasForbidden: false };
}

/**
 * Validate SQL query for safety
 * @param sql - SQL query string to validate
 * @returns Object indicating if query is valid and optional error message
 */
export function validateSqlQuery(sql: string): { valid: boolean; error?: string } {
  // Check for empty query
  if (!sql || sql.trim().length === 0) {
    return { valid: false, error: "Query cannot be empty" };
  }

  // Check query length
  if (sql.length > MAX_QUERY_LENGTH) {
    return { valid: false, error: `Query exceeds maximum length of ${MAX_QUERY_LENGTH} characters` };
  }

  // Check for forbidden keywords
  const { hasForbidden, keyword } = containsForbiddenKeywords(sql);
  if (hasForbidden) {
    return { valid: false, error: `Query contains forbidden keyword: ${keyword}` };
  }

  // Check that query starts with SELECT or WITH (CTE)
  const trimmedSql = sql.trim().toUpperCase();
  if (!trimmedSql.startsWith('SELECT') && !trimmedSql.startsWith('WITH')) {
    return { valid: false, error: "Only SELECT and WITH queries are allowed" };
  }

  // Check for multiple statements (basic check for semicolons)
  // Allow trailing semicolon but not semicolons in the middle
  const withoutTrailingSemicolon = sql.trim().replace(/;$/, '');
  if (withoutTrailingSemicolon.includes(';')) {
    return { valid: false, error: "Multiple statements are not allowed" };
  }

  return { valid: true };
}

/**
 * Sanitize a SQL identifier (table or column name)
 * @param identifier - The identifier to sanitize
 * @returns Sanitized identifier or null if invalid
 */
export function sanitizeIdentifier(identifier: string): string | null {
  // Remove any whitespace
  const cleaned = identifier.trim();
  
  // Check for valid identifier format
  // Must start with letter or underscore, contain only alphanumeric, underscore
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(cleaned)) {
    return null;
  }
  
  // Check length (PostgreSQL limit is 63 characters)
  if (cleaned.length > 63) {
    return null;
  }
  
  return cleaned;
}

/**
 * Validate that a query only accesses allowed tables
 * @param sql - SQL query string
 * @param allowedTables - Set of allowed table names
 * @returns Object indicating if query is valid for allowed tables
 */
export function validateTablesInQuery(
  sql: string,
  allowedTables: Set<string>
): { valid: boolean; invalidTables?: string[] } {
  const upperSql = sql.toUpperCase();
  const upperAllowed = new Set([...allowedTables].map(t => t.toUpperCase()));
  
  // Extract table names after FROM and JOIN keywords
  const tablePattern = /(?:FROM|JOIN)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi;
  const matches = sql.matchAll(tablePattern);
  const invalidTables: string[] = [];
  
  for (const match of matches) {
    const tableName = match[1].toUpperCase();
    if (!upperAllowed.has(tableName)) {
      invalidTables.push(match[1]);
    }
  }
  
  if (invalidTables.length > 0) {
    return { valid: false, invalidTables };
  }
  
  return { valid: true };
}
