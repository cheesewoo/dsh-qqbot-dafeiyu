# dsh-qqbot 本地收敛仓库说明（DEPLOY.md）

> 本仓库是把「富版本 dsh-qqbot」从 `profiles\web\node_modules` 里抢救出来、
> 收敛成可版本控制的独立包。**读这个文件前先看 README.md 了解插件功能。**

## 为什么会有这个仓库（背景）

- npm 上发布的 `@tencent-connect/dsh-qqbot@0.4.0` 是**精简版**。
- 你在 `profiles\web` 用的那份 node_modules 是装完后被**直接改过 dist** 的富版本
  （大肥鱼拟人化行为 `behavior/controller.js`、生图/语音工具、关键词触发等）。
  两份 `pnpm-lock.yaml` 里同一 integrity 证实了这一点 → 一旦 `pnpm install`，改动会被冲掉。
- 原始 TypeScript 源码已丢失：dist 的 `.js.map` 里 `sourcesContent` 被剥离，无法反解。
- **因此本仓库以"可读、带注释的 ESM JS"作为维护代码**（放在 `dist/`），不再有编译步骤。

## 仓库结构

```
dist/                     # 代码本体（ESM JS + .d.ts），改这里
  behavior/controller.js  # 拟人化行为状态机（睡/忙/醒）
  gateway/bootstrap.js    # 接线：生图设置页、generate_image / text_to_speech 工具
  ...（与 npm 包同构）
cordis.yml / cordis.patch.yml   # 插件 bundle patch（随包分发）
package.json              # v0.5.0；main 指向 dist/index.js
```

## 日常怎么改

1. 直接编辑 `dist/**/*.js`（保留了原 TS 的结构和中文注释，可读性没问题）。
2. 校验：`node --check dist/<改动的文件>.js`
3. 部署（任选其一）：
   - **推荐（一次性，之后自动同步）**：把两个 profile 的依赖改成
     `"@tencent-connect/dsh-qqbot": "file:本仓库绝对路径"`，然后在该 profile 下跑
     `pnpm install`。pnpm 会用符号链接指向本仓库 → 改完即生效，无需再拷贝。
   - **临时**：把 `dist/` 拷回 `profiles\<name>\node_modules\@tencent-connect\dsh-qqbot\dist\`，
     重启 dsh（或触发热更新）。注意：这种方式下再跑 `pnpm install` 会把富功能冲掉。

## 安全提醒

- `cordis.patch.yml` 由扫码绑定自动写**明文 appSecret**，勿提交/分享。
- 两个 profile 共用同一个 appId（1905502975）：**不要同时启动** `--profile qqbot`
  和 `--profile web`，否则会双回复。
- 版本显示：`/bot-help`、`/bot-version` 里的版本号是硬编码字符串，改 package.json
  版本时记得同步（本仓库已统一为 0.5.0）。

## 收敛前的双份对照（备忘）

| 项 | profiles\qqbot（精简，= npm 0.4.0） | profiles\web（富版本，已入本仓库） |
|---|---|---|
| behavior/controller.js | 无 | 有 |
| config schema 字段 | ~17 个 | ~40 个（+imageGen/触发/拟人化） |
| bootstrap.js | 3KB | 23KB（+生图页/工具/行为门控） |
| 备注 | 旧测试遗留 | **当前在用的真身** |
