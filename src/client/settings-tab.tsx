/**
 * dsh-novel-writer — 设置页签（DSH 0.2.0-rc.2 适配）。
 *
 * 0.1.x 时代设置卡注册进 `settings.plugin.item`，该 slot 在 0.2.0 已不存在，
 * 卡片因此静默不渲染。0.2.0 的正规位置是 Plugins 设置区的页签
 * （`settings.plugins.tab`），配置读写走 `ctx.configForms.get(entryId)`
 * 返回的 `ConfigForm`（读走快照，写走 set/unset，带 revision 围栏）。
 *
 * 降级策略：configForms 不可用（namespace 未暴露 / memory 模式）时只渲染
 * 浏览器本地的「隐藏侧边栏入口」开关，绝不抛出——保护 web shell boot。
 */
import React from 'react'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import { readUiHidden, writeUiHidden } from './ui-hidden.ts'

/** 配置表单值形状（与 host 的 Config schema 对应）。 */
interface SettingsShape {
  enabled?: boolean
  dataDir?: string
  uiHidden?: boolean
}

export interface NovelSettingsTabProps {
  /** profile entry 的配置表单；namespace 未暴露时为 undefined。 */
  form?: ConfigForm<SettingsShape> | undefined
}

const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '8px' }
const columnStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '4px' }
const inputStyle: React.CSSProperties = { padding: '4px 6px', border: '1px solid #ccc', borderRadius: '4px' }
const buttonStyle: React.CSSProperties = { padding: '4px 12px', borderRadius: '4px', border: '1px solid #888', cursor: 'pointer' }

/** 大肥鱼的小说工坊 — 设置页签。 */
export function NovelSettingsTab({ form }: NovelSettingsTabProps): React.ReactNode {
  const subscribe = React.useCallback(
    (listener: () => void) => form?.subscribe(listener) ?? (() => {}),
    [form],
  )
  const read = React.useCallback(() => form?.getSnapshot(), [form])
  const snapshot = React.useSyncExternalStore(subscribe, () => read(), () => undefined)

  // 本地「摸鱼模式」开关：不依赖 host settings 可达性
  const [uiHidden, setUiHidden] = React.useState<boolean>(() => readUiHidden())
  const [draftDir, setDraftDir] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)

  const value = snapshot?.value
  const status = snapshot?.status ?? 'unavailable'
  const writable = snapshot?.writable === true
  const enabled = value?.enabled ?? true
  const dataDir = draftDir ?? value?.dataDir ?? ''

  const flash = (text: string): void => {
    setNotice(text)
    window.setTimeout(() => setNotice(null), 1500)
  }

  const onToggleEnabled = (next: boolean): void => {
    if (!form) return
    void form.set('enabled', next).then((ok) => {
      if (!ok) flash('写入被拒绝')
    })
  }

  const saveDataDir = (): void => {
    if (!form) return
    const next = dataDir.trim()
    void (next ? form.set('dataDir', next) : form.unset('dataDir')).then((ok) => {
      setDraftDir(null)
      flash(ok ? '已保存' : '写入被拒绝')
    })
  }

  const onToggleHidden = (next: boolean): void => {
    setUiHidden(next)
    writeUiHidden(next) // localStorage + 派发事件 → 侧边栏入口即时增删
    // host settings 可用时同步一份，便于跨设备一致
    if (form) void form.set('uiHidden', next)
  }

  const hiddenToggle = React.createElement(
    'label',
    { style: rowStyle },
    React.createElement('input', {
      type: 'checkbox',
      checked: uiHidden,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => onToggleHidden(e.target.checked),
    }),
    '隐藏侧边栏入口（摸鱼模式）',
  )

  // 降级：host 配置命名空间不可达时只给本地开关
  if (!form || status === 'unavailable') {
    return React.createElement(
      'div',
      { style: { ...columnStyle, padding: '12px', fontSize: '13px' } },
      React.createElement('div', { style: { fontWeight: 600 } }, '大肥鱼的小说工坊'),
      React.createElement(
        'div',
        { style: { opacity: 0.7 } },
        '宿主配置命名空间不可用：请在 profile 的 cordis.patch.yml 中配置 dsh-novel-writer 条目。',
      ),
      hiddenToggle,
    )
  }

  return React.createElement(
    'div',
    { style: { ...columnStyle, padding: '12px', fontSize: '13px' } },
    React.createElement('div', { style: { fontWeight: 600 } }, '大肥鱼的小说工坊'),
    React.createElement(
      'label',
      { style: rowStyle },
      React.createElement('input', {
        type: 'checkbox',
        checked: enabled,
        disabled: !writable,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => onToggleEnabled(e.target.checked),
      }),
      '启用（世界书注入 / 创作工具 / 技能）',
    ),
    React.createElement(
      'label',
      { style: columnStyle },
      '数据目录',
      React.createElement('input', {
        type: 'text',
        value: dataDir,
        disabled: !writable,
        placeholder: '默认 ~/.dsh/dsh-novel-writer',
        style: inputStyle,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraftDir(e.target.value),
      }),
    ),
    hiddenToggle,
    React.createElement(
      'div',
      { style: { ...rowStyle, gap: '8px' } },
      React.createElement(
        'button',
        { type: 'button', onClick: saveDataDir, disabled: !writable, style: buttonStyle },
        '保存数据目录',
      ),
      notice !== null ? React.createElement('span', { style: { color: '#2a7' } }, notice) : null,
      status === 'loading' ? React.createElement('span', { style: { opacity: 0.6 } }, '加载中…') : null,
    ),
  )
}
