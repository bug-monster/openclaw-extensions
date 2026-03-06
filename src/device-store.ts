import fs from 'fs';
import path from 'path';

export interface DeviceStatusRecord {
  deviceMac: string;
  deviceType: string;
  timestamp: number;
  context: Record<string, unknown>;
}

/**
 * 简单的本地 JSON 文件存储
 * 每个设备保留最新状态 + 最近 N 条历史
 */
export class DeviceStore {
  private storePath: string;
  private latestPath: string;
  private historyPath: string;
  private maxHistoryPerDevice: number;

  // 内存缓存
  private latest: Map<string, DeviceStatusRecord> = new Map();
  private history: Map<string, DeviceStatusRecord[]> = new Map();
  private dirty = false;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(storeDir?: string, maxHistoryPerDevice = 100) {
    this.storePath = storeDir || path.join(process.env.HOME || '/tmp', '.openclaw', 'switchbot-data');
    this.latestPath = path.join(this.storePath, 'latest.json');
    this.historyPath = path.join(this.storePath, 'history.json');
    this.maxHistoryPerDevice = maxHistoryPerDevice;

    // 确保目录存在
    fs.mkdirSync(this.storePath, { recursive: true });

    // 加载已有数据
    this.load();

    // 定时刷盘（每 10 秒）
    this.flushTimer = setInterval(() => {
      if (this.dirty) this.flush();
    }, 10000);
  }

  /**
   * 记录设备状态
   */
  record(event: DeviceStatusRecord): void {
    const key = event.deviceMac;

    // 更新最新状态
    this.latest.set(key, event);

    // 追加历史
    if (!this.history.has(key)) {
      this.history.set(key, []);
    }
    const hist = this.history.get(key)!;
    hist.push(event);

    // 裁剪历史
    if (hist.length > this.maxHistoryPerDevice) {
      hist.splice(0, hist.length - this.maxHistoryPerDevice);
    }

    this.dirty = true;
  }

  /**
   * 获取设备最新状态
   */
  getLatest(deviceMac: string): DeviceStatusRecord | null {
    return this.latest.get(deviceMac) || null;
  }

  /**
   * 获取所有设备最新状态
   */
  getAllLatest(): DeviceStatusRecord[] {
    return Array.from(this.latest.values());
  }

  /**
   * 获取设备历史记录
   */
  getHistory(deviceMac: string, limit = 20): DeviceStatusRecord[] {
    const hist = this.history.get(deviceMac) || [];
    return hist.slice(-limit);
  }

  /**
   * 按设备类型查询
   */
  getByType(deviceType: string): DeviceStatusRecord[] {
    return Array.from(this.latest.values()).filter(
      r => r.deviceType.toLowerCase().includes(deviceType.toLowerCase())
    );
  }

  /**
   * 列出所有已知设备
   */
  listDevices(): Array<{ deviceMac: string; deviceType: string; lastSeen: number }> {
    return Array.from(this.latest.values()).map(r => ({
      deviceMac: r.deviceMac,
      deviceType: r.deviceType,
      lastSeen: r.timestamp,
    }));
  }

  /**
   * 导出摘要（供 OpenClaw agent 查询）
   */
  getSummary(): string {
    const devices = this.listDevices();
    if (devices.length === 0) return '暂无设备数据';

    const lines = devices.map(d => {
      const record = this.latest.get(d.deviceMac)!;
      const ctx = record.context;
      const age = Math.round((Date.now() - d.lastSeen) / 1000);
      const ageStr = age < 60 ? `${age}秒前` : age < 3600 ? `${Math.round(age / 60)}分钟前` : `${Math.round(age / 3600)}小时前`;

      const parts: string[] = [];
      if (ctx.temperature !== undefined) parts.push(`温度${ctx.temperature}°C`);
      if (ctx.humidity !== undefined) parts.push(`湿度${ctx.humidity}%`);
      if (ctx.battery !== undefined) parts.push(`电量${ctx.battery}%`);
      if (ctx.detectionState !== undefined) parts.push(ctx.detectionState === 'DETECTED' ? '有运动' : '无运动');
      if (ctx.power !== undefined) parts.push(ctx.power === 'on' ? '开启' : '关闭');
      if (ctx.openState !== undefined) parts.push(ctx.openState === 'open' ? '已打开' : '已关闭');
      if (ctx.lockState !== undefined) parts.push(`${ctx.lockState}`);
      if (ctx.slidePosition !== undefined) parts.push(`窗帘${ctx.slidePosition}%`);

      return `- ${d.deviceType} (${d.deviceMac}): ${parts.join(', ') || '状态已更新'} [${ageStr}]`;
    });

    return `SwitchBot 设备状态 (${devices.length} 台设备):\n${lines.join('\n')}`;
  }

  /**
   * 刷盘
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
   * 加载
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
   * 销毁
   */
  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.dirty) this.flush();
  }
}

// 全局单例
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
