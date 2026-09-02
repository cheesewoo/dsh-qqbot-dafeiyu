/**
 * 会话相关命令：/bot-reset /bot-clear /bot-new
 */
import type { SlashCommand } from '@tencent-connect/qqbot-nodejs';
import type { CommandDeps } from './types.js';
/** /bot-reset /bot-clear — 重置当前会话 */
export declare function resetCommand({ manager }: CommandDeps): SlashCommand;
/** /bot-new — 开始新会话 */
export declare function newCommand({ manager }: CommandDeps): SlashCommand;
//# sourceMappingURL=session.d.ts.map