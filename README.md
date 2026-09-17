# dsh-output-shape

把 [ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd)（MIT）的输出形状规则做成 DSH 插件。

规则只有一份真源：`skills/i-have-adhd/SKILL.md`。两种用法都读它：

| 形态 | 默认 | 说明 |
| --- | --- | --- |
| **技能 `i-have-adhd`** | **开** | 注册进技能目录，模型/用户按需调用。说"关闭 ADHD 模式"即停。 |
| **常驻注入 system prompt** | **关** | 段名 `dsh-output-shape:output-shape`、order 405。打开后对**所有**会话的每一个 model step 生效。 |

> **为什么常驻默认是关的**：`dsh-cache-control` 的会话守则里已经有一节等价的
> `R4 输出形状`。两处都常驻 = 同一套规则注入两遍 = 每请求多花一份 token
> （还会在每个子代理、每个 workflow 子会话里再乘一遍）。要么用技能形态，要么把
> R4 删掉再打开这里的常驻注入，别同时开。

## 规则内容

P1 首行即可行动 · P2 多步编号 · P3 收尾一个下一步 · P4 跑题后置 · P5 状态复述 ·
P6 时间估计具体 · P7 战果可见 · P8 报错讲因果 · P9 展示分组 ≤5 条 · P10 无开场白无客套。
另有 6 条破例条款（解释模式、破坏性操作、debug 打转、真歧义、规则与任务打架、规则与宿主打架）
与一趟发送前自检。

## 安装

```powershell
dsh plugin --profile web add link:D:/DeepSeek/dsh-plugins/dsh-output-shape
```

装完**重启一次 DSH Desktop**：宿主行与新技能目录都在启动时扫描。
之后改**已有**技能正文仍需重启；`POST /os/skills/reload` 只能让新增的技能目录免重启生效
（技能注册同名 first-wins）。

## 界面（v0.2.0）

| 位置 | 插槽 | 说明 |
| --- | --- | --- |
| 输入条右侧 chip「形状」 | `conversation.input.right`（order 210） | 点一下直接切常驻注入，徽标显示 开/关。cache-control 的 chip 在 order 200，故意错开 |
| 设置 → 输出形状 | `settings.section`（order 66） | 同一个开关 + 状态明细（技能注册、实际注入、是否表过态、规则体积/上限、逃生开关）+「查看模型实际看到的规则正文」抽屉 |

两处入口共用同一份数据源（本插件的 `/os/*` 路由），没有第二份状态。
DOM 锚点是契约名，改名要同步 `dsh-plugins/INTERFACES.md`：
`data-os-chip` · `data-os-toggle` · `data-os-state` · `data-os-switch` · `data-os-page` · `data-os-preview` · `data-os-err`。

chip 拨的是**常驻注入**，不是"技能开不开"——技能装了就在目录里、按需加载不占 token，没有开关可言。
设置页顶部会写明与「会话策略」R4 的关系：**两边同时开＝同一套规则注入两遍**。

## 换成常驻注入（可选，三步不中断）

```powershell
# ① 打开常驻（或直接点输入条上的 chip「形状」）
curl.exe -X PUT http://127.0.0.1:43129/os/settings.json -H "content-type: application/json" -d "{\"alwaysOn\":true}"
# ② 确认 injected=true（下一个请求就生效，无需重启）
curl.exe http://127.0.0.1:43129/os/state
# ③ 把 dsh-cache-control 的 session-gate.md 里「## R4 输出形状」整节删掉（存盘即生效，无需重启）
```

回退：把 `session-gate.md` 的 R4 粘回去，再把 `alwaysOn` 设回 `false`。

## 路由（前缀 `/os/`）

| 路由 | 方法 | 作用 |
| --- | --- | --- |
| `/os/state` | GET | 段名/order/已注册技能/当前是否注入/是否被 env 关掉/注入文本的字节三元组 |
| `/os/settings.json` | GET · PUT | 读/写 `$DSH_HOME/dsh-output-shape/settings.json`。GET 返回**生效值** `settings.alwaysOn`（界面能直接画开关）＋ `declared`（有没有写过，没写过是 `null`）。PUT 后**下一个请求即生效**，无需重启 |
| `/os/shape.json` | GET | **注入形态**正文（已剥 frontmatter、花括号已中和、按上限截断）＋同源字节三元组。预览即模型所见 |
| `/os/skills/reload` | POST | 补注册新增的技能目录（同名 first-wins） |

裸 GET 一律不改状态；写方法打到只读路由返回 405。

## 配置

`cordis.patch.yml` 的 config（**整块替换**，覆盖时把其它键一起写）：

| 键 | 默认 | 含义 |
| --- | --- | --- |
| `registerSkills` | `true` | 是否把 `skills/` 注册进全局技能目录 |
| `alwaysOn` | `false` | 常驻注入的**默认值**，仅在 settings.json 不存在（还没表态）时生效 |
| `maxBytes` | `16384` | 常驻注入文本的字节上限（这段文本每请求重复计费） |

优先级：**逃生开关 > settings.json > config.alwaysOn**。

逃生开关（技能注册不受影响）：

```powershell
$env:DSH_OUTPUT_SHAPE_DISABLE = '1'
```

## 状态与换机器

- 开关落在 `$DSH_HOME/dsh-output-shape/settings.json`，**不随仓库走**。换机器后要重新表态，
  否则表现为"装了但还是默认不常驻"（技能形态不受影响，装了就有）。
- 技能与注入文本都直接读仓库里的 `SKILL.md`，**改盘即生效**（按 mtime+size 记忆化）。

## 测试

```powershell
npm test                       # = node tools/run-all.mjs
node tools/run-all.mjs --list  # 只看清单
```

`tools/verify-shape.mjs` 覆盖 46 项：技能 frontmatter 解析（含块标量）、`shapeBody` 剥 frontmatter、
花括号中和、截断三元事实与两个边界（含"靠长度比会漏判/误报"的反向照妖镜）、
开关优先级三档、`apply` 的段注册契约（名字/order）、三条路由与 405/400 分支。
全程在临时 `DSH_HOME` 里跑，不读真实 `$DSH_HOME`。

A/B 复现：`$env:DSH_OS_INDEX = '<改动前那份 index.js>'` 再跑，断言应变红。

## 实现上踩过的坑（都留在测试里）

1. **设置不能"读一次就永远记住"**。首版用 `loaded` 标记 + 内存缓存，结果手改盘上的
   `settings.json` 不生效 —— 界面上表现为"开关点了、文件改了，形状却没变"。改法与规则文本同口径：
   按 `mtime+size` 记忆化。回归断言是 ④ 组那两条。
2. **"还没表态" 必须能跟 "明确写了 false" 区分**。settings.json 不存在时返回 `null`，
   而不是 `{alwaysOn:false}`；否则 config 里的 `alwaysOn:true` 永远不起作用。
3. **注入前必须中和成对花括号**。`renderPrompt` 对未知变量是抛错策略，用户编辑规则时写了
   `{{...}}` 会让每次组装失败 ⇒ 宁可换全角字形也不让会话挂。
4. **截断必须返回显式标记**。`bytes >= maxBytes` 这种反推两个方向都错：截断后必然短于上限
   （被砍了却显示"未截断"），原文恰好压线时又误报"已截断"。
5. **段名宿主内唯一**，重名直接抛错；order 用 405 而不是 400 —— 宿主同号时按名字排序，
   405 才能稳定落在会话守则（400）之后、plan 政策（500）之前。

## 许可

MIT。规则文本蒸馏自 [ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd)（MIT），
详见 `NOTICE`。
