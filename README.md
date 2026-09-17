# dsh-commandcode — 把 Command Code 接进 DeepSeek Harness，外加一个额度技能

**English TL;DR** — Everything needed to run a Command Code **Go plan** inside DeepSeek Harness: the correct community plugin per harness version, the settings keys that actually work, a quota skill (`/commandcode-quota`, natural language, double-click), and the validation recipe that catches the failure mode a config-only check misses.

> 非官方整合：DSH 侧模型接入用的是社区插件 [@mars-sea/dsh-commandcode-provider](https://github.com/Mars-Sea/dsh-commandcode-provider)（MIT），本仓库不包含也不复制它的代码，只提供**安装/配置/兼容性结论、额度技能与验证方法**。需要你自己的 Command Code 订阅，适用 Command Code 服务条款。

---

## 1. 机制：DSH 怎么接自定义模型

DSH 是 **cordis 插件框架**，profile（`$DSH_HOME/profiles/<name>/`）由若干 bundle patch 层叠加而成：

```
profile/package.json
  dependencies : 第三方插件包（pnpm 安装到 profile 的 node_modules）
  dsh.profile.bundles : 参与叠层的包，按顺序应用各自的 cordis.patch.yml
profile/cordis.patch.yml : 用户自己的覆盖层（永远改这里，不要改 cordis.yml）
```

模型走「provider 路由」：插件用 `ctx.llm` 注册一条路由，`$DSH_HOME/settings.yaml` 的 `agent-default-model.provider` 指向它。Command Code 插件注册的路由名是 **`commandcode`**，插件行 id 是 `llm-commandcode`（这一点决定了它设置项的命名空间，见第 4 节）。

```
DSH 会话 ──► provider route "commandcode" ──► /alpha/generate      （Go 套餐走这条）
                                          └─► /provider/v1/chat/completions （GOAT/Pro/Provider）
```

## 2. 版本兼容矩阵（本仓库最值钱的部分）

| 你的 DSH | 应装的插件版本 | 说明 |
| --- | --- | --- |
| `0.1.2-rc.1` 及以上（含 `0.1.5-rc.1/rc.2`、`0.1.6-alpha.1`） | **`@latest`**（当前 `0.11.4`） | 维护中的版本线：模型目录、推理档位、图片输入、多账号轮换、额度面板、浏览器内登录 |
| `0.1.1-rc.1` / `0.1.1-rc.2` 等更老的线 | **`@0.9.1`**（精确锁版本） | 插件的 peer 区间是 `^0.1.0-rc.6 \|\| ^0.1.1-rc.1`；老版本走 `/alpha/generate`，对 Go 套餐同样可用，但该线已停止维护 |

**为什么必须看版本**：插件 `engines.dsh` / `peerDependencies` 明确写了支持的 harness 版本区间；装错版本的表现往往不是"报错"，而是**插件行加载失败 → 模型选择器里没有 `commandcode` 分组**。

**Go 套餐能不能用**：能。0.10.1 之前插件只走 `/alpha/generate`（正是 Go 可用通道）；0.10.1 起才补上 Provider API。所以老版插件对 Go 套餐反而更"专一"。

## 3. 安装

```bash
# 装插件（profile 名按你的入口：web / tui / headless）
dsh plugin --profile web add @mars-sea/dsh-commandcode-provider@latest

# ⚠ pnpm 11 有 24 小时发布冷静期：刚发布不足一天的版本会被静默跳过，
#   要装当天的新版本请精确指定，例如：
dsh plugin --profile web add @mars-sea/dsh-commandcode-provider@0.11.4

# 然后重启 Web 应用
```

装完 DSH 会自动完成两件事（新版 harness 的 reconcile 逻辑）：把依赖写进 `package.json`，并把声明了 `dsh.bundle` 的包**自动加入 `dsh.profile.bundles`**——不需要手改 bundles 列表。

**API key 三个来源**（按优先级）：

1. `COMMANDCODE_API_KEY` 环境变量（进程启动环境）
2. DSH 凭据库（设置 → Command Code → 粘贴 / 点「登录 Command Code」走浏览器授权）
3. **`~/.commandcode/auth.json`**（官方 CLI `cmd login` / 桌面端写入）——有这个文件时插件开箱即用

## 4. 设置（都是实测过的键名）

见 `settings.example.yaml`。最常用的两项：

```yaml
# 新会话默认走 Command Code
agent-default-model:
  provider: commandcode
  model: deepseek/deepseek-v4.1-flash
  reasoningEffort: high

# 插件自己的设置：命名空间 = 插件行 id
llm-commandcode:
  showSidebarQuota: true    # 侧边栏额度卡（默认关，开了常驻显示套餐与窗口）
  webSearch: true           # dsh 的 web_search 改走 Command Code（/alpha/web-search）
```

**两个坑**：

- 界面里模型选择器的「设为默认」**只写 `provider` + `model`**，会把你手写的 `reasoningEffort` 冲掉——发现档位丢了就补回来；
- 手改 `settings.yaml` 时不要写 `apiKey`：那里只放**引用**，key 归凭据库 / `auth.json`。

## 5. 额度技能（`skills/commandcode-quota`）

```bat
:: 安装到用户级技能根目录（所有工作区可用）
install-skill.cmd
:: 之后：会话里说「查额度」，或用命令列表里的 commandcode-quota
::      双击 check-quota.cmd 也可以
```

输出示例：

```
Command Code 额度  (数据源: https://api.commandcode.ai)

<account>  [Go 套餐 · 订阅 active]
  月度剩余     $9.1485 / $10.00  [##------------------]   9%
  5 小时窗口   $0.8515 / $3.00  [######--------------]  28%   09-17 20:36 重置（约 3 小时 24 分后）
  每周窗口     $0.8515 / $6.00  [###-----------------]  14%   09-24 15:36 重置（约 6 天 22 小时后）
  本期累计     259 次请求 · $0.7885 · 输入 41.39M / 输出 252.9K tokens
  订阅周期     09-17 → 10-17（剩约 29 天）
  用量详情     https://commandcode.ai/<user>/settings/usage
```

设计要点：**只有一份实现**（`quota.mjs`），三个入口（技能 / 命令列表 / 双击 .cmd）都调用它，永远不会出现两处数字不一致。凭据来源：桥账号池 → `~/.commandcode/auth.json`；脚本只读，不打印任何密钥。

## 6. 故障排查

| 现象 | 原因 / 处理 |
| --- | --- |
| 模型选择器里没有 `commandcode` 分组 | 插件版本与 harness 不匹配（见矩阵）；或插件行加载失败——**看启动窗口的日志**，0.1.5 会报出来 |
| 部分模型 400 `Too big: expected number to be <=200000` | Go 网关对 `params.max_tokens` 有全局硬上限 200000，而客户端把模型声明的输出上限原样发出去。DSH 侧把声明值压到 ≤200000；若客户端是 ZCode，则需桥侧钳制（见姊妹仓库 `cmdgo-zcode`） |
| HTTP 200 但回复为空 | 思考型模型把 token 全用在 reasoning（`finish_reason=length`）→ 调大 `max_tokens` 或降低思考档位 |
| 401 / 403 | 凭据失效或套餐不含该模型（`MODEL_NOT_IN_PLAN`）；重新登录或换模型 |
| 额度卡不见了 | 设置 → Command Code → Advanced 的开关，或 `settings.yaml` 的 `llm-commandcode.showSidebarQuota` |
| 想退回 DeepSeek | 模型选择器切回 `deepseek-official`；或改回 `agent-default-model.provider` |

## 7. 升级 harness 前请读 `docs/validation.md`

一句话版本：**`dsh --profile web --dump-config` 只组装 YAML 配置树、不 import 插件模块**，所以它"零错误"完全可能掩盖启动即崩的 ESM 链接错误；升级 harness 时，profile 里那些按老版本 API 写的第三方插件（静态 import 被删掉的导出）会让应用起不来。文档里给了两级验证配方（模块导入测试 + 真启动）与一次真实事故的复盘。

## 8. 隐私

本仓库不含任何密钥。运行期敏感文件：DSH 凭据库（`$DSH_HOME/.credentials.yaml` / `.env`）、`~/.commandcode/auth.json`、以及桥的 `credentials.json`。key 一旦出现在日志或会话记录里就应轮换。

## 许可

本仓库 MIT（见 `LICENSE`）。模型接入依赖社区插件 **@mars-sea/dsh-commandcode-provider（MIT）**，上游仓库：<https://github.com/Mars-Sea/dsh-commandcode-provider>。
