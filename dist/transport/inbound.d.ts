import type { SessionManager } from '../session/index.js';
import type { ImQQBotConfig } from '../config.js';
import type { Logger } from '../types.js';
/**
 * 处理 QQ 入站消息（已经过 SDK 中间件链）
 */
export declare function handleInbound(rawMsg: unknown, manager: SessionManager, config: ImQQBotConfig, logger: Logger, state?: Record<string, unknown>): Promise<void>;
//# sourceMappingURL=inbound.d.ts.map