# Kuafu 求职发现与申请定制项目

## 项目简介

Kuafu 是一套基于候选人真实证据的职位发现、岗位筛选和申请材料定制工作流。它的目标不是替候选人自动海投，而是减少每天在 LinkedIn 上重复搜索、打开职位、检查硬指标和手工修改 CV 的时间。

当前 MVP 已经能够从候选人原始 CV 开始，建立可复用的候选人事实档案，生成候选人专属 LinkedIn 搜索组合，读取和筛选最新职位，并为通过硬指标筛选的岗位自动生成对应的 ATS CV。

## 当前已经具备的通用能力

### 1. 从原始 CV 建立候选人档案

`prepare-candidate-job-search` 可以接收 DOCX 或 PDF CV 及补充证据，生成候选人唯一的 canonical `candidate-profile.json`。

候选人档案会：

- 将教育、经历、技能、语言和工作许可拆分为原子事实；
- 保存每项事实的证据来源；
- 区分已验证、来源陈述、待确认和过期事实；
- 显式记录冲突和未验证陈述；
- 计算 profile fingerprint，防止后续流程读取错误版本；
- 供职位发现和 CV 定制共同读取，但不允许下游 skill 静默重建或覆盖。

### 2. 生成候选人专属搜索策略

根据候选人事实和用户确认的偏好，系统可以生成：

- 目标职位方向；
- 每个方向的证据依据；
- LinkedIn Smart Search 正向自然语言 Query；
- 地点、发布时间、合同和经验级别过滤条件；
- 可配置的职位标题语言策略；
- Query 的已知噪声和排除词。

搜索方向数量不写死，由候选人经历和可迁移能力决定。用户批准一个 search target 后，由它确定性生成的 Query 不再重复要求确认。

### 3. 执行 LinkedIn 每日职位发现

`discover-linkedin-job-postings` 使用已登录的 Codex 内置浏览器：

- 通过可见的 Smart Search 入口提交已批准的自然语言 Query；
- 正式 daily Smart Search 使用可见的 Past 24 hours，并记录 semantic_relevance 排序模式；
- 读取可见职位卡片；
- 跨 Query 按 LinkedIn Job ID 去重；
- 在可见的 related-results 边界停止，不读取边界以下的推荐职位；
- 对职位执行可审计的一级过滤；
- 只为可能适用的职位读取完整 JD；
- 逐职位保存 checkpoint；
- 将 JD 标准化为 schema.org JobPosting JSON 和 Markdown；
- 生成并验证正式 run manifest。

### 4. 自动进行详细岗位筛选

在明确请求端到端流程时，所有成功提取或缓存命中的 JD 无需逐个确认，会自动进入 `tailor-job-application`。`AGENTS.md` 中的“开启今日职位扫描”和“开始今日职位扫描”是仅扫描指令，完成验证和 JD 提取后停止，不自动进入 screening 或材料生成。

详细筛选会：

- 将要求分类为 hard、soft 或 learnable；
- 对每项要求保存 JD 证据和候选人证据；
- 标记 met、partial、unmet 或 unknown；
- 先处理硬指标，再给出最终 gate；
- 防止综合评分掩盖硬性不匹配。

最终 gate 为：

- `PASS`：所有硬指标满足；
- `HOLD`：没有明确不满足，但存在未知或部分满足的硬指标；
- `FAIL`：至少一个硬指标明确不满足；
- `OVERRIDDEN`：用户明确要求在 HOLD 或 FAIL 的情况下继续。

### 5. 为通过筛选的岗位自动生成 CV

`PASS` 或明确 `OVERRIDDEN` 的岗位无需重复确认岗位适合性，会自动进入草稿与审查流程；敏感内容修改仍需单独批准：

- 验证雇主和职位名称；
- 建立独立 application case；
- 审计基础 CV 的 ATS 结构；
- 生成带事实依据的修改记录；
- 保存内容草稿，由独立只读 agent 审查，处理反馈后定稿；
- 生成单栏、可选中文本的 ATS DOCX；
- 执行逐页视觉检查和文本提取检查；
- QA 通过后输出 PDF。

自动进入 CV 生成不代表允许虚构事实。没有证据的技能、职责、指标和成果不得写入 CV。流程先产出内容草稿，由独立 agent 审查，处理反馈后再生成 DOCX/PDF 并进行最终文件 QA。有证据支持的措辞和排序调整自动执行；新增事实、口径不清、证据冲突及关键经历删减、略过或实质压缩，须先展示建议并获得用户明确批准。初稿同样遵守该边界。

## 当前 MVP 使用方式

MVP 暂时采用人工每日触发，而不是后台无人值守调度。

项目仍有三个 skill，独立审查是 Tailoring 内部阶段。主交互负责协调；资料、发现和内容生成的默认模型分工见 [AGENTS.md](../../AGENTS.md)，模型不可用时报告，不静默替换。规则不会自动改变桌面应用中的主模型，也没有程序级模型调度或审批拦截。

直接提供单个 JD 时，可由主模型担任内容负责人，另开独立审查 subagent；不会重新执行职位扫描。多个 JD 分别使用独立执行上下文。多 skill 任务按依赖串行交接，已有有效候选档案直接复用。交接使用文件位置、版本和指纹，不转发完整聊天；文件读取仍消耗 token。默认一轮完整审查，之后只复核受影响部分；实际额度节省尚需运行数据验证。

每天打开 Codex 项目后，可以直接输入：

> 执行 `<candidate-id>` 今日职位搜索。使用 daily portfolio；完成 JD 提取后自动 screening；PASS 岗位自动生成并 QA CV；最后汇总结果。LinkedIn 登录异常时等待我处理。

用户只需要在以下情况介入：

- LinkedIn 登录过期、CAPTCHA 或 access challenge；
- `HOLD` 中存在可能改变 gate 的候选人事实；
- 用户希望 override 一个 FAIL；
- 新增事实、口径不清、证据冲突或关键经历删减/略过等敏感内容需要批准。

申请提交和 LinkedIn 账户修改不属于当前工作流。

## 项目不会自动执行的行为

当前明确不执行：

- 自动点击 Apply；
- 自动保存 LinkedIn 职位；
- 自动创建 LinkedIn Job Alert；
- 自动关注公司；
- 自动提交申请表；
- 自动修改候选人事实；
- 绕过登录、CAPTCHA 或访问控制；
- 调用 LinkedIn 私有 API 或枚举未知 Job ID。

## 当前状态

MVP 已实际验证：

- candidate profile、policy 和 query portfolio 的身份与版本校验；
- Past 24 hours 正式 LinkedIn 搜索；
- 多 Query 收集和去重；
- 德语标题一级过滤；
- “无匹配结果”下推荐职位的排除；
- JD 批量提取、缓存和 checkpoint；
- JobPosting 与 run manifest 校验；
- 自动批量 screening；
- PASS 自动进入 CV 生成的流程契约。

草稿独立审查与模型分工已加入执行规则，并通过独立场景检查；尚未据此验证真实求职任务的额度节省。完整流程和门控规则见 [中文 Pipeline](job-search-pipeline.md)，审查细则见 [草稿审查规则](../../.agents/skills/tailor-job-application/references/draft-content-review.md)。
