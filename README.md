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

SwitchBot Channel is an official channel plugin for the OpenClaw platform that receives real-time SwitchBot device status changes via MQTT protocol. Whether it's contact sensors, temperature/humidity meters, or smart plugs, you can monitor device status in real-time through OpenClaw and set up intelligent notifications.

## ✨ Features

- 🔄 **Real-time Sync**: Receive device status via MQTT in real-time
- 🏠 **Device Compatibility**: Support for all mainstream SwitchBot devices
- 🔑 **Auto Authentication**: Intelligent credential management with auto-renewal
- 🚨 **Smart Notifications**: Send notifications only for important events to avoid interruptions
- 🔧 **Zero Configuration**: Out-of-the-box functionality with just SwitchBot Token and Secret
- 📊 **History Records**: Local storage of device status history
- 🛡️ **High Availability**: Auto-reconnection with automatic recovery after network interruptions

## 🚀 Quick Start

### System Requirements

- **OpenClaw**: >= 2026.1.0
- **Node.js**: >= 18.0.0
- **SwitchBot App**: Latest version

### Step 1: Install Plugin

#### Method 1: NPM Installation (Recommended)

```bash
# Install plugin from npm
openclaw plugins install @linchengyu-org/switchbot-channel

# Verify installation
openclaw plugins list
```

#### Method 2: Manual Installation (for limited server environments)

If your OpenClaw server doesn't support npm operations, you can install manually:

**Step 1: Prepare the package locally**
```bash
# Clone or download the plugin source code
git clone https://github.com/bug-monster/openclaw-extensions.git
cd openclaw-extensions

# Install dependencies and build
npm install
npm run build

# Package everything (optional, for easier transfer)
tar -czf switchbot-channel.tar.gz .
```

**Step 2: Upload to server**
```bash
# Upload the complete package to your OpenClaw server
# Extract to: ~/.openclaw/extensions/switchbot-channel/
# or your preferred location
```

**Step 3: Manual configuration**
Edit your OpenClaw configuration file `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "switchbot-channel": {
        "enabled": true
      }
    },
    "installs": {
      "switchbot-channel": {
        "source": "local",
        "spec": "~/.openclaw/extensions/switchbot-channel",
        "installPath": "/full/path/to/.openclaw/extensions/switchbot-channel",
        "version": "0.1.8",
        "resolvedName": "switchbot-channel",
        "installedAt": "2026-03-09T12:00:00.000Z"
      }
    }
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

**Important notes for manual installation:**
- Replace `/full/path/to/` with your actual full path (e.g., `/home/username/` or `/Users/username/`)
- The `installPath` must be the absolute path to where you placed the plugin
- Update the `version` to match your plugin version
- Set `installedAt` to current timestamp or any valid ISO date

**Step 4: Restart OpenClaw**
```bash
# Restart OpenClaw to load the plugin
openclaw gateway restart

# Or if running as a service
sudo systemctl restart openclaw
```

#### Method 3: Local Development Installation

```bash
# For local development/testing
openclaw plugins install -l /path/to/switchbot-channel
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
    "entries": {
      "switchbot-channel": {
        "enabled": true
      }
    }
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

> 📝 **Note**: When using NPM installation, OpenClaw automatically manages the `plugins.installs` section. For manual installation, see Method 2 above for the complete configuration.

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
      "token": "xxxx",
      "secret": "xxxx"
    }
  }
}
```

## 📱 Usage Guide

### Device Status Monitoring

After the plugin starts, it will automatically receive status changes from all devices. You can view them using:

```bash
# View device status
openclaw devices list switchbot

# View specific device
openclaw devices show <device_id>
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

---

# 中文

## 📖 项目简介

SwitchBot Channel 是 OpenClaw 平台的官方渠道插件，通过 MQTT 协议实时接收 SwitchBot 设备状态变化。无论是门窗传感器、温湿度计还是智能插座，您都可以在 OpenClaw 中实时了解设备状态，并设置智能通知。

## ✨ 功能特性

- 🔄 **实时同步**：通过 MQTT 实时接收设备状态
- 🏠 **设备兼容**：支持所有主流 SwitchBot 设备
- 🔑 **自动认证**：智能管理凭证，自动续期
- 🚨 **智能通知**：仅在重要事件时发送通知，避免打扰
- 🔧 **零配置**：开箱即用，只需 SwitchBot Token 和 Secret
- 📊 **历史记录**：本地存储设备状态历史
- 🛡️ **高可用**：自动重连，网络中断后自动恢复

## 🚀 快速开始

### 系统要求

- **OpenClaw**: >= 2026.1.0
- **Node.js**: >= 18.0.0
- **SwitchBot App**: 最新版本

### 第一步：安装插件

#### 方法一：NPM 安装（推荐）

```bash
# 从 npm 安装插件
openclaw plugins install @linchengyu-org/switchbot-channel

# 验证安装
openclaw plugins list
```

#### 方法二：手动安装（适用于受限服务器环境）

如果您的 OpenClaw 服务器不支持 npm 操作，可以手动安装：

**第一步：本地准备插件包**
```bash
# 克隆或下载插件源代码
git clone https://github.com/bug-monster/openclaw-extensions.git
cd openclaw-extensions

# 安装依赖并构建
npm install
npm run build

# 打包（可选，便于传输）
tar -czf switchbot-channel.tar.gz .
```

**第二步：上传到服务器**
```bash
# 将完整的插件包上传到 OpenClaw 服务器
# 解压到：~/.openclaw/extensions/switchbot-channel/
# 或您偏好的位置
```

**第三步：手动配置**
编辑 OpenClaw 配置文件 `~/.openclaw/openclaw.json`：

```json
{
  "plugins": {
    "entries": {
      "switchbot-channel": {
        "enabled": true
      }
    },
    "installs": {
      "switchbot-channel": {
        "source": "local",
        "spec": "~/.openclaw/extensions/switchbot-channel",
        "installPath": "/完整路径/.openclaw/extensions/switchbot-channel",
        "version": "0.1.8",
        "resolvedName": "switchbot-channel",
        "installedAt": "2026-03-09T12:00:00.000Z"
      }
    }
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

**手动安装配置说明：**
- 将 `/完整路径/` 替换为实际的完整路径（如 `/home/username/` 或 `/Users/username/`）
- `installPath` 必须是插件放置位置的绝对路径
- 更新 `version` 以匹配您的插件版本
- 将 `installedAt` 设置为当前时间戳或任何有效的 ISO 日期

**第四步：重启 OpenClaw**
```bash
# 重启 OpenClaw 以加载插件
openclaw gateway restart

# 或如果作为系统服务运行
sudo systemctl restart openclaw
```

#### 方法三：本地开发安装

```bash
# 用于本地开发/测试
openclaw plugins install -l /path/to/switchbot-channel
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
    "entries": {
      "switchbot-channel": {
        "enabled": true
      }
    }
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

> 📝 **注意**: 使用 NPM 安装时，OpenClaw 会自动管理 `plugins.installs` 部分。手动安装请参考上面方法二的完整配置。

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
      "token": "xxxx",
      "secret": "xxxx"
    }
  }
}
```

## 📱 使用指南

### 设备状态监控

插件启动后会自动接收所有设备的状态变化，您可以通过以下方式查看：

```bash
# 查看设备状态
openclaw devices list switchbot

# 查看具体设备
openclaw devices show <device_id>
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

**Made with ❤️ by the SwitchBot Team**