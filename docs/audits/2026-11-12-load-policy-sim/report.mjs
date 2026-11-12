import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { read,OUT,INPUT,dayNum,dateStr,START,EXAM,spread,rows,FIT_W,loadData,initial,DEFAULT_W } from './common.mjs';
const grid=read('grid.json'),cal=read('calibration.json'),diag=read('diagnosis.json'),pre=read('preflight.json');
const replayData=loadData(),stored=initial(replayData,DEFAULT_W,.9,START-1,true),replayed=initial(replayData,DEFAULT_W,.9,START-1,false);
const fidelity={n:0,stability:0,due:0,state:0};
for(let i=0;i<stored.length;i++)if(!stored[i].retired&&!stored[i].prior){fidelity.n++;fidelity.stability+=Math.abs(stored[i].card.stability/replayed[i].card.stability-1)<.01;fidelity.due+=Math.abs(+stored[i].card.due-+replayed[i].card.due)<60000;fidelity.state+=stored[i].card.state===replayed[i].card.state;}
const entries=Object.entries(grid.results),index=new Map(entries.map(([id],i)=>[id,`C${String(i+1).padStart(3,'0')}`]));
const get=id=>grid.results[id],code=id=>index.get(id);
const fixed=(v,n=0)=>Number.isFinite(v)?Number(v).toFixed(n):'不适用';
const pct=(v,n=1)=>`${fixed(v*100,n)}%`;
const fmt=(s,n=0,mul=1)=>s&&Number.isFinite(s.mid)?`${fixed(s.mid*mul,n)}［${fixed(s.min*mul,n)}–${fixed(s.max*mul,n)}］`:'不适用';
const pf=s=>s&&Number.isFinite(s.mid)?`${pct(s.mid)}［${pct(s.min)}–${pct(s.max)}］`:'不适用';
const table=(heads,rs)=>'| '+heads.join(' | ')+' |\n| '+heads.map(()=>'---').join(' | ')+' |\n'+rs.map(r=>'| '+r.join(' | ')+' |').join('\n');
const M=(r,k,n=0,m=1)=>fmt(r.summary[k],n,m);
const baseId=c=>`P0_F25_L0_all_${c.supply}_${c.plateau?'cap79':'main'}`;
const differences=(r,k)=>{
 const b=get(baseId(r.config));return spread(r.seedMetrics.map((m,i)=>m[k]-b.seedMetrics[i][k]));
};
const efficiency=r=>{
 const b=get(baseId(r.config));const deltas=r.seedMetrics.map((m,i)=>[m.d180_remembered-b.seedMetrics[i].d180_remembered,m.totalAnswers-b.seedMetrics[i].totalAnswers]);
 if(deltas.every(([dk])=>dk>0))return fmt(spread(deltas.map(([dk,da])=>da/dk)),1);
 if(deltas.every(([dk])=>dk===0))return '不适用：记住词数差为0';
 if(deltas.every(([dk])=>dk<=0))return '少记住词，见左侧取舍';
 return '种子间增减方向不一致';
};
const sampleNote=n=>n<100?'样本少':'';
const sampleTable=(bucket,label)=>table([label,'样本数','正确率','忘了的比例','备注'],Object.entries(bucket).map(([k,v])=>[k,v.n,pct(v.ok/v.n),pct(v.forgot/v.n),sampleNote(v.n)]));
const supplyLabel=s=>({N3:'N3以内，含未见搭配',N2:'N3学完后继续N2，含搭配',ordinaryN3:'仅N3以内普通新词'}[s]);
const newLabel=c=>c.newKind==='fixed'?`每天${c.newValue}个`:c.newKind==='accuracy'?`近7学习日正确率<${pct(c.threshold,0)}：25降至${c.low}`:`不稳词>${c.threshold}：25降至${c.low}`;
const capLabel=c=>c.cap>=1000000?'全出':`${c.cap}，${c.selection==='random'?'随机':'最难提取的先出'}`;
const fullLabel=c=>`${c.schedule}；${newLabel(c)}；${c.leech?`累计忘${c.leech}次起、每天${c.intake}个`:'不出列'}；${capLabel(c)}`;
const recommendedId='P1a_F0_L8K5_C300-random_ordinaryN3_main';
const requestedId='P1a_accuracy0.65-5_L8K5_C300-random_N3_main';
const rec=get(recommendedId),base=get(baseId(rec.config)),wide=get(requestedId),wideBase=get(baseId(wide.config));
const current=get('P0_F0_L8K10_C621-random_ordinaryN3_main');
const actualIds=['P0_F25_L0_all_ordinaryN3_main','P0_F0_L8K10_C621-random_ordinaryN3_main','P1a_F0_L8K5_all_ordinaryN3_main','P1a_F0_L8K5_C200-random_ordinaryN3_main',recommendedId,'P1a_F0_L8K5_C300-lowest_ordinaryN3_main','P1a_F0_L8K10_C300-random_ordinaryN3_main'];
const jointIds=['P0_F25_L0_all_N3_main','P0_F25_L8K10_all_N3_main','P1a_accuracy0.65-5_L8K5_all_N3_main','P1b_accuracy0.65-5_L8K5_all_N3_main',requestedId,'P1a_accuracy0.65-5_L8K5_C200-random_N3_main','P1a_accuracy0.65-5_L8K5_C300-lowest_N3_main','P1a_F10_L8K5_C300-random_N3_main'];
const overview=ids=>table(['编号及方案','前14天每天分钟','第15–60天每天分钟','后30天每天分钟','峰值日分钟','考试日记住词数','考试日平均能想起','第180天平均能想起'],ids.map(id=>{const r=get(id);return [`${code(id)} ${fullLabel(r.config)}`,M(r,'earlyAnswers',1,.2),M(r,'middleAnswers',1,.2),M(r,'lateAnswers',1,.2),M(r,'peak',1,.2),M(r,'exam_remembered'),pf(r.summary.exam_meanR),pf(r.summary.d180_meanR)];}));
const out=[];
const put=x=>out.push(x);
put('# 作者真实数据上的减负模拟与遗忘诊断（2026-11-12）');
put('## 结论');
put(`**全部方案未标定，不能把以下数字当作上线承诺。** 以减少作答、增加“可提取率至少80%的词数”为标准，当前库存下的候选是：拟合参数0.80、上线重算、普通新词0、累计遗忘8次起每天只放5个、每天首答最多300个且随机选（${code(recommendedId)}）。`);
put(`它在第15–60天每天${fixed(rec.summary.middleAnswers.mid*.2,1)}分钟，考试日记住${rec.summary.exam_remembered.mid}词；相对同库存的题设P0+25+L0，每天少${fixed((base.summary.middleAnswers.mid-rec.summary.middleAnswers.mid)*.2,1)}分钟、多${rec.summary.exam_remembered.mid-base.summary.exam_remembered.mid}词。前14天仍约${fixed(rec.summary.earlyAnswers.mid*.2,1)}分钟，见表3。`);
put(`代价：考试日全体已学词平均能想起从${pct(base.summary.exam_meanR.mid)}降至${pct(rec.summary.exam_meanR.mid)}，第180天降至${pct(rec.summary.d180_meanR.mid)}；“高把握的词变多”与“整体不遗忘”不能混为一件事。`);
put(`实际代码已有8次/每天10个的闸。相对冻结库现有配置，新候选第15–60天反而每天多${fixed((rec.summary.middleAnswers.mid-current.summary.middleAnswers.mid)*.2,1)}分钟，考试日多${rec.summary.exam_remembered.mid-current.summary.exam_remembered.mid}个高把握词；表3把两种对照分开。`);
put(`“N5–N3还剩约460个”不适用于这份库：未见157个，全部是固定搭配；普通新词为0。按包含搭配的任务口径，三件事一起用的候选${code(requestedId)}为每天${fixed(wide.summary.middleAnswers.mid*.2,1)}分钟、考试日${wide.summary.exam_remembered.mid}词，见表4。`);
put('遗忘的主要证据是默认间隔偏乐观、新词首日回炉后的跨日迁移弱、长期顽固词消耗大。后段正确率下降和快速评分存在，但数据不能证明它们是原因。');
put('## 标定');
put('已先读两份11-03报告：旧保持率核查在按时复习、S≥3天的卡上观察到59%–68%正确率；拟合报告的留出测试对数损失0.773降到0.629、分桶误差0.217降到0.063。这支持参数不贴合的诊断，但旧报告的60天219分钟等负荷数不是本次结果，也不用于填补本次失败标定。');
put('### 表1：三项前提全部通过');
put(table(['核实项','结果','证据'],[
 ['原负荷估算器改路径后能运行','通过','只在私有目录生成副本，唯一修改为依赖路径；60天、1种子、原21个场景全部退出码0。原文件未改。'],
 ['原生绑定和调度库可加载','通过','本地官方绑定0.5.0可构造；ts-fsrs 5.4.1可用；next与repeat在600个状态/评分检查中逐字段一致。'],
 ['数据库表和指定列','通过','reviews、progress的5个指定字段、words.jlpt_level均存在；只读连接。'],
 ['全部数据拟合的21个权重','通过','params.json的fitAll.w与fit.json的g.wAll逐项相等；未重新拟合。']
]));
put(`冻结库SHA-256：\`${pre.sha256}\`。单词正向记录${rows("SELECT COUNT(*) n FROM reviews WHERE direction='forward'")[0].n}条；最新学习日11-10。当前已学3869词，其中3488词参与日常循环、381词熟知退出；153词有起点先验。不稳定在学词（当前排期S<7天、非熟知）1333词；阈值为666、999、1333。`);
put('### 表2：从09-30流水状态开始的三轮标定');
put(`实测窗口为10-01至11-02：28个学习日、33个自然日，只取正向单词。实测首答387词/学习日、作答847.93次/学习日、跨日首答“忘了”39.22%。首次真实作答704词，其中101词是先验验收；真正新学603词，即每天${fixed(diag.observed.newPerDay,2)}词。题设约25词对应未剔先验的25.14。标定仍严格用每天25新词及题设387、847、39%的闸门，相对误差不超过15%。`);
put(table(['轮次及修正','每天首答词数','每天作答次数','跨日首答遗忘率','相对题设偏差：词数 / 作答 / 遗忘','结果'],cal.rounds.map(r=>[
 `${r.round}：${r.round===1?'到期全出、原估算器式截断同日序列':r.round===2?'纳入任务表515复习上限，未毕业补完真实步骤':'再纳入历史当天已答任务占已排任务的比例；新词仍固定25'}`,
 fmt(r.summary.first,1),fmt(r.summary.answers,1),pf(r.summary.forgot),Object.values(r.errors).map(e=>`${e>=0?'+':''}${pct(e)}`).join(' / '),r.pass?'通过':'失败'
])));
put(`\`${cal.status}\``);
put('最多三轮后停止修改标定规则并继续扫描；没有拟合额外记忆倍率、没有用目标847反推耗时或序列长度。第3轮的参与比例来自同一历史窗口，连首答数量验证也不是独立样本检验。未过闸仍主要高估可完成工作量。**以下所有预测、排序和参数建议均标为未标定；真实SQL诊断不受模拟标定失败影响。**');
put(`当前状态重建另作交叉核对：3364个非先验日常词中，${fidelity.stability}个S误差在1%内（${pct(fidelity.stability/fidelity.n)}），${fidelity.due}个due误差在1分钟内（${pct(fidelity.due/fidelity.n)}），state ${fidelity.state}/${fidelity.n}相同。剩余S/due差异没有完全解释；P0/b未来起点直接用库内状态，a和真实记忆仍受流水重建误差影响。`);
put('校准日仍取题设L0，不偷换为现有顽固闸；到期截取随机。第2/3轮分别修正上限和参与程度，并补完学习/重学步骤。回放前后的差异也包含这些已知实现口径；无法把剩余误差全部归给某一个原因。');
put(`序列池整卡排除153个先验身份：真正新卡首日${cal.pools.fresh}串，跨日认识${cal.pools.ok}串、模糊${cal.pools.hard}串、忘记${cal.pools.fail}串。先验仍从各自基线参与当前状态模拟，不能被当作新学样本。`);
put('## 方案对比');
put('### 先明确两种“记住”与两种对照');
put('“记住词数”严格指真实模型在该日可提取率至少0.8的已学词数；同时报告全体已学词的平均可提取率和概率之和（每词只考一次时预计能想起多少）。熟知退出和顽固池中的词也自然衰减，绝不直接记成已掌握。纳入之后新学的词；未学习的词不算记住。');
put('主场景用全部数据拟合权重作为真实记忆；封顶场景把真实回答概率、知识统计概率都取min(R,0.79)。因此封顶场景的“R至少0.8词数”必为0，这是阈值与天花板不相容，并非所有词都忘了。该场景应看平均概率与预计想起词数；没有拿未封顶的R偷充记住词数。');
put('题设P0+25+L0是“默认参数、0.90、每天25新词、顽固词不出列、到期全复习”的实验对照，**不等于现行应用**。现行源码先过累计遗忘8次、每日10个的闸，再随机截取复习上限；冻结库level_plan_quotas还记录新词0、复习621。此快照值是记录到的配置，不能据此认定是作者手动选择或代表整个10月。');
put('### 表3：按普通新词真实库存比较（主场景，未标定）');
put('普通N3以内新词库存为0，所以该表P0名义每天25也实际新学0；157个搭配未被充作普通新词。所有单元格均为5个种子的中位数［最小–最大］；分钟先按每次12秒。');
put(overview(actualIds));
put(`建议只把${code(recommendedId)}视为一种取舍：300比200在考试日多${rec.summary.exam_remembered.mid-get('P1a_F0_L8K5_C200-random_ordinaryN3_main').summary.exam_remembered.mid}个高把握词，第15–60天每天多${fixed((rec.summary.middleAnswers.mid-get('P1a_F0_L8K5_C200-random_ordinaryN3_main').summary.middleAnswers.mid)*.2,1)}分钟；用最难提取优先，记住词数反而少${rec.summary.exam_remembered.mid-get('P1a_F0_L8K5_C300-lowest_ordinaryN3_main').summary.exam_remembered.mid}个。K从5加到10每天多${fixed((get('P1a_F0_L8K10_C300-random_ordinaryN3_main').summary.middleAnswers.mid-rec.summary.middleAnswers.mid)*.2,1)}分钟，考试日中位变化${get('P1a_F0_L8K10_C300-random_ordinaryN3_main').summary.exam_remembered.mid-rec.summary.exam_remembered.mid}个词，量级小于种子波动。`);
put('### 表4：任务指定三件事一起用（含搭配的N3供给，主场景，未标定）');
put(overview(jointIds));
put(`刹车候选${code(requestedId)}近7学习日正确率<65%时从25降至5，达到70%并连续满足3天才恢复25。考试日前只新学130个，仍剩27个未见搭配；固定10的对照${code('P1a_F10_L8K5_C300-random_N3_main')}可学完157个，但两者记住词数区间重叠，不能说哪个显著优胜。若确实要学完这批搭配，应走独立搭配配额，不能直接把普通新词调到10来实现。`);
put('### 表5：各维度如何缩小网格（以下均未标定）');
const scanIds=['P0_F25_L0_all_N3_main','P1a_F25_L0_all_N3_main','P1b_F25_L0_all_N3_main','P2a_F25_L0_all_N3_main','P2b_F25_L0_all_N3_main','P0_F15_L0_all_N2_main','P0_F10_L0_all_N2_main','P0_F0_L0_all_N2_main','P0_accuracy0.65-5_L0_all_N2_main','P0_weak1333-5_L0_all_N2_main','P0_F25_L8K5_all_N3_main','P0_F25_L8K10_all_N3_main','P0_F25_L6K5_all_N3_main','P0_F25_L6K10_all_N3_main'];
put(table(['编号','供给','被单独改变的方案','第15–60天分钟','考试日记住词数','考试日新学数'],scanIds.map(id=>{const r=get(id);return[code(id),supplyLabel(r.config.supply),fullLabel(r.config),M(r,'middleAnswers',1,.2),M(r,'exam_remembered'),M(r,'newExam')];})));
put('排期保留0.80的两种上线方式：0.85在主场景能记更多，但封顶场景成本明显更高。新词保留“正确率65%降至5”和“当前不稳词数1333降至5”两种自适应规则，另以固定10/15作考前供给对照；固定0和其他阈值已在单维度完整跑过。顽固池保留8次/5个与8次/10个：6次便出列会隔离更多还可学的词。随后16个组合，再对3个候选各加200/300与随机/最低可提取率取法；最后补8个符合实际普通词库存的配置。');
put(`实际运行${entries.length}个不同配置，每配置5个种子，合计${entries.length*5}条180天轨迹；另有标定3×5条历史轨迹及原估算器21条60天依赖试跑。单维度25个、组合16个、上限12个均各乘2种供给×2种记忆场景，实际普通词供给8个再各乘2种场景。所有组合见表8，无隐藏全排列。`);
put('### 表6：封顶敏感性与长期代价（未标定）');
const sensIds=[recommendedId,recommendedId.replace('_main','_cap79'),requestedId,requestedId.replace('_main','_cap79'),'P1a_F25_L0_all_N3_cap79','P2a_F25_L0_all_N3_cap79'];
put(table(['编号 / 场景','第15–60天分钟','考试日记住词数','考试日预计能想起词数','考试日平均能想起','第180天平均能想起','第180天池中词数'],sensIds.map(id=>{const r=get(id);return[`${code(id)} ${r.config.plateau?'封顶79%':'主场景'}`,M(r,'middleAnswers',1,.2),M(r,'exam_remembered'),M(r,'exam_expected',1),pf(r.summary.exam_meanR),pf(r.summary.d180_meanR),M(r,'pool180')];})));
put('顽固词出列是减少日常循环的代价交换，不是治好遗忘。累计lapses不会因答对降低，因此池子会继续长大；晚期用时下降的一部分正来自更多词被挡住。不能把每天只需二十多分钟解读为知识全部稳定了。');
put('### 表7：计时口径');
put(`10-01至11-02，word_study_time与正向作答按日匹配：${diag.observed.answers}次、282341秒，合计平均每次${fixed(diag.secondsPerAnswer,3)}秒，约为12秒估计的${pct(diag.secondsPerAnswer/12)}。这是主动计时总量除以作答量，不是每一次题目的精确用时，也不是只用相邻时间戳算出的中位数；所有配置的另一列实测换算见表10。`);
put(table(['时间段','对应日期','统计口径'],[['前14天',`${dateStr(START)}至${dateStr(START+13)}`,'每天都学习，日均'],['第15–60天',`${dateStr(START+14)}至${dateStr(START+59)}`,'每天都学习，日均'],['后30天',`${dateStr(START+150)}至${dateStr(START+179)}`,'每天都学习，日均'],['考试日','2026-12-06，第26天','当天计划学完后；不是考场开始前'],['第60天 / 第180天',`${dateStr(START+59)} / ${dateStr(START+179)}`,'当天计划学完后']]));
put('<details>\n<summary>展开全部228个组合、完整指标和随机种子范围（表8–13，全部未标定）</summary>\n');
put('### 表8：完整组合清单（未标定）');
put('P0=默认权重/0.90；P1=全部数据拟合/0.80；P2=全部数据拟合/0.85。a=上线时按新参数重放全部流水并重新排期；b=保留库中旧状态和到期日，后续答题才用新参数。“全出”只指过顽固闸后的到期词；上限是总首答词数，包含新词，但同日重刷不占。');
put(table(['编号','扫描批次','排期','新学规则','顽固词规则','每天首答上限与取法','新词供给','真实记忆'],entries.map(([id,r])=>[code(id),r.dimensions.map(x=>({schedule:'单维度',new:'单维度',leech:'单维度',snapshot:'快照对照',combine:'组合', 'fixed-control':'固定量对照',caps:'上限',actual:'实际库存'}[x])).join('、'),r.config.schedule,newLabel(r.config),r.config.leech?`${r.config.leech}次起，每天${r.config.intake}个`:'L0不出列',capLabel(r.config),supplyLabel(r.config.supply),r.config.plateau?'封顶79%':'拟合参数'])));
put('### 表9：每天作答与12秒换算（未标定）');
put(table(['编号','前14天每天作答','前14天每天分钟','第15–60天每天作答','第15–60天每天分钟','后30天每天作答','后30天每天分钟','峰值日作答 / 分钟','峰值日期'],entries.map(([id,r])=>[code(id),M(r,'earlyAnswers',1),M(r,'earlyAnswers',1,.2),M(r,'middleAnswers',1),M(r,'middleAnswers',1,.2),M(r,'lateAnswers',1),M(r,'lateAnswers',1,.2),`${M(r,'peak')} / ${M(r,'peak',1,.2)}`,`${dateStr(r.summary.peakDay.mid)}［${dateStr(r.summary.peakDay.min)}–${dateStr(r.summary.peakDay.max)}］`])));
put('### 表10：按作者平均每次用时换算分钟（未标定）');
put(table(['编号','前14天每天分钟','第15–60天每天分钟','后30天每天分钟','峰值日分钟'],entries.map(([id,r])=>[code(id),...['earlyAnswers','middleAnswers','lateAnswers','peak'].map(k=>M(r,k,1,diag.secondsPerAnswer/60))])));
put('### 表11：每天首答、正确率与新学（未标定）');
put(table(['编号','全程每天首答词数','跨日首答正确率','前14天每天首答 / 正确率','第15–60天每天首答 / 正确率','后30天每天首答 / 正确率','考试日累计新学','第180天累计新学','刹车天数 / 开关次数'],entries.map(([id,r])=>[code(id),M(r,'first',1),pf(r.summary.accuracy),...['early','middle','late'].map(k=>`${M(r,`${k}First`,1)} / ${pf(r.summary[`${k}Accuracy`])}`),M(r,'newExam'),M(r,'newTotal'),`${M(r,'brakeDays')} / ${M(r,'switches')}`])));
put('正确率只将认识/熟知算对；模糊单列为未正确，但在真实记忆更新中仍按FSRS Hard处理。标定遗忘率只计“忘了”，所以不直接等于1减此正确率。新学不包括起点先验。');
put('### 表12：记住的词与全部已学词平均可提取率（未标定）');
put(table(['编号','考试日记住词数','考试日平均能想起','考试日预计能想起词数','第60天记住词数','第60天平均能想起','第180天记住词数','第180天平均能想起'],entries.map(([id,r])=>[code(id),M(r,'exam_remembered'),pf(r.summary.exam_meanR),M(r,'exam_expected',1),M(r,'d60_remembered'),pf(r.summary.d60_meanR),M(r,'d180_remembered'),pf(r.summary.d180_meanR)])));
put('### 表13：相对同供给、同记忆场景P0+25+L0的效率与池子（未标定）');
put('差值先按同编号种子相减，再报中位数和范围；因此不会恒等于两组中位数相减。每多记住一词的成本用180天总作答差除以第180天记住词数差；负数表示少花作答。若少记住，保留损失与省下的作答，不假装成收益。池子阈值用各方案6或8；L0用8用于观察，未设置出列。积压含被池闸挡住的词。');
put(table(['编号','第180天多记住词数','180天多花作答次数','每多记住一词多花作答','初始池子','第14天池子','第60天池子','第180天池子','第180天仍到期未做'],entries.map(([id,r])=>[code(id),fmt(differences(r,'d180_remembered')),fmt(differences(r,'totalAnswers')),efficiency(r),M(r,'pool0'),M(r,'pool14'),M(r,'pool60'),M(r,'pool180'),M(r,'backlog180')])));
put('\n</details>');
put('## 诊断');
put(`主窗口仍为10-01至11-02；每词每学习日的首答，且此前已有学习日记录，才算跨日首答。总样本${diag.observed.n}，正确${diag.observed.ok}（${pct(diag.observed.ok/diag.observed.n)}），忘了${diag.observed.forgot}（${pct(diag.observed.forgot/diag.observed.n)}），模糊${diag.observed.fuzzy}。下面的属性是冻结库11-10时的属性，不能当成随机实验。所有格子不足100均标“样本少”；同一词反复出现不等于同样多的独立词。`);
put('### 1. 新词当天会了，跨日是否还会');
put(`表14：首个学习日答对次数，与第二个学习日首答。首次学习发生在主窗口，后续观察到11-10；剔除101个已有先验的首次验收，正确次数包括当天认识/熟知，不包括模糊。没有第二次见面的${diag.newNoReturn}词不填成答错。`);
put(sampleTable(diag.newSuccess,'首日答对次数'));
const returnedNew=Object.values(diag.newGap).reduce((s,x)=>s+x.n,0);
put(`表15：第一次跨日复习间隔。分母是已发生第二次见面的${returnedNew}词；区间内的比例是实际出现频率，不是系统本来想排的间隔。`);
put(table(['间隔','样本数','占已回访新词','正确率','备注'],Object.entries(diag.newGap).map(([k,v])=>[k,v.n,pct(v.n/returnedNew),pct(v.ok/v.n),sampleNote(v.n)])));
put(`结论：首日答对2次的下一次正确率${pct(diag.newSuccess['2次'].ok/diag.newSuccess['2次'].n)}，3次以上只有${pct(diag.newSuccess['3次以上'].ok/diag.newSuccess['3次以上'].n)}；当日反复做对并不保证长期记住。首答忘记的新词${diag.newDetails.firstForgot.n}个，下一次正确率${pct(diag.newDetails.firstForgot.ok/diag.newDetails.firstForgot.n)}；首答就认识的${diag.newDetails.firstKnow.n}个为${pct(diag.newDetails.firstKnow.ok/diag.newDetails.firstKnow.n)}（样本少）。难词本就会被迫多答，因此不能反推“多练导致遗忘”。`);
put('### 2. 忘了后回炉，下次隔天还会不会');
put('表16：老词当天至少忘过一次，在最后一次忘记后至少答对一次，再看下一次学习日首答。此处只要求回炉后出现过正确，并非已验证完整走完全部步骤；未再见322例、没有后续正确29例分开排除。');
put(sampleTable(diag.relearnGap,'隔了多久再见'));
put('表17：连续跨学习日“首答忘了—当天回炉答对”的失败链。链中的“连续”指连续两次实际出现的学习日，中间可以休息；末尾还没见下一次的链为右侧截断，不假装已经恢复。');
put(table(['连续次数','链条数','占全部链条','备注'],Object.entries(diag.chains).map(([k,v])=>[k,v,pct(v/diag.chainN),sampleNote(v)])));
put(`结论：链条共${diag.chainN}条，中位${diag.chainMedian}次、最长观察到${diag.chainMax}次；其中${diag.chainCensored}条结束时仍未验证恢复。回炉后的1天再见正确率${pct(diag.relearnGap['1天'].ok/diag.relearnGap['1天'].n)}，8–21天降至${pct(diag.relearnGap['8至21天'].ok/diag.relearnGap['8至21天'].n)}：当天会了仍不能支撑过长的下次间隔。`);
put('### 3. 哪些属性更容易跨日忘记');
let tn=18;
const attrNames={level:'JLPT等级',pos:'词性',kana:'题面是否纯假名',hanzi:'题面汉字个数',confusion:'是否在真实辨析组',collocation:'是否固定搭配'};
for(const [k,name]of Object.entries(attrNames)) {put(`表${tn++}：${name}。`);put(sampleTable(diag.byAttr[k],name));}
put(`结论：N3样本正确率${pct(diag.byAttr.level.N3.ok/diag.byAttr.level.N3.n)}，是最大负荷来源。纯假名正确率${pct(diag.byAttr.kana['纯假名'].ok/diag.byAttr.kana['纯假名'].n)}，其他表记${pct(diag.byAttr.kana['其他表记'].ok/diag.byAttr.kana['其他表记'].n)}；动词${pct(diag.byAttr.pos['动词'].ok/diag.byAttr.pos['动词'].n)}、副词${pct(diag.byAttr.pos['副词'].ok/diag.byAttr.pos['副词'].n)}，均只是相关分组；在辨析组与不在组的差距很小，不能把遗忘主要归给辨析关系。固定搭配只有70次跨日首答，正确率${pct(diag.byAttr.collocation['固定搭配'].ok/70)}，样本少。`);
put(`分组直接执行现有confusion-groups.ts及其真实依赖，仅读库：得到${diag.confusion.groups}组，覆盖${diag.confusion.members}个词；没有手写“像辨析组”的替代规则。纯假名与汉字数使用应用实际显示表记，去掉标注和空白后统计；词性含多种原始写法，主表归为中文大类，下表保留各原始标签的匿名格子。`);
put('<details>\n<summary>原始词性逐格聚合（匿名类别，避免原标签包含文字内容）</summary>\n');
put(table(['词性类别编号','归入大类','样本数','正确率','备注'],diag.posCells.map(v=>[v.id,v.category,v.n,pct(v.ok/v.n),sampleNote(v.n)])));
put('\n</details>');
put('### 4. 做到后面是否更容易忘，星期几是否不同');
put('表24：一天内的位置按正向全部作答（包含当天回炉）累计；正确率仍只看跨日首答，防止把后段大量重复作答混入成功率。');
put(sampleTable(diag.position,'一天里的作答位置'));
put('表25：按学习日星期统计，不按UTC时间戳的星期。');
put(sampleTable(diag.weekday,'星期'));
put(`结论：第1–100次${pct(diag.position['第1至100次'].ok/diag.position['第1至100次'].n)}，第101–300次${pct(diag.position['第101至300次'].ok/diag.position['第101至300次'].n)}，第301次以后${pct(diag.position['第301次以后'].ok/diag.position['第301次以后'].n)}；有后段下降，但开场也较低，不是单调疲劳曲线。排片、词难度和未完成日会混杂；星期差异亦不能认作作息因果。`);
put('### 5. 顽固词集中在哪些属性');
put(`表26：以冻结时${diag.studied}个已学词为总体，非熟知且累计lapses≥8的${diag.leeches}词为顽固池（${pct(diag.leeches/diag.studied)}）。每行同时给组内成顽固词比例、顽固池构成、全体构成，三个分母不同。此处是词数，不是作答数。`);
put(table(['属性','组','已学词数','顽固词数','组内顽固比例','占全部顽固词','占全部已学词','备注'],Object.entries(diag.leechComposition).flatMap(([k,b])=>Object.entries(b).map(([name,v])=>[attrNames[k],name,v.all,v.leech,pct(v.leech/v.all),pct(v.leech/diag.leeches),pct(v.all/diag.studied),v.all<100||v.leech<100?'样本少':'']))));
put(`结论：按冻结时的累计lapses回看主窗口，≥3的词占每天首答量${pct(diag.lapseShare.from3/diag.observed.firstWords)}；≥8的词每天${fixed(diag.lapseShare.from8/diag.window.days,1)}个、忘记率${pct(diag.lapseShare.from8Forgot/diag.lapseShare.from8)}。这是高成本小群体；“后来成了顽固词”有事后选择效应，不能当作答题前已知的预测准确率。`);
put('### 6. 作答节奏是否太快');
put('表27：相邻正向评分时间戳之差，归到后一次的回答类型；同一学习日内统计。“一分钟以内”用于排除长休息作敏感性检查，不把长休息当成慢答题。');
put(table(['范围','回答类型','样本数','相邻评分间隔中位秒','不足2秒比例','不足5秒比例','备注'],Object.entries({raw:'全部正间隔',withinMinute:'只取不超过60秒'}).flatMap(([k,scope])=>Object.entries(diag.timing[k]).map(([answer,v])=>[scope,{all:'全部',know:'认识或熟知',forgot:'忘了',fuzzy:'模糊'}[answer],v.n,fixed(v.median,3),pct(v.under2),pct(v.under5),sampleNote(v.n)]))));
put(`结论：原始相邻评分间隔中位${fixed(diag.timing.raw.all.median,3)}秒，“认识”${fixed(diag.timing.raw.know.median,3)}秒，“忘了”${fixed(diag.timing.raw.forgot.median,3)}秒；认识中${pct(diag.timing.raw.know.under2)}不足2秒。确有快速评分，但没有翻面/呈现时间戳，无法区分熟练、手滑、复制式短期回忆；不能称为每题净反应时间，更不能据此诊断个人记忆或健康问题。`);
put('## 建议的参数');
put('以下是供后续实现评估的具体候选，**全部未标定，尚无上线验证**；本任务没有改应用、设置或真实学习状态。当前普通N3词已无新词，眼下实际新词数应为0；新词阀门用于未来选择继续N2或其他有供给的阶段，不能拿普通配额投放独立搭配。');
put(table(['项目','可直接实现的值','依据'],[
 ['目标保持率','0.80；使用params.json的fitAll.w全部21权重','表5对0.85两种上线方式、表6封顶敏感性；0.85加重时间而封顶收益有限。'],
 ['评分映射','保持当天首答认识=Easy；其余按现有映射','原估算器与真实fsrs-scheduler一致；本任务未扫描改映射，不扩展结论。'],
 ['上线方式','(a)：重放完整流水、重算S/D/state/steps/due；同时启用下面的300上限','表4中a/b：a的考试日高把握词更多；不加上限会有千分钟级峰值，不能只上重算。'],
 ['普通新词：当前','0；N3以内普通库存=0；不自动续N2','输入核实、表3；不要把157个搭配或“约460”写成普通词缺口。'],
 ['有供给时正常新学','25个/学习日；降档到5，不降到0','表5和全部单维度表：降0会丢失所有考前新词供给；表4含搭配只是上界实验。'],
 ['刹车触发','最近7个有学习日，跨日首答正确率加权合计<0.65；次日新词降至5','表4、表8的65/70/75扫描及表11刹车天数；65是较宽松的候选，未证明显著最优。'],
 ['恢复与滞回','仍用最近7学习日的跨日首答：≥0.70，连续3个学习日满足才恢复25；无有效样本保持原档','表4、表11实跑使用同一规则；触发与恢复相差5个百分点。75%触发若恢复80%，封顶79%时无法恢复。'],
 ['不稳词计数刹车','不作为主开关；保留对照：S<7天词数>1333时降5，≤1066且连续3学习日才恢复','表5及表8–11：666/999/1333全扫；拟合后S变小、池子累积，计数容易长期锁住，不宜把默认S尺度直接搬到拟合参数。'],
 ['顽固词出列阈值','fsrs_lapses>=8','表5：改成6隔离1047词而非584词，考试日记住数更低；3次同日错误升级stubborn的规则照旧。'],
 ['每天从顽固池放回','5个到期词，随机挑；当日仍完成原有两步/三步重学；次日仍按顽固身份入池','表3/4/5：10个较5个更费时、记住收益在种子波动内；这是日额度，不是永久解除顽固标记。'],
 ['每天首答上限','300个（包含当天新词）；先过顽固闸，再在池中随机抽。当天重刷不占首答上限','表3/4和表8–13：200的考前记住数较低；最低可提取率优先在所选a方案里更差。应用现有reviewCap只限复习，若实现必须扣除当天实际新词占额。'],
 ['未见搭配','另走现有搭配日额；本次不把157个塞进普通新词设置','表1输入核实和表4供给对照；11个tier0、121个tier1、25个tier2。未单扫搭配日额，不能凭这些模拟给搭配日额新数值。']
]));
put('拟合权重（按w0至w20顺序；从已给产物读取，不是再次估计）：');
put('```json\n'+JSON.stringify(FIT_W)+'\n```');
put('## 局限');
put(`1. **标定失败是首要限制。** 三轮后首答与作答仍各高估${pct(cal.rounds.at(-1).errors.first)}/${pct(cal.rounds.at(-1).errors.answers)}，未增加第四轮或改目标。种子范围只反映随机性，不涵盖模型误差、参数不确定性和未来行为变化；不能当置信区间。`);
put('2. **供给背景与库不符。** 主网格按题设把未见搭配也作为单词供给，N3共157、继续N2共3635；实际普通N3为0。实际普通N2未见3098，另有380个未见搭配。可选表达开关、搭配独立配额、导入词优先和字典点名没有完整重现，因此另外跑普通N3为0的配置；没有擅自补出缺失的“460词”。');
put('3. **模型不是独立真值。** 拟合参数来自同一作者截至11-01的数据；未来诊断窗口与训练有重叠，不能证明未来记忆机制恒定。153个起点先验缺少学习前历史，按库中基线初始化真实模型，后续再按拟合权重推进；这是近似。');
put('4. **起点和上线方式。** P0与b严格用11-10库中当前排期状态；a用新参数完整重放。真实记忆都按相同流水用拟合参数重建，熟知名单相同。重算也会使初始lapses/池子稍变（584到589）；没有把它静默覆盖回旧值。固定的UTC日历日与学习日差沿用原估算器，学习日边界按UTC+8凌晨4点；同日未来作答使用合成时间。');
put('5. **同日回炉复用原估算器的真实序列池。** 首答由拟合R抽样，之后从10月同类真实序列抽取；每次仍调用官方FSRS，达到毕业就结束；截断序列用真实后续评分分布补完。它涵盖普通两步和错满3次后三步，却没有逐张模拟3–8/9–14/16–26张的插队间隔、同组12张避让、前6张减压、连续不同词错误保护或同日交错带来的记忆变化。不能声称完整运行了应用出题器。');
put('6. **参与和上限。** 未来180天假设每天都学习、选中的词都完成，不复制10月的缺席和主动中止，也不主动加餐、集中拿下、快速名单或其他方向。题设L0无闸；现行闸和快照621配置单列。扫描中的200/300是全体首答词数，不等于应用当前仅复习的reviewCap。上限不足时按先顽固闸、再随机或最低R取；未用旧的按due顺序替代随机。');
put('7. **最低R取法是较理想的信息条件。** 它读取按拟合历史重建的真实模型R；b上线方式实际仅保留默认状态时未必有同样信息，不应照搬该取法的数值优势。按日汇总时没有排片顺序对疲劳的反馈，也没让同日练习成功率随一天变长而降低。');
put('8. **考试知识量是当日学完后的值。** 不等于考试当天上午的记忆，也不代表JLPT分数；只算单词，不含语法、听力、汉字读音和辨析卡。阈值80%会让79.9%与80.1%的词落在两侧，所以同时必须看概率之和和平均R。');
put('9. **出列不治顽固。** lapses是Review态答错累计次数，不是所有“忘了”的总次数；同日stubborn是当天错到3次，和累计阈值6/8是两套判据。出列词仍衰减，导致180天均值明显下滑；该结果不支持只把池子藏起来后宣称长期掌握提升。');
put('10. **纯SQL/脚本诊断是关联。** 首日需要答更多次的词本就更难，晚段可能有更难词和更多回炉，当前累计lapses也带事后选择。相邻评分包含看题、翻面、看答案及停顿，没有精确反应时。所有不足100的格子都标样本少；不据此推断手滑、认知能力或疾病。');
put('11. **计时不是墙上时间。** 12秒和11.892秒均为作答量换算，可能漏掉讲解、整理和休息，也不保证日均耗时可实际承受。无上限重算方案的首日可超过一天可用时间，所以只作为计算对照，不是可执行日计划。');
put('12. **只读与隐私。** 未联网、未安装依赖、未访问5173、未写主目录、未运行任何git写操作、未改应用；所有可重跑脚本及该报告之外的产物都在gitignore私有目录。没有公开词条原文、读音、释义、词标识清单、流水或数据库导出。复跑步骤见同名脚本目录README。');
// Keep the conclusion within the requested twelve source lines.
const conclusionStart=out.indexOf('## 结论'),conclusionEnd=out.indexOf('## 标定');
const conclusion=out.slice(conclusionStart+1,conclusionEnd);
conclusion[3]+=' '+conclusion[4];conclusion.splice(4,1);
out.splice(conclusionStart+1,conclusionEnd-conclusionStart-1,...conclusion);
const text=out.join('\n\n')+'\n';
if(/[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9f]/u.test(text))throw new Error('Privacy gate: kana in generated report');
writeFileSync(resolve(OUT,'report.md'),text);
console.log(`REPORT OK: ${entries.length} configurations; ${text.length} characters; private output only`);
