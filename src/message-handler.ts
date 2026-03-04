import { SwitchBotDeviceEvent, OpenClawMessage } from './types';

export function toOpenClawMessage(topic: string, event: SwitchBotDeviceEvent): OpenClawMessage {
  const deviceId = extractDeviceId(topic);

  return {
    senderId: `switchbot:${deviceId}`,
    text: formatEventText(event),
    metadata: {
      source: 'switchbot',
      deviceId,
      deviceType: event.context.deviceType,
      raw: event.context,
      timestamp: Date.now()
    },
    routing: {
      type: 'event',
      store: true,
      notify: shouldNotifyUser(event),
      ttl: 3600 * 24 * 7 // 7天数据保留期
    }
  };
}

function extractDeviceId(topic: string): string {
  // topic 格式: switchbot/{userId}/device/{deviceId}/status
  const parts = topic.split('/');
  return parts[3] || 'unknown';
}

function formatEventText(event: SwitchBotDeviceEvent): string {
  const ctx = event.context;
  const deviceType = getDeviceTypeName(ctx.deviceType);

  const statusParts: string[] = [];

  // 温湿度
  if (ctx.temperature !== undefined) {
    statusParts.push(`温度 ${ctx.temperature}°C`);
  }
  if (ctx.humidity !== undefined) {
    statusParts.push(`湿度 ${ctx.humidity}%`);
  }

  // 开关状态
  if (ctx.power !== undefined) {
    statusParts.push(`电源${ctx.power === 'on' ? '开启' : '关闭'}`);
  }

  // 门窗状态
  if (ctx.openState !== undefined) {
    const stateMap = {
      'open': '已打开',
      'close': '已关闭',
      'timeOutNotClose': '超时未关闭'
    };
    statusParts.push(`门窗${stateMap[ctx.openState] || ctx.openState}`);
  }

  // 电量
  if (ctx.battery !== undefined) {
    statusParts.push(`电量 ${ctx.battery}%`);
  }

  // 窗帘位置
  if (ctx.slidePosition !== undefined) {
    statusParts.push(`窗帘位置 ${ctx.slidePosition}%`);
  }

  // 运动检测
  if (ctx.motionDetected !== undefined) {
    statusParts.push(ctx.motionDetected ? '检测到运动' : '运动停止');
  }

  // 锁状态
  if (ctx.lockState !== undefined) {
    const lockMap = {
      'locked': '已锁定',
      'unlocked': '已解锁',
      'jammed': '卡住'
    };
    statusParts.push(`门锁${lockMap[ctx.lockState] || ctx.lockState}`);
  }

  // 亮度
  if (ctx.brightness !== undefined) {
    statusParts.push(`亮度${ctx.brightness === 'bright' ? '明亮' : '昏暗'}`);
  }

  // 灯光
  if (ctx.brightnessLevel !== undefined) {
    statusParts.push(`亮度 ${ctx.brightnessLevel}%`);
  }

  if (statusParts.length === 0) {
    statusParts.push('状态已更新');
  }

  return `📱 ${deviceType}: ${statusParts.join(', ')}`;
}

function getDeviceTypeName(deviceType: string): string {
  const typeMap: Record<string, string> = {
    'WoContact': '门窗传感器',
    'WoMeterPro': '温湿度计',
    'WoCurtain3': '窗帘控制器',
    'WoPlug': '智能插座',
    'WoBulb': '智能灯泡',
    'WoLock': '智能门锁',
    'WoMotion': '运动传感器',
    'WoMeter': '温湿度计',
    'WoPresence': '人体存在传感器',
    'WoHub2': 'Hub 2',
    'WoIOSensor': 'IO 传感器'
  };

  return typeMap[deviceType] || deviceType;
}

// 智能过滤：只有重要事件才通知用户
export function shouldNotifyUser(event: SwitchBotDeviceEvent): boolean {
  const ctx = event.context;

  // 1. 安全相关事件
  if (ctx.openState === 'open' && isSecurityDevice(ctx.deviceType)) {
    return true; // 门窗传感器异常开启
  }

  if (ctx.openState === 'timeOutNotClose') {
    return true; // 超时未关闭
  }

  // 2. 环境异常
  if (ctx.temperature && (ctx.temperature > 35 || ctx.temperature < 5)) {
    return true; // 极端温度
  }

  if (ctx.humidity && (ctx.humidity > 85 || ctx.humidity < 20)) {
    return true; // 极端湿度
  }

  // 3. 设备故障
  if (ctx.battery && ctx.battery < 10) {
    return true; // 电量过低
  }

  // 4. 运动检测 (夜间)
  if (ctx.motionDetected && isAfterHours()) {
    return true; // 非正常时间的运动
  }

  // 5. 门锁异常
  if (ctx.lockState === 'jammed') {
    return true; // 门锁卡住
  }

  if (ctx.lockState === 'unlocked' && isSecurityHours()) {
    return true; // 安全时间内解锁
  }

  return false; // 其他情况不主动通知
}

function isSecurityDevice(deviceType: string): boolean {
  return ['WoContact', 'WoLock', 'WoMotion'].includes(deviceType);
}

function isAfterHours(): boolean {
  const hour = new Date().getHours();
  return hour >= 22 || hour <= 6; // 晚10点到早6点
}

function isSecurityHours(): boolean {
  const hour = new Date().getHours();
  return hour >= 23 || hour <= 5; // 晚11点到早5点
}

// 验证设备事件格式
export function validateDeviceEvent(data: unknown): SwitchBotDeviceEvent {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid event data: not an object');
  }

  const event = data as any;

  if (event.eventType !== 'changeReport') {
    throw new Error(`Invalid event type: ${event.eventType}`);
  }

  if (event.eventVersion !== '1') {
    throw new Error(`Unsupported event version: ${event.eventVersion}`);
  }

  if (!event.context || typeof event.context !== 'object') {
    throw new Error('Invalid event context');
  }

  const ctx = event.context;

  if (!ctx.deviceType || !ctx.deviceMac || !ctx.timeOfSample) {
    throw new Error('Missing required context fields');
  }

  // MAC 地址格式验证
  if (!/^[0-9A-Fa-f:]{17}$/.test(ctx.deviceMac)) {
    throw new Error(`Invalid device MAC format: ${ctx.deviceMac}`);
  }

  return event as SwitchBotDeviceEvent;
}