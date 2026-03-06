# SwitchBot Channel for OpenClaw

> Connect your SwitchBot smart home devices to OpenClaw platform for real-time device status monitoring | 将您的 SwitchBot 智能家居设备连接到 OpenClaw 平台，实时监控设备状态变化

[![npm version](https://badge.fury.io/js/%40openclaw%2Fswitchbot-channel.svg)](https://badge.fury.io/js/%40openclaw%2Fswitchbot-channel)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 🌐 Language | 语言

- [🇺🇸 English](#english)
- [🇨🇳 中文](#中文)

---

# English

## 📖 Project Overview

SwitchBot Channel is an official channel plugin for the OpenClaw platform that receives real-time SwitchBot device status changes via AWS IoT Core MQTT protocol. Whether it's contact sensors, temperature/humidity meters, or smart plugs, you can monitor device status in real-time through OpenClaw and set up intelligent notifications.

## ✨ Features

- 🔄 **Real-time Sync**: Receive device status via AWS IoT Core MQTT in real-time
- 🏠 **Device Compatibility**: Support for all mainstream SwitchBot devices
- 🔑 **Auto Authentication**: Intelligent AWS IoT credential management with auto-renewal
- 🚨 **Smart Notifications**: Send notifications only for important events to avoid interruptions
- 🔧 **Zero Configuration**: Out-of-the-box functionality with just SwitchBot Token and Secret
- 📊 **History Records**: Local storage of device status history
- 🛡️ **High Availability**: Auto-reconnection with automatic recovery after network interruptions

## 📋 Supported Devices

| Device Type | Model | Monitoring Content |
|-------------|-------|-------------------|
| Contact Sensor | WoContact | Open/Close state, Brightness, Battery |
| Temperature/Humidity Meter | WoMeter, WoMeterPro | Temperature, Humidity, Battery |
| Curtain Controller | WoCurtain3 | Position, Calibration status, Battery |
| Smart Plug | WoPlug | Power state, Power consumption |
| Smart Bulb | WoBulb | Power, Brightness, Color, Color temperature |
| Smart Lock | WoLock | Lock state, Door state, Battery |
| Motion Sensor | WoMotion | Motion detection, Battery |
| Presence Sensor | WoPresence | Presence detection, Battery |

## 🚀 Quick Start

### System Requirements

- **OpenClaw**: >= 2026.1.0
- **Node.js**: >= 18.0.0
- **SwitchBot App**: Latest version

### Step 1: Install Plugin

#### Method 1: NPM Installation (Recommended)

```bash
# Install plugin
openclaw plugins install @openclaw/switchbot-channel

# Verify installation
openclaw plugins list
```

#### Method 2: Install from Source

```bash
# Clone repository
git clone https://github.com/bug-monster/openclaw-extensions.git
cd openclaw-extensions

# Install dependencies and build
npm install
npm run build

# Install to OpenClaw
openclaw plugins install -l .
```

### Step 2: Get SwitchBot Credentials

1. **Open SwitchBot App**
2. **Enter Developer Options**:
   - Tap "Settings" in bottom right
   - Find and tap "Developer Options"
   - If this option doesn't exist, ensure the App is updated to the latest version

3. **Get Credentials**:
   - Record the **Token** (64-character string)
   - Record the **Secret** (32-character string)

> ⚠️ **Important**: Keep your Token and Secret secure and don't share them with others

### Step 3: Configure OpenClaw

Edit OpenClaw configuration file `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "enabled": true,
    "allow": ["switchbot"]
  },
  "channels": {
    "switchbot": {
      "enabled": true,
      "token": "your_switchbot_token_here",
      "secret": "your_switchbot_secret_here"
    }
  }
}
```

### Step 4: Start Service

```bash
# Restart OpenClaw Gateway
openclaw gateway restart

# Check plugin status
openclaw status
```

## ⚙️ Configuration Details

### Basic Configuration

```json
{
  "channels": {
    "switchbot": {
      "enabled": true,
      "token": "beb75f54fb2aed0ea6d6cc0444ebbe1b04b23d834125ccbbe7ef72652f51bcd64366b6f01beec8ffd6307ccd03c6e9fd",
      "secret": "ba58a15a119678256c0d9fff00a607cb"
    }
  }
}
```

### Advanced Configuration

```json
{
  "channels": {
    "switchbot": {
      "enabled": true,
      "token": "your_token",
      "secret": "your_secret",
      "credentialEndpoint": "https://oqwck99em8.execute-api.us-east-1.amazonaws.com/open/v1.1/iot/credential",
      "qos": 1,
      "renewBeforeMs": 3600000
    }
  }
}
```

### Configuration Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `enabled` | boolean | ❌ | `true` | Whether to enable SwitchBot channel |
| `token` | string | ✅ | - | SwitchBot API Token |
| `secret` | string | ✅ | - | SwitchBot API Secret |
| `credentialEndpoint` | string | ❌ | AWS IoT endpoint | IoT credential endpoint URL |
| `qos` | 0\|1\|2 | ❌ | `1` | MQTT message quality level |
| `renewBeforeMs` | number | ❌ | `3600000` | Credential renewal lead time (milliseconds) |

## 📱 Usage Guide

### Device Status Monitoring

After the plugin starts, it will automatically receive status changes from all devices. You can view them using:

```bash
# View device status
openclaw devices list switchbot

# View specific device
openclaw devices show <device_id>
```

### Smart Notifications

The plugin will send notifications for the following important events:

#### 🔒 Security Events
- Contact sensor abnormal opening
- Night motion detection (22:00-06:00)
- Late night lock unlock (23:00-05:00)

#### 🌡️ Environmental Anomalies
- Extreme temperature (< 5°C or > 35°C)
- Extreme humidity (< 20% or > 85%)

#### ⚡ Device Failures
- Low device battery (< 10%)
- Device offline for more than 30 minutes

### Agent Tools

When the plugin is running, OpenClaw Agent can use the following tools:

```
Check SwitchBot device status
Get device alert information
View plugin runtime status
```

## 🔍 Troubleshooting

### Common Issues

#### Q: Plugin fails to start
**A**: Check configuration

```bash
# Check configuration syntax
openclaw config validate

# View detailed errors
openclaw gateway logs --follow
```

#### Q: Not receiving device messages
**A**: Verify credentials and network

1. **Check SwitchBot credentials**:
   ```bash
   # Test API connection
   curl -H "Authorization: your_token" \
        -H "sign: your_hmac_signature" \
        https://api.switch-bot.com/v1.1/devices
   ```

2. **Check network connection**:
   - Ensure access to AWS IoT Core
   - Check firewall settings

3. **Verify devices are online**:
   - Confirm devices are online in SwitchBot App
   - Try controlling devices to confirm normal connection

#### Q: Frequent reconnections
**A**: Adjust renewal time

```json
{
  "channels": {
    "switchbot": {
      "renewBeforeMs": 1800000  // Renew every 30 minutes
    }
  }
}
```

### Debug Mode

Enable detailed logging for troubleshooting:

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

View logs:
```bash
# View real-time logs
tail -f ~/.openclaw/logs/gateway.log | grep "SwitchBot"

# View error logs
openclaw gateway logs --level error
```

### Reset Plugin

If you encounter serious issues, you can reset the plugin:

```bash
# Stop service
openclaw gateway stop

# Clear plugin cache
rm -rf ~/.openclaw/cache/plugins/switchbot

# Restart
openclaw gateway start
```

## 🛠️ Development Guide

### Local Development

```bash
# Clone project
git clone https://github.com/bug-monster/openclaw-extensions.git
cd openclaw-extensions

# Install dependencies
npm install

# Development mode (auto-compile)
npm run dev

# Run tests
npm test

# Check code quality
npm run lint
```

### Project Structure

```
src/
├── channel.ts           # Main channel class
├── config.ts            # Configuration validation and management
├── credential.ts        # AWS IoT credential service
├── mqtt-client.ts       # MQTT client wrapper
├── message-handler.ts   # Message processing and validation
├── device-store.ts      # Device status storage
├── types.ts             # TypeScript type definitions
└── runtime.ts           # Runtime utilities

dist/                    # Compiled output
tests/                   # Unit tests
```

### API Documentation

The plugin follows OpenClaw Channel Plugin standards and implements the following interfaces:

- **Account Management**: `listAccountIds`, `resolveAccount`
- **Configuration Management**: `configSchema`, `isConfigured`
- **Gateway Services**: `startAccount`, `stopAccount`
- **Status Monitoring**: `collectStatusIssues`, `probeAccount`

---

# 中文

## 📖 项目简介

SwitchBot Channel 是 OpenClaw 平台的官方渠道插件，通过 AWS IoT Core MQTT 协议实时接收 SwitchBot 设备状态变化。无论是门窗传感器、温湿度计还是智能插座，您都可以在 OpenClaw 中实时了解设备状态，并设置智能通知。

## ✨ 功能特性

- 🔄 **实时同步**：通过 AWS IoT Core MQTT 实时接收设备状态
- 🏠 **设备兼容**：支持所有主流 SwitchBot 设备
- 🔑 **自动认证**：智能管理 AWS IoT 凭证，自动续期
- 🚨 **智能通知**：仅在重要事件时发送通知，避免打扰
- 🔧 **零配置**：开箱即用，只需 SwitchBot Token 和 Secret
- 📊 **历史记录**：本地存储设备状态历史
- 🛡️ **高可用**：自动重连，网络中断后自动恢复

## 📋 支持的设备

| 设备类型 | 型号 | 监控内容 |
|---------|------|----------|
| 门窗传感器 | WoContact | 开关状态、亮度、电量 |
| 温湿度计 | WoMeter, WoMeterPro | 温度、湿度、电量 |
| 窗帘控制器 | WoCurtain3 | 位置、校准状态、电量 |
| 智能插座 | WoPlug | 开关状态、功率 |
| 智能灯泡 | WoBulb | 开关、亮度、颜色、色温 |
| 智能门锁 | WoLock | 锁定状态、门状态、电量 |
| 运动传感器 | WoMotion | 运动检测、电量 |
| 人体存在传感器 | WoPresence | 存在检测、电量 |

## 🚀 快速开始

### 系统要求

- **OpenClaw**: >= 2026.1.0
- **Node.js**: >= 18.0.0
- **SwitchBot App**: 最新版本

### 第一步：安装插件

#### 方法1：NPM 安装（推荐）

```bash
# 安装插件
openclaw plugins install @openclaw/switchbot-channel

# 验证安装
openclaw plugins list
```

#### 方法2：从源码安装

```bash
# 克隆仓库
git clone https://github.com/bug-monster/openclaw-extensions.git
cd openclaw-extensions

# 安装依赖并构建
npm install
npm run build

# 安装到 OpenClaw
openclaw plugins install -l .
```

### 第二步：获取 SwitchBot 凭证

1. **打开 SwitchBot App**
2. **进入开发者选项**：
   - 点击右下角 "设置"
   - 找到并点击 "开发者选项"
   - 如果没有此选项，请确保 App 为最新版本

3. **获取凭证**：
   - 记录 **Token** (64位字符串)
   - 记录 **Secret** (32位字符串)

> ⚠️ **重要提示**：请妥善保管您的 Token 和 Secret，不要泄露给他人

### 第三步：配置 OpenClaw

编辑 OpenClaw 配置文件 `~/.openclaw/openclaw.json`：

```json
{
  "plugins": {
    "enabled": true,
    "allow": ["switchbot"]
  },
  "channels": {
    "switchbot": {
      "enabled": true,
      "token": "your_switchbot_token_here",
      "secret": "your_switchbot_secret_here"
    }
  }
}
```

### 第四步：启动服务

```bash
# 重启 OpenClaw Gateway
openclaw gateway restart

# 检查插件状态
openclaw status
```

## ⚙️ 配置详解

### 基本配置

```json
{
  "channels": {
    "switchbot": {
      "enabled": true,
      "token": "beb75f54fb2aed0ea6d6cc0444ebbe1b04b23d834125ccbbe7ef72652f51bcd64366b6f01beec8ffd6307ccd03c6e9fd",
      "secret": "ba58a15a119678256c0d9fff00a607cb"
    }
  }
}
```

### 高级配置

```json
{
  "channels": {
    "switchbot": {
      "enabled": true,
      "token": "your_token",
      "secret": "your_secret",
      "credentialEndpoint": "https://oqwck99em8.execute-api.us-east-1.amazonaws.com/open/v1.1/iot/credential",
      "qos": 1,
      "renewBeforeMs": 3600000
    }
  }
}
```

### 配置参数说明

| 参数 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `enabled` | boolean | ❌ | `true` | 是否启用 SwitchBot 渠道 |
| `token` | string | ✅ | - | SwitchBot API Token |
| `secret` | string | ✅ | - | SwitchBot API Secret |
| `credentialEndpoint` | string | ❌ | AWS IoT endpoint | IoT 凭证获取地址 |
| `qos` | 0\|1\|2 | ❌ | `1` | MQTT 消息质量等级 |
| `renewBeforeMs` | number | ❌ | `3600000` | 凭证续期提前时间（毫秒） |

## 📱 使用指南

### 设备状态监控

插件启动后会自动接收所有设备的状态变化，您可以通过以下方式查看：

```bash
# 查看设备状态
openclaw devices list switchbot

# 查看具体设备
openclaw devices show <device_id>
```

### 智能通知

插件会在以下重要事件时发送通知：

#### 🔒 安全事件
- 门窗传感器异常开启
- 夜间（22:00-06:00）运动检测
- 深夜（23:00-05:00）门锁解锁

#### 🌡️ 环境异常
- 极端温度（< 5°C 或 > 35°C）
- 极端湿度（< 20% 或 > 85%）

#### ⚡ 设备故障
- 设备电量过低（< 10%）
- 设备离线超过 30 分钟

### Agent 工具

当插件运行时，OpenClaw Agent 可以使用以下工具：

```
检查 SwitchBot 设备状态
获取设备警报信息
查看插件运行状态
```

## 🔍 故障排除

### 常见问题

#### Q: 插件无法启动
**A**: 检查配置

```bash
# 检查配置语法
openclaw config validate

# 查看详细错误
openclaw gateway logs --follow
```

#### Q: 收不到设备消息
**A**: 验证凭证和网络

1. **检查 SwitchBot 凭证**：
   ```bash
   # 测试 API 连接
   curl -H "Authorization: your_token" \
        -H "sign: your_hmac_signature" \
        https://api.switch-bot.com/v1.1/devices
   ```

2. **检查网络连接**：
   - 确保能访问 AWS IoT Core
   - 检查防火墙设置

3. **验证设备在线**：
   - 在 SwitchBot App 中确认设备在线
   - 尝试控制设备确认连接正常

#### Q: 频繁重连
**A**: 调整续期时间

```json
{
  "channels": {
    "switchbot": {
      "renewBeforeMs": 1800000  // 30分钟续期一次
    }
  }
}
```

### 调试模式

启用详细日志进行问题诊断：

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

查看日志：
```bash
# 实时查看日志
tail -f ~/.openclaw/logs/gateway.log | grep "SwitchBot"

# 查看错误日志
openclaw gateway logs --level error
```

### 重置插件

如果遇到严重问题，可以重置插件：

```bash
# 停止服务
openclaw gateway stop

# 清理插件缓存
rm -rf ~/.openclaw/cache/plugins/switchbot

# 重新启动
openclaw gateway start
```

## 🛠️ 开发指南

### 本地开发

```bash
# 克隆项目
git clone https://github.com/bug-monster/openclaw-extensions.git
cd openclaw-extensions

# 安装依赖
npm install

# 开发模式（自动编译）
npm run dev

# 运行测试
npm test

# 检查代码质量
npm run lint
```

### 项目结构

```
src/
├── channel.ts           # 主渠道类
├── config.ts            # 配置验证和管理
├── credential.ts        # AWS IoT 凭证服务
├── mqtt-client.ts       # MQTT 客户端封装
├── message-handler.ts   # 消息处理和验证
├── device-store.ts      # 设备状态存储
├── types.ts             # TypeScript 类型定义
└── runtime.ts           # 运行时工具

dist/                    # 编译输出
tests/                   # 单元测试
```

### API 文档

插件遵循 OpenClaw Channel Plugin 标准，实现以下接口：

- **账户管理**：`listAccountIds`, `resolveAccount`
- **配置管理**：`configSchema`, `isConfigured`
- **网关服务**：`startAccount`, `stopAccount`
- **状态监控**：`collectStatusIssues`, `probeAccount`

## 📄 License | 许可证

This project is licensed under the [MIT License](LICENSE). | 本项目采用 [MIT License](LICENSE) 许可证。

## 🤝 Contributing | 贡献

We welcome contributions of all kinds! | 我们欢迎各种形式的贡献！

### Report Issues | 报告问题

Report in [GitHub Issues](https://github.com/bug-monster/openclaw-extensions/issues): | 在 [GitHub Issues](https://github.com/bug-monster/openclaw-extensions/issues) 中报告：
- 🐛 Bug reports | Bug 报告
- 💡 Feature suggestions | 功能建议
- 📚 Documentation improvements | 文档改进

### Submit Code | 提交代码

1. Fork the project | Fork 项目
2. Create a feature branch | 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. Commit your changes | 提交更改 (`git commit -m 'Add amazing feature'`)
4. Push to the branch | 推送到分支 (`git push origin feature/amazing-feature`)
5. Create a Pull Request | 创建 Pull Request

## 🔗 Related Links | 相关链接

- [OpenClaw Documentation | OpenClaw 官方文档](https://docs.openclaw.ai/)
- [SwitchBot API Documentation | SwitchBot API 文档](https://github.com/OpenWonderLabs/SwitchBotAPI)
- [OpenClaw Plugin Development Guide | OpenClaw 插件开发指南](https://docs.openclaw.ai/plugins/)
- [AWS IoT Core Documentation | AWS IoT Core 文档](https://docs.aws.amazon.com/iot/)

## 📞 Support | 支持

For help, please: | 如需帮助，请：

1. Check [FAQ documentation](docs/FAQ.md) | 查看 [FAQ 文档](docs/FAQ.md)
2. Search [existing Issues](https://github.com/bug-monster/openclaw-extensions/issues) | 搜索 [现有 Issues](https://github.com/bug-monster/openclaw-extensions/issues)
3. Create a new [Issue](https://github.com/bug-monster/openclaw-extensions/issues/new) | 创建新的 [Issue](https://github.com/bug-monster/openclaw-extensions/issues/new)
4. Join [OpenClaw Community](https://discord.gg/openclaw) | 加入 [OpenClaw 社区](https://discord.gg/openclaw)

---

**Made with ❤️ by the SwitchBot Team**