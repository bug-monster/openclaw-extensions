import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { switchbotPlugin } from "./src/channel";
import { setSwitchBotRuntime } from "./src/runtime";
import { getDeviceStore } from "./src/device-store";
import type { SwitchbotPluginModule } from "./src/types";

const plugin: SwitchbotPluginModule = {
  id: "switchbot",
  name: "SwitchBot Channel",
  description: "SwitchBot IoT device channel via AWS IoT Core MQTT streaming",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi): void {
    setSwitchBotRuntime(api.runtime);
    api.registerChannel({ plugin: switchbotPlugin });

    // 注册 agent tool: 查询 SwitchBot 设备状态
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

        // 按 MAC 查找
        let record = store.getLatest(device.toUpperCase());

        // 按设备类型查找
        if (!record) {
          const byType = store.getByType(device);
          if (byType.length > 0) {
            if (history) {
              const hist = store.getHistory(byType[0].deviceMac, limit || 20);
              const lines = hist.map(r => {
                const ts = new Date(r.timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
                return `[${ts}] ${JSON.stringify(r.context)}`;
              });
              return { details: {}, content: [{ type: 'text', text: `${byType[0].deviceType} (${byType[0].deviceMac}) 历史记录 (${lines.length}条):\n${lines.join('\n')}` }] };
            }
            const lines = byType.map(r => {
              const age = Math.round((Date.now() - r.timestamp) / 1000);
              const ageStr = age < 60 ? `${age}秒前` : age < 3600 ? `${Math.round(age / 60)}分钟前` : `${Math.round(age / 3600)}小时前`;
              return `- ${r.deviceType} (${r.deviceMac}): ${JSON.stringify(r.context)} [${ageStr}]`;
            });
            return { details: {}, content: [{ type: 'text', text: lines.join('\n') }] };
          }
          return { details: {}, content: [{ type: 'text', text: `未找到设备: ${device}` }] };
        }

        if (history) {
          const hist = store.getHistory(device.toUpperCase(), limit || 20);
          const lines = hist.map(r => {
            const ts = new Date(r.timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
            return `[${ts}] ${JSON.stringify(r.context)}`;
          });
          return { details: {}, content: [{ type: 'text', text: `${record.deviceType} (${record.deviceMac}) 历史记录 (${lines.length}条):\n${lines.join('\n')}` }] };
        }

        const age = Math.round((Date.now() - record.timestamp) / 1000);
        const ageStr = age < 60 ? `${age}秒前` : age < 3600 ? `${Math.round(age / 60)}分钟前` : `${Math.round(age / 3600)}小时前`;
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