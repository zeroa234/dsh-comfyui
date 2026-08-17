# dsh-comfyui · ComfyUI 驱动器（DeepSeek Harness）

**AI-first 合同制 ComfyUI driver for DeepSeek Harness (dsh).**

模型只看见合同（槽 / LoRA 坑 / can / cannot 能力标签），永远看不见工作流 JSON；人要改接线去真 ComfyUI。
The model only sees a contract (slots / LoRA pits / can-cannot capability tags) — never the workflow JSON; rewiring happens in real ComfyUI.

图生图 · 文生图 · 图生视频 · 文生视频：工作流扫描成合同 → 双击预检（节点存在性 + 模型文件）→ 失败如实报错，**不假出一张图**。
Image-to-image · text-to-image · image-to-video · text-to-video: scan a workflow into a contract → double preflight (node existence + model files) → honest errors on failure, **no fabricated output**.

---

## 特性 · Features

> 工具注册名统一为 `_dsh_external_dsh_comfyui_*` 全名（harness 不做名字缩短，模型按注册名调用）。
> Tool registration names are the full `_dsh_external_dsh_comfyui_*` (the harness does not shorten names; the model calls the registered names).

| 工具 Tool（注册名 Registration name） | 说明 Description |
|---|---|
| `_dsh_external_dsh_comfyui_list` | 连通状态 + 模板清单（先看 media/mode/can/cannot 再动手）Connectivity + template list (match media/mode before acting) |
| `_dsh_external_dsh_comfyui_inspect` | 单个模板的槽 / LoRA 坑 / media / cannot，`query` 搜模型文件名 One template's slots / LoRA pits / media / cannot; `query` searches model filenames |
| `_dsh_external_dsh_comfyui_generate` | 按合同填槽提交。图/视频/音频只传本地路径，`wait_s=0` 立即返回 job_id Submit by contract. Media inputs take local paths; `wait_s=0` returns a job_id immediately |
| `_dsh_external_dsh_comfyui_job` | 查询 / 等待 / 取消任务；成品只返回磁盘路径 Query / wait / cancel jobs; outputs are disk paths |
| `_dsh_external_dsh_comfyui_import` | 扫描 / 导入本地 API Format JSON 为新模板（默认只扫描不落盘）Scan / import a local API-format JSON as a template (preview-only by default) |

## 核心设计 · Core design

### AI-first 合同制 · Contract-first, AI-blind to graphs

```
工作流 JSON（ComfyUI API Format，模型不可见）
      │ scanGraph()：离线启发式 + 活体官方集合判定
      ▼
模板合同 templates/<id>.contract.json   ← 模型唯一可见物（槽/LoRA 坑/can/cannot/models）
      │ generate()：填槽 → 尺寸对齐 8 → 别名/触发词 → 模型文件校验
      │             → 预检（/object_info 逐节点存在性 + 必填输入）→ POST /prompt
      ▼
成品 outputDir/<prompt_id>/（图/视频/音频）＋ job 记录（查询/等待/取消）
```

- **槽 = (node, field) 指针**：注入是通用的，合同 JSON 可以手补节点号——自动扫描漏掉的槽有万能逃生门。
  Slots are `(node, field)` pointers with generic injection; contracts are hand-editable as the universal escape hatch.
- **槽类型封闭、工作流开放**：text / number / seed / model / lora / image / video / audio 8 种封闭槽，任意 API 图都能扫成合同。
  Closed slot types (`text/number/seed/model/lora/image/video/audio`), open workflow set.
- **双重预检**：先验节点 + 必填输入（`NODE_MISSING`/`NODE_SCHEMA_MISMATCH`），再验模型文件在服务器上（`MODEL_MISSING`）；全绿才 POST。失败返回结构化错误码（`SLOT_UNKNOWN`/`PROMPT_REJECTED`/`MEDIA_MISSING`/`UI_FORMAT`…），不会用文生图冒充视频、不会编造成品。
  Double preflight: node existence + required inputs, then model-file existence; structured error codes; honest failure.

### 工作流适配 · Workflow adaptability

| 类型 Type | 适配度 Adaptability | 证据 Evidence |
|---|---|---|
| 文生图 t2i / 图生图 i2i | ✅ 完全适配（成熟路径） | 随包 3 个 anima 模板，单测覆盖 |
| 文生视频 t2v | ✅ 适配 | 测试 fixture 是真实 MiniMax-H3 图：duration/fps/aspect_ratio/megapixels 槽、音频 VAE、`cannot: t2i` |
| 图生视频 i2v | ✅ 适配（图里接了 LoadImage 即识别） | 实测探针：LoadImage → WanImageToVideo → VHS_VideoCombine 扫出 `mode: i2v` + 必填 image 槽 |
| 音频相关 audio | 🟡 部分 | `LoadAudio`/`SaveAudio`/`VAEDecodeAudio` 识别，输出收集含 audio bag |
| 聊天 / LLM 节点混合 | 🟡 能导入能执行，无对话语义 | LLM 节点上游有标量文本时会被选为 prompt 槽；全内部化则诚实警告"edit the contract" |

### 官方 / 自定义节点判定 · Official vs custom node classification

每个节点的 `python_module` 标签就是权威来源：`nodes` / `comfy_extras.*` / `comfy_api_nodes.*` 是官方，`custom_nodes.<包名>` 是自定义（带插件包名）。

The `python_module` tag on every node is authoritative: `nodes` / `comfy_extras.*` / `comfy_api_nodes.*` are official; `custom_nodes.<pack>` is custom (pack name included).

- **生成时**：预检按 `python_module` 活体分类，返回 `custom_nodes: [{class_type, pack}]` —— 官方更新新节点**零维护自动跟随**。
  At generate time, preflight classifies live by `python_module` — new official nodes in ComfyUI updates are followed automatically.
- **导入时**：优先用活体会话分类（警告标注 `verified against the live server`）；离线时回退到 `lib/lib/official-nodes.json`（849 个官方节点，由 `scripts/update-official-nodes.mjs` 从服务器生成，绝不手打）。
  At import time, live classification wins (warning marked `verified`); offline falls back to the generated 849-node official list.

## 安装 · Installation

仓库即标准 dsh bundle 包（`@dsh-external/dsh-comfyui`），克隆后直接安装：

The repo is a standard dsh bundle package (`@dsh-external/dsh-comfyui`) — clone and install:

```powershell
git clone https://github.com/zeroa234/dsh-comfyui
cd dsh-comfyui
npm install
dsh plugin --profile web add .
```

安装后重启 harness，新会话的工具列表里就会出现 `_dsh_external_dsh_comfyui_*` 五个工具（bundle 自带的 `cordis.patch.yml` 会写入默认 baseUrl/outputDir）。

After a harness restart, the five `_dsh_external_dsh_comfyui_*` tools appear in new sessions; the bundle's own `cordis.patch.yml` applies the default baseUrl/outputDir.

## 配置 · Configuration

| 配置项 Option | 默认 Default | 说明 Description |
|---|---|---|
| `baseUrl` | `http://127.0.0.1:8188`（patch 覆盖为局域网地址） | ComfyUI 服务器 |
| `templatesDir` | 包内 `templates/` | 合同 + 工作流 JSON |
| `outputDir` | `E:\agent\output\comfyui` | 成品目录（按 prompt_id 分子目录） |

覆盖方式（profile 的 cordis.patch.yml 或预设配置）· Override in the profile's `cordis.patch.yml` or a preset config:

```yaml
- id: dsh-comfyui
  name: '@dsh-external/dsh-comfyui'
  config:
    baseUrl: 'http://192.168.0.103:8188'
    outputDir: 'E:\agent\output\comfyui'
```

另有浏览器设置页（**设置 → ComfyUI**）：改地址、LoRA 触发词（`mode=仅模型` 不写进提示词，适合 turbo）、**导入工作流**（API Format JSON，默认只扫描预览）。`user-settings.json` 保存在 `templates/` 下。

A browser settings page (Settings → ComfyUI) manages the address, LoRA trigger words (`model-only` mode keeps words out of the prompt, good for turbo), and workflow import (preview-only by default), persisted to `templates/user-settings.json`.

## 测试 · Tests

```bash
npm test   # node:test（零依赖），16 用例覆盖 graph 助手/合同读取/LoRA 触发词/扫描/官方节点分类
```

> `tests/templates/` 之外无需任何外部依赖；官方节点分类测试直接读生成的 `official-nodes.json`，并验证活体 `officialClasses` 覆盖优先。

## 构建与注入（开发）· Build & inject (development)

纯 JS 包，**源码即产物**（无 src/、无构建步骤），克隆即用：

```bash
dev_inject_plugin     # 运行时注入（重启会丢）
dev_install_package   # 持久化：写入 profile package.json（link 依赖 + dsh.profile.bundles），重启不丢
dev_reload_package dsh-comfyui   # 改完代码确定性热重载（清缓存 → 重建 fiber，失败回滚旧代）
```

> 官方节点清单再生成：`node scripts/update-official-nodes.mjs [baseUrl]`。
> 改造工作流时：ComfyUI 里 Enable Dev mode → Save (API Format)，再用 `_dsh_external_dsh_comfyui_import` 扫一遍。

## 仓库结构 · Repository layout

```
dsh-comfyui/
├── lib/                        # 源码即产物（纯 JS）· Plain-JS source (= build output)
│   ├── index.js                # 工具注册 + 设置 API · Tool registration + settings API
│   ├── client.js               # 浏览器设置页（settings.section slot）· Browser settings UI
│   └── lib/
│       ├── engine.js           # 生成管线（预检 / 上传 / 轮询）· Generation pipeline
│       ├── scan.js             # 工作流 → 合同扫描器 · Workflow → contract scanner
│       ├── graph.js            # 纯图助手（填槽/别名/绕过 LoRA）· Pure graph helpers
│       ├── templates.js        # 合同读写 · Contract I/O
│       ├── store.js            # LoRA 触发词设置 · LoRA trigger-word settings
│       ├── import-template.js  # 扫描/保存模板 · Template import
│       ├── http.js             # ComfyUI HTTP 客户端（fetch）· HTTP client
│       └── official-nodes.json # 官方节点离线清单（脚本生成）· Offline official-node list (generated)
├── templates/                  # 模板合同 + 工作流 JSON · Template contracts + workflows
│   └── <id>.contract.json + <id>.json
├── tests/                      # node:test 用例（零依赖）· node:test suites
├── scripts/
│   └── update-official-nodes.mjs   # 官方节点清单再生成 · Regenerate official-node list
├── package.json
├── README.md
└── LICENSE
```

## 许可证 · License

BSD-3-Clause