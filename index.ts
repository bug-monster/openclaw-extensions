import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { switchbotPlugin } from "./src/channel";
import { setSwitchBotRuntime } from "./src/runtime";
import type { SwitchbotPluginModule } from "./src/types";

const plugin: SwitchbotPluginModule = {
  id: "switchbot",
  name: "SwitchBot Channel",
  description: "SwitchBot IoT device channel via AWS IoT Core MQTT streaming",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi): void {
    setSwitchBotRuntime(api.runtime);
    api.registerChannel({ plugin: switchbotPlugin });
  },
};

export default plugin;