-- ============================================================================
-- NOVA CHECK EHR - DATABASE INITIALIZATION SCRIPT
-- ============================================================================
-- This script initializes the PostgreSQL database with required extensions,
-- schemas, and initial configurations for the Nova Check EHR system.
-- ============================================================================

-- Enable required PostgreSQL extensions
-- ============================================================================

-- UUID generation extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Cryptographic functions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Full-text search
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Additional text search functions
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- PostGIS for geospatial data (if needed for location-based features)
-- CREATE EXTENSION IF NOT EXISTS "postgis";

-- Time zone support
CREATE EXTENSION IF NOT EXISTS "timescaledb" CASCADE;

-- ============================================================================
-- Create custom schemas
-- ============================================================================

-- Audit schema for tracking changes
CREATE SCHEMA IF NOT EXISTS audit;

-- Analytics schema for reporting and business intelligence
CREATE SCHEMA IF NOT EXISTS analytics;

-- Archive schema for historical data
CREATE SCHEMA IF NOT EXISTS archive;

-- ============================================================================
-- Create custom types and enums
-- ============================================================================

-- User roles enum
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM (
        'SUPER_ADMIN',
        'ADMIN', 
        'MANAGER',
        'PROVIDER',
        'NURSE',
        'STAFF',
        'PATIENT',
        'GUEST'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- User status enum
DO $$ BEGIN
    CREATE TYPE user_status AS ENUM (
        'ACTIVE',
        'INACTIVE',
        'SUSPENDED',
        'PENDING',
        'LOCKED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Appointment status enum
DO $$ BEGIN
    CREATE TYPE appointment_status AS ENUM (
        'SCHEDULED',
        'CONFIRMED',
        'CHECKED_IN',
        'IN_PROGRESS',
        'COMPLETED',
        'CANCELLED',
        'NO_SHOW',
        'RESCHEDULED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Appointment type enum
DO $$ BEGIN
    CREATE TYPE appointment_type AS ENUM (
        'CONSULTATION',
        'FOLLOW_UP',
        'EMERGENCY',
        'ROUTINE_CHECKUP',
        'PROCEDURE',
        'SURGERY',
        'THERAPY',
        'VACCINATION',
        'LAB_WORK',
        'IMAGING'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Gender enum
DO $$ BEGIN
    CREATE TYPE gender AS ENUM (
        'MALE',
        'FEMALE',
        'OTHER',
        'PREFER_NOT_TO_SAY'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Marital status enum
DO $$ BEGIN
    CREATE TYPE marital_status AS ENUM (
        'SINGLE',
        'MARRIED',
        'DIVORCED',
        'WIDOWED',
        'SEPARATED',
        'DOMESTIC_PARTNER'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Blood type enum
DO $$ BEGIN
    CREATE TYPE blood_type AS ENUM (
        'A_POSITIVE',
        'A_NEGATIVE',
        'B_POSITIVE',
        'B_NEGATIVE',
        'AB_POSITIVE',
        'AB_NEGATIVE',
        'O_POSITIVE',
        'O_NEGATIVE',
        'UNKNOWN'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Insurance status enum
DO $$ BEGIN
    CREATE TYPE insurance_status AS ENUM (
        'ACTIVE',
        'INACTIVE',
        'PENDING',
        'EXPIRED',
        'CANCELLED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Payment status enum
DO $$ BEGIN
    CREATE TYPE payment_status AS ENUM (
        'PENDING',
        'PAID',
        'PARTIAL',
        'OVERDUE',
        'CANCELLED',
        'REFUNDED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Notification type enum
DO $$ BEGIN
    CREATE TYPE notification_type AS ENUM (
        'APPOINTMENT_REMINDER',
        'APPOINTMENT_CONFIRMATION',
        'APPOINTMENT_CANCELLATION',
        'LAB_RESULTS',
        'PRESCRIPTION_READY',
        'PAYMENT_DUE',
        'SYSTEM_ALERT',
        'SECURITY_ALERT',
        'GENERAL'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Notification status enum
DO $$ BEGIN
    CREATE TYPE notification_status AS ENUM (
        'PENDING',
        'SENT',
        'DELIVERED',
        'READ',
        'FAILED'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- File type enum
DO $$ BEGIN
    CREATE TYPE file_type AS ENUM (
        'DOCUMENT',
        'IMAGE',
        'VIDEO',
        'AUDIO',
        'MEDICAL_IMAGE',
        'LAB_REPORT',
        'PRESCRIPTION',
        'INSURANCE_CARD',
        'ID_DOCUMENT',
        'OTHER'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Audit action enum
DO $$ BEGIN
    CREATE TYPE audit_action AS ENUM (
        'CREATE',
        'READ',
        'UPDATE',
        'DELETE',
        'LOGIN',
        'LOGOUT',
        'EXPORT',
        'IMPORT',
        'BACKUP',
        'RESTORE'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- Create utility functions
-- ============================================================================

-- Function to generate secure random strings
CREATE OR REPLACE FUNCTION generate_random_string(length INTEGER)
RETURNS TEXT AS $$
BEGIN
    RETURN array_to_string(
        ARRAY(
            SELECT chr((65 + round(random() * 25))::INTEGER)
            FROM generate_series(1, length)
        ),
        ''
    );
END;
$$ LANGUAGE plpgsql;

-- Function to encrypt sensitive data
CREATE OR REPLACE FUNCTION encrypt_data(data TEXT, key TEXT)
RETURNS TEXT AS $$
BEGIN
    RETURN encode(pgp_sym_encrypt(data, key), 'base64');
END;
$$ LANGUAGE plpgsql;

-- Function to decrypt sensitive data
CREATE OR REPLACE FUNCTION decrypt_data(encrypted_data TEXT, key TEXT)
RETURNS TEXT AS $$
BEGIN
    RETURN pgp_sym_decrypt(decode(encrypted_data, 'base64'), key);
END;
$$ LANGUAGE plpgsql;

-- Function to generate patient ID
CREATE OR REPLACE FUNCTION generate_patient_id()
RETURNS TEXT AS $$
DECLARE
    new_id TEXT;
    exists BOOLEAN;
BEGIN
    LOOP
        new_id := 'P' || LPAD((EXTRACT(YEAR FROM NOW())::TEXT), 4, '0') || 
                  LPAD((EXTRACT(DOY FROM NOW())::TEXT), 3, '0') || 
                  LPAD((FLOOR(RANDOM() * 10000)::TEXT), 4, '0');
        
        -- Check if ID already exists (assuming patients table exists)
        -- SELECT EXISTS(SELECT 1 FROM patients WHERE patient_id = new_id) INTO exists;
        -- For now, assume it doesn't exist
        exists := FALSE;
        
        EXIT WHEN NOT exists;
    END LOOP;
    
    RETURN new_id;
END;
$$ LANGUAGE plpgsql;

-- Function to generate appointment number
CREATE OR REPLACE FUNCTION generate_appointment_number()
RETURNS TEXT AS $$
DECLARE
    new_number TEXT;
    exists BOOLEAN;
BEGIN
    LOOP
        new_number := 'APT' || TO_CHAR(NOW(), 'YYYYMMDD') || 
                     LPAD((FLOOR(RANDOM() * 10000)::TEXT), 4, '0');
        
        -- Check if number already exists (assuming appointments table exists)
        -- SELECT EXISTS(SELECT 1 FROM appointments WHERE appointment_number = new_number) INTO exists;
        -- For now, assume it doesn't exist
        exists := FALSE;
        
        EXIT WHEN NOT exists;
    END LOOP;
    
    RETURN new_number;
END;
$$ LANGUAGE plpgsql;

-- Function to generate invoice number
CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TEXT AS $$
DECLARE
    new_number TEXT;
    exists BOOLEAN;
BEGIN
    LOOP
        new_number := 'INV' || TO_CHAR(NOW(), 'YYYYMM') || 
                     LPAD((FLOOR(RANDOM() * 100000)::TEXT), 5, '0');
        
        -- Check if number already exists (assuming invoices table exists)
        -- SELECT EXISTS(SELECT 1 FROM invoices WHERE invoice_number = new_number) INTO exists;
        -- For now, assume it doesn't exist
        exists := FALSE;
        
        EXIT WHEN NOT exists;
    END LOOP;
    
    RETURN new_number;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Create audit trigger function
-- ============================================================================

CREATE OR REPLACE FUNCTION audit.audit_trigger_function()
RETURNS TRIGGER AS $$
DECLARE
    audit_row audit.audit_logs%ROWTYPE;
    include_values BOOLEAN = TRUE;
    log_diffs BOOLEAN = TRUE;
    excluded_cols TEXT[] = ARRAY[]::TEXT[];
BEGIN
    IF TG_WHEN <> 'AFTER' THEN
        RAISE EXCEPTION 'audit.audit_trigger_function() may only run as an AFTER trigger';
    END IF;

    audit_row = ROW(
        nextval('audit.audit_logs_id_seq'),  -- id
        TG_TABLE_SCHEMA::TEXT,               -- schema_name
        TG_TABLE_NAME::TEXT,                 -- table_name
        TG_RELID,                           -- relid
        session_user::TEXT,                 -- session_user_name
        current_timestamp,                  -- action_tstamp_tx
        statement_timestamp(),              -- action_tstamp_stm
        clock_timestamp(),                  -- action_tstamp_clk
        txid_current(),                     -- transaction_id
        current_setting('application_name'), -- application_name
        inet_client_addr(),                 -- client_addr
        inet_client_port(),                 -- client_port
        current_query(),                    -- client_query
        substring(TG_OP, 1, 1),            -- action
        NULL,                               -- row_data
        NULL,                               -- changed_fields
        FALSE                               -- statement_only
    );

    IF NOT TG_ARGV[0]::BOOLEAN IS DISTINCT FROM 'f'::BOOLEAN THEN
        audit_row.client_query = NULL;
    END IF;

    IF TG_ARGV[1] IS NOT NULL THEN
        excluded_cols = TG_ARGV[1]::TEXT[];
    END IF;

    IF (TG_OP = 'UPDATE' AND TG_LEVEL = 'ROW') THEN
        audit_row.row_data = hstore(OLD.*) - excluded_cols;
        audit_row.changed_fields = (hstore(NEW.*) - audit_row.row_data) - excluded_cols;
        IF audit_row.changed_fields = hstore('') THEN
            -- All changed fields are ignored. Skip this update.
            RETURN NULL;
        END IF;
    ELSIF (TG_OP = 'DELETE' AND TG_LEVEL = 'ROW') THEN
        audit_row.row_data = hstore(OLD.*) - excluded_cols;
    ELSIF (TG_OP = 'INSERT' AND TG_LEVEL = 'ROW') THEN
        audit_row.row_data = hstore(NEW.*) - excluded_cols;
    ELSIF (TG_LEVEL = 'STATEMENT' AND TG_OP IN ('INSERT','UPDATE','DELETE','TRUNCATE')) THEN
        audit_row.statement_only = 't';
    ELSE
        RAISE EXCEPTION '[audit.audit_trigger_function] - Trigger func added as trigger for unhandled case: %, %',TG_OP, TG_LEVEL;
        RETURN NULL;
    END IF;

    INSERT INTO audit.audit_logs VALUES (audit_row.*);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- Create indexes for better performance
-- ============================================================================

-- Note: These will be created by Prisma migrations, but we can prepare for them

-- Common indexes that will be useful
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON users(email);
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_role ON users(role);
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_patients_mrn ON patients(medical_record_number);
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_appointments_date ON appointments(appointment_date);
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_appointments_status ON appointments(status);

-- ============================================================================
-- Set up row-level security (RLS) policies
-- ============================================================================

-- Enable RLS on sensitive tables (will be done in Prisma migrations)
-- ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE medical_records ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Create database roles and permissions
-- ============================================================================

-- Application role for the backend service
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'nova_check_app') THEN
        CREATE ROLE nova_check_app WITH LOGIN PASSWORD 'app_password_change_me';
    END IF;
END
$$;

-- Read-only role for reporting
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'nova_check_readonly') THEN
        CREATE ROLE nova_check_readonly WITH LOGIN PASSWORD 'readonly_password_change_me';
    END IF;
END
$$;

-- Backup role
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'nova_check_backup') THEN
        CREATE ROLE nova_check_backup WITH LOGIN PASSWORD 'backup_password_change_me';
    END IF;
END
$$;

-- Grant permissions to application role
GRANT CONNECT ON DATABASE nova_check_ehr TO nova_check_app;
GRANT USAGE ON SCHEMA public TO nova_check_app;
GRANT USAGE ON SCHEMA audit TO nova_check_app;
GRANT USAGE ON SCHEMA analytics TO nova_check_app;

-- Grant permissions to read-only role
GRANT CONNECT ON DATABASE nova_check_ehr TO nova_check_readonly;
GRANT USAGE ON SCHEMA public TO nova_check_readonly;
GRANT USAGE ON SCHEMA analytics TO nova_check_readonly;

-- Grant permissions to backup role
GRANT CONNECT ON DATABASE nova_check_ehr TO nova_check_backup;

-- ============================================================================
-- Create configuration table for application settings
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_config (
    id SERIAL PRIMARY KEY,
    key VARCHAR(255) UNIQUE NOT NULL,
    value TEXT,
    description TEXT,
    category VARCHAR(100),
    is_encrypted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default configuration values
INSERT INTO app_config (key, value, description, category) VALUES
    ('app.name', 'Nova Check EHR', 'Application name', 'general'),
    ('app.version', '1.0.0', 'Application version', 'general'),
    ('app.timezone', 'UTC', 'Default application timezone', 'general'),
    ('security.password_min_length', '8', 'Minimum password length', 'security'),
    ('security.password_require_uppercase', 'true', 'Require uppercase in passwords', 'security'),
    ('security.password_require_lowercase', 'true', 'Require lowercase in passwords', 'security'),
    ('security.password_require_numbers', 'true', 'Require numbers in passwords', 'security'),
    ('security.password_require_symbols', 'true', 'Require symbols in passwords', 'security'),
    ('security.max_login_attempts', '5', 'Maximum login attempts before lockout', 'security'),
    ('security.lockout_duration_minutes', '30', 'Account lockout duration in minutes', 'security'),
    ('notifications.email_enabled', 'true', 'Enable email notifications', 'notifications'),
    ('notifications.sms_enabled', 'true', 'Enable SMS notifications', 'notifications'),
    ('appointments.default_duration_minutes', '30', 'Default appointment duration', 'appointments'),
    ('appointments.reminder_hours_before', '24', 'Hours before appointment to send reminder', 'appointments'),
    ('files.max_upload_size_mb', '10', 'Maximum file upload size in MB', 'files'),
    ('audit.retention_days', '2555', 'Audit log retention period in days (7 years)', 'audit')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- Create system health check function
-- ============================================================================

CREATE OR REPLACE FUNCTION system_health_check()
RETURNS JSON AS $$
DECLARE
    result JSON;
    db_size BIGINT;
    connection_count INTEGER;
    active_connections INTEGER;
BEGIN
    -- Get database size
    SELECT pg_database_size(current_database()) INTO db_size;
    
    -- Get connection counts
    SELECT count(*) FROM pg_stat_activity INTO connection_count;
    SELECT count(*) FROM pg_stat_activity WHERE state = 'active' INTO active_connections;
    
    -- Build result JSON
    result := json_build_object(
        'timestamp', NOW(),
        'database', json_build_object(
            'name', current_database(),
            'size_bytes', db_size,
            'size_mb', ROUND(db_size / 1024.0 / 1024.0, 2),
            'version', version()
        ),
        'connections', json_build_object(
            'total', connection_count,
            'active', active_connections,
            'max', current_setting('max_connections')::INTEGER
        ),
        'extensions', (
            SELECT json_agg(extname) 
            FROM pg_extension 
            WHERE extname IN ('uuid-ossp', 'pgcrypto', 'pg_trgm', 'unaccent')
        ),
        'schemas', (
            SELECT json_agg(schema_name) 
            FROM information_schema.schemata 
            WHERE schema_name IN ('public', 'audit', 'analytics', 'archive')
        )
    );
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Final setup and permissions
-- ============================================================================

-- Update search path for application role
ALTER ROLE nova_check_app SET search_path = public, audit, analytics;

-- Set timezone
SET timezone = 'UTC';

-- Log successful initialization
DO $$
BEGIN
    RAISE NOTICE 'Nova Check EHR database initialization completed successfully!';
    RAISE NOTICE 'Database: %', current_database();
    RAISE NOTICE 'Timestamp: %', NOW();
END
$$;

-- ============================================================================
-- END OF INITIALIZATION SCRIPT
-- ============================================================================