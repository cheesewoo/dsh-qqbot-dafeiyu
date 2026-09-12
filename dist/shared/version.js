import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * 包版本号：运行时从 package.json 读取。
 *
 * 早先 `/bot-help` 与 `/bot-version` 各自硬编码版本字符串，改 package.json
 * 时容易忘记同步（DEPLOY.md 里专门写过这条警告）。这里统一成单一来源。
 */
export const PKG_VERSION = (() => {
    try {
        const here = dirname(fileURLToPath(import.meta.url));
        const pkgPath = join(here, '..', '..', 'package.json');
        const version = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
        return typeof version === 'string' && version.length > 0 ? version : 'unknown';
    }
    catch {
        return 'unknown';
    }
})();
