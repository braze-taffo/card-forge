# 临时云酒馆

角色卡编辑页的“酒馆预览”将导出当前草稿副本，在 预览服务器 启动隔离的真实 SillyTavern，仅供玩家亲自试聊。每场只有一个玩家酒馆，通过原生 API 导入角色和世界书，服务器不启动 Chromium。开场、TavernHelper、MVU 和角色脚本由玩家网页实际初始化；网页接入前 state 返回 awaitingPlayer，不伪造已加载的脚本或变量。记录存回当前浏览器草稿，旧历史报告保留。

用户界面是通过 `https://lab.tellev.click` 嵌入的真实 SillyTavern 网页，文字由本机浏览器渲染，输入、选择、复制、滚动和酒馆工具栏均使用原生交互。独立域名隔离角色脚本与主站密钥、草稿及存储；短时签名入口换取 HttpOnly 会话 cookie，不能直接从公开地址访问其他人的酒馆。

固定版本的公共网页资源镜像在 网站服务器，带签名会话校验、内容摘要和短时浏览器缓存，避免反复穿过测试隧道。`/lib.js` 必须导出酒馆 Webpack 中间件实际提供的编译产物；不能复制 `public/lib.js` 源码。用户数据、HTML 启动配置和 API 仍只访问所属临时容器。页面加载期间显示转圈，超时可以重新打开网页，无需重新创建会话。

不提供 Agent 会话、截图和远程操作接口。`action`、`frame` 与 `actor=agent` 在主站和管理器均拒绝访问。玩家直接操作嵌入的网页，桥接仅负责保存观察记录、刷新当前聊天和模型流转。

## 模型与额度

真实酒馆使用正常 `Generate('normal')`，原生角色、世界书、正则和模板参与组装提示词。服务器只排队请求；玩家浏览器通过锻卡炉原有模型通道完成调用。自带密钥不传到 预览服务器，站内免费请求仍由原网站统计和限额。预览窗口必须保持打开。

单环境最多 40 次酒馆请求。模型回复以有序 SSE 片段传回酒馆，完成后补齐剩余文本；重复片段不重复追加，乱序片段拒绝。已领取请求不自动重放，防止刷新导致重复收费；浏览器消失后请求超时，需要重新发送。

## 运行边界

最多 4 个活动环境，另有 3 个候补位置；冷启动依次进行。每个浏览器同时 1 个环境，每 IP 每小时最多新建 6 次。每场容器上限 768 MiB、1 CPU、384 个进程；只运行一个酒馆后端。环境硬上限 45 分钟，5 分钟不活动回收。记录约每 10 秒保存到浏览器，保留最近 5 次环境记录。管理器重启会回收本项目标记的容器，部署激活脚本必须等到所有访客会话结束。

固定镜像在构建时编译酒馆库；运行时验证编译文件存在，复用上游相同的 lib.js 服务路径，省去每次开场的 Webpack 编译。世界书转换模块从固定上游源码逐字提取，保留全部原生字段、默认值和 originalData。扩展使用 modulepreload 提前下载，页面发送真实加载阶段；ready 后清除超时提示。

原生网页核心模块在镜像构建时合并为一个带内容摘要的共享文件；原有 ESM 路径保留为薄入口，共享实时绑定，供扩展继续导入。`lib.js` 仍使用上游编译产物。网站服务器 的酒馆子域名启用 HTTP/2 和压缩。资源配置版本变化时，首次进入仅清除旧 HTTP 缓存，不清除 cookie、存储或草稿。浏览器回传真实 readyMs 和最慢资源时长，用于区分容器准备与网页初始化。

原生 HTML 中连续的 14 个传统库脚本按原顺序、原源码拼接为一个带摘要的文件，减少远距离网络上的逐次阻塞下载；原路径文件仍保留。构建发现序列变化或脚本依赖自身 URL 时拒绝打包。扩展 `.mjs` 使用 JavaScript MIME，参与压缩。

包含 TavernHelper、ST-Prompt-Template，可加载固定 MVU。版本见运行返回的 `profile` 和 `profile.json`。常用脚本依赖预先缓存，容器不通互联网；未缓存的 CDN、图片、其他版本 MVU、任意扩展网络请求会被阻止并显示运行记录，不宣称所有卡片兼容。

Docker 独立 socket/data root，非 root Chromium 开启 sandbox；容器只读、去除能力，仅为旧内核 sandbox chroot 保留 SYS_CHROOT。固定内部网络加主机 INPUT 限制；管理接口只监听本机，通过严格受限 SSH 反向隧道连接 网站服务器。门户使用签名 HttpOnly owner cookie，不公开管理 token。

## 文件与部署

- `manager.py` / `capacity.py`：环境、四场并发、队列、TTL、所有权、回收；Python 3.6 标准库。
- `worker.mjs` / `bridge/`：真实玩家酒馆、初始化、模型队列、变量观察。
- `browser-proxy.mjs`：原生网页代理、固定模型路由、依赖缓存与流式响应。
- `../server/lab-static.mjs`、`../deploy/lab-static-*`：带鉴权的公共资源镜像、编译产物检查与部署。
- `../server/lab.mjs`：主站所有权校验、隔离域名入口与签名会话。
- `../web/src/components/TavernLab.vue`：玩家预览与记录界面。
- `../deploy/lab-cache-assets.py`、`lab-build-context.py`：缓存与构建上下文。
- `../deploy/lab-player-integration.py`：四场同时运行、第五场补位、无服务器浏览器和原生玩家交互回归；仅回归浏览器临时提高自有 fixture 内存，正式每场为 768 MiB；回复使用受控 fixture。
- `../deploy/lab-worldbook-module.py`：提取固定上游世界书转换及依赖常量，源码结构变化时拒绝静默生成。
- `../deploy/lab-player-runtime.py`：备份旧配置，激活固定玩家镜像；有访客会话时拒绝切换。
- `../deploy/lab-publish.py`：沿用原 网站服务器 发布/回滚流程。
- `../deploy/lab-native-nginx.py`：仅管理 lab 子域名、证书与无缓冲代理，保留已有主站及中转站配置。

预览服务器 服务：`card-forge-lab-docker`、`card-forge-lab`、`card-forge-lab-tunnel`；文件位于 `/opt/card-forge-lab`。网站服务器 额外加载 `/etc/card-forge/lab.env`（0600，包含私有连接信息）。不向前端写入 token，也不要打印这些配置。

停用：从 网站服务器 移除或清空 lab.env 中 LAB_CONTROL_URL/TOKEN，再重启原网站服务；前端入口随配置隐藏。停止 预览服务器 的 manager 后，仅清理 `card-forge.lab=1` 标签的容器，随后停止 tunnel 和本项目 Docker 服务。不要操作其他 Docker 实例。
