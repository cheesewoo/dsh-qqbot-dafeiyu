import type { Context } from '@deepseek-ai/cordis';
import type { ChatScope, Logger, ReplyTarget } from '../types.js';
import type { ImQQBotConfig } from '../config.js';
import type { ModelRoute, ModelEntry } from '../model/types.js';
import type { DshAgent, DshAgentRegistry, SessionRecord, SessionStatus, TokenUsageStats } from './types.js';
export declare class SessionManager {
    private readonly ctx;
    private readonly agents;
    private readonly config;
    private readonly logger;
    private sessions;
    private readonly evictor;
    private readonly modelResolver;
    constructor(ctx: Context, agents: DshAgentRegistry, config: ImQQBotConfig, logger: Logger);
    /**
     * 动态获取 sessions 服务（fork 能力，可选）
     */
    private getSessionsService;
    getEffectiveModel(scope: ChatScope, peerId: string): ModelRoute | undefined;
    /**
     * 切换模型（fork + 重建，对齐 dsh-TUI 的 switchModel）
     */
    setModelOverride(scope: ChatScope, peerId: string, route: ModelRoute): Promise<void>;
    clearModelOverride(scope: ChatScope, peerId: string): void;
    listAvailableModels(): ModelEntry[];
    listProviders(): string[];
    getSessionRecord(scope: ChatScope, peerId: string): SessionRecord | undefined;
    getStatus(scope: ChatScope, peerId: string): SessionStatus;
    getTokenUsage(scope: ChatScope, peerId: string): TokenUsageStats;
    exportMarkdown(scope: ChatScope, peerId: string): string;
    private countMessages;
    private sessionKey;
    private deriveSessionId;
    private currentSessionId;
    private composePreset;
    /** 获取或恢复或创建会话（get → resume → create） */
    getOrCreate(scope: ChatScope, peerId: string, senderId: string, replyTarget: ReplyTarget): Promise<SessionRecord>;
    findBySessionId(sessionId: string): SessionRecord | undefined;
    findByAgent(agent: DshAgent): SessionRecord | undefined;
    remove(scope: ChatScope, peerId: string): Promise<void>;
    disposeAll(): Promise<void>;
    get size(): number;
}
//# sourceMappingURL=session-manager.d.ts.map