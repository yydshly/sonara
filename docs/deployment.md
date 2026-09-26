# 部署与发布

## 单仓库、多入口

`SONARA_SITE_TARGET` 支持 `portal`（默认）、`studio`、`song`、`lab`、`score`、`tools`。所有构建都保留统一导航和其他页面；该参数只改变站点首页。将同一仓库连接到多个托管项目，分别设置此参数，即可独立部署各空间。

默认构建 `npm run build:site`，产物 `build/site/`。用于根域名部署时不设置 `SONARA_BASE_PATH`；用于 GitHub 项目站点时设置为 `/sonara`。公开代码和音频引用会按基础路径构建，不能简单复制本机 `dist/` 作为远端完整体验。

GitHub Pages 一个仓库只提供一个站点；本配置在该站点下提供统一首页及 `/studio/`、`/song/`、`/lab/`、`/score/`、`/tools/` 独立地址。若需要多个独立域名站点，使用同仓库多托管项目配置，不能把多个页面描述为多台已运行的服务器。

## 发布内容

- 网页源码和公开示例乐谱来自 `dist/`。
- `published/` 是按明确示范名单导出的 MP3、词谱与只读数据，有 `inventory.json` 散列清单。
- `scripts/export-web-preview.py` 仅由本机维护者主动运行；不会导出整个 `.local/`，也不在 CI 中调用本机 Codex。
- `scripts/build-site.mjs` 无需网络、模型或密钥即可从已提交文件构建。
- `remote-runtime.js` 只在发布包加载，将只读示范映射到静态资源，并拒绝后台写入；原始本机程序不使用该适配器。
- 浏览器内导入、混音和导出不通过远端后台，仍可使用。新歌生成与重新演唱不在静态站点运行。

源码提交排除 `.env`、`.local/`、声库、模型、原始 WAV、诊断日志和本机验证资料。仓库权限与网页访问权限分别由托管平台控制，不能把“私有源码”理解为“网页也私有”。

## GitHub Actions

`checks.yml` 在提交与 PR 上运行检查、测试和静态构建。`pages.yml` 在推送 `main` 后自动部署整个统一站点，也支持手动触发；启用 Pages 的 GitHub Actions 发布方式后使用。

`package-space.yml` 可选择一个独立入口，输出对应发布包。它只是可下载的部署产物，不意味着已在外部托管平台创建了另一个站点。

GitHub Pages 支持范围以[官方说明](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)为准：免费账户可使用公开仓库，私有仓库需要支持的付费计划。若账户不支持私有仓库 Pages，保留仓库私有并选择其他静态托管，或由仓库拥有者明确选择公开源码。

## 发布状态

- 源码仓库：[yydshly/sonara](https://github.com/yydshly/sonara)，已按拥有者确认设为公开。
- 统一入口：[声间音乐创作室](https://yydshly.github.io/sonara/)。
- 独立功能地址：[故事与歌曲](https://yydshly.github.io/sonara/studio/)、[青春歌曲](https://yydshly.github.io/sonara/song/)、[声音与风格](https://yydshly.github.io/sonara/lab/)、[按谱试唱](https://yydshly.github.io/sonara/score/)、[音轨工作台](https://yydshly.github.io/sonara/tools/)。
- 进展页：[当前进展与能力边界](https://yydshly.github.io/sonara/progress.html)。
- 首次源码提交：`7953b7fa9a02840b00a5804668ae39750e8db255`。
- [首次远端检查](https://github.com/yydshly/sonara/actions/runs/36261639539)与[首次部署](https://github.com/yydshly/sonara/actions/runs/36261732010)成功，网页已实际打开验证。

以上为一个 Pages 站点内的统一首页和五个功能地址。六种独立构建配置仍保留；尚未在其他平台建立多个独立站点。后续推送 `main` 将重新检查并发布全部页面，部署结果见仓库 Actions。
