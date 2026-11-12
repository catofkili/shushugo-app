import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OUT,START,dateStr,read,spread } from './common.mjs';
const grid=read('grid-r2.json'),cal=read('calibration-r2.json');
const entries=Object.values(grid.results);
const bands=['≤45','45–70','70–100','100–140','>140'];
const minutes=r=>r.summary.steadyAnswers.mid*.2;
const band=r=>{const m=minutes(r);return m<=45?0:m<=70?1:m<=100?2:m<=140?3:4;};
const get=(code,plateau=false)=>entries.find(r=>r.code===code&&r.config.plateau===plateau);
const ranked=(plateau,b,key)=>entries.filter(r=>r.config.plateau===plateau&&band(r)===b).sort((a,z)=>z.summary[key].mid-a.summary[key].mid||a.code.localeCompare(z.code));
const pair=(a,b,key,plateau=false)=>spread(get(a,plateau).seedMetrics.map((m,i)=>(m[key]-get(b,plateau).seedMetrics[i][key])*(key.endsWith('Answers')?.2:1)));
const separated=(a,b,key,plateau=false)=>{const x=get(a,plateau).summary[key],y=get(b,plateau).summary[key];return x.min>y.max||y.min>x.max;};
const f=(n,d=1)=>Number(n).toFixed(d);
const signed=(n,d=0)=>`${n>=0?'+':''}${f(n,d)}`;
const range=(s,m=1,d=1)=>`${f(s.mid*m,d)}［${f(s.min*m,d)}～${f(s.max*m,d)}］`;
const diff=s=>`${signed(s.mid)}［${signed(s.min,1)}～${signed(s.max,1)}］`;
const cap=r=>r.config.cap===1000000?'全出':r.config.cap;
const name=r=>`${r.code} ${r.config.schedule} / ${r.config.gate} / ${cap(r)}`;
const scene=p=>p?'封顶79%':'主场景';
const table=(headers,rows)=>['| '+headers.join(' | ')+' |','| '+headers.map(()=>'---').join(' | ')+' |',...rows.map(r=>'| '+r.join(' | ')+' |')].join('\n');
const peak=(r,key)=>{
  const dates=[...new Set(r.seedMetrics.map(m=>dateStr(m[`${key}Day`])))].sort();
  return `${range(r.summary[key],.2)}；${dates.join('、')}`;
};
const q1=pair('R22','R02','d180_expected'),q1c=pair('R22','R02','d180_expected',true);
const q2=pair('R33','R27','d180_expected'),q2c=pair('R33','R27','d180_expected',true),q2f3=pair('R37','R28','d180_expected');
const q3=pair('R30','R43','d180_expected'),q3strong=pair('R31','R44','d180_expected');
const lines=[
  '# 减负模拟第二轮：只降上限与会原谅的顽固词闸',
  '',
  '## 四个问题',
  '',
  `1. **换拟合参数多记多少？** 无闸、上限200：默认${f(minutes(get('R02')))}、拟合${f(minutes(get('R22')))}分钟，第180天拟合多${diff(q1)}词，两组种子范围分开；封顶只多${diff(q1c)}词，范围重叠。优势依赖记忆场景，不能一概说更好。`,
  '',
  `2. **会原谅的闸哪个最好？** 接近等时的F2（P1a/150，${f(minutes(get('R33')))}分钟）比现行闸（P1a/300，${f(minutes(get('R27')))}分钟）多${diff(q2)}词，封顶也多${diff(q2c)}。F1/200仅多${diff(pair('R30','R26','d180_expected'))}词。70分钟预算中，F3/150比同排期现行闸最佳组合多${f(q2f3.mid,0)}词，但实际${f(minutes(get('R37')))}对${f(minutes(get('R28')))}分钟；三种闸里F3记得最多，完全无闸还更多。`,
  '',
  `3. **重算值不值？** 200/F1的第180天仅多${diff(q3)}词，差距小于种子波动，**不值得重算**；另两项现行闸的种子范围也重叠。300/F1则多${diff(q3strong)}词且范围分开。重算每天多约5.5～6.5分钟，考试日多90～218词；不能把长期结论套到考前。`,
  '',
  '4. **目标0.70比0.80怎样？** 同闸、同上限：主场景每天省5.9～7.8分钟，第180天少37～54词；考试日上限200反多14～19词，300少54～72词。封顶每天省5.9～8.4分钟、第180天反多11～30词，说明“再降目标必然少记”不成立。',
  '',
  '以上“多/少”均为同种子相减后的中位数，方括号是5个种子的最小～最大；不一定等于两列中位数直接相减。“超出种子波动”只指本次两组种子范围分开，且配对差值方向一致，不等于通过统计显著性检验。',
  '',
  `本轮历史窗口标定${cal.pass?'过闸':'未过闸'}：首答${f(cal.summary.first.mid)}词/学习日（高${f(cal.errors.first*100)}%）、作答${f(cal.summary.answers.mid)}次（高${f(cal.errors.answers*100)}%）、跨日首答遗忘${f(cal.summary.forgot.mid*100)}%（相对高${f(cal.errors.forgot*100)}%）。**仍未完成独立标定，全部未来数字都是模型预测。**`,
  '',
  '## 等时间对比',
  '',
  '以第15～180天的日均作答时间分档，所有组合都参加。各档互斥：≤45、>45且≤70、>70且≤100、>100且≤140、>140分钟。每个场景分别取前5名，不足5个就全部列出。排名只用未四舍五入的中位数。',
  '',
  '**同档不是严格等时。** 表里列出实际耗时，并补充接近等时的配对核对。无上限组合可能把大量工作挤在前14天；不能只看第15天之后的均值，因此同时列前14天和全程峰值。封顶场景按自身耗时重新分档。',
  '',
  '### 表1：各时间档第180天预计能想起词数前5名',
  '',
];
for(const [key,title] of [['d180_expected',null],['exam_expected','### 表2：各时间档考试日预计能想起词数前5名']]) {
  if(title)lines.push('',title,'');
  const rs=[];
  for(const plateau of [false,true])for(let b=0;b<5;b++) {
    const group=ranked(plateau,b,key);
    for(const [i,r] of group.slice(0,5).entries())rs.push([scene(plateau),bands[b],i+1,name(r),range(r.summary.steadyAnswers,.2),f(r.summary.earlyAnswers.mid*.2),f(r.summary.peak.mid*.2),range(r.summary.exam_expected),range(r.summary.d180_expected)]);
  }
  lines.push(table(['场景','分钟档','档内名次','组合：排期 / 闸 / 上限','实际日均分钟','前14天日均分钟','全程峰值分钟','考试日预计想起词数','第180天预计想起词数'],rs));
}
const position=(r,key)=>ranked(r.config.plateau,band(r),key).findIndex(x=>x.code===r.code)+1;
const mismatches=entries.filter(r=>!r.config.plateau).filter(r=>{const z=get(r.code,true);return band(r)!==band(z)||position(r,'d180_expected')!==position(z,'d180_expected')||position(r,'exam_expected')!==position(z,'exam_expected');});
lines.push('', '### 表3：仅列两种场景档内排名不一致的组合', '',
  `共${mismatches.length}个。名次按各档全部组合排序，包含前5名以外的名次；不是把两个场景混在一起排。若档位改变，同样保留以免隐藏跨档变化。`, '',
  table(['组合','主场景分钟档','封顶分钟档','主场景日均分钟','封顶日均分钟','第180天名次：主 / 封顶','考试日名次：主 / 封顶'],mismatches.map(r=>{const z=get(r.code,true);return [name(r),bands[band(r)],bands[band(z)],f(minutes(r)),f(minutes(z)),`${position(r,'d180_expected')} / ${position(z,'d180_expected')}`,`${position(r,'exam_expected')} / ${position(z,'exam_expected')}`];})),
  '', '### 接近等时与同预算的核对', '',
  '前四行实际日均耗时相差约1分钟；最后一行只比较同为70分钟以内的预算，实际耗时多约10分钟，不声称是等时因果收益。所有差值都是右侧新方案减左侧对照。', '',
  table(['比较','场景','对照 → 新方案','实际日均分钟','第180天多想起词数','超过两组种子范围'],[
    ['换排期','主场景','R02 → R22',`${f(minutes(get('R02')))} → ${f(minutes(get('R22')))}`,diff(q1),separated('R22','R02','d180_expected')?'是':'否'],
    ['换排期','封顶79%','R02 → R22',`${f(minutes(get('R02',true)))} → ${f(minutes(get('R22',true)))}`,diff(q1c),'否'],
    ['换闸','主场景','R27 → R33',`${f(minutes(get('R27')))} → ${f(minutes(get('R33')))}`,diff(q2),'是'],
    ['换闸','封顶79%','R27 → R33',`${f(minutes(get('R27',true)))} → ${f(minutes(get('R33',true)))}`,diff(q2c),'是'],
    ['同70分钟预算','主场景','R28 → R37',`${f(minutes(get('R28')))} → ${f(minutes(get('R37')))}`,diff(q2f3),'是，但用时增加'],
  ]),
  '',
  'F1的“原谅”没有解开黑洞：P1a/200第180天池子仍为2014词，现行为2050词；P1a/300分别1996与2022词。原因是池中每天最多随机放回10个，要轮到同一个词并连对两次本就很慢。F2/150的池子降到1774词，F3没有池；F3仍会在上限不足时反复推迟难词，池子为0并不等于所有词都得到照顾。',
  '',
  'F3不是本轮总体最优：70分钟以内，主场景无闸P1a/150预计想起2470词，F3/P1a/150为2316；封顶场景默认无闸/150为2322词，F3/P0/150为2228。优先保住普通词有代价，不能把“取消池子”当成已解决遗忘。',
  '', '### 上线重算与不重算：四组完整配对', '',
  '同闸、同上限、同种子。正数表示重算更多；“范围分开”是两组第180天词数的种子区间不重叠。', '',
  table(['场景','闸 / 上限','不重算 → 重算','每天多用分钟','考试日多想起词数','第180天多想起词数','第180天种子范围分开'],[false,true].flatMap(p=>[['R26','R41'],['R27','R42'],['R30','R43'],['R31','R44']].map(([a,b])=>[scene(p),`${get(a).config.gate} / ${cap(get(a))}`,`${b} → ${a}`,range(pair(a,b,'steadyAnswers',p)),diff(pair(a,b,'exam_expected',p)),diff(pair(a,b,'d180_expected',p)),separated(a,b,'d180_expected',p)?'是':'否']))),
  '',
  '主场景现行闸的两项长期区间重叠，200/F1的配对差值还跨0；若只为了第180天少花时间，不值得重算。300/F1的长期增益在这5个种子里清楚，但每天仍多用约6.5分钟；封顶时长期反少约25词。考试日前的增益单独看，不能混成“重算总无用”。本轮没有P1b无闸，不能用这些有池结果断言无闸也无需重算。',
  '', '### 目标从0.80降到0.70：四组完整配对', '',
  '正数表示0.70更多或更省；考试日前两项的正收益来自上限下排期与抽样的相互作用，不代表遗忘目标越低越好。', '',
  table(['场景','闸 / 上限','0.80 → 0.70','每天省分钟','考试日多想起词数','第180天多想起词数'],[false,true].flatMap(p=>[['R45','R26'],['R46','R27'],['R47','R30'],['R48','R31']].map(([a,b])=>{const time=pair(a,b,'steadyAnswers',p);return [scene(p),`${get(a).config.gate} / ${cap(get(a))}`,`${b} → ${a}`,range({mid:-time.mid,min:-time.max,max:-time.min}),diff(pair(a,b,'exam_expected',p)),diff(pair(a,b,'d180_expected',p))];}))),
  '',
  '## 全部组合',
  '',
  '48个排期、闸、上限组合 × 2种真实记忆场景 × 5个种子 = 480条180天轨迹。均从2026-11-10的冻结状态开始，2026-11-11为第1天，2027-05-09为第180天。已学3869词全部计入知识量，含381个熟知退出词；日常活动词3488个。普通新词0，未见的157个搭配不投放；已学的搭配照常复习。',
  '',
  'P0=默认参数、目标0.90；P1a=拟合参数、目标0.80、上线重算；P1b=同样拟合0.80、保留旧状态及到期日、后续答题才切新参数；P3a=拟合0.70、上线重算。a重算的是排期，四种排期的真实记忆起点相同。',
  '',
  table(['闸','大白话规则','第180天池子列的含义'],[
    ['L0','不设闸，到期都可参加随机抽取','0，没有池'],
    ['L8/10','累计遗忘至少8次就入池，每天随机放回至多10个；答对不解除','当前仍在累计闸里的活动词'],
    ['F1','累计遗忘至少8次先入池；两次连续跨日首答正确放出；放出后累计再有2次跨日首答“忘了”才回池；每天随机放回至多10个','当前未获原谅或已再次入池的活动词'],
    ['F2','最近至多10次跨日首答中，“忘了”至少5次才入池；每天随机放回至多10个','当前滚动窗口触发闸的活动词'],
    ['F3','不设池，累计遗忘至少8次的到期词放在普通词后面；先随机填普通词，剩余名额再随机填难词','0；可能仍有被推迟的难词'],
  ]),
  '',
  '跨日首答是同一个词在较晚学习日的第一次回答；首次真实学习和同日补答都不计。F1/F2的起始判据从截至11-10的历史首答重建，不把历史清零。F1的两次再忘不要求连续，模糊会打断连对但不充作“忘了”。不足10次历史时，F2不补样本、不按比例放大。累计遗忘沿用FSRS的Review态遗忘计数，和跨日“忘了”次数不是同一个量。',
  '',
  '上限150/200/300指每天总首答词数，同日补答不占；闸先筛，再在余下名额内随机取。池内10个只是最多获得候选资格，随后仍可能被总上限挤掉。F3只在两档之间保留优先级，各档内随机。“全出”指通过闸后的词全出，没有把池里其余词一并放回。',
  '',
  '以下所有统计均为5种子的中位数［最小～最大］，一位小数；词数阈值及总作答为整数。日均分钟=该段全部作答次数×12秒÷60÷自然日数；每天都学，不另加休息。峰值先逐种子找最高日，再汇总其分钟；日期列列出5种子各自首次达到该峰值的全部日期，不把中位日期伪装成共同峰值。',
  '',
  '考试日为2026-12-06（第26天），第60天为2027-01-09；三次知识检查均在当天完成计划之后。“平均能想起”是3869个词的概率平均；“预计想起词数”是概率之和；“有八成把握词数”是R≥0.8的词数。熟知退出和池中词照样衰减，不算免费掌握。封顶79%的回答概率与知识统计都封顶，因此有八成把握词数恒为0，应看预计想起词数。',
  '',
);
for(const plateau of [false,true]) {
  const rows=entries.filter(r=>r.config.plateau===plateau).sort((a,b)=>a.code.localeCompare(b.code));
  lines.push(`### ${scene(plateau)}：用时、峰值与池子`,'',
    '<details>',`<summary>展开${rows.length}个组合的完整用时</summary>`,'',
    table(['组合：排期 / 闸 / 上限','前14天日均分钟','该段最高日分钟及日期','第15～60天日均分钟','该段最高日分钟及日期','第151～180天日均分钟','该段最高日分钟及日期','第15～180天日均分钟','全程最高日分钟及日期','180天总作答次数','第180天池子词数'],rows.map(r=>[name(r),range(r.summary.earlyAnswers,.2),peak(r,'earlyPeak'),range(r.summary.middleAnswers,.2),peak(r,'middlePeak'),range(r.summary.lateAnswers,.2),peak(r,'latePeak'),range(r.summary.steadyAnswers,.2),peak(r,'peak'),range(r.summary.totalAnswers,1,0),range(r.summary.pool180,1,0)])),
    '', '</details>', '', `### ${scene(plateau)}：三次知识检查`, '',
    '<details>',`<summary>展开${rows.length}个组合的完整记忆指标</summary>`,'',
    table(['组合','考试日平均能想起','考试日预计想起词数','考试日有八成把握词数','第60天平均能想起','第60天预计想起词数','第60天有八成把握词数','第180天平均能想起','第180天预计想起词数','第180天有八成把握词数'],rows.map(r=>[r.code,...['exam','d60','d180'].flatMap(k=>[range(r.summary[`${k}_meanR`],100)+'%',range(r.summary[`${k}_expected`]),range(r.summary[`${k}_remembered`],1,0)])])),
    '', '</details>', '');
}
lines.push('## 建议', '',
  '**首选：R22，P1a（拟合0.80、上线重算）+ L0无闸 + 每天首答最多200个、随机取。** 第15～180天约84.9分钟/日，前14天87.4、第15～60天86.0、后30天83.7；峰值99.2分钟［98.0～101.8］。第180天预计想起2687词［2685～2705］，考试日2604词；封顶场景分别2500和2422词。它在70～100分钟档的长期词数两场景都排第一，池子为0。', '',
  '**保守备选：R01，P0（默认0.90）+ L0无闸 + 每天首答最多150个、随机取。** 第15～180天约67.7分钟/日，前14天69.8、第15～60天69.0、后30天66.4；峰值82.2分钟［81.0～84.6］。第180天预计想起2426词［2421～2444］，考试日2384词；封顶场景分别2322和2283词。它保留默认参数，不重算；适合每天约70分钟的预算。', '',
  '不再把每天二三十分钟但池中藏着约2000词的现行闸作为长期首选。若每天只能给约54分钟且必须保留闸，R33（P1a/F2/150）比R27（P1a/现行/300）用时接近、主场景多约103词，封顶多约69词；这是明确的低时长退路，但第180天仍有1774词在池里，预计想起1975词，不能与无闸首选当成同一效果。', '',
  'F1不建议优先做：规则复杂了，长期池子仍接近2000词，收益常落在种子起伏里。F3在本轮三种会原谅方案中保留的长期知识最多，却没有胜过相近预算的L0；本轮不据此增加排期优先级。0.70暂不作为首选，节省约6～8分钟的同时主场景半年后少约40～50词，且封顶场景方向不同。', '',
  '这些都是离线候选，尚未改应用。首选重算只代表本轮已运行的R22；无闸P1b没有被要求扫描，尚无证据决定无闸是否可以省掉重算。若后续进入实现，应先补无闸a/b验证和独立历史窗口，再决定迁移方式；这不影响本轮完整交付。', '',
  '## 局限', '',
  '1. **第四轮只在原历史窗口过闸，未来未独立标定。** 第三轮以515为每天已排复习量，第四轮改为min(515，当天任务表实际排的复习数)，再乘第三轮已有的参与比例；新词仍固定25，目标仍为387/847/39%，没有调倍率或反推每题时间。第四轮结果为388.3/912.3/42.9%，三项相对误差都小于15%。参与比例来自同一窗口的已答/已排，首答过闸部分依赖这项观察，并非独立预测成功。没有再做第五轮。', '',
  '2. **同档与严格等时不同。** 45～70分钟档跨度25分钟；本报告如实列耗时，不在缺少重叠的时间区间里插值或外推。F3与现行闸在本轮同排期的实际耗时没有严格匹配，只能给同预算比较；不能宣称F3的额外词数全是规则本身带来的。首14天不进分档，不等于不花时间。', '',
  '3. **“换参数”是整套排期比较。** P0/0.90与拟合/0.80同时改变权重、目标，a还重算。不能把收益单独归功于权重；拟合权重也是主场景的真实模型，偏向匹配自身的排期。封顶敏感性中，150/200的拟合优势消失或减弱，未提供真实未来回忆验证。5个种子不是参数或模型不确定性的置信区间。', '',
  '4. **同一真实库存，固定不再学新词。** 知识量分母始终3869。未见搭配不借作普通新词；未模拟另设搭配配额、主动点名、新方向、其他卡型、缺席或中途停止。所有预测仅覆盖单词正向学习，不能当JLPT分数或整天学习总时间。', '',
  '5. **历史状态仍有重建误差。** 延续第一轮：3364个非先验日常词中84.2%的S误差在1%内，89.0%的due误差在1分钟内。P0/b用冻结库状态，a重放全部历史；a重放也使初始累计闸池从584变589。F1/F2从历史跨日首答重建，先验卡第一次真实作答不视为已有真实跨日历史；未来累积的两次再忘只数“忘了”，模糊不计。', '',
  '6. **同日学习仍是第一轮模型。** 回炉抽取真实同类序列并完成官方学习/重学步骤，未模拟真实交错排片、疲劳、同组回避、解释、整理、休息。12秒是按全部作答次数换算的主动学习时间，首答上限不是分钟硬上限。无上限方案有巨大首日峰值，不能视为可执行计划。', '',
  '7. **零池子不能证明没有遗漏。** L0、F3没有池，所以池子列为0；仍可能因随机总上限或F3的第二档而长期延后。统计把所有已学词都自然衰减；没有把出列词、熟知词或未被抽中的词直接算成掌握。考试日统计在当天学完后，真实上午考试可能更低。', '',
  '8. **证据和文件边界。** 只读既有冻结库与已装依赖，没有联网、安装、访问5173、改主目录或改frontend/src，也没有任何Git写操作。第一轮报告、网格与标定结果未覆盖；兼容性验收只更新第一轮私有校验清单。第二轮数据、检查点、逐日聚合和中间报告均在frontend/.local/load-sim/policy-results/；公开只放脚本、增补README及本报告，无词条、读音或词标识清单。', '',
  '重跑步骤见[同目录README](2026-11-12-load-policy-sim/README.md)。', '');
writeFileSync(resolve(OUT,'report-r2.md'),lines.join('\n'));
console.log(JSON.stringify({report:'frontend/.local/load-sim/policy-results/report-r2.md',configurations:entries.length,rankingMismatches:mismatches.length,calibration:cal.status}));
