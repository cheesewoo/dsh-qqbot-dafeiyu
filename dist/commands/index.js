import { resetCommand, newCommand } from './session.js';
import { modelCommand } from './model.js';
import { statusCommand } from './status.js';
import { helpCommand } from './help.js';
import { pingCommand, versionCommand, stopCommand } from './misc.js';
/**
 * 构建标准命令列表
 */
export function buildCommandList(deps) {
    const commands = [
        // 会话
        resetCommand(deps),
        newCommand(deps),
        // 模型
        modelCommand(deps),
        // 状态
        statusCommand(deps),
        // 杂项
        pingCommand(),
        versionCommand(deps),
        stopCommand(),
    ];
    // help 需要访问完整列表（含自身），通过闭包惰性引用
    commands.push(helpCommand(deps, () => commands));
    return commands;
}
//# sourceMappingURL=index.js.map