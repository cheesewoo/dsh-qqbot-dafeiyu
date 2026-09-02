import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { clearGroupHistory } from '../features/history-store.js';
// ── 主处理函数 ──
/**
 * 处理 QQ 入站消息（已经过 SDK 中间件链）
 */
export async function handleInbound(rawMsg, manager, config, logger, state) {
    const msg = rawMsg;
    const mwState = (state ?? {});
    const scope = msg.kind === 'group' ? 'group' : 'c2c';
    const peerId = scope === 'group' ? (msg.groupOpenid ?? msg.senderId) : msg.senderId;
    const replyTarget = {
        scope,
        targetId: peerId,
        msgId: msg.messageId,
    };
    // ── 读取中间件已下载的文件（attachmentProcessor 写入 state.downloadedFiles） ──
    const downloaded = mwState.downloadedFiles ?? [];
    // ── 组装 agentBody（对齐 openclaw-qqbot body-assembler） ──
    const agentBody = assembleAgentBody(msg, mwState, scope, logger, downloaded);
    if (!agentBody)
        return;
    logger.info(`Processing: scope=${scope} peerId=${peerId} body="${agentBody.slice(0, 200)}"`);
    // ── 获取或创建会话 ──
    let record;
    try {
        record = await manager.getOrCreate(scope, peerId, msg.senderId, replyTarget);
    }
    catch (err) {
        logger.error(`ERROR creating session: ${err instanceof Error ? err.message : String(err)}`);
        return;
    }
    // ── 构建 UserMessage → followup ──
    const content = [{ type: 'text', text: agentBody }];
    const message = createUserMessage({
        content,
        source: { kind: 'user' },
    });
    record.agent.followup(message);
    logger.info(`→ followup sent: key=${scope}:${peerId}`);
    // 群消息回复后清空历史缓存（避免下次 @ 时重复组包，对齐 openclaw-qqbot dispatch）
    if (scope === 'group') {
        clearGroupHistory(config.appId, msg.groupOpenid ?? msg.senderId);
    }
}
// ══════════════════════════════════════════════════════════════
// Body Assembly（对齐 openclaw-qqbot 5 层组装）
// ══════════════════════════════════════════════════════════════
/**
 * 组装 agentBody — AI 实际看到的完整上下文
 */
function assembleAgentBody(msg, state, scope, logger, downloaded) {
    const userContent = buildUserContent(msg, state, logger);
    if (!userContent && (!msg.attachments || msg.attachments.length === 0))
        return null;
    const quotePart = buildQuotePart(state.quote);
    const isGroup = scope === 'group';
    const wasMentioned = state.mention?.wasMentioned ?? false;
    const userMessage = buildUserMessage(userContent, quotePart, msg.senderId, msg.senderName, isGroup, wasMentioned);
    const dynamicCtx = buildDynamicCtx(msg, state, downloaded);
    const base = dynamicCtx ? `${dynamicCtx}${userMessage}` : userMessage;
    // 未读的提到她的消息（睡觉/画画时漏的）→ 前置提示，让她自然补一句
    const pending = state.pendingMentions;
    const pendingBlock = Array.isArray(pending) && pending.length > 0
        ? '[本鱼没来得及看的旧消息]\n' + pending.map((p) => {
            const t = new Date(p.at);
            const hm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
            return `${hm} ${p.sender}: ${p.text}`;
        }).join('\n') + '\n[本鱼没来得及看的旧消息结束]\n'
        : '';
    const agentBody = buildAgentBody(pendingBlock + base, state.history, isGroup, wasMentioned);
    return agentBody;
}
/**
 * Layer 1: 用户文本内容 + 语音 + 附件
 */
function buildUserContent(msg, state, logger) {
    const parts = [];
    const text = (msg.content ?? '').trim();
    if (text) {
        parts.push(text);
    }
    const voiceTexts = extractVoiceTexts(msg.attachments, state.processedAttachments, logger);
    if (voiceTexts.length > 0) {
        for (const vt of voiceTexts) {
            const durationTag = vt.duration ? ` (${vt.duration}s)` : '';
            parts.push(`[Voice message${durationTag}] ${vt.text}`);
        }
    }
    const otherAttachments = describeAttachments(msg.attachments, state.processedAttachments);
    if (otherAttachments) {
        parts.push(otherAttachments);
    }
    return parts.join('\n');
}
/**
 * Layer 2: 引用消息块
 */
function buildQuotePart(quote) {
    if (!quote?.text && !quote?.entry?.content)
        return '';
    const quoteText = quote.text || quote.entry?.content || 'Original content unavailable';
    return `[Quoted message begins]\n${quoteText}\n[Quoted message ends]\n[Current message]\n`;
}
/**
 * Layer 3: 带发送者标签的用户消息
 */
function buildUserMessage(userContent, quotePart, senderId, senderName, isGroup, wasMentioned) {
    if (!isGroup) {
        return `${quotePart}${userContent}`;
    }
    const mentionTag = wasMentioned ? ' (@you)' : '';
    const displayName = senderName ?? shortSenderId(senderId);
    const senderTag = `[${displayName} (${senderId})]`;
    return `${quotePart}${senderTag} ${userContent}${mentionTag}`;
}
/**
 * Layer 4: 媒体元数据上下文
 */
function isImageAtt(a) {
    const ct = (a.content_type ?? '').toLowerCase();
    return ct === 'image' || ct.startsWith('image/');
}
function isVoiceAtt(a) {
    const ct = (a.content_type ?? '').toLowerCase();
    return ct === 'voice' || ct.startsWith('audio/') || ct.includes('silk') || ct.includes('amr');
}
function isVideoAtt(a) {
    const ct = (a.content_type ?? '').toLowerCase();
    return ct === 'video' || ct.startsWith('video/');
}
function isFileAtt(a) {
    const ct = (a.content_type ?? '').toLowerCase();
    return ct === 'file' || ct.startsWith('application/') || ct.startsWith('text/');
}
function buildDynamicCtx(msg, state, downloaded) {
    const lines = [];
    if (!msg.attachments || msg.attachments.length === 0)
        return '';
    const images = msg.attachments.filter(isImageAtt);
    if (images.length > 0) {
        // 不暴露原始 url：避免模型被 URL 勾着去浏览器/搜网，只用本地绝对路径供 read_image 直接读
        const localImages = (downloaded ?? []).map(d => d.localPath).filter(Boolean);
        if (localImages.length > 0) {
            lines.push(`- 图片已下载到本地（用 read_image 工具读取该绝对路径即可真正看到图片内容）: ${localImages.join(', ')}`);
        }
    }
    const voices = msg.attachments.filter(isVoiceAtt);
    if (voices.length > 0) {
        const asrTexts = voices.map(a => a.asr_refer_text).filter(Boolean);
        if (asrTexts.length > 0) {
            lines.push(`- ASR: ${asrTexts.join(' | ')}`);
        }
        else {
            // 无 ASR 识别结果时才带链接（纯文本模型无法消费音频，链接无意义）
            const urls = voices.map(a => a.url).filter(Boolean);
            if (urls.length > 0) {
                lines.push(`- Voice: ${urls.join(', ')}`);
            }
        }
    }
    const videos = msg.attachments.filter(isVideoAtt);
    if (videos.length > 0) {
        lines.push(`- Videos: ${videos.map(a => a.filename).join(', ')}`);
    }
    const files = msg.attachments.filter(isFileAtt);
    if (files.length > 0) {
        for (const file of files) {
            const d = downloaded.find(x => x.filename === file.filename);
            if (d) {
                lines.push(`- File: ${file.filename} → ${d.displayPath}`);
            }
            else {
                lines.push(`- File: ${file.filename} (${formatFileSize(file.size)})`);
            }
        }
    }
    if (lines.length === 0)
        return '';
    const quoteAttachments = state.quote?.attachments;
    if (quoteAttachments && quoteAttachments.length > 0) {
        lines.push('[Reference attachments]');
        for (const qa of quoteAttachments) {
            const label = qa.asrText ? `Voice: ${qa.asrText}` : (qa.filename ?? qa.contentType ?? 'attachment');
            lines.push(`  - ${label}`);
        }
    }
    return lines.join('\n') + '\n\n';
}
/**
 * Layer 5: 最终 agentBody 拼合
 */
function buildAgentBody(base, history, isGroup, wasMentioned) {
    if (!isGroup || !wasMentioned || !history || history.length === 0) {
        return base;
    }
    const historyLines = history.map(h => {
        const name = h.senderName ?? shortSenderId(h.senderId);
        return `[${name} (${h.senderId})] ${h.content}`;
    });
    return [
        '[Chat history begins]',
        ...historyLines,
        '',
        '[Chat history ends]',
        '[Current message]',
        base,
    ].join('\n');
}
function extractVoiceTexts(attachments, processed, _logger) {
    const results = [];
    if (processed) {
        for (const pa of processed) {
            if (pa.type === 'voice' && pa.voiceText) {
                results.push({
                    text: pa.voiceText,
                    duration: pa.duration,
                    source: pa.voiceSource ?? 'stt',
                });
            }
        }
    }
    if (results.length === 0 && attachments) {
        for (const att of attachments) {
            if (att.content_type === 'voice' && att.asr_refer_text) {
                results.push({
                    text: att.asr_refer_text.trim(),
                    source: 'asr',
                });
            }
        }
    }
    return results;
}
function describeAttachments(attachments, _processed) {
    if (!attachments || attachments.length === 0)
        return '';
    const parts = [];
    for (const att of attachments) {
        if (isVoiceAtt(att))
            continue;
        if (isImageAtt(att)) {
            const dim = att.width && att.height ? ` ${att.width}×${att.height}` : '';
            parts.push(`[Image: ${att.filename}${dim}]`);
            continue;
        }
        if (isVideoAtt(att)) {
            parts.push(`[Video: ${att.filename}]`);
            continue;
        }
        if (isFileAtt(att)) {
            parts.push(`[File: ${att.filename} (${formatFileSize(att.size)})]`);
            continue;
        }
        parts.push(`[Attachment: ${att.filename ?? att.content_type}]`);
    }
    return parts.join('\n');
}
function formatFileSize(bytes) {
    if (bytes < 1024)
        return `${bytes}B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
/** 发送者短标识长度（openid 前 N 位，无昵称时兜底） */
const SENDER_SHORT_ID_LEN = 8;
/** 无昵称时用 openid 前 N 位作为匿名标识 */
function shortSenderId(senderId) {
    return senderId.slice(0, SENDER_SHORT_ID_LEN);
}
//# sourceMappingURL=inbound.js.map