# 前后端接口约定

所有时间 ISO 字符串；JSON 错误 {error:string}。服务器端口 3001，开发 Vite 将 /api 代理到它。

GET /api/bootstrap -> {project: Project, tasks: Task[], datasets: Dataset[], wallet: Wallet, skills: Skill[], domains: Domain[], settings: Settings}
POST /api/datasets/demo -> {dataset: Dataset}
POST /api/datasets/upload multipart 文件字段 files（可重复）-> {dataset: Dataset}
GET /api/datasets/:id -> {dataset: Dataset}
DELETE /api/datasets/:id -> {ok:true}
POST /api/tasks {title,goal,mode:'collaborative'|'automatic',datasetId,domain:'game',useAI:boolean} -> {task:Task,wallet:Wallet}
GET /api/tasks/:id -> {task:Task,wallet:Wallet}
POST /api/tasks/:id/approve {message?:string,stepId?:string} -> {task:Task,wallet:Wallet}; 前端传入当前确认步骤plan/report，用于延迟请求防重。
POST /api/tasks/:id/message {message:string} -> {task:Task}
POST /api/tasks/:id/cancel -> {task:Task,wallet:Wallet}
GET /api/tasks/:id/report.md -> Markdown 下载
GET /api/wallet -> {wallet:Wallet,transactions:Transaction[]}
GET /api/settings -> {settings:Settings}
PUT /api/settings {provider,baseUrl,model,apiKey?:string,clearKey?:boolean} -> {settings:Settings}
POST /api/settings/test -> {ok:true,message:string} 或错误。
GET /api/health -> {ok:true}

Project {id,name,domain,description}
Dataset {id,name,source:'demo'|'upload',createdAt,rowCount,tableCount,tables:[{name,type,columns:string[],rowCount,preview:object[]}],warnings:string[],dateRange:{start,end},channelCount}
Wallet {balance:number,frozen:number,spent:number} balance=可用额度；任务固定20额度，冻结时 balance-20 frozen+20，成功 frozen-20 spent+20，失败释放。
Transaction {id,type:'grant'|'freeze'|'settle'|'release',amount,taskId?:string,description,createdAt}
Settings {provider,baseUrl,model,hasKey:boolean} 永远不回传 apiKey。
Domain {id,name,description,enabled:boolean}
Skill {id,name,description,category,version,enabled:boolean}
Task {id,title,goal,mode,domain,datasetId,datasetName,status:'running'|'awaiting_approval'|'completed'|'failed'|'cancelled',currentStep:number,progress:number,createdAt,updatedAt,useAI,model,cost:20,steps:Step[],events:Event[],messages:Message[],report?:Report,error?:string}
Step {id,name,description,skillId,status:'pending'|'running'|'completed'|'awaiting_approval'|'skipped'|'failed',summary?:string}
Event {id,type:'start'|'complete'|'info'|'approval'|'error',title,detail,stepId?,createdAt}
Message {id,role:'user'|'assistant'|'system',content,createdAt}
Report {title,period,generatedAt,currency,summary:string,findings:[{title,detail,severity:'positive'|'warning'|'neutral',evidence:string}],recommendations:string[],metrics:[{id,label,value:number|null,unit:string,change:number|null,note:string}],daily:[{date,dau:number|null,newUsers:number|null,revenue:number|null,payers:number|null}],retention:[{date,users,d1:number|null,d7:number|null}],channels:[{name,users,revenue,d1:number|null}],quality:{rows,issues:string[],score:number},methodology:string[],source:'local'|'ai'}

daily字段在所属表实际覆盖区间之外为null；不能补零。金额指标包含revenue/arppu/arpdau，unit根据币种返回。AI请求已发出后 POST /tasks/:id/message 返回409并不保存。任务锁定创建时的供应商/模型/Key，Key快照仅内存。

Bootstrap 首次创建示例数据并计算一份 completed 报告；初始 wallet balance=500 frozen=0 spent=0，示例历史不扣费。轮询任务状态每1000ms。步骤顺序 quality,plan,activity,retention,monetization,insights,report,verify；协作模式在 plan 与 report 运行前显示 awaiting_approval，批准后继续。输入 useAI=true 但没 Key 时拒绝创建、不冻结。
