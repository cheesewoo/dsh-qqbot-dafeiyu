# dsh-qqbot 测试清单（收敛 v0.5.0 验收用）

> 用途：v0.5.0 收敛 / 每次改动后的回归验收。逐项打勾，❌ 的项记下现象。
> 注意：标注 ⚠️ 的项在修好对应 bug 前**预期失败**，不算回归错误。

## 测试前提

- [ ] 已跑 `pnpm install`（两个 profile）并**重启 dsh**，`/bot-version` 显示 v0.5.0
- [ ] 确认只有一个 profile 在跑（没有 `--profile qqbot` 和 `--profile web` 同时运行）
- [ ] 准备：1 个测试群、1 个私聊对象、sdwebui(7860) 或 minimax key、可用的 TTS

---

## A. 启动与连接
- [ ] 空配置首次启动 → 扫码绑定，凭据自动写入 `cordis.patch.yml`
- [ ] 已配置启动 → 不弹扫码，直接 Bot ready
- [ ] 环境变量 `QQBOT_APPID`/`QQBOT_SECRET` 优先于配置文件
- [ ] 凭据缺失且扫码失败 → 明确报错且进程不崩
- [ ] 改 `cordis.patch.yml` 触发热更新重连
- [ ] 两个 profile 不同时连同一 appId

## B. 消息收发
- [ ] 私聊 C2C 任意消息可收到并回复
- [ ] 群聊 `requireMention=true`：仅 @ 机器人触发
- [ ] 群聊 `requireMention=false`：关键词/热闹触发
- [ ] `groupTriggerKeywords`（大肥鱼/画画…）命中即响应
- [ ] 热闹模式：窗口内消息达阈值进入、冷却期内不刷屏
- [ ] ⚠️ 回声过滤（`skipSelfEcho:false` 修复前，机器人自己的消息可能自触发）
- [ ] 消息去重：重复推送只处理一次

## C. 拟人化行为（BehaviorController）
- [ ] 睡眠窗口内：普通消息不理；@ 达 `sleepWakePokes` 次被吵醒；固定回复正确
- [ ] 睡眠中主人 @ → 立即叫醒走模型
- [ ] 睡眠中提名字未 @ → 记入未读、醒来补回
- [ ] 醒着按 `busyChancePerHour` 概率进"画画"，时长在 `busyMinMs~busyMaxMs`
- [ ] 画画中 @ 达 `busyWakePokes` 次停笔回应；否则回 `busyFixedText`
- [ ] `masterOpenids` 主人判定正确
- [ ] 非主人长文（> `maxMessageChars`）且未 @ → 忽略
- [ ] `nameMentionKeywords` 可配置生效

## D. 生图
- [ ] pollinations：免 key 出图并发送
- [ ] minimax：填 key 出图；key 缺失有提示
- [ ] sdwebui(7860)：txt2img 出图；带参考图走 img2img
- [ ] novelai / erpsex 出图
- [ ] 宽高/steps/cfg/sampler 参数生效
- [ ] 生图失败时自然说明、不反复重试
- [ ] `/x-qqbot-imagegen` 设置页读写 `qqbot-imagegen.json`；非本机访问 403

## E. 语音 TTS
- [ ] edge-tts 默认音色生成并发送
- [ ] rvc 自定义音色（服务未启动有提示）
- [ ] 默认音色读 `~/.dsh/tts-rvc/last-voice.json`

## F. 访问控制
- [ ] c2c/group 三态：open / allowlist / disabled 生效
- [ ] 白名单命中放行、不命中拒绝
- [ ] ⚠️ `allowlist` + 空白名单 = 拒绝所有人（`['*']` 兜底修复前 = 放行所有人）

## G. 会话管理
- [ ] 同 peer 路由到同一会话（确定性 sessionId）
- [ ] 重启后可 resume 不丢上下文
- [ ] 空闲超 `sessionIdleTimeout` 驱逐
- [ ] `/bot-model provider/model` 切换：fork 保留上下文
- [ ] `/bot-reset` / `/bot-new` 清空上下文
- [ ] `/bot-status` 显示正确
- [ ] 会话导出内容正确

## H. 指令
- [ ] `/bot-help`（页脚显示 v0.5.0）
- [ ] `/bot-model`（无参列可用模型 / 有参切换）
- [ ] `/bot-status` `/bot-reset` `/bot-clear` `/bot-new` `/bot-ping`
- [ ] `/bot-version`（显示 v0.5.0）
- [ ] `/bot-stop`（隐藏）能中止生成

## I. 中间件链 / 输出
- [ ] 引用解析、@marker 清洗、表情清洗
- [ ] 文件附件下载并注入上下文（解压/读取）
- [ ] 长回复按 `textChunkLimit` 切分
- [ ] 流式输出（c2c）正常；群聊不流式
- [ ] 工具结果：错误始终展示，成功按 `showToolResults`
- [ ] 轮次异常结束有提示（非 STREAM_CLOSED）

## J. 可视化回归（做 UI 后）
- [ ] 每个开关保存后真实生效
- [ ] 数值单位（ms→分钟/秒）换算正确
- [ ] 逗号串→数组编辑器读写正常
- [ ] 保存触发热更新且不丢其它配置

## K. 边界 / 异常
- [ ] WebSocket 断线自动重连
- [ ] 二维码过期刷新
- [ ] 超长消息/并发洪峰不崩（maxQueue / processingTimeoutMs）

---

### 记录区
| 日期 | 环境(profile/版本) | 通过/失败 | 备注 |
|---|---|---|---|
|  |  |  |  |
