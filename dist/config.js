/**
 * dsh-im-qqbot 插件配置 Schema
 */
import Schema from '@deepseek-ai/schemastery';
export const ConfigSchema = Schema.object({
    appId: Schema.string().default('').description('QQ Bot AppID'),
    appSecret: Schema.string().default('').description('QQ Bot AppSecret'),
    provider: Schema.string().description('LLM provider name'),
    model: Schema.string().description('Model name'),
    preset: Schema.string().description('Agent preset id'),
    cwd: Schema.string().description('Agent working directory'),
    requireMention: Schema.boolean().default(true).description('群聊是否需要@bot触发'),
    groupPrompt: Schema.string().description('群聊额外system prompt'),
    directPrompt: Schema.string().description('私聊额外system prompt'),
    textChunkLimit: Schema.number().default(4500).description('单条消息最大字符数'),
    streaming: Schema.boolean().default(true).description('是否启用流式输出（群聊始终不启用）'),
    sessionIdleTimeout: Schema.number().default(30 * 60 * 1000).description('会话闲置超时(ms)'),
    maxQueue: Schema.number().default(20).description('并发队列最大长度'),
    processingTimeoutMs: Schema.number().default(120000).description('处理超时(ms)'),
    historyLimit: Schema.number().default(10).description('群历史缓冲条数'),
    // 访问控制：默认 allowlist（安全默认）。
    // 语义提醒：allowlist + 空名单 = 全部拒绝（上游 accessPolicy 的行为），不是"全部放行"。
    // 要对外服务必须显式写 open；open 模式下任何人找到机器人都能用，且 IM 输入可在宿主机执行工具。
    access: Schema.object({
        c2cMode: Schema.union(['open', 'allowlist', 'disabled']).default('allowlist').description('C2C访问模式：open=所有人 / allowlist=仅白名单 / disabled=关闭'),
        c2cAllow: Schema.array(Schema.string()).default([]).description('C2C白名单（对方 openid；allowlist 模式下为空即拒绝所有人）'),
        groupMode: Schema.union(['open', 'allowlist', 'disabled']).default('allowlist').description('群聊访问模式：open=所有群 / allowlist=仅白名单 / disabled=关闭'),
        groupAllow: Schema.array(Schema.string()).default([]).description('群聊白名单（群 openid；allowlist 模式下为空即拒绝所有群）'),
    }).default({
        c2cMode: 'allowlist',
        c2cAllow: [],
        groupMode: 'allowlist',
        groupAllow: [],
    }).description('访问控制（安全默认 allowlist：需显式加白名单；open 表示对所有人开放）'),
    showToolResults: Schema.boolean().default(false).description('是否展示工具调用成功结果（错误始终展示）'),
    debug: Schema.boolean().default(false),
    // ── 生图（后端可配置，参考 dsh-roleplay 实现） ──
    imageGenProvider: Schema.string().default('sdwebui').description('生图后端：sdwebui（本地免费）/ minimax（MiniMax海螺，需key）/ novelai / erpsex / url'),
    imageGenBaseUrl: Schema.string().default('http://127.0.0.1:7860').description('生图后端地址（sdwebui 默认 http://127.0.0.1:7860）'),
    imageGenApiKey: Schema.string().default('').description('生图后端 API Key（sdwebui 不需要；minimax/novelai/erpsex 需要时填）'),
    imageGenModel: Schema.string().default('image-01').description('生图模型名（MiniMax 默认 image-01）'),
    imageGenSteps: Schema.number().default(28).description('生图步数'),
    imageGenCfgScale: Schema.number().default(7).description('生图 CFG Scale'),
    imageGenSampler: Schema.string().default('Euler a').description('生图采样器'),
    imageGenWidth: Schema.number().default(768).description('生图默认宽度'),
    imageGenHeight: Schema.number().default(768).description('生图默认高度'),
    // ── 群聊触发：关键词 + 热闹模式（requireMention=true 时生效） ──
    groupTriggerKeywords: Schema.string().default('大肥鱼,画画,画图').description('群聊关键词触发（逗号分隔，命中即响应，无需@）'),
    groupBurstWindowMs: Schema.number().default(30000).description('群聊热闹判定窗口(ms)：窗口内消息达 groupBurstCount 条即触发'),
    groupBurstCount: Schema.number().default(4).description('热闹窗口内消息条数阈值'),
    groupBurstActiveMs: Schema.number().default(3 * 60 * 1000).description('热闹模式持续时长(ms)'),
    groupBurstCooldownMs: Schema.number().default(40000).description('热闹模式下两次触发的最小间隔(ms)，防刷屏'),
    // ── 拟人化行为（硬代码控制，不耗 token） ──
    masterOpenids: Schema.string().default('').description('主人 openid 列表（逗号分隔），用于确定「主人」身份'),
    sleepStartHour: Schema.number().default(1).description('睡觉开始钟点（24h，如 1=凌晨1点）'),
    sleepEndHour: Schema.number().default(10).description('起床钟点（如 10=上午10点）'),
    sleepWakePokes: Schema.number().default(3).description('睡眠中别人 @ 满几次就被吵醒'),
    sleepFixedText: Schema.string().default('（大肥鱼正在睡觉呢~）').description('睡眠中别人 @ 的自动提示'),
    busyChancePerHour: Schema.number().default(0.3).description('醒着时每小时进入「画画」的概率'),
    busyMinMs: Schema.number().default(20 * 60 * 1000).description('画画最短时长(ms)'),
    busyMaxMs: Schema.number().default(40 * 60 * 1000).description('画画最长时长(ms)'),
    busyFixedText: Schema.string().default('（大肥鱼正在画画，多叫叫她~）').description('画画中第一次被 @ 的自动提示'),
    busyWakePokes: Schema.number().default(2).description('画画中 @ 满几次就停笔回应'),
    maxMessageChars: Schema.number().default(40).description('非主人单条消息超过此字数就不看（忽略）'),
    maxMasterMessageChars: Schema.number().default(200).description('主人长消息超过此字数截断'),
    wakeDurationMs: Schema.number().default(20 * 60 * 1000).description('睡眠中被吵醒后保持清醒的时长(ms)'),
    highIntensityGapMs: Schema.number().default(8 * 60 * 1000).description('消息间隔小于此值视为高强度聊天，可让她保持清醒'),
});
//# sourceMappingURL=config.js.map