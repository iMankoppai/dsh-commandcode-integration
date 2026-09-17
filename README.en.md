# dsh-commandcode — Command Code inside DeepSeek Harness, plus a quota skill

**中文** | [English](README.en.md) · [![ci](https://github.com/iMankoppai/dsh-commandcode-integration/actions/workflows/ci.yml/badge.svg)](https://github.com/iMankoppai/dsh-commandcode-integration/actions/workflows/ci.yml)

> Unofficial integration. The DSH-side model access uses the community plugin [@mars-sea/dsh-commandcode-provider](https://github.com/Mars-Sea/dsh-commandcode-provider) (MIT); this repo does **not** include or copy its code — it collects the install/config/compatibility findings, the quota skill, and the validation recipe. You need your own Command Code subscription; Command Code's terms apply.

## 1. How DSH loads a custom model

DSH is a **cordis plugin framework**. A profile (`$DSH_HOME/profiles/<name>/`) is a stack of bundle patch layers:

```
profile/package.json
  dependencies          : third-party plugin packages (pnpm installs them into the profile's node_modules)
  dsh.profile.bundles   : the packages whose cordis.patch.yml layers are applied, in order
profile/cordis.patch.yml: your own overlay (always edit this one, never cordis.yml)
```

Models go through a **provider route**: a plugin registers one via `ctx.llm`, and `$DSH_HOME/settings.yaml`'s `agent-default-model.provider` points at it. The Command Code plugin registers the route **`commandcode`**, and its plugin row id is `llm-commandcode` — which determines the namespace of its settings (see §4).

```
DSH session ──► provider route "commandcode" ──► /alpha/generate                  (Go plan)
                                              └─► /provider/v1/chat/completions   (GOAT/Pro/Provider)
```

## 2. Version compatibility matrix (the most valuable part of this repo)

| Your DSH | Plugin version to install | Notes |
| --- | --- | --- |
| `0.1.2-rc.1` and newer (incl. `0.1.5-rc.1/rc.2`, `0.1.6-alpha.1`) | **`@latest`** (currently `0.11.4`) | The maintained line: model catalog, reasoning effort, image input, multi-account rotation, quota panel, in-browser login |
| `0.1.1-rc.1` / `0.1.1-rc.2` and other older lines | **`@0.9.1`** (pin exactly) | Its peers are `^0.1.0-rc.6 \|\| ^0.1.1-rc.1`; older builds go straight to `/alpha/generate`, which works fine for the Go plan, but that line is unmaintained |

**Why versions matter**: the plugin declares its supported harness range in `engines.dsh` / `peerDependencies`. Installing a mismatched version usually does **not** produce an error — the plugin row simply fails to load, so the model picker has **no `commandcode` group**.

**Does it work on the Go plan?** Yes. Before 0.10.1 the plugin only spoke `/alpha/generate` — exactly the channel Go can use; Provider API support arrived in 0.10.1. So for a Go plan the older builds are actually the more "single-purpose" ones.

## 3. Install

```bash
# install the plugin (profile name depends on your entry point: web / tui / headless)
dsh plugin --profile web add @mars-sea/dsh-commandcode-provider@latest

# WARNING: pnpm 11 has a 24-hour release cooldown; a version published less than a
# day ago is skipped silently. To install a same-day release, name it exactly:
dsh plugin --profile web add @mars-sea/dsh-commandcode-provider@0.11.4

# then restart the web app
```

DSH finishes two things for you afterwards (reconcile logic in newer harness versions): it records the dependency in `package.json`, and it **adds any package declaring `dsh.bundle` to `dsh.profile.bundles` automatically** — no hand-editing of the bundle list required.

**API key, three sources** (in priority order):

1. the `COMMANDCODE_API_KEY` environment variable (process launch environment);
2. the DSH credential store (Settings → Command Code → paste, or click "Sign in to Command Code" for the browser flow);
3. **`~/.commandcode/auth.json`** (written by the official CLI `cmd login` / the desktop app) — when this file exists the plugin works out of the box.

## 4. Settings (all key names verified)

See `settings.example.yaml`. The two you actually want:

```yaml
# route new sessions to Command Code
agent-default-model:
  provider: commandcode
  model: deepseek/deepseek-v4.1-flash
  reasoningEffort: high

# the plugin's own settings: namespace == the plugin row id
llm-commandcode:
  showSidebarQuota: true    # sidebar quota card (off by default)
  webSearch: true           # route dsh web_search through Command Code (/alpha/web-search)
```

**Two traps**:

- The model picker's "set as default" writes **only `provider` + `model`** and will drop a hand-written `reasoningEffort` — re-add it if the level disappears;
- Never put an `apiKey` in `settings.yaml`: that file carries **references** only; keys live in the credential store / `auth.json`.

## 5. Quota skill (`skills/commandcode-quota`)

```bat
:: install into the user-level skill root (visible to every workspace)
install-skill.cmd
:: then: ask "check the quota" in a session, or use the command-list entry commandcode-quota
:: or simply double-click check-quota.cmd
```

Sample output:

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

Design point: **exactly one implementation** (`quota.mjs`) behind all three entry points (skill / command list / double-click), so the numbers can never drift apart. Credential sources: bridge account pool → `~/.commandcode/auth.json`; the script only reads and never prints a secret.

## 6. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| No `commandcode` group in the model picker | Plugin/harness version mismatch (see the matrix); or the plugin row failed to load — **check the startup log**, 0.1.5 does report it |
| Some models return 400 `Too big: expected number to be <=200000` | The Go gateway hard-caps `params.max_tokens` at 200000 while the client forwards the model's declared output limit verbatim. On the DSH side keep declared values ≤ 200000; for ZCode clients clamp in the bridge (see the sibling repo `cmdgo-zcode`) |
| HTTP 200 with empty content | A thinking model spent the tokens on reasoning (`finish_reason=length`) → raise `max_tokens` or lower the reasoning level |
| 401 / 403 | Credential stale, or the plan does not include that model (`MODEL_NOT_IN_PLAN`); log in again or switch models |
| Quota card disappeared | Settings → Command Code → Advanced, or `llm-commandcode.showSidebarQuota` in `settings.yaml` |
| Want to go back to DeepSeek | Switch back to `deepseek-official` in the model picker, or change `agent-default-model.provider` |

## 7. Read `docs/validation.md` before upgrading the harness

The one-line version: **`dsh --profile web --dump-config` only composes the YAML tree and does not import plugin modules**, so a clean "zero errors" can still hide an ESM link error that crashes the app on boot. When you upgrade the harness, third-party profile plugins written against the old APIs (static imports of removed exports) will stop the app from starting. That document gives the two-level verification recipe (module import test + real boot) and a post-mortem of a real incident.

## 8. Privacy

This repo contains no secrets. Runtime-sensitive files: the DSH credential store (`$DSH_HOME/.credentials.yaml` / `.env`), `~/.commandcode/auth.json`, and the bridge's `credentials.json`. An API key that ever appeared in a log or transcript should be rotated.

## License

MIT for this repo (see `LICENSE`). Model access depends on the community plugin **@mars-sea/dsh-commandcode-provider (MIT)** — upstream: <https://github.com/Mars-Sea/dsh-commandcode-provider>.
