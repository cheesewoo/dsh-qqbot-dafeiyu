/**
 * dsh-im-qqbot — QQ Bot IM channel plugin for deepseek-harness
 *
 * Cordis 插件入口。将 QQ 消息平台作为 dsh 的前端协议驱动。
 * 网关组装（中间件编排 + 事件 + 出站 + 生命周期）见 src/gateway/。
 */
import type { Context } from '@deepseek-ai/cordis';
import { type ImQQBotConfig } from './config.js';
export declare const name = "im-qqbot";
export declare const inject: string[];
export declare const Config: import("@deepseek-ai/schemastery").default<ImQQBotConfig>;
export type { ImQQBotConfig } from './config.js';
export declare function apply(ctx: Context, config: ImQQBotConfig): Promise<void>;
//# sourceMappingURL=index.d.ts.map