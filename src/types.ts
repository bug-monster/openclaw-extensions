/** SwitchBot device status event format — unified format */
export interface SwitchBotDeviceEvent {
  /** Event type */
  eventType: 'changeReport';

  /** Event version */
  eventVersion: '1';

  /** Event context */
  context: {
    /** Device type identifier (e.g. "WoMeterPro", "WoContact", "WoCurtain3" etc.) */
    deviceType: string;

    /** Device MAC address */
    deviceMac: string;

    /** Sample timestamp (ms) */
    timeOfSample: number;

    /** === Common status fields (devices carry as needed) === */

    // Temperature and humidity
    temperature?: number;        // °C
    humidity?: number;           // %

    // Power switch
    power?: 'on' | 'off';

    // Contact sensor
    openState?: 'open' | 'close' | 'timeOutNotClose';
    brightness?: 'bright' | 'dim';

    // Curtain
    slidePosition?: number;      // 0-100
    calibrate?: boolean;

    // LED strip/bulb
    color?: string;              // "255:100:50" (R:G:B)
    colorTemperature?: number;   // Color temperature
    brightnessLevel?: number;    // 1-100

    // Battery
    battery?: number;            // 0-100

    // Motion sensor
    motionDetected?: boolean;
    detectionState?: 'DETECTED' | 'NOT_DETECTED';

    // Lock
    lockState?: 'locked' | 'unlocked' | 'jammed';
    doorState?: 'open' | 'closed';

    // Weather station
    pressure?: number;           // hPa
    uvIndex?: number;
    windSpeed?: number;          // m/s
    windDirection?: number;      // degrees
    rainRate?: number;           // mm/h

    // Camera / Doorbell image
    imageUrl?: string;           // Snapshot image URL from camera/doorbell events
    detectionUrl?: string;       // Detection event image URL
    thumbnailUrl?: string;       // Thumbnail URL

    /** Fallback: unlisted fields */
    [key: string]: unknown;
  };
}

/** OpenClaw message format */
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

/** Performance metrics */
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

/** Gateway API detection result */
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

/** OpenClaw runtime interface */
export interface OpenClawRuntime {
  sendMessage?: (message: any) => Promise<void>;
  log?: (level: string, message: string, meta?: any) => void;
  config?: any;
}

/** SwitchBot plugin module interface */
export interface SwitchbotPluginModule {
  id: string;
  name: string;
  description: string;
  configSchema: any;
  register(api: any): void;
}