import type { Logger, RawAttachment } from '../types.js';
/** 下载结果 */
export interface DownloadedFile {
    /** 原始文件名（用于与消息附件关联） */
    filename: string;
    /** 本地绝对路径 */
    localPath: string;
    /** 相对 cwd 的显示路径（@提及 / 工具访问用） */
    displayPath: string;
}
/**
 * 下载消息中的 file 附件到本地
 *
 * 下载目录为 {cwd}/.qqbot/{messageId}，用 messageId 隔离跨消息重名。
 * 下载失败不返回（由调用方回退描述），下载成功仅保留路径供模型用工具读取。
 */
export declare function downloadFileAttachments(attachments: RawAttachment[] | undefined, cwd: string, messageId: string, logger: Logger): Promise<DownloadedFile[]>;
//# sourceMappingURL=attachment.d.ts.map