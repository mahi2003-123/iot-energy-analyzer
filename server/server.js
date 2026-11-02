const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve static frontend files (index.html, style.css, script.js)
const publicDir = path.join(__dirname, "..");
app.use(express.static(publicDir));

// Database connection configuration (supports Neon PostgreSQL via DATABASE_URL or local Postgres)
const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    }
  : {
      host: process.env.DB_HOST || "localhost",
      port: parseInt(process.env.DB_PORT || "5432", 10),
      database: process.env.DB_NAME || "iot_energy_db",
      user: process.env.DB_USER || "postgres",
      password: process.env.DB_PASSWORD || "1102003",
    };

const pool = new Pool(poolConfig);

// Auto-initialize 2 minimal tables on startup (works seamlessly on fresh Neon DB)
async function initDatabaseTables() {
  const initSql = `
    CREATE TABLE IF NOT EXISTS device_runs (
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

    CREATE TABLE IF NOT EXISTS telemetry_logs (
      id BIGSERIAL PRIMARY KEY,
      device_name VARCHAR(100) NOT NULL DEFAULT 'ESP32 ACS712 Monitor',
      voltage NUMERIC(6, 2) NOT NULL DEFAULT 5.00,
      current_amps NUMERIC(8, 3) NOT NULL DEFAULT 0.0,
      power_watts NUMERIC(8, 2) NOT NULL DEFAULT 0.0,
      accumulated_kwh NUMERIC(14, 6) NOT NULL DEFAULT 0.0,
      cost_rupees NUMERIC(10, 4) NOT NULL DEFAULT 0.0,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `;
  try {
    await pool.query(initSql);
    console.log("[PostgreSQL] Tables (device_runs, telemetry_logs) verified and ready.");
  } catch (err) {
    console.error("[PostgreSQL] Error initializing tables:", err.message);
  }
}

// 1. Health check & table row counts
app.get("/api/health", async (req, res) => {
  try {
    const runsCount = await pool.query("SELECT COUNT(*) FROM device_runs;");
    const telemetryCount = await pool.query("SELECT COUNT(*) FROM telemetry_logs;");
    res.json({
      status: "ok",
      connected: true,
      database: process.env.DATABASE_URL ? "Neon Cloud Postgres" : "Local Postgres",
      counts: {
        device_runs: parseInt(runsCount.rows[0].count, 10),
        telemetry_logs: parseInt(telemetryCount.rows[0].count, 10)
      }
    });
  } catch (err) {
    res.status(500).json({ status: "error", connected: false, message: err.message });
  }
});

// 2. GET recent motor runs from `device_runs`
app.get("/api/runs", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || "50", 10);
    const result = await pool.query(
      "SELECT * FROM device_runs ORDER BY id DESC LIMIT $1;",
      [limit]
    );
    res.json({ success: true, count: result.rows.length, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. POST save motor run into `device_runs`
app.post("/api/runs", async (req, res) => {
  try {
    const {
      deviceName,
      startTime,
      endTime,
      durationSeconds,
      avgCurrent,
      peakCurrent,
      energyWh,
      energyKWh,
      tariffRate,
      costRupees
    } = req.body;

    const query = `
      INSERT INTO device_runs (
        device_name, start_time, end_time, duration_seconds,
        avg_current, peak_current, energy_wh, energy_kwh,
        tariff_rate, cost_rupees
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *;
    `;

    const values = [
      deviceName || "Device 1 (5V Motor)",
      startTime ? new Date(startTime) : new Date(),
      endTime ? new Date(endTime) : new Date(),
      durationSeconds || 1,
      parseFloat(avgCurrent || 0.0),
      parseFloat(peakCurrent || avgCurrent || 0.0),
      parseFloat(energyWh || 0.0),
      parseFloat(energyKWh || (energyWh ? energyWh / 1000.0 : 0.0)),
      parseFloat(tariffRate || 8.00),
      parseFloat(costRupees || 0.0)
    ];

    const result = await pool.query(query, values);
    console.log(`[DB] Logged run for "${values[0]}": ${values[3]}s, ${values[6]} Wh, ₹${values[9]}`);
    res.status(201).json({ success: true, saved_row: result.rows[0] });
  } catch (err) {
    console.error("[DB Error] Failed to insert run:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. GET recent live telemetry readings
app.get("/api/telemetry", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || "50", 10);
    const result = await pool.query(
      "SELECT * FROM telemetry_logs ORDER BY id DESC LIMIT $1;",
      [limit]
    );
    res.json({ success: true, count: result.rows.length, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. POST save live telemetry into `telemetry_logs`
app.post("/api/telemetry", async (req, res) => {
  try {
    const { deviceName, voltage, current, power, energy, cost } = req.body;
    const query = `
      INSERT INTO telemetry_logs (
        device_name, voltage, current_amps, power_watts, accumulated_kwh, cost_rupees
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *;
    `;
    const values = [
      deviceName || "ESP32 ACS712 Monitor",
      parseFloat(voltage || 5.0),
      parseFloat(current || 0.0),
      parseFloat(power || 0.0),
      parseFloat(energy || 0.0),
      parseFloat(cost || 0.0)
    ];
    const result = await pool.query(query, values);
    res.status(201).json({ success: true, saved_row: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Fallback to index.html for root path
app.get("*", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.listen(PORT, async () => {
  console.log(`IoT server running at http://localhost:${PORT}`);
  await initDatabaseTables();
});
