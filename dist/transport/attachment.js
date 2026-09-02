/**
 * 附件下载 — 将 QQ 文件附件安全下载到本地
 *
 * 下载后仅通过 @路径 提示模型，由模型通过 tool-bash / tool-fs 自行读取，
 * 不内联内容（避免 token 浪费与上下文污染）。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import * as dns from 'node:dns';
/** 下载大小上限（超过则跳过下载，仅保留路径提示） */
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;
/** 下载超时（毫秒） */
const DOWNLOAD_TIMEOUT_MS = 15_000;
/** 文件名净化：去路径、过滤危险字符，防止路径穿越 */
function sanitizeFilename(name) {
    const base = basename(name.replace(/\\/g, '/'));
    const safe = base.replace(/[^a-zA-Z0-9._-]/g, '_');
    return safe || 'attachment';
}
/** 字节数格式化 */
function formatSize(bytes) {
    if (bytes >= 1024 * 1024)
        return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
    if (bytes >= 1024)
        return `${(bytes / 1024).toFixed(1)}KB`;
    return `${bytes}B`;
}
// ── SSRF 防护：阻断解析到私有/保留地址的下载 ──
const PRIVATE_RANGES = [
    [0x0a000000n, 8], // 10.0.0.0/8
    [0xac100000n, 12], // 172.16.0.0/12
    [0xc0a80000n, 16], // 192.168.0.0/16
    [0x7f000000n, 8], // 127.0.0.0/8
    [0xa9fe0000n, 16], // 169.254.0.0/16
    [0xe0000000n, 4], // 224.0.0.0/4 (multicast)
];
function ipToBigInt(ip) {
    return ip.split('.').reduce((acc, octet) => (acc << 8n) | BigInt(Number(octet)), 0n);
}
function isPrivateIP(ip) {
    const val = ipToBigInt(ip);
    return PRIVATE_RANGES.some(([mask, prefix]) => (val >> (32n - BigInt(prefix))) === (mask >> (32n - BigInt(prefix))));
}
/** 解析 hostname 并阻断指向私有/内网地址的 URL（SSRF 防护） */
async function assertSafeHostname(hostname) {
    const addresses = await dns.promises.resolve4(hostname).catch(() => []);
    if (addresses.length === 0)
        throw new Error(`DNS resolution failed: ${hostname}`);
    for (const addr of addresses) {
        if (isPrivateIP(addr))
            throw new Error(`SSRF blocked: ${hostname} resolves to private IP ${addr}`);
    }
}
/** 安全下载：仅 HTTP(S) + 大小上限 + 超时，返回字节（不落盘，由调用方按真实格式命名） */
async function fetchBytes(url, maxBytes) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error(`Only HTTP(S) allowed: ${parsed.protocol}`);
    }
    const resp = await fetch(url, {
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (!resp.ok)
        throw new Error(`HTTP ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > maxBytes) {
        throw new Error(`Download exceeds ${Math.floor(maxBytes / 1024 / 1024)}MB`);
    }
    return buf;
}
/** 从字节签名嗅探真实扩展名：QQ 常把 JPEG/WebP 字节以 .png 命名，格式对不上会卡 read_image */
function detectImageExt(buf) {
    if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
    if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
    if (buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'webp';
    if (buf.length >= 4 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'gif';
    if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) return 'bmp';
    return null;
}
/**
 * 下载消息中的 file 附件到本地
 *
 * 下载目录为 {cwd}/.qqbot/{messageId}，用 messageId 隔离跨消息重名。
 * 下载失败不返回（由调用方回退描述），下载成功仅保留路径供模型用工具读取。
 */
export async function downloadFileAttachments(attachments, cwd, messageId, logger) {
    // QQ 官方 content_type 是 MIME 型（image/png、video/mp4）或字面值（voice、file），
    // 这里同时兼容两种，避免图片/文件因严格 === 'image' 比较而永不触发下载。
    const isDownloadable = (a) => {
        const ct = (a.content_type ?? '').toLowerCase();
        return (ct === 'file' || ct === 'image' || ct === 'video'
            || ct.startsWith('image/') || ct.startsWith('video/')
            || ct.startsWith('application/') || ct.startsWith('text/'));
    };
    const files = (attachments ?? []).filter(a => isDownloadable(a) && a.url);
    if (files.length === 0)
        return [];
    const dir = join(cwd, '.qqbot', messageId);
    mkdirSync(dir, { recursive: true });
    const results = [];
    for (const file of files) {
        // 原始文件名（去掉目录段 + 危险字符），但扩展名不可信：QQ 常把 JPEG/WebP 记为 .png
        const rawBase = sanitizeFilename(file.filename).replace(/\.[a-z0-9]+$/i, '');
        const defaultExt = (file.filename?.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase() || 'file';
        if (file.size > MAX_DOWNLOAD_BYTES) {
            const safeName = `${rawBase || 'attachment'}.${defaultExt}`;
            const localPath = join(dir, safeName);
            const displayPath = `.qqbot/${messageId}/${safeName}`;
            logger.debug(`im-qqbot: skip download (${file.size}B too large): ${file.filename}`);
            results.push({ filename: file.filename, localPath, displayPath });
            continue;
        }
        let bytes;
        try {
            bytes = await fetchBytes(file.url, MAX_DOWNLOAD_BYTES);
        }
        catch (err) {
            logger.warn(`im-qqbot: download failed: ${file.filename} — ${err instanceof Error ? err.message : String(err)}`);
            continue; // 下载失败不加入结果，由 buildDynamicCtx 回退为描述
        }
        // 按真实字节签名命名，避免 read_image 因扩展名/字节不匹配而报错
        const realExt = detectImageExt(bytes) || defaultExt;
        const safeName = `${rawBase || 'attachment'}.${realExt}`;
        const localPath = join(dir, safeName);
        const displayPath = `.qqbot/${messageId}/${safeName}`;
        writeFileSync(localPath, bytes);
        logger.debug(`im-qqbot: attachment downloaded: ${file.filename} (${formatSize(bytes.length)}) → ${displayPath}`);
        results.push({ filename: file.filename, localPath, displayPath });
    }
    return results;
}
//# sourceMappingURL=attachment.js.map