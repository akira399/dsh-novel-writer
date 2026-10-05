#!/usr/bin/env node
/**
 * 把构建产物部署到 DSH profile，并**强制刷新客户端 bundle 的版本号**。
 *
 * ## 为什么需要这个脚本（踩过的坑）
 *
 * DSH 的客户端模块系统用一个**文件元数据**哈希当作 bundle 的版本号：
 *
 * ```js
 * // @deepseek-ai/dsh-client-modules: artifactRevision
 * framedHash('plugin-artifact', [mtimeMs, ctimeMs, size])
 * ```
 *
 * 它**不读文件内容**。而 `npm pack` 会把打进包里的文件时间统一归零到 1985 年，
 * `tar` 解包又保留该时间戳 —— 于是「用同一份 tarball 覆盖安装」时
 * mtime / ctime / size 三个输入全都不变 → 版本号不变 → 客户端请求的 URL 不变 →
 * Chromium 对该 URL 的 `immutable, max-age=31536000` 缓存持续命中**旧字节**。
 *
 * 现象极具迷惑性：`lib/client.js` 磁盘内容明明是新的、类型检查与单测全绿、
 * 宿主也重启了，浏览器里却始终是旧界面。
 *
 * 所以部署的最后一步必须是「把文件时间改成现在」，本脚本负责这件事。
 *
 * ## 用法
 *
 * ```bash
 * npm run deploy            # 构建 + 部署到默认 profile（desktop）
 * node scripts/deploy.mjs --profile <name>
 * ```
 */
import { cp, rm, stat, utimes } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import process from 'node:process'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 解析目标 profile 名（--profile <name>，默认 desktop）。 */
function profileName() {
  const at = process.argv.indexOf('--profile')
  if (at >= 0 && process.argv[at + 1]) return process.argv[at + 1]
  return process.env.DSH_PROFILE || 'desktop'
}

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const PKG_NAME = '@dsh-external/dsh-novel-writer'
const dest = join(DSH_HOME, 'profiles', profileName(), 'node_modules', PKG_NAME)

if (!existsSync(dest)) {
  console.error(`deploy: 目标不存在：${dest}`)
  console.error('        先在 DSH 里安装该插件（或用 plugin_manager 安装 tgz）后再部署。')
  process.exit(1)
}

const source = {
  lib: join(ROOT, 'lib'),
  assets: join(ROOT, 'assets'),
  src: join(ROOT, 'src'),
  'package.json': join(ROOT, 'package.json'),
  'cordis.patch.yml': join(ROOT, 'cordis.patch.yml'),
  'client.d.ts': join(ROOT, 'client.d.ts'),
}

if (!existsSync(source.lib)) {
  console.error('deploy: 缺少 lib/，请先运行 npm run build')
  process.exit(1)
}

console.log(`deploy: ${ROOT}  ->  ${dest}`)

// src/ 用整体替换，避免删掉的文件残留在安装目录里
await rm(join(dest, 'src'), { recursive: true, force: true })

for (const [name, from] of Object.entries(source)) {
  await cp(from, join(dest, name), { recursive: true, force: true })
}

/**
 * 关键一步：把「决定版本号」的文件时间改成现在。
 *
 * 只改客户端 bundle 即可（那才是被浏览器缓存的东西），另外把 index.js 一起刷新，
 * 方便排查宿主侧是否更新。
 */
const now = new Date()
const touched = ['lib/client.js', 'lib/index.js']
for (const rel of touched) {
  const target = join(dest, rel)
  if (!existsSync(target)) continue
  await utimes(target, now, now)
  const info = await stat(target)
  console.log(`deploy: touched ${rel}  mtime=${info.mtime.toISOString()}  size=${info.size}`)
}

console.log('deploy: 完成。重启 DSH 后新的 bundle 版本号才会被计算并下发。')
