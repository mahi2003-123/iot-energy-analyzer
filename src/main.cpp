/**
 * ============================================================================
 * Smart Energy Consumption & Electricity Cost Analyzer - ESP32 Firmware
 * Connection Mode: WIRED USB SERIAL (Web Serial API at 115200 baud)
 * Clean, Ultra-Reliable DC Motor & Energy Metering
 * ============================================================================
 */

#include <Arduino.h>

/* ==========================================================================
   1. SENSOR & HARDWARE CONFIGURATION
   ========================================================================== */

int SENSOR_PIN = 34; // ESP32 ADC pin (GPIO34 default, auto-checks GPIO35/32 if 34 is empty)
const int SCAN_PINS[] = {34, 35, 32, 33, 36};
const int NUM_SCAN_PINS = 5;

// Sensor calibration parameters (adjustable dynamically over Web Serial)
float sensorSensitivityMvPerA = 100.0f; // ACS712-20A: 100, ACS712-05B: 185, ACS712-30A: 66
float voltageDividerRatio     = 0.50f;  // 10k + 10k divider = 0.50. Direct wire = 1.0
float loadVoltage             = 5.0f;   // Fixed 5.0V DC supply
float currentDeadband         = 0.015f; // 15mA sensitivity deadband (clean zero at idle)

const unsigned long SERIAL_INTERVAL_MS = 1000; // Stream readings every 1.0 second

/* ==========================================================================
   2. SYSTEM STATE VARIABLES
   ========================================================================== */

float zeroAdcMilliVolts    = 1250.0f; // Resting voltage directly at the ESP32 pin
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
   3. ADC READING & PIN AUTO-DETECTION
   ========================================================================== */

float readAdcMilliVoltsAverage(int pin) {
  uint32_t total = 0;
  const int SAMPLES = 60;
  for (int i = 0; i < SAMPLES; i++) {
    total += analogReadMilliVolts(pin);
    delayMicroseconds(250);
  }
  return (float)total / (float)SAMPLES;
}

int detectActiveSensorPin() {
  float mv34 = readAdcMilliVoltsAverage(SENSOR_PIN);
  if (mv34 >= 400.0f && mv34 <= 3100.0f) {
    return SENSOR_PIN;
  }
  // If default pin has no voltage, check other ADC1 pins in case of breadboard offset
  for (int i = 0; i < NUM_SCAN_PINS; i++) {
    int p = SCAN_PINS[i];
    float mv = readAdcMilliVoltsAverage(p);
    if (mv >= 400.0f && mv <= 3100.0f) {
      return p;
    }
  }
  return SENSOR_PIN;
}

void calibrateZeroOffset() {
  SENSOR_PIN = detectActiveSensorPin();
  pinMode(SENSOR_PIN, INPUT);

  // Average over 80 samples for a stable resting zero baseline
  float total = 0.0f;
  for (int i = 0; i < 80; i++) {
    total += readAdcMilliVoltsAverage(SENSOR_PIN);
    delay(5);
  }
  zeroAdcMilliVolts = total / 80.0f;
  rawAdcMilliVolts = zeroAdcMilliVolts;
}

/* ==========================================================================
   4. MEASUREMENTS & ENERGY CALCULATION
   ========================================================================== */

void performMeasurements() {
  unsigned long now = millis();

  // Read current voltage at ESP32 pin
  rawAdcMilliVolts = readAdcMilliVoltsAverage(SENSOR_PIN);

  // Compute shift from resting zero baseline
  float deltaAdcMv = rawAdcMilliVolts - zeroAdcMilliVolts;

  // Reconstruct sensor delta before voltage divider
  if (voltageDividerRatio <= 0.01f) voltageDividerRatio = 0.50f;
  lastDeltaMv = fabs(deltaAdcMv) / voltageDividerRatio;

  // Current (A) = Delta (mV) / Sensitivity (mV/A)
  float rawCurrent = lastDeltaMv / sensorSensitivityMvPerA;

  // Apply noise deadband
  if (rawCurrent < currentDeadband) {
    rawCurrent = 0.0f;
  }
  currentAmperes = rawCurrent;

  // Power (W) = Voltage (V) × Current (A)
  powerWatts = loadVoltage * currentAmperes;

  // Energy accumulation
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

/* ==========================================================================
   5. INCOMING WEB SERIAL COMMANDS
   ========================================================================== */

void checkIncomingSerialCommands() {
  while (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();

    if (cmd == "ZERO" || cmd == "TARE" || cmd == "CALIBRATE" || cmd == "RESET_ZERO") {
      calibrateZeroOffset();
    } else if (cmd.startsWith("PIN:")) {
      int p = cmd.substring(4).toInt();
      if (p == 34 || p == 35 || p == 32 || p == 33 || p == 36) {
        SENSOR_PIN = p;
        pinMode(SENSOR_PIN, INPUT);
        calibrateZeroOffset();
      }
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
   6. ARDUINO SETUP & MAIN LOOP
   ========================================================================== */

void setup() {
  Serial.begin(115200);
  delay(500);

  analogSetAttenuation(ADC_11db);

  SENSOR_PIN = detectActiveSensorPin();
  pinMode(SENSOR_PIN, INPUT);

  calibrateZeroOffset();

  lastSerialTime     = millis();
  lastEnergyCalcTime = millis();
}

void loop() {
  checkIncomingSerialCommands();

  unsigned long now = millis();

  if (now - lastSerialTime >= SERIAL_INTERVAL_MS) {
    lastSerialTime = now;

    performMeasurements();

    // Stream clean single-line JSON telemetry packet
    Serial.print("{\"device\":\"ESP32 ACS712 Monitor\",");
    Serial.print("\"pin\":");        Serial.print(SENSOR_PIN);                 Serial.print(",");
    Serial.print("\"voltage\":");    Serial.print(loadVoltage, 2);              Serial.print(",");
    Serial.print("\"current\":");    Serial.print(currentAmperes, 3);          Serial.print(",");
    Serial.print("\"power\":");      Serial.print(powerWatts, 2);              Serial.print(",");
    Serial.print("\"energy\":");     Serial.print(accumulatedKWh, 5);          Serial.print(",");
    Serial.print("\"cost\":");       Serial.print(estimatedCostRupees, 4);     Serial.print(",");
    Serial.print("\"raw_mv\":");     Serial.print(rawAdcMilliVolts, 1);        Serial.print(",");
    Serial.print("\"zero_mv\":");    Serial.print(zeroAdcMilliVolts, 1);       Serial.print(",");
    Serial.print("\"delta_mv\":");   Serial.print(lastDeltaMv, 1);
    Serial.println("}");
  }
}
