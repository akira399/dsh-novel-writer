/**
 * dsh-novel-writer — agent 预设同步（P2-I）。
 * 随包分发 assets/presets/novel-writer/{preset.yml,agent.cordis.yml}，
 * host 启用时同步到 ~/.dsh/.agent-presets/novel-writer/（幂等覆盖，
 * 仿 dsh-liangshen 同步思路：只写不删，升级自动更新）。
 */
import { cp, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'

const PRESET_ID = 'novel-writer'
const PRESET_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'presets', PRESET_ID)

/** 同步预设到 harness home（失败仅告警，不阻断装配）。 */
export async function syncAgentPreset(ctx: Context, dshHome: string): Promise<{ target: string; files: number } | null> {
  try {
    const target = join(dshHome, '.agent-presets', PRESET_ID)
    await mkdir(target, { recursive: true, mode: 0o700 })
    const entries = await readFile(join(PRESET_DIR, 'preset.yml'), 'utf8').catch(() => null)
    if (entries === null) return null
    await cp(PRESET_DIR, target, { recursive: true, force: true })
    return { target, files: 2 }
  } catch (error) {
    ctx.logger?.warn?.('[dsh-novel-writer] 预设同步失败: ' + String(error))
    return null
  }
}
