import { Router, Request, Response } from "express";

/**
 * OpenAPI 3.0 specification for Atomic CRM MCP Server
 */
const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Atomic CRM MCP Server API",
    description: `Model Context Protocol (MCP) server for Atomic CRM.

This server provides AI assistants with secure, authenticated access to CRM data including:
- Contacts and companies
- Deals and sales pipeline
- Tasks and activities
- Custom fields and metadata

## Authentication

All endpoints require Bearer token authentication using JWT tokens from Supabase Auth.

## Security

- All SQL queries use parameterized statements to prevent injection
- Row Level Security (RLS) is enforced at the database level
- Rate limiting is applied to prevent abuse
- All actions are logged for audit purposes

## Rate Limits

- Standard endpoints: 100 requests per minute
- Query endpoint: 30 requests per minute
- Write operations: 20 requests per minute`,
    version: "1.0.0",
    contact: {
      name: "Atomic CRM Support",
      email: "support@atomic-crm.com",
    },
    license: {
      name: "MIT",
      url: "https://opensource.org/licenses/MIT",
    },
  },
  servers: [
    {
      url: "/",
      description: "Current server",
    },
  ],
  security: [
    {
      BearerAuth: [],
    },
  ],
  paths: {
    "/health": {
      get: {
        summary: "Health check",
        description: "Returns the overall health status of the server",
        tags: ["Health"],
        security: [],
        responses: {
          "200": {
            description: "Server is healthy",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", enum: ["healthy", "degraded", "unhealthy"] },
                    timestamp: { type: "string", format: "date-time" },
                    version: { type: "string" },
                    uptime: { type: "number" },
                    checks: {
                      type: "object",
                      properties: {
                        database: { type: "boolean" },
                        cache: { type: "boolean" },
                      },
                    },
                  },
                },
              },
            },
          },
          "503": {
            description: "Server is unhealthy",
          },
        },
      },
    },
    "/health/live": {
      get: {
        summary: "Liveness probe",
        description: "Kubernetes liveness probe - indicates if the server is running",
        tags: ["Health"],
        security: [],
        responses: {
          "200": {
            description: "Server is alive",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "alive" },
                    timestamp: { type: "string", format: "date-time" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/health/ready": {
      get: {
        summary: "Readiness probe",
        description: "Kubernetes readiness probe - indicates if the server is ready to accept requests",
        tags: ["Health"],
        security: [],
        responses: {
          "200": {
            description: "Server is ready",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "ready" },
                    timestamp: { type: "string", format: "date-time" },
                    checks: {
                      type: "object",
                      properties: {
                        database: { type: "boolean" },
                        cache: { type: "boolean" },
                      },
                    },
                  },
                },
              },
            },
          },
          "503": {
            description: "Server is not ready",
          },
        },
      },
    },
    "/mcp": {
      post: {
        summary: "MCP endpoint",
        description: "Main Model Context Protocol endpoint for AI assistant integration",
        tags: ["MCP"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  jsonrpc: { type: "string", example: "2.0" },
                  method: { type: "string" },
                  params: { type: "object" },
                  id: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "MCP response",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    jsonrpc: { type: "string", example: "2.0" },
                    result: { type: "object" },
                    id: { type: "string" },
                  },
                },
              },
            },
          },
          "400": {
            description: "Invalid request",
          },
          "401": {
            description: "Authentication required",
          },
          "429": {
            description: "Rate limit exceeded",
          },
        },
      },
    },
    "/.well-known/oauth-protected-resource": {
      get: {
        summary: "OAuth protected resource metadata",
        description: "Returns OAuth 2.0 protected resource metadata per RFC 9728",
        tags: ["OAuth"],
        security: [],
        responses: {
          "200": {
            description: "Protected resource metadata",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    resource: { type: "string", format: "uri" },
                    authorization_servers: {
                      type: "array",
                      items: { type: "string", format: "uri" },
                    },
                    scopes_supported: {
                      type: "array",
                      items: { type: "string" },
                    },
                    bearer_methods_supported: {
                      type: "array",
                      items: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "JWT token from Supabase Auth",
      },
    },
    schemas: {
      Error: {
        type: "object",
        required: ["error", "code"],
        properties: {
          error: { type: "string" },
          code: { type: "string" },
          details: { type: "object" },
          requestId: { type: "string" },
        },
      },
      Contact: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          first_name: { type: "string" },
          last_name: { type: "string" },
          email: { type: "string", format: "email" },
          phone: { type: "string" },
          company_id: { type: "string", format: "uuid" },
          status: { type: "string" },
          created_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time" },
        },
      },
      Company: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          website: { type: "string", format: "uri" },
          industry: { type: "string" },
          size: { type: "integer" },
          created_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time" },
        },
      },
      Deal: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          stage: { type: "string" },
          amount: { type: "number" },
          probability: { type: "integer", minimum: 0, maximum: 100 },
          company_id: { type: "string", format: "uuid" },
          created_at: { type: "string", format: "date-time" },
          updated_at: { type: "string", format: "date-time" },
        },
      },
      Task: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          description: { type: "string" },
          type: { type: "string" },
          due_date: { type: "string", format: "date-time" },
          done_date: { type: "string", format: "date-time" },
          contact_id: { type: "string", format: "uuid" },
          created_at: { type: "string", format: "date-time" },
        },
      },
    },
  },
  tags: [
    {
      name: "Health",
      description: "Health check endpoints for monitoring and orchestration",
    },
    {
      name: "MCP",
      description: "Model Context Protocol endpoints for AI integration",
    },
    {
      name: "OAuth",
      description: "OAuth 2.0 metadata endpoints",
    },
  ],
};

/**
 * Create OpenAPI documentation router
 */
export function createApiDocsRouter(): Router {
  const router = Router();

  // Serve OpenAPI spec as JSON
  router.get("/openapi.json", (_req: Request, res: Response) => {
    res.json(openApiSpec);
  });

  // Serve Swagger UI-like documentation
  router.get("/", (_req: Request, res: Response) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Atomic CRM MCP API Documentation</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
  <style>
    body { margin: 0; padding: 0; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function() {
      SwaggerUIBundle({
        url: "/api-docs/openapi.json",
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset
        ],
        layout: "BaseLayout"
      });
    }
  </script>
</body>
</html>
    `);
  });

  return router;
}

export { openApiSpec };
