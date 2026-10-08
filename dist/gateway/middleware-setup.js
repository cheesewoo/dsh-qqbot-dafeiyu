import { errorHandler, messageFilter, accessPolicy, mentionGate, contentSanitizer, rateLimiter, slashCommand, concurrencyGuard, typingIndicator, quoteRef, historyBuffer, envelopeFormatter, } from '@tencent-connect/qqbot-nodejs';
import { buildCommandList } from '../commands/index.js';
import { attachmentProcessor } from '../middleware/attachment.js';
import { getHistoryStore, historyGroupKey } from '../features/history-store.js';
export function setupMiddlewares(bot, config, manager, logger) {
    // 1. 错误兜底（最外层洋葱皮）
    bot.use(errorHandler());
    // 2. 消息过滤：bot 回声 + 消息去重
    bot.use(messageFilter({ skipSelfEcho: false }));
    // 3. 访问控制（白名单/开放/禁用）
    //    白名单直接透传：allowlist + 空名单 = 拒绝所有人（上游 accessPolicy 语义）。
    //    不要再用 ['*'] 兜底空名单——那等于把"没配白名单"变成"放行所有人"。
    const c2cMode = config.access.c2cMode;
    const groupMode = config.access.groupMode;
    if (c2cMode === 'open' || groupMode === 'open') {
        logger.warn(`im-qqbot: 访问模式为 open（c2c=${c2cMode}, group=${groupMode}）——任何人/任何群都能驱动本机器人，且 IM 输入可在宿主机执行工具；如需限制请改为 allowlist 并配置白名单，或改为 disabled`);
    }
    if (c2cMode === 'allowlist' && config.access.c2cAllow.length === 0) {
        logger.warn('im-qqbot: c2cMode=allowlist 但 c2cAllow 为空，所有私聊都会被拒绝；请填入对方 openid 或改为 open');
    }
    if (groupMode === 'allowlist' && config.access.groupAllow.length === 0) {
        logger.warn('im-qqbot: groupMode=allowlist 但 groupAllow 为空，所有群聊都会被拒绝；请填入群 openid 或改为 open');
    }
    bot.use(accessPolicy({
        c2c: {
            mode: c2cMode,
            allow: config.access.c2cAllow,
        },
        group: {
            mode: groupMode,
            allow: config.access.groupAllow,
        },
        onBlock: (_mCtx, reason) => {
            if (config.debug) {
                logger.debug(`Access blocked: ${reason}`);
            }
        },
    }));
    // 4. 群历史缓冲 — 放在门控之前，确保所有消息（含未 @bot）都计入上下文
    //    store 走共享单例（getHistoryStore），groupKey 带 appId 前缀，供回复后清空
    bot.use(historyBuffer({
        limit: config.historyLimit,
        store: getHistoryStore(),
        recordOnSkip: true,
        groupKey: (ctx) => {
            const gid = ctx.message.groupOpenid;
            if (ctx.message.kind !== 'group' || !gid)
                return undefined;
            return historyGroupKey(config.appId, gid);
        },
    }));
    // 5. 群聊 @bot 门控 + 关键词/热闹触发（requireMention=false 时全部放行）
    // 群活跃度追踪：窗口内消息密集 → 进入「热闹模式」一段时间，期间她会自然参与（带冷却防刷屏）
    const groupActivity = new Map();
    const groupNow = () => Date.now();
    function recordGroupActivity(gid, now) {
        const a = groupActivity.get(gid) ?? { times: [], burstUntil: 0, lastPass: 0 };
        a.times.push(now);
        a.times = a.times.filter(t => now - t <= config.groupBurstWindowMs);
        if (a.times.length >= config.groupBurstCount && a.burstUntil < now) {
            a.burstUntil = now + config.groupBurstActiveMs;
        }
        if (a.times.length === 0 && a.burstUntil < now) {
            groupActivity.delete(gid);
            return;
        }
        groupActivity.set(gid, a);
    }
    function isGroupBursting(gid, now) {
        const a = groupActivity.get(gid);
        return !!a && a.burstUntil > now;
    }
    bot.use(mentionGate({
        requireMentionInGroup: config.requireMention,
        isImplicitMention: (mCtx) => {
            const msg = mCtx.message;
            if (msg.kind !== 'group' || !msg.groupOpenid)
                return false;
            const now = groupNow();
            recordGroupActivity(msg.groupOpenid, now);
            const text = (msg.content ?? '');
            const kws = String(config.groupTriggerKeywords || '').split(',').map(s => s.trim()).filter(Boolean);
            if (kws.some(k => text.includes(k))) {
                const a = groupActivity.get(msg.groupOpenid);
                if (a)
                    a.lastPass = now;
                return true;
            }
            // 热闹模式：群聊短时间很活跃时，她也会参与几句（带冷却）
            if (isGroupBursting(msg.groupOpenid, now)) {
                const a = groupActivity.get(msg.groupOpenid);
                if (now - (a.lastPass || 0) >= config.groupBurstCooldownMs) {
                    a.lastPass = now;
                    return true;
                }
            }
            return false;
        },
    }));
    // 6. 内容清洗（去 @marker、表情标签、多余空白）
    bot.use(contentSanitizer({
        parseFaceTags: true,
    }));
    // 7. 三层限流（sender / group / global）
    bot.use(rateLimiter());
    // 8. 斜杠命令（在 concurrencyGuard 之前，命令匹配后不排队直接响应）
    const slash = slashCommand({
        autoHelp: true,
        commands: buildCommandList({ manager, config }),
    });
    bot.use(slash.middleware);
    // 9. 并发串行 + 消息合并（同 peer 排队，避免 session 冲突）
    bot.use(concurrencyGuard({
        strategy: 'merge',
        maxQueue: config.maxQueue,
        maxProcessingMs: config.processingTimeoutMs,
        urgentPredicate: (mCtx) => {
            return (mCtx.message.content ?? '').trim() === '/bot-stop';
        },
    }));
    // 10. C2C 输入状态指示
    bot.use(typingIndicator());
    // 11. 引用消息解析（记录 + 解析被引用原文）
    bot.use(quoteRef({
        maxSize: 500,
        preferMsgElements: true,
    }));
    // 11.5. 附件下载（file 附件下载到本地，供 @提及 / 工具访问）
    bot.use(attachmentProcessor(config, logger));
    // 12. 上下文组装（将 history + quote + sender 组成 envelope）
    bot.use(envelopeFormatter({
        historyLimit: config.historyLimit,
        includeQuote: true,
        includeSender: true,
    }));
}
//# sourceMappingURL=middleware-setup.js.map