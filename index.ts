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
      description: 'Query SwitchBot smart home device status and manage device history. Returns latest status of all devices, or filter by MAC address or device type. Data comes from real-time MQTT device push notifications stored locally. Also supports clearing device history with flexible options.',
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
          },
          clearHistory: {
            type: 'boolean',
            description: 'If true, clear device history instead of querying. Requires additional parameters.'
          },
          target: {
            type: 'string',
            description: 'When clearHistory=true: Target to clear - device MAC address, device type, or "all" for all devices. If not specified, uses the "device" parameter.'
          },
          timeRange: {
            type: 'string',
            description: 'When clearHistory=true: Time range filter - "all" (default), "before:YYYY-MM-DD", "after:YYYY-MM-DD", or "days:N" (keep only last N days)'
          },
          keepLatest: {
            type: 'boolean',
            description: 'When clearHistory=true: Whether to keep the latest status record for each device (default: true)'
          },
          preview: {
            type: 'boolean',
            description: 'When clearHistory=true: Preview mode - show what would be cleared without actually deleting (default: false)'
          },
          confirm: {
            type: 'boolean',
            description: 'When clearHistory=true: Confirmation flag - must be true to actually execute the deletion (default: false)'
          }
        },
        required: [],
      },
      async execute(_id: string, params: {
        device?: string;
        history?: boolean;
        limit?: number;
        clearHistory?: boolean;
        target?: string;
        timeRange?: string;
        keepLatest?: boolean;
        preview?: boolean;
        confirm?: boolean;
      }): Promise<any> {
        const store = getDeviceStore();
        const { device, history, limit, clearHistory } = params;

        // Handle clear history functionality
        if (clearHistory) {
          const {
            target = device || 'all',
            timeRange = 'all',
            keepLatest = true,
            preview = false,
            confirm = false
          } = params;

          // Validate MAC address format if provided
          const macRegex = /^[0-9A-Fa-f]{12}$/;
          if (target !== 'all' && target.length === 12 && !macRegex.test(target.replace(/:/g, ''))) {
            return {
              details: {},
              content: [{
                type: 'text',
                text: 'Error: Invalid MAC address format. Use 12 hex characters (e.g., "CF7D1E125EAB")'
              }]
            };
          }

          // Safety check - require confirmation for actual deletion
          if (!preview && !confirm) {
            return {
              details: {},
              content: [{
                type: 'text',
                text: 'Safety check: To actually clear history data, set confirm=true. Use preview=true to see what would be cleared first.'
              }]
            };
          }

          // Parse time range options
          let beforeTimestamp: number | undefined;
          let afterTimestamp: number | undefined;

          if (timeRange !== 'all') {
            if (timeRange.startsWith('before:')) {
              const dateStr = timeRange.substring(7);
              const date = new Date(dateStr);
              if (isNaN(date.getTime())) {
                return {
                  details: {},
                  content: [{
                    type: 'text',
                    text: 'Error: Invalid date format. Use YYYY-MM-DD format.'
                  }]
                };
              }
              beforeTimestamp = date.getTime();
            } else if (timeRange.startsWith('after:')) {
              const dateStr = timeRange.substring(6);
              const date = new Date(dateStr);
              if (isNaN(date.getTime())) {
                return {
                  details: {},
                  content: [{
                    type: 'text',
                    text: 'Error: Invalid date format. Use YYYY-MM-DD format.'
                  }]
                };
              }
              afterTimestamp = date.getTime();
            } else if (timeRange.startsWith('days:')) {
              const daysStr = timeRange.substring(5);
              const days = parseInt(daysStr, 10);
              if (isNaN(days) || days < 0) {
                return {
                  details: {},
                  content: [{
                    type: 'text',
                    text: 'Error: Invalid days value. Use positive integer.'
                  }]
                };
              }
              beforeTimestamp = Date.now() - (days * 24 * 60 * 60 * 1000);
            }
          }

          // Build clear options
          const clearOptions: any = {
            keepLatest,
            dryRun: preview,
            beforeTimestamp,
            afterTimestamp
          };

          if (target === 'all') {
            // Clear all devices
          } else if (target.length === 12 && macRegex.test(target.replace(/:/g, ''))) {
            // Specific MAC address
            clearOptions.deviceMac = target.toUpperCase();
          } else {
            // Device type
            clearOptions.deviceType = target;
          }

          // Execute clear operation
          const result = store.clearHistory(clearOptions);

          // Format results
          const mode = preview ? '[PREVIEW MODE]' : '[EXECUTED]';
          const action = preview ? 'Would clear' : 'Cleared';

          let response = `${mode} ${action} history data:\n\n`;
          response += `Summary:\n`;
          response += `- Affected devices: ${result.clearedDevices.length}\n`;
          response += `- Total records ${preview ? 'to be ' : ''}cleared: ${result.totalRecordsCleared}\n`;
          response += `- Keep latest status: ${keepLatest ? 'Yes' : 'No'}\n`;

          if (result.clearedDevices.length > 0) {
            response += `\nDevice details:\n`;
            for (const deviceMac of result.clearedDevices) {
              const count = result.details[deviceMac];
              response += `- ${deviceMac}: ${count} records\n`;
            }
          }

          if (preview) {
            response += `\nTo execute this operation, run the command again with confirm=true.`;
          }

          if (!preview && result.totalRecordsCleared === 0) {
            response = 'No history records found matching the criteria.';
          }

          return {
            details: {},
            content: [{
              type: 'text',
              text: response
            }]
          };
        }

        // Original status query functionality
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