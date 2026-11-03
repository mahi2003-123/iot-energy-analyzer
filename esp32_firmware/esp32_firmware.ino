/**
 * ============================================================================
 * Smart Energy Consumption & Electricity Cost Analyzer - ESP32 Firmware
 * Connection Mode: WIRED USB SERIAL (Web Serial API at 115200 baud)
 * Enhanced: Dual True-RMS & DC Motor Sensing + Two-Way Calibration
 * ============================================================================
 */

#include <Arduino.h>
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"

/* ==========================================================================
   1. CONFIGURATION & SENSOR PARAMETERS
   ========================================================================== */

int SENSOR_PIN = 34; // ESP32 ADC pin (Auto-detected: GPIO34, GPIO35, GPIO32, GPIO33, GPIO36)
const int SCAN_PINS[] = {34, 35, 32, 33, 36, 39};
const int NUM_SCAN_PINS = 6;

int detectActiveSensorPin() {
  // If current pin already has a healthy sensor resting voltage (500mV to 3100mV), use it
  int curMv = analogReadMilliVolts(SENSOR_PIN);
  if (curMv >= 500 && curMv <= 3100) {
    return SENSOR_PIN;
  }
  // Otherwise scan all ADC1 pins for the pin where ACS712 is physically wired
  for (int i = 0; i < NUM_SCAN_PINS; i++) {
    int p = SCAN_PINS[i];
    int mv = analogReadMilliVolts(p);
    if (mv >= 500 && mv <= 3100) {
      return p;
    }
  }
  return SENSOR_PIN;
}

// Sensor Parameters (Adjustable over USB Serial)
float sensorSensitivityMvPerA = 100.0f; // ACS712-20A: 100, ACS712-05B: 185, ACS712-30A: 66
float voltageDividerRatio     = 0.50f;  // 10k + 10k divider = 0.50. Direct wire = 1.0
float loadVoltage             = 5.0f;   // Fixed 5.0V DC supply
float currentDeadband         = 0.008f; // 8mA sensitivity threshold

// Timing
const unsigned long SERIAL_INTERVAL_MS = 1000; // Stream readings every 1.0 second

/* ==========================================================================
   2. SYSTEM STATE VARIABLES
   ========================================================================== */

float zeroCurrentSensorMv  = 2500.0f; // Sensor resting voltage
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

void calibrateZeroCurrentOffset() {
  SENSOR_PIN = detectActiveSensorPin();
  pinMode(SENSOR_PIN, INPUT);
  uint32_t totalMv = 0;
  const int CAL_SAMPLES = 100;
  for (int i = 0; i < CAL_SAMPLES; i++) {
    totalMv += analogReadMilliVolts(SENSOR_PIN);
    delay(5);
  }
  rawAdcMilliVolts = (float)totalMv / (float)CAL_SAMPLES;
  if (voltageDividerRatio <= 0.01f) voltageDividerRatio = 0.50f;
  zeroCurrentSensorMv = rawAdcMilliVolts / voltageDividerRatio;
}

void performMeasurements() {
  unsigned long now = millis();

  // Measure 100 samples over a 100ms window (captures both DC offset & AC brush ripple)
  const int SAMPLES = 100;
  float sumMv = 0.0f;
  float sumSqDiff = 0.0f;
  float expectedZeroAdcMv = zeroCurrentSensorMv * voltageDividerRatio;

  for (int i = 0; i < SAMPLES; i++) {
    float mv = (float)analogReadMilliVolts(SENSOR_PIN);
    sumMv += mv;
    float diff = mv - expectedZeroAdcMv;
    sumSqDiff += diff * diff;
    delayMicroseconds(1000); // 1ms interval
  }

  rawAdcMilliVolts = sumMv / (float)SAMPLES;
  float currentSensorMv = rawAdcMilliVolts / voltageDividerRatio;

  // 1. Mean DC Shift
  float dcDeltaMv = currentSensorMv - zeroCurrentSensorMv;

  // 2. True-RMS AC/Ripple Shift (at sensor output)
  float rmsAdcMv = sqrt(sumSqDiff / (float)SAMPLES);
  float rmsSensorMv = rmsAdcMv / voltageDividerRatio;

  // Use the stronger signal: captures DC motors, commutator ripple, and AC loads
  float effectiveDeltaMv = (fabs(dcDeltaMv) > rmsSensorMv) ? fabs(dcDeltaMv) : rmsSensorMv;
  lastDeltaMv = effectiveDeltaMv;

  // Current (A) = Delta_mV / Sensitivity (mV/A)
  float rawCurrent = effectiveDeltaMv / sensorSensitivityMvPerA;

  // Apply noise deadband
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

void checkIncomingSerialCommands() {
  while (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();

    if (cmd == "ZERO" || cmd == "TARE" || cmd == "CALIBRATE" || cmd == "RESET_ZERO" || cmd == "DEFAULT_ZERO") {
      calibrateZeroCurrentOffset();
    } else if (cmd.startsWith("PIN:")) {
      int p = cmd.substring(4).toInt();
      if (p == 34 || p == 35 || p == 32 || p == 33 || p == 36 || p == 39) {
        SENSOR_PIN = p;
        pinMode(SENSOR_PIN, INPUT);
        calibrateZeroCurrentOffset();
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
   4. ARDUINO SETUP & MAIN LOOP
   ========================================================================== */

void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0); // Disable brownout detector to prevent motor inrush resets
  Serial.begin(115200);
  delay(400);

  analogSetAttenuation(ADC_11db);
  pinMode(SENSOR_PIN, INPUT);

  // Calibrate zero-current offset at boot while motor is idle
  calibrateZeroCurrentOffset();

  lastSerialTime     = millis();
  lastEnergyCalcTime = millis();
}

void loop() {
  checkIncomingSerialCommands();

  unsigned long now = millis();

  if (now - lastSerialTime >= SERIAL_INTERVAL_MS) {
    lastSerialTime = now;

    performMeasurements();

    // Telemetry packet with diagnostics
    Serial.print("{\"device\":\"ESP32 ACS712 Monitor\",");
    Serial.print("\"pin\":");        Serial.print(SENSOR_PIN);                 Serial.print(",");
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