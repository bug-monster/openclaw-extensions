import { SwitchBotDeviceEvent, OpenClawMessage } from './types';

export function toOpenClawMessage(topic: string, event: SwitchBotDeviceEvent): OpenClawMessage {
  const userId = extractDeviceId(topic);
  const deviceMac = event.context.deviceMac;

  return {
    senderId: `switchbot:${deviceMac}`,
    text: formatEventText(event),
    metadata: {
      source: 'switchbot',
      deviceId: deviceMac,
      deviceType: event.context.deviceType,
      raw: event.context,
      timestamp: event.context.timeOfSample || Date.now()
    },
    routing: {
      type: 'event',
      store: true,
      notify: false,
      ttl: 3600 * 24 * 7
    }
  };
}

function extractDeviceId(topic: string): string {
  // topic format: switchbot/{userId}/devicestatus
  // Device ID is in payload deviceMac, here returns userId
  const parts = topic.split('/');
  return parts[1] || 'unknown';
}

function formatEventText(event: SwitchBotDeviceEvent): string {
  const ctx = event.context;
  const deviceType = ctx.deviceType;

  const statusParts: string[] = [];

  // Temperature and humidity
  if (ctx.temperature !== undefined) {
    statusParts.push(`Temperature ${ctx.temperature}°C`);
  }
  if (ctx.humidity !== undefined) {
    statusParts.push(`Humidity ${ctx.humidity}%`);
  }

  // Power status
  if (ctx.power !== undefined) {
    statusParts.push(`Power ${ctx.power === 'on' ? 'On' : 'Off'}`);
  }

  // Door/window status
  if (ctx.openState !== undefined) {
    const stateMap = {
      'open': 'Open',
      'close': 'Closed',
      'timeOutNotClose': 'Timeout Not Closed'
    };
    statusParts.push(`Door/Window ${stateMap[ctx.openState] || ctx.openState}`);
  }

  // Battery
  if (ctx.battery !== undefined) {
    statusParts.push(`Battery ${ctx.battery}%`);
  }

  // Curtain position
  if (ctx.slidePosition !== undefined) {
    statusParts.push(`Curtain Position ${ctx.slidePosition}%`);
  }

  // Motion/presence detection
  if (ctx.motionDetected !== undefined) {
    statusParts.push(ctx.motionDetected ? 'Motion Detected' : 'Motion Stopped');
  }

  // detectionState (Motion Sensor actual format)
  if (ctx.detectionState !== undefined) {
    statusParts.push(ctx.detectionState === 'DETECTED' ? 'Motion Detected' : 'No Motion');
  }

  // Lock status
  if (ctx.lockState !== undefined) {
    const lockMap = {
      'locked': 'Locked',
      'unlocked': 'Unlocked',
      'jammed': 'Jammed'
    };
    statusParts.push(`Door Lock ${lockMap[ctx.lockState] || ctx.lockState}`);
  }

  // Brightness
  if (ctx.brightness !== undefined) {
    statusParts.push(`Brightness ${ctx.brightness === 'bright' ? 'Bright' : 'Dim'}`);
  }

  // Light brightness level (legacy)
  if (ctx.brightnessLevel !== undefined) {
    statusParts.push(`Brightness ${ctx.brightnessLevel}%`);
  }

  if (statusParts.length === 0) {
    statusParts.push('Status Updated');
  }

  return `📱 ${deviceType}: ${statusParts.join(', ')}`;
}

// Validate device event format
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

  return event as SwitchBotDeviceEvent;
}