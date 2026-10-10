import { QQBot } from '@tencent-connect/qqbot-nodejs';
import { SessionManager } from '../session/index.js';
import { handleInbound, createOutboundHandler } from '../transport/index.js';
import { buildUserAgent } from '../shared/index.js';
import { setupMiddlewares } from './middleware-setup.js';
import { BehaviorController } from '../behavior/controller.js';
import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { defineTool } from '@deepseek-ai/dsh-tools';
export async function bootstrapGateway(ctx, agents, config, logger) {
    const manager = new SessionManager(ctx, agents, config, logger);
    /**
     * 语音链路诊断（仅在 config.debug 时输出）。
     * 同时写 ~/.dsh/qqbot-voice-diag.log（便于事后排查合成/发送失败原因）。
     */
    function voiceDiag(msg) {
        if (!config.debug)
            return;
        const line = `${new Date().toISOString()} ${msg}\n`;
        try {
            appendFileSync(join(homedir(), '.dsh', 'qqbot-voice-diag.log'), line, 'utf8');
        }
        catch { }
        console.error(`[im-qqbot][diag] ${msg}`);
    }
    // ── 生图可视化设置页（webServer 已在插件 inject 中声明，先于本插件启动，不会死锁） ──
    const IMG_CFG_FILE = join(homedir(), '.dsh', 'qqbot-imagegen.json');
    function readImageGenFile() {
        try {
            if (existsSync(IMG_CFG_FILE)) {
                const v = JSON.parse(readFileSync(IMG_CFG_FILE, 'utf8'));
                return v && typeof v === 'object' ? v : {};
            }
        }
        catch { }
        return {};
    }
    function writeImageGenFile(obj) {
        try {
            mkdirSync(join(homedir(), '.dsh'), { recursive: true });
            writeFileSync(IMG_CFG_FILE, JSON.stringify(obj, null, 2), 'utf8');
        }
        catch (err) {
            logger.warn(`im-qqbot: write imagegen config failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    function isLoopback(req) {
        const address = req.socket?.remoteAddress ?? '';
        return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
    }
    async function readReqBody(req, limit = 1024 * 1024) {
        const parts = [];
        let total = 0;
        for await (const part of req) {
            total += part.length;
            if (total > limit)
                throw new Error('request body too large');
            parts.push(part);
        }
        return Buffer.concat(parts);
    }
    function imageGenFormHtml(v) {
        v = v || {};
        const esc = (s) => String(s ?? '').replace(/"/g, '&quot;');
        const opt = (cur, list) => list.map(o => `<option value="${o}"${o === cur ? ' selected' : ''}>${o}</option>`).join('');
        return `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>大肥鱼 · 生图设置</title>
<style>body{font-family:system-ui;max-width:520px;margin:40px auto;padding:0 16px;background:#101014;color:#eee}label{display:block;margin:14px 0 4px;font-size:13px;color:#9aa}input,select{width:100%;padding:8px;border-radius:8px;border:1px solid #333;background:#1c1c22;color:#eee;box-sizing:border-box}button{margin-top:18px;padding:10px 18px;border-radius:8px;border:0;background:#3b82f6;color:#fff;font-size:14px;cursor:pointer}#msg{margin-top:12px;font-size:13px;color:#8c8}</style></head>
<body><h2>🐟 大肥鱼 · 生图设置</h2>
<form id="f">
<label>生图后端</label><select id="imageGenProvider">${opt(v.imageGenProvider || 'pollinations', ['pollinations', 'minimax', 'sdwebui', 'novelai', 'erpsex'])}</select>
<label>API Key（MiniMax/NovelAI 用；pollinations 免 key 不用填）</label><input id="imageGenApiKey" type="password" value="${esc(v.imageGenApiKey)}" placeholder="粘贴你的 key">
<label>模型（MiniMax 默认 image-01）</label><input id="imageGenModel" value="${esc(v.imageGenModel || 'image-01')}">
<label>sdwebui 地址（用 sdwebui 时填）</label><input id="imageGenBaseUrl" value="${esc(v.imageGenBaseUrl || 'http://127.0.0.1:7860')}">
<button type="submit">保存</button>
</form><div id="msg"></div>
<script>
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    imageGenProvider: document.getElementById('imageGenProvider').value,
    imageGenApiKey: document.getElementById('imageGenApiKey').value,
    imageGenModel: document.getElementById('imageGenModel').value,
    imageGenBaseUrl: document.getElementById('imageGenBaseUrl').value,
  };
  const r = await fetch(location.pathname, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const m = document.getElementById('msg');
  m.textContent = r.ok ? '✅ 已保存（重启或热更新后生效）' : '❌ ' + (await r.text());
});
</script></body></html>`;
    }
    try {
        const webServer = ctx.get('webServer');
        if (webServer && typeof webServer.register === 'function') {
            const disposeRoute = webServer.register({
                kind: 'prefix',
                path: '/x-qqbot-imagegen',
                handler: async (req, res) => {
                    if (!isLoopback(req)) {
                        res.writeHead(403, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: 'loopback only' }));
                        return;
                    }
                    const url = new URL(req.url ?? '/', 'http://localhost');
                    const path = url.pathname.replace(/^\/x-qqbot-imagegen/, '') || '/';
                    const method = req.method ?? 'GET';
                    if (path === '/' && method === 'GET') {
                        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(imageGenFormHtml(readImageGenFile()));
                        return;
                    }
                    if (path === '/' && method === 'POST') {
                        const patch = JSON.parse((await readReqBody(req)).toString('utf8'));
                        writeImageGenFile({ ...readImageGenFile(), ...patch });
                        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify({ ok: true }));
                        return;
                    }
                    res.writeHead(404);
                    res.end('not found');
                },
            });
            ctx.effect(() => disposeRoute, 'im-qqbot.imagegen-ui');
            logger.info('[im-qqbot] 生图设置页: http://127.0.0.1:3080/x-qqbot-imagegen');
        }
    }
    catch (err) {
        logger.warn(`im-qqbot: imagegen UI register failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    // ── 初始化 QQ Bot SDK ──
    const userAgent = buildUserAgent();
    const bot = new QQBot({
        appId: config.appId,
        appSecret: config.appSecret,
        transport: 'websocket',
        baseUrl: process.env.QQBOT_BASE_URL?.replace(/\/+$/, '') || 'https://api.bot.qq.com',
        tokenBaseUrl: process.env.QQBOT_TOKEN_BASE_URL?.replace(/\/+$/, '') || 'https://api.bot.qq.com',
        userAgent,
        logger,
    });
    logger.info(`QQBot SDK initialized (UA: ${userAgent})`);
    // ── 中间件链 ──
    setupMiddlewares(bot, config, manager, logger);
    // ── 入站：拟人化行为门控（纯代码，不耗 token）→ 通过后才交给 dsh agent ──
    const behavior = new BehaviorController(config, logger);
    bot.on('message', async (mCtx) => {
        const msg = mCtx.message;
        // 访问控制需要群/私聊的 openid；把到达的每条消息的身份打到 INFO，
        // 便于配置 access.groupAllow（QQ 不在消息里显示 openid，只能这样取）。
        // 只在 debug 时输出，避免正常运行时刷日志。
        if (config.debug) {
            logger.info(`im-qqbot: 入站身份 kind=${msg.kind} senderId=${msg.senderId ?? ''} groupOpenid=${msg.groupOpenid ?? ''}`);
        }
        const decision = behavior.decide(msg, mCtx.state?.mention);
        if (decision.type === 'fixed') {
            try {
                await bot.sendMarkdown({
                    scope: msg.kind === 'group' ? 'group' : 'c2c',
                    targetId: msg.groupOpenid ?? msg.senderId,
                    msgId: msg.messageId,
                }, decision.text);
                logger.info(`im-qqbot: behavior fixed reply: ${decision.text}`);
            }
            catch (err) {
                logger.warn(`im-qqbot: behavior fixed reply failed: ${err instanceof Error ? err.message : String(err)}`);
            }
            return;
        }
        if (decision.type === 'skip') {
            return; // 不理会 → 零 token
        }
        // 未读的提到她的消息 → 注入本次上下文（补充回复用）
        const pending = behavior.takePending(msg.groupOpenid);
        if (pending && pending.length) {
            mCtx.state.pendingMentions = pending;
        }
        if (config.debug) {
            logger.debug(`← message (post-middleware): ${JSON.stringify(msg, null, 2).slice(0, 500)}`);
        }
        await handleInbound(msg, manager, config, logger, mCtx.state);
    });
    // ── 出站：dsh session/event → QQ 消息 ──
    // 获取 tools 服务（工具结果结构化展示，参考 dsh-TUI presentResult），可选
    let toolsRegistry;
    try {
        toolsRegistry = ctx.get('tools');
    }
    catch {
        toolsRegistry = undefined;
    }
    // 发送适配器：将 QQBot 实例适配为 QQBotSender（openStream 参数形态不同）
    const sender = {
        sendMarkdown: (target, content) => bot.sendMarkdown(target, content),
        openStream: (target) => bot.openStream({
            target: {
                scope: target.scope,
                targetId: target.targetId,
                msgId: target.msgId,
            },
        }),
        sendImage: (target, localPath, content) => bot.sendImage(target, { localPath }, { content }),
    };
    // ── 生图工具（参考 dsh-roleplay 的 sdwebui 实现，直接嵌进 im-qqbot） ──
    if (toolsRegistry) {
        const disposeTool = toolsRegistry.register(defineTool({
            name: 'generate_image',
            description: '生成一张图片（Stable Diffusion / sdwebui 后端）并自动发送给当前聊天对象（私聊或群里都能发）。生成完成后图片会直接出现在对话里，你只需在回复里用角色口吻说一两句（比如「画好啦」「喏，你要的图」）。prompt 必须用英文 danbooru 风格 tag、逗号分隔（如 "1girl, blue hair, maid, holding paintbrush, ocean, sunlight, detailed"），不要写自然语言长句。若生图服务不可用会报错，你就自然地用角色口吻说画不出来，别反复重试。',
            parameters: {
                prompt: { type: 'string', required: true, description: 'English danbooru-style tags, comma separated' },
                negative_prompt: { type: 'string', description: 'negative tags (optional)' },
                width: { type: 'number', description: 'width in px, default 768' },
                height: { type: 'number', description: 'height in px, default 768' },
                reference_image_path: { type: 'string', description: 'optional local image absolute path as img2img reference' },
            },
            output: {
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        image_path: { type: 'string', required: true },
                        sent: { type: 'boolean', required: true },
                    },
                },
                render: (_args, value) => [{
                    type: 'text',
                    text: value?.sent
                        ? '图片已生成并发送给对方。用角色口吻说一句就好，别贴文件路径/链接。'
                        : `图片已生成（${value?.image_path ?? ''}），但未能发送给对方。用角色口吻自然说明一下。`,
                }],
            },
            async execute(args, exec) {
                // 网页表单保存的 qqbot-imagegen.json 优先于配置文件
                const cfg = { ...config, ...readImageGenFile() };
                const provider = String(cfg.imageGenProvider || 'sdwebui').toLowerCase();
                let buf;
                if (provider === 'pollinations') {
                    // Pollinations：免费免 key，GET 直接出图
                    const w = args.width ?? cfg.imageGenWidth ?? 512;
                    const h = args.height ?? cfg.imageGenHeight ?? 512;
                    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(args.prompt)}?width=${w}&height=${h}`;
                    const resp = await fetch(url, { signal: exec?.signal ?? null });
                    if (!resp.ok) {
                        const detail = (await resp.text().catch(() => '')).slice(0, 300);
                        throw new Error(`生图服务返回 ${resp.status}: ${detail}`);
                    }
                    buf = Buffer.from(await resp.arrayBuffer());
                }
                else if (provider === 'minimax') {
                    // MiniMax（海螺）文生图：POST /v1/image_generation，Bearer key，response_format=base64
                    if (!cfg.imageGenApiKey)
                        throw new Error('MiniMax 生图需要配置 imageGenApiKey（在 cordis.patch.yml 里填）');
                    const resp = await fetch('https://api.minimaxi.com/v1/image_generation', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.imageGenApiKey}` },
                        body: JSON.stringify({
                            model: cfg.imageGenModel || 'image-01',
                            prompt: args.prompt,
                            n: 1,
                            width: args.width ?? cfg.imageGenWidth ?? 768,
                            height: args.height ?? cfg.imageGenHeight ?? 768,
                            response_format: 'base64',
                        }),
                        signal: exec?.signal ?? null,
                    });
                    if (!resp.ok) {
                        const detail = (await resp.text().catch(() => '')).slice(0, 300);
                        throw new Error(`MiniMax 返回 ${resp.status}: ${detail}`);
                    }
                    const payload = await resp.json();
                    const urls = payload?.data?.image_urls;
                    if (!Array.isArray(urls) || urls.length === 0)
                        throw new Error('MiniMax 没有返回图片');
                    const first = urls[0];
                    if (typeof first === 'string' && first.startsWith('data:')) {
                        buf = Buffer.from(first.slice(first.indexOf(',') + 1), 'base64');
                    }
                    else if (typeof first === 'string' && /^https?:\/\//.test(first)) {
                        const imgResp = await fetch(first, { signal: exec?.signal ?? null });
                        if (!imgResp.ok)
                            throw new Error(`MiniMax 图片下载失败 ${imgResp.status}`);
                        buf = Buffer.from(await imgResp.arrayBuffer());
                    }
                    else if (typeof first === 'string') {
                        buf = Buffer.from(first, 'base64');
                    }
                    else {
                        throw new Error('MiniMax 返回格式异常');
                    }
                }
                else {
                    // sdwebui（默认）：txt2img / img2img
                    const baseUrl = (cfg.imageGenBaseUrl || 'http://127.0.0.1:7860').replace(/\/+$/, '');
                    const endpoint = args.reference_image_path ? 'img2img' : 'txt2img';
                    const body = {
                        prompt: args.prompt,
                        negative_prompt: args.negative_prompt ?? '',
                        width: args.width ?? cfg.imageGenWidth ?? 768,
                        height: args.height ?? cfg.imageGenHeight ?? 768,
                        steps: cfg.imageGenSteps ?? 28,
                        cfg_scale: cfg.imageGenCfgScale ?? 7,
                        sampler_name: cfg.imageGenSampler || 'Euler a',
                        batch_size: 1,
                    };
                    if (args.reference_image_path) {
                        let refBuf;
                        try {
                            refBuf = readFileSync(args.reference_image_path);
                        }
                        catch {
                            throw new Error(`参考图无法读取: ${args.reference_image_path}`);
                        }
                        body.init_images = [refBuf.toString('base64')];
                        body.denoising_strength = 0.6;
                    }
                    const resp = await fetch(`${baseUrl}/sdapi/v1/${endpoint}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body),
                        signal: exec?.signal ?? null,
                    });
                    if (!resp.ok) {
                        const detail = (await resp.text().catch(() => '')).slice(0, 300);
                        throw new Error(`生图服务返回 ${resp.status}: ${detail}`);
                    }
                    const payload = await resp.json();
                    const first = payload.images?.[0];
                    if (!first)
                        throw new Error('生图服务没有返回图片');
                    buf = Buffer.from(first, 'base64');
                }
                const outDir = join(config.cwd || process.cwd(), '.qqbot-gen');
                mkdirSync(outDir, { recursive: true });
                const imagePath = join(outDir, `dfy_${Date.now()}.png`);
                writeFileSync(imagePath, buf);
                // 直接发送给当前 QQ 会话
                let sent = false;
                try {
                    const record = exec?.agent ? manager.findByAgent(exec.agent) : undefined;
                    if (record?.replyTarget) {
                        await bot.sendImage(record.replyTarget, { localPath: imagePath }, { content: '' });
                        sent = true;
                    }
                }
                catch (err) {
                    logger.warn(`im-qqbot: sendImage failed: ${err instanceof Error ? err.message : String(err)}`);
                }
                logger.info(`im-qqbot: generated image → ${imagePath} (sent=${sent})`);
                return { image_path: imagePath, sent };
            },
        }));
        ctx.effect(() => disposeTool, 'im-qqbot.imagegen');
    }
    // ── 语音：text_to_speech（复用 dsh-plugin-tts 的 /speak 接口，支持 edge-tts 与 RVC 自定义音色） ──
    if (toolsRegistry) {
        const TTS_BASE = process.env.DSH_TTS_BASE || 'http://127.0.0.1:3080';
        function readVoiceDefault() {
            try {
                const p = join(homedir(), '.dsh', 'tts-rvc', 'last-voice.json');
                if (existsSync(p)) {
                    const j = JSON.parse(readFileSync(p, 'utf8'));
                    if (j && typeof j.voice === 'string' && j.voice) return j.voice;
                }
            }
            catch { }
            return 'zh-CN-XiaoxuanNeural';
        }
        /** 单次合成尝试；失败抛错（含服务端返回的具体原因）。 */
        async function speakOnce(reqBody) {
            const resp = await fetch(`${TTS_BASE}/dsh-tts-api/speak`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(reqBody),
            });
            if (!resp.ok) {
                let detail = '';
                try {
                    detail = (await resp.text()).slice(0, 300);
                }
                catch { }
                throw new Error(`/speak HTTP ${resp.status} ${detail}`);
            }
            const data = await resp.json();
            const url = data.url || (Array.isArray(data.chunks) && data.chunks[0]);
            if (!url)
                throw new Error('TTS 未返回音频 url');
            const audio = await fetch(TTS_BASE + url);
            if (!audio.ok)
                throw new Error('TTS 音频下载失败: HTTP ' + audio.status);
            return Buffer.from(await audio.arrayBuffer());
        }
        /**
         * 合成语音。若模型指定了 rvc（未配置 RVC 模型）或给了无效音色，
         * 自动回退到 edge-tts + 面板默认音色，保证语音不会因参数问题发不出来。
         */
        async function generateVoice(text, voice, provider) {
            const wanted = { text, voice: voice || readVoiceDefault(), provider: provider || 'edge-tts' };
            const fallback = { text, voice: readVoiceDefault(), provider: 'edge-tts' };
            const sameAsFallback = wanted.provider === 'edge-tts' && wanted.voice === fallback.voice;
            const plan = sameAsFallback ? [wanted] : [wanted, fallback];
            let lastErr;
            for (let i = 0; i < plan.length; i += 1) {
                const reqBody = plan[i];
                voiceDiag(`voice: POST attempt${i + 1} ${JSON.stringify(reqBody).slice(0, 160)}`);
                try {
                    const buf = await speakOnce(reqBody);
                    if (i > 0)
                        voiceDiag('voice: recovered via edge-tts fallback');
                    return buf;
                }
                catch (err) {
                    lastErr = err;
                    voiceDiag(`voice: attempt${i + 1} failed: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
            throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
        }
        const disposeTts = toolsRegistry.register(defineTool({
            name: 'text_to_speech',
            description: '把一句话转成语音并自动发送给当前聊天对象（大肥鱼用语音说话）。text 是要读的内容（用角色口吻、简短自然）。**voice 和 provider 都建议省略**：省略时自动使用「设置 → 插件 → 语音」面板里选定的音色（Edge TTS），最稳。只有在主人明确要求用「自定义音色 / RVC」时才传 provider="rvc"。生成后语音会自动发出去，你只需在回复里配合说一句。',
            parameters: {
                text: { type: 'string', required: true, description: '要说的话（简短、自然、角色口吻）' },
                voice: { type: 'string', description: '声音名，默认 zh-CN-XiaoxuanNeural（晓晓）' },
                provider: { type: 'string', description: 'edge-tts 或 rvc（自定义音色）' },
            },
            output: {
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        sent: { type: 'boolean', required: true },
                    },
                },
                render: (_args, value) => [{
                    type: 'text',
                    text: value?.sent ? '语音已生成并发送给对方。' : '语音已生成但未能发送，用角色口吻自然说明一下。',
                }],
            },
            async execute(args, exec) {
                voiceDiag(`voice: CALLED text="${String(args.text ?? '').slice(0, 40)}" voice=${JSON.stringify(args.voice ?? null)} provider=${JSON.stringify(args.provider ?? null)} cwd=${config.cwd || '(process)'}`);
                const outDir = join(config.cwd || process.cwd(), '.qqbot-gen');
                mkdirSync(outDir, { recursive: true });
                const mp3 = join(outDir, `dfy_voice_${Date.now()}.mp3`);
                let buf;
                try {
                    buf = await generateVoice(args.text, args.voice, args.provider);
                }
                catch (err) {
                    const d = err instanceof Error ? (err.stack || err.message) : String(err);
                    const resp = err && typeof err === 'object' && err.response ? ` status=${err.response.status}` : '';
                    voiceDiag(`voice: FAIL generateVoice threw${resp}: ${d}`);
                    throw err;
                }
                writeFileSync(mp3, buf);
                let sent = false;
                try {
                    const record = exec?.agent ? manager.findByAgent(exec.agent) : undefined;
                    voiceDiag(`voice: hasAgent=${!!exec?.agent} record=${!!record} replyTarget=${JSON.stringify(record?.replyTarget ?? null)} file=${mp3} bytes=${buf.length}`);
                    if (record?.replyTarget) {
                        await bot.sendVoice(record.replyTarget, { localPath: mp3 });
                        sent = true;
                        voiceDiag('voice: sendVoice OK');
                    }
                    else {
                        voiceDiag('voice: FAIL no record/replyTarget -> not sent');
                    }
                }
                catch (err) {
                    voiceDiag(`voice: FAIL sendVoice threw: ${err instanceof Error ? (err.stack || err.message) : String(err)}`);
                    logger.warn(`im-qqbot: sendVoice failed: ${err instanceof Error ? err.message : String(err)}`);
                }
                logger.info(`im-qqbot: voice → ${mp3} (${buf.length}B, sent=${sent})`);
                return { sent };
            },
        }));
        ctx.effect(() => disposeTts, 'im-qqbot.tts');
    }
    const outboundHandler = createOutboundHandler(manager, sender, config, logger, toolsRegistry);
    ctx
        .on('session/event', outboundHandler);
    bot.on('error', (err) => {
        logger.error(`bot error: ${err instanceof Error ? err.message : String(err)}`);
    });
    bot.on('ready', () => {
        console.log(`[im-qqbot] Bot ready! appId=${config.appId}`);
    });
    // ── 生命周期 ──
    ctx
        .effect(() => {
        logger.info(`Starting bot (appId=${config.appId})`);
        bot.start().catch((err) => {
            logger.error(`Bot start failed: ${err instanceof Error ? err.message : String(err)}`);
        });
        return async () => {
            logger.info('Shutting down');
            await manager.disposeAll();
            bot.stop();
        };
    }, 'im-qqbot.lifecycle');
}
//# sourceMappingURL=bootstrap.js.map