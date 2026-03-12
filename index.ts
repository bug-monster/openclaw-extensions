import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { switchbotPlugin } from "./src/channel";
import { setSwitchBotRuntime } from "./src/runtime";
import { getDeviceStore } from "./src/device-store";
import type { SwitchbotPluginModule } from "./src/types";

const plugin: SwitchbotPluginModule = {
  id: "switchbot-channel",
  name: "SwitchBot Channel",
  description: "SwitchBot IoT device channel",
  configSchema: {
    type: 'object',
    properties: {
      token: {
        type: 'string',
        description: 'SwitchBot API token from developer settings',
      },
      secret: {
        type: 'string',
        description: 'SwitchBot API secret from developer settings',
      },
      monitorDeviceIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Device IDs (MAC addresses) to monitor in real-time and push to chat via LLM analysis',
      },
    },
  },
  register(api: OpenClawPluginApi): void {
    setSwitchBotRuntime(api.runtime);
    api.registerChannel({ plugin: switchbotPlugin });

    // Register agent tool: Query SwitchBot device status
    api.registerTool({
      name: 'switchbot_status',
      label: 'SwitchBot Status',
      description: 'Query SwitchBot smart home device status. Returns latest status of all devices, or filter by MAC address or device type. Data comes from real-time MQTT device push notifications stored locally.',
      parameters: {
        type: 'object',
        properties: {
          device: {
            type: 'string',
            description: 'Optional: device MAC address (e.g. "CF7D1E125EAB") or device type (e.g. "Motion Sensor"). If omitted, returns all devices summary.'
          },
          history: {
            type: 'boolean',
            description: 'If true, return recent history for the device. Default false.'
          },
          limit: {
            type: 'number',
            description: 'Number of history entries (default 20, max 100).'
          }
        },
        required: [],
      },
      async execute(_id: string, params: { device?: string; history?: boolean; limit?: number }): Promise<any> {
        const store = getDeviceStore();
        const { device, history, limit } = params;

        if (!device) {
          const summary = store.getSummary();
          return { details: {}, content: [{ type: 'text', text: summary }] };
        }

        // Search by MAC address
        let record = store.getLatest(device.toUpperCase());

        // Search by device type
        if (!record) {
          const byType = store.getByType(device);
          if (byType.length > 0) {
            if (history) {
              const hist = store.getHistory(byType[0].deviceMac, limit || 20);
              const lines = hist.map(r => {
                const ts = new Date(r.timestamp).toLocaleString('en-US', { timeZone: 'Asia/Shanghai' });
                return `[${ts}] ${JSON.stringify(r.context)}`;
              });
              return { details: {}, content: [{ type: 'text', text: `${byType[0].deviceType} (${byType[0].deviceMac}) History (${lines.length} records):\n${lines.join('\n')}` }] };
            }
            const lines = byType.map(r => {
              const age = Math.round((Date.now() - r.timestamp) / 1000);
              const ageStr = age < 60 ? `${age}s ago` : age < 3600 ? `${Math.round(age / 60)}m ago` : `${Math.round(age / 3600)}h ago`;
              return `- ${r.deviceType} (${r.deviceMac}): ${JSON.stringify(r.context)} [${ageStr}]`;
            });
            return { details: {}, content: [{ type: 'text', text: lines.join('\n') }] };
          }
          return { details: {}, content: [{ type: 'text', text: `Device not found: ${device}` }] };
        }

        if (history) {
          const hist = store.getHistory(device.toUpperCase(), limit || 20);
          const lines = hist.map(r => {
            const ts = new Date(r.timestamp).toLocaleString('en-US', { timeZone: 'Asia/Shanghai' });
            return `[${ts}] ${JSON.stringify(r.context)}`;
          });
          return { details: {}, content: [{ type: 'text', text: `${record.deviceType} (${record.deviceMac}) History (${lines.length} records):\n${lines.join('\n')}` }] };
        }

        const age = Math.round((Date.now() - record.timestamp) / 1000);
        const ageStr = age < 60 ? `${age}s ago` : age < 3600 ? `${Math.round(age / 60)}m ago` : `${Math.round(age / 3600)}h ago`;
        return {
          content: [{
            type: 'text',
            text: `${record.deviceType} (${record.deviceMac}) [${ageStr}]:\n${JSON.stringify(record.context, null, 2)}`
          }]
        };
      },
    });
  },
};

export default plugin;