# 变更记录

## 0.2.1 — 2026-09-17 · 修：漏写 `exports["./client"]` 把整台 DSH 打进安全模式

**现象**（用户报告）：重启后 DSH 进安全模式，技能目录从 15 个缩到 3 个，`/cc/`、`/bl/`、`/tds/` 等**所有**自研插件路由一起 404。

**真凶是我上一轮加 client 半时漏的一行**。宿主日志逐字对上了：

```
Error: client-modules: dsh-output-shape declares dsh.client but exports no "./client" bundle
    at ClientModuleRegistry.resolveMeta (…/@deepseek-ai/dsh-client-modules/lib/index.js:681:35)
    at ClientModuleRegistry.flush (:875) ← new ClientModuleRegistry (:504)
[desktop] safe mode: third-party web profile bundles are blocked
```

**为什么一个插件的错会让全部插件消失**：`ClientModuleRegistry` 在**构造期**同步遍历所有 loader entry 并 `flush()`，任一包抛错即 `ClientPackageCompositionError` ⇒ 整张图组装失败 ⇒ 桌面端判定"启动失败"，退到最小平滑进安全档（`SAFE_MODE_BUNDLES` 只有 `dsh-base` + `dsh-web-app`）。所以症状是全局的、元凶是局部的——**别被"所有插件都挂了"误导成宿主坏了**。

**修法**：`package.json` 补 `"./client": "./client.js"`（本机另外 6 个带界面的插件都是这个形状，抄它们就行）。顺带把 description 里已过期的"默认关／要切换请先删 R4"改成 v0.2.0 的真状态。

**这类 bug 为什么测不出来**：当时 70/70 全绿。因为两套测试分别 `import index.js` 和用 `new Function` 跑 `client.js`，**都不经过 Node 的 exports 解析**——清单少一行对代码路径毫无影响，只有宿主的取包动作会撞。故新增 `tools/verify-manifest.mjs`（12 项）专测清单自洽性：`dsh.client ⇄ exports["./client"] ⇄ 文件存在 ⇄ files 列表 ⇄ peerDeps.react`，并与同机插件横向比对写法是否一致。另留 `tools/diagnose-client-export.mjs`（跨包手工诊断，非 CI 套件）。

**退出安全模式**：不能靠删文件——安全档由桌面端的 `--safe-mode` / 管理界面控制，出口是管理界面里的 restart → `launchHarness()`。**在安全模式窗口点「重启 / Restart」**即可回正常档（修复已在盘上，重启就能加载）。

## 0.2.0 — 2026-09-16 · 加界面：输入条 chip「形状」+ 设置页分区「输出形状」

**需求**（用户 2026-09-16）：v0.1.0 是纯宿主侧，装完界面上零存在感——"要能看见、要有明显的开关"。

**做法**：

- 新增 `client.js`：两处入口共用 host 的 `/os/*` 数据源。
  - **chip「形状」**（`conversation.input.right`，order 210）：点一下直接切常驻注入，徽标显示 开/关。
  - **设置 → 输出形状**（`settings.section`，order 66）：同一个开关 + 状态明细（技能注册、实际注入、是否表过态、规则体积/上限、逃生开关）+「查看模型实际看到的规则正文」抽屉。
- 新增路由 `GET /os/shape.json`：返回**注入形态**正文（已剥 frontmatter、花括号已中和、按上限截断）。预览即模型所见，不另开一条读原文的路。
- `GET /os/settings.json` 响应改形：`settings.alwaysOn` 给**生效值布尔**（界面能直接画开关），另用 `declared` 表达"有没有写过 settings.json"——否则"没表态"会被渲染成"已关"这种假事实。
- `package.json` 补 `dsh.client` 与 react peerDep；`files` 加 `client.js`、`CHANGELOG.md`。

**照抄的两条硬规矩**（都来自 dsh-cache-control 的真实事故）：

1. 没成功读到过设置前绝不 PUT —— 那时内存里是默认值，一次保存就把用户真实配置盖掉。
2. chip 渲染抛错要有错误边界显示占位 —— 被槽静默丢弃的表现是"插件装了但什么都没发生"，最难查。

**验证**：`npm test` ⇒ 套件 **2/2 通过**：`verify-shape` **51**（原 46 + 新路由 5 项）、`verify-client` **17**（离线渲染 chip/设置页、槽注册契约、PUT 载荷只有一个键、未 loaded 时拒写、预览走 shape.json）。

**生效范围**：client 半刷新页面即可（宿主 `/plugins` 路由会重建 bundle）；若连 host 半一起改过（本次改了 `index.js` 的路由），需要**重启 DSH Desktop**。

