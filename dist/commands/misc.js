import { PKG_VERSION } from '../shared/version.js';
/** /bot-ping — 连通性测试 */
export function pingCommand() {
    return {
        name: 'bot-ping',
        description: '连通性测试',
        handler: () => 'pong 🏓',
    };
}
/** /bot-version — 查看版本信息 */
export function versionCommand({ manager }) {
    return {
        name: 'bot-version',
        description: '查看版本信息',
        handler: () => {
            const current = manager.getEffectiveModel('c2c', '');
            const modelInfo = current ? `${current.provider}/${current.model}` : '宿主默认';
            return `dsh-qqbot v${PKG_VERSION} | model: ${modelInfo}`;
        },
    };
}
/** /bot-stop — 中止当前生成（隐藏） */
export function stopCommand() {
    return {
        name: 'bot-stop',
        description: '中止当前生成',
        hidden: true,
        handler: () => ({ kind: 'noop' }),
    };
}
//# sourceMappingURL=misc.js.map