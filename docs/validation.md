# 验证方法（以及一次真实事故的复盘）

## 为什么需要这份文档

升级 harness 或增删 profile 插件后，"看起来配好了"和"真的能启动"是两件事。本文给出两级验证配方，都是几秒钟的事，但能挡住**配置检查永远看不见**的那类错误。

## Level 0：`--dump-config` —— 只组装 YAML，**不 import 模块**

```bash
dsh --profile web --dump-config | less          # 组合后的完整配置树
dsh --profile web --dump-default-config         # 不含用户层与 --patch
```

它能回答：配置树叠对了吗？插件行在不在？键名拼对了吗？
它**不能**回答：这些插件的 JS 模块能不能在当前 harness 上**加载**。

所以 `dump-config` 退出码 0 + "零错误" **不构成**"能启动"的证据。

## Level 1：模块导入测试（秒级，抓 ESM 链接错误）

对 profile 里的第三方插件，逐个直接 `import()` 它的 host bundle —— 静态 import 了不存在的具名导出时，这一步就会失败：

```js
// import-test.mjs   node import-test.mjs
const base = 'file:///ABSOLUTE/PATH/TO/profiles/web/node_modules/';
const mods = [
  ['@mars-sea/dsh-commandcode-provider', 'lib/index.js'],
  ['dshmarket', 'lib/index.js'],
  ['dsh-cost-meter', 'lib/index.js'],
];
for (const [pkg, entry] of mods) {
  try { const m = await import(base + pkg + '/' + entry);
        console.log('OK  ' + pkg + '  exports=' + Object.keys(m).length); }
  catch (e) { console.log('FAIL ' + pkg + '  ' + e.message.split('\n')[0]); }
}
```

（把 `node_modules` 路径换成你的 profile 目录；Windows 下 `file:///C:/...`。）

## Level 2：真启动（最终判据）

```bash
# 用另一个端口起一次，不打开浏览器；用后台任务托管，别用会被中断的前台命令
dsh web --no-open --port 3099
```

启动后应看到 `dsh web: http://127.0.0.1:3099/?token=...`。用它验证客户端插件是否注册进宿主（**认证后**的页面里带有客户端插件清单）：

```js
// --no-open 模式下把打印的 token 填进来
const r = await fetch('http://127.0.0.1:3099/?token=<TOKEN>', { redirect: 'manual' });
const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
const html = await (await fetch('http://127.0.0.1:3099/', { headers: { cookie } })).text();
console.log('plugin present:', html.includes('@mars-sea/dsh-commandcode-provider/client.js'));
```

**收尾**：验证完立刻停掉这个实例，并确认端口已释放。用"会被中断的前台命令"跑测试实例，很容易留下**占着端口的孤儿进程**，之后你会误以为是自己的服务坏了（这个坑我们踩过：一个 16:32 创建的测试进程一直占着 3080，直到手动清掉）。

## 一次真实事故（2026-09-17）

**做了什么**：把 harness 从 `0.1.1-rc.2` 升级到 `0.1.5-rc.1`。

**验证了什么**：`dsh --profile web --dump-config` → 退出码 0、612 行、零错误。

**结果**：重启后**起不来**。

**根因**：profile 里按老版本线安装的第三方插件（`@linxin666/dsh-web-ui-all@0.3.6`、`dshmarket@1.26.0`）在模块顶层**静态 import** 了新 `dsh-settings` 已经删掉的导出（`settingsNamespace` / `installSettingsSection`）。`dump-config` 只组装 YAML，不加载模块，所以完全看不到这个问题——这就是 Level 0 的盲区。

**修复**：把这些插件迁移到当前版本线（`@linxin666/dsh-web-all@0.3.23`、`dshmarket@1.47.0` 等），再启动即可。修完 `dump-config` 的行数从 612 变成 634，正是"插件集变了"的体现。

**结论（升级 harness 的检查清单）**：

1. 升级前备份 `profile/package.json`、`pnpm-lock.yaml`、`cordis.yml`、`cordis.patch.yml`、`settings.yaml`；
2. 升级后**不要**只跑 `dump-config`；
3. 跑 Level 1 导入测试，把失败的插件逐个升级到适配新 harness 的版本；
4. 再跑 Level 2 真启动（别开浏览器，用独立端口，用完释放端口）；
5. 全部通过后，再让用户重启生产入口。

## 附：升级/回滚命令

```bash
npm i -g @deepseek-ai/dsh@latest              # 升级
npm i -g @deepseek-ai/dsh@<old-version>       # 回滚
dsh plugin --profile web add <pkg>@<version>  # 装/钉插件版本
dsh plugin --profile web remove <pkg>         # 卸载插件
```
