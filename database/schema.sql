-- ============================================================================
-- Smart Energy Consumption & Electricity Cost Analyzer
-- Minimal 2-Table PostgreSQL Schema: iot_energy_db
-- ============================================================================

-- Clean up any previous tables or views
DROP VIEW IF EXISTS v_device_summary CASCADE;
DROP VIEW IF EXISTS v_daily_summary CASCADE;
DROP VIEW IF EXISTS v_recent_runs CASCADE;
DROP TABLE IF EXISTS telemetry_logs CASCADE;
DROP TABLE IF EXISTS machine_runs CASCADE;
DROP TABLE IF EXISTS tariff_settings CASCADE;
DROP TABLE IF EXISTS devices CASCADE;
DROP TABLE IF EXISTS device_runs CASCADE;
DROP TABLE IF EXISTS telemetry_readings CASCADE;

-- ============================================================================
-- TABLE 1: device_runs
-- Stores completed motor sessions (between motor ON and OFF, or manual log)
-- ============================================================================
CREATE TABLE device_runs (
    id SERIAL PRIMARY KEY,
    device_name VARCHAR(100) NOT NULL DEFAULT 'Device 1 (5V Motor)',
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    duration_seconds INT NOT NULL,
    avg_current NUMERIC(8, 3) NOT NULL DEFAULT 0.0,
    peak_current NUMERIC(8, 3) NOT NULL DEFAULT 0.0,
    energy_wh NUMERIC(12, 4) NOT NULL DEFAULT 0.0,
    energy_kwh NUMERIC(14, 6) NOT NULL DEFAULT 0.0,
    tariff_rate NUMERIC(8, 2) NOT NULL DEFAULT 8.00,
    cost_rupees NUMERIC(10, 4) NOT NULL DEFAULT 0.0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- TABLE 2: telemetry_logs
-- Stores real-time sensor measurements streamed from ESP32
-- ============================================================================
CREATE TABLE telemetry_logs (
    id BIGSERIAL PRIMARY KEY,
    device_name VARCHAR(100) NOT NULL DEFAULT 'ESP32 ACS712 Monitor',
    voltage NUMERIC(6, 2) NOT NULL DEFAULT 5.00,
    current_amps NUMERIC(8, 3) NOT NULL DEFAULT 0.0,
    power_watts NUMERIC(8, 2) NOT NULL DEFAULT 0.0,
    accumulated_kwh NUMERIC(14, 6) NOT NULL DEFAULT 0.0,
    cost_rupees NUMERIC(10, 4) NOT NULL DEFAULT 0.0,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_device_runs_time ON device_runs(start_time DESC);
CREATE INDEX idx_telemetry_time ON telemetry_logs(recorded_at DESC);
