/**
 * dsh-novel-writer — 工作台抽屉 v4（原生事件驱动版）。
 *
 * 背景（实测）：本环境中 createRoot 渲染 React 树**有效**（内容可见），
 * 但 React 合成事件（onClick/onChange）**失效**（REACT-OK 探针从未触发，
 * 输入框仅原生聚焦可用）——疑似宿主页面与独立 root 容器的事件委托冲突。
 * 方案：抽屉状态由闭包持有，交互全部走**原生事件代理**（click/input/change
 * 挂在外层容器，经 data-action/id 分派），React 只做**纯渲染**（props 传入，
 * 无 hooks、无合成事件）。渲染与交互各用已证实的通道。
 */
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { diffSentences, diffChars, countDiffChanges, splitPolishSuggestions, applyPolishSuggestions, type DiffChunk, type PolishSuggestion } from '../core/polish/diff.ts'
import { drawerSize } from '../core/drawer-size.ts'
import { GENRES, genreLabel, type GenreOption } from '../core/genres.ts'

export interface WorkshopOptions {
  api: string
  fenceHeader: string
}

export interface WorkshopHandle {
  toggle(): void
  dispose(): void
}

interface ProjectSummary {
  id: string
  title: string
  genre: string
  currentPhase: string
  chapterCount: number
  totalWords: number
}

interface BookDetail {
  book: {
    id: string
    title: string
    genre: string
    currentPhase: string
    stats: { totalWords: number; chapterCount: number }
    phases: Record<string, { state: string }>
  }
}

interface DiagnoseResult {
  score: number
  issues: Array<{ severity: string; advice: string }>
}

/** 删除确认状态：null=未触发；'confirm'=询问中；'busy'=执行中。 */
type DeleteState = 'confirm' | 'busy' | null

/** 世界书条目（GUI 视图）。 */
interface LoreEntryView {
  id: string
  name: string
  content: string
  keywords: string[]
  always_active: boolean
  enabled: boolean
  priority: number
  inject_target: string
  inject_position: string
  book_id: string
}

/** 世界书表单状态。 */
interface LoreForm {
  mode: 'none' | 'new' | 'edit'
  id: string
  name: string
  content: string
  keywords: string
  alwaysActive: boolean
  enabled: boolean
  priority: string
  /** 绑定书籍 id（''=全局）。 */
  bookId: string
}

/** 抽屉全部可变状态（闭包持有，交互修改后触发 render）。 */
interface DrawerState {
  projects: ProjectSummary[]
  loading: boolean
  error: string
  notice: string
  creating: boolean
  title: string
  genre: string
  selected: string | null
  detail: BookDetail | null
  chapterNo: number
  writing: boolean
  draft: string
  /** draft 版本号：非受控 textarea 用 key 强制重挂以显示新正文。 */
  draftVersion: number
  report: DiagnoseResult | null
  diagnosing: boolean
  deleteState: DeleteState
  exporting: boolean
  view: 'projects' | 'lorebook'
  loreEntries: LoreEntryView[]
  loreForm: LoreForm
  loreBusy: boolean
  /** book_id → 书名（世界书绑定显示）。 */
  bookMap: Record<string, string>
  /** 世界书过滤：'all' | 书 id（每本书独立栏目）。 */
  loreFilter: string
  /** AI 一键生成世界书设定（请求中）。 */
  loreAutogenBusy: boolean
  /** 本地书籍文件导入中。 */
  importing: boolean
  /** 一键润色请求中。 */
  polishing: boolean
  /** 润色预览（确认前不落盘）：original=用户原文，polished=润色文。 */
  polishPreview: { original: string; polished: string } | null
  /** 由原文vs润色文拆分出的逐条建议（每条可独立采纳/拒绝）。 */
  polishSuggestions: PolishSuggestion[]
  /** 润色保存确认中。 */
  polishBusy: boolean
  /** 文本历史栈（撤销：用户输入防抖快照 + 写章/润色应用前快照）。 */
  undoStack: string[]
  /** 当前章节已加载/已保存的原文（撤销兜底目标 & 修改检测基准）。 */
  baseline: string
  /** 编辑区文本是否偏离 baseline（= 内容被修改过，撤销立即可用）。 */
  draftModified: boolean
  /** 抽屉展开模式（宽视口 + 底部避让聊天条）。 */
  expanded: boolean
}

function emptyLoreForm(): LoreForm {
  return { mode: 'none', id: '', name: '', content: '', keywords: '', alwaysActive: false, enabled: true, priority: '50', bookId: '' }
}

function initial(): DrawerState {
  return {
    projects: [], loading: true, error: '', notice: '', creating: false,
    title: '', genre: 'fantasy', selected: null, detail: null,
    chapterNo: 1, writing: false, draft: '', draftVersion: 0,
    report: null, diagnosing: false, deleteState: null, exporting: false,
    view: 'projects', loreEntries: [], loreForm: emptyLoreForm(), loreBusy: false,
    bookMap: {}, loreFilter: 'all', loreAutogenBusy: false, importing: false,
    polishing: false, polishPreview: null, polishSuggestions: [], polishBusy: false, undoStack: [],
    baseline: '', draftModified: false, expanded: false,
  }
}

async function apiFetch(options: WorkshopOptions, path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${options.api}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), [options.fenceHeader]: '1', 'content-type': 'application/json' },
  })
  const payload = await response.json() as { ok: boolean; value?: unknown; error?: { message?: string } }
  if (!payload.ok) throw new Error(payload.error?.message ?? `HTTP ${response.status}`)
  return payload.value
}

const rowStyle: React.CSSProperties = {
  padding: '8px 10px', border: '1px solid #e5e5e5', borderRadius: '6px', background: '#fafafa', cursor: 'pointer',
}
const buttonStyle: React.CSSProperties = {
  padding: '4px 10px', borderRadius: '4px', border: '1px solid #888', cursor: 'pointer', background: '#fff',
}
const inputStyle: React.CSSProperties = {
  padding: '4px 6px', border: '1px solid #ccc', borderRadius: '4px', width: '100%', boxSizing: 'border-box',
}

/** 题材下拉选项：按分组渲染 <optgroup>（覆盖网文全类型）。 */
function genreGroupOptions(): React.ReactNode {
  const groups: Array<{ group: string; items: GenreOption[] }> = []
  for (const genre of GENRES) {
    const existing = groups.find((g) => g.group === genre.group)
    if (existing) existing.items.push(genre)
    else groups.push({ group: genre.group, items: [genre] })
  }
  return groups.map((g) =>
    React.createElement('optgroup', { key: g.group, label: g.group },
      g.items.map((genre) => React.createElement('option', { key: genre.id, value: genre.id }, genre.label))))
}

/** React 错误边界（渲染异常显示而非静默卸载）。 */
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string | null }> {
  override state: { error: string | null } = { error: null }
  static getDerivedStateFromError(error: unknown): { error: string } {
    return { error: error instanceof Error ? error.message : String(error) }
  }
  override render(): React.ReactNode {
    if (this.state.error) {
      return React.createElement('div', { style: { padding: '12px', color: '#c33', fontSize: '12px', fontFamily: 'monospace' } },
        React.createElement('div', { style: { fontWeight: 700 } }, '小说工坊渲染出错：'),
        this.state.error,
      )
    }
    return this.props.children
  }
}

/** 结构诊断面板（纯展示；交互走 data-action）。 */
function DiagnosePanelV(state: DrawerState): React.ReactNode {
  const { report, diagnosing, error } = state
  return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', borderTop: '1px solid #eee', paddingTop: '8px' } },
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
      React.createElement('span', { style: { fontWeight: 600, fontSize: '13px' } }, '结构诊断'),
      React.createElement('button', { 'data-action': 'diagnose', disabled: diagnosing, style: buttonStyle }, diagnosing ? '诊断中…' : '诊断本章'),
      report ? React.createElement('span', { style: { fontSize: '13px', fontWeight: 700, color: report.score >= 70 ? '#2a7' : report.score >= 50 ? '#c90' : '#c33' } }, `得分 ${report.score}`) : null,
    ),
    error ? React.createElement('div', { style: { color: '#c33', fontSize: '12px' } }, error) : null,
    report && report.issues.length > 0
      ? React.createElement('div', { style: { fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '4px' } },
        report.issues.slice(0, 5).map((issue, index) =>
          React.createElement('div', { key: index, style: { padding: '4px 6px', background: issue.severity === 'error' ? '#fde' : '#ffd', borderRadius: '4px' } }, issue.advice)))
      : report
        ? React.createElement('div', { style: { fontSize: '12px', color: '#2a7' } }, '未发现问题')
        : null,
  )
}

/** 字级 diff 渲染：把一段文本按 diffChars 拆成 同/删/增 内联片段。 */
function CharDiffV(original: string, polished: string, accent: 'warmer' | 'blue'): React.ReactNode {
  const chunks = diffChars(original, polished)
  return React.createElement('span', {},
    chunks.map((chunk, index) => {
      if (chunk.type === 'same') return React.createElement('span', { key: index }, chunk.text)
      if (chunk.type === 'del') {
        return React.createElement('span', { key: index, style: { background: '#fdd', color: '#a33', textDecoration: 'line-through', borderRadius: '2px' } }, chunk.text)
      }
      // add
      const blue = accent === 'blue'
      return React.createElement('span', {
        key: index,
        style: blue
          ? { background: '#dbeafe', color: '#1e40af', borderRadius: '2px' }
          : { background: '#ffe58a', color: '#333', borderRadius: '2px' },
      }, chunk.text)
    }),
  )
}

/** 润色预览面板：逐条建议（每条可独立采纳/拒绝）+ 字级 diff 标出改动处。 */
function DiffPreviewV(state: DrawerState): React.ReactNode {
  const preview = state.polishPreview
  if (!preview) return null
  // 建议列表：优先用已派生的，否则即时生成
  const suggestions = state.polishSuggestions.length > 0
    ? state.polishSuggestions
    : splitPolishSuggestions(preview.original, preview.polished)
  const acceptedCount = suggestions.filter((s) => s.accepted).length
  const decided = acceptedCount + suggestions.filter((s) => !s.accepted && s.original === '' && s.polished === '').length

  const suggestionCard = (s: PolishSuggestion): React.ReactNode => {
    const isIns = s.original === ''
    const isDel = s.polished === ''
    const title = isIns ? '（新增）' : isDel ? '（删除）' : `建议 ${s.id}`
    return React.createElement('div', {
      key: s.id,
      style: {
        border: s.accepted ? '1px solid #2a7' : '1px solid #e0e0e0',
        borderRadius: '6px', padding: '8px', background: s.accepted ? '#f0fbf4' : '#fcfcfc',
      },
    },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' } },
        React.createElement('span', { style: { fontWeight: 600, fontSize: '12px', color: s.accepted ? '#2a7' : '#666' } }, title),
        React.createElement('span', { style: { marginLeft: 'auto', fontSize: '12px' } },
          React.createElement('button', {
            'data-action': 'polish-toggle', 'data-id': s.id,
            style: { ...buttonStyle, fontSize: '12px', padding: '1px 8px', borderColor: s.accepted ? '#2a7' : '#888', color: s.accepted ? '#2a7' : '#888' },
          }, s.accepted ? '✓ 已采纳 · 点此撤销' : '采纳这条'),
        ),
      ),
      // 原文 → 润色（字级标亮具体改了哪几个字）
      s.original.length > 0
        ? React.createElement('div', { style: { fontSize: '12px', lineHeight: 1.6, color: '#555', whiteSpace: 'pre-wrap', wordBreak: 'break-all' } },
          '原文：', CharDiffV(s.original, s.polished, 'blue'))
        : null,
      s.polished.length > 0
        ? React.createElement('div', { style: { fontSize: '12px', lineHeight: 1.6, color: '#155', whiteSpace: 'pre-wrap', wordBreak: 'break-all' } },
          '改后：', CharDiffV(s.original, s.polished, 'warmer'))
        : null,
    )
  }

  return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', border: '1px solid #d9b64f', borderRadius: '6px', background: '#fffbeb', padding: '10px' } },
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
      React.createElement('span', { style: { fontWeight: 700, fontSize: '13px' } }, '润色预览'),
      React.createElement('span', { style: { fontSize: '11px', color: '#888' } },
        `共 ${suggestions.length} 条建议 · 已采纳 ${acceptedCount} 条（每条可单独采纳；删除线=删除，黄底/蓝底=新增/改动字）`),
    ),
    React.createElement('div', {
      style: {
        maxHeight: state.expanded ? '46vh' : 300, overflowY: 'auto',
        display: 'flex', flexDirection: 'column', gap: '6px', padding: '2px',
      },
    },
      suggestions.length === 0
        ? React.createElement('div', { style: { fontSize: '12px', color: '#888', padding: '8px' } }, '未检测到改动（与原文一致）')
        : suggestions.map(suggestionCard),
    ),
    React.createElement('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
      React.createElement('button', { 'data-action': 'polish-accept-all', style: { ...buttonStyle, borderColor: '#2a7', color: '#156' } }, '全部采纳'),
      React.createElement('button', { 'data-action': 'polish-reject-all', style: buttonStyle }, '全部拒绝'),
      React.createElement('button', { 'data-action': 'polish-save', disabled: state.polishBusy, style: { ...buttonStyle, borderColor: '#2a7', color: '#156' } },
        state.polishBusy ? '保存中…' : '确认保存'),
      React.createElement('button', { 'data-action': 'polish-discard', style: buttonStyle }, '放弃还原'),
      React.createElement('span', { style: { fontSize: '11px', color: '#888' } }, '保存只写入你采纳的改动；放弃则恢复原文'),
    ),
  )
}

/** 世界书面板（纯展示；交互走 data-action）。 */
function LorebookPanelView(state: DrawerState): React.ReactNode {
  const { loreEntries, loreForm, loreBusy, error, notice, bookMap, loreFilter, projects, loreAutogenBusy } = state
  const editing = loreForm.mode !== 'none'

  // 按书过滤（每本书独立栏目；__global__=仅全局条目）
  const filtered = loreFilter === 'all'
    ? loreEntries
    : loreFilter === '__global__'
      ? loreEntries.filter((entry) => !entry.book_id)
      : loreEntries.filter((entry) => entry.book_id === loreFilter)
  const bookName = (bookId: string): string => (bookId ? (bookMap[bookId] ?? bookId) : '全局')
  // AI 一键生成仅面向具体书籍栏目（需把设定绑定到本书）
  const specificBook = loreFilter !== 'all' && loreFilter !== '__global__'
  const autogenDisabled = !specificBook || loreAutogenBusy

  const entryRow = (entry: LoreEntryView): React.ReactNode =>
    React.createElement('div', { key: entry.id, style: { padding: '8px 10px', border: '1px solid #e5e5e5', borderRadius: '6px', background: '#fafafa' } },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
        React.createElement('span', { style: { fontWeight: 600, color: entry.enabled ? undefined : '#aaa' } }, entry.name),
        entry.always_active ? React.createElement('span', { style: { fontSize: '10px', color: '#a70', background: '#ffd', padding: '1px 5px', borderRadius: '3px' } }, '常驻') : null,
        !entry.enabled ? React.createElement('span', { style: { fontSize: '10px', color: '#888' } }, '已停用') : null,
        React.createElement('span', { style: { fontSize: '10px', color: '#29a', marginLeft: 'auto' } }, bookName(entry.book_id)),
        React.createElement('span', { style: { fontSize: '10px', color: '#888' } }, `P${entry.priority}`),
      ),
      entry.keywords.length > 0
        ? React.createElement('div', { style: { fontSize: '11px', color: '#666', marginTop: '3px' } }, `关键词：${entry.keywords.join('、')}`)
        : null,
      React.createElement('div', { style: { display: 'flex', gap: '6px', marginTop: '6px' } },
        React.createElement('button', { 'data-action': 'lore-edit', 'data-id': entry.id, style: buttonStyle }, '编辑'),
        React.createElement('button', { 'data-action': 'lore-toggle', 'data-id': entry.id, style: buttonStyle }, entry.enabled ? '停用' : '启用'),
        React.createElement('button', { 'data-action': 'lore-delete', 'data-id': entry.id, style: { ...buttonStyle, color: '#c33' } }, '删除'),
      ),
    )

  // 绑定书籍下拉选项：全局 + 各书
  const bookOptions = [React.createElement('option', { key: '', value: '' }, '全局（所有书）'), ...projects.map((p) =>
    React.createElement('option', { key: p.id, value: p.id }, p.title))]

  return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
      React.createElement('button', { 'data-action': 'lore-back', style: buttonStyle }, '← 项目'),
      React.createElement('span', { style: { fontWeight: 700, fontSize: '14px' } }, '世界书（设定注入）'),
      React.createElement('button', {
        'data-action': 'lore-autogen',
        disabled: autogenDisabled,
        title: specificBook ? `按《${bookName(loreFilter)}》生成 4-6 条设定并写入本书栏目` : '请先在「栏目」下拉选择一本书，AI 才知道按哪本书生成设定',
        style: { ...buttonStyle, marginLeft: 'auto', color: '#a06', borderColor: '#a06' },
      }, loreAutogenBusy ? '生成中…（约 1 分钟）' : 'AI 一键生成设定'),
      React.createElement('button', { 'data-action': 'lore-new', disabled: editing, style: buttonStyle }, '+ 新建条目'),
    ),
    // 按书分栏（每本书一个栏目）
    React.createElement('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } },
      React.createElement('label', { style: { fontSize: '12px', color: '#666' } }, '栏目：'),
      React.createElement('select', {
        id: 'lore-filter', defaultValue: loreFilter,
        style: { padding: '4px', borderRadius: '4px', border: '1px solid #ccc' },
      },
      React.createElement('option', { value: 'all' }, '全部条目'),
      ...projects.map((p) => React.createElement('option', { key: p.id, value: p.id }, p.title)),
      React.createElement('option', { value: '__global__' }, '仅全局条目'),
      ),
    ),
    error ? React.createElement('div', { style: { color: '#c33', fontSize: '12px' } }, error) : null,
    notice ? React.createElement('div', { style: { color: '#2a7', fontSize: '12px' } }, notice) : null,

    // 新建/编辑表单
    editing
      ? React.createElement('div', { style: { padding: '10px', border: '1px solid #29a', borderRadius: '6px', background: '#f0f8ff', display: 'flex', flexDirection: 'column', gap: '6px' } },
        React.createElement('div', { style: { fontWeight: 600, fontSize: '13px' } }, loreForm.mode === 'new' ? '新建条目' : '编辑条目'),
        React.createElement('div', { style: { display: 'flex', gap: '6px' } },
          React.createElement('input', { id: 'lore-name', defaultValue: loreForm.name, placeholder: '条目名称（如：林远）', style: { ...inputStyle, flex: 1 } }),
          React.createElement('select', { id: 'lore-book', defaultValue: loreForm.bookId, style: { padding: '4px', borderRadius: '4px', border: '1px solid #ccc' } }, ...bookOptions),
        ),
        React.createElement('input', { id: 'lore-keywords', defaultValue: loreForm.keywords, placeholder: '触发关键词（逗号分隔，留空=仅常驻）', style: inputStyle }),
        React.createElement('textarea', { id: 'lore-content', defaultValue: loreForm.content, placeholder: '注入内容（如：林远，炼气七层，青莲剑诀传人）', rows: 4, style: { ...inputStyle, fontFamily: 'monospace', fontSize: '12px' } }),
        React.createElement('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } },
          React.createElement('label', { style: { fontSize: '12px', display: 'flex', gap: '4px', alignItems: 'center' } },
            React.createElement('input', { id: 'lore-always', type: 'checkbox', defaultChecked: loreForm.alwaysActive }), '常驻注入'),
          React.createElement('label', { style: { fontSize: '12px', display: 'flex', gap: '4px', alignItems: 'center' } },
            React.createElement('input', { id: 'lore-enabled', type: 'checkbox', defaultChecked: loreForm.enabled }), '启用'),
          React.createElement('label', { style: { fontSize: '12px', display: 'flex', gap: '4px', alignItems: 'center' } },
            '优先级',
            React.createElement('input', { id: 'lore-priority', type: 'number', defaultValue: loreForm.priority, style: { width: '56px', padding: '2px 4px' } }),
          ),
        ),
        React.createElement('div', { style: { display: 'flex', gap: '6px' } },
          React.createElement('button', { 'data-action': 'lore-save', disabled: loreBusy, style: buttonStyle }, loreBusy ? '保存中…' : '保存'),
          React.createElement('button', { 'data-action': 'lore-cancel', style: buttonStyle }, '取消'),
        ),
      )
      : null,

    filtered.length === 0
      ? React.createElement('div', { style: { color: '#888' } }, '该栏目还没有条目，点「+ 新建条目」添加（并选择绑定本书）')
      : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, filtered.map(entryRow)),
  )
}

/** 项目详情视图（纯展示；交互由原生代理分派 data-action）。 */
function ProjectDetailView(state: DrawerState): React.ReactNode {
  const { detail, chapterNo, writing, draft, draftVersion, report, diagnosing, error, notice, deleteState, exporting, loreEntries, polishing, undoStack, draftModified } = state
  // 本书绑定的世界书条目数（写前提醒）
  const bookLoreCount = detail ? loreEntries.filter((e) => e.book_id === detail.book.id).length : 0
  const phases = detail ? Object.entries(detail.book.phases).filter(([, p]) => p.state !== 'locked') : []
  const chapterRows = detail ? Array.from({ length: Math.max(1, detail.book.stats.chapterCount + 1) }, (_, i) => i + 1) : [1]

  return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
    React.createElement('button', { 'data-action': 'back', style: buttonStyle }, '← 返回'),
    detail ? React.createElement('div', {},
      React.createElement('div', { style: { fontWeight: 700 } }, detail.book.title),
      React.createElement('div', { style: { color: '#888', fontSize: '12px' } },
        `${detail.book.genre ? `${genreLabel(detail.book.genre)} · ` : ''}阶段:${detail.book.currentPhase} · ${detail.book.stats.chapterCount} 章 · ${detail.book.stats.totalWords} 字`),
      phases.length > 0 ? React.createElement('div', { style: { fontSize: '12px', color: '#666', marginTop: '4px' } },
        phases.map(([name, p]) => `${name}:${p.state}`).join(' · ')) : null,
    ) : null,
    // 写前提醒：本书尚无世界书设定 → 引导先创建设定
    detail && bookLoreCount === 0
      ? React.createElement('div', { style: { padding: '8px', border: '1px solid #c90', borderRadius: '6px', background: '#ffd', fontSize: '12px' } },
        '本书还没有世界书设定。建议先到「世界书」创建主角/宗门/境界等条目并绑定本书，写章时这些设定会自动注入。',
        React.createElement('button', { 'data-action': 'go-lorebook', style: { ...buttonStyle, marginLeft: '6px' } }, '去添加设定'),
      )
      : detail
        ? React.createElement('div', { style: { fontSize: '12px', color: '#2a7' } }, `本书世界书条目：${bookLoreCount} 条`)
        : null,
    React.createElement('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
      React.createElement('label', { style: { fontSize: '12px' } }, '章节'),
      React.createElement('select', {
        id: 'novel-chapter', defaultValue: String(chapterNo),
        style: { padding: '4px', borderRadius: '4px' },
      }, chapterRows.map((no) => React.createElement('option', { key: no, value: String(no) }, `第 ${no} 章`))),
      React.createElement('button', { 'data-action': 'write', disabled: writing || polishing, style: buttonStyle },
        writing ? '写作中…（约 1 分钟）' : '一键写章并保存'),
      React.createElement('button', {
        'data-action': 'polish',
        disabled: writing || polishing,
        title: 'AI 润色当前章节正文（保持情节/人物/走向不变，提升文笔）',
        style: { ...buttonStyle, borderColor: '#a06', color: '#a06' },
      }, polishing ? '润色中…（约 1 分钟）' : '一键润色'),
    ),
    error ? React.createElement('div', { style: { color: '#c33', fontSize: '12px' } }, error) : null,
    notice ? React.createElement('div', { style: { color: '#2a7', fontSize: '12px' } }, notice) : null,
    // 编辑区工具行：侧向撤销（逐步还原文本至任意状态）
    React.createElement('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
      React.createElement('button', {
        'data-action': 'undo',
        id: 'undo-btn',
        disabled: !draftModified && undoStack.length === 0,
        title: '撤销上一步文本修改（含 AI 润色与手动编辑，可连续撤销；内容被修改后即可用）',
        style: { ...buttonStyle, fontSize: '12px', padding: '2px 8px' },
      }, `↶ 撤销${(undoStack.length > 0 || draftModified) ? `（${undoStack.length + (draftModified && undoStack.length === 0 ? 1 : 0)}）` : ''}`),
      React.createElement('span', { style: { fontSize: '11px', color: '#999' } }, draftModified ? '内容已修改，可撤销' : '未修改（输入后立即可撤销）'),
    ),
    React.createElement('textarea', {
      id: 'novel-draft',
      // 非受控 + key 重挂：写章回填/加载章节时显示新正文；用户输入不被打断
      key: `draft-${draftVersion}`,
      defaultValue: draft,
      placeholder: '本章正文（写章后自动填充并已保存；也可手动编辑）',
      rows: 8,
      style: { ...inputStyle, fontFamily: 'monospace', fontSize: '12px' },
    }),
    // 润色预览：diff 标亮 + 确认保存/放弃
    state.polishPreview ? React.createElement(DiffPreviewV, state) : null,
    React.createElement('div', { style: { display: 'flex', gap: '6px' } },
      React.createElement('button', { 'data-action': 'refresh', style: buttonStyle }, '刷新'),
      React.createElement('button', { 'data-action': 'export', disabled: exporting, style: buttonStyle }, exporting ? '导出中…' : '导出 txt'),
      React.createElement('button', { 'data-action': 'open-lore', 'data-id': detail?.book.id ?? '', style: buttonStyle }, '本书世界书'),
      React.createElement('button', { 'data-action': 'delete', style: { ...buttonStyle, color: '#c33' } }, '删除书籍'),
    ),
    // 删除确认区（原生代理处理）
    deleteState === 'confirm'
      ? React.createElement('div', { style: { padding: '8px', border: '1px solid #c66', borderRadius: '6px', background: '#fdf' } },
        React.createElement('div', { style: { fontSize: '12px', marginBottom: '6px' } }, '删除《' + (detail?.book.title ?? '本书') + '》？正文（chapters/ 目录）是否保留？'),
        React.createElement('div', { style: { display: 'flex', gap: '6px' } },
          React.createElement('button', { 'data-action': 'delete-keep', style: buttonStyle }, '保留正文，删除书籍'),
          React.createElement('button', { 'data-action': 'delete-all', style: { ...buttonStyle, color: '#c33' } }, '连同正文一起删除'),
          React.createElement('button', { 'data-action': 'delete-cancel', style: buttonStyle }, '取消'),
        ),
      )
      : deleteState === 'busy'
        ? React.createElement('div', { style: { fontSize: '12px', color: '#888' } }, '删除中…')
        : null,
    React.createElement(DiagnosePanelV, state),
  )
}

/** 工作台主面板（纯展示）。 */
function WorkshopPanelView(state: DrawerState): React.ReactNode {
  const { projects, loading, error, notice, creating, title, genre, selected, view, importing } = state
  if (view === 'lorebook') {
    return React.createElement(LorebookPanelView, state)
  }
  if (selected) {
    return React.createElement(ProjectDetailView, state)
  }
  const row = (p: ProjectSummary): React.ReactNode =>
    React.createElement('div', { key: p.id, style: rowStyle },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
        React.createElement('div', { 'data-action': 'open', 'data-id': p.id, style: { flex: 1, cursor: 'pointer' } },
          React.createElement('div', { style: { fontWeight: 600 } }, p.title),
          React.createElement('div', { style: { color: '#888', fontSize: '12px' } },
            `${p.genre ? `${genreLabel(p.genre)} · ` : ''}阶段:${p.currentPhase} · ${p.chapterCount} 章 · ${p.totalWords} 字`),
        ),
        React.createElement('button', { 'data-action': 'open-lore', 'data-id': p.id, style: { ...buttonStyle, fontSize: '11px', padding: '2px 6px' } }, '世界书'),
      ),
    )

  return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
    React.createElement('div', { style: { fontWeight: 700, fontSize: '14px' } }, '大肥鱼的小说工坊 · 项目'),
    React.createElement('div', { style: { display: 'flex', gap: '6px' } },
      React.createElement('input', {
        id: 'novel-title',
        // 非受控：合成事件失效环境下 React 不得干预用户输入（受控 value 会被 render 覆盖）
        defaultValue: title,
        placeholder: '书名（如：青云问道）',
        style: { ...inputStyle, flex: 1 },
      }),
      React.createElement('select', {
        id: 'novel-genre', defaultValue: genre,
        style: { padding: '4px', borderRadius: '4px', border: '1px solid #ccc', maxWidth: '130px' },
      }, genreGroupOptions()),
      React.createElement('button', { 'data-action': 'create', disabled: creating, style: buttonStyle },
        creating ? '创建中…' : '创建'),
    ),
    React.createElement('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
      React.createElement('span', { style: { fontSize: '12px', color: '#888' } }, '新手？'),
      React.createElement('button', { 'data-action': 'demo', style: buttonStyle }, '一键导入示例《青云问道》'),
      React.createElement('button', {
        'data-action': 'import-file',
        disabled: importing,
        title: '导入本地 txt / md 书籍文件（自动识别章节并建书）',
        style: { ...buttonStyle, borderColor: '#29a', color: '#156' },
      }, importing ? '导入中…' : '导入本地书籍'),
      React.createElement('button', { 'data-action': 'lorebook', style: { ...buttonStyle, marginLeft: 'auto' } }, '世界书'),
    ),
    error ? React.createElement('div', { style: { color: '#c33', fontSize: '12px' } }, error) : null,
    notice ? React.createElement('div', { style: { color: '#2a7', fontSize: '12px' } }, notice) : null,
    loading
      ? React.createElement('div', { style: { color: '#888' } }, '加载中…')
      : projects.length === 0
        ? React.createElement('div', { style: { color: '#888' } }, '还没有项目，输入书名创建一个')
        : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, projects.map(row)),
  )
}

/** 挂载抽屉：原生事件代理 + React 纯渲染。 */
export function mountWorkshopDrawer(options: WorkshopOptions): WorkshopHandle {
  let rootEl: HTMLElement | null = null
  let root: Root | null = null
  let open = false
  let badgeEl: HTMLDivElement | null = null
  let importFileInput: HTMLInputElement | null = null
  /** 撤销防抖 timer（手动编辑停顿 800ms 才记一个历史快照）。 */
  let undoTimer: number | null = null
  const state = initial()

  const render = (): void => {
    if (!root) return
    const headerTitle = state.view === 'lorebook'
      ? '世界书'
      : state.selected
        ? (state.detail?.book.title ?? '项目详情')
        : '大肥鱼的小说工坊'
    root.render(React.createElement(ErrorBoundary, null,
      React.createElement('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
        // 全局固定头部：视图标题 + 展开/收起（不随内容滚动，层级高于聊天条）
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', borderBottom: '1px solid #eee', flex: '0 0 auto', background: '#fff' } },
          React.createElement('span', { style: { fontWeight: 700, fontSize: '14px' } }, headerTitle),
          state.expanded
            ? React.createElement('span', { style: { fontSize: '10px', color: '#29a', border: '1px solid #29a', borderRadius: '3px', padding: '0 4px' } }, '展开')
            : null,
          React.createElement('button', {
            'data-action': 'expand',
            title: state.expanded ? '收起为窄栏（380px）' : '展开为宽栏，内容与润色预览更清晰（自动避让聊天框条）',
            style: { ...buttonStyle, marginLeft: 'auto', fontSize: '12px', padding: '2px 8px' },
          }, state.expanded ? '⇔ 收起' : '⇔ 展开'),
        ),
        // 内容滚动区（唯一滚动容器；头部常驻）
        React.createElement('div', { style: { flex: '1 1 auto', overflowY: 'auto', padding: '12px 14px', minHeight: 0 } },
          state.selected
            ? React.createElement(ProjectDetailView, state)
            : React.createElement(WorkshopPanelView, state),
        ),
      )))
  }

  // ── 业务动作（原生事件分派入口）──
  const refreshProjects = async (): Promise<void> => {
    state.loading = true
    render()
    try {
      state.projects = (await apiFetch(options, '/projects')) as ProjectSummary[]
      state.error = ''
    } catch (cause) {
      state.error = String(cause)
    } finally {
      state.loading = false
      render()
    }
  }
  const setDraft = (text: string): void => {
    state.draft = text
    state.draftVersion += 1
    state.draftModified = text !== state.baseline
  }
  /** 撤销栈压入（去重 + 上限保护）；栈变化需刷新按钮状态。 */
  const pushUndo = (text: string): void => {
    if (state.undoStack.at(-1) === text) return
    state.undoStack.push(text)
    if (state.undoStack.length > 100) state.undoStack.shift()
    render()
  }
  /** 撤销：栈非空 → 弹最近快照；栈空但内容被改 → 回到章节原文（兜底）。可连续撤销。 */
  const undo = (): void => {
    if (undoTimer !== null) {
      clearTimeout(undoTimer)
      undoTimer = null
    }
    let target: string | undefined
    if (state.undoStack.length > 0) {
      target = state.undoStack.pop()
    } else if (state.draft !== state.baseline) {
      target = state.baseline
    }
    if (target === undefined) {
      state.error = '没有可撤销的修改'
      render()
      return
    }
    state.error = ''
    setDraft(target)
    render()
  }
  /** 原生即时同步撤销按钮（input 事件内调用，避免 render 打断输入）。 */
  const syncUndoButton = (): void => {
    const btn = document.getElementById('undo-btn') as HTMLButtonElement | null
    if (!btn) return
    const canUndo = state.draftModified || state.undoStack.length > 0
    const steps = state.undoStack.length + (state.draftModified && state.undoStack.length === 0 ? 1 : 0)
    btn.disabled = !canUndo
    btn.textContent = `↶ 撤销${steps > 0 ? `（${steps}）` : ''}`
  }
  /** 加载已保存的章节正文到编辑框（刷新后/切章时可见）；切章清空撤销栈并重设基准。 */
  const loadChapter = async (projectId: string, no: number): Promise<void> => {
    if (undoTimer !== null) {
      clearTimeout(undoTimer)
      undoTimer = null
    }
    state.undoStack = []
    state.polishPreview = null
    state.polishSuggestions = []
    try {
      const content = await apiFetch(options, `/projects/${projectId}/chapters/${no}`) as string | null
      const text = content ?? ''
      state.baseline = text
      setDraft(text)
    } catch {
      state.baseline = ''
      setDraft('')
    }
    render()
  }
  const openProject = async (id: string): Promise<void> => {
    state.selected = id
    state.detail = null
    state.report = null
    state.chapterNo = 1
    render()
    try {
      const [bookDetail, entries] = await Promise.all([
        apiFetch(options, `/projects/${id}`) as Promise<BookDetail>,
        apiFetch(options, '/lorebook/entries') as Promise<LoreEntryView[]>,
      ])
      state.detail = bookDetail
      state.loreEntries = entries
    } catch (cause) {
      state.error = String(cause)
    }
    render()
    void loadChapter(id, 1)
  }
  const createProject = async (): Promise<void> => {
    if (!state.title.trim()) {
      state.error = '请先输入书名'
      render()
      return
    }
    state.creating = true
    render()
    try {
      const book = (await apiFetch(options, '/projects', { method: 'POST', body: JSON.stringify({ title: state.title.trim(), genre: state.genre }) })) as { id: string }
      state.title = ''
      await refreshProjects()
      await openProject(book.id)
    } catch (cause) {
      state.error = String(cause)
    } finally {
      state.creating = false
      render()
    }
  }
  const importDemo = async (): Promise<void> => {
    state.creating = true
    state.error = ''
    render()
    try {
      const result = await apiFetch(options, '/demo', { method: 'POST', body: '{}' }) as { book: { id: string }; imported: number }
      state.notice = `示例项目已导入（含 ${result.imported} 条世界书设定）`
      await refreshProjects()
      await openProject(result.book.id)
    } catch (cause) {
      state.error = String(cause)
    } finally {
      state.creating = false
      render()
    }
  }
  /** 导入本地书籍文件：host 解析 txt/md → 建书 → 逐章写入，完成后打开新书。 */
  const importBook = async (fileName: string, content: string): Promise<void> => {
    if (!content.trim()) {
      state.error = '所选文件为空'
      render()
      return
    }
    if (content.length > 8_000_000) {
      state.error = '文件过大（超过 8MB），请拆分后导入'
      render()
      return
    }
    state.importing = true
    state.error = ''
    state.notice = ''
    render()
    try {
      const result = await apiFetch(options, '/import', {
        method: 'POST', body: JSON.stringify({ fileName, content }),
      }) as { bookId: string; title: string; chapterCount: number; totalWords: number; emptyChapters: number }
      state.notice = `已导入《${result.title}》：${result.chapterCount} 章 / ${result.totalWords} 字`
        + (result.emptyChapters > 0 ? `（含 ${result.emptyChapters} 个空章节占位）` : '')
      await refreshProjects()
      await openProject(result.bookId)
    } catch (cause) {
      state.error = String(cause)
    } finally {
      state.importing = false
      render()
    }
  }
  const writeChapter = async (): Promise<void> => {
    state.writing = true
    state.error = ''
    state.notice = ''
    render()
    try {
      const result = await apiFetch(options, `/projects/${state.selected}/chapters/${state.chapterNo}/write`, {
        method: 'POST', body: JSON.stringify({}),
      }) as { chapter: { no: number; words: number; version: number }; text: string }
      pushUndo(state.draft)
      setDraft(result.text)
      state.notice = `已自动保存：第 ${result.chapter.no} 章（${result.chapter.words} 字，版本 v${result.chapter.version}）`
      // 保持当前章：只刷新详情统计与当前章正文，不跳回第 1 章
      try {
        state.detail = await apiFetch(options, `/projects/${state.selected}`) as BookDetail
      } catch {
        // 详情刷新失败不阻断（列表统计仍会刷新）
      }
      await loadChapter(state.selected!, state.chapterNo)
      // 同步刷新列表统计（返回列表时卡片显示新章节数/字数）
      await refreshProjects()
    } catch (cause) {
      state.error = String(cause)
    } finally {
      state.writing = false
      render()
    }
  }
  /** 一键润色：AI 优化当前章节文笔（不改情节/人物/走向），结果入编辑区 + diff 标亮预览。 */
  const polishChapter = async (): Promise<void> => {
    const source = state.draft.trim()
    if (!source) {
      state.error = '当前章节没有可润色的内容'
      render()
      return
    }
    state.polishing = true
    state.error = ''
    state.notice = ''
    render()
    try {
      const result = await apiFetch(options, `/projects/${state.selected}/chapters/${state.chapterNo}/polish`, {
        method: 'POST', body: JSON.stringify({ text: state.draft }),
      }) as { original: string; polished: string }
      pushUndo(state.draft) // 润色前原文入撤销栈（可一键回退）
      state.polishPreview = { original: result.original, polished: result.polished }
      state.polishSuggestions = splitPolishSuggestions(result.original, result.polished)
      setDraft(result.polished) // 润色结果展示于编辑区
      state.notice = '润色完成：下方已按改动拆成多条建议，可逐条选择采纳；标出的只是真正改动处'
    } catch (cause) {
      state.error = String(cause)
    } finally {
      state.polishing = false
      render()
    }
  }
  /** 确认保存润色结果：把用户采纳的建议重组回正文落盘（保留采纳的部分）。 */
  const polishSave = async (): Promise<void> => {
    if (!state.polishPreview) return
    // 组织所采纳的建议；用户未逐条决定时默认全采纳（保持旧行为，避免误删）
    const suggestions = state.polishSuggestions.length > 0
      ? state.polishSuggestions
      : splitPolishSuggestions(state.polishPreview.original, state.polishPreview.polished)
    const text = applyPolishSuggestions(state.polishPreview.original, suggestions)
    state.polishBusy = true
    state.error = ''
    render()
    try {
      await apiFetch(options, `/projects/${state.selected}/chapters/${state.chapterNo}`, {
        method: 'POST', body: JSON.stringify({ title: `第 ${state.chapterNo} 章`, text }),
      })
      state.notice = `已保存润色结果：第 ${state.chapterNo} 章（采纳 ${suggestions.filter((s) => s.accepted).length} 条改动）`
      await loadChapter(state.selected!, state.chapterNo) // 重新加载已保存正文（清预览/撤销栈）
      await refreshProjects()
    } catch (cause) {
      state.error = String(cause)
    } finally {
      state.polishBusy = false
      render()
    }
  }
  /** 放弃润色：恢复用户原文，关闭预览面板。 */
  const polishDiscard = (): void => {
    if (!state.polishPreview) return
    setDraft(state.polishPreview.original)
    state.polishPreview = null
    state.polishSuggestions = []
    state.error = ''
    render()
  }
  /** 逐条切换某条建议的采纳状态。 */
  const polishToggle = (id: string): void => {
    state.polishSuggestions = state.polishSuggestions.map((s) => (s.id === id ? { ...s, accepted: !s.accepted } : s))
    state.error = ''
    render()
  }
  /** 全部采纳（仅有内容的建议默认采纳）。 */
  const polishAcceptAll = (): void => {
    state.polishSuggestions = state.polishSuggestions.map((s) => (s.polished.length > 0 ? { ...s, accepted: true } : s))
    state.error = ''
    render()
  }
  /** 全部拒绝（回到原文；保存时等于不采纳任何建议）。 */
  const polishRejectAll = (): void => {
    state.polishSuggestions = state.polishSuggestions.map((s) => ({ ...s, accepted: false }))
    setDraft(state.polishPreview?.original ?? state.draft)
    state.error = ''
    render()
  }
  const diagnose = async (): Promise<void> => {
    state.diagnosing = true
    state.error = ''
    render()
    try {
      state.report = (await apiFetch(options, `/projects/${state.selected}/diagnose/${state.chapterNo}`)) as DiagnoseResult
    } catch (cause) {
      state.error = String(cause)
    } finally {
      state.diagnosing = false
      render()
    }
  }
  /** 导出 txt：host 生成内容 → 浏览器 Blob 下载。 */
  const exportProject = async (): Promise<void> => {
    state.exporting = true
    state.error = ''
    render()
    try {
      const result = await apiFetch(options, `/projects/${state.selected}/export`, {
        method: 'POST', body: JSON.stringify({ format: 'txt' }),
      }) as { fileName: string; content: string }
      // Blob 下载（原生 DOM）
      const blob = new Blob(['\uFEFF' + result.content], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = result.fileName
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      state.notice = `已导出：${result.fileName}`
    } catch (cause) {
      state.error = String(cause)
    } finally {
      state.exporting = false
      render()
    }
  }
  /** 删除书籍（keepChapters=false 连同正文删除）。 */
  const deleteProject = async (keepChapters: boolean): Promise<void> => {
    if (!state.selected) return
    state.deleteState = 'busy'
    state.error = ''
    render()
    try {
      await apiFetch(options, `/projects/${state.selected}/delete`, {
        method: 'POST', body: JSON.stringify({ keepChapters }),
      })
      state.selected = null
      state.detail = null
      state.report = null
      state.deleteState = null
      state.notice = keepChapters ? '已删除书籍（正文已保留在 chapters/ 目录）' : '已删除书籍（连同正文）'
      await refreshProjects()
    } catch (cause) {
      state.error = String(cause)
      state.deleteState = null
    } finally {
      render()
    }
  }

  /** 世界书：加载条目列表 + 书映射，进入世界书视图。 */
  const openLorebook = async (): Promise<void> => {
    state.view = 'lorebook'
    state.error = ''
    state.notice = ''
    render()
    try {
      const [entries, projectsList] = await Promise.all([
        apiFetch(options, '/lorebook/entries') as Promise<LoreEntryView[]>,
        apiFetch(options, '/projects') as Promise<ProjectSummary[]>,
      ])
      state.loreEntries = entries
      state.projects = projectsList
      const map: Record<string, string> = {}
      for (const p of projectsList) map[p.id] = p.title
      state.bookMap = map
    } catch (cause) {
      state.error = String(cause)
    }
    render()
  }
  /** 读取世界书表单当前值（原生 input/checkbox 已写回 state 或从 DOM 取）。 */
  const loreFormPayload = (): { name: string; content: string; keywords: string; always_active: boolean; enabled: boolean; priority: number; book_id: string } => {
    const val = (id: string): string => (document.getElementById(id) as HTMLInputElement | null)?.value ?? ''
    const checked = (id: string): boolean => (document.getElementById(id) as HTMLInputElement | null)?.checked ?? false
    const priority = Number(val('lore-priority')) || 50
    const bookId = (document.getElementById('lore-book') as HTMLSelectElement | null)?.value ?? ''
    return {
      name: val('lore-name').trim(),
      content: val('lore-content'),
      keywords: val('lore-keywords'),
      always_active: checked('lore-always'),
      enabled: checked('lore-enabled'),
      priority,
      book_id: bookId === '__global__' ? '' : bookId,
    }
  }
  const loreSave = async (): Promise<void> => {
    const payload = loreFormPayload()
    if (!payload.name || !payload.content.trim()) {
      state.error = '名称与内容不能为空'
      render()
      return
    }
    state.loreBusy = true
    state.error = ''
    render()
    try {
      if (state.loreForm.mode === 'edit' && state.loreForm.id) {
        await apiFetch(options, `/lorebook/entries/${state.loreForm.id}/update`, { method: 'POST', body: JSON.stringify(payload) })
      } else {
        await apiFetch(options, '/lorebook/entries', { method: 'POST', body: JSON.stringify(payload) })
      }
      state.loreForm = emptyLoreForm()
      await openLorebook()
    } catch (cause) {
      state.error = String(cause)
    } finally {
      state.loreBusy = false
      render()
    }
  }
  const loreEdit = (id: string): void => {
    const entry = state.loreEntries.find((e) => e.id === id)
    if (!entry) return
    state.loreForm = {
      mode: 'edit', id,
      name: entry.name,
      content: entry.content,
      keywords: entry.keywords.join(', '),
      alwaysActive: entry.always_active,
      enabled: entry.enabled,
      priority: String(entry.priority),
      bookId: entry.book_id,
    }
    state.error = ''
    render()
  }
  const loreDelete = async (id: string): Promise<void> => {
    state.loreBusy = true
    state.error = ''
    render()
    try {
      await apiFetch(options, `/lorebook/entries/${id}/delete`, { method: 'POST', body: '{}' })
      await openLorebook()
    } catch (cause) {
      state.error = String(cause)
    } finally {
      state.loreBusy = false
      render()
    }
  }
  const loreToggle = async (id: string): Promise<void> => {
    try {
      await apiFetch(options, `/lorebook/entries/${id}/toggle`, { method: 'POST', body: '{}' })
      await openLorebook()
    } catch (cause) {
      state.error = String(cause)
      render()
    }
  }
  /** AI 一键生成世界书设定：host 按当前栏目书籍生成 4-6 条并写入本书栏目。 */
  const loreAutogen = async (): Promise<void> => {
    const bookId = state.loreFilter
    if (!bookId || bookId === 'all' || bookId === '__global__') {
      state.error = '请先在「栏目」下拉选择一本书，AI 才知道按哪本书生成设定'
      render()
      return
    }
    state.loreAutogenBusy = true
    state.error = ''
    state.notice = ''
    render()
    try {
      const result = await apiFetch(options, `/lorebook/generate/${bookId}`, {
        method: 'POST', body: '{}',
      }) as { created: number; entries: Array<{ name: string }> }
      const names = result.entries.map((e) => e.name).join('、')
      state.notice = `AI 已为《${state.bookMap[bookId] ?? bookId}》生成并写入 ${result.created} 条设定：${names}`
      await openLorebook()
    } catch (cause) {
      state.error = String(cause)
    } finally {
      state.loreAutogenBusy = false
      render()
    }
  }

  const dispatch = (action: string, id?: string): void => {
    switch (action) {
      case 'open': void openProject(id ?? ''); break
      case 'create': void createProject(); break
      case 'demo': void importDemo(); break
      case 'import-file': importFileInput?.click(); break
      case 'expand':
        state.expanded = !state.expanded
        render()
        // 两次收敛：第一次用旧尺寸检测，第二次用新尺寸（width 变化影响重叠判定）
        applySize()
        applySize()
        break
      case 'lorebook': void openLorebook(); break
      case 'go-lorebook':
        // 从项目详情跳世界书，并过滤到本书栏目
        {
          const bookId = state.selected
          state.selected = null
          state.detail = null
          state.loreFilter = bookId ?? 'all'
          void openLorebook()
        }
        break
      case 'open-lore':
        // 跳转本书世界书（详情页/列表卡片：data-id=书 id）
        {
          const bookId = id
          if (!bookId) break
          state.selected = null
          state.detail = null
          state.report = null
          state.deleteState = null
          state.loreFilter = bookId
          void openLorebook()
        }
        break
      case 'lore-back':
        state.view = 'projects'
        state.loreForm = emptyLoreForm()
        state.selected = null
        state.detail = null
        render()
        void refreshProjects()
        break
      case 'lore-new':
        state.loreForm = emptyLoreForm()
        state.loreForm.mode = 'new'
        state.error = ''
        render()
        break
      case 'lore-edit': loreEdit(id ?? ''); break
      case 'lore-save': void loreSave(); break
      case 'lore-cancel':
        state.loreForm = emptyLoreForm()
        state.error = ''
        render()
        break
      case 'lore-delete': if (id) void loreDelete(id); break
      case 'lore-toggle': if (id) void loreToggle(id); break
      case 'lore-autogen': void loreAutogen(); break
      case 'back':
        // 返回列表：先刷新列表统计（写章后的章节数/字数要在卡片上生效）
        state.selected = null
        state.detail = null
        state.report = null
        state.deleteState = null
        render()
        void refreshProjects()
        break
      case 'refresh': void (state.selected ? openProject(state.selected) : refreshProjects()); break
      case 'write': void writeChapter(); break
      case 'polish': void polishChapter(); break
      case 'polish-save': void polishSave(); break
      case 'polish-discard': polishDiscard(); break
      case 'polish-toggle': if (id) polishToggle(id); break
      case 'polish-accept-all': polishAcceptAll(); break
      case 'polish-reject-all': polishRejectAll(); break
      case 'undo': undo(); break
      case 'diagnose': void diagnose(); break
      case 'export': void exportProject(); break
      case 'delete': state.deleteState = 'confirm'; render(); break
      case 'delete-keep': void deleteProject(true); break
      case 'delete-all': void deleteProject(false); break
      case 'delete-cancel': state.deleteState = null; render(); break
    }
  }

  const ensureMounted = (): void => {
    if (rootEl) return
    const el = document.createElement('div')
    el.style.cssText = [
      'position:fixed', 'top:0', 'right:0', 'bottom:0', 'width:380px',
      'background:#fff', 'boxShadow:-4px 0 16px rgba(0,0,0,.15)',
      'zIndex:2147483647',
      'display:flex', 'flexDirection:column', 'overflow:hidden',
      'fontFamily:system-ui,sans-serif',
      'transform:translateX(100%)', 'transition:transform .18s ease,width .18s ease',
    ].join(';')
    document.body.appendChild(el)
    rootEl = el
    applySize()

    // ── 原生事件代理（click / input / change 全走原生，不依赖 React 合成事件）──
    el.addEventListener('click', (event) => {
      const target = event.target as HTMLElement
      const actionEl = target.closest<HTMLElement>('[data-action]')
      if (actionEl) {
        const id = actionEl.dataset.id
        dispatch(actionEl.dataset.action ?? '', id)
        return
      }
      // 非 action 点击：仅用于记录（debug）
      console.debug('[novel-writer] click', target.tagName)
    })
    el.addEventListener('input', (event) => {
      const target = event.target as HTMLInputElement | HTMLTextAreaElement
      // 仅记录 state，不 render（非受控输入框，render 会打断输入）
      if (target.id === 'novel-title') {
        state.title = target.value
      } else if (target.id === 'novel-draft') {
        const previous = state.draft
        state.draft = target.value
        state.draftModified = state.draft !== state.baseline
        // 撤销可用性即时同步（原生操作按钮，不 render 避免打断输入）
        syncUndoButton()
        // 撤销快照防抖：停顿 800ms 记一次（连续打字不刷栈；首次撤销由 baseline 兜底）
        if (undoTimer !== null) {
          clearTimeout(undoTimer)
          undoTimer = null
        }
        undoTimer = window.setTimeout(() => { pushUndo(previous) }, 800)
      }
    })
    el.addEventListener('change', (event) => {
      const target = event.target as HTMLSelectElement
      if (target.id === 'novel-genre') {
        state.genre = target.value
      } else if (target.id === 'novel-chapter') {
        state.chapterNo = Number(target.value)
        // 切章：加载该章已保存正文
        if (state.selected) void loadChapter(state.selected, state.chapterNo)
      } else if (target.id === 'lore-filter') {
        state.loreFilter = target.value
        render()
      }
    })

    // ── 本地书籍导入：原生隐藏 file input（React 合成事件不可靠，走原生 change）──
    importFileInput = document.createElement('input')
    importFileInput.type = 'file'
    importFileInput.accept = '.txt,.md,text/plain,text/markdown'
    importFileInput.style.display = 'none'
    importFileInput.addEventListener('change', () => {
      const file = importFileInput?.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        const text = typeof reader.result === 'string' ? reader.result : ''
        void importBook(file.name, text)
      }
      reader.readAsText(file, 'utf-8')
      // 允许重复选择同一文件（change 需值变化才触发）
      if (importFileInput) importFileInput.value = ''
    })
    // 挂 body（createRoot 首次 render 会清空容器子节点，不能挂在抽屉容器内）
    document.body.appendChild(importFileInput)

    // ── 焦点/输入对照实验（定位"输入框不可输入"）──
    // 1) 原生 input（完全不经 React）：验证 el 内输入焦点是否被宿主拦截（挂 body 防被 React 清空；视觉隐藏）
    const nativeTest = document.createElement('input')
    nativeTest.id = 'novel-native-test'
    nativeTest.placeholder = '①原生输入测试（不经React）'
    nativeTest.style.cssText = 'position:fixed;left:8px;bottom:48px;width:220px;boxSizing:border-box;padding:6px;border:1px solid #29a;borderRadius:4px;zIndex:2147483647;opacity:0;'
    nativeTest.addEventListener('focus', () => { document.title = 'FOCUS-NATIVE' })
    nativeTest.addEventListener('input', () => { document.title = `INPUT-NATIVE:${nativeTest.value.slice(0, 8)}` })
    document.body.appendChild(nativeTest)
    // 2) React 输入框的聚焦诊断
    el.addEventListener('focusin', (event) => {
      const target = event.target as HTMLElement
      if (target.id === 'novel-title') document.title = 'FOCUS-REACT-TITLE'
      else if (target.id === 'novel-draft') document.title = 'FOCUS-REACT-DRAFT'
    }, true)
    el.addEventListener('input', (event) => {
      const target = event.target as HTMLElement
      if (target.id === 'novel-title') document.title = 'INPUT-REACT-TITLE'
    }, true)

    // body 级状态徽标（共存锚点；无害）——视觉隐藏（opacity:0）：
    // 元素必须保留在 DOM（实测与抽屉内 React 渲染正常化相关，机理未明），
    // 但不再显示；诊断信息仍写入 textContent，排查时可临时改回 opacity:1。
    badgeEl = document.createElement('div')
    badgeEl.style.cssText = [
      'position:fixed', 'left:8px', 'top:8px', 'zIndex:2147483647',
      'background:#111', 'color:#fff', 'fontSize:11px', 'padding:4px 8px',
      'borderRadius:6px', 'fontFamily:monospace', 'pointerEvents:none',
      'opacity:0',
    ].join(';')
    badgeEl.textContent = '小说工坊 ✓'
    document.body.appendChild(badgeEl)

    root = createRoot(el)
    render()
    // 展开宽度/底部避让随窗口变化重算（防抖）+ 宿主 DOM 动态变化重算
    window.addEventListener('resize', onResize)
    ensureObserver()
    void refreshProjects()
  }

  /** 扫描与抽屉矩形有实际重叠的 fixed 覆盖元素（宿主聊天条/侧栏等）。 */
  const detectOverlays = (): Array<{ rect: DOMRect; z: number }> => {
    if (!rootEl) return []
    const drawerRect = rootEl.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const out: Array<{ rect: DOMRect; z: number }> = []
    const candidates = document.querySelectorAll<HTMLElement>('header, footer, nav, aside, main, section, form, div, textarea, button, ul, ol')
    for (const el of candidates) {
      if (el === rootEl || el === badgeEl || el.id === 'novel-native-test' || el === importFileInput) continue
      if (el.offsetHeight < 4 || el.offsetWidth < 4) continue
      const style = getComputedStyle(el)
      if (style.position !== 'fixed') continue
      const rect = el.getBoundingClientRect()
      // 与抽屉有实际重叠（水平 + 垂直均 >8px）
      const overlapW = Math.min(drawerRect.right, rect.right) - Math.max(drawerRect.left, rect.left)
      const overlapH = Math.min(drawerRect.bottom, rect.bottom) - Math.max(drawerRect.top, rect.top)
      if (overlapW <= 8 || overlapH <= 8) continue
      // 基本可见性：元素主体在视口内
      if (rect.left >= vw || rect.right <= 0 || rect.top >= vh || rect.bottom <= 0) continue
      const z = Number.parseInt(style.zIndex, 10)
      out.push({ rect, z: Number.isFinite(z) ? z : 0 })
    }
    return out
  }

  /**
   * 应用抽屉尺寸与层级（每次展开/收起/窗口变化/宿主 DOM 变化时调用）：
   *  - 底部横条 → 抽屉 bottom 抬到条顶之上（物理不重叠）
   *  - 全高右侧竖条（聊天侧栏等）→ 抽屉右移，露出条自身（避免同层覆盖）
   *  - z-index 动态提升到比所有重叠元素高 1 级
   *  - 角标显示避让诊断（便于用户反馈定位）
   */
  const applySize = (): void => {
    if (!rootEl) return
    const vh = window.innerHeight
    const overlays = detectOverlays()
    let bottomNeed = 0
    let rightNeed = 0
    let maxZ = 0
    for (const overlay of overlays) {
      if (overlay.z > maxZ) maxZ = overlay.z
      const isTall = overlay.rect.height > vh * 0.6
      const nearBottom = overlay.rect.bottom >= vh - 24
      if (nearBottom && !isTall) {
        // 底部横条：抽屉底边让到条顶上方
        const need = vh - overlay.rect.top
        if (need > bottomNeed) bottomNeed = need
      }
      if (isTall) {
        // 全高竖条（聊天侧栏）：若其右缘与抽屉右缘相邻 → 抽屉左移露出条
        if (overlay.rect.right >= rootEl.getBoundingClientRect().right - 8) {
          if (overlay.rect.width > rightNeed) rightNeed = overlay.rect.width
        }
      }
    }
    const { width, bottom } = drawerSize(state.expanded, window.innerWidth, bottomNeed)
    rootEl.style.width = `${width}px`
    rootEl.style.bottom = `${bottom}px`
    rootEl.style.right = rightNeed > 0 ? `${rightNeed + 8}px` : '0px'
    const targetZ = maxZ > 0 ? Math.min(2147483647, maxZ + 1) : 2147483647
    rootEl.style.zIndex = String(targetZ)
    // 角标诊断（badge，pointerEvents:none 不影响交互）
    if (badgeEl) {
      badgeEl.textContent = overlays.length > 0
        ? `小说工坊 ✓ 避让:底${bottom}px 右${rightNeed}px 重叠${overlays.length} z${targetZ}`
        : '小说工坊 ✓'
    }
  }

  /** resize 防抖重算（避免连续触发）。 */
  let resizeTimer: number | null = null
  const onResize = (): void => {
    if (resizeTimer !== null) clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(() => {
      resizeTimer = null
      applySize()
    }, 200)
  }

  /** 宿主 DOM 动态变化（聊天条后插入/重渲染）时防抖重算。 */
  let observer: MutationObserver | null = null
  const ensureObserver = (): void => {
    if (observer) return
    observer = new MutationObserver(() => {
      if (resizeTimer !== null) clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(() => {
        resizeTimer = null
        applySize()
      }, 300)
    })
    observer.observe(document.body, { childList: true, subtree: true })
  }

  const applyOpen = (): void => {
    if (rootEl) rootEl.style.transform = open ? 'translateX(0)' : 'translateX(100%)'
  }

  return {
    toggle(): void {
      ensureMounted()
      open = !open
      applyOpen()
      applySize()
    },    dispose(): void {
      if (undoTimer !== null) {
        clearTimeout(undoTimer)
        undoTimer = null
      }
      if (resizeTimer !== null) {
        clearTimeout(resizeTimer)
        resizeTimer = null
      }
      observer?.disconnect()
      observer = null
      window.removeEventListener('resize', onResize)
      root?.unmount()
      root = null
      if (rootEl) rootEl.remove()
      rootEl = null
      if (badgeEl) badgeEl.remove()
      badgeEl = null
      if (importFileInput) {
        importFileInput.remove()
        importFileInput = null
      }
      document.getElementById('novel-native-test')?.remove()
    },
  }
}
