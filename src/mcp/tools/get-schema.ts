import { z } from "zod";
import { executeRawQuery } from "../../db/query-builder.js";
import type { McpContext } from "../server.js";

/**
 * Get database schema information
 */
async function getSchemaData(
  context: McpContext
): Promise<{ success: boolean; data?: string; error?: string }> {
  try {
    // Get columns with table type (table vs view)
    // These are safe static queries against information_schema
    const columnsQuery = `
      SELECT
        c.table_name,
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.column_default,
        t.table_type
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON c.table_name = t.table_name
        AND c.table_schema = t.table_schema
      WHERE c.table_schema = 'public'
      ORDER BY c.table_name, c.ordinal_position;
    `;

    const columnsResult = await executeRawQuery(columnsQuery, context);

    if (!columnsResult.success) {
      return {
        success: false,
        error: columnsResult.error,
      };
    }

    // Get foreign keys from pg_catalog (bypasses information_schema RLS)
    const foreignKeysQuery = `
      SELECT
        cl.relname AS table_name,
        att.attname AS column_name,
        fcl.relname AS foreign_table_name,
        fatt.attname AS foreign_column_name
      FROM pg_catalog.pg_constraint con
      JOIN pg_catalog.pg_class cl ON con.conrelid = cl.oid
      JOIN pg_catalog.pg_namespace ns ON cl.relnamespace = ns.oid
      JOIN pg_catalog.pg_attribute att ON att.attrelid = cl.oid AND att.attnum = ANY(con.conkey)
      JOIN pg_catalog.pg_class fcl ON con.confrelid = fcl.oid
      JOIN pg_catalog.pg_attribute fatt ON fatt.attrelid = fcl.oid AND fatt.attnum = ANY(con.confkey)
      WHERE con.contype = 'f'
        AND ns.nspname = 'public'
      ORDER BY cl.relname, att.attname;
    `;

    const foreignKeysResult = await executeRawQuery(foreignKeysQuery, context);

    // Group columns by table and track table types
    const tables: Record<string, { columns: any[]; tableType: string }> = {};
    for (const row of columnsResult.data || []) {
      if (!tables[row.table_name]) {
        tables[row.table_name] = {
          columns: [],
          tableType: row.table_type,
        };
      }
      tables[row.table_name].columns.push({
        column: row.column_name,
        type: row.data_type,
        nullable: row.is_nullable === "YES",
        default: row.column_default,
      });
    }

    // Group foreign keys by table
    const foreignKeys: Record<string, any[]> = {};
    if (foreignKeysResult.success && foreignKeysResult.data) {
      for (const row of foreignKeysResult.data) {
        if (!foreignKeys[row.table_name]) {
          foreignKeys[row.table_name] = [];
        }
        foreignKeys[row.table_name].push({
          column: row.column_name,
          referencesTable: row.foreign_table_name,
          referencesColumn: row.foreign_column_name,
        });
      }
    }

    const schemaText = Object.entries(tables)
      .map(([table, tableData]) => {
        const tableLabel = tableData.tableType === 'VIEW' ? 'View' : 'Table';
        const columnList = tableData.columns
          .map(
            (c) =>
              `  - ${c.column}: ${c.type}${c.nullable ? " (nullable)" : ""}`
          )
          .join("\n");

        let foreignKeyList = "";
        if (foreignKeys[table] && foreignKeys[table].length > 0) {
          foreignKeyList = "\n  Foreign Keys:\n" + foreignKeys[table]
            .map(
              (fk) =>
                `    - ${fk.column} -> ${fk.referencesTable}.${fk.referencesColumn}`
            )
            .join("\n");
        }

        return `${tableLabel}: ${table}\n${columnList}${foreignKeyList}`;
      })
      .join("\n\n");

    return {
      success: true,
      data: schemaText || "No tables found in the public schema.",
    };
  } catch (error) {
    console.error("Schema retrieval error:", error instanceof Error ? error.message : "Unknown error");
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const get_schema = {
  definition: {
    description: `Get the database schema for the user's Atomic CRM instance.

IMPORTANT: Always call this tool FIRST before using the query tool to understand what tables and columns are available.

Returns information about:
- All tables and views in the database (views are clearly labeled)
- Column names and data types for each table/view
- Foreign key relationships between tables

Views (like contacts_summary, companies_summary) are read-only and often provide aggregated or pre-joined data for easier querying.

This helps you write accurate SQL queries including JOINs without guessing table or column names.`,
    inputSchema: z.object({}),
  },
  handler: async (_params: {}, context: McpContext) => {
    const result = await getSchemaData(context);

    return {
      content: [
        {
          type: "text" as const,
          text: result.success ? result.data! : `Error: ${result.error}`,
        },
      ],
      isError: !result.success,
    };
  },
};
