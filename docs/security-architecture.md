# Security Architecture Documentation

## Overview

This document describes the security architecture of the Atomic CRM MCP Server, including authentication, authorization, data protection, and security controls.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Client Layer                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │
│  │ AI Assistant│  │  Web App    │  │  Mobile App │                 │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                 │
└─────────┼────────────────┼────────────────┼─────────────────────────┘
          │                │                │
          ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Authentication Layer                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Supabase Auth Service                      │   │
│  │  • JWT Token Issuance                                         │   │
│  │  • OAuth Providers (Google, GitHub, etc.)                     │   │
│  │  • Session Management                                         │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
          │
          ▼ JWT Token
┌─────────────────────────────────────────────────────────────────────┐
│                         API Gateway Layer                            │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    MCP Server (This App)                       │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │   │
│  │  │ Rate Limiter│  │ CSRF Guard  │  │ JWT Validator│          │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘          │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │   │
│  │  │Security Hdr │  │ Audit Logger│  │ Error Handler│          │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘          │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
          │
          ▼ Parameterized Queries
┌─────────────────────────────────────────────────────────────────────┐
│                          Data Layer                                  │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Supabase PostgreSQL                         │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │   │
│  │  │ Row Level   │  │  Audit Log  │  │   Data      │          │   │
│  │  │ Security    │  │    Table    │  │   Tables    │          │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘          │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Redis Cache (Optional)                      │   │
│  │  • Session Blocklist                                           │   │
│  │  • Rate Limit Counters                                         │   │
│  │  • Query Cache                                                 │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

## Authentication

### JWT Token Flow

1. **Token Acquisition**
   - User authenticates via Supabase Auth (email/password, OAuth, magic link)
   - Supabase issues JWT token containing user claims
   - Token includes: `sub` (user ID), `email`, `role`, custom claims

2. **Token Validation**
   - Every request includes `Authorization: Bearer <token>` header
   - Server validates token signature using Supabase JWT secret
   - Token expiration is checked (default: 1 hour)
   - Invalid/expired tokens return 401 Unauthorized

3. **Token Refresh**
   - Client uses refresh token to get new access token
   - Refresh tokens are managed by Supabase Auth

### JWT Claims Structure

```json
{
  "sub": "user-uuid",
  "email": "user@example.com",
  "role": "authenticated",
  "aud": "authenticated",
  "iat": 1234567890,
  "exp": 1234571490,
  "company_id": "company-uuid",
  "permissions": ["read:contacts", "write:contacts"]
}
```

## Authorization

### Row Level Security (RLS)

All data access is controlled by PostgreSQL Row Level Security policies:

```sql
-- Example RLS Policy for contacts table
CREATE POLICY "Users can only see their company's contacts"
ON contacts FOR SELECT
USING (company_id = (
  SELECT company_id FROM users WHERE id = auth.uid()
));

-- Example RLS Policy for audit log (read-only)
CREATE POLICY "Audit log is read-only"
ON audit_log FOR SELECT
TO authenticated
USING (true);
```

### Permission Model

| Role | Permissions |
|------|-------------|
| `authenticated` | Read/write own company data |
| `admin` | Full access to company data |
| `service_role` | System operations (internal) |

### MCP Tool Authorization

Each MCP tool validates permissions before execution:

```typescript
// Permission check in tool handler
if (!hasPermission(context.authInfo, 'read:contacts')) {
  throw new AuthorizationError('Missing required permission: read:contacts');
}
```

## Data Protection

### SQL Injection Prevention

All database queries use parameterized statements:

```typescript
// SAFE: Parameterized query
const result = await executeParameterizedQuery(
  'SELECT * FROM contacts WHERE company_id = $1 AND status = $2',
  [companyId, status],
  context
);

// UNSAFE: String interpolation (NEVER USE)
const unsafeQuery = `SELECT * FROM contacts WHERE id = '${id}'`;
```

### Input Validation

All inputs are validated using Zod schemas:

```typescript
const contactSchema = z.object({
  first_name: z.string().min(1).max(100),
  last_name: z.string().min(1).max(100),
  email: z.string().email().optional(),
  phone: z.string().regex(/^\+?[\d\s-]+$/).optional(),
});
```

### Output Sanitization

- Sensitive fields are never returned in API responses
- Error messages don't expose internal details
- Stack traces are hidden in production

## Security Controls

### Rate Limiting

| Endpoint Type | Limit | Window |
|---------------|-------|--------|
| Standard | 100 requests | 1 minute |
| Query | 30 requests | 1 minute |
| Write | 20 requests | 1 minute |

Rate limiting is implemented using sliding window algorithm with Redis backend.

### CSRF Protection

Non-MCP endpoints are protected by double-submit cookie CSRF:

1. Server issues CSRF token in cookie
2. Client must include token in request header
3. Server validates cookie matches header

### Security Headers

All responses include security headers:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Strict-Transport-Security: max-age=31536000; includeSubDomains
Content-Security-Policy: default-src 'self'
Referrer-Policy: strict-origin-when-cross-origin
```

### Request Validation

1. **Content-Type**: Only `application/json` accepted
2. **Body Size**: Maximum 1MB
3. **Request Timeout**: 30 seconds

## Audit Logging

### Events Logged

| Event Type | Description |
|------------|-------------|
| `AUTH_LOGIN` | User authentication |
| `AUTH_LOGOUT` | User logout |
| `AUTH_FAILURE` | Failed authentication |
| `DATA_CREATE` | Record creation |
| `DATA_UPDATE` | Record modification |
| `DATA_DELETE` | Record deletion |
| `DATA_READ` | Bulk data access |
| `MCP_TOOL_CALL` | MCP tool invocation |
| `SECURITY_EVENT` | Security-related events |

### Audit Log Structure

```sql
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  event_type TEXT NOT NULL,
  user_id UUID,
  company_id UUID,
  ip_address INET,
  user_agent TEXT,
  resource_type TEXT,
  resource_id UUID,
  action TEXT,
  details JSONB,
  success BOOLEAN DEFAULT true,
  error_message TEXT
);

-- Make audit log immutable
CREATE TRIGGER prevent_audit_log_modification
BEFORE UPDATE OR DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION deny_operation();
```

### Audit Log Retention

- Logs are retained indefinitely
- Logs cannot be modified or deleted
- Access to logs is restricted to admin users

## Secrets Management

### Required Secrets

| Secret | Description | Rotation |
|--------|-------------|----------|
| `SUPABASE_URL` | Project URL | Never |
| `SUPABASE_ANON_KEY` | Anonymous key | Never |
| `SUPABASE_JWT_SECRET` | JWT signing secret | Yearly |
| `DATABASE_URL` | Connection string | Quarterly |
| `REDIS_URL` | Redis connection | Quarterly |

### Secret Storage

- Development: `.env` file (never commit)
- Production: Environment variables or secrets manager
- CI/CD: GitHub Actions secrets

## Network Security

### TLS Configuration

- TLS 1.2 minimum required
- Strong cipher suites only
- HSTS enabled

### IP Allowlisting (Optional)

For enhanced security, specific IPs can be allowlisted:

```typescript
const ALLOWED_IPS = new Set([
  '192.168.1.0/24',  // Office network
  '10.0.0.0/8',      // VPN network
]);
```

## Compliance

### Data Residency

- All data stored in Supabase region (configurable)
- No data leaves the configured region

### GDPR Considerations

- Users can request data export
- Users can request data deletion
- Audit logs track all data access

### SOC 2 Alignment

- Access controls implemented
- Audit logging enabled
- Encryption in transit and at rest
- Incident response procedures documented

## Security Monitoring

### Alerts

| Condition | Severity | Action |
|-----------|----------|--------|
| Multiple auth failures from IP | Medium | Rate limit IP |
| SQL injection attempt detected | High | Block IP, alert team |
| Unusual data access pattern | Medium | Review audit logs |
| Rate limit exceeded | Low | Log and monitor |
| Health check failure | Critical | Alert on-call |

### Health Checks

- `/health/live` - Liveness probe
- `/health/ready` - Readiness probe (includes DB check)
- `/health` - Full health status

## Security Checklist

### Pre-Deployment

- [ ] All secrets properly configured
- [ ] RLS policies enabled on all tables
- [ ] Rate limiting enabled
- [ ] Security headers configured
- [ ] Audit logging enabled
- [ ] Health checks configured
- [ ] TLS enabled
- [ ] Error messages sanitized

### Regular Reviews

- [ ] Review audit logs weekly
- [ ] Rotate secrets quarterly
- [ ] Update dependencies monthly
- [ ] Penetration test annually
- [ ] Security training quarterly

## Incident Response

See [Incident Response Runbook](./incident-response-runbook.md) for detailed procedures.

## Contact

- Security issues: security@atomic-crm.com
- Bug bounty program: [Link]
- Security advisories: [Link]
