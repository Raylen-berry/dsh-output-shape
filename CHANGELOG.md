# 变更记录

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

