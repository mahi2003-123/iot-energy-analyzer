/**
 * ============================================================================
 * Smart Energy Consumption & Electricity Cost Analyzer
 * Direct Wired USB Connection via Web Serial API (ESP32-WROOM-32)
 * Feature: Per-Device Current, Energy & Amount Calculation
 * ============================================================================
 */

document.addEventListener("DOMContentLoaded", () => {
  "use strict";

  /* ==========================================================================
     1. CONSTANTS & SYSTEM STATE
     ========================================================================== */
  const BAUD_RATE = 115200;
  let runningCurrentThreshold = 0.006; // 0.006 A (6 mA): detects any running motor start immediately
  const MAX_CHART_POINTS = 30;

  let currentTariff = 8.00;
  let serialPort = null;
  let serialReader = null;
  let readableStreamClosed = null;
  let keepReading = false;
  let isConnected = false;
  let isConnecting = false;
  let softwareZeroOffset = 0.0;
  let lastRawCurrent = 0.0;
  let isAutoTaring = false;
  let autoTareSamples = [];

  // Active Device State (Amounts calculate strictly per device, not in overall)
  let activeDeviceName = "Device 1 (5V Motor)";
  let deviceCounter = 1;
  let deviceWattHours = 0.0;
  let lastTimestamp = null;
  let chart = null;

  // Active Running Session State (Between ON and OFF)
  let isMachineRunning = false;
  let manualRunActive = false;
  let latestDeltaMv = 0.0;
  let sessionStartTime = null;
  let sessionDurationSeconds = 0;
  let sessionTimerInterval = null;
  let sessionPeakCurrent = 0.0;
  let sessionCurrentSamples = [];
  let sessionRunWattHours = 0.0;
  let lastCompletedRunCost = 0.0;
  let lastCompletedRunDurationStr = "00:00";
  let lastCompletedRunTimeRange = "";
  let consecutiveZeroSamples = 0;
  let completedDeviceRuns = [];
  const STORAGE_KEY_HISTORY = "iot_energy_analyzer_history_v2";

  // Continuous Projection State
  let projectionHours = 1.0;
  let lastKnownActiveCurrent = 0.50; // Reference operating current for active device

  /* ==========================================================================
     2. DOM ELEMENT REFERENCES
     ========================================================================== */
  // Header & Status
  const elDeviceStatus     = document.getElementById("device-status");
  const elDeviceStatusText = document.getElementById("device-status-text");
  const btnConnectUsb      = document.getElementById("btn-connect-usb");
  const elUsbHint          = document.getElementById("usb-hint");
  const elBrowserWarning   = document.getElementById("browser-warning");
  const elConnectionAlert  = document.getElementById("connection-alert");
  const btnAlertDismiss    = document.getElementById("btn-alert-dismiss");

  // Device Tag / Selector
  const inputDeviceName    = document.getElementById("device-name-input");
  const btnNewDevice       = document.getElementById("btn-new-device");

  // Tariff Form
  const tariffForm         = document.getElementById("tariff-form");
  const tariffInput        = document.getElementById("tariff-input");
  const presetButtons      = document.querySelectorAll(".btn-preset");

  // Machine State Banner
  const bannerMachineState = document.getElementById("machine-state-banner");
  const dotMachineState    = document.getElementById("machine-dot");
  const labelMachineState  = document.getElementById("machine-state-label");
  const descMachineState   = document.getElementById("machine-state-desc");
  const timerSession       = document.getElementById("active-session-timer");
  const statsSession       = document.getElementById("active-session-stats");
  const energySession      = document.getElementById("active-session-energy");
  const costSession        = document.getElementById("active-session-cost");

  // Core Metric Cards
  const elCurrent          = document.getElementById("current-display");
  const elPower            = document.getElementById("power-display");
  const elRunCost          = document.getElementById("run-cost-display");
  const elRunCostBadge     = document.getElementById("run-cost-badge");
  const elRunCostDesc      = document.getElementById("run-cost-desc");
  const elEnergy           = document.getElementById("energy-display");
  const elEnergyUnit       = document.getElementById("energy-unit");
  const elEnergyDesc       = document.getElementById("energy-desc");
  const elDeviceAmount     = document.getElementById("total-cost-display");
  const elDeviceAmountDesc = document.getElementById("cost-desc");
  const elChartCaption     = document.getElementById("chart-caption");

  // Continuous Projection Elements
  const inputProjHours     = document.getElementById("projection-hours-input");
  const hourPresetButtons  = document.querySelectorAll(".btn-hour-preset");
  const elProjCurrent      = document.getElementById("proj-current-display");
  const elProjCurrentSub   = document.getElementById("proj-current-sub");
  const elProjEnergy       = document.getElementById("proj-energy-display");
  const elProjCost         = document.getElementById("proj-cost-display");
  const elProjCostSub      = document.getElementById("proj-cost-sub");
  const elProjBaseCurrent  = document.getElementById("proj-base-current");
  const elProjBaseType     = document.getElementById("proj-base-type");
  const elProjBaseDesc     = document.getElementById("proj-base-desc");

  // Sensor Live Diagnostics & Two-Way Calibration
  const btnToggleRun       = document.getElementById("btn-toggle-run");
  const btnResetBaseline   = document.getElementById("btn-reset-baseline");
  const btnTareSensor      = document.getElementById("btn-tare-sensor");
  const btnForceZero       = document.getElementById("btn-force-zero");
  const btnRestartZero     = document.getElementById("btn-restart-zero");
  const diagSignalDot      = document.getElementById("diag-signal-dot");
  const diagRawMv          = document.getElementById("diag-raw-mv");
  const diagZeroMv         = document.getElementById("diag-zero-mv");
  const diagDeltaMv        = document.getElementById("diag-delta-mv");
  const selectSensorModel  = document.getElementById("select-sensor-model");
  const selectDividerMode  = document.getElementById("select-divider-mode");
  const selectRunningThreshold = document.getElementById("select-running-threshold");
  const diagStatusHint     = document.getElementById("diag-status-hint");

  // History Log
  const historyTableBody   = document.getElementById("history-table-body");
  const elEmptyHistoryRow  = document.getElementById("empty-history-row");
  const elHistorySummary   = document.getElementById("history-total-summary");
  const btnLogCurrent      = document.getElementById("btn-log-current");
  const btnClearHistory    = document.getElementById("btn-clear-history");

  // Controls
  const btnResetCounter    = document.getElementById("reset-counter-btn");

  /* ==========================================================================
     3. BROWSER COMPATIBILITY CHECK
     ========================================================================== */
  const isWebSerialSupported = ("serial" in navigator);
  if (!isWebSerialSupported) {
    if (elBrowserWarning) elBrowserWarning.style.display = "block";
    btnConnectUsb.disabled = true;
    elUsbHint.textContent = "Web Serial API unavailable in this browser. Please use Chrome, Edge, or Brave.";
  }

  /* ==========================================================================
     4. ACTIVE DEVICE MANAGEMENT
     ========================================================================== */
  if (inputDeviceName) {
    inputDeviceName.addEventListener("input", () => {
      activeDeviceName = inputDeviceName.value.trim() || `Device ${deviceCounter}`;
      updateDeviceDescriptions();
    });
  }

  function updateDeviceDescriptions() {
    if (elEnergyDesc) {
      elEnergyDesc.textContent = `Calculated for "${activeDeviceName}"`;
    }
    if (elDeviceAmountDesc) {
      elDeviceAmountDesc.textContent = `Amount for "${activeDeviceName}" (Not in overall)`;
    }
  }

  // Full Reset to Zero for Testing New Machine
  function resetAllToZeroForNewMachine(isNewDevice = false) {
    manualRunActive = false;
    if (isMachineRunning) {
      isMachineRunning = false;
      if (sessionTimerInterval) {
        clearInterval(sessionTimerInterval);
        sessionTimerInterval = null;
      }
    }

    if (btnToggleRun) {
      btnToggleRun.textContent = "▶ Start Motor Run";
      btnToggleRun.classList.remove("is-running");
    }

    if (isNewDevice) {
      deviceCounter++;
      activeDeviceName = `Device ${deviceCounter} (5V Motor)`;
      if (inputDeviceName) inputDeviceName.value = activeDeviceName;
    }

    deviceWattHours = 0.0;
    sessionRunWattHours = 0.0;
    sessionDurationSeconds = 0;
    sessionPeakCurrent = 0.0;
    sessionCurrentSamples = [];
    sessionStartTime = null;
    lastCompletedRunCost = 0.0;
    lastCompletedRunDurationStr = "00:00";
    lastCompletedRunTimeRange = "";
    consecutiveZeroSamples = 0;
    lastTimestamp = Date.now();

    softwareZeroOffset = 0.0;

    bannerMachineState.classList.remove("running");
    dotMachineState.className = "state-indicator-dot idle";
    labelMachineState.textContent = `Machine Status: OFF (${activeDeviceName})`;
    descMachineState.textContent = `Ready for new machine test. All counters zeroed. Turn on motor to start timing and cost calculation.`;
    timerSession.textContent = "Run Time: 00:00";
    if (statsSession) statsSession.style.display = "none";

    renderDeviceMetrics(0.0, 0.0, 0.0, 0.0);
    if (elCurrent) elCurrent.textContent = "0.00";
    if (elPower)   elPower.textContent   = "0.00";
    if (elRunCost) elRunCost.textContent = "0.0000";
    if (elRunCostBadge) {
      elRunCostBadge.textContent = "⏱️ Between ON & OFF";
      elRunCostBadge.classList.remove("running-badge");
    }
    if (elRunCostDesc) {
      elRunCostDesc.textContent = "Cost for running between ON & OFF time";
    }

    if (chart) {
      chart.data.labels = [];
      chart.data.datasets[0].data = [];
      chart.update();
    }

    updateDeviceDescriptions();
    updateContinuousProjection(0.0);
  }

  // Next Device button: logs any active device run and starts a fresh calculation for the next device
  if (btnNewDevice) {
    btnNewDevice.addEventListener("click", () => {
      resetAllToZeroForNewMachine(true);

      const originalText = btnNewDevice.innerHTML;
      btnNewDevice.textContent = "✓ Next Device Started!";
      setTimeout(() => {
        btnNewDevice.innerHTML = originalText;
      }, 1200);
    });
  }

  // Manual Start / Stop Motor Run Button in Banner
  if (btnToggleRun) {
    btnToggleRun.addEventListener("click", () => {
      if (isMachineRunning) {
        manualRunActive = false;
        setMachineRunning(false);
      } else {
        manualRunActive = true;
        setMachineRunning(true);
      }
    });
  }

  // Prominent "Reset to Zero (New Machine)" button in banner
  if (btnRestartZero) {
    btnRestartZero.addEventListener("click", () => {
      resetAllToZeroForNewMachine(false);

      const originalText = btnRestartZero.innerHTML;
      btnRestartZero.textContent = "✓ All Zeroed! (Ready)";
      setTimeout(() => {
        btnRestartZero.innerHTML = originalText;
      }, 1200);
    });
  }

  /* ==========================================================================
     5. TARIFF RATE MANAGEMENT
     ========================================================================== */
  function updateTariff(newRate) {
    const rate = parseFloat(newRate);
    if (!isNaN(rate) && rate > 0) {
      currentTariff = rate;
      tariffInput.value = rate.toFixed(2);

      presetButtons.forEach(btn => {
        const pRate = parseFloat(btn.dataset.rate);
        btn.classList.toggle("active", Math.abs(pRate - rate) < 0.01);
      });

      // Recalculate amount specifically for the active device
      const deviceKWh = deviceWattHours / 1000.0;
      const deviceAmount = deviceKWh * currentTariff;
      renderDeviceMetrics(lastKnownActiveCurrent || 0, (lastKnownActiveCurrent || 0) * 5.0, deviceWattHours, deviceAmount);

      // Recalculate past run costs with the updated tariff
      completedDeviceRuns.forEach(r => {
        r.devAmount = (r.devKWh || (r.runWh / 1000.0)) * currentTariff;
      });
      if (completedDeviceRuns.length > 0) {
        lastCompletedRunCost = completedDeviceRuns[completedDeviceRuns.length - 1].devAmount;
      }
      saveHistoryToStorage();
      renderAllHistoryRows();
      updateLiveRunCost();
      updateContinuousProjection();
    }
  }

  tariffForm.addEventListener("submit", (e) => {
    e.preventDefault();
    updateTariff(tariffInput.value);
  });

  presetButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      updateTariff(btn.dataset.rate);
    });
  });

  /* ==========================================================================
     6. UI STATUS & CONNECTION HELPERS
     ========================================================================== */
  function setConnectionUI(connected) {
    isConnected = connected;

    if (connected) {
      isAutoTaring = true;
      autoTareSamples = [];
      elDeviceStatus.className = "status-badge connected";
      elDeviceStatusText.textContent = "Connected (USB)";
      btnConnectUsb.textContent = "🔌 Disconnect";
      btnConnectUsb.classList.add("connected-state");
      elUsbHint.textContent = "ESP32 connected at 115200 baud. Streaming live hardware telemetry.";
      elChartCaption.textContent = "Streaming live measurements from ACS712 sensor over USB";
      if (elConnectionAlert) elConnectionAlert.style.display = "none";
    } else {
      elDeviceStatus.className = "status-badge disconnected";
      elDeviceStatusText.textContent = "Disconnected";
      btnConnectUsb.textContent = "🔌 Connect ESP32 (USB)";
      btnConnectUsb.classList.remove("connected-state");
      elUsbHint.textContent = "Connect your ESP32 via USB and click Connect to start live monitoring.";
      elChartCaption.textContent = "Awaiting USB Serial connection...";

      if (elCurrent) elCurrent.textContent = "0.00";
      if (elPower)   elPower.textContent   = "0.00";
      setMachineRunning(false);
    }
  }

  function showConnectionAlert(err) {
    if (elConnectionAlert) {
      const title = document.getElementById("connection-alert-title");
      const msg = document.getElementById("connection-alert-msg");
      if (err && err.name === "NotFoundError") {
        if (title) title.textContent = "ℹ️ Port Selection Required:";
        if (msg) msg.textContent = "When you click 'Connect ESP32 (USB)', a browser dialog appears. You must click 'Silicon Labs CP210x USB to UART Bridge (COM9)' in that dialog list first, and then click the blue 'Connect' button.";
      } else if (err && (err.name === "NetworkError" || (err.message && err.message.includes("Failed to open")))) {
        if (title) title.textContent = "⚠️ Port Locked / Busy:";
        if (msg) msg.textContent = "COM9 is currently busy. Quick Fix: Unplug the USB cable and plug it back in (or close any other open dashboard tab), then click Connect.";
      } else {
        if (title) title.textContent = "⚠️ Serial Port Connection Note:";
        if (msg) msg.textContent = "Make sure your ESP32 is plugged in with a USB data cable and CP210x driver is active on COM9.";
      }
      elConnectionAlert.style.display = "flex";
      elConnectionAlert.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  if (btnAlertDismiss) {
    btnAlertDismiss.addEventListener("click", () => {
      if (elConnectionAlert) elConnectionAlert.style.display = "none";
    });
  }

  /* ==========================================================================
     7. MACHINE STATE & DEVICE RUN TRACKING
     ========================================================================== */
  function formatSeconds(totalSec) {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function formatTimeHHMMSS(date) {
    return date.toLocaleTimeString("en-IN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  }

  function formatRunCostValue(amount) {
    if (typeof amount !== "number" || isNaN(amount) || amount <= 0) return "0.0000";
    if (amount < 0.0001) {
      return amount.toFixed(5);
    } else if (amount < 0.01) {
      return amount.toFixed(4);
    } else if (amount < 1.0) {
      return amount.toFixed(3);
    } else {
      return amount.toFixed(2);
    }
  }

  function updateLiveRunCost() {
    if (!elRunCost) return;

    if (isMachineRunning && sessionStartTime) {
      const liveDurationSec = Math.max(1, Math.round((Date.now() - sessionStartTime.getTime()) / 1000));
      const avgCurrent = (sessionCurrentSamples && sessionCurrentSamples.length > 0)
        ? (sessionCurrentSamples.reduce((a, b) => a + b, 0) / sessionCurrentSamples.length)
        : (lastKnownActiveCurrent || 0.20);
      const physicalWh = 5.0 * avgCurrent * (liveDurationSec / 3600.0);
      const liveWh = Math.max(sessionRunWattHours, physicalWh);
      const liveCost = (liveWh / 1000.0) * currentTariff;

      elRunCost.textContent = formatRunCostValue(liveCost);
      if (elRunCostDesc) {
        elRunCostDesc.textContent = `Running: ${formatSeconds(liveDurationSec)} (Started ${formatTimeHHMMSS(sessionStartTime)})`;
      }
      if (elRunCostBadge) {
        elRunCostBadge.textContent = "⚡ Running Live";
        elRunCostBadge.classList.add("running-badge");
      }
    } else {
      // Standby / OFF: Show the completed cost of the last run between ON and OFF (frozen & held)
      if (lastCompletedRunCost > 0) {
        elRunCost.textContent = formatRunCostValue(lastCompletedRunCost);
        if (elRunCostDesc) {
          elRunCostDesc.textContent = `Last Run: ${lastCompletedRunDurationStr} (${lastCompletedRunTimeRange}) - Stopped`;
        }
        if (elRunCostBadge) {
          elRunCostBadge.textContent = "⏹️ Stopped (Cost Held)";
          elRunCostBadge.classList.remove("running-badge");
        }
      } else {
        elRunCost.textContent = "0.0000";
        if (elRunCostDesc) {
          elRunCostDesc.textContent = "Cost for running between ON & OFF time";
        }
        if (elRunCostBadge) {
          elRunCostBadge.textContent = "⏱️ Between ON & OFF";
          elRunCostBadge.classList.remove("running-badge");
        }
      }
    }
  }

  function setMachineRunning(running) {
    if (running === isMachineRunning) return;

    if (running) {
      // Machine switched ON
      isMachineRunning = true;
      sessionStartTime = new Date();
      sessionDurationSeconds = 0;
      sessionPeakCurrent = 0.0;
      sessionCurrentSamples = [];
      sessionRunWattHours = 0.0;
      consecutiveZeroSamples = 0;

      bannerMachineState.classList.add("running");
      dotMachineState.className = "state-indicator-dot active";
      labelMachineState.textContent = `Machine Status: ON (${activeDeviceName})`;
      descMachineState.textContent = `Active motor running detected automatically. Live timer & run cost calculating.`;
      if (statsSession) statsSession.style.display = "flex";
      timerSession.textContent = "Run Time: 00:00";

      if (btnToggleRun) {
        btnToggleRun.textContent = "⏹ Stop Motor Run";
        btnToggleRun.classList.add("is-running");
      }

      if (sessionTimerInterval) clearInterval(sessionTimerInterval);
      sessionTimerInterval = setInterval(() => {
        if (!sessionStartTime) return;
        const elapsedSec = Math.max(0, Math.floor((Date.now() - sessionStartTime.getTime()) / 1000));
        sessionDurationSeconds = elapsedSec;
        timerSession.textContent = `Run Time: ${formatSeconds(elapsedSec)}`;
        updateLiveRunCost();
      }, 500);
      updateLiveRunCost();

    } else {
      // Machine switched OFF
      if (!isMachineRunning) return;
      isMachineRunning = false;
      const sessionEndTime = new Date();

      if (sessionTimerInterval) {
        clearInterval(sessionTimerInterval);
        sessionTimerInterval = null;
      }

      // Calculate true elapsed time in seconds
      const elapsedMs = sessionStartTime
        ? (sessionEndTime.getTime() - sessionStartTime.getTime())
        : (sessionDurationSeconds * 1000);
      const durationSec = Math.max(1, Math.round(elapsedMs / 1000));
      const stoppedDurationStr = formatSeconds(durationSec);

      // Auto-save run to history if duration >= 1 sec
      if (durationSec >= 1) {
        const avg = (sessionCurrentSamples && sessionCurrentSamples.length > 0)
          ? (sessionCurrentSamples.reduce((a, b) => a + b, 0) / sessionCurrentSamples.length)
          : (sessionPeakCurrent || lastKnownActiveCurrent || 0.19);
        const physicalWh = 5.0 * avg * (durationSec / 3600.0);
        const runWh = Math.max(sessionRunWattHours, physicalWh);

        recordCompletedDeviceRun(
          activeDeviceName,
          sessionStartTime || new Date(sessionEndTime.getTime() - durationSec * 1000),
          sessionEndTime,
          durationSec,
          runWh,
          sessionPeakCurrent || avg,
          sessionCurrentSamples
        );
      }

      bannerMachineState.classList.remove("running");
      dotMachineState.className = "state-indicator-dot idle";
      labelMachineState.textContent = "Machine Status: OFF (Standby / Idle)";
      descMachineState.textContent = `Motor stopped. Run duration: ${stoppedDurationStr} | Run cost: ₹${formatRunCostValue(lastCompletedRunCost)} calculated & held.`;
      if (statsSession) statsSession.style.display = "none";
      timerSession.textContent = `Run Time: ${stoppedDurationStr} (Stopped)`;

      manualRunActive = false;
      if (btnToggleRun) {
        btnToggleRun.textContent = "▶ Start Motor Run";
        btnToggleRun.classList.remove("is-running");
      }

      // Reset run session state
      sessionRunWattHours = 0.0;
      sessionPeakCurrent = 0.0;
      sessionCurrentSamples = [];
      sessionStartTime = null;
      sessionDurationSeconds = 0;
      consecutiveZeroSamples = 0;
      updateLiveRunCost();
    }
  }

  function formatHistoryEnergy(wh) {
    if (typeof wh !== "number" || isNaN(wh) || wh <= 0) return "0.0 mWh";
    if (wh < 1.0) {
      return `${(wh * 1000).toFixed(1)} mWh`;
    } else if (wh < 1000.0) {
      return `${wh.toFixed(2)} Wh`;
    } else {
      return `${(wh / 1000.0).toFixed(4)} kWh`;
    }
  }

  function formatHistoryCost(amount) {
    if (typeof amount !== "number" || isNaN(amount) || amount <= 0) return "₹ 0.0000";
    if (amount < 0.0001) {
      return `₹ ${amount.toFixed(5)}`;
    } else if (amount < 0.01) {
      return `₹ ${amount.toFixed(4)}`;
    } else {
      return `₹ ${amount.toFixed(2)}`;
    }
  }

  function saveHistoryToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(completedDeviceRuns));
    } catch (e) {
      console.warn("Could not save history to localStorage:", e);
    }
  }

  function loadHistoryFromStorage() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_HISTORY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          completedDeviceRuns = parsed.map(record => {
            let durationSec = 1;
            if (record.durationStr && record.durationStr.includes(":")) {
              const parts = record.durationStr.split(":").map(Number);
              if (parts.length === 2) durationSec = parts[0] * 60 + parts[1];
              else if (parts.length === 3) durationSec = parts[0] * 3600 + parts[1] * 60 + parts[2];
            }
            const avgCur = record.avgCurrent || record.peakCurrent || 0.19;
            const physicalWh = 5.0 * avgCur * (durationSec / 3600.0);
            const actualWh = Math.max(record.runWh || 0, physicalWh);
            const actualKWh = actualWh / 1000.0;
            const actualCost = actualKWh * currentTariff;
            return {
              ...record,
              avgCurrent: avgCur,
              runWh: actualWh,
              devKWh: actualKWh,
              devAmount: actualCost
            };
          });

          const lastRun = completedDeviceRuns[completedDeviceRuns.length - 1];
          if (lastRun) {
            lastCompletedRunCost = lastRun.devAmount;
            lastCompletedRunDurationStr = lastRun.durationStr;
            lastCompletedRunTimeRange = `${lastRun.startStr} - ${lastRun.endStr}`;
          }
          saveHistoryToStorage();
          renderAllHistoryRows();
          updateLiveRunCost();
        }
      }
    } catch (e) {
      console.warn("Could not load history from localStorage:", e);
    }
  }

  function renderAllHistoryRows() {
    if (!historyTableBody) return;
    historyTableBody.innerHTML = "";

    if (completedDeviceRuns.length === 0) {
      historyTableBody.innerHTML = `
        <tr class="empty-row" id="empty-history-row">
          <td colspan="8">
            No machine runs recorded yet. When the machine runs and stops (between ON and OFF), its operating duration and calculated cost will be logged here.
          </td>
        </tr>
      `;
      if (elHistorySummary) {
        elHistorySummary.textContent = "Runs Logged: 0 | Total Run Cost: ₹ 0.0000";
      }
      return;
    }

    completedDeviceRuns.forEach((runRecord, idx) => {
      runRecord.runNumber = idx + 1;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="col-mono">#${runRecord.runNumber}</td>
        <td><strong>${runRecord.deviceName}</strong></td>
        <td class="col-mono">${runRecord.startStr} - ${runRecord.endStr}</td>
        <td class="col-mono">${runRecord.durationStr}</td>
        <td class="col-mono">${(runRecord.avgCurrent || 0).toFixed(2)} A</td>
        <td class="col-mono">${(runRecord.peakCurrent || 0).toFixed(2)} A</td>
        <td class="col-mono">${formatHistoryEnergy(runRecord.runWh)}</td>
        <td class="col-cost">${formatHistoryCost(runRecord.devAmount)}</td>
      `;
      historyTableBody.appendChild(tr);
    });

    const totalAmountAllDevices = completedDeviceRuns.reduce((sum, r) => sum + (r.devAmount || 0), 0);
    if (elHistorySummary) {
      elHistorySummary.textContent = `Runs Logged: ${completedDeviceRuns.length} | Total Run Cost: ${formatHistoryCost(totalAmountAllDevices)}`;
    }
  }

  function recordCompletedDeviceRun(devName, startTime, endTime, durationSec, wattHours, peakCurrent, samples) {
    const runNumber = completedDeviceRuns.length + 1;
    const avgCurrent = (samples && samples.length > 0)
      ? (samples.reduce((acc, v) => acc + v, 0) / samples.length)
      : (peakCurrent || 0.19);
    const physicalWh = 5.0 * avgCurrent * (durationSec / 3600.0);
    const runWh = Math.max(wattHours || 0, physicalWh);
    const devKWh = runWh / 1000.0;
    const devAmount = devKWh * currentTariff;

    const startStr = formatTimeHHMMSS(startTime);
    const endStr = formatTimeHHMMSS(endTime);
    const durationStr = formatSeconds(durationSec);

    const runRecord = {
      runNumber,
      deviceName: devName,
      startStr,
      endStr,
      durationStr,
      avgCurrent,
      peakCurrent: peakCurrent || avgCurrent,
      runWh,
      devKWh,
      devAmount
    };

    lastCompletedRunCost = devAmount;
    lastCompletedRunDurationStr = durationStr;
    lastCompletedRunTimeRange = `${startStr} - ${endStr}`;

    completedDeviceRuns.push(runRecord);
    saveHistoryToStorage();
    renderAllHistoryRows();
    updateLiveRunCost();

    // Async sync to PostgreSQL backend if running
    syncRunToPostgres(runRecord, startTime, endTime, durationSec);
  }

  // Base URL for API (Relative on Render, or localhost:3000 when developing locally)
  const API_BASE_URL = (window.location.hostname === "localhost" && window.location.port !== "" && window.location.port !== "3000")
    ? "http://localhost:3000"
    : "";

  async function syncRunToPostgres(record, startTime, endTime, durationSec) {
    try {
      await fetch(`${API_BASE_URL}/api/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceName: record.deviceName,
          startTime: startTime instanceof Date ? startTime.toISOString() : new Date().toISOString(),
          endTime: endTime instanceof Date ? endTime.toISOString() : new Date().toISOString(),
          durationSeconds: durationSec || 1,
          avgCurrent: record.avgCurrent,
          peakCurrent: record.peakCurrent,
          energyWh: record.runWh,
          energyKWh: record.devKWh,
          tariffRate: currentTariff,
          costRupees: record.devAmount
        })
      });
    } catch (_) {
      // Graceful offline fallback to browser storage
    }
  }

  let lastTelemetryDbSyncTime = 0;
  async function syncTelemetryToPostgres(currentA, voltage, powerW) {
    const now = Date.now();
    // Throttle to 1 reading every 2 seconds
    if (now - lastTelemetryDbSyncTime < 2000) return;
    lastTelemetryDbSyncTime = now;

    try {
      const devKWh = deviceWattHours / 1000.0;
      const devAmount = devKWh * currentTariff;
      await fetch(`${API_BASE_URL}/api/telemetry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceName: activeDeviceName,
          voltage: voltage,
          current: currentA,
          power: powerW,
          energy: devKWh,
          cost: devAmount
        })
      });
    } catch (_) {
      // Graceful offline fallback
    }
  }

  // Manual Instant "Log Run Now" button
  if (btnLogCurrent) {
    btnLogCurrent.addEventListener("click", () => {
      const now = new Date();
      const durationSec = sessionDurationSeconds > 0 ? sessionDurationSeconds : 1;
      const startTime = sessionStartTime || new Date(now.getTime() - durationSec * 1000);
      const avg = (sessionCurrentSamples && sessionCurrentSamples.length > 0)
        ? (sessionCurrentSamples.reduce((a, b) => a + b, 0) / sessionCurrentSamples.length)
        : (lastKnownActiveCurrent || 0.19);
      const physicalWh = 5.0 * avg * (durationSec / 3600.0);
      const runWh = Math.max(sessionRunWattHours, physicalWh);
      const peak = sessionPeakCurrent > 0 ? sessionPeakCurrent : avg;
      const samples = sessionCurrentSamples.length > 0 ? sessionCurrentSamples : [peak];

      recordCompletedDeviceRun(
        activeDeviceName,
        startTime,
        now,
        durationSec,
        runWh,
        peak,
        samples
      );

      const originalText = btnLogCurrent.innerHTML;
      btnLogCurrent.textContent = "✓ Logged!";
      setTimeout(() => {
        btnLogCurrent.innerHTML = originalText;
      }, 1000);
    });
  }

  btnClearHistory.addEventListener("click", () => {
    completedDeviceRuns = [];
    saveHistoryToStorage();
    renderAllHistoryRows();
  });

  /* ==========================================================================
     8. TELEMETRY PROCESSING (PER-DEVICE CALCULATION)
     ========================================================================== */
  function renderDeviceMetrics(currentA, powerW, devWh, devAmount) {
    if (elCurrent) elCurrent.textContent = currentA.toFixed(2);
    if (elPower)   elPower.textContent   = powerW.toFixed(2);

    if (elEnergy) {
      if (devWh < 1.0) {
        // Milliwatt-hours for low power / DC loads
        elEnergy.textContent = (devWh * 1000).toFixed(1);
        if (elEnergyUnit) elEnergyUnit.textContent = "mWh";
      } else if (devWh < 1000.0) {
        // Watt-hours
        elEnergy.textContent = devWh.toFixed(2);
        if (elEnergyUnit) elEnergyUnit.textContent = "Wh";
      } else {
        // Kilowatt-hours
        elEnergy.textContent = (devWh / 1000.0).toFixed(4);
        if (elEnergyUnit) elEnergyUnit.textContent = "kWh";
      }
      if (elEnergyDesc) elEnergyDesc.textContent = `Calculated for active device`;
    }

    if (elDeviceAmount) {
      if (devAmount > 0 && devAmount < 0.01) {
        // High-precision rupees for short test runs
        elDeviceAmount.textContent = devAmount.toFixed(4);
      } else if (devAmount >= 0.01) {
        elDeviceAmount.textContent = devAmount.toFixed(2);
      } else {
        elDeviceAmount.textContent = "0.0000";
      }
      // Single clean label without secondary duplicate paise
      if (elDeviceAmountDesc) elDeviceAmountDesc.textContent = `Amount for active device`;
    }
  }

  function handleTelemetryData(currentA, voltage, powerW) {
    const now = Date.now();

    // Motor Active Sensing with Hysteresis & Delta-mV backup:
    // - To START automatically: Current >= threshold (0.006 A) OR sensor delta >= 1.5 mV
    // - To MAINTAIN running state: Holds down to 0.003 A OR sensor delta >= 1.0 mV (prevents brush ripple cutoffs)
    const isSensorActive = isMachineRunning 
      ? (currentA >= 0.003 || Math.abs(latestDeltaMv) >= 1.0)
      : (currentA >= runningCurrentThreshold || Math.abs(latestDeltaMv) >= 1.5);

    const isMotorActive = isSensorActive || manualRunActive;

    // Display actual current and power
    const displayCurrent = currentA >= 0.005 ? currentA : (manualRunActive && currentA > 0 ? currentA : (isMotorActive ? 0.01 : 0.0));
    const displayPower   = displayCurrent > 0 ? (powerW > 0 ? powerW : (voltage * displayCurrent)) : 0.0;

    // Automatic Machine ON / OFF Tracking
    if (isMotorActive) {
      consecutiveZeroSamples = 0;
      if (!isMachineRunning) {
        setMachineRunning(true);
      }
      sessionPeakCurrent = Math.max(sessionPeakCurrent, displayCurrent);
      sessionCurrentSamples.push(displayCurrent);
    } else {
      if (isMachineRunning && !manualRunActive) {
        consecutiveZeroSamples++;
        // Confirmed OFF after 4 consecutive zero readings (4.0 seconds at 1.0s stream interval)
        // Prevents commutator brush ripple or transient noise dips from stopping the timer
        if (consecutiveZeroSamples >= 4) {
          setMachineRunning(false);
          consecutiveZeroSamples = 0;
        }
      }
    }

    // Accumulate energy SPECIFICALLY for the active device ONLY when motor is actively running
    if (lastTimestamp) {
      const elapsedMs = now - lastTimestamp;
      if (elapsedMs > 0 && elapsedMs < 60000) {
        const elapsedHours = elapsedMs / (1000 * 60 * 60);
        const effectivePower = displayPower > 0 ? displayPower : (isMachineRunning ? (voltage * (sessionPeakCurrent || 0.19)) : 0.0);
        const wattHoursDelta = effectivePower * elapsedHours;

        if (isMachineRunning) {
          deviceWattHours += wattHoursDelta;
          sessionRunWattHours += wattHoursDelta;
        }
      }
    }
    lastTimestamp = now;

    // Device-specific calculations (NOT added to overall)
    const deviceKWh = deviceWattHours / 1000.0;
    const deviceAmount = deviceKWh * currentTariff;

    renderDeviceMetrics(displayCurrent, displayPower, deviceWattHours, deviceAmount);
    updateLiveRunCost();
    updateContinuousProjection(displayCurrent);
    pushChartPoint(formatTimeHHMMSS(new Date()), displayPower);
  }

  /* ==========================================================================
     9. CONTINUOUS OPERATION PROJECTION ESTIMATOR
     ========================================================================== */
  function updateContinuousProjection(liveCurrent) {
    if (!elProjCurrent) return;

    let activeCurrent = lastKnownActiveCurrent;
    let baseType = "Active Load";
    let baseDesc = `Operating load for ${activeDeviceName}`;

    if (typeof liveCurrent === "number") {
      if (liveCurrent >= runningCurrentThreshold) {
        lastKnownActiveCurrent = liveCurrent;
        activeCurrent = liveCurrent;
        baseType = "Live Load";
        baseDesc = "Real-time motor current";
      } else {
        activeCurrent = lastKnownActiveCurrent;
        baseType = "Operating Reference";
        baseDesc = `Last active load for ${activeDeviceName}`;
      }
    }

    const totalCurrentAh = activeCurrent * projectionHours;
    const totalCurrentMAh = totalCurrentAh * 1000.0;
    const powerW = 5.0 * activeCurrent;
    const projectedKWh = (powerW * projectionHours) / 1000.0;
    const projectedCost = projectedKWh * currentTariff;

    if (elProjCurrent)     elProjCurrent.textContent = totalCurrentAh.toFixed(2);
    if (elProjCurrentSub)  elProjCurrentSub.textContent = `${Math.round(totalCurrentMAh).toLocaleString()} mAh total charge required`;
    if (elProjEnergy)      elProjEnergy.textContent = projectedKWh.toFixed(4);
    if (elProjCost)        elProjCost.textContent = projectedCost.toFixed(2);
    if (elProjCostSub)     elProjCostSub.textContent = `Tariff: ₹${currentTariff.toFixed(2)} / kWh`;
    if (elProjBaseCurrent) elProjBaseCurrent.textContent = activeCurrent.toFixed(2);
    if (elProjBaseType)    elProjBaseType.textContent = baseType;
    if (elProjBaseDesc)    elProjBaseDesc.textContent = baseDesc;
  }

  if (inputProjHours) {
    inputProjHours.addEventListener("input", () => {
      const hrs = parseFloat(inputProjHours.value);
      if (!isNaN(hrs) && hrs > 0) {
        projectionHours = hrs;
        hourPresetButtons.forEach(btn => {
          const bHours = parseFloat(btn.dataset.hours);
          btn.classList.toggle("active", Math.abs(bHours - hrs) < 0.01);
        });
        updateContinuousProjection();
      }
    });
  }

  hourPresetButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const hrs = parseFloat(btn.dataset.hours);
      if (!isNaN(hrs) && hrs > 0) {
        projectionHours = hrs;
        if (inputProjHours) inputProjHours.value = hrs.toFixed(1);
        hourPresetButtons.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        updateContinuousProjection();
      }
    });
  });

  /* ==========================================================================
     10. WIRED USB SERIAL (WEB SERIAL API)
     ========================================================================== */
  async function connectSerial() {
    if (!("serial" in navigator)) {
      if (elBrowserWarning) elBrowserWarning.style.display = "block";
      return;
    }

    try {
      serialPort = await navigator.serial.requestPort();
      
      try {
        await serialPort.open({ baudRate: BAUD_RATE });
      } catch (openErr) {
        // If port was briefly held during page reload, wait 600ms and retry once automatically
        if (openErr.name === "NetworkError" || (openErr.message && openErr.message.includes("Failed to open"))) {
          await new Promise(r => setTimeout(r, 600));
          await serialPort.open({ baudRate: BAUD_RATE });
        } else {
          throw openErr;
        }
      }

      setConnectionUI(true);
      lastTimestamp = Date.now();
      keepReading = true;

      // Ensure clean 2.5V zero baseline and sync parameters to ESP32 on connect
      setTimeout(() => {
        sendSerialCommand("RESET_ZERO");
        if (selectSensorModel) sendSerialCommand(`SENS:${selectSensorModel.value}`);
        if (selectDividerMode) sendSerialCommand(`DIV:${selectDividerMode.value}`);
        sendSerialCommand("DEADBAND:0.01");
      }, 350);

      const textDecoder = new TextDecoderStream();
      readableStreamClosed = serialPort.readable.pipeTo(textDecoder.writable);
      const reader = textDecoder.readable.getReader();
      serialReader = reader;

      let lineBuffer = "";

      while (keepReading) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          lineBuffer += value;
          const lines = lineBuffer.split(/\r?\n/);
          lineBuffer = lines.pop();

          for (const line of lines) {
            parseIncomingSerialLine(line);
          }
        }
      }

      try {
        reader.releaseLock();
      } catch (_) {}
      if (readableStreamClosed) {
        await readableStreamClosed.catch(() => {});
      }

    } catch (err) {
      console.warn("Serial connection failed or cancelled:", err);
      showConnectionAlert(err);
    } finally {
      await disconnectSerial();
    }
  }

  async function disconnectSerial() {
    keepReading = false;

    if (isMachineRunning) {
      setMachineRunning(false);
    }

    if (serialReader) {
      try {
        await serialReader.cancel();
      } catch (e) {}
      try {
        serialReader.releaseLock();
      } catch (e) {}
      serialReader = null;
    }

    if (readableStreamClosed) {
      try {
        await readableStreamClosed;
      } catch (e) {}
      readableStreamClosed = null;
    }

    if (serialPort) {
      try {
        await serialPort.close();
      } catch (e) {}
      serialPort = null;
    }

    if (isConnected) {
      setConnectionUI(false);
    }
  }

  async function sendSerialCommand(cmd) {
    if (!serialPort || !serialPort.writable) return;
    try {
      const encoder = new TextEncoder();
      const writer = serialPort.writable.getWriter();
      await writer.write(encoder.encode(cmd + "\n"));
      writer.releaseLock();
    } catch (e) {
      console.warn("Serial command error:", e);
    }
  }

  function parseIncomingSerialLine(rawLine) {
    const trimmed = rawLine.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
      return;
    }

    try {
      const data = JSON.parse(trimmed);
      latestDeltaMv = typeof data.delta_mv === "number" ? data.delta_mv : 0.0;
      let currentA = typeof data.current === "number" ? Math.max(0, data.current) : 0.0;
      
      // Fallback: If firmware deadband clamped current to 0, reconstruct from ANY delta_mv under load
      if (currentA <= 0.008 && typeof data.delta_mv === "number" && Math.abs(data.delta_mv) >= 0.5) {
        const sens = (selectSensorModel && parseFloat(selectSensorModel.value)) || 100.0;
        const estCurrent = Math.abs(data.delta_mv) / sens;
        if (estCurrent > currentA) {
          currentA = estCurrent;
        }
      }

      lastRawCurrent = currentA;
      const voltage  = typeof data.voltage === "number" ? data.voltage : 5.0;
      const powerW   = (typeof data.power === "number" && data.power > 0) ? data.power : (voltage * currentA);

      // Update Live Hardware Diagnostic Readouts
      if (typeof data.raw_mv === "number" && diagRawMv) {
        diagRawMv.textContent = `${Math.round(data.raw_mv)} mV`;
        
        if (typeof data.zero_mv === "number" && diagZeroMv) {
          diagZeroMv.textContent = `${Math.round(data.zero_mv)} mV`;
        }
        
        if (typeof data.delta_mv === "number" && diagDeltaMv) {
          const dVal = data.delta_mv;
          diagDeltaMv.textContent = `${dVal >= 0 ? '+' : ''}${dVal.toFixed(1)} mV`;
        }

        // Live Health Analysis of GPIO34 Wiring
        if (data.raw_mv < 50) {
          if (diagSignalDot) diagSignalDot.className = "diag-dot warn";
          if (diagStatusHint) {
            diagStatusHint.innerHTML = "⚠️ <strong>No signal on GPIO34 (0 mV):</strong> Ensure ACS712 VOUT is wired to GPIO34 and Common GND is connected to ESP32.";
          }
        } else if (Math.abs(data.delta_mv || 0) > 6 || currentA >= runningCurrentThreshold) {
          if (diagSignalDot) diagSignalDot.className = "diag-dot active";
          if (diagStatusHint) {
            diagStatusHint.innerHTML = `⚡ <strong>Active Current Detected:</strong> Sensor drawing ${currentA.toFixed(2)} A (${(data.delta_mv || 0).toFixed(1)} mV shift).`;
          }
        } else {
          if (diagSignalDot) diagSignalDot.className = "diag-dot";
          if (diagStatusHint) {
            diagStatusHint.innerHTML = `💡 <strong>Sensor Baseline:</strong> Resting at ${Math.round(data.raw_mv)} mV. Turn on your gadget to observe current.`;
          }
        }
      }

      handleTelemetryData(currentA, voltage, powerW);
      syncTelemetryToPostgres(currentA, voltage, powerW);

    } catch (e) {
      // Ignore malformed JSON packets
    }
  }

  // Two-Way Hardware Calibration & Zero Baseline
  function calibrateZeroBaseline() {
    softwareZeroOffset = 0.0;
    if (isMachineRunning) {
      setMachineRunning(false);
    }
    consecutiveZeroSamples = 0;
    renderDeviceMetrics(0.0, 0.0, deviceWattHours, (deviceWattHours / 1000.0) * currentTariff);
    updateLiveRunCost();
    updateContinuousProjection(0.0);
  }

  if (btnResetBaseline) {
    btnResetBaseline.addEventListener("click", () => {
      softwareZeroOffset = 0.0;
      sendSerialCommand("RESET_ZERO");
      const originalText = btnResetBaseline.innerHTML;
      btnResetBaseline.textContent = "✓ Baseline Restored (2.5V)";
      setTimeout(() => {
        btnResetBaseline.innerHTML = originalText;
      }, 1500);
    });
  }

  if (btnForceZero) {
    btnForceZero.addEventListener("click", () => {
      calibrateZeroBaseline();
      const originalText = btnForceZero.innerHTML;
      btnForceZero.textContent = "✓ Zero Set! (OFF)";
      setTimeout(() => {
        btnForceZero.innerHTML = originalText;
      }, 1200);
    });
  }

  if (btnTareSensor) {
    btnTareSensor.addEventListener("click", () => {
      sendSerialCommand("ZERO");
      calibrateZeroBaseline();
      const originalText = btnTareSensor.innerHTML;
      btnTareSensor.textContent = "✓ Zero Calibrated!";
      setTimeout(() => {
        btnTareSensor.innerHTML = originalText;
      }, 1200);
    });
  }

  if (selectRunningThreshold) {
    selectRunningThreshold.addEventListener("change", () => {
      const val = parseFloat(selectRunningThreshold.value);
      if (!isNaN(val) && val > 0) {
        runningCurrentThreshold = val;
        sendSerialCommand(`DEADBAND:${val.toFixed(2)}`);
      }
    });
  }

  if (selectSensorModel) {
    selectSensorModel.addEventListener("change", () => {
      sendSerialCommand(`SENS:${selectSensorModel.value}`);
    });
  }

  if (selectDividerMode) {
    selectDividerMode.addEventListener("change", () => {
      sendSerialCommand(`DIV:${selectDividerMode.value}`);
    });
  }

  if ("serial" in navigator) {
    navigator.serial.addEventListener("disconnect", () => {
      disconnectSerial();
    });
  }

  // Ensure serial port is cleanly released before page reload or tab close
  window.addEventListener("beforeunload", () => {
    if (isConnected) {
      disconnectSerial();
    }
  });

  /* ==========================================================================
     11. REAL-TIME CHART SETUP
     ========================================================================== */
  function setupChart() {
    const canvas = document.getElementById("powerChart");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const gradient = ctx.createLinearGradient(0, 0, 0, 260);
    gradient.addColorStop(0, "rgba(15, 23, 42, 0.12)");
    gradient.addColorStop(1, "rgba(15, 23, 42, 0.0)");

    chart = new Chart(ctx, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            label: "Power (Watts)",
            data: [],
            borderColor: "#0f172a",
            borderWidth: 2,
            backgroundColor: gradient,
            fill: true,
            tension: 0.25,
            pointRadius: 2.5,
            pointHoverRadius: 5,
            pointBackgroundColor: "#0f172a",
            pointBorderColor: "#ffffff",
            pointBorderWidth: 1.5,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#0f172a",
            titleColor: "#94a3b8",
            bodyColor: "#ffffff",
            padding: 8,
            displayColors: false,
            callbacks: {
              label: (context) => `Power: ${context.parsed.y.toFixed(2)} W`
            }
          }
        },
        scales: {
          x: {
            grid: { color: "#e2e8f0", drawBorder: false },
            ticks: {
              color: "#64748b",
              font: { family: "'JetBrains Mono', monospace", size: 11 },
              maxTicksLimit: 6
            }
          },
          y: {
            suggestedMin: 0,
            suggestedMax: 6,
            grid: { color: "#e2e8f0", drawBorder: false },
            ticks: {
              color: "#64748b",
              font: { family: "'JetBrains Mono', monospace", size: 11 },
              callback: (val) => `${val} W`
            }
          }
        }
      }
    });
  }

  function pushChartPoint(label, value) {
    if (!chart) return;
    chart.data.labels.push(label);
    chart.data.datasets[0].data.push(value);

    if (chart.data.labels.length > MAX_CHART_POINTS) {
      chart.data.labels.shift();
      chart.data.datasets[0].data.shift();
    }
    chart.update();
  }

  /* ==========================================================================
     12. BUTTON LISTENERS & INITIALIZATION
     ========================================================================== */
  btnConnectUsb.addEventListener("click", async () => {
    if (isConnecting) return;
    if (isConnected) {
      await disconnectSerial();
    } else {
      isConnecting = true;
      try {
        await connectSerial();
      } finally {
        isConnecting = false;
      }
    }
  });

  btnResetCounter.addEventListener("click", () => {
    resetAllToZeroForNewMachine(false);

    const originalText = btnResetCounter.innerHTML;
    btnResetCounter.textContent = "✓ Reset Device Calculation";
    setTimeout(() => {
      btnResetCounter.innerHTML = originalText;
    }, 1200);
  });

  // Startup initialization
  setupChart();
  setConnectionUI(false);
  updateDeviceDescriptions();
  updateContinuousProjection();
  loadHistoryFromStorage();
});
