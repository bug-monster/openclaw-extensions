# SwitchBot Channel for OpenClaw

SwitchBot 渠道插件，通过 AWS IoT Core MQTT 实时接收 SwitchBot 设备状态变化。

## 功能特性

- 🔗 **实时连接**: 通过 AWS IoT Core MQTT 接收设备状态更新
- 🏠 **智能设备支持**: 支持所有 SwitchBot 智能设备
- 🔄 **自动重连**: 网络断开时自动重连
- 🔑 **凭证管理**: 自动获取和续期 IoT 凭证
- 📱 **智能通知**: 仅在重要事件时通知用户
- 🔧 **灵活配置**: 支持监控所有设备或指定设备

## 支持设备

| 设备类型 | 设备代码 | 监控内容 |
|---------|----------|----------|
| 门窗传感器 | WoContact | 开关状态、亮度、电量 |
| 温湿度计 | WoMeter, WoMeterPro | 温度、湿度、电量 |
| 窗帘控制器 | WoCurtain3 | 位置、校准状态 |
| 智能插座 | WoPlug | 开关状态、电量消耗 |
| 智能灯泡 | WoBulb | 亮度、颜色、色温 |
| 智能门锁 | WoLock | 锁定状态、门状态 |
| 运动传感器 | WoMotion | 运动检测、电量 |
| 人体存在传感器 | WoPresence | 存在检测、电量 |

## 安装

### 方式 1: NPM 包安装 (推荐)

```bash
openclaw plugins install @switchbot/openclaw-channel
```

### 方式 2: 本地开发安装

```bash
git clone https://github.com/SwitchBot/openclaw-channel
cd openclaw-channel
npm install
npm run build
openclaw plugins install -l .
```

## 配置

### 获取 SwitchBot 凭证

1. 打开 SwitchBot App
2. 进入 **设置** > **开发者选项**
3. 获取 **Token** 和 **Secret**

### OpenClaw 配置

在 `~/.openclaw/openclaw.json` 中添加配置：

```json
{
  "plugins": {
    "allow": ["switchbot"]
  },
  "channels": {
    "switchbot": {
      "enabled": true,
      "token": "your_switchbot_token",
      "secret": "your_switchbot_secret",
      "deviceIds": [],
      "qos": 1,
      "renewBeforeMs": 300000
    }
  }
}
```

### 配置参数

| 参数 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `token` | string | ✅ | - | SwitchBot API Token |
| `secret` | string | ✅ | - | SwitchBot API Secret |
| `deviceIds` | string[] | ❌ | `[]` | 要监控的设备ID列表，留空监控所有设备 |
| `qos` | 0\|1\|2 | ❌ | `1` | MQTT QoS 级别 |
| `renewBeforeMs` | number | ❌ | `300000` | 凭证到期前多久开始续期(毫秒) |

### 设备 ID 获取

设备 ID 就是设备的 MAC 地址，可在 SwitchBot App 的设备详情页面查看。

示例配置监控特定设备：

```json
{
  "channels": {
    "switchbot": {
      "enabled": true,
      "token": "your_token",
      "secret": "your_secret",
      "deviceIds": [
        "C271111111",
        "H271111112"
      ]
    }
  }
}
```

## 启动

```bash
openclaw gateway restart
```

## 消息格式

插件接收到设备状态变化时会发送格式化消息到 OpenClaw：

```
📱 温湿度计: 温度 25.6°C, 湿度 65%, 电量 89%
📱 门窗传感器: 门窗已打开, 电量 76%
📱 智能门锁: 门锁已锁定, 门已关闭
```

### 智能通知策略

插件只在以下重要事件时通知用户：

- 🚨 **安全事件**: 门窗传感器异常开启、超时未关闭
- 🌡️ **环境异常**: 极端温度(<5°C 或 >35°C)、极端湿度(<20% 或 >85%)
- 🔋 **设备故障**: 电量过低(<10%)
- 🌙 **夜间运动**: 22:00-06:00 期间的运动检测
- 🔐 **安全时间解锁**: 23:00-05:00 期间的门锁解锁

## 开发

### 环境要求

- Node.js >= 18.0.0
- OpenClaw >= 2026.1.0

### 本地开发

```bash
# 克隆仓库
git clone https://github.com/SwitchBot/openclaw-channel
cd openclaw-channel

# 安装依赖
npm install

# 开发模式编译(监听文件变化)
npm run dev

# 生产编译
npm run build

# 运行测试
npm test
```

### 项目结构

```
├── index.ts                 # 主入口文件(OpenClaw 插件标准)
├── openclaw.plugin.json     # 插件元数据
├── package.json            # NPM 包配置
├── src/
│   ├── types.ts            # 类型定义
│   ├── config.ts           # 配置验证
│   ├── credential.ts       # IoT 凭证管理
│   ├── mqtt-client.ts      # MQTT 客户端
│   └── message-handler.ts  # 消息处理逻辑
└── dist/                   # 编译输出
```

## 故障排除

### 连接问题

1. **凭证错误**: 确认 Token 和 Secret 正确
2. **网络问题**: 检查到 AWS IoT Core 的连接
3. **设备离线**: 确认 SwitchBot 设备在线且连接正常

### 调试模式

启用详细日志：

```json
{
  "logging": {
    "level": "debug",
    "channels": {
      "switchbot": "debug"
    }
  }
}
```

### 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|----------|
| `Credential fetch failed` | Token/Secret 错误 | 重新获取正确的凭证 |
| `MQTT connection timeout` | 网络问题 | 检查网络连接和防火墙 |
| `Invalid device MAC format` | 设备ID格式错误 | 确认设备ID为正确的MAC地址格式 |

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！

---

更多信息请访问 [SwitchBot 官方文档](https://github.com/OpenWonderLabs/SwitchBotAPI)

一个为 OpenClaw 开发的 SwitchBot 频道插件，通过 AWS IoT Core MQTT 实时接收 SwitchBot 设备状态变更事件。

## 📋 功能特性

- **🔄 实时状态同步**: 通过 AWS IoT Core MQTT 接收设备状态推送
- **🌍 多区域支持**: 自动路由到最近的 AWS IoT Core 端点
- **🔐 自动认证**: 基于 AWS SigV4 的安全认证，支持凭证自动续期
- **📊 智能过滤**: 只有重要事件才推送通知，避免干扰
- **🛠️ Agent 工具**: 提供设备状态查询和警报查看功能
- **📈 性能监控**: 内置调试和性能指标

## 🚀 快速开始

### 安装

```bash
npm install @switchbot/openclaw-channel
```

### 配置

在 OpenClaw 配置文件中添加：

```json
{
  "channels": {
    "switchbot": {
      "token": "your_switchbot_token_here",
      "secret": "your_switchbot_secret_here",
      "credentialEndpoint": "https://api.switchbot.com/v2/iot/credential",
      "deviceIds": [],
      "qos": 1,
      "renewBeforeMs": 300000
    }
  }
}
```

### 配置参数

| 参数 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `token` | string | ✅ | - | SwitchBot 平台颁发的 token |
| `secret` | string | ✅ | - | SwitchBot secret for HMAC signing |
| `credentialEndpoint` | string | ❌ | `https://api.switchbot.com/v2/iot/credential` | 凭证接口地址 |
| `deviceIds` | string[] | ❌ | `[]` | 订阅的设备 ID 列表（空=订阅所有） |
| `qos` | 0\|1 | ❌ | `1` | MQTT QoS 级别 |
| `renewBeforeMs` | number | ❌ | `300000` | 凭证续期提前量（毫秒） |

## 🏗️ 架构设计

```
SwitchBot 设备 → SwitchBot Cloud → AWS IoT Core (MQTT)
                                        │
                                        ▼
                              OpenClaw SwitchBot Channel
                                        │
                                        ▼
                               Agent 工具 ← OpenClaw Gateway
```

### 核心特性

- **单向接收**: 只接收设备状态，不控制设备（控制请使用 SwitchBot Skill）
- **事件存储**: 本地存储设备事件，支持历史查询
- **智能通知**: 基于规则的重要事件过滤
- **多API兼容**: 支持多种 OpenClaw Gateway API

## 🛠️ Agent 工具

插件为 OpenClaw Agent 提供以下工具：

### `switchbot_check_devices`
检查 SwitchBot 设备当前状态

```
参数:
- deviceIds (可选): 设备ID列表
- includeHistory (可选): 是否包含历史数据

示例: "检查 SwitchBot 设备状态"
```

### `switchbot_get_alerts`
获取设备异常警报

```
参数:
- timeRange: 时间范围 (1h, 6h, 24h)
- severity: 警报级别 (all, high)

示例: "获取过去6小时的高优先级警报"
```

### `switchbot_plugin_status`
获取插件运行状态和统计信息

```
示例: "显示 SwitchBot 插件状态"
```

## 📊 支持的设备类型

| 设备类型 | 显示名称 | 状态字段 |
|----------|----------|----------|
| WoContact | 门窗传感器 | openState, brightness, battery |
| WoMeterPro | 温湿度计 | temperature, humidity, battery |
| WoCurtain3 | 窗帘控制器 | slidePosition, calibrate, battery |
| WoPlug | 智能插座 | power |
| WoBulb | 智能灯泡 | power, color, brightnessLevel |
| WoLock | 智能门锁 | lockState, doorState, battery |
| WoMotion | 运动传感器 | motionDetected, battery |

## 🚨 智能通知规则

插件会在以下情况自动发送通知：

### 安全事件
- 门窗传感器异常开启
- 门窗超时未关闭
- 门锁卡住
- 夜间（22:00-06:00）运动检测
- 深夜时间（23:00-05:00）门锁解锁

### 环境异常
- 极端温度（>35°C 或 <5°C）
- 极端湿度（>85% 或 <20%）

### 设备故障
- 电量过低（<10%）

## 🔧 开发指南

### 本地开发

```bash
# 克隆项目
git clone https://github.com/SwitchBot/openclaw-channel.git
cd openclaw-channel

# 安装依赖
npm install

# 编译
npm run build

# 运行测试
npm test

# 检查代码风格
npm run lint
```

### 项目结构

```
src/
├── index.ts              # 插件入口
├── config.ts             # 配置验证
├── credential.ts         # AWS IoT 凭证管理
├── mqtt-client.ts        # MQTT 客户端封装
├── message-handler.ts    # 消息转换和过滤
└── types.ts              # 类型定义

tests/                    # 单元测试
├── config.test.ts
├── credential.test.ts
└── message-handler.test.ts
```

## 🐛 故障排除

### 常见问题

#### MQTT 连接失败
```bash
# 检查凭证是否正确
curl -X POST https://api.switchbot.com/v2/iot/credential \
  -H "Authorization: your_token" \
  -H "sign: your_signature" \
  -d '{"instanceId": "test"}'
```

#### 无设备数据
1. 确认 SwitchBot token 和 secret 正确
2. 检查设备是否在线
3. 验证网络连接

#### Agent 工具不可用
1. 确认 OpenClaw 版本 >= 2026.1.0
2. 检查插件加载状态
3. 查看 Gateway 日志

### 调试模式

启动 Gateway 时启用详细日志：

```bash
openclaw gateway --verbose --log-level debug
```

查看插件相关日志：

```bash
tail -f ~/.openclaw/logs/gateway.log | grep SwitchBot
```

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📚 相关链接

- [OpenClaw 官方文档](https://docs.openclaw.ai/)
- [SwitchBot API 文档](https://github.com/OpenWonderLabs/SwitchBotAPI)
- [AWS IoT Core 文档](https://docs.aws.amazon.com/iot/)