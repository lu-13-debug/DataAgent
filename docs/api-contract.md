# 前后端接口约定

所有时间 ISO 字符串；JSON 错误 {error:string}。服务器端口 3001，开发 Vite 将 /api 代理到它。

GET /api/bootstrap -> {project: Project, tasks: Task[], datasets: Dataset[], wallet: Wallet, walletVersion?:number, skills: Skill[], domains: Domain[], settings: Settings}
POST /api/datasets/demo -> {dataset: Dataset}
POST /api/datasets/upload multipart 文件字段 files（可重复）-> {dataset: Dataset}
GET /api/datasets/:id -> {dataset: Dataset}
DELETE /api/datasets/:id -> {ok:true}
POST /api/tasks {title,goal,mode:'collaborative'|'automatic',datasetId,domain:'game',useAI:boolean,clientRequestId?:string,sourceTaskId?:string,inheritContext?:boolean} -> {task:Task,wallet:Wallet,walletVersion?:number}
GET /api/tasks/summary -> {summaries:TaskSummary[],wallet:Wallet,walletVersion?:number}
GET /api/tasks/events -> text/event-stream（同源 Cookie 认证，snapshot / heartbeat 事件）
GET /api/tasks/:id -> {task:Task,wallet:Wallet,walletVersion?:number}
PUT /api/tasks/:id/metadata {favorite?:boolean,pinned?:boolean,tags?:string[]} -> {task:Task}
POST /api/tasks/:id/explore {start:string,end:string,channels?:string[],comparePrevious?:boolean} -> {report:Report,scope:ExploreScope,previous?:Report,previousScope?:ExploreScope,comparison:ExploreComparison}
POST /api/tasks/:id/retry {strategy:'restart'|'resume',useAI:boolean,mode?:'collaborative'|'automatic',skipSteps?:string[],clientRequestId?:string} -> {task:Task,wallet:Wallet,walletVersion?:number}（新任务）
POST /api/tasks/:id/skip {stepId:'retention'|'monetization'|'insights'} -> {task:Task,wallet:Wallet,walletVersion?:number}
POST /api/tasks/:id/approve {message?:string,stepId?:string} -> {task:Task,wallet:Wallet,walletVersion?:number}; 前端传入当前确认步骤plan/report，用于延迟请求防重。
POST /api/tasks/:id/message {message:string} -> {task:Task}
POST /api/tasks/:id/cancel -> {task:Task,wallet:Wallet,walletVersion?:number}
GET /api/tasks/:id/report.md -> Markdown 下载
GET /api/wallet -> {wallet:Wallet,walletVersion?:number,transactions:Transaction[]}
GET /api/settings -> {settings:Settings}
PUT /api/settings {provider,baseUrl,model,apiKey?:string,clearKey?:boolean} -> {settings:Settings}
POST /api/settings/test -> {ok:true,message:string} 或错误。
POST /api/settings/models {baseUrl:string,apiKey?:string} -> {baseUrl:string,models:[{id:string,name:string}],partial:boolean}
GET /api/health -> {ok:true}
GET /api/runtime -> {mode:'local'|'cloud',authRequired:boolean,serviceName:string,version:string,modelHosts?:string[],capabilities?:{taskEvents?:boolean,taskRecovery?:boolean,taskSkip?:boolean,taskSummaries?:boolean,idempotentTasks?:boolean,walletVersion?:boolean,reportExplore?:boolean,reportMetadata?:boolean,reportContinuation?:boolean}}

Project {id,name,domain,description}
Dataset {id,name,source:'demo'|'upload',createdAt,rowCount,tableCount,tables:[{name,type,columns:string[],rowCount,preview:object[]}],warnings:string[],dateRange:{start,end},channelCount,inspection?:Inspection}
Inspection {version:1,mappings:[{table:string,source:string,field:string,sourceColumn:string|null,origin:'automatic'|'generated',required:boolean}],coverage:[{table:string,start:string|null,end:string|null,validRows:number}],missingTables:string[],issues:InspectionIssue[],quality:{score:number|null,rule:string},analyzable:boolean,rawRows:number,validRows:number}
InspectionIssue {code:string,severity:'error'|'warning'|'info',problem:string,metrics:string[],fix:string,location?:{table?:string,column?:string,rows?:number[]}}
Wallet {balance:number,frozen:number,spent:number} balance=可用额度；任务固定20额度，冻结时 balance-20 frozen+20，成功 frozen-20 spent+20，失败释放。
walletVersion 为响应顶层可选非负整数，不加入 Wallet 三字段对象。当前 local/cloud 的所有钱包响应及 SSE snapshot 均返回此字段，并通过 capabilities.walletVersion=true 声明支持；值取该账号 SQLite transactions 的最大 rowid（无流水时为 0）。赠送、冻结、释放、结算提交后递增；任务进度、消息、批准、跳过及幂等重放不改变版本，回滚不推进，进程重启后保留。账本 API 不删除流水；wallet 与 walletVersion 由同一条同步 SELECT 在同一个 SQLite 读取快照内取得，不能将分别读取的旧钱包与新版本拼接。
客户端应在同一账号/服务范围内统一比较所有来源的钱包版本：较旧版本的钱包不得覆盖已接收的新版本，即使较旧 bootstrap 或任务 HTTP 响应最后到达。相同版本代表同一钱包状态；任务内容可按自身状态更新时间更新。跨账号/服务切换须清空比较基准；缺少版本的旧服务按兼容策略处理，不得把缺省值猜成最新版本。SSE heartbeat 不携带钱包，也不推进版本。
Transaction {id,type:'grant'|'freeze'|'settle'|'release',amount,taskId?:string,description,createdAt}
Settings {provider,baseUrl,model,hasKey:boolean} 永远不回传 apiKey。
Domain {id,name,description,enabled:boolean}
Skill {id,name,description,category,version,enabled:boolean}
Task {id,title,goal,mode,domain,datasetId,datasetName,status:'running'|'awaiting_approval'|'completed'|'failed'|'cancelled',currentStep:number,progress:number,createdAt,updatedAt,useAI,model,cost:20,steps:Step[],events:Event[],messages:Message[],report?:Report,metadata?:ReportMetadata,error?:string,errorCode?:string,sourceTaskId?:string,sourceKind?:'continuation',clientRequestId?:string,skippedSteps?:string[]}
ReportMetadata {favorite:boolean,pinned:boolean,tags:string[],revision:number}
TaskSummary {id,title,mode,domain,datasetId,datasetName,status,currentStep,progress,createdAt,updatedAt,useAI,model,cost,sourceTaskId?,sourceKind?:'continuation',errorCode?,skippedSteps:string[],steps:[{id,name,status}]}
Step {id,name,description,skillId,status:'pending'|'running'|'completed'|'awaiting_approval'|'skipped'|'failed',summary?:string}
Event {id,type:'start'|'complete'|'info'|'approval'|'error',title,detail,stepId?,createdAt}
Message {id,role:'user'|'assistant'|'system',content,createdAt}
Report {title,period,generatedAt,currency,summary:string,findings:[{title,detail,severity:'positive'|'warning'|'neutral',evidence:string}],recommendations:string[],metrics:[{id,label,value:number|null,unit:string,change:number|null,note:string}],daily:[{date,dau:number|null,newUsers:number|null,revenue:number|null,payers:number|null}],retention:[{date,users,d1:number|null,d7:number|null}],channels:[{name,users:number|null,revenue,d1:number|null}],quality:{rows,issues:string[],score:number},methodology:string[],source:'local'|'ai'}

daily字段在所属表实际覆盖区间之外为null；不能补零。金额指标包含revenue/arppu/arpdau，unit根据币种返回。AI请求已发出后 POST /tasks/:id/message 返回409并不保存。任务锁定创建时的供应商/模型/Key，Key快照仅内存。

新上传和新生成示例数据返回可选 inspection；旧历史数据没有该字段时不补造源列映射，旧客户端仍可创建任务。公开数据集不返回 records；已有 rowCount、tables、preview、warnings、dateRange、channelCount 的语义保持不变。inspection.rawRows 是解析出的非空源数据行数（不含表头），validRows 是全量归一化后记录数：注册用户按标识合并、相同支付订单去重，活跃事件按原有语义保留。coverage 按每张标准表的全量有效记录计算最早和最晚上海日期与有效行数，包含当日及未来记录，不由最多 5 行预览推断；它不同于报告仅完整自然日的指标覆盖。

mappings 在 CSV / XLSX 解析时捕获，table 为 users、activity 或 payments，field 为标准字段，sourceColumn 为真实识别到的源列名，source 为 CSV 文件名或“文件名 / 工作表名”。自动识别来源标为 automatic；示例数据及缺失可选渠道列时生成的字段标为 generated、sourceColumn=null。required=false 仅用于可缺省的 channel。缺整表允许部分分析，missingTables 和 issues 明确指标限制；缺少支付表时收入、ARPPU、付费人数均不可计算，活跃付费率和 ARPDAU 也无数据。已有表缺少必填字段仍拒绝上传。

结构化问题包含问题、影响指标和修复建议；有解析定位证据时附标准表、源列及最多 5 个示例原始行号。CSV 行号是记录起始物理行，XLSX 是实际工作表行号。结构化问题与标准错误不含玩家标识、订单标识或原始单元格值；重复记录用行号定位。没有源位置证据时不伪造行号。

inspection.quality.score 直接复用 analyze 的 quality.score，规则 max(0,100-计分提示数×5)，rule 给出说明。计分提示为分析器去重输出前的 warnings、缺表、当日或未来、无完整覆盖、跨表覆盖不一致、非成功订单和未匹配注册用户提示；结构化问题可按类别合并或细化，数量不作为评分依据。无法分析时 score=null、analyzable=false；只有当日或未来记录的文件仍可上传查看识别结果，但不可创建分析任务。POST /api/tasks 在冻结额度前使用持久化真实 records 重新运行分析校验，不信任客户端或历史 inspection.analyzable；拒绝时无冻结、释放或新建任务。上传与任务创建的业务错误仍使用兼容的状态码和 {error:string}，可额外返回 issues:InspectionIssue[]，所有错误文本继续脱敏 Key。

模型发现不修改已保存设置，也不保存传入的临时 Key。未传 Key 时只复用当前登录会话中绑定到同一规范基础地址的 Key；更换地址或同账号另一会话改变地址后，不能转发旧凭据。云端目录请求同样需要登录并满足 HTTPS 精确白名单，禁用重定向。供应商 401/403 转换为业务 400 并提示检查 Key，避免误触发平台退出登录。目录最多返回 1000 项，Claude 分页最多 10 页，每次响应最多 2 MiB，默认总超时 15 秒。

连接测试输出上限 1024 Token，不自动重试；允许明确标注只有推理、尚无最终答案的有效响应。正式报告输出上限 8192 Token，截断或空最终文本按失败处理，不返回内部推理文本。测试兼容字符串和 text/output_text 分块响应。

Bootstrap 首次创建示例数据并计算一份 completed 报告；初始 wallet balance=500 frozen=0 spent=0，示例历史不扣费。监控优先使用 SSE 与轻量摘要；旧任务详情接口继续兼容。步骤顺序 quality,plan,activity,retention,monetization,insights,report,verify；协作模式在 plan 与 report 运行前显示 awaiting_approval，批准后继续。输入 useAI=true 但没 Key 时拒绝创建、不冻结。

任务摘要严格按 TaskSummary 白名单返回，不含报告、消息、业务目标、事件正文、预览、Key 或内部缓存。摘要包含最近 100 条任务以及未包含在其中的全部 running/awaiting_approval 任务；正常账本下云端最多 102 条，本地试用最多 125 条。summary/events 路由位于 /:id 之前。SSE 初连和每次重连均发送 `event: snapshot`，data 是与摘要 GET 相同的 `{summaries,wallet,walletVersion?}`；无历史事件重放。每 3 秒发送 `event: heartbeat`，data 为 `{timestamp:ISO字符串}`，无需读取或发送报告。任务状态与账本仅在 SQLite 提交后触发摘要快照，无全量 bootstrap 轮询。事件允许用户开启后台完成/失败提醒，但前端须按任务 ID 去重通知。

云端 SSE 使用当前同源 HttpOnly Cookie，不接受 URL 令牌；每次推送及心跳重新校验会话，退出、密码变更或过期后至多一个心跳周期内停流。每账号默认最多 4 个连接（可配置但硬上限 8），超限 429；客户端断开、服务器关闭均清理连接和排空监听器。长连接不占普通请求并发槽，但仍阻止其工作空间被驱逐；慢连接不累积无限快照，排空后发送最新快照或关闭并由客户端重连。反向代理应允许 SSE 长连接并关闭响应缓冲，响应包含 `X-Accel-Buffering:no`。

创建与恢复的 clientRequestId 可选，须为 1–100 位字母、数字、下划线或连字符；同账号同编号与相同规范化输入返回原任务（重放 200，新建 201），不会重复创建、冻结或调用模型。编号在创建/恢复操作间共享命名空间；相同编号配不同输入返回 409。幂等记录随任务持久化，不使用无限内存缓存，事务内再次校验并用唯一索引保护。旧客户端不传编号仍按每次请求创建新任务。

retry 仅接受 failed/cancelled 来源任务，始终创建新 ID、以 sourceTaskId 指向直接来源；不改来源记录、报告和旧账本。新尝试再次冻结 20 额度，成功结算，失败/取消释放。保留来源 title/goal/messages；mode 缺省继承来源，可显式更换。restart 从质量检查开始；resume 仅沿用连续已完成的确定性步骤摘要，分支改变时重算依赖洞察，报告、外部模型调用和最终核验始终重新执行；报告聚合可重新计算，绝不伪造恢复了旧模型输出。协作模式仍在尚未确认的计划及重新生成报告前等待确认，自动模式按原模式继续。skipSteps 缺省继承来源用户跳过列表，显式传数组则替换。所有恢复都使用持久化真实 records 重新验证可分析性、当前余额和并发；AI 必须验证当前会话 Key 与当前 HTTPS 白名单，新的模型/地址/凭据快照仅在内存绑定。重启仍将中断任务标为失败并释放冻结；不会恢复丢失 Key 或自动重试任何外部请求。

报告整理仅接受当前账号 completed 且有 report 的任务；未完成、失败、取消或缺报告返回 409，任务不存在或属于其他账号返回 404。favorite/pinned 只接受布尔值；tags 只接受最多 8 项的字符串数组，每项 trim 后最多 20 个 Unicode 字符，去空与去重后保存，非法类型/超长返回 400。未传字段保留原值；客户端提供的 revision、报告及其他额外字段全部忽略。元数据保存为当前工作空间 Store 中独立的 report-metadata 实体，不覆写原 Task、report、updatedAt、数据集或历史账本；不创建流水、不推进 walletVersion、不调用模型。同账号会话共享并在重启后保留，不跨账号读取。首次实际变化的 revision=1，之后每次变化递增，相同规范值不推进；未整理旧报告可省略 metadata，按 {favorite:false,pinned:false,tags:[],revision:0} 展示。所有完整 Task 响应在序列化时读取当前元数据；客户端必须独立比较 metadata.revision，不能用 Task.updatedAt 判断整理先后，也不能让迟到任务响应覆盖较新元数据。

基于报告继续分析沿用普通 POST /api/tasks，sourceTaskId 只接受当前账号已完成且有报告的任务（无报告/非 completed 为 409，不存在/越权为 404）；新任务记录 sourceTaskId 和 sourceKind='continuation'，可继续指向上一份 continuation 报告形成直接来源链。此标识不改变 retry 已有 sourceTaskId 语义。inheritContext 有来源时缺省 true；显式 false 不继承消息，非法类型为 400；无来源应省略此字段，单独传入返回 400。创建仍使用本次明确输入的 title、goal、mode、datasetId、useAI 及当前会话模型配置与 Key；允许更换数据集，但实际 records 必须重新通过可分析校验。服务端不拼接原目标、不复制原报告、模型结论、Key、内部分析缓存、跳过选择或整理元数据。用户需在创建前明确确认本次目标、数据和收费；新任务重新冻结 20 额度并按原流程结算/释放，来源任务、报告和原流水保持不变。

inheritContext=true 仅复制来源 messages 中 role=user 的正文，为每条重新生成 ID/创建时间，并添加系统继承说明；不复制原 assistant/system 消息。继承后初始 messages（含本次系统说明）最多 100 条，每条用户正文最多 3000 字，用户正文合计最多 300000 字；超过返回明确 400，请用户关闭继承再整理本次背景，不静默截断，不产生新任务或流水。sourceTaskId 与规范化 inheritContext 均纳入 clientRequestId 指纹，省略继承选项和 true 等价；同编号重放返回原任务、不重复冻结，换来源/继承选项返回 409。即使来源数据已删除，仍可明确选择其他有效数据集继续；不更换则按普通数据集校验返回 404。AI 每次新建验证当前会话凭据和云端当前 HTTPS 精确白名单，不能借来源任务绕过；重启后不会恢复旧 Key。reportMetadata/reportContinuation capabilities 在 local/cloud 均为 true，旧客户端无新增必填项。

skip 仅允许尚未执行的 retention、monetization、insights，通常在协作计划等待时选择；quality、plan、activity、report、verify 均拒绝跳过。已执行步骤与结束任务返回 409，结束任务需用新尝试选择分支；同一活跃任务重复跳过同一步幂等。用户跳过与缺表的自动跳过均有明确步骤说明，用户选择另记录 skippedSteps。每次本地分析和 AI 增强后重新应用掩码：商业化计算移除 payments 输入，所有商业化指标、每日收入/付费人数及渠道收入为 null；留存指标为 null、cohort 列表为空、渠道 d1 为 null，同时移除对应洞察/建议；跳过 insights 后 findings/recommendations 为空。发送给模型的聚合已排除上述结果；最终报告保留原数据质量审计、币种和自然日统计口径，并在摘要及方法中明确“由用户选择跳过”。API 不暴露内部分析缓存、请求指纹或凭据。

模型失败可额外返回受控 code，失败任务持久化 errorCode；摘要只包含 errorCode，不包含错误原文。白名单为 INVALID_KEY、NO_PERMISSION、RATE_LIMITED、MODEL_UNSUPPORTED、OUTPUT_TRUNCATED、REASONING_ONLY、EMPTY_RESPONSE、REFUSED、PROTOCOL_ERROR、UNREACHABLE、TIMEOUT、CANCELLED、KEY_REQUIRED、RESPONSE_TOO_LARGE、INVALID_REPORT、REQUEST_REJECTED。供应商原始错误码、响应及推理文本不透传。

runtime 在 local/cloud 均无需登录，旧字段保留。当前实现声明 capabilities 九项为 true；客户端仅在对应标记明确为 true 时启用摘要、SSE、恢复、跳过、幂等请求、钱包版本校验、报告探索、服务端报告整理和基于报告继续分析。旧服务缺少 capabilities 或对应字段时表示未声明支持，应降级为读取已知任务详情，隐藏恢复/跳过/探索操作；报告整理可明确标为“仅此设备”并按服务及账号保存，继续分析降级为普通新任务且不冒充已记录来源，避免反复请求不存在的接口；不能按版本号推测能力。

合法的仅支付表数据集在跳过商业化后仍完成质量审计与核验：报告保留原记录行数、币种及完整自然日日期，全部运营指标和每日运营值为 null，运营洞察与建议为空，并明确“全部可计算运营分支已跳过，仅保留质量检查”。真实支付金额、付费结果和对应叙述不进入报告或模型输入。SSE 同源检查绑定实际连接入口，Express 接受的尾斜杠及大小写路径变体执行相同检查；云端预期 origin 来自已校验的服务地址，Cookie 会话校验保持不变。

Report 可选 `aiUsage:{protocol:'anthropic'|'chat-completions',provider:string,model:string,inputTokens:number|null,outputTokens:number|null,totalTokens:number|null,cacheReadInputTokens:number|null,cacheCreationInputTokens:number|null,reasoningTokens:number|null}`。仅保留供应商返回的非负安全整数计数；未返回的字段为 null，不通过相加假造 totalTokens。无可用计数时不提供 aiUsage，旧报告与确定性分析继续兼容。usage 不含 Key、供应商原始响应或推理文本，报告页明确区分服务额度与模型费用；手填参考单价计算的金额仅为估算，不代表实际账单。

官方网关 api.anthropic.com 使用 Claude Messages（`/v1/messages`、`x-api-key`、`anthropic-version`），system 与 messages 分开；OpenAI / DeepSeek 使用现有 Chat Completions 协议。网关响应体限制 2 MiB，整个读取过程继续受超时和取消约束；不透传供应商错误响应。模型连接测试与生成均由用户动作触发。前端配置档案仅保存地址、模型名和非敏感供应商标识，按 origin/runtime/userId 分区；切换地址清空临时输入的 Key，服务器继续执行同地址会话凭据与 HTTPS 主机白名单约束。

报告探索为兼容的只读扩展：仅接受当前账号 completed 且已有报告的任务，不创建任务、不保存派生报告、不更改原任务/报告/源数据、不冻结或结算额度，也不调用模型。失败/取消/未完成任务或缺少报告返回 409；任务不存在或属于其他账号返回 404；源数据集已删除返回带明确说明的 404，真实 records 缺失/损坏返回脱敏 409。云端继续使用当前同源 Cookie，不接受外部账号的任务或数据；本地继续执行原有环回及来源校验。

探索源 records 必须是非数组对象，每个存在的键必须属于当前 users、activity、payments 标准表且值必须为数组，并至少有一张非空标准表；未知表、字符串/对象形式的表、空结构等均在共享源校验中返回脱敏 409，不忽略损坏表或把字符串长度/未知表行数计入样本。接口、worker 调度与计算层复用相同校验；行内容归一化失败同样返回脱敏 409，源质量行数不会以 NaN/null 伪装成功。

start/end 必须为合法 YYYY-MM-DD，开始日不晚于结束日，含首尾最多 3660 天，结束日不得晚于原报告 generatedAt 在上海时区的前一个自然日。截止日锁定原报告生成时刻，不随探索当天变化。channels 缺省或 [] 表示全部渠道；否则最多 50 项，每项 1–100 字，去重并规范顺序，必须来自真实注册表。缺少注册表时拒绝渠道筛选。comparePrevious 缺省 false，非布尔值返回 400；其他非法范围和渠道条件也返回 400。

ExploreScope {start:string,end:string,channels:string[],timeZone:'Asia/Shanghai',statisticsVersion:'report-explore-v1',generatedAt:string,coverage:{users:ExploreCoverage|null,activity:ExploreCoverage|null,payments:ExploreCoverage|null},sample:{sourceRows:number,selectedRows:number,selectedRowsByTable:{users:number,activity:number,payments:number},registeredUsers:number|null,payingUsers:number|null},skippedSteps:string[]}
ExploreCoverage {start:string,end:string}
ExploreComparison {requested:boolean,comparable:boolean,reasons:string[],previousRange?:{start:string,end:string},metrics:[{id:string,comparable:boolean,reason:string|null,current:number|null,previous:number|null,absoluteChange:number|null,percentChange:number|null}]}

coverage 由每张完整源表的有效记录独立推导，截止原报告的完整自然日；计算覆盖后才筛选日期及渠道。各表范围外的 daily 值为 null，覆盖范围内没有所选渠道事件时为真实零，不能用筛后首末事件缩短覆盖。sample.sourceRows 是持久化 records 三表行数之和（并非上传前 inspection.rawRows）；selectedRows/selectedRowsByTable 是在本次日期和注册渠道内、归一化和去重后的三表行数，支付包括成功与非成功订单。注册表归因用全表，留存可读期外活跃记录，这些期外辅助行不混入 selectedRows。registeredUsers 只数期间注册，缺注册覆盖时为 null；payingUsers 只数所选期间成功支付的唯一玩家，缺支付覆盖或原任务跳过商业化时为 null，不能把每日付费人数相加。报告 quality.rows 继续描述源 records 总行数；quality.issues 和 methodology 明确筛选范围、样本和有限覆盖，派生说明不作为额外质量扣分。

新增与留存 cohort 仅包含期间注册玩家；渠道订单收入使用完整注册映射下该渠道全部已注册玩家在期间的成功订单，包含期前注册者。未知玩家仅参与无渠道筛选的总事件，不归入任何已知渠道。ARPPU 为期间成功订单收入/期间真实唯一付费人数。D1/D7 在原全量活跃记录里观察目标自然日，可以超出所选末日，但该目标日必须成熟且有完整活跃覆盖；不能把筛选截断当作未回访。DAU、活跃付费率和 ARPDAU 仍取筛选范围内最后完整活跃覆盖日，口径在 metric.note 给出。原任务 skippedSteps 在当前期与上期同时应用，跳过分支的指标、每日值、cohort、渠道结果和对应叙述不会恢复；仅支付数据且跳过商业化时保留质量审计，运营指标全部 null。

只有新探索返回的派生报告会在注册表完全不覆盖所选期时将 channels[].users 返回 null，不能将未知新增写成零，也不能把 null 当作零参与排序或样本合计；原任务完整 Report 的 channels[].users 继续保持既有 number 语义。若注册覆盖内没有所选渠道注册，派生渠道新增才为零；渠道收入和成熟留存各自按对应表覆盖独立判断。

派生报告的渠道名单、筛选事件和渠道收入共享完整源注册表的玩家标识映射，即使源记录中的事件早于对应注册时间，也不会把已匹配的渠道事件静默移除或从渠道表漏掉；新增仍只计期间注册。此归因只说明源表标识匹配，不证明异常时间顺序有效，不能据此推断玩家生命周期或注册前行为。发现此类顺序异常时提供通用质量提示，不包含玩家或订单标识。

派生 Report.source 恒为 local；summary/findings/recommendations 由确定性统计生成，绝不把原 AI 摘要与洞察当作筛选结果，也不复制 aiUsage。报告 generatedAt 保留原报告的冻结统计时刻，scope.statisticsVersion 标识统计口径；前端应明确展示“确定性派生/有限数据”，不能称为重新生成的 AI 报告。所有派生 metric.change 恒为 null，上期比较只读 comparison.metrics。

comparePrevious=true 时，上期为紧邻当前期之前、含首尾等长的自然日区间，按相同渠道、原截止时刻和跳过掩码真正重算。previous 是直接的 Report（趋势读取 previous.daily），previousScope 结构与 scope 相同；未请求比较时这两字段省略。previous.daily 保留自身真实日期及 null，可按相对日序画虚线，但必须注明上期实际区间及有限覆盖，不跨 null 连线。comparison.comparable 表示至少有一项指标可比，各指标独立检查两期完整源表覆盖；留存还要求两期 cohort 均成熟且有样本。覆盖不足、不成熟、无指标/无有效分母、上期值为零或原任务跳过时，comparable=false，reason 明确原因，absoluteChange/percentChange 均为 null。即使两期原值能显示，也不能据此渲染增减结论；reasons 汇总全部不可比原因。可比时 absoluteChange=current-previous，percentChange=(current-previous)/previous×100，按两位小数显示。

探索计算位于 Node worker_threads，默认每账号最多两个 worker（可下调，硬上限二），超限 429；不建立无界缓存或等待队列。真实 records 仅在服务端及计算 worker 之间传递，不返回前端，不传 Key、模型配置或原 AI 叙述。请求取消和服务关闭均终止 worker 并释放并发槽；活跃探索纳入工作空间 busy 状态，防止云端驱逐正在使用的工作空间。统计不占用主事件循环，SSE 心跳和轻量摘要可继续响应。任何源数据异常错误均不透出玩家或订单标识。

探索渠道聚合按完整注册映射单遍建索引，期间注册 cohort 和成功订单分别累计；不会为每个渠道重新遍历全量用户、订单或全部 cohort。完整映射中的未来注册渠道仍保留，并按原覆盖分别返回真实零或 null；不通过丢弃渠道或降低原有数据支持上限规避计算。

每次探索的计算时限默认 30 秒，服务端可通过 reportExploreTimeoutMs 下调，硬上限始终为 30000ms；本地与云端一致。时限包含 worker 创建及源数据复制启动耗时；到期终止 worker、清理定时器并释放账号并发槽，返回 503 和“报告探索计算超时，请缩小日期或渠道范围后重试”。服务不自动重试，不更改原任务、报告或账本；调用者可调整范围后明确发起新请求。取消、正常完成、worker 错误和服务关闭也会清除同一时限定时器。

## 云端报告分享（capabilities.reportSharing）

仅 cloud 支持。所有管理接口需要会话及既有同源校验，公开接口匿名；分享为创建时固定的只读快照，不提供下载接口。

- `POST /api/tasks/:id/shares`：`{expiresInDays:1|7|30,hideRevenue:boolean}`；已完成且有报告的任务返回 201 `{share:{id,expiresAt,hideRevenue,views:0,registrations:0},token}`。token 为 32 字节随机数的 base64url，仅此响应返回；服务端只存 SHA-256 摘要。无权限/不存在任务 404，未完成 409，参数错误 400。
- `GET /api/tasks/:id/shares`：`{shares:[{id,expiresAt,hideRevenue,revoked,views,registrations}]}`，不返回 token；`DELETE /api/shares/:id` 撤销，返回 `{ok:true}`；其他账号不可管理。
- `POST /api/public/shares/read`，`{token}`：`{report:{source:'ai'|'local',hideRevenue,currency?:string|null,metrics:[{id,label,value:number|null,unit}],daily:[{date,dau,newUsers,revenue?,payers?}],retention:[{date,users,d1,d7}],methodology:string[]}}`。快照仅含明确白名单字段与服务端固定文字，无标题、渠道、自由文本、AI 叙述、原始记录及标识；隐藏收入时无币种、收入、付费指标及相关文字。货币代码仅认服务端固定白名单，其他显示 null；daily/retention 各最多 366 条。无效、过期及撤销统一返回 404 `{error:'分享不可用'}`。读取不计访问。
- 页面访问后主动 `POST /api/public/shares/visit`，`{token,visitorToken}`，返回 `{ok:true}`。visitorToken 为客户端生成的 32 字节随机 base64url 字符串（43 位），同一分享与访客标识只记一次；仅存其哈希，计数不使用 IP，不代表自然人数量。每个分享最多记录 10000 个访问标识；达到上限的新标识返回 429。匿名请求限流，不存 IP 到数据库。
- 站内主动注册可在原有注册请求中附带 `{shareToken,visitorToken}`。用户创建与有效分享归因同一 SQLite 事务；只有注册提交时分享仍有效才计数，同一分享/访客标识最多一次，最多 10000 个归因。无效、过期、撤销、字段缺失、重复或达到上限均不影响注册且不计数；旧客户端不传字段行为不变。计数为成功注册时唯一标识数，非访问转化率或真实人数。
- 每报告最多 20 条、每账号最多 100 条分享记录；到期 30 天后定期清理记录及关联去重数据。撤销记录同样在到期 30 天后清理。公开 API 和分享页面响应 `Cache-Control: no-store`、`Referrer-Policy: no-referrer`；分享链接格式为 `/share#<token>`，片段不会发送给服务器；反向代理及应用禁止记录请求体和分享令牌。创建或访问分享不调用模型、不改变额度。

分享快照补充字段：`period:{start,end}|null` 是严格匹配有效日期的报告期间；每个指标的 `coverage:{start,end}|null` 和 `method:string|null` 仅在已识别的确定性计算口径中提供，无法确认或无数据时为 null，应显示未知。留存指标没有可确认的覆盖日期。`dailyTruncated` 与 `retentionTruncated` 分别表示相应数组因 366 条上限被截断；完整指标并不局限于展示的图表片段。`sample:true|false|null` 依据该任务对应数据集 source 为 demo、upload 或缺失/未知得到，`sampleNotice` 是固定说明；不得将 null 解释为真实数据。以上信息均在创建快照时确定，已有分享快照保持不变。
