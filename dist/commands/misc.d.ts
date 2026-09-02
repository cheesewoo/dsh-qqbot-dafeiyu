/**
 * 杂项命令：/ping /version /stop
 */
import type { SlashCommand } from '@tencent-connect/qqbot-nodejs';
import type { CommandDeps } from './types.js';
/** /bot-ping — 连通性测试 */
export declare function pingCommand(): SlashCommand;
/** /bot-version — 查看版本信息 */
export declare function versionCommand({ manager }: CommandDeps): SlashCommand;
/** /bot-stop — 中止当前生成（隐藏） */
export declare function stopCommand(): SlashCommand;
//# sourceMappingURL=misc.d.ts.map