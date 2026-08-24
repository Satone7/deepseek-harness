#!/usr/bin/env node
// scripts/fork/peer-check.mjs — 第三方插件 peer 兼容性机器判定。
//
// 用法: node scripts/fork/peer-check.mjs
//
// 对 deploy/profiles/web/package.json 的每个外部依赖：
//   1. npm view 取最新版本；
//   2. 用仓库同款 semver 机器判定「候选版本的全部 @deepseek-ai/dsh-* peer 范围」
//      是否容纳当前 dsh 版本（packages/bundle/web-app 的 version）。
//
// 为什么必须机器判定：npm 预发布 semver 里 `^0.1.0-rc.8` 不容纳 `0.1.1-rc.1`
// （patch 元组不同，预发布只与同元组的 comparator 匹配）——人眼判曾误判过。
// 注意：peer 形式不满足 ≠ 运行时不兼容；升级决定以 plugin-stage.sh 的 staging 冒烟为准，
// 本脚本只回答「形式上是否成立」。
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(new URL('.', import.meta.url).pathname, '../..')
// semver 在本仓库是纯传递依赖（无直接声明方），从 .pnpm store 取最高的 7.x 目录解析。
const semverDirs = readdirSync(join(REPO, 'node_modules/.pnpm'))
  .filter(d => /^semver@7\./.test(d)).sort()
const semverDir = semverDirs.at(-1)
if (semverDir === undefined || !existsSync(join(REPO, `node_modules/.pnpm/${semverDir}/node_modules/semver`))) {
  throw new Error('peer-check: node_modules/.pnpm 下找不到 semver@7（先 pnpm install）')
}
const semver = createRequire(join(REPO, `node_modules/.pnpm/${semverDir}/node_modules/semver/package.json`))('semver')

const currentVersion = (JSON.parse(
  readFileSync(join(REPO, 'packages/bundle/web-app/package.json'), 'utf8'),
)).version

const profile = JSON.parse(readFileSync(join(REPO, 'deploy/profiles/web/package.json'), 'utf8'))
const deps = Object.entries(profile.dependencies).filter(([, spec]) => !spec.startsWith('file:'))

const npmView = (pkg, field) => {
  try {
    return JSON.parse(execFileSync('npm', ['view', pkg, field, '--json'], { encoding: 'utf8', timeout: 30_000 }))
  } catch {
    return undefined
  }
}

console.log(`当前 dsh 版本: ${currentVersion}\n`)
console.log('| 依赖 | pin | npm 最新 | 最新版 peer 满足当前版本 | 最新版 chunk 机制 |')
console.log('|---|---|---|---|---|')

for (const [name, spec] of deps) {
  const latest = npmView(name, 'version')
  const peers = npmView(`${name}@${latest}`, 'peerDependencies') ?? {}
  const dshPeers = Object.entries(peers).filter(([p]) => p.startsWith('@deepseek-ai/dsh-'))
  const unsatisfied = dshPeers.filter(([, range]) => !semver.satisfies(currentVersion, range, { includePrerelease: false }))
  const verdict = dshPeers.length === 0 ? '—（无 dsh peer）'
    : unsatisfied.length === 0 ? '✅ 全部满足'
    : `❌ ${unsatisfied.length}/${dshPeers.length} 不满足（如 ${unsatisfied[0][0]} ${unsatisfied[0][1]}）`
  console.log(`| ${name} | ${spec} | ${latest ?? '?'} | ${verdict} | 以 plugin-stage.sh 实测为准 |`)
}

console.log(`
判定规则：semver.satisfies(当前版本, peer范围)。npm 预发布语义下跨 patch 元组的 ^rc 范围
（如 ^0.1.0-rc.8 vs 0.1.1-rc.1）判 false 是正确行为，不是误报。
peer 不满足但 staging 冒烟绿 → 可以升级（记录在案）；staging 红 → 保持 pin 等生态跟进。`)
