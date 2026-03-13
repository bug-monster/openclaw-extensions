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

    const result = devices.map(d => {
      const record = this.latest.get(d.deviceMac)!;
      const age = Math.round((Date.now() - d.lastSeen) / 1000);
      const ageStr = age < 60 ? `${age}s ago` : age < 3600 ? `${Math.round(age / 60)}min ago` : `${Math.round(age / 3600)}h ago`;
      const { deviceMac, deviceType, timeOfSample, ...status } = record.context as Record<string, unknown>;
      return `- ${d.deviceType} (${d.deviceMac}) [${ageStr}]: ${JSON.stringify(status)}`;
    });
    return `SwitchBot devices (${devices.length}):\n${result.join('\n')}`;
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
   * Clear device history with flexible filtering options
   */
  clearHistory(options: {
    deviceMac?: string | string[];     // Single or multiple device MACs
    deviceType?: string;               // Filter by device type
    beforeTimestamp?: number;          // Clear history before this timestamp
    afterTimestamp?: number;           // Clear history after this timestamp
    keepLatest?: boolean;              // Keep latest status (default: true)
    dryRun?: boolean;                  // Preview mode, don't actually delete
  } = {}): {
    clearedDevices: string[];
    totalRecordsCleared: number;
    details: { [deviceMac: string]: number };
  } {
    const {
      deviceMac,
      deviceType,
      beforeTimestamp,
      afterTimestamp,
      keepLatest = true,
      dryRun = false
    } = options;

    const clearedDevices: string[] = [];
    let totalRecordsCleared = 0;
    const details: { [deviceMac: string]: number } = {};

    // Determine target devices
    let targetMacs: string[] = [];
    if (deviceMac) {
      targetMacs = Array.isArray(deviceMac) ? deviceMac : [deviceMac];
    } else if (deviceType) {
      // Filter by device type
      targetMacs = Array.from(this.latest.values())
        .filter(record => record.deviceType.toLowerCase().includes(deviceType.toLowerCase()))
        .map(record => record.deviceMac);
    } else {
      // All devices
      targetMacs = Array.from(this.history.keys());
    }

    // Process each device
    for (const mac of targetMacs) {
      const deviceHistory = this.history.get(mac);
      if (!deviceHistory || deviceHistory.length === 0) continue;

      let recordsToKeep = [...deviceHistory];
      let recordsCleared = 0;

      // Apply time filtering
      if (beforeTimestamp !== undefined || afterTimestamp !== undefined) {
        const originalLength = recordsToKeep.length;
        recordsToKeep = recordsToKeep.filter(record => {
          const timestamp = record.timestamp;
          const beforeOk = beforeTimestamp === undefined || timestamp >= beforeTimestamp;
          const afterOk = afterTimestamp === undefined || timestamp <= afterTimestamp;
          return beforeOk && afterOk;
        });
        recordsCleared = originalLength - recordsToKeep.length;
      } else {
        // Clear all history
        recordsCleared = recordsToKeep.length;
        recordsToKeep = [];
      }

      // Keep latest if requested
      if (keepLatest && recordsToKeep.length === 0 && deviceHistory.length > 0) {
        const latestRecord = deviceHistory[deviceHistory.length - 1];
        recordsToKeep = [latestRecord];
        recordsCleared = Math.max(0, recordsCleared - 1);
      }

      // Apply changes if not dry run
      if (!dryRun && recordsCleared > 0) {
        if (recordsToKeep.length === 0) {
          this.history.delete(mac);
          // Also remove from latest if not keeping latest
          if (!keepLatest) {
            this.latest.delete(mac);
          }
        } else {
          this.history.set(mac, recordsToKeep);
        }
        this.dirty = true;
      }

      // Record results
      if (recordsCleared > 0) {
        clearedDevices.push(mac);
        details[mac] = recordsCleared;
        totalRecordsCleared += recordsCleared;
      }
    }

    return {
      clearedDevices,
      totalRecordsCleared,
      details
    };
  }

  /**
   * Clear history for a specific device
   */
  clearDeviceHistory(deviceMac: string, keepLatest = true): number {
    const result = this.clearHistory({ deviceMac, keepLatest });
    return result.details[deviceMac] || 0;
  }

  /**
   * Clear all device history
   */
  clearAllHistory(keepLatest = true): { clearedDevices: number; totalRecords: number } {
    const result = this.clearHistory({ keepLatest });
    return {
      clearedDevices: result.clearedDevices.length,
      totalRecords: result.totalRecordsCleared
    };
  }

  /**
   * Clear history for devices of a specific type
   */
  clearHistoryByType(deviceType: string, keepLatest = true): { clearedDevices: string[]; totalRecords: number } {
    const result = this.clearHistory({ deviceType, keepLatest });
    return {
      clearedDevices: result.clearedDevices,
      totalRecords: result.totalRecordsCleared
    };
  }

  /**
   * Clear old history, keeping only recent N days
   */
  clearOldHistory(daysToKeep: number): { clearedDevices: string[]; totalRecords: number } {
    const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
    const result = this.clearHistory({ beforeTimestamp: cutoffTime });
    return {
      clearedDevices: result.clearedDevices,
      totalRecords: result.totalRecordsCleared
    };
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
