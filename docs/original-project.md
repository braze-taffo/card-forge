# 锻卡炉（Card Forge）

AI 协作创作 SillyTavern 角色卡 / 世界书的网页应用。从 Tellev Android 版「AI 协作创作」模块移植，保留完整功能，适配桌面与手机浏览器。

## 功能

- **创作会话**：与创作 agent 对话，agent 通过工具回路直接写结构化草稿——角色卡字段、多开场、示例对话、系统提示、内嵌世界书、TavernHelper 脚本 / 变量 / 正则
- **创作起点表单**：引导对话 / 直接出初稿、多角色卡、篇幅档位、逐条讨论世界书
- **创作提示词**：所有模型共用按角色卡/世界书任务组织的写作规则；字段分工、具体人物行为、样本文风、局部修改范围及玩家自主性统一约束，关键缺口一次只问一个问题
- **长文世界书提炼**：粘贴或导入小说原文（≤12MB / 400 万字符），逐段提取、断点续传、无证据条目拒收；聊天支持搜索原文和分段读取，读取时不做哈希校验
- **草稿管理**：IndexedDB 本地保存（会话 / 原文 / 封面分离存储），断线续作、删除清理
- **导入**：SillyTavern 角色卡 JSON / PNG（chara+ccv3）、世界书 JSON；「基于此卡写世界书」
- **导出**：V2 JSON（回读校验）、含 `chara` 元数据的 PNG 角色卡（SillyTavern 可直接导入）、独立世界书 JSON；导出前敏感字段脱敏
- **前端预览**：开场 HTML 片段沙箱预览（无脚本、无网络）+ 可移植性检查
- **双通道模型**：站内免费模型（服务端代理，密钥不下发）或自带 API（Base URL + 密钥，浏览器直连）
- **后台统计**：访问/IP 去重、每 IP 与每免费模型调用、成功/失败/中断/限流、实际 token；只读接入同机 New API 历史用量，区分专用令牌与全站中转总量

## 目录结构

```
card-forge/
├── web/          # Vue 3 + Vite 前端
│   ├── src/lib/  # 引擎移植：工具协议、创作回路、卡片模型、PNG、IndexedDB、SSE 客户端
│   ├── src/store.js    # 全局状态与动作（ViewModel 移植）
│   ├── src/views/      # 首页 / 编辑器 / 设置
│   └── test/     # node --test 单测（含提示词路由、接口地址、中断恢复、自定义回答与关联创作）
├── server/       # 零依赖 Node ≥18 后端：静态托管 + 免费模型 SSE 代理 + 限流额度
└── deploy/       # nginx 与 systemd 示例
```

## 本地开发

```bash
cd web
npm install
npm run dev          # http://localhost:5173（/api 代理到 127.0.0.1:8787）

cd ../server
node index.mjs       # 未配置免费模型也可启动；自带 key 模式不依赖后端 API

cd ../web && npm test   # 单测
cd ../server && node --test   # 统计、账本、鉴权、额度与 SSE 回归测试（账本测试需要 Python 3）
```

## 部署

1. **构建前端**：`cd web && npm install && npm run build`（产物 `web/dist/`）
2. **配置后端**：`cp server/config.json.example server/config.json`，填入：
   - `freeBaseUrl` / `freeApiKey` / `freeModel`：你的 OpenAI 兼容网关（如 New API）。不配置则免费通道关闭，站点仍可用（用户自带 key）
   - `freeModels` / `FREE_MODELS`：可选免费模型白名单，格式为 `[{"id":"模型 ID","name":"显示名称"}]`。前端可以选择列表中的模型；未列出的型号会返回 400。未配置列表时继续兼容单个 `freeModel`。
   - `ratePerMinute` / `dailyRequestsPerIp`：防滥用限额（默认 6/分钟、30/天/IP）
   - `accessCode`：可选访问码
3. **启动**：`node server/index.mjs`（默认 8787，`PORT` 可改），或用 systemd：
   `sudo cp deploy/card-forge.service /etc/systemd/system/ && sudo systemctl enable --now card-forge`
4. **nginx 反代**（可选，见 `deploy/nginx.conf.example`）：注意 `/api/` 必须 `proxy_buffering off`，否则 SSE 流式会被攒住

所有配置都可用环境变量覆盖（`FREE_BASE_URL`、`FREE_API_KEY`、`FREE_MODEL`、`PORT` 等）。
后端默认监听 `127.0.0.1`，可通过 `HOST` 调整。正式部署的上游密钥只保存在服务器，不进入前端产物。通用部署示例见 `deploy/card-forge.service` 与 `deploy/nginx.conf.example`。

## 与 Android 版的对应关系

| Android (app.tellev.feature.creation) | Web (web/src/lib) |
|---|---|
| CreationEngine.kt（对话回路/提取） | engine.js |
| 网页创作系统提示词与快捷指令（独立维护） | creation-prompts.js |
| CreationToolProtocol.kt（工具块/DSML/原生调用解析） | tool-protocol.js |
| CreationToolBox + CreationAdvancedAssets | toolbox.js |
| CreationModels.kt + CharacterExporter + WorldBookCodec | models.js |
| PngCardParser.kt | png.js |
| CreationRepository.kt（草稿文件存储） | idb.js（IndexedDB） |
| CreationViewModel.kt | store.js |
| CreationScreen.kt | views/ + components/ |

工具回路沿用 Android 版的 32 轮上限、连续三轮停滞报错、检查点保存和 ask_user 交互。网页内嵌世界书按酒馆 CCv2/v3 标准导出 entries 数组，独立世界书保持 ST entries 对象，兼容旧网页的对象格式导入，保留原生扩展。

## 临时云酒馆预览

角色卡编辑页的“酒馆预览”会在 预览服务器 启动真实 SillyTavern，包含 TavernHelper、变量框架和动态状态栏支持。玩家通过隔离子域名嵌入的原生网页亲自试聊；最多同时开放四场，后续申请排队。每场仅运行一个玩家酒馆，通过原生 API 导入角色与世界书，复用镜像内的编译库，服务器不启动浏览器。模型回复逐片段传回酒馆，记录保存到当前浏览器草稿。手机入口为独立的图标文字按钮。运行方式、部署与限制见 [lab/README.md](lab/README.md)。

## 已知边界

- 关联流程已覆盖脚本化工具回路、浏览器操作、上游标准校验和 PNG 回读；生成内容的文学质量仍需创作者审核
- 浏览器直连自带 key 时，目标网关需允许 CORS（主流 OpenAI 兼容服务均支持）
- 生成的 TavernHelper 脚本可通过云酒馆实际聊天验证；未缓存的外部资源会被阻止，不能据此宣称所有扩展兼容
