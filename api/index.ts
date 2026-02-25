/**
 * Vercel Serverless Function Entry Point
 * 
 * Stateless MCP server implementation for Vercel.
 * Each request is authenticated and processed independently.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

// Environment configuration
const config = {
  databaseUrl: process.env.DATABASE_URL || '',
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  mcpServerUrl: process.env.MCP_SERVER_URL || 'https://atomic-crm-mcp.vercel.app',
  nodeEnv: process.env.NODE_ENV || 'production',
};

// JWT validation
interface AuthInfo {
  userId: string;
  email: string;
  exp: number;
}

async function validateJwt(token: string): Promise<AuthInfo | null> {
  try {
    // Decode JWT payload (base64)
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    
    // Check expiration
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      return null;
    }
    
    // Verify with Supabase (use service key for admin access)
    const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': config.supabaseServiceKey || config.supabaseAnonKey,
      },
    });
    
    if (!response.ok) return null;
    
    const user = await response.json();
    
    return {
      userId: user.id,
      email: user.email,
      exp: payload.exp,
    };
  } catch (error) {
    console.error('JWT validation error:', error);
    return null;
  }
}

// Database query helper - uses service role key for admin access
async function executeQuery(sql: string, params: any[], userToken: string): Promise<any> {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.supabaseServiceKey}`,
      'apikey': config.supabaseServiceKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql, params }),
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Query failed: ${error}`);
  }
  
  return response.json();
}

// Direct Supabase REST API query - uses service role key for admin access
async function supabaseQuery(table: string, options: {
  select?: string;
  filter?: string;
  order?: string;
  limit?: number;
}, userToken: string): Promise<any[]> {
  let url = `${config.supabaseUrl}/rest/v1/${table}?select=${options.select || '*'}`;
  
  if (options.filter) {
    url += `&${options.filter}`;
  }
  if (options.order) {
    url += `&order=${options.order}`;
  }
  if (options.limit) {
    url += `&limit=${options.limit}`;
  }
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${config.supabaseServiceKey}`,
      'apikey': config.supabaseServiceKey,
    },
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Query failed: ${error}`);
  }
  
  return response.json();
}

// MCP Context
interface McpContext {
  authInfo: AuthInfo;
  userToken: string;
}

// Tool definitions
const tools = {
  get_schema: {
    definition: {
      description: 'Get the database schema for the CRM',
      inputSchema: z.object({}),
    },
    handler: async (params: any, context: McpContext) => {
      // Return schema information
      const tables = ['contacts', 'companies', 'deals', 'tasks', 'contactNotes', 'dealNotes', 'sales'];
      return {
        content: [{
          type: 'text' as const,
          text: `Database schema includes tables: ${tables.join(', ')}`,
        }],
      };
    },
  },
  
  query: {
    definition: {
      description: 'Execute a SQL query against the CRM database',
      inputSchema: z.object({
        sql: z.string().describe('The SQL SELECT query to execute'),
      }),
    },
    handler: async (params: { sql: string }, context: McpContext) => {
      try {
        // For security, only allow SELECT queries
        const sql = params.sql.trim().toUpperCase();
        if (!sql.startsWith('SELECT')) {
          return {
            content: [{
              type: 'text' as const,
              text: 'Error: Only SELECT queries are allowed',
            }],
            isError: true,
          };
        }
        
        // Use Supabase REST API for queries
        const result = await executeQuery(params.sql, [], context.userToken);
        
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    },
  },
  
  search_contacts: {
    definition: {
      description: 'Search for contacts by name, email, or company',
      inputSchema: z.object({
        query: z.string().describe('Search term'),
        limit: z.number().optional().default(10),
      }),
    },
    handler: async (params: { query: string; limit?: number }, context: McpContext) => {
      try {
        const result = await supabaseQuery('contacts', {
          select: 'id,first_name,last_name,email_jsonb,phone_jsonb,title,status',
          filter: `or(first_name.ilike.%${params.query}%,last_name.ilike.%${params.query}%,email_jsonb.ilike.%${params.query}%)`,
          limit: params.limit || 10,
        }, context.userToken);
        
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    },
  },
  
  get_summary: {
    definition: {
      description: 'Get a summary of the CRM data',
      inputSchema: z.object({}),
    },
    handler: async (params: any, context: McpContext) => {
      try {
        const [contacts, deals, tasks] = await Promise.all([
          supabaseQuery('contacts', { select: 'count' }, context.userToken),
          supabaseQuery('deals', { select: 'count' }, context.userToken),
          supabaseQuery('tasks', { select: 'count', filter: 'status.eq.pending' }, context.userToken),
        ]);
        
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              totalContacts: contacts.length,
              totalDeals: deals.length,
              pendingTasks: tasks.length,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    },
  },
  
  create_contact: {
    definition: {
      description: 'Create a new contact',
      inputSchema: z.object({
        first_name: z.string().min(1).max(100),
        last_name: z.string().min(1).max(100),
        email: z.string().email().optional(),
        phone: z.string().max(50).optional(),
        title: z.string().max(100).optional(),
        company_id: z.number().int().positive().optional(),
        status: z.string().max(50).optional().default('lead'),
      }),
    },
    handler: async (params: any, context: McpContext) => {
      try {
        // Map the parameters to the actual database columns
        const contactData = {
          first_name: params.first_name,
          last_name: params.last_name,
          email: params.email || null,
          phone: params.phone || null,
          job_title: params.title || null,
          company_id: params.company_id || null,
          status: params.status || 'active',
        };
        
        const response = await fetch(`${config.supabaseUrl}/rest/v1/contacts`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.supabaseServiceKey}`,
            'apikey': config.supabaseServiceKey,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
          body: JSON.stringify(contactData),
        });
        
        if (!response.ok) {
          const error = await response.text();
          throw new Error(error);
        }
        
        const result = await response.json();
        return {
          content: [{
            type: 'text' as const,
            text: `Contact created successfully:\n${JSON.stringify(result, null, 2)}`,
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error creating contact: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    },
  },
  
  create_deal: {
    definition: {
      description: 'Create a new deal',
      inputSchema: z.object({
        name: z.string().min(1).max(200),
        company_id: z.number().int().positive().optional(),
        contact_ids: z.array(z.number().int().positive()).optional(),
        stage: z.string().max(50).optional().default('opportunity'),
        amount: z.number().int().positive().optional(),
        description: z.string().max(5000).optional(),
        expected_closing_date: z.string().optional(),
      }),
    },
    handler: async (params: any, context: McpContext) => {
      try {
        const response = await fetch(`${config.supabaseUrl}/rest/v1/deals`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.supabaseServiceKey}`,
            'apikey': config.supabaseServiceKey,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
          body: JSON.stringify(params),
        });
        
        if (!response.ok) {
          const error = await response.text();
          throw new Error(error);
        }
        
        const result = await response.json();
        return {
          content: [{
            type: 'text' as const,
            text: `Deal created successfully:\n${JSON.stringify(result, null, 2)}`,
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error creating deal: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    },
  },
  
  create_task: {
    definition: {
      description: 'Create a new task',
      inputSchema: z.object({
        type: z.string().max(100).optional().default('general'),
        text: z.string().max(5000),
        contact_id: z.string().uuid().optional(),
        due_date: z.string().optional(),
      }),
    },
    handler: async (params: any, context: McpContext) => {
      try {
        // Map parameters to actual database columns
        const taskData = {
          type: params.type || 'general',
          text: params.text,
          contact_id: params.contact_id || null,
          due_date: params.due_date || new Date().toISOString(),
        };
        
        const response = await fetch(`${config.supabaseUrl}/rest/v1/tasks`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.supabaseServiceKey}`,
            'apikey': config.supabaseServiceKey,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
          body: JSON.stringify(taskData),
        });
        
        if (!response.ok) {
          const error = await response.text();
          throw new Error(error);
        }
        
        const result = await response.json();
        return {
          content: [{
            type: 'text' as const,
            text: `Task created successfully:\n${JSON.stringify(result, null, 2)}`,
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error creating task: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    },
  },
  
  create_company: {
    definition: {
      description: 'Create a new company',
      inputSchema: z.object({
        name: z.string().min(1).max(200),
        website: z.string().max(500).optional(),
        phone_number: z.string().max(50).optional(),
        sector: z.string().max(100).optional(),
        size: z.number().int().optional(),
        address: z.string().max(500).optional(),
        city: z.string().max(100).optional(),
        country: z.string().max(100).optional(),
        description: z.string().max(2000).optional(),
      }),
    },
    handler: async (params: any, context: McpContext) => {
      try {
        const response = await fetch(`${config.supabaseUrl}/rest/v1/companies`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.supabaseServiceKey}`,
            'apikey': config.supabaseServiceKey,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
          body: JSON.stringify(params),
        });
        
        if (!response.ok) {
          const error = await response.text();
          throw new Error(error);
        }
        
        const result = await response.json();
        return {
          content: [{
            type: 'text' as const,
            text: `Company created successfully:\n${JSON.stringify(result, null, 2)}`,
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error creating company: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    },
  },
  
  create_note: {
    definition: {
      description: 'Create a note on a contact or deal',
      inputSchema: z.object({
        text: z.string().min(1).max(10000),
        contact_id: z.string().uuid().optional(),
        deal_id: z.number().int().positive().optional(),
        type: z.string().max(50).optional().default('general'),
      }),
    },
    handler: async (params: any, context: McpContext) => {
      try {
        const table = params.contact_id ? 'contactNotes' : 'dealNotes';
        const noteData = {
          text: params.text,
          date: new Date().toISOString(),
          ...(params.contact_id 
            ? { contact_id: params.contact_id } 
            : { deal_id: params.deal_id, type: params.type || 'general' }
          ),
        };
        
        const response = await fetch(`${config.supabaseUrl}/rest/v1/${table}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.supabaseServiceKey}`,
            'apikey': config.supabaseServiceKey,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
          body: JSON.stringify(noteData),
        });
        
        if (!response.ok) {
          const error = await response.text();
          throw new Error(error);
        }
        
        const result = await response.json();
        return {
          content: [{
            type: 'text' as const,
            text: `Note created successfully:\n${JSON.stringify(result, null, 2)}`,
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error creating note: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    },
  },
  
  update_contact: {
    definition: {
      description: 'Update an existing contact',
      inputSchema: z.object({
        id: z.string().uuid(),
        first_name: z.string().min(1).max(100).optional(),
        last_name: z.string().min(1).max(100).optional(),
        email: z.string().email().optional(),
        phone: z.string().max(50).optional(),
        job_title: z.string().max(100).optional(),
        company_id: z.number().int().positive().optional(),
      }),
    },
    handler: async (params: any, context: McpContext) => {
      try {
        const { id, ...updates } = params;
        
        const response = await fetch(`${config.supabaseUrl}/rest/v1/contacts?id=eq.${id}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${config.supabaseServiceKey}`,
            'apikey': config.supabaseServiceKey,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
          body: JSON.stringify(updates),
        });
        
        if (!response.ok) {
          const error = await response.text();
          throw new Error(error);
        }
        
        const result = await response.json();
        return {
          content: [{
            type: 'text' as const,
            text: `Contact updated successfully:\n${JSON.stringify(result, null, 2)}`,
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error updating contact: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    },
  },
  
  update_deal: {
    definition: {
      description: 'Update an existing deal',
      inputSchema: z.object({
        id: z.number().int().positive(),
        name: z.string().min(1).max(200).optional(),
        stage: z.string().max(50).optional(),
        amount: z.number().int().positive().optional(),
        description: z.string().max(5000).optional(),
        expected_closing_date: z.string().optional(),
      }),
    },
    handler: async (params: any, context: McpContext) => {
      try {
        const { id, ...updates } = params;
        
        const response = await fetch(`${config.supabaseUrl}/rest/v1/deals?id=eq.${id}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${config.supabaseServiceKey}`,
            'apikey': config.supabaseServiceKey,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
          body: JSON.stringify(updates),
        });
        
        if (!response.ok) {
          const error = await response.text();
          throw new Error(error);
        }
        
        const result = await response.json();
        return {
          content: [{
            type: 'text' as const,
            text: `Deal updated successfully:\n${JSON.stringify(result, null, 2)}`,
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error updating deal: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    },
  },
  
  update_task: {
    definition: {
      description: 'Update an existing task',
      inputSchema: z.object({
        id: z.number().int().positive(),
        type: z.string().max(100).optional(),
        text: z.string().max(5000).optional(),
        contact_id: z.string().uuid().optional(),
        due_date: z.string().optional(),
        done_date: z.string().nullable().optional(),
      }),
    },
    handler: async (params: any, context: McpContext) => {
      try {
        const { id, ...updates } = params;
        
        const response = await fetch(`${config.supabaseUrl}/rest/v1/tasks?id=eq.${id}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${config.supabaseServiceKey}`,
            'apikey': config.supabaseServiceKey,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
          body: JSON.stringify(updates),
        });
        
        if (!response.ok) {
          const error = await response.text();
          throw new Error(error);
        }
        
        const result = await response.json();
        return {
          content: [{
            type: 'text' as const,
            text: `Task updated successfully:\n${JSON.stringify(result, null, 2)}`,
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error updating task: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    },
  },
  
  update_company: {
    definition: {
      description: 'Update an existing company',
      inputSchema: z.object({
        id: z.number().int().positive(),
        name: z.string().min(1).max(200).optional(),
        website: z.string().max(500).optional(),
        phone_number: z.string().max(50).optional(),
        sector: z.string().max(100).optional(),
        size: z.number().int().optional(),
        address: z.string().max(500).optional(),
        city: z.string().max(100).optional(),
        country: z.string().max(100).optional(),
        description: z.string().max(2000).optional(),
      }),
    },
    handler: async (params: any, context: McpContext) => {
      try {
        const { id, ...updates } = params;
        
        const response = await fetch(`${config.supabaseUrl}/rest/v1/companies?id=eq.${id}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${config.supabaseServiceKey}`,
            'apikey': config.supabaseServiceKey,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
          body: JSON.stringify(updates),
        });
        
        if (!response.ok) {
          const error = await response.text();
          throw new Error(error);
        }
        
        const result = await response.json();
        return {
          content: [{
            type: 'text' as const,
            text: `Company updated successfully:\n${JSON.stringify(result, null, 2)}`,
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error updating company: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    },
  },
  
  delete_contact: {
    definition: {
      description: 'Delete a contact',
      inputSchema: z.object({
        id: z.string().uuid(),
      }),
    },
    handler: async (params: { id: string }, context: McpContext) => {
      try {
        const response = await fetch(`${config.supabaseUrl}/rest/v1/contacts?id=eq.${params.id}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${config.supabaseServiceKey}`,
            'apikey': config.supabaseServiceKey,
          },
        });
        
        if (!response.ok) {
          const error = await response.text();
          throw new Error(error);
        }
        
        return {
          content: [{
            type: 'text' as const,
            text: `Contact ${params.id} deleted successfully`,
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error deleting contact: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    },
  },
  
  delete_deal: {
    definition: {
      description: 'Delete a deal',
      inputSchema: z.object({
        id: z.number().int().positive(),
      }),
    },
    handler: async (params: { id: number }, context: McpContext) => {
      try {
        const response = await fetch(`${config.supabaseUrl}/rest/v1/deals?id=eq.${params.id}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${config.supabaseServiceKey}`,
            'apikey': config.supabaseServiceKey,
          },
        });
        
        if (!response.ok) {
          const error = await response.text();
          throw new Error(error);
        }
        
        return {
          content: [{
            type: 'text' as const,
            text: `Deal ${params.id} deleted successfully`,
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error deleting deal: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    },
  },
  
  delete_task: {
    definition: {
      description: 'Delete a task',
      inputSchema: z.object({
        id: z.number().int().positive(),
      }),
    },
    handler: async (params: { id: number }, context: McpContext) => {
      try {
        const response = await fetch(`${config.supabaseUrl}/rest/v1/tasks?id=eq.${params.id}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${config.supabaseServiceKey}`,
            'apikey': config.supabaseServiceKey,
          },
        });
        
        if (!response.ok) {
          const error = await response.text();
          throw new Error(error);
        }
        
        return {
          content: [{
            type: 'text' as const,
            text: `Task ${params.id} deleted successfully`,
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error deleting task: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    },
  },
  
  delete_company: {
    definition: {
      description: 'Delete a company',
      inputSchema: z.object({
        id: z.number().int().positive(),
      }),
    },
    handler: async (params: { id: number }, context: McpContext) => {
      try {
        const response = await fetch(`${config.supabaseUrl}/rest/v1/companies?id=eq.${params.id}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${config.supabaseServiceKey}`,
            'apikey': config.supabaseServiceKey,
          },
        });
        
        if (!response.ok) {
          const error = await response.text();
          throw new Error(error);
        }
        
        return {
          content: [{
            type: 'text' as const,
            text: `Company ${params.id} deleted successfully`,
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error deleting company: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      }
    },
  },
};

// Health check handler
async function healthHandler(req: VercelRequest, res: VercelResponse): Promise<void> {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    tools: Object.keys(tools).length,
  });
}

// Main handler
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // Set security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-ID, mcp-session-id');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const path = req.url?.split('?')[0] || '/';

  // Health check
  if (path === '/health' || path === '/') {
    await healthHandler(req, res);
    return;
  }

  // MCP endpoint
  if (path === '/mcp' && req.method === 'POST') {
    // Authentication
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const token = authHeader.substring(7);
    const authInfo = await validateJwt(token);
    
    if (!authInfo) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    const context: McpContext = { authInfo, userToken: token };
    const body = req.body;

    try {
      // Handle MCP methods
      if (body.method === 'initialize') {
        res.status(200).json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: 'atomic-crm',
              version: '1.0.0',
            },
          },
        });
        return;
      }

      if (body.method === 'tools/list') {
        const toolsList = Object.entries(tools).map(([name, tool]) => ({
          name,
          description: tool.definition.description,
          inputSchema: tool.definition.inputSchema,
        }));
        
        res.status(200).json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            tools: toolsList,
          },
        });
        return;
      }

      if (body.method === 'tools/call') {
        const toolName = body.params?.name;
        const toolParams = body.params?.arguments || {};
        
        const tool = tools[toolName as keyof typeof tools];
        
        if (!tool) {
          res.status(200).json({
            jsonrpc: '2.0',
            id: body.id,
            error: {
              code: -32601,
              message: `Unknown tool: ${toolName}`,
            },
          });
          return;
        }

        const result = await tool.handler(toolParams, context);
        
        res.status(200).json({
          jsonrpc: '2.0',
          id: body.id,
          result,
        });
        return;
      }

      // Unknown method
      res.status(200).json({
        jsonrpc: '2.0',
        id: body.id,
        error: {
          code: -32601,
          message: `Unknown method: ${body.method}`,
        },
      });
      return;
    } catch (error) {
      res.status(500).json({
        jsonrpc: '2.0',
        id: body.id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Internal error',
        },
      });
      return;
    }
  }

  // 404 for unknown routes
  res.status(404).json({ error: 'Not found', path });
}
