/**
 * dsh-novel-writer — 设置卡（P1-I）。
 * 读写 settingsScope（host 设置：启用/数据目录）+ 浏览器端「隐藏侧边栏入口」
 * （localStorage，见 ui-hidden.ts）——该开关不依赖 host settings 是否暴露。
 */
import React, { useEffect, useState } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import { readUiHidden, writeUiHidden } from './ui-hidden.ts'

export interface NovelSettingsCardProps {
  scope: SettingsScope<{ enabled: boolean; dataDir: string; uiHidden: boolean }>
}

/** 最小设置卡：启用开关 + 数据目录（host）+ 隐藏入口（摸鱼，localStorage）。 */
export function NovelSettingsCard({ scope }: NovelSettingsCardProps): React.ReactNode {
  const snapshot = scope.getSnapshot()
  const ready = snapshot.status === 'ready' && snapshot.value !== undefined
  const [enabled, setEnabled] = useState<boolean>(snapshot.value?.enabled ?? true)
  const [dataDir, setDataDir] = useState<string>(snapshot.value?.dataDir ?? '')
  const [uiHidden, setUiHidden] = useState<boolean>(readUiHidden())
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => scope.subscribe(() => {
    const next = scope.getSnapshot()
    if (next.status === 'ready' && next.value !== undefined) {
      setEnabled(next.value.enabled)
      setDataDir(next.value.dataDir ?? '')
    }
  }), [scope])

  const onToggleHidden = (value: boolean): void => {
    setUiHidden(value)
    writeUiHidden(value) // localStorage + 派发事件 → 侧边栏入口即时增删
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      await scope.set('enabled', enabled)
      await scope.set('dataDir', dataDir)
      await scope.set('uiHidden', uiHidden)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } catch {
      setSaved(false)
    } finally {
      setSaving(false)
    }
  }

  // 隐藏开关（不依赖 host settings，任何环境可用）
  const hiddenToggle = React.createElement(
    'label',
    { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
    React.createElement('input', {
      type: 'checkbox',
      checked: uiHidden,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => onToggleHidden(e.target.checked),
    }),
    '隐藏侧边栏入口',
  )

  // host settings 不可用（命名空间未暴露 / memory 模式）：降级为纯本地开关，不让用户卡住
  if (!ready) {
    return React.createElement(
      'div',
      { style: { padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' } },
      React.createElement('div', { style: { fontWeight: 600 } }, '大肥鱼的小说工坊'),
      hiddenToggle,
    )
  }

  return React.createElement(
    'div',
    { style: { padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' } },
    React.createElement('div', { style: { fontWeight: 600 } }, '大肥鱼的小说工坊'),
    React.createElement(
      'label',
      { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
      React.createElement('input', {
        type: 'checkbox',
        checked: enabled,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setEnabled(e.target.checked),
      }),
      '启用（世界书注入 / 创作工具 / 技能）',
    ),
    React.createElement(
      'label',
      { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
      '数据目录',
      React.createElement('input', {
        type: 'text',
        value: dataDir,
        placeholder: '默认 ~/.dsh/dsh-novel-writer',
        style: { padding: '4px 6px', border: '1px solid #ccc', borderRadius: '4px' },
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDataDir(e.target.value),
      }),
    ),
    hiddenToggle,
    React.createElement(
      'div',
      { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
      React.createElement(
        'button',
        {
          onClick: () => void save(),
          disabled: saving,
          style: { padding: '4px 12px', borderRadius: '4px', border: '1px solid #888', cursor: 'pointer' },
        },
        saving ? '保存中…' : '保存',
      ),
      saved ? React.createElement('span', { style: { color: '#2a7' } }, '已保存') : null,
    ),
  )
}
