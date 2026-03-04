/** SwitchBot 推送的设备状态事件 — 统一格式 */
export interface SwitchBotDeviceEvent {
  /** 事件类型 */
  eventType: 'changeReport';

  /** 事件版本 */
  eventVersion: '1';

  /** 事件上下文 */
  context: {
    /** 设备类型标识 (如 "WoMeterPro", "WoContact", "WoCurtain3" 等) */
    deviceType: string;

    /** 设备 MAC */
    deviceMac: string;

    /** 采样时间戳 (ms) */
    timeOfSample: number;

    /** === 通用状态字段 (各设备按需携带) === */

    // 温湿度类
    temperature?: number;        // °C
    humidity?: number;           // %

    // 开关类
    power?: 'on' | 'off';

    // 门窗传感器
    openState?: 'open' | 'close' | 'timeOutNotClose';
    brightness?: 'bright' | 'dim';

    // 窗帘
    slidePosition?: number;      // 0-100
    calibrate?: boolean;

    // 灯带/灯泡
    color?: string;              // "255:100:50" (R:G:B)
    colorTemperature?: number;   // 色温
    brightnessLevel?: number;    // 1-100

    // 电量
    battery?: number;            // 0-100

    // 运动传感器
    motionDetected?: boolean;

    // 锁
    lockState?: 'locked' | 'unlocked' | 'jammed';
    doorState?: 'open' | 'closed';

    // 气象站
    pressure?: number;           // hPa
    uvIndex?: number;
    windSpeed?: number;          // m/s
    windDirection?: number;      // 度
    rainRate?: number;           // mm/h

    /** 兜底: 未列出的字段 */
    [key: string]: unknown;
  };
}

/** OpenClaw 消息格式 */
export interface OpenClawMessage {
  senderId: string;
  text: string;
  metadata: {
    source: string;
    deviceId: string;
    deviceType: string;
    raw: any;
    timestamp: number;
  };
  routing?: {
    type: string;
    store: boolean;
    notify: boolean;
    ttl: number;
  };
}

/** 性能监控指标 */
export interface PerformanceMetrics {
  messagesReceived: number;
  messagesProcessed: number;
  apiCallsAttempted: number;
  apiCallsSuccessful: number;
  errors: Array<{
    method: string;
    error: string;
    timestamp: number;
  }>;
}

/** Gateway API 检测结果 */
export interface ApiDetectionResult {
  availableApis: string[];
  preferredApi: string | null;
  capabilities: {
    messagesSupported: boolean;
    eventsSupported: boolean;
    rpcSupported: boolean;
    toolsSupported: boolean;
  };
}

/** OpenClaw 运行时接口 */
export interface OpenClawRuntime {
  sendMessage?: (message: any) => Promise<void>;
  log?: (level: string, message: string, meta?: any) => void;
  config?: any;
}

/** SwitchBot 插件模块接口 */
export interface SwitchbotPluginModule {
  id: string;
  name: string;
  description: string;
  configSchema: any;
  register(api: any): void;
}