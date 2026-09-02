/**
 * BehaviorController — 大肥鱼拟人化行为门控（纯代码、不耗 token）
 *
 * 三状态机：sleeping(睡眠) / busy(画画) / awake(清醒)
 * 每个群一条独立状态。决定一条群消息是：
 *   - { type: 'model' }   → 交给模型处理
 *   - { type: 'fixed', text } → 直接回固定提示（不唤醒模型，零 token）
 *   - { type: 'skip' }    → 完全不理（零 token）
 * 私聊(c2c)始终走模型（主人）。
 */

const randBetween = (min, max) => min + Math.random() * (max - min);

export class BehaviorController {
    constructor(cfg, logger) {
        this.cfg = cfg;
        this.log = logger;
        this.groups = new Map(); // groupOpenid -> state
        this.masters = String(cfg.masterOpenids || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        this.keywords = String(cfg.groupTriggerKeywords || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        this.nameWords = String(cfg.nameMentionKeywords || '大肥鱼,肥鱼')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
    }

    /** 纯文字提到她的名字（大肥鱼/肥鱼等） */
    mentionsName(content) {
        return this.nameWords.some((w) => content.includes(w));
    }
    /** 记录一条「没来得及看/没回上」的提到她的消息，供下次补回 */
    pushPending(g, msg, now) {
        const t = String(msg.content || '').trim().slice(0, 60);
        if (!t)
            return;
        g.pendingMentions = g.pendingMentions || [];
        g.pendingMentions.push({ at: now, sender: msg.senderName || String(msg.senderId || '').slice(0, 8), text: t });
        if (g.pendingMentions.length > 4)
            g.pendingMentions.shift();
    }
    /** 取出并清空某群的未读提到（供模型回合前注入上下文） */
    takePending(gid) {
        const g = this.groups.get(gid);
        if (!g || !g.pendingMentions || g.pendingMentions.length === 0)
            return [];
        const p = g.pendingMentions;
        g.pendingMentions = [];
        return p;
    }

    groupState(gid) {
        let s = this.groups.get(gid);
        if (!s) {
            s = {
                mode: 'awake',
                busyUntil: 0,
                busyPokes: 0,
                wokenUntil: 0,   // 睡眠窗口内被吵醒后的清醒截止
                sleepPokes: 0,
                lastMsgAt: 0,
                lastReplyAt: 0,
                lastBusyRollAt: 0,
                burstUntil: 0,   // 热闹模式截止
                lastCount: 0,
                pendingMentions: [], // 没来得及看的提到她的消息（补充回复用）
            };
            this.groups.set(gid, s);
        }
        return s;
    }

    isMaster(openid) {
        return this.masters.includes(openid);
    }

    inSleepWindow(now) {
        const h = new Date(now).getHours();
        const start = this.cfg.sleepStartHour ?? 1;
        const end = this.cfg.sleepEndHour ?? 10;
        return h >= start && h < end;
    }

    /** 进入/退出睡眠、画画等随时间变化的状态 */
    refreshMode(g, now) {
        const sleeping = this.inSleepWindow(now);
        if (sleeping) {
            if (g.mode !== 'sleeping') {
                g.mode = 'sleeping';
                g.sleepPokes = 0;
                g.wokenUntil = 0;
            }
        }
        else {
            if (g.mode === 'sleeping') {
                g.mode = 'awake';
                g.busyPokes = 0;
            }
            // 醒着时每小时有概率去画画
            if (g.mode === 'awake' && now >= g.lastBusyRollAt + 3600000) {
                g.lastBusyRollAt = now;
                if (Math.random() < (this.cfg.busyChancePerHour ?? 0.3)) {
                    g.mode = 'busy';
                    g.busyPokes = 0;
                    g.busyUntil = now + randBetween(this.cfg.busyMinMs ?? 1200000, this.cfg.busyMaxMs ?? 2400000);
                }
            }
        }
        // 画画超时 → 回到清醒
        if (g.mode === 'busy' && now >= g.busyUntil) {
            g.mode = 'awake';
            g.busyPokes = 0;
        }
    }

    /** 群活跃度：最近 groupBurstCount 条消息是否都在窗口内（决定热闹/插话） */
    isHot(g, now) {
        const windowMs = this.cfg.groupBurstWindowMs ?? 30000;
        const count = this.cfg.groupBurstCount ?? 4;
        return g.lastMsgAt > 0 && now - g.lastMsgAt <= windowMs && (g.lastCount ?? 0) >= count;
    }

    /**
     * 决策入口。msg 为 SDK 消息对象，mention 为 mentionGate 产出的 {wasMentioned}
     */
    decide(msg, mention) {
        if (msg.kind !== 'group' || !msg.groupOpenid)
            return { type: 'model' }; // 私聊/其他 → 一律给模型（主人）
        const now = Date.now();
        const g = this.groupState(msg.groupOpenid);
        const content = String(msg.content ?? '').trim();
        const isMaster = this.isMaster(msg.senderId);
        const wasMentioned = !!(mention && mention.wasMentioned);

        // 活跃度窗口统计（所有群消息到达即推进）
        const gap = now - g.lastMsgAt;
        if (g.lastMsgAt > 0 && gap <= (this.cfg.groupBurstWindowMs ?? 30000)) {
            g.lastCount = (g.lastCount ?? 0) + 1;
        }
        else {
            g.lastCount = 1;
        }
        g.lastMsgAt = now;
        if (g.lastCount >= (this.cfg.groupBurstCount ?? 4) && g.burstUntil < now) {
            g.burstUntil = now + (this.cfg.groupBurstActiveMs ?? 180000);
        }

        // ── 过滤：非主人的长文「不看」（不 @ 她的闲聊长文直接忽略） ──
        const maxChars = this.cfg.maxMessageChars ?? 40;
        if (!isMaster && content.length > maxChars && !wasMentioned) {
            return { type: 'skip' }; // 肥鱼不爱看长文
        }

        // ── 更新状态（睡眠/画画/清醒） ──
        this.refreshMode(g, now);
        const sleeping = this.inSleepWindow(now);

        // ── 睡眠状态 ──
        if (sleeping && g.mode === 'sleeping') {
            const woken = g.wokenUntil > now;
            if (woken) {
                // 已被吵醒的清醒期：有 @ / 关键词就回应；高强度聊天则延长清醒
                if (wasMentioned || this.keywords.some((k) => content.includes(k))) {
                    if (gap <= (this.cfg.highIntensityGapMs ?? 480000)) {
                        g.wokenUntil = now + (this.cfg.wakeDurationMs ?? 1200000);
                    }
                    return { type: 'model' };
                }
                if (now >= g.wokenUntil) {
                    g.wokenUntil = 0;
                }
                return { type: 'skip' };
            }
            if (isMaster && wasMentioned) {
                g.wokenUntil = now + (this.cfg.wakeDurationMs ?? 1200000); // 主人叫醒
                g.sleepPokes = 0;
                return { type: 'model' };
            }
            if (wasMentioned) {
                g.sleepPokes = (g.sleepPokes ?? 0) + 1;
                if (g.sleepPokes >= (this.cfg.sleepWakePokes ?? 3)) {
                    g.sleepPokes = 0;
                    g.wokenUntil = now + (this.cfg.wakeDurationMs ?? 1200000); // 被吵醒(起床气→模型)
                    return { type: 'model' };
                }
                return { type: 'fixed', text: this.cfg.sleepFixedText || '（大肥鱼正在睡觉呢~）' };
            }
            // 没 @ 但提到她名字 → 记入未读，醒来补回
            if (this.mentionsName(content))
                this.pushPending(g, msg, now);
            return { type: 'skip' };
        }

        // ── 忙碌（画画）状态 ──
        if (g.mode === 'busy') {
            if (wasMentioned) {
                g.busyPokes = (g.busyPokes ?? 0) + 1;
                if (g.busyPokes >= (this.cfg.busyWakePokes ?? 2)) {
                    g.mode = 'awake'; // 停笔回应
                    g.busyPokes = 0;
                    return { type: 'model' };
                }
                return { type: 'fixed', text: this.cfg.busyFixedText || '（大肥鱼正在画画，多叫叫她~）' };
            }
            // 没 @ 但提到她名字 → 记入未读，画完补回
            if (this.mentionsName(content))
                this.pushPending(g, msg, now);
            return { type: 'skip' };
        }

        // ── 清醒状态：触发门控 ──
        if (wasMentioned)
            return { type: 'model' };
        if (this.keywords.some((k) => content.includes(k)))
            return { type: 'model' };
        // 热闹/插话（带冷却）
        if (g.burstUntil > now || this.isHot(g, now)) {
            if (now - g.lastReplyAt >= (this.cfg.groupBurstCooldownMs ?? 40000)) {
                g.lastReplyAt = now;
                return { type: 'model' }; // 简短插话（内容靠人设控制）
            }
        }
        return { type: 'skip' };
    }
}
