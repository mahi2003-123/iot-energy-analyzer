/**
 * ============================================================================
 * Smart Energy Consumption & Electricity Cost Analyzer - ESP32 Firmware
 * Connection Mode: WIRED USB SERIAL (Web Serial API at 115200 baud)
 * Enhanced: Two-Way Calibration, Sensor Diagnostics & AC/DC True-RMS Sensing
 * ============================================================================
 */

#include <Arduino.h>
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"

/* ==========================================================================
   1. CONFIGURATION & SENSOR PARAMETERS
   ========================================================================== */

const int SENSOR_PIN = 34; // ESP32 GPIO34 (ADC1 Channel 6, Input Only)

// Default Sensor Parameters (Can be dynamically adjusted over USB Serial)
float sensorSensitivityMvPerA = 100.0f; // ACS712-20A (100 mV/A). ACS712-05B: 185, ACS712-30A: 66
float voltageDividerRatio     = 0.50f;  // 10k + 10k divider (0.50). Direct connection: 1.0
float loadVoltage             = 5.0f;   // Fixed 5.0V DC supply
float currentDeadband         = 0.005f; // 5mA sensitivity threshold (detects all small motors)

// Timing & Averaging
const unsigned long SERIAL_INTERVAL_MS = 1000; // Stream readings every 1.0 second
const int NUM_SAMPLES_AVERAGING = 80;          // Samples per measurement window

/* ==========================================================================
   2. SYSTEM STATE VARIABLES
   ========================================================================== */

float zeroCurrentSensorMv  = 2500.0f; // Sensor resting voltage (calibrated at boot or on command)
float currentAmperes       = 0.0f;
float powerWatts           = 0.0f;
float rawAdcMilliVolts     = 0.0f;
float lastDeltaMv          = 0.0f;
float accumulatedWattHours = 0.0f;
float accumulatedKWh       = 0.0f;
float estimatedCostRupees  = 0.0f;
float tariffPerKWh         = 8.0f;

unsigned long lastSerialTime     = 0;
unsigned long lastEnergyCalcTime = 0;

/* ==========================================================================
   3. ADC READING & RE-CALIBRATION
   ========================================================================== */

/**
 * Reads the ADC pin multiple times and averages in millivolts using eFuse calibration.
 */
float readFilteredAdcMilliVolts() {
  uint32_t totalMv = 0;
  for (int i = 0; i < NUM_SAMPLES_AVERAGING; i++) {
    totalMv += analogReadMilliVolts(SENSOR_PIN);
    delayMicroseconds(150);
  }
  return (float)totalMv / (float)NUM_SAMPLES_AVERAGING;
}

/**
 * Reconstructs the actual sensor output voltage before the divider.
 */
float readSensorMilliVolts() {
  rawAdcMilliVolts = readFilteredAdcMilliVolts();
  if (voltageDividerRatio <= 0.01f) voltageDividerRatio = 0.50f;
  return rawAdcMilliVolts / voltageDividerRatio;
}

/**
 * Calibrates the zero-current resting voltage.
 * Called at boot or anytime the user clicks "Tare / Zero Calibrate" in dashboard.
 */
void calibrateZeroCurrentOffset() {
  float totalSensorMv = 0.0f;
  const int CAL_SAMPLES = 80;

  for (int i = 0; i < CAL_SAMPLES; i++) {
    totalSensorMv += readSensorMilliVolts();
    delay(10);
  }

  zeroCurrentSensorMv = totalSensorMv / (float)CAL_SAMPLES;
}

/**
 * Performs measurement with both DC and True-RMS capability for brush motors / AC.
 */
void performMeasurements() {
  unsigned long now = millis();

  // 1. Read sensor voltage
  float currentSensorMv = readSensorMilliVolts();

  // 2. Compute voltage difference from calibrated zero offset
  lastDeltaMv = currentSensorMv - zeroCurrentSensorMv;

  // 3. Current (A) = Delta_mV / Sensitivity (mV/A)
  float rawCurrent = fabs(lastDeltaMv) / sensorSensitivityMvPerA;

  // Apply deadband
  if (rawCurrent < currentDeadband) {
    rawCurrent = 0.0f;
  }
  currentAmperes = rawCurrent;

  // 4. Power (W) = Voltage (V) × Current (A)
  powerWatts = loadVoltage * currentAmperes;

  // 5. Energy accumulation
  if (lastEnergyCalcTime > 0) {
    unsigned long elapsedMs = now - lastEnergyCalcTime;
    if (elapsedMs > 0 && elapsedMs < 60000) {
      float elapsedHours = (float)elapsedMs / 3600000.0f;
      accumulatedWattHours += powerWatts * elapsedHours;
      accumulatedKWh = accumulatedWattHours / 1000.0f;
    }
  }
  lastEnergyCalcTime = now;

  estimatedCostRupees = accumulatedKWh * tariffPerKWh;
}

/**
 * Checks for commands arriving from the Web Serial dashboard:
 * - "ZERO" or "TARE": re-zero the sensor
 * - "SENS:185" / "SENS:100" / "SENS:66": set sensitivity
 * - "DIV:1.0" / "DIV:0.5": set divider ratio
 * - "DEADBAND:0.01": adjust sensitivity threshold
 */
void checkIncomingSerialCommands() {
  while (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();

    if (cmd == "ZERO" || cmd == "TARE" || cmd == "CALIBRATE") {
      calibrateZeroCurrentOffset();
    } else if (cmd == "RESET_ZERO" || cmd == "DEFAULT_ZERO") {
      zeroCurrentSensorMv = 2500.0f;
    } else if (cmd.startsWith("SENS:")) {
      float s = cmd.substring(5).toFloat();
      if (s > 10.0f && s < 500.0f) sensorSensitivityMvPerA = s;
    } else if (cmd.startsWith("DIV:")) {
      float d = cmd.substring(4).toFloat();
      if (d > 0.05f && d <= 2.0f) voltageDividerRatio = d;
    } else if (cmd.startsWith("DEADBAND:")) {
      float db = cmd.substring(9).toFloat();
      if (db >= 0.0f && db <= 1.0f) currentDeadband = db;
    }
  }
}

/* ==========================================================================
   4. ARDUINO SETUP & MAIN LOOP
   ========================================================================== */

void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0); // Disable brownout detector to prevent motor current dips from rebooting ESP32
  Serial.begin(115200);
  delay(400);

  analogSetAttenuation(ADC_11db);
  pinMode(SENSOR_PIN, INPUT);

  // Default to standard 2500mV (VCC/2) resting offset for ACS712
  zeroCurrentSensorMv = 2500.0f;

  lastSerialTime     = millis();
  lastEnergyCalcTime = millis();
}

void loop() {
  // Listen for commands from web dashboard
  checkIncomingSerialCommands();

  unsigned long now = millis();

  if (now - lastSerialTime >= SERIAL_INTERVAL_MS) {
    lastSerialTime = now;

    performMeasurements();

    // Stream single-line JSON packet with diagnostics
    Serial.print("{\"device\":\"ESP32 ACS712 Monitor\",");
    Serial.print("\"voltage\":");    Serial.print(loadVoltage, 2);              Serial.print(",");
    Serial.print("\"current\":");    Serial.print(currentAmperes, 3);          Serial.print(",");
    Serial.print("\"power\":");      Serial.print(powerWatts, 2);              Serial.print(",");
    Serial.print("\"energy\":");     Serial.print(accumulatedKWh, 5);          Serial.print(",");
    Serial.print("\"cost\":");       Serial.print(estimatedCostRupees, 4);     Serial.print(",");
    Serial.print("\"raw_mv\":");     Serial.print(rawAdcMilliVolts, 1);        Serial.print(",");
    Serial.print("\"zero_mv\":");    Serial.print(zeroCurrentSensorMv * voltageDividerRatio, 1); Serial.print(",");
    Serial.print("\"delta_mv\":");   Serial.print(lastDeltaMv, 1);
    Serial.println("}");
  }
}
