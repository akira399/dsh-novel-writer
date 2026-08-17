/**
 * @dsh-external/dsh-novel-writer — client 半区类型声明（手写维护）。
 * client bundle 由 tsdown 打包为 CJS + ModuleLoader.load banner（lib/client.js），
 * 类型面极小（一个 apply），此文件随包发布供 `exports["./client"]` 引用。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

/** 宿主服务注入（按需声明；骨架阶段为空）。 */
export declare const inject: string[]

/** client 半区装配入口（由 web shell 经 __ModuleLoader__ 调用）。 */
export declare function apply(ctx: ClientContext): void
