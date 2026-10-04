/**
 * @dsh-external/dsh-novel-writer — client 半区类型声明（手写维护）。
 * client bundle 由 tsdown 打包为 CJS + ModuleLoader.load banner（lib/client.js），
 * 类型面极小（apply + inject），此文件随包发布供 `exports["./client"]` 引用。
 *
 * DSH 0.2.0-rc.2：`@deepseek-ai/dsh-client-runtime` 已不存在，客户端半区改为
 * 普通 cordis Context + 各客户端包的 declaration merging。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'

/** 客户端半区所需服务（slots 提供 slot 注册；configForms 提供设置表单）。 */
export declare const inject: string[]

/** client 半区装配入口（由 web shell 经 __ModuleLoader__ 调用）。 */
export declare function apply(ctx: Context): void
