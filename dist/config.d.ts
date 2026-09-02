/**
 * dsh-im-qqbot 插件配置 Schema
 */
import Schema from '@deepseek-ai/schemastery';
export interface AccessControlConfig {
    /** C2C 访问模式 */
    c2cMode: 'open' | 'allowlist' | 'disabled';
    /** C2C 白名单（user openid） */
    c2cAllow: string[];
    /** 群聊访问模式 */
    groupMode: 'open' | 'allowlist' | 'disabled';
    /** 群聊白名单（group openid） */
    groupAllow: string[];
}
export interface ImQQBotConfig {
    /** QQ Bot AppID */
    appId: string;
    /** QQ Bot AppSecret */
    appSecret: string;
    /** dsh LLM 提供商名称 */
    provider?: string;
    /** 模型名称 */
    model?: string;
    /** Agent preset id */
    preset?: string;
    /** Agent 工作目录（缺省回落到进程 cwd） */
    cwd?: string;
    /** 是否启用群消息 @mention 门控 */
    requireMention: boolean;
    /** 群聊额外 system prompt */
    groupPrompt?: string;
    /** 私聊额外 system prompt */
    directPrompt?: string;
    /** 单条消息最大长度（QQ 限制约 5000 字符） */
    textChunkLimit: number;
    /** 是否启用流式输出（群聊始终不启用） */
    streaming: boolean;
    /** 每会话最大闲置时长(ms)，超时自动回收 */
    sessionIdleTimeout: number;
    /** 并发队列最大长度 */
    maxQueue: number;
    /** 处理超时(ms)，超时中断当前 LLM 调用 */
    processingTimeoutMs: number;
    /** 群历史缓冲条数 */
    historyLimit: number;
    /** 访问控制 */
    access: AccessControlConfig;
    /** 是否展示工具调用成功结果（工具错误始终展示） */
    showToolResults: boolean;
    /** 调试模式 */
    debug: boolean;
}
export declare const ConfigSchema: Schema<ImQQBotConfig>;
//# sourceMappingURL=config.d.ts.map