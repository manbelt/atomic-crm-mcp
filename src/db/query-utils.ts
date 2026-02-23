/**
 * SQL query utilities that don't require database connection
 * These can be safely imported in tests without environment variables
 */

/**
 * Allowed tables for queries (whitelist)
 */
const ALLOWED_TABLES = new Set([
  'contacts',
  'companies',
  'deals',
  'tasks',
  'sales',
  'activities',
  'tags',
  'contact_tags',
  'deal_contacts',
  'audit_log',
  // Summary views
  'contacts_summary',
  'companies_summary',
  'deals_summary',
]);

/**
 * Build an IN clause with parameterized values
 * @param values - Array of values
 * @param startIndex - Starting parameter index (default 1)
 * @returns Object with placeholders string and params array
 */
export function buildInClause(
  values: unknown[],
  startIndex: number = 1
): { placeholders: string; params: unknown[] } {
  if (values.length === 0) {
    return { placeholders: '', params: [] };
  }

  const placeholders: string[] = [];
  const params: unknown[] = [];

  values.forEach((value, index) => {
    placeholders.push(`$${startIndex + index}`);
    params.push(value);
  });

  return {
    placeholders: placeholders.join(', '),
    params,
  };
}

/**
 * Build a SET clause for UPDATE statements
 * @param data - Object with column names and values
 * @param startIndex - Starting parameter index (default 1)
 * @returns Object with clause string and params array
 */
export function buildSetClause(
  data: Record<string, unknown>,
  startIndex: number = 1
): { clause: string; params: unknown[] } {
  const keys = Object.keys(data);
  const parts: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 0;

  keys.forEach((key) => {
    if (isValidColumn(key)) {
      parts.push(`${key} = $${startIndex + paramIndex}`);
      params.push(data[key]);
      paramIndex++;
    }
  });

  return {
    clause: parts.join(', '),
    params,
  };
}

/**
 * Build an INSERT statement with parameterized values
 * @param table - Table name
 * @param data - Object with column names and values
 * @returns Object with SQL string and params array
 */
export function buildInsertStatement(
  table: string,
  data: Record<string, unknown>
): { sql: string; params: unknown[] } {
  const keys = Object.keys(data).filter(isValidColumn);
  const columns = keys.join(', ');
  
  const placeholders: string[] = [];
  const params: unknown[] = [];

  keys.forEach((key, index) => {
    placeholders.push(`$${index + 1}`);
    params.push(data[key]);
  });

  return {
    sql: `INSERT INTO ${table} (${columns}) VALUES (${placeholders.join(', ')})`,
    params,
  };
}

/**
 * Build a WHERE clause from conditions
 * @param conditions - Object with column names and values
 * @param startIndex - Starting parameter index (default 1)
 * @param operator - Operator to join conditions (default AND)
 * @returns Object with clause string and params array
 */
export function buildWhereClause(
  conditions: Record<string, unknown>,
  startIndex: number = 1,
  operator: 'AND' | 'OR' = 'AND'
): { clause: string; params: unknown[] } {
  const keys = Object.keys(conditions);
  const parts: string[] = [];
  const params: unknown[] = [];

  keys.forEach((key, index) => {
    if (isValidColumn(key)) {
      const value = conditions[key];
      if (value === null) {
        parts.push(`${key} IS NULL`);
      } else {
        parts.push(`${key} = $${startIndex + params.length}`);
        params.push(value);
      }
    }
  });

  return {
    clause: parts.join(` ${operator} `),
    params,
  };
}

/**
 * Validate table name against whitelist
 * @param table - Table name to validate
 * @returns true if table is allowed
 */
export function isValidTable(table: string): boolean {
  return ALLOWED_TABLES.has(table.toLowerCase());
}

/**
 * Validate column name format
 * Prevents SQL injection in column names
 * @param column - Column name to validate
 * @returns true if column name is valid
 */
export function isValidColumn(column: string): boolean {
  // Column names must:
  // - Start with a letter or underscore
  // - Contain only letters, numbers, and underscores
  // - Be reasonable length (1-63 chars for PostgreSQL)
  if (!column || column.length === 0 || column.length > 63) {
    return false;
  }

  // Allow letters, numbers, underscores, and jsonb path operators
  const validPattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
  return validPattern.test(column);
}

/**
 * Escape a string for use in LIKE queries
 * @param value - String to escape
 * @returns Escaped string
 */
export function escapeLikePattern(value: string): string {
  // Escape special LIKE characters: %, _, \
  return value.replace(/[%_\\]/g, '\\$&');
}

/**
 * Build a full-text search query
 * @param query - Search query string
 * @returns Formatted tsquery string
 */
export function buildTsQuery(query: string): string {
  // Split into words and join with AND
  const words = query
    .trim()
    .split(/\s+/)
    .filter(word => word.length > 0)
    .map(word => `${word}:*`);
  
  return words.join(' & ');
}
