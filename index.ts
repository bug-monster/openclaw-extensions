import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { switchbotPlugin } from "./src/channel";
import { setSwitchBotRuntime } from "./src/runtime";
import type { SwitchbotPluginModule } from "./src/types";

const plugin: SwitchbotPluginModule = {
  id: "switchbot",
  name: "SwitchBot Channel",
  description: "SwitchBot IoT device channel via AWS IoT Core MQTT streaming",
  configSchema: {
    type: 'object',
    // required: ['token', 'secret'],
    properties: {
      token: {
        type: 'string',
        description: 'SwitchBot API token from developer settings'
      },
      secret: {
        type: 'string',
        description: 'SwitchBot API secret from developer settings'
      },
      credentialEndpoint: {
        type: 'string',
        default: 'https://oqwck99em8.execute-api.us-east-1.amazonaws.com/open/v1.1/iot/credential',
        description: 'SwitchBot IoT credential endpoint'
      },
      qos: {
        type: 'number',
        enum: [0, 1, 2],
        default: 1,
        description: 'MQTT QoS level'
      },
      renewBeforeMs: {
        type: 'number',
        default: 300000,
        description: 'Renew credentials before expiry (milliseconds)'
      }
    }
  },
  register(api: OpenClawPluginApi): void {
    setSwitchBotRuntime(api.runtime);
    api.registerChannel({ plugin: switchbotPlugin });
  },
};

export default plugin;