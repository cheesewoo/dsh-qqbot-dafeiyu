/**
 * 出站处理器 — dsh session/event → QQ 消息发送
 *
 * 采用路由器模式：OutboundRouter 持有会话级状态（文本缓冲、工具调用记录），
 * 事件解析归一化在 events.ts，路由按事件类型分发到私有方法。
 */
import type { SessionManager } from '../session/index.js';
import type { ImQQBotConfig } from '../config.js';
import type { Logger } from '../types.js';
import { type QQBotSender } from './outbound-buffer.js';
import { type ToolsRegistryLike } from './tool-presenter.js';
import { type RawSessionEvent } from './events.js';
export type { QQBotSender } from './outbound-buffer.js';
export type { ToolsRegistryLike } from './tool-presenter.js';
/** 出站处理器签名（注册到 ctx.on('session/event')） */
export type OutboundHandler = (session: SessionLike, event: RawSessionEvent) => void;
/** dsh Session 简化类型 */
export interface SessionLike {
    header: {
        id: string;
    };
}
/**
 * 创建出站事件处理器
 *
 * 返回一个 handler 函数，应注册到 ctx.on('session/event', handler)。
 * toolsRegistry 用于工具结果的结构化展示（参考 dsh-TUI 的 presentResult）。
 */
export declare function createOutboundHandler(manager: SessionManager, bot: QQBotSender, config: ImQQBotConfig, logger: Logger, toolsRegistry?: ToolsRegistryLike): OutboundHandler;
//# sourceMappingURL=outbound.d.ts.map