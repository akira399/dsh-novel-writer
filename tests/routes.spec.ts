import { describe, expect, it } from 'vitest'
import { parseNovelPath } from '../src/routes.ts'

describe('routes — path parsing', () => {
  it('parses the projects list', () => {
    const parsed = parseNovelPath('/api/novel-writer/projects')
    expect(parsed.segments).toEqual(['projects'])
    expect(parsed.projectId).toBeUndefined()
  })

  it('parses project detail', () => {
    const parsed = parseNovelPath('/api/novel-writer/projects/bk_abc123')
    expect(parsed.projectId).toBe('bk_abc123')
    expect(parsed.section).toBeUndefined()
  })

  it('parses chapter read/write', () => {
    const parsed = parseNovelPath('/api/novel-writer/projects/bk_abc123/chapters/3')
    expect(parsed.projectId).toBe('bk_abc123')
    expect(parsed.section).toBe('chapters')
    expect(parsed.noText).toBe('3')
  })

  it('parses diagnose and context (regression: destructuring offset)', () => {
    const diagnose = parseNovelPath('/api/novel-writer/projects/bk_abc123/diagnose/1')
    expect(diagnose.projectId).toBe('bk_abc123')
    expect(diagnose.section).toBe('diagnose')
    expect(diagnose.noText).toBe('1')

    const context = parseNovelPath('/api/novel-writer/projects/bk_abc123/context/2')
    expect(context.projectId).toBe('bk_abc123')
    expect(context.section).toBe('context')
    expect(context.noText).toBe('2')
  })

  it('parses the demo import route', () => {
    const parsed = parseNovelPath('/api/novel-writer/demo')
    expect(parsed.segments).toEqual(['demo'])
  })

  it('handles undefined and foreign paths', () => {
    expect(parseNovelPath(undefined).segments).toEqual([])
    expect(parseNovelPath('/api/other/x').segments).toEqual([])
  })
})
