# 圣家堂票务助手 — Agent 指引

## 项目概况

- 目标：监测圣家堂官方票务库存，发现有票后自动推进下单，支付前暂停等待人工确认
- 运行环境：Node.js + Playwright
- 入口：`src/index.js`

## 当前进度

| 步骤 | 状态 |
|------|------|
| API 库存监测 | ✅ 完成 |
| 日期选择（URL param） | ✅ 完成 |
| 时间段筛选 | ✅ 完成 |
| 票类 + 数量选择 | ✅ 完成 |
| 乘客姓名字段识别 | ✅ 字段 ID 已抓到 |
| 填写乘客信息后的 Continue 流程 | ✅ 完成 |
| 邮箱 / 证件号填写 | 由 config.yaml 配置 |

## 常用命令

```bash
npm run once-api        # API 查一次库存
npm run watch-api-fast  # API 高频监测（每 5 秒）
npm run checkout        # 执行下单流程
npm run inspect-api     # 抓取页面真实接口
```

## 已验证接口（Clorian 后端）

```
POST https://services.clorian.com/user/api/oauth/token?secretKey=thesagradafamiliafrontendoftomorrow
```
- Origin header：`https://tickets.sagradafamilia.org`
- body 可为空

```
GET https://services.clorian.com/catalog/salesGroups/1/product/4375/availability?...
```

## 已验证 DOM 操作

**日期选择**：不要点日历格子，直接用 URL param
```
https://tickets.sagradafamilia.org/en/1-individual/4375-sagrada-familia?date=YYYY-MM-DD
```

**时间段**：选最早且剩余库存 ≥ 目标数量的时间段，不足则跳过

**票类 + 数量**
- 票类容器：`.buyerType`
- 加减按钮：`button[data-action-id="increment/decrement"]`

**乘客信息字段**（通用选择器在本站无效，使用真实 ID）
```
contact-formsection-810.field-3711-bt-304-0[0].value   # 乘客1 名
contact-formsection-810.field-3712-bt-304-0[0].value   # 乘客1 姓
contact-formsection-810.field-3711-bt-304-1[0].value   # 乘客2 名
contact-formsection-810.field-3712-bt-304-1[0].value   # 乘客2 姓
```
建议用 `page.on('response')` 动态获取字段 ID，避免硬编码失效。

## 开发原则

**先用 API 拿数据，再用 DOM 推状态，两者结合。**

| 场景 | 方式 |
|------|------|
| 读取库存 / 可用性 | API Interception |
| 日期选择 | URL `?date=` param |
| 点选时间段 / 票种 / 数量 | DOM click |
| 填写表单字段 | DOM fill（用真实字段 ID） |
| 提交 / 跳转 | DOM click + 接口响应双重验证 |

> 通用规则参见全局 `~/.claude/CLAUDE.md`

## 注意事项

- 这是真实购票网站，不要高频 UI 轮询，优先用接口监测
- 支付步骤默认不自动触发（`pauseBeforePayment: true`）
- 出错时浏览器保持打开方便排查（`keepBrowserOpenOnError: true`）
- 乘客信息从 `config.yaml` 的 `passengers` 字段读取，邮箱和证件号需填写真实信息才能完整走到支付前
