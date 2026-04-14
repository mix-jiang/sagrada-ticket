# Sagrada Familia Ticket Monitor

一个基于 Node.js + Playwright 的门票监测 + 半自动下单工具。

- 定时轮询官方购票接口，有票立刻提醒
- 发现有票后自动打开浏览器、完成选座/选票/填写乘客信息
- **支付前默认暂停**，由你手动确认，不会在你不知情的情况下扣款

---

## 快速开始

### 1. 前置条件

```bash
node --version   # 需要 v18 或更高
```

### 2. 安装依赖

```bash
npm install
npx playwright install chromium
```

### 3. 配置购票信息

**方式 A（推荐）— 交互式向导**

```bash
npm run setup
```

向导会逐步询问：出行日期、票数、票种、乘客姓名/证件/邮箱、是否支付前暂停，
并自动生成 `config.yaml`。

**方式 B — 手动编辑**

```bash
cp config.example.yaml config.yaml
# 用任意文本编辑器打开 config.yaml，按注释说明填写
```

至少需要修改的字段：

| 字段 | 说明 |
|------|------|
| `target.date` | 想要的入场日期，格式 `YYYY-MM-DD` |
| `target.quantity` | 票数 |
| `target.ticketCategory` | 票种，需与网站页面显示的文字一致 |
| `passengers[*].firstName/lastName` | 乘客姓名，需与证件完全一致 |
| `passengers[*].email` | 乘客邮箱（订单确认邮件） |
| `passengers[*].documentId` | 证件号码 |

### 4. 验证配置是否正常

```bash
npm run once-api
```

输出 `API availability: NOT FOUND` 是正常的（说明当天没票），只要没有报错就代表网络和配置都 OK。

### 5. 开始监控

```bash
npm run watch-api-fast
```

程序每 5 秒轮询一次官方可用性接口。发现有票时：
1. 终端打印通知，macOS 弹出桌面提醒
2. 如果 `checkout.enabled: true`，自动打开浏览器进入购票流程
3. 填完乘客信息后，在支付页面**暂停等待你确认**

> 💡 建议保持终端窗口可见，或者配置 `notifications.webhookUrl` 发到手机/Slack。

---

## 全部命令

| 命令 | 说明 |
|------|------|
| `npm run setup` | 交互式配置向导，生成 config.yaml |
| `npm run once-api` | 调一次接口，查当前库存状态 |
| `npm run watch-api-fast` | **主监控**：接口级高频轮询（每 5 秒），发现有票后自动下单 |
| `npm run once` | 用浏览器检测一次（DOM 解析，较慢） |
| `npm run monitor` | 用浏览器循环监测（DOM 解析，默认 45 秒间隔） |
| `npm run watch-fast` | 用浏览器高频监测（DOM 解析，每 10 秒） |
| `npm run checkout` | 跳过监控，直接执行一次下单流程 |
| `npm run inspect-api` | 抓取页面真实网络请求，保存到 artifacts/ |

---

## 工作流程说明

```
npm run watch-api-fast
       │
       ▼
  每5秒轮询 Clorian 可用性接口
       │
  有票? ──否──▶ 继续等待
       │
       是
       ▼
  打开浏览器（非 headless）
  ┌─────────────────────────────────────┐
  │ 1. 打开购票页面（?date= 参数直达）  │
  │ 2. 选最早的可用时间段               │
  │ 3. 选票种 + 数量（e.g. Under 30 ×2）│
  │ 4. 点击 CONTINUE 展开乘客信息表单   │
  │ 5. 填写乘客姓名                     │
  │ 6. 点击 CONTINUE 进入购物车页       │
  │ 7. ★ 暂停 ★ 等待你手动确认支付    │
  └─────────────────────────────────────┘
```

**支付前暂停**：`checkout.pauseBeforePayment: true`（默认）确保程序不会在没有人工确认的情况下扣款。你需要自己检查浏览器里的订单信息，然后手动点击支付按钮。

---

## 配置说明

所有配置项都在 `config.yaml` 中，含详细注释。以下是最常用的：

### 监控频率

```yaml
monitor:
  intervalSeconds: 45   # 浏览器轮询间隔（watch-api-fast 固定 5 秒，不受此影响）
```

### 时间段偏好

```yaml
target:
  preferredTimes:
    - "10:30-13:00"
    - "13:00-16:00"
    - "16:00-19:30"
```

程序会选**最早的**可用且库存足够的时间段。

### 通知方式

```yaml
notifications:
  console: true          # 终端输出
  desktop: true          # macOS 桌面通知
  webhookUrl: ""         # 填入 Slack/Discord Webhook URL 可发到手机
```

### 关闭自动下单（只监控不购票）

```yaml
checkout:
  enabled: false
```

---

## 截图和日志

- 下单过程中的截图保存到 `./artifacts/` 目录
- 所有终端输出都包含时间戳，格式为 `[HH:MM:SS]`

---

## 常见问题

**Q: 显示 "No matching time slot found"**
检查 `target.preferredTimes` 的时间范围是否覆盖了当天实际开放的时间段，或者当天该时段已售罄。

**Q: 显示 "Could not find ticket category"**
检查 `target.ticketCategory` 的文字是否和网站页面上的完全一致（不区分大小写）。

**Q: 乘客表单没有出现**
程序需要先点击"CONTINUE"按钮才能展开乘客表单。如果页面结构有变化，请运行 `npm run inspect-api` 抓取最新 DOM 结构。

**Q: 我想完全不交互，自动到支付步骤**
设置 `checkout.pauseBeforePayment: false` 且 `checkout.proceedToPayment: true`。**风险自负**，建议只在你已完整测试过流程之后才这样做。

---

## 注意事项

- 这是针对真实购票网站的辅助工具，请勿高频 UI 轮询（优先使用 `watch-api-fast`）
- 支付步骤默认由你手动完成，程序不存储信用卡信息
- 如遇到验证码，程序会停在对应页面，方便你手动处理后继续
