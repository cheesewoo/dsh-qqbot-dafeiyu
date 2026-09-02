/** 凭据结果 */
export interface SetupCredentials {
    appId: string;
    appSecret: string;
}
/**
 * 执行 QR 扫码绑定，获取 QQ Bot 凭据
 *
 * 在终端打印二维码等待用户扫码；同时输出扫码 URL，
 * 供二维码因系统字符问题渲染错位时点击/复制到浏览器打开扫码。
 */
export declare function runQrSetup(source?: string): Promise<SetupCredentials | null>;
/**
 * 将凭据写入 dsh profile 的 cordis.patch.yml
 *
 * 用 js-yaml 解析现有文件后更新/追加 im-qqbot 条目，再 dump 写回，
 * 保证输出始终是合法 YAML。文件不存在或为空时安全重建；
 * 解析失败或结构异常时拒绝写入、保留原文件（避免覆盖用户其他配置）。
 */
export declare function persistCredentialsToProfile(credentials: SetupCredentials, profileDir?: string, logger?: {
    info(msg: string, ...args: unknown[]): void;
    warn(msg: string, ...args: unknown[]): void;
}): boolean;
//# sourceMappingURL=setup.d.ts.map