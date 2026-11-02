# Smart Energy Consumption & Electricity Cost Analyzer
### IoT Embedded Systems Project (ESP32-WROOM-32 + ACS712 + 5V DC Motor + Wired Web Dashboard)

A direct, **wired USB hardware** energy monitoring system. Measures instantaneous DC current from an ACS712 sensor, calculates active power in Watts, accumulates energy in kilowatt-hours (kWh), and estimates electricity costs in Indian Rupees (₹).

---

## 🔌 Wired USB Connection (Zero Simulation)

This project connects **directly to your physical ESP32 via a USB cable** using the modern **Web Serial API**. No simulated data, no Wi-Fi credentials, and no local IP addresses are required.

- **Status when connected**: Shows **"Connected"** and actively streams real measurements.
- **Status when disconnected / unplugged**: Shows **"Disconnected"** and zeros out instantaneous load.

---

## 📁 Project Structure

```text
iot_software/
├── platformio.ini         # PlatformIO project configuration (ESP32-WROOM-32, Arduino framework)
├── src/
│   └── main.cpp           # ESP32 C++ firmware (ACS712 ADC sampling, calibration, USB Serial streaming)
├── index.html             # Clean, responsive web dashboard (Current, Power, kWh, Cost, Chart)
├── style.css              # Minimalist black & white high-contrast stylesheet
├── script.js              # Web Serial API driver & real-time telemetry parser
└── README.md              # Wiring schematic, safety guidelines, and run instructions
```

---

## ⚡ Hardware Wiring & Schematic

### Component Bill of Materials
1. **ESP32-WROOM-32 DevKit** (Connected via USB data cable to your PC).
2. **ACS712 20A Current Sensor Module** (Hall-effect current sensor; $100\,\text{mV/A}$ sensitivity).
3. **5V DC Toy Motor** (Test load).
4. **External 5V DC Power Source** (Regulated power adapter or battery pack).
5. **Two $10\,\text{k}\Omega$ Resistors** (for the mandatory safety voltage divider).
6. **1N4007 Flyback Diode** (across motor terminals to snub inductive back-EMF spikes).
7. **NPN Transistor / N-channel MOSFET or Switch** (to switch the motor on/off).

### Schematic

```text
               +5V External Power Supply
                         │
                         ├───> [ ACS712 IP+ (Terminal 1) ]
                         │
                         │     [ ACS712 IP- (Terminal 2) ] ───> [ 5V DC Motor (+) ]
                         │
                         │     [ 5V DC Motor (-) ] ───> [ Transistor / Switch ] ───> GND (External)
                         │                                                                  │
                         │             ┌─── [ 1N4007 Diode across Motor ] ───┐              │
                         │             └─── (Cathode to +, Anode to -) ──────┘              │
                         │                                                                  │
[ACS712 Module]          │                                                                  │
   VCC ──────────────────┤                                                                  │
   GND ──────────────────┴──────────────────────────────────────────────────────────────────┤ Common GND
   VOUT ────[ 10k Resistor R1 ]──┬──> ESP32 GPIO34 (Analog In)                              │
                                 │                                                          │
                            [ 10k Resistor R2 ]                                             │
                                 │                                                          │
                                GND ────────────────────────────────────────────────────────┘
```

---

## ⚠️ Safety Precautions

> [!CAUTION]
> **1. Voltage Divider is Mandatory:**
> The ACS712 is powered at 5.0V. At 0 Amps, its resting output is $2.50\,\text{V}$ and rises under forward load. The ESP32 ADC pin cannot safely withstand more than $3.3\,\text{V}$. The $10\,\text{k}\Omega + 10\,\text{k}\Omega$ voltage divider cuts the voltage in half ($0.50\times$), keeping the signal safely between $0\,\text{V}$ and $2.5\,\text{V}$.

> [!CAUTION]
> **2. Never Power the DC Motor from ESP32 GPIO:**
> ESP32 pins provide only $12\text{--}40\,\text{mA}$. A 5V DC motor draws $300\text{--}1200\,\text{mA}$ and generates severe inductive voltage spikes. Always power the motor from an external 5V supply with a flyback diode.

---

## 🚀 How to Run

### Step 1: Upload Firmware to ESP32
Connect your ESP32 to your computer using a USB cable:
```powershell
pio run -t upload
```

### Step 2: Open the Dashboard in Google Chrome or Microsoft Edge
Navigate to:
[http://localhost:5500](http://localhost:5500)

### Step 3: Connect via USB
1. Click the **"🔌 Connect ESP32 (USB)"** button.
2. Select your ESP32's COM port in the browser popup and click **Connect**.
3. The dashboard status immediately switches to **"Connected"**.
4. Turn on your 5V DC motor to see live current, power, energy, and cost update in real time.

---

## 🗄️ PostgreSQL Database (Minimal 2 Tables)

The database `iot_energy_db` has been simplified to exactly 2 core tables:

1. **`device_runs`**: Stores each motor run session between ON and OFF (device name, start/end time, duration, average current, peak current, energy in Wh/kWh, and cost in ₹).
2. **`telemetry_logs`**: Stores real-time continuous sensor readings (voltage, current, power, accumulated kWh, cost).

### Verification
You can inspect the tables anytime:
```powershell
psql -U postgres -d iot_energy_db -c "SELECT * FROM device_runs;"
psql -U postgres -d iot_energy_db -c "SELECT * FROM telemetry_logs;"
```

### Start Live Sync Server
```powershell
cd server
npm start
```
