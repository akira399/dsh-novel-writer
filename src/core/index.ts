/**
 * dsh-novel-writer — core 域聚合导出。
 * 模块间引用统一走本入口（`import { ... } from '../core/index.ts'`），
 * 避免深层相对路径散落。
 */
export * from './types.ts'
export * from './util.ts'
export * from './genres.ts'
export * from './importer/index.ts'
