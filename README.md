# 锻卡炉（Card Forge）

Vue 前端、Node 后端和临时酒馆预览服务，包含当前创作提示词和长文世界书提炼功能。

## 开发与验证

需要 Node.js 20+、npm 和 Python 3。后端没有第三方运行依赖，前端依赖由锁文件固定。

```bash
npm ci --prefix web
npm run check
npm run audit:sensitive
npm run build
npm test
HOST=127.0.0.1 PORT=18787 DATA_DIR=../data TRUST_PROXY=false npm start
```

打开 `http://127.0.0.1:18787`。HTTP 集成测试会访问构建后的首页，因此首次运行测试前需要先构建前端。配置优先级为环境变量、`server/config.json`、默认值；示例见 `.env.example` 和 `server/config.json.example`。启动命令不会自动加载 `.env`。免费模型、管理后台、统计账本和酒馆预览需分别配置。

联网搜索：在服务端环境变量 `DEEPSEEK_API_KEY` 或私有 `server/config.json` 的 `deepseekApiKey` 中填写 DeepSeek 官方密钥，重启后端并刷新网页后启用。写卡 agent 可通过 `web_search` 按需查询资料；自带 API 和站内免费模型共用这项能力，搜索密钥始终保留在后端。搜索按 [DeepSeek Search API](https://api-docs.deepseek.com/guides/search/) 单独计费。默认每 IP 每分钟 6 次、每日 30 次成功且非空的搜索，可用 `WEB_SEARCH_RATE_PER_MINUTE` / `WEB_SEARCH_DAILY_REQUESTS_PER_IP` 调整；额度与创作模型独立。

## 目录

- `web/src/`、`web/public/`、`web/test/`：前端、公开资源和测试。创作提示词位于 `web/src/lib/creation-prompts.js`。
- `server/`：网站后端与测试。
- `lab/`：酒馆源码、Dockerfile、桥接脚本、测试及固定上游版本。
- `deploy/`：通用服务模板和构建脚本，生产连接信息由管理员单独保管。
- `docs/`：产品说明和脱敏审计说明。
- `_gui-test/`：本地固定构建输入，不进入 Git。
- `artifacts/`、`web/dist/`：生成结果，不进入 Git。

## 部署与固定资源

通用示例见 `deploy/card-forge.service` 和 `deploy/nginx.conf.example`。实际服务器地址、账号、部署路径、发布记录和运维脚本保存在项目之外的受限目录，不随源码分发。

固定第三方源码与缓存就绪后，可用 `python3 deploy/lab-build-context.py` 重新生成酒馆构建上下文。版本由 `lab/pinned-revisions.json` 固定；没有独立上游 Git 元数据时不会读取父项目 HEAD。上游资源遵守各自许可证。资源交接清单和原始归档由管理员另行保管。

## 敏感信息

运行前通过环境变量或本地私有配置提供真实凭据。生产配置、内部地址和连接信息不得提交。`npm run audit:sensitive` 检查项目内自有文件中的常见密钥格式、非示例 IP、内部 URL 和个人部署路径；不会打印匹配值。审计范围与处理结果见 `docs/security-audit.md`。

本仓库从最新源码快照建立独立 Git 历史，不包含原项目历史、运行数据、私有运维资料或生成产物。项目使用 [MIT 许可证](LICENSE)；字体和第三方源码保留各自许可证。
