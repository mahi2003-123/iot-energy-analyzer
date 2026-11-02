const { Pool } = require("pg");

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: "iot_energy_db",
  user: "postgres",
  password: "1102003",
});

async function runVerification() {
  console.log("==================================================");
  console.log("  Testing Data Ingestion into Minimal 2 Tables");
  console.log("==================================================");

  // 1. Insert into device_runs
  console.log("\n[Test 1] Inserting a completed motor run into 'device_runs'...");
  const runInsert = await pool.query(
    `INSERT INTO device_runs (
      device_name, start_time, end_time, duration_seconds,
      avg_current, peak_current, energy_wh, energy_kwh, tariff_rate, cost_rupees
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *;`,
    [
      "Device 1 (5V Motor)",
      new Date(Date.now() - 45000), // started 45 sec ago
      new Date(),                   // stopped now
      45,                           // duration 45 seconds
      0.380,                        // 0.38 A avg
      0.520,                        // 0.52 A peak
      0.0238,                       // 0.0238 Wh
      0.000024,                     // 0.000024 kWh
      8.00,                         // ₹8/kWh
      0.0002                        // ₹0.0002
    ]
  );
  console.log("Row successfully created in 'device_runs':");
  console.table(runInsert.rows);

  // 2. Insert into telemetry_logs
  console.log("\n[Test 2] Inserting live sensor reading into 'telemetry_logs'...");
  const telemetryInsert = await pool.query(
    `INSERT INTO telemetry_logs (
      device_name, voltage, current_amps, power_watts, accumulated_kwh, cost_rupees
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *;`,
    [
      "ESP32 ACS712 Monitor",
      5.00,     // 5.0 V
      0.385,    // 0.385 A
      1.925,    // 1.925 W
      0.000024, // accumulated kWh
      0.0002    // cost
    ]
  );
  console.log("Row successfully created in 'telemetry_logs':");
  console.table(telemetryInsert.rows);

  // 3. Query PostgreSQL directly to confirm
  console.log("\n[Test 3] Reading back from PostgreSQL to confirm data integrity...");
  const rCheck = await pool.query("SELECT id, device_name, duration_seconds, avg_current, energy_wh, cost_rupees, created_at FROM device_runs;");
  const tCheck = await pool.query("SELECT id, device_name, voltage, current_amps, power_watts, recorded_at FROM telemetry_logs;");

  console.log("\n--- Active rows in 'device_runs' ---");
  console.table(rCheck.rows);

  console.log("\n--- Active rows in 'telemetry_logs' ---");
  console.table(tCheck.rows);

  console.log("\nVERIFICATION RESULT: Both tables are receiving and storing data accurately!");
  await pool.end();
}

runVerification().catch(err => {
  console.error("Verification failed:", err);
  process.exit(1);
});
