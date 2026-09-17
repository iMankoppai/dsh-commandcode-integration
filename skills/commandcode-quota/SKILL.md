---
name: commandcode-quota
description: 查看 Command Code 账号额度与用量：剩余 credits、5 小时/每周限流窗口及重置倒计时、本期请求数与 token 累计、订阅周期。当用户问"额度""用量""还剩多少""限流窗口""套餐什么时候重置"时使用。
whenToUse: 用户询问 Command Code 的额度、用量、限流窗口、剩余额度、订阅周期，或让你"看一眼额度/查额度"时。
---

# Command Code 额度查询

运行本技能目录下的脚本，然后把输出 **原样** 展示给用户 —— 保留全部格式、数字、进度条与倒计时，**不要改写、不要压缩成一句话、不要省略任何行**：

```bash
node "<本技能所在目录>/quota.mjs"
```

需要机器可读时加 `--json`；桥的数据目录不在默认位置时用 `--data-dir` 或环境变量 `CMDGO_DATA_DIR` 指定：

```bash
node "<本技能所在目录>/quota.mjs" --json
node "<本技能所在目录>/quota.mjs" --data-dir /path/to/cmdgo-bridge-data
```

## 输出含义

| 行 | 含义 |
| --- | --- |
| `月度剩余` | 本月剩余 credits / 套餐总额（Go = $10），后面是已用比例条 |
| `5 小时窗口` | 滚动 5 小时限流窗口的已用额度 / 上限（Go = $3），撞上限会短暂报错，到重置时间自动恢复 |
| `每周窗口` | 滚动 7 天窗口（Go = $6），同上 |
| `本期累计` | 本计费周期内的请求数、总花费、输入/输出 token |
| `订阅周期` | 本期起止日期与剩余天数 |
| `用量详情` | Command Code 官网用量页地址 |

## 数据来源（脚本只读，不打印任何密钥）

1. **cmdgo-bridge 账号池** —— `$CMDGO_DATA_DIR`、`--data-dir`，或默认 `~/.cmdgo-bridge`（`accounts.json` + `credentials.json`）
2. **官方 CLI 登录态** —— `~/.commandcode/auth.json`

上游接口：`/alpha/whoami`、`/alpha/billing/credits`、`/alpha/billing/subscriptions`、`/alpha/usage/summary`。

## 报错时怎么说

把错误信息如实告诉用户，并按情况给一句原因：

- 连不上 / 网络错误 → 本机桥（`127.0.0.1:11435`）没在跑，或没有网络；
- HTTP 401/403 → 凭据失效，需要重新登录（桥控制台点「发起登录」，或在 DSH 设置 → Command Code 里登录）；
- 找不到凭据 → 账号池与 `~/.commandcode/auth.json` 都没有，先完成一次登录；
- 版本差异 → 若 `individual-*` 之外的套餐名显示为原始 planId，属正常（脚本只内置常见档位的中文名）。
