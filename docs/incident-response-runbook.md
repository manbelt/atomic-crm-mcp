# Incident Response Runbook

## Overview

This runbook provides step-by-step procedures for responding to security incidents and operational issues in the Atomic CRM MCP Server.

## Incident Severity Levels

| Level | Name | Description | Response Time |
|-------|------|-------------|---------------|
| P1 | Critical | Service down, data breach, security compromise | Immediate (< 15 min) |
| P2 | High | Major feature unavailable, performance degradation | < 1 hour |
| P3 | Medium | Minor feature issues, elevated error rates | < 4 hours |
| P4 | Low | Cosmetic issues, documentation updates | < 24 hours |

## Incident Response Team

| Role | Responsibilities |
|------|------------------|
| Incident Commander | Overall coordination, communication, decision making |
| Technical Lead | Technical investigation, mitigation implementation |
| Communications | Stakeholder notifications, status updates |
| Security Analyst | Security assessment, forensics, containment |

---

## Incident Response Procedures

### Phase 1: Detection and Triage

#### 1.1 Alert Sources
- Health check failures (Kubernetes probes)
- Error rate spikes (logging thresholds)
- Security alerts (audit log anomalies)
- User reports
- External notifications

#### 1.2 Initial Assessment
```bash
# Check service health
curl -s http://localhost:3000/health | jq

# Check recent errors in logs
# Look for: error, fatal, critical log levels

# Check database connectivity
curl -s http://localhost:3000/health/ready | jq

# Check pool statistics
# Look for: high utilization, waiting connections
```

#### 1.3 Severity Classification
- **P1**: Multiple users affected, data at risk, service completely unavailable
- **P2**: Single major feature down, significant performance impact
- **P3**: Intermittent issues, elevated error rates but service functional
- **P4**: Minor issues, workarounds available

---

### Phase 2: Containment

#### 2.1 Security Incident Containment

**SQL Injection Attempt Detected:**
```bash
# 1. Block offending IP immediately
iptables -A INPUT -s <IP_ADDRESS> -j DROP

# 2. Review audit logs for the IP
SELECT * FROM audit_log WHERE ip_address = '<IP_ADDRESS>' ORDER BY created_at DESC;

# 3. Check for successful data exfiltration
SELECT * FROM audit_log 
WHERE ip_address = '<IP_ADDRESS>' 
AND event_type IN ('DATA_READ', 'DATA_EXPORT')
ORDER BY created_at DESC;

# 4. Rotate database credentials if breach suspected
# Via Supabase dashboard or CLI
```

**Authentication Bypass Attempt:**
```bash
# 1. Revoke all sessions for affected user(s)
# Add tokens to blocklist in Redis

# 2. Force password reset for affected accounts
# Via Supabase Auth API

# 3. Enable additional monitoring
# Increase log level to debug
```

**Rate Limit Exceeded:**
```bash
# 1. Check if legitimate traffic spike or attack
# Review request patterns in logs

# 2. If attack, block IPs
# If legitimate, consider temporary rate limit increase

# 3. Enable request queuing if needed
```

#### 2.2 Service Degradation Containment

**Database Pool Exhaustion:**
```bash
# 1. Check pool stats
# Look for: utilization > 90%, waiting > 20

# 2. Kill long-running queries
SELECT pg_terminate_backend(pid) 
FROM pg_stat_activity 
WHERE state = 'active' 
AND query_start < NOW() - INTERVAL '5 minutes'
AND query NOT LIKE '%pg_stat_activity%';

# 3. Scale horizontally if needed
# Deploy additional instances
```

**Memory Pressure:**
```bash
# 1. Check memory usage
free -m
ps aux --sort=-%mem | head -20

# 2. Restart service if OOM imminent
kubectl rollout restart deployment/atomic-crm-mcp

# 3. Review memory limits
kubectl describe pod <pod-name>
```

---

### Phase 3: Investigation

#### 3.1 Log Analysis

**Key Log Locations:**
- Application logs: stdout/stderr (JSON format)
- Audit logs: `audit_log` table in database
- Access logs: Ingress controller logs
- Database logs: Supabase dashboard

**Search Patterns:**
```bash
# Find errors in last hour
# Look for: "level":"error" in logs

# Find authentication failures
# Look for: "AUTH_FAILURE", "AUTH_LOGIN_FAILED"

# Find SQL injection attempts
# Look for: "forbidden keyword", "SQL injection"

# Find rate limit violations
# Look for: "rate limit exceeded"
```

#### 3.2 Database Investigation

```sql
-- Recent audit events
SELECT event_type, COUNT(*) 
FROM audit_log 
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY event_type;

-- Failed operations
SELECT * FROM audit_log 
WHERE success = false 
AND created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;

-- Suspicious patterns
SELECT ip_address, COUNT(*) as request_count
FROM audit_log
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY ip_address
HAVING COUNT(*) > 100
ORDER BY request_count DESC;
```

---

### Phase 4: Remediation

#### 4.1 Service Recovery

**Restart Service:**
```bash
# Kubernetes
kubectl rollout restart deployment/atomic-crm-mcp

# Docker
docker restart atomic-crm-mcp

# PM2
pm2 restart atomic-crm-mcp
```

**Database Recovery:**
```bash
# Check database health
curl -s http://localhost:3000/health/ready

# Reset connection pool
# Service restart will reset pool

# Restore from backup if data corruption
# Via Supabase dashboard
```

#### 4.2 Security Remediation

**After Breach:**
1. Rotate all credentials (database, JWT secret, API keys)
2. Review and update RLS policies
3. Patch vulnerability that allowed breach
4. Update security rules/firewall
5. Notify affected users
6. File security incident report

**After DDoS:**
1. Review and update rate limits
2. Implement additional rate limiting at CDN/load balancer
3. Consider WAF rules
4. Review auto-scaling policies

---

### Phase 5: Post-Incident

#### 5.1 Documentation

Create incident report including:
- Timeline of events
- Root cause analysis
- Impact assessment
- Actions taken
- Lessons learned
- Preventive measures

#### 5.2 Follow-up Actions

- [ ] Update runbook with new procedures
- [ ] Implement additional monitoring
- [ ] Schedule security review
- [ ] Update documentation
- [ ] Conduct team training if needed

---

## Common Incident Scenarios

### Scenario 1: Database Connection Pool Exhaustion

**Symptoms:**
- Health check failures
- Request timeouts
- "Connection pool exhausted" errors in logs

**Resolution:**
1. Check pool stats via health endpoint
2. Identify long-running queries
3. Kill problematic queries
4. Restart service if needed
5. Review and optimize queries

### Scenario 2: Authentication Service Down

**Symptoms:**
- All requests return 401
- JWT verification failures in logs

**Resolution:**
1. Check Supabase Auth service status
2. Verify JWT secret configuration
3. Check token expiration settings
4. Implement fallback if available

### Scenario 3: Rate Limit False Positive

**Symptoms:**
- Legitimate users getting 429 errors
- Complaints about access denied

**Resolution:**
1. Review rate limit configuration
2. Check if IP is shared (NAT, proxy)
3. Whitelist legitimate IPs if needed
4. Adjust rate limits for specific endpoints

### Scenario 4: Data Integrity Issue

**Symptoms:**
- Unexpected data in database
- Missing records
- Audit log anomalies

**Resolution:**
1. Stop write operations if critical
2. Review audit logs for changes
3. Identify affected records
4. Restore from backup if needed
5. Investigate root cause

---

## Emergency Contacts

| Role | Contact | Backup |
|------|---------|--------|
| Incident Commander | [Primary] | [Backup] |
| Technical Lead | [Primary] | [Backup] |
| Security Team | [Primary] | [Backup] |
| Database Admin | [Primary] | [Backup] |

## External Resources

- Supabase Status: https://status.supabase.com
- Supabase Support: support@supabase.io
- Security Advisory: security@atomic-crm.com

---

## Appendix: Useful Commands

```bash
# Service health
curl -s http://localhost:3000/health | jq

# Pool statistics (via debug endpoint if available)
curl -s http://localhost:3000/debug/pool-stats | jq

# Recent errors
# Filter logs for: level=error

# Active connections
SELECT * FROM pg_stat_activity WHERE state = 'active';

# Kill specific connection
SELECT pg_terminate_backend(<pid>);

# Clear Redis cache
redis-cli FLUSHDB

# Check rate limit status
redis-cli KEYS "rate-limit:*"
```
