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
      if (ctx.temperature !== undefined) parts.push(`temp ${ctx.temperature}°C`);
      if (ctx.humidity !== undefined) parts.push(`humidity ${ctx.humidity}%`);
      if (ctx.battery !== undefined) parts.push(`battery ${ctx.battery}%`);
      if (ctx.detectionState !== undefined) parts.push(ctx.detectionState === 'DETECTED' ? 'motion detected' : 'no motion');
      if (ctx.power !== undefined) parts.push(ctx.power === 'on' ? 'on' : 'off');
      if (ctx.openState !== undefined) parts.push(ctx.openState === 'open' ? 'open' : 'closed');
      if (ctx.lockState !== undefined) parts.push(`${ctx.lockState}`);
      if (ctx.slidePosition !== undefined) parts.push(`curtain ${ctx.slidePosition}%`);

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
