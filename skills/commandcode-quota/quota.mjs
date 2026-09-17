#!/usr/bin/env node
/**
 * Command Code quota report (credits, rolling rate windows, period usage).
 *
 *   node quota.mjs                 # human-readable card (bars + reset countdowns)
 *   node quota.mjs --json          # machine-readable
 *   node quota.mjs --data-dir DIR  # cmdgo-bridge data dir (account pool)
 *
 * Credential sources, in order:
 *   1. cmdgo-bridge account pool  ($CMDGO_DATA_DIR, --data-dir, ~/.cmdgo-bridge)
 *   2. ~/.commandcode/auth.json   (written by the official CLI login)
 * Nothing is printed that could be a secret; only account names and numbers.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const argDataDir = (() => {
  const i = argv.indexOf('--data-dir');
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
})();

const DEFAULT_BASE = 'https://api.commandcode.ai';
const STUDIO_BASE = 'https://commandcode.ai';

const PLAN_NAMES = {
  'individual-go': 'Go', 'individual-goat': 'GOAT', 'individual-pro': 'Pro',
  'individual-pro-v1': 'Pro', 'individual-provider': 'Provider', 'individual-max': 'Max',
  'individual-ultra': 'Ultra', 'teams-pro': 'Teams Pro',
};
const PLAN_CREDITS = {
  'individual-go': 10.0, 'individual-goat': 70.0, 'individual-pro': 30.0,
  'individual-pro-v1': 80.0, 'individual-provider': 15.0, 'individual-max': 150.0,
  'individual-ultra': 300.0, 'teams-pro': 40.0,
};

// ---------- helpers ----------
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const money = (x, d = 4) => (Number.isFinite(Number(x)) ? '$' + Number(x).toFixed(d) : '$?');
const tokensShort = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '?';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
  return String(v);
};
const isWide = (cp) =>
  (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) ||
  (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) ||
  (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60) ||
  (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x3000 && cp <= 0x303e);
const dwidth = (s) => [...s].reduce((w, ch) => w + (isWide(ch.codePointAt(0)) ? 2 : 1), 0);
const pad = (s, width) => s + ' '.repeat(Math.max(0, width - dwidth(s)));
const bar = (used, cap, width = 20) => {
  const r = Number(cap) > 0 ? Math.min(Math.max(Number(used) / Number(cap), 0), 1) : 0;
  const filled = Math.round(r * width);
  return '[' + '#'.repeat(filled) + '-'.repeat(width - filled) + ']';
};
const humanizeUntil = (dt) => {
  const secs = (dt.getTime() - Date.now()) / 1000;
  if (secs <= 0) return '已重置';
  const d = Math.floor(secs / 86400), h = Math.floor((secs % 86400) / 3600), m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `约 ${d} 天 ${h} 小时后`;
  if (h > 0) return `约 ${h} 小时 ${m} 分后`;
  return `约 ${Math.max(m, 1)} 分钟后`;
};
const fmtLocal = (ms) => {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// ---------- account pool discovery ----------
function dataDir() {
  const candidates = [
    process.env.CMDGO_DATA_DIR,
    argDataDir,
    path.join(os.homedir(), '.cmdgo-bridge'),
  ].filter(Boolean);
  for (const d of candidates) {
    if (fs.existsSync(path.join(d, 'accounts.json')) || fs.existsSync(path.join(d, 'credentials.json'))) return d;
  }
  return candidates[candidates.length - 1] || null;
}

// ---------- upstream ----------
async function apiGet(base, key, p) {
  try {
    const r = await fetch(base + p, {
      headers: { Authorization: 'Bearer ' + key, Accept: 'application/json', 'User-Agent': 'command-code/quota-script' },
    });
    if (r.status === 401 || r.status === 403) return { error: `凭据无效或已过期（HTTP ${r.status}），需要重新登录` };
    if (!r.ok) return { error: `HTTP ${r.status}` };
    return { data: await r.json() };
  } catch (e) { return { error: '网络错误: ' + String(e.message).slice(0, 120) }; }
}

async function reportOne(base, { label, key, note }) {
  const [who, cr, sub, sum] = await Promise.all([
    apiGet(base, key, '/alpha/whoami?limits=1'),
    apiGet(base, key, '/alpha/billing/credits'),
    apiGet(base, key, '/alpha/billing/subscriptions'),
    apiGet(base, key, '/alpha/usage/summary'),
  ]);
  if (cr.error && sub.error) return { ok: false, label, error: cr.error || sub.error };

  const credits = cr.data || {};
  const c = credits.credits || {};
  const wl = credits.windowLimits || {};
  const s = sub.data && sub.data.data ? sub.data.data : (sub.data || {});
  const planId = s.planId || '';
  const planName = PLAN_NAMES[planId] || planId || '未知套餐';
  const status = s.status || '?';

  const rows = [];
  const remaining = c.monthlyCredits;
  const weeklyUsed = (wl.weekly || {}).used;
  let total = PLAN_CREDITS[planId];
  if (total === undefined && Number.isFinite(remaining) && Number.isFinite(weeklyUsed)) total = Number(remaining) + Number(weeklyUsed);
  if (Number.isFinite(remaining)) {
    let line = `  ${pad('月度剩余', 12)} ${money(remaining)}`;
    if (total) {
      const used = total - Number(remaining);
      line += ` / ${money(total, 2)}  ${bar(used, total)} ${String(Math.round((100 * used) / total)).padStart(3)}%`;
    }
    rows.push(line);
  }
  const windows = [];
  for (const [name, k] of [['5 小时窗口', 'fiveHour'], ['每周窗口', 'weekly']]) {
    const w = wl[k];
    if (!w) continue;
    let line = `  ${pad(name, 12)} ${money(w.used)} / ${money(w.cap, 2)}  ${bar(w.used, w.cap)}`;
    if (w.cap) line += ` ${String(Math.round((100 * w.used) / w.cap)).padStart(3)}%`;
    if (w.resetAt) line += `   ${fmtLocal(w.resetAt)} 重置（${humanizeUntil(new Date(w.resetAt))}）`;
    if (w.exceeded) line += '  ⚠ 已超限';
    rows.push(line);
    windows.push({ kind: k, used: w.used, cap: w.cap, resetAt: w.resetAt, exceeded: !!w.exceeded });
  }
  if (sum.data) {
    rows.push(`  ${pad('本期累计', 12)} ${sum.data.totalCount ?? '?'} 次请求 · ${money(sum.data.totalCost, 4)} · 输入 ${tokensShort(sum.data.totalTokensIn)} / 输出 ${tokensShort(sum.data.totalTokensOut)} tokens`);
  }
  let periodDays = null;
  if (s.currentPeriodStart && s.currentPeriodEnd) {
    const start = new Date(s.currentPeriodStart), end = new Date(s.currentPeriodEnd);
    periodDays = Math.max(0, Math.floor((end.getTime() - Date.now()) / 86400000));
    const p = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    rows.push(`  ${pad('订阅周期', 12)} ${p(start)} → ${p(end)}（剩约 ${periodDays} 天）`);
  }
  const uname = (who.data && who.data.user && who.data.user.userName) || label;
  const usageUrl = `${STUDIO_BASE}/${uname}/settings/usage`;
  rows.push(`  ${pad('用量详情', 12)} ${usageUrl}`);

  return { ok: true, header: `${label}  [${planName} 套餐 · 订阅 ${status}]`, rows, planId, planName, status, remaining, windows, summary: sum.data || null, periodDays, usageUrl, source: note };
}

async function main() {
  const dir = dataDir();
  const accounts = dir ? ((readJson(path.join(dir, 'accounts.json')) || {}).accounts || []) : [];
  const creds = dir ? (readJson(path.join(dir, 'credentials.json')) || {}) : {};
  const base = (dir && (readJson(path.join(dir, 'config.json')) || {}).baseURL) || DEFAULT_BASE;

  const results = [];
  if (accounts.length) {
    for (const a of accounts) {
      const name = a.userName || a.id || '?';
      if (a.enabled === false) { results.push({ ok: false, label: name, error: '已在账号池中停用' }); continue; }
      const entry = creds[a.ref];
      const key = entry && typeof entry === 'object' ? entry.value : null;
      if (!key) { results.push({ ok: false, label: name, error: `找不到凭据（${a.ref}）` }); continue; }
      results.push(await reportOne(base, { label: name, key, note: 'cmdgo-bridge account pool' }));
    }
  } else {
    const p = path.join(os.homedir(), '.commandcode', 'auth.json');
    const a = readJson(p);
    if (!a || !a.apiKey) {
      const msg = `没有可用凭据：账号池为空（${dir || '未找到数据目录'}），也读不到 ${p}`;
      if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
      else console.log(msg + '\n先启动 cmdgo-bridge 并在 http://127.0.0.1:11435/ 登录一次，或用官方 CLI 执行登录。');
      return 1;
    }
    results.push(await reportOne(base, { label: a.userName || '?', key: a.apiKey, note: 'auth.json' }));
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ base, results }, null, 2));
    return results.some((r) => r.ok) ? 0 : 1;
  }

  console.log(`Command Code 额度  (数据源: ${base})`);
  console.log();
  let ok = 0;
  for (const r of results) {
    if (r.ok) { ok++; console.log(r.header); r.rows.forEach((l) => console.log(l)); }
    else console.log(`* ${r.label}  ${r.error}`);
    console.log();
  }
  if (ok === 0) { console.log('所有账号查询失败。若刚续费/重新登录过，请稍后重试。'); return 1; }
  return 0;
}

process.exitCode = await main();
