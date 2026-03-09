import fs from 'fs';
import path from 'path';

export interface DeviceStatusRecord {
  deviceMac: string;
  deviceType: string;
  timestamp: number;
  context: Record<string, unknown>;
}

/**
 * Simple local JSON file storage
 * Each device retains latest status + recent N history entries
 */
export class DeviceStore {
  private storePath: string;
  private latestPath: string;
  private historyPath: string;
  private maxHistoryPerDevice: number;

  // Memory cache
  private latest: Map<string, DeviceStatusRecord> = new Map();
  private history: Map<string, DeviceStatusRecord[]> = new Map();
  private dirty = false;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(storeDir?: string, maxHistoryPerDevice = 100) {
    this.storePath = storeDir || path.join(process.env.HOME || '/tmp', '.openclaw', 'switchbot-data');
    this.latestPath = path.join(this.storePath, 'latest.json');
    this.historyPath = path.join(this.storePath, 'history.json');
    this.maxHistoryPerDevice = maxHistoryPerDevice;

    // Ensure directory exists
    fs.mkdirSync(this.storePath, { recursive: true });

    // Load existing data
    this.load();

    // Periodic flush to disk (every 10 seconds)
    this.flushTimer = setInterval(() => {
      if (this.dirty) this.flush();
    }, 10000);
  }

  /**
   * Record device status
   */
  record(event: DeviceStatusRecord): void {
    const key = event.deviceMac;

    // Update latest status
    this.latest.set(key, event);

    // Append to history
    if (!this.history.has(key)) {
      this.history.set(key, []);
    }
    const hist = this.history.get(key)!;
    hist.push(event);

    // Trim history
    if (hist.length > this.maxHistoryPerDevice) {
      hist.splice(0, hist.length - this.maxHistoryPerDevice);
    }

    this.dirty = true;
  }

  /**
   * Get device latest status
   */
  getLatest(deviceMac: string): DeviceStatusRecord | null {
    return this.latest.get(deviceMac) || null;
  }

  /**
   * Get all devices latest status
   */
  getAllLatest(): DeviceStatusRecord[] {
    return Array.from(this.latest.values());
  }

  /**
   * Get device history records
   */
  getHistory(deviceMac: string, limit = 20): DeviceStatusRecord[] {
    const hist = this.history.get(deviceMac) || [];
    return hist.slice(-limit);
  }

  /**
   * Query by device type
   */
  getByType(deviceType: string): DeviceStatusRecord[] {
    return Array.from(this.latest.values()).filter(
      r => r.deviceType.toLowerCase().includes(deviceType.toLowerCase())
    );
  }

  /**
   * List all known devices
   */
  listDevices(): Array<{ deviceMac: string; deviceType: string; lastSeen: number }> {
    return Array.from(this.latest.values()).map(r => ({
      deviceMac: r.deviceMac,
      deviceType: r.deviceType,
      lastSeen: r.timestamp,
    }));
  }

  /**
   * Export summary (for OpenClaw agent queries)
   */
  getSummary(): string {
    const devices = this.listDevices();
    if (devices.length === 0) return 'No device data available';

    const lines = devices.map(d => {
      const record = this.latest.get(d.deviceMac)!;
      const ctx = record.context;
      const age = Math.round((Date.now() - d.lastSeen) / 1000);
      const ageStr = age < 60 ? `${age}s ago` : age < 3600 ? `${Math.round(age / 60)}min ago` : `${Math.round(age / 3600)}h ago`;

      const parts: string[] = [];

      if (ctx.onlineStatus !== undefined) parts.push(ctx.onlineStatus === 'online' ? 'online' : 'offline');
      if (ctx.online !== undefined) parts.push(ctx.online ? 'online' : 'offline');
      if (ctx.battery !== undefined) parts.push(`battery ${ctx.battery}%`);
      if (ctx.temperature !== undefined) parts.push(`temp ${ctx.temperature}°C`);
      if (ctx.humidity !== undefined) parts.push(`humidity ${ctx.humidity}%`);
      if (ctx.CO2 !== undefined) parts.push(`CO2 ${ctx.CO2}ppm`);
      if (ctx.lightLevel !== undefined) parts.push(`light ${ctx.lightLevel}`);
      if (ctx.brightness && typeof ctx.brightness === 'string') parts.push(`brightness ${ctx.brightness}`);
      if (ctx.detectionState !== undefined) parts.push(ctx.detectionState === 'DETECTED' ? 'motion detected' : 'no motion');
      if (ctx.press !== undefined && ctx.press) parts.push('pressed');
      if (ctx.power !== undefined) parts.push(ctx.power === 'on' ? 'on' : 'off');
      if (ctx.powerState !== undefined) parts.push(ctx.powerState === 'ON' ? 'on' : 'off');
      if (ctx.openState !== undefined) {
        if (ctx.openState === 'open') parts.push('open');
        else if (ctx.openState === 'close') parts.push('closed');
        else if (ctx.openState === 'timeOutNotClose') parts.push('timeout not closed');
      }
      if (ctx.doorMode !== undefined) parts.push(ctx.doorMode === 'IN_DOOR' ? 'indoor' : 'outdoor');
      if (ctx.switchStatus !== undefined) parts.push(`switch ${ctx.switchStatus}`);
      if (ctx.switch1Status !== undefined) parts.push(`switch1 ${ctx.switch1Status}`);
      if (ctx.switch2Status !== undefined) parts.push(`switch2 ${ctx.switch2Status}`);
      if (ctx.lockState !== undefined) {
        if (ctx.lockState === 'LOCKED') parts.push('locked');
        else if (ctx.lockState === 'UNLOCKED') parts.push('unlocked');
        else if (ctx.lockState === 'JAMMED') parts.push('jammed');
      }
      if (ctx.slidePosition !== undefined) parts.push(`position ${ctx.slidePosition}%`);
      if (ctx.position !== undefined) parts.push(`position ${ctx.position}%`);
      if (ctx.calibrate !== undefined) parts.push(ctx.calibrate ? 'calibrated' : 'not calibrated');
      if (ctx.group !== undefined && ctx.group) parts.push('grouped');
      if (ctx.fanSpeed !== undefined) parts.push(`fan speed ${ctx.fanSpeed}`);
      if (ctx.mode !== undefined) parts.push(`mode ${ctx.mode}`);
      if (ctx.oscillation !== undefined) parts.push(ctx.oscillation === 'on' ? 'oscillating' : 'not oscillating');
      if (ctx.verticalOscillation !== undefined) parts.push(ctx.verticalOscillation === 'on' ? 'vertical oscillating' : 'not vertical oscillating');
      if (ctx.chargingStatus !== undefined) parts.push(ctx.chargingStatus === 'charging' ? 'charging' : 'not charging');
      if (ctx.nightStatus !== undefined) {
        if (ctx.nightStatus === 'off') parts.push('night light off');
        else parts.push(`night light ${ctx.nightStatus}`);
      }
      if (ctx.brightness !== undefined) parts.push(`brightness ${ctx.brightness}%`);
      if (ctx.color !== undefined) parts.push(`color ${ctx.color}`);
      if (ctx.colorTemperature !== undefined) parts.push(`color temp ${ctx.colorTemperature}K`);
      if (ctx.workingStatus !== undefined) parts.push(`status ${ctx.workingStatus}`);
      if (ctx.taskType !== undefined) parts.push(`task ${ctx.taskType}`);
      if (ctx.waterBaseBattery !== undefined) parts.push(`water base ${ctx.waterBaseBattery}%`);
      if (ctx.drying !== undefined && ctx.drying) parts.push('drying');
      if (ctx.fanGear !== undefined) parts.push(`fan gear ${ctx.fanGear}`);
      if (ctx.childLock !== undefined && ctx.childLock) parts.push('child lock on');
      if (ctx.overload !== undefined && ctx.overload) parts.push('overloaded');
      if (ctx.switch1Overload !== undefined && ctx.switch1Overload) parts.push('switch1 overloaded');
      if (ctx.switch2Overload !== undefined && ctx.switch2Overload) parts.push('switch2 overloaded');
      if (ctx.overTemperature !== undefined && ctx.overTemperature) parts.push('over temperature');
      if (ctx.isStuck !== undefined && ctx.isStuck) parts.push('stuck');
      if (ctx.deviceMode !== undefined) parts.push(`device mode ${ctx.deviceMode}`);
      if (ctx.displayMode !== undefined) parts.push(`display mode ${ctx.displayMode}`);
      if (ctx.doorStatus !== undefined) parts.push(`door status ${ctx.doorStatus}`);

      return `- ${d.deviceType} (${d.deviceMac}): ${parts.join(', ') || 'status updated'} [${ageStr}]`;
    });

    return `SwitchBot device status (${devices.length} devices):\n${lines.join('\n')}`;
  }

  /**
   * Flush to disk
   */
  flush(): void {
    try {
      const latestObj: Record<string, DeviceStatusRecord> = {};
      this.latest.forEach((v, k) => { latestObj[k] = v; });

      const historyObj: Record<string, DeviceStatusRecord[]> = {};
      this.history.forEach((v, k) => { historyObj[k] = v; });

      fs.writeFileSync(this.latestPath, JSON.stringify(latestObj, null, 2));
      fs.writeFileSync(this.historyPath, JSON.stringify(historyObj, null, 2));
      this.dirty = false;
    } catch (e) {
      console.error('[DeviceStore] flush failed:', e);
    }
  }

  /**
   * Load from disk
   */
  private load(): void {
    try {
      if (fs.existsSync(this.latestPath)) {
        const data = JSON.parse(fs.readFileSync(this.latestPath, 'utf-8'));
        for (const [k, v] of Object.entries(data)) {
          this.latest.set(k, v as DeviceStatusRecord);
        }
      }
      if (fs.existsSync(this.historyPath)) {
        const data = JSON.parse(fs.readFileSync(this.historyPath, 'utf-8'));
        for (const [k, v] of Object.entries(data)) {
          this.history.set(k, v as DeviceStatusRecord[]);
        }
      }
      console.log(`[DeviceStore] Loaded ${this.latest.size} devices from ${this.storePath}`);
    } catch (e) {
      console.error('[DeviceStore] load failed:', e);
    }
  }

  /**
   * Destroy
   */
  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.dirty) this.flush();
  }
}

// Global singleton
let store: DeviceStore | null = null;

export function getDeviceStore(): DeviceStore {
  if (!store) {
    store = new DeviceStore();
  }
  return store;
}

export function destroyDeviceStore(): void {
  if (store) {
    store.destroy();
    store = null;
  }
}
