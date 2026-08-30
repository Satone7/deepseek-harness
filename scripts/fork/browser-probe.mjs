#!/usr/bin/env node
// 无头浏览器探针：加载一个 dsh web 实例，采集 console 错误、页面异常、失败请求、
// 启动全局变量与插件 bundle 加载状态，并尝试打开侧边栏终端。用于故障定位与 staging 冒烟。
//
// 用法: node scripts/fork/browser-probe.mjs --url http://127.0.0.1:3080 [--out DIR] [--wait-ms 8000] [--strict]
//   --url      目标实例（必填）
//   --out      截图与采集落盘目录（默认 /tmp/dsh-browser-probe）
//   --wait-ms  networkidle 之后额外的异步等待（默认 8000，等插件 client 挂载）
//   --strict   存在 pageerror 或 console.error 时退出码 1（冒烟判定用；默认仅报告）
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

const repoRoot = resolve(new URL('.', import.meta.url).pathname, '../..')

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}
const url = arg('url')
if (!url) {
  console.error('用法: node scripts/fork/browser-probe.mjs --url http://127.0.0.1:3080 [--token-url URL] [--out DIR] [--wait-ms N] [--strict]')
  process.exit(2)
}
// 上游 0.1.2-alpha.1 起页面走一次性 token → 会话 cookie 鉴权；--token-url
// 先完成交换（浏览器跟随 303 落 cookie），再 goto 目标 --url。
const tokenUrl = arg('token-url')
const outDir = arg('out', '/tmp/dsh-browser-probe')
const waitMs = Number(arg('wait-ms', '8000'))
const strict = process.argv.includes('--strict')
mkdirSync(outDir, { recursive: true })

// playwright 是 apps/web 的 devDependency；从那里解析（pnpm symlink 结构）。
const requireFromWeb = createRequire(join(repoRoot, 'apps/web/package.json'))
const { chromium } = requireFromWeb('playwright')

const consoleErrors = []
const consoleWarnings = []
const pageErrors = []
const failedRequests = []
const badResponses = []

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
    else if (msg.type() === 'warning') consoleWarnings.push(msg.text())
  })
  page.on('pageerror', err => pageErrors.push(String(err)))
  page.on('requestfailed', req => failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`))
  page.on('response', res => {
    if (res.status() >= 400) badResponses.push(`${res.status()} ${res.url()}`)
  })

  // 不用 networkidle：页面持有常驻连接（HMR SSE），networkidle 永不触发。
  // token 模式只 goto 一次：303 重定向落在干净根 URL 上，应用随该次加载
  // 完成；紧跟的第二次 goto 只会把首屏已发出的 API 请求中断成 ERR_ABORTED。
  await page.goto(tokenUrl ?? url, { waitUntil: 'load', timeout: 30_000 })
  await page.waitForTimeout(waitMs)

  const boot = await page.evaluate(() => {
    const pluginScripts = [...document.querySelectorAll('script[src*="/plugins/"]')].map(s => s.getAttribute('src'))
    return {
      hasBoot: typeof window.__DSH_BOOT__ === 'object',
      bootKeys: typeof window.__DSH_BOOT__ === 'object' ? Object.keys(window.__DSH_BOOT__).length : 0,
      version: window.__DSH_WEB_VERSION__ ?? null,
      pluginScripts,
      sidebarNodes: document.querySelectorAll('[id*="sidebar" i], [class*="sidebar" i]').length,
      bodyTextSample: (document.body.innerText ?? '').slice(0, 300).replace(/\s+/g, ' '),
    }
  })

  // 尝试打开侧边栏终端 tab（选择器宽松匹配，找不到只记录不报错）。
  let terminalClick = '未找到可点击的终端入口'
  const terminalTab = page.locator('button, [role="tab"], [class*="tab" i]', ).filter({ hasText: /terminal|终端/i }).first()
  if (await terminalTab.count() > 0) {
    try {
      await terminalTab.click({ timeout: 3000 })
      await page.waitForTimeout(3000)
      terminalClick = '已点击终端入口'
    } catch (e) {
      terminalClick = `点击失败: ${String(e).slice(0, 120)}`
    }
  }
  await page.screenshot({ path: join(outDir, 'probe.png'), fullPage: false })

  const report = {
    url,
    boot,
    terminalClick,
    pageErrors,
    consoleErrors,
    consoleWarnings,
    failedRequests,
    badResponses,
  }
  writeFileSync(join(outDir, 'probe.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))

  if (strict && (pageErrors.length > 0 || consoleErrors.length > 0)) process.exitCode = 1
} finally {
  await browser.close()
}
