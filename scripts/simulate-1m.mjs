/**
 * dsh-novel-writer — 百万字一致性压测（P2-J）。
 * 生成 500 章 × 2000 字模拟正文（确定性伪随机），植入账本冲突，
 * 验证：上下文包预算恒不超限、冲突 100% 检出、巡检正确性。
 * 运行：node scripts/simulate-1m.mjs
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NovelService, NovelStore } from '../lib/core/novel/index.js'
import { LoreStore } from '../lib/core/lorebook/index.js'
import { VariableStoreFile, variablesFilePath } from '../lib/core/variables/index.js'
import { LedgerStore, ledgerFilePath, detectLedgerConflicts } from '../lib/core/consistency/index.js'
import { ContextAssembler } from '../lib/core/context/index.js'
import { createLlmClient } from '../lib/core/llm/index.js'

const CHAPTERS = 500
const WORDS_PER_CHAPTER = 2000
const BUDGET = 12000
const CONFLICT_PLANTS = 20

/** 确定性伪随机（mulberry32）。 */
function mulberry32(seed) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = mulberry32(20260816)
const FILLER = ['林远握紧剑柄，目光如电，喝道：“来战！”', '他迈步向前，衣袂翻飞，灵气在经脉中奔涌。', '远处山门传来钟声，一道身影踏云而来。', '丹炉中的火焰跳跃着，药香弥漫开来。']
function chapterText(no) {
  const parts = []
  let total = 0
  while (total < WORDS_PER_CHAPTER) {
    const piece = FILLER[Math.floor(rand() * FILLER.length)] + `（第${no}章·${total}）`
    parts.push(piece)
    total += piece.length
  }
  return parts.join('\n')
}

const dir = await mkdtemp(join(tmpdir(), 'sim1m-'))
try {
  const novelStore = new NovelStore(join(dir, 'projects'))
  const loreStore = new LoreStore(join(dir, 'lorebook'))
  const variables = new VariableStoreFile(variablesFilePath(join(dir, 'projects')))
  const novel = new NovelService({ store: novelStore, loreStore, variables })
  const ledger = new LedgerStore(ledgerFilePath(join(dir, 'projects')))
  const assembler = new ContextAssembler({ store: novelStore, loreStore, variables })

  console.log(`=== 百万字压测：${CHAPTERS} 章 × ${WORDS_PER_CHAPTER} 字 ===`)
  const book = await novel.createProject('压测之书', 'fantasy')
  const started = Date.now()

  // 1) 生成章节 + 植入冲突（每 25 章一条 JSONPatch，20 条含回退）
  const planted = []
  for (let no = 1; no <= CHAPTERS; no += 1) {
    let text = chapterText(no)
    if (no % 25 === 0 && planted.length < CONFLICT_PLANTS) {
      const stage = Math.floor(no / 25) // 1..20
      const value = stage % 4 === 0 ? `炼气${stage % 9 + 1}层` : `筑基${stage}期` // 每 4 条回退一次（非单调）
      text += `<JSONPatch>[{"op":"replace","path":"/stat_data/林远/境界","value":"${value}"}]</JSONPatch>`
      planted.push({ chapterNo: no, value })
    }
    await novel.saveChapter(book.id, no, `第${no}章`, text)
  }
  const totalWords = (await novel.load(book.id)).stats.totalWords

  // 2) 上下文包预算抽样（每 50 章）
  let overBudget = 0
  const samples = []
  for (let no = 50; no <= CHAPTERS; no += 50) {
    const packet = await assembler.assemble({ book: await novel.load(book.id), chapterNo: no, contextBudget: BUDGET })
    samples.push({ no, tokenEstimate: packet.tokenEstimate, truncated: packet.truncatedInfo.length })
    if (packet.tokenEstimate > BUDGET) overBudget += 1
  }

  // 3) 冲突检出（账本在项目目录内）
  const projectLedger = new LedgerStore(ledgerFilePath(novelStore.getBookDir(book.id)))
  const conflicts = detectLedgerConflicts(await projectLedger.all())
  const history = conflicts.find((c) => c.entity === '林远' && c.field === '境界')?.history ?? []
  const plantedValues = new Set(planted.map((p) => p.value))
  const covered = history.filter((h) => plantedValues.has(h.value)).length

  const elapsed = ((Date.now() - started) / 1000).toFixed(1)
  console.log(JSON.stringify({
    chapters: CHAPTERS,
    totalWords,
    elapsedSeconds: Number(elapsed),
    budgetSamples: samples,
    overBudget,
    conflictsRecorded: history.length,
    plantedValues: planted.length,
    plantedValuesCovered: covered,
    detectionRate: planted.length > 0 ? `${Math.round((covered / planted.length) * 100)}%` : 'n/a',
    pass: overBudget === 0 && covered === planted.length,
  }, null, 2))
} finally {
  await rm(dir, { recursive: true, force: true })
}
