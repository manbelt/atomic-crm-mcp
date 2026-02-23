-- Audit Log Table Migration
-- Creates an immutable audit log table for security and compliance

-- Create audit_log table
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  user_id TEXT,
  user_email TEXT,
  ip_address TEXT,
  user_agent TEXT,
  resource TEXT,
  resource_id TEXT,
  action TEXT,
  details JSONB,
  success BOOLEAN NOT NULL DEFAULT true,
  error_message TEXT
);

-- Create indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_event_type ON audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON audit_log(resource);
CREATE INDEX IF NOT EXISTS idx_audit_log_severity ON audit_log(severity);

-- Create partitioning for large-scale deployments (optional)
-- This creates monthly partitions for the audit log
-- Uncomment if expecting high volume of audit events

-- CREATE OR REPLACE FUNCTION create_audit_log_partition()
-- RETURNS void AS $$
-- DECLARE
--   partition_date TEXT;
--   partition_name TEXT;
-- BEGIN
--   partition_date := TO_CHAR(NOW() + INTERVAL '1 month', 'YYYY_MM');
--   partition_name := 'audit_log_' || partition_date;
--   
--   EXECUTE format(
--     'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_log 
--      FOR VALUES FROM (%L) TO (%L)',
--     partition_name,
--     (DATE_TRUNC('month', NOW() + INTERVAL '1 month'))::TEXT,
--     (DATE_TRUNC('month', NOW() + INTERVAL '2 months'))::TEXT
--   );
-- END;
-- $$ LANGUAGE plpgsql;

-- Make audit log immutable (prevent updates and deletes)
CREATE OR REPLACE FUNCTION prevent_audit_log_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit log entries cannot be modified';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_log_modification();

CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_log_modification();

-- Grant permissions
-- Note: In production, use a dedicated audit logger role with INSERT-only permissions
GRANT SELECT, INSERT ON audit_log TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE audit_log_id_seq TO authenticated;

-- Add comment for documentation
COMMENT ON TABLE audit_log IS 'Immutable audit log for security and compliance events';
COMMENT ON COLUMN audit_log.event_type IS 'Type of event (AUTH_LOGIN, DATA_CREATE, etc.)';
COMMENT ON COLUMN audit_log.severity IS 'Event severity: info, warning, or critical';
COMMENT ON COLUMN audit_log.success IS 'Whether the operation was successful';
