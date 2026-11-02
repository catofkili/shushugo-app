/* 由 scripts/build-shared.mjs 从 frontend/src 生成，别手改；改网页那份再重跑。 */
/*
 * 网页模块用到的三样浏览器全局，在小程序里的最小替身。打包时内联在 web.js 顶部。
 *  - localStorage → wx 同步存储（studyPreferences 那份偏好就存在这里，键名和网页一致）
 *    微信本地存储总量 10 MB、单键 1 MB；SQLite 学习库必须留在文件系统，不能放这里。
 *  - window.dispatchEvent / addEventListener → 进程内事件总线（PREFERENCES_EVENT、YUZU_EVENT）
 *  - Event / CustomEvent → 只带 type 和 detail 的普通对象
 *  - crypto.randomUUID / getRandomValues → Math.random 兼容层：只用于设备号唯一性和 SQLite 随机排序，绝不可用于密钥、令牌或支付签名。
 *  - document.documentElement → 只有 setAttribute / removeAttribute 的空壳：applyTheme / applyMotionLevel /
 *    applyYuzuEquipment 往它上面写 data-* 属性，小程序里没人读，页面自己按 equippedItem 套皮肤。
 */
(function installPolyfill(scope) {
  if (!scope.localStorage) {
    const hasWx = typeof wx !== 'undefined' && wx && typeof wx.getStorageSync === 'function';
    const memory = new Map();
    const registryKey = '__shushugo_local_storage_keys__';
    const keys = () => {
      if (!hasWx) return [...memory.keys()];
      try {
        const saved = wx.getStorageSync(registryKey);
        const registered = Array.isArray(saved) ? saved : [];
        const existing = wx.getStorageInfoSync?.().keys || [];
        return [...new Set([...registered, ...existing.filter((key) => key.startsWith('mn-') || key.startsWith('jp-grammar-'))])]
          .filter((key) => key !== registryKey);
      } catch { return []; }
    };
    const saveKeys = (next) => {
      if (!hasWx) return;
      wx.setStorageSync(registryKey, next);
    };
    scope.localStorage = {
      get length() { return keys().length; },
      key(index) { return keys()[Number(index)] ?? null; },
      getItem(key) {
        if (!hasWx) return memory.has(key) ? memory.get(key) : null;
        try { const value = wx.getStorageSync(key); return value === '' || value == null ? null : String(value); } catch { return null; }
      },
      setItem(key, value) {
        if (!hasWx) { memory.set(key, String(value)); return; }
        wx.setStorageSync(key, String(value));
        const current = keys();
        if (!current.includes(String(key))) saveKeys([...current, String(key)]);
      },
      removeItem(key) {
        if (!hasWx) { memory.delete(key); return; }
        wx.removeStorageSync(key);
        saveKeys(keys().filter((item) => item !== String(key)));
      },
      clear() {
        const current = keys();
        if (!hasWx) { memory.clear(); return; }
        current.forEach((key) => wx.removeStorageSync(key));
        saveKeys([]);
      }
    };
  }
  if (typeof scope.btoa !== 'function' || typeof scope.atob !== 'function') {
    const wxBase64 = typeof wx !== 'undefined' && wx;
    if (typeof scope.btoa !== 'function') scope.btoa = (value) => {
      if (wxBase64?.arrayBufferToBase64) {
        const bytes = new Uint8Array(value.length);
        for (let index = 0; index < value.length; index += 1) bytes[index] = value.charCodeAt(index);
        return wx.arrayBufferToBase64(bytes.buffer);
      }
      throw new Error('Base64 编码不可用');
    };
    if (typeof scope.atob !== 'function') scope.atob = (value) => {
      if (wxBase64?.base64ToArrayBuffer) {
        const bytes = new Uint8Array(wx.base64ToArrayBuffer(value));
        let output = '';
        for (let start = 0; start < bytes.length; start += 0x8000) {
          output += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
        }
        return output;
      }
      throw new Error('Base64 解码不可用');
    };
  }
  if (typeof scope.Event !== 'function') {
    scope.Event = function Event(type) { this.type = String(type); };
    scope.CustomEvent = function CustomEvent(type, init) { this.type = String(type); this.detail = init ? init.detail : undefined; };
  }
  if (!scope.document) {
    const attributes = new Map();
    scope.document = {
      documentElement: {
        setAttribute(name, value) { attributes.set(name, String(value)); },
        removeAttribute(name) { attributes.delete(name); },
        getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; }
      }
    };
  }
  if (!scope.crypto || typeof scope.crypto.randomUUID !== 'function') {
    // sync/schema 的设备号用 crypto.randomUUID()；小程序运行时没有 Web Crypto。
    const hex = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    scope.crypto = Object.assign(scope.crypto || {}, {
      randomUUID: () => `${hex(8)}-${hex(4)}-4${hex(3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${hex(3)}-${hex(12)}`
    });
  }
  if (typeof scope.crypto.getRandomValues !== 'function') {
    // sql.js 的 Emscripten random_get 需要同步 Uint8Array；它会被 SQLite RANDOM() 用于排序和非安全种子。
    // wx.getRandomValues 是异步 API，不能满足该接口；认证与支付凭证不使用此兼容函数。
    scope.crypto.getRandomValues = (bytes) => {
      if (!(bytes instanceof Uint8Array)) throw new TypeError('getRandomValues 只接受 Uint8Array');
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
      return bytes;
    };
  }
  if (!scope.window || typeof wx !== 'undefined') {
    const listeners = new Map();
    const eventTarget = {
      addEventListener(type, handler) { const list = listeners.get(type) || []; list.push(handler); listeners.set(type, list); },
      removeEventListener(type, handler) { listeners.set(type, (listeners.get(type) || []).filter((item) => item !== handler)); },
      dispatchEvent(event) { (listeners.get(event.type) || []).slice().forEach((handler) => { try { handler(event); } catch (error) { console.warn('[shared] 事件回调出错', error); } }); return true; }
    };
    if (!scope.window) scope.window = eventTarget;
    scope.__shushugoWindow = eventTarget;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof global !== 'undefined' ? global : this));

// 微信逻辑层会在页面切换时重建全局代理；网页源码里的裸引用要抓住本模块初始化的替身。
var sharedScope = typeof globalThis !== 'undefined' ? globalThis : (typeof global !== 'undefined' ? global : this);
var localStorage = sharedScope.localStorage;
var window = sharedScope.__shushugoWindow || sharedScope.window;
var Event = sharedScope.Event;
var CustomEvent = sharedScope.CustomEvent;
var document = sharedScope.document;
var crypto = sharedScope.crypto;

var UN=Object.create;var Bs=Object.defineProperty;var FN=Object.getOwnPropertyDescriptor;var WN=Object.getOwnPropertyNames;var jN=Object.getPrototypeOf,$N=Object.prototype.hasOwnProperty;var h=(e,t)=>()=>(e&&(t=e(e=0)),t);var le=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports),x=(e,t)=>{for(var r in t)Bs(e,r,{get:t[r],enumerable:!0})},WE=(e,t,r,n)=>{if(t&&typeof t=="object"||typeof t=="function")for(let o of WN(t))!$N.call(e,o)&&o!==r&&Bs(e,o,{get:()=>t[o],enumerable:!(n=FN(t,o))||n.enumerable});return e};var N=(e,t,r)=>(r=e!=null?UN(jN(e)):{},WE(t||!e||!e.__esModule?Bs(r,"default",{value:e,enumerable:!0}):r,e)),PN=e=>WE(Bs({},"__esModule",{value:!0}),e);var $=le((wD,$E)=>{var Xs=null,HN=()=>require("../runtime/database-store"),Ys=()=>Xs||HN().getDatabase(),jE=()=>Ys().constructor;$E.exports={getDatabase:Ys,openDatabase:async e=>new(jE())(e),createDatabase:async()=>new(jE()),exportDatabase:()=>Ys().export(),initDatabase:async()=>Ys(),withDatabase(e,t){let r=Xs;Xs=e;try{return t()}finally{Xs=r}}}});var zs,So,yo,jr=h(()=>{"use strict";zs=e=>e.t===0?"core":e.t===2?"optional":"common",So=e=>`${e} IN (SELECT id FROM words WHERE pos = '\u56FA\u5B9A\u642D\u914D' AND collocation_tier = 2)`,yo=e=>`CASE
  WHEN ${e} IN (SELECT id FROM words WHERE pos = '\u56FA\u5B9A\u642D\u914D' AND collocation_tier = 0) THEN 0
  WHEN ${So(e)} THEN 3
  WHEN ${e} IN (SELECT id FROM words WHERE pos = '\u56FA\u5B9A\u642D\u914D') THEN 2 ELSE 1 END`});var Xd={};x(Xd,{BACKLOG_SPREAD_DAYS:()=>BN,CONSOLIDATION_DAYS:()=>KN,EXAM_WEEK_DAYS:()=>GN,JLPT_TARGETS:()=>F,MAX_DAILY_NEW_GRAMMAR:()=>Kd,MAX_DAILY_NEW_WORDS:()=>Hd,availableShortfall:()=>YN,computeDailyMinimum:()=>Gd,consolidationDays:()=>Js,daysBetween:()=>Vt,levelsInScope:()=>wr,shortfallOf:()=>Bd,shortfallText:()=>zN});var F,wr,KN,Js,GN,BN,Hd,Kd,Vt,XN,Vs,Gd,Bd,YN,zN,_t=h(()=>{"use strict";F=["N5","N4","N3","N2","N1"],wr=e=>F.slice(0,F.indexOf(e)+1),KN=21,Js=e=>e===null?21:Math.max(0,Math.min(21,Math.floor(e/4))),GN=7,BN=7,Hd=50,Kd=12,Vt=(e,t)=>{let r=new Date(e.getFullYear(),e.getMonth(),e.getDate()),n=new Date(t.getFullYear(),t.getMonth(),t.getDate());return Math.round((n.getTime()-r.getTime())/864e5)},XN=(e,t)=>e<0?"past":e<=7?"exam-week":e<=t?"consolidate":"intake",Vs=(e,t)=>e<=0?0:t<=0?e:Math.ceil(e/t),Gd=e=>{let t=Vt(e.today,e.examDate),r=Js(e.planStartedOn?Vt(e.planStartedOn,e.examDate):null),n=XN(t,r),o=Math.max(t-r,0),s=n==="intake",i=s?Vs(e.unseenWords,o):0,a=s?Vs(e.unseenGrammar,o):0,d=Math.max(Math.min(7,t),1),u=n==="past"?0:e.freshDueWords+Vs(e.overdueWords,d),l=n==="past"?0:e.freshDueGrammar+Vs(e.overdueGrammar,d),c=Math.max(Math.ceil(e.unseenWords/50),Math.ceil(e.unseenGrammar/12));return{daysLeft:t,intakeDaysLeft:o,phase:n,consolidationDays:r,newWords:Math.min(i,50),reviewWords:u,newGrammar:Math.min(a,12),reviewGrammar:l,feasible:e.unseenWords===0&&e.unseenGrammar===0||s&&Math.ceil(e.unseenWords/50)<=o&&Math.ceil(e.unseenGrammar/12)<=o,daysNeeded:c+r}},Bd=(e,t)=>{let r=(a,d)=>Math.max(a-d,0),n=r(e.newWords,t.newWordsDone),o=r(e.reviewWords,t.reviewWordsDone),s=r(e.newGrammar,t.newGrammarDone),i=r(e.reviewGrammar,t.reviewGrammarDone);return{newWords:n,reviewWords:o,newGrammar:s,reviewGrammar:i,clear:n+o+s+i===0}},YN=(e,t,r=!1)=>{let n=r?0:e.newWords,o=e.reviewWords,s=t?e.newGrammar:0,i=t?e.reviewGrammar:0;return{newWords:n,reviewWords:o,newGrammar:s,reviewGrammar:i,clear:n+o+s+i===0}},zN=e=>{if(e.clear)return"\u4ECA\u5929\u7684\u6700\u4F4E\u91CF\u5DF2\u7ECF\u505A\u5B8C\u4E86";let t=[];return e.reviewWords>0&&t.push(`\u590D\u4E60 ${e.reviewWords}`),e.newWords>0&&t.push(`\u65B0\u8BCD ${e.newWords}`),e.reviewGrammar>0&&t.push(`\u8BED\u6CD5\u590D\u4E60 ${e.reviewGrammar}`),e.newGrammar>0&&t.push(`\u65B0\u8BED\u6CD5 ${e.newGrammar}`),`\u8FD8\u5DEE ${t.join(" \xB7 ")}`}});var qd={};x(qd,{EXAM_TYPES:()=>zd,announcedExamDates:()=>PE,defaultExamDate:()=>Ro,examDatesOfYear:()=>wn,examEndAt:()=>qs,examLabel:()=>VN,firstSundayOf:()=>Yd,formatExamDate:()=>Jd,formatExamDateHuman:()=>QN,isExamKind:()=>No,nextExamDate:()=>Vd,nextGaokaoDate:()=>KE,parseExamDate:()=>ht,suggestedExamDate:()=>HE,upcomingExamDates:()=>qN});var Yd,wn,zd,No,VN,JN,PE,HE,KE,Ro,qs,Vd,qN,ht,Jd,QN,Tn=h(()=>{"use strict";Yd=(e,t)=>{let n=(7-new Date(e,t-1,1).getDay())%7;return new Date(e,t-1,1+n)},wn=e=>[Yd(e,7),Yd(e,12)],zd=[{kind:"jlpt",label:"JLPT"},{kind:"eju",label:"EJU \u7559\u8003"},{kind:"kaoyan",label:"\u8003\u7814\u65E5\u8BED"},{kind:"university",label:"\u5927\u5B66\u65E5\u8BED\u56DB/\u516D\u7EA7"},{kind:"major",label:"\u65E5\u8BED\u4E13\u56DB/\u4E13\u516B"},{kind:"jtest",label:"J.TEST"},{kind:"nat",label:"NAT-TEST"},{kind:"bjt",label:"BJT \u5546\u52A1\u65E5\u8BED"},{kind:"gaokao",label:"\u9AD8\u8003\u65E5\u8BED"},{kind:"other",label:"\u5176\u4ED6\u8003\u8BD5"}],No=e=>zd.some(t=>t.kind===e),VN=e=>zd.find(t=>t.kind===e)?.label??"\u5176\u4ED6\u8003\u8BD5",JN={eju:["2026-11-08"],jtest:["2026-11-01"]},PE=(e,t=new Date)=>(JN[e]??[]).map(r=>ht(r)).filter(r=>r>=new Date(t.getFullYear(),t.getMonth(),t.getDate())),HE=(e,t=new Date)=>e==="gaokao"?KE(t):e==="jlpt"?Vd(t):PE(e,t)[0]??null,KE=(e=new Date)=>{let t=new Date(e.getFullYear(),5,8);return e>=qs("gaokao",t)?new Date(e.getFullYear()+1,5,8):t},Ro=(e,t=new Date)=>HE(e,t)??new Date(t.getFullYear(),t.getMonth(),t.getDate()-1),qs=(e,t)=>e==="gaokao"?new Date(t.getFullYear(),t.getMonth(),t.getDate(),17):new Date(t.getFullYear(),t.getMonth(),t.getDate()+1),Vd=(e=new Date)=>{let t=new Date(e.getFullYear(),e.getMonth(),e.getDate()),r=[...wn(e.getFullYear()),...wn(e.getFullYear()+1)];return r.find(n=>n.getTime()>=t.getTime())??r[0]},qN=(e=new Date)=>{let t=Vd(e),r=t.getFullYear();return[...wn(r),...wn(r+1),...wn(r+2)].filter(n=>n>=t).slice(0,4)},ht=e=>{let t=/^(\d{4})-(\d{2})-(\d{2})$/.exec(e.trim());if(!t)return null;let[,r,n,o]=t,s=new Date(Number(r),Number(n)-1,Number(o));return s.getMonth()!==Number(n)-1||s.getDate()!==Number(o)?null:s},Jd=e=>`${e.getFullYear()}-${String(e.getMonth()+1).padStart(2,"0")}-${String(e.getDate()).padStart(2,"0")}`,QN=e=>`${e.getMonth()+1} \u6708 ${e.getDate()} \u65E5`});var tt=le((SD,GE)=>{var Qd=null;function ZN(){Qd||(Qd=setTimeout(()=>{Qd=null;try{Promise.resolve(require("../runtime/database-store").saveDatabase()).catch(e=>{/尚未初始化/.test(String(e&&e.message))||console.warn("[shared] \u843D\u76D8\u5931\u8D25",e)})}catch(e){console.warn("[shared] \u843D\u76D8\u8DF3\u8FC7",e)}},300))}GE.exports={scheduleSave:ZN,requestFullSnapshot(){}}});var eu={};x(eu,{daysSince:()=>Lo,firstRow:()=>H,firstValue:()=>E,getState:()=>O,oncePerDatabase:()=>$r,persistContentSoon:()=>je,persistSoon:()=>D,rowsFor:()=>p,setState:()=>R,statementCache:()=>Zd,studyDate:()=>B,studyDayEnd:()=>A,today:()=>T});function $r(e,t){let r=(0,bo.getDatabase)(),n=BE.get(r);n||(n=new Set,BE.set(r,n)),!n.has(e)&&(t(),n.add(e))}function E(e,t=[],r){let n=(0,bo.getDatabase)().prepare(e);try{return t.length&&n.bind(t),n.step()?n.get()[0]:r}finally{n.free()}}function p(e,t=[]){return eR(e,t)}function H(e,t=[]){return p(e,t)[0]??null}function O(e,t){return E("SELECT value FROM app_state WHERE key = ?",[e],t)}function R(e,t){(0,bo.getDatabase)().run("INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)",[e,t])}function Lo(e){if(!e)return 0;let t=new Date(`${String(e)}T00:00:00`);if(Number.isNaN(t.getTime()))return 0;let r=new Date(`${B()}T00:00:00`);return Math.max(0,Math.floor((r.getTime()-t.getTime())/864e5))}function B(e=new Date){let t=new Date(e);return t.getHours()<4&&t.setDate(t.getDate()-1),tR(t)}function A(e=new Date){let t=new Date(e);return t.getHours()<4||t.setDate(t.getDate()+1),t.setHours(4,0,0,0),t}function D(){Promise.resolve().then(()=>N(tt(),1)).then(({scheduleSave:e})=>e())}function je(){Promise.resolve().then(()=>N(tt(),1)).then(({requestFullSnapshot:e,scheduleSave:t})=>{e(),t()})}var bo,eR,BE,tR,T,Zd,P=h(()=>{"use strict";bo=N($(),1),eR=(e,t=[])=>{let r=(0,bo.getDatabase)().prepare(e);try{t.length&&r.bind(t);let n=[];for(;r.step();)n.push(r.getAsObject());return n}finally{r.free()}},BE=new WeakMap;tR=e=>{let t=e.getFullYear(),r=String(e.getMonth()+1).padStart(2,"0"),n=String(e.getDate()).padStart(2,"0");return`${t}-${r}-${n}`};T=B;Zd=e=>{let t=new Map;return{run(r,n){let o=t.get(r);o||(o=e.prepare(r),t.set(r,o)),o.run(n)},free(){for(let r of t.values())r.free();t.clear()}}}});var lu={};x(lu,{GRAMMAR_INTENSITY_ANCHORS:()=>oR,GRAMMAR_INTENSITY_MAX:()=>JE,GRAMMAR_INTENSITY_MIN:()=>VE,INTENSITY_ANCHORS:()=>rR,INTENSITY_MAX:()=>zE,INTENSITY_MIN:()=>nR,LEVEL_ADVANCE_KEY:()=>au,LEVEL_ADVANCE_PAUSE_MS:()=>QE,MAX_DAILY_REVIEW:()=>Ao,PLAN_QUOTA_KEYS:()=>Sn,PLAN_REVIEW_DISABLED:()=>rt,POST_EXAM_LIGHT_DAYS:()=>ru,PREFERENCES_EVENT:()=>nu,REVIEW_CAP_UNLIMITED:()=>yn,STUDY_BUDDY_SHELVED:()=>sR,applyMotionLevel:()=>rf,applyTheme:()=>tf,choosePostExamIntensity:()=>cR,defaultStudyPreferences:()=>ae,ensureJlptPlanAnchor:()=>pR,getDailyGrammarGoal:()=>du,getDailyWordGoal:()=>Jt,getEffectiveStudyPreferences:()=>ot,getJlptPlanPreferences:()=>uu,getResolvedTheme:()=>ef,getReviewCapPreference:()=>Pr,getStudyPreferences:()=>X,isPostExamLightActive:()=>ho,jsMotionAllowed:()=>ER,kanaGatePending:()=>Qs,levelAdvanceNewCap:()=>Oo,levelAdvanceTarget:()=>Nn,levelUnseenContent:()=>ZE,normalizeStudyPreferences:()=>ou,postExamChoice:()=>iu,postExamRecovery:()=>su,readLevelAdvance:()=>ko,saveStudyPreferences:()=>nt,writeLevelAdvance:()=>mR});var nu,YE,rR,nR,zE,oR,VE,JE,sR,ae,iR,aR,dR,XE,yn,rt,Ao,uR,tu,ou,X,lR,Sn,nt,Qs,ru,qE,su,iu,cR,ho,au,QE,ko,mR,Nn,ZE,Oo,ot,Jt,du,Pr,pR,uu,ef,tf,rf,ER,pe=h(()=>{"use strict";_t();Tn();P();$e();nu="shushugo-preferences",YE="mn-study-preferences",rR=[{value:5,label:"\u8F7B\u677E"},{value:15,label:"\u65E5\u5E38"},{value:30,label:"\u8BA4\u771F"},{value:50,label:"\u51B2\u523A"}],nR=5,zE=50,oR=[{value:0,label:"\u53EA\u590D\u4E60"},{value:3,label:"\u8F7B\u677E"},{value:5,label:"\u65E5\u5E38"},{value:10,label:"\u8BA4\u771F"}],VE=0,JE=30,sR=!0,ae={theme:"system",autoPlay:!0,showRomaji:!1,showJlptLevel:!1,spellingEnabled:!1,includeOptionalExpressions:!1,dailyGoal:15,grammarDailyGoal:5,reviewCap:0,kanjiDailyGoal:5,confusionDailyGoal:5,grammarReviewCap:0,kanjiReviewCap:0,confusionReviewCap:0,zooSounds:!0,studyBuddy:!0,weeklyReportEnabled:!0,motionLevel:"full",voiceId:"",jlptPlanEnabled:!0,jlptTarget:"N3",planExamKind:"jlpt",jlptExamDate:"",jlptPlanStartedOn:""},iR=["full","reduced","off"],aR=e=>{let t=Number.isFinite(e)?Math.floor(e):ae.dailyGoal;return Math.min(zE,Math.max(0,t))},dR=e=>{let t=Number.isFinite(e)?Math.floor(e):ae.grammarDailyGoal;return Math.min(JE,Math.max(VE,t))},XE=(e,t)=>{let r=Number.isFinite(e)?Math.floor(e):0;return Math.min(t,Math.max(0,r))},yn=-1,rt=-1,Ao=2e3,uR=e=>Number.isFinite(e)?e<0?yn:e===0?0:Math.min(Ao,Math.max(1,Math.floor(e))):0,tu=e=>{let t=Number.isFinite(e)?Math.floor(e):0;return t===rt?rt:Math.min(Ao,Math.max(0,t))},ou=(e={})=>({theme:e.theme==="light"||e.theme==="dark"||e.theme==="system"?e.theme:"system",autoPlay:e.autoPlay??ae.autoPlay,showRomaji:e.showRomaji??ae.showRomaji,showJlptLevel:e.showJlptLevel??ae.showJlptLevel,spellingEnabled:e.spellingEnabled===!0,includeOptionalExpressions:e.includeOptionalExpressions===!0,dailyGoal:aR(Number(e.dailyGoal??ae.dailyGoal)),grammarDailyGoal:dR(Number(e.grammarDailyGoal??ae.grammarDailyGoal)),kanjiDailyGoal:XE(Number(e.kanjiDailyGoal??ae.kanjiDailyGoal),50),confusionDailyGoal:XE(Number(e.confusionDailyGoal??ae.confusionDailyGoal),20),grammarReviewCap:tu(Number(e.grammarReviewCap??0)),kanjiReviewCap:tu(Number(e.kanjiReviewCap??0)),confusionReviewCap:tu(Number(e.confusionReviewCap??0)),reviewCap:uR(Number(e.reviewCap??ae.reviewCap)),zooSounds:e.zooSounds??ae.zooSounds,studyBuddy:e.studyBuddy??ae.studyBuddy,weeklyReportEnabled:e.weeklyReportEnabled??ae.weeklyReportEnabled,motionLevel:iR.includes(e.motionLevel)?e.motionLevel:ae.motionLevel,voiceId:typeof e.voiceId=="string"?e.voiceId:ae.voiceId,jlptPlanEnabled:e.jlptPlanEnabled??ae.jlptPlanEnabled,jlptTarget:F.includes(e.jlptTarget)?e.jlptTarget:ae.jlptTarget,planExamKind:No(e.planExamKind)?e.planExamKind:"jlpt",jlptExamDate:/^\d{4}-\d{2}-\d{2}$/.test(String(e.jlptExamDate??""))?String(e.jlptExamDate):ae.jlptExamDate,jlptPlanStartedOn:/^\d{4}-\d{2}-\d{2}$/.test(String(e.jlptPlanStartedOn??""))?String(e.jlptPlanStartedOn):ae.jlptPlanStartedOn}),X=()=>{try{let e=localStorage.getItem(YE);return ou(e?JSON.parse(e):{})}catch{return ae}},lR=(e=new Date)=>`${e.getFullYear()}-${String(e.getMonth()+1).padStart(2,"0")}-${String(e.getDate()).padStart(2,"0")}`,Sn=["dailyGoal","reviewCap","grammarDailyGoal","grammarReviewCap","kanjiDailyGoal","kanjiReviewCap","confusionDailyGoal","confusionReviewCap"],nt=(e,t={})=>{let r=ou(e),n=X();if(!t.keepPlanAnchor&&(!r.jlptPlanStartedOn||n.jlptTarget!==r.jlptTarget||n.planExamKind!==r.planExamKind||n.jlptExamDate!==r.jlptExamDate)&&(r.jlptPlanStartedOn=lR()),!t.fromLevelPlanSync){let o=!1;try{o=!!O("starting_level","")}catch{}o&&(n.jlptPlanEnabled!==r.jlptPlanEnabled&&R("jlpt_plan_enabled",r.jlptPlanEnabled?"1":"0"),n.jlptTarget!==r.jlptTarget&&R("jlpt_plan_target",r.jlptTarget),n.planExamKind!==r.planExamKind&&R("jlpt_plan_exam_kind",r.planExamKind),n.jlptExamDate!==r.jlptExamDate&&R("jlpt_plan_exam_date",r.jlptExamDate),n.jlptPlanStartedOn!==r.jlptPlanStartedOn&&R("jlpt_plan_started_on",r.jlptPlanStartedOn),Sn.some(s=>n[s]!==r[s])&&R("level_plan_quotas",JSON.stringify(Object.fromEntries(Sn.map(s=>[s,r[s]])))))}return localStorage.setItem(YE,JSON.stringify(r)),window.dispatchEvent(new CustomEvent(nu,{detail:r})),r},Qs=()=>{try{return O("starting_level","")==="kana-none"&&O("kana_completed","0")!=="1"}catch{return!1}},ru=7,qE="post_exam_choice",su=(e=new Date,t=X())=>{if(!t.jlptPlanEnabled||t.planExamKind!=="jlpt")return null;let r=ht(t.jlptPlanStartedOn),n=ht(t.jlptExamDate)??(r?Ro("jlpt",r):null);if(!n||r&&Vt(r,n)<0)return null;let o=Vt(n,e);if(o<1||o>ru)return null;try{if(!t.jlptExamDate&&!O("starting_level",""))return null}catch{return null}return{key:Jd(n),target:t.jlptTarget,daysLeft:ru-o+1}},iu=e=>{try{let[t,r]=O(qE,"").split("|");return t===e&&(r==="light"||r==="usual")?r:null}catch{return null}},cR=(e,t)=>R(qE,`${e}|${t}`),ho=(e=new Date)=>{let t=su(e);return!!(t&&iu(t.key)!=="usual")},au="level_advance",QE=10080*60*1e3,ko=()=>{let e=t=>({answered:Array.isArray(t?.answered)?t.answered.filter(r=>F.includes(r)):[],pausedAt:Number.isFinite(t?.pausedAt)&&Number(t?.pausedAt)>0?Number(t?.pausedAt):0,stoppedAt:Number.isFinite(t?.stoppedAt)&&Number(t?.stoppedAt)>0?Number(t?.stoppedAt):0,pausedLevel:t?.pausedLevel&&F.includes(t.pausedLevel)?t.pausedLevel:"",upTo:t?.upTo&&F.includes(t.upTo)?t.upTo:"",backfill:t?.backfill&&F.includes(t.backfill)?t.backfill:""});try{let t=JSON.parse(O(au,"")||"null");return{words:e(t?.words??t),grammar:e(t?.grammar)}}catch{return{words:e(null),grammar:e(null)}}},mR=e=>R(au,JSON.stringify(e)),Nn=e=>F[Math.max(F.indexOf(X().jlptTarget),F.indexOf(ko()[e].upTo))],ZE=(e,t)=>E(e==="words"?`SELECT COUNT(*) FROM words w LEFT JOIN progress p ON p.word_id = w.id
       WHERE w.jlpt_level = ? AND ${Ne()}`:`SELECT COUNT(*) FROM grammar_points g LEFT JOIN grammar_progress p ON p.grammar_id = g.id
       WHERE g.level = ? AND COALESCE(p.seen_count, 0) = 0 AND COALESCE(p.known_forever, 0) = 0`,[t],0),Oo=(e,t=new Date)=>{let{pausedAt:r,stoppedAt:n,pausedLevel:o}=ko()[e];if(r<=0||o!==Nn(e))return null;if(n>0)return t.getTime()-n<QE?0:null;try{return ZE(e,o)}catch{return null}},ot=(e=new Date)=>{let t=X(),r=Oo("words",e),n=Oo("grammar",e),o={...t,dailyGoal:r===null?t.dailyGoal:Math.min(t.dailyGoal,r),grammarDailyGoal:n===null?t.grammarDailyGoal:Math.min(t.grammarDailyGoal,n)},s=su(e,o);if(!s||iu(s.key)==="usual")return o;let i=(d,u)=>d>0?Math.min(d,u):u,a=(d,u)=>d===rt?d:i(d,u);return{...o,dailyGoal:0,grammarDailyGoal:0,kanjiDailyGoal:0,confusionDailyGoal:0,reviewCap:i(o.reviewCap,60),grammarReviewCap:a(o.grammarReviewCap,10),kanjiReviewCap:a(o.kanjiReviewCap,10),confusionReviewCap:a(o.confusionReviewCap,5)}},Jt=()=>Qs()?0:ot().dailyGoal,du=()=>ot().grammarDailyGoal,Pr=()=>ot().reviewCap,pR=()=>{let e=X();e.jlptPlanStartedOn||nt(e)},uu=()=>{let e=X();return{enabled:e.jlptPlanEnabled,target:e.jlptTarget,examKind:e.planExamKind,examDate:e.jlptExamDate,startedOn:e.jlptPlanStartedOn}},ef=()=>{let e=X();return e.theme==="light"||e.theme==="dark"?e.theme:window.matchMedia?.("(prefers-color-scheme: dark)").matches?"dark":"light"},tf=()=>{let e=ef();document.documentElement.setAttribute("data-theme",e),console.log("\u2705 Theme applied:",e)},rf=(e=X().motionLevel)=>{document.documentElement.setAttribute("data-motion",e)},ER=()=>typeof window>"u"||window.matchMedia?.("(prefers-reduced-motion: reduce)").matches?!1:X().motionLevel==="full";typeof window<"u"&&window.addEventListener(nu,e=>{let t=e.detail;tf(),rf(t?.motionLevel??X().motionLevel)})});var ee,oe,Ne,$e=h(()=>{"use strict";jr();pe();ee=(e="p")=>`(
  COALESCE(${e}.seen_count, 0) > 0 OR ${e}.fsrs_state IS NOT NULL
  OR ${e}.fsrs_due IS NOT NULL OR ${e}.fsrs_stability IS NOT NULL OR ${e}.fsrs_last_review IS NOT NULL
  OR EXISTS (SELECT 1 FROM reviews started_review WHERE started_review.word_id = ${e}.word_id)
)`,oe=(e="w",t="p",r=X().includeOptionalExpressions)=>r?"1":`(NOT (${So(`${e}.id`)}) OR COALESCE(${t}.known_forever, 0) = 1 OR ${ee(t)})`,Ne=(e="w",t="p",r=X().includeOptionalExpressions)=>`(COALESCE(${t}.known_forever, 0) = 0 AND NOT ${ee(t)} AND ${oe(e,t,r)})`});var of,nf=h(()=>{of=`-- \u51FA\u5382\u5E93/\u65E7\u5907\u4EFD\u5DF2\u6709 words \u65F6\uFF0CCREATE \u4E0D\u8865\u5217\uFF1BensureUserTables \u7684 ALTER \u8D1F\u8D23\u5347\u7EA7\u3002
CREATE TABLE IF NOT EXISTS words (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meaning TEXT NOT NULL,
  kana TEXT NOT NULL,
  kanji TEXT NOT NULL,
  pos TEXT NOT NULL,
  verb_type TEXT,
  importance INTEGER NOT NULL DEFAULT 3,
  shuffle_rank REAL,
  example_jp TEXT,
  example_meaning TEXT,
  jlpt_level TEXT,
  example_furigana TEXT NOT NULL DEFAULT '',
  example_tokens TEXT NOT NULL DEFAULT '',
  example_lemmas TEXT NOT NULL DEFAULT '',
  sense_key TEXT NOT NULL DEFAULT '',
  collocation_tier INTEGER
);

CREATE TABLE IF NOT EXISTS grammar_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern TEXT NOT NULL UNIQUE,
  meaning TEXT NOT NULL,
  prompt TEXT NOT NULL,
  formation TEXT NOT NULL,
  example_jp TEXT NOT NULL,
  example_meaning TEXT NOT NULL,
  example_furigana TEXT NOT NULL DEFAULT '',
  example_tokens TEXT NOT NULL DEFAULT '',
  example_lemmas TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  confusions TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL DEFAULT 'N5',
  importance INTEGER NOT NULL DEFAULT 3,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS grammar_progress (
  grammar_id INTEGER PRIMARY KEY,
  score REAL NOT NULL DEFAULT 0,
  seen_count INTEGER NOT NULL DEFAULT 0,
  low_history INTEGER NOT NULL DEFAULT 0,
  known_forever INTEGER NOT NULL DEFAULT 0,
  mastered_on TEXT,
  last_seen_on TEXT,
  right_count INTEGER NOT NULL DEFAULT 0,
  fuzzy_count INTEGER NOT NULL DEFAULT 0,
  forgot_count INTEGER NOT NULL DEFAULT 0,
  mistake_streak INTEGER NOT NULL DEFAULT 0,
  last_decay_amount INTEGER NOT NULL DEFAULT 10,
  FOREIGN KEY(grammar_id) REFERENCES grammar_points(id)
);

CREATE TABLE IF NOT EXISTS grammar_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grammar_id INTEGER NOT NULL,
  answer TEXT NOT NULL,
  score_after REAL NOT NULL,
  reviewed_on TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(grammar_id) REFERENCES grammar_points(id)
);

-- \u8BED\u6CD5\u8F9E\u5178/\u6C89\u6D78\u5F0F\u9605\u8BFB\u7684\u8F7B\u91CF\u5B66\u4E60\u4E8B\u4EF6\u3002\u5B83\u4EEC\u4E0D\u6539\u53D8 FSRS\uFF0C\u53EA\u8BA9\u5468\u62A5\u77E5\u9053\u7528\u6237\u786E\u5B9E\u5B66\u4E60\u8FC7\u3002
CREATE TABLE IF NOT EXISTS grammar_activity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grammar_id TEXT NOT NULL,
  answer TEXT NOT NULL DEFAULT 'read',
  activity_at INTEGER NOT NULL,
  activity_on TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS grammar_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- \u7528\u6237\u81EA\u62A5\u6C34\u5E73\u53EA\u7ED9 FSRS \u4E00\u4E2A\u521D\u59CB\u72B6\u6001\uFF0C\u4E0D\u4F2A\u9020\u6210\u771F\u5B9E\u4F5C\u7B54\u3002\u6C49\u5B57\u548C\u8FA8\u6790\u7684
-- memory \u4F1A\u5728\u540C\u6B65/\u64A4\u9500\u540E\u4ECE\u6D41\u6C34\u91CD\u653E\uFF0C\u56E0\u6B64\u5FC5\u987B\u628A\u8FD9\u4EFD\u8D77\u59CB\u72B6\u6001\u5355\u72EC\u4FDD\u5B58\uFF1B
-- \u5426\u5219\u7B2C\u4E00\u6B21\u771F\u5B9E\u4F5C\u7B54\u91CD\u653E\u540E\u4F1A\u4ECE\u201C\u5168\u65B0\u5361\u201D\u8D77\u7B97\uFF0C\u64A4\u9500\u8FD8\u4F1A\u628A\u521D\u59CB\u72B6\u6001\u6E05\u7A7A\u3002
CREATE TABLE IF NOT EXISTS level_prior_baselines (
  entity TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  stability REAL NOT NULL,
  difficulty REAL NOT NULL DEFAULT 5,
  due TEXT NOT NULL,
  last_review TEXT NOT NULL,
  state INTEGER NOT NULL DEFAULT 2,
  steps INTEGER NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  starting_level TEXT NOT NULL,
  familiarity INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (entity, entity_key)
);

-- \u4E94\u5341\u97F3\u4E5F\u6709\u81EA\u5DF1\u7684 FSRS \u8BB0\u5FC6\u4E0E\u771F\u5B9E\u4F5C\u7B54\u6D41\u6C34\uFF1B\u5B8C\u6210 92 \u4E2A\u57FA\u7840\u5047\u540D\u4EE5\u524D\uFF0C
-- \u65B0\u8BCD\u8BA1\u5212\u6309\u5B9E\u9645\u8FDB\u5EA6\u5EF6\u540E\u3002\u8BB0\u5FC6\u662F\u53EF\u91CD\u653E\u68C0\u67E5\u70B9\uFF0C\u6D41\u6C34\u8DE8\u8BBE\u5907\u53D6\u5E76\u96C6\u3002
CREATE TABLE IF NOT EXISTS kana_memory (
  symbol TEXT PRIMARY KEY,
  correct_streak INTEGER NOT NULL DEFAULT 0,
  seen_count INTEGER NOT NULL DEFAULT 0,
  fsrs_stability REAL,
  fsrs_difficulty REAL,
  fsrs_due TEXT,
  fsrs_last_review TEXT,
  fsrs_state INTEGER,
  fsrs_steps INTEGER,
  fsrs_reps INTEGER,
  fsrs_lapses INTEGER
);

CREATE TABLE IF NOT EXISTS kana_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  answer TEXT NOT NULL,
  reviewed_on TEXT NOT NULL,
  reviewed_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_kana_reviews_symbol_at ON kana_reviews (symbol, reviewed_at);

-- \u4ECE\u4F8B\u53E5\u8BCD\u5178\u4E3B\u52A8\u52A0\u5165\u7684\u8BCD\u3002\u4EFB\u52A1\u8868\u6309\u5B66\u4E60\u65E5\u8F6E\u6362\uFF0C\u8FD9\u5F20\u5C0F\u8868\u4FDD\u7559\u53D1\u73B0\u610F\u56FE\uFF0C
-- \u8BA9\u672A\u5F00\u59CB\u7684\u8BCD\u5728\u7B2C\u4E8C\u5929\u4ECD\u4F1A\u4F18\u5148\u8FDB\u5165\u65B0\u8BCD\u8BA1\u5212\u3002
CREATE TABLE IF NOT EXISTS dictionary_discovered_words (
  word_id INTEGER PRIMARY KEY,
  discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- \u72EC\u7ACB\u4E8E JLPT \u5B66\u4E60\u8BCD\u5E93\u7684\u8865\u5145\u8BCD\u5178\u3002\u8FD9\u91CC\u7684\u6761\u76EE\u53EA\u4F9B\u4F8B\u53E5\u70B9\u8BCD\u67E5\u8BE2\uFF0C
-- \u4E0D\u4F7F\u7528 words.id\uFF0C\u4E5F\u4E0D\u4F1A\u8FDB\u5165 progress\u3001\u5B66\u4E60\u8BA1\u5212\u6216 FSRS\u3002
CREATE TABLE IF NOT EXISTS dictionary_entries (
  entry_key TEXT PRIMARY KEY,
  headword TEXT NOT NULL,
  kana TEXT NOT NULL,
  meaning TEXT NOT NULL,
  pos TEXT NOT NULL,
  verb_type TEXT,
  category TEXT NOT NULL,
  usage_note TEXT NOT NULL DEFAULT '',
  example_jp TEXT NOT NULL DEFAULT '',
  example_meaning TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 3,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  license TEXT NOT NULL,
  seed_version TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dictionary_entries_headword
  ON dictionary_entries(headword);

CREATE INDEX IF NOT EXISTS idx_dictionary_entries_kana
  ON dictionary_entries(kana);

-- \u8BED\u6CD5\u9875\u7684\u5212\u91CD\u70B9\u3002\u8303\u56F4\u7528\u8BED\u6CD5\u70B9\u7A33\u5B9A id + \u5185\u5BB9\u5757 + \u5B57\u7B26\u504F\u79FB\u5B9A\u4F4D\uFF0C
-- dataset_version \u7528\u6765\u8BC6\u522B grammar.ts/grammar_seed \u6539\u7248\u540E\u5DF2\u7ECF\u6F02\u79FB\u7684\u65E7\u951A\u70B9\u3002
CREATE TABLE IF NOT EXISTS grammar_highlights (
  grammar_id TEXT NOT NULL,
  block TEXT NOT NULL,
  start INTEGER NOT NULL,
  end INTEGER NOT NULL,
  text TEXT NOT NULL,
  dataset_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (grammar_id, block, start, end)
);

-- Library / \u6C89\u6D78\u5F0F\u9605\u8BFB\u4F4D\u7F6E\u3002\u5B58\u7A33\u5B9A\u7684\u8BED\u6CD5\u70B9 id\uFF0C\u4E0D\u5B58\u8FC7\u6EE4\u6570\u7EC4\u4E0B\u6807\u3002
CREATE TABLE IF NOT EXISTS grammar_reading_positions (
  kind TEXT NOT NULL,
  level TEXT NOT NULL,
  grammar_id TEXT NOT NULL,
  scroll_top REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (kind, level)
);

CREATE TABLE IF NOT EXISTS grammar_points_archive (
  archive_id INTEGER PRIMARY KEY AUTOINCREMENT,
  archived_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  dataset_version TEXT NOT NULL,
  id INTEGER,
  pattern TEXT NOT NULL,
  meaning TEXT NOT NULL,
  prompt TEXT NOT NULL,
  formation TEXT NOT NULL,
  example_jp TEXT NOT NULL,
  example_meaning TEXT NOT NULL,
  example_furigana TEXT NOT NULL DEFAULT '',
  example_tokens TEXT NOT NULL DEFAULT '',
  example_lemmas TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  confusions TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL DEFAULT 'N5',
  importance INTEGER NOT NULL DEFAULT 3,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS content_favorites (
  item_type TEXT NOT NULL,
  item_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- \u6536\u85CF\u5939\u540D\u5B57\u76F4\u63A5\u5B58\u5728\u8FD9\u91CC,\u4E0D\u5EFA id \u5916\u952E:\u540C\u6B65\u7684\u884C\u8EAB\u4EFD\u4E0D\u8BB8\u7528\u81EA\u589E id
  -- (\u89C1 sync/tables.ts \u5F00\u5934\u90A3\u6761),\u540D\u5B57\u672C\u8EAB\u5C31\u662F\u5929\u7136\u952E\u3002\u4EE3\u4EF7\u662F\u91CD\u547D\u540D\u8981\u8FDE\u5E26
  -- \u66F4\u65B0\u8FD9\u4E00\u5217 \u2014\u2014 renameFavoriteFolder \u4E00\u4E2A UPDATE \u5C31\u505A\u5B8C\u4E86\u3002
  folder TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (item_type, item_id)
);

-- \u6536\u85CF\u5939\u672C\u4F53\u3002\u53EA\u4E3A\u4E86\u8BA9\u300C\u5EFA\u597D\u4F46\u8FD8\u6CA1\u5F80\u91CC\u653E\u4E1C\u897F\u300D\u7684\u5939\u5B50\u6D3B\u5F97\u4E0B\u6765;
-- \u6709\u5185\u5BB9\u7684\u5939\u5B50\u5149\u9760 content_favorites.folder \u4E5F\u63A8\u5F97\u51FA\u6765\u3002
-- \u67E5\u8BCD\u6C47\u91CF\u7684\u5386\u53F2\u6210\u7EE9\u3002\u6BCF\u6B21\u6D4B\u5B8C\u8FFD\u52A0\u4E00\u884C\uFF0Crun_id \u5C31\u662F\u90A3\u4E00\u6B21\u7684\u8EAB\u4EFD\uFF08\u540C\u6B65\u53D6\u5E76\u96C6\uFF09\u3002
-- \u53EA\u5B58\u7ED3\u679C\uFF0C\u4E0D\u5B58\u9898\u76EE\uFF1A\u9898\u662F\u6BCF\u6B21\u73B0\u62BD\u7684\uFF0C\u5B58\u4E0B\u6765\u65E2\u6CA1\u7528\u4E5F\u767D\u5360\u5FEB\u7167\u4F53\u79EF\u3002
CREATE TABLE IF NOT EXISTS vocab_test_history (
  run_id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  answered INTEGER NOT NULL DEFAULT 0,
  total_questions INTEGER NOT NULL DEFAULT 0,
  estimated INTEGER NOT NULL DEFAULT 0,
  lower_bound INTEGER NOT NULL DEFAULT 0,
  upper_bound INTEGER NOT NULL DEFAULT 0,
  confidence INTEGER NOT NULL DEFAULT 0,
  recommendation TEXT NOT NULL DEFAULT '',
  -- \u5404\u7EA7\u7B54\u5BF9\u7387\uFF0C\u5206\u4EAB\u56FE\u4E0A\u90A3\u5F20\u6A2A\u6761\u56FE\u8981\u7528\uFF1A[["N5",0.9,12],...]
  levels_json TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS favorite_folders (
  name TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS grammar_mistakes (
  grammar_id INTEGER PRIMARY KEY,
  answer TEXT NOT NULL,
  score_after REAL NOT NULL DEFAULT 0,
  mistake_count INTEGER NOT NULL DEFAULT 1,
  first_seen_on TEXT NOT NULL,
  last_seen_on TEXT NOT NULL,
  resolved_on TEXT,
  FOREIGN KEY(grammar_id) REFERENCES grammar_points(id)
);

CREATE TABLE IF NOT EXISTS word_notes (
  word_id INTEGER PRIMARY KEY,
  note TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(word_id) REFERENCES words(id)
);

-- \u7528\u6237\u81EA\u5DF1\u6539\u5199\u7684\u9898\u9762\u9996\u4E49\u3002**\u4E0D\u5199 words.meaning**\uFF1Awords \u8868\u4E0D\u540C\u6B65\uFF0C\u800C\u4E14\u8BCD\u5355\u5BFC\u5165/
-- \u6362\u79CD\u5B50\u5E93\u4F1A\u6574\u8868\u8986\u76D6\uFF0C\u624B\u6539\u7684\u5185\u5BB9\u4F1A\u4E00\u6B21\u6027\u6CA1\u6389\u3002\u8FD9\u5F20\u8868\u8D70 lww \u540C\u6B65\uFF08\u89C1 sync/tables.ts\uFF09\uFF0C
-- \u540C\u65F6\u5FC5\u987B\u51FA\u73B0\u5728 scripts/bake-seed-db.mjs \u7684 userDataTables \u91CC\uFF0C\u5426\u5219\u4F1A\u968F\u51FA\u5382\u8BCD\u5E93\u5916\u6CC4\u3002
CREATE TABLE IF NOT EXISTS word_question_meanings (
  word_id INTEGER PRIMARY KEY,
  prompt_meaning TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(word_id) REFERENCES words(id)
);

-- \u7528\u6237\u81EA\u5DF1\u5BFC\u5165\u7684\u8BCD\u6761\u3002
--
-- \u26A0\uFE0F words \u8868\u672C\u8EAB**\u4E0D\u8FDB\u4E91\u5FEB\u7167**\uFF08\u51FA\u5382\u8BCD\u5178\u4E24\u7AEF\u4E00\u81F4\uFF0C\u6CA1\u5FC5\u8981\u4E3A\u6BCF\u4E2A\u8D26\u53F7\u91CD\u590D\u4E0A\u4F20\uFF09\uFF0C
-- \u4F46 progress / word_notes / reviews \u5168\u662F\u6309 word_id \u540C\u6B65\u7684\u3002\u81EA\u589E id \u5206\u914D\u8EAB\u4EFD\u65F6\uFF1A
-- \u4E24\u53F0\u8BBE\u5907\u5404\u5BFC\u5165\u4E00\u4E2A\u65B0\u8BCD\u90FD\u4F1A\u62FF\u5230\u540C\u4E00\u4E2A id\uFF08\u76F8\u540C\u6570\u5B57\u4E0D\u662F\u540C\u4E00\u4E2A\u8BCD\uFF09\uFF0C\u800C\u4E00\u53F0
-- \u6CA1\u6709\u8FD9\u4E2A\u81EA\u5B9A\u4E49\u8BCD\u7684\u65B0\u8BBE\u5907\u53EA\u4F1A\u6536\u5230\u4E00\u5806\u60AC\u7A7A\u7684\u5B66\u4E60\u8BB0\u5F55\u3002
--
-- \u6240\u4EE5\u81EA\u5B9A\u4E49\u8BCD\u7684 id \u6539\u6210**\u7531\u5185\u5BB9\u7B97\u51FA\u6765**\uFF08\u89C1 word-list-import \u7684 customWordId\uFF09\uFF0C
-- \u5E76\u628A\u5185\u5BB9\u672C\u8EAB\u653E\u8FDB\u8FD9\u5F20\u540C\u6B65\u8868\uFF1Aid \u4E24\u7AEF\u5929\u751F\u4E00\u81F4\uFF0C\u5408\u5E76\u4E4B\u540E\u518D\u628A\u7F3A\u7684\u8BCD\u884C\u8865\u51FA\u6765\u3002
CREATE TABLE IF NOT EXISTS custom_words (
  word_id INTEGER PRIMARY KEY,
  kanji TEXT NOT NULL DEFAULT '',
  kana TEXT NOT NULL DEFAULT '',
  meaning TEXT NOT NULL DEFAULT '',
  pos TEXT NOT NULL DEFAULT '',
  verb_type TEXT,
  importance INTEGER NOT NULL DEFAULT 0,
  example_jp TEXT,
  example_meaning TEXT,
  jlpt_level TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS moji_migrated_reviews (
  word_id INTEGER PRIMARY KEY,
  imported_on TEXT NOT NULL,
  priority REAL NOT NULL DEFAULT 0,
  activated_on TEXT,
  FOREIGN KEY(word_id) REFERENCES words(id)
);

CREATE INDEX IF NOT EXISTS idx_moji_migrated_reviews_activation
  ON moji_migrated_reviews(activated_on, priority);

-- \u6309 (kanji, kana) \u627E\u8BCD\u662F\u70ED\u8DEF\u5F84\uFF1A\u76F8\u4F3C\u91CA\u4E49\u8BCD\u5BF9\u7167\u6BCF\u5F20\u5361\u90FD\u8981\u67E5\u4E00\u6B21\uFF0C\u8BCD\u5355\u5BFC\u5165
-- \u6BCF\u6761\u8BB0\u5F55\u4E5F\u8981\u67E5\u4E00\u6B21\u3002\u6CA1\u6709\u8FD9\u4E2A\u7D22\u5F15\u5C31\u662F 11k \u884C\u5168\u8868\u626B\uFF0C\u4E00\u9875\u5FEB\u901F\u5B66\u4E60\u80FD\u626B\u6389\u4E0A\u767E\u4E07\u884C\u3002
CREATE INDEX IF NOT EXISTS idx_words_kanji_kana ON words(kanji, kana);

-- \u53CD\u5411\u5B66\u4E60(\u65E5\u8BED \u2192 \u91CA\u4E49)\u7684\u957F\u671F\u8BB0\u5FC6\u3002
--
-- \u53CD\u5411\u4EE5\u524D\u53EA\u6709\u5F53\u5929\u7684 stage2_progress\uFF0C\u5173\u6389\u5E94\u7528\u4EC0\u4E48\u90FD\u4E0D\u7559 \u2014\u2014 \u5B83\u4E0D\u662F\u4E00\u4E2A\u6A21\u5F0F\uFF0C
-- \u662F\u4E2A\u7528\u5B8C\u5C31\u6254\u7684\u4E34\u65F6\u961F\u5217\u3002\u73B0\u5728\u4E09\u4E2A\u65B9\u5411(\u6B63\u5411 progress / \u53CD\u5411 reverse_memory /
-- \u65E7\u6C49\u5B57 kanji_memory)\u5404\u6709\u4E00\u4EFD\u81EA\u5DF1\u7684 FSRS \u72B6\u6001\uFF0C\u89C4\u5219\u5B8C\u5168\u4E00\u6837\uFF1A\u540C\u4E00\u5957\u5230\u671F\u96C6\u9009\u8BCD\u3001
-- \u540C\u6837\u7684\u5B66\u4E60\u6B65\u9AA4\u548C\u6BD5\u4E1A\u5224\u5B9A\u3001\u540C\u6837\u7684\u6BCF\u65E5\u4E0A\u9650\u3002fsrs_* \u5217\u7531 ensureFsrsColumns \u8865\u3002
--
-- \u4E09\u5F20\u5361\u6302\u540C\u4E00\u4E2A word_id\uFF1A\u8BCD\u6761\u3001\u7B14\u8BB0\u3001\u6536\u85CF\u3001\u7EDF\u8BA1\u90FD\u662F\u5171\u4EAB\u7684\uFF0C
-- \u4F46\u5404\u81EA\u7684 due \u53EA\u7531\u5404\u81EA\u65B9\u5411\u7684\u4F5C\u7B54\u6539\u5199 \u2014\u2014 \u6240\u4EE5\u80CC\u6CA1\u80CC\u53CD\u5411\uFF0C\u4E0D\u5F71\u54CD\u5E38\u89C4\u6A21\u5F0F\u51FA\u54EA\u4E9B\u8BCD\u3002
CREATE TABLE IF NOT EXISTS reverse_memory (
  word_id INTEGER PRIMARY KEY,
  seen_count INTEGER NOT NULL DEFAULT 0,
  right_count INTEGER NOT NULL DEFAULT 0,
  fuzzy_count INTEGER NOT NULL DEFAULT 0,
  forgot_count INTEGER NOT NULL DEFAULT 0,
  last_seen_on TEXT,
  FOREIGN KEY(word_id) REFERENCES words(id)
);

-- \u6C49\u5B57\u8BFB\u97F3\u6A21\u5F0F\u7684\u957F\u671F\u8BB0\u5FC6\u3002\u65E7 kanji_memory \u8BB0\u5F55\u7684\u662F\u300C\u91CA\u4E49 \u2192 \u6C49\u5B57\u300D\u9898\u578B\uFF0C
-- \u65B0\u9898\u578B\u6539\u4E3A\u300C\u770B\u8868\u8BB0\uFF0C\u56DE\u5FC6\u6C49\u5B57\u5BF9\u5E94\u8BFB\u97F3\u300D\u540E\u4E0D\u80FD\u628A\u65E7\u7A33\u5B9A\u5EA6\u5192\u5145\u6210\u8BFB\u97F3\u80FD\u529B\u3002
-- \u56E0\u6B64\u65E7\u8868\u539F\u6837\u4FDD\u7559\u4F5C\u5F52\u6863\uFF0C\u65B0\u8868\u4ECE\u5E72\u51C0\u72B6\u6001\u5F00\u59CB\uFF1Bfsrs_* \u5217\u7531 ensureFsrsColumns \u8865\u3002
CREATE TABLE IF NOT EXISTS kanji_reading_memory (
  word_id INTEGER PRIMARY KEY,
  seen_count INTEGER NOT NULL DEFAULT 0,
  right_count INTEGER NOT NULL DEFAULT 0,
  fuzzy_count INTEGER NOT NULL DEFAULT 0,
  forgot_count INTEGER NOT NULL DEFAULT 0,
  mistake_streak INTEGER NOT NULL DEFAULT 0,
  last_seen_on TEXT,
  FOREIGN KEY(word_id) REFERENCES words(id)
);

-- \u65B0\u9898\u578B\u4E5F\u4F7F\u7528\u72EC\u7ACB\u7684\u5F53\u65E5\u4EFB\u52A1\u8868\uFF0C\u907F\u514D\u53D1\u5E03\u5F53\u5929\u628A\u65E7\u6C49\u5B57\u6A21\u5F0F\u7684\u5B8C\u6210\u8FDB\u5EA6\u63A5\u8FC7\u6765\u3002
CREATE TABLE IF NOT EXISTS kanji_reading_progress (
  reviewed_on TEXT NOT NULL,
  word_id INTEGER NOT NULL,
  order_index INTEGER NOT NULL,
  PRIMARY KEY (reviewed_on, word_id),
  FOREIGN KEY(word_id) REFERENCES words(id)
);

-- \u5355\u72EC\u6C49\u5B57\u5361\uFF08lib/kanji-char-cards.ts\uFF0Cdocs/MIXED_STUDY_PLAN.md\uFF09\uFF1A\u4E00\u4E2A\u5B57\u4E00\u5F20\u5361\u3002
-- kanji_char_reviews \u662F\u552F\u4E00\u7684\u4E8B\u5B9E\uFF08append\uFF0C\u8DE8\u7AEF\u6309 sync_uid \u5408\u5E76\uFF09\uFF1Bmemory \u662F\u672C\u673A\u68C0\u67E5\u70B9\uFF0C
-- \u5408\u5E76\u540E\u7531\u6D41\u6C34\u91CD\u653E\u91CD\u5EFA\uFF1Btasks \u662F\u5F53\u5929\u7684\u7269\u5316\u6E05\u5355\uFF0C\u5FEB\u7167\u53EA\u5E26 14 \u5929\u3002
-- \u5EFA\u5728\u8FD9\u91CC\u800C\u4E0D\u662F\u61D2\u5EFA\uFF1AensureSyncSchema \u53EA\u7ED9\u542F\u52A8\u65F6\u5DF2\u5B58\u5728\u7684\u8868\u6302\u89E6\u53D1\u5668\u548C sync_uid\u3002
CREATE TABLE IF NOT EXISTS kanji_char_memory (
  char TEXT PRIMARY KEY,
  level_rank INTEGER NOT NULL DEFAULT 5,
  seen_count INTEGER NOT NULL DEFAULT 0,
  right_count INTEGER NOT NULL DEFAULT 0,
  fuzzy_count INTEGER NOT NULL DEFAULT 0,
  forgot_count INTEGER NOT NULL DEFAULT 0,
  mistake_streak INTEGER NOT NULL DEFAULT 0,
  known_forever INTEGER NOT NULL DEFAULT 0,
  last_seen_on TEXT
);
CREATE TABLE IF NOT EXISTS kanji_char_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  char TEXT NOT NULL,
  answer TEXT NOT NULL,
  reviewed_on TEXT NOT NULL,
  reviewed_at INTEGER NOT NULL,
  scheduler_mode TEXT NOT NULL DEFAULT 'normal',
  fsrs_params_version TEXT NOT NULL DEFAULT 'fsrs-v1',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_kanji_char_reviews_char_on ON kanji_char_reviews (char, reviewed_on);
CREATE TABLE IF NOT EXISTS kanji_char_tasks (
  reviewed_on TEXT NOT NULL,
  char TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  PRIMARY KEY (reviewed_on, char)
);

-- \u7591\u96BE\u8FDE\u7EBF\u5361\uFF08lib/confusion-cards.ts\uFF09\uFF1A\u4E00\u4E2A\u8FA8\u6790\u7EC4\u4E00\u5F20\u5361\uFF0Cgroup_key \u540C confusion_mastered\u3002
-- \u4E09\u5F20\u8868\u548C kanji_char_* \u540C\u4E00\u5957\uFF08reviews \u4E8B\u5B9E / progress \u68C0\u67E5\u70B9 / tasks \u5F53\u5929\u6295\u5F71\uFF09\u3002
CREATE TABLE IF NOT EXISTS confusion_progress (
  group_key TEXT PRIMARY KEY,
  seen_count INTEGER NOT NULL DEFAULT 0,
  right_count INTEGER NOT NULL DEFAULT 0,
  fuzzy_count INTEGER NOT NULL DEFAULT 0,
  forgot_count INTEGER NOT NULL DEFAULT 0,
  mistake_streak INTEGER NOT NULL DEFAULT 0,
  known_forever INTEGER NOT NULL DEFAULT 0,
  last_seen_on TEXT,
  level_rank INTEGER NOT NULL DEFAULT 4
);
CREATE TABLE IF NOT EXISTS confusion_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_key TEXT NOT NULL,
  answer TEXT NOT NULL,
  reviewed_on TEXT NOT NULL,
  reviewed_at INTEGER NOT NULL,
  scheduler_mode TEXT NOT NULL DEFAULT 'normal',
  fsrs_params_version TEXT NOT NULL DEFAULT 'fsrs-v1',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_confusion_reviews_group_on ON confusion_reviews (group_key, reviewed_on);
CREATE TABLE IF NOT EXISTS confusion_tasks (
  reviewed_on TEXT NOT NULL,
  group_key TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  PRIMARY KEY (reviewed_on, group_key)
);

-- \u5B9E\u9A8C\u5F00\u53E3\u7EC3\u4E60\uFF1A\u6D41\u6C34\u662F\u4E8B\u5B9E\u3001memory \u662F\u68C0\u67E5\u70B9\u3001tasks \u662F\u5F53\u5929\u6295\u5F71\u3002
-- \u53EA\u5728\u672C\u673A\u6301\u4E45\u5316\uFF0Ccloud: false \u963B\u6B62\u5F00\u53D1\u7248\u628A\u65B0\u8868\u63A8\u7ED9\u5C1A\u4E0D\u8BA4\u8BC6\u5B83\u4EEC\u7684\u53D1\u5E03\u7248\u3002
CREATE TABLE IF NOT EXISTS talk_memory (
  card_key TEXT PRIMARY KEY,
  seen_count INTEGER NOT NULL DEFAULT 0,
  right_count INTEGER NOT NULL DEFAULT 0,
  fuzzy_count INTEGER NOT NULL DEFAULT 0,
  forgot_count INTEGER NOT NULL DEFAULT 0,
  mistake_streak INTEGER NOT NULL DEFAULT 0,
  known_forever INTEGER NOT NULL DEFAULT 0,
  last_seen_on TEXT
);
CREATE TABLE IF NOT EXISTS talk_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_key TEXT NOT NULL,
  answer TEXT NOT NULL,
  reviewed_on TEXT NOT NULL,
  reviewed_at INTEGER NOT NULL,
  hints INTEGER NOT NULL DEFAULT 0,
  filler TEXT,
  scheduler_mode TEXT NOT NULL DEFAULT 'normal',
  fsrs_params_version TEXT NOT NULL DEFAULT 'fsrs-v1',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_talk_reviews_card_on ON talk_reviews (card_key, reviewed_on);
CREATE TABLE IF NOT EXISTS talk_tasks (
  reviewed_on TEXT NOT NULL,
  card_key TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  PRIMARY KEY (reviewed_on, card_key)
);

-- \u62FC\u5199\u5386\u53F2\u4FDD\u7559\uFF1B\u5B66\u4E60\u6A21\u5F0F\u7684\u300C\u4E00\u76F4\u62FC\u5199\u300D\u53EA\u7528 always_spell\uFF0C\u4E0D\u518D\u64AD\u79CD\u72EC\u7ACB FSRS \u5361\u3002
-- \u4E09\u5F20\u8868\u4ECD\u53EA\u5728\u672C\u673A\u589E\u91CF\u4FDD\u5B58\uFF0C\u4E0D\u8FDB\u4E91\u5FEB\u7167\uFF0C\u907F\u514D\u65E7\u7248\u62D2\u7EDD\u540C\u6B65\u3002
-- fsrs_* \u5217\u7531 ensureFsrsColumns \u8865\uFF1B\u4E09\u5F20\u8868\u5FC5\u987B\u5148\u5728\u672C\u6587\u4EF6\u5B58\u5728\uFF0C\u4E0D\u80FD\u7531\u8FD0\u884C\u6A21\u5757\u61D2\u5EFA\u3002
CREATE TABLE IF NOT EXISTS spelling_memory (
  word_id INTEGER PRIMARY KEY,
  always_spell INTEGER NOT NULL DEFAULT 0,
  seen_count INTEGER NOT NULL DEFAULT 0,
  right_count INTEGER NOT NULL DEFAULT 0,
  fuzzy_count INTEGER NOT NULL DEFAULT 0,
  forgot_count INTEGER NOT NULL DEFAULT 0,
  mistake_streak INTEGER NOT NULL DEFAULT 0,
  known_forever INTEGER NOT NULL DEFAULT 0,
  last_seen_on TEXT,
  seed_fsrs_state TEXT,
  FOREIGN KEY(word_id) REFERENCES words(id)
);
CREATE TABLE IF NOT EXISTS spelling_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word_id INTEGER NOT NULL,
  answer TEXT NOT NULL,
  reviewed_on TEXT NOT NULL,
  reviewed_at INTEGER NOT NULL,
  scheduler_mode TEXT NOT NULL DEFAULT 'normal',
  fsrs_params_version TEXT NOT NULL DEFAULT 'fsrs-v1',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  typed TEXT NOT NULL,
  form TEXT NOT NULL,
  hints INTEGER NOT NULL DEFAULT 0,
  -- tries \u662F\u6539\u7248\u524D\u300C\u4E00\u8F6E\u6700\u591A\u4E24\u6B21\u63D0\u4EA4\u300D\u7684\u6B21\u6570\uFF0C\u73B0\u5728\u4E00\u8F6E\u53EA\u6709\u4E00\u6B21\u63D0\u4EA4\uFF0C\u4E0D\u518D\u5199\uFF08\u4FDD\u7559\u5217\u662F\u56E0\u4E3A\u4E0D\u503C\u5F97\u4E3A\u5B83\u52A8\u8868\uFF09\u3002
  tries INTEGER NOT NULL DEFAULT 0,
  ms INTEGER NOT NULL DEFAULT 0,
  problem TEXT NOT NULL DEFAULT '',
  -- \u9898\u9762\u5F62\u5F0F\u3001\u6765\u6E90\uFF08'page' \u72EC\u7ACB\u9875\u9762 / 'inline' \u5B66\u4E60\u6D41\u7A0B\u91CC\u63D2\u64AD\uFF09\u3002
  -- \u8001\u5E93\u4E0A\u8FD9\u4E24\u5217\u7531 store.ts \u7684 ensureSpellingTables \u8865\uFF08\u8868\u5DF2\u5B58\u5728\u65F6 CREATE IF NOT EXISTS \u4E0D\u4F1A\u52A0\u5217\uFF09\u3002
  mode TEXT NOT NULL DEFAULT 'meaning',
  source TEXT NOT NULL DEFAULT 'page'
);
CREATE INDEX IF NOT EXISTS idx_spelling_reviews_word_on ON spelling_reviews (word_id, reviewed_on);
CREATE TABLE IF NOT EXISTS spelling_tasks (
  reviewed_on TEXT NOT NULL,
  word_id INTEGER NOT NULL,
  order_index INTEGER NOT NULL,
  PRIMARY KEY (reviewed_on, word_id)
);
-- \u5B9E\u9A8C JLPT \u5237\u9898\uFF1A\u53EA\u8FFD\u52A0\u4F5C\u7B54\u4E8B\u5B9E\uFF0C\u4E0D\u5199 FSRS / \u4ECA\u65E5\u8BA1\u5212\uFF1Bcloud: false \u53EA\u8FDB\u672C\u673A\u589E\u91CF\u3002
-- \u5FC5\u987B\u968F\u542F\u52A8 schema \u5EFA\u8868\uFF0C\u4E0D\u80FD\u7531\u529F\u80FD\u6A21\u5757\u61D2\u5EFA\uFF0C\u540E\u7EED\u540C\u6B65\u5217\u548C\u89E6\u53D1\u5668\u624D\u4F1A\u5B8C\u6574\u3002
CREATE TABLE IF NOT EXISTS jlpt_answers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id TEXT NOT NULL,
  level TEXT NOT NULL,
  kind TEXT NOT NULL,
  chosen INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  mode TEXT NOT NULL,
  session_id TEXT NOT NULL,
  answered_on TEXT NOT NULL,
  answered_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_jlpt_answers_question ON jlpt_answers (question_id, answered_at);

-- \u300C\u7591\u96BE\u8FA8\u6790\u300D\u91CC\u6807\u8BB0\u4E3A\u5DF2\u638C\u63E1\u7684\u8BCD\u7EC4\u3002
--
-- \u4E3B\u952E\u662F\u8BCD\u7EC4\u7684\u7A33\u5B9A\u6807\u8BC6\uFF08type:\u951A\u70B9\uFF0C\u5982 homophone:\u3053\u3046\u3048\u3093\uFF09\uFF0C\u523B\u610F\u4E0D\u7528 word_id\uFF1A
-- \u53BB\u91CD\u548C\u5916\u6765\u8A9E\u5408\u5E76\u52A8\u8FC7 id\uFF08\u89C1 bake-seed-db \u7684 loanword-merge-map\uFF09\uFF0C\u62FF id \u7EC4\u952E
-- \u4F1A\u8BA9\u7528\u6237\u6807\u8FC7\u7684\u638C\u63E1\u72B6\u6001\u5728\u4E0B\u6B21\u6E05\u5E93\u540E\u5168\u90E8\u5931\u6548\u3002
-- \u6210\u5C31\u3002\u89E3\u9501\u4E86\u5C31\u6C38\u8FDC\u89E3\u9501,\u6240\u4EE5\u53EA\u8BB0\u300C\u54EA\u5929\u62FF\u5230\u7684\u300D,\u6CA1\u6709\u53D6\u6D88\u8FD9\u56DE\u4E8B\u3002
-- \u5224\u636E\u4E0D\u5B58\u5728\u8FD9\u91CC \u2014\u2014 \u5B83\u4EEC\u6BCF\u6B21\u90FD\u4ECE reviews/progress \u73B0\u7B97(\u89C1 lib/achievements/stats.ts),
-- \u8FD9\u6837\u52A0\u65B0\u6210\u5C31\u65F6,\u4EE5\u524D\u8FBE\u6210\u8FC7\u7684\u4F1A\u81EA\u52A8\u8865\u53D1\u3002
CREATE TABLE IF NOT EXISTS achievements (
  id TEXT PRIMARY KEY,
  unlocked_on TEXT NOT NULL
);

-- \u67DA\u5B50\u8D26\u672C\u3002\u6BCF\u4E00\u884C\u662F\u4E00\u7B14\u4E0D\u53EF\u53D8\u7684\u6536\u5165\u6216\u652F\u51FA,\u4F59\u989D = SUM(amount),\u4E0D\u5B58\u8BA1\u6570\u5668
-- (userProfile \u91CC\u90A3\u4EFD studyTimeMinutes \u81EA\u6512\u8BA1\u6570\u5668\u4ECE\u6765\u6CA1\u6DA8\u8FC7,\u524D\u8F66\u4E4B\u9274)\u3002
--   kind/key \u662F\u8FD9\u7B14\u8D26\u7684\u8EAB\u4EFD:study / plan / streak / encore \u6309\u5B66\u4E60\u65E5,
--   achievement \u6309\u6210\u5C31 id,buy \u6309\u5546\u54C1 id,repair \u6309\u8865\u56DE\u7684\u90A3\u4E00\u5929\u3002
--   \u4E24\u7AEF\u53D6\u5E76\u96C6 \u2014\u2014 \u540C\u4E00\u7B14\u8D26\u4E0D\u4F1A\u8BB0\u4E24\u6B21,\u4E5F\u4E0D\u4F1A\u88AB\u5BF9\u7AEF\u300C\u66F4\u65B0\u300D\u6389\u3002
-- \u8865\u7B7E\u672C\u8EAB\u5199\u7684\u662F checkins \u90A3\u5F20\u8868(\u8FDE\u51FB\u53EA\u770B\u5B83),\u8FD9\u91CC\u53EA\u7559\u82B1\u4E86\u591A\u5C11\u94B1\u7684\u75D5\u8FF9\u3002
CREATE TABLE IF NOT EXISTS yuzu_ledger (
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  amount INTEGER NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY (kind, key)
);

-- \u5341\u5206\u949F\u8BCD\u6C47\u5B66\u4E60\u7A97\u53E3\u3002baseline \u65E0\u8BBA\u662F\u5426\u5F00\u542F\u5012\u8BA1\u65F6\u90FD\u8BB0\uFF0Cfocus \u53EA\u8BB0\u5B8C\u6574\u5012\u8BA1\u65F6\u3002
-- \u7A97\u53E3\u4E00\u7ECF\u5B8C\u6210\u5C31\u4E0D\u518D\u4FEE\u6539\uFF0C\u6309 id \u53D6\u5E76\u96C6\u3002\u672A\u5B8C\u6210\u7684\u672C\u673A\u7A97\u53E3\u653E\u8BBE\u5907\u672C\u5730 app_state\u3002
-- remembered/fuzzy/forgotten \u662F\u7A97\u53E3\u5185\u6BCF\u4E2A\u8BCD\u6700\u540E\u4E00\u6B21\u81EA\u8BC4\uFF0C\u4E0D\u4EE3\u8868\u957F\u671F\u8BB0\u5FC6\u6D4B\u9A8C\u3002
CREATE TABLE IF NOT EXISTS study_focus_windows (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  completed_at INTEGER NOT NULL,
  active_ms INTEGER NOT NULL,
  words INTEGER NOT NULL,
  remembered INTEGER NOT NULL,
  fuzzy INTEGER NOT NULL,
  forgotten INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_study_focus_baseline ON study_focus_windows(kind, source, completed_at);

CREATE TABLE IF NOT EXISTS confusion_mastered (
  group_key TEXT PRIMARY KEY,
  mastered_on TEXT NOT NULL
);

-- \u300C\u65F6\u523B\u300D\u64AD\u62A5\u53F0\u8D26:\u54EA\u4E2A\u65F6\u523B\u5DF2\u7ECF\u64AD\u8FC7\u4E86\u3002
--
-- \u6BCF\u52A0\u4E00\u79CD\u5E86\u795D\u5C31\u914D\u4E00\u4E2A app_state \u952E\u7684\u8BDD,\u5F88\u5FEB\u4F1A\u6709\u4E00\u628A\u5F7C\u6B64\u4E0D\u8BA4\u8BC6\u7684\u952E,
-- \u800C\u4E14\u6CA1\u4EBA\u77E5\u9053\u300C\u4ECA\u5929\u603B\u5171\u5DF2\u7ECF\u8E66\u4E86\u51E0\u4E2A\u300D\u2014\u2014 \u9884\u7B97\u5C31\u65E0\u4ECE\u8C08\u8D77\u3002\u7EDF\u4E00\u8BB0\u8FD9\u4E00\u5F20\u8868:
--   kind = \u65F6\u523B\u79CD\u7C7B(plan_trend / leech_cleared / ...)
--   key  = \u4E00\u6B21\u6027\u7684\u7C92\u5EA6,\u7531\u5404\u81EA\u7684\u68C0\u6D4B\u5668\u51B3\u5B9A:
--          \u6BCF\u5929\u4E00\u6B21 \u2192 \u65E5\u671F,\u6BCF\u8BCD\u4E00\u6B21 \u2192 word_id,\u4E00\u8F88\u5B50\u4E00\u6B21 \u2192 \u56FA\u5B9A\u4E32\u6216\u9608\u503C
--   (\u6CE8\u610F:\u8FD9\u4E2A\u6587\u4EF6\u662F\u6309\u5206\u53F7\u88F8\u5207\u540E\u9010\u6761\u6267\u884C\u7684,\u6CE8\u91CA\u91CC\u4E5F\u4E0D\u8BB8\u51FA\u73B0\u534A\u89D2\u5206\u53F7)
--   fired_on = \u64AD\u62A5\u5F53\u5929\u7684\u5B66\u4E60\u65E5,\u7528\u6765\u6570\u6BCF\u65E5\u9884\u7B97
CREATE TABLE IF NOT EXISTS moments (
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  fired_on TEXT NOT NULL,
  PRIMARY KEY (kind, key)
);

CREATE INDEX IF NOT EXISTS idx_moments_fired_on ON moments(fired_on);

-- \u5468\u62A5\u6309 14:00 \u5468\u671F\u8BB0\u8D26\u3002\u6BCF\u53F0\u8BBE\u5907\u4E00\u884C\uFF0C\u907F\u514D\u8DE8\u8BBE\u5907\u5408\u5E76\u65F6\u91CD\u590D\u7D2F\u52A0\u3002
-- period_start \u662F\u672C\u5730\u65F6\u95F4\u7684\u5468\u65E5 14:00\uFF0C\u683C\u5F0F YYYY-MM-DD HH:MM\u3002
CREATE TABLE IF NOT EXISTS study_time_by_period (
  period_start TEXT NOT NULL,
  device_id TEXT NOT NULL,
  seconds INTEGER NOT NULL DEFAULT 0,
  sync_updated_at TEXT,
  sync_origin_device TEXT,
  PRIMARY KEY (period_start, device_id)
);

-- \u4E00\u5468\u4E00\u4EFD\u5C55\u793A\u5FEB\u7167\u3002\u62A5\u544A\u6B63\u6587\u653E JSON\uFF0C\u4FBF\u4E8E\u89C4\u5219\u5347\u7EA7\u540E\u4FDD\u7559\u5386\u53F2\u539F\u8C8C\uFF1B
-- \u9605\u8BFB\u72B6\u6001\u548C\u5FEB\u7167\u4E00\u8D77\u8FDB\u5165\u672C\u5730\u589E\u91CF\u6301\u4E45\u5316\uFF0C\u4E91\u7AEF\u5F52\u6863\u4ECD\u7531 Pro \u5468\u62A5\u63A5\u53E3\u5355\u72EC\u5904\u7406\u3002
CREATE TABLE IF NOT EXISTS weekly_reports (
  week_start TEXT PRIMARY KEY,
  week_end TEXT NOT NULL,
  generated_at INTEGER NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 3,
  content_json TEXT NOT NULL,
  read_at INTEGER,
  source_revision TEXT,
  sync_updated_at TEXT,
  sync_origin_device TEXT
);

-- \u6C49\u5B57\u5355\u5143\u8C03\u5EA6\u7684\u672C\u5730\u5185\u5BB9\u3001\u957F\u671F\u8BB0\u5FC6\u548C\u5B66\u4E60\u65E5\u68C0\u67E5\u70B9\u3002
-- \u5185\u5BB9\u6765\u81EA\u968F App \u53D1\u5E03\u7684 kanji_reading_unit_index.json\uFF0C\u4E0D\u5C5E\u4E8E\u7528\u6237\u540C\u6B65\u6570\u636E\uFF1B
-- memory/flags/tasks/reviews \u624D\u662F\u7528\u6237\u72B6\u6001\uFF0C\u7531 sync/tables.ts \u5206\u522B\u5408\u5E76\u3002
CREATE TABLE IF NOT EXISTS kanji_units (
  unit_id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_key TEXT NOT NULL UNIQUE,
  unit_type TEXT NOT NULL,
  char TEXT NOT NULL DEFAULT '',
  base TEXT NOT NULL DEFAULT '',
  surface TEXT NOT NULL DEFAULT '',
  reading TEXT NOT NULL DEFAULT '',
  kinds TEXT NOT NULL DEFAULT '[]',
  CHECK (
    (unit_type = 'char' AND char <> '' AND base <> '' AND surface = '' AND reading = '')
    OR (unit_type = 'jukujikun' AND char = '' AND base = '' AND surface <> '' AND reading <> '')
  )
);

CREATE TABLE IF NOT EXISTS kanji_unit_memory (
  unit_key TEXT PRIMARY KEY,
  seen_count INTEGER NOT NULL DEFAULT 0,
  right_count INTEGER NOT NULL DEFAULT 0,
  fuzzy_count INTEGER NOT NULL DEFAULT 0,
  forgot_count INTEGER NOT NULL DEFAULT 0,
  mistake_streak INTEGER NOT NULL DEFAULT 0,
  last_seen_on TEXT,
  fsrs_stability REAL,
  fsrs_difficulty REAL,
  fsrs_due TEXT,
  fsrs_last_review TEXT,
  fsrs_state INTEGER,
  fsrs_steps INTEGER,
  fsrs_reps INTEGER,
  fsrs_lapses INTEGER,
  FOREIGN KEY(unit_key) REFERENCES kanji_units(unit_key)
);

CREATE TABLE IF NOT EXISTS kanji_unit_flags (
  unit_key TEXT PRIMARY KEY,
  known_forever INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(unit_key) REFERENCES kanji_units(unit_key)
);

CREATE TABLE IF NOT EXISTS kanji_unit_tasks (
  reviewed_on TEXT NOT NULL,
  unit_key TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  PRIMARY KEY (reviewed_on, unit_key),
  FOREIGN KEY(unit_key) REFERENCES kanji_units(unit_key)
);

-- \u5355\u5143\u4E8B\u4EF6\u65E5\u5FD7\u662F\u8DE8\u8BBE\u5907 replay \u7684\u4E8B\u5B9E\u6765\u6E90\uFF1Bmemory \u662F\u53EF\u91CD\u5EFA checkpoint\u3002
CREATE TABLE IF NOT EXISTS kanji_unit_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_key TEXT NOT NULL,
  answer TEXT NOT NULL,
  reviewed_on TEXT NOT NULL,
  reviewed_at INTEGER NOT NULL,
  scheduler_mode TEXT NOT NULL DEFAULT 'normal',
  fsrs_params_version TEXT NOT NULL DEFAULT 'fsrs-v1',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(unit_key) REFERENCES kanji_units(unit_key)
);

CREATE INDEX IF NOT EXISTS idx_kanji_unit_tasks_day
  ON kanji_unit_tasks(reviewed_on, order_index);
CREATE INDEX IF NOT EXISTS idx_kanji_unit_reviews_unit_time
  ON kanji_unit_reviews(unit_key, reviewed_at, id);
`});function mu(e){let t=(0,sf.getDatabase)();e.split(";").map(r=>r.trim()).filter(Boolean).forEach(r=>t.run(r))}function pu(){mu(cu)}var sf,cu,af=h(()=>{"use strict";nf();sf=N($(),1),cu=of});function Zs(e){let t=e.map(o=>typeof o=="string"?o:JSON.stringify(o)).join(""),r=2166136261,n=2654435769;for(let o=0;o<t.length;o+=1){let s=t.charCodeAt(o);r=Math.imul(r^s,16777619),n=Math.imul(n^s,2246822507)}return`${(r>>>0).toString(16).padStart(8,"0")}${(n>>>0).toString(16).padStart(8,"0")}`}function ei(e,t){return p("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'app_state'").length?E("SELECT value FROM app_state WHERE key = ?",[e],"")===t:!1}function ti(e,t){R(e,t)}var Eu=h(()=>{"use strict";P()});function TR(){let e=(0,uf.getDatabase)(),t=H("SELECT * FROM progress WHERE word_id = ?",[vo]),r=H("SELECT * FROM progress WHERE word_id = ?",[Rn]),n=Number(t?.seen_count??0),o=Number(r?.seen_count??0),i=o>n?Rn:vo,a=kt("reviews")?E("SELECT COUNT(*) FROM reviews WHERE word_id = ?",[Rn],0):0;if(!mf())return{migrated:!1,winnerId:i,canonicalSeenCount:n,legacySeenCount:o,movedReviews:0};e.run("BEGIN TRANSACTION");try{wu(e,Rn,vo),_u(d=>d===Rn?vo:d),R(cf,lf),e.run("COMMIT")}catch(d){throw e.run("ROLLBACK"),d}return je(),{migrated:!0,winnerId:i,canonicalSeenCount:n,legacySeenCount:o,movedReviews:a}}async function pf(){if(!mf())return null;let{saveRecoverySnapshot:e}=await Promise.resolve().then(()=>N(tt(),1)),t=await e("before-biru-2480-to-775"),r=TR();return console.log("[migration] \u30D3\u30EB 2480\u2192775 merged",{...r,recovery:t}),r}var uf,Rn,vo,lf,cf,kt,gu,Oe,ri,bn,gR,df,_R,fu,wR,_u,wu,mf,Tu=h(()=>{"use strict";uf=N($(),1);P();Rn=2480,vo=775,lf="2026-08-13-biru-2480-to-775-v1",cf="legacy_biru_merge_version",kt=e=>E("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",[e],0)===1,gu=e=>p(`PRAGMA table_info(${e})`).map(t=>String(t.name??"")).filter(Boolean),Oe=e=>`"${e.replace(/"/g,'""')}"`,ri=(e,t,r="",n=[])=>E(`SELECT 1 FROM ${Oe(e)} WHERE word_id = ?${r} LIMIT 1`,[t,...n],0)===1,bn=(e,t,r,n,o,s="",i=[])=>{if(!kt(t)||!ri(t,r,s,i))return;let a=ri(t,n,s,i);if(!a||o){a&&e.run(`DELETE FROM ${Oe(t)} WHERE word_id = ?${s}`,[n,...i]);let d=gu(t).filter(l=>l!=="sync_updated_at"&&l!=="sync_origin_device"),u=d.map(l=>l==="word_id"?"?":Oe(l));e.run(`INSERT INTO ${Oe(t)} (${d.map(Oe).join(", ")})
       SELECT ${u.join(", ")}
       FROM ${Oe(t)}
       WHERE word_id = ?${s}`,[n,r,...i])}e.run(`DELETE FROM ${Oe(t)} WHERE word_id = ?${s}`,[r,...i])},gR=(e,t,r,n,o)=>{if(!kt(t))return;p(`SELECT reviewed_on FROM ${Oe(t)} WHERE word_id = ? ORDER BY reviewed_on`,[r]).forEach(i=>{bn(e,t,r,n,o," AND reviewed_on = ?",[String(i.reviewed_on??"")])})},df=(e,t,r,n)=>{if(!kt(t))return 0;let o=gu(t).filter(a=>a!=="id"&&a!=="sync_updated_at"&&a!=="sync_origin_device"&&a!=="sync_uid");if(!o.includes("word_id"))return 0;let s=p(`SELECT ${o.map(Oe).join(", ")} FROM ${Oe(t)} WHERE word_id = ?`,[r]);if(!s.length)return 0;e.run(`DELETE FROM ${Oe(t)} WHERE word_id = ?`,[r]);let i=`INSERT INTO ${Oe(t)} (${o.map(Oe).join(", ")}) VALUES (${o.map(()=>"?").join(", ")})`;for(let a of s){let d=o.map(u=>u==="word_id"?n:a[u]);e.run(i,d)}return s.length},_R=(e,t)=>{try{let r=JSON.parse(e);if(!Array.isArray(r))return e;let n=new Map;return r.forEach(o=>{if(!o||typeof o!="object"||Array.isArray(o))return;let s=o,i=Number(s.word_id),a=t(i);if(!Number.isFinite(a))return;let d={...s,word_id:a},u=n.get(a);(!u||Number(d.due_after??0)<Number(u.due_after??0))&&n.set(a,d)}),JSON.stringify([...n.values()])}catch{return e}},fu=(e,t)=>Array.isArray(e)?e.map(r=>fu(r,t)):!e||typeof e!="object"?e:Object.fromEntries(Object.entries(e).map(([r,n])=>[r,r==="word_id"&&Number.isFinite(Number(n))?t(Number(n)):fu(n,t)])),wR=(e,t)=>{let r=O(e,"");if(r)try{R(e,JSON.stringify(fu(JSON.parse(r),t)))}catch{}},_u=e=>{["review_queue","review_queue_reverse","review_queue_kanji","review_queue_kanji_reading"].forEach(t=>{let r=O(t,"");r&&R(t,_R(r,e))}),["current_card","last_answered_word","last_answered_word_reverse","last_answered_word_kanji","last_answered_word_kanji_reading"].forEach(t=>{let r=Number(O(t,"0"));if(!r)return;let n=e(r);n!==r&&R(t,String(n))}),["last_answer","undo_pinned_card"].forEach(t=>wR(t,e))},wu=(e,t,r)=>{if(t===r)return 0;let n=E("SELECT seen_count FROM progress WHERE word_id = ?",[t],0),o=E("SELECT seen_count FROM progress WHERE word_id = ?",[r],0),s=n>o,i=["reviews","spelling_reviews"].reduce((d,u)=>d+(kt(u)?E(`SELECT COUNT(*) FROM ${Oe(u)} WHERE word_id = ?`,[t],0):0),0);bn(e,"progress",t,r,s);let a=kt("spelling_memory")&&gu("spelling_memory").includes("always_spell")?E("SELECT MAX(always_spell) FROM spelling_memory WHERE word_id IN (?, ?)",[t,r],0):0;return["reverse_memory","kanji_memory","kanji_reading_memory","spelling_memory"].forEach(d=>{if(!kt(d))return;let u=E(`SELECT COALESCE(seen_count, 0) FROM ${Oe(d)} WHERE word_id = ?`,[r],0),l=E(`SELECT COALESCE(seen_count, 0) FROM ${Oe(d)} WHERE word_id = ?`,[t],0);bn(e,d,t,r,l>u)}),a&&e.run("UPDATE spelling_memory SET always_spell = 1 WHERE word_id = ?",[r]),["stage1_tasks","stage2_progress","kanji_progress","kanji_reading_progress","critical_reviews","spelling_tasks"].forEach(d=>{gR(e,d,t,r,s)}),bn(e,"word_notes",t,r,s||!ri("word_notes",r)),bn(e,"word_question_meanings",t,r,s),bn(e,"moji_migrated_reviews",t,r,s||!ri("moji_migrated_reviews",r)),kt("dictionary_discovered_words")&&(e.run("INSERT OR IGNORE INTO dictionary_discovered_words (word_id) VALUES (?)",[r]),e.run("DELETE FROM dictionary_discovered_words WHERE word_id = ?",[t])),df(e,"reviews",t,r),df(e,"spelling_reviews",t,r),kt("content_favorites")&&(e.run(`
      INSERT OR IGNORE INTO content_favorites (item_type, item_id, folder)
      SELECT item_type, ?, folder FROM content_favorites
      WHERE item_type = 'word' AND item_id = ?
    `,[String(r),String(t)]),e.run("DELETE FROM content_favorites WHERE item_type = 'word' AND item_id = ?",[String(t)])),kt("custom_words")&&e.run("DELETE FROM custom_words WHERE word_id = ?",[t]),e.run("DELETE FROM words WHERE id = ?",[t]),i},mf=()=>O(cf,"")!==lf&&E("SELECT 1 FROM words WHERE id = ? LIMIT 1",[Rn],0)===1&&E("SELECT 1 FROM words WHERE id = ? LIMIT 1",[vo],0)===1});var yu={};x(yu,{CONTENT_MIGRATION_STATE_KEYS:()=>ni,DEVICE_LOCAL_GRAMMAR_STATE_KEYS:()=>si,DEVICE_LOCAL_STATE_KEYS:()=>oi,STUDY_TIME_TABLE:()=>st,SYNCED_TABLES:()=>it,isAppendTable:()=>SR,isDeviceLocalStateKey:()=>Do,localOnlyTables:()=>Su,syncedTablesForCloud:()=>Co});var st,it,Co,Su,ni,oi,si,Do,SR,Hr=h(()=>{"use strict";st="word_study_time_by_device",it=[{table:"progress",keys:["word_id"],strategy:"lww"},{table:"kanji_reading_memory",keys:["word_id"],strategy:"lww"},{table:"kanji_memory",keys:["word_id"],strategy:"lww"},{table:"kanji_unit_memory",keys:["unit_key"],strategy:"lww"},{table:"kanji_unit_flags",keys:["unit_key"],strategy:"lww"},{table:"kanji_unit_tasks",keys:["reviewed_on","unit_key"],strategy:"lww"},{table:"kanji_char_memory",keys:["char"],strategy:"lww"},{table:"kanji_char_tasks",keys:["reviewed_on","char"],strategy:"lww"},{table:"confusion_progress",keys:["group_key"],strategy:"lww"},{table:"confusion_tasks",keys:["reviewed_on","group_key"],strategy:"lww"},{table:"talk_memory",keys:["card_key"],strategy:"lww",cloud:!1},{table:"talk_tasks",keys:["reviewed_on","card_key"],strategy:"lww",cloud:!1},{table:"talk_reviews",keys:["sync_uid"],strategy:"append",cloud:!1},{table:"spelling_memory",keys:["word_id"],strategy:"lww",cloud:!1},{table:"spelling_tasks",keys:["reviewed_on","word_id"],strategy:"lww",cloud:!1},{table:"spelling_reviews",keys:["sync_uid"],strategy:"append",cloud:!1},{table:"jlpt_answers",keys:["sync_uid"],strategy:"append",cloud:!1},{table:"reverse_memory",keys:["word_id"],strategy:"lww"},{table:"grammar_progress",keys:["grammar_id"],strategy:"lww"},{table:"grammar_mistakes",keys:["grammar_id"],strategy:"lww"},{table:"word_notes",keys:["word_id"],strategy:"lww"},{table:"word_question_meanings",keys:["word_id"],strategy:"lww"},{table:"custom_words",keys:["word_id"],strategy:"union"},{table:"dictionary_discovered_words",keys:["word_id"],strategy:"union"},{table:"confusion_mastered",keys:["group_key"],strategy:"lww"},{table:"level_prior_baselines",keys:["entity","entity_key"],strategy:"lww"},{table:"kana_memory",keys:["symbol"],strategy:"lww"},{table:"achievements",keys:["id"],strategy:"union"},{table:"moji_migrated_reviews",keys:["word_id"],strategy:"lww"},{table:"critical_reviews",keys:["reviewed_on","word_id"],strategy:"lww"},{table:"stage1_tasks",keys:["reviewed_on","word_id"],strategy:"lww"},{table:"stage2_progress",keys:["reviewed_on","word_id"],strategy:"lww"},{table:"kanji_progress",keys:["reviewed_on","word_id"],strategy:"lww"},{table:"kanji_reading_progress",keys:["reviewed_on","word_id"],strategy:"lww"},{table:"app_state",keys:["key"],strategy:"lww"},{table:"grammar_state",keys:["key"],strategy:"lww"},{table:"grammar_highlights",keys:["grammar_id","block","start","end"],strategy:"lww"},{table:"grammar_reading_positions",keys:["kind","level"],strategy:"lww"},{table:"content_favorites",keys:["item_type","item_id"],strategy:"lww"},{table:"favorite_folders",keys:["name"],strategy:"union"},{table:"vocab_test_history",keys:["run_id"],strategy:"union"},{table:"yuzu_ledger",keys:["kind","key"],strategy:"union"},{table:"study_focus_windows",keys:["id"],strategy:"union"},{table:"reviews",keys:["sync_uid"],strategy:"append"},{table:"grammar_reviews",keys:["sync_uid"],strategy:"append"},{table:"grammar_activity_events",keys:["sync_uid"],strategy:"append"},{table:"kanji_unit_reviews",keys:["sync_uid"],strategy:"append"},{table:"kanji_char_reviews",keys:["sync_uid"],strategy:"append"},{table:"confusion_reviews",keys:["sync_uid"],strategy:"append"},{table:"kana_reviews",keys:["sync_uid"],strategy:"append"},{table:"checkins",keys:["checked_on"],strategy:"union"},{table:"moments",keys:["kind","key"],strategy:"union"},{table:st,keys:["studied_on","device_id"],strategy:"lww"},{table:"study_time_by_period",keys:["period_start","device_id"],strategy:"lww"},{table:"weekly_reports",keys:["week_start"],strategy:"lww"}],Co=e=>it.filter(t=>t.cloud!==!1&&(e||t.table!=="weekly_reports")),Su=()=>it.filter(e=>e.cloud===!1).map(e=>e.table),ni=["jlpt_seed_version","jlpt_word_metadata_version","jlpt_level_override_version","jlpt_collocation_content_version","dictionary_supplement_version","furigana_version","kana_reading_fix_version","legacy_biru_merge_version"],oi=new Set(["sync_device_id","sync_cursor","sync_last_pushed_at","sync_generation","sync_last_modified","runtime_schema_user_ddl","runtime_schema_sync_ddl","auth_access_token","auth_user_id","entitlement_cache","local_snapshot_mark","weekly_report_events","study_focus_partial_windows","last_answer","level_trial_expiry_noticed",...ni]),si=new Set(["dataset_version"]),Do=(e,t)=>e==="app_state"?oi.has(t):e==="grammar_state"?si.has(t):!1,SR=e=>it.find(t=>t.table===e)?.strategy==="append"});function LR(e,t){let r=Math.max(0,Math.round(t));if(!r||!(p("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'study_time_by_period' LIMIT 1").length>0))return;let o=e-r*1e3,s=e,i=r;for(;o<s;){let a=RR(o),d=new Date(`${a.replace(" ","T")}:00`);d.setDate(d.getDate()+7);let u=Math.min(s,d.getTime()),l=u===s?i:Math.min(i,Math.max(0,Math.round((u-o)/1e3)));bR(a,l),i-=l,o=u,l===0&&(o+=1e3)}}function Ef(e,t,r=Date.now()){let n=Math.max(0,Math.round(t));n&&((0,Ln.getDatabase)().run(`
    INSERT INTO ${st} (studied_on, device_id, seconds)
    VALUES (?, ?, ?)
    ON CONFLICT(studied_on, device_id) DO UPDATE SET
      seconds = seconds + excluded.seconds
  `,[e,On(),n]),yR(e),LR(r,n))}function ff(){let e=(0,Ln.getDatabase)();e.run("SAVEPOINT rebuild_study_time");try{e.run(`DELETE FROM word_study_time WHERE NOT EXISTS (
      SELECT 1 FROM ${st} d WHERE d.studied_on = word_study_time.studied_on
    )`),e.run(`
      INSERT INTO word_study_time (studied_on, seconds, updated_at)
      SELECT studied_on, SUM(seconds), CURRENT_TIMESTAMP
      FROM ${st}
      GROUP BY studied_on
      ON CONFLICT(studied_on) DO UPDATE SET
        seconds = excluded.seconds,
        updated_at = CURRENT_TIMESTAMP
    `),e.run("RELEASE rebuild_study_time")}catch(t){throw e.run("ROLLBACK TO rebuild_study_time"),e.run("RELEASE rebuild_study_time"),t}}function gf(){let e=p(`
    SELECT t.studied_on, t.seconds
    FROM word_study_time t
    WHERE t.seconds > 0
      AND NOT EXISTS (
        SELECT 1 FROM ${st} d WHERE d.studied_on = t.studied_on
      )
      AND NOT EXISTS (
        SELECT 1 FROM sync_tombstones s
        WHERE s.table_name = '${st}'
          AND substr(s.row_key, 1, length(t.studied_on) + 1) = t.studied_on || char(31)
      )
  `);if(!e.length)return;let t=(0,Ln.getDatabase)(),r=On();t.run("BEGIN");try{for(let n of e)t.run(`INSERT OR REPLACE INTO ${st} (studied_on, device_id, seconds) VALUES (?, ?, ?)`,[String(n.studied_on),r,Number(n.seconds??0)]);t.run("COMMIT")}catch(n){throw t.run("ROLLBACK"),n}}var Ln,yR,NR,RR,bR,ii=h(()=>{"use strict";Ln=N($(),1);P();at();Hr();yR=e=>{(0,Ln.getDatabase)().run(`
    INSERT INTO word_study_time (studied_on, seconds, updated_at)
    SELECT ?, COALESCE(SUM(seconds), 0), CURRENT_TIMESTAMP
    FROM ${st}
    WHERE studied_on = ?
    ON CONFLICT(studied_on) DO UPDATE SET
      seconds = excluded.seconds,
      updated_at = CURRENT_TIMESTAMP
  `,[e,e])},NR=e=>{let t=e.getFullYear(),r=String(e.getMonth()+1).padStart(2,"0"),n=String(e.getDate()).padStart(2,"0");return`${t}-${r}-${n}`},RR=e=>{let t=new Date(e);return t.setHours(14,0,0,0),t.setDate(t.getDate()-t.getDay()),e<t.getTime()&&t.setDate(t.getDate()-7),`${NR(t)} 14:00`},bR=(e,t)=>{t<=0||(0,Ln.getDatabase)().run(`
    INSERT INTO study_time_by_period (period_start, device_id, seconds)
    VALUES (?, ?, ?)
    ON CONFLICT(period_start, device_id) DO UPDATE SET
      seconds = seconds + excluded.seconds
  `,[e,On(),t])}});var ku={};x(ku,{SYNC_ORIGIN_COL:()=>_e,SYNC_SCHEMA_FINGERPRINT_KEY:()=>ai,SYNC_UID_COL:()=>vt,SYNC_UPDATED_COL:()=>Ae,beginSyncApply:()=>di,endSyncApply:()=>ui,ensureLegacyMemoryColumns:()=>Au,ensureSyncSchema:()=>Ve,getDeviceId:()=>On,invalidateSyncSchema:()=>Ou,resetDeviceId:()=>kR,withoutSyncStamp:()=>qt});function Ou(){let e=(0,Ct.getDatabase)();bu.delete(e),R(ai,"")}function Au(e){let t=(0,Ct.getDatabase)();for(let r of hu(e))t.run(r)}function Ve(){let e=(0,Ct.getDatabase)();if(bu.has(e))return;let t=_f(),r=ei(ai,t)&&!OR();r||AR(),e.run("DELETE FROM sync_context WHERE key = 'applying_remote'"),e.run("INSERT OR REPLACE INTO sync_context (key, value) VALUES ('applying_remote', '1')");try{hR()}finally{e.run("DELETE FROM sync_context WHERE key = 'applying_remote'")}r||ti(ai,_f()),bu.add(e),wf("word_study_time")&&gf()}function Tf(){let e=["CREATE TABLE IF NOT EXISTS sync_device (id TEXT NOT NULL)",`CREATE TABLE IF NOT EXISTS sync_context (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,`CREATE TABLE IF NOT EXISTS sync_tombstones (
      table_name TEXT NOT NULL,
      row_key TEXT NOT NULL,
      deleted_at TEXT NOT NULL,
      origin_device TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (table_name, row_key)
    )`,`CREATE TABLE IF NOT EXISTS ${st} (
      studied_on TEXT NOT NULL,
      device_id TEXT NOT NULL,
      seconds INTEGER NOT NULL DEFAULT 0,
      ${Ae} TEXT,
      PRIMARY KEY (studied_on, device_id)
    )`,`CREATE TABLE IF NOT EXISTS weekly_reports (
      week_start TEXT PRIMARY KEY,
      week_end TEXT NOT NULL,
      generated_at INTEGER NOT NULL,
      schema_version INTEGER NOT NULL DEFAULT 3,
      content_json TEXT NOT NULL,
      read_at INTEGER,
      source_revision TEXT,
      sync_updated_at TEXT,
      sync_origin_device TEXT
    )`];e.push("ALTER TABLE sync_tombstones ADD COLUMN origin_device TEXT NOT NULL DEFAULT ''");for(let t of it)t.table==="reviews"&&e.push("ALTER TABLE reviews ADD COLUMN direction TEXT NOT NULL DEFAULT 'forward'","ALTER TABLE reviews ADD COLUMN reviewed_at INTEGER","ALTER TABLE reviews ADD COLUMN scheduler_mode TEXT NOT NULL DEFAULT 'legacy'","ALTER TABLE reviews ADD COLUMN fsrs_params_version TEXT NOT NULL DEFAULT 'legacy'","ALTER TABLE reviews ADD COLUMN event_source TEXT NOT NULL DEFAULT 'legacy'"),e.push(...hu(t.table,new Set)),e.push(...Sf(t,new Set)),e.push(...yf(t));return e}function AR(){let e=(0,Ct.getDatabase)(),t=5,r=Tf();e.run("SAVEPOINT sync_structure");try{e.exec(r.slice(0,t).join(";")),On();let n=[];Lu("sync_tombstones").has("origin_device")||n.push("ALTER TABLE sync_tombstones ADD COLUMN origin_device TEXT NOT NULL DEFAULT ''");let o=new Set(p("SELECT name FROM sqlite_master WHERE type = 'table'").map(s=>String(s.name)));for(let s of it){if(!o.has(s.table))continue;let i=Lu(s.table);s.table==="reviews"&&(i.has("direction")||n.push("ALTER TABLE reviews ADD COLUMN direction TEXT NOT NULL DEFAULT 'forward'"),i.has("reviewed_at")||n.push("ALTER TABLE reviews ADD COLUMN reviewed_at INTEGER"),i.has("scheduler_mode")||n.push("ALTER TABLE reviews ADD COLUMN scheduler_mode TEXT NOT NULL DEFAULT 'legacy'"),i.has("fsrs_params_version")||n.push("ALTER TABLE reviews ADD COLUMN fsrs_params_version TEXT NOT NULL DEFAULT 'legacy'"),i.has("event_source")||n.push("ALTER TABLE reviews ADD COLUMN event_source TEXT NOT NULL DEFAULT 'legacy'")),n.push(...hu(s.table,i)),n.push(...Sf(s,i)),n.push(...yf(s))}e.exec([...n.filter(s=>s.startsWith("ALTER TABLE")),...n.filter(s=>!s.startsWith("ALTER TABLE"))].join(";")),e.run("RELEASE sync_structure")}catch(n){throw e.run("ROLLBACK TO sync_structure"),e.run("RELEASE sync_structure"),n}}function hR(){let e=(0,Ct.getDatabase)(),t=new Set(p("SELECT name FROM sqlite_master WHERE type = 'table'").map(o=>String(o.name))),r=it.filter(o=>t.has(o.table));if(!r.length)return;let n=p(r.map((o,s)=>`SELECT ${s} AS position,
    ${o.strategy==="append"?`EXISTS (SELECT 1 FROM ${o.table} WHERE ${vt} IS NULL LIMIT 1)`:"0"} AS uid,
    EXISTS (SELECT 1 FROM ${o.table} WHERE ${Ae} IS NULL LIMIT 1) AS updated,
    EXISTS (SELECT 1 FROM ${o.table} WHERE ${_e} IS NULL OR ${_e} = '' LIMIT 1) AS origin
  `).join(" UNION ALL "));for(let o of n){let s=r[Number(o.position)],i=[],a=[];Number(o.uid)&&(i.push(`${vt} = COALESCE(${vt}, (SELECT id FROM sync_device LIMIT 1) || ':' || CAST(id AS TEXT))`),a.push(`${vt} IS NULL`)),Number(o.updated)&&(i.push(`${Ae} = COALESCE(${Ae}, '1970-01-01T00:00:00.000Z')`),a.push(`${Ae} IS NULL`)),Number(o.origin)&&(i.push(`${_e} = CASE WHEN ${_e} IS NULL OR ${_e} = ''
        THEN (SELECT id FROM sync_device LIMIT 1) ELSE ${_e} END`),a.push(`${_e} IS NULL OR ${_e} = ''`)),i.length&&e.run(`UPDATE ${s.table} SET ${i.join(", ")} WHERE ${a.join(" OR ")}`)}}function di(){Ve(),(0,Ct.getDatabase)().run("INSERT OR REPLACE INTO sync_context (key, value) VALUES ('applying_remote', '1')")}function ui(){(0,Ct.getDatabase)().run("DELETE FROM sync_context WHERE key = 'applying_remote'")}function qt(e){if(Ve(),E("SELECT value FROM sync_context WHERE key = 'applying_remote'",[],"")==="1")return e();di();try{return e()}finally{ui()}}function On(){let e=(0,Ct.getDatabase)();e.run("CREATE TABLE IF NOT EXISTS sync_device (id TEXT NOT NULL)");let t=p("SELECT id FROM sync_device LIMIT 1");if(t.length)return String(t[0].id);let r=crypto.randomUUID();return e.run("INSERT INTO sync_device (id) VALUES (?)",[r]),r}function kR(){let e=(0,Ct.getDatabase)(),t=crypto.randomUUID();return e.run("DELETE FROM sync_device"),e.run("INSERT INTO sync_device (id) VALUES (?)",[t]),t}var Ct,Ae,vt,_e,Nu,bu,ai,Lu,wf,Ru,hu,OR,_f,Sf,yf,at=h(()=>{"use strict";Ct=N($(),1);P();Eu();ii();Hr();Ae="sync_updated_at",vt="sync_uid",_e="sync_origin_device",Nu="strftime('%Y-%m-%dT%H:%M:%fZ','now')",bu=new WeakSet,ai="runtime_schema_sync_ddl";Lu=e=>new Set(p(`PRAGMA table_info(${e})`).map(t=>String(t.name??""))),wf=e=>p("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",[e]).length>0,Ru=(e,t)=>e.keys.map(r=>`CAST(${t}.${r} AS TEXT)`).join(" || char(31) || ");hu=(e,t)=>{if(e!=="reverse_memory"&&e!=="kanji_reading_memory")return[];if(!t&&!wf(e))return[];let r=t??Lu(e);return Object.entries({score:"INTEGER NOT NULL DEFAULT 0",low_history:"INTEGER NOT NULL DEFAULT 0",known_forever:"INTEGER NOT NULL DEFAULT 0",mastered_on:"TEXT",mistake_streak:"INTEGER NOT NULL DEFAULT 0",last_decay_amount:"INTEGER DEFAULT 10",right_streak:"INTEGER NOT NULL DEFAULT 0",auto_retired_on:"TEXT"}).filter(([o])=>!r.has(o)).map(([o,s])=>`ALTER TABLE ${e} ADD COLUMN ${o} ${s}`)};OR=()=>p(`
  SELECT 1 FROM sqlite_master m
  WHERE m.type = 'table' AND m.name IN (${it.map(e=>`'${e.table}'`).join(", ")})
    AND NOT EXISTS (SELECT 1 FROM pragma_table_info(m.name) WHERE name = '${Ae}')
  LIMIT 1
`).length>0,_f=()=>{let e=new Set(p("SELECT name FROM sqlite_master WHERE type = 'table'").map(t=>String(t.name)));return Zs([Tf(),it.filter(t=>e.has(t.table)).map(t=>t.table)])};Sf=(e,t)=>{let r=[];return t.has(Ae)||r.push(`ALTER TABLE ${e.table} ADD COLUMN ${Ae} TEXT`),t.has(_e)||r.push(`ALTER TABLE ${e.table} ADD COLUMN ${_e} TEXT`),e.strategy==="append"&&(t.has(vt)||r.push(`ALTER TABLE ${e.table} ADD COLUMN ${vt} TEXT`),r.push(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${e.table}_sync_uid
       ON ${e.table}(${vt})`)),r.push(`CREATE INDEX IF NOT EXISTS idx_${e.table}_sync_updated
     ON ${e.table}(${Ae})`),r.push(`CREATE INDEX IF NOT EXISTS idx_${e.table}_sync_origin_missing
     ON ${e.table}(${_e})
     WHERE ${_e} IS NULL OR ${_e} = ''`),r},yf=e=>{let{table:t}=e,r=e.strategy==="append"?`, ${vt} = COALESCE(NEW.${vt},
         (SELECT id FROM sync_device LIMIT 1) || ':' || lower(hex(randomblob(16))))`:"",n=[`DROP TRIGGER IF EXISTS trg_${t}_sync_insert`,`DROP TRIGGER IF EXISTS trg_${t}_sync_update`,`DROP TRIGGER IF EXISTS trg_${t}_sync_delete`];return n.push(`
    CREATE TRIGGER IF NOT EXISTS trg_${t}_sync_insert AFTER INSERT ON ${t}
    WHEN NOT EXISTS (SELECT 1 FROM sync_context WHERE key = 'applying_remote' AND value = '1')
    BEGIN
      UPDATE ${t} SET ${Ae} = ${Nu},
        ${_e} = (SELECT id FROM sync_device LIMIT 1)${r}
      WHERE rowid = NEW.rowid;
      DELETE FROM sync_tombstones
      WHERE table_name = '${t}' AND row_key = ${Ru(e,"NEW")};
    END
  `),n.push(`
    CREATE TRIGGER IF NOT EXISTS trg_${t}_sync_update AFTER UPDATE ON ${t}
    WHEN NEW.${Ae} IS OLD.${Ae}
      AND NOT EXISTS (SELECT 1 FROM sync_context WHERE key = 'applying_remote' AND value = '1')
    BEGIN
      UPDATE ${t} SET ${Ae} = ${Nu},
        ${_e} = (SELECT id FROM sync_device LIMIT 1)
      WHERE rowid = NEW.rowid;
    END
  `),n.push(`
    CREATE TRIGGER IF NOT EXISTS trg_${t}_sync_delete AFTER DELETE ON ${t}
    WHEN NOT EXISTS (SELECT 1 FROM sync_context WHERE key = 'applying_remote' AND value = '1')
      -- \u7B97\u4E0D\u51FA row_key \u7684\u884C(\u67D0\u5217\u662F NULL)\u5199\u4E0D\u4E86\u5893\u7891 \u2014\u2014 \u4F46\u90A3\u4E5F\u4E0D\u8BE5\u8BA9\u8C03\u7528\u65B9\u7684\u4E8B\u52A1
      -- \u6574\u4E2A\u5931\u8D25\u3002\u6CA1\u6709\u540C\u6B65\u8EAB\u4EFD\u7684\u884C\u672C\u6765\u5C31\u4E0D\u53EF\u80FD\u88AB\u5BF9\u7AEF\u6309\u952E\u590D\u6D3B,\u8DF3\u8FC7\u662F\u5B89\u5168\u7684;
      -- \u629B\u9519\u5219\u4F1A\u628A\u300C\u5408\u5E76\u91CD\u590D\u8BCD\u6761\u300D\u8FD9\u79CD\u4E00\u6574\u4E2A\u6279\u91CF\u8FC1\u79FB\u6380\u7FFB\u3002\u4E0A\u9762\u7684 uid \u56DE\u586B\u8D1F\u8D23
      -- \u8BA9\u8FD9\u6761\u5B88\u536B\u5E73\u65F6\u7528\u4E0D\u4E0A\u3002
      AND ${Ru(e,"OLD")} IS NOT NULL
    BEGIN
      INSERT INTO sync_tombstones (table_name, row_key, deleted_at, origin_device)
      VALUES ('${t}', ${Ru(e,"OLD")}, ${Nu},
        (SELECT id FROM sync_device LIMIT 1))
      ON CONFLICT(table_name, row_key) DO UPDATE SET
        deleted_at = excluded.deleted_at,
        origin_device = excluded.origin_device;
    END
  `),n}});var ci,vR,CR,DR,vu,li,IR,Nf,Rf,Tr,Z,Sr,Qt=h(()=>{"use strict";ci=typeof __TARO_PERF_OVERLAY__<"u"&&__TARO_PERF_OVERLAY__,vR="\u542F\u52A8 \xB7 ",CR=0,DR=!1,vu=new Map,li=[],IR=new Map;ci&&(globalThis.__shushugoPerf={perfPhases:vu,perfTimeline:li,perfSql:IR});Nf=(e,t,r)=>{li.push({phase:e,at:Math.round(t-CR),ms:Math.round(r)}),li.length>300&&li.shift()},Rf="",Tr=(e,t)=>{if(!ci||e.startsWith(vR)&&!DR)return;let r=vu.get(e)??[];r.push(Math.round(t)),r.length>20&&r.shift(),vu.set(e,r)},Z=(e,t)=>{if(!ci)return t();Rf=e;let r=performance.now();try{return t()}finally{Tr(e,performance.now()-r),Nf(e,r,performance.now()-r)}},Sr=(e,t)=>{if(!ci)return t();Rf=e;let r=performance.now(),n;try{n=t()}catch(o){throw Tr(e,performance.now()-r),o}return n.then(o=>(Tr(e,performance.now()-r),Nf(e,r,performance.now()-r),o),o=>{throw Tr(e,performance.now()-r),o})}});var Zt=le((GD,bf)=>{bf.exports=new Proxy({},{get(e,t){if(t==="__esModule")return!1;if(typeof t!="symbol")throw new Error(`\u51FA\u5382\u79CD\u5B50\u6570\u636E\u4E0D\u5728\u5C0F\u7A0B\u5E8F\u5305\u91CC\uFF08\u8BBF\u95EE\u4E86 ${String(t)}\uFF09\uFF1A\u5185\u5BB9\u8FC1\u79FB\u53EA\u5728\u7F51\u9875 / App \u4E0A\u8DD1`)}})});var Of=le((BD,Lf)=>{Lf.exports=()=>require("../shared/content").load("jlptCollocations")});var Af={};x(Af,{migrateJlptCollocationContent:()=>xR});var Cu,MR,xR,UR,hf=h(()=>{"use strict";jr();Cu=N($(),1);P();G();MR=async()=>{let t=(await Promise.resolve().then(()=>N(Of(),1))).default;return typeof t=="function"?t():t},xR=async()=>{if(O("jlpt_collocation_content_version","")===Io)return;let e=await MR();if(e.status!=="content_ready_runtime_migration"||e.entries.length!==790)throw new Error(`\u56FA\u5B9A\u642D\u914D\u5185\u5BB9\u7248\u672C\u65E0\u6548: status=${e.status} entries=${e.entries.length}`);if(e.entries.some(o=>!o.surface||!o.kana||!o.meaning||!/^N[1-5]$/.test(o.level)))throw new Error("\u56FA\u5B9A\u642D\u914D\u5185\u5BB9\u5B58\u5728\u7F3A\u5C11\u8868\u8BB0\u3001\u8BFB\u97F3\u3001\u91CA\u4E49\u6216\u7B49\u7EA7\u7684\u6761\u76EE");let t=(0,Cu.getDatabase)(),r=new Set(p("SELECT kanji, kana FROM words").map(o=>`${String(o.kanji??"")}\0${String(o.kana??"")}`)),n=[];t.run("BEGIN TRANSACTION");try{e.entries.forEach(o=>{let s=`${o.surface}\0${o.kana}`;if(!r.has(s)){t.run(`
          INSERT INTO words (
            meaning, kana, kanji, pos, verb_type, importance,
            shuffle_rank, example_jp, example_meaning, example_furigana, example_tokens, example_lemmas, jlpt_level
          )
          VALUES (?, ?, ?, ?, NULL, ?, ABS(RANDOM()) / 9223372036854775807.0, '', '', '', '', '', ?)
        `,[o.meaning,o.kana,o.surface,"\u56FA\u5B9A\u642D\u914D",3,o.level]);let i=E("SELECT last_insert_rowid()",[],0);i>0&&n.push(i),r.add(s)}t.run("UPDATE words SET collocation_tier = ? WHERE pos = '\u56FA\u5B9A\u642D\u914D' AND kanji = ? AND kana = ?",[{core:0,common:1,optional:2}[zs(o)],o.surface,o.kana])}),n.forEach(o=>t.run("INSERT OR IGNORE INTO progress (word_id) VALUES (?)",[o])),UR(e.removed),R("jlpt_collocation_content_version",Io),t.run("COMMIT")}catch(o){throw t.run("ROLLBACK"),o}je()},UR=e=>{if(!e.length)return;let t=(0,Cu.getDatabase)(),r=a=>p(`PRAGMA table_info("${a}")`).map(d=>String(d.name)),n=p("SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'words'").map(a=>String(a.name)).filter(a=>r(a).includes("word_id")),o=n.filter(a=>a!=="progress"),s=n.filter(a=>r(a).includes("known_forever")),i=a=>E(`
      SELECT COUNT(*) FROM progress WHERE word_id = ? AND (
        COALESCE(seen_count, 0) > 0 OR COALESCE(known_forever, 0) <> 0
        OR last_seen_on IS NOT NULL OR mastered_on IS NOT NULL
      )
    `,[a],0)>0||o.some(d=>E(`SELECT COUNT(*) FROM "${d}" WHERE word_id = ?`,[a],0)>0)||E("SELECT COUNT(*) FROM content_favorites WHERE item_type = 'word' AND item_id = ?",[String(a)],0)>0||O("current_card","")===String(a);e.forEach(({surface:a,kana:d})=>{p("SELECT id FROM words WHERE kanji = ? AND kana = ? AND pos = '\u56FA\u5B9A\u642D\u914D'",[a,d]).map(u=>Number(u.id)).forEach(u=>{if(i(u)){s.forEach(l=>t.run(`UPDATE "${l}" SET known_forever = 1 WHERE word_id = ? AND known_forever = 0`,[u]));return}t.run("DELETE FROM progress WHERE word_id = ?",[u]),t.run("DELETE FROM words WHERE id = ?",[u])})})}});var Fu={};x(Fu,{DICTIONARY_SUPPLEMENT_VERSION:()=>Ei,FURIGANA_VERSION:()=>fi,GRAMMAR_SEED_ROW_COUNT:()=>Mf,GRAMMAR_SEED_VERSION:()=>pi,JLPT_COLLOCATION_CONTENT_VERSION:()=>Io,USER_SCHEMA_FINGERPRINT_KEY:()=>Uu,answerLabel:()=>QR,collocationTier:()=>zs,daysSince:()=>Lo,ensureJlptCollocationContent:()=>Pf,ensureSeedData:()=>PR,ensureUserTables:()=>q,firstRow:()=>H,firstValue:()=>E,getState:()=>O,isFavorite:()=>Mo,persistSoon:()=>D,randomBetween:()=>JR,rowsFor:()=>p,sessionScoreDelta:()=>qR,setState:()=>R,studyDate:()=>B,studyDayEnd:()=>A,today:()=>T});var wt,Du,fi,If,mi,pi,Mf,Ei,Io,xf,Uf,Ff,Wf,jf,FR,$f,WR,Iu,Uu,jR,kf,q,vf,$R,PR,Pf,HR,Mo,Mu,xu,KR,GR,BR,XR,Hf,Cf,YR,Df,zR,VR,JR,qR,QR,G=h(()=>{"use strict";wt=N($(),1);af();Eu();Tu();at();Hr();Qt();P();P();jr();Du="2026-06-15-jlpt10k",fi="2026-08-15-kuromoji-ipadic-v5-bunsetsu-morph-v1",If=`2026-10-12-atatameru-example-v1-${fi}`,mi="2026-08-21-unleveled-v1",pi="2026-10-20-grammar-connection-examples-v1",Mf=769,Ei="2026-08-16-handwritten-v1",Io="2026-10-18-jlpt-collocations-zh-v4",xf=async()=>(await Promise.resolve().then(()=>N(Zt(),1))).default,Uf=async()=>(await Promise.resolve().then(()=>N(Zt(),1))).default,Ff=e=>{let t=(0,wt.getDatabase)();e.forEach(([r,n,o])=>{t.run("UPDATE words SET sense_key = ? WHERE kanji = ? AND kana = ?",[o,r,n])})},Wf=async()=>(await Promise.resolve().then(()=>N(Zt(),1))).default,jf=async()=>(await Promise.resolve().then(()=>N(Zt(),1))).default,FR=async()=>(await Promise.resolve().then(()=>N(Zt(),1))).default,$f=async()=>(await Promise.resolve().then(()=>N(Zt(),1))).default,WR=async()=>(await Promise.resolve().then(()=>N(Zt(),1))).default,Iu=new WeakSet,Uu="runtime_schema_user_ddl",jR=["CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)",...cu.split(";").map(e=>e.trim()).filter(Boolean),"ALTER TABLE words ADD COLUMN collocation_tier INTEGER","ALTER TABLE words ADD COLUMN jlpt_level TEXT","ALTER TABLE words ADD COLUMN example_furigana TEXT NOT NULL DEFAULT ''","ALTER TABLE words ADD COLUMN example_tokens TEXT NOT NULL DEFAULT ''","ALTER TABLE words ADD COLUMN example_lemmas TEXT NOT NULL DEFAULT ''","ALTER TABLE words ADD COLUMN sense_key TEXT NOT NULL DEFAULT ''","ALTER TABLE grammar_points ADD COLUMN example_furigana TEXT NOT NULL DEFAULT ''","ALTER TABLE grammar_points ADD COLUMN example_tokens TEXT NOT NULL DEFAULT ''","ALTER TABLE grammar_points ADD COLUMN example_lemmas TEXT NOT NULL DEFAULT ''","ALTER TABLE grammar_points_archive ADD COLUMN example_furigana TEXT NOT NULL DEFAULT ''","ALTER TABLE grammar_points_archive ADD COLUMN example_tokens TEXT NOT NULL DEFAULT ''","ALTER TABLE grammar_points_archive ADD COLUMN example_lemmas TEXT NOT NULL DEFAULT ''","ALTER TABLE grammar_reading_positions ADD COLUMN scroll_top REAL NOT NULL DEFAULT 0","ALTER TABLE content_favorites ADD COLUMN folder TEXT NOT NULL DEFAULT ''","ALTER TABLE vocab_test_history ADD COLUMN levels_json TEXT NOT NULL DEFAULT ''","ALTER TABLE reviews ADD COLUMN direction TEXT NOT NULL DEFAULT 'forward'","ALTER TABLE spelling_memory ADD COLUMN always_spell INTEGER NOT NULL DEFAULT 0",`CREATE TABLE IF NOT EXISTS study_time_by_period (
    period_start TEXT NOT NULL, device_id TEXT NOT NULL, seconds INTEGER NOT NULL DEFAULT 0,
    sync_updated_at TEXT, sync_origin_device TEXT, PRIMARY KEY (period_start, device_id)
  )`,"CREATE INDEX IF NOT EXISTS idx_reviews_day_direction ON reviews(reviewed_on, direction)","CREATE INDEX IF NOT EXISTS idx_words_jlpt_level ON words(jlpt_level)","CREATE INDEX IF NOT EXISTS idx_words_pos ON words(pos)"],kf=()=>Zs([jR,pu.toString(),mu.toString(),q.toString()]),q=()=>{let e=(0,wt.getDatabase)();if(Iu.has(e))return;let t=kf();if(ei(Uu,t)){Iu.add(e);return}pu(),p("PRAGMA table_info(spelling_memory)").some(u=>u.name==="always_spell")||e.run("ALTER TABLE spelling_memory ADD COLUMN always_spell INTEGER NOT NULL DEFAULT 0"),e.run("CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)");let r=p("PRAGMA table_info(words)").map(u=>String(u.name??""));r.includes("collocation_tier")||e.run("ALTER TABLE words ADD COLUMN collocation_tier INTEGER"),r.includes("jlpt_level")||e.run("ALTER TABLE words ADD COLUMN jlpt_level TEXT"),r.includes("example_furigana")||e.run("ALTER TABLE words ADD COLUMN example_furigana TEXT NOT NULL DEFAULT ''"),r.includes("example_tokens")||e.run("ALTER TABLE words ADD COLUMN example_tokens TEXT NOT NULL DEFAULT ''"),r.includes("example_lemmas")||e.run("ALTER TABLE words ADD COLUMN example_lemmas TEXT NOT NULL DEFAULT ''"),r.includes("sense_key")||e.run("ALTER TABLE words ADD COLUMN sense_key TEXT NOT NULL DEFAULT ''");let n=p("PRAGMA table_info(grammar_points)").map(u=>String(u.name??""));n.includes("example_furigana")||e.run("ALTER TABLE grammar_points ADD COLUMN example_furigana TEXT NOT NULL DEFAULT ''"),n.includes("example_tokens")||e.run("ALTER TABLE grammar_points ADD COLUMN example_tokens TEXT NOT NULL DEFAULT ''"),n.includes("example_lemmas")||e.run("ALTER TABLE grammar_points ADD COLUMN example_lemmas TEXT NOT NULL DEFAULT ''");let o=p("PRAGMA table_info(grammar_points_archive)").map(u=>String(u.name??""));o.includes("example_furigana")||e.run("ALTER TABLE grammar_points_archive ADD COLUMN example_furigana TEXT NOT NULL DEFAULT ''"),o.includes("example_tokens")||e.run("ALTER TABLE grammar_points_archive ADD COLUMN example_tokens TEXT NOT NULL DEFAULT ''"),o.includes("example_lemmas")||e.run("ALTER TABLE grammar_points_archive ADD COLUMN example_lemmas TEXT NOT NULL DEFAULT ''"),p("PRAGMA table_info(grammar_reading_positions)").map(u=>String(u.name??"")).includes("scroll_top")||e.run("ALTER TABLE grammar_reading_positions ADD COLUMN scroll_top REAL NOT NULL DEFAULT 0"),p("PRAGMA table_info(content_favorites)").map(u=>String(u.name??"")).includes("folder")||e.run("ALTER TABLE content_favorites ADD COLUMN folder TEXT NOT NULL DEFAULT ''");let a=p("PRAGMA table_info(vocab_test_history)").map(u=>String(u.name??""));a.length&&!a.includes("levels_json")&&e.run("ALTER TABLE vocab_test_history ADD COLUMN levels_json TEXT NOT NULL DEFAULT ''"),p("PRAGMA table_info(reviews)").map(u=>String(u.name??"")).includes("direction")||e.run("ALTER TABLE reviews ADD COLUMN direction TEXT NOT NULL DEFAULT 'forward'"),e.run("CREATE INDEX IF NOT EXISTS idx_reviews_day_direction ON reviews(reviewed_on, direction)"),e.run(`
    CREATE TABLE IF NOT EXISTS study_time_by_period (
      period_start TEXT NOT NULL,
      device_id TEXT NOT NULL,
      seconds INTEGER NOT NULL DEFAULT 0,
      sync_updated_at TEXT,
      sync_origin_device TEXT,
      PRIMARY KEY (period_start, device_id)
    )
  `),e.run("CREATE INDEX IF NOT EXISTS idx_words_jlpt_level ON words(jlpt_level)"),e.run("CREATE INDEX IF NOT EXISTS idx_words_pos ON words(pos)"),Ou(),ti(Uu,kf()),Iu.add(e)},vf="2026-09-09-unsynced-content-markers-v1",$R=()=>{if(O("content_marker_repair","")!==vf){for(let e of ni)R(e,"");R("content_marker_repair",vf)}},PR=async()=>{Z("\u542F\u52A8 \xB7 \u7528\u6237\u8868\u7ED3\u6784",q),Z("\u542F\u52A8 \xB7 \u540C\u6B65\u7ED3\u6784",Ve),Z("\u542F\u52A8 \xB7 \u5185\u5BB9\u8FC1\u79FB / \u6807\u8BB0\u4FEE\u590D",$R),await Sr("\u542F\u52A8 \xB7 \u5185\u5BB9\u8FC1\u79FB / \u65E7\u8BCD\u8868",pf),await Sr("\u542F\u52A8 \xB7 \u5185\u5BB9\u8FC1\u79FB / \u8BCD\u5178\u8865\u5145",HR),await Sr("\u542F\u52A8 \xB7 \u5185\u5BB9\u8FC1\u79FB / \u56FA\u5B9A\u642D\u914D",Pf),await Sr("\u542F\u52A8 \xB7 \u5185\u5BB9\u8FC1\u79FB / \u8BED\u6CD5",GR),await Sr("\u542F\u52A8 \xB7 \u5185\u5BB9\u8FC1\u79FB / JLPT \u8BCD\u5E93",VR),await Sr("\u542F\u52A8 \xB7 \u5185\u5BB9\u8FC1\u79FB / \u7EA7\u522B\u8986\u76D6",zR),await Sr("\u542F\u52A8 \xB7 \u5185\u5BB9\u8FC1\u79FB / \u632F\u5047\u540D",BR)},Pf=async()=>{if(O("jlpt_collocation_content_version","")===Io)return;let{migrateJlptCollocationContent:e}=await Promise.resolve().then(()=>(hf(),Af));await e()},HR=async()=>{let e=O("dictionary_supplement_version",""),t=E("SELECT COUNT(*) FROM dictionary_entries WHERE entry_key LIKE 'builtin:%'",[],0);if(e===Ei&&t===21)return;let r=await WR();if(r.version!==Ei)throw new Error(`\u8865\u5145\u8BCD\u5178\u7248\u672C\u4E0D\u4E00\u81F4: ${r.version} != ${Ei}`);if(r.entries.length!==21)throw new Error(`\u8865\u5145\u8BCD\u5178\u6761\u6570\u5F02\u5E38: ${r.entries.length} != 21`);let n=(0,wt.getDatabase)();n.run("BEGIN TRANSACTION");try{n.run("DELETE FROM dictionary_entries WHERE entry_key LIKE 'builtin:%'"),r.entries.forEach(o=>{n.run(`
        INSERT INTO dictionary_entries (
          entry_key, headword, kana, meaning, pos, verb_type, category,
          usage_note, example_jp, example_meaning, priority,
          source_name, source_url, license, seed_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,[o.entryKey,o.headword,o.kana,o.meaning,o.pos,o.verbType,o.category,o.usageNote,o.exampleJp,o.exampleMeaning,o.priority,r.source.name,r.source.url,r.source.license,r.version])}),R("dictionary_supplement_version",r.version),n.run("COMMIT"),je()}catch(o){throw n.run("ROLLBACK"),o}},Mo=(e,t)=>(q(),!!E("SELECT 1 FROM content_favorites WHERE item_type = ? AND item_id = ? LIMIT 1",[e,String(t)],0)),Mu=["grammar_progress","grammar_reviews","grammar_mistakes"],xu=1e6,KR={"\u8AB0\uFF0F\u3069\u306A\u305F\uFF0F\u3069\u306E\u65B9":"\u8AB0","\u3069\u3046\uFF0F\u3044\u304B\u304C":"\u3069\u3046","\u306A\u305C\uFF0F\u3069\u3046\u3057\u3066\uFF0F\u306A\u3093\u3067":"\u306A\u305C","\u304B\u306A\uFF0F\u304B\u3057\u3089":"\u304B\u306A","\uFF5E\u305F\u3061\uFF0F\u304C\u305F":"\uFF5E\u305F\u3061","\uFF5E\u3060\u308D\u3046\uFF0F\u3067\u3057\u3087\u3046":"\uFF5E\u3060\u308D\u3046","\u3042\u3052\u308B\uFF0F\u3055\u3057\u3042\u3052\u308B":"\u3042\u3052\u308B","\uFF5E\u3066\u3042\u3052\u308B\uFF0F\u3066\u3055\u3057\u3042\u3052\u308B":"\uFF5E\u3066\u3042\u3052\u308B","\u3082\u3089\u3046\uFF0F\u3044\u305F\u3060\u304F":"\u3082\u3089\u3046","\uFF5E\u3066\u3082\u3089\u3046\uFF0F\u3066\u3044\u305F\u3060\u304F":"\uFF5E\u3066\u3082\u3089\u3046","\u304F\u308C\u308B\uFF0F\u304F\u3060\u3055\u308B":"\u304F\u308C\u308B","\uFF5E\u3066\u304F\u308C\u308B\uFF0F\u3066\u304F\u3060\u3055\u308B":"\uFF5E\u3066\u304F\u308C\u308B","\uFF5E\u3046\u3061\u306F\uFF0F\u306A\u3044\u3046\u3061\u306B":"\uFF5E\u3046\u3061\u306F","\uFF5E\u3066\u3057\u304B\u305F\uFF08\u304C\uFF09\u306A\u3044\uFF0F\u3066\u3057\u3088\u3046\u304C\u306A\u3044":"\uFF5E\u3066\u3057\u304B\u305F\uFF08\u304C\uFF09\u306A\u3044","\uFF5E\u3066\u3082\u3057\u304B\u305F\uFF08\u304C\uFF09\u306A\u3044\uFF0F\u3066\u3082\u3057\u3088\u3046\u304C\u306A\u3044":"\uFF5E\u3066\u3082\u3057\u304B\u305F\uFF08\u304C\uFF09\u306A\u3044","\uFF5E\u3068\u3044\u3046\u306E\u306F\uFF0F\u3068\u306F":"\uFF5E\u3068\u3044\u3046\u306E\u306F","\uFF5E\u306A\u3093\u304B\uFF0F\u306A\u3093\u3066":"\uFF5E\u306A\u3093\u304B","\uFF5E\u3066\u3044\u3089\u3063\u3057\u3083\u308B\uFF0F\u3066\u304A\u3044\u3067\u306B\u306A\u308B":"\uFF5E\u3066\u3044\u3089\u3063\u3057\u3083\u308B","\uFF5E\u304B\u306D\u308B\uFF0F\u304B\u306D\u306A\u3044":"\uFF5E\u304B\u306D\u308B","\uFF5E\u6B21\u7B2C\uFF0F\u6B21\u7B2C\u3060\uFF0F\u6B21\u7B2C\u3067\uFF08\u306F\uFF09":"\uFF5E\u6B21\u7B2C","\uFF5E\u3060\u3051\u3042\u3063\u3066\uFF0F\u3060\u3051\u306B\uFF0F\u3060\u3051\u306E\u3053\u3068\u306F\u3042\u308B":"\uFF5E\u3060\u3051\u3042\u3063\u3066","\uFF5E\u306F\u3082\u3061\u308D\u3093\uFF0F\u306F\u3082\u3068\u3088\u308A":"\uFF5E\u306F\u3082\u3061\u308D\u3093","\uFF5E\u3068\u306F\uFF0F\u306A\u3093\u3066":"\uFF5E\u3068\u306F\uFF08N1-2\uFF09","\uFF5E\u3068\u306F\u3044\u3046\u3082\u306E\u306E\uFF0F\u3068\u306F\u8A00\u3044\u6761":"\uFF5E\u3068\u306F\u3044\u3046\u3082\u306E\u306E","\uFF5E\u306B\u305F\u3048\u308B\uFF0F\u306B\u305F\u3048\u306A\u3044":"\uFF5E\u306B\u305F\u3048\u308B","\uFF5E\u3084\uFF0F\u3084\u5426\u3084":"\uFF5E\u3084"},GR=async()=>{let e=(0,wt.getDatabase)(),t=E("SELECT value FROM grammar_state WHERE key = ?",["dataset_version"],"");if(t===pi&&E("SELECT COUNT(*) FROM grammar_points",[],0)===Mf)return;let r=await $f();if(r.version===t&&t!==pi){console.warn(`GRAMMAR_SEED_VERSION \u5E38\u91CF(${pi})\u843D\u540E\u4E8E grammar_seed.json(${r.version}),\u8BF7\u66F4\u65B0\u5E38\u91CF\u3002`);return}e.run("BEGIN TRANSACTION");try{let n=new Map;p("SELECT id, pattern FROM grammar_points").forEach(s=>{n.set(String(s.pattern??""),Number(s.id))}),n.size>0&&e.run(`
        INSERT INTO grammar_points_archive (
          dataset_version, id, pattern, meaning, prompt, formation,
          example_jp, example_meaning, notes, confusions, level,
          importance, example_furigana, example_tokens, example_lemmas, sort_order
        )
        SELECT ?, id, pattern, meaning, prompt, formation, example_jp,
          example_meaning, notes, confusions, level, importance, example_furigana, example_tokens, example_lemmas, sort_order
        FROM grammar_points
      `,[t||"legacy-before-pdf-n4"]),e.run("DELETE FROM grammar_points"),e.run("DELETE FROM sqlite_sequence WHERE name = 'grammar_points'");let o=new Map;r.rows.forEach((s,i)=>{if(o.has(s[0])){console.warn(`grammar_seed \u5B58\u5728\u91CD\u590D pattern,\u5DF2\u8DF3\u8FC7\u540E\u51FA\u73B0\u7684\u4E00\u6761: ${s[0]}`);return}e.run(`
        INSERT INTO grammar_points (
          pattern, meaning, prompt, formation, example_jp, example_meaning,
          notes, confusions, level, importance, example_furigana, example_tokens, example_lemmas, sort_order
        )
        -- \u26A0\uFE0F 14 \u4E2A\u5217\u540D\u5C31\u8981 14 \u4E2A\u5360\u4F4D\u7B26\u3002\u8FD9\u91CC\u66FE\u7ECF\u53EA\u6709 13 \u4E2A,\u800C\u79CD\u5B50\u884C\u662F 13 \u4E2A\u5B57\u6BB5
        -- \u52A0\u4E0A sort_order \u6B63\u597D 14 \u4E2A\u503C \u2014\u2014 \u5C11\u4E00\u4E2A ? \u5C31\u662F "13 values for 14 columns",
        -- \u800C\u4E14\u8FD9\u6BB5\u53EA\u5728**\u8BED\u6CD5\u79CD\u5B50\u5347\u7248\u672C**\u65F6\u624D\u8DD1,\u6240\u4EE5\u4ECE\u5199\u4E0B\u6765\u5230 2026-08-23 \u4E00\u6B21\u90FD\u6CA1\u6267\u884C\u8FC7\u3002
        -- \u771F\u5347\u4E00\u6B21\u7248\u672C\u7684\u8BDD,\u6BCF\u4E2A\u5DF2\u5B89\u88C5\u7528\u6237\u542F\u52A8\u65F6\u90FD\u4F1A\u5D29\u5728 initDatabase(\u754C\u9762\u663E\u793A
        -- \u300C\u672C\u5730\u8BCD\u5E93\u8BFB\u53D6\u5931\u8D25\u300D),\u7B49\u4E8E\u4E00\u6B21\u5185\u5BB9\u66F4\u65B0\u628A\u6240\u6709\u4EBA\u7684 App \u53D8\u7816\u3002
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,[...s,i+1]),o.set(s[0],E("SELECT last_insert_rowid()",[],0))}),Mu.forEach(s=>{e.run(`UPDATE ${s} SET grammar_id = grammar_id + ${xu}`)}),n.forEach((s,i)=>{let a=o.get(KR[i]??i);a&&Mu.forEach(d=>{e.run(`UPDATE ${d} SET grammar_id = ? WHERE grammar_id = ?`,[a,s+xu])})}),Mu.forEach(s=>{e.run(`DELETE FROM ${s} WHERE grammar_id >= ${xu}`)}),e.run("INSERT OR REPLACE INTO grammar_state (key, value) VALUES (?, ?)",["queue","[]"]),e.run("DELETE FROM grammar_state WHERE key LIKE 'quiz_undo:%'"),R("review_queue_grammar","[]"),e.run("INSERT OR REPLACE INTO grammar_state (key, value) VALUES (?, ?)",["dataset_version",r.version]),e.run("COMMIT")}catch(n){throw e.run("ROLLBACK"),n}je()},BR=async()=>{if(O("furigana_version","")===fi)return;let e=await $f(),t=(0,wt.getDatabase)();t.run("BEGIN TRANSACTION");try{e.rows.forEach(r=>{let[n,,,,o,,,,,,s,i,a]=r;t.run(`
        UPDATE grammar_points
        SET example_furigana = ?, example_tokens = ?, example_lemmas = ?
        WHERE pattern = ?
          AND example_jp = ?
      `,[s??"",i??"",a??"",n,o])}),R("furigana_version",fi),t.run("COMMIT")}catch(r){throw t.run("ROLLBACK"),r}je()},XR=[["\u904B\u52D5","\u3046\u3093\u3069\u3046"],["\u8A08\u753B","\u3051\u3044\u304B\u304F"],["\u7814\u7A76","\u3051\u3093\u304D\u3085\u3046"],["\u6545\u969C","\u3053\u3057\u3087\u3046"],["\u6388\u696D","\u3058\u3085\u304E\u3087\u3046"],["\u751F\u6D3B","\u305B\u3044\u304B\u3064"],["\u9078\u629E","\u305B\u3093\u305F\u304F"],["\u5352\u696D","\u305D\u3064\u304E\u3087\u3046"],["\u7559\u5B66","\u308A\u3085\u3046\u304C\u304F"],["\u65C5\u884C","\u308A\u3087\u3053\u3046"],["\u7DF4\u7FD2","\u308C\u3093\u3057\u3085\u3046"],["\u9023\u7D61","\u308C\u3093\u3089\u304F"],["\u9045\u523B","\u3061\u3053\u304F"],["\u51FA\u767A","\u3057\u3085\u3063\u3071\u3064"],["\u5230\u7740","\u3068\u3046\u3061\u3083\u304F"],["\u898B\u5B66","\u3051\u3093\u304C\u304F"],["\u5FA9\u7FD2","\u3075\u304F\u3057\u3085\u3046"],["\u4E88\u7FD2","\u3088\u3057\u3085\u3046"],["\u4E88\u7D04","\u3088\u3084\u304F"],["\u7FFB\u8A33","\u307B\u3093\u3084\u304F"],["\u4FE1\u53F7","\u3057\u3093\u3054\u3046"],["\u6D17\u6FEF","\u305B\u3093\u305F\u304F"],["\u52C9\u5F37","\u3079\u3093\u304D\u3087\u3046"],["\u6D3B\u52D5","\u304B\u3064\u3069\u3046"],["\u5E30\u56FD","\u304D\u3053\u304F"],["\u6328\u62F6","\u3042\u3044\u3055\u3064"],["\u55B6\u696D","\u3048\u3044\u304E\u3087\u3046"],["\u5E0C\u671B","\u304D\u307C\u3046"],["\u6210\u529F","\u305B\u3044\u3053\u3046"],["\u5165\u5B66","\u306B\u3085\u3046\u304C\u304F"],["\u7D04\u675F","\u3084\u304F\u305D\u304F"],["\u5229\u7528","\u308A\u3088\u3046"],["\u6025\u884C","\u304D\u3085\u3046\u3053\u3046"],["\u5354\u529B","\u304D\u3087\u3046\u308A\u3087\u304F"],["\u6559\u80B2","\u304D\u3087\u3046\u3044\u304F"],["\u7DCA\u5F35","\u304D\u3093\u3061\u3087\u3046"],["\u884C\u52D5","\u3053\u3046\u3069\u3046"],["\u4FE1\u7528","\u3057\u3093\u3088\u3046"],["\u52AA\u529B","\u3069\u308A\u3087\u304F"],["\u8F38\u51FA","\u3086\u3057\u3085\u3064"],["\u8F38\u5165","\u3086\u306B\u3085\u3046"],["\u51B7\u8535","\u308C\u3044\u305E\u3046"],["\u671D\u5BDD\u574A","\u3042\u3055\u306D\u307C\u3046"],["\u8A95\u751F","\u305F\u3093\u3058\u3087\u3046"],["\u98F2\u98DF","\u3044\u3093\u3057\u3087\u304F"],["\u51FA\u5F35","\u3057\u3085\u3063\u3061\u3087\u3046"],["\u3054\u3061\u305D\u3046","\u3054\u3061\u305D\u3046"],["\u5F71\u97FF","\u3048\u3044\u304D\u3087\u3046"],["\u9060\u8DB3","\u3048\u3093\u305D\u304F"],["\u5B66\u7FD2","\u304C\u304F\u3057\u3085\u3046"],["\u89B3\u5149","\u304B\u3093\u3053\u3046"],["\u7AF6\u4E89","\u304D\u3087\u3046\u305D\u3046"],["\u898B\u7269","\u3051\u3093\u3076\u3064"],["\u5408\u683C","\u3054\u3046\u304B\u304F"],["\u96C6\u5408","\u3057\u3085\u3046\u3054\u3046"],["\u4F53\u64CD","\u305F\u3044\u305D\u3046"],["\u6696\u623F","\u3060\u3093\u307C\u3046"],["\u5831\u544A","\u307B\u3046\u3053\u304F"],["\u653E\u9001","\u307B\u3046\u305D\u3046"],["\u63D0\u51FA","\u3066\u3044\u3057\u3085\u3064"],["\u8EE2\u8077","\u3066\u3093\u3057\u3087\u304F"],["\u512A\u52DD","\u3086\u3046\u3057\u3087\u3046"],["\u5916\u51FA","\u304C\u3044\u3057\u3085\u3064"],["\u7814\u4FEE","\u3051\u3093\u3057\u3085\u3046"],["\u5E83\u544A","\u3053\u3046\u3053\u304F"],["\u6B8B\u696D","\u3056\u3093\u304E\u3087\u3046"],["\u5C31\u8077","\u3057\u3085\u3046\u3057\u3087\u304F"],["\u5F6B\u523B","\u3061\u3087\u3046\u3053\u304F"],["\u6D41\u884C","\u308A\u3085\u3046\u3053\u3046"],["\u62C5\u5F53","\u305F\u3093\u3068\u3046"],["\u4F01\u753B","\u304D\u304B\u304F"],["\u6CE5\u68D2","\u3069\u308D\u307C\u3046"],["\u770B\u75C5","\u304B\u3093\u3073\u3087\u3046"]],Hf=(e,t=[],r=[])=>{let n=(0,wt.getDatabase)(),o=new Set,s=new Map(t.map(({kanji:i,kana:a,meaning:d})=>[`${i}\0${a}`,d]));e.forEach(([,i,a,d,u,l,c,f,m,g,S,w])=>{let y=`${a}\0${i}`;o.has(y)||(o.add(y),n.run(`
      UPDATE words
      SET meaning = COALESCE(?, meaning),
          pos = ?,
          verb_type = ?,
          importance = MAX(importance, ?),
          example_jp = ?,
          example_meaning = ?,
          example_furigana = COALESCE(NULLIF(?, ''), example_furigana),
          example_tokens = COALESCE(NULLIF(?, ''), example_tokens),
          example_lemmas = COALESCE(NULLIF(?, ''), example_lemmas),
          jlpt_level = COALESCE(jlpt_level, ?)
      WHERE kanji = ? AND kana = ?
    `,[s.get(y)??null,d,u,l,c,f,g??"",S??"",w??"",m,a,i]))}),s.forEach((i,a)=>{let d=a.indexOf("\0"),u=a.slice(0,d),l=a.slice(d+1);n.run("UPDATE words SET meaning = ? WHERE kanji = ? AND kana = ?",[i,u,l])}),r.forEach(({kanji:i,kana:a,exampleJp:d,exampleMeaning:u,exampleFurigana:l,exampleTokens:c,exampleLemmas:f})=>{let m=typeof l=="string"?l:JSON.stringify(l??[]);n.run(`
      UPDATE words
      SET example_jp = ?, example_meaning = ?,
          example_furigana = COALESCE(NULLIF(?, ''), example_furigana),
          example_tokens = COALESCE(NULLIF(?, ''), example_tokens),
          example_lemmas = COALESCE(NULLIF(?, ''), example_lemmas)
      WHERE kanji = ? AND kana = ?
        AND (example_jp IS NULL OR example_jp = '')
    `,[d,u,m,typeof c=="string"?c:"",typeof f=="string"?f:"",i,a])}),n.run(`
    UPDATE words
    SET pos = '\u540D\u8BCD',
        verb_type = NULL
    WHERE pos = '\u540D\u8BCD\u30FB\u3059\u308B\u52A8\u8BCD'
      AND (
        (kanji = '\u6226\u4E89' AND kana = '\u305B\u3093\u305D\u3046') OR
        (kanji = '\u30C1\u30A7\u30C3\u30AF' AND kana = '\u30C1\u30A7\u30C3\u30AF') OR
        (kanji = '\u30B3\u30D4\u30FC' AND kana = '\u30B3\u30D4\u30FC')
      )
  `),XR.forEach(([i,a])=>{n.run(`
      UPDATE words
      SET pos = '\u540D\u8BCD\u30FB\u3059\u308B\u52A8\u8BCD',
          verb_type = 'suru'
      WHERE kanji = ?
        AND kana = ?
        AND pos = '\u52A8\u8BCD'
        AND verb_type = 'godan'
    `,[i,a])}),R("jlpt_word_metadata_version",If)},Cf="2026-07-31-katakana-readings",YR=async()=>{if(O("kana_reading_fix_version","")===Cf)return;let t=(await Promise.resolve().then(()=>N(Zt(),1))).default.fixes??[],r=(0,wt.getDatabase)();r.run("BEGIN TRANSACTION");try{t.forEach(([n,o,s])=>{n&&o&&s&&r.run("UPDATE words SET kana = ? WHERE kanji = ? AND kana = ?",[s,n,o])}),R("kana_reading_fix_version",Cf),r.run("COMMIT"),je()}catch(n){throw r.run("ROLLBACK"),n}},Df=async()=>{if(O("jlpt_word_metadata_version","")===If)return;let e=await xf(),t=await Wf(),r=await jf(),n=await Uf(),o=(0,wt.getDatabase)();o.run("BEGIN TRANSACTION");try{Hf(e,t,r),Ff(n),o.run("COMMIT")}catch(s){throw o.run("ROLLBACK"),s}je()},zR=async()=>{if(O("jlpt_level_override_version","")===mi)return;let e=await FR();if(e.version!==mi)throw new Error(`JLPT \u8BCD\u7EA7\u522B\u8986\u76D6\u7248\u672C\u4E0D\u4E00\u81F4: ${e.version} != ${mi}`);if(e.rows.length!==320)throw new Error(`JLPT \u8BCD\u7EA7\u522B\u8986\u76D6\u6761\u6570\u5F02\u5E38: ${e.rows.length} != 320`);let t=(0,wt.getDatabase)();t.run("BEGIN TRANSACTION");try{e.rows.forEach(({kanji:r,kana:n,jlptLevel:o})=>{t.run(`
        UPDATE words
        SET jlpt_level = ?
        WHERE kanji = ?
          AND kana = ?
          AND (jlpt_level IS NULL OR jlpt_level NOT IN ('N1', 'N2', 'N3', 'N4', 'N5'))
      `,[o,r,n])}),R("jlpt_level_override_version",mi),t.run("COMMIT")}catch(r){throw t.run("ROLLBACK"),r}je()},VR=async()=>{if(await YR(),O("jlpt_seed_version","")===Du){await Df();return}let e=E("SELECT COUNT(*) FROM words",[],0),t=E("SELECT COUNT(*) FROM words WHERE jlpt_level IN ('N5', 'N4', 'N3', 'N2', 'N1')",[],0)>=1e4;if(e>=1e4&&t){await Df(),R("jlpt_seed_version",Du),je();return}let r=await xf(),n=await Wf(),o=await jf(),s=await Uf(),i=(0,wt.getDatabase)(),a=new Map;p("SELECT id, kanji, kana FROM words").forEach(d=>{a.set(`${String(d.kanji??"")}\0${String(d.kana??"")}`,Number(d.id))}),i.run("BEGIN TRANSACTION");try{r.forEach(([d,u,l,c,f,m,g,S,w,y,_,b])=>{let k=`${l}\0${u}`,v=a.get(k);if(v){i.run(`
          UPDATE words
          SET jlpt_level = COALESCE(jlpt_level, ?),
              importance = MAX(importance, ?)
          WHERE id = ?
        `,[w,m,v]);return}i.run(`
        INSERT INTO words (
          meaning, kana, kanji, pos, verb_type, importance,
          shuffle_rank, example_jp, example_meaning, example_furigana, example_tokens, example_lemmas, jlpt_level
        )
        VALUES (?, ?, ?, ?, ?, ?, ABS(RANDOM()) / 9223372036854775807.0, ?, ?, ?, ?, ?, ?)
      `,[d,u,l,c,f,m,g,S,y??"",_??"",b??"",w]);let L=E("SELECT last_insert_rowid()",[],0);a.set(k,L)}),i.run("INSERT OR IGNORE INTO progress (word_id) SELECT id FROM words"),Hf(r,n,o),Ff(s),R("jlpt_seed_version",Du),i.run("COMMIT")}catch(d){throw i.run("ROLLBACK"),d}je()},JR=(e,t)=>e+Math.floor(Math.random()*(t-e+1)),qR={forgot:-10,fuzzy:-2,know:10,known_forever:10},QR={forgot:"\u5FD8\u8BB0",fuzzy:"\u6A21\u7CCA",know:"\u8BA4\u8BC6",known_forever:"\u719F\u77E5"}});var $u={};x($u,{ensureGrammarProgressInitialized:()=>Ce,getGrammarPointFavorite:()=>ju,getGrammarQueue:()=>tb,setGrammarQueue:()=>rb});function Ce(){$r("grammar-progress",()=>{q(),qt(()=>{(0,Wu.getDatabase)().run(`
        INSERT OR IGNORE INTO grammar_progress (grammar_id)
        SELECT id FROM grammar_points
      `)})})}function ju(e){return Mo("grammar",e)}var Wu,ZR,eb,tb,rb,yr=h(()=>{"use strict";Wu=N($(),1);P();at();G();ZR=(e,t)=>E("SELECT value FROM grammar_state WHERE key = ?",[e],t),eb=(e,t)=>{(0,Wu.getDatabase)().run("INSERT OR REPLACE INTO grammar_state (key, value) VALUES (?, ?)",[e,t])},tb=()=>{try{let e=JSON.parse(ZR("queue","[]"));return Array.isArray(e)?e.flatMap(t=>{let r=Number(t?.grammar_id);return Number.isFinite(r)?[{grammar_id:r,due_after:Math.max(Number(t?.due_after??0),0)}]:[]}):[]}catch{return[]}},rb=e=>{eb("queue",JSON.stringify(e))}});var Kf,nb,Gf,Kr,Bf,gi,we,Tt=h(()=>{"use strict";P();_t();pe();Kf=(e,t)=>{let r=F.indexOf(e);return r<0?0:r+(t===0?0:1)},nb=(e,t,r)=>{let n=Kf(e,t),o=F.indexOf(r);return F.map((s,i)=>i<n?0:i<=o?i-n:100+i)},Gf=()=>{try{let e=JSON.parse(O("level_prior_applied","")||"null");if(e&&typeof e.level=="string")return{level:e.level,familiarity:e.familiarity??{}}}catch{}return{level:"",familiarity:{}}},Kr=e=>{let t=Gf(),r=e==="words"||e==="grammar"?Nn(e):X().jlptTarget,n=nb(t.level,t.familiarity[e],r);if(e==="words"||e==="grammar"){let o=F.indexOf(ko()[e].backfill);o>=0&&(n[o]=-1)}return n},Bf=e=>{let t=Gf();return Kf(t.level,t.familiarity[e])},gi=(e,t)=>{let r=Kr(t);return`CASE ${e} ${F.map((n,o)=>`WHEN '${n}' THEN ${r[o]}`).join(" ")} ELSE 0 END`},we=(e,t)=>E("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'level_prior_baselines'",[],0)>0?`EXISTS (SELECT 1 FROM level_prior_baselines lpb WHERE lpb.entity = '${e}' AND lpb.entity_key = CAST(${t} AS TEXT))`:"0"});var Xf,Yf,zf,Vf,Jf,Pu,er,qf,Qf,Hu,Nr,ce,tr,Zf,ob,xo,Gr,Uo,_i,De,te,Dt,wi,An,Rr,Te=h(()=>{"use strict";Xf=N($(),1);P();Tt();Yf=5,zf=1,Vf=8,Jf=10,Pu={words:{table:"progress",idColumn:"word_id",reviews:"reviews"},grammar:{table:"grammar_progress",idColumn:"grammar_id",reviews:"grammar_reviews"},kanji:{table:"kanji_char_memory",idColumn:"char",reviews:"kanji_char_reviews"},confusion:{table:"confusion_progress",idColumn:"group_key",reviews:"confusion_reviews"}},er=Pu,qf=e=>`prior_pace:${e}`,Qf=e=>`'${e.replace(/'/gu,"''")}'`,Hu=(e,t)=>`${e} IN (${t.map(Qf).join(",")||"NULL"})`,Nr=e=>e==="reverse_memory"||e==="kanji_reading_memory"?"words":Object.keys(er).find(t=>er[t].table===e)??null,ce=(e,t)=>{let r=we(e,t);if(r==="0")return"0";let n=er[e];return`(${r} AND NOT EXISTS (SELECT 1 FROM ${n.reviews} prior_review WHERE prior_review.${n.idColumn} = ${t}))`},tr=e=>we(e,"NULL")!=="0"&&E("SELECT 1 FROM level_prior_baselines WHERE entity = ? LIMIT 1",[e],0)>0,Zf=e=>{try{let t=JSON.parse(O(qf(e),"")||"null");if(t&&Number.isInteger(t.quota)&&t.quota>=zf&&t.quota<=Vf&&Array.isArray(t.window)&&t.window.length<Jf&&t.window.every(r=>["know","fuzzy","forgot","known_forever"].includes(String(r))))return{quota:t.quota,window:t.window}}catch{}return{quota:Yf,window:[]}},ob=(e,t)=>{let r=[...e.window,t];if(r.length<Jf)return{quota:e.quota,window:r};let n=r.filter(s=>s==="know").length/r.length,o=n>=.9?-1:n<.7?1:0;return{quota:Math.max(zf,Math.min(Vf,e.quota+o)),window:[]}},xo=(e,t=T(),r="1")=>{if(!tr(e))return 0;let{reviews:n,idColumn:o,table:s}=er[e];return E(`SELECT COUNT(DISTINCT r.${o}) FROM ${n} r
    WHERE r.reviewed_on = ? AND ${we(e,`r.${o}`)}
      AND r.${o} IN (SELECT ${o} FROM ${s} WHERE ${r})
      AND NOT EXISTS (SELECT 1 FROM ${n} earlier WHERE earlier.${o} = r.${o} AND earlier.reviewed_on < ?)
  `,[t,t],0)},Gr=(e,t,r=T())=>{if(!tr(e))return"0";let{reviews:n,idColumn:o}=er[e];return`(${we(e,t)} AND NOT EXISTS (SELECT 1 FROM ${n} earlier
    WHERE earlier.${o} = ${t} AND earlier.reviewed_on < ${Qf(r)}))`},Uo=(e,t=A(),r=T(),n="1")=>{if(!tr(e))return[];let o=Math.max(0,Zf(e).quota-xo(e,r));if(!o)return[];let{table:s,idColumn:i}=er[e];return p(`SELECT ${i} AS k FROM ${s}
    WHERE known_forever = 0 AND seen_count > 0 AND fsrs_due <= ? AND (${n})
      AND ${ce(e,`${s}.${i}`)}
    ORDER BY fsrs_due ASC, ${i} ASC LIMIT ?
  `,[t.toISOString(),o]).map(a=>String(a.k))},_i=(e,t,r="1")=>{if(!t.length||!tr(e))return t.map(()=>0);let{table:n,idColumn:o}=er[e],s=p(`SELECT fsrs_due FROM ${n} WHERE known_forever = 0 AND seen_count > 0
    AND fsrs_due <= ? AND (${r}) AND ${ce(e,`${n}.${o}`)} ORDER BY fsrs_due`,[t[t.length-1].toISOString()]).map(d=>String(d.fsrs_due)),i=Zf(e).quota,a=0;return t.map((d,u)=>{let l=a,c=u===0?Math.max(0,i-xo(e,T(new Date(d.getTime()-1)))):i;for(;a-l<c&&a<s.length&&s[a]<=d.toISOString();)a+=1;return a-l})},De=(e,t=A(),r=T())=>{let n=Nr(e.table);if(!n)return[];let o=Uo(n,t,r,e.table===er[n].table?e.eligible:"1");return o.length?p(`SELECT ${e.idColumn} AS k FROM ${e.table}
    WHERE (${e.eligible}) AND (fsrs_due IS NULL OR fsrs_due <= ?) AND ${Hu(e.idColumn,o)}
    ORDER BY fsrs_due ASC, ${e.idColumn} ASC
  `,[t.toISOString()]).map(s=>String(s.k)):[]},te=(e,t,r=A(),n=T(),o="1")=>tr(e)?`(NOT ${ce(e,t)} OR ${Hu(t,Uo(e,r,n,o))})`:"1",Dt=(e,t,r=T(),n=A(),o)=>{let s=Nr(e.table);if(!s||!tr(s))return;let i=e.idColumn,a=De(e,n,r),d=(0,Xf.getDatabase)();if(d.run(`DELETE FROM ${t} WHERE reviewed_on = ? AND ${ce(s,`${t}.${i}`)} AND NOT ${Hu(i,a)}`,[r]),!a.length)return;let u=E(`SELECT COALESCE(MAX(order_index), 0) FROM ${t} WHERE reviewed_on = ?`,[r],0);a.forEach((l,c)=>d.run(`INSERT OR IGNORE INTO ${t} (reviewed_on, ${i}, order_index${o?", task_type":""})
    VALUES (?, ?, ?${o?", ?":""})`,[r,l,u+c+1,...o?[o]:[]]))},wi=e=>{if(!tr(e))return;let{reviews:t,idColumn:r}=er[e],n=e==="grammar"?"created_at":"COALESCE(reviewed_at, strftime('%s', created_at) * 1000)",s=p(`SELECT r.answer FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY ${r} ORDER BY reviewed_on, ${n}, sync_uid, id) AS first_answer
    FROM ${t}
  ) r WHERE r.first_answer = 1 AND ${we(e,`r.${r}`)}
  ORDER BY r.reviewed_on, ${n}, r.sync_uid, r.id`).reduce((i,a)=>ob(i,String(a.answer)),{quota:Yf,window:[]});R(qf(e),JSON.stringify(s))},An=(e,t,r)=>{let n=tr(e)&&E(`SELECT ${ce(e,"?")}`,[t,t],0)>0,o=r();return n&&wi(e),o},Rr=(e,t)=>{tr(e)&&E(`SELECT ${we(e,"?")}`,[t],0)&&wi(e)}});var Gu={};x(Gu,{parseFurigana:()=>Fo,parseTokenBoundaries:()=>Ku,tokenBoundaryAtOffset:()=>ab});var eg,tg,Fo,sb,ib,Ku,ab,Ti=h(()=>{"use strict";eg=e=>{if(!e||typeof e!="object")return!1;let t=e;return Number.isInteger(t.start)&&Number.isInteger(t.length)&&Number(t.start)>=0&&Number(t.length)>0&&typeof t.reading=="string"&&t.reading.length>0},tg=e=>{if(Array.isArray(e)&&e.length>=3){let[t,r,n]=e;return eg({start:t,length:r,reading:n})?{start:t,length:r,reading:n}:null}return eg(e)?e:null},Fo=e=>{if(Array.isArray(e)){let t=e.map(tg).filter(r=>!!r);return t.length?t:void 0}if(!(typeof e!="string"||!e.trim()))try{let t=JSON.parse(e);if(!Array.isArray(t))return;let r=t.map(tg).filter(n=>!!n);return r.length?r:void 0}catch{return}},sb=e=>{if(!e||typeof e!="object")return null;let t=e;return typeof t.surface!="string"||!t.surface||typeof t.lemma!="string"||!t.lemma||typeof t.pos!="string"||typeof t.detail!="string"?null:{surface:t.surface,lemma:t.lemma,...t.reading?{reading:t.reading}:{},pos:t.pos,detail:t.detail,...t.conjugatedType?{conjugatedType:t.conjugatedType}:{},...t.conjugatedForm?{conjugatedForm:t.conjugatedForm}:{}}},ib=e=>{if(!e)return{};let t=e;if(typeof e=="string")try{t=JSON.parse(e)}catch{return{}}return!t||typeof t!="object"||Array.isArray(t)?{}:Object.fromEntries(Object.entries(t).flatMap(([r,n])=>{if(!/^\d+$/u.test(r))return[];if(typeof n=="string"&&n.trim())return[[r,{lemma:n.trim()}]];if(!n||typeof n!="object"||Array.isArray(n))return[];let o=n.lemma;if(typeof o!="string"||!o.trim())return[];let s=Array.isArray(n.morphs)?n.morphs.map(sb).filter(i=>!!i):[];return[[r,{lemma:o.trim(),...s.length?{morphs:s}:{}}]]}))},Ku=(e,t,r)=>{if(typeof e!="string"||!e.trim())return;let n=e.split(",").map(a=>Number(a));if(!n.length||n.some(a=>!Number.isInteger(a)||a===0)||n.reduce((a,d)=>a+Math.abs(d),0)!==t.length)return;let s=ib(r),i=0;return n.map((a,d)=>{let u=Math.abs(a),l=i;i+=u;let c=s[String(d)];return{start:l,end:i,text:t.slice(l,i),clickable:a>0,...c?{lemma:c.lemma,...c.morphs?{morphs:c.morphs}:{}}:{}}})},ab=(e,t)=>e?.find(({start:r,end:n})=>t>=r&&t<n)});var ng,rg=h(()=>{ng={source:"JMdict \xA9 EDRDG, CC BY-SA 4.0",sourceUrl:"http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz",generatedBy:"frontend/scripts/audit-kanji-orthography.mjs",manualReview:"frontend/scripts/kanji-orthography-manual-review.json",entries:{"\u7121\u304F\u3059|\u306A\u304F\u3059":{band:"kana",score:15,preferredSurface:"\u306A\u304F\u3059"},"\u7121\u304F\u306A\u308B|\u306A\u304F\u306A\u308B":{band:"kana",score:15,preferredSurface:"\u306A\u304F\u306A\u308B"},"\u7E4B\u304C\u308B|\u3064\u306A\u304C\u308B":{band:"low",score:24,preferredSurface:"\u3064\u306A\u304C\u308B"},"\u305F\u3060\u4ECA|\u305F\u3060\u3044\u307E":{band:"kana",score:0,preferredSurface:"\u305F\u3060\u3044\u307E"},"\u639B\u304B\u308B|\u304B\u304B\u308B":{band:"kana",score:15,preferredSurface:"\u304B\u304B\u308B"},"\u639B\u3051\u308B|\u304B\u3051\u308B":{band:"kana",score:15,preferredSurface:"\u304B\u3051\u308B"},"\u5E73\u4EEE\u540D|\u3072\u3089\u304C\u306A":{band:"kana",score:15,preferredSurface:"\u3072\u3089\u304C\u306A"},"\u7247\u4EEE\u540D|\u304B\u305F\u304B\u306A":{band:"kana",score:8,preferredSurface:"\u30AB\u30BF\u30AB\u30CA"},"\u8449\u66F8|\u306F\u304C\u304D":{band:"low",score:24,preferredSurface:"\u306F\u304C\u304D"},"\u9802\u304F|\u3044\u305F\u3060\u304F":{band:"kana",score:15,preferredSurface:"\u3044\u305F\u3060\u304F"},"\u4F55\u3067|\u306A\u3093\u3067":{band:"kana",score:15,preferredSurface:"\u306A\u3093\u3067"},"\u4E0B\u3055\u3044|\u304F\u3060\u3055\u3044":{band:"kana",score:15,preferredSurface:"\u304F\u3060\u3055\u3044"},"\u521D\u3081\u307E\u3057\u3066|\u306F\u3058\u3081\u307E\u3057\u3066":{band:"kana",score:15,preferredSurface:"\u306F\u3058\u3081\u307E\u3057\u3066"},"\u301C\u9054|\u301C\u305F\u3061":{band:"kana",score:15,preferredSurface:"\u301C\u305F\u3061"},"\u4E8B|\u3053\u3068":{band:"kana",score:15,preferredSurface:"\u3053\u3068"},"\u5168\u3066|\u3059\u3079\u3066":{band:"low",score:24,preferredSurface:"\u3059\u3079\u3066"},"\u5927\u4EBA\u3057\u3044|\u304A\u3068\u306A\u3057\u3044":{band:"kana",score:15,preferredSurface:"\u304A\u3068\u306A\u3057\u3044"},"\u5927\u4F53|\u3060\u3044\u305F\u3044":{band:"low",score:24,preferredSurface:"\u3060\u3044\u305F\u3044"},"\u5168\u304F|\u307E\u3063\u305F\u304F":{band:"low",score:34,preferredSurface:"\u307E\u3063\u305F\u304F"},"\u5699[\u304B]\u3080|\u304B\u3080":{band:"alternate",score:0,preferredSurface:"\u565B\u3080"},"\u968F\u5206|\u305A\u3044\u3076\u3093":{band:"kana",score:15,preferredSurface:"\u305A\u3044\u3076\u3093"},"\u81F4\u3059|\u3044\u305F\u3059":{band:"kana",score:15,preferredSurface:"\u3044\u305F\u3059"},"\u7136\u3057|\u3057\u304B\u3057":{band:"kana",score:0,preferredSurface:"\u3057\u304B\u3057"},"\u5438\u6BBB|\u3059\u3044\u304C\u3089":{band:"alternate",score:34,preferredSurface:"\u5438\u3044\u6BBB"},"\u5074|\u305D\u3070":{band:"kana",score:15,preferredSurface:"\u305D\u3070"},"\u4F46\u3057|\u305F\u3060\u3057":{band:"kana",score:15,preferredSurface:"\u305F\u3060\u3057"},"\u4F55\u65B9|\u3069\u306A\u305F":{band:"kana",score:15,preferredSurface:"\u3069\u306A\u305F"},"\u7247\u3065\u3051\u308B|\u304B\u305F\u3065\u3051\u308B":{band:"alternate",score:34,preferredSurface:"\u7247\u4ED8\u3051\u308B"},"\u6B86\u3069|\u307B\u3068\u3093\u3069":{band:"kana",score:15,preferredSurface:"\u307B\u3068\u3093\u3069"},"\u52FF\u4F53\u306A\u3044|\u3082\u3063\u305F\u3044\u306A\u3044":{band:"kana",score:15,preferredSurface:"\u3082\u3063\u305F\u3044\u306A\u3044"},"\u8CB0\u3046|\u3082\u3089\u3046":{band:"low",score:24,preferredSurface:"\u3082\u3089\u3046"},"\u5411\u65E5\u8475|\u3072\u307E\u308F\u308A":{band:"kana",score:8,preferredSurface:"\u3072\u307E\u308F\u308A"},"\u4E0D\u5473\u3044|\u307E\u305A\u3044":{band:"kana",score:15,preferredSurface:"\u307E\u305A\u3044"},"\u78BA\u308A|\u3057\u3063\u304B\u308A":{band:"kana",score:0,preferredSurface:"\u3057\u3063\u304B\u308A"},"\u66F4\u306B|\u3055\u3089\u306B":{band:"kana",score:15,preferredSurface:"\u3055\u3089\u306B"},"\u66AB\u304F|\u3057\u3070\u3089\u304F":{band:"kana",score:15,preferredSurface:"\u3057\u3070\u3089\u304F"},"\u4ED5\u821E\u3046|\u3057\u307E\u3046":{band:"kana",score:0,preferredSurface:"\u3057\u307E\u3046"},"\u65E8\u304F|\u3046\u307E\u304F":{band:"kana",score:8,preferredSurface:"\u3046\u307E\u304F"},"\u51FA\u6765\u308B|\u3067\u304D\u308B":{band:"kana",score:15,preferredSurface:"\u3067\u304D\u308B"},"\u51FA\u6765\u308B\u3060\u3051|\u3067\u304D\u308B\u3060\u3051":{band:"kana",score:15,preferredSurface:"\u3067\u304D\u308B\u3060\u3051"},"\u5148\u305A|\u307E\u305A":{band:"kana",score:15,preferredSurface:"\u307E\u305A"},"\u5927\u5206|\u3060\u3044\u3076":{band:"kana",score:15,preferredSurface:"\u3060\u3044\u3076"},"\u4E01\u5EA6|\u3061\u3087\u3046\u3069":{band:"kana",score:15,preferredSurface:"\u3061\u3087\u3046\u3069"},"\u76F4\u3050|\u3059\u3050":{band:"kana",score:15,preferredSurface:"\u3059\u3050"},"\u76F4\u3050\u306B|\u3059\u3050\u306B":{band:"kana",score:15,preferredSurface:"\u3059\u3050\u306B"},"\u304A\u6C41\u7C89|\u304A\u3057\u308B\u3053":{band:"kana",score:8,preferredSurface:"\u304A\u3057\u308B\u3053"},"\u5982\u4F55|\u3044\u304B\u304C":{band:"kana",score:15,preferredSurface:"\u3044\u304B\u304C"},"\u304A\u7956\u6BCD\u3055\u3093|\u304A\u3070\u3042\u3055\u3093":{band:"kana",score:15,preferredSurface:"\u304A\u3070\u3042\u3055\u3093"},"\u53C8|\u307E\u305F":{band:"kana",score:15,preferredSurface:"\u307E\u305F"},"\u304A\u723A\u3055\u3093|\u304A\u3058\u3044\u3055\u3093":{band:"kana",score:0,preferredSurface:"\u304A\u3058\u3044\u3055\u3093"},"\u77E2\u3063\u5F35\u308A|\u3084\u3063\u3071\u308A":{band:"kana",score:0,preferredSurface:"\u3084\u3063\u3071\u308A"},"\u77E2\u5F35\u308A|\u3084\u306F\u308A":{band:"kana",score:0,preferredSurface:"\u3084\u306F\u308A"},"\u4F59\u308A|\u3042\u307E\u308A":{band:"kana",score:15,preferredSurface:"\u3042\u307E\u308A"},"\u826F\u304F|\u3088\u304F":{band:"kana",score:15,preferredSurface:"\u3088\u304F"},"\u7686|\u307F\u3093\u306A":{band:"low",score:24,preferredSurface:"\u307F\u3093\u306A"},"\u9054|\u305F\u3061":{band:"kana",score:15,preferredSurface:"\u305F\u3061"},"\u99C4\u76EE|\u3060\u3081":{band:"low",score:34,preferredSurface:"\u3060\u3081"},"\u65AF\u3046|\u3053\u3046":{band:"kana",score:0,preferredSurface:"\u3053\u3046"},"\u672A\u3060|\u307E\u3060":{band:"kana",score:15,preferredSurface:"\u307E\u3060"},"\u305D\u3046\u8A00\u3048\u3070|\u305D\u3046\u3044\u3048\u3070":{band:"kana",score:15,preferredSurface:"\u305D\u3046\u3044\u3048\u3070"},"\u6BB5\u6BB5|\u3060\u3093\u3060\u3093":{band:"kana",score:15,preferredSurface:"\u3060\u3093\u3060\u3093"},"\u4F55\u6642|\u3044\u3064":{band:"kana",score:0,preferredSurface:"\u3044\u3064"},"\u4F55\u6642\u3082|\u3044\u3064\u3082":{band:"kana",score:15,preferredSurface:"\u3044\u3064\u3082"},"\u4F55\u51E6|\u3069\u3053":{band:"kana",score:15,preferredSurface:"\u3069\u3053"},"\u4F55\u65B9|\u3069\u3061\u3089":{band:"kana",score:0,preferredSurface:"\u3069\u3061\u3089"},"\u53EF\u7B11\u3057\u3044|\u304A\u304B\u3057\u3044":{band:"kana",score:8,preferredSurface:"\u304A\u304B\u3057\u3044"},"\u5982\u4F55|\u3069\u3046":{band:"kana",score:0,preferredSurface:"\u3069\u3046"},"\u6210\u308B|\u306A\u308B":{band:"kana",score:15,preferredSurface:"\u306A\u308B"},"\u5E7E\u3089|\u3044\u304F\u3089":{band:"kana",score:15,preferredSurface:"\u3044\u304F\u3089"},"\u8CB4\u65B9|\u3042\u306A\u305F":{band:"kana",score:15,preferredSurface:"\u3042\u306A\u305F"},"\u8A70\u307E\u3089\u306A\u3044|\u3064\u307E\u3089\u306A\u3044":{band:"kana",score:0,preferredSurface:"\u3064\u307E\u3089\u306A\u3044"},"\u5076\u306B|\u305F\u307E\u306B":{band:"kana",score:8,preferredSurface:"\u305F\u307E\u306B"},"\u5FA1\u514D|\u3054\u3081\u3093":{band:"kana",score:15,preferredSurface:"\u3054\u3081\u3093"},"\u82E5\u3057|\u3082\u3057":{band:"kana",score:0,preferredSurface:"\u3082\u3057"},"\u884C\u3063\u3066\u3089\u3063\u3057\u3083\u3044|\u3044\u3063\u3066\u3089\u3063\u3057\u3083\u3044":{band:"kana",score:15,preferredSurface:"\u3044\u3063\u3066\u3089\u3063\u3057\u3083\u3044"},"\u6B64\u306E\u5118|\u3053\u306E\u307E\u307E":{band:"kana",score:0,preferredSurface:"\u3053\u306E\u307E\u307E"},"\u6B64\u308C\u304B\u3089|\u3053\u308C\u304B\u3089":{band:"kana",score:0,preferredSurface:"\u3053\u308C\u304B\u3089"},"\u6B62\u3081\u308B|\u3084\u3081\u308B":{band:"kana",score:15,preferredSurface:"\u3084\u3081\u308B"},"\u82E5\u3057\u304B\u3057\u305F\u3089|\u3082\u3057\u304B\u3057\u305F\u3089":{band:"kana",score:0,preferredSurface:"\u3082\u3057\u304B\u3057\u305F\u3089"},"\u53D6\u308A\u6562\u3048\u305A|\u3068\u308A\u3042\u3048\u305A":{band:"kana",score:8,preferredSurface:"\u3068\u308A\u3042\u3048\u305A"},"\u745E\u897F|\u30B9\u30A4\u30B9":{band:"kana",score:0,preferredSurface:"\u30B9\u30A4\u30B9"},"\u5176\u65B9|\u305D\u3061\u3089":{band:"kana",score:0,preferredSurface:"\u305D\u3061\u3089"},"\u9942\u98E9|\u3046\u3069\u3093":{band:"kana",score:0,preferredSurface:"\u3046\u3069\u3093"},"\u7169\u3044|\u3046\u308B\u3055\u3044":{band:"kana",score:15,preferredSurface:"\u3046\u308B\u3055\u3044"},"\u53EA\u4ECA|\u305F\u3060\u3044\u307E":{band:"kana",score:15,preferredSurface:"\u305F\u3060\u3044\u307E"},"\u4E2D\u3005|\u306A\u304B\u306A\u304B":{band:"kana",score:15,preferredSurface:"\u306A\u304B\u306A\u304B"},"\u73A9\u5177|\u304A\u3082\u3061\u3083":{band:"low",score:24,preferredSurface:"\u304A\u3082\u3061\u3083"},"\u5982\u4F55\u3057\u3066|\u3069\u3046\u3057\u3066":{band:"kana",score:0,preferredSurface:"\u3069\u3046\u3057\u3066"},"\u304A\u65E9\u3046|\u304A\u306F\u3088\u3046":{band:"kana",score:8,preferredSurface:"\u304A\u306F\u3088\u3046"},"\u5F7C\u51E6|\u3042\u305D\u3053":{band:"kana",score:0,preferredSurface:"\u3042\u305D\u3053"},"\u5F7C\u65B9|\u3042\u3061\u3089":{band:"kana",score:0,preferredSurface:"\u3042\u3061\u3089"},"\u4F55\u308C|\u3069\u308C":{band:"kana",score:0,preferredSurface:"\u3069\u308C"},"\u8272\u3093\u306A|\u3044\u308D\u3093\u306A":{band:"kana",score:15,preferredSurface:"\u3044\u308D\u3093\u306A"},"\u5FA1\u89A7|\u3054\u3089\u3093":{band:"alternate",score:23,preferredSurface:"\u3054\u89A7"},"\u525D[\u3080]\u304F|\u3080\u304F":{band:"kana",score:0,preferredSurface:"\u3080\u304F"},"\u7F79[\u304B\u304B]\u308B|\u304B\u304B\u308B":{band:"kana",score:15,preferredSurface:"\u304B\u304B\u308B"},"\u6414[\u304B]\u304F|\u304B\u304F":{band:"kana",score:0,preferredSurface:"\u304B\u304F"},"\u67D3\u307F|\u3057\u307F":{band:"low",score:24,preferredSurface:"\u3057\u307F"},"\u7A0B|\u307B\u3069":{band:"kana",score:15,preferredSurface:"\u307B\u3069"},"\u5224\u5B50|\u306F\u3093\u3053":{band:"low",score:24,preferredSurface:"\u306F\u3093\u3053"},"\u6765\u3059|\u304D\u305F\u3059":{band:"kana",score:8,preferredSurface:"\u304D\u305F\u3059"},"\u8A0A[\u305F\u305A]\u306D\u308B|\u305F\u305A\u306D\u308B":{band:"alternate",score:34,preferredSurface:"\u5C0B\u306D\u308B"},"\u4F55\u3068\u306A\u304F|\u306A\u3093\u3068\u306A\u304F":{band:"kana",score:15,preferredSurface:"\u306A\u3093\u3068\u306A\u304F"},"\u6B63\u306B|\u307E\u3055\u306B":{band:"low",score:24,preferredSurface:"\u307E\u3055\u306B"},"\u8E0F\u307F\u5207\u308A|\u3075\u307F\u304D\u308A":{band:"alternate",score:34,preferredSurface:"\u8E0F\u5207"},"\u7121\u3057|\u306A\u3057":{band:"kana",score:15,preferredSurface:"\u306A\u3057"},"\u6709\u308A\u96E3\u3044|\u3042\u308A\u304C\u305F\u3044":{band:"kana",score:15,preferredSurface:"\u3042\u308A\u304C\u305F\u3044"},"\u4ED5\u69D8\u304C\u306A\u3044|\u3057\u3088\u3046\u304C\u306A\u3044":{band:"kana",score:0,preferredSurface:"\u3057\u3088\u3046\u304C\u306A\u3044"},"\u4F55\u3060\u304B|\u306A\u3093\u3060\u304B":{band:"kana",score:15,preferredSurface:"\u306A\u3093\u3060\u304B"},"\u5EA6\u3005|\u305F\u3073\u305F\u3073":{band:"kana",score:15,preferredSurface:"\u305F\u3073\u305F\u3073"},"\u6050\u3089\u304F|\u304A\u305D\u3089\u304F":{band:"kana",score:15,preferredSurface:"\u304A\u305D\u3089\u304F"},"\u6975[\u3054\u304F]|\u3054\u304F":{band:"kana",score:15,preferredSurface:"\u3054\u304F"},"\u53F0\u8A5E[\u305B\u308A\u3075]|\u305B\u308A\u3075":{band:"low",score:20,preferredSurface:"\u305B\u308A\u3075"},"\u7C60|\u304B\u3054":{band:"low",score:24,preferredSurface:"\u304B\u3054"},"\u301C\u907F\u3051|\u301C\u3088\u3051":{band:"kana",score:8,preferredSurface:"\u301C\u3088\u3051"},"\u87FB[\u3042\u308A]|\u3042\u308A":{band:"kana",score:15,preferredSurface:"\u30A2\u30EA"},"\u304F\u307F\u53D6\u308B|\u304F\u307F\u3068\u308B":{band:"alternate",score:0,preferredSurface:"\u6C72\u307F\u53D6\u308B"},"\u63AC[\u3059\u304F]\u3046|\u3059\u304F\u3046":{band:"kana",score:15,preferredSurface:"\u3059\u304F\u3046"},"\u525D[\u3080]\u3051\u308B|\u3080\u3051\u308B":{band:"alternate",score:34,preferredSurface:"\u5265\u3051\u308B"},"\u81EA[\u304A\u306E]\u305A\u304B\u3089|\u304A\u306E\u305A\u304B\u3089":{band:"kana",score:15,preferredSurface:"\u304A\u306E\u305A\u304B\u3089"},"\u898B\u306A\u3059|\u307F\u306A\u3059":{band:"kana",score:15,preferredSurface:"\u307F\u306A\u3059"},"\u6301\u3066\u6210\u3059|\u3082\u3066\u306A\u3059":{band:"kana",score:0,preferredSurface:"\u3082\u3066\u306A\u3059"},"\u8CBC\u308A\u7D19|\u306F\u308A\u304C\u307F":{band:"alternate",score:34,preferredSurface:"\u5F35\u308A\u7D19"},"\u5699[\u304B]\u307F\u5408\u3046|\u304B\u307F\u3042\u3046":{band:"alternate",score:20,preferredSurface:"\u565B\u307F\u5408\u3046"},"\u8FC2\u95CA[\u3046\u304B\u3064]|\u3046\u304B\u3064":{band:"low",score:16,preferredSurface:"\u3046\u304B\u3064"},"\u4ED8\u304D\u7269|\u3064\u304D\u3082\u306E":{band:"low",score:16,preferredSurface:"\u3064\u304D\u3082\u306E"},"\u689F[\u3075\u304F\u308D\u3046]|\u3075\u304F\u308D\u3046":{band:"kana",score:8,preferredSurface:"\u30D5\u30AF\u30ED\u30A6"},"\u6D77\u8C5A[\u3044\u308B\u304B]|\u3044\u308B\u304B":{band:"kana",score:0,preferredSurface:"\u30A4\u30EB\u30AB"},"\u4ECA\u4E00\u3064|\u3044\u307E\u3072\u3068\u3064":{band:"low",score:34,preferredSurface:"\u3044\u307E\u3072\u3068\u3064"},"\u51FA\u6765\u305F\u3066|\u3067\u304D\u305F\u3066":{band:"kana",score:8,preferredSurface:"\u3067\u304D\u305F\u3066"},"\u9AED[\u3072\u3052]|\u3072\u3052":{band:"low",score:24,preferredSurface:"\u3072\u3052"},"\u764C[\u304C\u3093]|\u304C\u3093":{band:"kana",score:15,preferredSurface:"\u304C\u3093"},"\u9762\u5012\u81ED\u3044|\u3081\u3093\u3069\u3046\u304F\u3055\u3044":{band:"alternate",score:24,preferredSurface:"\u9762\u5012\u304F\u3055\u3044"},"\u89E3\u304B\u3059|\u3068\u304B\u3059":{band:"kana",score:15,preferredSurface:"\u3068\u304B\u3059"},"\u70BA[\u306A]\u3059|\u306A\u3059":{band:"alternate",score:24,preferredSurface:"\u6210\u3059"},"\u5927\u5C64|\u305F\u3044\u305D\u3046":{band:"kana",score:15,preferredSurface:"\u305F\u3044\u305D\u3046"},"\u525D\u304C\u3059|\u306F\u304C\u3059":{band:"alternate",score:0,preferredSurface:"\u5265\u304C\u3059"},"\u5343\u5207\u308C\u308B|\u3061\u304E\u308C\u308B":{band:"kana",score:15,preferredSurface:"\u3061\u304E\u308C\u308B"},"\u525D\u304C\u308C\u308B|\u306F\u304C\u308C\u308B":{band:"alternate",score:34,preferredSurface:"\u5265\u304C\u308C\u308B"},"\u96C4|\u304A\u3059":{band:"kana",score:15,preferredSurface:"\u30AA\u30B9"},"\u5D69\u5F35[\u304B\u3055\u3070]\u308B|\u304B\u3055\u3070\u308B":{band:"kana",score:8,preferredSurface:"\u304B\u3055\u3070\u308B"},"\u4F55\u3052\u306A\u3044|\u306A\u306B\u3052\u306A\u3044":{band:"alternate",score:0,preferredSurface:"\u4F55\u6C17\u306A\u3044"},"\u61D0\u304F|\u306A\u3064\u304F":{band:"low",score:16,preferredSurface:"\u306A\u3064\u304F"},"\u96CC|\u3081\u3059":{band:"kana",score:15,preferredSurface:"\u30E1\u30B9"},"\u7121\u95C7|\u3080\u3084\u307F":{band:"kana",score:8,preferredSurface:"\u3080\u3084\u307F"},"\u6B8A\u66F4|\u3053\u3068\u3055\u3089":{band:"kana",score:8,preferredSurface:"\u3053\u3068\u3055\u3089"},"\u5927\u304C\u304B\u308A|\u304A\u304A\u304C\u304B\u308A":{band:"alternate",score:34,preferredSurface:"\u5927\u639B\u304B\u308A"},"\u87F9[\u304B\u306B]|\u304B\u306B":{band:"low",score:24,preferredSurface:"\u30AB\u30CB"},"\u6A9C[\u3072\u306E\u304D]|\u3072\u306E\u304D":{band:"kana",score:8,preferredSurface:"\u30D2\u30CE\u30AD"},"\u72F8[\u305F\u306C\u304D]|\u305F\u306C\u304D":{band:"low",score:24,preferredSurface:"\u30BF\u30CC\u30AD"},"\u4E00\u307E\u3068\u3081|\u3072\u3068\u307E\u3068\u3081":{band:"kana",score:8,preferredSurface:"\u3072\u3068\u307E\u3068\u3081"},"\u7269\u771F\u4F3C|\u3082\u306E\u307E\u306D":{band:"kana",score:8,preferredSurface:"\u3082\u306E\u307E\u306D"},"\u51FA\u3057\u3083\u3070\u308B|\u3067\u3057\u3083\u3070\u308B":{band:"kana",score:8,preferredSurface:"\u3067\u3057\u3083\u3070\u308B"},"\u86D9[\u304B\u3048\u308B]|\u304B\u3048\u308B":{band:"low",score:24,preferredSurface:"\u30AB\u30A8\u30EB"},"\u71D5[\u3064\u3070\u3081]|\u3064\u3070\u3081":{band:"low",score:34,preferredSurface:"\u30C4\u30D0\u30E1"},"\u8B33[\u3046\u305F]\u3046|\u3046\u305F\u3046":{band:"kana",score:15,preferredSurface:"\u3046\u305F\u3046"},"\u5699[\u304B]\u307F\u4ED8\u304F|\u304B\u307F\u3064\u304F":{band:"alternate",score:0,preferredSurface:"\u565B\u307F\u4ED8\u304F"},"\u73CA\u745A[\u3055\u3093\u3054]|\u3055\u3093\u3054":{band:"low",score:24,preferredSurface:"\u30B5\u30F3\u30B4"},"\u9280\u674F[\u3044\u3061\u3087\u3046]|\u3044\u3061\u3087\u3046":{band:"kana",score:8,preferredSurface:"\u30A4\u30C1\u30E7\u30A6"},"\u9DAF[\u3046\u3050\u3044\u3059]|\u3046\u3050\u3044\u3059":{band:"low",score:34,preferredSurface:"\u30A6\u30B0\u30A4\u30B9"},"\u88DC\u5861|\u307B\u3066\u3093":{band:"alternate",score:2,preferredSurface:"\u88DC\u586B"},"\u4F38\u3073\u4F38\u3073|\u306E\u3073\u306E\u3073":{band:"kana",score:15,preferredSurface:"\u306E\u3073\u306E\u3073"},"\u64E6\u308A\u629C\u3051\u308B|\u3059\u308A\u306C\u3051\u308B":{band:"kana",score:15,preferredSurface:"\u3059\u308A\u629C\u3051\u308B"}}}});var Bu={};x(Bu,{cleanWordSurface:()=>Wo,isLoanwordSourceSurface:()=>br,kanjiReadingPriorityAdjustment:()=>hn,kanjiReadingSurface:()=>jo,orthographyEntry:()=>Br,preferredWordSurface:()=>Lr,shouldStudyKanjiReading:()=>$o});var ub,lb,Wo,br,Br,Lr,jo,$o,hn,Xr=h(()=>{"use strict";rg();ub=ng.entries,lb=/[\u3400-\u9fff]/u,Wo=e=>e.replace(/\[[^\]]*\]/g,"").replace(/\s+/g,"")||e,br=({kanji:e,kana:t})=>/[A-Za-z]/.test(e)&&/[\u30a0-\u30ff]/u.test(t),Br=({kanji:e,kana:t})=>ub[`${e}|${t}`]??null,Lr=e=>br(e)?e.kana:Br(e)?.preferredSurface||Wo(e.kanji)||e.kana,jo=e=>{let t=Br(e);return t?.band==="alternate"?t.preferredSurface:Wo(e.kanji)},$o=e=>{if(br(e)||Br(e)?.band==="kana")return!1;let r=jo(e);return r!==e.kana&&lb.test(r)},hn=e=>Br(e)?.band==="low"?-30:0});var Or=le((gI,og)=>{og.exports=require("../data/verb_pair_hints")});var sg,ig,ag=h(()=>{"use strict";sg=[{id:"\u3042\u306A\u305F-kanji-variant",members:[["\u3042\u306A\u305F","\u3042\u306A\u305F"],["\u8CB4\u65B9","\u3042\u306A\u305F"]],reason:"\u73B0\u4EE3\u9ED8\u8BA4\u5199\u4F5C\u5047\u540D\uFF0C\u8CB4\u65B9\u662F\u540C\u4E00\u8BCD\u7684\u65E7/\u6C49\u5B57\u5199\u6CD5\u3002"},{id:"\u3046\u308B\u3055\u3044-kanji-variant",members:[["\u3046\u308B\u3055\u3044","\u3046\u308B\u3055\u3044"],["\u7169\u3044","\u3046\u308B\u3055\u3044"]],reason:"\u3046\u308B\u3055\u3044\u4E0E\u7169\u3044\u662F\u540C\u4E00\u5F62\u5BB9\u8BCD\u7684\u5047\u540D/\u6C49\u5B57\u5199\u6CD5\u3002"},{id:"\u3067\u304D\u308B-kanji-variant",members:[["\u3067\u304D\u308B","\u3067\u304D\u308B"],["\u51FA\u6765\u308B","\u3067\u304D\u308B"]],reason:"\u73B0\u4EE3\u9ED8\u8BA4\u5199\u4F5C\u5047\u540D\uFF0C\u51FA\u6765\u308B\u662F\u540C\u4E00\u8BCD\u7684\u6C49\u5B57\u5199\u6CD5\u3002"},{id:"\u3069\u3046-kanji-variant",members:[["\u3069\u3046","\u3069\u3046"],["\u5982\u4F55","\u3069\u3046"]],reason:"\u3069\u3046\u4E0E\u5982\u4F55\uFF08\u3069\u3046\uFF09\u662F\u540C\u4E00\u526F\u8BCD\u7684\u5047\u540D/\u6C49\u5B57\u5199\u6CD5\u3002"},{id:"\u3044\u304B\u304C-kanji-variant",members:[["\u3044\u304B\u304C","\u3044\u304B\u304C"],["\u5982\u4F55","\u3044\u304B\u304C"]],reason:"\u3044\u304B\u304C\u4E0E\u5982\u4F55\uFF08\u3044\u304B\u304C\uFF09\u662F\u540C\u4E00\u8BCD\u7684\u5047\u540D/\u6C49\u5B57\u5199\u6CD5\uFF1B\u5982\u4F55\uFF08\u3069\u3046\uFF09\u662F\u53E6\u4E00\u8BFB\u6CD5\uFF0C\u4FDD\u7559\u3002"},{id:"\u3069\u3061\u3089-kanji-variant",members:[["\u3069\u3061\u3089","\u3069\u3061\u3089"],["\u4F55\u65B9","\u3069\u3061\u3089"]],reason:"\u73B0\u4EE3\u9ED8\u8BA4\u5199\u4F5C\u5047\u540D\uFF0C\u4F55\u65B9\uFF08\u3069\u3061\u3089\uFF09\u662F\u540C\u4E00\u4EE3\u8BCD\u7684\u6C49\u5B57\u5199\u6CD5\u3002"},{id:"\u3069\u306A\u305F-kanji-variant",members:[["\u3069\u306A\u305F","\u3069\u306A\u305F"],["\u4F55\u65B9","\u3069\u306A\u305F"]],reason:"\u73B0\u4EE3\u9ED8\u8BA4\u5199\u4F5C\u5047\u540D\uFF0C\u4F55\u65B9\uFF08\u3069\u306A\u305F\uFF09\u662F\u540C\u4E00\u4EE3\u8BCD\u7684\u6C49\u5B57\u5199\u6CD5\u3002"},{id:"\u3069\u308C-kanji-variant",members:[["\u3069\u308C","\u3069\u308C"],["\u4F55\u308C","\u3069\u308C"]],reason:"\u73B0\u4EE3\u9ED8\u8BA4\u5199\u4F5C\u5047\u540D\uFF0C\u4F55\u308C\u662F\u540C\u4E00\u4EE3\u8BCD\u7684\u6C49\u5B57\u5199\u6CD5\u3002"},{id:"\u307E\u3060-kanji-variant",members:[["\u307E\u3060","\u307E\u3060"],["\u672A\u3060","\u307E\u3060"]],reason:"\u307E\u3060\u4E0E\u672A\u3060\u662F\u540C\u4E00\u526F\u8BCD\u7684\u5047\u540D/\u6C49\u5B57\u5199\u6CD5\u3002"},{id:"\u305F\u307E\u306B-kanji-variant",members:[["\u305F\u307E\u306B","\u305F\u307E\u306B"],["\u5076\u306B","\u305F\u307E\u306B"]],reason:"\u73B0\u4EE3\u9ED8\u8BA4\u5199\u4F5C\u5047\u540D\uFF0C\u5076\u306B\u662F\u540C\u4E00\u526F\u8BCD\u7684\u6C49\u5B57\u5199\u6CD5\u3002"},{id:"\u3057\u3063\u304B\u308A-kanji-variant",members:[["\u3057\u3063\u304B\u308A","\u3057\u3063\u304B\u308A"],["\u78BA\u308A","\u3057\u3063\u304B\u308A"]],reason:"\u73B0\u4EE3\u9ED8\u8BA4\u5199\u4F5C\u5047\u540D\uFF0C\u78BA\u308A\u662F\u540C\u4E00\u526F\u8BCD\u7684\u6C49\u5B57\u5199\u6CD5\u3002"},{id:"\u3057\u307E\u3046-kanji-variant",members:[["\u3057\u307E\u3046","\u3057\u307E\u3046"],["\u4ED5\u821E\u3046","\u3057\u307E\u3046"]],reason:"\u3057\u307E\u3046\u4E0E\u4ED5\u821E\u3046\u662F\u540C\u4E00\u52A8\u8BCD\u7684\u5047\u540D/\u6C49\u5B57\u5199\u6CD5\u3002"},{id:"\u3046\u308C\u3057\u3044-kanji-variant",members:[["\u3046\u308C\u3057\u3044","\u3046\u308C\u3057\u3044"],["\u5B09\u3057\u3044","\u3046\u308C\u3057\u3044"]],reason:"\u3046\u308C\u3057\u3044\u4E0E\u5B09\u3057\u3044\u662F\u540C\u4E00\u5F62\u5BB9\u8BCD\u7684\u5047\u540D/\u6C49\u5B57\u5199\u6CD5\u3002"},{id:"\u3059\u3070\u3089\u3057\u3044-kanji-variant",members:[["\u3059\u3070\u3089\u3057\u3044","\u3059\u3070\u3089\u3057\u3044"],["\u7D20\u6674\u3089\u3057\u3044","\u3059\u3070\u3089\u3057\u3044"]],reason:"\u3059\u3070\u3089\u3057\u3044\u4E0E\u7D20\u6674\u3089\u3057\u3044\u662F\u540C\u4E00\u5F62\u5BB9\u8BCD\u7684\u5047\u540D/\u6C49\u5B57\u5199\u6CD5\u3002"},{id:"\u307E\u3063\u3059\u3050-kanji-variant",members:[["\u307E\u3063\u3059\u3050","\u307E\u3063\u3059\u3050"],["\u771F\u3063\u76F4\u3050","\u307E\u3063\u3059\u3050"]],reason:"\u307E\u3063\u3059\u3050\u4E0E\u771F\u3063\u76F4\u3050\u662F\u540C\u4E00\u5F62\u5BB9\u52A8\u8BCD\u7684\u5047\u540D/\u6C49\u5B57\u5199\u6CD5\u3002"},{id:"\u3086\u3046\u3079-kanji-variant",members:[["\u3086\u3046\u3079","\u3086\u3046\u3079"],["\u6628\u591C","\u3086\u3046\u3079"]],reason:"\u3086\u3046\u3079\u4E0E\u6628\u591C\u662F\u540C\u4E00\u540D\u8BCD\u7684\u5047\u540D/\u6C49\u5B57\u5199\u6CD5\u3002"},{id:"\u3046\u3061-kanji-variant",members:[["\u3046\u3061","\u3046\u3061"],["\u5185","\u3046\u3061"]],reason:"\u8868\u793A\u5BB6\u91CC/\u5185\u90E8\u7684\u3046\u3061\u4E0E\u5185\u662F\u540C\u4E00\u8BCD\u7684\u5047\u540D/\u6C49\u5B57\u5199\u6CD5\u3002"},{id:"\u3051\u304C-kanji-variant",members:[["\u3051\u304C","\u3051\u304C"],["\u602A\u6211","\u3051\u304C"]],reason:"\u3051\u304C\u4E0E\u602A\u6211\u662F\u540C\u4E00\u540D\u8BCD\u7684\u5047\u540D/\u6C49\u5B57\u5199\u6CD5\u3002"},{id:"\u304B\u3076\u308B-kanji-variant",members:[["\u304B\u3076\u308B","\u304B\u3076\u308B"],["\u88AB\u308B","\u304B\u3076\u308B"]],reason:"\u8868\u793A\u6234\u4E0A/\u8499\u4E0A\u7684\u304B\u3076\u308B\u4E0E\u88AB\u308B\u662F\u540C\u4E00\u52A8\u8BCD\u7684\u5047\u540D/\u6C49\u5B57\u5199\u6CD5\u3002"},{id:"\u306F\u304F-kanji-variant",members:[["\u306F\u304F","\u306F\u304F"],["\u5C65\u304F","\u306F\u304F"]],reason:"\u8868\u793A\u7A7F\u4E0B\u88C5/\u978B\u7684\u306F\u304F\u4E0E\u5C65\u304F\u662F\u540C\u4E00\u52A8\u8BCD\uFF1B\u6383\u304F\u3001\u5410\u304F\u4E0D\u662F\u6210\u5458\u3002"},{id:"\u3088\u308B-kanji-variant",members:[["\u3088\u308B","\u3088\u308B"],["\u5BC4\u308B","\u3088\u308B"]],reason:"\u8868\u793A\u9760\u8FD1/\u987A\u9053\u62DC\u8BBF\u7684\u3088\u308B\u4E0E\u5BC4\u308B\u662F\u540C\u4E00\u52A8\u8BCD\uFF1B\u591C\u662F\u53E6\u4E00\u8BCD\uFF0C\u4FDD\u7559\u3002"},{id:"\u305F\u3060\u3057-kanji-variant",members:[["\u4F46\u3057","\u305F\u3060\u3057"],["\u305F\u3060\u3057","\u305F\u3060\u3057"]],reason:"\u73B0\u4EE3\u9ED8\u8BA4\u5199\u4F5C\u5047\u540D\uFF0C\u4F46\u3057\u4E0E\u4F46\u3057\u662F\u540C\u4E00\u63A5\u7EED\u8BCD\u3002"},{id:"\u3055\u3089\u306B-kanji-variant",members:[["\u3055\u3089\u306B","\u3055\u3089\u306B"],["\u66F4\u306B","\u3055\u3089\u306B"]],reason:"\u73B0\u4EE3\u9ED8\u8BA4\u5199\u4F5C\u5047\u540D\uFF0C\u3055\u3089\u306B\u4E0E\u66F4\u306B\u306F\u540C\u4E00\u526F\u8BCD\u3002"},{id:"\u305F\u305A\u306D\u308B-kanji-variant",members:[["\u5C0B\u306D\u308B","\u305F\u305A\u306D\u308B"],["\u8A0A[\u305F\u305A]\u306D\u308B","\u305F\u305A\u306D\u308B"]],reason:"\u8868\u793A\u8BE2\u95EE\u7684\u5C0B\u306D\u308B\u4E0E\u8A0A\u306D\u308B\u662F\u540C\u4E00\u52A8\u8BCD\u7684\u5F02\u4F53\u5199\u6CD5\uFF1B\u5BFB\u8BBF\u4E49\u4FDD\u7559\u5728\u8F83\u5B8C\u6574\u8BCD\u6761\u3002"},{id:"\u304B\u305F\u3065\u3051\u308B-kanji-variant",members:[["\u7247\u4ED8\u3051\u308B","\u304B\u305F\u3065\u3051\u308B"],["\u7247\u3065\u3051\u308B","\u304B\u305F\u3065\u3051\u308B"]],reason:"\u7247\u4ED8\u3051\u308B\u4E0E\u7247\u3065\u3051\u308B\u662F\u540C\u4E00\u52A8\u8BCD\u7684\u9001\u308A\u4EEE\u540D\u53D8\u4F53\u3002"},{id:"\u3051\u3093\u304B-annotation-duplicate",members:[["\u55A7\u5629[\u3051\u3093\u304B]","\u3051\u3093\u304B"],["\u55A7\u5629","\u3051\u3093\u304B"]],reason:"\u65B9\u62EC\u53F7\u8BFB\u97F3\u6807\u6CE8\u88AB\u6E05\u7406\u540E\u662F\u540C\u4E00\u8BCD\u6761\u3002"},{id:"\u3046\u308F\u3055-annotation-duplicate",members:[["\u5642[\u3046\u308F\u3055]","\u3046\u308F\u3055"],["\u5642","\u3046\u308F\u3055"]],reason:"\u65B9\u62EC\u53F7\u8BFB\u97F3\u6807\u6CE8\u88AB\u6E05\u7406\u540E\u662F\u540C\u4E00\u8BCD\u6761\u3002"},{id:"\u305F\u305F\u304F-annotation-duplicate",members:[["\u53E9\u304F","\u305F\u305F\u304F"],["\u53E9[\u305F\u305F]\u304F","\u305F\u305F\u304F"]],reason:"\u65B9\u62EC\u53F7\u8BFB\u97F3\u6807\u6CE8\u88AB\u6E05\u7406\u540E\u662F\u540C\u4E00\u8BCD\u6761\u3002"},{id:"\u305D\u3070-annotation-duplicate",members:[["\u854E\u9EA6[\u305D\u3070]","\u305D\u3070"],["\u854E\u9EA6","\u305D\u3070"]],reason:"\u65B9\u62EC\u53F7\u8BFB\u97F3\u6807\u6CE8\u88AB\u6E05\u7406\u540E\u662F\u540C\u4E00\u8BCD\u6761\uFF1B\u5074\u662F\u53E6\u4E00\u8BCD\uFF0C\u4FDD\u7559\u3002"},{id:"\u3057\u304B\u3057-kanji-variant",members:[["\u3057\u304B\u3057","\u3057\u304B\u3057"],["\u7136\u3057","\u3057\u304B\u3057"]],reason:"\u73B0\u4EE3\u9ED8\u8BA4\u5199\u4F5C\u5047\u540D\uFF0C\u7136\u3057\u662F\u540C\u4E00\u63A5\u7EED\u8BCD\u7684\u6C49\u5B57\u5199\u6CD5\u3002"},{id:"\u305F\u3060\u3044\u307E-kanji-variant",members:[["\u305F\u3060\u4ECA","\u305F\u3060\u3044\u307E"],["\u53EA\u4ECA","\u305F\u3060\u3044\u307E"]],reason:"\u305F\u3060\u4ECA\u4E0E\u53EA\u4ECA\u662F\u540C\u4E00\u526F\u8BCD\u7684\u8868\u8BB0\u53D8\u4F53\u3002"},{id:"\u5165\u53E3-\u9001\u308A\u4EEE\u540D-variant",members:[["\u5165\u53E3","\u3044\u308A\u3050\u3061"],["\u5165\u308A\u53E3","\u3044\u308A\u3050\u3061"]],reason:"\u5165\u53E3\u4E0E\u5165\u308A\u53E3\u662F\u540C\u4E00\u540D\u8BCD\u7684\u8868\u8BB0\u53D8\u4F53\uFF0C\u4E0D\u5E94\u4F5C\u4E3A\u6C49\u5B57\u7528\u6CD5\u8FA8\u6790\u3002"},{id:"\u6669\u3054\u98EF-\u6669\u5FA1\u98EF-variant",members:[["\u6669\u3054\u98EF","\u3070\u3093\u3054\u306F\u3093"],["\u6669\u5FA1\u98EF","\u3070\u3093\u3054\u306F\u3093"]],reason:"\u6669\u3054\u98EF\u4E0E\u6669\u5FA1\u98EF\u662F\u540C\u4E00\u540D\u8BCD\u7684\u8868\u8BB0\u53D8\u4F53\u3002"},{id:"\u6C17\u3092\u4ED8\u3051\u308B-\u6C17\u3092\u3064\u3051\u308B-variant",members:[["\u6C17\u3092\u4ED8\u3051\u308B","\u304D\u3092\u3064\u3051\u308B"],["\u6C17\u3092\u3064\u3051\u308B","\u304D\u3092\u3064\u3051\u308B"]],reason:"\u6C17\u3092\u4ED8\u3051\u308B\u4E0E\u6C17\u3092\u3064\u3051\u308B\u662F\u540C\u4E00\u60EF\u7528\u8868\u8FBE\u7684\u8868\u8BB0\u53D8\u4F53\u3002"}],ig=[{id:"synonym-things-east-west",members:[["\u7269","\u3082\u306E"],["\u6771\u897F","\u3068\u3046\u3056\u3044"]],reason:"\u4E2D\u6587\u2018\u4E1C\u897F\u2019\u540C\u5F62\uFF1B\u7269\u662F\u4E1C\u897F\uFF0C\u6771\u897F\u662F\u4E1C\u4E0E\u897F\uFF0C\u4E0D\u662F\u65E5\u8BED\u8FD1\u4E49\u8BCD\u3002"},{id:"synonym-thousand-kilo",members:[["\u5343","\u305B\u3093"],["(\u30D5) kilo","\u30AD\u30ED"]],reason:"\u5343\u662F\u6570\u8BCD\uFF0C\u30AD\u30ED\u662F\u53EF\u8868\u793A\u5343\u514B/\u5343\u7C73\u7B49\u5355\u4F4D\uFF0C\u4E0D\u80FD\u4E92\u6362\u3002"},{id:"synonym-can-tank",members:[["\u7F36","\u304B\u3093"],["tank","\u30BF\u30F3\u30AF"]],reason:"\u7F36\u662F\u7F50\u5934/\u7F50\uFF0C\u30BF\u30F3\u30AF\u662F\u50A8\u7F50\u6216\u5927\u578B\u5BB9\u5668\uFF0C\u4E2D\u6587\u9996\u4E49\u78B0\u649E\u4E0D\u6784\u6210\u8FD1\u4E49\u3002"},{id:"synonym-ice-ice-cream",members:[["\u6C37","\u3053\u304A\u308A"],["ice","\u30A2\u30A4\u30B9"]],reason:"\u6C37\u662F\u51B0\uFF0C\u30A2\u30A4\u30B9\u8FD8\u53EF\u6307\u51B0\u6DC7\u6DCB\uFF0C\u4E0D\u662F\u540C\u4E00\u8BCD\u4E49\u3002"},{id:"synonym-date-calendar-appointment",members:[["date","\u30C7\u30FC\u30C8"],["\u65E5\u4ED8","\u3072\u3065\u3051"],["\u65E5\u306B\u3061","\u3072\u306B\u3061"],["\u671F\u65E5","\u304D\u3058\u3064"]],reason:"\u30C7\u30FC\u30C8\u662F\u7EA6\u4F1A\uFF0C\u5176\u4ED6\u6210\u5458\u662F\u65E5\u671F/\u671F\u9650\uFF0C\u539F\u4E2D\u6587\u9996\u4E49\u5C5E\u4E8E\u8BEF\u8BD1\u6216\u591A\u4E49\u78B0\u649E\u3002"},{id:"synonym-receipt-ticketing",members:[["\u9818\u53CE\u66F8","\u308A\u3087\u3046\u3057\u3085\u3046\u3057\u3087"],["\u767A\u5238","\u306F\u3063\u3051\u3093"]],reason:"\u9818\u53CE\u66F8\u662F\u6536\u636E\uFF0C\u767A\u5238\u662F\u51FA\u7968/\u53D1\u884C\u7968\u5238\uFF0C\u4E0D\u662F\u53D1\u7968\u7684\u540C\u4E49\u8BCD\u3002"},{id:"synonym-title-question",members:[["\u984C\u540D","\u3060\u3044\u3081\u3044"],["\u984C","\u3060\u3044"],["\u8A2D\u554F","\u305B\u3064\u3082\u3093"]],reason:"\u984C\u540D\u662F\u6807\u9898\uFF0C\u984C/\u8A2D\u554F\u662F\u9898\u76EE\u6216\u8BBE\u95EE\uFF0C\u4E0D\u80FD\u4F5C\u4E3A\u4E00\u7EC4\u53EF\u4E92\u6362\u8BCD\u3002"},{id:"synonym-quality-mass",members:[["\u8CEA","\u3057\u3064"],["\u8CEA\u91CF","\u3057\u3064\u308A\u3087\u3046"]],reason:"\u8CEA\u662F\u8D28\u91CF/\u7D20\u8D28\uFF0C\u8CEA\u91CF\u662F\u7269\u7406\u5B66\u7684\u8D28\u91CF\uFF08mass\uFF09\uFF0C\u4E2D\u6587\u540C\u5B57\u4E0D\u540C\u4E49\u3002"},{id:"synonym-ecology-eco",members:[["\u751F\u614B","\u305B\u3044\u305F\u3044"],["eco","\u30A8\u30B3"]],reason:"\u751F\u614B\u662F\u751F\u6001\u72B6\u6001\uFF0C\u30A8\u30B3\u662F\u73AF\u4FDD/\u751F\u6001\u53CB\u597D\uFF0C\u4E0D\u80FD\u4E92\u6362\u3002"},{id:"synonym-literary-entertainment",members:[["\u82B8\u80FD","\u3052\u3044\u306E\u3046"],["\u6587\u82B8","\u3076\u3093\u3052\u3044"]],reason:"\u82B8\u80FD\u662F\u6F14\u827A/\u5A31\u4E50\uFF0C\u6587\u82B8\u662F\u6587\u5B66\u827A\u672F\uFF0C\u4E2D\u6587\u2018\u6587\u827A\u2019\u9020\u6210\u8BEF\u5408\u5E76\u3002"},{id:"synonym-lesson-curriculum",members:[["lesson","\u30EC\u30C3\u30B9\u30F3"],["curriculum","\u30AB\u30EA\u30AD\u30E5\u30E9\u30E0"]],reason:"\u30EC\u30C3\u30B9\u30F3\u662F\u5355\u8282\u8BFE/\u8BFE\u7A0B\uFF0C\u30AB\u30EA\u30AD\u30E5\u30E9\u30E0\u662F\u8BFE\u7A0B\u4F53\u7CFB\uFF0C\u4E0D\u662F\u540C\u4E49\u8BCD\u3002"},{id:"synonym-potted-plant-garden-tree",members:[["\u9262\u690D\u3048","\u306F\u3061\u3046\u3048"],["\u690D\u6728","\u3046\u3048\u304D"]],reason:"\u9262\u690D\u3048\u662F\u76C6\u683D\u690D\u7269\uFF0C\u690D\u6728\u662F\u5EAD\u9662\u6811\u6728/\u56ED\u6797\u690D\u7269\uFF0C\u4E2D\u6587\u9996\u4E49\u8FC7\u5BBD\u3002"},{id:"synonym-decisive-absolutely-not",members:[["\u65AD\u7136","\u3060\u3093\u305C\u3093"],["\u65AD\u3058\u3066","\u3060\u3093\u3058\u3066"]],reason:"\u65AD\u7136\u662F\u65AD\u7136/\u660E\u663E\u5730\uFF0C\u65AD\u3058\u3066\u5E38\u7528\u4E8E\u2018\u7EDD\u4E0D\u2019\uFF0C\u4E0D\u662F\u540C\u4E49\u8BCD\u3002"},{id:"synonym-terminal-station-device",members:[["terminal","\u30BF\u30FC\u30DF\u30CA\u30EB"],["\u7AEF\u672B","\u305F\u3093\u307E\u3064"]],reason:"\u30BF\u30FC\u30DF\u30CA\u30EB\u53EF\u6307\u7EC8\u70B9\u7AD9\uFF0C\u7AEF\u672B\u662F\u7EC8\u7AEF\u8BBE\u5907\uFF0C\u4E2D\u6587\u9996\u4E49\u4E0D\u5E94\u5408\u7EC4\u3002"},{id:"synonym-route-circuit",members:[["\u8DEF\u7DDA","\u308D\u305B\u3093"],["\u56DE\u7DDA","\u304B\u3044\u305B\u3093"]],reason:"\u8DEF\u7DDA\u662F\u8DEF\u7EBF\uFF0C\u56DE\u7DDA\u662F\u901A\u4FE1\u7EBF\u8DEF/\u7535\u8DEF\uFF0C\u4E2D\u6587\u2018\u7EBF\u8DEF\u2019\u9020\u6210\u8BEF\u5408\u5E76\u3002"}]});var Si=le((wI,dg)=>{dg.exports=new Proxy({},{get:(e,t)=>t==="__esModule"?!1:()=>({})})});var Yu={};x(Yu,{CONFUSION_TYPES:()=>wb,TYPE_META:()=>Ko,TYPE_PRIORITY:()=>Ho,confusionGroups:()=>Je,confusionGroupsForWord:()=>Ar,displayForm:()=>Se,duplicateMergeTargets:()=>Ai,duplicateWordIds:()=>Oi,firstSense:()=>bi,groupWordParts:()=>mg,groupWords:()=>Tb,masteredConfusionKeys:()=>_b,resetConfusionGroups:()=>Cn,setConfusionMastered:()=>Xu,warmConfusionGroups:()=>Sb});var ug,lg,Ie,cb,kn,Li,bi,vn,mb,Ho,Yr,pb,dt,Eb,fb,gb,yi,Po,Ni,Cn,Oi,Ai,cg,Je,_b,Xu,wb,Ko,Se,mg,Tb,Ri,Ar,Sb,rr=h(()=>{"use strict";ug=N($(),1);Xr();P();G();lg=N(Or(),1);ag();Qt();Ie=N(Si(),1),cb=8,kn=/[㐀-鿿]/,Li=/[A-Za-z]/,bi=e=>{let t=0;for(let r=0;r<e.length;r+=1){let n=e[r];if(n==="\uFF08"||n==="(")t+=1;else if(n==="\uFF09"||n===")")t=Math.max(0,t-1);else if(t===0&&"\uFF1B;\uFF0C,\u3001".includes(n))return e.slice(0,r).trim()}return e.trim()},vn=e=>e.senseKey||bi(e.meaning),mb=e=>({id:e.id,kanji:e.kanji,kana:e.kana,meaning:e.meaning,exampleJp:e.exampleJp,exampleMeaning:e.exampleMeaning,jlptLevel:e.jlptLevel,senseKey:vn(e)}),Ho=["pair","kanji-choice","reading-register","reading-sense","homophone","stem","synonym","near-synonym"],Yr=(e,t)=>{let r=new Map;return e.forEach(n=>{let o=t(n);if(!o)return;let s=r.get(o);s?s.push(n):r.set(o,[n])}),r},pb=e=>{let t=new Map,r=new Set,n=(a,d)=>{r.add(a.id),t.set(a.id,d.id)},o=Yr(e,a=>`${a.kanji}\0${a.kana}`);o.forEach(a=>{if(!a[0].kanji||a.length<2)return;let[d,...u]=[...a].sort((l,c)=>dt(l)-dt(c)||l.id-c.id);u.forEach(l=>n(l,d))}),Yr(e.filter(a=>!r.has(a.id)),a=>a.kana).forEach((a,d)=>{if(a.length!==2)return;let u=a.filter(m=>Li.test(m.kanji)),l=a.filter(m=>m.kanji===d);if(u.length!==1||l.length!==1)return;let[c,f]=[...a].sort((m,g)=>dt(m)-dt(g)||m.id-g.id);n(f,c)});let s=e.filter(a=>!r.has(a.id));Yr(s,a=>`${a.kana}\0${vn(a)}`).forEach(a=>{if(a.length<2)return;let d=a.filter(c=>kn.test(c.kanji));if(d.length===a.length)return;if(d.length){let c=[...d].sort((f,m)=>dt(f)-dt(m)||f.id-m.id)[0];a.filter(f=>!kn.test(f.kanji)).forEach(f=>n(f,c));return}let u=c=>c.kanji===c.kana?1:0,l=[...a].sort((c,f)=>dt(c)-dt(f)||u(c)-u(f)||c.id-f.id)[0];a.filter(c=>c.id!==l.id).forEach(c=>n(c,l))}),sg.forEach(a=>{let d=a.members.map(([l,c])=>o.get(`${l}\0${c}`)?.find(f=>!r.has(f.id))).filter(l=>!!l);if(d.length<2)return;let u=[...d].sort((l,c)=>dt(l)-dt(c)||l.id-c.id)[0];d.filter(l=>l.id!==u.id).forEach(l=>n(l,u))});let i=(a,d=new Set)=>{let u=t.get(a);return u===void 0||d.has(a)?a:(d.add(a),i(u,d))};return new Map([...t.keys()].map(a=>[a,i(a)]))},dt=e=>(e.exampleJp?0:2)+(e.jlptLevel?0:1),Eb=(e,t)=>e==="reading-register"||e==="reading-sense"?t.kana:Se(t),fb=(e,t)=>{let r=Eb(e,t);return Li.test(t.kanji)?`${r}\0${t.kanji}`:r},gb=e=>{let t=Oi(),r=e.filter(m=>!t.has(m.id)),n=[],o=new Map,s=(m,g,S,w=`${m}:${g}`)=>{let y=new Map;S.forEach(v=>{let L=fb(m,v),I=y.get(L);(!I||dt(v)<dt(I))&&y.set(L,v)});let _=[...y.values()];if(_.length<2||_.length>cb)return;let b=m==="synonym"&&new Set(_.map(v=>bi(v.meaning))).size>1?"near-synonym":m,k={key:w,type:b,label:g,members:_.map(mb)};n.push(k);for(let v of _){let L=o.get(v.id);L?L.push(k):o.set(v.id,[k])}},i=lg.default,a=new Set,d=Yr(r,m=>m.kanji),u=Yr(r,m=>m.kana);r.forEach(m=>{let g=i[m.kanji]??i[m.kana];if(!g)return;let S=g[1],w=g[2],y=[...new Set([...(d.get(S)??[]).filter(b=>!w||b.kana===w),...u.get(S)??[]])].sort((b,k)=>b.order-k.order);if(!y.length)return;let _=[m.kanji||m.kana,S].sort().join(" / ");a.has(_)||(a.add(_),s("pair",_,[m,...y]))}),u.forEach((m,g)=>{if(m.length<2)return;if(new Set(m.map(w=>vn(w))).size>1){s("homophone",g,m);return}m.every(w=>kn.test(w.kanji))&&s("kanji-choice",g,m)}),d.forEach((m,g)=>{if(!kn.test(g)||new Set(m.map(w=>w.kana)).size<2)return;let S=new Set(m.map(w=>vn(w)));s(S.size===1?"reading-register":"reading-sense",g,m)});let l=r.filter(m=>(m.verbType==="godan"||m.verbType==="ichidan")&&kn.test(m.kanji));Yr(l,m=>m.kanji.match(kn)?.[0]??"").forEach((m,g)=>{let S=new Map(m.map(y=>[y,new Set(vn(y).match(/[㐀-鿿]/g)??[])])),w=m.filter(y=>{let _=S.get(y);return m.some(b=>b.id!==y.id&&[...S.get(b)].some(k=>_.has(k)))});s("stem",g,w)});let c=m=>{Yr(r,m?g=>bi(g.meaning):vn).forEach((g,S)=>{if(g.length<2||new Set(g.map(_=>_.pos)).size>1)return;let w=new Set(g.map(_=>`${_.kanji}\0${_.kana}`));ig.some(_=>_.members.length===g.length&&_.members.every(([b,k])=>w.has(`${b}\0${k}`)))||m&&o.get(g[0].id)?.some(_=>g.every(b=>_.members.some(k=>k.id===b.id)))||s("synonym",S,g,`${m?"synonym-now":"synonym"}:${S}`)})};c(!1),c(!0);let f=new Map;return n.forEach(m=>{let g=m.members.map(w=>w.id).sort((w,y)=>w-y).join(","),S=f.get(g);(!S||Ho.indexOf(m.type)<Ho.indexOf(S.type))&&f.set(g,m)}),[...f.values()]},yi=null,Po=null,Ni=null,Cn=()=>{yi=null,Po=null,Ni=null,Ri=null},Oi=()=>new Set(Ai().keys()),Ai=()=>(Ni||(Ni=pb(cg())),Ni),cg=()=>{if(Po)return Po;let e=p("PRAGMA table_info(words)").some(r=>r.name==="sense_key");return Po=JSON.parse(E(`
    SELECT json_group_array(json_array(id, kanji, kana, meaning, pos, verb_type,
      example_jp, example_meaning, jlpt_level, ${e?"sense_key":"''"}))
    FROM words
  `,[],"[]")).map((r,n)=>({order:n,id:Number(r[0]??0),kanji:String(r[1]??""),kana:String(r[2]??""),meaning:String(r[3]??""),pos:String(r[4]??""),verbType:String(r[5]??""),exampleJp:String(r[6]??""),exampleMeaning:String(r[7]??""),jlptLevel:String(r[8]??""),senseKey:String(r[9]??"")})).filter(r=>r.id&&!Li.test(r.kana)),Po},Je=()=>(yi||(yi=gb(cg())),yi),_b=()=>new Set(p("SELECT group_key FROM confusion_mastered").map(e=>String(e.group_key??""))),Xu=(e,t)=>{q();let r=(0,ug.getDatabase)();t?r.run("INSERT OR REPLACE INTO confusion_mastered (group_key, mastered_on) VALUES (?, date('now','localtime'))",[e]):r.run("DELETE FROM confusion_mastered WHERE group_key = ?",[e]),D()},wb=["pair","homophone","kanji-choice","reading-sense","reading-register","stem","synonym","near-synonym"],Ko={pair:{name:"\u81EA\u4ED6\u52A8\u8BCD",Icon:Ie.ArrowLeftRight},homophone:{name:"\u540C\u97F3\u5F02\u4E49",Icon:Ie.Volume2},"kanji-choice":{name:"\u6C49\u5B57\u7528\u6CD5",Icon:Ie.PenLine},"reading-register":{name:"\u8BFB\u97F3\u8BED\u4F53",Icon:Ie.Crown},"reading-sense":{name:"\u4E00\u5F62\u591A\u8BFB",Icon:Ie.Type},stem:{name:"\u540C\u8BCD\u6839",Icon:Ie.Sprout},synonym:{name:"\u9996\u4E49\u76F8\u540C",Icon:Ie.Handshake},"near-synonym":{name:"\u91CA\u4E49\u76F8\u8FD1",Icon:Ie.Handshake}},Se=e=>Lr({kanji:e.kanji??"",kana:e.kana??""}),mg=e=>{if(e.type==="reading-register"||e.type==="reading-sense")return e.members.map(n=>({text:n.kana,reading:""}));let t=e.members.map(Se),r=new Set(t).size!==t.length;return e.members.map((n,o)=>{let s=r&&Li.test(n.kanji);return{text:s?n.kanji:t[o],reading:s?"":n.kana}})},Tb=e=>mg(e).map(t=>t.text).join(" / "),Ri=null,Ar=e=>{if(!Ri){let t=new Map;Je().forEach(r=>{r.members.forEach(n=>{let o=t.get(n.id);o?o.push(r):t.set(n.id,[r])})}),t.forEach(r=>r.sort((n,o)=>Ho.indexOf(n.type)-Ho.indexOf(o.type))),Ri=t}return Ri.get(e)??[]},Sb=()=>{Z("\u8FA8\u6790 \xB7 \u5206\u7EC4\u7D22\u5F15",()=>Ar(0))}});var yb,Nb,pg,Dn,Go,Eg,fg,hi=h(()=>{"use strict";P();Qt();yb={N5:0,N4:1,N3:2,N2:3,N1:4},Nb=2.5,pg=e=>yb[e]??Nb,Dn=null,Go=()=>{Dn=null},Eg=()=>{if(Dn)return Dn;try{Dn=Z("\u8FA8\u6790 \xB7 \u719F\u6089\u5EA6\u7D22\u5F15",()=>new Set(p("SELECT word_id FROM progress WHERE fsrs_last_review IS NOT NULL OR fsrs_due IS NOT NULL").map(e=>Number(e.word_id??0)).filter(e=>e>0)))}catch{Dn=new Set}return Dn},fg=(e,t,r)=>pg(t)<=pg(e)||Eg().has(r)});function Rb(e,t){let r=Array.from(e),n=Array.from(t),o=new Array(n.length+1),s=new Array(n.length+1);for(let i=0;i<=n.length;i+=1)o[i]=i;for(let i=1;i<=r.length;i+=1){s[0]=i;for(let d=1;d<=n.length;d+=1)s[d]=Math.min(o[d]+1,s[d-1]+1,o[d-1]+(r[i-1]===n[d-1]?0:1));let a=o;o=s,s=a}return o[n.length]}function vi(e,t){return e===t?1:Math.max(1-Rb(e,t)/Math.max(Array.from(e).length,Array.from(t).length,1),0)}function Vu(e,t){let r=vi(e,t);return e&&t&&e[0]===t[0]&&(r+=.08),e&&t&&e[e.length-1]===t[t.length-1]&&(r+=.08),Array.from(e).length===Array.from(t).length&&(r+=.06),Math.min(r,1)}function Ju(e){let t=Array.from(e).length;return t<=2?.9:t===3?.82:t===4?.74:.68}function qu(e){let t=Array.from(e).length;return t<=3?1:t<=5?2:3}function _g(e){let t=Number(e.id??0);if(t){let n=zu.get(t);if(n)return n}let r=Ob(e);return t&&zu.set(t,r),r}function Ob(e){let t=String(e.kana??"");if(!t)return[];let r=String(e.pos??"").split("\u30FB")[0],n=Number(e.id??0),o=Array.from(t).length,s=qu(t),i=Ju(t),a=bb(),d=Oi(),u=[];for(let m=o-s;m<=o+s;m+=1){let g=a.get(m);g&&u.push(...g)}let l=String(e.jlpt_level??"");return u.flatMap(m=>{if(m.id===n||d.has(m.id))return[];if(!fg(l,m.jlptLevel,m.id))return[];let g=m.kana;if(g===t)return[];let S=vi(t,g),w=Vu(t,g),y=S*.65+w*.35;return r&&m.pos.includes(r)&&(y+=.04),e.verb_type&&e.verb_type===m.verbType&&(y+=.04),y<i?[]:[{similarity:y,candidate:m}]}).sort((m,g)=>g.similarity-m.similarity||g.candidate.importance-m.candidate.importance).slice(0,3).map(({candidate:m})=>({id:m.id,kana:m.kana,kanji:m.kanji,meaning:m.meaning,kind:"sound"}))}var zu,gg,ki,bb,Lb,Qu,Bo=h(()=>{"use strict";P();rr();hi();Qt();zu=new Map,gg=()=>{zu.clear(),ki=null};ki=null,bb=()=>ki||Z("\u8FA8\u6790 \xB7 \u5019\u9009\u8BCD\u7D22\u5F15",()=>{let e=new Map;for(let t of p("SELECT id, meaning, kana, kanji, pos, verb_type, importance, jlpt_level FROM words")){let r=String(t.kana??"");if(!r)continue;let n=Array.from(r).length,o={id:Number(t.id??0),meaning:String(t.meaning??""),kana:r,kanji:String(t.kanji??""),pos:String(t.pos??""),verbType:t.verb_type,importance:Number(t.importance??0),jlptLevel:String(t.jlpt_level??""),length:n},s=e.get(n);s?s.push(o):e.set(n,[o])}return ki=e,e}),Lb=/[^\u3400-\u9fff]+$/,Qu=(e,t)=>{let r=o=>o.replace(Lb,""),n=r(String(e.kanji??""));return!!n&&n===r(String(t.kanji??""))}});function Tg(e){let t=el.find(d=>d.members.some(u=>Ab(u,e)));if(!t)return vb(e);let r=Number(e.id??0),n=kb(t).filter(d=>d.id!==r),o=wg(e),s=new Set(n.map(d=>d.id)),i=[...n,...o.filter(d=>!s.has(d.id))];if(!i.length)return null;let a=o.some(d=>!s.has(d.id));return{title:t.title,source:"manual",distinction:a?`${t.distinction}\u9898\u9762\u9996\u4E49\u76F8\u540C\u7684\u5176\u4ED6\u8BCD\u4E5F\u5217\u5728\u540E\u9762\uFF0C\u8BF7\u7ED3\u5408\u8BCD\u5F62\u3001\u8BED\u5883\u548C\u8BCD\u6027\u533A\u5206\u3002`:t.distinction,items:i}}var el,Ab,hb,Zu,Ci,kb,wg,vb,Xo=h(()=>{"use strict";P();hr();el=[{id:"mawari-kanji-choice",title:"\u307E\u308F\u308A\uFF1A\u56DE\u308A\uFF0F\u5468\u308A",distinction:"\u56DE\u308A\u662F\u65CB\u8F6C\u3001\u8FD0\u8F6C\u6216\u8F6E\u6B21\uFF1B\u5468\u308A\u662F\u5468\u56F4\u3001\u9644\u8FD1\u7684\u4EBA\u6216\u4E8B\u7269\u3002\u99C5\u306E\u307E\u308F\u308A\uFF08\u8F66\u7AD9\u5468\u56F4\uFF09\u5199\u4F5C\u300C\u99C5\u306E\u5468\u308A\u300D\u3002",members:[["\u56DE\u308A","\u307E\u308F\u308A","\u65CB\u8F6C"],["\u5468\u308A","\u307E\u308F\u308A","\u5468\u56F4\uFF1B\u9644\u8FD1"]]},{id:"honorific-come-go-be",title:"\u6765\uFF0F\u53BB\uFF0F\u5728\uFF08\u5C0A\u656C\u8BED\uFF09",distinction:"\u5F88\u591A\u666E\u901A\u201C\u6765\uFF0F\u53BB\uFF0F\u5728\u201D\u7684\u63D0\u793A\u90FD\u80FD\u5BF9\u5E94\u8FD9\u4E9B\u5C0A\u656C\u8868\u8FBE\uFF1B\u304A\u898B\u3048\u306B\u306A\u308B\u66F4\u504F\u201C\u6765\u5230\u3001\u5230\u573A\u201D\u3002",members:[["\u3044\u3089\u3063\u3057\u3083\u308B","\u3044\u3089\u3063\u3057\u3083\u308B","\u6765\u3001\u53BB\u3001\u5728\uFF08\u5C0A\u656C\u8BED\uFF09"],["\u304A\u3044\u3067\u306B\u306A\u308B","\u304A\u3044\u3067\u306B\u306A\u308B","\u6765\u3001\u53BB\u3001\u5728\uFF08\u5C0A\u656C\u8BED\uFF09"],["\u304A\u898B\u3048\u306B\u306A\u308B","\u304A\u307F\u3048\u306B\u306A\u308B","\u6765\u5230\u3001\u5230\u573A\uFF08\u5C0A\u656C\u8BED\uFF09"]]},{id:"honorific-eat-drink",title:"\u5403\uFF0F\u559D\uFF08\u656C\u8BED\uFF09",distinction:"\u53EC\u3057\u4E0A\u304C\u308B\u62AC\u9AD8\u5BF9\u65B9\uFF1B\u3044\u305F\u3060\u304F\u662F\u81EA\u5DF1\u8C26\u900A\u5730\u5403\u3001\u559D\u6216\u63A5\u53D7\u3002",members:[["\u98DF\u3079\u308B","\u305F\u3079\u308B","\u5403\uFF08\u666E\u901A\u8BF4\u6CD5\uFF09"],["\u53EC\u3057\u4E0A\u304C\u308B","\u3081\u3057\u3042\u304C\u308B","\u5403\u3001\u559D\uFF08\u5C0A\u656C\u8BED\uFF09"],["\u9802\u304F","\u3044\u305F\u3060\u304F","\u5403\u3001\u559D\uFF1B\u5F97\u5230\uFF08\u8C26\u8BA9\u8BED\uFF09"]]},{id:"honorific-say",title:"\u8BF4\uFF08\u656C\u8BED\uFF09",distinction:"\u304A\u3063\u3057\u3083\u308B\u662F\u5BF9\u65B9\u8BF4\uFF1B\u7533\u3059\u662F\u81EA\u5DF1\u8C26\u900A\u5730\u8BF4\u3002\u4E0D\u80FD\u4E92\u76F8\u66FF\u4EE3\u3002",members:[["\u304A\u3063\u3057\u3083\u308B","\u304A\u3063\u3057\u3083\u308B","\u8BF4\uFF08\u5C0A\u656C\u8BED\uFF09"],["\u7533\u3059","\u3082\u3046\u3059","\u8BF4\u3001\u79F0\u4E3A\uFF08\u8C26\u8BA9\u8BED\uFF09"]]},{id:"honorific-see",title:"\u770B\uFF08\u656C\u8BED\uFF09",distinction:"\u3054\u89A7\u306B\u306A\u308B\u62AC\u9AD8\u5BF9\u65B9\uFF1B\u62DD\u898B\u3059\u308B\u964D\u4F4E\u81EA\u5DF1\u3002",members:[["\u3054\u89A7\u306B\u306A\u308B","\u3054\u3089\u3093\u306B\u306A\u308B","\u770B\uFF08\u5C0A\u656C\u8BED\uFF09"],["\u62DD\u898B","\u306F\u3044\u3051\u3093","\u62DC\u89C1\u3001\u89C2\u770B\uFF08\u8C26\u8BA9\u8BED\uFF09"],["\u898B\u308B","\u307F\u308B","\u770B\uFF08\u666E\u901A\u8BF4\u6CD5\uFF09"]]},{id:"open",title:"\u5F00",distinction:"\u958B\u304F\uFF08\u3042\u304F\uFF09\u662F\u4E1C\u897F\u6253\u5F00\uFF1B\u958B\u304F\uFF08\u3072\u3089\u304F\uFF09\u5E38\u7528\u4E8E\u4E66\u3001\u6D3B\u52A8\u3001\u4F1A\u8BAE\uFF1B\u958B\u3051\u308B\u662F\u4EBA\u4E3A\u6253\u5F00\u3002",members:[["\u958B\u304F","\u3042\u304F","\u6253\u5F00\u3001\u5F00\u7740\uFF08\u81EA\u52A8\u8BCD\uFF09"],["\u958B\u304F","\u3072\u3089\u304F","\u6253\u5F00\uFF1B\u5F00\u529E\uFF08\u81EA\u52A8\u8BCD\uFF09"],["\u958B\u3051\u308B","\u3042\u3051\u308B","\u6253\u5F00\uFF08\u4ED6\u52A8\u8BCD\uFF09"]]},{id:"close",title:"\u5173",distinction:"\u9589\u307E\u308B\u662F\u81EA\u5DF1\u5173\u4E0A\uFF1B\u9589\u3081\u308B\u662F\u628A\u67D0\u7269\u5173\u4E0A\u3002",members:[["\u9589\u307E\u308B","\u3057\u307E\u308B","\u5173\u4E0A\uFF08\u81EA\u52A8\u8BCD\uFF09"],["\u9589\u3081\u308B","\u3057\u3081\u308B","\u5173\u4E0A\uFF08\u4ED6\u52A8\u8BCD\uFF09"]]},{id:"turn-on",title:"\u5F00\uFF0F\u4EAE\uFF0F\u63A5\u901A",distinction:"\u3064\u304F\u662F\u81EA\u5DF1\u4EAE\u3001\u63A5\u901A\u6216\u9644\u7740\uFF1B\u3064\u3051\u308B\u662F\u4EBA\u4E3A\u6253\u5F00\u3001\u63A5\u4E0A\u6216\u9644\u7740\u3002",members:[["\u3064\u304F","\u3064\u304F","\u4EAE\uFF1B\u63A5\u901A\uFF1B\u9644\u7740\uFF08\u81EA\u52A8\u8BCD\uFF09"],["\u3064\u3051\u308B","\u3064\u3051\u308B","\u6253\u5F00\uFF1B\u63A5\u4E0A\uFF1B\u9644\u7740\uFF08\u4ED6\u52A8\u8BCD\uFF09"]]},{id:"disappear",title:"\u6D88\u5931\uFF0F\u5173\u6389",distinction:"\u6D88\u3048\u308B\u662F\u81EA\u5DF1\u6D88\u5931\uFF1B\u6D88\u3059\u662F\u4EBA\u4E3A\u6D88\u9664\u6216\u5173\u6389\u3002",members:[["\u6D88\u3048\u308B","\u304D\u3048\u308B","\u6D88\u5931\uFF1B\u7184\u706D\uFF08\u81EA\u52A8\u8BCD\uFF09"],["\u6D88\u3059","\u3051\u3059","\u6D88\u9664\uFF1B\u5173\u6389\uFF08\u4ED6\u52A8\u8BCD\uFF09"]]},{id:"enter-put-in",title:"\u8FDB\u5165\uFF0F\u653E\u5165",distinction:"\u5165\u308B\u662F\u8FDB\u53BB\uFF1B\u5165\u308C\u308B\u662F\u628A\u4E1C\u897F\u653E\u8FDB\u53BB\u3002",members:[["\u5165\u308B","\u306F\u3044\u308B","\u8FDB\u5165\uFF08\u81EA\u52A8\u8BCD\uFF09"],["\u5165\u308C\u308B","\u3044\u308C\u308B","\u653E\u5165\uFF1B\u88C5\u5165\uFF08\u4ED6\u52A8\u8BCD\uFF09"]]},{id:"leave-take-out",title:"\u51FA\u53BB\uFF0F\u62FF\u51FA",distinction:"\u51FA\u308B\u662F\u51FA\u6765\u3001\u51FA\u53BB\uFF1B\u51FA\u3059\u662F\u62FF\u51FA\u3001\u63D0\u4EA4\u6216\u53D1\u51FA\u3002",members:[["\u51FA\u308B","\u3067\u308B","\u51FA\u53BB\uFF1B\u51FA\u6765\uFF08\u81EA\u52A8\u8BCD\uFF09"],["\u51FA\u3059","\u3060\u3059","\u62FF\u51FA\uFF1B\u63D0\u4EA4\uFF1B\u53D1\u51FA\uFF08\u4ED6\u52A8\u8BCD\uFF09"]]},{id:"start",title:"\u5F00\u59CB",distinction:"\u59CB\u307E\u308B\u662F\u4E8B\u60C5\u5F00\u59CB\uFF1B\u59CB\u3081\u308B\u662F\u67D0\u4EBA\u5F00\u59CB\u67D0\u4E8B\u3002",members:[["\u59CB\u307E\u308B","\u306F\u3058\u307E\u308B","\u5F00\u59CB\uFF08\u81EA\u52A8\u8BCD\uFF09"],["\u59CB\u3081\u308B","\u306F\u3058\u3081\u308B","\u5F00\u59CB\u505A\uFF08\u4ED6\u52A8\u8BCD\uFF09"]]},{id:"decide",title:"\u51B3\u5B9A",distinction:"\u6C7A\u307E\u308B\u662F\u88AB\u51B3\u5B9A\u3001\u5B9A\u4E0B\u6765\uFF1B\u6C7A\u3081\u308B\u662F\u4E3B\u52A8\u51B3\u5B9A\u3002",members:[["\u6C7A\u307E\u308B","\u304D\u307E\u308B","\u51B3\u5B9A\u4E0B\u6765\uFF08\u81EA\u52A8\u8BCD\uFF09"],["\u6C7A\u3081\u308B","\u304D\u3081\u308B","\u51B3\u5B9A\uFF08\u4ED6\u52A8\u8BCD\uFF09"]]},{id:"change",title:"\u6539\u53D8",distinction:"\u5909\u308F\u308B\u662F\u53D1\u751F\u53D8\u5316\uFF1B\u5909\u3048\u308B\u662F\u6539\u53D8\u67D0\u7269\u3002",members:[["\u5909\u308F\u308B","\u304B\u308F\u308B","\u53D8\u5316\uFF08\u81EA\u52A8\u8BCD\uFF09"],["\u5909\u3048\u308B","\u304B\u3048\u308B","\u6539\u53D8\uFF08\u4ED6\u52A8\u8BCD\uFF09"]]},{id:"continue",title:"\u7EE7\u7EED",distinction:"\u7D9A\u304F\u662F\u6301\u7EED\uFF1B\u7D9A\u3051\u308B\u662F\u7EE7\u7EED\u505A\u67D0\u4E8B\u3002",members:[["\u7D9A\u304F","\u3064\u3065\u304F","\u6301\u7EED\uFF08\u81EA\u52A8\u8BCD\uFF09"],["\u7D9A\u3051\u308B","\u3064\u3065\u3051\u308B","\u7EE7\u7EED\u505A\uFF08\u4ED6\u52A8\u8BCD\uFF09"]]},{id:"increase",title:"\u589E\u52A0",distinction:"\u5897\u3048\u308B\u662F\u6570\u91CF\u81EA\u7136\u589E\u52A0\uFF1B\u5897\u3084\u3059\u662F\u4EBA\u4E3A\u589E\u52A0\u6570\u91CF\u3002",members:[["\u5897\u3048\u308B","\u3075\u3048\u308B","\u589E\u52A0\uFF08\u81EA\u52A8\u8BCD\uFF09"],["\u5897\u3084\u3059","\u3075\u3084\u3059","\u589E\u52A0\u67D0\u7269\uFF08\u4ED6\u52A8\u8BCD\uFF09"]]},{id:"find",title:"\u627E\u5230",distinction:"\u898B\u3064\u304B\u308B\u662F\u88AB\u627E\u5230\uFF1B\u898B\u3064\u3051\u308B\u662F\u627E\u5230\u67D0\u7269\u3002",members:[["\u898B\u3064\u304B\u308B","\u307F\u3064\u304B\u308B","\u88AB\u627E\u5230\uFF08\u81EA\u52A8\u8BCD\uFF09"],["\u898B\u3064\u3051\u308B","\u307F\u3064\u3051\u308B","\u627E\u5230\uFF08\u4ED6\u52A8\u8BCD\uFF09"]]},{id:"fix-heal",title:"\u4FEE\u597D\uFF0F\u6CBB\u597D",distinction:"\u76F4\u308B\uFF0F\u76F4\u3059\u7528\u4E8E\u7269\u54C1\u3001\u9519\u8BEF\uFF1B\u6CBB\u308B\uFF0F\u6CBB\u3059\u7528\u4E8E\u75BE\u75C5\u3001\u4F24\u75C5\u3002",members:[["\u76F4\u308B","\u306A\u304A\u308B","\u4FEE\u597D\uFF1B\u6539\u6B63\uFF08\u81EA\u52A8\u8BCD\uFF09"],["\u76F4\u3059","\u306A\u304A\u3059","\u4FEE\u7406\uFF1B\u6539\u6B63\uFF08\u4ED6\u52A8\u8BCD\uFF09"],["\u6CBB\u308B","\u306A\u304A\u308B","\u75CA\u6108\uFF08\u81EA\u52A8\u8BCD\uFF09"],["\u6CBB\u3059","\u306A\u304A\u3059","\u6CBB\u597D\uFF08\u4ED6\u52A8\u8BCD\uFF09"]]},{id:"remember-recall",title:"\u8BB0\u5F97\uFF0F\u60F3\u8D77",distinction:"\u899A\u3048\u308B\u662F\u8BB0\u4F4F\u3001\u5B66\u4F1A\uFF1B\u601D\u3044\u51FA\u3059\u662F\u4ECE\u8BB0\u5FC6\u4E2D\u56DE\u60F3\u8D77\u6765\u3002",members:[["\u899A\u3048\u308B","\u304A\u307C\u3048\u308B","\u8BB0\u4F4F\uFF1B\u5B66\u4F1A"],["\u601D\u3044\u51FA\u3059","\u304A\u3082\u3044\u3060\u3059","\u60F3\u8D77\u6765\uFF1B\u56DE\u5FC6\u8D77"]]},{id:"know-understand",title:"\u77E5\u9053\uFF0F\u660E\u767D",distinction:"\u77E5\u308B\u662F\u83B7\u5F97\u4FE1\u606F\uFF1B\u5206\u304B\u308B\u662F\u7406\u89E3\u5185\u5BB9\u6216\u5F04\u660E\u767D\u3002",members:[["\u77E5\u308B","\u3057\u308B","\u77E5\u9053\uFF1B\u5F97\u77E5"],["\u5206\u304B\u308B","\u308F\u304B\u308B","\u660E\u767D\uFF1B\u7406\u89E3"]]},{id:"think-consider",title:"\u60F3\uFF0F\u8003\u8651",distinction:"\u601D\u3046\u504F\u611F\u89C9\u3001\u8BA4\u4E3A\uFF1B\u8003\u3048\u308B\u504F\u601D\u8003\u3001\u8003\u8651\u3002",members:[["\u601D\u3046","\u304A\u3082\u3046","\u60F3\uFF1B\u8BA4\u4E3A"],["\u8003\u3048\u308B","\u304B\u3093\u304C\u3048\u308B","\u601D\u8003\uFF1B\u8003\u8651"]]},{id:"see",title:"\u770B\uFF0F\u770B\u89C1\uFF0F\u7ED9\u770B",distinction:"\u898B\u308B\u662F\u4E3B\u52A8\u770B\uFF1B\u898B\u3048\u308B\u662F\u81EA\u7136\u770B\u5F97\u89C1\uFF1B\u898B\u305B\u308B\u662F\u7ED9\u522B\u4EBA\u770B\u3002",members:[["\u898B\u308B","\u307F\u308B","\u770B"],["\u898B\u3048\u308B","\u307F\u3048\u308B","\u770B\u5F97\u89C1\uFF1B\u6620\u5165\u773C\u5E18"],["\u898B\u305B\u308B","\u307F\u305B\u308B","\u7ED9\u522B\u4EBA\u770B\uFF1B\u5C55\u793A"]]},{id:"hear",title:"\u542C\uFF0F\u542C\u89C1",distinction:"\u805E\u304F\u662F\u4E3B\u52A8\u542C\u6216\u8BE2\u95EE\uFF1B\u805E\u3053\u3048\u308B\u662F\u58F0\u97F3\u81EA\u7136\u4F20\u5165\u8033\u4E2D\u3002",members:[["\u805E\u304F","\u304D\u304F","\u542C\uFF1B\u8BE2\u95EE"],["\u805E\u3053\u3048\u308B","\u304D\u3053\u3048\u308B","\u542C\u5F97\u89C1\uFF1B\u542C\u8D77\u6765"]]},{id:"choose-decide",title:"\u9009\u62E9\uFF0F\u51B3\u5B9A",distinction:"\u9078\u3076\u662F\u4ECE\u5019\u9009\u4E2D\u9009\uFF1B\u6C7A\u3081\u308B\u662F\u4F5C\u51FA\u51B3\u5B9A\u3002",members:[["\u9078\u3076","\u3048\u3089\u3076","\u9009\u62E9"],["\u6C7A\u3081\u308B","\u304D\u3081\u308B","\u51B3\u5B9A"]]},{id:"prepare",title:"\u51C6\u5907",distinction:"\u6E96\u5099\u504F\u4E3A\u4E8B\u60C5\u505A\u51C6\u5907\uFF1B\u7528\u610F\u504F\u51C6\u5907\u5177\u4F53\u7269\u54C1\u3002",members:[["\u6E96\u5099","\u3058\u3085\u3093\u3073","\u51C6\u5907"],["\u7528\u610F","\u3088\u3046\u3044","\u51C6\u5907\u3001\u5907\u597D"]]},{id:"explain-introduce",title:"\u8BF4\u660E\uFF0F\u4ECB\u7ECD",distinction:"\u8AAC\u660E\u662F\u89E3\u91CA\u5185\u5BB9\uFF1B\u7D39\u4ECB\u662F\u628A\u4EBA\u6216\u4E8B\u7269\u4ECB\u7ECD\u7ED9\u522B\u4EBA\u3002",members:[["\u8AAC\u660E","\u305B\u3064\u3081\u3044","\u8BF4\u660E\uFF1B\u89E3\u91CA"],["\u7D39\u4ECB","\u3057\u3087\u3046\u304B\u3044","\u4ECB\u7ECD"]]},{id:"participate-attend",title:"\u53C2\u52A0\uFF0F\u51FA\u5E2D",distinction:"\u53C2\u52A0\u504F\u53C2\u4E0E\u6D3B\u52A8\uFF1B\u51FA\u5E2D\u504F\u51FA\u5E2D\u4F1A\u8BAE\u3001\u8BFE\u7A0B\u7B49\u6B63\u5F0F\u573A\u5408\u3002",members:[["\u53C2\u52A0","\u3055\u3093\u304B","\u53C2\u52A0"],["\u51FA\u5E2D","\u3057\u3085\u3063\u305B\u304D","\u51FA\u5E2D"]]},{id:"experience",title:"\u7ECF\u9A8C\uFF0F\u4F53\u9A8C",distinction:"\u7D4C\u9A13\u504F\u7D2F\u8BA1\u7ECF\u5386\uFF1B\u4F53\u9A13\u504F\u4EB2\u8EAB\u7ECF\u5386\u67D0\u4EF6\u4E8B\u3002",members:[["\u7D4C\u9A13","\u3051\u3044\u3051\u3093","\u7ECF\u9A8C\uFF1B\u7ECF\u5386"],["\u4F53\u9A13","\u305F\u3044\u3051\u3093","\u4EB2\u8EAB\u4F53\u9A8C"]]},{id:"plan-promise",title:"\u8BA1\u5212\uFF0F\u7EA6\u5B9A",distinction:"\u4E88\u5B9A\u662F\u9884\u5B9A\u5B89\u6392\uFF1B\u7D04\u675F\u662F\u548C\u522B\u4EBA\u7EA6\u597D\u6216\u4F5C\u51FA\u627F\u8BFA\u3002",members:[["\u4E88\u5B9A","\u3088\u3066\u3044","\u9884\u5B9A\uFF1B\u8BA1\u5212"],["\u7D04\u675F","\u3084\u304F\u305D\u304F","\u7EA6\u5B9A\uFF1B\u627F\u8BFA"]]},{id:"reason-cause",title:"\u7406\u7531\uFF0F\u539F\u56E0",distinction:"\u539F\u56E0\u662F\u4E8B\u60C5\u53D1\u751F\u7684\u5BA2\u89C2\u539F\u56E0\uFF1B\u7406\u7531\u662F\u4EBA\u505A\u67D0\u4E8B\u7684\u7406\u7531\u3002",members:[["\u539F\u56E0","\u3052\u3093\u3044\u3093","\u539F\u56E0"],["\u7406\u7531","\u308A\u3086\u3046","\u7406\u7531"]]},{id:"safe-relieved",title:"\u5B89\u5168\uFF0F\u653E\u5FC3",distinction:"\u5B89\u5168\u662F\u5BA2\u89C2\u6CA1\u6709\u5371\u9669\uFF1B\u5B89\u5FC3\u662F\u4E3B\u89C2\u611F\u5230\u653E\u5FC3\u3002",members:[["\u5B89\u5168","\u3042\u3093\u305C\u3093","\u5B89\u5168"],["\u5B89\u5FC3","\u3042\u3093\u3057\u3093","\u653E\u5FC3\uFF1B\u5B89\u5FC3"]]},{id:"always-usually",title:"\u603B\u662F\uFF0F\u5E73\u65F6",distinction:"\u3044\u3064\u3082\u504F\u6BCF\u6B21\u3001\u603B\u662F\uFF1B\u666E\u6BB5\u504F\u5E73\u5E38\u72B6\u6001\u3002",members:[["\u3044\u3064\u3082","\u3044\u3064\u3082","\u603B\u662F\uFF1B\u4E00\u76F4"],["\u666E\u6BB5","\u3075\u3060\u3093","\u5E73\u65F6\uFF1B\u5E73\u5E38"]]},{id:"sometimes",title:"\u5076\u5C14\uFF0F\u6709\u65F6",distinction:"\u305F\u307E\u306B\u9891\u7387\u66F4\u4F4E\uFF1B\u3068\u304D\u3069\u304D\u662F\u4E2D\u6027\u7684\u201C\u6709\u65F6\u201D\u3002",members:[["\u305F\u307E\u306B","\u305F\u307E\u306B","\u5076\u5C14"],["\u6642\u3005","\u3068\u304D\u3069\u304D","\u6709\u65F6\uFF1B\u65F6\u5E38"]]},{id:"finally",title:"\u7EC8\u4E8E\uFF0F\u6700\u7EC8",distinction:"\u3084\u3063\u3068\u5F3A\u8C03\u56F0\u96BE\u540E\u5B9E\u73B0\uFF1B\u3068\u3046\u3068\u3046\u5E38\u5E26\u7ED3\u679C\u611F\uFF1B\u3064\u3044\u306B\u8F83\u6B63\u5F0F\u3002",members:[["\u3084\u3063\u3068","\u3084\u3063\u3068","\u7EC8\u4E8E\uFF1B\u597D\u4E0D\u5BB9\u6613"],["\u3068\u3046\u3068\u3046","\u3068\u3046\u3068\u3046","\u7EC8\u4E8E\uFF1B\u6700\u7EC8"],["\u3064\u3044\u306B","\u3064\u3044\u306B","\u7EC8\u4E8E\uFF1B\u6700\u7EC8"]]},{id:"gradually-rapidly",title:"\u9010\u6E10\uFF0F\u4E0D\u65AD",distinction:"\u3060\u3093\u3060\u3093\u662F\u6E10\u53D8\uFF1B\u3069\u3093\u3069\u3093\u662F\u5FEB\u901F\u3001\u8FDE\u7EED\u5730\u53D1\u5C55\u3002",members:[["\u3060\u3093\u3060\u3093","\u3060\u3093\u3060\u3093","\u9010\u6E10"],["\u3069\u3093\u3069\u3093","\u3069\u3093\u3069\u3093","\u4E0D\u65AD\u5730\uFF1B\u5FEB\u901F\u5730"]]},{id:"probably-surely",title:"\u5927\u6982\uFF0F\u4E00\u5B9A",distinction:"\u305F\u3076\u3093\u662F\u4E0D\u786E\u5B9A\u63A8\u6D4B\uFF1B\u304D\u3063\u3068\u662F\u8F83\u5F3A\u786E\u4FE1\u3002",members:[["\u305F\u3076\u3093","\u305F\u3076\u3093","\u5927\u6982\uFF1B\u53EF\u80FD"],["\u304D\u3063\u3068","\u304D\u3063\u3068","\u4E00\u5B9A\uFF1B\u60F3\u5FC5"]]},{id:"properly",title:"\u597D\u597D\u5730\uFF0F\u8BA4\u771F\u5730",distinction:"\u3061\u3083\u3093\u3068\u504F\u53E3\u8BED\uFF1B\u304D\u3061\u3093\u3068\u504F\u6574\u9F50\u89C4\u8303\uFF1B\u3057\u3063\u304B\u308A\u504F\u7262\u56FA\u53EF\u9760\u3002",members:[["\u3061\u3083\u3093\u3068","\u3061\u3083\u3093\u3068","\u597D\u597D\u5730\uFF1B\u786E\u5B9E"],["\u304D\u3061\u3093\u3068","\u304D\u3061\u3093\u3068","\u6574\u9F50\u5730\uFF1B\u89C4\u77E9\u5730"],["\u3057\u3063\u304B\u308A","\u3057\u3063\u304B\u308A","\u7262\u56FA\u5730\uFF1B\u8BA4\u771F\u5730"]]},{id:"for-now",title:"\u59D1\u4E14\uFF0F\u5148",distinction:"\u4E00\u5FDC\u662F\u6700\u4F4E\u9650\u5EA6\u5B8C\u6210\uFF1B\u3068\u308A\u3042\u3048\u305A\u662F\u5148\u505A\u773C\u524D\u7684\u4E00\u6B65\u3002",members:[["\u4E00\u5FDC","\u3044\u3061\u304A\u3046","\u59D1\u4E14\uFF1B\u6682\u4E14"],["\u3068\u308A\u3042\u3048\u305A","\u3068\u308A\u3042\u3048\u305A","\u5148\uFF1B\u6682\u4E14"]]},{id:"on-purpose-special-effort",title:"\u6545\u610F\uFF0F\u7279\u610F",distinction:"\u308F\u3056\u3068\u662F\u6545\u610F\u505A\uFF1B\u308F\u3056\u308F\u3056\u662F\u7279\u610F\u8D39\u529B\u53BB\u505A\u3002",members:[["\u308F\u3056\u3068","\u308F\u3056\u3068","\u6545\u610F"],["\u308F\u3056\u308F\u3056","\u308F\u3056\u308F\u3056","\u7279\u610F\uFF1B\u4E13\u7A0B"]]}],Ab=(e,t)=>{let r=String(t.kanji??""),n=String(t.kana??"");return e[0]===r&&e[1]===n},hb=(e,t)=>String(e.kanji??"")===t[0]&&String(e.kana??"")===t[1],Zu=new Map,Ci=()=>{Zu.clear(),zr()},kb=e=>{let t=Zu.get(e.id);if(t)return t;let r=e.members.flatMap(([i,a])=>[i,a]),n=e.members.map(()=>"(kanji = ? AND kana = ?)").join(" OR "),o=p(`SELECT id, meaning, kana, kanji FROM words WHERE ${n}`,r),s=e.members.flatMap(i=>{let a=o.find(d=>hb(d,i));return a?[{id:Number(a.id??0),kana:String(a.kana??i[1]),kanji:String(a.kanji??i[0]),meaning:String(a.meaning??i[2]),note:i[2],manual:!0}]:[]});return Zu.set(e.id,s),s},wg=e=>{let t=tl(Number(e.id??0));if(!t.length)return[];let r=t.map(()=>"?").join(", ");return p(`SELECT id, meaning, kana, kanji FROM words WHERE id IN (${r})`,t).map(n=>({id:Number(n.id??0),kana:String(n.kana??""),kanji:String(n.kanji??""),meaning:String(n.meaning??""),note:String(n.meaning??""),manual:!1}))},vb=e=>{let t=Vr(Number(e.id??0)),r=wg(e);return!t||!r.length?null:{title:`\u9898\u9762\u9996\u4E49\u76F8\u540C\uFF1A${t}`,distinction:"\u8FD9\u4E9B\u8BCD\u5728\u9898\u9762\u663E\u793A\u7684\u9996\u4E49\u76F8\u540C\uFF0C\u90FD\u53EF\u80FD\u662F\u5408\u7406\u7B54\u6848\uFF1B\u8BF7\u7ED3\u5408\u65E5\u8BED\u8BCD\u5F62\u3001\u8BED\u5883\u548C\u8BCD\u6027\u533A\u5206\u3002",source:"auto",items:r}}});var Mi=le((FI,yg)=>{var Sg=require("../shared/content-store"),Di=(e,t)=>{let r=Sg[e];for(let n of t)r=r?.[n];return r},Ii=(e,t,r="object")=>{let n=r==="array"?[]:{};return new Proxy(n,{get(o,s,i){if(s==="__esModule")return!1;if(s==="default"&&t.length===0)return Ii(e,t,r);let a=Di(e,[...t,s]);return a===void 0?r==="array"&&s in n?Reflect.get(n,s,i):Sg[e]==null?Ii(e,[...t,s]):void 0:a&&typeof a=="object"?Ii(e,[...t,s],Array.isArray(a)?"array":"object"):a},has(o,s){if(r==="array"&&s==="length")return!0;let i=Di(e,t);return!!i&&typeof i=="object"&&s in i},ownKeys(){let o=Di(e,t);return o&&typeof o=="object"?Reflect.ownKeys(o):r==="array"?["length"]:[]},getOwnPropertyDescriptor(o,s){let i=Di(e,t);if(r==="array"&&s==="length")return Object.getOwnPropertyDescriptor(i&&typeof i=="object"?i:n,"length");if(!i||typeof i!="object")return;let a=Object.getOwnPropertyDescriptor(i,s);return a?{...a,configurable:!0}:void 0}})};yg.exports=(e,t)=>Ii(e,[],t)});var Rg=le((WI,Ng)=>{Ng.exports=Mi()("kanjiVariants")});var Lg,bg=h(()=>{Lg={\u30C1\u30A7\u30C3\u30AF:"check",\u30B3\u30D4\u30FC:"copy",\u30D7\u30EC\u30BC\u30F3\u30C8:"present",\u30AB\u30FC\u30C6\u30F3:"curtain",\u30B3\u30F3\u30AF\u30EA\u30FC\u30C8:"concrete",\u30B5\u30A4\u30BA:"size",\u30B5\u30FC\u30D3\u30B9\u30BB\u30F3\u30BF\u30FC:"service center",\u30B7\u30E5\u30FC\u30C8:"shoot",\u30CE\u30FC\u30C8:"note",\u30D1\u30F3\u30AF:"puncture / punk",\u30D4\u30AF\u30CB\u30C3\u30AF:"picnic",\u30D4\u30B6:"pizza",\u30D5\u30EA\u30FC\u30BA:"freeze",\u30D6\u30ED\u30FC\u30C1:"brooch",\u30D7\u30E9\u30B9\u30C1\u30C3\u30AF:"plastic",\u30E1\u30FC\u30C8\u30EB:"metre",\u30E9\u30B8\u30AA:"radio",\u30B7\u30F3\u30D7\u30EB:"simple",\u30B8\u30E3\u30B9\u30DF\u30F3\u8336:"jasmine",\u30C9\u30E9\u30DE:"drama",\u751F\u7523\u30B3\u30B9\u30C8:"cost",\u30B5\u30F3\u30C0\u30EB:"sandal",\u30AD\u30E3\u30F3\u30D7:"camp",\u30AF\u30E9\u30B9:"class",\u30AF\u30EC\u30B8\u30C3\u30C8\u30AB\u30FC\u30C9:"credit card",\u30B3\u30FC\u30D2\u30FC:"coffee",\u30B3\u30F3\u30B5\u30FC\u30C8:"concert",\u30B4\u30FC\u30EB\u30C7\u30F3\u30A6\u30A3\u30FC\u30AF:"Golden Week",\u30B8\u30E7\u30AE\u30F3\u30B0:"jogging",\u30B9\u30A4\u30C3\u30C1:"switch",\u30BF\u30A4\u30E0\u30B5\u30FC\u30D3\u30B9:"time service",\u30C6\u30FC\u30D7:"tape",\u30C7\u30B6\u30A4\u30CA\u30FC:"designer",\u30D1\u30B9\u30DD\u30FC\u30C8:"passport",\u30D5\u30A1\u30C3\u30AF\u30B9:"fax",\u30D9\u30C3\u30C9:"bed",\u30DB\u30FC\u30E0\u30D1\u30FC\u30C6\u30A3\u30FC:"home party",\u30A2\u30D1\u30FC\u30C8:"apartment",\u30A2\u30E1\u30EA\u30AB\u4EBA:"American",\u751F\u30D3\u30FC\u30EB:"beer",\u30AA\u30FC\u30B9\u30C8\u30E9\u30EA\u30A2\u4EBA:"Australian",\u30A2\u30E1\u30EA\u30AB:"America",\u30C7\u30A3\u30BA\u30CB\u30FC\u30E9\u30F3\u30C9:"Disneyland",\u30A8\u30EC\u30D9\u30FC\u30BF\u30FC:"elevator",\u30B9\u30B1\u30B8\u30E5\u30FC\u30EB:"schedule",\u30C1\u30FC\u30E0:"team",\u793E\u4EA4\u30C0\u30F3\u30B9:"dance"}});var nl={};x(nl,{resetUserQuestionMeanings:()=>zo,saveUserQuestionMeaning:()=>rl,userQuestionMeaning:()=>xi,userQuestionMeaningCount:()=>Db});var Og,Yo,zo,Ag,xi,Db,rl,In=h(()=>{"use strict";Og=N($(),1);P();Yo=null,zo=()=>{Yo=null},Ag=()=>{if(Yo)return Yo;let e=new Map;try{p("SELECT word_id, prompt_meaning FROM word_question_meanings").forEach(t=>{let r=Number(t.word_id??0),n=String(t.prompt_meaning??"").trim();r&&n&&e.set(r,n)})}catch{}return Yo=e,e},xi=e=>Ag().get(e),Db=()=>Ag().size,rl=(e,t)=>{let r=(0,Og.getDatabase)(),n=t.trim();return n?r.run(`INSERT INTO word_question_meanings (word_id, prompt_meaning, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(word_id) DO UPDATE SET
         prompt_meaning = excluded.prompt_meaning,
         updated_at = excluded.updated_at`,[e,n]):r.run("DELETE FROM word_question_meanings WHERE word_id = ?",[e]),Yo=null,n}});var Fi=le((PI,vg)=>{var sl=require("../shared/content-store"),kg=(e,t)=>`${e}\0${t}`,ol=null,Ui=null,hg=()=>(Ui===sl.questionMeanings||(Ui=sl.questionMeanings,ol=Ui?new Map(Ui.map(e=>[kg(e.kanji,e.kana),e.questionMeaning])):null),ol);vg.exports={reviewedQuestionMeaning:(e,t)=>hg()?hg().get(kg(e,t)):void 0,reviewedQuestionMeaningEntries:()=>sl.questionMeanings||[]}});var ll={};x(ll,{buildKanjiComponents:()=>$g,buildVerbPair:()=>Pg,hasKanjiText:()=>Xb,honorificLabel:()=>Kg,isFavorite:()=>Gg,isKanji:()=>ul,mistakeScore:()=>Bg,primaryMeaning:()=>Hg,promptMeaning:()=>xn,questionMeaning:()=>Mn,rowObjectToCard:()=>re});function Wb(e,t,r){if(!/[\u30a0-\u30ff]/.test(`${e}${t}`))return"";let n=Dg[e]||Dg[t];if(n)return n;let o=/^\s*[（(\[]\s*(?:法|フ|仏|德|独|オ|蘭|葡|ポ|伊|イ|露|ロ)\s*[）)\]]/;return/[A-Za-z]/.test(e)?e.split(/[；;]/).find(s=>/[A-Za-z]/.test(s)&&!o.test(s))?.trim()??"":o.test(r)?"":r.match(/[A-Za-z]+(?:[ .'-]+[A-Za-z]+)*/)?.[0]?.replace(/[ .;,-]+$/,"")??""}function jb(e){let t=e.replace(/[Ａ-Ｚ]/g,r=>String.fromCharCode(r.charCodeAt(0)-65248));return t.length>=2&&t.length<=4&&t===t.toUpperCase()}function $b(e){return/[A-ZＡ-Ｚ]/.test(e)}function Wg(e){return e.replace(Ub,(t,r,n)=>{let o=r>0?n[r-1]:"",s=r+t.length<n.length?n[r+t.length]:"";return t.length<=4&&$b(t)&&Fb.test(`${o}${s}`)||jb(t)?t:""})}function jg(e){return e.replace(Kb,t=>{let r=il.test(t)||/[A-Za-zＡ-Ｚａ-ｚ]/.test(t),n=/[「『“"]\s*[」』”"]/.test(t);return r||n?"":t}).replace(/[「『]\s*[」』]/g,"").replace(/([。．；;，,、])[；;，,、]+/g,"$1")}function Bb(e){return e.replace(/[（(［〔\[][^（(）)［\]〔〕]*[）)］〕\]]/g,t=>il.test(t)?"":t).replace(/[「『“][^「」『』“”]*[」』”]/g,t=>il.test(t)?"":t).replace(Gb,"").replace(/[（(［〔\[]\s*[）)］〕\]]/g,"").replace(/[「『]\s*[」』]/g,"").replace(/([；;，,、])[；;，,、]+/g,"$1").replace(/^[\s；;，,、.:：/·]+/,"").replace(/[；;，,、\s]+$/,"").trim()}function Mn(e,t="",r="",n=0){let o=n?xi(n):void 0;if(o)return o;let s=(0,dl.reviewedQuestionMeaning)(t,r);return s||Bb(jg(Wg(e))).replace(/[（(\[]\s*(?:英|美)\s*[）)\]]/g,"").replace(/[（(]\s*[）)]/g,"").replace(/\s*([；;，,])\s*/g,"$1").replace(/^[\s；;，,、.:：/]+/,"").replace(/[；;，,、\s]+$/,"").trim()}function ul(e){return e>="\u4E00"&&e<="\u9FFF"}function Xb(e){return Array.from(e).some(ul)}function $g(e){let t=new Set;return Array.from(e).flatMap(r=>{if(!ul(r)||t.has(r))return[];t.add(r);let n=xb[r]??r;return[{char:r,simplified:n,marked:n!==r,source:"auto"}]})}function Yb(e,t,r){let n=e.prepare(`
    SELECT kana, kanji, meaning
    FROM words
    WHERE kana = ? OR kanji = ?
    ORDER BY CASE WHEN kanji = ? THEN 0 ELSE 1 END
    LIMIT 1
  `);try{if(n.bind([r,t,t]),!n.step())return null;let o=n.getAsObject(),{kana:s,kanji:i,meaning:a}=o;return{kana:String(s??r),kanji:String(i??t),meaning:String(a??"")}}finally{n.free()}}function Pg(e,t,r){let n=t in Cg?t:!t||t===r?r:"",o=Cg[n];if(!o)return null;let[s,i,a]=o,d=Yb(e,i,a);return{voice:s,pairVoice:s==="\u4ED6\u52A8\u8BCD"?"\u81EA\u52A8\u8BCD":"\u4ED6\u52A8\u8BCD",kana:d?.kana??a,kanji:d?.kanji??i,meaning:d?.meaning??""}}function Hg(e){for(let t of["\uFF1B",";","\uFF0C"])if(e.includes(t))return e.split(t,1)[0].trim();return e.trim()}function xn(e,t,r,n=""){let o=xi(t);if(o)return o;if(Ig[t])return Ig[t];let s=(0,dl.reviewedQuestionMeaning)(r,n);if(s)return s;if(Mg[r])return Mg[r];let i=e.trim();if(!i)return"";let d=i.split(/[；;，,]/).map(l=>l.trim()).filter(Boolean).slice(0,3)[0]||i;d=d.replace(/^[⓪①②③④⑤⑥⑦⑧⑨⑩]+/,"").trim();let u="";for(;u!==d;)u=d,d=d.replace(/^[（(][^）)]{1,40}[）)]/,"").trim();if(d=jg(Wg(d)).trim(),d=d.replace(/^[〈《][^〉》]{1,20}[〉》]/,"").trim(),d.includes("\u3002")&&(d=d.split("\u3002",1)[0].trim()),r&&r.length<=5&&!/[ぁ-ゟァ-ヿA-Za-z〜～]/.test(r)){let l="";Array.from(d).some((c,f)=>c!==Array.from(r)[f]?!0:(l+=c,!1)),l.length>=2&&(d=l)}return d.slice(0,8)}function Kg(e,t=""){return/(謙譲語|謙讓語|谦让语|谦让|謙讓)/.test(e)?"\u8C26\u8BED":/(谦称|謙称|謙稱)/.test(e)?"\u8C26\u79F0":e.includes("\u81EA\u8C26")?"\u81EA\u8C26":/(敬语|敬語|尊敬表达|尊敬語|敬称|敬意|对外敬语)/.test(e)?"\u656C\u8BED":zb[t]??""}function Gg(e,t){let r=(0,al.getDatabase)().prepare("SELECT 1 FROM content_favorites WHERE item_type = ? AND item_id = ? LIMIT 1");try{return r.bind([e,String(t)]),r.step()}finally{r.free()}}function Bg(e){let t=Number(e.forgot_count??0)*2+Number(e.fuzzy_count??0),r=t+Number(e.right_count??0);if(r===0)return 0;let n=Math.min(Number(e.mistake_streak??0)*.08,.32);return Math.min(t/r+n,1)}function re(e){let t=Number(e.id??e.word_id??0),r=String(e.meaning??""),n=String(e.kana??""),o=String(e.kanji||n),s=Number(e.importance??3),i=Bg(e),a={id:t,meaning:r,questionMeaning:Mn(r,o,n,t),primaryMeaning:Hg(r),promptMeaning:xn(r,t,o,n),honorificLabel:Kg(r,o),kana:n,kanji:o,englishOrigin:Wb(o,n,r),pos:String(e.pos??""),jlptLevel:String(e.jlpt_level??""),importance:s,importanceScore:Math.round(Math.min(Math.max(s*1.4+i*3,0),10)*10)/10,isFavorite:Gg("word",t),note:String(e.note??""),example:{jp:String(e.example_jp??""),meaning:String(e.example_meaning??""),furigana:Fo(e.example_furigana),tokens:Ku(e.example_tokens,String(e.example_jp??""),e.example_lemmas)},kanjiComponents:$g(o),conjugations:e.verb_type?[{label:"\u52A8\u8BCD\u7C7B\u578B",value:Mb(String(e.verb_type))}]:[],verbPair:Pg((0,al.getDatabase)(),o,n)};return xg(a,"confusions",()=>_g(e)),xg(a,"similarMeaning",()=>Tg(e)),a}var al,Ug,Fg,dl,Ib,Mb,xb,Cg,Dg,Ub,Fb,Pb,Hb,Kb,il,Gb,Ig,Mg,zb,xg,St=h(()=>{"use strict";al=N($(),1);Ti();Bo();Xo();Ug=N(Rg(),1),Fg=N(Or(),1);bg();In();dl=N(Fi(),1),Ib={godan:"\u4E00\u7C7B\u52A8\u8BCD\uFF08\u4E94\u6BB5\uFF09",iku:"\u4E00\u7C7B\u52A8\u8BCD\uFF08\u4E94\u6BB5\uFF09",ichidan:"\u4E8C\u7C7B\u52A8\u8BCD\uFF08\u4E00\u6BB5\uFF09",suru:"\u4E09\u7C7B\u52A8\u8BCD\uFF08\u30B5\u53D8\uFF09",kuru:"\u4E09\u7C7B\u52A8\u8BCD\uFF08\u30AB\u53D8\uFF09"},Mb=e=>Ib[e]??e,xb=Ug.default.japanese_to_simplified??{},Cg=Object.fromEntries(Object.entries(Fg.default).flatMap(([e,t])=>t.length<4?[]:[[e,[t[0],t[1],t[2],t[3]]]])),Dg=Lg,Ub=/[A-Za-zＡ-Ｚａ-ｚ]+/g,Fb=/[\u3400-\u9fff]/;Pb='(?:[\u300C\u300E\u201C"][^\u300C\u300D\u300E\u300F\u201C\u201D"]*[\u300D\u300F\u201D"]|[\uFF08(\uFF3B\u3014][^\uFF08()\uFF09\uFF3B\\]\u3014\u3015]*[\uFF09)\uFF3D\u3015]|[\u3041-\u3096\u309D\u309E\u30A1-\u30FA\u30FC\u30FD\u30FE\uFF66-\uFF9F\u30FB]+|[A-Za-z\uFF21-\uFF3A\uFF41-\uFF5A]+|[\xB7\\s])*',Hb="(?:\u7701\u7565|\u7E2E\u7565|\u7F29\u7565|\u7B80\u79F0|\u7C21\u79F0|\u7565\u79F0|\u7565\u8A9E|\u7565\u8BED|\u7F29\u5199|\u7E2E\u5199|\u7565)(?:\u8BED|\u8A9E|\u8BCD|\u8A5E)?",Kb=new RegExp(`${Pb}(?:\u7684|\u306E|\u4E4B)\\s*${Hb}`,"g");il=/[ぁ-ゖゝゞァ-ヺーヽヾｦ-ﾟ]/,Gb=/[ぁ-ゖゝゞァ-ヺーヽヾｦ-ﾟ]+/g;Ig={596:"\u656C\u79F0",750:"\u804C\u4E1A\u8005",847:"\u5BF9\u8C61\u5730\u70B9",952:"\u5929\u5987\u7F57",1519:"\u5E97\u94FA\u4EBA\u5458",1528:"\u6536\u4FE1\u5730\u5740",2008:"\u79CD\u7C7B\u6570",2084:"\u5E72\u70B8\u98DF\u54C1",2138:"\u64CD\u4F5C",2280:"\u4E8B\u60C5\u4EF6\u6570",2303:"\u6CD5\u56FD",2340:"\u5361\u4E01\u8F66",2358:"\u4F53\u80B2\u4E2D\u5FC3",2379:"\u513F\u7AE5\u8282",2392:"\u805A\u4F1A",2398:"\u5E7F\u5C9B",2401:"\u7EF4\u751F\u7D20\u5242",2425:"\u9AD8\u7EA7\u516C\u5BD3",2428:"\u90AE\u7BB1\u5730\u5740",2446:"\u6635\u79F0\u540E\u7F00",2464:"\u4E0D\u4E45",2480:"\u5927\u697C",2494:"\u8DEF\u4E0A\u5C0F\u5FC3",2495:"\u8BF7\u591A\u5173\u7167",2519:"\u6253\u5DE5",2524:"\u5404\u79CD\u5404\u6837",2525:"\u795E\u6237",2539:"\u5A01\u58EB\u5FCC",2579:"\u6839\u636E",2582:"\u541B\u79F0",2624:"\u5404\u79CD\u5404\u6837"},Mg={\u8B1B\u5EA7:"\u8BB2\u5EA7",\u7DD1\u8336:"\u7EFF\u8336",\u8272\u925B\u7B46:"\u5F69\u8272\u94C5\u7B14",\u5BCC\u58EB\u5C71:"\u5BCC\u58EB\u5C71",\u5730\u5473:"\u6734\u7D20",\u6D3E\u624B:"\u82B1\u54E8",\u521D\u8A63:"\u65B0\u5E74\u53C2\u62DC"};zb={\u3044\u3089\u3063\u3057\u3083\u308B:"\u656C\u8BED",\u304A\u3063\u3057\u3083\u308B:"\u656C\u8BED",\u306A\u3055\u308B:"\u656C\u8BED",\u304F\u3060\u3055\u308B:"\u656C\u8BED",\u3054\u89A7\u306B\u306A\u308B:"\u656C\u8BED",\u304A\u3044\u3067\u306B\u306A\u308B:"\u656C\u8BED",\u304A\u8D8A\u3057\u306B\u306A\u308B:"\u656C\u8BED",\u304A\u53EC\u3057\u306B\u306A\u308B:"\u656C\u8BED",\u53EC\u3057\u4E0A\u304C\u308B:"\u656C\u8BED",\u4F3A\u3046:"\u8C26\u8BED",\u53C2\u308B:"\u8C26\u8BED",\u7533\u3059:"\u8C26\u8BED",\u7533\u3057\u4E0A\u3052\u308B:"\u8C26\u8BED",\u9802\u304F:"\u8C26\u8BED",\u3044\u305F\u3060\u304F:"\u8C26\u8BED",\u5DEE\u3057\u4E0A\u3052\u308B:"\u8C26\u8BED",\u81F4\u3059:"\u8C26\u8BED",\u304A\u308B:"\u8C26\u8BED",\u5B58\u3058\u308B:"\u8C26\u8BED",\u5B58\u3058\u4E0A\u3052\u308B:"\u8C26\u8BED",\u62DD\u898B:"\u8C26\u8BED",\u9802\u6234:"\u8C26\u8BED",\u62DD\u501F:"\u8C26\u8BED",\u304A\u76EE\u306B\u304B\u304B\u308B:"\u8C26\u8BED",\u627F\u308B:"\u8C26\u8BED",\u304B\u3057\u3053\u307E\u308A\u307E\u3057\u305F:"\u8C26\u8BED"};xg=(e,t,r)=>{let n,o=!1;Object.defineProperty(e,t,{enumerable:!0,configurable:!0,get(){return o||(n=r(),o=!0),n}})}});var _l={};x(_l,{displayedPromptKeyOf:()=>fl,displayedPromptPeers:()=>gl,questionMeaningKeyOf:()=>Vr,questionMeaningPeers:()=>tl,resetQuestionMeaningIndex:()=>zr});var cl,zr,Vb,ml,Vr,tl,pl,Jb,El,fl,gl,hr=h(()=>{"use strict";P();St();cl=null,zr=()=>{cl=null,pl=null},Vb=()=>{let e=new Map,t=new Map;return p("SELECT id, kanji, kana, meaning FROM words").forEach(r=>{let n=Number(r.id??0);if(!n)return;let o=String(r.kanji||r.kana||""),s=xn(String(r.meaning??""),n,o,String(r.kana??""));if(!s)return;e.set(n,s);let i=t.get(s);i?i.push(n):t.set(s,[n])}),t.forEach((r,n)=>{r.length<2&&(t.delete(n),e.delete(r[0]))}),{keyByWord:e,wordsByKey:t}},ml=()=>(cl??(cl=Vb()),cl),Vr=e=>ml().keyByWord.get(e),tl=e=>{let t=ml().keyByWord.get(e);return t?(ml().wordsByKey.get(t)??[]).filter(r=>r!==e):[]},pl=null,Jb=()=>{let e=new Map,t=new Map;return p("SELECT id, kanji, kana, meaning FROM words").forEach(r=>{let n=Number(r.id??0);if(!n)return;let o=String(r.kanji||r.kana||""),s=Mn(String(r.meaning??""),o,String(r.kana??""),n)||String(r.meaning??"").trim();if(!s)return;e.set(n,s);let i=t.get(s);i?i.push(n):t.set(s,[n])}),t.forEach((r,n)=>{r.length<2&&(t.delete(n),e.delete(r[0]))}),{keyByWord:e,wordsByKey:t}},El=()=>(pl??(pl=Jb()),pl),fl=e=>El().keyByWord.get(e),gl=e=>{let t=El().keyByWord.get(e);return t?(El().wordsByKey.get(t)??[]).filter(r=>r!==e):[]}});function eL(e){let t=e.map(i=>Number(i.id??i.word_id??0)),r=new Map,n=(i,a)=>{i!==a&&(r.has(i)||r.set(i,new Set),r.has(a)||r.set(a,new Set),r.get(i).add(a),r.get(a).add(i))},o=new Map;e.forEach((i,a)=>{for(let d of Qb(i)){let u=o.get(d)??[];u.push(t[a]),o.set(d,u)}});for(let i of o.values())for(let a=0;a<i.length;a+=1)for(let d=a+1;d<i.length;d+=1)n(i[a],i[d]);for(let i=0;i<e.length;i+=1)for(let a=i+1;a<e.length;a+=1)Zb(e[i],e[a])&&n(t[i],t[a]);let s=new Set(t);return{conflicts:(i,a)=>r.get(i)?.has(a)??!1,has:i=>s.has(i)}}function Vo(e,t,r="forward"){let n=t.map(o=>Number(o.id??o.word_id??0));return Jr?.day===e&&Jr.scope===r&&n.every(o=>Jr.index.has(o))||(Jr={index:eL(t),day:e,scope:r}),Jr.index}var Xg,Un,qb,Qb,Zb,Jr,Yg,Jo=h(()=>{"use strict";Xg=N(Or(),1);Xo();hr();Bo();Un=12,qb=Xg.default,Qb=e=>{let t=String(e.kanji??""),r=String(e.kana??""),n=[];for(let i of[t,r]){let a=i&&qb[i];if(!a)continue;let d=String(a[1]??"");d&&n.push(`vp:${[i,d].sort().join("|")}`)}let o=el.find(i=>i.members.some(([a,d])=>a===t&&d===r||a===r||d===r));o&&n.push(`sm:${o.id}`);let s=Vr(Number(e.id??0));return s&&n.push(`qm:${s}`),n},Zb=(e,t)=>{let r=String(e.kana??""),n=String(t.kana??"");if(!r||!n||Math.abs(Array.from(r).length-Array.from(n).length)>qu(r))return!1;let s=vi(r,n)*.65+Vu(r,n)*.35,i=String(e.pos??"").split("\u30FB")[0];return i&&String(t.pos??"").includes(i)&&(s+=.04),e.verb_type&&e.verb_type===t.verb_type&&(s+=.04),s>=Ju(r)};Jr=null;Yg=()=>{Jr=null}});var nr=le((ZI,qg)=>{var zg="shushugo-progress-updated",Vg="shushugo-today-word-plan-updated",wl=0,Jg=[];qg.exports={PROGRESS_UPDATED_EVENT:zg,TODAY_WORD_PLAN_UPDATED_EVENT:Vg,readTodayWordAudioPlanUpdate:()=>Jg,notifyTodayWordPlanUpdated:e=>{Jg=e;try{globalThis.window.dispatchEvent(new globalThis.Event(Vg))}catch{}},withProgressEventsMuted:e=>{wl+=1;try{return e()}finally{wl-=1}},notifyProgressUpdated:()=>{if(!wl)try{globalThis.window.dispatchEvent(new globalThis.Event(zg))}catch{}}}});var bl={};x(bl,{FSRS_DEFAULT_RETENTION:()=>Sl,FSRS_LEARNING_STEPS:()=>Zg,FSRS_MAX_INTERVAL_DAYS:()=>yl,FSRS_NO_STEPS:()=>Tl,FSRS_RELEARNING_STEPS:()=>e_,FSRS_STUBBORN_RELEARNING_STEPS:()=>t_,GRADUATION_STABILITY_DAYS:()=>i_,LEECH_LAPSE_THRESHOLD:()=>me,MASTERED_INTERVAL_DAYS:()=>Wi,STUBBORN_DAILY_MISTAKES:()=>Me,getScheduler:()=>Nl,intervalDays:()=>s_,isDue:()=>oL,isGraduated:()=>aL,isGraduatedForDay:()=>yt,isLearning:()=>sL,isLeech:()=>iL,isMastered:()=>nL,ratingFor:()=>n_,recordReview:()=>qe,retrievability:()=>Rl});function qe(e,t,r,n={}){let o=n.retention??Sl,s=n.maxInterval??yl,i=n.mode??"normal",d=Nl(o,s,i).repeat(o_(e,r),r)[n_(t,i)].card;return rL(d,r,s)}function Rl(e,t){return Nl().get_retrievability(o_(e,t),t,!1)}function oL(e,t){return qr(e)?new Date(e.due).getTime()<=t.getTime():!0}function yt(e,t){return!qr(e)||e.state===ye.State.Learning||e.state===ye.State.Relearning?!1:new Date(e.due).getTime()>t.getTime()}function sL(e){return qr(e)&&(e.state===ye.State.Learning||e.state===ye.State.Relearning||e.state===ye.State.New)}var ye,Sl,yl,Zg,e_,t_,Me,Tl,me,r_,Qg,Nl,n_,qr,o_,tL,rL,Wi,s_,nL,iL,i_,aL,Pe=h(()=>{"use strict";ye=require("../vendor/ts-fsrs.umd"),Sl=.9,yl=365,Zg=["1m","10m"],e_=["10m","10m"],t_=["10m","10m","30m"],Me=3,Tl=[],me=8,r_=864e5,Qg=new Map,Nl=(e=Sl,t=yl,r="normal")=>{let n=`${e}|${t}|${r}`,o=Qg.get(n);return o||(o=(0,ye.fsrs)({request_retention:e,maximum_interval:t,enable_fuzz:!1,enable_short_term:!0,learning_steps:[...r==="known"?Tl:Zg],relearning_steps:[...r==="known"?Tl:r==="stubborn"?t_:e_]}),Qg.set(n,o)),o},n_=(e,t="normal")=>{switch(e){case"know":return t==="known"?ye.Rating.Easy:ye.Rating.Good;case"fuzzy":return ye.Rating.Hard;case"forgot":return ye.Rating.Again;case"known_forever":return ye.Rating.Easy;default:return ye.Rating.Good}},qr=e=>!!e&&Number.isFinite(e.stability)&&e.stability>0&&!!e.due,o_=(e,t)=>qr(e)?{due:new Date(e.due),stability:e.stability,difficulty:e.difficulty,elapsed_days:0,scheduled_days:0,learning_steps:Number.isFinite(e.steps)?e.steps:0,reps:Number.isFinite(e.reps)?e.reps:1,lapses:Number.isFinite(e.lapses)?e.lapses:0,state:Number.isFinite(e.state)?e.state:ye.State.Review,last_review:new Date(e.lastReview||e.due)}:(0,ye.createEmptyCard)(t),tL=(e,t,r)=>{let n=t.getTime()+r*r_,o=new Date(e).getTime();return new Date(Math.min(o,n)).toISOString()},rL=(e,t,r)=>{let n=e.last_review??t;return{stability:e.stability,difficulty:e.difficulty,due:tL(e.due.toISOString(),n,r),lastReview:n.toISOString(),state:e.state,steps:e.learning_steps,reps:e.reps,lapses:e.lapses}};Wi=180,s_=e=>(new Date(e.due).getTime()-new Date(e.lastReview).getTime())/r_,nL=e=>qr(e)?s_(e)>=Wi:!1;iL=e=>qr(e)&&e.lapses>=me,i_=180,aL=e=>qr(e)&&e.stability>=i_});function $i(e,t,r,n={}){let o=Number(e.seen_count??0)===0,s=Number(e.fsrs_lapses??0),i={score:0,critical:0,importance:Number(e.importance??3)*7,mistake:Math.min(s*10,EL),queue:0,age:Math.min(Lo(e.last_seen_on)*3,30),review:o?0:35,new:0,jitter:n.randomize===!1?0:Math.random()*lL};if(o)i.new=45+Math.min(r,10),i.score=18,i.shuffle=Number(e.shuffle_rank??0)*18,i.importance=Number(e.importance??3)*4;else{let a=Number(e.fsrs_state??0),d=a===1||a===3;i.score=d?cL:e.fsrs_due==null||e.fsrs_stability==null?mL:fL(Number(e.fsrs_stability))}return s>=me&&(i.critical=pL),t!==void 0&&(t<=0?i.queue=45:i.queue=-80-t*25),i}function Pi(e){return Object.values(e).reduce((t,r)=>t+r,0)}var dL,uL,lL,cL,mL,pL,EL,fL,gL,ji,Hi=h(()=>{"use strict";P();Pe();dL=50,uL=30,lL=60,cL=55,mL=50,pL=12,EL=40,fL=e=>dL*Math.max(0,1-Math.log2(1+Math.max(e,0))/Math.log2(1+uL)),gL=1/8,ji=(e,t,r,n=Math.random())=>{if(t<=0)return!1;if(e<=0)return!0;if(r===0)return!1;let o=t/(e+t);return n<Math.max(o,gL)}});var _L,wL,TL,SL,a_,yL,NL,d_,ut,Ll,It,or=h(()=>{"use strict";_L=(e,t)=>e+Math.floor(Math.random()*(t-e+1)),wL=[3,8],TL=[9,14],SL=[16,26],a_=[8,20],yL=5,NL=20,d_=(e,t=_L,r=!1)=>{let n=e>=NL?SL:e>=yL?TL:wL,[o,s]=r?[Math.max(n[0],a_[0]),Math.max(n[1],a_[1])]:n;return t(o,s)},ut=3,Ll=.1,It=e=>e.mistakeStreak>=ut?!0:e.total<=0?!1:e.remaining<=Math.ceil(e.total*Ll)});function Gi(e,t){return e.length?vL(kL(e,t),t.random??Math.random):null}var RL,bL,LL,OL,AL,Ki,hL,kL,vL,Ol=h(()=>{"use strict";Jo();RL=6,bL=.35,LL=2,OL=6,AL=.5,Ki=.7,hL=e=>{let t=e.map(n=>n.recall).sort((n,o)=>n-o);if(!t.length)return 0;let r=Math.floor(t.length/2);return t.length%2?t[r]:(t[r-1]+t[r])/2},kL=(e,t)=>{let r=(s,i)=>s.length?s:i,n=e,o=t.recentIds.slice(0,Un);if(o.length&&(n=r(n.filter(s=>!o.some(i=>t.interference.conflicts(s.id,i))),n)),t.answeredToday<RL&&(n=r(n.filter(s=>!s.isLeech),n),n=r(n.filter(s=>s.recall>=bL),n)),t.wrongStreak>=LL){let s=hL(n);n=r(n.filter(i=>i.recall>=s),n)}return n},vL=(e,t)=>{if(!e.length)return null;let r=[...e].sort((i,a)=>a.score-i.score||i.id-a.id).slice(0,OL),n=r.map((i,a)=>AL**a),o=n.reduce((i,a)=>i+a,0),s=t()*o;for(let i=0;i<r.length;i+=1)if(s-=n[i],s<=0)return r[i];return r[r.length-1]}});var xl={};x(xl,{DUE_SQL:()=>$L,GRAMMAR_FSRS:()=>lt,KANJI_FSRS:()=>Bi,LEECH_DAILY_INTAKE:()=>Il,LEECH_SQL:()=>Yi,MASTERED_SQL:()=>Ee,NOT_MASTERED_SQL:()=>jL,RECENT_LAPSE_HOURS:()=>p_,REVERSE_FSRS:()=>Al,WORD_FSRS:()=>de,backfillFsrsFromHistory:()=>vl,cappedDueCount:()=>Ml,clearFsrsState:()=>m_,ensureFsrsColumns:()=>j,ensureGrammarFsrs:()=>kl,ensureKanjiReadingFsrs:()=>hl,fsrsDueCount:()=>Dl,fsrsDueWordIds:()=>en,fsrsMasteredCount:()=>PL,migrateFullHistoryDailyEasy:()=>Cl,migrateRecentDailyEasyReviews:()=>Xi,plannedDueCount:()=>Wn,readFsrsState:()=>Nt,recallFromRow:()=>Qr,recordFsrsReview:()=>Re,restoreFsrsState:()=>Zr,writeFsrsState:()=>Rt});function j(e=de){let t=(0,Fn.getDatabase)(),r=u_.get(t);if(r||(r=new Set,u_.set(t,r)),r.has(e.table))return;let n=new Set(p(`PRAGMA table_info(${e.table})`).map(s=>String(s.name??""))),o=l_.filter(([s])=>!n.has(s)).map(([s,i])=>`ALTER TABLE ${e.table} ADD COLUMN ${s} ${i}`);o.length&&t.exec(o.join(";")),r.add(e.table)}function Qr(e,t=new Date){let r=c_(e);return r?Rl(r,t):void 0}function Nt(e,t=de){j(t);let r=p(`SELECT ${DL} FROM ${t.table} WHERE ${t.idColumn} = ?`,[e]);return c_(r[0]??null)}function Rt(e,t,r=de){j(r),(0,Fn.getDatabase)().run(`UPDATE ${r.table} SET fsrs_stability = ?, fsrs_difficulty = ?, fsrs_due = ?, fsrs_last_review = ?,
       fsrs_state = ?, fsrs_steps = ?, fsrs_reps = ?, fsrs_lapses = ? WHERE ${r.idColumn} = ?`,[t.stability,t.difficulty,t.due,t.lastReview,t.state,t.steps,t.reps,t.lapses,e])}function hl(){j(Bi)}function kl(){j(lt)}function m_(e,t=de){j(t),(0,Fn.getDatabase)().run(`UPDATE ${t.table} SET ${l_.map(([r])=>`${r} = NULL`).join(", ")}
     WHERE ${t.idColumn} = ?`,[e])}function Zr(e,t,r=de){t?Rt(e,t,r):m_(e,r)}function Re(e,t,r=new Date,n={},o=de){let s=Nt(e,o),i=qe(s,t,r,n);return Rt(e,i,o),i}function vl(){if(j(),O("fsrs_backfilled","")==="1")return{migrated:!1,words:0};let e=p(`
    SELECT r.word_id, r.answer, r.created_at, r.reviewed_on
    FROM reviews r
    JOIN (
      SELECT word_id, reviewed_on, MIN(id) AS mid
      FROM reviews
      GROUP BY word_id, reviewed_on
    ) f ON f.mid = r.id
    ORDER BY r.word_id ASC, r.created_at ASC, r.id ASC
  `),t=(0,Fn.getDatabase)(),r=new Map;for(let o of e){let s=Number(o.word_id),i=new Date(String(o.created_at??o.reviewed_on).replace(" ","T")).getTime();r.has(s)||r.set(s,[]),r.get(s).push({answer:String(o.answer),at:Number.isFinite(i)?i:Date.now()})}let n=0;t.run("BEGIN TRANSACTION");try{for(let[o,s]of r){s.sort((d,u)=>d.at-u.at);let i=null,a=0;for(let d of s){let u=d.at<=a?a+1e3:d.at;a=u,i=qe(i,d.answer,new Date(u))}i&&(Rt(o,i),n++)}t.run("COMMIT")}catch(o){throw t.run("ROLLBACK"),o}return R("fsrs_backfilled","1"),{migrated:!0,words:n}}function Xi(e=new Date,t=ML,r=IL){if(O(r,"")==="1")return{migrated:!1,words:0,reviews:0};j();let n=B(e),{startDay:o}=UL(n,t),s=p(`
    SELECT r.id, r.word_id, r.answer, r.reviewed_on, r.created_at
    FROM reviews r
    JOIN progress p ON p.word_id = r.word_id
    WHERE p.known_forever = 0
    ORDER BY r.word_id ASC, r.id ASC
  `),i=new Map;s.forEach(c=>{let f=Number(c.word_id),m=Number(c.id),g=String(c.answer),S=String(c.reviewed_on??"");!Number.isFinite(f)||!Number.isFinite(m)||!S||(i.has(f)||i.set(f,[]),i.get(f).push({id:m,wordId:f,answer:g,studyDay:S,at:xL(S,c.created_at)}))});let a=new Map,d=0;i.forEach((c,f)=>{let m=new Map;c.forEach(S=>{m.has(S.studyDay)||m.set(S.studyDay,S)}),[...m.values()].some(S=>S.studyDay>=o&&S.studyDay<=n&&S.answer==="know")&&(a.set(f,c),d+=c.length)});let u=(0,Fn.getDatabase)(),l=0;u.run("BEGIN TRANSACTION");try{a.forEach((c,f)=>{let m=new Map;c.forEach(_=>{m.has(_.studyDay)||m.set(_.studyDay,_)});let g=[...c].sort((_,b)=>_.at-b.at||_.id-b.id),S=new Map,w=null,y=0;g.forEach(_=>{if(_.answer==="known_forever"||_.studyDay<o&&m.get(_.studyDay)?.id!==_.id)return;let b=_.studyDay>=o&&_.studyDay<=n,k=m.get(_.studyDay)?.id===_.id,v=S.get(_.studyDay)??0,L=_.answer==="forgot"||_.answer==="fuzzy",I=v+(L?1:0),M=b&&k&&_.answer==="know"?"known":b&&I>=3?"stubborn":"normal",U=_.at<=y?y+1e3:_.at;y=U,w=qe(w,_.answer,new Date(U),{mode:M}),L&&b&&S.set(_.studyDay,I)}),w&&(Rt(f,w),l+=1)}),u.run("COMMIT")}catch(c){throw u.run("ROLLBACK"),c}return R(r,"1"),{migrated:!0,words:l,reviews:d}}function Cl(e=new Date){return Xi(e,WL,FL)}function PL(e=de){return j(e),E(`SELECT COUNT(*) FROM ${e.table} WHERE ${e.eligible} AND ${Ee}`,[],0)}function Dl(e=new Date,t=de){j(t);let r=Nr(t.table);return E(`SELECT COUNT(*) FROM ${t.table}
     WHERE ${t.eligible} AND (fsrs_due IS NULL OR fsrs_due <= ?)
       AND ${r?te(r,`${t.table}.${t.idColumn}`,e,B(),t.table==="grammar_progress"?t.eligible:"1"):"1"}`,[e.toISOString()],0)}function Wn(e=new Date,t=de,r=Il){j(t);let n=Nr(t.table),o=p(`SELECT SUM(COALESCE(fsrs_lapses, 0) < ?) AS normal, SUM(COALESCE(fsrs_lapses, 0) >= ?) AS leech
     FROM ${t.table} WHERE ${t.eligible} AND (fsrs_due IS NULL OR fsrs_due <= ?)
       AND NOT ${n?ce(n,`${t.table}.${t.idColumn}`):"0"}`,[me,me,e.toISOString()])[0];return Number(o?.normal??0)+Math.min(Number(o?.leech??0),r)+De(t,e).length}function Ml(e,t=new Date,r=de){let n=De(r,t).length;return Math.min(Math.max(0,e),Wn(t,r)-n)+n}function en(e,t=new Date,r=de,n=Il){j(r);let o=De(r,t).map(Number),s=Nr(r.table);if(r={...r,eligible:`(${r.eligible}) AND NOT ${s?ce(s,`${r.table}.${r.idColumn}`):"0"}`},e<=0)return o;let i=p(`SELECT ${r.idColumn} AS id FROM ${r.table}
     WHERE ${r.eligible} AND (fsrs_due IS NULL OR fsrs_due <= ?) AND COALESCE(fsrs_lapses, 0) >= ?
     ORDER BY RANDOM() LIMIT ?`,[t.toISOString(),me,n]).map(f=>Number(f.id));if(E(`SELECT COUNT(*) FROM ${r.table}
     WHERE ${r.eligible} AND (fsrs_due IS NULL OR fsrs_due <= ?) AND COALESCE(fsrs_lapses, 0) < ?`,[t.toISOString(),me],0)+i.length>e)return[...p(`SELECT ${r.idColumn} AS id FROM ${r.table}
       WHERE ${r.eligible} AND (fsrs_due IS NULL OR fsrs_due <= ?)
         AND (COALESCE(fsrs_lapses, 0) < ? OR ${r.idColumn} IN (${i.map(()=>"?").join(",")||"NULL"}))
       ORDER BY RANDOM() LIMIT ?`,[t.toISOString(),me,...i,e]).map(f=>Number(f.id)),...o];let d=new Date(t.getTime()-p_*36e5).toISOString(),u=p(`SELECT ${r.idColumn} AS id, COALESCE(fsrs_lapses, 0) AS lapses FROM ${r.table}
     WHERE ${r.eligible}
       AND (fsrs_due IS NULL OR fsrs_due <= ?)
     ORDER BY (fsrs_due IS NULL) DESC,
              (fsrs_lapses > 0 AND fsrs_last_review >= ?) DESC,
              fsrs_due ASC,
              ${r.idColumn} ASC
     LIMIT ?`,[t.toISOString(),d,e*3]),l=[],c=0;for(let f of u){if(l.length>=e)break;if(Number(f.lapses??0)>=me){if(c>=n)continue;c+=1}l.push(Number(f.id))}return[...l,...o]}var Fn,l_,CL,de,Bi,Al,lt,u_,DL,c_,IL,ML,xL,UL,FL,WL,Ee,jL,$L,Yi,p_,Il,ne=h(()=>{"use strict";Fn=N($(),1);P();$e();Te();Pe();l_=[["fsrs_stability","REAL"],["fsrs_difficulty","REAL"],["fsrs_due","TEXT"],["fsrs_last_review","TEXT"],["fsrs_state","INTEGER"],["fsrs_steps","INTEGER"],["fsrs_reps","INTEGER"],["fsrs_lapses","INTEGER"]],CL=`word_id NOT IN (
  SELECT word_id FROM moji_migrated_reviews WHERE activated_on IS NULL
)`,de={table:"progress",idColumn:"word_id",eligible:`known_forever = 0 AND ${ee("progress")} AND ${CL}`},Bi={table:"kanji_reading_memory",idColumn:"word_id",eligible:"1 = 1"},Al={table:"reverse_memory",idColumn:"word_id",eligible:"1 = 1"},lt={table:"grammar_progress",idColumn:"grammar_id",eligible:"known_forever = 0 AND seen_count > 0"},u_=new WeakMap;DL="fsrs_stability, fsrs_difficulty, fsrs_due, fsrs_last_review, fsrs_state, fsrs_steps, fsrs_reps, fsrs_lapses",c_=e=>!e||e.fsrs_stability==null||!e.fsrs_due?null:{stability:Number(e.fsrs_stability),difficulty:Number(e.fsrs_difficulty),due:String(e.fsrs_due),lastReview:String(e.fsrs_last_review??e.fsrs_due),state:e.fsrs_state==null?2:Number(e.fsrs_state),steps:e.fsrs_steps==null?0:Number(e.fsrs_steps),reps:e.fsrs_reps==null?1:Number(e.fsrs_reps),lapses:e.fsrs_lapses==null?0:Number(e.fsrs_lapses)};IL="fsrs_recent_daily_easy_v1",ML=8,xL=(e,t)=>{let r=new Date(`${e}T12:00:00`).getTime();if(t==null||String(t).trim()==="")return r;let n=new Date(String(t).replace(" ","T")).getTime();return Number.isFinite(n)?n:r},UL=(e,t)=>{let r=new Date(`${e}T12:00:00`);return r.setDate(r.getDate()-Math.max(t-1,0)),{startDay:B(r),endDay:e}};FL="fsrs_full_daily_easy_v1",WL=1e4;Ee=`(fsrs_due IS NOT NULL AND fsrs_last_review IS NOT NULL
    AND julianday(fsrs_due) - julianday(fsrs_last_review) >= ${Wi})`,jL=`NOT ${Ee}`,$L="(fsrs_due IS NULL OR fsrs_due <= ?)",Yi=`COALESCE(fsrs_lapses, 0) >= ${me}`;p_=36,Il=10});var Fl={};x(Fl,{NO_REVIEW_LIMIT:()=>E_,autoReviewCap:()=>f_,dailyReviewCap:()=>sr,encoreChunkSize:()=>qo,encoreWeekKey:()=>g_,estimatedMinutesFor:()=>Ul,fatigueDetected:()=>Zo,readEncoreLog:()=>jn,recentReviewAverages:()=>zi,recordEncore:()=>Qo,reviewBacklogCount:()=>BL});function jn(e){let t=g_(e);try{let r=JSON.parse(O("encore_log","{}"));return{weekKey:t,weekCount:r.weekKey===t&&Number(r.weekCount)||0,day:e,dayWords:r.day===e&&Number(r.dayWords)||0}}catch{return{weekKey:t,weekCount:0,day:e,dayWords:0}}}function Qo(e,t){let r=jn(e);R("encore_log",JSON.stringify({weekKey:r.weekKey,weekCount:r.weekCount+1,day:e,dayWords:r.dayWords+t}))}function zi(e=T()){let t=p(`
    SELECT reviewed_on, COUNT(DISTINCT word_id) AS words
    FROM reviews
    WHERE reviewed_on < ? AND reviewed_on >= date(?, '-30 day')
    GROUP BY reviewed_on
  `,[e,e]),r=t.reduce((i,a)=>i+Number(a.words??0),0),n=t.length?r/t.length:0,o=E(`
    SELECT COALESCE(SUM(seconds), 0)
    FROM word_study_time
    WHERE studied_on < ? AND studied_on >= date(?, '-30 day')
  `,[e,e],0),s=r>0&&o>0?Math.min(Math.max(o/r,6),45):GL;return{avgDailyWords:n,secondsPerWord:s}}function sr(e,t=T()){return e===yn?E_:e>0?Math.min(Math.max(Math.floor(e),1),Ao):f_(zi(t).avgDailyWords)}function Zo(e=T()){let t=E("SELECT COUNT(*) FROM reviews WHERE reviewed_on = ?",[e],0);if(t<40)return!1;let r=p("SELECT answer FROM reviews WHERE reviewed_on = ? ORDER BY id DESC LIMIT 20",[e]);if(r.length<20)return!1;let n=a=>a==="forgot"||a==="fuzzy",o=r.filter(a=>n(a.answer)).length/r.length,i=E("SELECT COUNT(*) FROM reviews WHERE reviewed_on = ? AND answer IN ('forgot', 'fuzzy')",[e],0)/t;return o>=.4&&o>=i+.15}var HL,KL,GL,E_,f_,qo,g_,Ul,BL,Mt=h(()=>{"use strict";P();ne();pe();HL=60,KL=150,GL=12,E_=1e9,f_=e=>Math.min(Math.max(Math.round(e*1.5),HL),KL),qo=e=>{if(e<=0)return 0;if(e<=5)return e;let t=Math.ceil(e*.3/5)*5;return Math.min(Math.max(t,5),50,e)},g_=e=>{let t=new Date(`${e}T00:00:00`);t.setDate(t.getDate()-t.getDay());let r=String(t.getMonth()+1).padStart(2,"0"),n=String(t.getDate()).padStart(2,"0");return`${t.getFullYear()}-${r}-${n}`};Ul=(e,t)=>e<=0?0:Math.max(Math.ceil(e*t/60),1);BL=()=>Dl()});var __,w_,T_,S_,y_,N_,$n,R_,Vi,Pn,Ji,es,ts=h(()=>{"use strict";Tt();jr();__=6,w_=4,T_=.2,S_=3,y_=.65,N_=21,$n=(e="p")=>`(
  ${e}.seen_count >= ${__}
  AND (
    ${e}.fsrs_stability IS NULL
    OR ${e}.fsrs_stability < ${N_}
  )
  AND (
    (
      COALESCE(${e}.fsrs_lapses, 0) >= ${w_}
      AND COALESCE(${e}.fsrs_lapses, 0) * 1.0
          / MAX(COALESCE(${e}.fsrs_reps, 0), 1) >= ${T_}
    )
    OR (
      COALESCE(${e}.forgot_count, 0) + COALESCE(${e}.fuzzy_count, 0) >= ${S_}
      AND (
        COALESCE(${e}.forgot_count, 0) * 2.0 + COALESCE(${e}.fuzzy_count, 0)
      ) / MAX(
        COALESCE(${e}.right_count, 0) + COALESCE(${e}.forgot_count, 0) * 2.0 + COALESCE(${e}.fuzzy_count, 0),
        1
      ) >= ${y_}
    )
  )
)`,R_=e=>{let t=d=>Number(e[d]??0)||0;if(t("seen_count")<__)return!1;let r=e.fsrs_stability==null?null:t("fsrs_stability");if(r!==null&&r>=N_)return!1;let n=t("fsrs_lapses"),o=t("fsrs_reps");if(n>=w_&&n/Math.max(o,1)>=T_)return!0;let s=t("forgot_count"),i=t("fuzzy_count"),a=s*2+i;return s+i<S_?!1:a/Math.max(t("right_count")+a,1)>=y_},Vi=(e="w")=>gi(`${e}.jlpt_level`,"words"),Pn=(e="w")=>`${Vi(e)} ASC, ${yo(`${e}.id`)} ASC, ${e}.importance DESC, ABS(RANDOM()) ASC`,Ji=(e={},t="w",r="p")=>{let n=[],o=[],s=e.level??"All",i=e.type??"all";return e.focus==="mistakes"&&n.push($n(r)),s!=="All"&&(s==="Unleveled"?n.push(`(${t}.jlpt_level IS NULL OR ${t}.jlpt_level = '')`):(n.push(`${t}.jlpt_level = ?`),o.push(s))),i==="favorite"?n.push(`EXISTS (
      SELECT 1 FROM content_favorites cf
      WHERE cf.item_type = 'word' AND cf.item_id = CAST(${t}.id AS TEXT)
    )`):i==="noun"?n.push(`(${t}.pos LIKE '%\u540D%' OR ${t}.pos LIKE '%\u540D\u8BCD%')`):i==="verb"?n.push(`(
      ${t}.pos LIKE '%\u52D5%' OR
      ${t}.pos LIKE '%\u52A8\u8BCD%' OR
      ${t}.pos LIKE '%\u81EA\u52A8%' OR
      ${t}.pos LIKE '%\u4ED6\u52A8%' OR
      ${t}.pos LIKE '%\u81EA\u52D5%' OR
      ${t}.pos LIKE '%\u4ED6\u52D5%'
    )`):i==="adjective"?n.push(`(${t}.pos LIKE '%\u5F62%' OR ${t}.pos LIKE '%\u5F62\u5BB9\u8BCD%')`):i==="adverb"&&n.push(`(${t}.pos LIKE '%\u526F%' OR ${t}.pos LIKE '%\u526F\u8BCD%')`),{clause:n.length?` AND ${n.join(" AND ")} `:"",params:o}},es=(e={})=>(e.level??"All")!=="All"||(e.type??"all")!=="all"||e.focus==="mistakes"});function qi(e,t,r="forward"){let n=E("SELECT COUNT(*) FROM reviews WHERE reviewed_on = ? AND direction = ?",[e,r],0),o=p(`SELECT word_id, answer FROM reviews
     WHERE reviewed_on = ? AND direction = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,[e,r,Math.max(t,1)]),s=new Set;for(let a of o){let d=String(a.answer??"");if(d!=="forgot"&&d!=="fuzzy")break;s.add(Number(a.word_id))}let i=s.size;return{answeredToday:n,wordIds:o.map(a=>Number(a.word_id)),wrongStreak:i}}var xt,b_,L_,fe,Qe,Hn,Kn,ir,xe,Ut=h(()=>{"use strict";pe();or();G();xt=()=>Jt(),b_=e=>e==="forward"?"review_queue":`review_queue_${e}`,L_=e=>e==="forward"?"last_answered_word":`last_answered_word_${e}`,fe=(e="forward")=>{try{let t=JSON.parse(O(b_(e),"[]"));return Array.isArray(t)?t.flatMap(r=>{let n=Number(r?.word_id);return Number.isFinite(n)?[{word_id:n,due_after:Math.max(Number(r?.due_after??0),0)}]:[]}):[]}catch{return[]}},Qe=(e,t="forward")=>{R(b_(t),JSON.stringify(e))},Hn=(e,t="forward")=>{Qe(fe(t).flatMap(r=>r.word_id===e?[]:[{word_id:r.word_id,due_after:Math.max(r.due_after-1,0)}]),t)},Kn=(e,t=0,r=!1,n=!1,o="forward")=>{let s=fe(o).filter(i=>i.word_id!==e);s.push({word_id:e,due_after:r?0:d_(t,void 0,n)}),Qe(s,o)},ir=(e,t="forward")=>R(L_(t),String(e)),xe=(e="forward")=>Number(O(L_(e),"0"))||0});var Gn,XL,Wl,O_,jl,YL,zL,$l,VL,A_,JL,Ft,qL,tn,h_,k_,ar,Qi,QL,Pl,kr=h(()=>{"use strict";Gn=N($(),1);pe();St();Qt();Hi();or();Jo();Ol();G();Mt();ne();Te();Pe();ts();jr();$e();Tt();Ut();XL=e=>Qr(e)??Ki,Wl=e=>E("SELECT COUNT(*) FROM stage1_tasks WHERE reviewed_on = ?",[e],0),O_=new WeakMap,jl=e=>E("SELECT COUNT(*) FROM stage1_tasks WHERE reviewed_on = ? AND task_type = 'new'",[e],0),YL=e=>{p(`
    SELECT
      today_reviews.word_id,
      MIN(today_reviews.id) AS first_review_id,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM reviews earlier_reviews
          WHERE earlier_reviews.word_id = today_reviews.word_id
            AND earlier_reviews.reviewed_on < ?
        ) OR ${we("words","today_reviews.word_id")}
        THEN 'review'
        ELSE 'new'
      END AS task_type
    FROM reviews today_reviews
    WHERE today_reviews.reviewed_on = ?
    GROUP BY today_reviews.word_id
    ORDER BY first_review_id ASC
  `,[e,e]).forEach((r,n)=>{(0,Gn.getDatabase)().run(`
      INSERT OR IGNORE INTO stage1_tasks (reviewed_on, word_id, task_type, order_index)
      VALUES (?, ?, ?, ?)
    `,[e,Number(r.word_id),String(r.task_type??"review"),n+1])})},zL=e=>{p(`
    SELECT m.word_id
    FROM moji_migrated_reviews m
    JOIN progress p ON p.word_id = m.word_id
    JOIN words w ON w.id = m.word_id
    WHERE m.activated_on IS NULL
      AND p.known_forever = 0
      AND p.seen_count > 0
      AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?)
    ORDER BY m.priority DESC, p.fsrs_due ASC, w.importance DESC, m.word_id ASC
    LIMIT 30
  `,[A().toISOString()]).forEach(r=>{(0,Gn.getDatabase)().run("UPDATE moji_migrated_reviews SET activated_on = ? WHERE word_id = ?",[e,Number(r.word_id)])})},$l=(e,t={})=>{let r=(0,Gn.getDatabase)(),n=X().includeOptionalExpressions,o=(O_.get(r)??!1)!==n;O_.set(r,n),r.run(`DELETE FROM stage1_tasks WHERE reviewed_on = ? AND word_id IN (
    SELECT t.word_id FROM stage1_tasks t JOIN words w ON w.id=t.word_id
    LEFT JOIN progress p ON p.word_id = w.id
    WHERE t.reviewed_on = ? AND NOT ${oe()}
  )`,[e,e]);let s=r.getRowsModified()>0;if(!t.topUp){let f=Wl(e)>0;if(f&&!s&&!o){Dt(de,"stage1_tasks",e,A(),"review");return}!f&&!s&&E("SELECT 1 FROM reviews WHERE reviewed_on = ? LIMIT 1",[e],0)&&YL(e)}zL(e);let i=E(`SELECT COUNT(*) FROM stage1_tasks WHERE reviewed_on = ? AND task_type = 'review'
      AND NOT ${Gr("words","stage1_tasks.word_id",e)}`,[e],0),a=sr(Pr(),e),d=Math.max(a-i,0),u=E("SELECT COALESCE(MAX(order_index), 0) + 1 FROM stage1_tasks WHERE reviewed_on = ?",[e],1);en(d,A()).map(f=>({word_id:f})).forEach(f=>{r.run(`
      INSERT OR IGNORE INTO stage1_tasks (reviewed_on, word_id, task_type, order_index)
      VALUES (?, ?, 'review', ?)
    `,[e,Number(f.word_id),u]),u+=1}),p(`
    SELECT p.word_id
    FROM progress p
    JOIN words w ON w.id = p.word_id
    LEFT JOIN dictionary_discovered_words d ON d.word_id = p.word_id
    LEFT JOIN (
      SELECT word_id, MIN(reviewed_on) AS first_planned_on
      FROM stage1_tasks
      WHERE task_type = 'new' AND reviewed_on < ?
      GROUP BY word_id
    ) carried ON carried.word_id = p.word_id
    WHERE ${Ne()}
      AND p.word_id NOT IN (SELECT word_id FROM stage1_tasks WHERE reviewed_on = ?)
    ORDER BY
      CASE WHEN d.word_id IS NOT NULL THEN 0 ELSE 1 END,
      ${Vi("w")},
      ${yo("w.id")},
      CASE WHEN carried.word_id IS NOT NULL THEN 0 ELSE 1 END,
      carried.first_planned_on ASC,
      ${Pn("w")}
    LIMIT ?
  `,[e,e,Math.max(xt()-jl(e),0)]).forEach(f=>{r.run(`
      INSERT OR IGNORE INTO stage1_tasks (reviewed_on, word_id, task_type, order_index)
      VALUES (?, ?, 'new', ?)
    `,[e,Number(f.word_id),u]),u+=1}),Dt(de,"stage1_tasks",e,A(),"review")},VL=e=>{let t=E(`
    SELECT COUNT(*)
    FROM stage1_tasks t
    JOIN progress p ON p.word_id = t.word_id
    WHERE t.reviewed_on = ?
      AND t.task_type = 'new'
      AND (${ee()} OR p.known_forever = 1)
  `,[e],0),r=Math.max(xt()-t,0);(0,Gn.getDatabase)().run(`
    DELETE FROM stage1_tasks
    WHERE reviewed_on = ?
      AND task_type = 'new'
      AND word_id IN (
        SELECT word_id
        FROM (
          SELECT
            t.word_id,
            ROW_NUMBER() OVER (ORDER BY t.order_index ASC, t.word_id ASC) AS row_number
          FROM stage1_tasks t
          JOIN progress p ON p.word_id = t.word_id
          WHERE t.reviewed_on = ?
            AND t.task_type = 'new'
            AND NOT ${ee()}
            AND p.known_forever = 0
        )
        WHERE row_number > ?
      )
  `,[e,e,r])},A_="capped-random-v4",JL=e=>{if(O("stage1_plan_version","")===A_)return;E(`
    SELECT COUNT(DISTINCT r.word_id)
    FROM reviews r
    JOIN stage1_tasks t ON t.word_id = r.word_id AND t.reviewed_on = r.reviewed_on
    WHERE t.reviewed_on = ?
  `,[e],0)===0&&((0,Gn.getDatabase)().run("DELETE FROM stage1_tasks WHERE reviewed_on = ?",[e]),Qe([])),R("stage1_plan_version",A_)},Ft=()=>{let e=T();JL(e),$l(e),VL(e)},qL=(e,t)=>p(`
  SELECT w.kanji, w.kana, w.example_jp AS example
  FROM stage1_tasks t
  JOIN words w ON w.id = t.word_id
  JOIN progress p ON p.word_id = t.word_id
  WHERE t.reviewed_on = ?
    AND p.known_forever = 0
    AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?)
  ORDER BY t.order_index ASC, t.word_id ASC
`,[e,t.toISOString()]).map(r=>({kanji:String(r.kanji??""),kana:String(r.kana??""),example:String(r.example??"")})),tn=()=>qL(T(),A()),h_=()=>{let e=new Date(`${T()}T12:00:00`);e.setDate(e.getDate()+1);let t=new Date(e);t.setDate(t.getDate()+1),t.setHours(4,0,0,0);let r=p(`
    SELECT w.kanji, w.kana, w.example_jp AS example
    FROM words w JOIN progress p ON p.word_id = w.id
    WHERE p.known_forever = 0 AND ${ee()}
      AND p.fsrs_due IS NOT NULL AND p.fsrs_due <= ?
      AND ${te("words","p.word_id",t,T(e))}
    ORDER BY p.fsrs_due ASC, w.id ASC
  `,[t.toISOString()]).map(s=>({kanji:String(s.kanji??""),kana:String(s.kana??""),example:String(s.example??"")})),n=xt(),o=p(`
    SELECT w.kanji, w.kana, w.example_jp AS example
    FROM words w JOIN progress p ON p.word_id = w.id
    WHERE ${Ne()}
    ORDER BY ${Pn("w")}
    LIMIT ?
  `,[Math.max(n*4,n)]).map(s=>({kanji:String(s.kanji??""),kana:String(s.kana??""),example:String(s.example??"")}));return[...r,...o]},k_=()=>{let e=T(),t=p(`
    SELECT w.id, w.kana, w.kanji, w.pos, w.verb_type
    FROM stage1_tasks t
    JOIN words w ON w.id = t.word_id
    JOIN progress p ON p.word_id = t.word_id
    WHERE t.reviewed_on = ?
      AND p.known_forever = 0
      AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?)
  `,[e,A().toISOString()]);t.length&&Z("\u9996\u9875\u7A7A\u95F2 \xB7 \u5E72\u6270\u7D22\u5F15",()=>Vo(e,t))},ar=()=>{let e=T();Ft();let t=Wl(e),r=E(`
    SELECT COUNT(DISTINCT t.word_id)
    FROM stage1_tasks t
    JOIN progress p ON p.word_id = t.word_id
    WHERE t.reviewed_on = ?
      AND (p.known_forever = 1 OR (p.fsrs_due IS NOT NULL AND p.fsrs_due > ?))
  `,[e,A().toISOString()],0),n=p(`
    SELECT
      CASE WHEN t.task_type = 'review' THEN 'review' ELSE 'new' END AS lane,
      COUNT(*) AS total,
      COUNT(CASE WHEN p.known_forever = 1 OR (p.fsrs_due IS NOT NULL AND p.fsrs_due > ?) THEN 1 END) AS done
    FROM stage1_tasks t
    LEFT JOIN progress p ON p.word_id = t.word_id
    WHERE t.reviewed_on = ?
    GROUP BY lane
  `,[A().toISOString(),e]),o=s=>{let i=n.find(a=>String(a.lane)===s);return{total:Number(i?.total??0),done:Number(i?.done??0)}};return{completed:Math.min(Number(r??0),t),total:t,newLane:o("new"),reviewLane:o("review")}},Qi=e=>E(`
  SELECT COUNT(*)
  FROM progress p
  WHERE p.known_forever = 0
    AND ${ee()}
    AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?)
    AND ${te("words","p.word_id",A(),e)}
    -- \u8FD8\u6CA1\u8F6E\u5230\u6FC0\u6D3B\u7684\u5BFC\u5165\u8BCD\u4E0D\u7B97\u79EF\u538B,\u5426\u5219\u7EED\u676F\u4F1A\u628A\u51E0\u5343\u4E2A\u5BFC\u5165\u8BCD\u4E00\u6B21\u6027\u5012\u51FA\u6765
    AND p.word_id NOT IN (SELECT word_id FROM moji_migrated_reviews WHERE activated_on IS NULL)
    AND p.word_id NOT IN (SELECT word_id FROM stage1_tasks WHERE reviewed_on = ?)
`,[A().toISOString(),e],0),QL=(e,t)=>{let r=H(`
    SELECT
      w.*,
      p.word_id,
      p.seen_count,
      p.known_forever,
      p.last_seen_on,
      p.right_count,
      p.fuzzy_count,
      p.forgot_count,
      p.mistake_streak,
      p.fsrs_stability,
      p.fsrs_difficulty,
      p.fsrs_last_review,
      p.fsrs_due,
      p.fsrs_lapses,
      p.fsrs_state,
      t.task_type,
      t.order_index,
      EXISTS (SELECT 1 FROM dictionary_discovered_words d WHERE d.word_id=w.id) AS discovered,
      COALESCE(n.note, '') AS note
    FROM stage1_tasks t
    JOIN words w ON w.id = t.word_id
    JOIN progress p ON p.word_id = t.word_id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE t.reviewed_on = ? AND t.word_id = ?
  `,[e,t]);return r?re(r):null},Pl=(e=new Set,t={})=>{let r=t.deterministic===!0,n=T();Z("\u9009\u5361 \xB7 \u4ECA\u65E5\u8BA1\u5212\u68C0\u67E5",Ft);let o=new Map(fe().map(C=>[C.word_id,C.due_after])),s=E(`
    SELECT COUNT(*)
    FROM stage1_tasks t
    JOIN progress p ON p.word_id = t.word_id
    WHERE t.reviewed_on = ?
      AND t.task_type = 'new'
      AND NOT ${ee()}
      AND p.known_forever = 0
  `,[n],0),i=Z("\u9009\u5361 \xB7 \u5019\u9009\u67E5\u8BE2",()=>p(`
    SELECT
      w.id, w.kana, w.kanji, w.pos, w.verb_type, w.importance, w.shuffle_rank,
      p.word_id,
      p.seen_count,
      p.known_forever,
      p.last_seen_on,
      p.right_count,
      p.fuzzy_count,
      p.forgot_count,
      p.mistake_streak,
      -- stability / difficulty / last_review \u4E00\u8D77\u5E26\u4E0A:\u4F18\u5148\u7EA7\u6309 stability \u6392,\u6392\u7247\u5668\u7684
      -- recall \u4E5F\u4ECE\u8FD9\u51E0\u5217\u7B97\u3002\u5C11\u4E86\u5B83\u4EEC recallFromRow \u8FD4\u56DE undefined \u2192 \u6BCF\u5F20\u5361\u90FD\u662F 0.7,
      -- \u5F00\u573A\u51CF\u538B\u548C\u8FDE\u8D25\u4FDD\u62A4\u5728\u6B63\u5411\u8FD9\u6761\u8DEF\u4E0A\u4ECE\u6765\u6CA1\u751F\u6548\u8FC7(2026-09-17 \u67E5\u660E)\u3002
      p.fsrs_stability,
      p.fsrs_difficulty,
      p.fsrs_last_review,
      p.fsrs_due,
      p.fsrs_lapses,
      p.fsrs_state,
      t.task_type,
      t.order_index,
      ${Vi("w")} AS new_level_rank,
      ${yo("w.id")} AS new_tier_rank,
      ${ee()} AS started
    FROM stage1_tasks t
    JOIN words w ON w.id = t.word_id
    JOIN progress p ON p.word_id = t.word_id
    WHERE t.reviewed_on = ?
      AND p.known_forever = 0
      -- \u51E1\u300C\u672C\u5B66\u4E60\u65E5\u5185\u4ECD\u5230\u671F\u300D\u7684\u90FD\u8981\u51FA:\u8FD8\u6CA1\u7B54\u7684\u3001\u4EE5\u53CA\u7B54\u9519/\u65B0\u8BCD\u5B66\u4E60\u4E2D
      -- (\u88AB\u6392\u5230\u51E0\u5206\u949F\u540E\u3001\u4ECD <= \u4ECA\u65E5\u8FB9\u754C)\u7684\u3002\u6BD5\u4E1A(due \u6392\u5230\u660E\u5929+)\u624D\u79FB\u51FA\u5F53\u5929\u3002
      AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?)
  `,[n,A().toISOString()]));Tr("\u5019\u9009\u5361\u6570",i.length);let a=C=>Z("\u9009\u5361 \xB7 \u5361\u7247\u7EC4\u88C5",()=>QL(n,Number(C.id))),d=i.filter(C=>!e.has(Number(C.id))),u=xe(),l=d.find(C=>Number(C.id)===u),c=It({mistakeStreak:Number(l?.mistake_streak??0),remaining:d.length,total:Wl(n)});if(l&&Number(l.mistake_streak??0)>=ut&&(o.get(u)??0)<=0)return a(l);let m=d.length>1&&!c?d.filter(C=>Number(C.id)!==u):d,g=m.filter(C=>String(C.task_type)==="review"),S=m.filter(C=>["new","encore_new"].includes(String(C.task_type))),w=S.filter(C=>!C.started).sort((C,z)=>Number(z.discovered)-Number(C.discovered)||Number(C.new_level_rank)-Number(z.new_level_rank)||Number(C.new_tier_rank)-Number(z.new_tier_rank)||Number(C.order_index)-Number(z.order_index))[0],y=w?S.filter(C=>C===w||C.started):S,_=E(`
    SELECT COUNT(DISTINCT r.word_id)
    FROM reviews r
    JOIN stage1_tasks t ON t.word_id = r.word_id AND t.reviewed_on = r.reviewed_on
    WHERE t.reviewed_on = ?
  `,[n],0),b=qi(n,Un),k=Z("\u9009\u5361 \xB7 \u5E72\u6270\u7D22\u5F15",()=>Vo(n,i)),v=ji(g.length,S.length,_,r?1:void 0),L=C=>b.wordIds.some(z=>k.conflicts(Number(C.id),z)),M=(v&&!(g.length&&y.every(L))?y:g.length?g:y).map(C=>{let z=o.get(Number(C.id))??0,ze=$i(C,o.get(Number(C.id)),s,{randomize:!r});return{score:Pi(ze),dueAfter:z,row:C}});if(!M.length)return null;let U=M.filter(C=>C.dueAfter<=0);if(!U.length)return M.sort((C,z)=>C.dueAfter-z.dueAfter||z.score-C.score),a(M[0].row);let W=new Map(U.map(C=>[C.row,C])),K=Gi(U.map(C=>({id:Number(C.row.id),score:C.score,recall:XL(C.row),isLeech:Number(C.row.fsrs_lapses??0)>=me})),{answeredToday:b.answeredToday,recentIds:b.wordIds,wrongStreak:b.wrongStreak,interference:k,...r?{random:()=>0}:{}});if(!K)return null;let J=[...W.keys()].find(C=>Number(C.id)===K.id);return a(J||U[0].row)}});var v_,vr,Bn,Xn=h(()=>{"use strict";P();v_=N($(),1);at();Te();vr="fsrs-v1",Bn=({wordId:e,answer:t,reviewedOn:r,direction:n,schedulerMode:o="normal",reviewedAt:s=Date.now(),eventSource:i="study"})=>{Ve();let a=(0,v_.getDatabase)();return An("words",e,()=>(a.run(`
      INSERT INTO reviews (
        word_id, answer, score_after, reviewed_on, direction,
        reviewed_at, scheduler_mode, fsrs_params_version, event_source
      ) VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?)
    `,[e,t,r,n,s,o,vr,i]),E("SELECT last_insert_rowid()",[],0)))}});var Zi,C_,Hl,Kl,D_,ea,rs,I_,Gl,M_,x_,Bl,ta=h(()=>{"use strict";G();Zi=2,C_="last_answer",Hl=e=>!!e&&typeof e=="object"&&!Array.isArray(e),Kl=()=>{let e=O(C_,"");if(!e)return[];try{let t=JSON.parse(e);return Hl(t)?[t]:Array.isArray(t)?t.filter(Hl):[]}catch{return[]}},D_=e=>{R(C_,JSON.stringify(e.slice(-Zi)))},ea=e=>{D_([...Kl(),e])},rs=e=>{let t=Kl(),r=t.length?t[t.length-1]:null;return!!r&&r.mode===e&&r.reviewed_on===T()},I_=e=>{if(!rs(e))return null;let t=Kl(),r=t.pop();return D_(t),r},Gl="undo_pinned_card",M_=(e,t)=>{R(Gl,JSON.stringify({word_id:e,mode:t}))},x_=e=>{let t=O(Gl,"");if(!t)return null;try{let r=JSON.parse(t);if(!Hl(r)||r.mode!==e)return null;let n=Number(r.word_id);return Number.isFinite(n)&&n>0?n:null}catch{return null}},Bl=()=>{R(Gl,"")}});var U_,Y,ZL,rn=h(()=>{"use strict";U_=N($(),1);P();Qt();at();G();yr();ne();Y=()=>$r("word-progress",ZL),ZL=()=>{let e=(0,U_.getDatabase)();q(),E("SELECT EXISTS (SELECT 1 FROM words w WHERE NOT EXISTS (SELECT 1 FROM progress p WHERE p.word_id = w.id))",[],1)&&qt(()=>{e.run(`
      INSERT OR IGNORE INTO progress (word_id)
      SELECT id FROM words
    `)}),e.run("UPDATE words SET shuffle_rank = ABS(RANDOM()) / 9223372036854775807.0 WHERE shuffle_rank IS NULL"),O("first_study_day","")||R("first_study_day",T()),Z("\u542F\u52A8 \xB7 \u8BED\u6CD5\u8FDB\u5EA6\u521D\u59CB\u5316",Ce);try{j(),vl(),Xi(),Cl()}catch(r){console.warn("[fsrs] \u5355\u8BCD\u56DE\u586B\u8DF3\u8FC7:",r)}try{hl()}catch(r){console.warn("[fsrs] \u6C49\u5B57\u8BFB\u97F3\u5EFA\u8868\u8DF3\u8FC7:",r)}try{kl()}catch(r){console.warn("[fsrs] \u8BED\u6CD5\u5EFA\u5217\u8DF3\u8FC7:",r)}D()}});var Yl={};x(Yl,{patternAttachment:()=>Xl,patternPieces:()=>eO,splitFormationRules:()=>W_});var W_,j_,$_,F_,eO,tO,rO,Xl,zl=h(()=>{"use strict";W_=e=>{let t=String(e??"").trim();if(!t)return[];let r=t.indexOf("\uFF0F");if(r<=0)return[t];let n=t.slice(0,r).trim(),o=t.slice(r+1).trim();return!n.includes("\uFF0B")||!o.includes("\uFF0B")?[t]:[n,o]},j_=/[～〜~]/,$_=/[～〜~]/g,F_=/[＋+]/,eO=e=>{let t=[],r="";for(let n of String(e??""))j_.test(n)?(r&&t.push({text:r,slot:!1}),r="",t.push({text:n,slot:!0})):r+=n;return r&&t.push({text:r,slot:!1}),t},tO=e=>String(e).split($_).map(t=>t.replace(/^[／/、，,]+|[／/、，,]+$/g,"").trim()).filter(Boolean),rO=(e,t,r)=>{if(!F_.test(e))return null;let n=e.split(F_).map(i=>i.trim()).filter(Boolean),o=n[0]??"";if(!o||j_.test(o))return null;let s=tO(t);if(s.some(i=>o.includes(i)||i.includes(o)))return null;if(r>=2){if(n.length>2||s.length!==r)return null;let i=new Map;if(s.forEach(a=>i.set(a,(i.get(a)??0)+1)),![...i.values()].every(a=>a>=2))return null}return o},Xl=(e,t)=>{let r=String(e??""),n=(r.match($_)??[]).length;if(!n)return null;let o=W_(t).map(s=>rO(s,r,n)).filter(s=>!!s);return o.length?[...new Set(o)].join("\uFF0F"):null}});var nO,P_,H_=h(()=>{"use strict";nO={"\u57FA\u6570\u8A5E\uFF08\u57FA\u6570\u8BCD\uFF09":"\u57FA\u6570\u8A5E","\u5E8F\u6570\u8A5E\uFF08\u5E8F\u6570\u8BCD\uFF09":"\u5E8F\u6570\u8A5E","\u5E38\u7528\u52A9\u6570\u8A5E\uFF08\u91CF\u8BCD\uFF09":"\u5E38\u7528\u52A9\u6570\u8A5E","\u5E38\u7528\u6570\u91CF\u306E\u8AAD\u307F\u65B9\uFF08\u5E38\u7528\u6570\u91CF\u8BFB\u6CD5\uFF09":"\u5E38\u7528\u6570\u91CF\u306E\u8AAD\u307F\u65B9","\u4E09\u985E\u52D5\u8A5E\u306E\u533A\u5206\uFF08\u52A8\u8BCD\u5206\u7C7B\uFF09":"\u4E09\u985E\u52D5\u8A5E\u306E\u533A\u5206","\u81EA\u52D5\u8A5E\u3068\u4ED6\u52D5\u8A5E\uFF08\u81EA\u4ED6\u52A8\u8BCD\uFF09":"\u81EA\u52D5\u8A5E\u3068\u4ED6\u52D5\u8A5E","\u52D5\u8A5E\u300C\u307E\u3059\u5F62\u300D\uFF08\u656C\u4F53\u5F62\uFF09":"\u52D5\u8A5E\u300C\u307E\u3059\u5F62\u300D","\u306A\u5F62\u5BB9\u8A5E\uFF0B\u52D5\u8A5E\uFF08\u526F\u8BCD\u7528\u6CD5\uFF09":"\u306A\u5F62\u5BB9\u8A5E\uFF0B\u52D5\u8A5E","\u3044\u5F62\u5BB9\u8A5E\uFF0B\u52D5\u8A5E\uFF08\u526F\u8BCD\u7528\u6CD5\uFF09":"\u3044\u5F62\u5BB9\u8A5E\uFF0B\u52D5\u8A5E","\uFF5E\u304B\u3089\uFF08\u539F\u56E0\uFF09":"\uFF5E\u304B\u3089","\uFF5E\u304F\u3066\uFF0F\u3067\uFF08\u4E2D\u987F\uFF09":"\uFF5E\u304F\u3066\uFF0F\u3067","\uFF5E\u304F\u3089\u3044\uFF08\u7A0B\u5EA6\uFF09":"\uFF5E\u304F\u3089\u3044","\u53EF\u80FD\u52A9\u52A8\u8BCD\u300C\u308C\u308B\uFF0F\u3089\u308C\u308B\u300D":"\u308C\u308B\uFF0F\u3089\u308C\u308B","\u4F7F\u5F79\u52A9\u52A8\u8BCD\u300C\u305B\u308B\uFF0F\u3055\u305B\u308B\u300D":"\u305B\u308B\uFF0F\u3055\u305B\u308B","\u88AB\u52A8\u52A9\u52A8\u8BCD\u300C\u308C\u308B\uFF0F\u3089\u308C\u308B\u300D":"\u308C\u308B\uFF0F\u3089\u308C\u308B","\u4F7F\u5F79\u88AB\u52A8\u52A9\u52A8\u8BCD\u300C\u3055\u308C\u308B\uFF0F\u3055\u305B\u3089\u308C\u308B\u300D":"\u3055\u308C\u308B\uFF0F\u3055\u305B\u3089\u308C\u308B","\u547D\u4EE4\u52A9\u52A8\u8BCD\u300C\u308C\uFF0F\u308D\u300D":"\u308C\uFF0F\u308D","\u7981\u6B62\u52A9\u52A8\u8BCD\u300C\u306A\u300D":"\u306A","\u656C\u8BED\u52A9\u52A8\u8BCD\u300C\u308C\u308B\uFF0F\u3089\u308C\u308B\u300D":"\u308C\u308B\uFF0F\u3089\u308C\u308B","\uFF5E\uFF08\u3089\uFF09\u308C\u308B\uFF08\u81EA\u767A\uFF09":"\uFF5E\uFF08\u3089\uFF09\u308C\u308B","\u656C\u8A9E\u306E\u7279\u6B8A\u5F62\uFF08\u7279\u6B8A\u656C\u8BED\u52A8\u8BCD\uFF09":"\u656C\u8A9E\u306E\u7279\u6B8A\u5F62"},P_=e=>nO[e]??e.replace(/（N[1-5]-\d+）$/,"")});var sc={};x(sc,{GRAMMAR_DEFAULT_REVIEW_CAP:()=>B_,GRAMMAR_ENCORE_SIZE:()=>Q_,PLAN_GRAMMAR_LEVEL:()=>bt,extendGrammarQuizPlan:()=>pO,getGrammarQuizSession:()=>zn,grammarAudioPlan:()=>mO,grammarNewQuota:()=>Ql,grammarPlanDone:()=>rc,grammarPlanRemaining:()=>tc,grammarQuizRanking:()=>EO,grammarReviewEntity:()=>ra,grammarReviewPool:()=>os,scopeLevels:()=>Jl,submitGrammarQuizAnswer:()=>nc,undoLastGrammarQuizAnswer:()=>oc});var Yn,dr,oO,bt,Jl,ur,ra,B_,X_,os,sO,iO,aO,Vl,ql,Y_,dO,z_,Ql,K_,uO,na,Zl,ns,G_,lO,cO,V_,ec,J_,q_,tc,rc,mO,zn,nc,oc,Q_,pO,EO,ss=h(()=>{"use strict";Yn=N($(),1);Ti();yr();G();Mt();pe();_t();Tt();Te();ne();Pe();or();Hi();Ut();zl();H_();dr="grammar",oO=/^N[1-5]$/,bt="plan",Jl=e=>e===bt?wr(Nn("grammar")):oO.test(e)?[e]:[],ur=(e,t="g.level")=>{let r=Jl(e);return r.length?`${t} IN (${r.map(n=>`'${n}'`).join(", ")})`:"0"},ra=e=>Jl(e).length?{...lt,eligible:`${lt.eligible}
      AND grammar_id IN (SELECT id FROM grammar_points WHERE ${ur(e,"level")})`}:lt,B_=60,X_=(e,t)=>e===rt?0:e>0?e:Math.min(B_,sr(Pr(),t)),os=(e,t)=>{Ce();let r=ra(e);j(r);let n=A(),o=De(r,n).length;return{due:Wn(n,r),prior:o,review:t==null?0:Ml(X_(t),n,r)}},sO=e=>E(`SELECT COUNT(*) FROM grammar_points WHERE ${ur(e,"level")}`,[],0),iO=(e,t)=>E(`
  SELECT COUNT(DISTINCT r.grammar_id)
  FROM grammar_reviews r
  JOIN grammar_points g ON g.id = r.grammar_id
  WHERE r.reviewed_on = ? AND ${ur(e)}
`,[t],0),aO=(e,t)=>E(`
  SELECT COUNT(DISTINCT r.grammar_id)
  FROM grammar_reviews r
  JOIN grammar_points g ON g.id = r.grammar_id
  WHERE r.reviewed_on = ? AND ${ur(e)}
    AND EXISTS (SELECT 1 FROM grammar_reviews earlier WHERE earlier.grammar_id = r.grammar_id AND earlier.reviewed_on < ?)
`,[t,t],0),Vl=(e,t)=>E(`
  SELECT COUNT(DISTINCT r.grammar_id)
  FROM grammar_reviews r
  JOIN grammar_points g ON g.id = r.grammar_id
  WHERE r.reviewed_on = ? AND ${ur(e)}
    AND NOT EXISTS (
      SELECT 1 FROM grammar_reviews earlier
      WHERE earlier.grammar_id = r.grammar_id AND earlier.reviewed_on < ?
    )
    AND NOT ${we("grammar","r.grammar_id")}
`,[t,t],0),ql=(e,t)=>E(`
  SELECT COUNT(DISTINCT r.grammar_id)
  FROM grammar_reviews r
  JOIN grammar_points g ON g.id = r.grammar_id
  JOIN grammar_progress p ON p.grammar_id = r.grammar_id
  WHERE r.reviewed_on = ? AND ${ur(e)}
    AND (p.known_forever = 1 OR (p.fsrs_due IS NOT NULL AND p.fsrs_due > ?))
`,[t,A().toISOString()],0),Y_=e=>`quiz_encore:${e}`,dO=e=>{try{let t=JSON.parse(E("SELECT value FROM grammar_state WHERE key = ?",[Y_(e)],"")||"null");return!t||typeof t!="object"?{day:"",count:0}:{day:String(t.day??""),count:Math.max(Number(t.count??0)||0,0)}}catch{return{day:"",count:0}}},z_=(e,t)=>{let r=dO(e);return r.day===t?r.count:0},Ql=(e,t=T())=>{let r=Math.max(du()+z_(e,t)-Vl(e,t),0),n=Oo("grammar");return n===null?r:Math.min(r,n)},K_=!1,uO=()=>{K_||(K_=!0,(0,Yn.getDatabase)().run("DELETE FROM grammar_state WHERE key LIKE 'quiz_round:%'"))},na=(e,t)=>{Ce(),j(lt),uO();let r=ot().grammarReviewCap,n=Math.min(X_(r,t),sO(e));if(!/^\d{4}-\d{2}-\d{2}$/.test(t))throw new Error(`bad study day: ${t}`);let o=ra(e),s=`grammar_id IN (SELECT grammar_id FROM grammar_reviews WHERE reviewed_on = '${t}')`,i=A(),a=p(`SELECT grammar_id AS id FROM grammar_progress WHERE ${o.eligible} AND ${s}
       AND (fsrs_due IS NULL OR fsrs_due <= ?)`,[i.toISOString()]).map(f=>Number(f.id)),d=en(Math.max(0,n-aO(e,t)),i,{...o,eligible:`(${o.eligible}) AND NOT ${s}`}),u=[...a,...d.filter(f=>!a.includes(f))],l=Ql(e,t),c=l<=0?[]:p(`
    SELECT g.id
    FROM grammar_points g
    JOIN grammar_progress p ON p.grammar_id = g.id
    WHERE ${ur(e)}
      AND p.seen_count = 0
      AND p.known_forever = 0
    ORDER BY ${gi("g.level","grammar")} ASC, g.sort_order ASC
    LIMIT ?
  `,[l]).map(f=>Number(f.id));return{reviewIds:u,newIds:c}},Zl=`
  g.id, g.pattern, g.formation, g.meaning, g.level,
  g.example_jp, g.example_meaning, g.example_furigana, g.example_tokens, g.example_lemmas,
  COALESCE(p.forgot_count, 0) AS forgot_count,
  COALESCE(p.right_count, 0) AS right_count,
  COALESCE(p.seen_count, 0) AS seen_count,
  COALESCE(p.mistake_streak, 0) AS mistake_streak,
  COALESCE(p.known_forever, 0) AS known_forever
`,ns=e=>{let t=String(e.pattern??""),r=String(e.formation??""),n=String(e.example_jp??""),o=Fo(e.example_furigana);return{id:Number(e.id),question:P_(t),pattern:t,formation:r,attachment:Xl(t,r),meaning:String(e.meaning??""),exampleJp:n,exampleMeaning:String(e.example_meaning??""),exampleFurigana:o,exampleTokens:String(e.example_tokens??""),exampleLemmas:String(e.example_lemmas??""),level:String(e.level??""),forgotCount:Number(e.forgot_count??0),rightCount:Number(e.right_count??0),isNew:Number(e.seen_count??0)===0}},G_=e=>{if(!e.length)return[];let t=e.map(()=>"?").join(","),r=p(`
    SELECT ${Zl}
    FROM grammar_points g
    LEFT JOIN grammar_progress p ON p.grammar_id = g.id
    WHERE g.id IN (${t}) AND COALESCE(p.known_forever, 0) = 0
  `,e),n=new Map(r.map(o=>[Number(o.id),o]));return e.map(o=>n.get(o)).filter(Boolean)},lO=(e,t)=>{let{reviewIds:r,newIds:n}=na(e,t),o=new Map(fe(dr).map(_=>[_.word_id,_.due_after])),s=G_(r),i=G_(n),a=[...s,...i];if(!a.length)return null;let d=xe(dr),u=a.find(_=>Number(_.id)===d);if(u&&Number(u.mistake_streak??0)>=ut&&(o.get(d)??0)<=0)return ns(u);let l=It({mistakeStreak:Number(u?.mistake_streak??0),remaining:a.length,total:a.length+ql(e,t)}),c=a.length>1&&!l?a.filter(_=>Number(_.id)!==d):a,f=c.filter(_=>Number(_.seen_count??0)>0),m=c.filter(_=>Number(_.seen_count??0)===0),g=ji(f.length,m.length,iO(e,t))?m:f.length?f:m,S=g.length?g:c;if(!S.length)return null;let w=S.filter(_=>(o.get(Number(_.id))??0)<=0);if(w.length)return ns(w[0]);let y=[...S].sort((_,b)=>(o.get(Number(_.id))??0)-(o.get(Number(b.id))??0));return ns(y[0])},cO=2,V_=e=>`quiz_undo:${e}`,ec=e=>{try{let t=E("SELECT value FROM grammar_state WHERE key = ?",[V_(e)],"");if(!t)return[];let r=JSON.parse(t);return Array.isArray(r)?r.filter(n=>n?.reviewedOn===T()):[]}catch{return[]}},J_=(e,t)=>{(0,Yn.getDatabase)().run("INSERT OR REPLACE INTO grammar_state (key, value) VALUES (?, ?)",[V_(e),JSON.stringify(t.slice(-cO))])},q_=(e,t)=>{let r=T(),{reviewIds:n,newIds:o}=na(e,r),s=ql(e,r),i=n.length+o.length;return{card:t,level:e,done:s,total:s+i,remaining:i,newDone:Vl(e,r),newQuota:Vl(e,r)+Ql(e,r),canUndo:ec(e).length>0}},tc=(e,t=T())=>{let{reviewIds:r,newIds:n}=na(e,t);return r.length+n.length},rc=(e,t=T())=>ql(e,t),mO=e=>{let{reviewIds:t,newIds:r}=na(e,T()),n=t.length?p(`SELECT g.id FROM grammar_points g JOIN grammar_progress p ON p.grammar_id=g.id
    WHERE ${ur(e)} AND p.known_forever=0 AND p.seen_count>0 AND (p.fsrs_due IS NULL OR p.fsrs_due<=?)
      AND ${te("grammar","p.grammar_id",A(),T(),ra(e).eligible)}`,[A().toISOString()]).map(s=>Number(s.id)):[],o=[...new Set([...n,...r])];return o.length?p(`SELECT example_jp FROM grammar_points WHERE id IN (${o.map(()=>"?").join(",")})`,o).map(s=>String(s.example_jp??"")).filter(Boolean):[]},zn=e=>{let t=T();return q_(e,lO(e,t))},nc=(e,t,r)=>{Ce(),j(lt);let n=(0,Yn.getDatabase)(),o=T(),s=p(`
    SELECT seen_count, known_forever, last_seen_on, right_count, fuzzy_count, forgot_count, mistake_streak
    FROM grammar_progress
    WHERE grammar_id = ?
  `,[t])[0],i={grammarId:t,reviewedOn:o,reviewId:0,seenCount:Number(s?.seen_count??0),knownForever:Number(s?.known_forever??0)===1?1:0,lastSeenOn:s?.last_seen_on==null?null:String(s.last_seen_on),rightCount:Number(s?.right_count??0),fuzzyCount:Number(s?.fuzzy_count??0),forgotCount:Number(s?.forgot_count??0),mistakeStreak:Number(s?.mistake_streak??0),fsrs:Nt(t,lt),queue:fe(dr),lastAnswered:xe(dr)};Hn(t,dr);let a=r==="known_forever",d=a||r==="know"?0:i.mistakeStreak+1,l=E(`
    SELECT COUNT(*) FROM grammar_reviews
    WHERE grammar_id = ? AND reviewed_on = ? AND answer IN ('forgot','fuzzy')
  `,[t,o],0)+(r==="forgot"||r==="fuzzy"?1:0)>=Me,f=E("SELECT COUNT(*) FROM grammar_reviews WHERE grammar_id = ? AND reviewed_on = ?",[t,o],0)===0&&r==="know"?"known":l?"stubborn":"normal",m=!1,g=!1,S=0;if(!a)try{let w=Re(t,r,new Date,{mode:f},lt);m=yt(w,A()),S=Math.max((new Date(w.due).getTime()-Date.now())/6e4,0),g=!m&&yt(qe(w,"know",new Date,{mode:l?"stubborn":"normal"}),A())}catch(w){console.warn("[fsrs] \u8BED\u6CD5\u8BB0\u5F55\u8DF3\u8FC7:",w),m=r==="know"}return!m&&!a&&Kn(t,S,d>=ut,g,dr),ir(t,dr),n.run(`
    UPDATE grammar_progress
    SET seen_count = COALESCE(seen_count, 0) + 1,
        last_seen_on = ?,
        right_count = ?,
        fuzzy_count = ?,
        forgot_count = ?,
        mistake_streak = ?,
        known_forever = ?
    WHERE grammar_id = ?
  `,[o,i.rightCount+(r==="know"?1:0),i.fuzzyCount+(r==="fuzzy"?1:0),i.forgotCount+(r==="forgot"?1:0),d,a?1:0,t]),i.reviewId=An("grammar",t,()=>(n.run(`
      INSERT INTO grammar_reviews (grammar_id, answer, score_after, reviewed_on)
      VALUES (?, ?, 0, ?)
    `,[t,r,o]),E("SELECT last_insert_rowid()",[],0))),J_(e,[...ec(e),i]),Promise.resolve().then(()=>N(tt(),1)).then(({scheduleSave:w})=>w()),zn(e)},oc=e=>{Ce();let t=ec(e);if(!t.length)return zn(e);let r=t.pop(),n=(0,Yn.getDatabase)();n.run(`
    UPDATE grammar_progress
    SET seen_count = ?, known_forever = ?, last_seen_on = ?, right_count = ?,
        fuzzy_count = ?, forgot_count = ?, mistake_streak = ?
    WHERE grammar_id = ?
  `,[r.seenCount,r.knownForever,r.lastSeenOn,r.rightCount,r.fuzzyCount??0,r.forgotCount,r.mistakeStreak,r.grammarId]),r.reviewId&&n.run("DELETE FROM grammar_reviews WHERE id = ?",[r.reviewId]),Rr("grammar",r.grammarId),Zr(r.grammarId,r.fsrs??null,lt),Qe(r.queue??[],dr),ir(r.lastAnswered??0,dr),J_(e,t),Promise.resolve().then(()=>N(tt(),1)).then(({scheduleSave:s})=>s());let o=p(`
    SELECT ${Zl}
    FROM grammar_points g
    LEFT JOIN grammar_progress p ON p.grammar_id = g.id
    WHERE g.id = ?
  `,[r.grammarId])[0];return q_(e,o?ns(o):null)},Q_=10,pO=(e,t=Q_)=>{let r=T();return E(`
    SELECT COUNT(*)
    FROM grammar_points g
    JOIN grammar_progress p ON p.grammar_id = g.id
    WHERE ${ur(e)} AND p.seen_count = 0 AND p.known_forever = 0
  `,[],0)>0&&(0,Yn.getDatabase)().run("INSERT OR REPLACE INTO grammar_state (key, value) VALUES (?, ?)",[Y_(e),JSON.stringify({day:r,count:z_(e,r)+Math.max(t,0)})]),Promise.resolve().then(()=>N(tt(),1)).then(({scheduleSave:o})=>o()),zn(e)},EO=e=>(Ce(),j(lt),p(`
    SELECT ${Zl}, COALESCE(p.fsrs_lapses, 0) AS lapses
    FROM grammar_points g
    LEFT JOIN grammar_progress p ON p.grammar_id = g.id
    WHERE g.level = ?
    ORDER BY COALESCE(p.forgot_count, 0) DESC,
             COALESCE(p.seen_count, 0) ASC,
             g.sort_order ASC
  `,[e]).map(t=>({...ns(t),seenCount:Number(t.seen_count??0),knownForever:Number(t.known_forever??0)===1,lapses:Number(t.lapses??0)})))});var ct,oa,ic=h(()=>{"use strict";ct=N($(),1);G();ne();Pe();Xn();Te();oa=e=>{let{entity:t,reviewsTable:r,tasksTable:n}=e,o=t.idColumn,s=t.table,i=()=>{let L=typeof e.extraExclude=="function"?e.extraExclude():e.extraExclude;return`known_forever = 0${L?` AND ${L}`:""}`},a=()=>j(t),d=Nr(s),u=()=>({...t,eligible:`${i()} AND seen_count > 0`}),l=L=>{let M=d&&E("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'level_prior_baselines'",[],0)>0?p(`
      SELECT stability, difficulty, due, last_review, state, steps, reps, lapses
      FROM level_prior_baselines WHERE entity = ? AND entity_key = ?
    `,[d,L])[0]:void 0;if(M){(0,ct.getDatabase)().run(`
        UPDATE ${s}
        SET seen_count = 1, right_count = 0, fuzzy_count = 0, forgot_count = 0, mistake_streak = 0, known_forever = 0, last_seen_on = NULL,
            fsrs_stability = ?, fsrs_difficulty = ?, fsrs_due = ?, fsrs_last_review = ?,
            fsrs_state = ?, fsrs_steps = ?, fsrs_reps = ?, fsrs_lapses = ?
        WHERE ${o} = ?
      `,[M.stability,M.difficulty,M.due,M.last_review,M.state,M.steps,M.reps,M.lapses,L]);return}let U=e.startingState?.(L);if(U){(0,ct.getDatabase)().run(`
        UPDATE ${s}
        SET seen_count = 0, right_count = 0, fuzzy_count = 0, forgot_count = 0,
            mistake_streak = 0, known_forever = 0, last_seen_on = NULL
        WHERE ${o} = ?
      `,[L]),Rt(L,U,t);return}(0,ct.getDatabase)().run(`
      UPDATE ${s}
      SET seen_count = 0, right_count = 0, fuzzy_count = 0, forgot_count = 0, mistake_streak = 0, known_forever = 0, last_seen_on = NULL,
          fsrs_stability = NULL, fsrs_difficulty = NULL, fsrs_due = NULL, fsrs_last_review = NULL,
          fsrs_state = NULL, fsrs_steps = NULL, fsrs_reps = NULL, fsrs_lapses = NULL
      WHERE ${o} = ?
    `,[L])},c=(L,I,M)=>{let U=I==="forgot"?[1,0,0,1]:I==="fuzzy"?[1,0,1,0]:[1,1,0,0],W=E(`SELECT mistake_streak FROM ${s} WHERE ${o} = ?`,[L],0);(0,ct.getDatabase)().run(`
      UPDATE ${s}
      SET seen_count = seen_count + ?, right_count = right_count + ?, fuzzy_count = fuzzy_count + ?, forgot_count = forgot_count + ?,
          mistake_streak = ?, last_seen_on = ?
      WHERE ${o} = ?
    `,[...U,I==="forgot"?W+1:0,M,L])},f=(L,I,M=T())=>E(`SELECT COUNT(*) FROM ${r} WHERE ${o} = ? AND reviewed_on = ?`,[L,M],0)===0&&(I==="know"||I==="known_forever")?"known":E(`SELECT COUNT(*) FROM ${r} WHERE ${o} = ? AND reviewed_on = ? AND answer IN ('forgot','fuzzy')`,[L,M],0)+(I==="forgot"||I==="fuzzy"?1:0)>=Me?"stubborn":"normal",m=(L,I,M=new Date,U,W={})=>{let K=Object.entries(W),J=[o,"answer","reviewed_on","reviewed_at","scheduler_mode","fsrs_params_version"];if(K.some(([gt])=>!/^[a-z][a-z0-9_]*$/u.test(gt)||J.includes(gt)||gt==="id"||gt.startsWith("sync_")))throw new Error("Invalid extra review column");let C=[...J,...K.map(([gt])=>gt)];if(a(),!E(`SELECT COUNT(*) FROM ${s} WHERE ${o} = ?`,[L],0))throw new Error(`Unknown ${s} row: ${L}`);U??(U=f(L,I));let z=I==="known_forever"?"know":I,ze=Re(L,z,M,{mode:U},t),_n=T();c(L,z,_n),I==="known_forever"&&(0,ct.getDatabase)().run(`UPDATE ${s} SET known_forever = 1 WHERE ${o} = ?`,[L]);let zt=()=>(0,ct.getDatabase)().run(`
      INSERT INTO ${r} (${C.join(", ")})
      VALUES (${C.map(()=>"?").join(", ")})
    `,[L,I,_n,M.getTime(),U,vr,...K.map(([,gt])=>gt)]);return d?An(d,L,zt):zt(),ze},g=(L,I=M=>{(0,ct.getDatabase)().run(`INSERT OR IGNORE INTO ${s} (${o}) VALUES (?)`,[M])})=>{a();let M=L?[...new Set([...L])]:p(`SELECT DISTINCT ${o} FROM ${r}`).map(K=>String(K[o])),U=(0,ct.getDatabase)(),W=0;for(let K of M){let J=p(`SELECT answer, reviewed_on, reviewed_at, scheduler_mode FROM ${r} WHERE ${o} = ? ORDER BY reviewed_at ASC, id ASC`,[K]);if(J.length){I(K),l(K);for(let C of J){let z=String(C.answer);if(!["forgot","fuzzy","know","known_forever"].includes(z))continue;let ze=Number(C.reviewed_at),_n=Number.isFinite(ze)?new Date(ze):new Date(`${String(C.reviewed_on)}T12:00:00`),zt=z==="known_forever"?"know":z;Re(K,zt,_n,{mode:String(C.scheduler_mode??"normal")},t),c(K,zt,String(C.reviewed_on??T())),z==="known_forever"&&U.run(`UPDATE ${s} SET known_forever = 1 WHERE ${o} = ?`,[K])}W+=1}}return W};return{ensure:a,stepMode:f,record:m,replay:g,undoLast:(L=T())=>{a();let I=p(`SELECT id, ${o} AS k FROM ${r} WHERE reviewed_on = ? ORDER BY reviewed_at DESC, id DESC LIMIT 1`,[L])[0];if(!I)return null;let M=String(I.k);return(0,ct.getDatabase)().run(`DELETE FROM ${r} WHERE id = ?`,[I.id]),d&&Rr(d,M),g([M])||l(M),M},createTasks:(L,I,M=T())=>{a();let U=(0,ct.getDatabase)();if(E(`SELECT COUNT(*) FROM ${n} WHERE reviewed_on = ?`,[M],0)>0){Dt(u(),n,M,e.dayEnd?.(M)??A());let z=ze=>E(`SELECT COUNT(*) FROM ${n} t JOIN ${s} m ON m.${o} = t.${o} WHERE t.reviewed_on = ? AND ${ze}`,[M],0);return{review:z("m.seen_count > 0"),fresh:z("m.seen_count = 0")}}let W=(e.dayEnd?.(M)??A()).toISOString(),K=p(`
      SELECT ${o} FROM ${s}
      WHERE ${i()} AND seen_count > 0 AND fsrs_due IS NOT NULL AND fsrs_due <= ?
        AND NOT ${d?ce(d,`${s}.${o}`):"0"}
      ORDER BY RANDOM() LIMIT ?
    `,[W,Math.max(0,L.review)]).map(z=>String(z[o])),J=De(u(),new Date(W),M),C=I().slice(0,Math.max(0,L.fresh));U.run("BEGIN");try{[...K,...J,...C].forEach((z,ze)=>{U.run(`INSERT OR IGNORE INTO ${n} (reviewed_on, ${o}, order_index) VALUES (?, ?, ?)`,[M,z,ze])}),U.run("COMMIT")}catch(z){throw U.run("ROLLBACK"),z}return{review:K.length+J.length,fresh:C.length}},clearTasks:(L=T())=>{a(),(0,ct.getDatabase)().run(`DELETE FROM ${n} WHERE reviewed_on = ?`,[L])},pickNext:(L=T(),I=new Set)=>{a();let M=(e.dayEnd?.(L)??A()).toISOString();Dt(u(),n,L,new Date(M));let U=p(`
      SELECT t.${o} AS k, m.fsrs_due, m.fsrs_state
      FROM ${n} t JOIN ${s} m ON m.${o} = t.${o}
      WHERE t.reviewed_on = ? AND m.known_forever = 0
      ORDER BY t.order_index
    `,[L]);for(let W of U){let K=String(W.k);if(I.has(K))continue;if(!(!(W.fsrs_state!=null&&Number(W.fsrs_state)!==2)&&W.fsrs_due!=null&&String(W.fsrs_due)>M))return K}return null},progress:(L=T())=>{a();let I=(e.dayEnd?.(L)??A()).toISOString();Dt(u(),n,L,new Date(I));let M=E(`SELECT COUNT(*) FROM ${n} WHERE reviewed_on = ?`,[L],0),U=E(`
      SELECT COUNT(*) FROM ${n} t JOIN ${s} m ON m.${o} = t.${o}
      WHERE t.reviewed_on = ? AND (m.known_forever = 1 OR (m.fsrs_state = 2 AND m.fsrs_due > ?))
    `,[L,I],0);return{total:M,done:U,remaining:Math.max(0,M-U)}},dueCount:()=>(a(),E(`SELECT COUNT(*) FROM ${s} WHERE ${i()} AND seen_count > 0 AND fsrs_due <= ?
      AND NOT ${d?ce(d,`${s}.${o}`):"0"}`,[A().toISOString()],0)+De(u()).length),priorCount:()=>(a(),De(u()).length),get exclude(){return i()}}}});var ew=le((yx,Z_)=>{Z_.exports=new Proxy({},{get(e,t){let r=require("../shared/content-store");if(t==="__esModule")return!1;if(t!=="then"){if(!r.kanjiUnitRuntime)throw new Error("\u6C49\u5B57\u5355\u5143\u7D22\u5F15\u8FD8\u6CA1\u4ECE\u5206\u5305\u52A0\u8F7D\uFF1A\u5148 await content.ready()");return t==="default"?r.kanjiUnitRuntime:r.kanjiUnitRuntime[t]}}})});var uc={};x(uc,{allKanjiUnits:()=>mt,kanjiUnitByKey:()=>is,kanjiUnitExamples:()=>as,kanjiUnitIndexLoaded:()=>He,kanjiUnitIndexVersion:()=>_O,kanjiUnitLevels:()=>ac,kanjiUnitWordIds:()=>Vn,kanjiUnitsUpToLevel:()=>dc,loadKanjiUnitIndex:()=>nn});var lr,tw,fO,gO,nn,He,_O,ac,mt,is,Vn,as,dc,on=h(()=>{"use strict";lr=null,tw=null,fO=(e,t,r,n,o)=>[e,t,r,n,o].join("|"),gO=e=>{let t=[],r=new Map,n=new Map,o=new Map;return e.units.forEach((s,i)=>{let[a,d,u,l,c,f,m]=s,g=a===0?"char":"jukujikun",S=[];f&1&&S.push("on"),f&2&&S.push("kun");let w=fO(g,d,u,l,c),y=e.wordIds[i]??[],_={unitKey:w,unitType:g,char:d,base:u,surface:l,reading:c,kinds:S,levelRank:m,occurrenceCount:y.length};t.push(_),r.set(w,_),n.set(w,y),o.set(w,(e.examples[i]??[]).map(([b,k,v,L,I])=>({wordId:b,start:k,length:v,reading:L,variant:e.variants[I]??"base"})))}),{version:e.version,levels:e.levels,units:t,byKey:r,wordIdsByKey:n,examplesByKey:o}},nn=()=>lr?Promise.resolve():(tw??(tw=Promise.resolve().then(()=>N(ew(),1)).then(e=>{lr=gO(e.default??e)})),tw),He=()=>lr!==null,_O=()=>lr?.version??"",ac=()=>lr?.levels??[],mt=()=>lr?.units??[],is=e=>lr?.byKey.get(e)??null,Vn=e=>lr?.wordIdsByKey.get(e)??[],as=e=>lr?.examplesByKey.get(e)??[],dc=e=>mt().filter(t=>t.levelRank<=e)});var nw=le((Nx,rw)=>{rw.exports=new Proxy({},{get(e,t){let r=require("../shared/content-store");if(t==="__esModule")return!1;if(t!=="then"){if(!r.kanjiReadingUsage)throw new Error("\u4E00\u5B57\u591A\u97F3\u8BF4\u660E\u8868\u8FD8\u6CA1\u4ECE\u5206\u5305\u52A0\u8F7D\uFF1A\u5148 await content.ready()");return t==="default"?r.kanjiReadingUsage:r.kanjiReadingUsage[t]}}})});var gc={};x(gc,{allKanjiReadingQuestionChars:()=>pc,allKanjiReadingUsage:()=>yO,assignKanjiReadingPair:()=>wO,clauseText:()=>fc,decodeUsagePayload:()=>sw,kanjiReadingQuestionFor:()=>sa,kanjiReadingUsageFor:()=>Ec,kanjiReadingUsageLoaded:()=>mc,kanjiReadingUsageVersion:()=>SO,loadKanjiReadingUsage:()=>cc,readingLine:()=>NO,shuffleKanjiReadingOptions:()=>lc});var lc,wO,Cr,ow,TO,sw,cc,mc,SO,yO,pc,Ec,sa,fc,NO,ia=h(()=>{"use strict";lc=(e,t=Math.random)=>{let r=[...e];for(let n=r.length-1;n>0;n-=1){let o=Math.floor(t()*(n+1));[r[n],r[o]]=[r[o],r[n]]}return r},wO=(e,t,r)=>{let n={...e};delete n[t];for(let[o,s]of Object.entries(n))s===r&&delete n[Number(o)];return n[t]=r,n},Cr=null,ow=null,TO=new Set(["num","oku","list"]),sw=e=>{let t=e.chars.map(([r,n,o,s])=>{let i=s.map(([a,d,u,l,c,f])=>{let m=[];return d&1&&m.push("on"),d&2&&m.push("kun"),{base:a,kinds:m,clause:u>=0?e.clauses[u]??null:null,arg:l,count:c,manual:u<0,examples:f.map(g=>{let[S,w,y]=g.split("|");return{surface:S??"",kana:w??"",meaning:y??""}})}});return{char:r,levelRank:n,summary:o,readings:i,hasManual:i.some(a=>a.manual),hasSpecific:i.some(a=>a.manual||a.clause!==null&&TO.has(a.clause))}});return{version:e.version,levels:e.levels,chars:t,byChar:new Map(t.map(r=>[r.char,r])),questions:new Map(Object.entries(e.questions??{}))}},cc=()=>Cr?Promise.resolve():(ow??(ow=Promise.resolve().then(()=>N(nw(),1)).then(e=>{Cr=sw(e.default??e)})),ow),mc=()=>Cr!==null,SO=()=>Cr?.version??"",yO=()=>Cr?.chars??[],pc=()=>[...Cr?.questions.keys()??[]],Ec=e=>Cr?.byChar.get(e)??null,sa=e=>Cr?.questions.get(e)??null,fc=e=>{if(e.manual)return e.arg;switch(e.clause){case"num":return"\u8DDF\u5728\u6570\u5B57\u540E\u9762";case"oku":{let t=e.arg.split("\uFF0F").filter(Boolean);return t.length?`\u5E26\u9001\u5047\u540D ${t.map(r=>`\u301C${r}`).join("\uFF0F")}`:"\u5E26\u9001\u5047\u540D"}case"list":return"\u5728\u5F53\u524D\u8BCD\u5E93\u4E3B\u8981\u89C1\u4E8E\u4E0B\u9762\u8FD9\u4E9B\u8BCD";case"on":return"\u97F3\u8BFB \u2014\u2014 \u6C49\u8BED\u590D\u5408\u8BCD\u91CC";case"kun":return"\u8BAD\u8BFB \u2014\u2014 \u5355\u72EC\u7528\u3001\u5E26\u9001\u5047\u540D\uFF0C\u6216\u548C\u8BED\u8BCD\u91CC";default:return""}},NO=e=>e.readings.map(t=>t.base).join(" / ")});var aa=le((Rx,iw)=>{iw.exports=Mi()("kanjiReadings")});var us,Jn,_c,RO,bO,LO,OO,ds,wc,Tc,da,AO,hO,aw,dw,uw,lw,cw,kO,mw,pw,Ew=h(()=>{"use strict";us=N($(),1);G();on();ia();Jn=e=>e.normalize("NFKC").replace(/[ァ-ヶ]/gu,t=>String.fromCharCode(t.charCodeAt(0)-96)),_c=e=>/^[ぁ-ゖ]+$/u.test(e),RO=["\u304B\u304C","\u304D\u304E","\u304F\u3050","\u3051\u3052","\u3053\u3054","\u3055\u3056","\u3057\u3058","\u3059\u305A","\u305B\u305C","\u305D\u305E","\u305F\u3060","\u3061\u3062","\u3064\u3065","\u3066\u3067","\u3068\u3069","\u306F\u3070\u3071","\u3072\u3073\u3074","\u3075\u3076\u3077","\u3078\u3079\u307A","\u307B\u307C\u307D"],bO={\u304D:"\u304B\u304F\u3053",\u304E:"\u304C\u3050\u3054",\u3057:"\u3055\u3059\u305D",\u3058:"\u3056\u305A\u305E",\u3061:"\u305F\u3064\u3068",\u306B:"\u306A\u306C\u306E",\u3072:"\u306F\u3075\u307B",\u3073:"\u3070\u3076\u307C",\u3074:"\u3071\u3077\u307D",\u307F:"\u307E\u3080\u3082",\u308A:"\u3089\u308B\u308D"},LO=(e,t)=>{let r=Jn(e),n=t.map(Jn);for(let s=0;s<r.length;s+=1){let i=r[s],a="\u304A\u3053\u3054\u305D\u305E\u3068\u3069\u306E\u307B\u307C\u307D\u3082\u3088\u3087\u308D\u3046\u304F\u3050\u3059\u305A\u3064\u3065\u306C\u3075\u3076\u3077\u3080\u3086\u3085\u308B\u3094\u3049\u3045".includes(i)?"\u3046":"\u3048\u3051\u3052\u305B\u305C\u3066\u3067\u306D\u3078\u3079\u307A\u3081\u308C\u3047".includes(i)?"\u3044":"";a&&(i==="\u3046"&&s>0&&"\u304A\u3053\u3054\u305D\u305E\u3068\u3069\u306E\u307B\u307C\u307D\u3082\u3088\u3087\u308D\u3046\u304F\u3050\u3059\u305A\u3064\u3065\u306C\u3075\u3076\u3077\u3080\u3086\u3085\u308B\u3094\u3049\u3045".includes(r[s-1])||n.push(r[s+1]===a?r.slice(0,s+1)+r.slice(s+2):r.slice(0,s+1)+a+r.slice(s+1)))}let o=RO.find(s=>s.includes(r[0]??""));if(r&&o)for(let s of o)n.push(s+r.slice(1));for(let[s,i]of Object.entries(bO))for(let a=0;a<3;a+=1){let d=s+"\u3083\u3085\u3087"[a];for(let u of[s,i[a]]){r.includes(d)&&n.push(r.replace(d,u));let l=r.indexOf(u);l>=0&&!"\u3083\u3085\u3087".includes(r[l+1]??" ")&&n.push(r.slice(0,l)+d+r.slice(l+1))}}return n.push(r.endsWith("\u3093")?r.slice(0,-1):r+"\u3093"),/[つく]$/u.test(r)&&n.push(r.slice(0,-1)+"\u3063"),r.endsWith("\u3063")&&n.push(r.slice(0,-1)+"\u3064",r.slice(0,-1)+"\u304F"),[...new Set(n)].filter(s=>_c(s)&&s!==r)},OO=new Set(["rendaku","sokuon","handaku","rendaku-handaku","on-drop"]),ds=null,wc=e=>{if(!ds){ds=new Map;for(let t of mt()){if(t.unitType!=="char")continue;let r=ds.get(t.char)??[];r.push(t),ds.set(t.char,r)}}return ds.get(e)??[]},Tc=new WeakMap,da=new WeakMap,AO=()=>{let e=(0,us.getDatabase)(),t=da.get(e);if(!t){t=new Map;for(let r of p("SELECT id, kanji, kana FROM words")){let n=String(r.kanji??""),o=t.get(n)??[];o.push({wordId:Number(r.id),kana:String(r.kana??"")}),t.set(n,o)}da.set(e,t)}return t},hO=(e,t,r)=>{let n=2166136261;for(let o of`${t}:${r}`)n=Math.imul(n^o.charCodeAt(0),16777619)>>>0;return lc(e,()=>(n=Math.imul(n,1664525)+1013904223>>>0,n/4294967296))},aw=e=>e.flatMap(t=>as(t.unitKey).map(r=>({...r,base:t.base}))),dw=(e,t,r)=>{let n=[];for(let o of t){let s=r.get(o.wordId);if(!s)continue;let i=String(s.kanji??"");if(/[\[\]]/u.test(i)||i.slice(o.start,o.start+o.length)!==e||o.variant!=="base"&&!OO.has(o.variant))continue;let a=o.variant==="base"?0:1,d=n[a];if(d&&(Number(d.row.seen)-Number(s.seen)||Number(d.row.importance)-Number(s.importance)||Number(s.id)-Number(d.row.id))>=0)continue;let u=Jn(o.reading),l=Jn(o.base);!_c(u)||!_c(l)||(n[a]={row:s,example:o,answer:u,base:l})}return n.flatMap(({row:o,example:s,answer:i,base:a})=>[{wordId:s.wordId,word:String(o.kanji??""),start:s.start,length:s.length,kana:String(o.kana??""),meaning:String(o.meaning??""),answer:i,base:a,variant:s.variant}])},uw=(e,t)=>{let r=AO().get(e.word)??[];return n=>!r.some(o=>{if(o.wordId===e.wordId)return!1;let s=t.filter(i=>i.wordId===o.wordId&&i.start===e.start&&i.length===e.length);return s.length?s.some(i=>Jn(i.reading)===n):Jn(o.kana).includes(n)})},lw=(e,t,r)=>{let n=[...e.variant==="base"?[]:[e.base],...t.map(o=>o.base)];return LO(e.answer,n).filter(uw(e,r)).slice(0,3)},cw=(e,t)=>t.length>0&&(e.variant==="base"||t.includes(e.base)),kO=e=>{if(!He())return null;let t=(0,us.getDatabase)(),r=Tc.get(t);if(r||(r=new Map,Tc.set(t,r)),r.has(e))return r.get(e);let n=wc(e),o=aw(n),s=[...new Set(o.map(l=>l.wordId))],i=s.length?p(`
    SELECT w.id, w.kanji, w.kana, w.meaning, COALESCE(p.seen_count, 0) AS seen, COALESCE(w.importance, 0) AS importance
    FROM words w LEFT JOIN progress p ON p.word_id = w.id
    WHERE w.id IN (${s.map(()=>"?").join(",")})
  `,s):[],a=dw(e,o,new Map(i.map(l=>[Number(l.id),l]))),d=[];for(let l of a){if(!l)continue;let c=lw(l,n,o);cw(l,c)&&d.push({...l,options:hO([l.answer,...c],e,l.wordId)})}let u=d.length?{items:d}:null;return r.set(e,u),u},mw=e=>kO(e),pw=e=>{if(!He()||!e.length)return[];let t=(0,us.getDatabase)(),r=new Map(e.map(d=>[d,aw(wc(d))])),n=new Set([...r.values()].flatMap(d=>d.map(u=>u.wordId))),o=new Map,s=new Map,i=JSON.parse(E(`
    SELECT json_group_array(json_array(w.id, w.kanji, w.kana, COALESCE(p.seen_count, 0), COALESCE(w.importance, 0)))
    FROM words w LEFT JOIN progress p ON p.word_id = w.id
  `,[],"[]"));for(let[d,u,l,c,f]of i){let m=Number(d),g=String(u??"");n.has(m)&&o.set(m,{id:d,kanji:u,kana:l,seen:c,importance:f});let S=s.get(g)??[];S.push({wordId:m,kana:String(l??"")}),s.set(g,S)}da.has(t)||da.set(t,s);let a=Tc.get((0,us.getDatabase)());return e.filter(d=>{if(a?.has(d))return a.get(d)!==null;let u=wc(d),l=r.get(d);return dw(d,l,o).some(c=>{let f=uw(c,l);if(c.variant!=="base")return c.base!==c.answer&&f(c.base);let m=c.answer.endsWith("\u3093")?c.answer.slice(0,-1):c.answer+"\u3093";return m&&f(m)?!0:cw(c,lw(c,u,l))})})}});var pa={};x(pa,{KANJI_CHAR_FSRS:()=>Sc,clearKanjiCharTasks:()=>Oc,createKanjiCharTasks:()=>la,ensureKanjiCharTables:()=>Wt,kanjiCharCard:()=>yc,kanjiCharDataLoaded:()=>ua,kanjiCharPool:()=>ma,kanjiCharPriorCount:()=>bc,kanjiCharProgress:()=>ca,kanjiCharStepMode:()=>MO,loadKanjiCharData:()=>ls,materializeKanjiChars:()=>cs,pickKanjiCharNext:()=>Rc,recordKanjiCharReview:()=>Lc,replayKanjiCharReviews:()=>xO,undoLastKanjiCharReview:()=>Ac});var qn,gw,Sc,vO,ls,ua,Wt,cs,CO,yc,DO,fw,Nc,IO,pt,la,Rc,ca,bc,MO,Lc,Oc,Ac,xO,ma,Qn=h(()=>{"use strict";qn=N($(),1);Tt();G();ne();Xn();ic();at();on();ia();gw=N(aa(),1);Ew();Sc={table:"kanji_char_memory",idColumn:"char",eligible:"known_forever = 0"},vO=gw.default.readings,ls=()=>Promise.all([nn(),cc()]).then(()=>{}),ua=()=>He()&&mc(),Wt=()=>{let e=(0,qn.getDatabase)();e.run(`
    CREATE TABLE IF NOT EXISTS kanji_char_memory (
      char TEXT PRIMARY KEY,
      level_rank INTEGER NOT NULL DEFAULT 5,
      seen_count INTEGER NOT NULL DEFAULT 0,
      right_count INTEGER NOT NULL DEFAULT 0,
      fuzzy_count INTEGER NOT NULL DEFAULT 0,
      forgot_count INTEGER NOT NULL DEFAULT 0,
      mistake_streak INTEGER NOT NULL DEFAULT 0,
      known_forever INTEGER NOT NULL DEFAULT 0,
      last_seen_on TEXT
    )
  `),e.run(`
    CREATE TABLE IF NOT EXISTS kanji_char_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      char TEXT NOT NULL,
      answer TEXT NOT NULL,
      reviewed_on TEXT NOT NULL,
      reviewed_at INTEGER NOT NULL,
      scheduler_mode TEXT NOT NULL DEFAULT 'normal',
      fsrs_params_version TEXT NOT NULL DEFAULT '${vr}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `),e.run("CREATE INDEX IF NOT EXISTS idx_kanji_char_reviews_char_on ON kanji_char_reviews (char, reviewed_on)"),e.run(`
    CREATE TABLE IF NOT EXISTS kanji_char_tasks (
      reviewed_on TEXT NOT NULL,
      char TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      PRIMARY KEY (reviewed_on, char)
    )
  `),j(Sc)},cs=()=>{Wt();let e=new Map;for(let n of mt()){if(n.unitType!=="char"||!n.char)continue;let o=e.get(n.char);(o===void 0||n.levelRank<o)&&e.set(n.char,n.levelRank)}let t=(0,qn.getDatabase)();return qt(()=>(t.run(`
      INSERT OR IGNORE INTO kanji_char_memory (char, level_rank)
      SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]')
      FROM json_each(?) ORDER BY CAST(key AS INTEGER)
    `,[JSON.stringify([...e])]),t.getRowsModified()))},CO=6,yc=e=>{let t=p("SELECT level_rank FROM kanji_char_memory WHERE char = ?",[e])[0];if(!t)return null;let r=new Set;for(let i of mt())i.unitType==="char"&&i.char===e&&Vn(i.unitKey).forEach(a=>r.add(a));let n=r.size?p(`
        SELECT w.id, w.kanji, w.kana, w.meaning, w.jlpt_level, COALESCE(p.seen_count, 0) AS seen, COALESCE(w.importance, 0) AS importance
        FROM words w LEFT JOIN progress p ON p.word_id = w.id
        WHERE w.id IN (${[...r].map(()=>"?").join(",")})
        ORDER BY seen DESC, importance DESC, w.id ASC
        LIMIT ${CO}
      `,[...r]).map(i=>({wordId:Number(i.id),kanji:String(i.kanji??""),kana:String(i.kana??""),meaning:String(i.meaning??""),level:String(i.jlpt_level??"")})):[],o=vO[e]??{},s=Ec(e)?.readings.map(i=>({base:i.base,kinds:i.kinds,note:fc(i)}))??[];return{char:e,levelRank:Number(t.level_rank),on:o.on??[],kun:o.kun??[],usage:s,examples:n,question:sa(e)??void 0,choice:sa(e)?void 0:mw(e)??void 0}},DO=()=>{let e=new Map;for(let t of mt())t.unitType==="char"&&t.char&&e.set(t.char,(e.get(t.char)??0)+t.occurrenceCount);return e},fw=new WeakMap,Nc=()=>{let e=(0,qn.getDatabase)(),t=fw.get(e);if(t)return t;let r=new Set(pc());if(!ua())return r;let n=[...new Set(mt().filter(o=>o.unitType==="char").map(o=>o.char))];for(let o of pw(n.filter(s=>!r.has(s))))r.add(o);return fw.set(e,r),r},IO=()=>{let e=[...Nc()];return e.length?`char IN (${e.map(t=>`'${t.replace(/'/gu,"''")}'`).join(",")})`:"0"},pt=oa({entity:Sc,reviewsTable:"kanji_char_reviews",tasksTable:"kanji_char_tasks",extraExclude:IO}),la=(e,t,r=T())=>{Wt();let n=Nc();if(!n.size)throw new Error("\u6C49\u5B57\u9898\u5C1A\u672A\u52A0\u8F7D\uFF0C\u4E0D\u80FD\u751F\u6210\u6C49\u5B57\u5361\u6E05\u5355");return p("SELECT char FROM kanji_char_tasks WHERE reviewed_on = ?",[r]).some(o=>!n.has(String(o.char)))&&(0,qn.getDatabase)().run("DELETE FROM kanji_char_tasks WHERE reviewed_on = ?",[r]),pt.createTasks(e,()=>{let o=DO(),s=Kr("kanji");return p(`SELECT char, level_rank FROM kanji_char_memory WHERE ${pt.exclude} AND seen_count = 0 AND level_rank <= ?`,[t]).map(i=>({char:String(i.char),rank:s[Number(i.level_rank)]??0})).sort((i,a)=>i.rank-a.rank||(o.get(a.char)??0)-(o.get(i.char)??0)||i.char.localeCompare(a.char)).map(i=>i.char)},r)},Rc=(e=T(),t=new Set)=>{Wt();let r=Nc(),n=new Set(t);for(let o=0;o<1e3;o+=1){let s=pt.pickNext(e,n);if(!s)return null;if(r.has(s))return s;n.add(s)}return null},ca=(e=T())=>(Wt(),pt.progress(e)),bc=pt.priorCount,MO=pt.stepMode,Lc=(e,t,r=new Date,n)=>(Wt(),pt.record(e,t,r,n)),Oc=(e=T())=>{Wt(),pt.clearTasks(e)},Ac=()=>(Wt(),pt.undoLast()),xO=e=>(Wt(),pt.replay(e,t=>(0,qn.getDatabase)().run("INSERT OR IGNORE INTO kanji_char_memory (char, level_rank) VALUES (?, 5)",[t]))),ma=e=>(Wt(),{due:pt.dueCount(),unseen:E(`SELECT COUNT(*) FROM kanji_char_memory WHERE ${pt.exclude} AND seen_count = 0 AND level_rank <= ?`,[e],0)})});var Ea=le((Fx,_w)=>{var UO=require("../shared/content-store"),Dr=()=>UO.distinctionReviews;_w.exports={get DISTINCTION_REVIEWS(){return Dr()?Dr().DISTINCTION_REVIEWS:[]},get distinctionReviewMap(){return Dr()?Dr().distinctionReviewMap:new Map},distinctionReviewFor:e=>Dr()?Dr().distinctionReviewFor(e):null,distinctionNotesFor:(...e)=>Dr()?Dr().distinctionNotesFor(...e):[]}});var ww,Tw=h(()=>{"use strict";ww={"stem:\u5411":[{title:"\u5355\u65B9\u671D\u5411\u76EE\u6807",words:{\u5411\u304B\u3046:"\u81EA",\u5411\u304F:"\u81EA",\u5411\u3051\u308B:"\u4ED6"}},{title:"\u5E26\u300C\u5408\u3046\u300D\uFF1A\u53CC\u65B9\u4E92\u76F8",words:{\u5411\u304B\u3044\u5408\u3046:"\u81EA",\u5411\u304D\u5408\u3046:"\u81EA"}}],"stem:\u9589":[{title:"\u8BFB \u3057\u3081\uFF0F\u3057\u307E\uFF1A\u95E8\u7A97\u5173\u4E0A",words:{\u9589\u3081\u308B:"\u4ED6",\u9589\u307E\u308B:"\u81EA"}},{title:"\u8BFB \u3068\u3058\uFF0F\u3068\u3056\uFF1A\u5408\u62E2\u3001\u5C01\u4F4F",words:{\u9589\u3058\u308B:"\u81EA\u4ED6",\u9589\u3056\u3059:"\u4ED6",\u9589\u3058\u8FBC\u3081\u308B:"\u4ED6"}}],"stem:\u5165":[{title:"\u8FDB\u53BB\u3001\u653E\u8FDB\u53BB",words:{\u5165\u308B:"\u81EA",\u5165\u308C\u308B:"\u4ED6",\u5165\u308A\u8FBC\u3080:"\u81EA"}},{title:"\u5165\u308C\u66FF\u301C\uFF1A\u4E92\u6362",words:{\u5165\u308C\u66FF\u308F\u308B:"\u81EA",\u5165\u308C\u66FF\u3048\u308B:"\u4ED6"}},{title:"\u8BFB \u3044\u308A\uFF1A\u6DF7\u6742\u3001\u590D\u6742",words:{\u5165\u308A\u4EA4\u3058\u308B:"\u81EA",\u5165\u308A\u7D44\u3080:"\u81EA"}}],"stem:\u624B":[{title:"\u4E1C\u897F\u79BB\u624B\uFF1A\u4EA4\u51FA\u6216\u653E\u6389",words:{\u624B\u6E21\u3059:"\u4ED6",\u624B\u653E\u3059:"\u4ED6"}},{title:"\u4EB2\u624B\u53BB\u505A",words:{\u624B\u304C\u3051\u308B:"\u4ED6"}}],"stem:\u8003":[{title:"\u601D\u8003\u672C\u8EAB",words:{\u8003\u3048\u308B:"\u4ED6"}},{title:"\u8003\u3048\uFF0B\u540E\u9879\uFF1A\u91CD\u60F3\uFF0F\u9677\u8FDB\u53BB",words:{\u8003\u3048\u76F4\u3059:"\u4ED6",\u8003\u3048\u8FBC\u3080:"\u81EA"}}],"stem:\u6C7A":[{title:"\u51B3\u5B9A\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u6C7A\u3081\u308B:"\u4ED6",\u6C7A\u307E\u308B:"\u81EA"}},{title:"\u301C\u3064\u3051\u308B\uFF1A\u6B66\u65AD",words:{\u6C7A\u3081\u3064\u3051\u308B:"\u4ED6"}}],"stem:\u53D7":[{title:"\u63A5\u4F4F\u4E1C\u897F\u6216\u51B2\u51FB",words:{\u53D7\u3051\u308B:"\u4ED6",\u53D7\u3051\u53D6\u308B:"\u4ED6",\u53D7\u3051\u6B62\u3081\u308B:"\u4ED6"}},{title:"\u8BA9\u5BF9\u65B9\u8FDB\u6765\uFF1A\u63A5\u7EB3\u3001\u53D7\u7406",words:{\u53D7\u3051\u5165\u308C\u308B:"\u4ED6",\u53D7\u3051\u4ED8\u3051\u308B:"\u4ED6"}}],"stem:\u4F7F":[{title:"\u600E\u4E48\u7528",words:{\u4F7F\u3046:"\u4ED6",\u4F7F\u3044\u5206\u3051\u308B:"\u4ED6",\u4F7F\u3044\u3053\u306A\u3059:"\u4ED6"}},{title:"\u7528\u5230\u6D88\u8017",words:{\u4F7F\u3044\u679C\u305F\u3059:"\u4ED6",\u4F7F\u3044\u8FBC\u3080:"\u4ED6"}}],"stem:\u8CB7":[{title:"\u4E70\u5230\u81EA\u5DF1\u624B\u91CC",words:{\u8CB7\u3046:"\u4ED6",\u8CB7\u3044\u6C42\u3081\u308B:"\u4ED6",\u8CB7\u3044\u53D6\u308B:"\u4ED6"}},{title:"\u4E70\u7ED9\u522B\u4EBA\uFF0F\u5168\u90E8\u4E70\u5149",words:{\u8CB7\u3044\u4E0E\u3048\u308B:"\u4ED6",\u8CB7\u3044\u5360\u3081\u308B:"\u4ED6"}}],"stem:\u58F2":[{title:"\u4EBA\u5356\u4E1C\u897F\uFF08\u4ED6\uFF09",words:{\u58F2\u308B:"\u4ED6",\u58F2\u308A\u51FA\u3059:"\u4ED6"}},{title:"\u5546\u54C1\u4F5C\u4E3B\u8BED\uFF1A\u5356\u5F97\u600E\u6837\uFF08\u81EA\uFF09",words:{\u58F2\u308C\u308B:"\u81EA",\u58F2\u308A\u5207\u308C\u308B:"\u81EA",\u58F2\u308C\u6B8B\u308B:"\u81EA"}}],"stem:\u6301":[{title:"\u62FF\u7740\u3001\u5E26\u5728\u8EAB\u4E0A",words:{\u6301\u3064:"\u4ED6",\u6301\u3061\u6B69\u304F:"\u4ED6"}},{title:"\u5E26\u5F80\u54EA\u91CC\uFF1A\u56DE\u3001\u8FDB\u3001\u51FA",words:{\u6301\u3061\u5E30\u308B:"\u4ED6",\u6301\u3061\u8FBC\u3080:"\u4ED6",\u6301\u3061\u51FA\u3059:"\u4ED6"}}],"stem:\u7ACB":[{title:"\u7AD9\u3001\u7AD6",words:{\u7ACB\u3064:"\u81EA",\u7ACB\u3066\u308B:"\u4ED6",\u7ACB\u3061\u4E0A\u304C\u308B:"\u81EA",\u7ACB\u3061\u4E26\u3076:"\u81EA"}},{title:"\u79BB\u5F00",words:{\u7ACB\u3061\u53BB\u308B:"\u81EA",\u7ACB\u3061\u9000\u304F:"\u81EA"}},{title:"\u56DE\u5230\u539F\u5904",words:{\u7ACB\u3061\u8FD4\u308B:"\u81EA",\u7ACB\u3061\u623B\u308B:"\u81EA"}}],"stem:\u8AAD":[{title:"\u8BFB\u3001\u8BFB\u61C2",words:{\u8AAD\u3080:"\u4ED6",\u8AAD\u307F\u53D6\u308B:"\u4ED6",\u8AAD\u307F\u8FBC\u3080:"\u4ED6"}},{title:"\u8BFB\u7684\u65B9\u5F0F\uFF1A\u51FA\u58F0\uFF0F\u518D\u8BFB",words:{\u8AAD\u307F\u4E0A\u3052\u308B:"\u4ED6",\u8AAD\u307F\u8FD4\u3059:"\u4ED6"}}],"stem:\u805E":[{title:"\u4E0D\u5E26\u540E\u9879\uFF1A\u542C\u3001\u542C\u5F97\u89C1\u3001\u8BA9\u4EBA\u542C",words:{\u805E\u304F:"\u4ED6",\u805E\u3053\u3048\u308B:"\u81EA",\u805E\u304B\u305B\u308B:"\u4ED6"}},{title:"\u542C\u5230\u624B\uFF1A\u542C\u61C2\u3001\u542C\u5230\u98CE\u58F0",words:{\u805E\u304D\u53D6\u308B:"\u4ED6",\u805E\u304D\u3064\u3051\u308B:"\u4ED6"}},{title:"\u95EE\uFF1A\u518D\u95EE\u3001\u95EE\u51FA",words:{\u805E\u304D\u76F4\u3059:"\u4ED6",\u805E\u304D\u51FA\u3059:"\u4ED6"}}],"stem:\u6B62":[{title:"\u8BFB \u3068\u307E\uFF0F\u3068\u3081\uFF1A\u52A8\u7684\u4E1C\u897F\u505C\u4E0B",words:{\u6B62\u307E\u308B:"\u81EA",\u6B62\u3081\u308B:"\u4ED6"}},{title:"\u8BFB \u3084\u3080\uFF0F\u3084\u3081\u308B\uFF1A\u6301\u7EED\u7684\u4E8B\u505C\u6B62",words:{\u6B62\u3080:"\u81EA",\u3084\u3081\u308B:"\u4ED6"}}],"stem:\u63A2":[{title:"\u4E00\u822C\u5730\u627E",words:{\u63A2\u3059:"\u4ED6"}},{title:"\u627E\u5230\u624B\uFF0F\u5230\u5904\u627E",words:{\u63A2\u3057\u51FA\u3059:"\u4ED6",\u63A2\u3057\u56DE\u308B:"\u4ED6"}}],"stem:\u7740":[{title:"\u8BFB \u304D\uFF1A\u7A7F\u8863\u670D",words:{\u7740\u308B:"\u4ED6",\u7740\u66FF\u3048\u308B:"\u81EA\u4ED6"}},{title:"\u8BFB \u3064\u304F\uFF1A\u5230\u8FBE",words:{\u7740\u304F:"\u81EA",\u305F\u3069\u308A\u7740\u304F:"\u81EA"}}],"stem:\u4E26":[{title:"\u6392\u5217\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u4E26\u3076:"\u81EA",\u4E26\u3079\u308B:"\u4ED6"}},{title:"\u4E00\u6761\u6761\u8BF4\u51FA\u6765",words:{\u4E26\u3079\u7ACB\u3066\u308B:"\u4ED6"}}],"stem:\u964D":[{title:"\u8BFB \u304A\u308A\u308B\uFF1A\u4EBA\u4ECE\u4E0A\u9762\u4E0B\u6765",words:{\u964D\u308A\u308B:"\u81EA"}},{title:"\u8BFB \u3075\u308B\uFF1A\u96E8\u96EA\u843D\u4E0B",words:{\u964D\u308B:"\u81EA",\u964D\u308A\u51FA\u3059:"\u81EA",\u964D\u308A\u7D9A\u304F:"\u81EA",\u964D\u308A\u6CE8\u3050:"\u81EA"}}],"stem:\u4E57":[{title:"\u5750\u8F66\u3001\u6362\u8F66",words:{\u4E57\u308B:"\u81EA",\u4E57\u308A\u63DB\u3048\u308B:"\u4ED6",\u4E57\u308A\u7D99\u3050:"\u4ED6"}},{title:"\u6BD4\u55BB\uFF1A\u8D8A\u8FC7\u3001\u633A\u8FC7\u96BE\u5173",words:{\u4E57\u308A\u8D8A\u3048\u308B:"\u81EA",\u4E57\u308A\u5207\u308B:"\u81EA\u4ED6"}}],"stem:\u8A00":[{title:"\u8BF4\u51FA\u53E3",words:{\u8A00\u3046:"\u4ED6",\u8A00\u3044\u51FA\u3059:"\u4ED6",\u8A00\u3044\u653E\u3064:"\u4ED6",\u8A00\u3044\u5207\u308B:"\u4ED6"}},{title:"\u8BF4\u7ED9\u4EBA\uFF1A\u529D\u3001\u6362\u8BF4\u6CD5\u3001\u7559\u8BDD",words:{\u8A00\u3044\u805E\u304B\u305B\u308B:"\u4ED6",\u8A00\u3044\u63DB\u3048\u308B:"\u4ED6",\u8A00\u3044\u6B8B\u3059:"\u4ED6"}}],"stem:\u547C":[{title:"\u628A\u4EBA\u53EB\u8FC7\u6765",words:{\u547C\u3076:"\u4ED6",\u547C\u3073\u5BC4\u305B\u308B:"\u4ED6",\u547C\u3073\u8FBC\u3080:"\u4ED6"}},{title:"\u8BA9\u4EBA\u505C\u4E0B",words:{\u547C\u3073\u6B62\u3081\u308B:"\u4ED6"}}],"stem:\u4E0A":[{title:"\u4E3B\u4F53\u5F80\u4E0A\uFF08\u81EA\uFF09",words:{\u4E0A\u304C\u308B:"\u81EA",\u4E0A\u308B:"\u81EA"}},{title:"\u628A\u4E1C\u897F\u5F04\u4E0A\u6765\uFF08\u4ED6\uFF09",words:{\u304F\u307F\u4E0A\u3052\u308B:"\u4ED6"}}],"stem:\u5207":[{title:"\u5207\u6389\u4E00\u90E8\u5206",words:{\u5207\u308A\u53D6\u308B:"\u4ED6",\u5207\u308A\u843D\u3068\u3059:"\u4ED6",\u5207\u308A\u6368\u3066\u308B:"\u4ED6"}},{title:"\u5207\u5F00\u3001\u5206\u5F00",words:{\u5207\u308B:"\u4ED6",\u5207\u308A\u96E2\u3059:"\u4ED6",\u5207\u308A\u958B\u304F:"\u4ED6"}},{title:"\u8F6C\u4E49\uFF1A\u6362\u3001\u5F00\u53E3",words:{\u5207\u308A\u66FF\u3048\u308B:"\u4ED6",\u5207\u308A\u51FA\u3059:"\u4ED6"}}],"stem:\u5206":[{title:"\u5206\u5F00\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u5206\u3051\u308B:"\u4ED6",\u5206\u304B\u308C\u308B:"\u81EA"}},{title:"\u5206\u7ED9\u522B\u4EBA",words:{\u5206\u3051\u4E0E\u3048\u308B:"\u4ED6"}}],"stem:\u901A":[{title:"\u901A\u8FC7\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u901A\u308B:"\u81EA",\u901A\u3059:"\u4ED6"}},{title:"\u3068\u304A\u308A\uFF0B\u540E\u9879\uFF1A\u8DEF\u8FC7",words:{\u901A\u308A\u304B\u304B\u308B:"\u81EA",\u901A\u308A\u904E\u304E\u308B:"\u81EA"}},{title:"\u8BFB \u3064\u3046\u3058\u308B\uFF1A\u76F8\u901A",words:{\u901A\u3058\u308B:"\u81EA\u4ED6"}}],"stem:\u62BC":[{title:"\u6309\u3001\u538B\u3001\u786C\u63A8\u5230\u5E95",words:{\u62BC\u3059:"\u4ED6",\u62BC\u3055\u3048\u308B:"\u4ED6",\u62BC\u3057\u5207\u308B:"\u4ED6"}},{title:"\u5F80\u91CC\u585E",words:{\u62BC\u3057\u8FBC\u3080:"\u4ED6",\u62BC\u3057\u8FBC\u3081\u308B:"\u4ED6"}},{title:"\u5F80\u5916\u3001\u5F80\u65C1\u8FB9\u63A8",words:{\u62BC\u3057\u51FA\u3059:"\u4ED6",\u62BC\u3057\u3084\u308B:"\u4ED6"}}],"stem:\u5438":[{title:"\u5438\u8FDB\u6765",words:{\u5438\u3046:"\u4ED6",\u5438\u3044\u8FBC\u3080:"\u4ED6"}},{title:"\u5438\u8D70\u3001\u5438\u4E0A\u6765",words:{\u5438\u3044\u53D6\u308B:"\u4ED6",\u5438\u3044\u4E0A\u3052\u308B:"\u4ED6"}}],"stem:\u80B2":[{title:"\u6210\u957F\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u80B2\u3064:"\u81EA",\u80B2\u3066\u308B:"\u4ED6"}},{title:"\u517B\u5F97\u66F4\u6DF1\u3001\u517B\u5230\u5E95",words:{\u80B2\u3080:"\u4ED6",\u80B2\u3066\u4E0A\u3052\u308B:"\u4ED6"}}],"stem:\u4E0B":[{title:"\u8BFB \u3055\u304C\uFF0F\u3055\u3052\uFF1A\u4F4D\u7F6E\u3001\u6570\u503C\u964D\u4F4E",words:{\u4E0B\u304C\u308B:"\u81EA",\u4E0B\u3052\u308B:"\u4ED6"}},{title:"\u8BFB \u304A\u308A\uFF0F\u304A\u308D\uFF1A\u4ECE\u4E0A\u9762\u4E0B\u6765\u3001\u653E\u4E0B",words:{\u4E0B\u308A\u308B:"\u81EA",\u4E0B\u308D\u3059:"\u4ED6"}},{title:"\u8BFB \u3057\u305F\u307E\u308F\u308B\uFF1A\u4F4E\u4E8E\u57FA\u51C6",words:{\u4E0B\u56DE\u308B:"\u4ED6"}}],"stem:\u904E":[{title:"\u65F6\u95F4\u3001\u5730\u70B9\u81EA\u5DF1\u8FC7\u53BB\uFF08\u81EA\uFF09",words:{\u904E\u304E\u308B:"\u81EA",\u904E\u304E\u53BB\u308B:"\u81EA"}},{title:"\u8BA9\u65F6\u95F4\u3001\u4E8B\u60C5\u8FC7\u53BB\uFF08\u4ED6\uFF09",words:{\u904E\u3054\u3059:"\u4ED6",\u3084\u308A\u904E\u3054\u3059:"\u4ED6"}}],"stem:\u5EFA":[{title:"\u5EFA\u9020\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u5EFA\u3064:"\u81EA",\u5EFA\u3066\u308B:"\u4ED6"}},{title:"\u91CD\u5EFA",words:{\u5EFA\u3066\u76F4\u3059:"\u4ED6"}}],"stem:\u4F3C":[{title:"\u50CF",words:{\u4F3C\u308B:"\u81EA",\u4F3C\u901A\u3046:"\u81EA"}},{title:"\u76F8\u914D",words:{\u4F3C\u5408\u3046:"\u81EA"}}],"stem:\u96C6":[{title:"\u4EBA\u805A\u5230\u4E00\u8D77\uFF08\u81EA\uFF09",words:{\u96C6\u307E\u308B:"\u81EA",\u96C6\u3046:"\u81EA"}},{title:"\u628A\u4E1C\u897F\u6536\u96C6\u8D77\u6765\uFF08\u4ED6\uFF09",words:{\u96C6\u3081\u308B:"\u4ED6",\u304B\u304D\u96C6\u3081\u308B:"\u4ED6"}}],"stem:\u5897":[{title:"\u6570\u91CF\u589E\u52A0\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u5897\u3048\u308B:"\u81EA",\u5897\u3084\u3059:"\u4ED6"}},{title:"\u8BFB \u307E\u3059\uFF1A\u4E66\u9762\u3001\u7A0B\u5EA6\u52A0\u6DF1",words:{\u5897\u3059:"\u81EA\u4ED6"}}],"stem:\u6253":[{title:"\u6572\u6253\uFF08\u91CD\u6253\u4E5F\u662F\u6253\uFF09",words:{\u6253\u3064:"\u4ED6",\u6253\u3061\u76F4\u3059:"\u4ED6"}},{title:"\u6253\u8FDB\u53BB\u3001\u5168\u5FC3\u6295\u5165",words:{\u6253\u3061\u8FBC\u3080:"\u4ED6"}}],"stem:\u6295":[{title:"\u6254\u51FA\u53BB\u3001\u6254\u6389\u3001\u653E\u5F03",words:{\u6295\u3052\u308B:"\u4ED6",\u6295\u3052\u6368\u3066\u308B:"\u4ED6",\u6295\u3052\u51FA\u3059:"\u4ED6"}},{title:"\u629B\u7ED9\u5BF9\u65B9\uFF0F\u6295\u8FDB\u53BB",words:{\u6295\u3052\u304B\u3051\u308B:"\u4ED6",\u6295\u3058\u308B:"\u4ED6"}}],"stem:\u9003":[{title:"\u81EA\u5DF1\u9003\uFF08\u81EA\uFF09",words:{\u9003\u3052\u308B:"\u81EA",\u9003\u308C\u308B:"\u81EA"}},{title:"\u8BA9\u5B83\u8DD1\u4E86\u3001\u9519\u8FC7\uFF08\u4ED6\uFF09",words:{\u9003\u304C\u3059:"\u4ED6",\u9003\u3059:"\u4ED6"}}],"stem:\u52D5":[{title:"\u52A8\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u52D5\u304F:"\u81EA",\u52D5\u304B\u3059:"\u4ED6"}},{title:"\u8BFB \u3069\u3046\u3058\u308B\uFF1A\u5185\u5FC3\u52A8\u6447",words:{\u52D5\u3058\u308B:"\u81EA"}}],"stem:\u843D":[{title:"\u6389\u4E0B\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u843D\u3061\u308B:"\u81EA",\u843D\u3068\u3059:"\u4ED6"}},{title:"\u9677\u8FDB\u53BB\u3001\u60C5\u7EEA\u4F4E\u843D",words:{\u843D\u3061\u8FBC\u3080:"\u81EA"}}],"stem:\u6D41":[{title:"\u8BFB \u306A\u304C\u308C\uFF1A\u4E1C\u897F\u81EA\u5DF1\u6D41\uFF08\u81EA\uFF09",words:{\u6D41\u308C\u308B:"\u81EA",\u6D41\u308C\u7740\u304F:"\u81EA",\u6D41\u308C\u8FBC\u3080:"\u81EA"}},{title:"\u8BFB \u306A\u304C\u3057\uFF1A\u4EBA\u628A\u6DB2\u4F53\u704C\u8FDB\u53BB\uFF08\u4ED6\uFF09",words:{\u6D41\u3057\u8FBC\u3080:"\u4ED6"}},{title:"\u8BFB \u306F\u3084\u308B\uFF1A\u6D41\u884C",words:{\u6D41\u884C\u308B:"\u81EA"}}],"stem:\u6620":[{title:"\u6620\u51FA\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u6620\u308B:"\u81EA",\u6620\u3059:"\u4ED6"}},{title:"\u6E05\u695A\u5730\u5448\u73B0\u51FA\u6765",words:{\u6620\u3057\u51FA\u3059:"\u4ED6"}}],"stem:\u89E6":[{title:"\u78B0\u5230\u3001\u63D0\u53CA",words:{\u89E6\u308B:"\u81EA",\u89E6\u308C\u308B:"\u81EA"}},{title:"\u5E26\u300C\u5408\u3046\u300D\uFF1A\u4E92\u76F8\u63A5\u89E6",words:{\u89E6\u308C\u5408\u3046:"\u81EA"}}],"stem:\u7D44":[{title:"\u62FC\u6210\u4E00\u4E2A\u6574\u4F53",words:{\u7D44\u3080:"\u81EA\u4ED6",\u7D44\u307F\u7ACB\u3066\u308B:"\u4ED6",\u7D44\u307F\u5408\u308F\u305B\u308B:"\u4ED6"}},{title:"\u653E\u8FDB\u5DF2\u6709\u7684\u6574\u4F53",words:{\u7D44\u307F\u8FBC\u3080:"\u4ED6",\u7D44\u307F\u5165\u308C\u308B:"\u4ED6"}}],"stem:\u54B2":[{title:"\u5F00\u82B1",words:{\u54B2\u304F:"\u81EA"}},{title:"\u5F00\u5F97\u591A\u3001\u5F00\u5F97\u76DB",words:{\u54B2\u304D\u4E71\u308C\u308B:"\u81EA",\u54B2\u304D\u8A87\u308B:"\u81EA"}}],"stem:\u5272":[{title:"\u7834\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u5272\u308B:"\u4ED6",\u5272\u308C\u308B:"\u81EA"}},{title:"\u5206\u914D",words:{\u5272\u308A\u5F53\u3066\u308B:"\u4ED6",\u5272\u308A\u632F\u308B:"\u4ED6"}},{title:"\u8F6C\u4E49\uFF1A\u6253\u6298\u3001\u60F3\u5F00",words:{\u5272\u308A\u5F15\u304F:"\u4ED6",\u5272\u308A\u5207\u308B:"\u4ED6"}}],"stem:\u690D":[{title:"\u79CD\u4E0B\u53BB",words:{\u690D\u3048\u308B:"\u4ED6",\u690D\u3048\u4ED8\u3051\u308B:"\u4ED6"}},{title:"\u79FB\u683D",words:{\u690D\u3048\u66FF\u3048\u308B:"\u4ED6"}}],"stem:\u6298":[{title:"\u6298\u65AD\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u6298\u308B:"\u4ED6",\u6298\u308C\u308B:"\u81EA"}},{title:"\u6298\u53E0\u8D77\u6765",words:{\u6298\u308A\u7573\u3080:"\u4ED6"}}],"stem:\u6355":[{title:"\u8BFB \u3064\u304B\u307E\uFF1A\u6293\u4F4F\uFF0F\u88AB\u6293\u4F4F",words:{\u6355\u307E\u3048\u308B:"\u4ED6",\u6355\u307E\u308B:"\u81EA"}},{title:"\u8BFB \u3068\u3089\uFF1A\u6355\u83B7\u3001\u628A\u63E1\uFF0F\u88AB\u675F\u7F1A",words:{\u6355\u3089\u3048\u308B:"\u4ED6",\u6355\u3089\u308F\u308C\u308B:"\u81EA"}}],"stem:\u51B7":[{title:"\u8BFB \u3072\u3048\uFF1A\u53D8\u51B7",words:{\u51B7\u3048\u308B:"\u81EA",\u51B7\u3048\u8FBC\u3080:"\u81EA"}},{title:"\u8BFB \u3055\u3081\uFF0F\u3055\u307E\uFF1A\u70ED\u7684\u53D8\u51C9",words:{\u51B7\u3081\u308B:"\u81EA",\u51B7\u307E\u3059:"\u4ED6"}}],"stem:\u6210":[{title:"\u306A\u308B \u7CFB\uFF1A\u53D8\u6210\u3001\u6210\u7ACB\uFF08\u81EA\uFF09",words:{\u306A\u308B:"\u81EA",\u6210\u308A\u7ACB\u3064:"\u81EA"}},{title:"\u4EBA\u628A\u4E8B\u505A\u6210\uFF08\u4ED6\uFF09",words:{\u6210\u3057\u9042\u3052\u308B:"\u4ED6"}}],"stem:\u6398":[{title:"\u6316",words:{\u6398\u308B:"\u4ED6"}},{title:"\u6316\u7684\u65B9\u5411\uFF1A\u5F80\u6DF1\uFF0F\u6316\u51FA\u6765",words:{\u6398\u308A\u4E0B\u3052\u308B:"\u4ED6",\u6398\u308A\u8D77\u3053\u3059:"\u4ED6"}}],"stem:\u4F38":[{title:"\u957F\u5EA6\u3001\u80FD\u529B\u589E\u957F",words:{\u4F38\u3073\u308B:"\u81EA",\u4F38\u3070\u3059:"\u4ED6",\u4F38\u3073\u60A9\u3080:"\u81EA"}},{title:"\u4F38\u51FA\u624B\uFF08\u4E66\u9762\uFF09",words:{\u4F38\u3079\u308B:"\u4ED6"}}],"stem:\u632F":[{title:"\u6325\u52A8\u3001\u53D1\u6325",words:{\u632F\u308B:"\u4ED6",\u632F\u308A\u56DE\u3059:"\u4ED6",\u632F\u308B\u3046:"\u4ED6"}},{title:"\u56DE\u5934",words:{\u632F\u308A\u5411\u304F:"\u81EA",\u632F\u308A\u8FD4\u308B:"\u81EA\u4ED6"}},{title:"\u4E3E\u6B62\u3001\u62DB\u5F85",words:{\u632F\u308B\u821E\u3046:"\u81EA\u4ED6"}}],"stem:\u7DE0":[{title:"\u6536\u7D27\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u7DE0\u307E\u308B:"\u81EA",\u7DE0\u3081\u308B:"\u4ED6"}},{title:"\u52D2\u7D27\u3001\u538B\u5236",words:{\u7DE0\u3081\u3064\u3051\u308B:"\u4ED6"}}],"stem:\u525D":[{title:"\u8BFB \u3080\u304F\uFF0F\u3080\u3051\u308B\uFF1A\u5265\u76AE",words:{\u3080\u304F:"\u4ED6",\u5265\u3051\u308B:"\u81EA"}},{title:"\u8BFB \u306F\u304C\uFF1A\u63ED\u4E0B\u8D34\u7740\u7684\u4E1C\u897F",words:{\u5265\u304C\u3059:"\u4ED6",\u5265\u304C\u308C\u308B:"\u81EA"}}],"stem:\u629C":[{title:"\u8BFB \u306C\u3051\uFF1A\u81EA\u5DF1\u8131\u843D\uFF08\u81EA\uFF09",words:{\u629C\u3051\u308B:"\u81EA",\u629C\u3051\u843D\u3061\u308B:"\u81EA"}},{title:"\u8BFB \u306C\u304D\uFF0F\u306C\u304F\uFF1A\u628A\u5B83\u62D4\u51FA\u6765\uFF08\u4ED6\uFF09",words:{\u629C\u304F:"\u4ED6",\u629C\u304D\u51FA\u3059:"\u4ED6"}},{title:"\u8BFB \u306C\u304D\u3093\u3067\u308B\uFF1A\u51FA\u4F17",words:{\u629C\u304D\u3093\u51FA\u308B:"\u81EA"}}],"stem:\u62B1":[{title:"\u8BFB \u3060\u304F\uFF1A\u62B1\u4F4F",words:{\u62B1\u304F:"\u4ED6"}},{title:"\u8BFB \u304B\u304B\u3048\uFF1A\u62B1\u7740\u3001\u63FD\u4E0B\u8D1F\u62C5",words:{\u62B1\u3048\u308B:"\u4ED6",\u62B1\u3048\u8FBC\u3080:"\u4ED6"}}],"stem:\u653E":[{title:"\u8BFB \u307B\u3046\uFF1A\u6254\u3001\u4E22\u5F00\u4E0D\u7BA1",words:{\u653E\u308B:"\u4ED6",\u653E\u308A\u51FA\u3059:"\u4ED6",\u653E\u3063\u3066\u304A\u304F:"\u4ED6"}},{title:"\u8BFB \u306F\u306A\u3059\uFF1A\u653E\u5F00\u3001\u653E\u8D70",words:{\u653E\u3059:"\u4ED6"}}],"stem:\u57CB":[{title:"\u586B\u6EE1\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u57CB\u307E\u308B:"\u81EA",\u57CB\u3081\u308B:"\u4ED6"}},{title:"\u57CB\u5F97\u66F4\u6DF1\uFF1A\u5D4C\u5165\uFF0F\u88AB\u57CB\u6CA1",words:{\u57CB\u3081\u8FBC\u3080:"\u4ED6",\u57CB\u3082\u308C\u308B:"\u81EA"}}],"stem:\u6DF7":[{title:"\u8BFB \u307E\u305C\uFF0F\u307E\u3056\uFF1A\u6DF7\u5408",words:{\u6DF7\u3056\u308B:"\u81EA",\u6DF7\u305C\u308B:"\u4ED6"}},{title:"\u8BFB \u307E\u3058\uFF1A\u6DF7\u8FDB\u53BB\u3001\u4EA4\u878D",words:{\u6DF7\u3058\u308B:"\u81EA",\u6DF7\u3058\u308A\u5408\u3046:"\u81EA"}}],"stem:\u6EB6":[{title:"\u6EB6\u5316\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u6EB6\u3051\u308B:"\u81EA",\u6EB6\u304B\u3059:"\u4ED6"}},{title:"\u878D\u8FDB\u53BB",words:{\u6EB6\u3051\u8FBC\u3080:"\u81EA"}}],"stem:\u8A70":[{title:"\u585E\u6EE1\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u8A70\u307E\u308B:"\u81EA",\u8A70\u3081\u308B:"\u4ED6"}},{title:"\u5927\u91CF\u585E\u8FDB\u53BB",words:{\u8A70\u3081\u8FBC\u3080:"\u4ED6"}}],"stem:\u6D6E":[{title:"\u8BFB \u3046\u304B\u3076 \u7CFB\uFF1A\u6D6E\u73B0",words:{\u6D6E\u304B\u3076:"\u81EA",\u6D6E\u304B\u3079\u308B:"\u4ED6",\u6D6E\u304B\u3073\u4E0A\u304C\u308B:"\u81EA"}},{title:"\u8BFB \u3046\u304F\uFF1A\u6D6E\u8D77\u3001\u8131\u79BB\u539F\u4F4D",words:{\u6D6E\u304F:"\u81EA"}}],"stem:\u63FA":[{title:"\u81EA\u5DF1\u6643\uFF08\u81EA\uFF09",words:{\u63FA\u308C\u308B:"\u81EA",\u63FA\u308C\u52D5\u304F:"\u81EA",\u63FA\u3089\u3050:"\u81EA"}},{title:"\u7528\u529B\u6447\u5B83\uFF08\u4ED6\uFF09",words:{\u63FA\u3055\u3076\u308B:"\u4ED6"}}],"stem:\u8DF3":[{title:"\u8BFB \u3068\u3076\uFF1A\u8DF3\u8D77\u3001\u8D8A\u8FC7",words:{\u8DF3\u3076:"\u81EA"}},{title:"\u8BFB \u306F\u306D\uFF1A\u5F39\u8D77",words:{\u8DF3\u306D\u308B:"\u81EA",\u8DF3\u306D\u4E0A\u304C\u308B:"\u81EA"}}],"stem:\u99C6":[{title:"\u8DD1\u3001\u8DD1\u8FC7\u3001\u5230\u5904\u8DD1",words:{\u99C6\u3051\u308B:"\u81EA",\u99C6\u3051\u629C\u3051\u308B:"\u81EA",\u99C6\u3051\u5DE1\u308B:"\u81EA"}},{title:"\u8DD1\u8FDB\u3001\u8DD1\u4E0A",words:{\u99C6\u3051\u8FBC\u3080:"\u81EA",\u99C6\u3051\u4E0A\u304C\u308B:"\u81EA"}},{title:"\u8DD1\u5230\u67D0\u5904\u3001\u67D0\u4EBA\u8EAB\u8FB9",words:{\u99C6\u3051\u3064\u3051\u308B:"\u81EA",\u99C6\u3051\u5BC4\u308B:"\u81EA"}}],"stem:\u6307":[{title:"\u6307",words:{\u6307\u3059:"\u4ED6",\u6307\u5DEE\u3059:"\u4ED6"}},{title:"\u660E\u786E\u6307\u51FA\u6765",words:{\u6307\u3057\u793A\u3059:"\u4ED6"}}],"stem:\u5BC4":[{title:"\u628A\u4E1C\u897F\u632A\u8FD1\uFF08\u4ED6\uFF09",words:{\u5BC4\u305B\u308B:"\u4ED6"}},{title:"\u81EA\u5DF1\u9760\u4E0A\u53BB\uFF08\u81EA\uFF09",words:{\u5BC4\u308A\u639B\u304B\u308B:"\u81EA",\u5BC4\u308A\u6DFB\u3046:"\u81EA"}}],"stem:\u8FD1":[{title:"\u9760\u8FD1\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u8FD1\u3065\u304F:"\u81EA",\u8FD1\u3065\u3051\u308B:"\u4ED6"}},{title:"\u4E3B\u52A8\u51D1\u8FD1",words:{\u8FD1\u5BC4\u308B:"\u81EA"}}],"stem:\u7E2E":[{title:"\u8DDD\u79BB\u3001\u65F6\u95F4\u7F29\u77ED\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u7E2E\u3081\u308B:"\u4ED6",\u7E2E\u307E\u308B:"\u81EA"}},{title:"\u4E1C\u897F\u672C\u8EAB\u7F29\u6C34\u3001\u754F\u7F29",words:{\u7E2E\u3080:"\u81EA"}}],"stem:\u7A4D":[{title:"\u5806\u8D77\u6765",words:{\u7A4D\u3080:"\u4ED6",\u7A4D\u3082\u308B:"\u81EA"}},{title:"\u5C42\u5C42\u7D2F\u79EF\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u7A4D\u307F\u91CD\u306D\u308B:"\u4ED6",\u7A4D\u307F\u91CD\u306A\u308B:"\u81EA"}},{title:"\u5B9A\u671F\u5B58\u94B1",words:{\u7A4D\u307F\u7ACB\u3066\u308B:"\u4ED6"}}],"stem:\u67D3":[{title:"\u8BFB \u305D\u3081\uFF0F\u305D\u307E\uFF1A\u67D3\u8272",words:{\u67D3\u3081\u308B:"\u4ED6",\u67D3\u307E\u308B:"\u81EA"}},{title:"\u8BFB \u3057\u307F\uFF1A\u6E17\u8FDB\u53BB\u3001\u7559\u4E0B",words:{\u67D3\u307F\u308B:"\u81EA",\u67D3\u307F\u8FBC\u3080:"\u81EA",\u67D3\u307F\u4ED8\u304F:"\u81EA"}}],"stem:\u554F":[{title:"\u95EE",words:{\u554F\u3046:"\u4ED6",\u554F\u3044\u304B\u3051\u308B:"\u4ED6"}},{title:"\u95EE\u6E05\u695A\uFF1A\u67E5\u8BE2\u3001\u8FFD\u95EE",words:{\u554F\u3044\u5408\u308F\u305B\u308B:"\u4ED6",\u554F\u3044\u8A70\u3081\u308B:"\u4ED6"}}],"stem:\u7A81":[{title:"\u8BFB \u3064\u3063\uFF1A\u731B\u51B2",words:{\u7A81\u3063\u8FBC\u3080:"\u81EA\u4ED6",\u7A81\u3063\u8D70\u308B:"\u81EA"}},{title:"\u8BFB \u3064\u304D\uFF1A\u523A",words:{\u7A81\u304D\u523A\u3059:"\u4ED6"}}],"stem:\u81A8":[{title:"\u8BFB \u3075\u304F\u3089\u3080\uFF0F\u3075\u304F\u3089\u307E\u3059\uFF1A\u9F13\u8D77\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u81A8\u3089\u3080:"\u81EA",\u81A8\u3089\u307E\u3059:"\u4ED6"}},{title:"\u8BFB \u3075\u304F\u308C\uFF1A\u9F13\u8D77\u6765\u3001\u80C0\u5927",words:{\u81A8\u308C\u308B:"\u81EA",\u81A8\u308C\u4E0A\u304C\u308B:"\u81EA"}}],"stem:\u5F37":[{title:"\u8BFB \u3064\u3088\uFF1A\u53D8\u5F3A\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u5F37\u307E\u308B:"\u81EA",\u5F37\u3081\u308B:"\u4ED6"}},{title:"\u8BFB \u3057\u3044\u308B\uFF1A\u5F3A\u8FEB",words:{\u5F37\u3044\u308B:"\u4ED6"}}],"stem:\u50B7":[{title:"\u8BFB \u304D\u305A\uFF1A\u53D7\u4F24\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u50B7\u3064\u304F:"\u81EA",\u50B7\u3064\u3051\u308B:"\u4ED6"}},{title:"\u8BFB \u3044\u305F\uFF1A\u635F\u574F\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u50B7\u3080:"\u81EA",\u50B7\u3081\u308B:"\u4ED6"}}],"stem:\u5148":[{title:"\u5728\u524D\u9762",words:{\u5148\u7ACB\u3064:"\u81EA",\u5148\u3093\u3058\u308B:"\u81EA"}},{title:"\u62A2\u5148\u5192\u8FDB",words:{\u5148\u8D70\u308B:"\u81EA"}}],"stem:\u5F31":[{title:"\u53D8\u5F31\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u5F31\u307E\u308B:"\u81EA",\u5F31\u3081\u308B:"\u4ED6"}},{title:"\u8EAB\u4F53\u8870\u5F31\u3001\u4E3A\u96BE",words:{\u5F31\u308B:"\u81EA"}}],"stem:\u7D61":[{title:"\u7F20\u4F4F",words:{\u7D61\u3080:"\u81EA",\u7D61\u307E\u308B:"\u81EA"}},{title:"\u5E26\u300C\u5408\u3046\u300D\uFF1A\u4E92\u76F8\u7F20",words:{\u7D61\u307F\u5408\u3046:"\u81EA"}}],"stem:\u7DF4":[{title:"\u63A8\u6572",words:{\u7DF4\u308B:"\u4ED6"}},{title:"\u7DF4\u308A\uFF0B\u540E\u9879\uFF1A\u7EC3\u597D\uFF0F\u91CD\u7EC3",words:{\u7DF4\u308A\u4E0A\u3052\u308B:"\u4ED6",\u7DF4\u308A\u76F4\u3059:"\u4ED6"}}],"stem:\u7E54":[{title:"\u7EC7\u51FA\u4E1C\u897F",words:{\u7E54\u308B:"\u4ED6",\u7E54\u308A\u6210\u3059:"\u4ED6"}},{title:"\u7EC7\u8FDB\u53BB\uFF1A\u7EB3\u5165",words:{\u7E54\u308A\u8FBC\u3080:"\u4ED6"}}],"stem:\u548C":[{title:"\u8BFB \u3084\u308F\u3089\uFF1A\u7F13\u548C\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u548C\u3089\u3050:"\u81EA",\u548C\u3089\u3052\u308B:"\u4ED6"}},{title:"\u8BFB \u306A\u3054\u3080\uFF1A\u5FC3\u60C5\u653E\u677E",words:{\u548C\u3080:"\u81EA"}}],"synonym:\u91CD\u8981\u7684":[{title:"\u53E3\u8BED\u3001\u5E26\u73CD\u60DC",words:{\u5927\u5207:"",\u5927\u4E8B:""}},{title:"\u4E66\u9762\u3001\u5BA2\u89C2\u8BF4\u660E",words:{\u91CD\u8981:"",\u809D\u8981:""}}],"synonym:\u6D88\u5931":[{title:"\u65E5\u5E38\uFF1A\u6CA1\u4E86\u3001\u706D\u4E86",words:{\u306A\u304F\u306A\u308B:"\u81EA",\u6D88\u3048\u308B:"\u81EA"}},{title:"\u5F7B\u5E95\u79BB\u53BB\uFF08\u4E66\u9762\uFF09",words:{\u6D88\u3048\u53BB\u308B:"\u81EA",\u5931\u305B\u308B:"\u81EA"}}],"synonym:\u5435\u95F9\u7684":[{title:"\u548C\u8BED\uFF1A\u70E6\u4EBA\uFF0C\u4E5F\u80FD\u8BF4\u4EBA",words:{\u3046\u308B\u3055\u3044:"",\u3084\u304B\u307E\u3057\u3044:""}},{title:"\u9A12 \u5B57\uFF1A\u73B0\u573A\u5608\u6742",words:{\u9A12\u3005\u3057\u3044:"",\u9A12\u304C\u3057\u3044:""}}],"synonym:\u56E0\u6B64":[{title:"\u53E3\u8BED\uFF1A\u76F4\u63A5\u4E0B\u7ED3\u8BBA",words:{\u3060\u304B\u3089:"",\u3067\u3059\u304B\u3089:""}},{title:"\u627F\u63A5\u4E0B\u6587\uFF1A\u7ED3\u679C\uFF0F\u63A5\u7740\u505A",words:{\u305D\u308C\u3067:"",\u305D\u3053\u3067:""}},{title:"\u4E66\u9762\uFF1A\u8BF4\u660E\u56E0\u679C",words:{\u305D\u306E\u305F\u3081:"",\u3057\u305F\u304C\u3063\u3066:""}}],"synonym:\u66F4\u52A0":[{title:"\u53E3\u8BED\u3001\u6BD4\u8F83",words:{\u3082\u3063\u3068:"",\u3088\u308A:""}},{title:"\u66F4\u8FDB\u4E00\u5C42\uFF08\u4E66\u9762\uFF0F\u9012\u8FDB\uFF09",words:{\u4E00\u5C64:"",\u306A\u304A\u3055\u3089:""}}],"synonym:\u573A\u6240":[{title:"\u6CDB\u6307\u5730\u65B9",words:{\u6240:"",\u5834\u6240:""}},{title:"\u7279\u5B9A\u7684\uFF1A\u573A\u5408\u3001\u666F\u70B9",words:{\u5834:"",\u30B9\u30DD\u30C3\u30C8:""}}],"synonym:\u524D\u9762":[{title:"\u548C\u8BED\uFF1A\u4E5F\u80FD\u6307\u65F6\u95F4",words:{\u524D:"",\u5148:""}},{title:"\u6C49\u8BED\uFF1A\u53EA\u6307\u7A7A\u95F4\u65B9\u5411",words:{\u524D\u65B9:"",\u524D\u9762:""}}],"synonym:\u8863\u670D":[{title:"\u65E5\u5E38\uFF0F\u6B63\u5F0F\u8BF4\u8863\u670D",words:{\u670D:"",\u8863\u670D:""}},{title:"\u5206\u7C7B\u7528\u8BED\u3001\u4E66\u9762",words:{\u8863\u985E:"",\u8863:""}}],"synonym:\u7EC8\u4E8E":[{title:"\u7B49\u4E86\u5F88\u4E45\uFF0C\u7ED3\u679C\u6765\u4E86",words:{\u3084\u3063\u3068:"",\u3068\u3046\u3068\u3046:"",\u3064\u3044\u306B:""}},{title:"\u5173\u5934\u4E34\u8FD1",words:{\u3044\u3088\u3044\u3088:""}}],"synonym:\u4E0D\u64C5\u957F\u7684":[{title:"\u53E3\u8BED\u5E38\u7528",words:{\u4E0B\u624B:"",\u82E6\u624B:""}},{title:"\u4E0D \u5B57\u5934\uFF1A\u4E66\u9762",words:{\u4E0D\u5F97\u624B:"",\u4E0D\u5F97\u610F:""}}],"synonym:\u89D2\u843D":[{title:"\u62D0\u89D2\u3001\u4E13\u533A",words:{\u89D2:"",\u30B3\u30FC\u30CA\u30FC:""}},{title:"\u8FB9\u89D2\u3001\u504F\u50FB\u5904",words:{\u9685:"",\u7247\u9685:""}}],"synonym:\u505A\u6CD5":[{title:"\u505A\u4E8B\u7684\u65B9\u6CD5",words:{\u3084\u308A\u65B9:"",\u4ED5\u65B9:""}},{title:"\u505A\u6210\u7684\u6837\u5B50\u3001\u89C4\u683C",words:{\u4F5C\u308A:"",\u4ED5\u69D8:""}}],"synonym:\u5DEE\u5F02":[{title:"\u65E5\u5E38\uFF1A\u4E0D\u540C\u3001\u5DEE\u8DDD",words:{\u9055\u3044:"",\u5DEE:""}},{title:"\u4E66\u9762\u8BBA\u8FF0",words:{\u76F8\u9055:"",\u5DEE\u7570:""}}],"synonym:\u9519\u8BEF":[{title:"\u65E5\u5E38\u3001\u5DE5\u4F5C\u4E0A\u7684\u5931\u8BEF",words:{\u9593\u9055\u3044:"",\u30DF\u30B9:""}},{title:"\u6B63\u5F0F\uFF1A\u5185\u5BB9\u6216\u8BA4\u8BC6\u9519\u4E86",words:{\u8AA4\u308A:"",\u932F\u8AA4:"",\u8AA4\u8B2C:""}},{title:"\u5E26\u8D23\u4EFB\u7684\u8FC7\u5931",words:{\u904E\u3061:""}}],"synonym:\u5173\u7CFB":[{title:"\u4E8B\u7269\u3001\u4EBA\u4E4B\u95F4\u7684\u5173\u8054",words:{\u95A2\u4FC2:"",\u95A2\u308F\u308A:""}},{title:"\u4EBA\u548C\u4EBA\u4E4B\u95F4\u7684\u4EA4\u60C5\u3001\u8EAB\u4EFD",words:{\u4EF2:"",\u9593\u67C4:""}}],"synonym:\u60F3\u8D77":[{title:"\u60F3\u8D77\u8FC7\u53BB\u7684\u4E8B",words:{\u601D\u3044\u51FA\u3059:"\u4ED6",\u601D\u3044\u8D77\u3053\u3059:"\u4ED6"}},{title:"\u8111\u4E2D\u6D6E\u73B0\u753B\u9762",words:{\u601D\u3044\u6D6E\u304B\u3076:"\u81EA",\u601D\u3044\u6D6E\u304B\u3079\u308B:"\u4ED6"}},{title:"\u60F3\u5230\u7EBF\u7D22",words:{\u601D\u3044\u5F53\u305F\u308B:"\u81EA"}}],"synonym:\u6BD4\u8D5B":[{title:"\u5BF9\u6297\u3001\u6BD4\u8D5B\u4E2D\u7684\u8868\u73B0",words:{\u8A66\u5408:"",\u30D7\u30EC\u30FC:""}},{title:"\u6309\u901F\u5EA6\u6216\u8BC4\u6BD4\u5B9A\u540D\u6B21",words:{\u30EC\u30FC\u30B9:"",\u30B3\u30F3\u30AF\u30FC\u30EB:""}}],"synonym:\u4E8B\u60C5":[{title:"\u6CDB\u6307\u4E8B\u60C5\u3001\u4E8B\u9879",words:{\u3053\u3068:"",\u4E8B\u67C4:""}},{title:"\u8981\u53BB\u529E\u7684\u4E8B",words:{\u7528\u4E8B:"",\u7528\u4EF6:""}}],"synonym:\u60C5\u51B5":[{title:"\u5047\u8BBE\u3001\u4E2A\u6848",words:{\u5834\u5408:"",\u30B1\u30FC\u30B9:""}},{title:"\u80CC\u666F\u7F18\u7531\u3001\u5BA2\u89C2\u72B6\u6001",words:{\u4E8B\u60C5:"",\u72B6\u6CC1:""}}],"synonym:\u7279\u522B":[{title:"\u5728\u80AF\u5B9A\u53E5\u91CC\u70B9\u51FA\u4E00\u9879",words:{\u7279\u306B:"",\u3068\u308A\u308F\u3051:""}},{title:"\u5426\u5B9A\u53E5\u3001\u523B\u610F\u5F3A\u8C03",words:{\u53D6\u308A\u7ACB\u3066\u3066:"",\u3053\u3068\u3055\u3089:""}}],"synonym:\u5546\u54C1":[{title:"\u4E00\u822C\u8BF4\u6CD5",words:{\u54C1\u7269:"",\u5546\u54C1:""}},{title:"\u7279\u6307\uFF1A\u5356\u54C1\u3001\u5468\u8FB9",words:{\u58F2\u308A\u7269:"",\u30B0\u30C3\u30BA:""}}],"synonym:\u8FD4\u56DE":[{title:"\u65E5\u5E38\uFF1A\u56DE\u6765\u3001\u8FD8\u56DE\u6765",words:{\u623B\u308B:"\u81EA",\u8FD4\u308B:"\u81EA",\u5F15\u304D\u8FD4\u3059:"\u81EA"}},{title:"\u7ACB\u3061\u301C\uFF1A\u56DE\u5230\u539F\u70B9\uFF08\u4E66\u9762\uFF09",words:{\u7ACB\u3061\u8FD4\u308B:"\u81EA",\u7ACB\u3061\u623B\u308B:"\u81EA"}}],"synonym:\u6545\u4E61":[{title:"\u6545\u4E61\u672C\u8EAB",words:{\u3075\u308B\u3055\u3068:"",\u6545\u90F7:""}},{title:"\u5730\u65B9\u7279\u8272\u3001\u51FA\u8EAB\u5730",words:{\u90F7\u571F:"",\u90F7\u91CC:""}}],"synonym:\u62FC\u547D\u7684":[{title:"\u52AA\u529B",words:{\u4E00\u751F\u61F8\u547D:"",\u61F8\u547D:""}},{title:"\u5E26\u5371\u673A\u611F\uFF1A\u6025\u3001\u9669",words:{\u5FC5\u6B7B:"",\u8E8D\u8D77:"",\u547D\u304C\u3051:""}}],"synonym:\u7A81\u7136":[{title:"\u4E8B\u60C5\u7A81\u7136\u53D1\u751F",words:{\u6025\u306B:"",\u7A81\u7136:""}},{title:"\u6BEB\u65E0\u9884\u544A\u3001\u4E00\u4E0B\u5B50\u7684\u52A8\u4F5C",words:{\u3044\u304D\u306A\u308A:"",\u3070\u3063\u3068:""}}],"synonym:\u8D85\u8FC7":[{title:"\u8D8A\u8FC7\u754C\u9650\u3001\u6570\u503C",words:{\u8D85\u3048\u308B:"\u4ED6",\u8D85\u3059:"\u4ED6",\u4E0A\u56DE\u308B:"\u4ED6"}},{title:"\u79FB\u52A8\u4E2D\u8FFD\u8FC7\u53BB",words:{\u8FFD\u3044\u8D8A\u3059:"\u4ED6"}}],"synonym:\u773C\u524D":[{title:"\u7A7A\u95F4\uFF1A\u5C31\u5728\u9762\u524D",words:{\u76EE\u306E\u524D:""}},{title:"\u65F6\u95F4\uFF1A\u9A6C\u4E0A\u8981\u53D1\u751F",words:{\u76EE\u524D:"",\u5BF8\u524D:""}},{title:"\u773C\u524D\u5229\u76CA",words:{\u76EE\u5148:""}}],"synonym:\u4E3E\u8D77":[{title:"\u4E3E\uFF1A\u81EA\u4ED6\u5BF9",words:{\u6319\u3052\u308B:"\u4ED6",\u6319\u304C\u308B:"\u81EA"}},{title:"\u62AC\u8D77\u3001\u9AD8\u4E3E",words:{\u6301\u3061\u4E0A\u3052\u308B:"\u4ED6",\u63B2\u3052\u308B:"\u4ED6"}}],"synonym:\u7ACB\u523B":[{title:"\u3059\u3050 \u7CFB\uFF1A\u9A6C\u4E0A\u505A",words:{\u3059\u3050:"",\u3059\u3050\u306B:""}},{title:"\u8F6C\u773C\u95F4\uFF0F\u6293\u4F4F\u65F6\u673A",words:{\u305F\u3061\u307E\u3061:"",\u3059\u304B\u3055\u305A:""}}],"synonym:\u56FE\u8868":[{title:"\u56FE",words:{\u30B0\u30E9\u30D5:"",\u56F3:""}},{title:"\u6C49\u8BED\uFF1A\u6B63\u5F0F\u7EDF\u79F0\u3001\u793A\u610F\u56FE",words:{\u56F3\u8868:"",\u56F3\u5F0F:""}}],"synonym:\u8DEF\u7EBF":[{title:"\u5916\u6765\u8BED",words:{\u30B3\u30FC\u30B9:"",\u30EB\u30FC\u30C8:""}},{title:"\u548C\u8BED \u9053\u301C\uFF1A\u8D70\u6CD5\u3001\u8109\u7EDC",words:{\u9053\u9806:"",\u9053\u7B4B:""}}],"synonym:\u4E3B\u9898":[{title:"\u4F5C\u54C1\u3001\u7814\u7A76\u7684\u6838\u5FC3",words:{\u30C6\u30FC\u30DE:"",\u4E3B\u984C:"",\u30E2\u30C1\u30FC\u30D5:""}},{title:"\u90AE\u4EF6\u3001\u6587\u4EF6\u7684\u6807\u9898",words:{\u4EF6\u540D:""}}],"synonym:\u89E3\u5F00":[{title:"\u8BFB \u3068\u304F\uFF0F\u3068\u3051\u308B\uFF1A\u89E3\u5F00\u3001\u89E3\u9898",words:{\u89E3\u304F:"\u4ED6",\u89E3\u3051\u308B:"\u81EA"}},{title:"\u8BFB \u307B\u3069\uFF0F\u307B\u3050\uFF1A\u677E\u5F00\u3001\u653E\u677E",words:{\u307B\u3069\u3051\u308B:"\u81EA",\u307B\u3050\u3059:"\u4ED6",\u307B\u3050\u308C\u308B:"\u81EA"}}],"synonym:\u6BD4\u4F8B":[{title:"\u5360\u6BD4",words:{\u5272\u5408:"",\u6BD4\u4F8B:""}},{title:"\u4EFD\u989D\u3001\u6C47\u7387",words:{\u5272\u308A:"",\u30EC\u30FC\u30C8:""}}],"synonym:\u987A\u5E8F":[{title:"\u5148\u540E\u6B21\u5E8F",words:{\u9806\u756A:"",\u9806:"",\u9806\u5E8F:""}},{title:"\u6392\u597D\u7684\u9635\u5BB9\u3001\u7B49\u7EA7",words:{\u30AA\u30FC\u30C0\u30FC:"",\u5E8F\u5217:""}}],"synonym:\u76EE\u6807":[{title:"\u8981\u8FBE\u6210\u7684\u6307\u6807\u3001\u5BF9\u8C61",words:{\u76EE\u6A19:"",\u30BF\u30FC\u30B2\u30C3\u30C8:""}},{title:"\u80CC\u540E\u7684\u610F\u56FE\u3001\u76EE\u7684",words:{\u72D9\u3044:"",\u76EE\u5F53\u3066:""}},{title:"\u9884\u8BA1\u3001\u5934\u7EEA",words:{\u3081\u3069:""}}],"synonym:\u9053\u7406":[{title:"\u7F18\u6545\u3001\u7406\u7531",words:{\u8A33:"",\u7406\u5C48:""}},{title:"\u903B\u8F91\u3001\u60C5\u7406",words:{\u8AD6\u7406:"",\u9053\u7406:""}}],"synonym:\u4EFB\u6027\u7684":[{title:"\u53EA\u987E\u81EA\u5DF1",words:{\u308F\u304C\u307E\u307E:"",\u8EAB\u52DD\u624B:"",\u52DD\u624B:""}},{title:"\u968F\u5FC3\u3001\u591A\u53D8",words:{\u6C17\u307E\u307E:"",\u6C17\u307E\u3050\u308C:""}}],"synonym:\u5DE8\u5927\u7684":[{title:"\u89C4\u6A21\u3001\u6570\u91CF\u5927",words:{\u5DE8\u5927:"",\u83AB\u5927:""}},{title:"\u5F71\u54CD\u3001\u7A0B\u5EA6\u5927\uFF08\u4E66\u9762\uFF09",words:{\u591A\u5927:"",\u751A\u5927:""}}],"synonym:\u987A\u5229\u7684":[{title:"\u8FDB\u5C55\u3001\u72B6\u6001\u597D",words:{\u9806\u8ABF:"",\u597D\u8ABF:""}},{title:"\u6D41\u7545\u65E0\u963B",words:{\u30B9\u30E0\u30FC\u30BA:"",\u5186\u6ED1:""}}],"synonym:\u660E\u663E\u7684":[{title:"\u6E05\u695A\u53EF\u89C1",words:{\u660E\u3089\u304B:"",\u660E\u767D:"",\u6B74\u7136:""}},{title:"\u9732\u9AA8\u3001\u4E0D\u906E\u63A9",words:{\u3042\u304B\u3089\u3055\u307E:""}}],"synonym:\u4F38\u51FA":[{title:"\u5DEE\u3057\u301C\uFF1A\u9012\u7ED9\u5BF9\u65B9",words:{\u5DEE\u3057\u4F38\u3079\u308B:"\u4ED6",\u5DEE\u3057\u51FA\u3059:"\u4ED6"}},{title:"\u5F80\u524D\u4F38",words:{\u7A81\u304D\u51FA\u3059:"\u4ED6",\u4F38\u3079\u308B:"\u4ED6"}}],"synonym:\u5916\u89C2":[{title:"\u5916 \u5B57\u5934\uFF1A\u5916\u90E8\u6837\u5B50",words:{\u5916\u898B:"",\u5916\u89B3:""}},{title:"\u898B \u5B57\u5934\uFF1A\u770B\u8D77\u6765\u3001\u5356\u76F8",words:{\u898B\u304B\u3051:"",\u898B\u6804\u3048:""}}],"reading-sense:\u5206":[{title:"\u65F6\u95F4\uFF1A\u5206\u949F",words:{\u3075\u3093:""}},{title:"\u4EFD\u989D",words:{\u3076\u3093:"",\u3076:""}}],"reading-sense:\u9593":[{title:"\u65F6\u95F4\uFF1A\u671F\u95F4",words:{\u304B\u3093:""}},{title:"\u95F4\u9694\uFF1A\u4E24\u8005\u4E4B\u95F4",words:{\u3042\u3044\u3060:""}},{title:"\u7A7A\u9699",words:{\u307E:""}}],"reading-sense:\u89D2":[{title:"\u4F4D\u7F6E\uFF1A\u62D0\u89D2",words:{\u304B\u3069:""}},{title:"\u51E0\u4F55\uFF1A\u89D2\u5EA6",words:{\u304B\u304F:""}},{title:"\u52A8\u7269\u7684\u89D2",words:{\u3064\u306E:""}}],"synonym:\u8B66\u5BDF":[{title:"\u673A\u6784",words:{\u8B66\u5BDF:""}},{title:"\u6267\u6CD5\u4EBA\u5458",words:{\u8B66\u5BDF\u5B98:"",\u8B66\u5B98:""}}],"synonym:\u539F\u56E0":[{title:"\u6C49\u8BED\uFF1A\u539F\u56E0\u3001\u7F18\u7531",words:{\u539F\u56E0:"",\u6240\u4EE5:""}},{title:"\u4E5F\u80FD\u8868\u793A\u76EE\u7684",words:{\u305F\u3081:""}}],"synonym:\u9057\u61BE\u7684":[{title:"\u4E2A\u4EBA\u611F\u53D7\uFF1A\u53EF\u60DC\u3001\u6094\u6068",words:{\u6B8B\u5FF5:"",\u7121\u5FF5:""}},{title:"\u6B63\u5F0F\u8BC4\u4EF7",words:{\u907A\u61BE:""}}],"synonym:\u65F6\u95F4":[{title:"\u9636\u6BB5\u3001\u65F6\u671F",words:{\u6642\u671F:""}},{title:"\u65F6\u957F\u3001\u65F6\u523B",words:{\u6642\u9593:""}},{title:"\u6BD4\u8D5B\u8BA1\u65F6",words:{\u30BF\u30A4\u30E0:""}}],"synonym:\u4F4F\u6240":[{title:"\u767B\u8BB0\u7684\u5730\u5740",words:{\u4F4F\u6240:""}},{title:"\u5C45\u4F4F\u7684\u623F\u5C4B",words:{\u4F4F\u307E\u3044:"",\u4F4F\u5C45:""}}],"synonym:\u6765":[{title:"\u671D\u8BF4\u8BDD\u4EBA\u65B9\u5411\u6765",words:{\u6765\u308B:"\u81EA"}},{title:"\u5C0A\u656C\u8BED\uFF1A\u6765\u3001\u53BB\u3001\u5728",words:{\u3044\u3089\u3063\u3057\u3083\u308B:"\u81EA",\u304A\u3044\u3067\u306B\u306A\u308B:"\u81EA"}}],"synonym:\u505A":[{title:"\u4E2D\u6027\u8BF4\u6CD5",words:{\u3059\u308B:"\u81EA\u4ED6"}},{title:"\u53E3\u8BED",words:{\u3084\u308B:"\u4ED6"}},{title:"\u8C26\u8BA9\u8BED",words:{\u3044\u305F\u3059:"\u4ED6"}}],"synonym:\u533B\u751F":[{title:"\u65E5\u5E38\u79F0\u547C",words:{\u533B\u8005:""}},{title:"\u6B63\u5F0F\u804C\u4E1A\u540D\u79F0",words:{\u533B\u5E2B:""}},{title:"\u5916\u6765\u8BED\uFF1A\u4E5F\u6307\u535A\u58EB",words:{\u30C9\u30AF\u30BF\u30FC:""}}],"synonym:\u5B66\u751F":[{title:"\u5728\u6821\u5B66\u4E60\u8005",words:{\u5B66\u751F:"",\u751F\u5F92:""}},{title:"\u6559\u5E08\u6240\u6559\u7684\u4EBA",words:{\u6559\u3048\u5B50:""}}],"synonym:\u4E08\u592B":[{title:"\u4E2D\u6027\u914D\u5076\u79F0\u547C",words:{\u592B:""}},{title:"\u4E5F\u6307\u4E3B\u4EBA",words:{\u4E3B\u4EBA:"",\u4EAD\u4E3B:""}}],"synonym:\u59BB\u5B50":[{title:"\u4E2D\u6027\u914D\u5076\u79F0\u547C",words:{\u59BB:""}},{title:"\u4F20\u7EDF\u5BB6\u5EAD\u79F0\u547C",words:{\u5BB6\u5185:"",\u5973\u623F:""}}],"synonym:\u5305":[{title:"\u643A\u5E26\u7528\u5305",words:{\u304B\u3070\u3093:"",\u30D0\u30C3\u30B0:""}},{title:"\u67D4\u8F6F\u888B\u5B50",words:{\u888B:""}}],"synonym:\u7968":[{title:"\u4E58\u8F66\u3001\u5165\u573A\u51ED\u8BC1",words:{\u30C1\u30B1\u30C3\u30C8:"",\u5207\u7B26:""}},{title:"\u9009\u7968\u3001\u7968\u6570",words:{\u7968:""}}],"synonym:\u8BF7":[{title:"\u793C\u8C8C\u9080\u8BF7",words:{\u3069\u3046\u305E:""}},{title:"\u90D1\u91CD\u6073\u8BF7",words:{\u3069\u3046\u304B:"",\u4F55\u3068\u305E:""}}],"synonym:\u5DF2\u7ECF":[{title:"\u4E00\u822C\u8BF4\u660E\u5DF2\u7ECF\u53D1\u751F",words:{\u3082\u3046:"",\u3059\u3067\u306B:""}},{title:"\u591A\u63A5\u5426\u5B9A\uFF1A\u5982\u4ECA\u4E0D\u518D",words:{\u3082\u306F\u3084:""}}],"synonym:\u996E\u6599":[{title:"\u65E5\u5E38\u7EDF\u79F0",words:{\u98F2\u307F\u7269:""}},{title:"\u5916\u6765\u8BED\uFF1A\u83DC\u5355\u3001\u5546\u54C1",words:{\u30C9\u30EA\u30F3\u30AF:""}},{title:"\u6B63\u5F0F\u5206\u7C7B",words:{\u98F2\u6599:""}}],"synonym:\u8F66\u7AD9":[{title:"\u94C1\u8DEF\u3001\u5730\u94C1\u7AD9",words:{\u99C5:""}},{title:"\u5916\u6765\u8BED\uFF1A\u670D\u52A1\u7AD9\u70B9",words:{\u30B9\u30C6\u30FC\u30B7\u30E7\u30F3:""}},{title:"\u516C\u4EA4\u505C\u9760\u5904",words:{\u505C\u7559\u6240:""}}],"synonym:\u5404\u4F4D":[{title:"\u65E5\u5E38\u79F0\u547C\u542C\u4F17",words:{\u7686\u3055\u3093:""}},{title:"\u793C\u8C8C\u5730\u6307\u4E00\u7FA4\u4EBA",words:{\u65B9\u3005:""}},{title:"\u4E66\u9762\u79F0\u547C\u6536\u4FE1\u4EBA",words:{\u5404\u4F4D:""}}],"synonym:\u5BF9\u9762":[{title:"\u5411\u3053\u3046\uFF1A\u90A3\u4E00\u8FB9",words:{\u5411\u3053\u3046:"",\u5411\u3053\u3046\u5074:""}},{title:"\u6B63\u76F8\u5BF9\u7684\u4F4D\u7F6E",words:{\u5411\u304B\u3044:""}}],"synonym:\u64C5\u957F\u7684":[{title:"\u6280\u80FD\u719F\u7EC3\u7684\u8BC4\u4EF7",words:{\u4E0A\u624B:""}},{title:"\u5F97 \u5B57\u5934\uFF1A\u5F3A\u9879",words:{\u5F97\u610F:"",\u5F97\u624B:""}}],"synonym:\u4EBA":[{title:"\u65E5\u5E38\u6307\u4E2A\u4EBA",words:{\u4EBA:""}},{title:"\u4EBA\u7C7B\u3001\u672C\u6027",words:{\u4EBA\u9593:""}},{title:"\u63A5\u5728\u8EAB\u4EFD\u7C7B\u522B\u540E",words:{\u8005:""}}],"synonym:\u8EAB\u4F53":[{title:"\u548C\u8BED\uFF1A\u65E5\u5E38\u8868\u8FBE",words:{\u4F53:"",\u8EAB:""}},{title:"\u6C49\u8BED\uFF1A\u6B63\u5F0F\u4EBA\u4F53\u6982\u5FF5",words:{\u8EAB\u4F53:""}}],"synonym:\u5929\u6C14":[{title:"\u65E5\u5E38\u5929\u6C14",words:{\u5929\u6C17:""}},{title:"\u5BA2\u89C2\u8BB0\u5F55\u5929\u6C14",words:{\u5929\u5019:""}},{title:"\u9002\u5408\u67D0\u6D3B\u52A8\u7684\u5929\u6C14",words:{\u65E5\u548C:""}}],"synonym:\u665A\u996D":[{title:"\u5BB6\u5EAD\u65E5\u5E38\u79F0\u547C",words:{\u6669\u3054\u98EF:"",\u5915\u98EF:""}},{title:"\u6B63\u5F0F\u9910\u6B21\u540D\u79F0",words:{\u5915\u98DF:""}}],"synonym:\u611F\u89C9":[{title:"\u4E3B\u89C2\u5370\u8C61",words:{\u611F\u3058:""}},{title:"\u611F\u5B98\u80FD\u529B",words:{\u611F\u899A:""}},{title:"\u63A5\u8BCD\u540E\u8868\u793A\u503E\u5411",words:{\u6C17\u5473:""}}],"synonym:\u5F04\u9519":[{title:"\u9593\u9055\u301C\uFF1A\u65E5\u5E38\u8BF4\u505A\u9519",words:{\u9593\u9055\u3048\u308B:"\u4ED6",\u9593\u9055\u3046:"\u81EA\u4ED6"}},{title:"\u4E66\u9762\u8BF4\u5224\u65AD\u5931\u8BEF",words:{\u8AA4\u308B:"\u81EA\u4ED6"}}],"synonym:\u60F3\u6CD5":[{title:"\u8003\u3048\u301C\uFF1A\u610F\u89C1\u3001\u601D\u8003",words:{\u8003\u3048:"",\u8003\u3048\u65B9:""}},{title:"\u5916\u6765\u8BED\uFF1A\u5177\u4F53\u521B\u610F",words:{\u30A2\u30A4\u30C7\u30A2:""}}],"synonym:\u8BA4\u771F\u7684":[{title:"\u6027\u683C\u8E0F\u5B9E",words:{\u771F\u9762\u76EE:""}},{title:"\u9762\u5BF9\u4E8B\u60C5\u7684\u6001\u5EA6",words:{\u771F\u5263:"",\u672C\u6C17:""}}],"synonym:\u5EA7\u4F4D":[{title:"\u4E5F\u6307\u5E2D\u4F4D\u3001\u540D\u989D",words:{\u5E2D:""}},{title:"\u4F9B\u4EBA\u5750\u7684\u4F4D\u7F6E\u3001\u5EA7\u6905",words:{\u5EA7\u5E2D:"",\u30B7\u30FC\u30C8:""}}],"synonym:\u5185\u5BB9":[{title:"\u6587\u7AE0\u3001\u8282\u76EE\u4FE1\u606F",words:{\u5185\u5BB9:""}},{title:"\u5BB9\u5668\u91CC\u7684\u4E1C\u897F",words:{\u4E2D\u8EAB:""}},{title:"\u6570\u5B57\u5A92\u4F53\u4F5C\u54C1",words:{\u30B3\u30F3\u30C6\u30F3\u30C4:""}}],"synonym:\u8EAB\u9AD8":[{title:"\u80CC \u5B57\u5934\uFF1A\u65E5\u5E38\u8EAB\u9AD8",words:{\u80CC:"",\u80CC\u4E08:""}},{title:"\u6B63\u5F0F\u6D4B\u91CF\u3001\u767B\u8BB0",words:{\u8EAB\u9577:""}}],"synonym:\u800C\u4E14":[{title:"\u8865\u5145\u3001\u9012\u52A0\u4FE1\u606F",words:{\u305D\u308C\u306B:"",\u305D\u306E\u3046\u3048:""}},{title:"\u5F3A\u8C03\u8D85\u51FA\u9884\u671F",words:{\u3057\u304B\u3082:""}}],"synonym:\u6280\u672F":[{title:"\u6280\u672F\u4F53\u7CFB\u3001\u5DE5\u827A",words:{\u6280\u8853:""}},{title:"\u5177\u4F53\u6280\u5DE7\u3001\u624B\u6CD5",words:{\u30C6\u30AF\u30CB\u30C3\u30AF:"",\u6280\u6CD5:""}}],"synonym:\u76F8\u53CD\u7684":[{title:"\u65B9\u5411\u3001\u7ACB\u573A\u76F8\u53CD",words:{\u9006:"",\u53CD\u5BFE:""}},{title:"\u8868\u91CC\u4E0D\u4E00\u81F4",words:{\u88CF\u8179:""}}],"synonym:\u7D27\u6025\u7684":[{title:"\u4E5F\u5F62\u5BB9\u7A81\u7136\u3001\u9661\u5CED",words:{\u6025:""}},{title:"\u5C3D\u5FEB\u5904\u7406",words:{\u65E9\u6025:""}},{title:"\u6B63\u5F0F\u5371\u6025\u72B6\u6001",words:{\u7DCA\u6025:""}}],"synonym:\u627E\u5230":[{title:"\u4E1C\u897F\u4F5C\u4E3B\u8BED\uFF08\u81EA\uFF09",words:{\u898B\u3064\u304B\u308B:"\u81EA",\u898B\u5F53\u305F\u308B:"\u81EA"}},{title:"\u5BFB\u627E\u8005\u4F5C\u4E3B\u8BED\uFF08\u4ED6\uFF09",words:{\u898B\u3064\u3051\u308B:"\u4ED6"}}],"synonym:\u7559\u4E0B":[{title:"\u5269\u4E0B\u7684\u4EBA\u7269\u4F5C\u4E3B\u8BED\uFF08\u81EA\uFF09",words:{\u6B8B\u308B:"\u81EA"}},{title:"\u628A\u5BF9\u8C61\u7559\u4E0B\uFF08\u4ED6\uFF09",words:{\u6B8B\u3059:"\u4ED6",\u53D6\u308A\u6B8B\u3059:"\u4ED6"}}],"synonym:\u7EBF":[{title:"\u7EBF\u6761\u3001\u8DEF\u7EBF\u3001\u754C\u7EBF",words:{\u7DDA:"",\u30E9\u30A4\u30F3:""}},{title:"\u7F1D\u7EAB\u3001\u7F16\u7EC7\u6750\u6599",words:{\u7CF8:""}}],"synonym:\u8868\u9762":[{title:"\u7269\u4F53\u6B63\u9762\u3001\u5916\u5C42",words:{\u8868:"",\u8868\u9762:""}},{title:"\u5916\u8868\u4E0E\u771F\u5B9E\u76F8\u5BF9",words:{\u4E0A\u8FBA:""}}],"synonym:\u5206\u5F00":[{title:"\u4E3B\u52A8\u5206\u5F00\uFF08\u4ED6\uFF09",words:{\u5206\u3051\u308B:"\u4ED6",\u5207\u308A\u96E2\u3059:"\u4ED6"}},{title:"\u6574\u4F53\u81EA\u884C\u5206\u5F00\uFF08\u81EA\uFF09",words:{\u5206\u304B\u308C\u308B:"\u81EA"}}],"synonym:\u65B9\u6CD5":[{title:"\u4E00\u822C\u505A\u6CD5",words:{\u65B9\u6CD5:""}},{title:"\u89E3\u51B3\u95EE\u9898\u7684\u5BF9\u7B56",words:{\u65B9\u7B56:""}},{title:"\u5916\u6765\u8BED\uFF1A\u4F53\u7CFB\u5316\u7A0B\u5E8F",words:{\u30E1\u30BD\u30C3\u30C9:""}}],"synonym:\u80CC\u9762":[{title:"\u8BFB \u3046\u3089\uFF1A\u65E5\u5E38\u80CC\u9762",words:{\u88CF:"",\u88CF\u5074:""}},{title:"\u8BFB \u308A\u3081\u3093\uFF1A\u6B63\u5F0F\u8BF4\u6CD5",words:{\u88CF\u9762:""}}],"synonym:\u597D\u597D\u5730":[{title:"\u80AF\u5B9A\u5730\u8BF4\u505A\u597D",words:{\u3061\u3083\u3093\u3068:"",\u304D\u3061\u3093\u3068:""}},{title:"\u591A\u63A5\u5426\u5B9A\uFF1A\u4E0D\u5145\u5206",words:{\u308D\u304F\u306B:""}}],"synonym:\u8F7B\u677E\u7684":[{title:"\u4E0D\u8D39\u529B\u3001\u8212\u670D",words:{\u697D:""}},{title:"\u6C17 \u5B57\u5934\uFF1A\u5FC3\u7406\u65E0\u62D8\u675F",words:{\u6C17\u697D:"",\u6C17\u8EFD:""}}],"synonym:\u540C\u4F34":[{title:"\u540C\u4E00\u7FA4\u4F53\u7684\u4F19\u4F34",words:{\u4EF2\u9593:""}},{title:"\u51FA\u884C\u3001\u966A\u540C\u5173\u7CFB",words:{\u9023\u308C:"",\u540C\u4F34:""}}],"synonym:\u521A\u624D":[{title:"\u53E3\u8BED\u8BF4\u4E0D\u4E45\u524D",words:{\u3055\u3063\u304D:"",\u305F\u3063\u305F\u4ECA:""}},{title:"\u793C\u8C8C\u3001\u6B63\u5F0F\u8BF4\u6CD5",words:{\u5148\u307B\u3069:""}}],"synonym:\u538B\u529B":[{title:"\u5916\u6765\u8BED\uFF1A\u8EAB\u5FC3\u8D1F\u62C5",words:{\u30B9\u30C8\u30EC\u30B9:"",\u30D7\u30EC\u30C3\u30B7\u30E3\u30FC:""}},{title:"\u4E5F\u6307\u7269\u7406\u538B\u529B",words:{\u5727\u529B:""}}],"synonym:\u6293\u4F4F":[{title:"\u6355 \u5B57\u5934\uFF1A\u902E\u6355\u3001\u6355\u83B7",words:{\u6355\u307E\u3048\u308B:"\u4ED6",\u6355\u3089\u3048\u308B:"\u4ED6"}},{title:"\u7528\u624B\u6293\u53D6",words:{\u3064\u304B\u3080:"\u4ED6"}}],"synonym:\u6837\u5B50":[{title:"\u89C2\u5BDF\u5230\u7684\u72B6\u6001",words:{\u69D8\u5B50:""}},{title:"\u88C5\u51FA\u6765\u7684\u59FF\u6001",words:{\u632F\u308A:""}},{title:"\u4E66\u9762\u8BF4\u5B58\u5728\u65B9\u5F0F",words:{\u3042\u308A\u3088\u3046:""}}],"synonym:\u5BA2\u5385":[{title:"\u5BB6\u5EAD\u8D77\u5C45\u5BA4",words:{\u5C45\u9593:"",\u30EA\u30D3\u30F3\u30B0:""}},{title:"\u63A5\u5F85\u3001\u4F4F\u5BBF\u5BA2\u623F",words:{\u5BA2\u5BA4:""}}],"synonym:\u5E03\u6599":[{title:"\u5E03 \u5B57\u5934\uFF1A\u7EC7\u7269",words:{\u5E03:"",\u5E03\u5730:""}},{title:"\u4E5F\u6307\u9762\u56E2\u7B49\u5E95\u6599",words:{\u751F\u5730:""}}],"synonym:\u6682\u65F6":[{title:"\u4E00\u6BB5\u65F6\u95F4",words:{\u3057\u3070\u3089\u304F:"",\u5F53\u5206:""}},{title:"\u5148\u505A\u4E00\u6B65\u518D\u8BF4",words:{\u3044\u3063\u305F\u3093:""}}],"synonym:\u5C31\u4E1A":[{title:"\u83B7\u5F97\u804C\u4F4D",words:{\u5C31\u8077:""}},{title:"\u4ECE\u4E8B\u5DE5\u4F5C\u3001\u52B3\u52A8",words:{\u5C31\u696D:"",\u5C31\u52B4:""}}],"synonym:\u8BBE\u8BA1":[{title:"\u5DE5\u7A0B\u3001\u7CFB\u7EDF\u89C4\u5212",words:{\u8A2D\u8A08:""}},{title:"\u5916\u6765\u8BED\uFF1A\u89C6\u89C9\u5916\u89C2",words:{\u30C7\u30B6\u30A4\u30F3:""}},{title:"\u6784\u601D\u65B0\u65B9\u6848",words:{\u8003\u6848:""}}],"synonym:\u5E74\u957F":[{title:"\u76F8\u5BF9\u67D0\u4EBA\u5E74\u9F84\u5927",words:{\u5E74\u4E0A:"",\u5E74\u9577:""}},{title:"\u4E2D\u8001\u5E74",words:{\u5E74\u914D:""}}],"synonym:\u679C\u7136":[{title:"\u65E5\u5E38\u786E\u8BA4\uFF1A\u3084 \u7CFB",words:{\u3084\u3063\u3071\u308A:"",\u3084\u306F\u308A:""}},{title:"\u4E66\u9762\u8BF4\u4E0D\u51FA\u6240\u6599",words:{\u6848\u306E\u5B9A:""}}],"synonym:\u4E0D\u4E45":[{title:"\u5F88\u5FEB\u5373\u5C06\u53D1\u751F",words:{\u9593\u3082\u306A\u304F:""}},{title:"\u8FC7\u4E00\u9635\u540E\u51FA\u73B0\u7ED3\u679C",words:{\u3084\u304C\u3066:""}},{title:"\u8FD1\u65E5",words:{\u8FD1\u3005:""}}],"synonym:\u518D\u6B21":[{title:"\u65E5\u5E38\u8BF4\u6CD5",words:{\u3082\u3046\u4E00\u5EA6:""}},{title:"\u518D \u5B57\u5934\uFF1A\u8F83\u4E66\u9762",words:{\u518D\u3073:"",\u518D\u5EA6:""}}],"synonym:\u603B\u4E4B":[{title:"\u6682\u4E0D\u8BA1\u8F83\u67D0\u9879",words:{\u3068\u306B\u304B\u304F:"",\u3068\u3082\u304B\u304F:""}},{title:"\u5F52\u7EB3\u524D\u6587\u7ED3\u8BBA",words:{\u8981\u3059\u308B\u306B:""}}],"synonym:\u6210\u5458":[{title:"\u5916\u6765\u8BED\uFF1A\u56E2\u961F\u6210\u5458",words:{\u30E1\u30F3\u30D0\u30FC:""}},{title:"\u793E\u56E2\u3001\u90E8\u95E8\u6210\u5458",words:{\u90E8\u54E1:""}},{title:"\u4E66\u9762\u8BF4\u7EC4\u7EC7\u6210\u5458",words:{\u6210\u54E1:""}}],"synonym:\u4EF7\u503C":[{title:"\u4E8B\u7269\u7684\u4EF7\u503C\u3001\u8EAB\u4EF7",words:{\u4FA1\u5024:"",\u5024\u6253\u3061:""}},{title:"\u4ED8\u51FA\u503C\u5F97",words:{\u304B\u3044:""}}],"synonym:\u679C\u5B9E":[{title:"\u679C\u5B9E\uFF0C\u4E5F\u6BD4\u55BB\u6210\u679C",words:{\u5B9F:"",\u679C\u5B9F:""}},{title:"\u6811\u6728\u7684\u679C\u5B50\u3001\u575A\u679C",words:{\u6728\u306E\u5B9F:""}}],"synonym:\u5206\u6570":[{title:"\u6C49\u8BED\uFF1A\u5F97\u5206",words:{\u70B9\u6570:"",\u5F97\u70B9:""}},{title:"\u5916\u6765\u8BED\uFF1A\u6BD4\u8D5B\u8BB0\u5F55",words:{\u30B9\u30B3\u30A2:""}}],"synonym:\u7530\u5730":[{title:"\u65F1\u7530",words:{\u7551:""}},{title:"\u6C34\u7530",words:{\u7530\u3093\u307C:""}},{title:"\u65F1\u7530\u3001\u6C34\u7530\u603B\u79F0",words:{\u7530\u7551:""}}],"synonym:\u5206\u91CF":[{title:"\u6570\u91CF\u3001\u4EFD\u989D",words:{\u91CF:"",\u5206\u91CF:""}},{title:"\u91CD\u91CF\u3001\u5F71\u54CD\u529B",words:{\u91CD\u307F:""}}],"synonym:\u79EF\u6512":[{title:"\u81EA\u884C\u7D2F\u79EF\uFF08\u81EA\uFF09",words:{\u305F\u307E\u308B:"\u81EA"}},{title:"\u4E3B\u52A8\u79EF\u6512\uFF08\u4ED6\uFF09",words:{\u305F\u3081\u308B:"\u4ED6",\u7A4D\u307F\u7ACB\u3066\u308B:"\u4ED6"}}],"synonym:\u63D0\u524D":[{title:"\u4E3B\u52A8\u8C03\u524D\uFF08\u4ED6\uFF09",words:{\u65E9\u3081\u308B:"\u4ED6",\u7E70\u308A\u4E0A\u3052\u308B:"\u4ED6"}},{title:"\u81EA\u884C\u63D0\u524D\uFF08\u81EA\uFF09",words:{\u65E9\u307E\u308B:"\u81EA"}}],"synonym:\u6346\u7ED1":[{title:"\u7E1B \u5B57\u5934\uFF1A\u6346\u7ED1\u3001\u675F\u7F1A",words:{\u7E1B\u308B:"\u4ED6",\u7E1B\u308A\u4ED8\u3051\u308B:"\u4ED6"}},{title:"\u6346\u6210\u4E00\u675F\uFF0C\u4E5F\u6307\u5F52\u7EB3",words:{\u304F\u304F\u308B:"\u4ED6"}}],"synonym:\u670D\u88C5":[{title:"\u6C49\u8BED\uFF1A\u670D\u9970\u540D\u79F0",words:{\u670D\u88C5:"",\u8863\u88C5:""}},{title:"\u548C\u8BED\uFF1A\u5916\u8868\u4E3E\u6B62",words:{\u306A\u308A\u3075\u308A:""}}],"synonym:\u897F\u5F0F":[{title:"\u897F\u5F0F\u7ED3\u6784\u3001\u98CE\u683C",words:{\u6D0B\u5F0F:"",\u6D0B\u98A8:""}},{title:"\u5355\u5B57\uFF1A\u897F\u6D0B\u3001\u6D77\u6D0B",words:{\u6D0B:""}}],"synonym:\u788E\u7247":[{title:"\u5207\u4E0B\u7684\u7247\u3001\u5757",words:{\u5207\u308C:"",\u7D30\u5207\u308C:""}},{title:"\u7834\u88C2\u540E\u7684\u788E\u7247",words:{\u7834\u7247:""}}],"synonym:\u642D\u914D":[{title:"\u5408\u308F\u305B\uFF1A\u914D\u5408\u3001\u7EC4\u5408",words:{\u5408\u308F\u305B:"",\u7D44\u307F\u5408\u308F\u305B:""}},{title:"\u5916\u6765\u8BED\uFF1A\u89C6\u89C9\u9020\u578B",words:{\u30B3\u30FC\u30C7\u30A3\u30CD\u30FC\u30C8:""}}],"synonym:\u5BDF\u89C9":[{title:"\u63A8\u6D4B\u3001\u4F53\u8C05\u4ED6\u4EBA",words:{\u5BDF\u3057:""}},{title:"\u5BDF\u89C9\u4FE1\u606F\u3001\u5F02\u5E38",words:{\u5BDF\u77E5:""}},{title:"\u611F\u5B98\u611F\u77E5",words:{\u611F\u77E5:""}}],"synonym:\u975E\u5E38":[{title:"\u4E66\u9762\u5F3A\u8C03\u7A0B\u5EA6\u9AD8",words:{\u3044\u3068\u3082:"",\u8AA0\u306B:""}},{title:"\u5E38\u63A5\u300C\u8A00\u3048\u306A\u3044\u300D",words:{\u4F55\u3068\u3082:""}}],"synonym:\u8BF4\u6CD5":[{title:"\u63AA\u8F9E\u3001\u8BF4\u8BDD\u65B9\u5F0F",words:{\u8A00\u3044\u65B9:"",\u7269\u8A00\u3044:""}},{title:"\u5B66\u8BF4\u3001\u4E3B\u5F20",words:{\u8AAC:""}}],"synonym:\u4F20\u8BF4":[{title:"\u548C\u8BED\uFF1A\u53E3\u8033\u6D41\u4F20",words:{\u6614\u8A71:"",\u8A00\u3044\u4F1D\u3048:""}},{title:"\u6C49\u8BED\uFF1A\u5386\u53F2\u795E\u79D8\u8272\u5F69",words:{\u4F1D\u8AAC:""}}],"synonym:\u79BB\u5F00":[{title:"\u7A7A\u95F4\u3001\u5173\u7CFB\u8131\u79BB",words:{\u96E2\u308C\u308B:"\u81EA"}},{title:"\u53BB \u5B57\uFF1A\u79BB\u53BB",words:{\u53BB\u308B:"\u81EA\u4ED6",\u7ACB\u3061\u53BB\u308B:"\u81EA"}}],"synonym:\u8BB0\u53F7":[{title:"\u5370 \u5B57\uFF1A\u6807\u8BB0",words:{\u5370:"",\u76EE\u5370:""}},{title:"\u6B63\u5F0F\u7B26\u53F7\u7C7B\u522B",words:{\u8A18\u53F7:""}}],"synonym:\u957F\u5904":[{title:"\u4E00\u822C\u4F18\u70B9",words:{\u9577\u6240:""}},{title:"\u7ADE\u4E89\u4F18\u52BF",words:{\u5F37\u307F:""}},{title:"\u91C7\u7528\u67D0\u505A\u6CD5\u7684\u597D\u5904",words:{\u5229\u70B9:""}}],"synonym:\u6F14\u5458":[{title:"\u620F\u5267\u3001\u5F71\u89C6\u8868\u6F14\u8005",words:{\u4FF3\u512A:"",\u5F79\u8005:""}},{title:"\u7535\u89C6\u827A\u4EBA\u3001\u7EFC\u827A\u5609\u5BBE",words:{\u30BF\u30EC\u30F3\u30C8:""}}],"synonym:\u8BBA\u70B9":[{title:"\u7406\u8BBA\u3001\u4E3B\u5F20",words:{\u8AD6:""}},{title:"\u8BA8\u8BBA\u7684\u7126\u70B9",words:{\u8AD6\u70B9:""}},{title:"\u6587\u7AE0\u7684\u4E2D\u5FC3\u5185\u5BB9",words:{\u8AD6\u65E8:""}}],"synonym:\u5C71\u9876":[{title:"\u4E0D\u9650\u4E8E\u5C71\u7684\u9876\u7AEF",words:{\u9802\u4E0A:"",\u9802:""}},{title:"\u4E13\u6307\u5C71\u7684\u6700\u9AD8\u5904",words:{\u5C71\u9802:""}}],"synonym:\u9633\u5149":[{title:"\u7167\u5C04\u611F\u3001\u6652\u611F",words:{\u65E5\u5DEE\u3057:""}},{title:"\u6C49\u8BED\uFF1A\u592A\u9633\u5149",words:{\u65E5\u5149:"",\u967D\u5149:""}}],"synonym:\u8DF3\u8D77":[{title:"\u4E0A\u304C\u308B\uFF1A\u5411\u4E0A\u8DF3",words:{\u98DB\u3073\u4E0A\u304C\u308B:"\u81EA",\u8DF3\u306D\u4E0A\u304C\u308B:"\u81EA"}},{title:"\u5F39\u8DF3\u3001\u98DE\u6E85",words:{\u8DF3\u306D\u308B:"\u81EA"}}],"synonym:\u8981\u70B9":[{title:"\u5185\u5BB9\u7684\u6838\u5FC3\u91CD\u70B9",words:{\u8981\u70B9:""}},{title:"\u5916\u6765\u8BED\uFF1A\u4E5F\u6307\u5206\u6570",words:{\u30DD\u30A4\u30F3\u30C8:""}},{title:"\u5173\u952E\u4F4D\u7F6E\u3001\u73AF\u8282",words:{\u8981\u6240:""}}],"synonym:\u7A0D\u5FAE":[{title:"\u7A0B\u5EA6\u7A0D\u8BB8",words:{\u3084\u3084:"",\u3044\u3055\u3055\u304B:""}},{title:"\u67D0\u79CD\u4E0D\u660E\u5BF9\u8C61",words:{\u4F55\u3089\u304B:""}}],"synonym:\u66FF\u6362":[{title:"\u4EA4\u6362\u4F4D\u7F6E\u3001\u5185\u5BB9",words:{\u5165\u308C\u66FF\u3048\u308B:"\u4ED6"}},{title:"\u7528\u65B0\u5BF9\u8C61\u4EE3\u66FF\u65E7\u5BF9\u8C61",words:{\u7F6E\u304D\u63DB\u3048\u308B:"\u4ED6",\u5DEE\u3057\u66FF\u3048\u308B:"\u4ED6"}}],"synonym:\u6E05\u695A\u7684":[{title:"\u5916\u6765\u8BED\uFF1A\u4E5F\u6307\u901A\u8FC7",words:{\u30AF\u30EA\u30A2:""}},{title:"\u6C49\u8BED\uFF1A\u6E05\u695A\u660E\u786E",words:{\u660E\u77AD:"",\u5206\u660E:""}}],"synonym:\u5730\u4F4D":[{title:"\u4F4D \u5B57\uFF1A\u8EAB\u4EFD\u3001\u7B49\u7EA7",words:{\u4F4D:"",\u5730\u4F4D:""}},{title:"\u5916\u6765\u8BED\uFF1A\u4E5F\u6307\u72B6\u6001",words:{\u30B9\u30C6\u30FC\u30BF\u30B9:""}}],"synonym:\u6069\u60E0":[{title:"\u5F97\u5230\u7684\u5229\u76CA\u3001\u6069\u6CFD",words:{\u6069\u6075:"",\u6075\u307F:""}},{title:"\u611F\u53D7\u5230\u7684\u53EF\u8D35",words:{\u3042\u308A\u304C\u305F\u307F:""}}],"synonym:\u6781\u5176":[{title:"\u4FEE\u9970\u4E00\u90E8\u3001\u308F\u305A\u304B",words:{\u3054\u304F:""}},{title:"\u6B63\u5F0F\u5F3A\u8C03\u7A0B\u5EA6",words:{\u6975\u3081\u3066:"",\u81F3\u3063\u3066:""}}],"synonym:\u8003\u8651":[{title:"\u628A\u6761\u4EF6\u7EB3\u5165\u5224\u65AD",words:{\u8003\u616E:""}},{title:"\u987E\u53CA\u4ED6\u4EBA\u5904\u5883",words:{\u914D\u616E:""}},{title:"\u614E\u91CD\u6DF1\u601D",words:{\u601D\u616E:""}}],"synonym:\u7EBF\u7D22":[{title:"\u8C03\u67E5\u3001\u89E3\u51B3\u7684\u7A81\u7834\u53E3",words:{\u7CF8\u53E3:""}},{title:"\u81EA\u5DF1\u8BB0\u5F97\u6216\u731C\u5230",words:{\u5FC3\u5F53\u305F\u308A:""}},{title:"\u53EF\u4F9D\u51ED\u7684\u5224\u65AD\u4F9D\u636E",words:{\u624B\u304C\u304B\u308A:""}}],"synonym:\u77AC\u95F4":[{title:"\u77ED\u6682\u65F6\u523B\u3001\u65F6\u95F4",words:{\u77AC\u9593:"",\u77AC\u6642:""}},{title:"\u7A81\u53D1\u72B6\u51B5\u4E0B\u7684\u53CD\u5E94",words:{\u3068\u3063\u3055:""}}],"synonym:\u81A8\u80C0":[{title:"\u9F13\u8D77\u3001\u589E\u5927",words:{\u81A8\u3089\u3080:"\u81EA",\u81A8\u308C\u308B:"\u81EA"}},{title:"\u4E0A\u304C\u308B\uFF1A\u6025\u5267\u66B4\u589E",words:{\u81A8\u308C\u4E0A\u304C\u308B:"\u81EA"}}],"synonym:\u6D8C\u51FA":[{title:"\u6E67 \u5B57\uFF1A\u4ECE\u5185\u90E8\u4EA7\u751F",words:{\u6E67\u304F:"\u81EA",\u6E67\u304D\u51FA\u308B:"\u81EA"}},{title:"\u8D85\u51FA\u5BB9\u91CF\u800C\u6EA2\u51FA",words:{\u3042\u3075\u308C\u51FA\u3059:"\u81EA"}}],"synonym:\u987D\u56FA\u7684":[{title:"\u9811 \u5B57\uFF1A\u56FA\u6267",words:{\u9811\u56FA:"",\u9811\u8FF7:""}},{title:"\u548C\u8BED\uFF1A\u575A\u6301\u3001\u62D2\u7EDD",words:{\u304B\u305F\u304F\u306A:""}}],"synonym:\u770B\u7A7F":[{title:"\u8BC6\u7834\u771F\u76F8\u3001\u9690\u7792",words:{\u898B\u629C\u304F:"\u4ED6",\u898B\u900F\u304B\u3059:"\u4ED6"}},{title:"\u770B\u6E05\u5168\u5C40\u3001\u9884\u89C1\u672A\u6765",words:{\u898B\u901A\u3059:"\u4ED6"}}],"synonym:\u7528\u5C3D":[{title:"\u628A\u8D44\u6E90\u7528\u5B8C\uFF08\u4ED6\uFF09",words:{\u4F7F\u3044\u679C\u305F\u3059:"\u4ED6",\u5207\u3089\u3059:"\u4ED6"}},{title:"\u8D44\u6E90\u81EA\u7136\u8017\u5C3D\uFF08\u81EA\uFF09",words:{\u5C3D\u304D\u308B:"\u81EA"}}],"synonym:\u5B89\u6392":[{title:"\u5916\u6765\u8BED\uFF1A\u4E5F\u6307\u6539\u7F16",words:{\u30A2\u30EC\u30F3\u30B8:""}},{title:"\u6B65\u9AA4\u5148\u540E\u987A\u5E8F",words:{\u6BB5\u53D6\u308A:""}},{title:"\u4EBA\u5458\u3001\u7269\u8D44\u3001\u624B\u7EED",words:{\u624B\u914D:""}}],"synonym:\u5D4C\u5165":[{title:"\u306F\u307E\u308B\uFF0F\u306F\u3081\u308B\uFF1A\u5D4C\u5408",words:{\u306F\u307E\u308B:"\u81EA",\u306F\u3081\u308B:"\u4ED6"}},{title:"\u4FB5\u5360\u7A7A\u95F4\u3001\u65F6\u95F4",words:{\u98DF\u3044\u8FBC\u3080:"\u81EA"}}],"synonym:\u6B65\u4F10":[{title:"\u5916\u6765\u8BED\uFF1A\u901F\u5EA6\u3001\u8FDB\u5EA6",words:{\u30DA\u30FC\u30B9:""}},{title:"\u811A\u6B65\uFF0C\u4E5F\u6709\u6BD4\u55BB\u4E49",words:{\u6B69\u307F:"",\u8DB3\u53D6\u308A:""}}],"synonym:\u575A\u56FA\u7684":[{title:"\u65E5\u5E38\u7ED3\u5B9E\u8010\u7528",words:{\u9811\u4E08:""}},{title:"\u6B63\u5F0F\u8BF4\u7262\u56FA\u53EF\u9760",words:{\u5F37\u56FA:"",\u5805\u7262:""}}],"synonym:\u652F\u63F4":[{title:"\u4E00\u822C\u63F4\u52A9",words:{\u652F\u63F4:""}},{title:"\u9488\u5BF9\u505C\u6EDE\u8FFD\u52A0\u63AA\u65BD",words:{\u3066\u3053\u5165\u308C:""}},{title:"\u5916\u6765\u8BED\uFF1A\u4E5F\u6307\u5907\u4EFD",words:{\u30D0\u30C3\u30AF\u30A2\u30C3\u30D7:""}}],"synonym:\u652F\u6301":[{title:"\u8D5E\u540C\u3001\u652F\u6491",words:{\u652F\u6301:""}},{title:"\u534F\u52A9\u3001\u670D\u52A1",words:{\u30B5\u30DD\u30FC\u30C8:""}},{title:"\u80CC\u540E\u63A8\u52A8\u884C\u52A8",words:{\u5F8C\u62BC\u3057:""}}],"synonym:\u624B\u52BF":[{title:"\u8EAB\u4F53\u6574\u4F53\u52A8\u4F5C",words:{\u8EAB\u632F\u308A:""}},{title:"\u624B\u90E8\u52A8\u4F5C",words:{\u624B\u632F\u308A:""}},{title:"\u5916\u6765\u8BED\uFF1A\u6709\u610F\u4F20\u8FBE",words:{\u30B8\u30A7\u30B9\u30C1\u30E3\u30FC:""}}],"synonym:\u9886\u57DF":[{title:"\u4E00\u822C\u6D3B\u52A8\u3001\u7814\u7A76\u8303\u56F4",words:{\u9818\u57DF:"",\u57DF:""}},{title:"\u81EA\u5DF1\u8D1F\u8D23\u7684\u8303\u56F4",words:{\u9818\u5206:""}}],"synonym:\u6B3A\u9A97":[{title:"\u4F7F\u5BF9\u65B9\u53D7\u9A97",words:{\u3060\u307E\u3059:"\u4ED6",\u6B3A\u304F:"\u4ED6"}},{title:"\u4F2A\u9020\u8EAB\u4EFD\u3001\u8BF4\u6CD5",words:{\u507D\u308B:"\u81EA\u4ED6"}}],"synonym:\u6838\u5FC3":[{title:"\u5355\u5B57\uFF1A\u4E5F\u6307\u539F\u5B50\u6838",words:{\u6838:""}},{title:"\u8BAE\u9898\u7684\u4E2D\u5FC3\u8981\u70B9",words:{\u6838\u5FC3:""}},{title:"\u7EC4\u7EC7\u3001\u7CFB\u7EDF\u9AA8\u5E72",words:{\u4E2D\u6838:""}}],"synonym:\u6D6A\u8D39":[{title:"\u4E71\u82B1\u94B1\u3001\u8017\u8D39\u8D44\u6E90",words:{\u7121\u99C4\u9063\u3044:"",\u6D6A\u8CBB:""}},{title:"\u5916\u6765\u8BED\uFF1A\u635F\u8017\u6D41\u5931",words:{\u30ED\u30B9:""}}],"synonym:\u89E6\u611F":[{title:"\u89E6\u308A\uFF1A\u89E6\u6478\u624B\u611F",words:{\u89E6\u308A:"",\u808C\u89E6\u308A:""}},{title:"\u4E5F\u6307\u5FC3\u7406\u5370\u8C61",words:{\u611F\u89E6:""}}],"synonym:\u611A\u8822\u7684":[{title:"\u53E3\u8BED\u9A82\u4EBA",words:{\u3070\u304B:""}},{title:"\u4E66\u9762\u8BF4\u7F3A\u4E4F\u5224\u65AD",words:{\u611A\u304B:""}},{title:"\u5177\u4F53\u7B28\u62D9\u5931\u8BEF",words:{\u3078\u307E:""}}],"synonym:\u7EC6\u81F4\u7684":[{title:"\u8BA1\u5212\u3001\u51C6\u5907\u5468\u5BC6",words:{\u7DBF\u5BC6:"",\u5165\u5FF5:""}},{title:"\u5173\u6000\u3001\u611F\u60C5\u7EC6\u817B",words:{\u7D30\u3084\u304B:""}}],"synonym:\u5996\u602A":[{title:"\u90AA\u6076\u9B54\u7269",words:{\u9B54\u7269:""}},{title:"\u5916\u5F62\u602A\u7269\u3001\u8D85\u5E38\u8005",words:{\u5316\u3051\u7269:""}},{title:"\u53E4\u5178\u6587\u5B66\u9B3C\u602A",words:{\u7269\u306E\u602A:""}}],"synonym:\u50B2\u6162\u7684":[{title:"\u6162 \u5B57\uFF1A\u81EA\u5927",words:{\u50B2\u6162:"",\u9AD8\u6162:""}},{title:"\u6446\u67B6\u5B50\uFF1A\u5C0A\u5927\u3076\u308B",words:{\u5C0A\u5927:""}}],"synonym-now:\u51C6\u5907":[{title:"\u4E3A\u505A\u4E8B\u9884\u5148\u5B89\u6392",words:{\u6E96\u5099:"",\u7528\u610F:""}},{title:"\u4E5F\u6307\u9632\u5907",words:{\u5099\u3048:""}}],"synonym-now:\u5305":[{title:"\u643A\u5E26\u7528\u5305",words:{\u304B\u3070\u3093:""}},{title:"\u88C5\u4E1C\u897F\u7684\u888B\u5B50",words:{\u888B:""}},{title:"\u5916\u6765\u8BED\uFF1A\u5305\u88C5\u3001\u9762\u819C",words:{\u30D1\u30C3\u30AF:""}}],"synonym-now:\u60F3\u6CD5":[{title:"\u610F\u89C1\u3001\u601D\u60F3",words:{\u8003\u3048:""}},{title:"\u5916\u6765\u8BED\uFF1A\u5177\u4F53\u521B\u610F",words:{\u30A2\u30A4\u30C7\u30A2:""}},{title:"\u4E00\u65F6\u8D77\u610F",words:{\u601D\u3044\u3064\u304D:""}}],"synonym-now:\u6837\u5B50":[{title:"\u5916\u8868\u88C5\u675F",words:{\u683C\u597D:""}},{title:"\u89C2\u5BDF\u5230\u7684\u60C5\u51B5",words:{\u69D8\u5B50:""}},{title:"\u88C5\u51FA\u6765\u7684\u59FF\u6001",words:{\u632F\u308A:""}}],"synonym-now:\u4E8B\u60C5":[{title:"\u6CDB\u6307\u4E8B\u60C5\u3001\u4E8B\u9879",words:{\u3053\u3068:"",\u4E8B\u67C4:""}},{title:"\u8981\u529E\u7684\u4E8B\u52A1",words:{\u7528\u4E8B:"",\u7528\u4EF6:""}},{title:"\u53D1\u751F\u7684\u4E8B\u4EF6",words:{\u51FA\u6765\u4E8B:""}}],"synonym-now:\u5F00\u59CB":[{title:"\u6C49\u8BED\uFF1A\u5F00\u59CB",words:{\u958B\u59CB:""}},{title:"\u5916\u6765\u8BED\uFF1A\u4E5F\u6307\u8D77\u70B9",words:{\u30B9\u30BF\u30FC\u30C8:""}},{title:"\u548C\u8BED\uFF1A\u5F00\u7AEF",words:{\u59CB\u307E\u308A:"",\u624B\u59CB\u3081:""}}],"synonym-now:\u4E60\u60EF":[{title:"\u6C49\u8BED\uFF1A\u4E60\u60EF\u3001\u98CE\u4FD7",words:{\u7FD2\u6163:"",\u6163\u7FD2:""}},{title:"\u4E2A\u4EBA\u6BDB\u75C5",words:{\u7656:""}},{title:"\u9002\u5E94\u3001\u719F\u6089",words:{\u6163\u308C:""}}],"synonym-now:\u8DEF\u7EBF":[{title:"\u9053 \u5B57\u5934\uFF1A\u8D70\u6CD5\u3001\u8109\u7EDC",words:{\u9053\u9806:"",\u9053\u7B4B:""}},{title:"\u7EBF\u8DEF\u3001\u65B9\u9488",words:{\u8DEF\u7DDA:""}}],"synonym-now:\u5F3A\u786C\u7684":[{title:"\u548C\u8BED\uFF1A\u987D\u5F3A\u96BE\u5BF9\u4ED8",words:{\u3057\u305F\u305F\u304B:""}},{title:"\u5F37 \u5B57\u5934\uFF1A\u6001\u5EA6\u5F3A\u786C",words:{\u5F37\u5F15:"",\u5F37\u786C:""}}],"synonym-now:\u5916\u89C2":[{title:"\u5355\u5B57\uFF1A\u4E5F\u6307\u89C2\u70B9",words:{\u89B3:""}},{title:"\u5916 \u5B57\u5934\uFF1A\u5916\u5F62",words:{\u5916\u898B:"",\u5916\u89B3:""}},{title:"\u770B\u8D77\u6765\u7684\u6837\u5B50",words:{\u898B\u304B\u3051:""}}],"synonym-now:\u6784\u60F3":[{title:"\u767A\uFF0F\u7740 \u5B57\u5934\uFF1A\u60F3\u6CD5",words:{\u767A\u60F3:"",\u7740\u60F3:""}},{title:"\u69CB \u5B57\u5934\uFF1A\u8BBE\u60F3",words:{\u69CB\u60F3:""}}],"synonym-now:\u90E8\u95E8":[{title:"\u653F\u5E9C\u7701\u5385",words:{\u7701:""}},{title:"\u7EC4\u7EC7\u5185\u90E8\u90E8\u95E8",words:{\u90E8\u9580:"",\u90E8\u7F72:""}}],"synonym-now:\u95F4\u9699":[{title:"\u4E8B\u60C5\u4E4B\u95F4\u7684\u7A7A\u5F53",words:{\u5408\u9593:""}},{title:"\u4E2D\u65AD\uFF0C\u4E5F\u6307\u5207\u53E3",words:{\u5207\u308C\u76EE:""}},{title:"\u591A\u63A5\u5426\u5B9A\uFF1A\u4E0D\u65AD",words:{\u7D76\u3048\u9593:""}}]}});var FO,Zn,eo,fa=h(()=>{"use strict";Tw();FO=(e,t,r)=>{let n=Math.max(0,...e.map(o=>r(o).length));for(let o=0;o<n;o+=1){let s=e.findIndex(i=>r(i)[o]===t);if(s>=0)return s}return-1},Zn=(e,t,r,n)=>{let o=ww[e];if(!o)return t.map(a=>({member:a,voice:n(a),subgroup:""}));let s=[...t];return[...o.flatMap(a=>Object.entries(a.words).flatMap(([d,u])=>{let l=FO(s,d,r);if(l<0)return[];let[c]=s.splice(l,1);return[{member:c,voice:u||null,subgroup:a.title}]})),...s.map(a=>({member:a,voice:n(a),subgroup:""}))]},eo=e=>e==="\u81EA\u52A8\u8BCD"?"\u81EA":e==="\u4ED6\u52A8\u8BCD"?"\u4ED6":null});var Sa={};x(Sa,{CONFUSION_FSRS:()=>hc,clearConfusionTasks:()=>Ic,confusionCardPool:()=>Ta,confusionCardProgress:()=>wa,confusionPriorCount:()=>Cc,createConfusionTasks:()=>_a,ensureConfusionCardTables:()=>jt,groupLevelRank:()=>yw,matchable:()=>cr,matchingCard:()=>kc,materializeConfusionCards:()=>ps,pickConfusionNext:()=>vc,recordConfusionReview:()=>Dc,replayConfusionReviews:()=>HO,undoLastConfusionReview:()=>Mc});var ga,ms,Sw,hc,WO,jO,$O,Lt,jt,cr,PO,yw,ps,kc,_a,vc,wa,Cc,Dc,Ic,Mc,HO,Ta,sn=h(()=>{"use strict";ga=N($(),1);Tt();G();ne();ic();at();rr();ms=N(Ea(),1),Sw=N(Or(),1);fa();hc={table:"confusion_progress",idColumn:"group_key",eligible:"known_forever = 0"},WO=e=>`'${e.replace(/'/gu,"''")}'`,jO=()=>`group_key IN (${Je().filter(cr).map(t=>t.key).map(WO).join(",")||"NULL"})`,$O="group_key NOT IN (SELECT group_key FROM confusion_mastered)",Lt=oa({entity:hc,reviewsTable:"confusion_reviews",tasksTable:"confusion_tasks",extraExclude:()=>`${jO()} AND ${$O}`}),jt=()=>{let e=(0,ga.getDatabase)();e.run(`
    CREATE TABLE IF NOT EXISTS confusion_progress (
      group_key TEXT PRIMARY KEY,
      seen_count INTEGER NOT NULL DEFAULT 0,
      right_count INTEGER NOT NULL DEFAULT 0,
      fuzzy_count INTEGER NOT NULL DEFAULT 0,
      forgot_count INTEGER NOT NULL DEFAULT 0,
      mistake_streak INTEGER NOT NULL DEFAULT 0,
      known_forever INTEGER NOT NULL DEFAULT 0,
      last_seen_on TEXT,
      level_rank INTEGER NOT NULL DEFAULT 4
    )
  `),p("PRAGMA table_info(confusion_progress)").some(t=>t.name==="level_rank")||e.run("ALTER TABLE confusion_progress ADD COLUMN level_rank INTEGER NOT NULL DEFAULT 4"),e.exec(`
    CREATE TABLE IF NOT EXISTS confusion_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_key TEXT NOT NULL,
      answer TEXT NOT NULL,
      reviewed_on TEXT NOT NULL,
      reviewed_at INTEGER NOT NULL,
      scheduler_mode TEXT NOT NULL DEFAULT 'normal',
      fsrs_params_version TEXT NOT NULL DEFAULT 'fsrs-v1',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_confusion_reviews_group_on ON confusion_reviews (group_key, reviewed_on);
    CREATE TABLE IF NOT EXISTS confusion_tasks (
      reviewed_on TEXT NOT NULL,
      group_key TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      PRIMARY KEY (reviewed_on, group_key)
    );
    CREATE TABLE IF NOT EXISTS confusion_mastered (group_key TEXT PRIMARY KEY, mastered_on TEXT NOT NULL);
  `),j(hc)},cr=e=>{let t=(0,ms.distinctionReviewFor)(e.key);return!t||t.level!=="major"||e.type==="synonym"||e.type==="near-synonym"||e.members.length<2||!t.summary.trim()?!1:new Set(e.members.map(n=>`${Se(n)}\0${n.kana}`)).size===e.members.length},PO={N5:0,N4:1,N3:2,N2:3,N1:4},yw=e=>Math.max(...e.members.map(t=>PO[t.jlptLevel]??4)),ps=()=>{jt();let e=(0,ga.getDatabase)(),t=new Map(p("SELECT group_key, level_rank FROM confusion_progress").map(n=>[String(n.group_key),Number(n.level_rank)])),r=0;return qt(()=>{e.run("BEGIN");try{let n=Je().filter(cr).map(i=>[i.key,yw(i)]),o=n.filter(([i])=>!t.has(i));e.run(`
        INSERT INTO confusion_progress (group_key, level_rank)
        SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]')
        FROM json_each(?) ORDER BY CAST(key AS INTEGER)
      `,[JSON.stringify(o)]),r=e.getRowsModified();let s=n.filter(([i,a])=>t.has(i)&&t.get(i)!==a);s.length&&e.run(`
        UPDATE confusion_progress SET level_rank = batch.value ->> '$[1]'
        FROM json_each(?) AS batch WHERE group_key = batch.value ->> '$[0]'
      `,[JSON.stringify(s)]),e.run("COMMIT")}catch(n){throw e.run("ROLLBACK"),n}}),r},kc=e=>{let t=Je().find(s=>s.key===e),r=t?(0,ms.distinctionReviewFor)(t.key):null;if(!t||!r||!cr(t))return null;let n=(0,ms.distinctionNotesFor)(r.summary,t.members.map(s=>({key:String(s.id),forms:[Se(s),s.kanji,s.kana]}))),o=Sw.default;return{groupKey:t.key,type:t.type,label:t.label,overview:r.summary.split(/[；;]/u)[0].trim(),members:Zn(t.key,t.members,s=>[Se(s),s.kanji,s.kana],s=>eo((o[s.kanji]??o[s.kana])?.[0])).map(({member:s,voice:i,subgroup:a})=>({id:s.id,surface:Se(s),kana:s.kana,note:n.get(String(s.id)),exampleJp:s.exampleJp,exampleMeaning:s.exampleMeaning,voice:i,subgroup:a})),summary:r.summary,notes:n}},_a=(e,t=4,r=T())=>{jt();let n=new Set(Je().filter(cr).map(s=>s.key));return p("SELECT group_key FROM confusion_tasks WHERE reviewed_on = ?",[r]).some(s=>!n.has(String(s.group_key)))&&(0,ga.getDatabase)().run("DELETE FROM confusion_tasks WHERE reviewed_on = ?",[r]),Lt.createTasks(e,()=>{let s=new Set(p("SELECT word_id FROM progress WHERE seen_count > 0").map(d=>Number(d.word_id))),i=Kr("confusion"),a=new Map(p(`SELECT group_key, level_rank FROM confusion_progress WHERE ${Lt.exclude} AND seen_count = 0 AND level_rank <= ?`,[t]).map(d=>[String(d.group_key),i[Number(d.level_rank)]??0]));return Je().filter(d=>cr(d)).filter(d=>a.has(d.key)).map(d=>({key:d.key,rank:a.get(d.key)??0,learned:d.members.filter(u=>s.has(u.id)).length,size:d.members.length})).sort((d,u)=>d.rank-u.rank||u.learned-d.learned||d.size-u.size||d.key.localeCompare(u.key)).map(d=>d.key)},r)},vc=(e=T(),t=new Set)=>{jt();let r=new Set(t),n=new Set(Je().filter(cr).map(o=>o.key));for(let o=0;o<1e3;o+=1){let s=Lt.pickNext(e,r);if(!s)return null;if(n.has(s))return s;r.add(s)}return null},wa=(e=T())=>(jt(),Lt.progress(e)),Cc=Lt.priorCount,Dc=(e,t,r=new Date,n)=>(jt(),Lt.record(e,t,r,n)),Ic=(e=T())=>{jt(),Lt.clearTasks(e)},Mc=()=>(jt(),Lt.undoLast()),HO=e=>(jt(),Lt.replay(e)),Ta=(e=4)=>(jt(),{due:Lt.dueCount(),unseen:E(`SELECT COUNT(*) FROM confusion_progress WHERE ${Lt.exclude} AND seen_count = 0 AND level_rank <= ?`,[e],0)})});var Kc={};x(Kc,{getConfusionCardSession:()=>ba,getKanjiCardSession:()=>Ra,loadMixedCardData:()=>xc,mixedCardCounts:()=>Hc,mixedCardDataLoaded:()=>to,refreshMixedCardTasks:()=>Pc,submitConfusionCardAnswer:()=>jc,submitKanjiCardAnswer:()=>Fc,targetLevelRank:()=>Na,undoConfusionCardAnswer:()=>$c,undoKanjiCardAnswer:()=>Wc});var KO,Na,GO,ya,xc,to,Nw,Uc,Ra,Fc,Wc,ba,jc,$c,Pc,Hc,Es=h(()=>{"use strict";pe();G();Qn();sn();KO={N5:0,N4:1,N3:2,N2:3,N1:4},Na=()=>KO[X().jlptTarget]??2,GO=1e5,ya=e=>e===rt?0:e>0?e:GO,xc=ls,to=ua,Nw=null,Uc=e=>{Nw!==e&&(cs(),ps(),Nw=e)},Ra=(e,t=T())=>{Uc(e);let r=ot();la({fresh:r.kanjiDailyGoal,review:ya(r.kanjiReviewCap)},Na(),t);let n=Rc(t),o=ca(t);return{card:n?yc(n):null,...o}},Fc=(e,t)=>Lc(e,t),Wc=()=>Ac(),ba=(e,t=T())=>{Uc(e);let r=ot();_a({fresh:r.confusionDailyGoal,review:ya(r.confusionReviewCap)},Na(),t);let n=vc(t),o=wa(t);return{card:n?kc(n):null,...o}},jc=(e,t)=>Dc(e,t),$c=()=>Mc(),Pc=e=>{to()&&(Oc(),Ic(),Ra(e),ba(e))},Hc=(e,t=T())=>{Uc(e);let r=ot(),n=Na();la({fresh:r.kanjiDailyGoal,review:ya(r.kanjiReviewCap)},n,t);let o=ca(t);_a({fresh:r.confusionDailyGoal,review:ya(r.confusionReviewCap)},n,t);let s=wa(t);return{kanjiDone:o.done,kanjiRemaining:o.remaining,confusionDone:s.done,confusionRemaining:s.remaining}}});var Gc,bw,fs,gs,BO,mr,an,Lw,XO,Rw,dn,YO,Ow,_s,ws=h(()=>{"use strict";Gc=N($(),1);G();ne();Xr();Pe();Te();jr();bw={id:"forward",phase:"stage1",entity:de,taskTable:"stage1_tasks",wordFilterSql:"",label:"\u6B63\u5411"},fs={id:"reverse",phase:"stage2",entity:Al,taskTable:"stage2_progress",wordFilterSql:"",label:"\u53CD\u5411"},gs={id:"kanji_reading",phase:"kanji",entity:Bi,taskTable:"kanji_reading_progress",wordFilterSql:"w.kanji <> w.kana",label:"\u6C49\u5B57"},BO=[bw,fs,gs],mr=e=>BO.find(t=>t.phase===e)??bw,an=(e,t)=>e.id!=="kanji_reading"||$o({kanji:String(t.kanji??""),kana:String(t.kana??"")}),Lw=(e,t)=>{if(e.id!=="kanji_reading"||!t.length)return t;let r=t.map(()=>"?").join(","),n=new Set(p(`
    SELECT id, kanji, kana FROM words WHERE id IN (${r})
  `,t).filter(o=>an(e,o)).map(o=>Number(o.id)));return t.filter(o=>n.has(o))},XO=[["seen_count","INTEGER NOT NULL DEFAULT 0"],["right_count","INTEGER NOT NULL DEFAULT 0"],["fuzzy_count","INTEGER NOT NULL DEFAULT 0"],["forgot_count","INTEGER NOT NULL DEFAULT 0"],["mistake_streak","INTEGER NOT NULL DEFAULT 0"],["last_seen_on","TEXT"]],Rw=new WeakMap,dn=e=>{let t=(0,Gc.getDatabase)();j(e.entity);let r=Rw.get(t);if(r||(r=new Set,Rw.set(t,r)),r.has(e.entity.table))return;let n=new Set(p(`PRAGMA table_info(${e.entity.table})`).map(o=>String(o.name??"")));for(let[o,s]of XO)n.has(o)||t.run(`ALTER TABLE ${e.entity.table} ADD COLUMN ${o} ${s}`);r.add(e.entity.table)},YO=.5,Ow=(e,t)=>{if(e.id==="forward"||t<=0)return[];dn(e);let r=e.entity.table,n=p(`
    SELECT p.word_id, p.fsrs_lapses, w.kanji, w.kana, ${ce("words","p.word_id")} AS pending_prior
    FROM progress p
    JOIN words w ON w.id = p.word_id
    WHERE p.seen_count > 0
      AND p.known_forever = 0
      AND COALESCE(p.fsrs_lapses, 0) < ?
      AND ${te("words","p.word_id")}
      ${e.id==="kanji_reading"?`AND NOT (${So("w.id")})`:""}
      ${e.wordFilterSql?`AND ${e.wordFilterSql}`:""}
      AND NOT EXISTS (SELECT 1 FROM ${r} m WHERE m.word_id = p.word_id)
    ORDER BY p.fsrs_due ASC, p.word_id ASC
  `,[me]).filter(d=>an(e,d));e.id==="kanji_reading"&&n.sort((d,u)=>hn({kanji:String(u.kanji??""),kana:String(u.kana??"")})-hn({kanji:String(d.kanji??""),kana:String(d.kana??"")}));let o=(0,Gc.getDatabase)(),s=new Date().toISOString(),i=[],a=n.filter(d=>!d.pending_prior).slice(0,t);for(let d of[...a,...n.filter(u=>u.pending_prior)]){let u=Number(d.word_id);o.run(`INSERT OR IGNORE INTO ${r} (word_id, seen_count) VALUES (?, 0)`,[u]);let l=Nt(u,de);l&&Rt(u,{...l,stability:Math.max(l.stability*YO,.1),due:s,lastReview:s,reps:0,lapses:0,steps:0},e.entity),i.push(u)}return i},_s=(e,t=T())=>E(`SELECT COUNT(*) FROM ${e.taskTable} WHERE reviewed_on = ?`,[t],0)});var La,zO,VO,JO,qO,QO,ZO,Oa,ro,eA,Aa,Bc,Xc=h(()=>{"use strict";La=N($(),1);St();pe();Hi();or();Jo();Ol();G();Mt();ne();Te();Pe();Xr();Ut();ws();zO=e=>Qr(e)??Ki,VO=(e,t)=>E(`SELECT COUNT(*)
   FROM ${e.taskTable} t
   JOIN ${e.entity.table} m ON m.word_id = t.word_id
   WHERE t.reviewed_on = ? AND COALESCE(m.seen_count, 0) = 0`,[t],0),JO=(e,t)=>{if(e.id!=="kanji_reading")return;p(`
    SELECT t.word_id, w.kanji, w.kana
    FROM ${e.taskTable} t
    JOIN words w ON w.id = t.word_id
    WHERE t.reviewed_on = ?
  `,[t]).filter(n=>!an(e,n)).forEach(n=>(0,La.getDatabase)().run(`DELETE FROM ${e.taskTable} WHERE reviewed_on = ? AND word_id = ?`,[t,Number(n.word_id)]))},qO=(e,t,r)=>{let n=e.id==="kanji_reading"?Math.max(t*2,32):t,o=new Set(De(e.entity,r).map(Number)),s=Lw(e,en(n,r,e.entity));return[...s.filter(i=>!o.has(i)).slice(0,Math.max(0,t)),...s.filter(i=>o.has(i))]},QO=(e,t=T(),r=!1)=>{dn(e);let n=(0,La.getDatabase)();if(JO(e,t),_s(e,t)>0){Dt(e.entity,e.taskTable,t);return}ZO(e,t);let o=sr(Pr(),t),s=E(`SELECT COUNT(*) FROM ${e.taskTable}
    WHERE reviewed_on = ? AND NOT ${Gr("words",`${e.taskTable}.word_id`,t)}`,[t],0),i=Math.max(o-s,0),a=_s(e,t)+1;qO(e,i,A()).forEach(u=>{n.run(`
      INSERT OR IGNORE INTO ${e.taskTable} (reviewed_on, word_id, order_index)
      VALUES (?, ?, ?)
    `,[t,u,a]),a+=1});let d=r?Math.max(xt()-VO(e,t),0):0;d>0&&Ow(e,d).forEach(u=>{n.run(`
        INSERT OR IGNORE INTO ${e.taskTable} (reviewed_on, word_id, order_index)
        VALUES (?, ?, ?)
      `,[t,u,a]),a+=1}),Dt(e.entity,e.taskTable,t)},ZO=(e,t)=>{p(`
    SELECT r.word_id, MIN(r.id) AS first_review_id, w.kanji, w.kana
    FROM reviews r
    JOIN words w ON w.id = r.word_id
    WHERE r.reviewed_on = ? AND r.direction = ? AND r.answer != 'known_forever'
    GROUP BY r.word_id
    ORDER BY first_review_id ASC
  `,[t,e.id]).filter(n=>an(e,n)).forEach((n,o)=>{(0,La.getDatabase)().run(`
      INSERT OR IGNORE INTO ${e.taskTable} (reviewed_on, word_id, order_index)
      VALUES (?, ?, ?)
    `,[t,Number(n.word_id),o+1])})},Oa=(e,t=!1)=>{QO(e,T(),t)},ro=e=>{let t=T();Oa(e);let r=_s(e,t),n=E(`
    SELECT COUNT(DISTINCT t.word_id)
    FROM ${e.taskTable} t
    JOIN ${e.entity.table} m ON m.word_id = t.word_id
    LEFT JOIN progress p ON p.word_id = t.word_id
    WHERE t.reviewed_on = ?
      AND (
        COALESCE(p.known_forever, 0) = 1
        OR (m.fsrs_due IS NOT NULL AND m.fsrs_due > ?)
      )
  `,[t,A().toISOString()],0);return{total:r,completed:Math.min(n,r)}},eA=e=>`
      w.*,
      m.word_id,
      m.seen_count,
      m.right_count,
      m.fuzzy_count,
      m.forgot_count,
      m.mistake_streak,
      m.last_seen_on,
      m.fsrs_stability,
      m.fsrs_difficulty,
      m.fsrs_due,
      m.fsrs_last_review,
      m.fsrs_state,
      m.fsrs_reps,
      m.fsrs_lapses,
      COALESCE(p.known_forever, 0) AS known_forever,
      COALESCE(n.note, '') AS note
    FROM ${e.entity.table} m
    JOIN words w ON w.id = m.word_id
    LEFT JOIN progress p ON p.word_id = m.word_id
    LEFT JOIN word_notes n ON n.word_id = w.id`,Aa=(e,t)=>{dn(e);let r=H(`SELECT ${eA(e)} WHERE m.word_id = ?`,[t]);return r&&an(e,r)?re(r):null},Bc=(e,t=new Set,r={})=>{let n=r.deterministic===!0,o=T();Oa(e);let s=new Map(fe(e.id).map(_=>[_.word_id,_.due_after])),i=p(`
    SELECT
      w.*,
      m.word_id,
      m.seen_count,
      m.right_count,
      m.fuzzy_count,
      m.forgot_count,
      m.mistake_streak,
      m.last_seen_on,
      m.fsrs_stability,
      m.fsrs_difficulty,
      m.fsrs_due,
      m.fsrs_last_review,
      m.fsrs_state,
      m.fsrs_reps,
      m.fsrs_lapses,
      COALESCE(p.known_forever, 0) AS known_forever,
      t.order_index,
      'review' AS task_type,
      COALESCE(n.note, '') AS note
    FROM ${e.taskTable} t
    JOIN words w ON w.id = t.word_id
    JOIN ${e.entity.table} m ON m.word_id = t.word_id
    LEFT JOIN progress p ON p.word_id = t.word_id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE t.reviewed_on = ?
      AND COALESCE(p.known_forever, 0) = 0
      -- \u300C\u672C\u5B66\u4E60\u65E5\u5185\u4ECD\u5230\u671F\u300D\u7684\u90FD\u8981\u51FA:\u6CA1\u7B54\u7684\u3001\u7B54\u9519\u8FD8\u5728\u91CD\u5B66\u6B65\u9AA4\u91CC\u7684
      AND (m.fsrs_due IS NULL OR m.fsrs_due <= ?)
  `,[o,A().toISOString()]),a=i.filter(_=>!t.has(Number(_.id))&&an(e,_));if(!a.length)return null;let d=xe(e.id),u=a.find(_=>Number(_.id)===d),l=It({mistakeStreak:Number(u?.mistake_streak??0),remaining:a.length,total:_s(e,o)});if(u&&Number(u.mistake_streak??0)>=ut&&(s.get(d)??0)<=0)return re(u);let m=(a.length>1&&!l?a.filter(_=>Number(_.id)!==d):a).map(_=>{let b=$i(_,s.get(Number(_.id)),0,{randomize:!n});return e.id==="kanji_reading"&&(b.orthography=hn({kanji:String(_.kanji??""),kana:String(_.kana??"")})),{score:Pi(b),dueAfter:s.get(Number(_.id))??0,row:_}});if(!m.length)return null;let g=m.filter(_=>_.dueAfter<=0);if(!g.length)return m.sort((_,b)=>_.dueAfter-b.dueAfter||b.score-_.score),re(m[0].row);let S=qi(o,Un,e.id),w=Gi(g.map(_=>({id:Number(_.row.id),score:_.score,recall:zO(_.row),isLeech:Number(_.row.fsrs_lapses??0)>=me})),{answeredToday:S.answeredToday,recentIds:S.wordIds,wrongStreak:S.wrongStreak,interference:Vo(o,i,e.id),...n?{random:()=>0}:{}});if(!w)return null;let y=g.find(_=>Number(_.row.id)===w.id)?.row;return re(y??g[0].row)}});var Aw,tA,hw,Yc,kw,ha,vw,zc=h(()=>{"use strict";St();or();G();Ut();$e();Aw="picked_word_ids",tA=300,hw=e=>{let t=Array.from(new Set(e.map(r=>Math.round(Number(r))).filter(r=>Number.isFinite(r)&&r>0))).slice(0,tA);return R(Aw,JSON.stringify(t)),D(),t},Yc=()=>{try{let e=JSON.parse(O(Aw,"[]"));if(!Array.isArray(e))return[];let t=e.map(n=>Number(n)).filter(n=>Number.isFinite(n)&&n>0);if(!t.length)return[];let r=new Set(p(`SELECT w.id FROM words w LEFT JOIN progress p ON p.word_id=w.id
      WHERE w.id IN (${t.map(()=>"?").join(",")}) AND ${oe()}`,t).map(n=>Number(n.id)));return t.filter(n=>r.has(n))}catch{return[]}},kw=()=>{let e=Yc();if(!e.length)return[];let t=e.map(()=>"?").join(",");return p(`
    SELECT
      w.*,
      p.seen_count,
      p.known_forever,
      p.last_seen_on,
      p.right_count,
      p.fuzzy_count,
      p.forgot_count,
      p.mistake_streak,
      p.fsrs_stability,
      p.fsrs_difficulty,
      p.fsrs_due,
      p.fsrs_state,
      p.fsrs_reps,
      p.fsrs_lapses,
      COALESCE(n.note, '') AS note
    FROM words w
    JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE w.id IN (${t})
      AND p.known_forever = 0
      AND (
        p.last_seen_on IS NULL
        OR p.last_seen_on <> ?
        OR p.fsrs_due IS NULL
        OR p.fsrs_due <= ?
      )
    ORDER BY
      CASE WHEN p.last_seen_on IS NULL OR p.last_seen_on <> ? THEN 0 ELSE 1 END ASC,
      CASE WHEN p.fsrs_due IS NULL THEN 0 ELSE 1 END ASC,
      p.fsrs_due ASC,
      w.importance DESC,
      w.id ASC
  `,[...e,T(),A().toISOString(),T()])},ha=()=>{let e=Yc().length;return{total:e,remaining:Math.min(kw().length,e)}},vw=()=>{let e=kw();if(!e.length)return null;let t=xe(),r=e.find(s=>Number(s.id)===t),n=It({mistakeStreak:Number(r?.mistake_streak??0),remaining:e.length,total:Yc().length}),o=e.length>1&&!n?e.filter(s=>Number(s.id)!==t):e;return re(o[0]??e[0])}});var Cw,qc,Vc,Dw,Jc,rA,ka,nA,va,Iw,Mw,xw,Uw,Fw,un,no,oA,Ww,jw,$w,Ts=h(()=>{"use strict";Cw=N(nr(),1);St();G();kr();qc="daily_relief_v2",Vc=6,Dw=12,Jc=100,rA=300,ka=(e=T())=>({studyDate:e,wordIds:[],completed:0}),nA=(e,t)=>{if(!e||typeof e!="object")return ka(t);let r=e,n=Array.isArray(r.wordIds)?r.wordIds.map(Number).filter(s=>Number.isFinite(s)):[],o=Array.from(new Set(n));return{studyDate:t,wordIds:o,completed:Math.min(Math.max(Number(r.completed??0),0),o.length)}},va=(e=T())=>{let t=O(qc,"");if(!t)return ka(e);try{let r=JSON.parse(t);return r.studyDate!==e?ka(e):nA(r,e)}catch{return ka(e)}},Iw=e=>(R(qc,JSON.stringify(e)),D(),(0,Cw.notifyProgressUpdated)(),e),Mw=e=>{let t=new Date(`${e}T12:00:00`);return t.setDate(t.getDate()-1),t.toISOString().slice(0,10)},xw=e=>{let t=Mw(e);return p(`
    SELECT r.word_id, COUNT(*) AS remembered_count, MAX(r.id) AS last_review_id
    FROM reviews r
    JOIN progress p ON p.word_id = r.word_id
    WHERE r.reviewed_on = ?
      AND r.direction = 'forward'
      AND r.answer IN ('know', 'known_forever')
      AND NOT EXISTS (
        SELECT 1 FROM stage1_tasks today_tasks
        WHERE today_tasks.reviewed_on = ? AND today_tasks.word_id = r.word_id
      )
    GROUP BY r.word_id
    ORDER BY remembered_count ASC, last_review_id ASC, r.word_id ASC
    LIMIT ?
  `,[t,e,Dw]).map(r=>({wordId:Number(r.word_id),rememberedCount:Number(r.remembered_count??0)}))},Uw=e=>E(`
    SELECT COUNT(DISTINCT word_id)
    FROM reviews
    WHERE reviewed_on = ?
      AND direction = 'forward'
  `,[Mw(e)],0),Fw=(e,t)=>{if(e.length<Vc||t<Jc)return 0;let r=Math.min(1,(t-Jc)/(rA-Jc)),n=Math.round(Vc+r*(Dw-Vc));return Math.min(e.length,n)},un=()=>{let e=T();Ft();let t=va(e),r=O(qc,""),n=!1;if(r)try{n=JSON.parse(r).studyDate===e}catch{n=!1}if(t.wordIds.length>0||n)return t;let o=xw(e),s=Fw(o,Uw(e)),i=o.slice(0,s).map(a=>a.wordId);return Iw({studyDate:e,wordIds:i,completed:0})},no=()=>{let e=va();return{total:e.wordIds.length,completed:e.completed,pending:Math.max(e.wordIds.length-e.completed,0)}},oA=e=>{let t=H(`
    SELECT
      w.*,
      p.seen_count,
      p.known_forever,
      p.last_seen_on,
      p.right_count,
      p.fuzzy_count,
      p.forgot_count,
      p.mistake_streak,
      p.fsrs_stability,
      p.fsrs_difficulty,
      p.fsrs_due,
      p.fsrs_state,
      p.fsrs_steps,
      p.fsrs_reps,
      p.fsrs_lapses,
      COALESCE(n.note, '') AS note
    FROM words w
    JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE w.id = ?
  `,[e]);return t?re(t):null},Ww=()=>{let e=un(),t=e.wordIds[e.completed];return t==null?null:oA(t)},jw=()=>{let e=va();return e.completed>=e.wordIds.length?e:Iw({...e,completed:e.completed+1})},$w=e=>e===T()?va().completed:Fw(xw(e),Uw(e))});var Pw,Zc,Qc,Hw,sA,Ca,Da,em,iA,aA,Ss,dA,uA,Kw,oo,Gw,Bw,Ia=h(()=>{"use strict";G();Pw=N(nr(),1);St();ne();kr();Ts();Zc="daily_tail_v2",Qc=3,Hw=7,sA=3,Ca=(e=T())=>({studyDate:e,wordIds:[],completed:0}),Da=(e=T())=>{let t=O(Zc,"");if(!t)return Ca(e);try{let r=JSON.parse(t);if(r.studyDate!==e)return Ca(e);let n=Array.isArray(r.wordIds)?r.wordIds.map(Number).filter(o=>Number.isFinite(o)):[];return{studyDate:e,wordIds:n,completed:Math.min(Math.max(Number(r.completed??0),0),n.length)}}catch{return Ca(e)}},em=e=>(R(Zc,JSON.stringify(e)),D(),(0,Pw.notifyProgressUpdated)(),e),iA=14,aA=()=>{let e=T(),t=A().toISOString(),r=new Set(un().wordIds);return p(`
    SELECT
      w.*,
      p.seen_count,
      p.known_forever,
      p.last_seen_on,
      p.right_count,
      p.fuzzy_count,
      p.forgot_count,
      p.mistake_streak,
      p.fsrs_stability,
      p.fsrs_difficulty,
      p.fsrs_due,
      p.fsrs_last_review,
      p.fsrs_state,
      p.fsrs_steps,
      p.fsrs_reps,
      p.fsrs_lapses,
      COALESCE(n.note, '') AS note
    FROM words w
    JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE p.known_forever = 0
      AND p.seen_count >= 3
      AND p.fsrs_due IS NOT NULL
      AND p.fsrs_due > ?
      AND p.fsrs_stability >= ?
      AND NOT EXISTS (
        SELECT 1 FROM stage1_tasks t
        WHERE t.reviewed_on = ? AND t.word_id = p.word_id
      )
      -- \u4ECA\u5929\u5DF2\u7ECF\u7B54\u8FC7\u7684\u4E0D\u7B97\u300C\u518D\u786E\u8BA4\u4E00\u6B21\u300D\uFF0C\u90A3\u662F\u4E00\u5C0F\u65F6\u524D\u521A\u505A\u8FC7\u7684\u9898
      AND NOT EXISTS (
        SELECT 1 FROM reviews r
        WHERE r.word_id = p.word_id AND r.reviewed_on = ? AND r.direction = 'forward'
      )
  `,[t,iA,e,e]).map(o=>({row:o,recall:Qr(o)??0})).filter(o=>!r.has(Number(o.row.id))).filter(o=>o.recall>=.82).sort(()=>Math.random()-.5).slice(0,Hw).map(o=>o.row)},Ss=()=>{let e=T(),t=Da(e),r=O(Zc,""),n=!1;if(r)try{n=JSON.parse(r).studyDate===e}catch{n=!1}if(t.wordIds.length>0||n)return t;if(ar().total<=0)return Ca(e);let s=aA().map(a=>Number(a.id)),i=s.length>=Qc?Qc+Math.floor(Math.random()*(Math.min(Hw,s.length)-Qc+1)):0;return em({studyDate:e,wordIds:s.slice(0,i),completed:0})},dA=e=>{let t=H(`
    SELECT w.*, p.seen_count, p.known_forever,
           p.last_seen_on, p.right_count, p.fuzzy_count,
           p.forgot_count, p.mistake_streak,
           p.fsrs_stability, p.fsrs_difficulty, p.fsrs_due, p.fsrs_last_review,
           p.fsrs_state, p.fsrs_steps, p.fsrs_reps, p.fsrs_lapses,
           COALESCE(n.note, '') AS note
    FROM words w
    JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE w.id = ?
  `,[e]);return t?re(t):null},uA=e=>{R("phase_date",T()),R("phase","stage1"),R("current_card",String(e))},Kw=()=>{let e=Ss(),t=ar();if(t.total<=0||t.completed<t.total)return null;let r=e.wordIds[e.completed];if(r==null)return null;let n=dA(r);return n&&uA(r),n},oo=()=>{let e=Da();return{total:e.wordIds.length,completed:e.completed,pending:Math.max(e.wordIds.length-e.completed,0)}},Gw=(e={})=>{let t=Da();if(t.completed>=t.wordIds.length)return t;let r=t.wordIds[t.completed],n=t.wordIds.filter(s=>s===r).length,o=e.requeue&&n<sA?[...t.wordIds,r]:t.wordIds;return em({...t,wordIds:o,completed:t.completed+1})},Bw=e=>{let t=Da();if(t.completed<=0)return t;let r=[...t.wordIds];return r[r.length-1]===e&&r.filter(n=>n===e).length>1&&r.pop(),em({...t,wordIds:r,completed:t.completed-1})}});var Ua={};x(Ua,{KANJI_UNIT_FSRS:()=>Ma,KANJI_UNIT_QUOTA_DEFAULT:()=>tm,KANJI_UNIT_QUOTA_MAX:()=>sm,KANJI_UNIT_QUOTA_MIN:()=>om,KANJI_UNIT_SCHEDULER_FLAG:()=>nm,REVIEWS_PER_NEW_UNIT:()=>Yw,buildUnitsByWord:()=>Vw,coverageScore:()=>rm,createKanjiUnitTasks:()=>ys,ensureKanjiUnitTables:()=>Pt,getKanjiUnitDailyQuota:()=>im,getKanjiUnitTargetLevelRank:()=>mA,isKanjiUnitSchedulerEnabled:()=>pr,kanjiUnitCardByKey:()=>xa,kanjiUnitEta:()=>pA,kanjiUnitProgress:()=>dm,kanjiUnitStepMode:()=>qw,loadKanjiUnitIndex:()=>nn,materializeKanjiUnitIndex:()=>zw,pickKanjiUnitNext:()=>am,recordKanjiUnitReview:()=>um,replayKanjiUnitReviews:()=>wA,setKanjiUnitDailyQuota:()=>cA,setKanjiUnitKnownForever:()=>lm,setKanjiUnitSchedulerEnabled:()=>EA});var $t,nm,Xw,om,sm,tm,lA,im,cA,mA,Yw,pA,pr,EA,Ma,xa,fA,Pt,zw,rm,gA,Vw,ys,_A,am,dm,Jw,qw,um,wA,lm,Ns=h(()=>{"use strict";$t=N($(),1);G();ne();on();Pe();Xn();_t();Tt();pe();nm="feature.kanji_unit_scheduler_v1",Xw="kanji_unit_daily_quota",om=5,sm=200,tm=30,lA=e=>{try{return E("SELECT value FROM app_state WHERE key = ?",[e],"")||null}catch{return null}},im=()=>{let e=lA(Xw);if(e===null)return tm;let t=Number(e);return!Number.isFinite(t)||t<=0?tm:Math.min(Math.max(Math.floor(t),om),sm)},cA=e=>{let t=Math.min(Math.max(Math.floor(e),om),sm);(0,$t.getDatabase)().run(`
    INSERT INTO app_state (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `,[Xw,String(t)])},mA=()=>Math.max(F.indexOf(X().jlptTarget),0),Yw=9,pA=(e=im())=>{let t=ac(),r=new Set(p("SELECT unit_key FROM kanji_unit_memory WHERE COALESCE(seen_count, 0) > 0").map(o=>String(o.unit_key))),n=Math.max(e/Yw,.1);return t.map((o,s)=>{let i=dc(s),a=i.filter(d=>!r.has(d.unitKey)).length;return{levelRank:s,level:o,unitsNeeded:i.length,unitsRemaining:a,days:Math.ceil(a/n)}})},pr=()=>{try{return globalThis.localStorage?.getItem(nm)!=="0"}catch{return!0}},EA=e=>{try{globalThis.localStorage?.setItem(nm,e?"1":"0")}catch{}},Ma={table:"kanji_unit_memory",idColumn:"unit_key",eligible:"1 = 1"},xa=(e,t=0)=>{let r=is(e),n=as(e)[t];if(!r||!n)return null;let o=p("SELECT * FROM words WHERE id = ?",[n.wordId])[0];if(!o)return null;let s=String(o.kanji??"");return{unit:r,exampleWordId:n.wordId,exampleWord:o,targetSegment:{start:n.start,length:n.length,text:s.slice(n.start,n.start+n.length)},actualReading:n.reading,variant:n.variant}},fA=(e,t)=>{let r=new Set(p(`PRAGMA table_info(${e})`).map(o=>String(o.name??""))),n=(0,$t.getDatabase)();for(let[o,s]of Object.entries(t))r.has(o)||n.run(`ALTER TABLE ${e} ADD COLUMN ${o} ${s}`)},Pt=()=>{let e=(0,$t.getDatabase)();e.run(`
    CREATE TABLE IF NOT EXISTS kanji_units (
      unit_id INTEGER PRIMARY KEY AUTOINCREMENT,
      unit_key TEXT NOT NULL UNIQUE,
      unit_type TEXT NOT NULL,
      char TEXT NOT NULL DEFAULT '',
      base TEXT NOT NULL DEFAULT '',
      surface TEXT NOT NULL DEFAULT '',
      reading TEXT NOT NULL DEFAULT '',
      kinds TEXT NOT NULL DEFAULT '[]',
      CHECK (
        (unit_type = 'char' AND char <> '' AND base <> '' AND surface = '' AND reading = '')
        OR (unit_type = 'jukujikun' AND char = '' AND base = '' AND surface <> '' AND reading <> '')
      )
    )
  `),e.run(`
    CREATE TABLE IF NOT EXISTS kanji_unit_memory (
      unit_key TEXT PRIMARY KEY,
      seen_count INTEGER NOT NULL DEFAULT 0,
      right_count INTEGER NOT NULL DEFAULT 0,
      fuzzy_count INTEGER NOT NULL DEFAULT 0,
      forgot_count INTEGER NOT NULL DEFAULT 0,
      mistake_streak INTEGER NOT NULL DEFAULT 0,
      last_seen_on TEXT,
      FOREIGN KEY(unit_key) REFERENCES kanji_units(unit_key)
    )
  `),e.run(`
    CREATE TABLE IF NOT EXISTS kanji_unit_flags (
      unit_key TEXT PRIMARY KEY,
      known_forever INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(unit_key) REFERENCES kanji_units(unit_key)
    )
  `),e.run(`
    CREATE TABLE IF NOT EXISTS kanji_unit_tasks (
      reviewed_on TEXT NOT NULL,
      unit_key TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      PRIMARY KEY (reviewed_on, unit_key),
      FOREIGN KEY(unit_key) REFERENCES kanji_units(unit_key)
    )
  `),e.run(`
    CREATE TABLE IF NOT EXISTS kanji_unit_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      unit_key TEXT NOT NULL,
      answer TEXT NOT NULL,
      reviewed_on TEXT NOT NULL,
      reviewed_at INTEGER NOT NULL,
      scheduler_mode TEXT NOT NULL DEFAULT 'normal',
      fsrs_params_version TEXT NOT NULL DEFAULT '${vr}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(unit_key) REFERENCES kanji_units(unit_key)
    )
  `),fA("kanji_unit_memory",{fsrs_stability:"REAL",fsrs_difficulty:"REAL",fsrs_due:"TEXT",fsrs_last_review:"TEXT",fsrs_state:"INTEGER",fsrs_steps:"INTEGER",fsrs_reps:"INTEGER",fsrs_lapses:"INTEGER"}),j(Ma)},zw=()=>{Pt();let e=mt();if(!e.length)return 0;let t=(0,$t.getDatabase)();if(E("SELECT COUNT(*) FROM kanji_units",[],0)>=e.length)return 0;let n=!1;try{t.run("BEGIN"),n=!0}catch{n=!1}let o=0;try{let s=JSON.stringify(e.map(i=>[i.unitKey,i.unitType,i.char,i.base,i.surface,i.reading,JSON.stringify(i.kinds)]));t.run(`
      INSERT OR IGNORE INTO kanji_units
        (unit_key, unit_type, char, base, surface, reading, kinds)
      SELECT value ->> '$[0]', value ->> '$[1]', value ->> '$[2]', value ->> '$[3]',
             value ->> '$[4]', value ->> '$[5]', value ->> '$[6]'
      FROM json_each(?) ORDER BY CAST(key AS INTEGER)
    `,[s]),o=t.getRowsModified(),t.run(`
      INSERT OR IGNORE INTO kanji_unit_memory (unit_key)
      SELECT value ->> '$[0]' FROM json_each(?) ORDER BY CAST(key AS INTEGER)
    `,[s]),n&&t.run("COMMIT")}catch(s){throw n&&t.run("ROLLBACK"),s}return o},rm=(e,t)=>{if(!is(e))return 0;let n=Vn(e),o=n.length,s=0,i=0;for(let d of n){i+=t.wordMeta.get(d)?.importance??0;let u=t.unitsByWord.get(d);u&&u.every(l=>l===e||t.knownUnits.has(l))&&(s+=1)}let a=n.length?i/n.length:0;return o+s*3+a*.5},gA=(e,t,r)=>e<r?50:t[e]??100+e,Vw=()=>{let e=new Map;for(let t of mt())for(let r of Vn(t.unitKey)){let n=e.get(r);n?n.push(t.unitKey):e.set(r,[t.unitKey])}return e},ys=(e=T(),t=im())=>{if(t<=0)return{units:[],reviewCount:0,newCount:0,crowdedOut:!1};zw();let r=(0,$t.getDatabase)(),n=p("SELECT unit_key FROM kanji_unit_tasks WHERE reviewed_on = ? ORDER BY order_index",[e]).map(y=>String(y.unit_key));if(n.length){let y=new Set(p(`
      SELECT t.unit_key FROM kanji_unit_tasks t
      JOIN kanji_unit_memory m ON m.unit_key = t.unit_key
      WHERE t.reviewed_on = ? AND COALESCE(m.seen_count, 0) > 0
    `,[e]).map(_=>String(_.unit_key)));return{units:n,reviewCount:n.filter(_=>y.has(_)).length,newCount:n.filter(_=>!y.has(_)).length,crowdedOut:!1}}let o=new Map;p(`
    SELECT w.id, COALESCE(w.importance, 0) AS importance, COALESCE(p.seen_count, 0) AS seen
    FROM words w LEFT JOIN progress p ON p.word_id = w.id
  `).forEach(y=>o.set(Number(y.id),{seen:Number(y.seen??0),importance:Number(y.importance??0)}));let s=Vw(),i=new Set(p("SELECT unit_key FROM kanji_unit_memory WHERE COALESCE(seen_count, 0) > 0").map(y=>String(y.unit_key))),a={wordMeta:o,knownUnits:i,unitsByWord:s},d=(y,_)=>rm(_,a)-rm(y,a)||y.localeCompare(_,"ja"),l=p(`
    SELECT m.unit_key
    FROM kanji_unit_memory m
    LEFT JOIN kanji_unit_flags f ON f.unit_key = m.unit_key
    WHERE COALESCE(f.known_forever, 0) = 0
      AND COALESCE(m.seen_count, 0) > 0
      AND (m.fsrs_due IS NULL OR m.fsrs_due <= ?)
  `,[A().toISOString()]).map(y=>String(y.unit_key)).sort(d).slice(0,t),c=Kr("kanji"),f=Bf("kanji"),m=y=>gA(is(y)?.levelRank??5,c,f),g=Math.max(t-l.length,0),S=g>0?p(`
        SELECT m.unit_key
        FROM kanji_unit_memory m
        LEFT JOIN kanji_unit_flags f ON f.unit_key = m.unit_key
        WHERE COALESCE(f.known_forever, 0) = 0
          AND COALESCE(m.seen_count, 0) = 0
      `).map(y=>String(y.unit_key)).sort((y,_)=>m(y)-m(_)||d(y,_)).slice(0,g):[],w=[...l,...S];return w.forEach((y,_)=>r.run(`
    INSERT OR IGNORE INTO kanji_unit_tasks (reviewed_on, unit_key, order_index)
    VALUES (?, ?, ?)
  `,[e,y,_+1])),{units:w,reviewCount:l.length,newCount:S.length,crowdedOut:S.length===0&&l.length>=t&&_A()}},_A=()=>E(`
  SELECT COUNT(*) FROM kanji_unit_memory m
  LEFT JOIN kanji_unit_flags f ON f.unit_key = m.unit_key
  WHERE COALESCE(f.known_forever, 0) = 0 AND COALESCE(m.seen_count, 0) = 0
`,[],0)>0,am=(e=T(),t=new Set)=>(Pt(),p(`
    SELECT t.unit_key
    FROM kanji_unit_tasks t
    JOIN kanji_unit_memory m ON m.unit_key = t.unit_key
    LEFT JOIN kanji_unit_flags f ON f.unit_key = t.unit_key
    WHERE t.reviewed_on = ?
      AND COALESCE(f.known_forever, 0) = 0
      AND (m.fsrs_due IS NULL OR m.fsrs_due <= ?)
    ORDER BY t.order_index ASC
  `,[e,new Date().toISOString()]).map(n=>String(n.unit_key)).find(n=>!t.has(n))??null),dm=(e=T())=>{Pt();let t=A();ys(e);let r=E("SELECT COUNT(*) FROM kanji_unit_tasks WHERE reviewed_on = ?",[e],0),n=E(`
    SELECT COUNT(*)
    FROM kanji_unit_tasks t
    JOIN kanji_unit_memory m ON m.unit_key = t.unit_key
    LEFT JOIN kanji_unit_flags f ON f.unit_key = t.unit_key
    WHERE t.reviewed_on = ?
      AND (COALESCE(f.known_forever, 0) = 1 OR m.fsrs_due > ?)
  `,[e,t.toISOString()],0);return{total:r,completed:Math.min(r,n)}},Jw=(e,t,r)=>{let n=t==="know"?[1,1,0,0]:t==="fuzzy"?[1,0,1,0]:[1,0,0,1],o=E("SELECT mistake_streak FROM kanji_unit_memory WHERE unit_key = ?",[e],0),s=t==="forgot"?o+1:0;(0,$t.getDatabase)().run(`
    UPDATE kanji_unit_memory
    SET seen_count = seen_count + ?, right_count = right_count + ?,
        fuzzy_count = fuzzy_count + ?, forgot_count = forgot_count + ?,
        mistake_streak = ?, last_seen_on = ?
    WHERE unit_key = ?
  `,[...n,s,r,e])},qw=(e,t,r=T())=>E("SELECT COUNT(*) FROM kanji_unit_reviews WHERE unit_key = ? AND reviewed_on = ?",[e,r],0)===0&&t==="know"?"known":E(`SELECT COUNT(*) FROM kanji_unit_reviews
     WHERE unit_key = ? AND reviewed_on = ? AND answer IN ('forgot','fuzzy')`,[e,r],0)+(t==="forgot"||t==="fuzzy"?1:0)>=Me?"stubborn":"normal",um=(e,t,r=new Date,n)=>{if(Pt(),!E("SELECT COUNT(*) FROM kanji_units WHERE unit_key = ?",[e],0))throw new Error(`Unknown kanji unit: ${e}`);n??(n=qw(e,t));let s=Re(e,t,r,{mode:n},Ma),i=T();return Jw(e,t,i),(0,$t.getDatabase)().run(`
    INSERT INTO kanji_unit_reviews
      (unit_key, answer, reviewed_on, reviewed_at, scheduler_mode, fsrs_params_version)
    VALUES (?, ?, ?, ?, ?, ?)
  `,[e,t,i,r.getTime(),n,vr]),s},wA=e=>{Pt();let t=e?[...new Set([...e])]:p("SELECT DISTINCT unit_key FROM kanji_unit_reviews").map(n=>String(n.unit_key)),r=0;for(let n of t){let o=p(`
      SELECT answer, reviewed_on, reviewed_at, scheduler_mode
      FROM kanji_unit_reviews
      WHERE unit_key = ?
      ORDER BY reviewed_at ASC, id ASC
    `,[n]);if(o.length){(0,$t.getDatabase)().run(`
      UPDATE kanji_unit_memory
      SET seen_count = 0, right_count = 0, fuzzy_count = 0, forgot_count = 0,
          mistake_streak = 0, last_seen_on = NULL,
          fsrs_stability = NULL, fsrs_difficulty = NULL, fsrs_due = NULL,
          fsrs_last_review = NULL, fsrs_state = NULL, fsrs_steps = NULL,
          fsrs_reps = NULL, fsrs_lapses = NULL
      WHERE unit_key = ?
    `,[n]);for(let s of o){let i=String(s.answer);if(i!=="forgot"&&i!=="fuzzy"&&i!=="know")continue;let a=Number(s.reviewed_at),d=Number.isFinite(a)?new Date(a):new Date(`${String(s.reviewed_on)}T12:00:00`);Re(n,i,d,{mode:String(s.scheduler_mode??"normal")},Ma),Jw(n,i,String(s.reviewed_on??T()))}r+=1}}return r},lm=(e,t)=>{Pt(),(0,$t.getDatabase)().run(`
    INSERT INTO kanji_unit_flags (unit_key, known_forever, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(unit_key) DO UPDATE SET known_forever = excluded.known_forever, updated_at = excluded.updated_at
  `,[e,t?1:0])}});function ke(e="stage1",t={},r={}){Y();let n=T(),o=Ji(t,"w");un();let s=no(),i=ar();Ss();let a=oo(),d={completed:s.completed+i.completed+a.completed,total:s.total+i.total+a.total},u=i.total>0&&i.completed>=i.total,l=u&&s.pending===0&&a.pending===0,c=Math.max(d.total-d.completed,0),f=he(()=>E(`
    SELECT COUNT(*)
    FROM words w
    JOIN progress p ON p.word_id = w.id
    WHERE ${oe()} ${o.clause}
  `,o.params,0)),m=he(()=>E(`
    SELECT COUNT(*)
    FROM progress p
    JOIN words w ON w.id = p.word_id
    WHERE p.known_forever = 1 ${o.clause}
  `,o.params,0)),g=he(()=>E("SELECT COUNT(DISTINCT word_id) FROM reviews WHERE reviewed_on = ? AND direction = 'forward'",[n],0)),S=he(()=>E(`
    SELECT COUNT(*)
    FROM progress p
    JOIN words w ON w.id = p.word_id
    WHERE p.known_forever = 0 AND ${ee()}
      AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?) ${o.clause}
      AND ${te("words","p.word_id")}
  `,[A().toISOString(),...o.params],0)),w=he(()=>E(`
    SELECT COUNT(*)
    FROM progress p
    JOIN words w ON w.id = p.word_id
    WHERE ${Ne()} ${o.clause}
    `,o.params,0)),y=he(()=>({poolSize:E(`
      SELECT COUNT(*)
      FROM progress p
      WHERE p.known_forever = 0 AND ${$n("p")}
    `,[],0),answeredToday:E(`
      SELECT COUNT(DISTINCT r.word_id)
      FROM reviews r
      JOIN progress p ON p.word_id = r.word_id
      WHERE r.reviewed_on = ? AND r.direction = 'forward' AND ${$n("p")}
    `,[n],0)})),_=he(()=>ro(fs)),b=he(()=>r.kanjiUnits??(pr()&&He())?dm():ro(gs)),k=he(()=>tc(bt)),v=he(()=>rc(bt)),L=he(()=>to()?Hc((0,Qw.getDatabase)()):(xc().then(Zw.notifyProgressUpdated,()=>{}),{kanjiDone:0,kanjiRemaining:0,confusionDone:0,confusionRemaining:0})),I=he(()=>({classic:c,mixed:c+k()+L().kanjiRemaining+L().confusionRemaining,mistakes:y().poolSize,quick:c,reverse:Math.max(_().total-_().completed,0),kanji:Math.max(b().total-b().completed,0),picked:ha().remaining})),M=he(()=>p("SELECT checked_on FROM checkins ORDER BY checked_on").map(J=>String(J.checked_on??""))),U=he(()=>E("SELECT seconds FROM word_study_time WHERE studied_on = ?",[n],0)),W=he(()=>{let J=Qi(n),{secondsPerWord:C}=zi(n),z=g()>0&&U()>0?Math.min(Math.max(U()/g(),6),60):C,ze=qo(J),_n=Math.max(Math.round(Jt()/2),5),zt=ze>0?ze:Math.min(_n,w()),gt=jn(n);return{available:zt>0&&!ho(),size:zt,estimatedMinutes:Ul(zt,z),remaining:J,unseenRemaining:w(),secondsPerWord:z,totalLearned:E(`SELECT COUNT(*) FROM progress p
         WHERE p.known_forever = 1
           OR EXISTS (SELECT 1 FROM reviews r WHERE r.word_id=p.word_id AND r.direction='forward')
           OR (p.seen_count > 0 AND NOT EXISTS (
             SELECT 1 FROM level_prior_baselines b WHERE b.entity='words' AND b.entity_key=CAST(p.word_id AS TEXT)
           ))`,[],0),weekEncoreCount:gt.weekCount,todayEncoreWords:gt.dayWords,fatigued:Zo(n)}}),K=he(()=>E(`
    SELECT COUNT(DISTINCT today_reviews.word_id)
    FROM reviews today_reviews
    WHERE today_reviews.reviewed_on = ?
      AND today_reviews.direction = 'forward'
      AND NOT EXISTS (
        SELECT 1
        FROM reviews earlier_reviews
        WHERE earlier_reviews.word_id = today_reviews.word_id
          AND earlier_reviews.direction = 'forward'
          AND earlier_reviews.reviewed_on < ?
      )
      AND NOT ${we("words","today_reviews.word_id")}
    `,[n,n],0));return{get encore(){return W()},dailyRelief:s,get total(){return f()},get knownForever(){return m()},get masteredToday(){return E(`SELECT COUNT(DISTINCT r.word_id)
         FROM reviews r
         JOIN progress p ON p.word_id = r.word_id
         WHERE r.reviewed_on = ?
           AND r.direction = 'forward'
           AND (p.known_forever = 1 OR ${Ee})`,[n],0)},get reviewedToday(){return g()},get lowCount(){return S()},get unseenCount(){return w()},get newToday(){return K()},get oldToday(){return Math.max(0,g()-K())},get newQuota(){return xt()},get mistakes(){return y()},get modeCounts(){return I()},get grammarRemaining(){return k()},get grammarDone(){return v()},get kanjiCardRemaining(){return L().kanjiRemaining},get kanjiCardDone(){return L().kanjiDone},get confusionCardRemaining(){return L().confusionRemaining},get confusionCardDone(){return L().confusionDone},stage1ProgressDone:d.completed,stage1ProgressTotal:d.total,stage1NewDone:i.newLane.done,stage1NewTotal:i.newLane.total,stage1ReviewDone:i.reviewLane.done+s.completed+a.completed,stage1ReviewTotal:i.reviewLane.total+s.total+a.total,phase:e,stage1Done:u,dailyPlanDone:l,get stage2Total(){return _().total},get stage2Completed(){return _().completed},get kanjiTotal(){return b().total},get kanjiCompleted(){return b().completed},studyDate:n,get checkins(){return M()},get dailyStudyStats(){return TA(n)},get wordStudySecondsToday(){return U()},get taskDone(){return b().total>0?b().completed>=b().total:_().total>0?_().completed>=_().total:l}}}var Qw,Zw,TA,he,cm=h(()=>{"use strict";$e();pe();ss();Tt();Te();Qw=N($(),1),Zw=N(nr(),1);Es();G();Mt();rn();Ut();kr();Xc();ws();zc();ts();Ts();Ia();ne();Ns();on();TA=(e=T())=>{let t=new Map,r=n=>{let o=t.get(n);return o||(o={date:n,seconds:0,wordCount:0,grammarCount:0,reliefCount:0,total:0},t.set(n,o)),o};p(`
    SELECT studied_on, seconds
    FROM word_study_time
    WHERE studied_on BETWEEN date(?, '-30 day') AND ?
  `,[e,e]).forEach(n=>{let o=String(n.studied_on??"");o&&(r(o).seconds=Number(n.seconds??0))}),p(`
    SELECT reviewed_on, COUNT(DISTINCT word_id) AS word_count
    FROM reviews
    WHERE direction = 'forward'
      AND reviewed_on BETWEEN date(?, '-30 day') AND ?
    GROUP BY reviewed_on
  `,[e,e]).forEach(n=>{let o=String(n.reviewed_on??"");o&&(r(o).wordCount=Number(n.word_count??0))}),p(`
    SELECT reviewed_on, COUNT(DISTINCT grammar_id) AS grammar_count
    FROM grammar_reviews
    WHERE reviewed_on BETWEEN date(?, '-30 day') AND ?
    GROUP BY reviewed_on
  `,[e,e]).forEach(n=>{let o=String(n.reviewed_on??"");o&&(r(o).grammarCount=Number(n.grammar_count??0))}),p("SELECT checked_on FROM checkins ORDER BY checked_on").forEach(n=>{let o=String(n.checked_on??"");o&&r(o)});for(let n of t.values())(n.date===e||n.wordCount>0)&&(n.reliefCount=$w(n.date)),n.total=n.wordCount+n.grammarCount+n.reliefCount;return Array.from(t.values()).sort((n,o)=>n.date.localeCompare(o.date))},he=e=>{let t=null;return()=>(t??(t={value:e()})).value}});var SA,eT,tT=h(()=>{"use strict";St();or();G();ts();Ut();SA=e=>{let t=Number(e.fsrs_lapses??0),r=Number(e.fsrs_difficulty??0),n=Math.max(Number(e.fsrs_stability??0),0),o=Number(e.forgot_count??0),s=Number(e.fuzzy_count??0),i=Number(e.right_count??0),a=o*2+s,d=a/Math.max(i+a,1);return t*100+r*8+d*50-Math.min(n,365)*.03},eT=()=>{let e=T(),t=A().toISOString(),r=p(`
    SELECT
      w.*,
      p.seen_count,
      p.known_forever,
      p.last_seen_on,
      p.right_count,
      p.fuzzy_count,
      p.forgot_count,
      p.mistake_streak,
      p.fsrs_stability,
      p.fsrs_difficulty,
      p.fsrs_due,
      p.fsrs_state,
      p.fsrs_reps,
      p.fsrs_lapses,
      COALESCE(n.note, '') AS note
    FROM words w
    JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE p.known_forever = 0
      AND ${$n("p")}
      AND (
        p.last_seen_on IS NULL
        OR p.last_seen_on <> ?
        OR p.fsrs_due IS NULL
        OR p.fsrs_due <= ?
      )
  `,[e,t]);if(!r.length)return null;let n=new Map(fe().map(c=>[c.word_id,c.due_after])),o=xe(),s=r.find(c=>Number(c.id)===o),i=It({mistakeStreak:Number(s?.mistake_streak??0),remaining:r.length,total:r.length}),d=(r.length>1&&!i?r.filter(c=>Number(c.id)!==o):r).map(c=>({row:c,dueAfter:n.get(Number(c.id))??0,risk:SA(c)})),u=d.filter(c=>c.dueAfter<=0),l=u.length?u:d;return l.sort((c,f)=>u.length?f.risk-c.risk:c.dueAfter-f.dueAfter||f.risk-c.risk),l[0]?re(l[0].row):null}});var mm,rT,nT,oT=h(()=>{"use strict";mm=N($(),1);G();ne();Pe();or();Ut();ws();ta();Xn();Te();rT=(e,t,r)=>{dn(e);let n=(0,mm.getDatabase)(),o=e.entity.table,s=T(),i=H(`SELECT * FROM ${o} WHERE word_id = ?`,[t]);i||n.run(`INSERT OR IGNORE INTO ${o} (word_id, seen_count) VALUES (?, 0)`,[t]);let a={phase:e.phase,mode:e.phase,direction:e.id,reviewed_on:s,word_id:t,memory_exists:!!i,known_forever:Number(E("SELECT known_forever FROM progress WHERE word_id = ?",[t],0)??0),last_answered_word:xe(e.id),seen_count:Number(i?.seen_count??0),right_count:Number(i?.right_count??0),fuzzy_count:Number(i?.fuzzy_count??0),forgot_count:Number(i?.forgot_count??0),mistake_streak:Number(i?.mistake_streak??0),last_seen_on:i?.last_seen_on??null,fsrs:Nt(t,e.entity),review_queue:fe(e.id)};Hn(t,e.id);let d=Number(i?.right_count??0),u=Number(i?.fuzzy_count??0),l=Number(i?.forgot_count??0),c=Number(i?.mistake_streak??0),f=r==="known_forever";f?(n.run("UPDATE progress SET known_forever = 1 WHERE word_id = ?",[t]),c=0):(d+=r==="know"?1:0,u+=r==="fuzzy"?1:0,l+=r==="forgot"?1:0,c=r==="know"?0:c+1);let g=E(`SELECT COUNT(*) FROM reviews
     WHERE word_id = ? AND reviewed_on = ? AND direction = ? AND answer IN ('forgot','fuzzy')`,[t,s,e.id],0)+(r==="forgot"||r==="fuzzy"?1:0)>=Me,w=E("SELECT COUNT(*) FROM reviews WHERE word_id = ? AND reviewed_on = ? AND direction = ?",[t,s,e.id],0)===0&&r==="know"?"known":g?"stubborn":"normal",y=!1,_=!1,b=0;if(!f)try{let v=Re(t,r,new Date,{mode:w},e.entity);y=yt(v,A()),b=Math.max((new Date(v.due).getTime()-Date.now())/6e4,0),_=!y&&yt(qe(v,"know",new Date,{mode:g?"stubborn":"normal"}),A())}catch(v){console.warn(`[fsrs] ${e.label}\u8BB0\u5F55\u8DF3\u8FC7:`,v),y=r==="know"}!y&&!f&&Kn(t,b,c>=ut,_,e.id),ir(t,e.id),n.run(`
    UPDATE ${o}
    SET seen_count = COALESCE(seen_count, 0) + 1,
        last_seen_on = ?,
        right_count = ?,
        fuzzy_count = ?,
        forgot_count = ?,
        mistake_streak = ?
    WHERE word_id = ?
  `,[s,d,u,l,c,t]);let k=Bn({wordId:t,answer:r,reviewedOn:s,direction:e.id,schedulerMode:w});ea({...a,review_id:k})},nT=(e,t)=>{dn(e);let r=(0,mm.getDatabase)(),n=Number(t.word_id);r.run(`
    UPDATE ${e.entity.table}
    SET seen_count = ?, right_count = ?, fuzzy_count = ?, forgot_count = ?,
        mistake_streak = ?, last_seen_on = ?
    WHERE word_id = ?
  `,[Number(t.seen_count??0),Number(t.right_count??0),Number(t.fuzzy_count??0),Number(t.forgot_count??0),Number(t.mistake_streak??0),t.last_seen_on??null,n]),Zr(n,t.fsrs??null,e.entity),r.run("UPDATE progress SET known_forever = ? WHERE word_id = ?",[Number(t.known_forever??0),n]),Array.isArray(t.review_queue)&&Qe(t.review_queue.flatMap(o=>{if(!o||typeof o!="object")return[];let s=o,i=Number(s.word_id);return Number.isFinite(i)?[{word_id:i,due_after:Math.max(Number(s.due_after??0),0)}]:[]}),e.id),t.last_answered_word!=null&&ir(Number(t.last_answered_word),e.id),t.review_id!=null&&(r.run("DELETE FROM reviews WHERE id = ?",[Number(t.review_id)]),Rr("words",n))}});var sT,iT,Em,aT,fm,pm,dT,yA,gm,uT,lT,cT,mT,pT=h(()=>{"use strict";G();Mt();St();ln();sT=3,iT="daily_review_v2",Em=()=>{let e={studyDate:T(),rounds:0,invites:0,lastRoundAnswerCount:0,snoozeUntilAnswerCount:0,declined:!1};try{let t=JSON.parse(O(iT,"{}"));return t.studyDate===e.studyDate?{...e,...t}:e}catch{return e}},aT=e=>{R(iT,JSON.stringify(e)),D()},fm=()=>Number(E("SELECT COUNT(*) FROM reviews WHERE reviewed_on = ?",[T()],0)),pm=`(
  SELECT COUNT(*)
  FROM reviews today_reviews
  WHERE today_reviews.word_id = t.word_id
    AND today_reviews.reviewed_on = ?
    AND today_reviews.direction = 'forward'
)`,dT="(p.known_forever = 0 AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?))",yA=()=>{let e=T(),t=A().toISOString();return p(`
    SELECT
      w.*,
      p.seen_count,
      p.known_forever,
      p.last_seen_on,
      p.right_count,
      p.fuzzy_count,
      p.forgot_count,
      p.mistake_streak,
      p.fsrs_stability,
      p.fsrs_difficulty,
      p.fsrs_due,
      p.fsrs_state,
      p.fsrs_steps,
      p.fsrs_reps,
      p.fsrs_lapses,
      ${pm} AS today_seen_count,
      COALESCE(n.note, '') AS note
    FROM stage1_tasks t
    JOIN words w ON w.id = t.word_id
    JOIN progress p ON p.word_id = t.word_id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE t.reviewed_on = ?
      AND ${dT}
      AND ${pm} >= ${sT}
    ORDER BY today_seen_count DESC, COALESCE(p.fsrs_lapses, 0) DESC, p.fsrs_due ASC, w.id ASC
    LIMIT 8
  `,[e,e,t,e])},gm=()=>Number(E(`
  SELECT COUNT(*) FROM stage1_tasks t
  JOIN words w ON w.id = t.word_id
  JOIN progress p ON p.word_id = t.word_id
  WHERE t.reviewed_on = ? AND ${dT}
    AND ${pm} >= ${sT}
`,[T(),A().toISOString(),T()],0)),uT=()=>yA().map(re),lT=()=>{let e=Em();if(e.declined||e.rounds>=2)return!1;let t=fm();return t<e.snoozeUntilAnswerCount||e.rounds===1&&t-e.lastRoundAnswerCount<30||Zo()?!1:gm()>=5},cT=()=>{let e=Em(),t=e.invites+1;aT({...e,invites:t,declined:t>=2,snoozeUntilAnswerCount:t>=2?0:fm()+20})},mT=()=>{let e=Em();aT({...e,rounds:e.rounds+1,lastRoundAnswerCount:fm(),invites:0,snoozeUntilAnswerCount:0})}});function _m(){let e=E("SELECT value FROM app_state WHERE key = ?",[gT],null);if(e!=null)try{return JSON.parse(String(e))}catch{return ET()}return ET()}function ET(){return{memoryStrength:1,firstTimeCorrectRate:.5,retentionRate7Days:.5,avgReviewsToMaster:10,totalReviews:0,lastUpdated:new Date().toISOString()}}function bA(e){(0,fT.getDatabase)().run(`
    INSERT OR REPLACE INTO app_state (key, value)
    VALUES (?, ?)
  `,[gT,JSON.stringify(e)])}function LA(){let e=B(),t=p(`
    WITH ranked AS (
      SELECT
        r.reviewed_on,
        r.answer,
        ROW_NUMBER() OVER (PARTITION BY r.word_id ORDER BY r.reviewed_on, r.id) AS rn
      FROM reviews r
      WHERE r.direction = 'forward'
    )
    SELECT
      COUNT(CASE WHEN answer IN ('know', 'known_forever') THEN 1 END) AS correct,
      COUNT(*) AS total
    FROM ranked
    WHERE rn = 1
      AND reviewed_on BETWEEN date(?, '-30 days') AND ?
  `,[e,e])[0];if(!t)return .5;let r=Number(t.correct??0),n=Number(t.total??0);return n===0?.5:r/n}function OA(){j();let e=p(`
    WITH first_day AS (
      SELECT word_id, MIN(reviewed_on) AS d0
      FROM reviews
      WHERE direction = 'forward'
      GROUP BY word_id
    ), day_firsts AS (
      SELECT
        r.word_id,
        r.reviewed_on,
        r.answer,
        ROW_NUMBER() OVER (PARTITION BY r.word_id, r.reviewed_on ORDER BY r.id) AS rn
      FROM reviews r
      WHERE r.direction = 'forward'
    )
    SELECT
      COUNT(CASE WHEN f.answer IN ('know', 'known_forever') THEN 1 END) AS retained,
      COUNT(*) AS total
    FROM day_firsts f
    JOIN first_day fd ON fd.word_id = f.word_id
    WHERE f.rn = 1
      AND julianday(f.reviewed_on) - julianday(fd.d0) >= 7
  `)[0];if(!e)return .5;let t=Number(e.retained??0),r=Number(e.total??0);return r===0?.5:t/r}function AA(){j();let e=E(`
    SELECT
      AVG(review_count) AS avg_reviews
    FROM (
      SELECT p.word_id, COUNT(r.id) AS review_count
      FROM progress p
      JOIN reviews r ON r.word_id = p.word_id AND r.direction = 'forward'
      WHERE p.known_forever = 1 OR ${Ee}
      GROUP BY p.word_id
    )
  `,[],null);return Number(e)||10}function hA(){return E("SELECT COUNT(*) FROM reviews WHERE direction = 'forward'",[],0)}function kA(e,t,r){let n=e*.3,o=t*.4,s=Math.min(1,5/r)*.3;return .5+(n+o+s)*1.5}function _T(){let e=_m(),t=hA();if(t<NA||t-e.totalReviews<RA)return;let n=LA(),o=OA(),s=AA(),i=kA(n,o,s),a={memoryStrength:i,firstTimeCorrectRate:n,retentionRate7Days:o,avgReviewsToMaster:s,totalReviews:t,lastUpdated:new Date().toISOString()};bA(a),console.log("\u{1F4CA} \u8BB0\u5FC6\u753B\u50CF\u5DF2\u66F4\u65B0:",{memoryStrength:i.toFixed(2),firstTimeCorrectRate:(n*100).toFixed(1)+"%",retentionRate7Days:(o*100).toFixed(1)+"%",avgReviewsToMaster:s.toFixed(1)})}function wT(e){return e>=1.5?"\u4F18\u79C0":e>=1.2?"\u826F\u597D":e>=.8?"\u6B63\u5E38":"\u9700\u52A0\u5F3A"}var fT,gT,NA,RA,TT=h(()=>{"use strict";fT=N($(),1);ne();P();gT="user_memory_profile",NA=100,RA=50});var Tm={};x(Tm,{getEfficiencyAnalytics:()=>RT,getErrorAnalytics:()=>NT,getMasteryAnalytics:()=>yT,getStudyAnalytics:()=>wm,getStudyTimeAnalytics:()=>ST});function ST(){let e=B(),t=p(`
    SELECT
      studied_on AS date,
      CAST(seconds / 60.0 AS INTEGER) AS minutes,
      0 AS wordCount
    FROM word_study_time
    WHERE studied_on BETWEEN date(?, '-30 days') AND ?
    ORDER BY studied_on DESC
  `,[e,e]).map(u=>({date:String(u.date),minutes:Number(u.minutes??0),wordCount:0})),r=E("SELECT SUM(seconds) FROM word_study_time",[],0),n=Math.floor(r/3600),o=p(`
    SELECT checked_on FROM checkins ORDER BY checked_on DESC
  `).map(u=>String(u.checked_on)),s=0,i=B();for(let u=0;u<o.length;u++){let l=new Date(i);l.setDate(l.getDate()-u);let c=l.toISOString().slice(0,10);if(o[u]===c)s++;else break}let a=t.length>0?Math.round(t.reduce((u,l)=>u+l.minutes,0)/t.length):0;return{dailyMinutes:t,bestTimeOfDay:[],totalHours:n,streakDays:s,avgDailyMinutes:a}}function yT(){let e=vA(),t=p(`
    SELECT
      COALESCE(w.jlpt_level, '\u672A\u5206\u7EA7') AS level,
      COUNT(*) AS total,
      SUM(CASE WHEN ${e} THEN 1 ELSE 0 END) AS studied,
      SUM(CASE WHEN ${e} AND (p.known_forever = 1 OR ${Ee}) THEN 1 ELSE 0 END) AS mastered,
      SUM(CASE WHEN ${e} AND NOT (p.known_forever = 1 OR ${Ee})
        AND COALESCE(p.fsrs_lapses, 0) = 0 THEN 1 ELSE 0 END) AS learning,
      SUM(CASE WHEN ${e} AND NOT (p.known_forever = 1 OR ${Ee})
        AND COALESCE(p.fsrs_lapses, 0) > 0 THEN 1 ELSE 0 END) AS struggling
    FROM words w
    JOIN progress p ON p.word_id = w.id
    WHERE w.jlpt_level IN ('N5', 'N4', 'N3', 'N2', 'N1') AND ${oe()}
    GROUP BY w.jlpt_level
    ORDER BY CASE w.jlpt_level
      WHEN 'N5' THEN 1
      WHEN 'N4' THEN 2
      WHEN 'N3' THEN 3
      WHEN 'N2' THEN 4
      WHEN 'N1' THEN 5
      ELSE 9 END
  `).map(s=>{let i=Number(s.total??0),a=Number(s.studied??0),d=Number(s.mastered??0);return{level:String(s.level),total:i,studied:a,mastered:d,learning:Number(s.learning??0),struggling:Number(s.struggling??0),percentage:a>0?Math.round(d/a*100):0}}),r=p(`
    SELECT
      CASE
        WHEN pos LIKE '%\u540D%' THEN '\u540D\u8BCD'
        WHEN pos LIKE '%\u52D5%' OR pos LIKE '%\u52A8%' THEN '\u52A8\u8BCD'
        WHEN pos LIKE '%\u5F62%' THEN '\u5F62\u5BB9\u8BCD'
        WHEN pos LIKE '%\u526F%' THEN '\u526F\u8BCD'
        ELSE '\u5176\u4ED6'
      END AS pos,
      AVG(p.fsrs_stability) AS avgStability,
      COUNT(*) AS count,
      SUM(CASE WHEN p.known_forever = 1 OR ${Ee} THEN 1 ELSE 0 END) AS masteredCount
    FROM words w
    JOIN progress p ON p.word_id = w.id
    WHERE ${e}
    GROUP BY pos
    ORDER BY count DESC
    LIMIT 5
  `).map(s=>({pos:String(s.pos),avgStability:Math.round(Number(s.avgStability??0)*10)/10,count:Number(s.count??0),masteredCount:Number(s.masteredCount??0)})),n={},o=E(`SELECT AVG(daily_new) FROM (
      SELECT COUNT(DISTINCT word_id) AS daily_new
      FROM reviews
      WHERE direction = 'forward'
        AND reviewed_on BETWEEN date(?, '-7 days') AND ?
      GROUP BY reviewed_on
    )`,[B(),B()],10);return t.forEach(s=>{let i=s.total-s.mastered,a=o>0?Math.ceil(i/o):999;n[s.level]=a}),{byLevel:t,byPartOfSpeech:r,estimatedDaysToComplete:n}}function NT(){let e=p(`
    SELECT
      w.id,
      w.kanji,
      w.kana,
      w.meaning,
      p.fsrs_stability,
      COUNT(r.id) AS totalReviews,
      SUM(CASE WHEN r.answer IN ('forgot', 'fuzzy') THEN 1 ELSE 0 END) AS wrong_count
    FROM words w
    JOIN progress p ON p.word_id = w.id
    JOIN reviews r ON r.word_id = w.id AND r.direction = 'forward'
    WHERE p.known_forever = 0
    GROUP BY w.id, w.kanji, w.kana, w.meaning, p.fsrs_stability
    HAVING COUNT(r.id) >= 3
    ORDER BY
      SUM(CASE WHEN r.answer = 'forgot' THEN 2.0 WHEN r.answer = 'fuzzy' THEN 1.0 ELSE 0 END)
        / NULLIF(COUNT(r.id), 0) DESC,
      COALESCE(p.fsrs_stability, 0) ASC
    LIMIT 20
  `).map(n=>{let o=Number(n.wrong_count??0),s=Number(n.totalReviews??1);return{id:Number(n.id),kanji:String(n.kanji),kana:String(n.kana),meaning:String(n.meaning),errorRate:Math.round(o/s*100),totalReviews:s,stability:Number(n.fsrs_stability??0)}}),t=H(`
    SELECT
      SUM(CASE WHEN answer = 'forgot' THEN 1 ELSE 0 END) AS forgot,
      SUM(CASE WHEN answer = 'fuzzy' THEN 1 ELSE 0 END) AS fuzzy,
      SUM(CASE WHEN answer IN ('know', 'known_forever') THEN 1 ELSE 0 END) AS know
    FROM reviews
    WHERE direction = 'forward'
  `),r={forgot:Number(t?.forgot??0),fuzzy:Number(t?.fuzzy??0),know:Number(t?.know??0)};return{mostDifficultWords:e,errorTypeDistribution:r}}function RT(){let e=E(`SELECT AVG(review_count) FROM (
      SELECT p.word_id, COUNT(r.id) AS review_count
      FROM progress p
      JOIN reviews r ON r.word_id = p.word_id AND r.direction = 'forward'
      WHERE p.known_forever = 1 OR ${Ee}
      GROUP BY p.word_id
    )`,[],null),t=H(`
    SELECT
      SUM(wst.seconds) / 3600.0 AS total_hours,
      COUNT(DISTINCT r.word_id) AS new_words
    FROM word_study_time wst
    LEFT JOIN reviews r ON r.reviewed_on = wst.studied_on
      AND r.direction = 'forward'
    WHERE wst.studied_on BETWEEN date(?, '-7 days') AND ?
      AND NOT EXISTS (
        SELECT 1 FROM reviews r2
        WHERE r2.word_id = r.word_id
          AND r2.direction = 'forward'
          AND (r2.reviewed_on < r.reviewed_on OR (r2.reviewed_on = r.reviewed_on AND r2.id < r.id))
      )
  `,[B(),B()]),r=Number(t?.total_hours??1),n=Number(t?.new_words??0),o=r>0?Math.round(n/r):0,s=H(`
    SELECT
      SUM(CASE WHEN r.answer IN ('know', 'known_forever') THEN 1 ELSE 0 END) AS retained,
      COUNT(*) AS sample_size
    FROM reviews r
    WHERE r.direction = 'forward'
      AND EXISTS (
        SELECT 1
        FROM reviews prior
        WHERE prior.word_id = r.word_id
          AND prior.direction = 'forward'
          AND (julianday(r.reviewed_on) - julianday(prior.reviewed_on)) >= 7
      )
      AND NOT EXISTS (
        SELECT 1
        FROM reviews same_day
        WHERE same_day.word_id = r.word_id
          AND same_day.direction = 'forward'
          AND same_day.reviewed_on = r.reviewed_on
          AND same_day.id < r.id
          AND EXISTS (
            SELECT 1
            FROM reviews same_day_prior
            WHERE same_day_prior.word_id = same_day.word_id
              AND same_day_prior.direction = 'forward'
              AND (julianday(same_day.reviewed_on) - julianday(same_day_prior.reviewed_on)) >= 7
          )
      )
  `),i=Number(s?.sample_size??0),a=i>0?Number(s?.retained??0)/i:0;_T();let u=_m().memoryStrength,l=wT(u),c="stable";i>0&&a>.7?c="improving":i>0&&a<.4&&(c="declining");let f=E("SELECT COUNT(*) FROM reviews WHERE direction = 'forward'",[],0);return{avgReviewsToMaster:e==null?0:Math.round(e*10)/10,newWordsPerHour:o,retentionRate7Days:Math.round(a*100),retentionSampleSize:i,efficiencyTrend:c,memoryStrength:Math.round(u*100)/100,memoryStrengthLabel:l,memorySampleSize:f}}function wm(){return j(),{studyTime:ST(),mastery:yT(),errors:NT(),efficiency:RT(),generatedAt:new Date().toISOString()}}var vA,Sm=h(()=>{"use strict";P();TT();ne();$e();vA=()=>`(p.known_forever = 1 OR EXISTS (
    SELECT 1 FROM reviews r WHERE r.word_id = w.id AND r.direction = 'forward'
  ) OR (p.seen_count > 0${E("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='level_prior_baselines'",[],0)>0?` AND NOT EXISTS (
    SELECT 1 FROM level_prior_baselines b WHERE b.entity='words' AND b.entity_key=CAST(p.word_id AS TEXT)
  )`:""}))`});var Cm={};x(Cm,{FOLDER_NAME_MAX:()=>bT,UNFILED_FOLDER:()=>mn,addFavorite:()=>Rs,addFavorites:()=>hm,createFavoriteFolder:()=>bm,deleteFavoriteFolder:()=>Om,getFavoriteItems:()=>vm,lastFavoriteFolder:()=>Nm,listFavoriteFolders:()=>ym,renameFavoriteFolder:()=>Lm,setFavoriteFolder:()=>Am,toggleFavorite:()=>km,unfiledFavoriteCount:()=>Rm});function ym(){return q(),p(`
    SELECT name, COALESCE(n, 0) AS n, created_at FROM (
      SELECT f.name AS name, c.n AS n, f.created_at AS created_at
      FROM favorite_folders f
      LEFT JOIN (SELECT folder, COUNT(*) AS n FROM content_favorites GROUP BY folder) c
        ON c.folder = f.name
      UNION
      SELECT folder, COUNT(*), '' FROM content_favorites
      WHERE folder <> '' AND folder NOT IN (SELECT name FROM favorite_folders)
      GROUP BY folder
    )
    ORDER BY created_at ASC, name ASC
  `).map(t=>({name:String(t.name??""),count:Number(t.n??0)}))}function Nm(){return q(),O(OT,mn)}function Rm(){return q(),E("SELECT COUNT(*) FROM content_favorites WHERE folder = ''",[],0)}function bm(e){q();let t=LT(e);return t?((0,cn.getDatabase)().run("INSERT OR IGNORE INTO favorite_folders (name) VALUES (?)",[t]),D(),t):""}function Lm(e,t){q();let r=LT(t);if(!r||r===e)return e;let n=(0,cn.getDatabase)();return n.run("INSERT OR IGNORE INTO favorite_folders (name) VALUES (?)",[r]),n.run("DELETE FROM favorite_folders WHERE name = ?",[e]),n.run("UPDATE content_favorites SET folder = ? WHERE folder = ?",[r,e]),D(),r}function Om(e){q();let t=(0,cn.getDatabase)();t.run("UPDATE content_favorites SET folder = '' WHERE folder = ?",[e]),t.run("DELETE FROM favorite_folders WHERE name = ?",[e]),D()}function Am(e,t,r){q(),(0,cn.getDatabase)().run("UPDATE content_favorites SET folder = ? WHERE item_type = ? AND item_id = ?",[r,e,String(t)]),D()}function Rs(e,t,r=mn){q();let n=(0,cn.getDatabase)(),o=String(t);n.run("INSERT OR IGNORE INTO content_favorites (item_type, item_id, folder) VALUES (?, ?, ?)",[e,o,r]),n.run("UPDATE content_favorites SET folder = ? WHERE item_type = ? AND item_id = ?",[r,e,o]),R(OT,r),D()}function hm(e,t,r=mn){return t.forEach(n=>Rs(e,n,r)),t.length}function km(e,t,r=mn){q();let n=String(t);return Mo(e,n)?((0,cn.getDatabase)().run("DELETE FROM content_favorites WHERE item_type = ? AND item_id = ?",[e,n]),D(),{isFavorite:!1}):(Rs(e,n,r),{isFavorite:!0})}function vm(e="all",t){q();let r=[],n=[];return e!=="all"&&(r.push("item_type = ?"),n.push(e)),t!==void 0&&(r.push("folder = ?"),n.push(t)),p(`
    SELECT item_type, item_id, folder
    FROM content_favorites
    ${r.length?`WHERE ${r.join(" AND ")}`:""}
    ORDER BY created_at DESC
  `,n).flatMap(s=>{let i=String(s.item_type??""),a=String(s.item_id??""),d=String(s.folder??"");if(i==="word"){let u=H("SELECT id, kanji, kana, meaning, pos FROM words WHERE id = ?",[Number(a)]);return u?[{type:i,id:a,folder:d,title:String(u.kanji||u.kana||""),subtitle:String(u.meaning??""),meta:`${String(u.kana??"")}${u.pos?` \xB7 ${String(u.pos)}`:""}`}]:[]}if(i==="grammar"){let u=H(`
        SELECT g.pattern, g.prompt, g.meaning, g.level,
          (SELECT COUNT(*) FROM grammar_points same_level
           WHERE same_level.level = g.level AND same_level.sort_order <= g.sort_order) AS level_ordinal
        FROM grammar_points g
        WHERE g.pattern = ?
      `,[a]);return u?[{type:i,id:a,folder:d,title:String(u.prompt||u.pattern||""),subtitle:String(u.meaning??""),meta:`${String(u.level??"")} \xB7 ${String(Number(u.level_ordinal??0)).padStart(3,"0")}`}]:[{type:i,id:a,folder:d,title:"",subtitle:"",meta:""}]}return[]})}var cn,mn,bT,LT,OT,Dm=h(()=>{"use strict";cn=N($(),1);G();mn="",bT=20,LT=e=>e.replace(/\s+/g," ").trim().slice(0,bT);OT="favorite_last_folder"});var Im,AT,hT,kT,vT=h(()=>{"use strict";G();Pe();Im=8,AT=(e=B())=>p(`
    SELECT * FROM (
      SELECT
        w.id AS id, w.kanji AS kanji, w.kana AS kana, w.meaning AS meaning,
        COALESCE(p.forgot_count, 0) AS lapses,
        (SELECT COUNT(*) FROM reviews r
          WHERE r.word_id = w.id AND r.reviewed_on = ? AND r.direction = 'forward'
            AND r.answer IN ('forgot','fuzzy')) AS wrong_today,
        EXISTS(SELECT 1 FROM content_favorites cf
          WHERE cf.item_type = 'word' AND cf.item_id = CAST(w.id AS TEXT)) AS favorited
      FROM words w
      JOIN progress p ON p.word_id = w.id
      WHERE w.id IN (
        SELECT DISTINCT word_id FROM reviews WHERE reviewed_on = ? AND direction = 'forward'
      )
    )
    WHERE lapses > ? AND wrong_today >= ?
    ORDER BY wrong_today DESC, lapses DESC, id ASC
  `,[e,e,Im,Me]).map(t=>({id:Number(t.id??0),kanji:String(t.kanji??""),kana:String(t.kana??""),meaning:String(t.meaning??""),lapses:Number(t.lapses??0),wrongToday:Number(t.wrong_today??0),isFavorite:Number(t.favorited??0)===1})),hT=(e=B())=>p(`
    SELECT * FROM (
      SELECT
        g.id AS id, g.pattern AS pattern, g.meaning AS meaning, g.level AS level,
        COALESCE(p.forgot_count, 0) AS lapses,
        (SELECT COUNT(*) FROM grammar_reviews r
          WHERE r.grammar_id = g.id AND r.reviewed_on = ?
            AND r.answer IN ('forgot','fuzzy')) AS wrong_today
      FROM grammar_points g
      JOIN grammar_progress p ON p.grammar_id = g.id
      WHERE g.id IN (
        SELECT DISTINCT grammar_id FROM grammar_reviews WHERE reviewed_on = ?
      )
    )
    WHERE lapses > ? AND wrong_today >= ?
    ORDER BY wrong_today DESC, lapses DESC, id ASC
  `,[e,e,Im,Me]).map(t=>({id:Number(t.id??0),pattern:String(t.pattern??""),meaning:String(t.meaning??""),level:String(t.level??""),lapses:Number(t.lapses??0),wrongToday:Number(t.wrong_today??0)})),kT=(e=60)=>{let t=B(),r=s=>new Map(p(s,[t,Me,Im]).map(i=>[String(i.day??""),Number(i.n??0)])),n=r(`
    SELECT day, COUNT(*) AS n FROM (
      SELECT r.reviewed_on AS day, r.word_id AS wid, COUNT(*) AS wrong
      FROM reviews r
      WHERE r.direction = 'forward' AND r.answer IN ('forgot','fuzzy') AND r.reviewed_on < ?
      GROUP BY r.reviewed_on, r.word_id
    ) x
    JOIN progress p ON p.word_id = x.wid
    WHERE x.wrong >= ? AND COALESCE(p.forgot_count, 0) > ?
    GROUP BY day
  `),o=r(`
    SELECT day, COUNT(*) AS n FROM (
      SELECT r.reviewed_on AS day, r.grammar_id AS gid, COUNT(*) AS wrong
      FROM grammar_reviews r
      WHERE r.answer IN ('forgot','fuzzy') AND r.reviewed_on < ?
      GROUP BY r.reviewed_on, r.grammar_id
    ) x
    JOIN grammar_progress p ON p.grammar_id = x.gid
    WHERE x.wrong >= ? AND COALESCE(p.forgot_count, 0) > ?
    GROUP BY day
  `);return[...new Set([...n.keys(),...o.keys()])].sort((s,i)=>s<i?1:-1).slice(0,e).map(s=>({date:s,words:n.get(s)??0,grammar:o.get(s)??0}))}});var Hm={};x(Hm,{UNFILED_FOLDER:()=>mn,addAnswerPreview:()=>n0,addFavorite:()=>Rs,addFavorites:()=>hm,addWordStudySeconds:()=>c0,addWordToTodayEncore:()=>WA,addWordsToQueue:()=>jA,advanceDailyRelief:()=>jw,advanceDailyTail:()=>Gw,answerPreviewsFresh:()=>o0,completeTodayWordPlan:()=>xA,continueKanjiStudy:()=>e0,continueStage2Study:()=>ZA,continueTodayPlanStudy:()=>QA,createFavoriteFolder:()=>bm,dailyReviewBatch:()=>uT,dailyReviewCandidateCount:()=>gm,declineDailyReviewInvite:()=>cT,deleteFavoriteFolder:()=>Om,ensureDailyRelief:()=>un,ensureDailyTail:()=>Ss,ensureProgressInitialized:()=>Y,getDailyReliefNext:()=>Ww,getDailyReliefProgress:()=>no,getDailyReviewCard:()=>Ht,getDailyTailNext:()=>Kw,getDailyTailProgress:()=>oo,getFavoriteItems:()=>vm,getGrammarPointFavorite:()=>ju,getQuickStudySession:()=>zA,getQuickStudySessionForWords:()=>JA,getReviewQueue:()=>fe,getStubbornGrammarToday:()=>hT,getStubbornHistoryDays:()=>kT,getStubbornWordsToday:()=>AT,getStudyAnalytics:()=>wm,getWordSession:()=>Fe,getWordStats:()=>ke,jumpToSimilarWord:()=>YA,lastFavoriteFolder:()=>Nm,listFavoriteFolders:()=>ym,markTodayWordCheckin:()=>UA,markWordKnownForever:()=>KA,pickedProgress:()=>ha,questionMeaningRivals:()=>u0,recordStubbornQuickStudy:()=>VA,refreshTodayWordPlan:()=>xm,renameFavoriteFolder:()=>Lm,rewindDailyTail:()=>Bw,setFavoriteFolder:()=>Am,setReviewQueue:()=>Qe,setWordsKnownForever:()=>Um,setWordsKnownForeverIds:()=>MT,shouldInviteDailyReview:()=>lT,startAnswerPreviews:()=>r0,startDailyReviewRound:()=>mT,startEncore:()=>FA,startPickedStudy:()=>BA,submitKanjiUnitAnswer:()=>t0,submitQuickStudyBatch:()=>qA,submitWordAnswer:()=>Wm,submitWordAnswerWithPreview:()=>i0,takeAnswerPreview:()=>s0,todayWordAudioPlan:()=>tn,toggleFavorite:()=>km,tomorrowWordAudioPlan:()=>h_,undoLastWordAnswer:()=>a0,unfiledFavoriteCount:()=>Rm,unmarkWordKnownForever:()=>GA,updateWordNote:()=>d0,updateWordQuestionMeaning:()=>l0,warmStage1SelectionCache:()=>k_,wordCardById:()=>Ht});function xm(){Y();let e=T(),t=Er(),r=ar();return t==="stage1"&&r.completed<r.total&&((0,We.getDatabase)().run("DELETE FROM stage1_tasks WHERE reviewed_on = ? AND word_id NOT IN (SELECT word_id FROM reviews WHERE reviewed_on = ? AND direction = 'forward')",[e,e]),$l(e,{topUp:!0}),D()),(0,se.notifyProgressUpdated)(),(0,se.notifyTodayWordPlanUpdated)(tn()),ke(Er())}function xA(){Y();let e=T();Ft();let r=p(`
    SELECT t.word_id
    FROM stage1_tasks t
    JOIN progress p ON p.word_id = t.word_id
    WHERE t.reviewed_on = ?
      AND p.known_forever = 0
      AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?)
  `,[e,A().toISOString()]).map(n=>Number(n.word_id)).filter(n=>Number.isFinite(n));if(r.length){let n=r.map(()=>"?").join(","),o=new Date;r.forEach(s=>{try{Re(s,"know",o)}catch(i){console.warn("[fsrs] \u4E00\u952E\u5B8C\u6210\u8BB0\u5F55\u8DF3\u8FC7:",i)}}),(0,We.getDatabase)().run(`
      UPDATE progress
      SET seen_count = seen_count + 1,
          last_seen_on = ?,
          right_count = right_count + 1,
          mistake_streak = 0
      WHERE word_id IN (${n})
        AND known_forever = 0
    `,[e,...r]),r.forEach(s=>Bn({wordId:s,answer:"know",reviewedOn:e,direction:"forward",schedulerMode:"normal",eventSource:"bulk_complete"})),Qe(fe().filter(s=>!r.includes(s.word_id)))}return Fa(),Ue("done"),D(),(0,se.notifyProgressUpdated)(),{stats:ke("done"),completedCount:r.length}}function UA(){return Y(),Fa(),D(),(0,se.notifyProgressUpdated)(),ke(Er())}function FA(e){if(Y(),ho())return Fe();let t=T();Ft();let r=qo(Qi(t)),n=e&&e>0?Math.min(Math.round(e),100):r>0?r:Math.max(Math.round(Jt()/2),5);if(n<=0)return Fe();let o=(0,We.getDatabase)(),s=E("SELECT COALESCE(MAX(order_index), 0) + 1 FROM stage1_tasks WHERE reviewed_on = ?",[t],1),i=p(`
    SELECT p.word_id
    FROM progress p
    JOIN words w ON w.id = p.word_id
    WHERE p.known_forever = 0
      AND p.seen_count > 0
      AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?)
      AND ${te("words","p.word_id")}
      AND p.word_id NOT IN (SELECT word_id FROM stage1_tasks WHERE reviewed_on = ?)
    ORDER BY
      p.fsrs_due ASC,
      p.fsrs_lapses DESC,
      w.importance DESC,
      p.last_seen_on ASC,
      p.word_id ASC
    LIMIT ?
  `,[A().toISOString(),t,n]);i.forEach((d,u)=>{o.run(`
      INSERT OR IGNORE INTO stage1_tasks (reviewed_on, word_id, task_type, order_index)
      VALUES (?, ?, 'review', ?)
    `,[t,Number(d.word_id),s+u])});let a=n-i.length;if(a>0){let d=p(`
      SELECT p.word_id
      FROM progress p
      JOIN words w ON w.id = p.word_id
      WHERE p.known_forever = 0
        AND ${Ne()}
        AND p.word_id NOT IN (SELECT word_id FROM stage1_tasks WHERE reviewed_on = ?)
      ORDER BY ${Pn("w")}
      LIMIT ?
    `,[t,a]);d.forEach((u,l)=>{o.run(`
        INSERT OR IGNORE INTO stage1_tasks (reviewed_on, word_id, task_type, order_index)
        VALUES (?, ?, 'encore_new', ?)
      `,[t,Number(u.word_id),s+i.length+l])}),i.length+d.length>0&&Qo(t,i.length+d.length)}else i.length>0&&Qo(t,i.length);return Ue("stage1"),D(),(0,se.notifyProgressUpdated)(),(0,se.notifyTodayWordPlanUpdated)(tn()),Fe()}function WA(e){Y(),Ft();let t=Math.round(Number(e));if(!Number.isFinite(t)||t<=0)return!1;let r=T();if(!E(`SELECT 1 FROM words w JOIN progress p ON p.word_id = w.id WHERE w.id = ? AND p.known_forever = 0 AND ${oe()} LIMIT 1`,[t],0)||!E(`SELECT 1 FROM progress WHERE word_id = ? AND (fsrs_due IS NULL OR fsrs_due <= ?)
      AND ${te("words","progress.word_id")} LIMIT 1`,[t,A().toISOString()],0)||E("SELECT 1 FROM stage1_tasks WHERE reviewed_on = ? AND word_id = ? LIMIT 1",[r,t],0))return!1;let i=(0,We.getDatabase)();return i.run("INSERT OR IGNORE INTO dictionary_discovered_words (word_id) VALUES (?)",[t]),i.run(`
    INSERT OR IGNORE INTO stage1_tasks (reviewed_on, word_id, task_type, order_index)
    VALUES (?, ?, 'encore_new', ?)
  `,[r,t,E("SELECT COALESCE(MAX(order_index), 0) + 1 FROM stage1_tasks WHERE reviewed_on = ?",[r],1)]),Ue("stage1"),D(),(0,se.notifyProgressUpdated)(),(0,se.notifyTodayWordPlanUpdated)(tn()),!0}function jA(e){Y(),Ft();let t=(0,We.getDatabase)(),r=T(),n=xt(),o=new Set,s=[],i=0,a=0;if(e.forEach(c=>{let f=Math.round(Number(c));if(!Number.isFinite(f)||f<=0||o.has(f))return;let m=H(`SELECT p.seen_count, p.known_forever, ${ee()} AS started FROM progress p JOIN words w ON w.id = p.word_id WHERE w.id = ? AND ${oe()} LIMIT 1`,[f]);if(m){if(o.add(f),Number(m.known_forever??0)===1){a+=1;return}if(Number(m.started??0)>0){i+=1;return}s.push(f)}}),!s.length)return{added:0,today:0,alreadyLearning:i,known:a};let d=()=>{let c=s.map(()=>"?").join(","),f=E(`
      SELECT t.word_id
      FROM stage1_tasks t
      JOIN progress p ON p.word_id = t.word_id
      WHERE t.reviewed_on = ?
        AND t.task_type = 'new'
        AND NOT ${ee()}
        AND p.known_forever = 0
        AND t.word_id NOT IN (${c})
      ORDER BY t.order_index DESC
      LIMIT 1
    `,[r,...s],0);return f?(t.run("DELETE FROM stage1_tasks WHERE reviewed_on = ? AND word_id = ?",[r,f]),!0):!1},u=E("SELECT COALESCE(MAX(order_index), 0) + 1 FROM stage1_tasks WHERE reviewed_on = ?",[r],1),l=0;return s.forEach(c=>{if(t.run("INSERT OR IGNORE INTO dictionary_discovered_words (word_id) VALUES (?)",[c]),E("SELECT 1 FROM stage1_tasks WHERE reviewed_on = ? AND word_id = ? LIMIT 1",[r,c],0)){l+=1;return}l>=n||jl(r)>=n&&!d()||(t.run(`
      INSERT OR IGNORE INTO stage1_tasks (reviewed_on, word_id, task_type, order_index)
      VALUES (?, ?, 'new', ?)
    `,[r,c,u]),u+=1,l+=1)}),l>0&&Ue("stage1"),D(),(0,se.notifyProgressUpdated)(),l>0&&(0,se.notifyTodayWordPlanUpdated)(tn()),{added:s.length,today:l,alreadyLearning:i,known:a}}function MT(e,t){Y();let r=T(),n=[];return e.forEach(o=>{let s=HA(o);s!==null&&(t?$A(s,r):PA(s,r))&&n.push(s)}),n.length>0&&(D(),(0,se.notifyProgressUpdated)()),n}function Um(e,t){return MT(e,t).length}function BA(e){Y();let t=hw(e);return(0,se.notifyProgressUpdated)(),{count:t.length,session:Fe({focus:"picked"})}}function Fe(e={}){if(Y(),!e.focus&&pr()&&He()&&Er()==="kanji")return Fm();let{card:t,phase:r}=Z("\u9009\u5361",()=>IT(e));return{card:t,phase:r,stats:Z("\u7EDF\u8BA1",()=>ke(r,e)),canUndo:rs(Wa(r,e))}}function YA(e,t,r={}){if(Y(),!Number.isFinite(t)||t===e)throw new Error("\u76F8\u4F3C\u8BCD\u76EE\u6807\u65E0\u6548");let n=Ht(t);if(!n)throw new Error("\u627E\u4E0D\u5230\u8FD9\u4E2A\u76F8\u4F3C\u8BCD");let o=Wm(e,"fuzzy",r);return Kt(n),{card:n,phase:o.phase,stats:o.stats,canUndo:o.canUndo}}function zA(e=50,t=[]){Y();let r=Math.max(1,Math.round(e)),n=Er(),o=[],s=new Set(t.map(a=>Number(a)).filter(a=>Number.isFinite(a))),i=()=>n==="stage1"?Pl(s,{deterministic:!0}):n==="stage2"||n==="kanji"?Bc(mr(n),s,{deterministic:!0}):null;for(;o.length<r;){let a=i();if(!a||s.has(a.id))break;o.push(a),s.add(a.id)}return{cards:o,phase:n,stats:ke(n)}}function VA(e){e<=0||(Qo(T(),e),D(),(0,se.notifyProgressUpdated)())}function JA(e){return Y(),{cards:e.map(r=>Ht(Number(r))).filter(r=>!!r),phase:"stage1",stats:ke("stage1")}}function qA(e,t){if(Y(),!e.length)return Fe();let r=t==="stage2"||t==="kanji"?t:"stage1",n=null;return e.forEach(({wordId:o,answer:s},i)=>{Ue(r),Kt({id:o}),n=Wm(o,s),i<e.length-1&&Ue(r)}),n??Fe()}function QA(e){Y(),Ue("stage1"),Ft();let r=e!=null&&E(`
    SELECT COUNT(*) FROM stage1_tasks t JOIN progress p ON p.word_id = t.word_id
    WHERE t.reviewed_on = ? AND t.word_id = ? AND p.known_forever = 0
      AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?)
  `,[T(),e,A().toISOString()],0)>0?Ht(e):null;r&&Kt(r);let n=r?{card:r,phase:"stage1",stats:ke("stage1"),canUndo:!1}:Fe();return(0,se.notifyProgressUpdated)(),n}function ZA(){return xT(fs)}function e0(){return xT(gs)}function t0(e,t){return Y(),!pr()||!He()||bs!==e||(t==="known_forever"?lm(e,!0):um(e,t),bs=null,Kt(null),D(),(0,se.notifyProgressUpdated)()),Fe()}function Wm(e,t,r={},n=!1,o=!1){return o&&(Ue("stage1"),Kt({id:e})),Z("\u8BB0\u8D26",()=>jm(e,t,r,n)),Fe(r)}function jm(e,t,r,n=!1){if(Y(),!DA(e))return;let o=(0,We.getDatabase)(),s=T(),i=es(r)?"stage1":Er();if(i==="stage2"||i==="kanji"){rT(mr(i),e,t),D(),(0,se.notifyProgressUpdated)();return}let a=H("SELECT * FROM progress WHERE word_id = ?",[e]);if(!a)return;let d={phase:"stage1",mode:Wa("stage1",r),reviewed_on:s,word_id:e,last_answered_word:xe(),seen_count:Number(a.seen_count??0),known_forever:Number(a.known_forever??0),last_seen_on:a.last_seen_on,right_count:Number(a.right_count??0),fuzzy_count:Number(a.fuzzy_count??0),forgot_count:Number(a.forgot_count??0),mistake_streak:Number(a.mistake_streak??0),fsrs:Nt(e),...n&&t==="forgot"?{always_spell:E("SELECT always_spell FROM spelling_memory WHERE word_id = ?",[e],0)}:{},review_queue:fe()};Hn(e);let u=Number(a.known_forever??0),l=Number(a.right_count??0),c=Number(a.fuzzy_count??0),f=Number(a.forgot_count??0),m=Number(a.mistake_streak??0);t==="known_forever"?(u=1,m=0):(l+=t==="know"?1:0,c+=t==="fuzzy"?1:0,f+=t==="forgot"?1:0,m=t==="know"?0:m+1);let g=!1,S=!1,w=0,_=E(`SELECT COUNT(*) FROM reviews
       WHERE word_id = ? AND reviewed_on = ? AND direction = 'forward'
         AND answer IN ('forgot','fuzzy')`,[e,s],0)+(t==="forgot"||t==="fuzzy"?1:0)>=Me,v=E("SELECT COUNT(*) FROM reviews WHERE word_id = ? AND reviewed_on = ? AND direction = 'forward'",[e,s],0)===0&&t==="know"?"known":_?"stubborn":"normal";if(!u)try{let U=Re(e,t,new Date,{mode:v});g=yt(U,A()),w=Math.max((new Date(U.due).getTime()-Date.now())/6e4,0),S=!g&&yt(qe(U,"know",new Date,{mode:_?"stubborn":"normal"}),A())}catch(U){console.warn("[fsrs] \u8BB0\u5F55\u8DF3\u8FC7:",U),g=t==="know"}let L=!g,I=m>=ut;L&&!u&&Kn(e,w,I,S&&R_(a)),ir(e),o.run(`
    UPDATE progress
    SET seen_count = seen_count + 1,
        known_forever = ?,
        last_seen_on = ?,
        right_count = ?,
        fuzzy_count = ?,
        forgot_count = ?,
        mistake_streak = ?
    WHERE word_id = ?
  `,[u,s,l,c,f,m,e]);let M=Bn({wordId:e,answer:t,reviewedOn:s,direction:"forward",schedulerMode:v});n&&t==="forgot"&&o.run(`INSERT INTO spelling_memory (word_id, always_spell) VALUES (?, 1)
      ON CONFLICT(word_id) DO UPDATE SET always_spell = 1`,[e]),ea({...d,review_id:M}),D(),(0,se.notifyProgressUpdated)()}function r0(e){return{wordId:e,db:(0,We.getDatabase)(),day:T(),changes:$m(),byAnswer:{}}}function n0(e,t,r={}){if(!Pm(e))return;let n=performance.now(),o=(0,We.getDatabase)();o.run("SAVEPOINT preview_next_card");try{e.byAnswer[t]=(0,se.withProgressEventsMuted)(()=>{jm(e.wordId,t,r);let s=yt(Nt(e.wordId),A()),{card:i,phase:a}=IT(r),d=T(),u=a==="stage1"?E(`
        SELECT COUNT(*) FROM stage1_tasks t JOIN progress p ON p.word_id = t.word_id
        WHERE t.reviewed_on = ? AND p.known_forever = 0 AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?)
      `,[d,A().toISOString()],0):0,l=a==="stage1"?E("SELECT COUNT(*) FROM stage1_tasks WHERE reviewed_on = ?",[d],0):0;return{card:i,phase:a,graduatedForDay:s,sharedWithinClass:a==="stage1"&&i!=null&&i.id!==e.wordId&&u>Math.ceil(l*Ll)+2}})}catch(s){console.warn("[preview] \u9884\u7B97\u4E0B\u4E00\u5F20\u5931\u8D25\uFF0C\u8FD9\u4E00\u5F20\u8D70\u540C\u6B65\u8DEF\u5F84",s)}finally{o.run("ROLLBACK TO preview_next_card"),o.run("RELEASE preview_next_card")}e.changes=$m(),Tr("\u540E\u53F0\u9884\u7B97\u4E00\u6B21",performance.now()-n)}function s0(e,t,r){if(!e||e.wordId!==t||!Pm(e))return null;let n=e.byAnswer[r],o=CT[r]?e.byAnswer[CT[r]]:void 0,s=n??(o?.sharedWithinClass?o:void 0);return s?.card?s:null}function i0(e,t,r,n={},o=!1){return Z("\u8BB0\u8D26",()=>jm(e,t,n,o)),Kt(r.card),{card:r.card,phase:r.phase,stats:Z("\u7EDF\u8BA1",()=>ke(r.phase,n)),canUndo:rs(Wa(r.phase,n))}}function a0(e={}){Y();let t=(0,We.getDatabase)(),r=I_(Mm(e));if(!r)return DT(e);if(r.phase==="stage2"||r.phase==="kanji"){let i=mr(String(r.phase));if(r.direction&&r.direction!==i.id)return DT(e);nT(i,r),Ue(String(r.phase))}else r.phase==="stage1"&&(t.run(`
      UPDATE progress
      SET seen_count = ?,
          known_forever = ?,
          last_seen_on = ?,
          right_count = ?,
          fuzzy_count = ?,
          forgot_count = ?,
          mistake_streak = ?
      WHERE word_id = ?
    `,[Number(r.seen_count??0),Number(r.known_forever??0),r.last_seen_on==null?null:String(r.last_seen_on),Number(r.right_count??0),Number(r.fuzzy_count??0),Number(r.forgot_count??0),Number(r.mistake_streak??0),Number(r.word_id)]),r.review_id!=null&&(t.run("DELETE FROM reviews WHERE id = ?",[Number(r.review_id)]),Rr("words",Number(r.word_id))),Zr(Number(r.word_id),r.fsrs??null),r.always_spell!=null&&t.run("UPDATE spelling_memory SET always_spell = ? WHERE word_id = ?",[Number(r.always_spell),Number(r.word_id)]),Array.isArray(r.review_queue)&&Qe(r.review_queue.flatMap(i=>{if(!i||typeof i!="object")return[];let a=i,d=Number(a.word_id);return Number.isFinite(d)?[{word_id:d,due_after:Math.max(Number(a.due_after??0),0)}]:[]})),r.last_answered_word!=null&&ir(Number(r.last_answered_word)),es(e)||Ue("stage1"));D(),(0,se.notifyProgressUpdated)();let n=String(r.mode??r.phase??"stage1"),o=Number(r.word_id),s=n==="stage2"||n==="kanji"?Aa(mr(n),o):Ht(o);return s?(Kt(s),M_(s.id,n),{card:s,phase:n,stats:ke(n,e),canUndo:rs(n)}):Fe(e)}function d0(e,t){let r=(0,We.getDatabase)(),n=t.trim();return n?r.run("INSERT OR REPLACE INTO word_notes (word_id, note, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",[e,n]):r.run("DELETE FROM word_notes WHERE word_id = ?",[e]),D(),{wordId:e,note:n}}function u0(e){let t=gl(e);if(!t.length)return[];let r=t.map(()=>"?").join(", ");return p(`SELECT id, kanji, kana, meaning FROM words WHERE id IN (${r})`,t).map(n=>({id:Number(n.id??0),label:String(n.kanji||n.kana||""),kana:String(n.kana??""),meaning:String(n.meaning??"")}))}function l0(e,t){let r=rl(e,t);Ci(),Yg(),setTimeout(()=>fl(e),0),D();let n=p("SELECT id, kanji, kana, meaning FROM words WHERE id = ?",[e])[0],o=String(n?.kanji||n?.kana||""),s=String(n?.kana??""),i=String(n?.meaning??"");return{wordId:e,questionMeaning:n?Mn(i,o,s,e):r,promptMeaning:n?xn(i,e,o,s):r,isOverridden:!!r}}function c0(e,t=Date.now()){return Ve(),Ef(T(),e,t),D(),{seconds:e,stats:ke("stage1")}}var We,se,Er,Ue,Fa,CA,Kt,Ht,DA,Wa,Mm,IA,IT,MA,$A,PA,HA,KA,GA,bs,XA,Fm,xT,$m,Pm,o0,CT,DT,ln=h(()=>{"use strict";$e();We=N($(),1);Te();hr();In();Xo();Jo();pe();St();se=N(nr(),1);kr();Qt();or();G();Mt();at();ii();Xn();ne();Pe();Ut();ta();rn();cm();ts();tT();zc();ws();Xc();oT();kr();Ns();on();Ut();rn();cm();kr();Ts();Ia();pT();Sm();yr();Dm();vT();Er=()=>{let e=T();O("phase_date","")!==e&&(R("phase_date",e),R("phase","stage1"));let t=O("phase","stage1");if(t==="stage2"||t==="kanji"){if(t==="kanji"&&pr()&&He())return t;let r=ro(mr(t));if(r.total>0&&r.completed>=r.total)return R("phase","done"),"done"}return t},Ue=e=>{R("phase_date",T()),R("phase",e)},Fa=()=>{(0,We.getDatabase)().run("INSERT OR IGNORE INTO checkins (checked_on) VALUES (?)",[T()])},CA=e=>{let t=Ji(e,"w");t.clause+=` AND ${te("words","p.word_id")} AND ${oe()}`;let r=fe().filter(a=>a.due_after<=0).map(a=>a.word_id);if(r.length){let a=r.map(()=>"?").join(","),d=H(`
      SELECT w.*, p.seen_count, p.known_forever,
             p.last_seen_on, p.right_count, p.fuzzy_count, p.forgot_count,
             p.mistake_streak, COALESCE(n.note, '') AS note
      FROM words w
      JOIN progress p ON p.word_id = w.id
      LEFT JOIN word_notes n ON n.word_id = w.id
      WHERE w.id IN (${a})
        AND p.known_forever = 0
        ${t.clause}
      ORDER BY p.fsrs_due ASC, p.fsrs_lapses DESC, w.importance DESC
      LIMIT 1
    `,[...r,...t.params]);if(d)return re(d)}let n=H(`
    SELECT w.*, p.seen_count, p.known_forever,
           p.last_seen_on, p.right_count, p.fuzzy_count, p.forgot_count,
           p.mistake_streak, COALESCE(n.note, '') AS note
    FROM words w
    JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE p.known_forever = 0
      AND ${ee()}
      AND COALESCE(p.fsrs_lapses, 0) >= ?
      ${t.clause}
    ORDER BY p.fsrs_lapses DESC, p.fsrs_due ASC, w.importance DESC
    LIMIT 1
  `,[me,...t.params]);if(n)return re(n);let o=H(`
    SELECT w.*, p.seen_count, p.known_forever,
           p.last_seen_on, p.right_count, p.fuzzy_count, p.forgot_count,
           p.mistake_streak, COALESCE(n.note, '') AS note
    FROM words w
    JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE p.known_forever = 0
      AND ${ee()}
      AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?)
      ${t.clause}
    ORDER BY p.fsrs_due ASC, p.fsrs_lapses DESC, w.importance DESC
    LIMIT 1
  `,[A().toISOString(),...t.params]);if(o)return re(o);let s=H(`
    SELECT w.*, p.seen_count, p.known_forever,
           p.last_seen_on, p.right_count, p.fuzzy_count, p.forgot_count,
           p.mistake_streak, COALESCE(n.note, '') AS note
    FROM words w
    JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE p.known_forever = 0
      AND ${Ne()}
      ${t.clause}
    ORDER BY ${Pn("w")}
    LIMIT 1
  `,t.params);if(s)return re(s);let i=H(`
    SELECT w.*, p.seen_count, p.known_forever,
           p.last_seen_on, p.right_count, p.fuzzy_count, p.forgot_count,
           p.mistake_streak, COALESCE(n.note, '') AS note
    FROM words w
    JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE p.known_forever = 0
      ${t.clause}
    ORDER BY p.fsrs_due ASC, p.last_seen_on ASC, w.importance DESC, w.shuffle_rank DESC
    LIMIT 1
  `,t.params);return i?re(i):null},Kt=e=>{R("current_card",e&&e.id!=null?String(e.id):"0")},Ht=e=>{let t=H(`
    SELECT
      w.*,
      p.seen_count,
      p.known_forever,
      p.last_seen_on,
      p.right_count,
      p.fuzzy_count,
      p.forgot_count,
      p.mistake_streak,
      COALESCE(n.note, '') AS note
    FROM words w
    JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE w.id = ?
  `,[e]);return t?re(t):null},DA=e=>{let t=O("current_card","");return t===""?!0:t===String(e)?(R("current_card","0"),Bl(),!0):!1},Wa=(e,t={})=>t.focus==="mistakes"?"mistakes":t.focus==="picked"?"picked":es(t)?"filtered":e,Mm=(e={})=>Wa(Er(),e),IA=(e={})=>{let t=Mm(e),r=x_(t);if(!r)return null;let n=t==="stage2"||t==="kanji"?Aa(mr(t),r):Ht(r);return n?{card:n,phase:t==="filtered"?"filtered":t}:(Bl(),null)},IT=(e={})=>{let t=IA(e)??MA(e);return Kt(t.card),t},MA=(e={})=>{if(e.focus==="mistakes")return{card:eT(),phase:"mistakes"};if(e.focus==="picked")return{card:vw(),phase:"picked"};if(es(e))return{card:CA(e),phase:"filtered"};let t=Er();if(t==="done")return{card:null,phase:"done"};if(t==="stage2"||t==="kanji"){let n=Bc(mr(t));return n?{card:n,phase:t}:(Ue("done"),Fa(),{card:null,phase:"done"})}let r=Pl();return r?{card:r,phase:"stage1"}:(Fa(),Ue("done"),{card:null,phase:"done"})};$A=(e,t)=>{let r=H("SELECT known_forever FROM progress WHERE word_id = ?",[e]);return!r||Number(r.known_forever??0)===1?!1:((0,We.getDatabase)().run(`
    UPDATE progress
    SET seen_count = seen_count + 1,
        known_forever = 1,
        last_seen_on = ?,
        mistake_streak = 0
    WHERE word_id = ?
  `,[t,e]),Bn({wordId:e,answer:"known_forever",reviewedOn:t,direction:"forward",schedulerMode:"known_forever",eventSource:"known_forever"}),!0)},PA=(e,t)=>{let r=H("SELECT known_forever FROM progress WHERE word_id = ?",[e]);if(!r||Number(r.known_forever??0)!==1)return!1;let n=(0,We.getDatabase)(),o=E(`
    SELECT id FROM reviews
    WHERE word_id = ? AND reviewed_on = ? AND direction = 'forward' AND answer = 'known_forever'
    ORDER BY id DESC
    LIMIT 1
  `,[e,t],0);return o?(n.run("DELETE FROM reviews WHERE id = ?",[o]),n.run("UPDATE progress SET known_forever = 0, seen_count = MAX(seen_count - 1, 0) WHERE word_id = ?",[e])):n.run("UPDATE progress SET known_forever = 0 WHERE word_id = ?",[e]),!0},HA=e=>{let t=Math.round(Number(e));return Number.isFinite(t)&&t>0?t:null};KA=e=>Um([e],!0)>0,GA=e=>Um([e],!1)>0;bs=null,XA=e=>{let t=xa(e);return t?{text:t.targetSegment.text,start:t.targetSegment.start,length:t.targetSegment.length,reading:t.actualReading,unitType:t.unit.unitType,char:t.unit.char,base:t.unit.base,surface:t.unit.surface}:null},Fm=()=>{Pt(),ys(T());let e=am(T());if(!e)return bs=null,Kt(null),{card:null,phase:"done",stats:ke("kanji",{},{kanjiUnits:!0}),unitKey:null,unitTarget:null,canUndo:!1};let t=xa(e),r=t?Ht(t.exampleWordId):null;return r?(bs=e,Kt(r),{card:r,phase:"kanji",stats:ke("kanji",{},{kanjiUnits:!0}),unitKey:e,unitTarget:XA(e),canUndo:!1}):(bs=null,Fm())};xT=e=>{if(Y(),e.id==="kanji_reading"&&pr()&&!He()&&nn(),e.id==="kanji_reading"&&pr()&&He()){Pt(),ys(T()),Ue("kanji");let r=Fm();return(0,se.notifyProgressUpdated)(),r}Oa(e,!0);let t=ro(e);if(t.total>0&&t.completed<t.total){Ue(e.phase);let r=Fe();return(0,se.notifyProgressUpdated)(),r}return Ue("done"),Fe()};$m=()=>E("SELECT total_changes()",[],0);Pm=e=>e.db===(0,We.getDatabase)()&&e.day===T()&&e.changes===$m(),o0=(e,t)=>!!(e&&e.wordId===t&&e.byAnswer.know&&e.byAnswer.forgot&&Pm(e)),CT={fuzzy:"forgot",known_forever:"know"};DT=(e={})=>{let t=Mm(e),r=Number(O("current_card","0"))||0,n=r?t==="stage2"||t==="kanji"?Aa(mr(t),r):Ht(r):null;if(!n)return Fe(e);let o=t==="done"?Er():t;return{card:n,phase:o,stats:ke(o,e),canUndo:!1}}});var Vm=le((P1,KT)=>{KT.exports=new Proxy({},{get:(e,t)=>t==="__esModule"?!1:()=>({})})});var BT=le((H1,GT)=>{GT.exports=new Proxy({},{get(e,t){let r=require("../shared/content-store");if(t==="__esModule")return!1;if(t!=="then"){if(!r.pitchAccent)throw new Error("\u97F3\u9AD8\u91CD\u97F3\u8868\u8FD8\u6CA1\u4ECE\u5206\u5305\u52A0\u8F7D\uFF1A\u5148 await content.ready()");return t==="default"?r.pitchAccent:r.pitchAccent[t]}}})});var za={};x(za,{KANA:()=>Et,KANA_MASTERY_DAYS:()=>ip,deferWordPlanUntilKanaComplete:()=>$0,enforceKanaGate:()=>up,getAnsweredKana:()=>j0,getKanaProgress:()=>dp,getKanaStates:()=>Xa,kanaComplete:()=>fr,kanaMasteredCount:()=>rS,kanaProgressFrom:()=>Ya,kanaQuizChoices:()=>U0,kanaStateFrom:()=>tS,pickKanaIndex:()=>F0,recordKanaAnswer:()=>P0,replayKanaReviews:()=>H0});var Ga,ZT,io,Et,U0,F0,eS,ap,Ba,ip,tS,Xa,W0,Ya,dp,j0,rS,fr,$0,up,P0,H0,hs=h(()=>{"use strict";Ga=N($(),1);P();ne();pe();ZT=N(nr(),1),io=N(tt(),1),Et=[["\u3042","a"],["\u3044","i"],["\u3046","u"],["\u3048","e"],["\u304A","o"],["\u304B","ka"],["\u304D","ki"],["\u304F","ku"],["\u3051","ke"],["\u3053","ko"],["\u3055","sa"],["\u3057","shi"],["\u3059","su"],["\u305B","se"],["\u305D","so"],["\u305F","ta"],["\u3061","chi"],["\u3064","tsu"],["\u3066","te"],["\u3068","to"],["\u306A","na"],["\u306B","ni"],["\u306C","nu"],["\u306D","ne"],["\u306E","no"],["\u306F","ha"],["\u3072","hi"],["\u3075","fu"],["\u3078","he"],["\u307B","ho"],["\u307E","ma"],["\u307F","mi"],["\u3080","mu"],["\u3081","me"],["\u3082","mo"],["\u3084","ya"],["\u3086","yu"],["\u3088","yo"],["\u3089","ra"],["\u308A","ri"],["\u308B","ru"],["\u308C","re"],["\u308D","ro"],["\u308F","wa"],["\u3092","wo"],["\u3093","n"],["\u30A2","a"],["\u30A4","i"],["\u30A6","u"],["\u30A8","e"],["\u30AA","o"],["\u30AB","ka"],["\u30AD","ki"],["\u30AF","ku"],["\u30B1","ke"],["\u30B3","ko"],["\u30B5","sa"],["\u30B7","shi"],["\u30B9","su"],["\u30BB","se"],["\u30BD","so"],["\u30BF","ta"],["\u30C1","chi"],["\u30C4","tsu"],["\u30C6","te"],["\u30C8","to"],["\u30CA","na"],["\u30CB","ni"],["\u30CC","nu"],["\u30CD","ne"],["\u30CE","no"],["\u30CF","ha"],["\u30D2","hi"],["\u30D5","fu"],["\u30D8","he"],["\u30DB","ho"],["\u30DE","ma"],["\u30DF","mi"],["\u30E0","mu"],["\u30E1","me"],["\u30E2","mo"],["\u30E4","ya"],["\u30E6","yu"],["\u30E8","yo"],["\u30E9","ra"],["\u30EA","ri"],["\u30EB","ru"],["\u30EC","re"],["\u30ED","ro"],["\u30EF","wa"],["\u30F2","wo"],["\u30F3","n"]],U0=(e,t=0)=>{let r=new Set([Et[e][1]]);for(let o=7;r.size<4;o+=11)r.add(Et[(e+o)%Et.length][1]);let n=[...r];for(let o=n.length-1;o>0;o-=1){let s=(Math.floor(Math.random()*(o+1))+t)%(o+1);[n[o],n[s]]=[n[s],n[o]]}return n},F0=(e,t,r=Math.random)=>{let n=Et.flatMap(([d],u)=>(e[d]??0)<2?[u]:[]);if(!n.length)return null;let o=d=>d.filter(u=>Et[u][0]!==t),s=o(n.slice(0,8)),i=o(Et.flatMap(([d],u)=>(e[d]??0)>=2?[u]:[])),a=i.length&&(!s.length||r()<.25)?i:s.length?s:n;return a[Math.floor(r()*a.length)]},eS="kana_deferred_word_goal",ap={table:"kana_memory",idColumn:"symbol",eligible:"1=1"},Ba=()=>$r("kana-rows",()=>{let e=(0,Ga.getDatabase)();for(let[t]of Et)e.run("INSERT OR IGNORE INTO kana_memory (symbol) VALUES (?)",[t]);j(ap)}),ip=3,tS=(e,t)=>{let r=[],n="",o=0;for(let a of e){if(a.reviewed_on!==n&&(n=a.reviewed_on,o=0),a.answer!=="know"){r=[],o=0;continue}o+=1,!r.includes(a.reviewed_on)&&o>=(r.length===0?2:1)&&r.push(a.reviewed_on)}let s=n===t?o:0,i=r.length>=ip?"mastered":r.includes(t)?"passed":e.length?r.length===0?"learning":"review":"new";return{stage:i,days:r.length,todayCorrect:s,masteredOn:i==="mastered"?r[ip-1]:void 0}},Xa=(e=T())=>{Ba();let t=new Map;for(let r of p("SELECT symbol, answer, reviewed_on FROM kana_reviews ORDER BY reviewed_at, id")){let n=t.get(String(r.symbol))??[];n.push({answer:String(r.answer),reviewed_on:String(r.reviewed_on)}),t.set(String(r.symbol),n)}return Object.fromEntries(Et.map(([r])=>[r,tS(t.get(r)??[],e)]))},W0=e=>e.stage==="mastered"?2:e.days>0?1:0,Ya=e=>Object.fromEntries(Object.entries(e).map(([t,r])=>[t,W0(r)])),dp=()=>Ya(Xa()),j0=()=>(Ba(),new Set(p("SELECT symbol FROM kana_memory WHERE seen_count > 0").map(e=>String(e.symbol)))),rS=(e=dp())=>Et.filter(([t])=>(e[t]??0)>=2).length,fr=e=>O("kana_completed","0")==="1"||rS(e??dp())===Et.length,$0=e=>{R(eS,String(Math.max(0,Math.round(e)))),R("kana_completed",fr()?"1":"0");let t=X();fr()||nt({...t,dailyGoal:0}),(0,io.requestFullSnapshot)(),(0,io.scheduleSave)(0)},up=()=>{if(O("starting_level","")!=="kana-none"||fr())return;let e=X();e.dailyGoal!==0&&nt({...e,dailyGoal:0})},P0=(e,t)=>{if(Ba(),!Et.some(([d])=>d===e))throw new Error("\u672A\u77E5\u7684\u5047\u540D\u5361");let r=fr(),n=new Date;Re(e,t?"know":"forgot",n,{},ap);let o=(0,Ga.getDatabase)();o.run("INSERT INTO kana_reviews (symbol,answer,reviewed_on,reviewed_at) VALUES (?,?,?,?)",[e,t?"know":"forgot",T(n),n.getTime()]);let s=Xa(T(n)),i=Ya(s);o.run("UPDATE kana_memory SET correct_streak=?, seen_count=seen_count+1 WHERE symbol=?",[i[e],e]);let a=fr(i);if(a&&!r){R("kana_completed","1");let d=Math.max(0,Number(O(eS,"0"))||0),u=X(),l=`${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`;R("jlpt_plan_started_on",l),nt({...u,jlptPlanStartedOn:l,dailyGoal:d>0&&u.dailyGoal===0?d:u.dailyGoal},{keepPlanAnchor:!0})}return(0,io.requestFullSnapshot)(),(0,io.scheduleSave)(0),(0,ZT.notifyProgressUpdated)(),{progress:i,states:s,completed:a}},H0=()=>{Ba();let e=(0,Ga.getDatabase)(),t=p("SELECT DISTINCT symbol FROM kana_reviews").map(i=>String(i.symbol));for(let i of t){let a=p("SELECT answer, reviewed_at FROM kana_reviews WHERE symbol=? ORDER BY reviewed_at, id",[i]);e.run(`UPDATE kana_memory SET correct_streak=0, seen_count=?,
      fsrs_stability=NULL, fsrs_difficulty=NULL, fsrs_due=NULL, fsrs_last_review=NULL,
      fsrs_state=NULL, fsrs_steps=NULL, fsrs_reps=NULL, fsrs_lapses=NULL WHERE symbol=?`,[a.length,i]);for(let d of a)Re(i,d.answer==="know"?"know":"forgot",new Date(Number(d.reviewed_at)),{},ap)}let r=Xa(),n=Ya(r);for(let i of t)e.run("UPDATE kana_memory SET correct_streak=? WHERE symbol=?",[n[i]??0,i]);let o=O("kana_completed","0")==="1",s=fr(n);if(s&&!o){let i=Object.values(r).map(a=>a.masteredOn??"").sort().pop();i&&R("jlpt_plan_started_on",i)}R("kana_completed",s?"1":"0")}});var sS={};x(sS,{applyLevelStartingPoint:()=>Y0});async function Y0(e,t,r){Y(),Ce(),await ls(),cs(),ps();let n=(0,nS.getDatabase)(),o=F.indexOf(e.startingLevel);n.run("BEGIN");try{for(let s of B0){let i=p("SELECT entity_key FROM level_prior_baselines WHERE entity = ?",[s.name]).map(d=>String(d.entity_key)),a=new Map;if(o>=0){let d=p(`
          SELECT CAST(t.${s.key} AS TEXT) AS entity_key, ${s.level} AS level_rank
          FROM ${s.table} t
          WHERE t.known_forever = 0
            AND (${s.name==="words"?`NOT ${ee("t")}`:"t.seen_count = 0"} OR EXISTS (
              SELECT 1 FROM level_prior_baselines b WHERE b.entity = ? AND b.entity_key = CAST(t.${s.key} AS TEXT)
            ))
            AND NOT EXISTS (SELECT 1 FROM ${s.reviewTable} r WHERE r.${s.reviewKey} = t.${s.key})
            ${s.name==="words"?`AND t.word_id IN (SELECT w.id FROM words w JOIN progress p ON p.word_id = w.id WHERE ${oe()})`:""}
        `,[s.name]);for(let u of d){let l=Number(u.level_rank);if(l>o)continue;let c=l<o?100:e.familiarity[s.name],f=lp(c);if(f<=0)continue;let m=l<o?30:14,g=String(u.entity_key),S=G0(s.name,g,m,t),w=new Date(Math.min(t.getTime(),Date.parse(S)-f*864e5)).toISOString();a.set(g,{familiarity:c,stability:f,due:S,lastReview:w})}}for(let d of i)a.has(d)||E(`SELECT COUNT(*) FROM ${s.reviewTable} WHERE ${s.reviewKey} = ?`,[d],0)>0||E(`SELECT known_forever FROM ${s.table} WHERE ${s.key} = ?`,[d],0)||(n.run(`UPDATE ${s.table} SET ${X0} WHERE ${s.key} = ?`,[d]),n.run("DELETE FROM level_prior_baselines WHERE entity = ? AND entity_key = ?",[s.name,d]));for(let[d,u]of a)n.run(`
          INSERT OR REPLACE INTO level_prior_baselines
            (entity, entity_key, stability, difficulty, due, last_review, state, steps, reps, lapses, starting_level, familiarity, updated_at)
          VALUES (?, ?, ?, 5, ?, ?, 2, 0, 0, 0, ?, ?, ?)
        `,[s.name,d,u.stability,u.due,u.lastReview,e.startingLevel,u.familiarity,t.toISOString()]),n.run(`UPDATE ${s.table} SET
          seen_count = 1, known_forever = 0, fsrs_stability = ?, fsrs_difficulty = 5,
          fsrs_due = ?, fsrs_last_review = ?, fsrs_state = 2, fsrs_steps = 0,
          fsrs_reps = 0, fsrs_lapses = 0
          WHERE ${s.key} = ?`,[u.stability,u.due,u.lastReview,d])}R("level_prior_applied",r),n.run("COMMIT")}catch(s){throw n.run("ROLLBACK"),s}(0,Va.requestFullSnapshot)(),(0,Va.scheduleSave)(0),(0,oS.notifyProgressUpdated)()}var nS,oS,Va,K0,G0,B0,X0,iS=h(()=>{"use strict";$e();nS=N($(),1);P();yr();Qn();sn();oS=N(nr(),1),Va=N(tt(),1);rn();_t();Ja();K0=e=>{let t=2166136261;for(let r of e)t=Math.imul(t^r.charCodeAt(0),16777619);return t>>>0},G0=(e,t,r,n)=>new Date(n.getFullYear(),n.getMonth(),n.getDate()+K0(`${e}:${t}`)%r,12).toISOString(),B0=[{name:"words",table:"progress",key:"word_id",level:"(SELECT CASE w.jlpt_level WHEN 'N5' THEN 0 WHEN 'N4' THEN 1 WHEN 'N3' THEN 2 WHEN 'N2' THEN 3 WHEN 'N1' THEN 4 ELSE 99 END FROM words w WHERE w.id = t.word_id)",reviewTable:"reviews",reviewKey:"word_id"},{name:"grammar",table:"grammar_progress",key:"grammar_id",level:"(SELECT CASE g.level WHEN 'N5' THEN 0 WHEN 'N4' THEN 1 WHEN 'N3' THEN 2 WHEN 'N2' THEN 3 WHEN 'N1' THEN 4 ELSE 99 END FROM grammar_points g WHERE g.id = t.grammar_id)",reviewTable:"grammar_reviews",reviewKey:"grammar_id"},{name:"kanji",table:"kanji_char_memory",key:"char",level:"level_rank",reviewTable:"kanji_char_reviews",reviewKey:"char"},{name:"confusion",table:"confusion_progress",key:"group_key",level:"level_rank",reviewTable:"confusion_reviews",reviewKey:"group_key"}],X0=`seen_count = 0, right_count = 0, fuzzy_count = 0, forgot_count = 0,
  known_forever = 0, last_seen_on = NULL, fsrs_stability = NULL, fsrs_difficulty = NULL,
  fsrs_due = NULL, fsrs_last_review = NULL, fsrs_state = NULL, fsrs_steps = NULL,
  fsrs_reps = NULL, fsrs_lapses = NULL`});var fp={};x(fp,{applyLevelStartingPoint:()=>mp,effectiveStartingLevel:()=>Ep,familiarityDefaults:()=>J0,getLevelPlanSettings:()=>Mr,hydrateLevelPlanPreferences:()=>eh,recalibrateLevelStartingPoint:()=>th,saveLevelPlanSettings:()=>Z0,shouldShowLevelSetup:()=>Q0,stabilityFor:()=>lp});async function mp(e,t=new Date){let r=dS(e);if(O(ve.applied,"")===r)return;let{applyLevelStartingPoint:n}=await Promise.resolve().then(()=>(iS(),sS));await n(e,t,r)}async function Z0({planEnabled:e=!0,...t}){let r=Mr(),n=t.examKind??r?.examKind??"jlpt",o=uS(t.familiarity),s=r?.startingLevel===t.startingLevel&&r.target===t.target&&r.examKind===n&&r.examDate===t.examDate&&JSON.stringify(r.familiarity)===JSON.stringify(o),i={...t,examKind:n,familiarity:o,startedOn:t.startedOn||(s?r.startedOn:cp())};await mp({...i,startingLevel:pp(i)??i.startingLevel}),R(ve.startingLevel,i.startingLevel),R(ve.familiarity,JSON.stringify(i.familiarity)),R(ve.target,i.target),R(ve.examKind,i.examKind),R(ve.examDate,i.examDate),R(ve.startedOn,i.startedOn),R("jlpt_plan_enabled",e?"1":"0");let a=X();return R("level_plan_quotas",JSON.stringify(Object.fromEntries(Sn.map(d=>[d,a[d]])))),nt({...a,jlptPlanEnabled:e,jlptTarget:i.target,planExamKind:i.examKind,jlptExamDate:i.examDate,jlptPlanStartedOn:i.startedOn},{keepPlanAnchor:!0,fromLevelPlanSync:!0}),(0,qa.requestFullSnapshot)(),(0,qa.scheduleSave)(0),i}var aS,qa,z0,dS,V0,ve,cp,ks,uS,J0,lp,q0,Mr,Q0,eh,pp,Ep,th,Ja=h(()=>{"use strict";aS=N($(),1);P();Es();qa=N(tt(),1);ln();_t();Tn();pe();hs();z0="level-prior-v1",dS=e=>JSON.stringify({version:z0,level:e.startingLevel,familiarity:e.familiarity}),V0=new Set(["kana-none","kana",...F,"beyond"]),ve={startingLevel:"starting_level",familiarity:"type_familiarity",target:"jlpt_plan_target",examKind:"jlpt_plan_exam_kind",examDate:"jlpt_plan_exam_date",startedOn:"jlpt_plan_started_on",applied:"level_prior_applied"},cp=(e=new Date)=>`${e.getFullYear()}-${String(e.getMonth()+1).padStart(2,"0")}-${String(e.getDate()).padStart(2,"0")}`,ks=e=>Math.max(0,Math.min(100,Math.round(Number(e)||0))),uS=(e={})=>({words:ks(e.words),grammar:ks(e.grammar),kanji:ks(e.kanji),confusion:ks(e.confusion)}),J0=e=>{let t=F.includes(e)?75:0;return{words:t,grammar:t,kanji:t,confusion:t}},lp=e=>{let t=[[0,0],[25,3],[50,10],[75,30],[100,90]],r=ks(e);for(let n=1;n<t.length;n+=1){let[o,s]=t[n],[i,a]=t[n-1];if(r<=o){if(r===o)return s;let d=(r-i)/(o-i);return a===0?s*d:Math.exp(Math.log(a)+(Math.log(s)-Math.log(a))*d)}}return 90},q0=e=>{try{return uS(JSON.parse(e))}catch{return null}},Mr=()=>{let e=O(ve.startingLevel,""),t=q0(O(ve.familiarity,""));if(!V0.has(e)||!t)return null;let r=O(ve.target,""),n=F.includes(r)?r:X().jlptTarget;return{startingLevel:e,familiarity:t,target:n,examKind:No(O(ve.examKind,"jlpt"))?O(ve.examKind,"jlpt"):"jlpt",examDate:O(ve.examDate,""),startedOn:O(ve.startedOn,"")||cp()}},Q0=()=>O(ve.startingLevel,"")?!1:[["reviews","1=1"],["grammar_reviews","1=1"],["kanji_char_reviews","1=1"],["confusion_reviews","1=1"],["kana_reviews","1=1"],["progress","seen_count > 0 OR known_forever = 1"],["grammar_progress","seen_count > 0 OR known_forever = 1"],["checkins","1=1"]].every(([e,t])=>{try{return E(`SELECT COUNT(*) FROM ${e} WHERE ${t}`,[],0)===0}catch{return!0}});eh=()=>{let e=Mr();if(!e)return;let t={};try{t=JSON.parse(O("level_plan_quotas","{}"))}catch{}if(e.startingLevel==="kana-none"&&O("kana_completed","0")==="1"&&t.dailyGoal===0){let n=Number(O("kana_deferred_word_goal","0"));Number.isFinite(n)&&n>0&&(t.dailyGoal=n,R("level_plan_quotas",JSON.stringify(t)))}let r=Object.fromEntries(Sn.filter(n=>Number.isFinite(t[n])).map(n=>[n,t[n]]));nt({...X(),...r,jlptPlanEnabled:O("jlpt_plan_enabled","1")!=="0",jlptTarget:e.target,planExamKind:e.examKind,jlptExamDate:e.examDate,jlptPlanStartedOn:e.startedOn},{keepPlanAnchor:!0,fromLevelPlanSync:!0}),up()},pp=(e,t=new Date)=>{if(!F.includes(e.startingLevel))return null;let r=e.startingLevel,n=new Date(`${e.startedOn}T12:00:00`);if(!Number.isFinite(n.getTime())||t.getTime()-n.getTime()<14*864e5)return r;let o=p(`
    SELECT w.jlpt_level AS level, COUNT(*) AS total,
      SUM(CASE WHEN first.answer IN ('know', 'known_forever') THEN 1 ELSE 0 END) AS correct
    FROM (
      SELECT r.word_id, r.answer, r.reviewed_on
      FROM reviews r
      JOIN (SELECT word_id, MIN(id) AS id FROM reviews WHERE direction = 'forward' GROUP BY word_id) f ON f.id = r.id
    ) first JOIN words w ON w.id = first.word_id
    WHERE first.reviewed_on >= ?
    GROUP BY w.jlpt_level
  `,[cp(new Date(t.getTime()-14*864e5))]),s=new Map(o.map(l=>[String(l.level),{total:Number(l.total),rate:Number(l.correct)/Math.max(1,Number(l.total))}])),i=F.indexOf(r),a=s.get(r);if(a&&a.total>=50&&a.rate<.55)return F[Math.max(0,i-1)];let d=F[i+1],u=d?s.get(d):void 0;return u&&u.total>=50&&u.rate>=.85?d:r},Ep=(e=new Date)=>{let t=Mr();return t?pp(t,e):null},th=async(e=new Date)=>{let t=Mr();if(!t)return!1;let r={...t,startingLevel:pp(t,e)??t.startingLevel};return O(ve.applied,"")===dS(r)?!1:(await mp(r,e),xm(),Pc((0,aS.getDatabase)()),!0)}});var QS=le((Ej,qS)=>{qS.exports=Mi()("grammarKeyPoints")});var gy=le((yj,fy)=>{fy.exports=new Proxy({},{get:(e,t)=>t==="__esModule"?!1:()=>({})})});var md=le((Nj,_y)=>{var qk=()=>{try{return require("../runtime/entitlements").cachedEntitlement()}catch{return{active:!1,plan:"free",expiresAt:null,source:"local-default"}}},cd=()=>{let e=qk();return{isPro:!!e.active,productId:e.plan,source:e.source,expiresAt:e.expiresAt,updatedAt:e.fetchedAt||null}},qp=new Set,Jp=e=>{let t={...cd(),...e};try{require("../runtime/entitlements").storeEntitlement({isPro:!!t.isPro,plan:t.productId,source:t.source,expiresAt:t.expiresAt})}catch(n){console.warn("[entitlements] \u6743\u76CA\u6CA1\u5B58\u4E0B\u6765",n)}let r=cd();return qp.forEach(n=>{try{n(r)}catch(o){console.warn("[entitlements] \u8BA2\u9605\u56DE\u8C03\u51FA\u9519",o)}}),r},Qk={pro_monthly:"\u6708\u5EA6 Pro",pro_quarterly:"\u5B63\u5EA6 Pro",pro_yearly:"\u5E74\u5EA6 Pro",pro_lifetime:"\u6C38\u4E45 Pro",pro_trial:"\u8BA1\u5212\u8BD5\u7528",pro_launch_gift:"\u9996\u6708\u8D60\u9001\u4F1A\u5458"},Zk=e=>Qk[String(e||"").replace(/^shushugo_/,"")]||"\u514D\u8D39\u7248",ev=({productId:e,expiresAt:t})=>{if(!t)return String(e||"").replace(/^shushugo_/,"")==="pro_lifetime"?"\u957F\u671F\u6709\u6548":"\u5230\u671F\u65E5\u5F85\u786E\u8BA4";let r=new Date(t);return Number.isNaN(r.getTime())?"\u5230\u671F\u65E5\u5F85\u786E\u8BA4":`\u5230\u671F\u65E5 ${r.getFullYear()}-${String(r.getMonth()+1).padStart(2,"0")}-${String(r.getDate()).padStart(2,"0")}`};_y.exports={productLabel:Zk,entitlementExpiryLabel:ev,devForcePro:()=>!1,setDevForcePro:()=>{},getEntitlements:cd,canUseFeature:(e,t=cd())=>!!t.isPro,saveEntitlements:Jp,grantPro:(e,t,r)=>Jp({isPro:!0,productId:e,source:t,expiresAt:r}),clearEntitlements:()=>Jp({isPro:!1,source:"free",productId:void 0,expiresAt:null}),subscribeEntitlements:e=>(qp.add(e),()=>qp.delete(e))}});var hy={};x(hy,{customWordId:()=>Ay,importExternalWordList:()=>kv,materializeCustomWords:()=>hv,parseExternalWordListText:()=>iE,previewExternalWordList:()=>Oy});var _d,by,lv,Ge,oE,wd,fd,gd,Be,cv,mv,pv,Ev,sE,fv,iE,gv,Ps,_v,wv,Tv,Sv,Ly,Oy,yv,Nv,Rv,bv,Lv,Ov,Ay,Av,hv,kv,ky=h(()=>{"use strict";_d=N($(),1);ln();G();by=N(nr(),1);Bo();rr();hi();Pe();ne();Xo();lv=new Set(["word","term","title","entry","spell","surface","headword","\u5355\u8BCD","\u55AE\u8A5E","\u8BCD","\u8A5E","\u8BCD\u6761","\u8A5E\u689D","\u8868\u8BB0","\u8868\u8A18","\u898B\u51FA\u3057","\u65E5\u6587","kana","reading","yomi","pronunciation","pron","\u5047\u540D","\u304B\u306A","\u4EEE\u540D","\u8BFB\u97F3","\u8AAD\u307F","meaning","translation","definition","explain","briefInfo","excerpt","\u91CA\u4E49","\u91CA\u610F","\u4E2D\u6587","\u610F\u601D","\u7FFB\u8BD1","score","memory","\u719F\u6089\u5EA6","\u719F\u77E5\u5EA6","\u8BB0\u5FC6","\u8A18\u61B6","\u505A\u9898\u5206\u6570","\u6B63\u786E\u7387"]),Ge={term:["word","term","title","entry","spell","surface","headword","\u5355\u8BCD","\u55AE\u8A5E","\u8BCD","\u8A5E","\u8BCD\u6761","\u8A5E\u689D","\u8868\u8BB0","\u8868\u8A18","\u898B\u51FA\u3057","\u65E5\u6587"],kana:["kana","reading","yomi","pronunciation","pron","\u5047\u540D","\u304B\u306A","\u4EEE\u540D","\u8BFB\u97F3","\u8AAD\u307F","\u767A\u97F3","\u53D1\u97F3"],meaning:["meaning","translation","definition","explain","briefInfo","excerpt","\u91CA\u4E49","\u91CA\u610F","\u4E2D\u6587","\u610F\u601D","\u7FFB\u8BD1","\u8A33","\u8A33\u6587","\u4E2D\u56FD\u8A9E"],pos:["pos","partofspeech","\u54C1\u8BCD","\u54C1\u8A5E","\u8BCD\u6027","\u8A5E\u6027"],exampleJp:["examplejp","example","sentence","\u4F8B\u53E5","\u4F8B\u6587","\u65E5\u6587\u4F8B\u53E5"],exampleMeaning:["examplemeaning","examplecn","\u4F8B\u53E5\u7FFB\u8BD1","\u4F8B\u53E5\u91CA\u4E49","\u4E2D\u6587\u4F8B\u53E5"],jlptLevel:["jlpt","level","\u7B49\u7EA7","\u7D1A\u5225","\u7EA7\u522B","\u96E3\u5EA6","\u96BE\u5EA6"],note:["note","memo","notes","\u7B14\u8BB0","\u7B46\u8A18","\u5907\u6CE8","\u5099\u8003"],score:["score","memoryscore","\u719F\u6089\u5EA6","\u719F\u77E5\u5EA6","\u8BB0\u5FC6\u5206","\u8A18\u61B6\u5206","\u505A\u9898\u5206\u6570","\u6B63\u786E\u7387","\u6B63\u7B54\u7387","\u638C\u63E1\u5EA6"],seenCount:["seencount","reviewcount","testcount","qcnt","testtimes","\u6B21\u6570","\u590D\u4E60\u6B21\u6570","\u6D4B\u8BD5\u6B21\u6570","\u505A\u9898\u6B21\u6570"],rightCount:["rightcount","correctcount","\u6B63\u786E","\u6B63\u786E\u6570","\u4F1A\u4E86"],fuzzyCount:["fuzzycount","halfcount","\u6A21\u7CCA","\u72B9\u8C6B"],forgotCount:["forgotcount","wrongcount","incorrectcount","qwrcnt","\u9519\u8BEF","\u9519\u9898","\u5FD8\u8BB0","\u4E0D\u4F1A"],lastSeenOn:["lastseenon","reviewedon","updatedat","\u6700\u540E\u590D\u4E60","\u4E0A\u6B21\u590D\u4E60","\u6700\u8FD1\u5B66\u4E60"]},oE=e=>e.toLowerCase().replace(/[\s_\-()[\]（）【】:：/\\.,，。]/g,""),wd=e=>String(e??"").replace(/\uFEFF/g,"").trim(),fd=e=>/[\u3040-\u30ff\u3400-\u9fff々〆〤]/.test(e),gd=e=>/^[\u3040-\u30ffー・〜~\s]+$/.test(e.trim()),Be=(e,t)=>{let r=new Map(Object.keys(e).map(n=>[oE(n),n]));for(let n of t){let o=r.get(oE(n));if(o){let s=wd(e[o]);if(s)return s}}return""},cv=(e,t)=>{let r=[],n=[],o="",s=!1;for(let i=0;i<e.length;i+=1){let a=e[i],d=e[i+1];if(s){a==='"'&&d==='"'?(o+='"',i+=1):a==='"'?s=!1:o+=a;continue}a==='"'?s=!0:a===t?(n.push(o.trim()),o=""):a===`
`?(n.push(o.trim()),r.push(n),n=[],o=""):a!=="\r"&&(o+=a)}return n.push(o.trim()),n.some(Boolean)&&r.push(n),r.filter(i=>i.some(Boolean))},mv=e=>{let t=e.split(/\r?\n/).slice(0,8).join(`
`);return["	",",",";","|"].map(n=>({delimiter:n,count:t.split(n).length-1})).sort((n,o)=>o.count-n.count)[0]?.delimiter??"	"},pv=e=>e.filter(r=>lv.has(oE(r))).length>=1||e.filter(r=>!fd(r)&&/[a-zA-Z]/.test(r)).length>=Math.max(2,e.length/2),Ev=e=>{let t=cv(e,mv(e));if(!t.length)return[];if(pv(t[0])){let r=t[0].map((n,o)=>wd(n)||`column_${o+1}`);return t.slice(1).map(n=>Object.fromEntries(r.map((o,s)=>[o,n[s]??""])))}return t.map(r=>Object.fromEntries(r.map((n,o)=>[`column_${o+1}`,n])))},sE=e=>{if(Array.isArray(e))return e.flatMap(sE);if(!e||typeof e!="object")return[];let t=e,r=["words","items","list","data","records","vocabulary"].find(n=>Array.isArray(t[n]));return r?sE(t[r]):[t]},fv=e=>{let t=e.split(/\n\s*\n/).map(n=>n.trim()).filter(Boolean);return(t.length>1?t:e.split(/\r?\n/).map(n=>n.trim()).filter(Boolean)).map(n=>{let o=n.split(/\t| {2,}|,|，|、/).map(s=>s.trim()).filter(Boolean);return Object.fromEntries(o.map((s,i)=>[`column_${i+1}`,s]))})},iE=e=>{let t=e.replace(/\uFEFF/g,"").trim();if(!t)return[];if(/^[\[{]/.test(t))try{let n=sE(JSON.parse(t));if(n.length)return n}catch{}let r=Ev(t);return r.length?r:fv(t)},gv=e=>{let t=Object.values(e).map(wd).filter(Boolean),r=t.filter(fd),n=Be(e,Ge.kana)||r.find(i=>gd(i))||"",o=Be(e,Ge.term)||r.find(i=>!gd(i))||n||"",s=Be(e,Ge.meaning)||t.find(i=>!fd(i)&&i.length>1)||"";return{term:o,kana:n,meaning:s}},Ps=e=>{let t=e.replace(/,/g,"").match(/-?\d+(?:\.\d+)?/);return t?Number(t[0]):null},_v=e=>{let t=e.match(/20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}/);if(!t)return null;let[r,n,o]=t[0].split(/\D+/).map(Number);return!r||!n||!o?null:`${r}-${String(n).padStart(2,"0")}-${String(o).padStart(2,"0")}`},wv=e=>{let t=Be(e,Ge.score),r=Object.values(e).map(wd).join(" "),n=Ps(t);if(n!==null){if(n>=-40&&n<=10)return Math.round(n);let o=n<=1?n*100:n;if(o>=0&&o<=100)return Math.max(-15,Math.min(10,Math.round((o-60)/4)))}return/已掌握|完全记住|熟知|known|master/i.test(r)?8:/模糊|一般|fuzzy|again/i.test(r)?-2:/忘记|不会|错误|错题|forgot|wrong/i.test(r)?-10:0},Tv=(e,t)=>t||(/する$/.test(e)?"\u540D\u8BCD\u30FB\u3059\u308B\u52A8\u8BCD":/[うくぐすつぬぶむる]$/.test(e)?"\u52A8\u8BCD":/い$/.test(e)&&!gd(e)?"\u3044\u5F62\u5BB9\u8BCD":"\u5BFC\u5165\u8BCD"),Sv=(e,t)=>/する/.test(e)||/suru|する/.test(t)?"suru":/动词|動詞/.test(t)?/る$/.test(e)?"ichidan":"godan":null,Ly=e=>{let{term:t,kana:r,meaning:n}=gv(e);if(!t||!fd(t))return null;let o=t.replace(/\s+/g,""),s=(r||(gd(o)?o:"")).replace(/\s+/g,""),i=o,a=s||o,d=wv(e),u=Math.max(Ps(Be(e,Ge.seenCount))??0,d===0?0:1),l=Math.max(Ps(Be(e,Ge.rightCount))??0,d>4?1:0),c=Math.max(Ps(Be(e,Ge.fuzzyCount))??0,d<4&&d>-8?1:0),f=Math.max(Ps(Be(e,Ge.forgotCount))??0,d<=-8?1:0),m=Tv(o,Be(e,Ge.pos));return{term:o,kana:a,kanji:i,meaning:n||"\u81EA\u5B9A\u4E49\u5BFC\u5165",pos:m,verbType:Sv(o,m),importance:Math.max(1,Math.min(5,d<=-8?5:d<=2?4:3)),exampleJp:Be(e,Ge.exampleJp),exampleMeaning:Be(e,Ge.exampleMeaning),jlptLevel:Be(e,Ge.jlptLevel).match(/N[1-5]/i)?.[0].toUpperCase()??null,memoryScore:d,seenCount:u,rightCount:l,fuzzyCount:c,forgotCount:f,lowHistory:d<=-10?1:0,lastSeenOn:_v(Be(e,Ge.lastSeenOn)),note:Be(e,Ge.note)}},Oy=e=>{let t=iE(e),r=new Set,n=[],o=0,s=0;t.forEach(a=>{let d=Ly(a);if(!d){s+=1;return}let u=`${d.kanji}\0${d.kana}`;if(r.has(u)){o+=1;return}r.add(u),n.push(d)});let i=[];return t.length&&n.length/t.length<.5&&i.push("\u53EF\u8BC6\u522B\u884C\u504F\u5C11\uFF0C\u8BF7\u786E\u8BA4\u6587\u4EF6\u91CC\u6709\u65E5\u6587\u8BCD\u6761\u548C\u91CA\u4E49\u5217\u3002"),n.some(a=>a.meaning==="\u81EA\u5B9A\u4E49\u5BFC\u5165")&&i.push("\u90E8\u5206\u8BCD\u6CA1\u6709\u8BC6\u522B\u5230\u4E2D\u6587\u91CA\u4E49\uFF0C\u5DF2\u7528\u5360\u4F4D\u91CA\u4E49\u5BFC\u5165\u3002"),{totalRows:t.length,validRows:n.length,duplicateRows:o,skippedRows:s,samples:n.slice(0,5),warnings:i}},yv=(e,t)=>E("SELECT id FROM words WHERE kanji = ? AND kana = ?",[e,t],0)||E("SELECT id FROM words WHERE kanji = ? OR kana = ? LIMIT 1",[e,t],0),Nv=e=>Math.max(0,8-e.memoryScore)+e.forgotCount*2+e.fuzzyCount+Math.min(e.seenCount,20)/10,Rv=6,bv=(e,t)=>{let r=f=>Math.max(0,Math.min(Math.round(f),Rv)),n=r(t.rightCount),o=r(t.fuzzyCount),s=r(t.forgotCount),i=(f,m)=>Array(m).fill(f),d=t.memoryScore>=4?[...i("forgot",s),...i("fuzzy",o),...i("know",n)]:[...i("know",n),...i("fuzzy",o),...i("forgot",s)];d.length||(d=[t.memoryScore>=4?"know":t.memoryScore>-8?"fuzzy":"forgot"]);let u=new Date(`${t.lastSeenOn??""}T12:00:00`),l=Number.isNaN(u.getTime())?Date.now()-d.length*6e4:u.getTime(),c=null;d.forEach((f,m)=>{let g=t.memoryScore>=8&&f==="know"&&m===d.length-1?"known":"normal";c=qe(c,f,new Date(l),{mode:g}),l+=6e4}),c&&Rt(e,c)},Lv=1e12,Ov=1e12,Ay=(e,t)=>{let r=`${e}\0${t}`,n=2166136261,o=16777619;for(let s=0;s<r.length;s+=1){let i=r.charCodeAt(s);n=Math.imul(n^i,16777619)>>>0,o=Math.imul(o^i+s,2246822507)>>>0}return Lv+(n*4294967296+o)%Ov},Av=(e,t)=>{let r=(0,_d.getDatabase)(),n=Ay(e,t);for(;E("SELECT 1 FROM words WHERE id = ? LIMIT 1",[n],0)===1;){let o=H("SELECT kanji, kana FROM words WHERE id = ?",[n]);if(String(o?.kanji??"")===e&&String(o?.kana??"")===t)break;n+=1}return n},hv=()=>{let e=(0,_d.getDatabase)(),t=E("SELECT COUNT(*) FROM custom_words c WHERE NOT EXISTS (SELECT 1 FROM words w WHERE w.id = c.word_id)",[],0);return t?(e.run(`
    INSERT INTO words (
      id, meaning, kana, kanji, pos, verb_type, importance,
      shuffle_rank, example_jp, example_meaning, jlpt_level
    )
    SELECT
      c.word_id, c.meaning, c.kana, c.kanji, c.pos, c.verb_type, c.importance,
      ABS(RANDOM()) / 9223372036854775807.0, c.example_jp, c.example_meaning, c.jlpt_level
    FROM custom_words c
    WHERE NOT EXISTS (SELECT 1 FROM words w WHERE w.id = c.word_id)
  `),e.run("INSERT OR IGNORE INTO progress (word_id) SELECT word_id FROM custom_words"),Cn(),Go(),t):0},kv=e=>{Y();let t=Oy(e),r=iE(e).map(Ly).filter(u=>!!u),n=(0,_d.getDatabase)();j();let o=T(),s=0,i=0,a=0,d=new Set;n.run("BEGIN TRANSACTION");try{r.forEach(u=>{let l=`${u.kanji}\0${u.kana}`;if(d.has(l))return;d.add(l);let c=yv(u.kanji,u.kana);c?(n.run(`
          UPDATE words
          SET meaning = CASE WHEN meaning = '' OR meaning = '\u81EA\u5B9A\u4E49\u5BFC\u5165' THEN ? ELSE meaning END,
              pos = CASE WHEN pos = '' OR pos = '\u5BFC\u5165\u8BCD' THEN ? ELSE pos END,
              verb_type = COALESCE(verb_type, ?),
              importance = MAX(importance, ?),
              example_jp = COALESCE(NULLIF(example_jp, ''), ?),
              example_meaning = COALESCE(NULLIF(example_meaning, ''), ?),
              jlpt_level = COALESCE(jlpt_level, ?)
          WHERE id = ?
        `,[u.meaning,u.pos,u.verbType,u.importance,u.exampleJp,u.exampleMeaning,u.jlptLevel,c]),i+=1):(c=Av(u.kanji,u.kana),n.run(`
          INSERT INTO words (
            id, meaning, kana, kanji, pos, verb_type, importance,
            shuffle_rank, example_jp, example_meaning, jlpt_level
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ABS(RANDOM()) / 9223372036854775807.0, ?, ?, ?)
        `,[c,u.meaning,u.kana,u.kanji,u.pos,u.verbType,u.importance,u.exampleJp,u.exampleMeaning,u.jlptLevel]),n.run(`
          INSERT OR REPLACE INTO custom_words (
            word_id, kanji, kana, meaning, pos, verb_type, importance,
            example_jp, example_meaning, jlpt_level
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,[c,u.kanji,u.kana,u.meaning,u.pos,u.verbType,u.importance,u.exampleJp,u.exampleMeaning,u.jlptLevel]),s+=1),n.run("INSERT OR IGNORE INTO progress (word_id) VALUES (?)",[c]);let f=H("SELECT * FROM progress WHERE word_id = ?",[c]);Number(f?.known_forever??0)===0&&(Number(f?.seen_count??0)===0||f?.fsrs_due==null)&&(n.run(`
          UPDATE progress
          SET seen_count = MAX(seen_count, ?),
              known_forever = 0,
              last_seen_on = COALESCE(?, last_seen_on),
              right_count = MAX(right_count, ?),
              fuzzy_count = MAX(fuzzy_count, ?),
              forgot_count = MAX(forgot_count, ?)
          WHERE word_id = ?
        `,[u.seenCount,u.lastSeenOn??o,u.rightCount,u.fuzzyCount,u.forgotCount,c]),bv(c,u)),u.note&&n.run(`
          INSERT INTO word_notes (word_id, note, updated_at)
          VALUES (?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(word_id) DO UPDATE SET
            note = CASE
              WHEN word_notes.note = '' THEN excluded.note
              WHEN instr(word_notes.note, excluded.note) > 0 THEN word_notes.note
              ELSE word_notes.note || char(10) || excluded.note
            END,
            updated_at = CURRENT_TIMESTAMP
        `,[c,u.note]),u.seenCount>0&&u.memoryScore<=6&&(n.run(`
          INSERT INTO moji_migrated_reviews (word_id, imported_on, priority, activated_on)
          VALUES (?, ?, ?, NULL)
          ON CONFLICT(word_id) DO UPDATE SET
            imported_on = excluded.imported_on,
            priority = MAX(priority, excluded.priority),
            activated_on = NULL
        `,[c,o,Nv(u)]),a+=1)}),R("external_word_list_last_import",JSON.stringify({importedOn:o,inserted:s,updated:i,queuedForReview:a})),n.run("COMMIT")}catch(u){throw n.run("ROLLBACK"),u}return Ci(),gg(),Cn(),Go(),Promise.resolve().then(()=>N(tt(),1)).then(({requestFullSnapshot:u})=>u()),D(),(0,by.notifyProgressUpdated)(),{...t,inserted:s,updated:i,queuedForReview:a}}});var mE=le((Vj,Ky)=>{var fo="kalimba",yd=null,jy=new Map,Nd=16e3,$y=Math.PI*2;function Py(e){fo=["kalimba","marimba","epiano"].includes(e)?e:"kalimba"}function Jv(e){return fo==="marimba"?Math.sin(e):fo==="epiano"?Math.sin(e)*.78+Math.sin(e*2)*.22:2/Math.PI*Math.asin(Math.sin(e))}function ie(e,t,r,n,o=!1){return{freq:e,start:t,duration:r,gain:n,sine:o}}function Hy(e,t,r,n){let o=(e%12+12)%12/12,s=Array.from({length:9},(a,d)=>{let u=32.703*2**(d+o),l=Math.log2(u/523.25);return{freq:u,weight:Math.exp(-l*l/(2*.85**2))}}),i=s.reduce((a,d)=>a+d.weight,0);return s.map(a=>ie(a.freq,t,r*Math.min(2.2,Math.max(.3,(523.25/a.freq)**.8)),n*a.weight/i))}function qv(e){if(e.startsWith("know-")){let t=Number(e.slice(5));return[...Hy(t,0,.16,.23),...Hy(t+4,.09,.22,.23)]}return e==="wrong"?[ie(440,0,.18,.12),ie(349.23,.1,.26,.11)]:e==="flip"?[ie(880,0,.06,.06)]:e==="complete"?[ie(523.25,0,.2,.23),ie(659.25,.12,.2,.23),ie(783.99,.24,.32,.25)]:e==="countdown"?[ie(880,0,.1,.105),ie(1046.5,.045,.13,.09)]:e==="relief"?[ie(783.99,0,.09,.13),ie(1046.5,.055,.14,.11)]:e==="save"?[ie(1046.5,0,.07,.16,!0),ie(880,.06,.07,.14,!0),ie(783.99,.12,.1,.12,!0)]:e==="chirp"?[ie(880,0,.05,.1,!0),ie(1046.5,.05,.05,.1,!0),ie(880,.1,.05,.1,!0),ie(1046.5,.15,.08,.1,!0)]:e==="ignite"?[ie(392,0,.14,.16),ie(523.25,.07,.16,.18),ie(783.99,.14,.32,.2)]:e==="gold"?[ie(659.25,0,.1,.12),ie(783.99,.06,.12,.13),ie(1046.5,.12,.38,.15)]:[]}function Qv(e){let t=Math.max(...e.map(i=>i.start+i.duration),0)+.04,r=Math.ceil(t*Nd),n=new ArrayBuffer(44+r*2),o=new DataView(n),s=(i,a)=>{for(let d=0;d<4;d++)o.setUint8(i+d,a.charCodeAt(d))};s(0,"RIFF"),o.setUint32(4,36+r*2,!0),s(8,"WAVE"),s(12,"fmt "),o.setUint32(16,16,!0),o.setUint16(20,1,!0),o.setUint16(22,1,!0),o.setUint32(24,Nd,!0),o.setUint32(28,Nd*2,!0),o.setUint16(32,2,!0),o.setUint16(34,16,!0),s(36,"data"),o.setUint32(40,r*2,!0);for(let i=0;i<r;i++){let a=i/Nd,d=0;for(let u of e){let l=a-u.start;if(l<0||l>=u.duration)continue;let c=Math.min(1,l/.012),f=Math.exp(-5.5*l/u.duration);d+=(u.sine?Math.sin($y*u.freq*l):Jv($y*u.freq*l))*c*f*u.gain}o.setInt16(44+i*2,Math.max(-1,Math.min(1,d))*32767,!0)}return n}function At(e){if(!(typeof wx>"u"||!wx.createInnerAudioContext||!wx.getFileSystemManager||!wx.env?.USER_DATA_PATH))try{let t=`${fo}-${e}`,r=jy.get(t);r||(r=`${wx.env.USER_DATA_PATH}/shushugo-sfx-v1-${t}.wav`,wx.getFileSystemManager().writeFileSync(r,Qv(qv(e))),jy.set(t,r)),yd||(yd=wx.createInnerAudioContext()),yd.stop(),yd.src=r,yd.play()}catch(t){console.warn("[sounds] \u97F3\u6548\u4E0D\u53EF\u7528",t)}}Ky.exports={setSoundTimbre:Py,playKnow:(e=0)=>At(`know-${(e%12+12)%12}`),playDontKnow:()=>At("wrong"),playFlip:()=>At("flip"),playComplete:()=>At("complete"),playCountdownTick:()=>At("countdown"),playReliefDeal:()=>At("relief"),playSave:()=>At("save"),playStreakChirp:()=>At("chirp"),playStreakIgnite:()=>At("ignite"),playStreakGold:()=>At("gold"),soundAvailable:()=>typeof wx<"u"&&!!(wx.createInnerAudioContext&&wx.getFileSystemManager&&wx.env?.USER_DATA_PATH),previewTimbre(e){let t=fo;Py(e),At("know-0"),fo=t}}});var By=le((Jj,Gy)=>{Gy.exports={setMascotSkin(){},setWalkStyle(){}}});var ED={};x(ED,{achievements:()=>UE,analytics:()=>Tm,confusionCards:()=>Sa,confusionGroups:()=>Yu,dailyPlan:()=>Rp,database:()=>fD,dbUtils:()=>eu,distinctionQuiz:()=>Pp,duplicateMerge:()=>Vp,examDates:()=>qd,favorites:()=>Cm,fsrsScheduler:()=>bl,fsrsStore:()=>xl,furigana:()=>Gu,furiganaSplit:()=>zp,grammarApi:()=>$u,grammarFormation:()=>Yl,grammarKeyPoints:()=>Xp,grammarQuiz:()=>sc,jlptPlan:()=>Xd,jlptStatus:()=>sp,kanaProgress:()=>za,kanjiCharCards:()=>pa,kanjiReadingUsage:()=>gc,kanjiUnitIndex:()=>uc,kanjiUnitScheduler:()=>Ua,levelPlan:()=>fp,mixedCards:()=>Kc,mixedSession:()=>Bp,orthography:()=>Bu,pitchAccent:()=>Jm,planContent:()=>wp,preferences:()=>lu,progressApi:()=>Gm,questionMeaningIndex:()=>_l,reviewBudget:()=>Fl,sounds:()=>gD,streak:()=>cE,studyCore:()=>Fu,studyFocus:()=>kE,studyLoad:()=>Lp,studyMode:()=>op,studyTotals:()=>FE,syncMerge:()=>dE,syncSchema:()=>ku,syncSnapshot:()=>nE,syncTables:()=>yu,tokenDictionary:()=>zm,userQuestionMeanings:()=>nl,vocabTest:()=>Wp,weekly:()=>DE,weeklyReports:()=>ME,wordApi:()=>Hm,wordCard:()=>ll,wordDistinctions:()=>Zm,wordLibrary:()=>Ap,wordStudyUtils:()=>kp,yuzu:()=>yE,yuzuCatalog:()=>fE});module.exports=PN(ED);var fD=N($());var Gm={};x(Gm,{getProgressOverview:()=>p0,seenWordCount:()=>m0});$e();G();yr();ln();ne();Qt();Te();var pn=`(p.known_forever = 1 OR EXISTS (SELECT 1 FROM reviews r WHERE r.word_id = p.word_id AND r.direction = 'forward')
  OR (p.seen_count > 0 AND NOT EXISTS (SELECT 1 FROM level_prior_baselines b WHERE b.entity='words' AND b.entity_key=CAST(p.word_id AS TEXT))))`,Km=`(p.known_forever = 1 OR EXISTS (SELECT 1 FROM grammar_reviews r WHERE r.grammar_id = p.grammar_id)
  OR (p.seen_count > 0 AND NOT EXISTS (SELECT 1 FROM level_prior_baselines b WHERE b.entity='grammar' AND b.entity_key=CAST(p.grammar_id AS TEXT))))`,m0=()=>H(`SELECT COUNT(*) AS n FROM progress p WHERE ${pn}`)?.n??0;function p0(){Z("\u542F\u52A8 \xB7 \u5355\u8BCD\u8FDB\u5EA6\u521D\u59CB\u5316",Y),Ce();let e=A().toISOString(),t=H(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN ${pn} THEN 1 ELSE 0 END) AS seen,
      SUM(CASE WHEN ${pn} AND (p.known_forever = 1 OR ${Ee}) THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN p.known_forever = 0 AND p.seen_count > 0 AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?) AND ${te("words","p.word_id")} THEN 1 ELSE 0 END) AS low,
      SUM(CASE WHEN NOT ${pn} THEN 1 ELSE 0 END) AS unseen
    FROM words w
    JOIN progress p ON p.word_id = w.id
    WHERE ${oe()}
  `,[e]),r=p(`
    SELECT
      COALESCE(w.jlpt_level, '\u672A\u5206\u7EA7') AS level,
      COUNT(*) AS total,
      SUM(CASE WHEN ${pn} THEN 1 ELSE 0 END) AS seen,
      SUM(CASE WHEN ${pn} AND (p.known_forever = 1 OR ${Ee}) THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN p.known_forever = 0 AND p.seen_count > 0 AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?) AND ${te("words","p.word_id")} THEN 1 ELSE 0 END) AS low,
      SUM(CASE WHEN NOT ${pn} THEN 1 ELSE 0 END) AS unseen
    FROM words w
    JOIN progress p ON p.word_id = w.id
    WHERE w.jlpt_level IN ('N5', 'N4', 'N3', 'N2', 'N1') AND ${oe()}
    GROUP BY w.jlpt_level
    ORDER BY CASE w.jlpt_level WHEN 'N5' THEN 1 WHEN 'N4' THEN 2 WHEN 'N3' THEN 3 WHEN 'N2' THEN 4 WHEN 'N1' THEN 5 ELSE 9 END
  `,[e]).map(o=>({level:String(o.level??""),total:Number(o.total??0),seen:Number(o.seen??0),completed:Number(o.completed??0),low:Number(o.low??0),unseen:Number(o.unseen??0)})),n=p(`
    SELECT
      g.level,
      COUNT(*) AS total,
      SUM(CASE WHEN ${Km} THEN 1 ELSE 0 END) AS seen,
      SUM(CASE WHEN ${Km} AND (p.known_forever = 1 OR ${Ee}) THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN p.known_forever = 0 AND p.seen_count > 0 AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?) AND ${te("grammar","p.grammar_id")} THEN 1 ELSE 0 END) AS low,
      SUM(CASE WHEN NOT ${Km} THEN 1 ELSE 0 END) AS unseen
    FROM grammar_points g
    JOIN grammar_progress p ON p.grammar_id = g.id
    GROUP BY g.level
    ORDER BY CASE g.level WHEN 'N5' THEN 1 WHEN 'N4' THEN 2 WHEN 'N3' THEN 3 WHEN 'N2' THEN 4 WHEN 'N1' THEN 5 ELSE 9 END
  `,[e]).map(o=>({level:String(o.level??""),total:Number(o.total??0),seen:Number(o.seen??0),completed:Number(o.completed??0),low:Number(o.low??0),unseen:Number(o.unseen??0)}));return{words:{total:Number(t?.total??0),seen:Number(t?.seen??0),completed:Number(t?.completed??0),low:Number(t?.low??0),unseen:Number(t?.unseen??0)},wordsByLevel:r,grammar:n}}var zm={};x(zm,{lookupTokenEntries:()=>N0});G();var UT=N(Or(),1),Bm=UT.default,so=e=>e.replace(/[ァ-ヶ]/gu,t=>String.fromCodePoint((t.codePointAt(0)??0)-96)),Xm=new Set;Object.entries(Bm).forEach(([,e])=>{let t=e?.[1],r=e?.[2];if(!t||!r)return;let n=Bm[t];if(!n?.[2])return;let o=so(n[2]),s=so(r);Xm.add(`${o}${s}`),Xm.add(`${s}${o}`)});var FT={\u3046:"\u3048",\u304F:"\u3051",\u3050:"\u3052",\u3059:"\u305B",\u3064:"\u3066",\u306C:"\u306D",\u3076:"\u3079",\u3080:"\u3081",\u308B:"\u308C"};var Ir=e=>String(e??"").replace(/[\s]/gu,""),WT=e=>{let t=[...e];return t[t.length-1]??""},E0=e=>[...e].slice(0,-1).join(""),jT=(e,t)=>`${E0(e)}${t}`;var f0=(e,t)=>{let r=WT(e);return t[r]?jT(e,t[r]):null};var $T=e=>{let t=Ir(e),r=[];if(t.endsWith("\u3089\u308C\u308B")&&t.length>3&&r.push(`${t.slice(0,-3)}\u308B`),t.endsWith("\u308B")&&t.length>1){let n=t.slice(0,-1),o=WT(n),s=Object.entries(FT).find(([,i])=>i===o)?.[0];s&&r.push(jT(n,s))}return r.filter((n,o)=>n&&r.indexOf(n)===o)},g0=(e,t)=>{let r=so(Ir(e));if(!r)return[];let n="";if(t==="godan"){let i=f0(r,FT);n=i?`${i}\u308B`:""}else t==="ichidan"&&r.endsWith("\u308B")?n=`${r.slice(0,-1)}\u3089\u308C\u308B`:t==="suru"||r==="\u3059\u308B"?n="\u3067\u304D\u308B":(t==="kuru"||r==="\u304F\u308B")&&(n="\u3053\u3089\u308C\u308B");if(!n)return[];let o=n.endsWith("\u308B")?n.slice(0,-1):n;return[o,...["","\u307E\u3059","\u307E\u305B\u3093","\u307E\u3057\u305F","\u307E\u305B\u3093\u3067\u3057\u305F","\u306A\u3044","\u306A\u304B\u3063\u305F","\u306A\u3051\u308C\u3070","\u306A\u304F\u3066","\u3066","\u305F","\u305F\u3089","\u3066\u3044\u308B","\u3066\u3044\u307E\u3059","\u3066\u3044\u305F","\u3066\u3044\u307E\u3057\u305F","\u3066\u3044\u306A\u3044","\u3066\u3044\u307E\u305B\u3093","\u3066\u3057\u307E\u3046","\u3066\u3057\u307E\u3044\u307E\u3059","\u3066\u3057\u307E\u3063\u305F","\u3066\u3057\u307E\u3044\u307E\u3057\u305F"].map(i=>`${o}${i}`),n]},PT=(e,t,r)=>{let n=so(Ir(e));return!!n&&g0(t,r).some(o=>n===o||n.startsWith(o)&&[...n.slice(o.length)].length<=6)},HT=(e,t,r="",n="")=>{let o=Ir(e),s=Ir(t);if(!o||!s||o===s)return!1;let i=(u,l)=>{let c=Bm[u];return Array.isArray(c)?c.slice(1,3).some(f=>Ir(f)===l):!1};if(i(o,s)||i(s,o))return!0;if(!r||!n)return!1;let a=so(Ir(r)),d=so(Ir(n));return Xm.has(`${a}${d}`)};var Ym=e=>/^[ぁ-ゖァ-ヺー]+$/u.test(e)&&e.length>=2,_0=e=>/[\p{Script=Han}]/u.test(e),w0=e=>e.replace(/[ァ-ヶ]/gu,t=>String.fromCodePoint((t.codePointAt(0)??0)-96)),T0=e=>[...e].find(t=>/[\p{Script=Han}]/u.test(t))??"",S0=e=>/动词|動詞/u.test(String(e??"")),y0=(e,t)=>({id:String(e.lookup_source??"jlpt")==="supplement"?String(e.id??""):Number(e.id??0),studyWordId:e.study_word_id==null?null:Number(e.study_word_id),source:String(e.lookup_source??"jlpt")==="supplement"?"supplement":"jlpt",kanji:String(e.kanji??""),kana:String(e.kana??""),meaning:String(e.meaning??""),pos:String(e.pos??""),verbType:String(e.verb_type??""),jlptLevel:String(e.jlpt_level??""),exampleJp:String(e.example_jp??""),exampleMeaning:String(e.example_meaning??""),category:String(e.category??""),usageNote:String(e.usage_note??""),sourceName:String(e.source_name??""),matchedForm:t}),N0=(e,t="",r=4,n="",o=[])=>{let s=e.trim(),i=n.trim()||s;if(!i)return[];let a=Ym(s);try{let d=(m,g=!1)=>p(`
      SELECT * FROM (
        SELECT
          CAST(id AS TEXT) AS id,
          id AS study_word_id,
          kanji,
          kana,
          meaning,
          pos,
          verb_type,
          jlpt_level,
          example_jp,
          example_meaning,
          importance AS lookup_priority,
          'jlpt' AS lookup_source,
          '' AS category,
          '' AS usage_note,
          '' AS source_name
        FROM words
        WHERE kanji = ? OR (? = 1 AND kana = ?)

        UNION ALL

        SELECT
          entry_key AS id,
          NULL AS study_word_id,
          headword AS kanji,
          kana,
          meaning,
          pos,
          verb_type,
          '' AS jlpt_level,
          example_jp,
          example_meaning,
          priority AS lookup_priority,
          'supplement' AS lookup_source,
          category,
          usage_note,
          source_name
        FROM dictionary_entries
        WHERE headword = ? OR (? = 1 AND kana = ?)
      ) AS dictionary_matches
      ORDER BY
        CASE
          WHEN kanji = ? THEN 0
          ELSE 1
        END,
        CASE WHEN lookup_source = 'jlpt' THEN 0 ELSE 1 END,
        lookup_priority DESC,
        id ASC
      LIMIT ?
    `,[m,g?1:0,m,m,g?1:0,m,m,r]),u=m=>m.map(g=>y0(g,String(g.kanji||g.kana||i))),l=n.trim()&&s!==i&&_0(s)?[s,i]:[i];for(let m of l){let g=d(m,Ym(m)||!n.trim()&&a);if(g.length)return u(g)}let c=[t,...o.map(m=>m.reading??"")];for(let m of l)for(let g of $T(m)){let w=d(g,Ym(g)).filter(y=>!S0(y.pos)||HT(m,g,t,String(y.kana??""))?!1:c.some(_=>PT(_,String(y.kana??""),String(y.verb_type??""))));if(w.length)return u(w)}let f=[...o.slice(0,1).map(m=>m.reading??""),t].map(m=>w0(m.trim())).filter(Boolean);for(let m of f){let g=d(m,!0),S=T0(s),w=g.filter(y=>a||S&&String(y.kanji??"").startsWith(S));if(w.length)return u(w)}if(/^[おご]/u.test(i)&&i.length>1){let m=d(i.slice(1),!0);if(m.length)return u(m)}return[]}catch{return[]}};var Jm={};x(Jm,{loadPitchAccent:()=>YT,lookupAccent:()=>R0,pitchAccentLoaded:()=>zT,pitchPattern:()=>O0,splitMorae:()=>L0,usePitchAccentReady:()=>A0});var ja=N(Vm(),1),Ls=null,XT=null,YT=()=>Ls?Promise.resolve():(XT??(XT=Promise.resolve().then(()=>N(BT(),1)).then(e=>{Ls=e.default.accents})),XT),zT=()=>Ls!==null;function R0(e,t){if(!Ls)return null;let r=Ls[`${e||t}|${t}`];return r===void 0?null:Array.isArray(r)?r[0]??null:r}var b0=/[ぁぃぅぇぉゃゅょゎァィゥェォャュョヮヵヶ]/;function L0(e){let t=[];for(let r of e)t.length&&b0.test(r)?t[t.length-1]+=r:t.push(r);return t}function O0(e,t){return Array.from({length:e},(r,n)=>{let o=n+1;return{high:t===1?o===1:o>1&&(t===0||o<=t),drop:t!==0&&o===t}})}function A0(){let[e,t]=(0,ja.useState)(zT());return(0,ja.useEffect)(()=>{if(e)return;let r=!0;return YT().then(()=>{r&&t(!0)}),()=>{r=!1}},[e]),e}Xr();G();P();ln();St();var Zm={};x(Zm,{wordDistinctions:()=>h0});rr();Bo();var $a=N(Ea(),1),Pa=N(Si(),1);fa();var VT=N(Or(),1),qm=e=>({id:e.id,word:Se({kanji:e.kanji,kana:e.kana}),kana:e.kana,meaning:e.meaning,exampleJp:e.example?.jp??"",exampleMeaning:e.example?.meaning??"",jlptLevel:e.jlptLevel,note:"",isCurrent:!0,voice:null,subgroup:""}),Qm=e=>({id:Number(e.id??0),word:Se(e),kana:e.kana,meaning:e.meaning,exampleJp:"",exampleMeaning:"",jlptLevel:"",note:e.note&&e.note!==e.meaning?e.note:"",isCurrent:!1,voice:null,subgroup:""});function h0(e){let t=[],r=new Set,n=new Set,o=l=>{let c=new Set,f=l.members.filter(S=>{let w=`${S.word}|${S.kana}`;return c.has(w)?!1:(c.add(w),!0)}),m=new Set(f.filter(S=>S.isCurrent).map(S=>`${S.word}|${S.kana}`)),g=f.filter(S=>{if(S.isCurrent)return!0;let w=`${S.word}|${S.kana}`;return!m.has(w)&&(S.id<=0||!r.has(S.id))&&!n.has(w)});g.some(S=>!S.isCurrent)&&(t.push({...l,members:g}),g.forEach(S=>{S.isCurrent||(S.id>0&&r.add(S.id),n.add(`${S.word}|${S.kana}`))}))},s=e.similarMeaning;if(s&&s.source==="manual"){let l=s.items.filter(c=>c.manual!==!1);o({key:`manual:${s.title}`,name:"\u91CA\u4E49\u8FA8\u6790",Icon:Pa.NotebookPen,summary:s.distinction,level:"major",members:[qm(e),...l.map(c=>Qm({...c,note:""}))],masterable:!1})}let i=VT.default;Ar(e.id).forEach(l=>{let c=Ko[l.type],f=(0,$a.distinctionReviewFor)(l.key),m=f?.level==="major"?(0,$a.distinctionNotesFor)(f.summary,l.members.map(g=>({key:String(g.id),forms:[Se(g),g.kanji,g.kana]}))):new Map;o({key:l.key,name:c.name,Icon:c.Icon,summary:f?.summary??"",level:f?.level??null,members:Zn(l.key,l.members,g=>[Se(g),g.kanji,g.kana],g=>eo((i[g.kanji]??i[g.kana])?.[0])).map(({member:g,voice:S,subgroup:w})=>({id:g.id,word:Se(g),kana:g.kana,meaning:g.meaning,exampleJp:g.exampleJp,exampleMeaning:g.exampleMeaning,jlptLevel:g.jlptLevel,note:m.get(String(g.id))??"",isCurrent:g.id===e.id,voice:S,subgroup:w})),masterable:!0})});let a=e.confusions.filter(l=>l.kind==="sound"&&!r.has(l.id)),d=a.filter(l=>Qu(e,l));d.length&&o({key:`derived:${e.id}`,name:Ko.stem.name,Icon:Ko.stem.Icon,summary:"",level:null,members:[qm(e),...d.map(Qm)],masterable:!1});let u=a.filter(l=>!Qu(e,l));return u.length&&o({key:`sound:${e.id}`,name:"\u97F3\u5F62\u76F8\u8FD1",Icon:Pa.Eye,summary:"",level:null,members:[qm(e),...u.map(Qm)],masterable:!1}),t}hr();In();var op={};x(op,{STUDY_MODES:()=>As,STUDY_MODE_EVENT:()=>JT,VISIBLE_STUDY_MODES:()=>k0,activateMistakesForToday:()=>D0,defaultStudyMode:()=>tp,getStudyMode:()=>v0,saveStudyMode:()=>C0,studyModeInfo:()=>QT});P();var Ke=N(Si(),1),Ha="mn-active-study-mode",Os="mn-auto-mistakes-mode",As=[{id:"classic",title:"\u7ECF\u5178\u6A21\u5F0F",short:"\u7ECF\u5178",label:"Classic",subtitle:"\u4ECA\u65E5\u8BA1\u5212",description:"\u5F53\u65E5\u5230\u671F\u96C6\uFF0C\u91CA\u4E49 \u2192 \u65E5\u8BED\u3002",Icon:Ke.CalendarCheck},{id:"mixed",title:"\u6DF7\u5408\u5B66\u4E60",short:"\u6DF7\u5408",label:"Mixed",subtitle:"\u5355\u8BCD \xB7 \u8BED\u6CD5 \xB7 \u6C49\u5B57 \xB7 \u8FA8\u6790",description:"\u80CC\u8BCD\u65F6\u63D2\u64AD\u8BED\u6CD5\u3001\u5355\u72EC\u6C49\u5B57\u548C\u8FA8\u6790\u8FDE\u7EBF\uFF0C\u6BCF\u65E5\u91CF\u5706\u73AF\u4E0A\u7684\u56DB\u6BB5\u5168\u51FA\u3002",Icon:Ke.Shuffle},{id:"mistakes",title:"\u5B66\u4E60\u9519\u9898\u672C",short:"\u9519\u9898\u672C",label:"Mistakes",subtitle:"\u957F\u671F\u8584\u5F31\u8BCD",description:"\u53EA\u5237\u957F\u671F\u8584\u5F31\u8BCD\uFF0C\u4E0D\u5360\u4ECA\u65E5\u8BA1\u5212\u3002",Icon:Ke.Brain},{id:"quick",title:"\u5FEB\u901F\u590D\u4E60",short:"\u5FEB\u901F",label:"Quick",subtitle:"\u4E00\u9875 50 \u5F20",description:"\u4ECA\u65E5\u8BA1\u5212\u4E00\u9875\u94FA 50 \u5F20\u7FFB\u7740\u770B\u3002",Icon:Ke.NotebookPen,page:"quick-study"},{id:"reverse",title:"\u53CD\u5411\u5B66\u4E60",short:"\u53CD\u5411",label:"Reverse",subtitle:"\u65E5\u8BED \u2192 \u91CA\u4E49",description:"\u51FA\u65E5\u8BED\uFF0C\u56DE\u5FC6\u91CA\u4E49\u3002\u81EA\u5DF1\u4E00\u5957\u5230\u671F\u96C6\u3002",Icon:Ke.Repeat},{id:"kanji",title:"\u6C49\u5B57\u8BFB\u97F3",short:"\u6C49\u5B57",label:"Kanji",subtitle:"\u770B\u8868\u8BB0 \u2192 \u56DE\u5FC6\u8BFB\u97F3",description:"\u53EA\u906E\u6C49\u5B57\u7684\u8BFB\u97F3\uFF0C\u70B9\u5361\u63ED\u6653\u3002",Icon:Ke.Languages},{id:"picked",title:"\u81EA\u9009\u6E05\u5355",short:"\u81EA\u9009",label:"Picked",subtitle:"\u4F60\u5728\u8BCD\u5E93\u91CC\u52FE\u7684\u8BCD",description:"\u53EA\u51FA\u52FE\u4E2D\u7684\u8BCD\uFF0C\u4E0D\u770B\u5230\u671F\u3002",Icon:Ke.Target,hidden:!0,transient:!0}],JT="mn:study-mode",k0=As.filter(e=>!e.hidden),qT=new Set(As.map(e=>e.id)),tp="classic",QT=e=>As.find(t=>t.id===e)??As[0],rp=e=>typeof e=="string"&&qT.has(e)?e:tp,np=()=>{let e=localStorage.getItem(Os);if(!e)return null;try{let t=JSON.parse(e);return typeof t.studyDate!="string"?null:{studyDate:t.studyDate,returnMode:rp(t.returnMode),dismissed:t.dismissed===!0}}catch{return null}},ep=()=>{let e=localStorage.getItem(Ha);return e&&qT.has(e)?e:tp};function v0(e=new Date){let t=np();return t?.studyDate===B(e)?t.dismissed?ep():"mistakes":(t&&(t.dismissed||localStorage.setItem(Ha,t.returnMode),localStorage.removeItem(Os)),ep())}function C0(e,t=new Date){let r=rp(e);QT(r).transient||localStorage.setItem(Ha,r);let n=np();return n?.studyDate===B(t)?localStorage.setItem(Os,JSON.stringify({...n,dismissed:!0})):n&&localStorage.removeItem(Os),typeof window<"u"&&window.dispatchEvent(new Event(JT)),r}function D0(e,t=new Date){let r=rp(e);if(r==="mistakes")return r;let n=np();return n?.studyDate===B(t)?n.dismissed?ep():"mistakes":(localStorage.setItem(Ha,r),localStorage.setItem(Os,JSON.stringify({studyDate:B(t),returnMode:r})),"mistakes")}ne();Pe();var Rp={};x(Rp,{PLAN_KINDS:()=>En,PLAN_LABELS:()=>Cs,SECONDS_PER_CARD:()=>Tp,STUDY_INTENSITY:()=>LS,applyExamPreset:()=>mh,applyStudyIntensity:()=>ph,arrangedPlan:()=>uh,dailyPlanView:()=>yp,examPreset:()=>bS,hasPendingPlanTotal:()=>oh,learnedLevel:()=>ch,previewCurrentLevelPlan:()=>NS,remainingPlanWords:()=>Sp,saveDailyPlan:()=>Np,segmentLength:()=>lh});$e();pe();var sp={};x(sp,{getJlptPlanStatus:()=>Ka});$e();G();rn();yr();pe();Tt();Te();Tn();_t();var I0=e=>`(w.jlpt_level IN (${wr(e).map(r=>`'${r}'`).join(", ")}) OR w.jlpt_level IS NULL OR w.jlpt_level = '')`,M0=e=>`g.level IN (${wr(e).map(r=>`'${r}'`).join(", ")})`,x0=(e=new Date)=>{let t=A(e);return t.setDate(t.getDate()-1),t};function Ka(e=new Date){Y(),Ce();let t=uu(),r=t.target,n=t.examDate?ht(t.examDate):null,o=ht(t.startedOn),s=n??Ro(t.examKind,o??e),i=T(e),a=A(e).toISOString(),d=x0(e).toISOString(),u=I0(r),l=M0(r),c=`word_id IN (SELECT w.id FROM words w WHERE ${u})`,f=`grammar_id IN (SELECT g.id FROM grammar_points g WHERE ${l})`,m=E(`SELECT COUNT(*) FROM words w LEFT JOIN progress p ON p.word_id = w.id WHERE ${u} AND ${oe()}`,[],0),g=E(`
    SELECT COUNT(*) FROM words w
    JOIN progress p ON p.word_id = w.id
    WHERE ${u} AND ${Ne()}
  `,[],0),S=E(`
    SELECT COUNT(*) FROM words w JOIN progress p ON p.word_id = w.id
    WHERE ${u} AND (p.known_forever = 1 OR EXISTS (SELECT 1 FROM reviews r WHERE r.word_id = p.word_id))
  `,[],0),w=E(`
    SELECT COUNT(*) FROM words w
    JOIN progress p ON p.word_id = w.id
    WHERE ${u} AND ${ee()} AND p.known_forever = 0
      AND (p.fsrs_due IS NULL OR (p.fsrs_due <= ? AND p.fsrs_due >= ?))
      AND NOT ${Gr("words","p.word_id",i)}
  `,[a,d],0)+Uo("words",new Date(a),i).filter(C=>E(`SELECT 1 FROM words w WHERE w.id = ? AND ${u}`,[C],0)).length+xo("words",i,c),y=E(`
    SELECT COUNT(*) FROM words w
    JOIN progress p ON p.word_id = w.id
    WHERE ${u} AND ${ee()} AND p.known_forever = 0
      AND p.fsrs_due IS NOT NULL AND p.fsrs_due < ?
      AND NOT ${ce("words","p.word_id")}
  `,[d],0),_=E(`SELECT COUNT(*) FROM grammar_points g WHERE ${l}`,[],0),b=E(`
    SELECT COUNT(*) FROM grammar_points g
    JOIN grammar_progress p ON p.grammar_id = g.id
    WHERE ${l} AND p.seen_count = 0 AND p.known_forever = 0
  `,[],0),k=E(`
    SELECT COUNT(*) FROM grammar_points g JOIN grammar_progress p ON p.grammar_id = g.id
    WHERE ${l} AND (p.known_forever = 1 OR EXISTS (SELECT 1 FROM grammar_reviews r WHERE r.grammar_id = p.grammar_id))
  `,[],0),v=E(`
    SELECT COUNT(*) FROM grammar_points g
    JOIN grammar_progress p ON p.grammar_id = g.id
    WHERE ${l} AND p.seen_count > 0 AND p.known_forever = 0
      AND (p.fsrs_due IS NULL OR (p.fsrs_due <= ? AND p.fsrs_due >= ?))
      AND NOT ${Gr("grammar","p.grammar_id",i)}
  `,[a,d],0)+Uo("grammar",new Date(a),i,f).length+xo("grammar",i,f),L=E(`
    SELECT COUNT(*) FROM grammar_points g
    JOIN grammar_progress p ON p.grammar_id = g.id
    WHERE ${l} AND p.seen_count > 0 AND p.known_forever = 0
      AND p.fsrs_due IS NOT NULL AND p.fsrs_due < ?
      AND NOT ${ce("grammar","p.grammar_id")}
  `,[d],0),I=E(`
    SELECT COUNT(DISTINCT r.word_id)
    FROM reviews r
    JOIN words w ON w.id = r.word_id
    WHERE r.reviewed_on = ? AND ${u}
      AND NOT EXISTS (
        SELECT 1 FROM reviews earlier
        WHERE earlier.word_id = r.word_id AND earlier.reviewed_on < ?
      )
      AND NOT ${we("words","r.word_id")}
  `,[i,i],0),M=E(`
    SELECT COUNT(DISTINCT r.word_id)
    FROM reviews r
    JOIN words w ON w.id = r.word_id
    WHERE r.reviewed_on = ? AND ${u}
  `,[i],0),U=E(`
    SELECT COUNT(DISTINCT r.grammar_id)
    FROM grammar_reviews r
    JOIN grammar_points g ON g.id = r.grammar_id
    WHERE r.reviewed_on = ? AND ${l}
      AND NOT EXISTS (
        SELECT 1 FROM grammar_reviews earlier
        WHERE earlier.grammar_id = r.grammar_id AND earlier.reviewed_on < ?
      )
      AND NOT ${we("grammar","r.grammar_id")}
  `,[i,i],0),W=E(`
    SELECT COUNT(DISTINCT r.grammar_id)
    FROM grammar_reviews r
    JOIN grammar_points g ON g.id = r.grammar_id
    WHERE r.reviewed_on = ? AND ${l}
  `,[i],0),K=Gd({today:e,examDate:s,planStartedOn:o,unseenWords:g,unseenGrammar:b,freshDueWords:w,overdueWords:y,freshDueGrammar:v,overdueGrammar:L}),J={newWordsDone:I,reviewWordsDone:Math.max(M-I,0),newGrammarDone:U,reviewGrammarDone:Math.max(W-U,0)};return{enabled:t.enabled,target:r,examKind:t.examKind,finished:e>=qs(t.examKind,s),examDate:s,examDateSource:n?"manual":"auto",plan:K,done:J,shortfall:Bd(K,J),coverage:{words:{seen:S,total:m},grammar:{seen:k,total:_}}}}_t();G();Qn();sn();Mt();ne();Te();ss();Ts();Ia();Ja();var lS={words:12,grammar:25,kanji:10,confusion:40},rh=[3,2,1.5,1.5,.5,.5,.5,.5],nh=e=>e<=30?"light":e<=60?"steady":e<=90?"heavy":"aggressive";function cS(e){let t=Math.max(1,Math.min(12,e.weeks??8)),r=Math.ceil(Math.max(0,e.intakeDaysLeft??t*7)/7),n=Array.from({length:t},(i,a)=>{let d=0,u=0;for(let l of Object.keys(lS)){let c=Number(e.existingDuePerWeek?.[a]?.[l]??0)/7;for(let f=0;f<=a&&f<r;f+=1){let m=a-f;c+=e.dailyNew[l]*(rh[m]??.5)}u+=c,d+=c*lS[l]}return{week:a+1,minutes:Math.round(d/60),answers:Math.round(u)}}),o=n.reduce((i,a)=>a.minutes>i.minutes?a:i,n[0]),s=n[Math.min(3,n.length-1)].minutes;return{perWeek:n,peakWeek:o.week,steadyMinutes:s,tier:nh(s)}}var wp={};x(wp,{CONTENT_BY_LEVEL:()=>gp,CONTENT_MATRIX:()=>gS,OPTIONAL_WORDS_BY_LEVEL:()=>pS,VISIBLE_STARTS:()=>ES,expectedContent:()=>_S,previewLevelPlan:()=>_p});_t();pe();var gp={N5:{words:920,grammar:127,kanji:448,confusion:8},N4:{words:862,grammar:136,kanji:362,confusion:33},N3:{words:2069,grammar:146,kanji:408,confusion:58},N2:{words:3354,grammar:155,kanji:390,confusion:91},N1:{words:4074,grammar:205,kanji:362,confusion:154}},pS={N5:0,N4:0,N3:27,N2:261,N1:142},ES=["kana-none","kana",...F],vs=["words","grammar","kanji","confusion"],fS=()=>({words:0,grammar:0,kanji:0,confusion:0}),gS=Object.fromEntries(ES.map(e=>[e,Object.fromEntries(F.map(t=>{let r=F.indexOf(e),n=F.indexOf(t),o=fS();for(let s=r+1;s<=n;s+=1)for(let i of vs)o[i]+=gp[F[s]][i];return[t,o]}))])),_S=(e,t,r,n=X().includeOptionalExpressions)=>{if(e==="beyond")return fS();let o={...gS[e][t]};if(n){let s=Math.max(0,F.indexOf(e)+(r?.words===0?0:1));o.words+=F.slice(s,F.indexOf(t)+1).reduce((i,a)=>i+pS[a],0)}if(F.includes(e)&&F.indexOf(e)<=F.indexOf(t))for(let s of vs)r?.[s]===0&&(o[s]+=gp[e][s]);return o},mS={words:50,grammar:12,kanji:50,confusion:20},_p=e=>{let t=e.today??new Date,r=Vt(t,e.examDate),n=Vt(e.startedOn??t,e.examDate),o=Js(n),s=e.startingLevel==="kana-none"&&!e.kanaCompleted?7:0,i=Math.max(0,r-o-s),a={..._S(e.startingLevel,e.target,e.familiarity,e.includeOptionalExpressions)};Number.isFinite(e.remainingWords)&&(a.words=Math.max(0,Math.floor(e.remainingWords)));let d=Object.fromEntries(vs.map(c=>[c,Math.ceil(a[c]/Math.max(1,i))])),u=Object.fromEntries(vs.map(c=>[c,Math.min(d[c],mS[c])])),l=r>0&&i>0&&vs.every(c=>d[c]<=mS[c]);return{content:a,required:d,daily:u,daysLeft:r,intakeDays:i,reviewDays:o,kanaDays:s,feasible:l}};Tn();hs();rn();var En=["words","grammar","kanji","confusion"],oh=(e,t)=>e!==null&&Number(e)!==t,Cs={words:"\u5355\u8BCD",grammar:"\u8BED\u6CD5",kanji:"\u6C49\u5B57",confusion:"\u8FA8\u6790"},Tp={words:12,grammar:25,kanji:10,confusion:40},sh={N5:0,N4:1,N3:2,N2:3,N1:4},ao=(e,t)=>e<=0?0:Math.ceil(e/Math.max(1,t)),TS=()=>Wn(A()),SS=e=>{let t=wr(e).map(r=>`'${r}'`).join(", ");return{due:os(bt).due,unseen:E(`
      SELECT COUNT(*) FROM grammar_progress p JOIN grammar_points g ON g.id = p.grammar_id
      WHERE g.level IN (${t}) AND p.known_forever = 0 AND p.seen_count = 0
    `,[],0)}},ih=(e,t)=>{if(e===yn)return t;let r=sr(e);return Math.min(t,r)},yS=()=>no().total+oo().total,wS=(e,t)=>e===rt?0:e>0?Math.min(e,t):t,Sp=(e,t,r,n)=>{if(e==="beyond")return 0;let o=F.indexOf(e),s=F.indexOf(t),i=o<0?0:o+(r?.words===0?0:1),a=F.slice(i,s+1);if(!a.length)return 0;Y();let d=a.map(l=>`'${l}'`).join(", ");return E(`
    SELECT COUNT(*) FROM words w
    LEFT JOIN progress p ON p.word_id = w.id
    WHERE (w.jlpt_level IN (${d})${i===0?" OR w.jlpt_level IS NULL OR w.jlpt_level = ''":""})
      AND ${Ne("w","p",n)}
  `,[],0)},NS=e=>_p({...e,remainingWords:Sp(e.startingLevel,e.target,e.familiarity,e.includeOptionalExpressions)}),yp=(e=ot())=>{let t=Ka(),r=e.jlptTarget,n=sh[r]??2,o=t.plan.intakeDaysLeft,s=yS(),i=TS()+s,a=SS(r),d=ma(n),u=Ta(n),l={words:De(de).length,grammar:os(bt).prior,kanji:bc(),confusion:Cc()},c=[{kind:"words",label:Cs.words,fresh:Qs()?0:e.dailyGoal,review:ih(e.reviewCap,i-s-l.words)+s+l.words,pool:{due:i,unseen:Sp("kana",r,void 0,e.includeOptionalExpressions)},suggest:{fresh:t.plan.newWords,review:i}},{kind:"grammar",label:Cs.grammar,fresh:e.grammarDailyGoal,review:os(bt,e.grammarReviewCap).review,pool:a,suggest:{fresh:t.plan.newGrammar,review:a.due}},{kind:"kanji",label:Cs.kanji,fresh:e.kanjiDailyGoal,review:wS(e.kanjiReviewCap,d.due-l.kanji)+l.kanji,pool:d,suggest:{fresh:o>0?ao(d.unseen,o):0,review:d.due}},{kind:"confusion",label:Cs.confusion,fresh:e.confusionDailyGoal,review:wS(e.confusionReviewCap,u.due-l.confusion)+l.confusion,pool:u,suggest:{fresh:o>0?ao(u.unseen,o):0,review:u.due}}],f=c.reduce((g,S)=>g+S.fresh+S.review,0),m=Math.round(c.reduce((g,S)=>g+(S.fresh+S.review)*Tp[S.kind],0)/60);return{total:f,segments:c,daysLeft:t.plan.daysLeft,minutes:m,wordExtras:s,priorExtras:l}},RS="mn-daily-plan-baseline",ah=e=>({words:e.dailyGoal,grammar:e.grammarDailyGoal,kanji:e.kanjiDailyGoal,confusion:e.confusionDailyGoal}),dh=()=>{try{let e=JSON.parse(localStorage.getItem(RS)??"null");if(e&&En.every(t=>Number.isFinite(e[t])))return e}catch{}return ah(ae)},uh=e=>{let t=dh();return Object.fromEntries(e.segments.map(r=>[r.kind,{fresh:t[r.kind],review:r.pool.due}]))},Np=(e,t=!1,r=yp())=>{let n=X();if(t)try{localStorage.setItem(RS,JSON.stringify(Object.fromEntries(En.map(i=>[i,e[i].fresh]))))}catch{}let o=i=>r.segments.find(a=>a.kind===i)?.review??0,s=(i,a)=>{let d=e[i];if(d.fresh+d.review===0)return rt;if(d.review===o(i))return a;let u=d.review-(r.priorExtras?.[i]??0);return u>0?u:rt};nt({...n,dailyGoal:e.words.fresh,reviewCap:e.words.review===o("words")?n.reviewCap:Math.max(1,e.words.review-r.wordExtras-(r.priorExtras?.words??0)),grammarDailyGoal:e.grammar.fresh,grammarReviewCap:s("grammar",n.grammarReviewCap),kanjiDailyGoal:e.kanji.fresh,kanjiReviewCap:s("kanji",n.kanjiReviewCap),confusionDailyGoal:e.confusion.fresh,confusionReviewCap:s("confusion",n.confusionReviewCap)})},lh=e=>Math.log1p(Math.max(0,e)),ch=()=>{if(Mr())return Ep();let e=p(`
    SELECT w.jlpt_level AS level, SUM(${ee()} OR p.known_forever = 1) AS seen, COUNT(*) AS total
    FROM progress p JOIN words w ON w.id = p.word_id WHERE ${oe()} GROUP BY w.jlpt_level
  `),t=new Map(e.map(n=>[String(n.level),Number(n.seen)/Math.max(1,Number(n.total))])),r=null;for(let n of F){if((t.get(n)??0)<.5)break;r=n}return r},bS=e=>{let t=Ka(),r=Mr(),n=r?NS({startingLevel:r.startingLevel,familiarity:r.familiarity,target:e,examDate:t.examDate,startedOn:ht(r.startedOn)??void 0,kanaCompleted:r.startingLevel==="kana-none"&&fr()}):null,o=n?.intakeDays??t.plan.intakeDaysLeft,s=F.indexOf(e),i=F.slice(0,s+1).map(b=>`'${b}'`).join(", "),a=n?.content.words??E(`
    SELECT COUNT(*) FROM progress p JOIN words w ON w.id = p.word_id
    WHERE w.jlpt_level IN (${i}) AND ${Ne()}
  `,[],0),d=n?.content.grammar??E(`
    SELECT COUNT(*) FROM grammar_progress p JOIN grammar_points g ON g.id = p.grammar_id
    WHERE g.level IN (${i}) AND p.seen_count = 0 AND p.known_forever = 0
  `,[],0),u=n?.content.kanji??E("SELECT COUNT(*) FROM kanji_char_memory WHERE known_forever = 0 AND seen_count = 0 AND level_rank <= ?",[s],0),l=n?.content.confusion??E("SELECT COUNT(*) FROM confusion_progress WHERE known_forever = 0 AND seen_count = 0 AND level_rank <= ? AND group_key NOT IN (SELECT group_key FROM confusion_mastered)",[s],0),c=Ta(s),f={words:{fresh:n?.daily.words??Math.min(50,ao(a,o)),review:TS()+yS()},grammar:{fresh:n?.daily.grammar??Math.min(12,ao(d,o)),review:SS(e).due},kanji:{fresh:n?.daily.kanji??Math.min(50,ao(u,o)),review:ma(s).due},confusion:{fresh:n?.daily.confusion??Math.min(20,ao(l,o)),review:c.due}},m=Math.round(En.reduce((b,k)=>b+(f[k].fresh+f[k].review)*Tp[k],0)/60),g={words:"progress",grammar:"grammar_progress",kanji:"kanji_char_memory",confusion:"confusion_progress"},S=Array.from({length:56},(b,k)=>{let v=A();return v.setDate(v.getDate()+k),v}),w=Object.fromEntries(En.map(b=>[b,_i(b,S)])),y=Array.from({length:8},(b,k)=>{let v=new Date;v.setHours(0,0,0,0),v.setDate(v.getDate()+k*7);let L=new Date(v);return L.setDate(L.getDate()+7),Object.fromEntries(Object.keys(g).map(I=>[I,E(`SELECT COUNT(*) FROM ${g[I]} WHERE known_forever = 0 AND fsrs_due >= ? AND fsrs_due < ?
        AND NOT ${ce(I,`${g[I]}.${Pu[I].idColumn}`)}`,[v.toISOString(),L.toISOString()],0)+w[I].slice(k*7,(k+1)*7).reduce((M,U)=>M+U,0)]))}),_=cS({dailyNew:Object.fromEntries(En.map(b=>[b,f[b].fresh])),existingDuePerWeek:y,intakeDaysLeft:o,weeks:8});return{plan:f,minutes:m,load:_,daysLeft:t.plan.daysLeft,intakeDays:o,remaining:{words:a,grammar:d,kanji:u,confusion:l},expected:n}},mh=e=>{let t=bS(e),r=X();return nt({...r,jlptTarget:e}),Np(t.plan,!0),t},LS={light:{label:"\u8F7B\u677E",words:10,grammar:2,kanji:3,confusion:2},normal:{label:"\u6807\u51C6",words:15,grammar:5,kanji:5,confusion:5},hard:{label:"\u52A0\u628A\u52B2",words:30,grammar:8,kanji:10,confusion:8}},ph=e=>{let t=yp(),r=o=>t.segments.find(s=>s.kind===o)?.review??0,n=Object.fromEntries(En.map(o=>[o,{fresh:LS[e][o],review:r(o)}]));return Np(n,!0,t),{plan:n}};var Lp={};x(Lp,{dailyStudyLoad:()=>Sh});$e();G();pe();ne();Te();Tt();var Eh=14,fh=7,bp=(e,t)=>{let r=new Date(`${e}T12:00:00`);return r.setDate(r.getDate()+t),B(r)},uo=de,gh=(e,t)=>{let r=new Map,n=(o,s,i)=>{if(!o)return;let a=r.get(o)??{cards:0,fresh:0};a[s]+=i,r.set(o,a)};return p(`
    SELECT reviewed_on, COUNT(DISTINCT word_id) AS cards
    FROM reviews
    WHERE direction = 'forward' AND reviewed_on BETWEEN ? AND ?
    GROUP BY reviewed_on
  `,[e,t]).forEach(o=>n(String(o.reviewed_on??""),"cards",Number(o.cards??0))),p(`
    SELECT reviewed_on, COUNT(*) AS fresh
    FROM (
      SELECT word_id, MIN(reviewed_on) AS reviewed_on
      FROM reviews
      WHERE direction = 'forward' AND NOT ${we("words","reviews.word_id")}
      GROUP BY word_id
    )
    WHERE reviewed_on BETWEEN ? AND ?
    GROUP BY reviewed_on
  `,[e,t]).forEach(o=>n(String(o.reviewed_on??""),"fresh",Number(o.fresh??0))),r},_h=(e,t)=>{let r=new Array(e).fill(0);if(e<=0)return r;let n=[],o=A(t);for(let u=0;u<=e;u+=1){let l=new Date(o);l.setDate(l.getDate()+u),n.push(l.getTime())}let s=new Date(n[0]).toISOString(),i=new Date(n[e]).toISOString();j(uo),p(`
    SELECT fsrs_due FROM ${uo.table}
    WHERE ${uo.eligible} AND fsrs_due >= ? AND fsrs_due < ?
      AND NOT ${ce("words","progress.word_id")}
  `,[s,i]).forEach(u=>{let l=new Date(String(u.fsrs_due??"")).getTime();if(!Number.isFinite(l))return;let c=0;for(;c<e-1&&l>=n[c+1];)c+=1;r[c]+=1});let a=Array.from({length:e+1},(u,l)=>{let c=A(t);return c.setDate(c.getDate()+l),c}),d=_i("words",a);return r.forEach((u,l)=>{r[l]+=d[l+1]}),r},wh=e=>{let t=A(e).toISOString();return j(uo),Number(p(`
    SELECT COUNT(*) AS n FROM ${uo.table}
    WHERE ${uo.eligible} AND (fsrs_due IS NULL OR fsrs_due <= ?)
      AND ${te("words","progress.word_id",A(e),T(e))}
  `,[t])[0]?.n??0)},Th=()=>Number(p(`
  SELECT COUNT(*) AS n FROM progress p JOIN words w ON w.id = p.word_id WHERE ${Ne()}
`)[0]?.n??0),Sh=(e={})=>{let t=e.now??new Date,r=Math.max(e.pastDays??Eh,1),n=Math.max(e.futureDays??fh,0),o=T(t),s=bp(o,-(r-1)),i=gh(s,o),a=[];for(let w=r-1;w>=0;w-=1){let y=bp(o,-w),_=i.get(y)??{cards:0,fresh:0};a.push({date:y,fresh:_.fresh,review:Math.max(_.cards-_.fresh,0),pending:0,forecast:!1,today:w===0})}let d=Math.max(Jt(),0),u=Th(),l=a[a.length-1];if(l?.today){let w=Math.min(Math.max(d-l.fresh,0),u);l.pending=wh(t)+w,u-=w}let c=_h(n,t);for(let w=0;w<n;w+=1){let y=Math.min(d,u);u-=y,a.push({date:bp(o,w+1),fresh:y,review:c[w]??0,pending:0,forecast:!0,today:!1})}let f=w=>w.fresh+w.review+w.pending,m=a.filter(w=>!w.forecast&&!w.today),g=a.filter(w=>w.forecast),S=w=>w.length?Math.round(w.reduce((y,_)=>y+f(_),0)/w.length):0;return{bars:a,pastAverage:S(m),forecastAverage:S(g)}};var Ap={};x(Ap,{DEFAULT_LIBRARY_FILTERS:()=>bh,MEMORY_BANDS:()=>Ds,POS_BUCKETS:()=>Nh,bandMeta:()=>yh,classifyPos:()=>Is,queryWordLibrary:()=>hh,resetWordLibraryCaches:()=>Op,romajiToKana:()=>AS,tallyWordLibrary:()=>vh,wordLibraryDetail:()=>Ch,wordLibraryIds:()=>Dh});ne();Te();G();ln();var Ds=[{id:"mastered",label:"\u5DF2\u638C\u63E1",hint:"\u95F4\u9694\u5DF2\u7ECF\u62C9\u5230\u534A\u5E74\u4EE5\u4E0A\uFF0C\u6216\u4F60\u624B\u52A8\u6807\u4E86\u719F\u77E5"},{id:"d5",label:"3 \u4E2A\u6708+",hint:"\u8BB0\u5F97\u5F88\u7262\uFF0C\u4E09\u4E2A\u6708\u540E\u624D\u9700\u8981\u518D\u770B\u4E00\u773C"},{id:"d4",label:"1\u20133 \u4E2A\u6708",hint:"\u7A33\u56FA\uFF0C\u957F\u95F4\u9694\u590D\u4E60\u4E2D"},{id:"d3",label:"1\u20133 \u5468",hint:"\u6B63\u5728\u53D8\u719F"},{id:"d2",label:"3\u20137 \u5929",hint:"\u8FD8\u4E0D\u7262\uFF0C\u9694\u51E0\u5929\u5C31\u4F1A\u5FD8"},{id:"d1",label:"1\u20133 \u5929",hint:"\u751F\u758F\uFF0C\u6491\u4E0D\u8FC7\u51E0\u5929"},{id:"d0",label:"\u4E0D\u5230 1 \u5929",hint:"\u57FA\u672C\u6CA1\u8BB0\u4F4F\uFF0C\u660E\u5929\u5C31\u4F1A\u5FD8"},{id:"unseen",label:"\u672A\u5B66",hint:"\u8FD8\u6CA1\u5B66\u8FC7\u8FD9\u4E2A\u8BCD"}],yh=e=>Ds.find(t=>t.id===e)??Ds[Ds.length-1],Nh=[{id:"noun",label:"\u540D\u8BCD"},{id:"suru",label:"\u3059\u308B\u52A8\u8BCD"},{id:"verb",label:"\u52A8\u8BCD"},{id:"adj",label:"\u5F62\u5BB9\u8BCD"},{id:"adv",label:"\u526F\u8BCD"},{id:"pron",label:"\u4EE3\u8BCD\xB7\u8FDE\u4F53"},{id:"affix",label:"\u63A5\u8F9E\xB7\u52A9\u8BCD"},{id:"other",label:"\u611F\u53F9\xB7\u60EF\u7528\xB7\u5176\u4ED6"}],Is=e=>{let t=(e??"").trim();return t?/サ变|サ変|する/.test(t)?"suru":/形容词|形容詞|形动|形動|^形$/.test(t)?"adj":/动词|動詞|他动|自动|他動|自動/.test(t)?"verb":/^名|^代名/.test(t)?"noun":/副词|副詞/.test(t)?"adv":/^代|連体|连体/.test(t)?"pron":/接尾|接頭|接头|^接|造|助$|助词|格助|終助|接助|助动/.test(t)?"affix":"other":"other"},Qa=null,Rh=()=>{if(Qa)return Qa;let e=new Map;return p("SELECT DISTINCT pos FROM words").forEach(t=>{let r=String(t.pos??""),n=Is(r),o=e.get(n)??[];o.push(r),e.set(n,o)}),Qa=e,e},Op=()=>{Qa=null},bh={level:"all",band:"all",pos:"all",search:"",sort:"level"},OS={a:"\u3042",i:"\u3044",u:"\u3046",e:"\u3048",o:"\u304A",ka:"\u304B",ki:"\u304D",ku:"\u304F",ke:"\u3051",ko:"\u3053",ga:"\u304C",gi:"\u304E",gu:"\u3050",ge:"\u3052",go:"\u3054",sa:"\u3055",si:"\u3057",shi:"\u3057",su:"\u3059",se:"\u305B",so:"\u305D",za:"\u3056",zi:"\u3058",ji:"\u3058",zu:"\u305A",ze:"\u305C",zo:"\u305E",ta:"\u305F",ti:"\u3061",chi:"\u3061",tu:"\u3064",tsu:"\u3064",te:"\u3066",to:"\u3068",da:"\u3060",di:"\u3062",du:"\u3065",de:"\u3067",do:"\u3069",na:"\u306A",ni:"\u306B",nu:"\u306C",ne:"\u306D",no:"\u306E",ha:"\u306F",hi:"\u3072",hu:"\u3075",fu:"\u3075",he:"\u3078",ho:"\u307B",ba:"\u3070",bi:"\u3073",bu:"\u3076",be:"\u3079",bo:"\u307C",pa:"\u3071",pi:"\u3074",pu:"\u3077",pe:"\u307A",po:"\u307D",ma:"\u307E",mi:"\u307F",mu:"\u3080",me:"\u3081",mo:"\u3082",ya:"\u3084",yu:"\u3086",yo:"\u3088",ra:"\u3089",ri:"\u308A",ru:"\u308B",re:"\u308C",ro:"\u308D",wa:"\u308F",wi:"\u3046\u3043",we:"\u3046\u3047",wo:"\u3092",kya:"\u304D\u3083",kyu:"\u304D\u3085",kyo:"\u304D\u3087",gya:"\u304E\u3083",gyu:"\u304E\u3085",gyo:"\u304E\u3087",sya:"\u3057\u3083",syu:"\u3057\u3085",syo:"\u3057\u3087",sha:"\u3057\u3083",shu:"\u3057\u3085",sho:"\u3057\u3087",zya:"\u3058\u3083",zyu:"\u3058\u3085",zyo:"\u3058\u3087",jya:"\u3058\u3083",jyu:"\u3058\u3085",jyo:"\u3058\u3087",ja:"\u3058\u3083",ju:"\u3058\u3085",jo:"\u3058\u3087",je:"\u3058\u3047",tya:"\u3061\u3083",tyu:"\u3061\u3085",tyo:"\u3061\u3087",cya:"\u3061\u3083",cyu:"\u3061\u3085",cyo:"\u3061\u3087",cha:"\u3061\u3083",chu:"\u3061\u3085",cho:"\u3061\u3087",che:"\u3061\u3047",dya:"\u3062\u3083",dyu:"\u3062\u3085",dyo:"\u3062\u3087",nya:"\u306B\u3083",nyu:"\u306B\u3085",nyo:"\u306B\u3087",hya:"\u3072\u3083",hyu:"\u3072\u3085",hyo:"\u3072\u3087",bya:"\u3073\u3083",byu:"\u3073\u3085",byo:"\u3073\u3087",pya:"\u3074\u3083",pyu:"\u3074\u3085",pyo:"\u3074\u3087",mya:"\u307F\u3083",myu:"\u307F\u3085",myo:"\u307F\u3087",rya:"\u308A\u3083",ryu:"\u308A\u3085",ryo:"\u308A\u3087",fa:"\u3075\u3041",fi:"\u3075\u3043",fe:"\u3075\u3047",fo:"\u3075\u3049",fya:"\u3075\u3083",fyu:"\u3075\u3085",fyo:"\u3075\u3087",va:"\u3094\u3041",vi:"\u3094\u3043",vu:"\u3094",ve:"\u3094\u3047",vo:"\u3094\u3049",tsa:"\u3064\u3041",tsi:"\u3064\u3043",tse:"\u3064\u3047",tso:"\u3064\u3049",she:"\u3057\u3047",thi:"\u3066\u3043",thu:"\u3066\u3085",dhi:"\u3067\u3043",dhu:"\u3067\u3085",twa:"\u3068\u3041",twi:"\u3068\u3043",twu:"\u3068\u3045",twe:"\u3068\u3047",two:"\u3068\u3049",dwa:"\u3069\u3041",dwi:"\u3069\u3043",dwu:"\u3069\u3045",dwe:"\u3069\u3047",dwo:"\u3069\u3049",kwa:"\u304F\u3041",kwi:"\u304F\u3043",kwe:"\u304F\u3047",kwo:"\u304F\u3049",gwa:"\u3050\u3041",gwi:"\u3050\u3043",gwe:"\u3050\u3047",gwo:"\u3050\u3049",wha:"\u3046\u3041",whi:"\u3046\u3043",whe:"\u3046\u3047",who:"\u3046\u3049",ye:"\u3044\u3047",ca:"\u304B",ci:"\u3057",cu:"\u304F",ce:"\u305B",co:"\u3053",xa:"\u3041",xi:"\u3043",xu:"\u3045",xe:"\u3047",xo:"\u3049",la:"\u3041",li:"\u3043",lu:"\u3045",le:"\u3047",lo:"\u3049",xya:"\u3083",xyu:"\u3085",xyo:"\u3087",lya:"\u3083",lyu:"\u3085",lyo:"\u3087",xtu:"\u3063",xtsu:"\u3063",ltu:"\u3063",ltsu:"\u3063",xwa:"\u308E",lwa:"\u308E"},Lh=Object.keys(OS).sort((e,t)=>t.length-e.length),AS=e=>{let t=e.normalize("NFKC").toLowerCase().replace(/\s+/g,""),r="";for(let n=0;n<t.length;){let o=t.slice(n);if(o.startsWith("n'")){r+="\u3093",n+=2;continue}if(o.startsWith("nn")){r+="\u3093",n+=n+2<t.length&&/[aiueoy]/.test(t[n+2])?1:2;continue}let s=t[n],i=t[n+1];if(s==="n"&&(!i||!/[aiueoyn]/.test(i))){r+="\u3093",n+=1;continue}if(s==="t"&&o.startsWith("tch")||s===i&&/[bcdfghjklmpqrstvwxyz]/.test(s)){r+="\u3063",n+=1;continue}if(s==="-"){r+="\u30FC",n+=1;continue}let a=Lh.find(d=>o.startsWith(d));a?(r+=OS[a],n+=a.length):(r+=s,n+=1)}return r},Oh=e=>e.replace(/[ぁ-ゖ]/g,t=>String.fromCharCode(t.charCodeAt(0)+96)),Za=`
  CASE
    WHEN p.known_forever = 1 OR ${Ee} THEN 'mastered'
    WHEN p.seen_count = 0 THEN 'unseen'
    WHEN p.fsrs_stability IS NULL THEN 'd0'
    WHEN p.fsrs_stability < 1 THEN 'd0'
    WHEN p.fsrs_stability < 3 THEN 'd1'
    WHEN p.fsrs_stability < 7 THEN 'd2'
    WHEN p.fsrs_stability < 21 THEN 'd3'
    WHEN p.fsrs_stability < 90 THEN 'd4'
    ELSE 'd5'
  END
`,ed=()=>`
  (p.known_forever = 0 AND p.seen_count > 0 AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?) AND ${te("words","p.word_id")})
`,Ah="CASE w.jlpt_level WHEN 'N5' THEN 1 WHEN 'N4' THEN 2 WHEN 'N3' THEN 3 WHEN 'N2' THEN 4 WHEN 'N1' THEN 5 ELSE 9 END",hS=e=>{let t=[],r=[];if(e.level==="unranked"?t.push("(w.jlpt_level IS NULL OR w.jlpt_level NOT IN ('N5','N4','N3','N2','N1'))"):e.level!=="all"&&(t.push("w.jlpt_level = ?"),r.push(e.level)),e.pos!=="all"){let o=Rh().get(e.pos)??[];o.length===0?t.push("1 = 0"):(t.push(`w.pos IN (${o.map(()=>"?").join(",")})`),o.forEach(s=>r.push(s)))}let n=e.search.trim();if(n){let o=`%${n}%`,s=/^[A-Za-z'\s-]+$/.test(n)?AS(n):"";s&&!/[a-z]/i.test(s)?(t.push("(w.kanji LIKE ? OR w.kana LIKE ? OR w.meaning LIKE ? OR w.kana LIKE ? OR w.kana LIKE ?)"),r.push(o,o,o,`%${s}%`,`%${Oh(s)}%`)):(t.push("(w.kanji LIKE ? OR w.kana LIKE ? OR w.meaning LIKE ?)"),r.push(o,o,o))}return{sql:t.length?`WHERE ${t.join(" AND ")}`:"",params:r}},kS=(e,t)=>{let r=hS(e);if(e.band==="all")return r;let n="",o=[];return e.band==="due"?(n=ed(),o.push(t)):e.band==="leech"?n=Yi.replace(/fsrs_lapses/g,"p.fsrs_lapses"):(n=`${Za} = ?`,o.push(e.band)),{sql:r.sql?`${r.sql} AND ${n}`:`WHERE ${n}`,params:[...r.params,...o]}},vS={level:`${Ah} ASC, w.importance DESC, w.id ASC`,weakest:`CASE WHEN p.seen_count = 0 AND p.known_forever = 0 THEN 1 ELSE 0 END ASC,
            COALESCE(p.fsrs_stability, 999999) ASC, w.importance DESC, w.id ASC`,recent:"CASE WHEN p.fsrs_last_review IS NULL THEN 1 ELSE 0 END ASC, p.fsrs_last_review DESC, w.id ASC",kana:"w.kana ASC, w.id ASC"},CS=e=>{let t=String(e.pos??"");return{id:Number(e.id??0),kanji:String(e.kanji??""),kana:String(e.kana??""),meaning:String(e.meaning??""),pos:t,posBucket:Is(t),level:String(e.jlpt_level??"")||"\u672A\u5206\u7EA7",band:String(e.band??"unseen"),stability:e.fsrs_stability===null||e.fsrs_stability===void 0?null:Number(e.fsrs_stability),dueAt:e.fsrs_due?String(e.fsrs_due):null,lastReview:e.fsrs_last_review?String(e.fsrs_last_review):null,lapses:Number(e.fsrs_lapses??0),reps:Number(e.fsrs_reps??0),isDue:Number(e.is_due??0)===1,isLeech:Number(e.fsrs_lapses??0)>=8,isKnownForever:Number(e.known_forever??0)===1}},td=()=>{Y(),j()};function hh(e,t,r){td();let n=A().toISOString(),o=kS(e,n);return p(`
    SELECT
      w.id, w.kanji, w.kana, w.meaning, w.pos, w.jlpt_level,
      p.known_forever,
      p.fsrs_stability, p.fsrs_due, p.fsrs_last_review, p.fsrs_lapses, p.fsrs_reps,
      ${Za} AS band,
      CASE WHEN ${ed()} THEN 1 ELSE 0 END AS is_due
    FROM words w
    JOIN progress p ON p.word_id = w.id
    ${o.sql}
    ORDER BY ${vS[e.sort]}
    LIMIT ? OFFSET ?
  `,[n,...o.params,r,t]).map(CS)}var kh=()=>Ds.reduce((e,t)=>({...e,[t.id]:0}),{});function vh(e){td();let t=A().toISOString(),r=hS(e),n=kh(),o=0,s=0,i=0;return p(`
    SELECT
      ${Za} AS band,
      COUNT(*) AS n,
      SUM(CASE WHEN ${ed()} THEN 1 ELSE 0 END) AS due_n,
      SUM(CASE WHEN ${Yi.replace(/fsrs_lapses/g,"p.fsrs_lapses")} THEN 1 ELSE 0 END) AS leech_n
    FROM words w
    JOIN progress p ON p.word_id = w.id
    ${r.sql}
    GROUP BY band
  `,[t,...r.params]).forEach(a=>{let d=String(a.band??"unseen"),u=Number(a.n??0);d in n&&(n[d]=u),o+=u,s+=Number(a.due_n??0),i+=Number(a.leech_n??0)}),{total:o,bands:n,due:s,leech:i}}function Ch(e){td();let t=A().toISOString(),r=p(`
    SELECT
      w.id, w.kanji, w.kana, w.meaning, w.pos, w.jlpt_level, w.example_jp, w.example_meaning,
      p.known_forever,
      p.fsrs_stability, p.fsrs_due, p.fsrs_last_review, p.fsrs_lapses, p.fsrs_reps,
      ${Za} AS band,
      CASE WHEN ${ed()} THEN 1 ELSE 0 END AS is_due,
      COALESCE(n.note, '') AS note,
      CASE WHEN f.item_id IS NULL THEN 0 ELSE 1 END AS favorite
    FROM words w
    JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    LEFT JOIN content_favorites f ON f.item_type = 'word' AND f.item_id = CAST(w.id AS TEXT)
    WHERE w.id = ?
    LIMIT 1
  `,[t,e])[0];return r?{...CS(r),example:{jp:String(r.example_jp??""),meaning:String(r.example_meaning??"")},note:String(r.note??""),isFavorite:Number(r.favorite??0)===1}:null}function Dh(e,t=500){td();let r=A().toISOString(),n=kS(e,r);return p(`
    SELECT w.id
    FROM words w
    JOIN progress p ON p.word_id = w.id
    ${n.sql}
    ORDER BY ${vS[e.sort]}
    LIMIT ?
  `,[...n.params,t]).map(o=>Number(o.id??0))}rr();var Pp={};x(Pp,{buildQuestions:()=>Ak,playableGroupKeys:()=>Ok,quizGroups:()=>Lk,settleGroup:()=>hk});rr();var Fs=N(Ea(),1),VS=N(Or(),1);sn();fa();var jp=N(Fi(),1);P();var Wp={};x(Wp,{CONFIDENCE_BONUS:()=>xp,GUESS_FLOOR_CAP:()=>vp,PENALTY:()=>nd,VOCAB_TEST_LEVELS:()=>be,VOCAB_TEST_PROBE_PER_LEVEL:()=>Dp,VOCAB_TEST_QUESTION_COUNT:()=>sd,VOCAB_TEST_SECONDS:()=>Cp,buildVocabTestQuestions:()=>Up,calibrateLevelsV3:()=>XS,clearVocabTestSession:()=>gk,extendVocabTestPlan:()=>GS,finishVocabTest:()=>fk,getVocabTestHistory:()=>Sk,getVocabTestResult:()=>YS,getVocabTestSession:()=>Fp,guessRate:()=>Ip,kanjiCoreReading:()=>PS,recordVocabTestRun:()=>wk,secondsForQuestion:()=>$S,shuffle:()=>Bt,startVocabTest:()=>pk,submitVocabTestAnswer:()=>Ek,vocabTestStorageValue:()=>yk});var WS=N(aa(),1);G();var jS=N($(),1);rr();hr();var Mp=N(Fi(),1);Xr();var kp={};x(kp,{answerHotkeyLabels:()=>Mh,answerOptions:()=>Ih,answerReadingText:()=>jh,cardLabel:()=>Wh,concealedReadingParts:()=>$h,formatDuration:()=>Gh,isLoanwordSourceCard:()=>Fh,kanaToRomaji:()=>Hh,levelOptions:()=>xh,monthDays:()=>Bh,moraCount:()=>lo,primaryAnswerText:()=>hp,secondaryAnswerText:()=>IS,typeOptions:()=>Uh});Xr();var Ih=[{value:"forgot",label:"\u5FD8\u8BB0"},{value:"fuzzy",label:"\u6A21\u7CCA",secondary:!0},{value:"know",label:"\u8BA4\u8BC6"},{value:"known_forever",label:"\u719F\u77E5",secondary:!0}],Mh={forgot:"V",fuzzy:"B",know:"N",known_forever:"M"},xh=[{value:"All",label:"\u5168\u90E8"},{value:"N5",label:"N5"},{value:"N4",label:"N4"},{value:"N3",label:"N3"},{value:"N2",label:"N2"},{value:"N1",label:"N1"},{value:"Unleveled",label:"\u672A\u5206\u7EA7"}],Uh=[{value:"all",label:"\u5168\u90E8\u7C7B\u578B"},{value:"noun",label:"\u540D\u8BCD"},{value:"verb",label:"\u52A8\u8BCD"},{value:"adjective",label:"\u5F62\u5BB9\u8BCD"},{value:"adverb",label:"\u526F\u8BCD"},{value:"favorite",label:"\u6536\u85CF"}],Fh=e=>br(e),hp=e=>Lr(e),IS=e=>{if(br(e))return e.kanji;let t=Br(e);return t?.band==="kana"||t?.band==="low"?Wo(e.kanji):e.kana},Wh=e=>{let t=hp(e),r=IS(e);return t===r?t:`${t} / ${r}`},jh=(e,t=hp(e))=>!t||!/[\u3400-\u9fff]/u.test(t)?"":e.kana,$h=e=>e?.length?e.map(t=>t.isKanji?{text:"",hidden:!0}:{text:t.text,hidden:!1}):[{text:"",hidden:!0}],DS={\u3042:"a",\u3044:"i",\u3046:"u",\u3048:"e",\u304A:"o",\u304B:"ka",\u304D:"ki",\u304F:"ku",\u3051:"ke",\u3053:"ko",\u3055:"sa",\u3057:"shi",\u3059:"su",\u305B:"se",\u305D:"so",\u305F:"ta",\u3061:"chi",\u3064:"tsu",\u3066:"te",\u3068:"to",\u306A:"na",\u306B:"ni",\u306C:"nu",\u306D:"ne",\u306E:"no",\u306F:"ha",\u3072:"hi",\u3075:"fu",\u3078:"he",\u307B:"ho",\u307E:"ma",\u307F:"mi",\u3080:"mu",\u3081:"me",\u3082:"mo",\u3084:"ya",\u3086:"yu",\u3088:"yo",\u3089:"ra",\u308A:"ri",\u308B:"ru",\u308C:"re",\u308D:"ro",\u308F:"wa",\u3092:"wo",\u3093:"n",\u304C:"ga",\u304E:"gi",\u3050:"gu",\u3052:"ge",\u3054:"go",\u3056:"za",\u3058:"ji",\u305A:"zu",\u305C:"ze",\u305E:"zo",\u3060:"da",\u3062:"ji",\u3065:"zu",\u3067:"de",\u3069:"do",\u3070:"ba",\u3073:"bi",\u3076:"bu",\u3079:"be",\u307C:"bo",\u3071:"pa",\u3074:"pi",\u3077:"pu",\u307A:"pe",\u307D:"po",\u3041:"a",\u3043:"i",\u3045:"u",\u3047:"e",\u3049:"o",\u3083:"ya",\u3085:"yu",\u3087:"yo",\u30A1:"a",\u30A3:"i",\u30A5:"u",\u30A7:"e",\u30A9:"o",\u30E3:"ya",\u30E5:"yu",\u30E7:"yo",\u30A2:"a",\u30A4:"i",\u30A6:"u",\u30A8:"e",\u30AA:"o",\u30AB:"ka",\u30AD:"ki",\u30AF:"ku",\u30B1:"ke",\u30B3:"ko",\u30B5:"sa",\u30B7:"shi",\u30B9:"su",\u30BB:"se",\u30BD:"so",\u30BF:"ta",\u30C1:"chi",\u30C4:"tsu",\u30C6:"te",\u30C8:"to",\u30CA:"na",\u30CB:"ni",\u30CC:"nu",\u30CD:"ne",\u30CE:"no",\u30CF:"ha",\u30D2:"hi",\u30D5:"fu",\u30D8:"he",\u30DB:"ho",\u30DE:"ma",\u30DF:"mi",\u30E0:"mu",\u30E1:"me",\u30E2:"mo",\u30E4:"ya",\u30E6:"yu",\u30E8:"yo",\u30E9:"ra",\u30EA:"ri",\u30EB:"ru",\u30EC:"re",\u30ED:"ro",\u30EF:"wa",\u30F2:"wo",\u30F3:"n",\u30AC:"ga",\u30AE:"gi",\u30B0:"gu",\u30B2:"ge",\u30B4:"go",\u30B6:"za",\u30B8:"ji",\u30BA:"zu",\u30BC:"ze",\u30BE:"zo",\u30C0:"da",\u30C2:"ji",\u30C5:"zu",\u30C7:"de",\u30C9:"do",\u30D0:"ba",\u30D3:"bi",\u30D6:"bu",\u30D9:"be",\u30DC:"bo",\u30D1:"pa",\u30D4:"pi",\u30D7:"pu",\u30DA:"pe",\u30DD:"po"},Ph={kya:"kya",kiya:"kya",kyu:"kyu",kiyu:"kyu",kyo:"kyo",kiyo:"kyo",sha:"sha",shiya:"sha",shu:"shu",shiyu:"shu",sho:"sho",shiyo:"sho",cha:"cha",chiya:"cha",chu:"chu",chiyu:"chu",cho:"cho",chiyo:"cho",nya:"nya",niya:"nya",nyu:"nyu",niyu:"nyu",nyo:"nyo",niyo:"nyo",hya:"hya",hiya:"hya",hyu:"hyu",hiyu:"hyu",hyo:"hyo",hiyo:"hyo",mya:"mya",miya:"mya",myu:"myu",miyu:"myu",myo:"myo",miyo:"myo",rya:"rya",riya:"rya",ryu:"ryu",riyu:"ryu",ryo:"ryo",riyo:"ryo",gya:"gya",giya:"gya",gyu:"gyu",giyu:"gyu",gyo:"gyo",giyo:"gyo",ja:"ja",jiya:"ja",ju:"ju",jiyu:"ju",jo:"jo",jiyo:"jo",bya:"bya",biya:"bya",byu:"byu",biyu:"byu",byo:"byo",biyo:"byo",pya:"pya",piya:"pya",pyu:"pyu",piyu:"pyu",pyo:"pyo",piyo:"pyo"},Hh=e=>{let t=[],r=!1;for(let n=0;n<e.length;n+=1){let o=e[n];if(o==="\u3063"||o==="\u30C3"){r=!0;continue}if(o==="\u30FC"){t[t.length-1]=`${t[t.length-1]??""}-`;continue}let s=DS[o],i=DS[e[n+1]],a=s??o;i&&["\u3083","\u3085","\u3087","\u30E3","\u30E5","\u30E7"].includes(e[n+1])&&(a=Ph[`${a}${i}`]??a,n+=1),r&&/^[bcdfghjklmnpqrstvwxyz]/.test(a)&&(a=`${a[0]}${a}`),r=!1,t.push(a)}return t.join(" ")},Kh=/[ぁぃぅぇぉゃゅょゎァィゥェォャュョヮ]/,lo=e=>{let t=0;for(let r of e.replace(/[～〜（）()\s・]/g,""))Kh.test(r)||(t+=1);return t},Gh=e=>{let t=Math.max(0,Math.round(e)),r=Math.floor(t/60),n=t%60;if(r>=60){let o=Math.floor(r/60),s=r%60;return`${o}\u5C0F\u65F6${s.toString().padStart(2,"0")}\u5206`}return r>0?`${r}\u5206${n.toString().padStart(2,"0")}\u79D2`:`${n}\u79D2`},Bh=e=>{let t=e?new Date(`${e}T00:00:00`):new Date,r=t.getFullYear(),n=t.getMonth(),o=new Date(r,n,1),s=new Date(r,n+1,0).getDate(),i=Array.from({length:o.getDay()},()=>null),a=Array.from({length:s},(d,u)=>{let l=u+1;return{day:l,date:`${r}-${String(n+1).padStart(2,"0")}-${String(l).padStart(2,"0")}`}});return{title:`${r}\u5E74${n+1}\u6708`,cells:[...i,...a]}};$e();var od="vocab_test_session_v1",be=["N5","N4","N3","N2","N1"],sd=80,nd=1.15,vp=.3,xp=1.1,Cp={reading:15,meaning:10},$S=e=>Cp[e.kind]??Cp.reading,Gt=3,xr=e=>String(e??"").trim(),Ot=(e,t,r)=>Math.min(r,Math.max(t,e)),Bt=(e,t=Math.random)=>{let r=[...e];for(let n=r.length-1;n>0;n-=1){let o=Math.floor(Ot(t(),0,.999999999)*(n+1));[r[n],r[o]]=[r[o],r[n]]}return r},id="[\\u3040-\\u309F\\u30A0-\\u30FF\\u30FC]+",Xh=new RegExp(`^${id}`),Yh=new RegExp(`${id}$`),PS=(e,t)=>{let r=e.trim(),n=t.trim();if(!r||!n)return null;let o=r.match(Xh)?.[0]??"";if(o){if(!n.startsWith(o))return null;r=r.slice(o.length),n=n.slice(o.length)}let s=r.match(Yh)?.[0]??"";if(s){if(!n.endsWith(s))return null;r=r.slice(0,-s.length),n=n.slice(0,-s.length)}return!r||!n||new RegExp(id).test(r)||r===e.trim()?null:{core:r,reading:n}},zh=e=>{let t=jo(e),r=PS(t,e.kana),n=(r?.reading??e.kana).trim();return{...e,posBucket:Is(e.pos??""),morae:lo(n),loan:br({kanji:e.kanji,kana:e.kana}),readingSurface:t,core:r,readingValue:n}},HS=()=>p(`
  SELECT w.id, w.kanji, w.kana, w.meaning, w.pos, w.jlpt_level AS level
  FROM words w LEFT JOIN progress p ON p.word_id = w.id
  WHERE w.jlpt_level IN ('N5', 'N4', 'N3', 'N2', 'N1') AND ${oe()}
    AND TRIM(COALESCE(meaning, '')) <> ''
    AND TRIM(COALESCE(kana, '')) <> ''
`).map(e=>({id:Number(e.id??0),kanji:xr(e.kanji),kana:xr(e.kana),meaning:(0,Mp.reviewedQuestionMeaning)(xr(e.kanji),xr(e.kana))??xr(e.meaning),pos:xr(e.pos),level:xr(e.level)})).filter(e=>e.id>0&&be.includes(e.level)),Vh=new RegExp(id),Jh=2,qh=e=>{if(!$o(e))return!1;if(e.core){let t=lo(e.core.reading);return t>=Jh&&t*2>=lo(e.kana)}return!Vh.test(e.readingSurface)},rd=(e,t)=>t==="reading"?jo(e):Lr(e),Qh=e=>{let t=new Map,r=new Map,n=(o,s,i)=>{if(!s||!i)return;let a=o.get(s)??new Set;a.add(i),o.set(s,a)};return e.forEach(o=>{[Lr(o),o.readingSurface].forEach(s=>{n(t,s,o.kana.trim()),n(t,s,o.readingValue),n(r,s,o.meaning.trim())})}),{readings:t,meanings:r}},Zh=e=>{let t=WS.default.readings,r=new Map;for(let n of e)for(let o of Us(n.core?.core??n.readingSurface)){if(r.has(o))continue;let s=t[o];r.set(o,new Set([...s?.on??[],...(s?.kun??[]).map(i=>i.split(".")[0])].filter(Boolean)))}return r},ek=new Map(`
\u9B5A\u9C7C \u6C17\u6C14 \u7D4C\u7ECF \u6642\u65F6 \u9593\u95F4 \u95A2\u5173 \u898B\u89C1 \u805E\u95FB \u8AAD\u8BFB \u66F8\u4E66 \u8A71\u8BDD \u8A9E\u8BED
\u96FB\u7535 \u8ECA\u8F66 \u6771\u4E1C \u697D\u4E50 \u5F37\u5F3A \u5E83\u5E7F \u9577\u957F \u9580\u95E8 \u958B\u5F00 \u9589\u95ED \u554F\u95EE \u984C\u9898 \u982D\u5934 \u9854\u989C
\u98A8\u98CE \u96F2\u4E91 \u99AC\u9A6C \u9CE5\u9E1F \u9D8F\u9E21 \u7ADC\u9F99 \u8C9D\u8D1D \u8CB7\u4E70 \u58F2\u5356 \u8CB8\u8D37 \u8CA8\u8D27 \u8CBB\u8D39 \u8CC7\u8D44
\u7523\u4EA7 \u696D\u4E1A \u52D5\u52A8 \u8EE2\u8F6C \u904B\u8FD0 \u9032\u8FDB \u9060\u8FDC \u904E\u8FC7 \u9054\u8FBE \u9023\u8FDE \u8FBA\u8FB9 \u9078\u9009 \u9031\u5468
\u5E30\u5F52 \u5E2F\u5E26 \u6E80\u6EE1 \u6E08\u6D4E \u6F22\u6C49 \u6E6F\u6C64 \u7121\u65E0 \u71B1\u70ED \u713C\u70E7
\u7D19\u7EB8 \u7DDA\u7EBF \u7D44\u7EC4 \u7D42\u7EC8 \u7D50\u7ED3 \u7D9A\u7EED \u7DF4\u7EC3 \u7DD1\u7EFF \u7E01\u7F18 \u7E3E\u7EE9 \u7DCF\u603B \u7D66\u7ED9 \u7D75\u7ED8 \u7D71\u7EDF \u7D04\u7EA6 \u7D30\u7EC6
\u8A18\u8BB0 \u8A08\u8BA1 \u8A2D\u8BBE \u8A31\u8BB8 \u8A66\u8BD5 \u8A8D\u8BA4 \u8AAC\u8BF4 \u8ABF\u8C03 \u8AD6\u8BBA \u8B70\u8BAE \u8B77\u62A4 \u8A33\u8BD1 \u8A3C\u8BC1 \u8A55\u8BC4 \u8AB2\u8BFE \u8B1D\u8C22
\u99C5\u9A7F \u9244\u94C1 \u9280\u94F6 \u9285\u94DC \u92AD\u94B1 \u9332\u5F55 \u93E1\u955C \u9375\u952E \u9396\u9501 \u9234\u94C3 \u9271\u77FF \u91DD\u9488 \u91E3\u9493 \u92ED\u9510 \u9451\u9274
\u98EF\u996D \u98F2\u996E \u9928\u9986 \u98FC\u9972 \u9913\u997F \u98FE\u9970 \u9905\u997C \u990A\u517B \u9A13\u9A8C \u99C6\u9A71 \u9A12\u9A9A \u99D0\u9A7B \u9AEA\u53D1 \u9ED2\u9ED1 \u9EC4\u9EC4
\u611B\u7231 \u60AA\u6076 \u60A9\u607C \u5FDC\u5E94 \u61B6\u5FC6 \u614B\u6001 \u6163\u60EF \u61A4\u6124 \u61D0\u6000 \u5922\u68A6 \u5B9F\u5B9E \u5BFE\u5BF9 \u5C02\u4E13
\u6226\u6218 \u5358\u5355 \u52B4\u52B3 \u52DD\u80DC \u8CA0\u8D1F \u52B9\u6548 \u52E7\u529D \u52E2\u52BF \u5354\u534F \u5727\u538B \u53B3\u4E25 \u5909\u53D8
\u5FA9\u590D \u8907\u590D \u767A\u53D1 \u5F01\u8FA9 \u6E1B\u51CF \u5897\u589E \u899A\u89C9 \u89B3\u89C2 \u898F\u89C4 \u8996\u89C6 \u89AA\u4EB2 \u73FE\u73B0
\u7BC0\u8282 \u8449\u53F6 \u82B8\u827A \u85AC\u836F \u83EF\u534E \u8535\u85CF \u4F1D\u4F20 \u4ECF\u4F5B \u4FA1\u4EF7 \u5024\u503C \u5074\u4FA7 \u512A\u4F18 \u5099\u5907
`.trim().split(/\s+/).map(e=>[e[0],e[1]])),MS=e=>[...e].map(t=>ek.get(t)??t).join(""),Us=e=>[...e].filter(t=>/\p{Script=Han}/u.test(t)),tk=(e,t)=>{let r=MS(t);return Us(MS(e)).filter(n=>r.includes(n)).length},Ms=(e,t,r)=>Us(e).filter(n=>[...r.get(n)??[]].some(o=>t.includes(o))).length,rk=(e,t)=>{let r=e.readingValue,n=new Set;for(let s of Us(e.core?.core??e.readingSurface)){let i=[...t.get(s)??[]];for(let a of i)if(r.includes(a))for(let d of i)n.add(r.replace(a,d))}let o=["\u3042\u3044\u3046\u3048\u304A","\u304B\u304D\u304F\u3051\u3053","\u304C\u304E\u3050\u3052\u3054","\u3055\u3057\u3059\u305B\u305D","\u3056\u3058\u305A\u305C\u305E","\u305F\u3061\u3064\u3066\u3068","\u3060\u3062\u3065\u3067\u3069","\u306A\u306B\u306C\u306D\u306E","\u306F\u3072\u3075\u3078\u307B","\u3070\u3073\u3076\u3079\u307C","\u3071\u3074\u3077\u307A\u307D","\u307E\u307F\u3080\u3081\u3082","\u3089\u308A\u308B\u308C\u308D"];return[...r].forEach((s,i)=>{let a=o.find(d=>d.includes(s));for(let d of a??"")n.add(r.slice(0,i)+d+r.slice(i+1))}),[...n]},nk=e=>{try{let t=new Set;return Ar(e).forEach(r=>{r.members.forEach(n=>{n.id!==e&&t.add(n.id)})}),t}catch{return new Set}},xS=e=>{try{return Vr(e)}catch{return}},co=(e,t)=>(t==="reading"?e.readingValue:e.meaning).trim(),KS=(e,t)=>e.includes(t)||t.includes(e),ok=/[ゃゅょぁぃぅぇぉャュョァィゥェォ]/,sk=e=>{let t=[];for(let r of e.replace(/[～〜（）()\s・]/g,""))ok.test(r)&&t.length?t[t.length-1]+=r:t.push(r);return t},ik=(e,t)=>!!(e&&t)&&[...e].some(r=>/[\u4E00-\u9FFF]/.test(r)&&t.includes(r)),ak=(e,t,r,n,o)=>{let s=co(e,r),i=r==="meaning"?xS(e.id):void 0,a=rd(e,r),d=(r==="reading"?n.readings:n.meanings).get(a)??new Set,u=Us(e.core?.core??a).map(w=>[...o.get(w)??[]]),l=w=>u.filter(y=>y.some(_=>w.includes(_))).length,c=r==="reading"?l(s):0,f=t.filter(w=>{if(w.id===e.id)return!1;let y=co(w,r);if(!y||y===s||d.has(y))return!1;if(r==="reading"){let _=l(y);if(KS(s,y)||_<c||_>c+1)return!1}return!(i&&xS(w.id)===i)}),m=w=>r!=="reading"||Math.abs(w.morae-e.morae)<=1,g=w=>w.posBucket===e.posBucket,S=w=>w.loan===e.loan;return[f.filter(w=>w.level===e.level&&g(w)&&S(w)&&m(w)),f.filter(w=>g(w)&&S(w)&&m(w)),f.filter(w=>S(w)&&m(w)),f.filter(S),f]},dk=(e,t,r)=>{let n=sk(t),o=Math.max(1,Math.ceil(n.length/2)),s=f=>n.slice(0,f).join(""),i=f=>n.slice(-f).join(""),a=f=>m=>m.readingValue!==t&&m.readingValue.startsWith(s(f)),d=f=>m=>m.readingValue!==t&&m.readingValue.endsWith(i(f)),u=f=>r.some(f),l=u(a(o))?a(o):a(1),c=u(d(o))?d(o):d(1);return[l,c,f=>ik(e.kanji,f.kanji)||l(f)||c(f)]},uk=(e,t,r,n,o)=>{let s=qh(e)?"reading":"meaning",i=co(e,s);if(!i)return null;let a=nk(e.id),d=[],u=new Set([i]),l=ak(e,t,s,n,o);if(((s==="reading"?n.readings:n.meanings).get(rd(e,s))??new Set).forEach(_=>u.add(_)),s==="reading"){let _=e.core?.core??e.readingSurface,b=Ms(_,i,o),k=rk(e,o).filter(W=>!u.has(W)&&!KS(i,W)&&Math.abs(lo(W)-e.morae)<=1&&Ms(_,W,o)>=b&&Ms(_,W,o)<=b+1),v=[...l[2],...k.map(W=>({...e,id:-1,readingValue:W}))],L=new Map,I=W=>(L.has(W)||L.set(W,Ms(_,W,o)),L.get(W)),M=v.filter(W=>I(W.readingValue)===b),U=new Set(M.map(W=>W.readingValue)).size>=Gt?M:v;dk(e,i,U).forEach(W=>{let K=Bt(U.filter(W),r).sort((J,C)=>I(J.readingValue)-I(C.readingValue)||+(C.posBucket===e.posBucket)-+(J.posBucket===e.posBucket)).find(J=>!u.has(J.readingValue));K&&(u.add(K.readingValue),d.push(K.readingValue))});for(let W of Bt(U,r).sort((K,J)=>I(K.readingValue)-I(J.readingValue))){if(d.length>=Gt)break;let K=W.readingValue;u.has(K)||(u.add(K),d.push(K))}}let f=s==="reading"?e.core?.core??e.readingSurface:rd(e,s),m=new Map,g=_=>(m.has(_)||m.set(_,s==="reading"?Ms(f,_,o):tk(f,_)),m.get(_)),S=g(i);if(s==="meaning"&&new Set(l[4].filter(_=>g(_.meaning)===S).map(_=>_.meaning)).size<Gt)return null;let w=[...new Set(l[4].map(_=>Math.abs(g(co(_,s))-S)))].sort((_,b)=>_-b);for(let _ of w){for(let b of l){if(d.length>=Gt)break;let k=Bt(b.filter(v=>Math.abs(g(co(v,s))-S)===_),r).sort((v,L)=>Number(a.has(L.id))-Number(a.has(v.id)));for(let v of k){if(d.length>=Gt)break;let L=co(v,s);u.has(L)||(u.add(L),d.push(L))}}if(d.length>=Gt)break}if(d.length<Gt)return null;let y=Bt([i,...d],r);return{id:e.id,level:e.level,kind:s,prompt:rd(e,s),readingScope:s==="reading"?e.core?.core:void 0,options:y,answerIndex:y.indexOf(i),answer:i}},US={N5:261,N4:334,N3:934,N2:1539,N1:1435},FS=9,lk=(e=sd)=>{let t={};be.forEach(s=>{t[s]=FS});let r=e-FS*be.length;if(r<=0)return t;let n=be.reduce((s,i)=>s+US[i],0),o=be.map(s=>{let i=r*US[s]/n;return{level:s,whole:Math.floor(i),fraction:i-Math.floor(i)}});o.forEach(s=>{t[s.level]+=s.whole,r-=s.whole}),o.sort((s,i)=>i.fraction-s.fraction);for(let s=0;r>0;s=(s+1)%o.length,r-=1)t[o[s].level]+=1;return t},Dp=4,ck=(e,t,r)=>{let n={};if(be.forEach(d=>{n[d]=0}),r<=0)return n;let o=be.map(d=>{let u=Ot(e[d]??.5,.15,.85);return{level:d,weight:(t[d]??0)*Math.sqrt(u*(1-u))}}),s=o.reduce((d,u)=>d+u.weight,0);if(s<=0)return be.forEach((d,u)=>{n[d]=Math.floor(r/be.length)+(u<r%be.length?1:0)}),n;let i=r,a=o.map(d=>{let u=r*d.weight/s;return{level:d.level,whole:Math.floor(u),fraction:u-Math.floor(u)}});a.forEach(d=>{n[d.level]+=d.whole,i-=d.whole}),a.sort((d,u)=>u.fraction-d.fraction);for(let d=0;i>0;d=(d+1)%a.length,i-=1)n[a[d].level]+=1;return n},Up=(e,t=Math.random,r={})=>{let n=e.map(f=>({...f,meaning:(0,Mp.reviewedQuestionMeaning)(f.kanji,f.kana)??f.meaning})).map(zh),o=Qh(n),s=Zh(n),i=Object.fromEntries(be.map(f=>[f,n.filter(m=>m.level===f).length])),a=r.targets??lk(),d=r.total??sd,u=[],l=new Set(r.excludeIds??[]),c=(f,m)=>{for(let g of Bt(f,t)){if(u.length>=d||u.filter(w=>w.level===g.level).length>=m)break;if(l.has(g.id))continue;let S=uk(g,n,t,o,s);S&&(l.add(g.id),u.push(S))}};return be.forEach(f=>c(n.filter(m=>m.level===f),a[f]??0)),u.length<d&&c(n,d),{questions:Bt(u,t),populationByLevel:i}},mk=e=>{if(!e)return null;try{let t=JSON.parse(e);if(t.version!==1||!Array.isArray(t.questions)||!Array.isArray(t.responses))return null;let r=t.questions.filter(n=>!!(n&&Number.isFinite(Number(n.id))&&typeof n.prompt=="string"&&Array.isArray(n.options)&&n.options.length===Gt+1&&Number.isInteger(Number(n.answerIndex))));return r.length?{version:1,scoreVersion:t.scoreVersion===3?3:t.scoreVersion===2?2:1,runId:xr(t.runId)||`vocab-${Date.now()}`,startedAt:Number(t.startedAt)||Date.now(),finishedAt:t.finishedAt==null?null:Number(t.finishedAt),currentIndex:Ot(Math.floor(Number(t.currentIndex)||0),0,r.length),questions:r,responses:t.responses.filter(Boolean).map(n=>({questionIndex:Number(n.questionIndex),questionId:Number(n.questionId),answerState:n.answerState,selectedOption:n.selectedOption==null?null:Number(n.selectedOption),responseMs:n.responseMs==null?null:Number(n.responseMs),answeredAt:Number(n.answeredAt)||Date.now()})),populationByLevel:Object.fromEntries(Object.entries(t.populationByLevel??{}).map(([n,o])=>[n,Number(o)||0])),plannedTotal:Math.max(Number(t.plannedTotal)||0,r.length)}:null}catch{return null}},xs=e=>(R(od,JSON.stringify(e)),D(),e),Fp=()=>(q(),mk(O(od,""))),pk=(e=Math.random)=>{q();let t=HS(),r=Object.fromEntries(be.map(i=>[i,Dp])),n=Dp*be.length,{questions:o,populationByLevel:s}=Up(t,e,{targets:r,total:n});if(o.length<10)throw new Error("\u5F53\u524D\u8BCD\u5E93\u53EF\u7528\u4E8E\u6D4B\u9A8C\u7684\u8BCD\u592A\u5C11\uFF0C\u65E0\u6CD5\u5F00\u59CB\u6D4B\u91CF\u3002");return xs({version:1,scoreVersion:3,runId:`vocab-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,startedAt:Date.now(),finishedAt:null,currentIndex:0,questions:o,responses:[],populationByLevel:s,plannedTotal:sd})},GS=(e,t=Math.random)=>{let r=e.plannedTotal-e.questions.length;if(r<=0)return e;let n=Object.fromEntries(be.map(a=>{let d=BS(a,e);return[a,d.rate]})),o=ck(n,e.populationByLevel,r),{questions:s}=Up(HS(),t,{targets:o,total:r,excludeIds:e.questions.map(a=>a.id)});if(!s.length)return e;let i=[...e.questions,...s];return xs({...e,questions:i,plannedTotal:Math.min(e.plannedTotal,i.length)})},Ek=(e,t,r)=>{let n=Fp();if(!n||n.finishedAt||n.currentIndex>=n.questions.length)return n;let o=n.questions[n.currentIndex],s={questionIndex:n.currentIndex,questionId:o.id,answerState:e,selectedOption:t,responseMs:r,answeredAt:Date.now()},i=n.currentIndex+1,a=xs({...n,currentIndex:i,responses:[...n.responses,s],finishedAt:i>=n.questions.length&&i>=n.plannedTotal?Date.now():null});if(i>=a.questions.length&&a.questions.length<a.plannedTotal){let d=GS(a);return d.questions.length>a.questions.length?d:xs({...a,plannedTotal:a.questions.length,finishedAt:a.finishedAt??Date.now()})}return a},fk=()=>{let e=Fp();return!e||e.finishedAt?e:xs({...e,finishedAt:Date.now()})},gk=()=>{q(),R(od,""),D()},Ip=(e,t)=>{let r=4*e+3*t;return r>0?4*e/r:0},BS=(e,t)=>{let r=t.responses.filter(l=>t.questions[l.questionIndex]?.level===e),n=r.filter(l=>l.answerState==="correct").length,o=r.filter(l=>l.answerState==="wrong").length,s=r.filter(l=>l.answerState==="unknown").length,i=r.filter(l=>l.answerState==="timeout").length,a=t.scoreVersion>=2?nd:1/Gt,d=r.length?(n-o*a)/r.length:null,u=d==null?null:Ot(d,0,1);return{level:e,total:t.populationByLevel[e]??0,answered:r.length,correct:n,wrong:o,unknown:s,timeout:i,rate:u==null?null:Math.round(u*100)/100}},XS=e=>{let t=e.filter(n=>n.answered>=5&&n.rate!=null).map(n=>n.rate),r=t.length?Ot(Math.min(vp,...t),0,vp):0;return{floor:r,levels:e.map(n=>({...n,rate:n.rate==null?null:Math.round(Ot((n.rate-r)/(1-r)*xp,0,1)*100)/100}))}},YS=e=>{if(!e)return null;let t=be.map(k=>BS(k,e)),r=e.scoreVersion===3?XS(t):null,n=r?.levels??t,o=r?(xp/(1-r.floor))**2:1,s=n.reduce((k,v)=>k+v.total,0),i=n.reduce((k,v)=>k+v.total*(v.rate??0),0),a=0;n.forEach(k=>{let{total:v,answered:L,rate:I,correct:M,wrong:U,unknown:W,timeout:K}=k;if(!L||I==null){a+=o*v*v;return}if(e.scoreVersion===1){let z=Ip(U,W+K);a+=v*v*(I*(1-I)+(1-I)*z/Gt)/L;return}let J=M-U*nd,C=M+U*nd**2;a+=o*v*v*(L<2?1:Math.max(0,C-J**2/L)/(L*(L-1)))});let d=e.responses.length?Math.ceil(1.96*Math.sqrt(Math.max(0,a))):s,u=Math.round(i),l=n.find(k=>k.rate!=null&&k.answered>=5&&k.rate<.6)?.level??"N1+",c=e.responses.length,f=c/Math.max(1,e.plannedTotal),m=n.reduce((k,v)=>({wrong:k.wrong+v.wrong,unanswered:k.unanswered+v.unknown+v.timeout,timeout:k.timeout+v.timeout}),{wrong:0,unanswered:0,timeout:0}),g=Ip(m.wrong,m.unanswered),S=c?m.timeout/c:0,w=n.map(k=>k.rate).filter(k=>k!=null),y=w.reduce((k,v,L)=>L>0&&v>w[L-1]+.15?k+1:k,0),_=c?Ot(4*m.wrong/(3*c),0,1):0,b=Math.round(Ot((f*60+(1-S)*40)*(1-_)-y*8,0,100));return{scoreVersion:e.scoreVersion,estimated:u,lower:Ot(u-d,0,s),upper:Ot(u+d,0,s),population:s,answered:c,totalQuestions:e.plannedTotal,confidence:b,gamma:Math.round(g*100)/100,guessedShare:Math.round(_*100)/100,timeoutShare:Math.round(S*100)/100,recommendation:l,levels:n}},_k=e=>{let t=e.responses.reduce((r,n)=>{let o=e.questions[n.questionIndex],s=$S(o??{kind:"reading"})*1e3;return r+Ot(Number(n.responseMs??0),0,s)},0);return Math.max(0,Math.round(t/1e3))},wk=e=>{if(!e||e.responses.length===0)return;let t=YS(e);if(!t)return;q();let r=e.finishedAt??Date.now();(0,jS.getDatabase)().run(`
    INSERT OR IGNORE INTO vocab_test_history (
      run_id, started_at, finished_at, duration_seconds,
      answered, total_questions, estimated, lower_bound, upper_bound, confidence, recommendation, levels_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,[e.runId,new Date(e.startedAt).toISOString(),new Date(r).toISOString(),_k(e),t.answered,t.totalQuestions,t.estimated,t.lower,t.upper,t.confidence,t.recommendation,e.scoreVersion>=2?JSON.stringify({version:e.scoreVersion,levels:t.levels.map(n=>[n.level,n.rate,n.answered])}):JSON.stringify(t.levels.map(n=>[n.level,n.rate,n.answered]))]),D()},Tk=e=>{try{let t=JSON.parse(e||"[]"),r=t?.version===3?3:t?.version===2?2:1,n=Array.isArray(t)?t:t?.levels;if(!Array.isArray(n))return{scoreVersion:r,levels:[]};let o=n.map(s=>({level:String(s?.[0]??""),rate:s?.[1]==null?null:Number(s[1]),answered:Number(s?.[2]??0)})).filter(s=>s.level);return{scoreVersion:r,levels:o}}catch{return{scoreVersion:1,levels:[]}}},Sk=(e=20)=>(q(),p(`
    SELECT * FROM vocab_test_history ORDER BY finished_at DESC LIMIT ?
  `,[e]).map(t=>({runId:String(t.run_id??""),startedAt:Date.parse(String(t.started_at??""))||0,finishedAt:Date.parse(String(t.finished_at??""))||0,durationSeconds:Math.min(Number(t.duration_seconds??0),Number(t.answered??0)*20),answered:Number(t.answered??0),totalQuestions:Number(t.total_questions??0),estimated:Number(t.estimated??0),lower:Number(t.lower_bound??0),upper:Number(t.upper_bound??0),confidence:Number(t.confidence??0),recommendation:String(t.recommendation??""),...Tk(String(t.levels_json??""))}))),yk=()=>E("SELECT value FROM app_state WHERE key = ?",[od],"");var Nk=e=>e.split(/[；;]/)[0].trim(),$p=e=>{if(!(0,Fs.distinctionReviewFor)(e.key)||!cr(e))return!1;let r=new Set,n=new Set;return e.members.every(o=>{if(n.has(o.id))return!1;n.add(o.id);let s=(0,jp.reviewedQuestionMeaning)(o.kanji,o.kana);if(!s)return!1;let i=Nk(s);return r.has(i)?!1:(r.add(i),!0)})},Rk=e=>{let t=new Map;return e.forEach(r=>Ar(r).forEach(n=>t.set(n.key,n))),[...t.values()]},bk=()=>new Set(p("SELECT DISTINCT word_id FROM reviews WHERE reviewed_on = ? AND direction = 'forward'",[T()]).map(e=>Number(e.word_id??0)).filter(Boolean)),zS=()=>{let e=E("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='level_prior_baselines'",[],0)>0;return new Set(p(`SELECT p.word_id FROM progress p WHERE p.known_forever = 1
    OR EXISTS (SELECT 1 FROM reviews r WHERE r.word_id = p.word_id AND r.direction = 'forward')
    OR (p.seen_count > 0${e?` AND NOT EXISTS (
      SELECT 1 FROM level_prior_baselines b WHERE b.entity='words' AND b.entity_key=CAST(p.word_id AS TEXT)
    )`:""})`).map(t=>Number(t.word_id??0)).filter(Boolean))};function Lk(e){let t;if(e.kind==="group")t=Je().filter(r=>r.key===e.key);else if(e.kind==="type")t=Je().filter(r=>r.type===e.type);else if(t=Rk(e.kind==="today"?bk():zS()),e.kind==="learned"){let r=zS();t=t.filter(n=>n.members.filter(o=>r.has(o.id)).length>=2)}return t.filter($p)}var Ok=()=>new Set(Je().filter($p).map(e=>e.key));function Ak(e,t=Math.random){let r=[],n=VS.default;for(let o of Bt(e,t)){let s=(0,Fs.distinctionReviewFor)(o.key);if(!$p(o)||!s||r.length+o.members.length>24)continue;let i=(0,Fs.distinctionNotesFor)(s.summary,o.members.map(u=>({key:String(u.id),forms:[Se(u),u.kanji,u.kana]}))),a=Bt(o.members.map(u=>({id:u.id,surface:Se(u),kana:u.kana,exampleJp:u.exampleJp,exampleMeaning:u.exampleMeaning})),t),d=Zn(o.key,o.members,u=>[Se(u),u.kanji,u.kana],u=>eo((n[u.kanji]??n[u.kana])?.[0])).map(({member:u,voice:l,subgroup:c})=>({id:u.id,voice:l,subgroup:c}));for(let u of o.members){let l=(0,jp.reviewedQuestionMeaning)(u.kanji,u.kana);l&&r.push({groupKey:o.key,prompt:l,options:a,answerId:u.id,summary:s.summary,overview:s.summary.split(/[；;]/u)[0].trim(),explained:d,notes:i})}if(r.length===24)return r}return r}var hk=(e,t)=>{Xu(e,t)};sn();Qn();Ns();ia();on();Es();var Bp={};x(Bp,{MIXED_EVERY:()=>ad,answerMixedOther:()=>Mk,canUndoMixed:()=>xk,mixedTurnDue:()=>Dk,mixedUndoKind:()=>dd,pickMixedNext:()=>Ck,recordMixedWordAnswer:()=>Ik,resetMixedSession:()=>kk,undoMixedOther:()=>Uk,undoMixedWord:()=>Fk});var Kp=N($(),1);ss();Es();ta();var ad=5,Hp=["grammar","kanji","confusion"],Q={wordsSince:0,rotation:0,rotationBefore:0,undo:[],grammarCanUndo:!1},Gp=()=>bt,kk=()=>{Q.wordsSince=0,Q.rotation=0,Q.rotationBefore=0,Q.undo=[],Q.grammarCanUndo=!1},JS=e=>{if(e==="grammar"){let r=zn(Gp());return r.card?{kind:e,card:r.card}:null}if(!to())return null;if(e==="kanji"){let r=Ra((0,Kp.getDatabase)()).card;return r?{kind:e,card:r}:null}let t=ba((0,Kp.getDatabase)()).card;return t?{kind:e,card:t}:null},vk=()=>{for(let e=0;e<Hp.length;e+=1){let t=JS(Hp[(Q.rotation+e)%Hp.length]);if(t)return Q.rotationBefore=Q.rotation,Q.rotation+=e+1,t}return null},Ck=({word:e,afterWord:t=!1})=>(t&&(Q.wordsSince+=1),e&&Q.wordsSince<ad?"word":(e&&(Q.wordsSince=0),vk()??(e?"word":null))),Dk=()=>Q.wordsSince+1>=ad,Ik=()=>{Q.undo=[...Q.undo,"word"].slice(-Zi)},Mk=(e,t)=>{e.kind==="grammar"?Q.grammarCanUndo=nc(Gp(),e.card.id,t).canUndo:e.kind==="kanji"?Fc(e.card.char,t):jc(e.card.groupKey,t),Q.undo=[...Q.undo,e.kind].slice(-Zi)},dd=()=>Q.undo[Q.undo.length-1]??null,xk=(e,t)=>{let r=dd();return e&&!r?!1:r==="grammar"?Q.grammarCanUndo:r==="kanji"||r==="confusion"?!0:t},Uk=()=>{let e=dd();if(!e||e==="word")return null;if(Q.undo=Q.undo.slice(0,-1),e==="grammar"){let t=oc(Gp());return Q.grammarCanUndo=t.canUndo,t.card?{kind:e,card:t.card}:null}return e==="kanji"?Wc():$c(),JS(e)},Fk=({otherShowing:e})=>{dd()==="word"&&(Q.undo=Q.undo.slice(0,-1)),e&&(Q.wordsSince=ad-1,Q.rotation=Q.rotationBefore)};ss();yr();var Xp={};x(Xp,{grammarKanjiHint:()=>ty,grammarKanjiHintFor:()=>Pk,grammarKeyPoint:()=>ey,grammarKeyPointFor:()=>$k});var ud=N(QS(),1),Wk=ud.default.points,ZS=ud.default.aliases,jk=ud.default.kanji,ey=e=>{let t=Wk[e];return typeof t=="string"?t:""},$k=e=>ey(ZS[e.id]??e.title),ty=e=>{let t=jk[e];if(!Array.isArray(t)||t.length!==3)return null;let[r,n,o]=t;return typeof r!="string"||typeof n!="string"||typeof o!="string"?null:{kana:r,kanji:n,hook:o}},Pk=e=>{let t=ZS[e.id];return ty(typeof t=="string"?t:e.title)};zl();var zp={};x(zp,{kanjiReadingsLoaded:()=>uy,loadKanjiReadings:()=>dy,splitFurigana:()=>zk,useFuriganaReady:()=>Hk});var ld=N(Vm(),1),Ws=null,ry=null,dy=()=>Ws?Promise.resolve():(ry??(ry=Promise.resolve().then(()=>N(aa(),1)).then(e=>{Ws=e.default.readings})),ry),uy=()=>Ws!==null;function Hk(){let[e,t]=(0,ld.useState)(uy());return(0,ld.useEffect)(()=>{if(e)return;let r=!0;return dy().then(()=>{r&&t(!0)}),()=>{r=!1}},[e]),e}var ly=e=>e>="\u4E00"&&e<="\u9FFF"||e==="\u3005",ny=e=>e.replace(/[ァ-ヶ]/g,t=>String.fromCodePoint((t.codePointAt(0)??0)-96)),oy={\u304B:"\u304C",\u304D:"\u304E",\u304F:"\u3050",\u3051:"\u3052",\u3053:"\u3054",\u3055:"\u3056",\u3057:"\u3058",\u3059:"\u305A",\u305B:"\u305C",\u305D:"\u305E",\u305F:"\u3060",\u3061:"\u3062",\u3064:"\u3065",\u3066:"\u3067",\u3068:"\u3069",\u306F:"\u3070",\u3072:"\u3073",\u3075:"\u3076",\u3078:"\u3079",\u307B:"\u307C"},sy={\u306F:"\u3071",\u3072:"\u3074",\u3075:"\u3077",\u3078:"\u307A",\u307B:"\u307D"},Kk={\u3046:"\u3044",\u304F:"\u304D",\u3050:"\u304E",\u3059:"\u3057",\u3064:"\u3061",\u306C:"\u306B",\u3076:"\u3073",\u3080:"\u307F",\u308B:"\u308A"};function Gk(e){if(!e)return[];let t=[[e,0]],r=e[0],n=e.slice(1);return oy[r]&&t.push([oy[r]+n,1]),sy[r]&&t.push([sy[r]+n,1]),/[つちく]$/.test(e)&&t.push([`${e.slice(0,-1)}\u3063`,1]),t.push([`${e}\u3063`,2]),t}var iy=new Map;function Bk(e){let t=iy.get(e);if(t)return t;let r=Ws?.[e],n=new Map,o=(i,a)=>{if(i)for(let[d,u]of Gk(i)){let l=a+u;(!n.has(d)||n.get(d)>l)&&n.set(d,l)}};r?.on?.forEach((i,a)=>{o(i,a===0?0:1),/[ちつ]$/.test(i)&&i.length>1&&o(i.slice(0,-1),2)}),r?.kun?.forEach((i,a)=>{let[d,u=""]=i.split(".");o(d,a===0?0:1);for(let c=1;c<=u.length;c+=1)o(d+u.slice(0,c),c<u.length?3:2);let l=Kk[u[0]??""];l&&o(d+l,3)});let s=[...n.entries()].sort((i,a)=>i[1]-a[1]);return iy.set(e,s),s}var Xk=e=>ly(e)?"kanji":e>="\u30A1"&&e<="\u30FA"?"katakana":e>="\u3041"&&e<="\u3096"?"hiragana":"other";function Yk(e){let t=[];for(let r of e){let n=Xk(r),o=t[t.length-1];o&&(o.script===n||r==="\u30FC")?o.text+=r:t.push({text:r,isKanji:n==="kanji",script:n})}return t}var Yp=new Map,ay=2e4;function zk(e,t){if(!Ws||!e||!t)return null;let r=`${e}\0${t}`;if(Yp.has(r))return Yp.get(r)??null;let n=Vk(e,t);return Yp.set(r,n),n}function Vk(e,t){if(e===t||![...e].some(ly))return null;let r=ny(t),n=Yk(e),o=0,s=null,i=(d,u,l,c)=>{if(o++>ay||s&&c>=s.penalty)return;if(d===n.length){u===r.length&&(s={picks:[...l],penalty:c});return}let f=n[d];if(!f.isKanji){let m=ny(f.text);if(!r.startsWith(m,u))return;l.push({text:f.text,reading:t.slice(u,u+m.length),isKanji:!1}),i(d+1,u+m.length,l,c),l.pop();return}a(d,0,u,l,c)},a=(d,u,l,c,f)=>{if(o++>ay)return;let m=n[d];if(u===m.text.length){i(d+1,l,c,f);return}let g=m.text[u],S=d===n.length-1&&u===m.text.length-1;for(let[w,y]of Bk(g))r.startsWith(w,l)&&(S&&l+w.length!==r.length||(c.push({text:g,reading:t.slice(l,l+w.length),isKanji:!0}),a(d,u+1,l+w.length,c,f+y),c.pop()))};return i(0,0,[],0),s?s.picks:null}Ti();var Vp={};x(Vp,{duplicateMergePlan:()=>Ey,mergeDuplicateWords:()=>Jk});var my=N($(),1);rr();P();Tu();var py=N(nr(),1);hr();In();var cy=e=>{let t=String(e.kanji??""),r=String(e.kana??"");return t&&t!==r?`${t}/${r}`:r||t};function Ey(){let e=Ai();if(!e.size)return{pairs:[],reviews:0,bothStudied:0};let t=p(`
    SELECT w.id, w.kanji, w.kana, COALESCE(p.seen_count, 0) AS seen_count,
           (SELECT COUNT(*) FROM reviews r WHERE r.word_id = w.id) AS reviews
    FROM words w
    LEFT JOIN progress p ON p.word_id = w.id
  `),r=new Map(t.map(o=>[Number(o.id),o])),n=[];return e.forEach((o,s)=>{let i=r.get(s),a=r.get(o);!i||!a||n.push({fromId:s,intoId:o,fromLabel:cy(i),intoLabel:cy(a),reviews:Number(i.reviews??0),bothStudied:Number(i.seen_count??0)>0&&Number(a.seen_count??0)>0})}),{pairs:n,reviews:n.reduce((o,s)=>o+s.reviews,0),bothStudied:n.filter(o=>o.bothStudied).length}}function Jk(){let e=Ey(),t=(0,my.getDatabase)(),r=E("SELECT COUNT(*) FROM reviews",[],0);if(!e.pairs.length)return{merged:0,movedReviews:0,reviewsBefore:r,reviewsAfter:r};let n=new Map(e.pairs.map(s=>[s.fromId,s.intoId])),o=0;t.run("BEGIN TRANSACTION");try{e.pairs.forEach(s=>{o+=wu(t,s.fromId,s.intoId)}),_u(s=>n.get(s)??s),t.run("COMMIT")}catch(s){throw t.run("ROLLBACK"),s}return Cn(),Op(),zo(),zr(),Promise.resolve().then(()=>N(tt(),1)).then(({requestFullSnapshot:s})=>s()),D(),(0,py.notifyProgressUpdated)(),{merged:e.pairs.length,movedReviews:o,reviewsBefore:r,reviewsAfter:E("SELECT COUNT(*) FROM reviews",[],0)}}at();var nE={};x(nE,{MAX_UNCOMPRESSED_SNAPSHOT_BYTES:()=>gr,SUPPORTED_SYNC_PROTOCOL_VERSIONS:()=>Ty,SYNC_PROTOCOL_VERSION:()=>tE,SYNC_SNAPSHOT_FORMAT:()=>eE,compressSyncSnapshot:()=>dv,decompressSyncSnapshot:()=>uv,exportSyncSnapshot:()=>av,getSnapshotCapacity:()=>tv,isUserSyncSnapshot:()=>rE});var Zp=N(gy(),1),pd=N($(),1);at();Hr();var Ed=N(md(),1);async function wy(){if(typeof __non_webpack_require__>"u"||typeof __non_webpack_require__.async!="function")throw new Error("\u5F53\u524D\u5FAE\u4FE1\u57FA\u7840\u5E93\u4E0D\u652F\u6301\u5F02\u6B65\u52A0\u8F7D\u540C\u6B65\u538B\u7F29\u6A21\u5757\u3002");let e=await __non_webpack_require__.async("./account/fflate.umd.js");return e.default??e}var eE="master-nihongo-user-sqlite-v1",tE=2,Ty=new Set([1,tE]),gr=48e6,Qp=0,tv=()=>({bytes:Qp,limit:gr,ratio:Qp/gr}),mo="sync_snapshot_meta",rv=["sync_tombstones"],js=e=>`"${e.replace(/"/g,'""')}"`,$s=(e,t,r=[])=>(()=>{let n=e.prepare(t);try{return r.length&&n.bind(r),n.step()?n.get()[0]:void 0}finally{n.free()}})(),Sy=(e,t)=>!!$s(e,"SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",[t]),nv={stage1_tasks:14,stage2_progress:14,kanji_progress:14,kanji_reading_progress:14,kanji_unit_tasks:14,kanji_char_tasks:14,confusion_tasks:14,spelling_tasks:14},ov=e=>new Date(Date.now()-e*24*60*60*1e3).toISOString().slice(0,10),sv=(e,t)=>{let r=e.prepare(`PRAGMA table_info(${js(t)})`),n=[];try{for(;r.step();)n.push(String(r.getAsObject().name))}finally{r.free()}return n},iv=(e,t,r,n="")=>{if(!Sy(e,r))return;let o=String($s(e,"SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",[r])??"");if(!o)throw new Error(`\u65E0\u6CD5\u5BFC\u51FA\u540C\u6B65\u8868\u7ED3\u6784\uFF1A${r}`);t.run(o);let s=r==="app_state"?[...oi]:r==="grammar_state"?[...si]:[],i=nv[r],a=[],d="";s.length?(d=` WHERE key NOT IN (${s.map(()=>"?").join(", ")})`,a.push(...s)):i&&(d=" WHERE reviewed_on >= ?",a.push(ov(i))),n&&(d=d?`${d} AND (${n})`:` WHERE ${n}`);let u=sv(e,r);if(!u.length)return;let l=`INSERT INTO ${js(r)} (${u.map(js).join(", ")}) VALUES (${u.map(()=>"?").join(", ")})`,c=e.prepare(`SELECT ${u.map(js).join(", ")} FROM ${js(r)}${d}`),f=t.prepare(l);t.run("BEGIN");try{for(a.length&&c.bind(a);c.step();)f.run(c.get());t.run("COMMIT")}catch(m){throw t.run("ROLLBACK"),m}finally{c.free(),f.free()}};async function av(){Ve();let e=(0,pd.getDatabase)(),t=await(0,pd.createDatabase)();try{t.run(`
      CREATE TABLE ${mo} (
        format TEXT PRIMARY KEY,
        protocol_version INTEGER NOT NULL
      )
    `),t.run(`INSERT INTO ${mo} (format, protocol_version) VALUES (?, ?)`,[eE,tE]);let r=(0,Ed.canUseFeature)("weeklyReportCloudHistory",(0,Ed.getEntitlements)()),n=new Set([...Co(r).map(a=>a.table),...rv]),o=[...Su(),...r?[]:["weekly_reports"]],s=o.length?`table_name NOT IN (${o.map(a=>`'${a.replace(/'/g,"''")}'`).join(", ")})`:"";for(let a of n)iv(e,t,a,a==="sync_tombstones"?s:"");let i=new Uint8Array(t.export());return Qp=i.byteLength,i}finally{t.close()}}var rE=e=>{if(!Sy(e,mo)||$s(e,`SELECT format FROM ${mo} LIMIT 1`)!==eE)return!1;let t=$s(e,`SELECT COUNT(*) FROM pragma_table_info('${mo}') WHERE name = 'protocol_version'`);return Number(t)?Ty.has(Number($s(e,`SELECT protocol_version FROM ${mo} LIMIT 1`))):!0},yy=e=>e.buffer.slice(e.byteOffset,e.byteOffset+e.byteLength);async function dv(e){if(e.byteLength>gr)throw new Error(`\u5B66\u4E60\u6570\u636E\u5FEB\u7167 ${(e.byteLength/1e6).toFixed(1)} MB\uFF0C\u8D85\u8FC7 ${gr/1e6} MB \u4E0A\u9650\uFF0C\u4E91\u5907\u4EFD\u5DF2\u505C\u6B62\u3002\u672C\u673A\u6570\u636E\u5B8C\u597D\uFF0C\u8BF7\u5728\u8BBE\u7F6E\u9875\u5BFC\u51FA\u672C\u5730\u5907\u4EFD\u5E76\u8054\u7CFB\u652F\u6301\u3002`);if(Zp.Capacitor.getPlatform()==="wechat"){let{gzipSync:r}=await wy();return{bytes:r(e),compression:"gzip"}}if(typeof CompressionStream>"u")return{bytes:e,compression:"none"};let t=new Blob([yy(e)]).stream().pipeThrough(new CompressionStream("gzip"));return{bytes:new Uint8Array(await new Response(t).arrayBuffer()),compression:"gzip"}}async function uv(e,t){if(t==="none"){if(e.byteLength>gr)throw new Error("\u4E91\u7AEF\u5B66\u4E60\u6570\u636E\u8D85\u8FC7\u5B89\u5168\u5927\u5C0F\u9650\u5236\u3002");return e}if(Zp.Capacitor.getPlatform()==="wechat"){let{gunzipSync:d}=await wy(),u=d(e);if(u.byteLength>gr)throw new Error("\u4E91\u7AEF\u5B66\u4E60\u6570\u636E\u89E3\u538B\u540E\u8D85\u8FC7\u5B89\u5168\u5927\u5C0F\u9650\u5236\uFF0C\u5DF2\u505C\u6B62\u5904\u7406\u3002");return u}if(typeof DecompressionStream>"u")throw new Error("\u5F53\u524D\u7CFB\u7EDF\u7248\u672C\u65E0\u6CD5\u89E3\u538B\u4E91\u7AEF\u5B66\u4E60\u6570\u636E\uFF08\u9700\u8981 iOS/Safari 16.4 \u4EE5\u4E0A\uFF09\uFF0C\u8BF7\u5347\u7EA7\u540E\u91CD\u8BD5\u3002");let n=new Blob([yy(e)]).stream().pipeThrough(new DecompressionStream("gzip")).getReader(),o=[],s=0;try{for(;;){let{done:d,value:u}=await n.read();if(d)break;if(s+=u.byteLength,s>gr)throw await n.cancel(),new Error(`\u4E91\u7AEF\u5B66\u4E60\u6570\u636E\u89E3\u538B\u540E\u8D85\u8FC7 ${gr/1e6} MB\uFF0C\u5DF2\u505C\u6B62\u5904\u7406\u3002`);o.push(u)}}finally{n.releaseLock()}let i=new Uint8Array(s),a=0;for(let d of o)i.set(d,a),a+=d.byteLength;return i}var dE={};x(dE,{mergeDatabaseBytes:()=>Hv});var Eo=N($(),1);at();Hr();P();var Td=N(md(),1);ii();var Ny="grammar-highlights-updated",Ry="grammar-positions-updated";hi();hr();In();ne();Te();var Cy="",vv="legacy",Ur=e=>`"${e.replace(/"/g,'""')}"`,ge=(e,t)=>{let r=e.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1");try{return r.bind([t]),r.step()}finally{r.free()}},po=(e,t)=>{if(!ge(e,t))return new Set;let r=e.prepare(`PRAGMA table_info(${Ur(t)})`);try{let n=new Set;for(;r.step();)n.add(String(r.get()[1]));return n}finally{r.free()}},Cv=(e,t,r)=>{let n=new Set(["sync_updated_at","sync_origin_device","sync_uid"]),o=new Set(["sync_snapshot_meta","sync_tombstones","direction_tasks","mode_tasks","achievement_unlocked",...r.filter(d=>d.cloud!==!1).map(d=>d.table)]),s=e.prepare("SELECT name FROM sqlite_master WHERE type = 'table'"),i=[];try{for(;s.step();)i.push(String(s.get()[0]??""))}finally{s.free()}let a=i.filter(d=>d&&d!=="sqlite_sequence"&&!o.has(d));if(a.length)throw new Error(`\u4E91\u7AEF\u5B66\u4E60\u6570\u636E\u5305\u542B\u5F53\u524D\u7248\u672C\u65E0\u6CD5\u4FDD\u7559\u7684\u8868\uFF1A${a.join(", ")}\uFF0C\u8BF7\u5148\u66F4\u65B0\u5E94\u7528\u3002`);for(let d of r){if(!ge(e,d.table))continue;if(!ge(t,d.table))throw new Error(`\u4E91\u7AEF\u5B66\u4E60\u6570\u636E\u9700\u8981\u8868 ${d.table}\uFF0C\u5F53\u524D\u7248\u672C\u65E0\u6CD5\u65E0\u635F\u4FDD\u5B58\uFF0C\u8BF7\u5148\u66F4\u65B0\u5E94\u7528\u3002`);let u=po(t,d.table),l=[...po(e,d.table)].filter(c=>!u.has(c)&&!n.has(c));if(l.length)throw new Error(`\u4E91\u7AEF\u5B66\u4E60\u6570\u636E\u7684 ${d.table} \u5305\u542B\u5F53\u524D\u7248\u672C\u65E0\u6CD5\u4FDD\u7559\u7684\u5217\uFF1A${l.join(", ")}\uFF0C\u8BF7\u5148\u66F4\u65B0\u5E94\u7528\u3002`)}},aE=(e,t)=>{if(!ge(e,t))return[];let r=e.prepare(`SELECT * FROM ${Ur(t)}`);try{let n=[];for(;r.step();)n.push(r.getAsObject());return n}finally{r.free()}},Dy=(e,t)=>e.keys.map(r=>String(t[r]??"")).join(Cy),Dv=e=>String(e?.[Ae]??"1970-01-01T00:00:00.000Z"),Iv=e=>String(e?.[_e]??vv),Iy=(e,t)=>e.changedAt!==t.changedAt?e.changedAt>t.changedAt?1:-1:e.originDevice===t.originDevice?0:e.originDevice>t.originDevice?1:-1,vy=(e,t,r)=>{let n=new Map;for(let o of r){if(!ge(e,o.table))continue;let s=new Map;for(let i of aE(e,o.table)){let a=o.strategy==="append"&&!String(i.sync_uid??"")?`${String(i.sync_origin_device??t)}:${String(i.id??`${i.word_id??i.grammar_id??i.unit_key??""}|${i.answer??""}|${i.reviewed_on??""}|${i.created_at??""}`)}`:Dy(o,i);Do(o.table,String(i.key??""))||s.set(a,{key:a,row:i,deleted:!1,changedAt:Dv(i),originDevice:Iv(i)||t})}n.set(o.table,s)}if(ge(e,"sync_tombstones"))for(let o of aE(e,"sync_tombstones")){let s=String(o.table_name??""),i=String(o.row_key??"");if(!r.find(l=>l.table===s)||!n.has(s)||Do(s,i))continue;let d={key:i,deleted:!0,changedAt:String(o.deleted_at??"1970-01-01T00:00:00.000Z"),originDevice:String(o.origin_device??t)||t},u=n.get(s)?.get(i);(!u||Iy(d,u)>0)&&n.get(s)?.set(i,d)}return{rows:n}},Mv=(e,t,r)=>{let n=new Map,o=t.rows.get(e.table)??new Map,s=r.rows.get(e.table)??new Map,i=new Set([...o.keys(),...s.keys()]);for(let a of i){let d=o.get(a),u=s.get(a);if(!d){u&&n.set(a,u);continue}if(!u){n.set(a,d);continue}(e.strategy==="append"||e.strategy==="union"||e.strategy==="lww")&&n.set(a,Iy(d,u)>=0?d:u)}return n},xv=(e,t)=>{if(!e.deleted)return{...t??{},...e.row??{}}},Uv=(e,t)=>e instanceof Uint8Array||t instanceof Uint8Array?!(e instanceof Uint8Array)||!(t instanceof Uint8Array)||e.length!==t.length?!1:e.every((r,n)=>r===t[n]):e===t,Fv=(e,t,r)=>{if(!e||!t)return!1;for(let n of r)if(!Uv(e[n],t[n]))return!1;return!0},Wv=(e,t,r)=>{let n=r.split(Cy),o=t.keys.map(s=>`${Ur(s)} = ?`).join(" AND ");e.run(`DELETE FROM ${Ur(t.table)} WHERE ${o}`,n)},jv=(e,t)=>{if(!ge(e,t.table))return[];let r=new Set(t.keys),n=e.prepare(`PRAGMA table_info(${Ur(t.table)})`);try{let o=[];for(;n.step();){let s=n.get();Number(s[5]??0)>0&&!r.has(String(s[1]))&&o.push(String(s[1]))}return o}finally{n.free()}},$v=(e,t,r,n)=>{if(!ge(e,r.table))return;let o=po(e,r.table),s=aE(e,r.table),i=new Map(s.map(l=>[Dy(r,l),l])),a=new Set(o),d=jv(e,r),u=[];for(let[l,c]of n){if(Do(r.table,l))continue;let f=i.get(l),m=xv(c,f);if(!m){f&&u.push(()=>Wv(t,r,l));continue}r.strategy==="append"&&!String(m.sync_uid??"")&&(m.sync_uid=l);for(let y of d)f&&f[y]!=null?m[y]=f[y]:delete m[y];if(Fv(f,m,a))continue;let g=Object.keys(m).filter(y=>a.has(y));if(!g.length)continue;let S=g.map(Ur).join(", "),w=g.map(()=>"?").join(", ");u.push(()=>t.run(`INSERT OR REPLACE INTO ${Ur(r.table)} (${S}) VALUES (${w})`,g.map(y=>m[y])))}u.forEach(l=>l())},Pv=(e,t,r)=>{if(!ge(e,"sync_tombstones"))return;for(let o of r.keys())e.run("DELETE FROM sync_tombstones WHERE table_name = ?",[o]);let n=po(e,"sync_tombstones");for(let[o,s]of r)for(let i of s.values()){if(!i.deleted)continue;let a={table_name:o,row_key:i.key,deleted_at:i.changedAt,origin_device:i.originDevice},d=Object.keys(a).filter(u=>n.has(u));t.run(`INSERT OR REPLACE INTO sync_tombstones (${d.map(Ur).join(", ")})
         VALUES (${d.map(()=>"?").join(", ")})`,d.map(u=>a[u]))}};async function Hv(e){Ve();let t=(0,Eo.getDatabase)(),r=await(0,Eo.openDatabase)(e);try{let n=ge(r,"words")&&ge(r,"progress")&&ge(r,"app_state"),o=rE(r);if(!n&&!o)throw new Error("\u4E91\u7AEF\u5B66\u4E60\u6570\u636E\u683C\u5F0F\u65E0\u6548\uFF0C\u5DF2\u4FDD\u7559\u672C\u673A\u6570\u636E\u3002");let s=Co((0,Td.canUseFeature)("weeklyReportCloudHistory",(0,Td.getEntitlements)()));for(let w of s){if(!ge(t,w.table)||!ge(r,w.table))continue;Au(w.table);let y=po(t,w.table);[...po(r,w.table)].some(_=>_.startsWith("fsrs_")&&!y.has(_))&&j({table:w.table,idColumn:"",eligible:""})}o&&Cv(r,t,it);let i=ge(t,"kanji_unit_reviews")?(await Promise.resolve().then(()=>(Ns(),Ua))).replayKanjiUnitReviews:void 0,a=ge(t,"kanji_char_reviews")?(await Promise.resolve().then(()=>(Qn(),pa))).replayKanjiCharReviews:void 0,d=ge(t,"confusion_reviews")?(await Promise.resolve().then(()=>(sn(),Sa))).replayConfusionReviews:void 0,u=ge(t,"kana_reviews")?(await Promise.resolve().then(()=>(hs(),za))).replayKanaReviews:void 0,l=ge(t,"custom_words")?(await Promise.resolve().then(()=>(ky(),hy))).materializeCustomWords:void 0,c=vy(t,"local",s),f=vy(r,"remote",s),m=new Map;di();let g=Zd(t);t.run("BEGIN TRANSACTION");try{for(let w of s){let y=Mv(w,c,f);m.set(w.table,y),$v(t,g,w,y)}Pv(t,g,m),g.free(),i?.(),a?.(),d?.(),u?.();for(let w of["words","grammar","kanji","confusion"])wi(w);ff(),l?.(),t.run("COMMIT")}catch(w){throw g.free(),t.run("ROLLBACK"),w}finally{ui()}Go(),zo(),zr(),typeof window<"u"&&(window.dispatchEvent(new Event(Ny)),window.dispatchEvent(new Event(Ry)));let S=(0,Eo.exportDatabase)();if(!S)throw new Error("\u5F53\u524D\u6CA1\u6709\u53EF\u5408\u5E76\u7684\u672C\u5730\u6570\u636E\u5E93\u3002");return S}finally{r.close()}}Hr();var yE={};x(yE,{YUZU:()=>ue,YUZU_EVENT:()=>Vy,applyYuzuEquipment:()=>Jy,bookReferralReward:()=>nC,bookTeamReward:()=>rC,buyItem:()=>dC,buyRepairCard:()=>lC,claimDailyPlanYuzu:()=>iC,claimStudyFocusYuzu:()=>_E,equipItem:()=>qy,equippedItem:()=>go,grantReferralSet:()=>oC,grantRepairCard:()=>Qy,nextStudyFocusYuzu:()=>gE,ownsItem:()=>Ad,proGiftClaimed:()=>cC,proGiftEligible:()=>Zy,repairCards:()=>hd,repairDay:()=>pC,repairDayWithCard:()=>mC,repairPrice:()=>TE,repairableDays:()=>SE,settleYuzu:()=>aC,unequip:()=>uC,voiceUnlocked:()=>tC,yuzuBalance:()=>Od,yuzuToday:()=>sC});var Xt={early:"title-early",night:"title-night",hunter:"title-hunter",slow:"title-slow",grove:"title-grove",capy:"title-capy",yuyou:"title-yuyou"};var _o=N($(),1);P();kr();Mt();var cE={};x(cE,{computeStreak:()=>Gv,shiftDay:()=>ft,weekDays:()=>Bv});var uE=e=>Date.parse(`${e}T00:00:00Z`),Kv=e=>new Date(e).toISOString().slice(0,10),lE=e=>/^\d{4}-\d{2}-\d{2}$/.test(e)&&!Number.isNaN(uE(e)),ft=(e,t)=>lE(e)?Kv(uE(e)+t*864e5):e,Gv=(e,t)=>{if(!lE(t))return 0;let r=new Set(e),n=r.has(t)?t:ft(t,-1),o=0;for(;r.has(n);)o+=1,n=ft(n,-1);return o},Bv=e=>{if(!lE(e))return[];let t=new Date(uE(e)).getUTCDay(),r=t===0?6:t-1,n=ft(e,-r);return Array.from({length:7},(o,s)=>ft(n,s))};P();var Sd={answers:20,seconds:300},Xv=[7,14,30,50,100,200,365,500,1e3];function Yv(e){return e<=0?0:e<7?1:e<30?2:e<100?3:e<365?4:5}function zv(e,t,r,n,o){let s=[...e].filter(([m,g])=>m<=t&&g!=="none").map(([m])=>m).sort(),i=new Set(s),a=e.get(t)??"none",d=a!=="none"?t:ft(t,-1),u=0,l=0;for(;i.has(d);){u+=1,e.get(d)==="gold"&&(l+=1);let m=ft(d,-1);if(m===d)break;d=m}let c=0,f=0;return s.forEach((m,g)=>{f=g>0&&ft(s[g-1],1)===m?f+1:1,c=Math.max(c,f)}),{today:t,todayStatus:a,streak:u,longest:c,litDays:s.length,atRisk:u>0&&a==="none"&&(r>=20||r<4),tier:Yv(u),nextMilestone:Xv.find(m=>m>u)??null,todayAnswers:n,todaySeconds:o,everLitBefore:s.filter(m=>m<t).length,goldInStreak:l}}var My=[["reviews","reviewed_on"],["grammar_reviews","reviewed_on"],["kanji_unit_reviews","reviewed_on"],["spelling_reviews","reviewed_on"],["jlpt_answers","answered_on"]];function xy(){let e=new Map,t=new Map,r=new Set(p("SELECT name FROM sqlite_master WHERE type = 'table'").map(s=>String(s.name)));for(let[s,i]of My)if(r.has(s))for(let a of p(`SELECT ${i} AS day, COUNT(*) AS answers FROM ${s} GROUP BY ${i}`)){let d=String(a.day);e.set(d,(e.get(d)??0)+Number(a.answers))}for(let s of p("SELECT studied_on AS day, SUM(seconds) AS seconds FROM word_study_time GROUP BY studied_on"))t.set(String(s.day),Number(s.seconds));let n=new Map;for(let s of new Set([...e.keys(),...t.keys()]))((e.get(s)??0)>=Sd.answers||(t.get(s)??0)>=Sd.seconds)&&n.set(s,"lit");let o=new Set(p("SELECT key FROM yuzu_ledger WHERE kind IN ('repair', 'repair_card') GROUP BY key").map(s=>String(s.key)));for(let s of p("SELECT checked_on FROM checkins GROUP BY checked_on")){let i=String(s.checked_on);n.set(i,o.has(i)?"repaired":"gold")}return{statuses:n,answers:e,seconds:t}}function Vv(){return xy().statuses}function Uy(e=new Date){let{statuses:t,answers:r,seconds:n}=xy(),o=T(e);return zv(t,o,e.getHours(),r.get(o)??0,n.get(o)??0)}function Fy(){let e=Vv(),t=[...e.keys()].sort()[0];if(!t)return[];let r=T();return Array.from({length:7},(n,o)=>ft(r,-o-1)).filter(n=>n>t&&!e.has(n))}function Wy(e=new Date){let t=T(e),r=i=>Number(p(i,[t])[0]?.n??0);if(r("SELECT COUNT(*) AS n FROM checkins WHERE checked_on = ?")>0)return r("SELECT COUNT(*) AS n FROM yuzu_ledger WHERE kind IN ('repair', 'repair_card') AND key = ?")>0?"repaired":"gold";let n=new Set(p("SELECT name FROM sqlite_master WHERE type = 'table'").map(i=>String(i.name))),o=0;for(let[i,a]of My)n.has(i)&&(o+=r(`SELECT COUNT(*) AS n FROM ${i} WHERE ${a} = ?`));let s=r("SELECT COALESCE(SUM(seconds), 0) AS n FROM word_study_time WHERE studied_on = ?");return o>=Sd.answers||s>=Sd.seconds?"lit":"none"}var Yy=N(mE(),1),Ld=N(By(),1),zy=N(md(),1);var Rd=()=>!1,pE=()=>Promise.resolve();var fE={};x(fE,{CATEGORY_LABEL:()=>Zv,EQUIPPABLE:()=>bd,VOICE_ITEM_PREFIX:()=>EE,YUZU_ITEMS:()=>Xy,itemById:()=>Hs,teamTitleName:()=>eC});var EE="voice-",Zv={theme:"\u914D\u8272\u4E3B\u9898",mascot:"\u5409\u7965\u7269\u76AE\u80A4",icon:"App \u56FE\u6807",voice:"\u53D1\u97F3\u58F0\u97F3",sound:"\u7B54\u9898\u97F3\u6548",walk:"\u8D70\u6CD5",title:"\u961F\u4F0D\u79F0\u53F7",misc:"\u5176\u4ED6"},bd=new Set(["theme","mascot","icon","sound","walk","title"]),Xy=[{id:"theme-dusk",name:"\u665A\u971E",description:"\u6A59\u7C89\u6696\u8C03\u7684\u914D\u8272",category:"theme",price:0,invite:!0},{id:"theme-matcha",name:"\u62B9\u8336",description:"\u9752\u7EFF\u4E3B\u8272\u6362\u6210\u62B9\u8336\u7EFF",category:"theme",price:2e3},{id:"theme-sakura",name:"\u6A31",description:"\u7C89\u5E95\u6A31\u8272",category:"theme",price:2e3},{id:"theme-night",name:"\u6DF1\u591C\u98DF\u5802",description:"\u6697\u7425\u73C0\u6696\u8C03\u7684\u591C\u95F4\u914D\u8272",category:"theme",price:2e3},{id:"theme-paper",name:"\u7EB8\u672C",description:"\u5976\u6CB9\u7EB8\u8272\u3001\u58A8\u8272\u4E3B\u952E\u3001\u7EC6\u7EBF\u5206\u9694\uFF0C\u50CF\u4E00\u672C\u5B89\u9759\u7684\u5355\u8BCD\u672C",category:"theme",price:3e3},{id:"theme-round",name:"\u5706\u5706",description:"\u767D\u5E95\u5706\u4F53\u3001\u4F1A\u6309\u4E0B\u53BB\u7684\u7ACB\u4F53\u6309\u94AE\u3001\u67DA\u5B50\u6A59\u70B9\u7F00",category:"theme",price:3e3},{id:"mascot-croc",name:"\u9CC4\u9C7C",description:"\u6362\u4E00\u53EA\u9CC4\u9C7C:\u8868\u60C5\u3001\u9875\u9762\u56FE\u6807\u3001\u7A7A\u72B6\u6001\u63D2\u753B\u6574\u5957\u6362\u3002\u5C0F\u8DEF\u4E0A\u8D70\u7684\u8FD8\u662F\u6C34\u8C5A",category:"mascot",price:3e3},{id:"icon-happy",name:"\u5F00\u5FC3\u56FE\u6807",description:"\u628A App \u56FE\u6807\u6362\u6210\u5F00\u5FC3\u8868\u60C5",category:"icon",price:5e3,art:"app-icon-happy"},{id:"icon-onsen",name:"\u6CE1\u6C64\u56FE\u6807",description:"\u628A App \u56FE\u6807\u6362\u6210\u6CE1\u6C64\u7684\u6C34\u8C5A",category:"icon",price:5e3,art:"app-icon-onsen"},{id:"voice-voicevox-10",name:"\u96E8\u6674\u306F\u3046",description:"\u8F7B\u5FEB\u5973\u58F0\u3002\u5207\u6362\u5355\u8BCD\u53D1\u97F3\uFF1B\u4F8B\u53E5\u4ECD\u7528\u9ED8\u8BA4\u58F0",category:"voice",price:6e3,art:"item-voice-female-2"},{id:"voice-voicevox-11",name:"\u7384\u91CE\u6B66\u5B8F",description:"\u6C89\u7A33\u7537\u58F0\u3002\u5207\u6362\u5355\u8BCD\u53D1\u97F3\uFF1B\u4F8B\u53E5\u4ECD\u7528\u9ED8\u8BA4\u58F0",category:"voice",price:6e3,art:"item-voice-male"},{id:"sound-marimba",name:"\u6728\u7434",description:"\u7B54\u9898\u97F3\u6362\u6210\u6728\u7434:\u66F4\u5706\u3001\u66F4\u77ED",category:"sound",price:3e3,art:"item-sound-marimba-2"},{id:"sound-epiano",name:"\u7535\u94A2",description:"\u7B54\u9898\u97F3\u6362\u6210\u7535\u94A2:\u5E26\u4E00\u70B9\u6BDB\u8FB9\u7684\u6696\u97F3",category:"sound",price:3e3,art:"item-sound-epiano-2"},{id:"walk-alt",name:"\u6EDA\u7740\u8D70",description:"\u5B66\u4E60\u9875\u5C0F\u8DEF\u548C\u52A0\u8F7D\u65F6\uFF0C\u6C34\u8C5A\u6539\u6210\u6EDA\u7740\u8D70",category:"walk",price:4e3,art:"roll-frame"},{id:"report-cover",name:"\u5468\u62A5\u5C01\u9762",description:"\u5468\u62A5\u5C01\u9762\u6362\u4E00\u5F20",category:"misc",price:3e3,soon:!0,art:"card-daily"},{id:Xt.yuyou,name:"\u67DA\u53CB",description:"\u961F\u4F0D\u540D\u5355\u91CC\uFF0C\u540D\u5B57\u65C1\u6302\u4E0A\u300C\u67DA\u53CB\u300D",category:"title",price:0,invite:!0},{id:Xt.early,name:"\u6668\u8BFB\u6D3E",description:"\u961F\u4F0D\u540D\u5355\u91CC\uFF0C\u540D\u5B57\u65C1\u6302\u4E0A\u300C\u6668\u8BFB\u6D3E\u300D",category:"title",price:3e3},{id:Xt.night,name:"\u591C\u8BFB\u6D3E",description:"\u961F\u4F0D\u540D\u5355\u91CC\uFF0C\u540D\u5B57\u65C1\u6302\u4E0A\u300C\u591C\u8BFB\u6D3E\u300D",category:"title",price:3e3},{id:Xt.hunter,name:"\u5355\u8BCD\u730E\u4EBA",description:"\u961F\u4F0D\u540D\u5355\u91CC\uFF0C\u540D\u5B57\u65C1\u6302\u4E0A\u300C\u5355\u8BCD\u730E\u4EBA\u300D",category:"title",price:3e3},{id:Xt.slow,name:"\u6162\u6162\u6765",description:"\u961F\u4F0D\u540D\u5355\u91CC\uFF0C\u540D\u5B57\u65C1\u6302\u4E0A\u300C\u6162\u6162\u6765\u300D",category:"title",price:3e3},{id:Xt.grove,name:"\u67DA\u5B50\u5E84\u56ED\u4E3B",description:"\u961F\u4F0D\u540D\u5355\u91CC\uFF0C\u540D\u5B57\u65C1\u6302\u4E0A\u300C\u67DA\u5B50\u5E84\u56ED\u4E3B\u300D",category:"title",price:3e3},{id:Xt.capy,name:"\u6C34\u8C5A\u672C\u8C5A",description:"\u961F\u4F0D\u540D\u5355\u91CC\uFF0C\u540D\u5B57\u65C1\u6302\u4E0A\u300C\u6C34\u8C5A\u672C\u8C5A\u300D",category:"title",price:3e3}],Hs=e=>Xy.find(t=>t.id===e),eC=e=>{let t=e?Hs(e):void 0;return t?.category==="title"?t.name:""};var ue={study:50,studyWords:100,plan:50,streak7:300,encore:50,achievement:200,focus:[100,50,25,23,12,6,3,2,1],focusMinimumMs:300*1e3,focusMinimumWords:10,repair:[500,1e3,2e3],repairWindowDays:7},Vy="shushugo:yuzu",_r=()=>{if(O("yuzu_scale_10","")==="1")return;let e=(0,_o.getDatabase)();e.run("BEGIN");try{O("yuzu_scale_10","")!=="1"&&(e.run("UPDATE yuzu_ledger SET amount = amount * 10 WHERE amount != 0"),R("yuzu_scale_10","1")),e.run("COMMIT"),D()}catch(t){throw e.run("ROLLBACK"),t}},Ze=()=>{Jy(),typeof window<"u"&&window.dispatchEvent(new Event(Vy))},Jy=()=>{if(!(typeof document>"u"))try{let e=go("theme");e?document.documentElement.setAttribute("data-skin",e):document.documentElement.removeAttribute("data-skin"),(0,Yy.setSoundTimbre)(go("sound").replace("sound-","")||"kalimba"),(0,Ld.setMascotSkin)(go("mascot")),(0,Ld.setWalkStyle)(go("walk"))}catch{}},tC=(e,t)=>!e||e===t||Ad(EE+e),Xe=(e,t,r)=>((0,_o.getDatabase)().run("INSERT OR IGNORE INTO yuzu_ledger (kind, key, amount, day) VALUES (?, ?, ?, ?)",[e,t,r,T()]),E("SELECT changes()",[],0)>0),rC=(e,t,r)=>!t||!Number.isSafeInteger(r)||r<=0||(_r(),!Xe(e,t,r))?!1:(D(),Ze(),!0),nC=(e,t,r)=>!t||!Number.isSafeInteger(r)||r<=0||(_r(),!Xe(e,t,r))?!1:(D(),Ze(),!0),oC=()=>{_r();let e=Xe("buy","theme-dusk",0),t=Xe("buy",Xt.yuyou,0);(e||t)&&(D(),Ze())},Od=()=>(_r(),E("SELECT COALESCE(SUM(amount), 0) FROM yuzu_ledger",[],0)),sC=()=>(_r(),p("SELECT kind, key, amount FROM yuzu_ledger WHERE day = ? AND kind != 'focus_claim' ORDER BY rowid",[T()]).map(e=>({kind:String(e.kind),key:String(e.key),amount:Number(e.amount)}))),gE=(e=T())=>{let t=E("SELECT COUNT(*) FROM yuzu_ledger WHERE kind = 'focus' AND day = ?",[e],0);return ue.focus[t]??0},_E=e=>{_r();let t=p(`SELECT completed_at FROM study_focus_windows
    WHERE id = ? AND kind = 'focus' AND active_ms >= ? AND words >= ?`,[e,ue.focusMinimumMs,ue.focusMinimumWords])[0];if(!t||E("SELECT COUNT(*) FROM yuzu_ledger WHERE kind = 'focus_claim' AND key = ?",[e],0))return 0;let r=B(new Date(Number(t.completed_at))),n=(0,_o.getDatabase)(),o=0;n.run("SAVEPOINT claim_study_focus");try{let s=E("SELECT COUNT(*) FROM yuzu_ledger WHERE kind = 'focus' AND day = ?",[r],0),i=ue.focus[s]??0;i>0&&(n.run("INSERT OR IGNORE INTO yuzu_ledger(kind, key, amount, day) VALUES ('focus', ?, ?, ?)",[`${r}:${s+1}`,i,r]),E("SELECT changes()",[],0)&&(o=i)),n.run("INSERT OR IGNORE INTO yuzu_ledger(kind, key, amount, day) VALUES ('focus_claim', ?, 0, ?)",[e,r]),n.run("RELEASE claim_study_focus")}catch(s){throw n.run("ROLLBACK TO claim_study_focus"),n.run("RELEASE claim_study_focus"),s}return D(),o&&Ze(),o},iC=()=>{_r();let e=ar();return e.total<=0||e.completed<e.total||!Xe("plan",T(),ue.plan)?0:(D(),Ze(),ue.plan)},aC=()=>{_r();let e=T(),t=0;if(E("SELECT COUNT(DISTINCT word_id) FROM reviews WHERE reviewed_on = ? AND direction = 'forward'",[e],0)>=ue.studyWords&&Xe("study",e,ue.study)&&(t+=ue.study),Wy()==="gold"){let{goldInStreak:o}=Uy();o%7===0&&Xe("streak",e,ue.streak7)&&(t+=ue.streak7)}jn(e).dayWords>0&&Xe("encore",e,ue.encore)&&(t+=ue.encore),p("SELECT id FROM achievements WHERE id NOT IN (SELECT key FROM yuzu_ledger WHERE kind = 'achievement')").forEach(o=>{Xe("achievement",String(o.id),ue.achievement)&&(t+=ue.achievement)});let n=Zy()&&Qy("pro",!1);return(t||n)&&(D(),Ze()),t},Ad=e=>E("SELECT COUNT(*) FROM yuzu_ledger WHERE kind = 'buy' AND key = ?",[e],0)>0,dC=e=>{let t=Hs(e);return!t||t.soon||t.invite||Ad(e)||Od()<t.price||t.category==="icon"&&!Rd()?!1:(Xe("buy",e,-t.price),bd.has(t.category)&&!go(t.category)&&qy(e),D(),Ze(),!0)},wE=e=>`yuzu_equipped:${e}`,go=e=>O(wE(e),""),qy=e=>{let t=Hs(e);!t||!bd.has(t.category)||!Ad(e)||t.category==="icon"&&!Rd()||(R(wE(t.category),e),t.category==="icon"&&pE(e),D(),Ze())},uC=e=>{e==="icon"&&!Rd()||(R(wE(e),""),e==="icon"&&pE(""),D(),Ze())},TE=()=>{_r();let e=ft(T(),-30),t=E("SELECT COUNT(*) FROM yuzu_ledger WHERE kind IN ('repair', 'card_buy') AND day >= ?",[e],0);return ue.repair[Math.min(t,ue.repair.length-1)]},SE=()=>Fy(),hd=()=>Math.max(0,E("SELECT COUNT(*) FROM yuzu_ledger WHERE kind IN ('card', 'card_buy')",[],0)-E("SELECT COUNT(*) FROM yuzu_ledger WHERE kind = 'repair_card'",[],0)),Qy=(e,t=!0)=>{if(E("SELECT COUNT(*) FROM yuzu_ledger WHERE kind IN ('card', 'card_overflow') AND key = ?",[e],0)||hd()>=1)return!1;let r=Xe("card",e,0);return r&&t&&(D(),Ze()),r},lC=()=>{if(hd()>=1)return!1;let e=TE();if(Od()<e)return!1;let t=`${T()}:${E("SELECT COUNT(*) FROM yuzu_ledger WHERE kind = 'card_buy' AND day = ?",[T()],0)+1}`;return Xe("card_buy",t,-e)?(D(),Ze(),!0):!1},Zy=()=>{try{let e=(0,zy.getEntitlements)();return e.isPro&&e.source!=="trial"}catch{return!1}},cC=()=>E("SELECT COUNT(*) FROM yuzu_ledger WHERE kind IN ('card', 'card_overflow') AND key = 'pro'",[],0)>0,mC=e=>!SE().includes(e)||hd()<1?!1:(Xe("repair_card",e,0),(0,_o.getDatabase)().run("INSERT OR IGNORE INTO checkins (checked_on) VALUES (?)",[e]),D(),Ze(),!0),pC=e=>{if(!SE().includes(e))return!1;let t=TE();if(Od()<t)return!1;let r=(0,_o.getDatabase)();return Xe("repair",e,-t),r.run("INSERT OR IGNORE INTO checkins (checked_on) VALUES (?)",[e]),D(),Ze(),!0};var kE={};x(kE,{STUDY_FOCUS_BASELINE_DAYS:()=>rN,STUDY_FOCUS_MIN_WORDS:()=>kd,STUDY_FOCUS_PARTIAL_KEY:()=>LE,STUDY_FOCUS_REWARDS:()=>EC,STUDY_FOCUS_REWARD_MIN_MS:()=>tN,STUDY_FOCUS_WINDOW_MS:()=>Fr,claimStudyFocusReward:()=>LC,continueStudyFocus:()=>OC,enterStudyFocus:()=>sN,finishStudyFocusAtDailyCompletion:()=>AC,getStudyFocusSnapshot:()=>Le,isStudyFocusArmed:()=>fC,leaveStudyFocus:()=>hC,recordStudyFocusAnswer:()=>NC,recordStudyFocusTime:()=>yC,resumeStudyFocus:()=>SC,sameStudyFocusState:()=>TC,setStudyFocusArmed:()=>gC,startStudyFocus:()=>bC,stopStudyFocus:()=>hE,studyFocusCounts:()=>OE,summarizeStudyFocus:()=>AE,undoStudyFocusAnswer:()=>RC});var bE=N($(),1);P();var Fr=600*1e3,EC=ue.focus,tN=ue.focusMinimumMs,LE="study_focus_partial_windows",kd=ue.focusMinimumWords,rN=30,NE="mn-study-focus-armed",fC=()=>{try{return localStorage.getItem(NE)==="1"}catch{return!1}},gC=e=>{try{e?localStorage.setItem(NE,"1"):localStorage.removeItem(NE)}catch{}if(!e)try{et().source||hE()}catch{}},eN=new WeakMap,vd=e=>({id:`focus-${e}-${Math.random().toString(36).slice(2,12)}`,startedAt:e,activeMs:0,answers:{}}),nN=e=>e==="know"||e==="known_forever"||e==="fuzzy"||e==="forgot",_C=e=>{if(!e||typeof e!="object")return!1;let t=e;return typeof t.id=="string"&&typeof t.startedAt=="number"&&Number.isFinite(t.startedAt)&&typeof t.activeMs=="number"&&Number.isFinite(t.activeMs)&&t.activeMs>=0&&t.activeMs<Fr&&!!t.answers&&typeof t.answers=="object"&&!Array.isArray(t.answers)&&Object.entries(t.answers).every(([r,n])=>Number.isInteger(Number(r))&&Number(r)>0&&nN(n))},et=()=>{let e=(0,bE.getDatabase)(),t=eN.get(e);if(!t){let r={};try{let n=JSON.parse(O(LE,"{}"));n&&typeof n=="object"&&!Array.isArray(n)&&(r=Object.fromEntries(Object.entries(n).filter(([,o])=>_C(o))))}catch{}t={source:null,pausedFrom:null,pausedAt:0,baselines:r,focus:null,completedAt:null,summary:null,unsavedMs:0,reward:null,rewardClaimed:!1,answerHistory:[]},eN.set(e,t)}return t},fn=e=>{R(LE,JSON.stringify(e.baselines)),e.unsavedMs=0,D()},OE=e=>{let t=Object.values(e);return{words:t.length,remembered:t.filter(r=>r==="know"||r==="known_forever").length,fuzzy:t.filter(r=>r==="fuzzy").length,forgotten:t.filter(r=>r==="forgot").length}},AE=(e,t)=>{let r=OE(e),n=t.length?t.reduce((o,s)=>o+s.remembered,0)/t.length:null;return{...r,rememberedRate:r.words?r.remembered/r.words*100:null,qualified:r.words>=kd,baselineWindows:t.length,baselineRemembered:n,rememberedDelta:n===null?null:r.remembered-n,efficiencyChangePercent:n===null||n===0?null:(r.remembered-n)/n*100}},RE=(e,t,r,n)=>{let o=OE(e.answers);t==="baseline"&&o.words<kd||(0,bE.getDatabase)().run(`INSERT OR IGNORE INTO study_focus_windows
    (id, kind, source, started_at, completed_at, active_ms, words, remembered, fuzzy, forgotten)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,[e.id,t,r,e.startedAt,n,t==="baseline"?Fr:e.activeMs,o.words,o.remembered,o.fuzzy,o.forgotten])},oN=(e,t)=>p(`
  SELECT words, remembered, fuzzy, forgotten FROM study_focus_windows
  WHERE kind = 'baseline' AND source = ? AND completed_at <= ? AND completed_at >= ? AND words >= ?`,[e,t,t-rN*864e5,kd]).map(r=>({words:Number(r.words),remembered:Number(r.remembered),fuzzy:Number(r.fuzzy),forgotten:Number(r.forgotten)})),wC=(e,t)=>(e.reward?.day!==t&&(e.reward={day:t,value:gE(t)}),e.reward.value),Le=(e=Date.now())=>{let t=et();return{status:t.summary?"break":t.focus?"running":"off",remainingSeconds:Math.max(0,Math.ceil((Fr-(t.focus?.activeMs??0))/1e3)),focusWindowId:t.focus?.id??null,activeMs:t.focus?.activeMs??0,summary:t.summary,nextReward:t.summary&&!t.summary.qualified?0:wC(t,B(new Date(t.completedAt??e))),rewardClaimed:t.rewardClaimed,paused:!t.source&&!!t.focus}},TC=(e,t)=>e.status===t.status&&e.nextReward===t.nextReward&&e.summary===t.summary&&e.rewardClaimed===t.rewardClaimed,sN=(e,t=Date.now())=>{var o;let r=et();return r.focus&&!r.summary&&!r.source&&r.pausedFrom===e&&B(new Date(r.pausedAt))===B(new Date(t))||(r.focus=null,r.rewardClaimed=!1),r.pausedFrom=null,r.summary=null,r.completedAt=null,r.reward=null,r.source=e,r.answerHistory=[],(o=r.baselines)[e]??(o[e]=vd(t)),Le(t)},SC=(e,t=Date.now())=>et().source===e?Le(t):sN(e,t),yC=(e,t=Date.now(),r)=>{let n=et();if(!n.source||r!==void 0&&r!==n.source||n.summary||!Number.isFinite(e)||e<=0)return Le(t);let o=Math.min(e,n.focus?Fr-n.focus.activeMs:e),s=o;for(;s>0;){let i=n.baselines[n.source],a=Math.min(s,Fr-i.activeMs);i.activeMs+=a,s-=a,i.activeMs===Fr&&(RE(i,"baseline",n.source,t-s),n.baselines[n.source]=vd(t-s))}return n.focus&&(n.focus.activeMs+=o,n.focus.activeMs===Fr&&(RE(n.focus,"focus",n.source,t),n.summary=AE(n.focus.answers,oN(n.source,n.focus.startedAt)),n.completedAt=t)),n.unsavedMs+=o,n.answerHistory=n.answerHistory.filter(i=>i.baselineId===n.baselines[n.source].id||i.focusId===n.focus?.id),(n.unsavedMs>=15e3||n.summary)&&fn(n),Le(t)},NC=(e,t,r=Date.now())=>{let n=et();if(!n.source||n.summary||!Number.isInteger(e)||e<=0||!nN(t))return Le(r);let o=n.baselines[n.source];return n.answerHistory.push({wordId:e,baselineId:o.id,baselinePrevious:o.answers[String(e)],focusId:n.focus?.id,focusPrevious:n.focus?.answers[String(e)]}),o.answers[String(e)]=t,n.focus&&(n.focus.answers[String(e)]=t),fn(n),Le(r)},RC=(e,t=Date.now())=>{let r=et();if(!r.source||r.summary)return Le(t);let n=r.answerHistory.length-1;for(;n>=0&&r.answerHistory[n].wordId!==e;)n--;if(n<0)return Le(t);let[o]=r.answerHistory.splice(n,1),s=(i,a,d)=>{!i||i.id!==a||(d?i.answers[String(e)]=d:delete i.answers[String(e)])};return s(r.baselines[r.source],o.baselineId,o.baselinePrevious),s(r.focus,o.focusId,o.focusPrevious),fn(r),Le(t)},bC=(e=Date.now())=>{let t=et();return t.source&&!t.focus&&(t.focus=vd(e),t.rewardClaimed=!1),Le(e)},LC=()=>{let e=et();if(!e.source||!e.focus||!e.summary?.qualified||e.rewardClaimed||Le().nextReward<=0)return 0;let r=_E(e.focus.id);return e.rewardClaimed=!0,r},OC=(e=Date.now())=>{let t=et();return!t.source||!t.focus||!t.summary||t.summary.qualified&&Le(e).nextReward>0&&!t.rewardClaimed?!1:(t.reward=null,t.rewardClaimed=!1,t.focus=vd(e),t.summary=null,t.completedAt=null,!0)},hE=(e=Date.now())=>{let t=et();return t.focus=null,t.summary=null,t.completedAt=null,t.reward=null,t.rewardClaimed=!1,fn(t),Le(e)},AC=(e=Date.now())=>{let t=et();return!t.source||!t.focus||t.summary?Le(e):t.focus.activeMs<tN?(t.focus=null,t.reward=null,t.rewardClaimed=!1,fn(t),Le(e)):(RE(t.focus,"focus",t.source,e),t.summary=AE(t.focus.answers,oN(t.source,t.focus.startedAt)),t.completedAt=e,fn(t),Le(e))},hC=(e,t=Date.now())=>{let r=et();if(!r.source||e!==void 0&&r.source!==e)return!1;let n=!!r.focus&&!r.summary;return n?(r.pausedFrom=r.source,r.pausedAt=t,fn(r)):hE(t),r.source=null,n};Dm();var DE={};x(DE,{ETA_MAX_WEEKS:()=>PC,KEYWORD_RARITY:()=>fN,SPEED_BANDS:()=>TN,TIME_REF_MIN_MINUTES:()=>SN,WEEKLY_HIGHLIGHT_MIN_PEAK:()=>cN,WEEKLY_REPORT_MIN_DAYS:()=>YC,buildReferences:()=>yN,buildWeeklyReport:()=>Ud,formatDateCn:()=>XC,getGoalEta:()=>HC,getKeywordCandidates:()=>gN,getRollingSpeed:()=>GC,getSlotDistribution:()=>EN,getSpeedBand:()=>$C,getStreak:()=>xC,getWeekWindow:()=>wo,getWeeklyHighlight:()=>mN,getWeeklyMetrics:()=>CE,getWeeklyRevisitWords:()=>pN,hashSeed:()=>_N,isWeekend:()=>dN,passesThreshold:()=>Fd,pickKeyword:()=>wN,reportPeriodStart:()=>vC,weekStartOf:()=>DC,windowDays:()=>aN});P();var Ye=e=>{let t=e.getFullYear(),r=String(e.getMonth()+1).padStart(2,"0"),n=String(e.getDate()).padStart(2,"0");return`${t}-${r}-${n}`},kC=e=>`${Ye(e)} ${String(e.getHours()).padStart(2,"0")}:${String(e.getMinutes()).padStart(2,"0")}`,xd=(e,t,r=0)=>{let n=new Date(`${e}T00:00:00`);return n.setHours(t,r,0,0),n},vE=e=>e instanceof Date?new Date(e):/^\d{4}-\d{2}-\d{2}$/.test(e)?xd(e,12):new Date(e),Cd=(e,t)=>{if(typeof e=="number"&&Number.isFinite(e))return e;if(typeof e=="string"&&e.trim()){let o=Number(e);if(Number.isFinite(o)&&o>0)return o;let i=/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)$/.test(e)?`${e.replace(" ","T")}Z`:e.includes("T")?e:e.replace(" ","T"),a=new Date(i);if(Number.isFinite(a.getTime()))return a.getTime()}let r=String(t??""),n=/^\d{4}-\d{2}-\d{2}$/.test(r)?xd(r,12):new Date(r);return Number.isFinite(n.getTime())?n.getTime():NaN},Yt=e=>p("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",[e]).length>0,Id=(e,t)=>{let r=new Date(e);return r.setDate(r.getDate()+t),r},vC=e=>{let t=new Date(e);return t.setHours(14,0,0,0),t.setDate(t.getDate()-t.getDay()),e<t.getTime()&&t.setDate(t.getDate()-7),`${Ye(t)} 14:00`},CC=e=>{let t=vE(e);if(!Number.isFinite(t.getTime()))return xd(Ye(new Date),14);let r=new Date(t);return r.setHours(14,0,0,0),r.setDate(r.getDate()-r.getDay()),t.getTime()<r.getTime()&&r.setDate(r.getDate()-7),r},iN=(e,t)=>{let r=Id(e,t*7),n=Id(r,-7);return{start:Ye(n),end:Ye(Id(r,-1)),startAt:n.getTime(),endAt:r.getTime()}};function wo(e=new Date,t=0){return iN(CC(e),t)}function DC(e){let t=vE(e);return Number.isFinite(t.getTime())?(t.setDate(t.getDate()-t.getDay()),Ye(t)):e}function aN(e){let t=[],r=xd(e.start,0);for(let n=0;n<7;n+=1)t.push(Ye(r)),r.setDate(r.getDate()+1);return t}var dN=e=>{let t=vE(e).getDay();return t===0||t===6},To=()=>{let e=[];if(Yt("reviews")){let r=new Set(p("PRAGMA table_info(reviews)").map(n=>String(n.name??""))).has("event_source")?"event_source":"'legacy' AS event_source";for(let n of p(`SELECT id, word_id, answer, direction, reviewed_on, reviewed_at, created_at, ${r} FROM reviews`)){let o=Cd(n.reviewed_at??n.created_at,n.reviewed_on);e.push({kind:"word",id:`word:${String(n.id)}`,wordId:Number(n.word_id),answer:String(n.answer??""),direction:String(n.direction??"forward"),eventSource:String(n.event_source??"legacy"),day:String(n.reviewed_on??Ye(new Date(o))),at:o})}}if(Yt("grammar_reviews"))for(let t of p("SELECT id, grammar_id, answer, reviewed_on, created_at FROM grammar_reviews")){let r=Cd(t.created_at,t.reviewed_on);e.push({kind:"grammar",id:`grammar:${String(t.id)}`,grammarId:String(t.grammar_id),answer:String(t.answer??""),day:String(t.reviewed_on??Ye(new Date(r))),at:r})}if(Yt("grammar_activity_events"))for(let t of p("SELECT id, grammar_id, answer, activity_on, activity_at, created_at FROM grammar_activity_events")){let r=Cd(t.activity_at??t.created_at,t.activity_on);e.push({kind:"grammar",id:`grammar-activity:${String(t.id)}`,grammarId:String(t.grammar_id),answer:String(t.answer??"read"),day:String(t.activity_on??Ye(new Date(r))),at:r})}if(Yt("kanji_unit_reviews"))for(let t of p("SELECT id, unit_key, answer, reviewed_on, reviewed_at, created_at FROM kanji_unit_reviews")){let r=Cd(t.reviewed_at??t.created_at,t.reviewed_on);e.push({kind:"kanji",id:`kanji:${String(t.id)}`,answer:String(t.answer??""),day:String(t.reviewed_on??Ye(new Date(r))),at:r})}return e.filter(t=>t.answer!=="known_forever").filter(t=>t.eventSource!=="bulk_complete").filter(t=>Number.isFinite(t.at))},Ks=(e,t)=>e.at>=t.startAt&&e.at<t.endAt,Md=e=>{let t=new Date(e.at);return Number.isFinite(t.getTime())?Ye(t):e.day},Dd=(e,t,r)=>e===r?t.start:e,uN=(e,t)=>{let r=new Set;for(let n of e)n.at<t&&r.add(Md(n));return r},lN=(e,t)=>{let r=uN(e,t.endAt),n=0,o=new Date(t.endAt-1);for(;r.has(Ye(o));)n+=1,o.setDate(o.getDate()-1);return n},IC=e=>{let t=new Map;for(let r of e){if(r.kind!=="word"||r.direction!=="forward"||r.wordId==null)continue;let n=t.get(r.wordId);(!n||r.at<n.at||r.at===n.at&&r.id<n.id)&&t.set(r.wordId,r)}return[...t.values()]},MC=e=>{if(Yt("study_time_by_period")){let t=E("SELECT COALESCE(SUM(seconds), 0) FROM study_time_by_period WHERE period_start = ?",[kC(new Date(e.startAt))],0);if(t>0)return t}return Yt("word_study_time")?E("SELECT COALESCE(SUM(seconds), 0) FROM word_study_time WHERE studied_on BETWEEN ? AND ?",[e.start,e.end],0):0};function xC(e=wo()){return lN(To(),e)}function CE(e){let t=To(),r=t.filter(b=>Ks(b,e)),n=IC(t),o=n.filter(b=>Ks(b,e)),s=Ye(new Date(e.endAt-1)),i=new Map;if(Yt("word_study_time"))for(let b of p("SELECT studied_on, seconds FROM word_study_time WHERE studied_on BETWEEN ? AND ? AND seconds > 0",[e.start,s])){let k=Dd(String(b.studied_on),e,s);i.set(k,(i.get(k)??0)+Math.max(0,Number(b.seconds??0)))}let d=aN(e).map(b=>({date:b,reviews:r.filter(k=>Dd(Md(k),e,s)===b).length,newWords:o.filter(k=>Dd(Md(k),e,s)===b).length,seconds:i.get(b)??0})),u=r.filter(b=>b.kind==="word").length,l=r.filter(b=>b.kind==="grammar").length,c=r.filter(b=>b.kind==="kanji").length,f=r.length,m=Math.max(0,Math.round(MC(e))),g=new Set(r.map(b=>Dd(Md(b),e,s))),S=new Set([...g,...i.keys()]),w=S.size>0?S.size:m>0?1:0,y=n.filter(b=>b.at<e.endAt).length,_=uN(t,e.endAt);if(Yt("word_study_time"))for(let b of p("SELECT studied_on FROM word_study_time WHERE studied_on <= ? AND seconds > 0",[s]))_.add(String(b.studied_on));return{window:e,days:w,minutes:Math.round(m/60),totalSeconds:m,totalReviews:f,wordReviews:u,grammarReviews:l,kanjiReviews:c,newWords:o.length,reviewCount:Math.max(0,f-o.length),daily:d,streak:lN(t,e),cumulativeDays:Math.max(_.size,m>0?1:0),cumulativeWords:y}}var cN=2;function mN(e){let t=e.daily.filter(n=>n.reviews>0);if(t.length<2)return null;let r=t.reduce((n,o)=>o.reviews>n.reviews?o:n);return r.reviews<cN?null:{date:r.date,text:`${r.date} \u5B8C\u6210\u4E86 ${r.reviews} \u6B21\u5B66\u4E60\u8BB0\u5F55`}}function pN(e){let t=To().filter(o=>Ks(o,e)),r=new Map;for(let o of t){if(o.kind!=="word"||o.direction!=="forward"||o.wordId==null||!["forgot","fuzzy"].includes(o.answer))continue;let s=r.get(o.wordId);r.set(o.wordId,{count:(s?.count??0)+1,latest:Math.max(s?.latest??0,o.at)})}if(!r.size||!Yt("words"))return[];let n=new Map;for(let o of p("SELECT id, kanji, kana FROM words WHERE id IN ("+[...r.keys()].map(()=>"?").join(",")+")",[...r.keys()]))n.set(Number(o.id),String(o.kanji||o.kana||`\u8BCD\u6761 ${o.id}`));if(Yt("custom_words"))for(let o of p("SELECT word_id, kanji, kana FROM custom_words WHERE word_id IN ("+[...r.keys()].map(()=>"?").join(",")+")",[...r.keys()]))n.set(Number(o.word_id),String(o.kanji||o.kana||`\u8BCD\u6761 ${o.word_id}`));return[...r.entries()].filter(([o])=>n.has(o)).map(([o,s])=>({wordId:o,text:n.get(o),count:s.count,latest:s.latest})).sort((o,s)=>s.count-o.count||s.latest-o.latest||o.wordId-s.wordId).slice(0,8).map(({wordId:o,text:s,count:i})=>({wordId:o,text:s,count:i}))}var UC=e=>e>=22||e<4?"deepNight":e<8?"earlyMorning":e<12?"morning":e<17?"afternoon":e<20?"dusk":"night";function EN(e){let t={deepNight:0,earlyMorning:0,morning:0,afternoon:0,dusk:0,night:0},r=0,n=0;for(let o of To().filter(s=>Ks(s,e))){let s=new Date(o.at).getHours();t[UC(s)]+=1,r+=1,(s>=7&&s<9||s>=17&&s<19)&&(n+=1)}return{counts:t,total:r,commuteShare:r>0?n/r:0}}var FC=e=>{if(e.length<2)return Number.POSITIVE_INFINITY;let t=e.reduce((n,o)=>n+o,0)/e.length;if(t===0)return Number.POSITIVE_INFINITY;let r=e.reduce((n,o)=>n+(o-t)**2,0)/e.length;return Math.sqrt(r)/t},fN={\u590D\u4E60\u6D3E:2,\u94C1\u4EBA:2,\u5300\u901F\u524D\u8FDB:3,\u653B\u575A\u624B:3,\u591C\u884C\u8005:3,\u901A\u52E4\u515A:4,\u5F00\u8352\u8005:4,\u5468\u672B\u7A81\u51FB\u624B:4,\u65E9\u8D77\u9E1F:5,\u5355\u65E5\u7206\u53D1:5},WC=e=>{let t=null;for(let r of Object.keys(e))e[r]!==0&&(t===null||e[r]>e[t])&&(t=r);return t};function gN(e,t){let r=[],n=WC(t.counts);n==="deepNight"&&r.push("\u591C\u884C\u8005"),n==="earlyMorning"&&r.push("\u65E9\u8D77\u9E1F"),t.total>0&&t.commuteShare>=.35&&r.push("\u901A\u52E4\u515A");let o=e.daily.filter(a=>dN(a.date)).reduce((a,d)=>a+d.reviews,0);e.totalReviews>0&&o/e.totalReviews>=.4&&r.push("\u5468\u672B\u7A81\u51FB\u624B"),e.streak>=14&&r.push("\u94C1\u4EBA"),FC(e.daily.map(a=>a.newWords))<.3&&r.push("\u5300\u901F\u524D\u8FDB");let s=e.daily.filter(a=>a.newWords>0);if(s.length>0){let a=Math.max(...s.map(u=>u.newWords)),d=s.reduce((u,l)=>u+l.newWords,0)/s.length;d>0&&a/d>=3&&r.push("\u5355\u65E5\u7206\u53D1")}e.reviewCount>e.newWords&&r.push("\u590D\u4E60\u6D3E"),e.newWords>e.reviewCount&&r.push("\u5F00\u8352\u8005");let i=new Map;for(let a of To().filter(d=>d.kind==="word"&&Ks(d,e.window)))a.wordId!=null&&i.set(a.wordId,(i.get(a.wordId)??0)+1);return[...i.values()].some(a=>a>=5)&&r.push("\u653B\u575A\u624B"),r.map(a=>({keyword:a,rarity:fN[a]??3}))}var _N=e=>{let t=2166136261;for(let r=0;r<e.length;r+=1)t^=e.charCodeAt(r),t=Math.imul(t,16777619);return t>>>0},jC=e=>{let t=e>>>0;return()=>{t=t+1831565813|0;let r=Math.imul(t^t>>>15,1|t);return r=r+Math.imul(r^r>>>7,61|r)^r,((r^r>>>14)>>>0)/4294967296}};function wN(e,t){if(e.length===0)return null;if(e.length===1)return e[0];let r=e.reduce((s,i)=>s+i.rarity,0),n=jC(_N(t))()*r,o=0;for(let s of e)if(o+=s.rarity,n<o)return s;return e[e.length-1]}var TN=[{level:4,threshold:100,label:"\u672C\u5468\u63A5\u89E6\u91CF\u5F88\u9AD8"},{level:3,threshold:64,label:"\u672C\u5468\u63A5\u89E6\u91CF\u5F88\u5145\u5B9E"},{level:2,threshold:43,label:"\u672C\u5468\u63A5\u89E6\u91CF\u7A33\u5B9A"},{level:1,threshold:22,label:"\u672C\u5468\u63A5\u89E6\u4E86\u4E0D\u5C11\u65B0\u8BCD"}];function $C(e){return TN.find(t=>e>=t.threshold)??null}var PC=104;function HC(){return null}var KC=()=>{let e=To();return e.length?e.reduce((t,r)=>Math.min(t,r.at),Number.POSITIVE_INFINITY):Number.POSITIVE_INFINITY};function GC(e,t=4){let r=KC(),n=0,o=0,s=new Date(e.endAt);for(let i=0;i<t;i+=1){let a=iN(Id(s,-i*7),0);a.endAt<=r||(n+=CE(a).newWords,o+=1)}return o>0?n/o:0}var SN=1,BC=e=>{let t=Math.floor(e/60),r=e%60;return t>0&&r>0?`${t} \u5C0F\u65F6 ${r} \u5206`:t>0?`${t} \u5C0F\u65F6`:`${r} \u5206\u949F`},XC=e=>{let t=e.split("-");return t.length===3?`${t[0]} \u5E74 ${Number(t[1])} \u6708 ${Number(t[2])} \u65E5`:e};function yN(e){let{metrics:t}=e,r=[];return t.totalSeconds>=60*SN&&r.push({kind:"time",text:`\u8FD9\u6BB5\u65F6\u95F4\u4F60\u6295\u5165\u4E86 ${BC(Math.floor(t.totalSeconds/60))}`}),t.totalReviews>0&&r.push({kind:"review",text:`\u8FD9\u6BB5\u65F6\u95F4\u4F60\u5B8C\u6210\u4E86 ${t.totalReviews} \u6B21\u5B66\u4E60`}),t.streak>0&&!(e.takenKeywords??[]).includes("\u94C1\u4EBA")&&r.push({kind:"streak",text:`\u4F60\u8FDE\u7EED ${t.streak} \u5929\u4E0E\u65E5\u8BED\u89C1\u9762`}),r}function Ud(e,t=0,r=new Date){let n=wo(r,t),o=CE(n),s=EN(n),i=gN(o,s),a=wN(i,`${e}:${n.startAt}`);return{window:n,metrics:o,keyword:a,keywordCandidates:i,speedBand:null,eta:null,references:yN({metrics:o,speedBand:null,eta:null,takenKeywords:a?[a.keyword]:[]}),highlight:mN(o),revisitWords:pN(n)}}var YC=1,Fd=e=>e.totalReviews>0||e.totalSeconds>0;var ME={};x(ME,{WEEKLY_BACKFILL_MAX_WEEKS:()=>hN,WEEKLY_REPORT_SCHEMA_VERSION:()=>Gs,WEEKLY_REPORT_UPDATED_EVENT:()=>NN,backfillWeeklyReports:()=>ZC,generateLatestWeeklyReport:()=>JC,generateWeeklyReport:()=>AN,getWeeklyReport:()=>$d,getWeeklyReportNotice:()=>tD,listWeeklyReports:()=>ON,markWeeklyReportRead:()=>qC,reportWindowLabel:()=>rD,reportWindowLabelCompact:()=>nD,saveWeeklyReport:()=>IE});var gn=N($(),1);P();var Gs=3,NN="shushugo-weekly-report-updated",jd=()=>{(0,gn.getDatabase)().run(`
    CREATE TABLE IF NOT EXISTS weekly_reports (
      week_start TEXT PRIMARY KEY,
      week_end TEXT NOT NULL,
      generated_at INTEGER NOT NULL,
      schema_version INTEGER NOT NULL DEFAULT 3,
      content_json TEXT NOT NULL,
      read_at INTEGER,
      source_revision TEXT,
      sync_updated_at TEXT,
      sync_origin_device TEXT
    )
  `);let e=p("PRAGMA table_info(weekly_reports)").map(t=>String(t.name??""));e.includes("source_revision")||(0,gn.getDatabase)().run("ALTER TABLE weekly_reports ADD COLUMN source_revision TEXT"),e.includes("sync_updated_at")||(0,gn.getDatabase)().run("ALTER TABLE weekly_reports ADD COLUMN sync_updated_at TEXT"),e.includes("sync_origin_device")||(0,gn.getDatabase)().run("ALTER TABLE weekly_reports ADD COLUMN sync_origin_device TEXT")},zC=()=>{let e=[],t=[["reviews","SELECT COUNT(*) count, COALESCE(MAX(id), 0) max_id, COALESCE(MAX(created_at), '') max_at FROM reviews"],["grammar_reviews","SELECT COUNT(*) count, COALESCE(MAX(id), 0) max_id, COALESCE(MAX(created_at), '') max_at FROM grammar_reviews"],["grammar_activity_events","SELECT COUNT(*) count, COALESCE(MAX(id), 0) max_id, COALESCE(MAX(created_at), '') max_at FROM grammar_activity_events"],["kanji_unit_reviews","SELECT COUNT(*) count, COALESCE(MAX(id), 0) max_id, COALESCE(MAX(created_at), '') max_at FROM kanji_unit_reviews"],["word_study_time","SELECT COUNT(*) count, COALESCE(SUM(seconds), 0) total FROM word_study_time"],["study_time_by_period","SELECT COUNT(*) count, COALESCE(SUM(seconds), 0) total FROM study_time_by_period"]];for(let[r,n]of t)try{let o=p("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",[r]).length?p(n)[0]:null;e.push(`${r}:${JSON.stringify(o??null)}`)}catch{e.push(`${r}:null`)}return e.join("|")},RN=e=>{try{let t=JSON.parse(String(e.content_json??"")),r=LN(t);return!r?.window?.start||!r?.metrics?null:{schemaVersion:Number(e.schema_version??Gs),generatedAt:Number(e.generated_at??0),readAt:e.read_at==null?null:Number(e.read_at),sourceRevision:e.source_revision==null?void 0:String(e.source_revision),report:r}}catch{return null}},bN=e=>{let t=e.getFullYear(),r=String(e.getMonth()+1).padStart(2,"0"),n=String(e.getDate()).padStart(2,"0");return`${t}-${r}-${n}`},Wd=e=>{let t=Number(e);return Number.isFinite(t)?t:0},VC=e=>{let r=(Array.isArray(e.metrics?.daily)?e.metrics.daily:[]).map(i=>({...i,date:String(i.date??""),reviews:Wd(i.reviews),newWords:Wd(i.newWords),seconds:Wd(i.seconds)}));if(r.length<=7)return r;let n=bN(new Date(e.window.endAt-1)),o=r.findIndex(i=>i.date===e.window.start),s=r.findIndex(i=>i.date===n&&i.date!==e.window.start);return o>=0&&s>=0&&(r[o]={...r[o],reviews:r[o].reviews+r[s].reviews,newWords:r[o].newWords+r[s].newWords,seconds:r[o].seconds+r[s].seconds},r.splice(s,1)),r.slice(0,7)},LN=e=>{let t=VC(e),r=Wd(e.metrics?.days),n=e.highlight??null,o=bN(new Date(e.window.endAt-1));return{...e,metrics:{...e.metrics,days:Math.min(Math.max(r,0),7),daily:t},highlight:n&&n.date===o?{...n,date:e.window.start}:n,revisitWords:e.revisitWords??[]}};function $d(e){jd();let t=p("SELECT schema_version, generated_at, content_json, read_at, source_revision FROM weekly_reports WHERE week_start = ?",[e])[0];return t?RN(t):null}function ON(){return jd(),p("SELECT schema_version, generated_at, content_json, read_at, source_revision FROM weekly_reports ORDER BY week_start DESC").flatMap(e=>{let t=RN(e);return t?[t]:[]})}function IE(e,t=Date.now()){jd();let r=LN(e),o=$d(r.window.start)?.readAt??null,s=zC();return(0,gn.getDatabase)().run(`
    INSERT INTO weekly_reports
      (week_start, week_end, generated_at, schema_version, content_json, read_at, source_revision, sync_updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(week_start) DO UPDATE SET
      week_end = excluded.week_end,
      generated_at = excluded.generated_at,
      schema_version = excluded.schema_version,
      content_json = excluded.content_json,
      read_at = excluded.read_at,
      source_revision = excluded.source_revision,
      sync_updated_at = excluded.sync_updated_at
  `,[r.window.start,r.window.end,t,Gs,JSON.stringify(r),o,s,new Date().toISOString()]),typeof window<"u"&&window.dispatchEvent(new Event(NN)),{schemaVersion:Gs,generatedAt:t,readAt:o,sourceRevision:s,report:r}}function AN(e="local",t=0,r=new Date,n=!1){let o=wo(r,t),s=$d(o.start);if(s&&s.schemaVersion>=Gs&&(!n||s.readAt!=null))return s;let i=Ud(e,t,r);return Fd(i.metrics)?IE(i):null}function JC(e="local",t=new Date,r=!1){return AN(e,0,t,r)}function qC(e,t=Date.now()){jd();let r=p("SELECT read_at FROM weekly_reports WHERE week_start = ? LIMIT 1",[e])[0];return!r||r.read_at!=null?!1:((0,gn.getDatabase)().run("UPDATE weekly_reports SET read_at = ?, sync_updated_at = ? WHERE week_start = ?",[t,new Date().toISOString(),e]),!0)}var hN=12,QC=3;function ZC(e="local",t={}){let r=Math.max(1,Math.min(hN,t.maxWeeks??6)),n=t.now??new Date,o=0,s=0,i=0;for(let a=0;a<r;a+=1){let d=wo(n,-a);if(s+=1,$d(d.start)){i=0;continue}let u=Ud(e,-a,n);if(!Fd(u.metrics)){if(i+=1,i>=QC)break;continue}IE(u),o+=1,i=0}return{generated:o,scanned:s,stoppedByLimit:s>=r}}var eD=600*60*1e3;function tD(e=new Date){let t=ON()[0]??null;if(!t)return{state:"none",weekStart:null};let r=t.report.window.start;if(t.readAt!=null)return{state:"read",weekStart:r};let n=t.report.window.endAt,o=e.getTime();return!Number.isFinite(n)||o<n?{state:"none",weekStart:r}:o>=n+eD?{state:"expired",weekStart:r}:{state:"new",weekStart:r}}var kN=e=>{let t=new Date(e.endAt);return`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`},rD=e=>{let t=r=>{let[,n,o]=r.split("-");return`${Number(n)} \u6708 ${Number(o)} \u65E5`};return`${t(e.start)} 14:00\u2014${t(kN(e))} 14:00`},nD=e=>{let t=r=>{let[,n,o]=r.split("-");return`${Number(n)}/${Number(o)}`};return`${t(e.start)}\u2014${t(kN(e))}`};Sm();_t();Ja();hs();Tn();pe();var gD=N(mE());var UE={};x(UE,{ACHIEVEMENTS:()=>Wr,CATEGORY_ORDER:()=>vN,TIER_LABEL:()=>CN,achievementBoard:()=>cD,achievementSummary:()=>mD,evaluateAchievements:()=>lD,unlockedAchievementIds:()=>dD});var MN=N($(),1);P();G();var Wr=[{id:"first-know",name:"\u5F00\u5F20",description:"\u7B54\u5BF9\u7B2C\u4E00\u4E2A\u8BCD",category:"\u8D77\u6B65",tier:"common",goal:1,value:e=>e.totalKnow},{id:"first-note",name:"\u597D\u8BB0\u6027\u4E0D\u5982\u70C2\u7B14\u5934",description:"\u7ED9\u67D0\u4E2A\u8BCD\u5199\u4E0B\u7B2C\u4E00\u6761\u4FBF\u7B7E",category:"\u8D77\u6B65",tier:"common",goal:1,value:e=>e.notes},{id:"first-confusion",name:"\u660E\u5BDF\u79CB\u6BEB",description:"\u5728\u7591\u96BE\u8FA8\u6790\u91CC\u6807\u638C\u63E1\u7B2C\u4E00\u7EC4",category:"\u8D77\u6B65",tier:"common",goal:1,value:e=>e.confusionMastered},{id:"first-kanji",name:"\u8BA4\u5B57",description:"\u5F00\u59CB\u6C49\u5B57\u8BFB\u97F3\u6A21\u5F0F",category:"\u8D77\u6B65",tier:"common",goal:1,value:e=>e.kanjiWords},{id:"first-reverse",name:"\u53CD\u8FC7\u6765",description:"\u7528\u4E00\u6B21\u53CD\u5411\u6A21\u5F0F\uFF1A\u770B\u7740\u4E2D\u6587\u5199\u65E5\u8BED",category:"\u8D77\u6B65",tier:"common",goal:1,value:e=>e.reverseReviews},{id:"words-100",name:"\u767E\u8BCD\u65A9",description:"100 \u4E2A\u8BCD\u8FDB\u5165\u590D\u4E60",category:"\u91CC\u7A0B\u7891",tier:"common",goal:100,value:e=>e.distinctWords},{id:"words-1000",name:"\u5343\u8BCD\u65A9",description:"1,000 \u4E2A\u8BCD\u8FDB\u5165\u590D\u4E60",category:"\u91CC\u7A0B\u7891",tier:"common",goal:1e3,value:e=>e.distinctWords},{id:"words-3000",name:"\u4E09\u5343\u9662",description:"3,000 \u4E2A\u8BCD\u8FDB\u5165\u590D\u4E60",category:"\u91CC\u7A0B\u7891",tier:"rare",goal:3e3,value:e=>e.distinctWords},{id:"reviews-10000",name:"\u4E00\u4E07\u6B21",description:"\u7D2F\u8BA1\u4F5C\u7B54 10,000 \u6B21",category:"\u91CC\u7A0B\u7891",tier:"common",goal:1e4,value:e=>e.totalReviews},{id:"reviews-50000",name:"\u4E94\u4E07\u6B21",description:"\u7D2F\u8BA1\u4F5C\u7B54 50,000 \u6B21",category:"\u91CC\u7A0B\u7891",tier:"epic",goal:5e4,value:e=>e.totalReviews},{id:"mastered-10",name:"\u7B2C\u4E00\u6279\u6BD5\u4E1A\u751F",description:"10 \u4E2A\u8BCD\u7684\u590D\u4E60\u95F4\u9694\u62C9\u5230 180 \u5929\u4EE5\u4E0A",category:"\u91CC\u7A0B\u7891",tier:"common",goal:10,value:e=>e.masteredWords},{id:"mastered-100",name:"\u9000\u4F11\u540D\u5355",description:"100 \u4E2A\u8BCD\u7684\u590D\u4E60\u95F4\u9694\u62C9\u5230 180 \u5929\u4EE5\u4E0A",category:"\u91CC\u7A0B\u7891",tier:"rare",goal:100,value:e=>e.masteredWords},{id:"hours-100",name:"\u4E00\u767E\u5C0F\u65F6",description:"\u7D2F\u8BA1\u5B66\u4E60\u6EE1 100 \u5C0F\u65F6",category:"\u91CC\u7A0B\u7891",tier:"rare",goal:6e3,value:e=>e.minutesTotal},{id:"one-year",name:"\u4E00\u5468\u5E74",description:"\u4ECE\u7B2C\u4E00\u6B21\u5B66\u4E60\u90A3\u5929\u8D77\u6EE1 365 \u5929",category:"\u91CC\u7A0B\u7891",tier:"rare",goal:365,value:e=>e.daysSinceFirst},{id:"streak-7",name:"\u4E00\u5468\u4E0D\u65AD",description:"\u8FDE\u7EED 7 \u5929\u6709\u5B66\u4E60\u8BB0\u5F55",category:"\u6BC5\u529B",tier:"common",goal:7,value:e=>e.longestDayStreak},{id:"streak-30",name:"\u6EE1\u6708",description:"\u8FDE\u7EED 30 \u5929\u6709\u5B66\u4E60\u8BB0\u5F55",category:"\u6BC5\u529B",tier:"rare",goal:30,value:e=>e.longestDayStreak},{id:"streak-100",name:"\u767E\u65E5",description:"\u8FDE\u7EED 100 \u5929\u6709\u5B66\u4E60\u8BB0\u5F55",category:"\u6BC5\u529B",tier:"epic",goal:100,value:e=>e.longestDayStreak},{id:"comeback-7",name:"\u5F52\u961F",description:"\u65AD\u4E86\u4E00\u5468\u4EE5\u4E0A\uFF0C\u53C8\u56DE\u6765\u4E86",category:"\u6BC5\u529B",tier:"common",goal:7,value:e=>e.longestComebackGap},{id:"comeback-30",name:"\u4E45\u522B\u91CD\u9022",description:"\u65AD\u4E86\u4E00\u4E2A\u6708\u4EE5\u4E0A\uFF0C\u53C8\u56DE\u6765\u4E86",category:"\u6BC5\u529B",tier:"rare",hidden:!0,goal:30,value:e=>e.longestComebackGap},{id:"five-minutes",name:"\u4E94\u5206\u949F\u4E5F\u662F\u5B66",description:"\u6709\u4E00\u5929\u53EA\u5B66\u4E86\u4E0D\u5230\u4E94\u5206\u949F \u2014\u2014 \u4F46\u6CA1\u65AD",category:"\u6BC5\u529B",tier:"common",goal:1,value:e=>e.shortestStudyDayMinutes>0&&e.shortestStudyDayMinutes<5?1:0},{id:"day-1000",name:"\u4E00\u65E5\u5343\u8BCD",description:"\u5355\u65E5\u4F5C\u7B54 1,000 \u6B21",category:"\u6BC5\u529B",tier:"rare",goal:1e3,value:e=>e.maxReviewsInDay},{id:"marathon",name:"\u9A6C\u62C9\u677E",description:"\u5355\u65E5\u5B66\u4E60\u65F6\u957F\u6EE1 8 \u5C0F\u65F6",category:"\u6BC5\u529B",tier:"epic",goal:480,value:e=>e.maxMinutesInDay},{id:"know-streak-25",name:"\u987A\u98CE\u5C40",description:"\u8FDE\u7740\u7B54\u5BF9 25 \u6B21",category:"\u624B\u611F",tier:"common",goal:25,value:e=>e.longestKnowStreak},{id:"know-streak-50",name:"\u4E00\u6C14\u5475\u6210",description:"\u8FDE\u7740\u7B54\u5BF9 50 \u6B21",category:"\u624B\u611F",tier:"rare",goal:50,value:e=>e.longestKnowStreak},{id:"accuracy-90",name:"\u7A33\u5982\u8001\u72D7",description:"\u67D0\u5929\u7B54\u6EE1 100 \u6B21\uFF0C\u6B63\u786E\u7387\u8FD8\u6709\u4E5D\u6210",category:"\u624B\u611F",tier:"rare",goal:90,value:e=>Math.floor(e.bestDailyAccuracy*100)},{id:"known-forever-20",name:"\u65AD\u820D\u79BB",description:"\u4E00\u5929\u91CC\u70B9 20 \u6B21\u300C\u719F\u77E5\u300D\uFF0C\u628A\u8BCD\u8BF7\u51FA\u590D\u4E60\u961F\u5217",category:"\u624B\u611F",tier:"common",goal:20,value:e=>e.maxKnownForeverInDay},{id:"forgot-streak-10",name:"\u5148\u51B7\u9759",description:"\u8FDE\u7740\u70B9\u4E86 10 \u6B21\u300C\u5FD8\u8BB0\u300D\u3002\u559D\u53E3\u6C34\uFF0C\u8FD9\u4E0D\u602A\u4F60",category:"\u7FFB\u8F66",tier:"common",goal:10,value:e=>e.longestForgotStreak},{id:"forgot-streak-20",name:"\u518D\u51B7\u9759\u4E00\u70B9",description:"\u8FDE\u7740\u70B9\u4E86 20 \u6B21\u300C\u5FD8\u8BB0\u300D\u3002\u771F\u7684\uFF0C\u53BB\u7761\u5427",category:"\u7FFB\u8F66",tier:"rare",goal:20,value:e=>e.longestForgotStreak},{id:"leech-1",name:"\u8FD9\u8BCD\u8DDF\u6211\u6709\u4EC7",description:"\u6709\u4E00\u4E2A\u8BCD\u88AB\u4F60\u5FD8\u4E86\u6574\u6574 8 \u6B21",category:"\u7FFB\u8F66",tier:"common",goal:1,value:e=>e.leeches},{id:"leech-100",name:"\u4EC7\u4EBA\u540D\u5355",description:"100 \u4E2A\u8BCD\u5404\u88AB\u4F60\u5FD8\u4E86 8 \u6B21\u4EE5\u4E0A",category:"\u7FFB\u8F66",tier:"rare",goal:100,value:e=>e.leeches},{id:"relapse-forever",name:"\u6211\u660E\u660E\u80CC\u8FC7",description:"\u70B9\u8FC7\u300C\u719F\u77E5\u300D\u7684\u8BCD\uFF0C\u540E\u6765\u53C8\u5FD8\u4E86",category:"\u7FFB\u8F66",tier:"common",goal:1,value:e=>e.relapsedForever},{id:"fuzzy-half",name:"\u5047\u88C5\u5728\u5B66",description:"\u67D0\u5929\u7B54\u4E86 50 \u6B21\u4EE5\u4E0A\uFF0C\u4E00\u534A\u90FD\u70B9\u7684\u300C\u6A21\u7CCA\u300D",category:"\u7FFB\u8F66",tier:"common",goal:50,value:e=>Math.floor(e.worstDailyFuzzyShare*100)},{id:"thrice-a-day",name:"\u4E8C\u8FDB\u5BAB",description:"\u540C\u4E00\u4E2A\u8BCD\uFF0C\u5728\u540C\u4E00\u5929\u91CC\u88AB\u4F60\u5FD8\u4E86\u4E09\u6B21",category:"\u7FFB\u8F66",tier:"common",goal:1,value:e=>e.thriceForgotSameDay},{id:"backlog-500",name:"\u9E35\u9E1F",description:"\u5230\u671F\u6C60\u79EF\u538B\u5230 500 \u4E2A",category:"\u7FFB\u8F66",tier:"common",goal:500,value:e=>e.dueBacklog},{id:"backlog-1000",name:"\u503A\u53F0\u9AD8\u7B51",description:"\u5230\u671F\u6C60\u79EF\u538B\u5230 1,000 \u4E2A",category:"\u7FFB\u8F66",tier:"rare",goal:1e3,value:e=>e.dueBacklog},{id:"ghosted",name:"\u5931\u8054",description:"\u6574\u6574\u4E24\u5468\u6CA1\u6253\u5F00\u8FC7 \u2014\u2014 \u73B0\u5728\u56DE\u6765\u4E86\u5C31\u4E0D\u7B97\u6570\u4E86",category:"\u7FFB\u8F66",tier:"common",hidden:!0,goal:14,value:e=>e.longestComebackGap},{id:"night-100",name:"\u591C\u732B\u5B50",description:"\u534A\u591C 0 \u70B9\u5230 4 \u70B9\u4E4B\u95F4\u7B54\u8FC7 100 \u6B21",category:"\u602A\u7656",tier:"common",goal:100,value:e=>e.nightReviews},{id:"night-1000",name:"\u4E0E\u6708\u4EAE\u4E3A\u4F34",description:"\u534A\u591C 0 \u70B9\u5230 4 \u70B9\u4E4B\u95F4\u7B54\u8FC7 1,000 \u6B21",category:"\u602A\u7656",tier:"rare",goal:1e3,value:e=>e.nightReviews},{id:"early-50",name:"\u65E9\u8D77\u7684\u9E1F",description:"\u65E9\u4E0A 5 \u70B9\u5230 8 \u70B9\u4E4B\u95F4\u7B54\u8FC7 50 \u6B21",category:"\u602A\u7656",tier:"common",goal:50,value:e=>e.earlyReviews},{id:"day-and-night",name:"\u663C\u591C\u4E0D\u5206",description:"\u540C\u4E00\u5929\u91CC\uFF0C\u51CC\u6668\u4E09\u70B9\u548C\u65E9\u4E0A\u4E03\u70B9\u4F60\u90FD\u5728\u7B54\u9898",category:"\u602A\u7656",tier:"epic",hidden:!0,goal:1,value:e=>e.dayAndNight},{id:"burst",name:"\u624B\u901F",description:"\u540C\u4E00\u79D2\u91CC\u7B54\u6389\u4E86 5 \u5F20\u5361",category:"\u602A\u7656",tier:"common",hidden:!0,goal:5,value:e=>e.sameSecondBurst},{id:"new-year",name:"\u5143\u65E6\u4E5F\u5B66",description:"1 \u6708 1 \u65E5\u90A3\u5929\u4F60\u5728\u80CC\u5355\u8BCD",category:"\u602A\u7656",tier:"rare",hidden:!0,goal:1,value:e=>e.studiedOnNewYear},{id:"leap-day",name:"\u95F0\u65E5",description:"2 \u6708 29 \u65E5\u90A3\u5929\u4F60\u5728\u80CC\u5355\u8BCD\u3002\u4E0B\u6B21\u673A\u4F1A\u56DB\u5E74\u540E",category:"\u602A\u7656",tier:"epic",hidden:!0,goal:1,value:e=>e.studiedOnLeapDay},{id:"notes-50",name:"\u7B14\u8BB0\u72C2\u9B54",description:"\u5199\u4E0B 50 \u6761\u4FBF\u7B7E",category:"\u6DF1\u6316",tier:"rare",goal:50,value:e=>e.notes},{id:"confusion-100",name:"\u8FA8\u6790\u5927\u5E08",description:"\u5728\u7591\u96BE\u8FA8\u6790\u91CC\u6807\u638C\u63E1 100 \u7EC4",category:"\u6DF1\u6316",tier:"rare",goal:100,value:e=>e.confusionMastered},{id:"favorites-50",name:"\u6536\u85CF\u5BB6",description:"\u6536\u85CF 50 \u4E2A\u8BCD",category:"\u6DF1\u6316",tier:"common",goal:50,value:e=>e.favorites},{id:"all-three",name:"\u5168\u5BB6\u6876",description:"\u5355\u8BCD\u3001\u6C49\u5B57\u3001\u8BED\u6CD5\u4E09\u6761\u7EBF\u90FD\u5F00\u8FC7",category:"\u6DF1\u6316",tier:"rare",goal:3,value:e=>(e.distinctWords>0?1:0)+(e.kanjiWords>0?1:0)+(e.grammarPoints>0?1:0)}],vN=["\u8D77\u6B65","\u91CC\u7A0B\u7891","\u6BC5\u529B","\u624B\u611F","\u7FFB\u8F66","\u602A\u7656","\u6DF1\u6316"],CN={common:"\u5E38\u89C4",rare:"\u7A00\u6709",epic:"\u53F2\u8BD7"};P();Te();var oD=e=>{try{return p(e)}catch{return[]}},V=(e,t=[])=>{try{return Number(E(e,t,0)??0)}catch{return 0}},sD=()=>{let e=-new Date().getTimezoneOffset();return`${e>=0?"+":"-"}${Math.abs(e)} minutes`},DN=e=>V(`
  WITH ordered AS (SELECT answer, ROW_NUMBER() OVER (ORDER BY id) AS rn FROM reviews),
  grouped AS (
    SELECT answer, rn - ROW_NUMBER() OVER (PARTITION BY answer ORDER BY rn) AS island
    FROM ordered
  )
  SELECT COALESCE(MAX(runs.streak), 0) FROM (
    SELECT COUNT(*) AS streak FROM grouped WHERE answer = ? GROUP BY island
  ) AS runs
`,[e]),iD=()=>{let e=oD(`
    SELECT day FROM (
      SELECT DISTINCT reviewed_on AS day FROM reviews
      UNION
      SELECT studied_on AS day FROM word_study_time WHERE seconds > 0
    ) WHERE day IS NOT NULL AND day <> '' ORDER BY day
  `).map(o=>String(o.day)),t=e.length?1:0,r=e.length?1:0,n=0;for(let o=1;o<e.length;o+=1){let s=Date.parse(`${e[o-1]}T00:00:00Z`),i=Math.round((Date.parse(`${e[o]}T00:00:00Z`)-s)/864e5);i===1?(r+=1,t=Math.max(t,r)):(r=1,n=Math.max(n,i-1))}return{longest:t,longestGap:n}},aD=e=>{let t=new Map,r={};return Object.keys(e).forEach(n=>{Object.defineProperty(r,n,{enumerable:!0,get:()=>(t.has(n)||t.set(n,e[n]()),t.get(n))})}),r},xE=()=>{let t=`CAST(strftime('%H', datetime(created_at, '${sD()}')) AS INTEGER)`,r=null,n=()=>r??(r=iD());return aD({totalReviews:()=>V("SELECT COUNT(*) FROM reviews"),totalKnow:()=>V("SELECT COUNT(*) FROM reviews WHERE answer IN ('know','known_forever')"),knownForeverTotal:()=>V("SELECT COUNT(*) FROM reviews WHERE answer = 'known_forever'"),distinctWords:()=>V("SELECT COUNT(DISTINCT word_id) FROM reviews"),longestKnowStreak:()=>DN("know"),longestForgotStreak:()=>DN("forgot"),studyDays:()=>V(`
      SELECT COUNT(*) FROM (
        SELECT reviewed_on AS day FROM reviews
        UNION
        SELECT studied_on FROM word_study_time WHERE seconds > 0
      )
    `),longestDayStreak:()=>n().longest,longestComebackGap:()=>n().longestGap,nightReviews:()=>V(`SELECT COUNT(*) FROM reviews WHERE ${t} BETWEEN 0 AND 3`),earlyReviews:()=>V(`SELECT COUNT(*) FROM reviews WHERE ${t} BETWEEN 5 AND 7`),maxReviewsInDay:()=>V("SELECT COALESCE(MAX(n),0) FROM (SELECT COUNT(*) AS n FROM reviews GROUP BY reviewed_on)"),maxMinutesInDay:()=>V("SELECT COALESCE(MAX(seconds),0)/60 FROM word_study_time"),minutesTotal:()=>V("SELECT COALESCE(SUM(seconds),0)/60 FROM word_study_time"),shortestStudyDayMinutes:()=>V(`
      SELECT COALESCE(MIN(seconds), 0)/60 FROM word_study_time WHERE seconds > 0
    `),bestDailyAccuracy:()=>V(`
      SELECT COALESCE(MAX(rate), 0) FROM (
        SELECT SUM(CASE WHEN answer IN ('know','known_forever') THEN 1.0 ELSE 0 END) / COUNT(*) AS rate
        FROM reviews GROUP BY reviewed_on HAVING COUNT(*) >= 100
      )
    `),worstDailyFuzzyShare:()=>V(`
      SELECT COALESCE(MAX(share), 0) FROM (
        SELECT SUM(CASE WHEN answer = 'fuzzy' THEN 1.0 ELSE 0 END) / COUNT(*) AS share
        FROM reviews GROUP BY reviewed_on HAVING COUNT(*) >= 50
      )
    `),maxKnownForeverInDay:()=>V(`
      SELECT COALESCE(MAX(n), 0) FROM (
        SELECT COUNT(*) AS n FROM reviews WHERE answer = 'known_forever' GROUP BY reviewed_on
      )
    `),masteredWords:()=>V(`
      SELECT COUNT(*) FROM progress
      WHERE fsrs_due IS NOT NULL AND fsrs_last_review IS NOT NULL
        AND julianday(fsrs_due) - julianday(fsrs_last_review) >= 180
    `),leeches:()=>V("SELECT COUNT(*) FROM progress WHERE COALESCE(fsrs_lapses, 0) >= 8"),relapsedForever:()=>V(`
      SELECT COUNT(*) FROM (
        SELECT word_id FROM reviews WHERE answer = 'known_forever'
        INTERSECT
        SELECT word_id FROM reviews WHERE answer = 'forgot'
          AND id > (SELECT MIN(id) FROM reviews r2 WHERE r2.word_id = reviews.word_id AND r2.answer = 'known_forever')
      )
    `),thriceForgotSameDay:()=>V(`
      SELECT COUNT(*) FROM (
        SELECT word_id FROM reviews WHERE answer = 'forgot'
        GROUP BY word_id, reviewed_on HAVING COUNT(*) >= 3
      )
    `),dueBacklog:()=>V(`SELECT COUNT(*) FROM progress WHERE fsrs_due IS NOT NULL AND date(fsrs_due) <= date('now','localtime')
      AND ${te("words","progress.word_id")}`),notes:()=>V("SELECT COUNT(*) FROM word_notes WHERE TRIM(note) <> ''"),confusionMastered:()=>V("SELECT COUNT(*) FROM confusion_mastered"),favorites:()=>V("SELECT COUNT(*) FROM content_favorites"),reverseReviews:()=>V("SELECT COUNT(*) FROM reviews WHERE direction <> 'forward'"),kanjiWords:()=>V("SELECT COUNT(*) FROM kanji_reading_memory WHERE seen_count > 0"),grammarPoints:()=>V("SELECT COUNT(*) FROM grammar_progress"),daysSinceFirst:()=>V(`
      SELECT COALESCE(CAST(julianday('now','localtime') - julianday(MIN(reviewed_on)) AS INTEGER), 0) FROM reviews
    `),studiedOnNewYear:()=>V("SELECT COUNT(*) FROM reviews WHERE strftime('%m-%d', reviewed_on) = '01-01'"),studiedOnLeapDay:()=>V("SELECT COUNT(*) FROM reviews WHERE strftime('%m-%d', reviewed_on) = '02-29'"),sameSecondBurst:()=>V(`
      SELECT COALESCE(MAX(n), 0) FROM (
        SELECT COUNT(*) AS n FROM reviews GROUP BY created_at
      )
    `),dayAndNight:()=>V(`
      SELECT COUNT(*) FROM (
        SELECT reviewed_on FROM reviews
        GROUP BY reviewed_on
        HAVING SUM(CASE WHEN ${t} = 3 THEN 1 ELSE 0 END) > 0
           AND SUM(CASE WHEN ${t} = 7 THEN 1 ELSE 0 END) > 0
      )
    `)})};var Pd=()=>{q();let e=new Map;return p("SELECT id, unlocked_on FROM achievements").forEach(t=>{e.set(String(t.id??""),String(t.unlocked_on??""))}),e},dD=()=>new Set(Pd().keys()),IN=0,uD=6e4,xN=(e,t)=>{let r=Wr.filter(i=>!t.has(i.id));if(!r.length)return[];let n=r.filter(i=>i.value(e)>=i.goal);if(!n.length)return[];let o=(0,MN.getDatabase)(),s=new Date().toLocaleDateString("sv");return n.forEach(i=>{o.run("INSERT OR IGNORE INTO achievements (id, unlocked_on) VALUES (?, ?)",[i.id,s]),t.set(i.id,s)}),D(),n},lD=(e={})=>{let t=Date.now();return!e.force&&t-IN<uD?[]:(IN=t,xN(xE(),Pd()))},cD=()=>{let e=Pd(),t=xE();return xN(t,e),{items:Wr.map(n=>{let o=Math.max(0,Math.min(n.goal,Math.floor(n.value(t))));return{...n,unlocked:e.has(n.id),unlockedOn:e.get(n.id)??null,progress:o}}),unlocked:e.size,total:Wr.length}},mD=()=>{let e=Pd(),t=new Map(Wr.map(n=>[n.id,n])),r=[...e.entries()].sort((n,o)=>o[1].localeCompare(n[1])).map(([n])=>t.get(n)).filter(n=>!!n).slice(0,3);return{unlocked:e.size,total:Wr.length,recent:r}};Mt();var FE={};x(FE,{studyTotals:()=>pD});P();var pD=()=>{let e=E("SELECT SUM(seconds) FROM word_study_time",[],0)??0,t=E(`
    SELECT COUNT(*) FROM (
      SELECT studied_on AS day FROM word_study_time WHERE seconds > 0
      UNION
      SELECT reviewed_on AS day FROM reviews
    )
  `,[],0)??0;return{minutes:Math.floor(e/60),days:t}};
