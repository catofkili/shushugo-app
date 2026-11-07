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

var mR=Object.create;var ei=Object.defineProperty;var pR=Object.getOwnPropertyDescriptor;var ER=Object.getOwnPropertyNames;var fR=Object.getPrototypeOf,gR=Object.prototype.hasOwnProperty;var h=(e,t)=>()=>(e&&(t=e(e=0)),t);var le=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports),M=(e,t)=>{for(var r in t)ei(e,r,{get:t[r],enumerable:!0})},lf=(e,t,r,n)=>{if(t&&typeof t=="object"||typeof t=="function")for(let o of ER(t))!gR.call(e,o)&&o!==r&&ei(e,o,{get:()=>t[o],enumerable:!(n=pR(t,o))||n.enumerable});return e};var N=(e,t,r)=>(r=e!=null?mR(fR(e)):{},lf(t||!e||!e.__esModule?ei(r,"default",{value:e,enumerable:!0}):r,e)),_R=e=>lf(ei({},"__esModule",{value:!0}),e);var $=le((JD,mf)=>{var ti=null,wR=()=>require("../runtime/database-store"),ri=()=>ti||wR().getDatabase(),cf=()=>ri().constructor;mf.exports={getDatabase:ri,openDatabase:async e=>new(cf())(e),createDatabase:async()=>new(cf()),exportDatabase:()=>ri().export(),initDatabase:async()=>ri(),withDatabase(e,t){let r=ti;ti=e;try{return t()}finally{ti=r}}}});var ni,No,yn,Gr=h(()=>{"use strict";ni=e=>e.t===0?"core":e.t===2?"optional":"common",No=e=>`${e} IN (SELECT id FROM words WHERE pos = '\u56FA\u5B9A\u642D\u914D' AND collocation_tier = 2)`,yn=e=>`CASE
  WHEN ${e} IN (SELECT id FROM words WHERE pos = '\u56FA\u5B9A\u642D\u914D' AND collocation_tier = 0) THEN 0
  WHEN ${No(e)} THEN 3
  WHEN ${e} IN (SELECT id FROM words WHERE pos = '\u56FA\u5B9A\u642D\u914D') THEN 2 ELSE 1 END`});var nu={};M(nu,{BACKLOG_SPREAD_DAYS:()=>yR,CONSOLIDATION_DAYS:()=>TR,EXAM_WEEK_DAYS:()=>SR,JLPT_TARGETS:()=>W,MAX_DAILY_NEW_GRAMMAR:()=>eu,MAX_DAILY_NEW_WORDS:()=>Zd,availableShortfall:()=>RR,computeDailyMinimum:()=>tu,consolidationDays:()=>si,daysBetween:()=>Jt,levelsInScope:()=>Tr,shortfallOf:()=>ru,shortfallText:()=>bR});var W,Tr,TR,si,SR,yR,Zd,eu,Jt,NR,oi,tu,ru,RR,bR,wt=h(()=>{"use strict";W=["N5","N4","N3","N2","N1"],Tr=e=>W.slice(0,W.indexOf(e)+1),TR=21,si=e=>e===null?21:Math.max(0,Math.min(21,Math.floor(e/4))),SR=7,yR=7,Zd=50,eu=12,Jt=(e,t)=>{let r=new Date(e.getFullYear(),e.getMonth(),e.getDate()),n=new Date(t.getFullYear(),t.getMonth(),t.getDate());return Math.round((n.getTime()-r.getTime())/864e5)},NR=(e,t)=>e<0?"past":e<=7?"exam-week":e<=t?"consolidate":"intake",oi=(e,t)=>e<=0?0:t<=0?e:Math.ceil(e/t),tu=e=>{let t=Jt(e.today,e.examDate),r=si(e.planStartedOn?Jt(e.planStartedOn,e.examDate):null),n=NR(t,r),o=Math.max(t-r,0),s=n==="intake",i=s?oi(e.unseenWords,o):0,a=s?oi(e.unseenGrammar,o):0,d=Math.max(Math.min(7,t),1),u=n==="past"?0:e.freshDueWords+oi(e.overdueWords,d),l=n==="past"?0:e.freshDueGrammar+oi(e.overdueGrammar,d),c=Math.max(Math.ceil(e.unseenWords/50),Math.ceil(e.unseenGrammar/12));return{daysLeft:t,intakeDaysLeft:o,phase:n,consolidationDays:r,newWords:Math.min(i,50),reviewWords:u,newGrammar:Math.min(a,12),reviewGrammar:l,feasible:e.unseenWords===0&&e.unseenGrammar===0||s&&Math.ceil(e.unseenWords/50)<=o&&Math.ceil(e.unseenGrammar/12)<=o,daysNeeded:c+r}},ru=(e,t)=>{let r=(a,d)=>Math.max(a-d,0),n=r(e.newWords,t.newWordsDone),o=r(e.reviewWords,t.reviewWordsDone),s=r(e.newGrammar,t.newGrammarDone),i=r(e.reviewGrammar,t.reviewGrammarDone);return{newWords:n,reviewWords:o,newGrammar:s,reviewGrammar:i,clear:n+o+s+i===0}},RR=(e,t,r=!1)=>{let n=r?0:e.newWords,o=e.reviewWords,s=t?e.newGrammar:0,i=t?e.reviewGrammar:0;return{newWords:n,reviewWords:o,newGrammar:s,reviewGrammar:i,clear:n+o+s+i===0}},bR=e=>{if(e.clear)return"\u4ECA\u5929\u7684\u6700\u4F4E\u91CF\u5DF2\u7ECF\u505A\u5B8C\u4E86";let t=[];return e.reviewWords>0&&t.push(`\u590D\u4E60 ${e.reviewWords}`),e.newWords>0&&t.push(`\u65B0\u8BCD ${e.newWords}`),e.reviewGrammar>0&&t.push(`\u8BED\u6CD5\u590D\u4E60 ${e.reviewGrammar}`),e.newGrammar>0&&t.push(`\u65B0\u8BED\u6CD5 ${e.newGrammar}`),`\u8FD8\u5DEE ${t.join(" \xB7 ")}`}});var du={};M(du,{EXAM_TYPES:()=>su,announcedExamDates:()=>pf,defaultExamDate:()=>bo,examDatesOfYear:()=>Nn,examEndAt:()=>ii,examLabel:()=>LR,firstSundayOf:()=>ou,formatExamDate:()=>au,formatExamDateHuman:()=>hR,isExamKind:()=>Ro,nextExamDate:()=>iu,nextGaokaoDate:()=>ff,parseExamDate:()=>Dt,suggestedExamDate:()=>Ef,upcomingExamDates:()=>AR});var ou,Nn,su,Ro,LR,OR,pf,Ef,ff,bo,ii,iu,AR,Dt,au,hR,Rn=h(()=>{"use strict";ou=(e,t)=>{let n=(7-new Date(e,t-1,1).getDay())%7;return new Date(e,t-1,1+n)},Nn=e=>[ou(e,7),ou(e,12)],su=[{kind:"jlpt",label:"JLPT"},{kind:"eju",label:"EJU \u7559\u8003"},{kind:"kaoyan",label:"\u8003\u7814\u65E5\u8BED"},{kind:"university",label:"\u5927\u5B66\u65E5\u8BED\u56DB/\u516D\u7EA7"},{kind:"major",label:"\u65E5\u8BED\u4E13\u56DB/\u4E13\u516B"},{kind:"jtest",label:"J.TEST"},{kind:"nat",label:"NAT-TEST"},{kind:"bjt",label:"BJT \u5546\u52A1\u65E5\u8BED"},{kind:"gaokao",label:"\u9AD8\u8003\u65E5\u8BED"},{kind:"other",label:"\u5176\u4ED6\u8003\u8BD5"}],Ro=e=>su.some(t=>t.kind===e),LR=e=>su.find(t=>t.kind===e)?.label??"\u5176\u4ED6\u8003\u8BD5",OR={eju:["2026-11-08"],jtest:["2026-11-01"]},pf=(e,t=new Date)=>(OR[e]??[]).map(r=>Dt(r)).filter(r=>r>=new Date(t.getFullYear(),t.getMonth(),t.getDate())),Ef=(e,t=new Date)=>e==="gaokao"?ff(t):e==="jlpt"?iu(t):pf(e,t)[0]??null,ff=(e=new Date)=>{let t=new Date(e.getFullYear(),5,8);return e>=ii("gaokao",t)?new Date(e.getFullYear()+1,5,8):t},bo=(e,t=new Date)=>Ef(e,t)??new Date(t.getFullYear(),t.getMonth(),t.getDate()-1),ii=(e,t)=>e==="gaokao"?new Date(t.getFullYear(),t.getMonth(),t.getDate(),17):new Date(t.getFullYear(),t.getMonth(),t.getDate()+1),iu=(e=new Date)=>{let t=new Date(e.getFullYear(),e.getMonth(),e.getDate()),r=[...Nn(e.getFullYear()),...Nn(e.getFullYear()+1)];return r.find(n=>n.getTime()>=t.getTime())??r[0]},AR=(e=new Date)=>{let t=iu(e),r=t.getFullYear();return[...Nn(r),...Nn(r+1),...Nn(r+2)].filter(n=>n>=t).slice(0,4)},Dt=e=>{let t=/^(\d{4})-(\d{2})-(\d{2})$/.exec(e.trim());if(!t)return null;let[,r,n,o]=t,s=new Date(Number(r),Number(n)-1,Number(o));return s.getMonth()!==Number(n)-1||s.getDate()!==Number(o)?null:s},au=e=>`${e.getFullYear()}-${String(e.getMonth()+1).padStart(2,"0")}-${String(e.getDate()).padStart(2,"0")}`,hR=e=>`${e.getMonth()+1} \u6708 ${e.getDate()} \u65E5`});var nt=le((ZD,gf)=>{var uu=null;function kR(){uu||(uu=setTimeout(()=>{uu=null;try{Promise.resolve(require("../runtime/database-store").saveDatabase()).catch(e=>{/尚未初始化/.test(String(e&&e.message))||console.warn("[shared] \u843D\u76D8\u5931\u8D25",e)})}catch(e){console.warn("[shared] \u843D\u76D8\u8DF3\u8FC7",e)}},300))}gf.exports={scheduleSave:kR,requestFullSnapshot(){}}});var cu={};M(cu,{daysSince:()=>Oo,firstRow:()=>H,firstValue:()=>E,getState:()=>O,oncePerDatabase:()=>Br,persistContentSoon:()=>Pe,persistSoon:()=>D,rowsFor:()=>p,setState:()=>R,statementCache:()=>lu,studyDate:()=>B,studyDayEnd:()=>A,today:()=>T});function Br(e,t){let r=(0,Lo.getDatabase)(),n=_f.get(r);n||(n=new Set,_f.set(r,n)),!n.has(e)&&(t(),n.add(e))}function E(e,t=[],r){let n=(0,Lo.getDatabase)().prepare(e);try{return t.length&&n.bind(t),n.step()?n.get()[0]:r}finally{n.free()}}function p(e,t=[]){return vR(e,t)}function H(e,t=[]){return p(e,t)[0]??null}function O(e,t){return E("SELECT value FROM app_state WHERE key = ?",[e],t)}function R(e,t){(0,Lo.getDatabase)().run("INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)",[e,t])}function Oo(e){if(!e)return 0;let t=new Date(`${String(e)}T00:00:00`);if(Number.isNaN(t.getTime()))return 0;let r=new Date(`${B()}T00:00:00`);return Math.max(0,Math.floor((r.getTime()-t.getTime())/864e5))}function B(e=new Date){let t=new Date(e);return t.getHours()<4&&t.setDate(t.getDate()-1),CR(t)}function A(e=new Date){let t=new Date(e);return t.getHours()<4||t.setDate(t.getDate()+1),t.setHours(4,0,0,0),t}function D(){Promise.resolve().then(()=>N(nt(),1)).then(({scheduleSave:e})=>e())}function Pe(){Promise.resolve().then(()=>N(nt(),1)).then(({requestFullSnapshot:e,scheduleSave:t})=>{e(),t()})}var Lo,vR,_f,CR,T,lu,P=h(()=>{"use strict";Lo=N($(),1),vR=(e,t=[])=>{let r=(0,Lo.getDatabase)().prepare(e);try{t.length&&r.bind(t);let n=[];for(;r.step();)n.push(r.getAsObject());return n}finally{r.free()}},_f=new WeakMap;CR=e=>{let t=e.getFullYear(),r=String(e.getMonth()+1).padStart(2,"0"),n=String(e.getDate()).padStart(2,"0");return`${t}-${r}-${n}`};T=B;lu=e=>{let t=new Map;return{run(r,n){let o=t.get(r);o||(o=e.prepare(r),t.set(r,o)),o.run(n)},free(){for(let r of t.values())r.free();t.clear()}}}});var yu={};M(yu,{GRAMMAR_INTENSITY_ANCHORS:()=>MR,GRAMMAR_INTENSITY_MAX:()=>Nf,GRAMMAR_INTENSITY_MIN:()=>yf,INTENSITY_ANCHORS:()=>DR,INTENSITY_MAX:()=>Sf,INTENSITY_MIN:()=>IR,LEVEL_ADVANCE_KEY:()=>wu,LEVEL_ADVANCE_PAUSE_MS:()=>bf,MAX_DAILY_REVIEW:()=>ho,PLAN_QUOTA_KEYS:()=>bn,PLAN_REVIEW_DISABLED:()=>Qt,POST_EXAM_LIGHT_DAYS:()=>pu,PREFERENCES_EVENT:()=>Eu,REVIEW_CAP_UNLIMITED:()=>Ln,STUDY_BUDDY_SHELVED:()=>xR,applyMotionLevel:()=>hf,applyTheme:()=>Af,choosePostExamIntensity:()=>PR,defaultStudyPreferences:()=>de,ensureJlptPlanAnchor:()=>KR,getDailyGrammarGoal:()=>Tu,getDailyWordGoal:()=>Zt,getEffectiveStudyPreferences:()=>st,getJlptPlanPreferences:()=>Su,getResolvedTheme:()=>Of,getReviewCapPreference:()=>Xr,getStudyPreferences:()=>Y,isPostExamLightActive:()=>ko,jsMotionAllowed:()=>GR,kanaGatePending:()=>ai,levelAdvanceNewCap:()=>Ao,levelAdvanceTarget:()=>On,levelUnseenContent:()=>Lf,normalizeStudyPreferences:()=>fu,postExamChoice:()=>_u,postExamRecovery:()=>gu,readLevelAdvance:()=>vo,saveStudyPreferences:()=>ot,writeLevelAdvance:()=>HR});var Eu,Tf,DR,IR,Sf,MR,yf,Nf,xR,de,UR,FR,WR,wf,Ln,Qt,ho,jR,mu,fu,Y,$R,bn,ot,ai,pu,Rf,gu,_u,PR,ko,wu,bf,vo,HR,On,Lf,Ao,st,Zt,Tu,Xr,KR,Su,Of,Af,hf,GR,Se=h(()=>{"use strict";wt();Rn();P();He();Eu="shushugo-preferences",Tf="mn-study-preferences",DR=[{value:5,label:"\u8F7B\u677E"},{value:15,label:"\u65E5\u5E38"},{value:30,label:"\u8BA4\u771F"},{value:50,label:"\u51B2\u523A"}],IR=5,Sf=50,MR=[{value:0,label:"\u53EA\u590D\u4E60"},{value:3,label:"\u8F7B\u677E"},{value:5,label:"\u65E5\u5E38"},{value:10,label:"\u8BA4\u771F"}],yf=0,Nf=30,xR=!0,de={theme:"system",autoPlay:!0,showRomaji:!1,showJlptLevel:!1,spellingEnabled:!1,includeOptionalExpressions:!1,dailyGoal:15,grammarDailyGoal:5,reviewCap:0,kanjiDailyGoal:5,confusionDailyGoal:5,grammarReviewCap:0,kanjiReviewCap:0,confusionReviewCap:0,zooSounds:!0,studyBuddy:!0,weeklyReportEnabled:!0,motionLevel:"full",voiceId:"",jlptPlanEnabled:!0,jlptTarget:"N3",planExamKind:"jlpt",jlptExamDate:"",jlptPlanStartedOn:""},UR=["full","reduced","off"],FR=e=>{let t=Number.isFinite(e)?Math.floor(e):de.dailyGoal;return Math.min(Sf,Math.max(0,t))},WR=e=>{let t=Number.isFinite(e)?Math.floor(e):de.grammarDailyGoal;return Math.min(Nf,Math.max(yf,t))},wf=(e,t)=>{let r=Number.isFinite(e)?Math.floor(e):0;return Math.min(t,Math.max(0,r))},Ln=-1,Qt=-1,ho=2e3,jR=e=>Number.isFinite(e)?e<0?Ln:e===0?0:Math.min(ho,Math.max(1,Math.floor(e))):0,mu=e=>{let t=Number.isFinite(e)?Math.floor(e):0;return t===Qt?Qt:Math.min(ho,Math.max(0,t))},fu=(e={})=>({theme:e.theme==="light"||e.theme==="dark"||e.theme==="system"?e.theme:"system",autoPlay:e.autoPlay??de.autoPlay,showRomaji:e.showRomaji??de.showRomaji,showJlptLevel:e.showJlptLevel??de.showJlptLevel,spellingEnabled:e.spellingEnabled===!0,includeOptionalExpressions:e.includeOptionalExpressions===!0,dailyGoal:FR(Number(e.dailyGoal??de.dailyGoal)),grammarDailyGoal:WR(Number(e.grammarDailyGoal??de.grammarDailyGoal)),kanjiDailyGoal:wf(Number(e.kanjiDailyGoal??de.kanjiDailyGoal),50),confusionDailyGoal:wf(Number(e.confusionDailyGoal??de.confusionDailyGoal),20),grammarReviewCap:mu(Number(e.grammarReviewCap??0)),kanjiReviewCap:mu(Number(e.kanjiReviewCap??0)),confusionReviewCap:mu(Number(e.confusionReviewCap??0)),reviewCap:jR(Number(e.reviewCap??de.reviewCap)),zooSounds:e.zooSounds??de.zooSounds,studyBuddy:e.studyBuddy??de.studyBuddy,weeklyReportEnabled:e.weeklyReportEnabled??de.weeklyReportEnabled,motionLevel:UR.includes(e.motionLevel)?e.motionLevel:de.motionLevel,voiceId:typeof e.voiceId=="string"?e.voiceId:de.voiceId,jlptPlanEnabled:e.jlptPlanEnabled??de.jlptPlanEnabled,jlptTarget:W.includes(e.jlptTarget)?e.jlptTarget:de.jlptTarget,planExamKind:Ro(e.planExamKind)?e.planExamKind:"jlpt",jlptExamDate:/^\d{4}-\d{2}-\d{2}$/.test(String(e.jlptExamDate??""))?String(e.jlptExamDate):de.jlptExamDate,jlptPlanStartedOn:/^\d{4}-\d{2}-\d{2}$/.test(String(e.jlptPlanStartedOn??""))?String(e.jlptPlanStartedOn):de.jlptPlanStartedOn}),Y=()=>{try{let e=localStorage.getItem(Tf);return fu(e?JSON.parse(e):{})}catch{return de}},$R=(e=new Date)=>`${e.getFullYear()}-${String(e.getMonth()+1).padStart(2,"0")}-${String(e.getDate()).padStart(2,"0")}`,bn=["dailyGoal","reviewCap","grammarDailyGoal","grammarReviewCap","kanjiDailyGoal","kanjiReviewCap","confusionDailyGoal","confusionReviewCap"],ot=(e,t={})=>{let r=fu(e),n=Y();if(!t.keepPlanAnchor&&(!r.jlptPlanStartedOn||n.jlptTarget!==r.jlptTarget||n.planExamKind!==r.planExamKind||n.jlptExamDate!==r.jlptExamDate)&&(r.jlptPlanStartedOn=$R()),!t.fromLevelPlanSync){let o=!1;try{o=!!O("starting_level","")}catch{}o&&(n.jlptPlanEnabled!==r.jlptPlanEnabled&&R("jlpt_plan_enabled",r.jlptPlanEnabled?"1":"0"),n.jlptTarget!==r.jlptTarget&&R("jlpt_plan_target",r.jlptTarget),n.planExamKind!==r.planExamKind&&R("jlpt_plan_exam_kind",r.planExamKind),n.jlptExamDate!==r.jlptExamDate&&R("jlpt_plan_exam_date",r.jlptExamDate),n.jlptPlanStartedOn!==r.jlptPlanStartedOn&&R("jlpt_plan_started_on",r.jlptPlanStartedOn),bn.some(s=>n[s]!==r[s])&&R("level_plan_quotas",JSON.stringify(Object.fromEntries(bn.map(s=>[s,r[s]])))))}return localStorage.setItem(Tf,JSON.stringify(r)),window.dispatchEvent(new CustomEvent(Eu,{detail:r})),r},ai=()=>{try{return O("starting_level","")==="kana-none"&&O("kana_completed","0")!=="1"}catch{return!1}},pu=7,Rf="post_exam_choice",gu=(e=new Date,t=Y())=>{if(!t.jlptPlanEnabled||t.planExamKind!=="jlpt")return null;let r=Dt(t.jlptPlanStartedOn),n=Dt(t.jlptExamDate)??(r?bo("jlpt",r):null);if(!n||r&&Jt(r,n)<0)return null;let o=Jt(n,e);if(o<1||o>pu)return null;try{if(!t.jlptExamDate&&!O("starting_level",""))return null}catch{return null}return{key:au(n),target:t.jlptTarget,daysLeft:pu-o+1}},_u=e=>{try{let[t,r]=O(Rf,"").split("|");return t===e&&(r==="light"||r==="usual")?r:null}catch{return null}},PR=(e,t)=>R(Rf,`${e}|${t}`),ko=(e=new Date)=>{let t=gu(e);return!!(t&&_u(t.key)!=="usual")},wu="level_advance",bf=10080*60*1e3,vo=()=>{let e=t=>({answered:Array.isArray(t?.answered)?t.answered.filter(r=>W.includes(r)):[],pausedAt:Number.isFinite(t?.pausedAt)&&Number(t?.pausedAt)>0?Number(t?.pausedAt):0,stoppedAt:Number.isFinite(t?.stoppedAt)&&Number(t?.stoppedAt)>0?Number(t?.stoppedAt):0,pausedLevel:t?.pausedLevel&&W.includes(t.pausedLevel)?t.pausedLevel:"",upTo:t?.upTo&&W.includes(t.upTo)?t.upTo:"",backfill:t?.backfill&&W.includes(t.backfill)?t.backfill:""});try{let t=JSON.parse(O(wu,"")||"null");return{words:e(t?.words??t),grammar:e(t?.grammar)}}catch{return{words:e(null),grammar:e(null)}}},HR=e=>R(wu,JSON.stringify(e)),On=e=>W[Math.max(W.indexOf(Y().jlptTarget),W.indexOf(vo()[e].upTo))],Lf=(e,t)=>E(e==="words"?`SELECT COUNT(*) FROM words w LEFT JOIN progress p ON p.word_id = w.id
       WHERE w.jlpt_level = ? AND NOT ${me()} AND ${ye()}`:`SELECT COUNT(*) FROM grammar_points g LEFT JOIN grammar_progress p ON p.grammar_id = g.id
       WHERE g.level = ? AND COALESCE(p.seen_count, 0) = 0 AND COALESCE(p.known_forever, 0) = 0`,[t],0),Ao=(e,t=new Date)=>{let{pausedAt:r,stoppedAt:n,pausedLevel:o}=vo()[e];if(r<=0||o!==On(e))return null;if(n>0)return t.getTime()-n<bf?0:null;try{return Lf(e,o)}catch{return null}},st=(e=new Date)=>{let t=Y(),r=Ao("words",e),n=Ao("grammar",e),o={...t,dailyGoal:r===null?t.dailyGoal:Math.min(t.dailyGoal,r),grammarDailyGoal:n===null?t.grammarDailyGoal:Math.min(t.grammarDailyGoal,n)},s=gu(e,o);if(!s||_u(s.key)==="usual")return o;let i=(d,u)=>d>0?Math.min(d,u):u,a=(d,u)=>d===Qt?d:i(d,u);return{...o,dailyGoal:0,grammarDailyGoal:0,kanjiDailyGoal:0,confusionDailyGoal:0,reviewCap:i(o.reviewCap,60),grammarReviewCap:a(o.grammarReviewCap,10),kanjiReviewCap:a(o.kanjiReviewCap,10),confusionReviewCap:a(o.confusionReviewCap,5)}},Zt=()=>ai()?0:st().dailyGoal,Tu=()=>st().grammarDailyGoal,Xr=()=>st().reviewCap,KR=()=>{let e=Y();e.jlptPlanStartedOn||ot(e)},Su=()=>{let e=Y();return{enabled:e.jlptPlanEnabled,target:e.jlptTarget,examKind:e.planExamKind,examDate:e.jlptExamDate,startedOn:e.jlptPlanStartedOn}},Of=()=>{let e=Y();return e.theme==="light"||e.theme==="dark"?e.theme:window.matchMedia?.("(prefers-color-scheme: dark)").matches?"dark":"light"},Af=()=>{let e=Of();document.documentElement.setAttribute("data-theme",e),console.log("\u2705 Theme applied:",e)},hf=(e=Y().motionLevel)=>{document.documentElement.setAttribute("data-motion",e)},GR=()=>typeof window>"u"||window.matchMedia?.("(prefers-reduced-motion: reduce)").matches?!1:Y().motionLevel==="full";typeof window<"u"&&window.addEventListener(Eu,e=>{let t=e.detail;Af(),hf(t?.motionLevel??Y().motionLevel)})});var me,J,oe,ye,He=h(()=>{"use strict";Gr();Se();me=(e="w")=>`(COALESCE(${e}.pos, '') = '\u56FA\u5B9A\u642D\u914D')`,J=(e="p")=>`(
  COALESCE(${e}.seen_count, 0) > 0 OR ${e}.fsrs_state IS NOT NULL
  OR ${e}.fsrs_due IS NOT NULL OR ${e}.fsrs_stability IS NOT NULL OR ${e}.fsrs_last_review IS NOT NULL
  OR EXISTS (SELECT 1 FROM reviews started_review WHERE started_review.word_id = ${e}.word_id)
)`,oe=(e="w",t="p",r=Y().includeOptionalExpressions)=>r?"1":`(NOT (${No(`${e}.id`)}) OR COALESCE(${t}.known_forever, 0) = 1 OR ${J(t)})`,ye=(e="w",t="p",r=Y().includeOptionalExpressions)=>`(COALESCE(${t}.known_forever, 0) = 0 AND NOT ${J(t)} AND ${oe(e,t,r)})`});var vf,kf=h(()=>{vf=`-- \u51FA\u5382\u5E93/\u65E7\u5907\u4EFD\u5DF2\u6709 words \u65F6\uFF0CCREATE \u4E0D\u8865\u5217\uFF1BensureUserTables \u7684 ALTER \u8D1F\u8D23\u5347\u7EA7\u3002
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
`});function Ru(e){let t=(0,Cf.getDatabase)();e.split(";").map(r=>r.trim()).filter(Boolean).forEach(r=>t.run(r))}function bu(){Ru(Nu)}var Cf,Nu,Df=h(()=>{"use strict";kf();Cf=N($(),1),Nu=vf});function di(e){let t=e.map(o=>typeof o=="string"?o:JSON.stringify(o)).join(""),r=2166136261,n=2654435769;for(let o=0;o<t.length;o+=1){let s=t.charCodeAt(o);r=Math.imul(r^s,16777619),n=Math.imul(n^s,2246822507)}return`${(r>>>0).toString(16).padStart(8,"0")}${(n>>>0).toString(16).padStart(8,"0")}`}function ui(e,t){return p("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'app_state'").length?E("SELECT value FROM app_state WHERE key = ?",[e],"")===t:!1}function li(e,t){R(e,t)}var Lu=h(()=>{"use strict";P()});function VR(){let e=(0,Mf.getDatabase)(),t=H("SELECT * FROM progress WHERE word_id = ?",[Co]),r=H("SELECT * FROM progress WHERE word_id = ?",[An]),n=Number(t?.seen_count??0),o=Number(r?.seen_count??0),i=o>n?An:Co,a=It("reviews")?E("SELECT COUNT(*) FROM reviews WHERE word_id = ?",[An],0):0;if(!Ff())return{migrated:!1,winnerId:i,canonicalSeenCount:n,legacySeenCount:o,movedReviews:0};e.run("BEGIN TRANSACTION");try{ku(e,An,Co),hu(d=>d===An?Co:d),R(Uf,xf),e.run("COMMIT")}catch(d){throw e.run("ROLLBACK"),d}return Pe(),{migrated:!0,winnerId:i,canonicalSeenCount:n,legacySeenCount:o,movedReviews:a}}async function Wf(){if(!Ff())return null;let{saveRecoverySnapshot:e}=await Promise.resolve().then(()=>N(nt(),1)),t=await e("before-biru-2480-to-775"),r=VR();return console.log("[migration] \u30D3\u30EB 2480\u2192775 merged",{...r,recovery:t}),r}var Mf,An,Co,xf,Uf,It,Au,ke,ci,hn,XR,If,YR,Ou,zR,hu,ku,Ff,vu=h(()=>{"use strict";Mf=N($(),1);P();An=2480,Co=775,xf="2026-08-13-biru-2480-to-775-v1",Uf="legacy_biru_merge_version",It=e=>E("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",[e],0)===1,Au=e=>p(`PRAGMA table_info(${e})`).map(t=>String(t.name??"")).filter(Boolean),ke=e=>`"${e.replace(/"/g,'""')}"`,ci=(e,t,r="",n=[])=>E(`SELECT 1 FROM ${ke(e)} WHERE word_id = ?${r} LIMIT 1`,[t,...n],0)===1,hn=(e,t,r,n,o,s="",i=[])=>{if(!It(t)||!ci(t,r,s,i))return;let a=ci(t,n,s,i);if(!a||o){a&&e.run(`DELETE FROM ${ke(t)} WHERE word_id = ?${s}`,[n,...i]);let d=Au(t).filter(l=>l!=="sync_updated_at"&&l!=="sync_origin_device"),u=d.map(l=>l==="word_id"?"?":ke(l));e.run(`INSERT INTO ${ke(t)} (${d.map(ke).join(", ")})
       SELECT ${u.join(", ")}
       FROM ${ke(t)}
       WHERE word_id = ?${s}`,[n,r,...i])}e.run(`DELETE FROM ${ke(t)} WHERE word_id = ?${s}`,[r,...i])},XR=(e,t,r,n,o)=>{if(!It(t))return;p(`SELECT reviewed_on FROM ${ke(t)} WHERE word_id = ? ORDER BY reviewed_on`,[r]).forEach(i=>{hn(e,t,r,n,o," AND reviewed_on = ?",[String(i.reviewed_on??"")])})},If=(e,t,r,n)=>{if(!It(t))return 0;let o=Au(t).filter(a=>a!=="id"&&a!=="sync_updated_at"&&a!=="sync_origin_device"&&a!=="sync_uid");if(!o.includes("word_id"))return 0;let s=p(`SELECT ${o.map(ke).join(", ")} FROM ${ke(t)} WHERE word_id = ?`,[r]);if(!s.length)return 0;e.run(`DELETE FROM ${ke(t)} WHERE word_id = ?`,[r]);let i=`INSERT INTO ${ke(t)} (${o.map(ke).join(", ")}) VALUES (${o.map(()=>"?").join(", ")})`;for(let a of s){let d=o.map(u=>u==="word_id"?n:a[u]);e.run(i,d)}return s.length},YR=(e,t)=>{try{let r=JSON.parse(e);if(!Array.isArray(r))return e;let n=new Map;return r.forEach(o=>{if(!o||typeof o!="object"||Array.isArray(o))return;let s=o,i=Number(s.word_id),a=t(i);if(!Number.isFinite(a))return;let d={...s,word_id:a},u=n.get(a);(!u||Number(d.due_after??0)<Number(u.due_after??0))&&n.set(a,d)}),JSON.stringify([...n.values()])}catch{return e}},Ou=(e,t)=>Array.isArray(e)?e.map(r=>Ou(r,t)):!e||typeof e!="object"?e:Object.fromEntries(Object.entries(e).map(([r,n])=>[r,r==="word_id"&&Number.isFinite(Number(n))?t(Number(n)):Ou(n,t)])),zR=(e,t)=>{let r=O(e,"");if(r)try{R(e,JSON.stringify(Ou(JSON.parse(r),t)))}catch{}},hu=e=>{["review_queue","review_queue_reverse","review_queue_kanji","review_queue_kanji_reading"].forEach(t=>{let r=O(t,"");r&&R(t,YR(r,e))}),["current_card","last_answered_word","last_answered_word_reverse","last_answered_word_kanji","last_answered_word_kanji_reading"].forEach(t=>{let r=Number(O(t,"0"));if(!r)return;let n=e(r);n!==r&&R(t,String(n))}),["last_answer","undo_pinned_card"].forEach(t=>zR(t,e))},ku=(e,t,r)=>{if(t===r)return 0;let n=E("SELECT seen_count FROM progress WHERE word_id = ?",[t],0),o=E("SELECT seen_count FROM progress WHERE word_id = ?",[r],0),s=n>o,i=["reviews","spelling_reviews"].reduce((d,u)=>d+(It(u)?E(`SELECT COUNT(*) FROM ${ke(u)} WHERE word_id = ?`,[t],0):0),0);hn(e,"progress",t,r,s);let a=It("spelling_memory")&&Au("spelling_memory").includes("always_spell")?E("SELECT MAX(always_spell) FROM spelling_memory WHERE word_id IN (?, ?)",[t,r],0):0;return["reverse_memory","kanji_memory","kanji_reading_memory","spelling_memory"].forEach(d=>{if(!It(d))return;let u=E(`SELECT COALESCE(seen_count, 0) FROM ${ke(d)} WHERE word_id = ?`,[r],0),l=E(`SELECT COALESCE(seen_count, 0) FROM ${ke(d)} WHERE word_id = ?`,[t],0);hn(e,d,t,r,l>u)}),a&&e.run("UPDATE spelling_memory SET always_spell = 1 WHERE word_id = ?",[r]),["stage1_tasks","stage2_progress","kanji_progress","kanji_reading_progress","critical_reviews","spelling_tasks"].forEach(d=>{XR(e,d,t,r,s)}),hn(e,"word_notes",t,r,s||!ci("word_notes",r)),hn(e,"word_question_meanings",t,r,s),hn(e,"moji_migrated_reviews",t,r,s||!ci("moji_migrated_reviews",r)),It("dictionary_discovered_words")&&(e.run("INSERT OR IGNORE INTO dictionary_discovered_words (word_id) VALUES (?)",[r]),e.run("DELETE FROM dictionary_discovered_words WHERE word_id = ?",[t])),If(e,"reviews",t,r),If(e,"spelling_reviews",t,r),It("content_favorites")&&(e.run(`
      INSERT OR IGNORE INTO content_favorites (item_type, item_id, folder)
      SELECT item_type, ?, folder FROM content_favorites
      WHERE item_type = 'word' AND item_id = ?
    `,[String(r),String(t)]),e.run("DELETE FROM content_favorites WHERE item_type = 'word' AND item_id = ?",[String(t)])),It("custom_words")&&e.run("DELETE FROM custom_words WHERE word_id = ?",[t]),e.run("DELETE FROM words WHERE id = ?",[t]),i},Ff=()=>O(Uf,"")!==xf&&E("SELECT 1 FROM words WHERE id = ? LIMIT 1",[An],0)===1&&E("SELECT 1 FROM words WHERE id = ? LIMIT 1",[Co],0)===1});var Du={};M(Du,{CONTENT_MIGRATION_STATE_KEYS:()=>mi,DEVICE_LOCAL_GRAMMAR_STATE_KEYS:()=>Ei,DEVICE_LOCAL_STATE_KEYS:()=>pi,STUDY_TIME_TABLE:()=>it,SYNCED_TABLES:()=>at,isAppendTable:()=>qR,isDeviceLocalStateKey:()=>Io,localOnlyTables:()=>Cu,syncedTablesForCloud:()=>Do});var it,at,Do,Cu,mi,pi,Ei,Io,qR,Yr=h(()=>{"use strict";it="word_study_time_by_device",at=[{table:"progress",keys:["word_id"],strategy:"lww"},{table:"kanji_reading_memory",keys:["word_id"],strategy:"lww"},{table:"kanji_memory",keys:["word_id"],strategy:"lww"},{table:"kanji_unit_memory",keys:["unit_key"],strategy:"lww"},{table:"kanji_unit_flags",keys:["unit_key"],strategy:"lww"},{table:"kanji_unit_tasks",keys:["reviewed_on","unit_key"],strategy:"lww"},{table:"kanji_char_memory",keys:["char"],strategy:"lww"},{table:"kanji_char_tasks",keys:["reviewed_on","char"],strategy:"lww"},{table:"confusion_progress",keys:["group_key"],strategy:"lww"},{table:"confusion_tasks",keys:["reviewed_on","group_key"],strategy:"lww"},{table:"talk_memory",keys:["card_key"],strategy:"lww",cloud:!1},{table:"talk_tasks",keys:["reviewed_on","card_key"],strategy:"lww",cloud:!1},{table:"talk_reviews",keys:["sync_uid"],strategy:"append",cloud:!1},{table:"spelling_memory",keys:["word_id"],strategy:"lww",cloud:!1},{table:"spelling_tasks",keys:["reviewed_on","word_id"],strategy:"lww",cloud:!1},{table:"spelling_reviews",keys:["sync_uid"],strategy:"append",cloud:!1},{table:"jlpt_answers",keys:["sync_uid"],strategy:"append",cloud:!1},{table:"reverse_memory",keys:["word_id"],strategy:"lww"},{table:"grammar_progress",keys:["grammar_id"],strategy:"lww"},{table:"grammar_mistakes",keys:["grammar_id"],strategy:"lww"},{table:"word_notes",keys:["word_id"],strategy:"lww"},{table:"word_question_meanings",keys:["word_id"],strategy:"lww"},{table:"custom_words",keys:["word_id"],strategy:"union"},{table:"dictionary_discovered_words",keys:["word_id"],strategy:"union"},{table:"confusion_mastered",keys:["group_key"],strategy:"lww"},{table:"level_prior_baselines",keys:["entity","entity_key"],strategy:"lww"},{table:"kana_memory",keys:["symbol"],strategy:"lww"},{table:"achievements",keys:["id"],strategy:"union"},{table:"moji_migrated_reviews",keys:["word_id"],strategy:"lww"},{table:"critical_reviews",keys:["reviewed_on","word_id"],strategy:"lww"},{table:"stage1_tasks",keys:["reviewed_on","word_id"],strategy:"lww"},{table:"stage2_progress",keys:["reviewed_on","word_id"],strategy:"lww"},{table:"kanji_progress",keys:["reviewed_on","word_id"],strategy:"lww"},{table:"kanji_reading_progress",keys:["reviewed_on","word_id"],strategy:"lww"},{table:"app_state",keys:["key"],strategy:"lww"},{table:"grammar_state",keys:["key"],strategy:"lww"},{table:"grammar_highlights",keys:["grammar_id","block","start","end"],strategy:"lww"},{table:"grammar_reading_positions",keys:["kind","level"],strategy:"lww"},{table:"content_favorites",keys:["item_type","item_id"],strategy:"lww"},{table:"favorite_folders",keys:["name"],strategy:"union"},{table:"vocab_test_history",keys:["run_id"],strategy:"union"},{table:"yuzu_ledger",keys:["kind","key"],strategy:"union"},{table:"study_focus_windows",keys:["id"],strategy:"union"},{table:"reviews",keys:["sync_uid"],strategy:"append"},{table:"grammar_reviews",keys:["sync_uid"],strategy:"append"},{table:"grammar_activity_events",keys:["sync_uid"],strategy:"append"},{table:"kanji_unit_reviews",keys:["sync_uid"],strategy:"append"},{table:"kanji_char_reviews",keys:["sync_uid"],strategy:"append"},{table:"confusion_reviews",keys:["sync_uid"],strategy:"append"},{table:"kana_reviews",keys:["sync_uid"],strategy:"append"},{table:"checkins",keys:["checked_on"],strategy:"union"},{table:"moments",keys:["kind","key"],strategy:"union"},{table:it,keys:["studied_on","device_id"],strategy:"lww"},{table:"study_time_by_period",keys:["period_start","device_id"],strategy:"lww"},{table:"weekly_reports",keys:["week_start"],strategy:"lww"}],Do=e=>at.filter(t=>t.cloud!==!1&&(e||t.table!=="weekly_reports")),Cu=()=>at.filter(e=>e.cloud===!1).map(e=>e.table),mi=["jlpt_seed_version","jlpt_word_metadata_version","jlpt_level_override_version","jlpt_collocation_content_version","dictionary_supplement_version","furigana_version","kana_reading_fix_version","legacy_biru_merge_version"],pi=new Set(["sync_device_id","sync_cursor","sync_last_pushed_at","sync_generation","sync_last_modified","runtime_schema_user_ddl","runtime_schema_sync_ddl","content_marker_repair","auth_access_token","auth_user_id","entitlement_cache","local_snapshot_mark","weekly_report_events","study_focus_partial_windows","last_answer","level_trial_expiry_noticed",...mi]),Ei=new Set(["dataset_version"]),Io=(e,t)=>e==="app_state"?pi.has(t):e==="grammar_state"?Ei.has(t):!1,qR=e=>at.find(t=>t.table===e)?.strategy==="append"});function tb(e,t){let r=Math.max(0,Math.round(t));if(!r||!(p("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'study_time_by_period' LIMIT 1").length>0))return;let o=e-r*1e3,s=e,i=r;for(;o<s;){let a=ZR(o),d=new Date(`${a.replace(" ","T")}:00`);d.setDate(d.getDate()+7);let u=Math.min(s,d.getTime()),l=u===s?i:Math.min(i,Math.max(0,Math.round((u-o)/1e3)));eb(a,l),i-=l,o=u,l===0&&(o+=1e3)}}function jf(e,t,r=Date.now()){let n=Math.max(0,Math.round(t));n&&((0,kn.getDatabase)().run(`
    INSERT INTO ${it} (studied_on, device_id, seconds)
    VALUES (?, ?, ?)
    ON CONFLICT(studied_on, device_id) DO UPDATE SET
      seconds = seconds + excluded.seconds
  `,[e,vn(),n]),JR(e),tb(r,n))}function $f(){let e=(0,kn.getDatabase)();e.run("SAVEPOINT rebuild_study_time");try{e.run(`DELETE FROM word_study_time WHERE NOT EXISTS (
      SELECT 1 FROM ${it} d WHERE d.studied_on = word_study_time.studied_on
    )`),e.run(`
      INSERT INTO word_study_time (studied_on, seconds, updated_at)
      SELECT studied_on, SUM(seconds), CURRENT_TIMESTAMP
      FROM ${it}
      GROUP BY studied_on
      ON CONFLICT(studied_on) DO UPDATE SET
        seconds = excluded.seconds,
        updated_at = CURRENT_TIMESTAMP
    `),e.run("RELEASE rebuild_study_time")}catch(t){throw e.run("ROLLBACK TO rebuild_study_time"),e.run("RELEASE rebuild_study_time"),t}}function Pf(){let e=p(`
    SELECT t.studied_on, t.seconds
    FROM word_study_time t
    WHERE t.seconds > 0
      AND NOT EXISTS (
        SELECT 1 FROM ${it} d WHERE d.studied_on = t.studied_on
      )
      AND NOT EXISTS (
        SELECT 1 FROM sync_tombstones s
        WHERE s.table_name = '${it}'
          AND substr(s.row_key, 1, length(t.studied_on) + 1) = t.studied_on || char(31)
      )
  `);if(!e.length)return;let t=(0,kn.getDatabase)(),r=vn();t.run("BEGIN");try{for(let n of e)t.run(`INSERT OR REPLACE INTO ${it} (studied_on, device_id, seconds) VALUES (?, ?, ?)`,[String(n.studied_on),r,Number(n.seconds??0)]);t.run("COMMIT")}catch(n){throw t.run("ROLLBACK"),n}}var kn,JR,QR,ZR,eb,fi=h(()=>{"use strict";kn=N($(),1);P();dt();Yr();JR=e=>{(0,kn.getDatabase)().run(`
    INSERT INTO word_study_time (studied_on, seconds, updated_at)
    SELECT ?, COALESCE(SUM(seconds), 0), CURRENT_TIMESTAMP
    FROM ${it}
    WHERE studied_on = ?
    ON CONFLICT(studied_on) DO UPDATE SET
      seconds = excluded.seconds,
      updated_at = CURRENT_TIMESTAMP
  `,[e,e])},QR=e=>{let t=e.getFullYear(),r=String(e.getMonth()+1).padStart(2,"0"),n=String(e.getDate()).padStart(2,"0");return`${t}-${r}-${n}`},ZR=e=>{let t=new Date(e);return t.setHours(14,0,0,0),t.setDate(t.getDate()-t.getDay()),e<t.getTime()&&t.setDate(t.getDate()-7),`${QR(t)} 14:00`},eb=(e,t)=>{t<=0||(0,kn.getDatabase)().run(`
    INSERT INTO study_time_by_period (period_start, device_id, seconds)
    VALUES (?, ?, ?)
    ON CONFLICT(period_start, device_id) DO UPDATE SET
      seconds = seconds + excluded.seconds
  `,[e,vn(),t])}});var $u={};M($u,{SYNC_ORIGIN_COL:()=>Ne,SYNC_SCHEMA_FINGERPRINT_KEY:()=>gi,SYNC_UID_COL:()=>Mt,SYNC_UPDATED_COL:()=>ve,beginSyncApply:()=>_i,endSyncApply:()=>wi,ensureLegacyMemoryColumns:()=>Wu,ensureSyncSchema:()=>Je,getDeviceId:()=>vn,invalidateSyncSchema:()=>Fu,resetDeviceId:()=>sb,withoutSyncStamp:()=>er});function Fu(){let e=(0,xt.getDatabase)();xu.delete(e),R(gi,"")}function Wu(e){let t=(0,xt.getDatabase)();for(let r of ju(e))t.run(r)}function Je(){let e=(0,xt.getDatabase)();if(xu.has(e))return;let t=Hf(),r=ui(gi,t)&&!rb();r||nb(),e.run("DELETE FROM sync_context WHERE key = 'applying_remote'"),e.run("INSERT OR REPLACE INTO sync_context (key, value) VALUES ('applying_remote', '1')");try{ob()}finally{e.run("DELETE FROM sync_context WHERE key = 'applying_remote'")}r||li(gi,Hf()),xu.add(e),Kf("word_study_time")&&Pf()}function Gf(){let e=["CREATE TABLE IF NOT EXISTS sync_device (id TEXT NOT NULL)",`CREATE TABLE IF NOT EXISTS sync_context (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,`CREATE TABLE IF NOT EXISTS sync_tombstones (
      table_name TEXT NOT NULL,
      row_key TEXT NOT NULL,
      deleted_at TEXT NOT NULL,
      origin_device TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (table_name, row_key)
    )`,`CREATE TABLE IF NOT EXISTS ${it} (
      studied_on TEXT NOT NULL,
      device_id TEXT NOT NULL,
      seconds INTEGER NOT NULL DEFAULT 0,
      ${ve} TEXT,
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
    )`];e.push("ALTER TABLE sync_tombstones ADD COLUMN origin_device TEXT NOT NULL DEFAULT ''");for(let t of at)t.table==="reviews"&&e.push("ALTER TABLE reviews ADD COLUMN direction TEXT NOT NULL DEFAULT 'forward'","ALTER TABLE reviews ADD COLUMN reviewed_at INTEGER","ALTER TABLE reviews ADD COLUMN scheduler_mode TEXT NOT NULL DEFAULT 'legacy'","ALTER TABLE reviews ADD COLUMN fsrs_params_version TEXT NOT NULL DEFAULT 'legacy'","ALTER TABLE reviews ADD COLUMN event_source TEXT NOT NULL DEFAULT 'legacy'"),e.push(...ju(t.table,new Set)),e.push(...Bf(t,new Set)),e.push(...Xf(t));return e}function nb(){let e=(0,xt.getDatabase)(),t=5,r=Gf();e.run("SAVEPOINT sync_structure");try{e.exec(r.slice(0,t).join(";")),vn();let n=[];Uu("sync_tombstones").has("origin_device")||n.push("ALTER TABLE sync_tombstones ADD COLUMN origin_device TEXT NOT NULL DEFAULT ''");let o=new Set(p("SELECT name FROM sqlite_master WHERE type = 'table'").map(s=>String(s.name)));for(let s of at){if(!o.has(s.table))continue;let i=Uu(s.table);s.table==="reviews"&&(i.has("direction")||n.push("ALTER TABLE reviews ADD COLUMN direction TEXT NOT NULL DEFAULT 'forward'"),i.has("reviewed_at")||n.push("ALTER TABLE reviews ADD COLUMN reviewed_at INTEGER"),i.has("scheduler_mode")||n.push("ALTER TABLE reviews ADD COLUMN scheduler_mode TEXT NOT NULL DEFAULT 'legacy'"),i.has("fsrs_params_version")||n.push("ALTER TABLE reviews ADD COLUMN fsrs_params_version TEXT NOT NULL DEFAULT 'legacy'"),i.has("event_source")||n.push("ALTER TABLE reviews ADD COLUMN event_source TEXT NOT NULL DEFAULT 'legacy'")),n.push(...ju(s.table,i)),n.push(...Bf(s,i)),n.push(...Xf(s))}e.exec([...n.filter(s=>s.startsWith("ALTER TABLE")),...n.filter(s=>!s.startsWith("ALTER TABLE"))].join(";")),e.run("RELEASE sync_structure")}catch(n){throw e.run("ROLLBACK TO sync_structure"),e.run("RELEASE sync_structure"),n}}function ob(){let e=(0,xt.getDatabase)(),t=new Set(p("SELECT name FROM sqlite_master WHERE type = 'table'").map(o=>String(o.name))),r=at.filter(o=>t.has(o.table));if(!r.length)return;let n=p(r.map((o,s)=>`SELECT ${s} AS position,
    ${o.strategy==="append"?`EXISTS (SELECT 1 FROM ${o.table} WHERE ${Mt} IS NULL LIMIT 1)`:"0"} AS uid,
    EXISTS (SELECT 1 FROM ${o.table} WHERE ${ve} IS NULL LIMIT 1) AS updated,
    EXISTS (SELECT 1 FROM ${o.table} WHERE ${Ne} IS NULL OR ${Ne} = '' LIMIT 1) AS origin
  `).join(" UNION ALL "));for(let o of n){let s=r[Number(o.position)],i=[],a=[];Number(o.uid)&&(i.push(`${Mt} = COALESCE(${Mt}, (SELECT id FROM sync_device LIMIT 1) || ':' || CAST(id AS TEXT))`),a.push(`${Mt} IS NULL`)),Number(o.updated)&&(i.push(`${ve} = COALESCE(${ve}, '1970-01-01T00:00:00.000Z')`),a.push(`${ve} IS NULL`)),Number(o.origin)&&(i.push(`${Ne} = CASE WHEN ${Ne} IS NULL OR ${Ne} = ''
        THEN (SELECT id FROM sync_device LIMIT 1) ELSE ${Ne} END`),a.push(`${Ne} IS NULL OR ${Ne} = ''`)),i.length&&e.run(`UPDATE ${s.table} SET ${i.join(", ")} WHERE ${a.join(" OR ")}`)}}function _i(){Je(),(0,xt.getDatabase)().run("INSERT OR REPLACE INTO sync_context (key, value) VALUES ('applying_remote', '1')")}function wi(){(0,xt.getDatabase)().run("DELETE FROM sync_context WHERE key = 'applying_remote'")}function er(e){if(Je(),E("SELECT value FROM sync_context WHERE key = 'applying_remote'",[],"")==="1")return e();_i();try{return e()}finally{wi()}}function vn(){let e=(0,xt.getDatabase)();e.run("CREATE TABLE IF NOT EXISTS sync_device (id TEXT NOT NULL)");let t=p("SELECT id FROM sync_device LIMIT 1");if(t.length)return String(t[0].id);let r=crypto.randomUUID();return e.run("INSERT INTO sync_device (id) VALUES (?)",[r]),r}function sb(){let e=(0,xt.getDatabase)(),t=crypto.randomUUID();return e.run("DELETE FROM sync_device"),e.run("INSERT INTO sync_device (id) VALUES (?)",[t]),t}var xt,ve,Mt,Ne,Iu,xu,gi,Uu,Kf,Mu,ju,rb,Hf,Bf,Xf,dt=h(()=>{"use strict";xt=N($(),1);P();Lu();fi();Yr();ve="sync_updated_at",Mt="sync_uid",Ne="sync_origin_device",Iu="strftime('%Y-%m-%dT%H:%M:%fZ','now')",xu=new WeakSet,gi="runtime_schema_sync_ddl";Uu=e=>new Set(p(`PRAGMA table_info(${e})`).map(t=>String(t.name??""))),Kf=e=>p("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",[e]).length>0,Mu=(e,t)=>e.keys.map(r=>`CAST(${t}.${r} AS TEXT)`).join(" || char(31) || ");ju=(e,t)=>{if(e!=="reverse_memory"&&e!=="kanji_reading_memory")return[];if(!t&&!Kf(e))return[];let r=t??Uu(e);return Object.entries({score:"INTEGER NOT NULL DEFAULT 0",low_history:"INTEGER NOT NULL DEFAULT 0",known_forever:"INTEGER NOT NULL DEFAULT 0",mastered_on:"TEXT",mistake_streak:"INTEGER NOT NULL DEFAULT 0",last_decay_amount:"INTEGER DEFAULT 10",right_streak:"INTEGER NOT NULL DEFAULT 0",auto_retired_on:"TEXT"}).filter(([o])=>!r.has(o)).map(([o,s])=>`ALTER TABLE ${e} ADD COLUMN ${o} ${s}`)};rb=()=>p(`
  SELECT 1 FROM sqlite_master m
  WHERE m.type = 'table' AND m.name IN (${at.map(e=>`'${e.table}'`).join(", ")})
    AND NOT EXISTS (SELECT 1 FROM pragma_table_info(m.name) WHERE name = '${ve}')
  LIMIT 1
`).length>0,Hf=()=>{let e=new Set(p("SELECT name FROM sqlite_master WHERE type = 'table'").map(t=>String(t.name)));return di([Gf(),at.filter(t=>e.has(t.table)).map(t=>t.table)])};Bf=(e,t)=>{let r=[];return t.has(ve)||r.push(`ALTER TABLE ${e.table} ADD COLUMN ${ve} TEXT`),t.has(Ne)||r.push(`ALTER TABLE ${e.table} ADD COLUMN ${Ne} TEXT`),e.strategy==="append"&&(t.has(Mt)||r.push(`ALTER TABLE ${e.table} ADD COLUMN ${Mt} TEXT`),r.push(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${e.table}_sync_uid
       ON ${e.table}(${Mt})`)),r.push(`CREATE INDEX IF NOT EXISTS idx_${e.table}_sync_updated
     ON ${e.table}(${ve})`),r.push(`CREATE INDEX IF NOT EXISTS idx_${e.table}_sync_origin_missing
     ON ${e.table}(${Ne})
     WHERE ${Ne} IS NULL OR ${Ne} = ''`),r},Xf=e=>{let{table:t}=e,r=e.strategy==="append"?`, ${Mt} = COALESCE(NEW.${Mt},
         (SELECT id FROM sync_device LIMIT 1) || ':' || lower(hex(randomblob(16))))`:"",n=[`DROP TRIGGER IF EXISTS trg_${t}_sync_insert`,`DROP TRIGGER IF EXISTS trg_${t}_sync_update`,`DROP TRIGGER IF EXISTS trg_${t}_sync_delete`];return n.push(`
    CREATE TRIGGER IF NOT EXISTS trg_${t}_sync_insert AFTER INSERT ON ${t}
    WHEN NOT EXISTS (SELECT 1 FROM sync_context WHERE key = 'applying_remote' AND value = '1')
    BEGIN
      UPDATE ${t} SET ${ve} = ${Iu},
        ${Ne} = (SELECT id FROM sync_device LIMIT 1)${r}
      WHERE rowid = NEW.rowid;
      DELETE FROM sync_tombstones
      WHERE table_name = '${t}' AND row_key = ${Mu(e,"NEW")};
    END
  `),n.push(`
    CREATE TRIGGER IF NOT EXISTS trg_${t}_sync_update AFTER UPDATE ON ${t}
    WHEN NEW.${ve} IS OLD.${ve}
      AND NOT EXISTS (SELECT 1 FROM sync_context WHERE key = 'applying_remote' AND value = '1')
    BEGIN
      UPDATE ${t} SET ${ve} = ${Iu},
        ${Ne} = (SELECT id FROM sync_device LIMIT 1)
      WHERE rowid = NEW.rowid;
    END
  `),n.push(`
    CREATE TRIGGER IF NOT EXISTS trg_${t}_sync_delete AFTER DELETE ON ${t}
    WHEN NOT EXISTS (SELECT 1 FROM sync_context WHERE key = 'applying_remote' AND value = '1')
      -- \u7B97\u4E0D\u51FA row_key \u7684\u884C(\u67D0\u5217\u662F NULL)\u5199\u4E0D\u4E86\u5893\u7891 \u2014\u2014 \u4F46\u90A3\u4E5F\u4E0D\u8BE5\u8BA9\u8C03\u7528\u65B9\u7684\u4E8B\u52A1
      -- \u6574\u4E2A\u5931\u8D25\u3002\u6CA1\u6709\u540C\u6B65\u8EAB\u4EFD\u7684\u884C\u672C\u6765\u5C31\u4E0D\u53EF\u80FD\u88AB\u5BF9\u7AEF\u6309\u952E\u590D\u6D3B,\u8DF3\u8FC7\u662F\u5B89\u5168\u7684;
      -- \u629B\u9519\u5219\u4F1A\u628A\u300C\u5408\u5E76\u91CD\u590D\u8BCD\u6761\u300D\u8FD9\u79CD\u4E00\u6574\u4E2A\u6279\u91CF\u8FC1\u79FB\u6380\u7FFB\u3002\u4E0A\u9762\u7684 uid \u56DE\u586B\u8D1F\u8D23
      -- \u8BA9\u8FD9\u6761\u5B88\u536B\u5E73\u65F6\u7528\u4E0D\u4E0A\u3002
      AND ${Mu(e,"OLD")} IS NOT NULL
    BEGIN
      INSERT INTO sync_tombstones (table_name, row_key, deleted_at, origin_device)
      VALUES ('${t}', ${Mu(e,"OLD")}, ${Iu},
        (SELECT id FROM sync_device LIMIT 1))
      ON CONFLICT(table_name, row_key) DO UPDATE SET
        deleted_at = excluded.deleted_at,
        origin_device = excluded.origin_device;
    END
  `),n}});var Si,ib,ab,db,Pu,Ti,ub,Yf,zf,Sr,ee,yr,tr=h(()=>{"use strict";Si=typeof __TARO_PERF_OVERLAY__<"u"&&__TARO_PERF_OVERLAY__,ib="\u542F\u52A8 \xB7 ",ab=0,db=!1,Pu=new Map,Ti=[],ub=new Map;Si&&(globalThis.__shushugoPerf={perfPhases:Pu,perfTimeline:Ti,perfSql:ub});Yf=(e,t,r)=>{Ti.push({phase:e,at:Math.round(t-ab),ms:Math.round(r)}),Ti.length>300&&Ti.shift()},zf="",Sr=(e,t)=>{if(!Si||e.startsWith(ib)&&!db)return;let r=Pu.get(e)??[];r.push(Math.round(t)),r.length>20&&r.shift(),Pu.set(e,r)},ee=(e,t)=>{if(!Si)return t();zf=e;let r=performance.now();try{return t()}finally{Sr(e,performance.now()-r),Yf(e,r,performance.now()-r)}},yr=(e,t)=>{if(!Si)return t();zf=e;let r=performance.now(),n;try{n=t()}catch(o){throw Sr(e,performance.now()-r),o}return n.then(o=>(Sr(e,performance.now()-r),Yf(e,r,performance.now()-r),o),o=>{throw Sr(e,performance.now()-r),o})}});var rr=le((RI,Vf)=>{Vf.exports=new Proxy({},{get(e,t){if(t==="__esModule")return!1;if(typeof t!="symbol")throw new Error(`\u51FA\u5382\u79CD\u5B50\u6570\u636E\u4E0D\u5728\u5C0F\u7A0B\u5E8F\u5305\u91CC\uFF08\u8BBF\u95EE\u4E86 ${String(t)}\uFF09\uFF1A\u5185\u5BB9\u8FC1\u79FB\u53EA\u5728\u7F51\u9875 / App \u4E0A\u8DD1`)}})});var Jf=le((bI,qf)=>{qf.exports=()=>require("../shared/content").load("jlptCollocations")});var Qf={};M(Qf,{migrateJlptCollocationContent:()=>cb});var Hu,lb,cb,mb,Zf=h(()=>{"use strict";Gr();Hu=N($(),1);P();G();lb=async()=>{let t=(await Promise.resolve().then(()=>N(Jf(),1))).default;return typeof t=="function"?t():t},cb=async()=>{if(O("jlpt_collocation_content_version","")===Mo)return;let e=await lb();if(e.status!=="content_ready_runtime_migration"||e.entries.length!==790)throw new Error(`\u56FA\u5B9A\u642D\u914D\u5185\u5BB9\u7248\u672C\u65E0\u6548: status=${e.status} entries=${e.entries.length}`);if(e.entries.some(o=>!o.surface||!o.kana||!o.meaning||!/^N[1-5]$/.test(o.level)))throw new Error("\u56FA\u5B9A\u642D\u914D\u5185\u5BB9\u5B58\u5728\u7F3A\u5C11\u8868\u8BB0\u3001\u8BFB\u97F3\u3001\u91CA\u4E49\u6216\u7B49\u7EA7\u7684\u6761\u76EE");let t=(0,Hu.getDatabase)(),r=new Set(p("SELECT kanji, kana FROM words").map(o=>`${String(o.kanji??"")}\0${String(o.kana??"")}`)),n=[];t.run("BEGIN TRANSACTION");try{e.entries.forEach(o=>{let s=`${o.surface}\0${o.kana}`;if(!r.has(s)){t.run(`
          INSERT INTO words (
            meaning, kana, kanji, pos, verb_type, importance,
            shuffle_rank, example_jp, example_meaning, example_furigana, example_tokens, example_lemmas, jlpt_level
          )
          VALUES (?, ?, ?, ?, NULL, ?, ABS(RANDOM()) / 9223372036854775807.0, '', '', '', '', '', ?)
        `,[o.meaning,o.kana,o.surface,"\u56FA\u5B9A\u642D\u914D",3,o.level]);let i=E("SELECT last_insert_rowid()",[],0);i>0&&n.push(i),r.add(s)}t.run("UPDATE words SET collocation_tier = ? WHERE pos = '\u56FA\u5B9A\u642D\u914D' AND kanji = ? AND kana = ?",[{core:0,common:1,optional:2}[ni(o)],o.surface,o.kana])}),n.forEach(o=>t.run("INSERT OR IGNORE INTO progress (word_id) VALUES (?)",[o])),mb(e.removed),R("jlpt_collocation_content_version",Mo),t.run("COMMIT")}catch(o){throw t.run("ROLLBACK"),o}Pe()},mb=e=>{if(!e.length)return;let t=(0,Hu.getDatabase)(),r=a=>p(`PRAGMA table_info("${a}")`).map(d=>String(d.name)),n=p("SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'words'").map(a=>String(a.name)).filter(a=>r(a).includes("word_id")),o=n.filter(a=>a!=="progress"),s=n.filter(a=>r(a).includes("known_forever")),i=a=>E(`
      SELECT COUNT(*) FROM progress WHERE word_id = ? AND (
        COALESCE(seen_count, 0) > 0 OR COALESCE(known_forever, 0) <> 0
        OR last_seen_on IS NOT NULL OR mastered_on IS NOT NULL
      )
    `,[a],0)>0||o.some(d=>E(`SELECT COUNT(*) FROM "${d}" WHERE word_id = ?`,[a],0)>0)||E("SELECT COUNT(*) FROM content_favorites WHERE item_type = 'word' AND item_id = ?",[String(a)],0)>0||O("current_card","")===String(a);e.forEach(({surface:a,kana:d})=>{p("SELECT id FROM words WHERE kanji = ? AND kana = ? AND pos = '\u56FA\u5B9A\u642D\u914D'",[a,d]).map(u=>Number(u.id)).forEach(u=>{if(i(u)){s.forEach(l=>t.run(`UPDATE "${l}" SET known_forever = 1 WHERE word_id = ? AND known_forever = 0`,[u]));return}t.run("DELETE FROM progress WHERE word_id = ?",[u]),t.run("DELETE FROM words WHERE id = ?",[u])})})}});var zu={};M(zu,{DICTIONARY_SUPPLEMENT_VERSION:()=>Ri,FURIGANA_VERSION:()=>bi,GRAMMAR_SEED_ROW_COUNT:()=>sg,GRAMMAR_SEED_VERSION:()=>Ni,JLPT_COLLOCATION_CONTENT_VERSION:()=>Mo,USER_SCHEMA_FINGERPRINT_KEY:()=>Yu,answerLabel:()=>hb,collocationTier:()=>ni,daysSince:()=>Oo,ensureJlptCollocationContent:()=>mg,ensureSeedData:()=>_b,ensureUserTables:()=>V,firstRow:()=>H,firstValue:()=>E,getState:()=>O,isFavorite:()=>xo,persistSoon:()=>D,randomBetween:()=>Ob,rowsFor:()=>p,sessionScoreDelta:()=>Ab,setState:()=>R,studyDate:()=>B,studyDayEnd:()=>A,today:()=>T});var Tt,Ku,bi,og,yi,Ni,sg,Ri,Mo,ig,ag,dg,ug,lg,pb,cg,Eb,Gu,Yu,fb,eg,V,tg,gb,_b,mg,wb,xo,Bu,Xu,Tb,Sb,yb,Nb,pg,rg,Rb,ng,bb,Lb,Ob,Ab,hb,G=h(()=>{"use strict";Tt=N($(),1);Df();Lu();vu();dt();Yr();tr();P();P();Gr();Ku="2026-06-15-jlpt10k",bi="2026-08-15-kuromoji-ipadic-v5-bunsetsu-morph-v1",og=`2026-10-12-atatameru-example-v1-${bi}`,yi="2026-08-21-unleveled-v1",Ni="2026-11-02-grammar-tables-v2",sg=753,Ri="2026-08-16-handwritten-v1",Mo="2026-10-18-jlpt-collocations-zh-v4",ig=async()=>(await Promise.resolve().then(()=>N(rr(),1))).default,ag=async()=>(await Promise.resolve().then(()=>N(rr(),1))).default,dg=e=>{let t=(0,Tt.getDatabase)();e.forEach(([r,n,o])=>{t.run("UPDATE words SET sense_key = ? WHERE kanji = ? AND kana = ?",[o,r,n])})},ug=async()=>(await Promise.resolve().then(()=>N(rr(),1))).default,lg=async()=>(await Promise.resolve().then(()=>N(rr(),1))).default,pb=async()=>(await Promise.resolve().then(()=>N(rr(),1))).default,cg=async()=>(await Promise.resolve().then(()=>N(rr(),1))).default,Eb=async()=>(await Promise.resolve().then(()=>N(rr(),1))).default,Gu=new WeakSet,Yu="runtime_schema_user_ddl",fb=["CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)",...Nu.split(";").map(e=>e.trim()).filter(Boolean),"ALTER TABLE words ADD COLUMN collocation_tier INTEGER","ALTER TABLE words ADD COLUMN jlpt_level TEXT","ALTER TABLE words ADD COLUMN example_furigana TEXT NOT NULL DEFAULT ''","ALTER TABLE words ADD COLUMN example_tokens TEXT NOT NULL DEFAULT ''","ALTER TABLE words ADD COLUMN example_lemmas TEXT NOT NULL DEFAULT ''","ALTER TABLE words ADD COLUMN sense_key TEXT NOT NULL DEFAULT ''","ALTER TABLE grammar_points ADD COLUMN example_furigana TEXT NOT NULL DEFAULT ''","ALTER TABLE grammar_points ADD COLUMN example_tokens TEXT NOT NULL DEFAULT ''","ALTER TABLE grammar_points ADD COLUMN example_lemmas TEXT NOT NULL DEFAULT ''","ALTER TABLE grammar_points_archive ADD COLUMN example_furigana TEXT NOT NULL DEFAULT ''","ALTER TABLE grammar_points_archive ADD COLUMN example_tokens TEXT NOT NULL DEFAULT ''","ALTER TABLE grammar_points_archive ADD COLUMN example_lemmas TEXT NOT NULL DEFAULT ''","ALTER TABLE grammar_reading_positions ADD COLUMN scroll_top REAL NOT NULL DEFAULT 0","ALTER TABLE content_favorites ADD COLUMN folder TEXT NOT NULL DEFAULT ''","ALTER TABLE vocab_test_history ADD COLUMN levels_json TEXT NOT NULL DEFAULT ''","ALTER TABLE reviews ADD COLUMN direction TEXT NOT NULL DEFAULT 'forward'","ALTER TABLE spelling_memory ADD COLUMN always_spell INTEGER NOT NULL DEFAULT 0",`CREATE TABLE IF NOT EXISTS study_time_by_period (
    period_start TEXT NOT NULL, device_id TEXT NOT NULL, seconds INTEGER NOT NULL DEFAULT 0,
    sync_updated_at TEXT, sync_origin_device TEXT, PRIMARY KEY (period_start, device_id)
  )`,"CREATE INDEX IF NOT EXISTS idx_reviews_day_direction ON reviews(reviewed_on, direction)","CREATE INDEX IF NOT EXISTS idx_words_jlpt_level ON words(jlpt_level)","CREATE INDEX IF NOT EXISTS idx_words_pos ON words(pos)"],eg=()=>di([fb,bu.toString(),Ru.toString(),V.toString()]),V=()=>{let e=(0,Tt.getDatabase)();if(Gu.has(e))return;let t=eg();if(ui(Yu,t)){Gu.add(e);return}bu(),p("PRAGMA table_info(spelling_memory)").some(u=>u.name==="always_spell")||e.run("ALTER TABLE spelling_memory ADD COLUMN always_spell INTEGER NOT NULL DEFAULT 0"),e.run("CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)");let r=p("PRAGMA table_info(words)").map(u=>String(u.name??""));r.includes("collocation_tier")||e.run("ALTER TABLE words ADD COLUMN collocation_tier INTEGER"),r.includes("jlpt_level")||e.run("ALTER TABLE words ADD COLUMN jlpt_level TEXT"),r.includes("example_furigana")||e.run("ALTER TABLE words ADD COLUMN example_furigana TEXT NOT NULL DEFAULT ''"),r.includes("example_tokens")||e.run("ALTER TABLE words ADD COLUMN example_tokens TEXT NOT NULL DEFAULT ''"),r.includes("example_lemmas")||e.run("ALTER TABLE words ADD COLUMN example_lemmas TEXT NOT NULL DEFAULT ''"),r.includes("sense_key")||e.run("ALTER TABLE words ADD COLUMN sense_key TEXT NOT NULL DEFAULT ''");let n=p("PRAGMA table_info(grammar_points)").map(u=>String(u.name??""));n.includes("example_furigana")||e.run("ALTER TABLE grammar_points ADD COLUMN example_furigana TEXT NOT NULL DEFAULT ''"),n.includes("example_tokens")||e.run("ALTER TABLE grammar_points ADD COLUMN example_tokens TEXT NOT NULL DEFAULT ''"),n.includes("example_lemmas")||e.run("ALTER TABLE grammar_points ADD COLUMN example_lemmas TEXT NOT NULL DEFAULT ''");let o=p("PRAGMA table_info(grammar_points_archive)").map(u=>String(u.name??""));o.includes("example_furigana")||e.run("ALTER TABLE grammar_points_archive ADD COLUMN example_furigana TEXT NOT NULL DEFAULT ''"),o.includes("example_tokens")||e.run("ALTER TABLE grammar_points_archive ADD COLUMN example_tokens TEXT NOT NULL DEFAULT ''"),o.includes("example_lemmas")||e.run("ALTER TABLE grammar_points_archive ADD COLUMN example_lemmas TEXT NOT NULL DEFAULT ''"),p("PRAGMA table_info(grammar_reading_positions)").map(u=>String(u.name??"")).includes("scroll_top")||e.run("ALTER TABLE grammar_reading_positions ADD COLUMN scroll_top REAL NOT NULL DEFAULT 0"),p("PRAGMA table_info(content_favorites)").map(u=>String(u.name??"")).includes("folder")||e.run("ALTER TABLE content_favorites ADD COLUMN folder TEXT NOT NULL DEFAULT ''");let a=p("PRAGMA table_info(vocab_test_history)").map(u=>String(u.name??""));a.length&&!a.includes("levels_json")&&e.run("ALTER TABLE vocab_test_history ADD COLUMN levels_json TEXT NOT NULL DEFAULT ''"),p("PRAGMA table_info(reviews)").map(u=>String(u.name??"")).includes("direction")||e.run("ALTER TABLE reviews ADD COLUMN direction TEXT NOT NULL DEFAULT 'forward'"),e.run("CREATE INDEX IF NOT EXISTS idx_reviews_day_direction ON reviews(reviewed_on, direction)"),e.run(`
    CREATE TABLE IF NOT EXISTS study_time_by_period (
      period_start TEXT NOT NULL,
      device_id TEXT NOT NULL,
      seconds INTEGER NOT NULL DEFAULT 0,
      sync_updated_at TEXT,
      sync_origin_device TEXT,
      PRIMARY KEY (period_start, device_id)
    )
  `),e.run("CREATE INDEX IF NOT EXISTS idx_words_jlpt_level ON words(jlpt_level)"),e.run("CREATE INDEX IF NOT EXISTS idx_words_pos ON words(pos)"),Fu(),li(Yu,eg()),Gu.add(e)},tg="2026-09-09-unsynced-content-markers-v1",gb=()=>{if(O("content_marker_repair","")!==tg){for(let e of mi)R(e,"");R("content_marker_repair",tg)}},_b=async()=>{ee("\u542F\u52A8 \xB7 \u7528\u6237\u8868\u7ED3\u6784",V),ee("\u542F\u52A8 \xB7 \u540C\u6B65\u7ED3\u6784",Je),ee("\u542F\u52A8 \xB7 \u5185\u5BB9\u8FC1\u79FB / \u6807\u8BB0\u4FEE\u590D",gb),await yr("\u542F\u52A8 \xB7 \u5185\u5BB9\u8FC1\u79FB / \u65E7\u8BCD\u8868",Wf),await yr("\u542F\u52A8 \xB7 \u5185\u5BB9\u8FC1\u79FB / \u8BCD\u5178\u8865\u5145",wb),await yr("\u542F\u52A8 \xB7 \u5185\u5BB9\u8FC1\u79FB / \u56FA\u5B9A\u642D\u914D",mg),await yr("\u542F\u52A8 \xB7 \u5185\u5BB9\u8FC1\u79FB / \u8BED\u6CD5",Sb),await yr("\u542F\u52A8 \xB7 \u5185\u5BB9\u8FC1\u79FB / JLPT \u8BCD\u5E93",Lb),await yr("\u542F\u52A8 \xB7 \u5185\u5BB9\u8FC1\u79FB / \u7EA7\u522B\u8986\u76D6",bb),await yr("\u542F\u52A8 \xB7 \u5185\u5BB9\u8FC1\u79FB / \u632F\u5047\u540D",yb)},mg=async()=>{if(O("jlpt_collocation_content_version","")===Mo)return;let{migrateJlptCollocationContent:e}=await Promise.resolve().then(()=>(Zf(),Qf));await e()},wb=async()=>{let e=O("dictionary_supplement_version",""),t=E("SELECT COUNT(*) FROM dictionary_entries WHERE entry_key LIKE 'builtin:%'",[],0);if(e===Ri&&t===21)return;let r=await Eb();if(r.version!==Ri)throw new Error(`\u8865\u5145\u8BCD\u5178\u7248\u672C\u4E0D\u4E00\u81F4: ${r.version} != ${Ri}`);if(r.entries.length!==21)throw new Error(`\u8865\u5145\u8BCD\u5178\u6761\u6570\u5F02\u5E38: ${r.entries.length} != 21`);let n=(0,Tt.getDatabase)();n.run("BEGIN TRANSACTION");try{n.run("DELETE FROM dictionary_entries WHERE entry_key LIKE 'builtin:%'"),r.entries.forEach(o=>{n.run(`
        INSERT INTO dictionary_entries (
          entry_key, headword, kana, meaning, pos, verb_type, category,
          usage_note, example_jp, example_meaning, priority,
          source_name, source_url, license, seed_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,[o.entryKey,o.headword,o.kana,o.meaning,o.pos,o.verbType,o.category,o.usageNote,o.exampleJp,o.exampleMeaning,o.priority,r.source.name,r.source.url,r.source.license,r.version])}),R("dictionary_supplement_version",r.version),n.run("COMMIT"),Pe()}catch(o){throw n.run("ROLLBACK"),o}},xo=(e,t)=>(V(),!!E("SELECT 1 FROM content_favorites WHERE item_type = ? AND item_id = ? LIMIT 1",[e,String(t)],0)),Bu=["grammar_progress","grammar_reviews","grammar_mistakes"],Xu=1e6,Tb={"\uFF5E\u304C\u958B\u304F\uFF0F\uFF5E\u3092\u958B\u3051\u308B":"\uFF5E\u304C\uFF0B\u81EA\u52D5\u8A5E\uFF0F\uFF5E\u3092\uFF0B\u4ED6\u52D5\u8A5E","\u8AB0\uFF0F\u3069\u306A\u305F\uFF0F\u3069\u306E\u65B9":"\u8AB0","\u3069\u3046\uFF0F\u3044\u304B\u304C":"\u3069\u3046","\u306A\u305C\uFF0F\u3069\u3046\u3057\u3066\uFF0F\u306A\u3093\u3067":"\u306A\u305C","\u304B\u306A\uFF0F\u304B\u3057\u3089":"\u304B\u306A","\uFF5E\u305F\u3061\uFF0F\u304C\u305F":"\uFF5E\u305F\u3061","\uFF5E\u3060\u308D\u3046\uFF0F\u3067\u3057\u3087\u3046":"\uFF5E\u3060\u308D\u3046","\u3042\u3052\u308B\uFF0F\u3055\u3057\u3042\u3052\u308B":"\u3042\u3052\u308B","\uFF5E\u3066\u3042\u3052\u308B\uFF0F\u3066\u3055\u3057\u3042\u3052\u308B":"\uFF5E\u3066\u3042\u3052\u308B","\u3082\u3089\u3046\uFF0F\u3044\u305F\u3060\u304F":"\u3082\u3089\u3046","\uFF5E\u3066\u3082\u3089\u3046\uFF0F\u3066\u3044\u305F\u3060\u304F":"\uFF5E\u3066\u3082\u3089\u3046","\u304F\u308C\u308B\uFF0F\u304F\u3060\u3055\u308B":"\u304F\u308C\u308B","\uFF5E\u3066\u304F\u308C\u308B\uFF0F\u3066\u304F\u3060\u3055\u308B":"\uFF5E\u3066\u304F\u308C\u308B","\uFF5E\u3046\u3061\u306F\uFF0F\u306A\u3044\u3046\u3061\u306B":"\uFF5E\u3046\u3061\u306F","\uFF5E\u3066\u3057\u304B\u305F\uFF08\u304C\uFF09\u306A\u3044\uFF0F\u3066\u3057\u3088\u3046\u304C\u306A\u3044":"\uFF5E\u3066\u3057\u304B\u305F\uFF08\u304C\uFF09\u306A\u3044","\uFF5E\u3066\u3082\u3057\u304B\u305F\uFF08\u304C\uFF09\u306A\u3044\uFF0F\u3066\u3082\u3057\u3088\u3046\u304C\u306A\u3044":"\uFF5E\u3066\u3082\u3057\u304B\u305F\uFF08\u304C\uFF09\u306A\u3044","\uFF5E\u3068\u3044\u3046\u306E\u306F\uFF0F\u3068\u306F":"\uFF5E\u3068\u3044\u3046\u306E\u306F","\uFF5E\u306A\u3093\u304B\uFF0F\u306A\u3093\u3066":"\uFF5E\u306A\u3093\u304B","\uFF5E\u3066\u3044\u3089\u3063\u3057\u3083\u308B\uFF0F\u3066\u304A\u3044\u3067\u306B\u306A\u308B":"\uFF5E\u3066\u3044\u3089\u3063\u3057\u3083\u308B","\uFF5E\u304B\u306D\u308B\uFF0F\u304B\u306D\u306A\u3044":"\uFF5E\u304B\u306D\u308B","\uFF5E\u6B21\u7B2C\uFF0F\u6B21\u7B2C\u3060\uFF0F\u6B21\u7B2C\u3067\uFF08\u306F\uFF09":"\uFF5E\u6B21\u7B2C","\uFF5E\u3060\u3051\u3042\u3063\u3066\uFF0F\u3060\u3051\u306B\uFF0F\u3060\u3051\u306E\u3053\u3068\u306F\u3042\u308B":"\uFF5E\u3060\u3051\u3042\u3063\u3066","\uFF5E\u306F\u3082\u3061\u308D\u3093\uFF0F\u306F\u3082\u3068\u3088\u308A":"\uFF5E\u306F\u3082\u3061\u308D\u3093","\uFF5E\u3068\u306F\uFF0F\u306A\u3093\u3066":"\uFF5E\u3068\u306F\uFF08N1-2\uFF09","\uFF5E\u3068\u306F\u3044\u3046\u3082\u306E\u306E\uFF0F\u3068\u306F\u8A00\u3044\u6761":"\uFF5E\u3068\u306F\u3044\u3046\u3082\u306E\u306E","\uFF5E\u306B\u305F\u3048\u308B\uFF0F\u306B\u305F\u3048\u306A\u3044":"\uFF5E\u306B\u305F\u3048\u308B","\uFF5E\u3084\uFF0F\u3084\u5426\u3084":"\uFF5E\u3084"},Sb=async()=>{let e=(0,Tt.getDatabase)(),t=E("SELECT value FROM grammar_state WHERE key = ?",["dataset_version"],"");if(t===Ni&&E("SELECT COUNT(*) FROM grammar_points",[],0)===sg)return;let r=await cg();if(r.version===t&&t!==Ni){console.warn(`GRAMMAR_SEED_VERSION \u5E38\u91CF(${Ni})\u843D\u540E\u4E8E grammar_seed.json(${r.version}),\u8BF7\u66F4\u65B0\u5E38\u91CF\u3002`);return}e.run("BEGIN TRANSACTION");try{let n=new Map;p("SELECT id, pattern FROM grammar_points").forEach(s=>{n.set(String(s.pattern??""),Number(s.id))}),n.size>0&&e.run(`
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
      `,[...s,i+1]),o.set(s[0],E("SELECT last_insert_rowid()",[],0))}),Bu.forEach(s=>{e.run(`UPDATE ${s} SET grammar_id = grammar_id + ${Xu}`)}),n.forEach((s,i)=>{let a=o.get(Tb[i]??i);a&&Bu.forEach(d=>{e.run(`UPDATE ${d} SET grammar_id = ? WHERE grammar_id = ?`,[a,s+Xu])})}),Bu.forEach(s=>{e.run(`DELETE FROM ${s} WHERE grammar_id >= ${Xu}`)}),e.run("INSERT OR REPLACE INTO grammar_state (key, value) VALUES (?, ?)",["queue","[]"]),e.run("DELETE FROM grammar_state WHERE key LIKE 'quiz_undo:%'"),R("review_queue_grammar","[]"),e.run("INSERT OR REPLACE INTO grammar_state (key, value) VALUES (?, ?)",["dataset_version",r.version]),e.run("COMMIT")}catch(n){throw e.run("ROLLBACK"),n}Pe()},yb=async()=>{if(O("furigana_version","")===bi)return;let e=await cg(),t=(0,Tt.getDatabase)();t.run("BEGIN TRANSACTION");try{e.rows.forEach(r=>{let[n,,,,o,,,,,,s,i,a]=r;t.run(`
        UPDATE grammar_points
        SET example_furigana = ?, example_tokens = ?, example_lemmas = ?
        WHERE pattern = ?
          AND example_jp = ?
      `,[s??"",i??"",a??"",n,o])}),R("furigana_version",bi),t.run("COMMIT")}catch(r){throw t.run("ROLLBACK"),r}Pe()},Nb=[["\u904B\u52D5","\u3046\u3093\u3069\u3046"],["\u8A08\u753B","\u3051\u3044\u304B\u304F"],["\u7814\u7A76","\u3051\u3093\u304D\u3085\u3046"],["\u6545\u969C","\u3053\u3057\u3087\u3046"],["\u6388\u696D","\u3058\u3085\u304E\u3087\u3046"],["\u751F\u6D3B","\u305B\u3044\u304B\u3064"],["\u9078\u629E","\u305B\u3093\u305F\u304F"],["\u5352\u696D","\u305D\u3064\u304E\u3087\u3046"],["\u7559\u5B66","\u308A\u3085\u3046\u304C\u304F"],["\u65C5\u884C","\u308A\u3087\u3053\u3046"],["\u7DF4\u7FD2","\u308C\u3093\u3057\u3085\u3046"],["\u9023\u7D61","\u308C\u3093\u3089\u304F"],["\u9045\u523B","\u3061\u3053\u304F"],["\u51FA\u767A","\u3057\u3085\u3063\u3071\u3064"],["\u5230\u7740","\u3068\u3046\u3061\u3083\u304F"],["\u898B\u5B66","\u3051\u3093\u304C\u304F"],["\u5FA9\u7FD2","\u3075\u304F\u3057\u3085\u3046"],["\u4E88\u7FD2","\u3088\u3057\u3085\u3046"],["\u4E88\u7D04","\u3088\u3084\u304F"],["\u7FFB\u8A33","\u307B\u3093\u3084\u304F"],["\u4FE1\u53F7","\u3057\u3093\u3054\u3046"],["\u6D17\u6FEF","\u305B\u3093\u305F\u304F"],["\u52C9\u5F37","\u3079\u3093\u304D\u3087\u3046"],["\u6D3B\u52D5","\u304B\u3064\u3069\u3046"],["\u5E30\u56FD","\u304D\u3053\u304F"],["\u6328\u62F6","\u3042\u3044\u3055\u3064"],["\u55B6\u696D","\u3048\u3044\u304E\u3087\u3046"],["\u5E0C\u671B","\u304D\u307C\u3046"],["\u6210\u529F","\u305B\u3044\u3053\u3046"],["\u5165\u5B66","\u306B\u3085\u3046\u304C\u304F"],["\u7D04\u675F","\u3084\u304F\u305D\u304F"],["\u5229\u7528","\u308A\u3088\u3046"],["\u6025\u884C","\u304D\u3085\u3046\u3053\u3046"],["\u5354\u529B","\u304D\u3087\u3046\u308A\u3087\u304F"],["\u6559\u80B2","\u304D\u3087\u3046\u3044\u304F"],["\u7DCA\u5F35","\u304D\u3093\u3061\u3087\u3046"],["\u884C\u52D5","\u3053\u3046\u3069\u3046"],["\u4FE1\u7528","\u3057\u3093\u3088\u3046"],["\u52AA\u529B","\u3069\u308A\u3087\u304F"],["\u8F38\u51FA","\u3086\u3057\u3085\u3064"],["\u8F38\u5165","\u3086\u306B\u3085\u3046"],["\u51B7\u8535","\u308C\u3044\u305E\u3046"],["\u671D\u5BDD\u574A","\u3042\u3055\u306D\u307C\u3046"],["\u8A95\u751F","\u305F\u3093\u3058\u3087\u3046"],["\u98F2\u98DF","\u3044\u3093\u3057\u3087\u304F"],["\u51FA\u5F35","\u3057\u3085\u3063\u3061\u3087\u3046"],["\u3054\u3061\u305D\u3046","\u3054\u3061\u305D\u3046"],["\u5F71\u97FF","\u3048\u3044\u304D\u3087\u3046"],["\u9060\u8DB3","\u3048\u3093\u305D\u304F"],["\u5B66\u7FD2","\u304C\u304F\u3057\u3085\u3046"],["\u89B3\u5149","\u304B\u3093\u3053\u3046"],["\u7AF6\u4E89","\u304D\u3087\u3046\u305D\u3046"],["\u898B\u7269","\u3051\u3093\u3076\u3064"],["\u5408\u683C","\u3054\u3046\u304B\u304F"],["\u96C6\u5408","\u3057\u3085\u3046\u3054\u3046"],["\u4F53\u64CD","\u305F\u3044\u305D\u3046"],["\u6696\u623F","\u3060\u3093\u307C\u3046"],["\u5831\u544A","\u307B\u3046\u3053\u304F"],["\u653E\u9001","\u307B\u3046\u305D\u3046"],["\u63D0\u51FA","\u3066\u3044\u3057\u3085\u3064"],["\u8EE2\u8077","\u3066\u3093\u3057\u3087\u304F"],["\u512A\u52DD","\u3086\u3046\u3057\u3087\u3046"],["\u5916\u51FA","\u304C\u3044\u3057\u3085\u3064"],["\u7814\u4FEE","\u3051\u3093\u3057\u3085\u3046"],["\u5E83\u544A","\u3053\u3046\u3053\u304F"],["\u6B8B\u696D","\u3056\u3093\u304E\u3087\u3046"],["\u5C31\u8077","\u3057\u3085\u3046\u3057\u3087\u304F"],["\u5F6B\u523B","\u3061\u3087\u3046\u3053\u304F"],["\u6D41\u884C","\u308A\u3085\u3046\u3053\u3046"],["\u62C5\u5F53","\u305F\u3093\u3068\u3046"],["\u4F01\u753B","\u304D\u304B\u304F"],["\u6CE5\u68D2","\u3069\u308D\u307C\u3046"],["\u770B\u75C5","\u304B\u3093\u3073\u3087\u3046"]],pg=(e,t=[],r=[])=>{let n=(0,Tt.getDatabase)(),o=new Set,s=new Map(t.map(({kanji:i,kana:a,meaning:d})=>[`${i}\0${a}`,d]));e.forEach(([,i,a,d,u,l,c,f,m,g,S,w])=>{let y=`${a}\0${i}`;o.has(y)||(o.add(y),n.run(`
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
  `),Nb.forEach(([i,a])=>{n.run(`
      UPDATE words
      SET pos = '\u540D\u8BCD\u30FB\u3059\u308B\u52A8\u8BCD',
          verb_type = 'suru'
      WHERE kanji = ?
        AND kana = ?
        AND pos = '\u52A8\u8BCD'
        AND verb_type = 'godan'
    `,[i,a])}),R("jlpt_word_metadata_version",og)},rg="2026-07-31-katakana-readings",Rb=async()=>{if(O("kana_reading_fix_version","")===rg)return;let t=(await Promise.resolve().then(()=>N(rr(),1))).default.fixes??[],r=(0,Tt.getDatabase)();r.run("BEGIN TRANSACTION");try{t.forEach(([n,o,s])=>{n&&o&&s&&r.run("UPDATE words SET kana = ? WHERE kanji = ? AND kana = ?",[s,n,o])}),R("kana_reading_fix_version",rg),r.run("COMMIT"),Pe()}catch(n){throw r.run("ROLLBACK"),n}},ng=async()=>{if(O("jlpt_word_metadata_version","")===og)return;let e=await ig(),t=await ug(),r=await lg(),n=await ag(),o=(0,Tt.getDatabase)();o.run("BEGIN TRANSACTION");try{pg(e,t,r),dg(n),o.run("COMMIT")}catch(s){throw o.run("ROLLBACK"),s}Pe()},bb=async()=>{if(O("jlpt_level_override_version","")===yi)return;let e=await pb();if(e.version!==yi)throw new Error(`JLPT \u8BCD\u7EA7\u522B\u8986\u76D6\u7248\u672C\u4E0D\u4E00\u81F4: ${e.version} != ${yi}`);if(e.rows.length!==320)throw new Error(`JLPT \u8BCD\u7EA7\u522B\u8986\u76D6\u6761\u6570\u5F02\u5E38: ${e.rows.length} != 320`);let t=(0,Tt.getDatabase)();t.run("BEGIN TRANSACTION");try{e.rows.forEach(({kanji:r,kana:n,jlptLevel:o})=>{t.run(`
        UPDATE words
        SET jlpt_level = ?
        WHERE kanji = ?
          AND kana = ?
          AND (jlpt_level IS NULL OR jlpt_level NOT IN ('N1', 'N2', 'N3', 'N4', 'N5'))
      `,[o,r,n])}),R("jlpt_level_override_version",yi),t.run("COMMIT")}catch(r){throw t.run("ROLLBACK"),r}Pe()},Lb=async()=>{if(await Rb(),O("jlpt_seed_version","")===Ku){await ng();return}let e=E("SELECT COUNT(*) FROM words",[],0),t=E("SELECT COUNT(*) FROM words WHERE jlpt_level IN ('N5', 'N4', 'N3', 'N2', 'N1')",[],0)>=1e4;if(e>=1e4&&t){await ng(),R("jlpt_seed_version",Ku),Pe();return}let r=await ig(),n=await ug(),o=await lg(),s=await ag(),i=(0,Tt.getDatabase)(),a=new Map;p("SELECT id, kanji, kana FROM words").forEach(d=>{a.set(`${String(d.kanji??"")}\0${String(d.kana??"")}`,Number(d.id))}),i.run("BEGIN TRANSACTION");try{r.forEach(([d,u,l,c,f,m,g,S,w,y,_,b])=>{let k=`${l}\0${u}`,C=a.get(k);if(C){i.run(`
          UPDATE words
          SET jlpt_level = COALESCE(jlpt_level, ?),
              importance = MAX(importance, ?)
          WHERE id = ?
        `,[w,m,C]);return}i.run(`
        INSERT INTO words (
          meaning, kana, kanji, pos, verb_type, importance,
          shuffle_rank, example_jp, example_meaning, example_furigana, example_tokens, example_lemmas, jlpt_level
        )
        VALUES (?, ?, ?, ?, ?, ?, ABS(RANDOM()) / 9223372036854775807.0, ?, ?, ?, ?, ?, ?)
      `,[d,u,l,c,f,m,g,S,y??"",_??"",b??"",w]);let L=E("SELECT last_insert_rowid()",[],0);a.set(k,L)}),i.run("INSERT OR IGNORE INTO progress (word_id) SELECT id FROM words"),pg(r,n,o),dg(s),R("jlpt_seed_version",Ku),i.run("COMMIT")}catch(d){throw i.run("ROLLBACK"),d}Pe()},Ob=(e,t)=>e+Math.floor(Math.random()*(t-e+1)),Ab={forgot:-10,fuzzy:-2,know:10,known_forever:10},hb={forgot:"\u5FD8\u8BB0",fuzzy:"\u6A21\u7CCA",know:"\u8BA4\u8BC6",known_forever:"\u719F\u77E5"}});var Ju={};M(Ju,{ensureGrammarProgressInitialized:()=>Ie,getGrammarPointFavorite:()=>qu,getGrammarQueue:()=>Cb,setGrammarQueue:()=>Db});function Ie(){Br("grammar-progress",()=>{V(),er(()=>{(0,Vu.getDatabase)().run(`
        INSERT OR IGNORE INTO grammar_progress (grammar_id)
        SELECT id FROM grammar_points
      `)})})}function qu(e){return xo("grammar",e)}var Vu,kb,vb,Cb,Db,Nr=h(()=>{"use strict";Vu=N($(),1);P();dt();G();kb=(e,t)=>E("SELECT value FROM grammar_state WHERE key = ?",[e],t),vb=(e,t)=>{(0,Vu.getDatabase)().run("INSERT OR REPLACE INTO grammar_state (key, value) VALUES (?, ?)",[e,t])},Cb=()=>{try{let e=JSON.parse(kb("queue","[]"));return Array.isArray(e)?e.flatMap(t=>{let r=Number(t?.grammar_id);return Number.isFinite(r)?[{grammar_id:r,due_after:Math.max(Number(t?.due_after??0),0)}]:[]}):[]}catch{return[]}},Db=e=>{vb("queue",JSON.stringify(e))}});var Eg,Ib,fg,zr,gg,Li,fe,St=h(()=>{"use strict";P();wt();Se();Eg=(e,t)=>{let r=W.indexOf(e);return r<0?0:r+(t===0?0:1)},Ib=(e,t,r)=>{let n=Eg(e,t),o=W.indexOf(r);return W.map((s,i)=>i<n?0:i<=o?i-n:100+i)},fg=()=>{try{let e=JSON.parse(O("level_prior_applied","")||"null");if(e&&typeof e.level=="string")return{level:e.level,familiarity:e.familiarity??{}}}catch{}return{level:"",familiarity:{}}},zr=e=>{let t=fg(),r=e==="words"||e==="grammar"?On(e):Y().jlptTarget,n=Ib(t.level,t.familiarity[e],r);if(e==="words"||e==="grammar"){let o=W.indexOf(vo()[e].backfill);o>=0&&(n[o]=-1)}return n},gg=e=>{let t=fg();return Eg(t.level,t.familiarity[e])},Li=(e,t)=>{let r=zr(t);return`CASE ${e} ${W.map((n,o)=>`WHEN '${n}' THEN ${r[o]}`).join(" ")} ELSE 0 END`},fe=(e,t)=>E("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'level_prior_baselines'",[],0)>0?`EXISTS (SELECT 1 FROM level_prior_baselines lpb WHERE lpb.entity = '${e}' AND lpb.entity_key = CAST(${t} AS TEXT))`:"0"});var _g,wg,Tg,Sg,yg,Qu,nr,Ng,Rg,Zu,Rr,pe,or,bg,Mb,Uo,Vr,Fo,Oi,Me,te,Ut,Ai,Cn,br,Re=h(()=>{"use strict";_g=N($(),1);P();St();wg=5,Tg=1,Sg=8,yg=10,Qu={words:{table:"progress",idColumn:"word_id",reviews:"reviews"},grammar:{table:"grammar_progress",idColumn:"grammar_id",reviews:"grammar_reviews"},kanji:{table:"kanji_char_memory",idColumn:"char",reviews:"kanji_char_reviews"},confusion:{table:"confusion_progress",idColumn:"group_key",reviews:"confusion_reviews"}},nr=Qu,Ng=e=>`prior_pace:${e}`,Rg=e=>`'${e.replace(/'/gu,"''")}'`,Zu=(e,t)=>`${e} IN (${t.map(Rg).join(",")||"NULL"})`,Rr=e=>e==="reverse_memory"||e==="kanji_reading_memory"?"words":Object.keys(nr).find(t=>nr[t].table===e)??null,pe=(e,t)=>{let r=fe(e,t);if(r==="0")return"0";let n=nr[e];return`(${r} AND NOT EXISTS (SELECT 1 FROM ${n.reviews} prior_review WHERE prior_review.${n.idColumn} = ${t}))`},or=e=>fe(e,"NULL")!=="0"&&E("SELECT 1 FROM level_prior_baselines WHERE entity = ? LIMIT 1",[e],0)>0,bg=e=>{try{let t=JSON.parse(O(Ng(e),"")||"null");if(t&&Number.isInteger(t.quota)&&t.quota>=Tg&&t.quota<=Sg&&Array.isArray(t.window)&&t.window.length<yg&&t.window.every(r=>["know","fuzzy","forgot","known_forever"].includes(String(r))))return{quota:t.quota,window:t.window}}catch{}return{quota:wg,window:[]}},Mb=(e,t)=>{let r=[...e.window,t];if(r.length<yg)return{quota:e.quota,window:r};let n=r.filter(s=>s==="know").length/r.length,o=n>=.9?-1:n<.7?1:0;return{quota:Math.max(Tg,Math.min(Sg,e.quota+o)),window:[]}},Uo=(e,t=T(),r="1")=>{if(!or(e))return 0;let{reviews:n,idColumn:o,table:s}=nr[e];return E(`SELECT COUNT(DISTINCT r.${o}) FROM ${n} r
    WHERE r.reviewed_on = ? AND ${fe(e,`r.${o}`)}
      AND r.${o} IN (SELECT ${o} FROM ${s} WHERE ${r})
      AND NOT EXISTS (SELECT 1 FROM ${n} earlier WHERE earlier.${o} = r.${o} AND earlier.reviewed_on < ?)
  `,[t,t],0)},Vr=(e,t,r=T())=>{if(!or(e))return"0";let{reviews:n,idColumn:o}=nr[e];return`(${fe(e,t)} AND NOT EXISTS (SELECT 1 FROM ${n} earlier
    WHERE earlier.${o} = ${t} AND earlier.reviewed_on < ${Rg(r)}))`},Fo=(e,t=A(),r=T(),n="1")=>{if(!or(e))return[];let o=Math.max(0,bg(e).quota-Uo(e,r));if(!o)return[];let{table:s,idColumn:i}=nr[e];return p(`SELECT ${i} AS k FROM ${s}
    WHERE known_forever = 0 AND seen_count > 0 AND fsrs_due <= ? AND (${n})
      AND ${pe(e,`${s}.${i}`)}
    ORDER BY fsrs_due ASC, ${i} ASC LIMIT ?
  `,[t.toISOString(),o]).map(a=>String(a.k))},Oi=(e,t,r="1")=>{if(!t.length||!or(e))return t.map(()=>0);let{table:n,idColumn:o}=nr[e],s=p(`SELECT fsrs_due FROM ${n} WHERE known_forever = 0 AND seen_count > 0
    AND fsrs_due <= ? AND (${r}) AND ${pe(e,`${n}.${o}`)} ORDER BY fsrs_due`,[t[t.length-1].toISOString()]).map(d=>String(d.fsrs_due)),i=bg(e).quota,a=0;return t.map((d,u)=>{let l=a,c=u===0?Math.max(0,i-Uo(e,T(new Date(d.getTime()-1)))):i;for(;a-l<c&&a<s.length&&s[a]<=d.toISOString();)a+=1;return a-l})},Me=(e,t=A(),r=T())=>{let n=Rr(e.table);if(!n)return[];let o=Fo(n,t,r,e.table===nr[n].table?e.eligible:"1");return o.length?p(`SELECT ${e.idColumn} AS k FROM ${e.table}
    WHERE (${e.eligible}) AND (fsrs_due IS NULL OR fsrs_due <= ?) AND ${Zu(e.idColumn,o)}
    ORDER BY fsrs_due ASC, ${e.idColumn} ASC
  `,[t.toISOString()]).map(s=>String(s.k)):[]},te=(e,t,r=A(),n=T(),o="1")=>or(e)?`(NOT ${pe(e,t)} OR ${Zu(t,Fo(e,r,n,o))})`:"1",Ut=(e,t,r=T(),n=A(),o)=>{let s=Rr(e.table);if(!s||!or(s))return;let i=e.idColumn,a=Me(e,n,r),d=(0,_g.getDatabase)();if(d.run(`DELETE FROM ${t} WHERE reviewed_on = ? AND ${pe(s,`${t}.${i}`)} AND NOT ${Zu(i,a)}`,[r]),!a.length)return;let u=E(`SELECT COALESCE(MAX(order_index), 0) FROM ${t} WHERE reviewed_on = ?`,[r],0);a.forEach((l,c)=>d.run(`INSERT OR IGNORE INTO ${t} (reviewed_on, ${i}, order_index${o?", task_type":""})
    VALUES (?, ?, ?${o?", ?":""})`,[r,l,u+c+1,...o?[o]:[]]))},Ai=e=>{if(!or(e))return;let{reviews:t,idColumn:r}=nr[e],n=e==="grammar"?"created_at":"COALESCE(reviewed_at, strftime('%s', created_at) * 1000)",s=p(`SELECT r.answer FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY ${r} ORDER BY reviewed_on, ${n}, sync_uid, id) AS first_answer
    FROM ${t}
  ) r WHERE r.first_answer = 1 AND ${fe(e,`r.${r}`)}
  ORDER BY r.reviewed_on, ${n}, r.sync_uid, r.id`).reduce((i,a)=>Mb(i,String(a.answer)),{quota:wg,window:[]});R(Ng(e),JSON.stringify(s))},Cn=(e,t,r)=>{let n=or(e)&&E(`SELECT ${pe(e,"?")}`,[t,t],0)>0,o=r();return n&&Ai(e),o},br=(e,t)=>{or(e)&&E(`SELECT ${fe(e,"?")}`,[t],0)&&Ai(e)}});var tl={};M(tl,{parseFurigana:()=>Wo,parseTokenBoundaries:()=>el,tokenBoundaryAtOffset:()=>Fb});var Lg,Og,Wo,xb,Ub,el,Fb,hi=h(()=>{"use strict";Lg=e=>{if(!e||typeof e!="object")return!1;let t=e;return Number.isInteger(t.start)&&Number.isInteger(t.length)&&Number(t.start)>=0&&Number(t.length)>0&&typeof t.reading=="string"&&t.reading.length>0},Og=e=>{if(Array.isArray(e)&&e.length>=3){let[t,r,n]=e;return Lg({start:t,length:r,reading:n})?{start:t,length:r,reading:n}:null}return Lg(e)?e:null},Wo=e=>{if(Array.isArray(e)){let t=e.map(Og).filter(r=>!!r);return t.length?t:void 0}if(!(typeof e!="string"||!e.trim()))try{let t=JSON.parse(e);if(!Array.isArray(t))return;let r=t.map(Og).filter(n=>!!n);return r.length?r:void 0}catch{return}},xb=e=>{if(!e||typeof e!="object")return null;let t=e;return typeof t.surface!="string"||!t.surface||typeof t.lemma!="string"||!t.lemma||typeof t.pos!="string"||typeof t.detail!="string"?null:{surface:t.surface,lemma:t.lemma,...t.reading?{reading:t.reading}:{},pos:t.pos,detail:t.detail,...t.conjugatedType?{conjugatedType:t.conjugatedType}:{},...t.conjugatedForm?{conjugatedForm:t.conjugatedForm}:{}}},Ub=e=>{if(!e)return{};let t=e;if(typeof e=="string")try{t=JSON.parse(e)}catch{return{}}return!t||typeof t!="object"||Array.isArray(t)?{}:Object.fromEntries(Object.entries(t).flatMap(([r,n])=>{if(!/^\d+$/u.test(r))return[];if(typeof n=="string"&&n.trim())return[[r,{lemma:n.trim()}]];if(!n||typeof n!="object"||Array.isArray(n))return[];let o=n.lemma;if(typeof o!="string"||!o.trim())return[];let s=Array.isArray(n.morphs)?n.morphs.map(xb).filter(i=>!!i):[];return[[r,{lemma:o.trim(),...s.length?{morphs:s}:{}}]]}))},el=(e,t,r)=>{if(typeof e!="string"||!e.trim())return;let n=e.split(",").map(a=>Number(a));if(!n.length||n.some(a=>!Number.isInteger(a)||a===0)||n.reduce((a,d)=>a+Math.abs(d),0)!==t.length)return;let s=Ub(r),i=0;return n.map((a,d)=>{let u=Math.abs(a),l=i;i+=u;let c=s[String(d)];return{start:l,end:i,text:t.slice(l,i),clickable:a>0,...c?{lemma:c.lemma,...c.morphs?{morphs:c.morphs}:{}}:{}}})},Fb=(e,t)=>e?.find(({start:r,end:n})=>t>=r&&t<n)});var hg,Ag=h(()=>{hg={source:"JMdict \xA9 EDRDG, CC BY-SA 4.0",sourceUrl:"http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz",generatedBy:"frontend/scripts/audit-kanji-orthography.mjs",manualReview:"frontend/scripts/kanji-orthography-manual-review.json",entries:{"\u7121\u304F\u3059|\u306A\u304F\u3059":{band:"kana",score:15,preferredSurface:"\u306A\u304F\u3059"},"\u7121\u304F\u306A\u308B|\u306A\u304F\u306A\u308B":{band:"kana",score:15,preferredSurface:"\u306A\u304F\u306A\u308B"},"\u7E4B\u304C\u308B|\u3064\u306A\u304C\u308B":{band:"low",score:24,preferredSurface:"\u3064\u306A\u304C\u308B"},"\u305F\u3060\u4ECA|\u305F\u3060\u3044\u307E":{band:"kana",score:0,preferredSurface:"\u305F\u3060\u3044\u307E"},"\u639B\u304B\u308B|\u304B\u304B\u308B":{band:"kana",score:15,preferredSurface:"\u304B\u304B\u308B"},"\u639B\u3051\u308B|\u304B\u3051\u308B":{band:"kana",score:15,preferredSurface:"\u304B\u3051\u308B"},"\u5E73\u4EEE\u540D|\u3072\u3089\u304C\u306A":{band:"kana",score:15,preferredSurface:"\u3072\u3089\u304C\u306A"},"\u7247\u4EEE\u540D|\u304B\u305F\u304B\u306A":{band:"kana",score:8,preferredSurface:"\u30AB\u30BF\u30AB\u30CA"},"\u8449\u66F8|\u306F\u304C\u304D":{band:"low",score:24,preferredSurface:"\u306F\u304C\u304D"},"\u9802\u304F|\u3044\u305F\u3060\u304F":{band:"kana",score:15,preferredSurface:"\u3044\u305F\u3060\u304F"},"\u4F55\u3067|\u306A\u3093\u3067":{band:"kana",score:15,preferredSurface:"\u306A\u3093\u3067"},"\u4E0B\u3055\u3044|\u304F\u3060\u3055\u3044":{band:"kana",score:15,preferredSurface:"\u304F\u3060\u3055\u3044"},"\u521D\u3081\u307E\u3057\u3066|\u306F\u3058\u3081\u307E\u3057\u3066":{band:"kana",score:15,preferredSurface:"\u306F\u3058\u3081\u307E\u3057\u3066"},"\u301C\u9054|\u301C\u305F\u3061":{band:"kana",score:15,preferredSurface:"\u301C\u305F\u3061"},"\u4E8B|\u3053\u3068":{band:"kana",score:15,preferredSurface:"\u3053\u3068"},"\u5168\u3066|\u3059\u3079\u3066":{band:"low",score:24,preferredSurface:"\u3059\u3079\u3066"},"\u5927\u4EBA\u3057\u3044|\u304A\u3068\u306A\u3057\u3044":{band:"kana",score:15,preferredSurface:"\u304A\u3068\u306A\u3057\u3044"},"\u5927\u4F53|\u3060\u3044\u305F\u3044":{band:"low",score:24,preferredSurface:"\u3060\u3044\u305F\u3044"},"\u5168\u304F|\u307E\u3063\u305F\u304F":{band:"low",score:34,preferredSurface:"\u307E\u3063\u305F\u304F"},"\u5699[\u304B]\u3080|\u304B\u3080":{band:"alternate",score:0,preferredSurface:"\u565B\u3080"},"\u968F\u5206|\u305A\u3044\u3076\u3093":{band:"kana",score:15,preferredSurface:"\u305A\u3044\u3076\u3093"},"\u81F4\u3059|\u3044\u305F\u3059":{band:"kana",score:15,preferredSurface:"\u3044\u305F\u3059"},"\u7136\u3057|\u3057\u304B\u3057":{band:"kana",score:0,preferredSurface:"\u3057\u304B\u3057"},"\u5438\u6BBB|\u3059\u3044\u304C\u3089":{band:"alternate",score:34,preferredSurface:"\u5438\u3044\u6BBB"},"\u5074|\u305D\u3070":{band:"kana",score:15,preferredSurface:"\u305D\u3070"},"\u4F46\u3057|\u305F\u3060\u3057":{band:"kana",score:15,preferredSurface:"\u305F\u3060\u3057"},"\u4F55\u65B9|\u3069\u306A\u305F":{band:"kana",score:15,preferredSurface:"\u3069\u306A\u305F"},"\u7247\u3065\u3051\u308B|\u304B\u305F\u3065\u3051\u308B":{band:"alternate",score:34,preferredSurface:"\u7247\u4ED8\u3051\u308B"},"\u6B86\u3069|\u307B\u3068\u3093\u3069":{band:"kana",score:15,preferredSurface:"\u307B\u3068\u3093\u3069"},"\u52FF\u4F53\u306A\u3044|\u3082\u3063\u305F\u3044\u306A\u3044":{band:"kana",score:15,preferredSurface:"\u3082\u3063\u305F\u3044\u306A\u3044"},"\u8CB0\u3046|\u3082\u3089\u3046":{band:"low",score:24,preferredSurface:"\u3082\u3089\u3046"},"\u5411\u65E5\u8475|\u3072\u307E\u308F\u308A":{band:"kana",score:8,preferredSurface:"\u3072\u307E\u308F\u308A"},"\u4E0D\u5473\u3044|\u307E\u305A\u3044":{band:"kana",score:15,preferredSurface:"\u307E\u305A\u3044"},"\u78BA\u308A|\u3057\u3063\u304B\u308A":{band:"kana",score:0,preferredSurface:"\u3057\u3063\u304B\u308A"},"\u66F4\u306B|\u3055\u3089\u306B":{band:"kana",score:15,preferredSurface:"\u3055\u3089\u306B"},"\u66AB\u304F|\u3057\u3070\u3089\u304F":{band:"kana",score:15,preferredSurface:"\u3057\u3070\u3089\u304F"},"\u4ED5\u821E\u3046|\u3057\u307E\u3046":{band:"kana",score:0,preferredSurface:"\u3057\u307E\u3046"},"\u65E8\u304F|\u3046\u307E\u304F":{band:"kana",score:8,preferredSurface:"\u3046\u307E\u304F"},"\u51FA\u6765\u308B|\u3067\u304D\u308B":{band:"kana",score:15,preferredSurface:"\u3067\u304D\u308B"},"\u51FA\u6765\u308B\u3060\u3051|\u3067\u304D\u308B\u3060\u3051":{band:"kana",score:15,preferredSurface:"\u3067\u304D\u308B\u3060\u3051"},"\u5148\u305A|\u307E\u305A":{band:"kana",score:15,preferredSurface:"\u307E\u305A"},"\u5927\u5206|\u3060\u3044\u3076":{band:"kana",score:15,preferredSurface:"\u3060\u3044\u3076"},"\u4E01\u5EA6|\u3061\u3087\u3046\u3069":{band:"kana",score:15,preferredSurface:"\u3061\u3087\u3046\u3069"},"\u76F4\u3050|\u3059\u3050":{band:"kana",score:15,preferredSurface:"\u3059\u3050"},"\u76F4\u3050\u306B|\u3059\u3050\u306B":{band:"kana",score:15,preferredSurface:"\u3059\u3050\u306B"},"\u304A\u6C41\u7C89|\u304A\u3057\u308B\u3053":{band:"kana",score:8,preferredSurface:"\u304A\u3057\u308B\u3053"},"\u5982\u4F55|\u3044\u304B\u304C":{band:"kana",score:15,preferredSurface:"\u3044\u304B\u304C"},"\u304A\u7956\u6BCD\u3055\u3093|\u304A\u3070\u3042\u3055\u3093":{band:"kana",score:15,preferredSurface:"\u304A\u3070\u3042\u3055\u3093"},"\u53C8|\u307E\u305F":{band:"kana",score:15,preferredSurface:"\u307E\u305F"},"\u304A\u723A\u3055\u3093|\u304A\u3058\u3044\u3055\u3093":{band:"kana",score:0,preferredSurface:"\u304A\u3058\u3044\u3055\u3093"},"\u77E2\u3063\u5F35\u308A|\u3084\u3063\u3071\u308A":{band:"kana",score:0,preferredSurface:"\u3084\u3063\u3071\u308A"},"\u77E2\u5F35\u308A|\u3084\u306F\u308A":{band:"kana",score:0,preferredSurface:"\u3084\u306F\u308A"},"\u4F59\u308A|\u3042\u307E\u308A":{band:"kana",score:15,preferredSurface:"\u3042\u307E\u308A"},"\u826F\u304F|\u3088\u304F":{band:"kana",score:15,preferredSurface:"\u3088\u304F"},"\u7686|\u307F\u3093\u306A":{band:"low",score:24,preferredSurface:"\u307F\u3093\u306A"},"\u9054|\u305F\u3061":{band:"kana",score:15,preferredSurface:"\u305F\u3061"},"\u99C4\u76EE|\u3060\u3081":{band:"low",score:34,preferredSurface:"\u3060\u3081"},"\u65AF\u3046|\u3053\u3046":{band:"kana",score:0,preferredSurface:"\u3053\u3046"},"\u672A\u3060|\u307E\u3060":{band:"kana",score:15,preferredSurface:"\u307E\u3060"},"\u305D\u3046\u8A00\u3048\u3070|\u305D\u3046\u3044\u3048\u3070":{band:"kana",score:15,preferredSurface:"\u305D\u3046\u3044\u3048\u3070"},"\u6BB5\u6BB5|\u3060\u3093\u3060\u3093":{band:"kana",score:15,preferredSurface:"\u3060\u3093\u3060\u3093"},"\u4F55\u6642|\u3044\u3064":{band:"kana",score:0,preferredSurface:"\u3044\u3064"},"\u4F55\u6642\u3082|\u3044\u3064\u3082":{band:"kana",score:15,preferredSurface:"\u3044\u3064\u3082"},"\u4F55\u51E6|\u3069\u3053":{band:"kana",score:15,preferredSurface:"\u3069\u3053"},"\u4F55\u65B9|\u3069\u3061\u3089":{band:"kana",score:0,preferredSurface:"\u3069\u3061\u3089"},"\u53EF\u7B11\u3057\u3044|\u304A\u304B\u3057\u3044":{band:"kana",score:8,preferredSurface:"\u304A\u304B\u3057\u3044"},"\u5982\u4F55|\u3069\u3046":{band:"kana",score:0,preferredSurface:"\u3069\u3046"},"\u6210\u308B|\u306A\u308B":{band:"kana",score:15,preferredSurface:"\u306A\u308B"},"\u5E7E\u3089|\u3044\u304F\u3089":{band:"kana",score:15,preferredSurface:"\u3044\u304F\u3089"},"\u8CB4\u65B9|\u3042\u306A\u305F":{band:"kana",score:15,preferredSurface:"\u3042\u306A\u305F"},"\u8A70\u307E\u3089\u306A\u3044|\u3064\u307E\u3089\u306A\u3044":{band:"kana",score:0,preferredSurface:"\u3064\u307E\u3089\u306A\u3044"},"\u5076\u306B|\u305F\u307E\u306B":{band:"kana",score:8,preferredSurface:"\u305F\u307E\u306B"},"\u5FA1\u514D|\u3054\u3081\u3093":{band:"kana",score:15,preferredSurface:"\u3054\u3081\u3093"},"\u82E5\u3057|\u3082\u3057":{band:"kana",score:0,preferredSurface:"\u3082\u3057"},"\u884C\u3063\u3066\u3089\u3063\u3057\u3083\u3044|\u3044\u3063\u3066\u3089\u3063\u3057\u3083\u3044":{band:"kana",score:15,preferredSurface:"\u3044\u3063\u3066\u3089\u3063\u3057\u3083\u3044"},"\u6B64\u306E\u5118|\u3053\u306E\u307E\u307E":{band:"kana",score:0,preferredSurface:"\u3053\u306E\u307E\u307E"},"\u6B64\u308C\u304B\u3089|\u3053\u308C\u304B\u3089":{band:"kana",score:0,preferredSurface:"\u3053\u308C\u304B\u3089"},"\u6B62\u3081\u308B|\u3084\u3081\u308B":{band:"kana",score:15,preferredSurface:"\u3084\u3081\u308B"},"\u82E5\u3057\u304B\u3057\u305F\u3089|\u3082\u3057\u304B\u3057\u305F\u3089":{band:"kana",score:0,preferredSurface:"\u3082\u3057\u304B\u3057\u305F\u3089"},"\u53D6\u308A\u6562\u3048\u305A|\u3068\u308A\u3042\u3048\u305A":{band:"kana",score:8,preferredSurface:"\u3068\u308A\u3042\u3048\u305A"},"\u745E\u897F|\u30B9\u30A4\u30B9":{band:"kana",score:0,preferredSurface:"\u30B9\u30A4\u30B9"},"\u5176\u65B9|\u305D\u3061\u3089":{band:"kana",score:0,preferredSurface:"\u305D\u3061\u3089"},"\u9942\u98E9|\u3046\u3069\u3093":{band:"kana",score:0,preferredSurface:"\u3046\u3069\u3093"},"\u7169\u3044|\u3046\u308B\u3055\u3044":{band:"kana",score:15,preferredSurface:"\u3046\u308B\u3055\u3044"},"\u53EA\u4ECA|\u305F\u3060\u3044\u307E":{band:"kana",score:15,preferredSurface:"\u305F\u3060\u3044\u307E"},"\u4E2D\u3005|\u306A\u304B\u306A\u304B":{band:"kana",score:15,preferredSurface:"\u306A\u304B\u306A\u304B"},"\u73A9\u5177|\u304A\u3082\u3061\u3083":{band:"low",score:24,preferredSurface:"\u304A\u3082\u3061\u3083"},"\u5982\u4F55\u3057\u3066|\u3069\u3046\u3057\u3066":{band:"kana",score:0,preferredSurface:"\u3069\u3046\u3057\u3066"},"\u304A\u65E9\u3046|\u304A\u306F\u3088\u3046":{band:"kana",score:8,preferredSurface:"\u304A\u306F\u3088\u3046"},"\u5F7C\u51E6|\u3042\u305D\u3053":{band:"kana",score:0,preferredSurface:"\u3042\u305D\u3053"},"\u5F7C\u65B9|\u3042\u3061\u3089":{band:"kana",score:0,preferredSurface:"\u3042\u3061\u3089"},"\u4F55\u308C|\u3069\u308C":{band:"kana",score:0,preferredSurface:"\u3069\u308C"},"\u8272\u3093\u306A|\u3044\u308D\u3093\u306A":{band:"kana",score:15,preferredSurface:"\u3044\u308D\u3093\u306A"},"\u5FA1\u89A7|\u3054\u3089\u3093":{band:"alternate",score:23,preferredSurface:"\u3054\u89A7"},"\u525D[\u3080]\u304F|\u3080\u304F":{band:"kana",score:0,preferredSurface:"\u3080\u304F"},"\u7F79[\u304B\u304B]\u308B|\u304B\u304B\u308B":{band:"kana",score:15,preferredSurface:"\u304B\u304B\u308B"},"\u6414[\u304B]\u304F|\u304B\u304F":{band:"kana",score:0,preferredSurface:"\u304B\u304F"},"\u67D3\u307F|\u3057\u307F":{band:"low",score:24,preferredSurface:"\u3057\u307F"},"\u7A0B|\u307B\u3069":{band:"kana",score:15,preferredSurface:"\u307B\u3069"},"\u5224\u5B50|\u306F\u3093\u3053":{band:"low",score:24,preferredSurface:"\u306F\u3093\u3053"},"\u6765\u3059|\u304D\u305F\u3059":{band:"kana",score:8,preferredSurface:"\u304D\u305F\u3059"},"\u8A0A[\u305F\u305A]\u306D\u308B|\u305F\u305A\u306D\u308B":{band:"alternate",score:34,preferredSurface:"\u5C0B\u306D\u308B"},"\u4F55\u3068\u306A\u304F|\u306A\u3093\u3068\u306A\u304F":{band:"kana",score:15,preferredSurface:"\u306A\u3093\u3068\u306A\u304F"},"\u6B63\u306B|\u307E\u3055\u306B":{band:"low",score:24,preferredSurface:"\u307E\u3055\u306B"},"\u8E0F\u307F\u5207\u308A|\u3075\u307F\u304D\u308A":{band:"alternate",score:34,preferredSurface:"\u8E0F\u5207"},"\u7121\u3057|\u306A\u3057":{band:"kana",score:15,preferredSurface:"\u306A\u3057"},"\u6709\u308A\u96E3\u3044|\u3042\u308A\u304C\u305F\u3044":{band:"kana",score:15,preferredSurface:"\u3042\u308A\u304C\u305F\u3044"},"\u4ED5\u69D8\u304C\u306A\u3044|\u3057\u3088\u3046\u304C\u306A\u3044":{band:"kana",score:0,preferredSurface:"\u3057\u3088\u3046\u304C\u306A\u3044"},"\u4F55\u3060\u304B|\u306A\u3093\u3060\u304B":{band:"kana",score:15,preferredSurface:"\u306A\u3093\u3060\u304B"},"\u5EA6\u3005|\u305F\u3073\u305F\u3073":{band:"kana",score:15,preferredSurface:"\u305F\u3073\u305F\u3073"},"\u6050\u3089\u304F|\u304A\u305D\u3089\u304F":{band:"kana",score:15,preferredSurface:"\u304A\u305D\u3089\u304F"},"\u6975[\u3054\u304F]|\u3054\u304F":{band:"kana",score:15,preferredSurface:"\u3054\u304F"},"\u53F0\u8A5E[\u305B\u308A\u3075]|\u305B\u308A\u3075":{band:"low",score:20,preferredSurface:"\u305B\u308A\u3075"},"\u7C60|\u304B\u3054":{band:"low",score:24,preferredSurface:"\u304B\u3054"},"\u301C\u907F\u3051|\u301C\u3088\u3051":{band:"kana",score:8,preferredSurface:"\u301C\u3088\u3051"},"\u87FB[\u3042\u308A]|\u3042\u308A":{band:"kana",score:15,preferredSurface:"\u30A2\u30EA"},"\u304F\u307F\u53D6\u308B|\u304F\u307F\u3068\u308B":{band:"alternate",score:0,preferredSurface:"\u6C72\u307F\u53D6\u308B"},"\u63AC[\u3059\u304F]\u3046|\u3059\u304F\u3046":{band:"kana",score:15,preferredSurface:"\u3059\u304F\u3046"},"\u525D[\u3080]\u3051\u308B|\u3080\u3051\u308B":{band:"alternate",score:34,preferredSurface:"\u5265\u3051\u308B"},"\u81EA[\u304A\u306E]\u305A\u304B\u3089|\u304A\u306E\u305A\u304B\u3089":{band:"kana",score:15,preferredSurface:"\u304A\u306E\u305A\u304B\u3089"},"\u898B\u306A\u3059|\u307F\u306A\u3059":{band:"kana",score:15,preferredSurface:"\u307F\u306A\u3059"},"\u6301\u3066\u6210\u3059|\u3082\u3066\u306A\u3059":{band:"kana",score:0,preferredSurface:"\u3082\u3066\u306A\u3059"},"\u8CBC\u308A\u7D19|\u306F\u308A\u304C\u307F":{band:"alternate",score:34,preferredSurface:"\u5F35\u308A\u7D19"},"\u5699[\u304B]\u307F\u5408\u3046|\u304B\u307F\u3042\u3046":{band:"alternate",score:20,preferredSurface:"\u565B\u307F\u5408\u3046"},"\u8FC2\u95CA[\u3046\u304B\u3064]|\u3046\u304B\u3064":{band:"low",score:16,preferredSurface:"\u3046\u304B\u3064"},"\u4ED8\u304D\u7269|\u3064\u304D\u3082\u306E":{band:"low",score:16,preferredSurface:"\u3064\u304D\u3082\u306E"},"\u689F[\u3075\u304F\u308D\u3046]|\u3075\u304F\u308D\u3046":{band:"kana",score:8,preferredSurface:"\u30D5\u30AF\u30ED\u30A6"},"\u6D77\u8C5A[\u3044\u308B\u304B]|\u3044\u308B\u304B":{band:"kana",score:0,preferredSurface:"\u30A4\u30EB\u30AB"},"\u4ECA\u4E00\u3064|\u3044\u307E\u3072\u3068\u3064":{band:"low",score:34,preferredSurface:"\u3044\u307E\u3072\u3068\u3064"},"\u51FA\u6765\u305F\u3066|\u3067\u304D\u305F\u3066":{band:"kana",score:8,preferredSurface:"\u3067\u304D\u305F\u3066"},"\u9AED[\u3072\u3052]|\u3072\u3052":{band:"low",score:24,preferredSurface:"\u3072\u3052"},"\u764C[\u304C\u3093]|\u304C\u3093":{band:"kana",score:15,preferredSurface:"\u304C\u3093"},"\u9762\u5012\u81ED\u3044|\u3081\u3093\u3069\u3046\u304F\u3055\u3044":{band:"alternate",score:24,preferredSurface:"\u9762\u5012\u304F\u3055\u3044"},"\u89E3\u304B\u3059|\u3068\u304B\u3059":{band:"kana",score:15,preferredSurface:"\u3068\u304B\u3059"},"\u70BA[\u306A]\u3059|\u306A\u3059":{band:"alternate",score:24,preferredSurface:"\u6210\u3059"},"\u5927\u5C64|\u305F\u3044\u305D\u3046":{band:"kana",score:15,preferredSurface:"\u305F\u3044\u305D\u3046"},"\u525D\u304C\u3059|\u306F\u304C\u3059":{band:"alternate",score:0,preferredSurface:"\u5265\u304C\u3059"},"\u5343\u5207\u308C\u308B|\u3061\u304E\u308C\u308B":{band:"kana",score:15,preferredSurface:"\u3061\u304E\u308C\u308B"},"\u525D\u304C\u308C\u308B|\u306F\u304C\u308C\u308B":{band:"alternate",score:34,preferredSurface:"\u5265\u304C\u308C\u308B"},"\u96C4|\u304A\u3059":{band:"kana",score:15,preferredSurface:"\u30AA\u30B9"},"\u5D69\u5F35[\u304B\u3055\u3070]\u308B|\u304B\u3055\u3070\u308B":{band:"kana",score:8,preferredSurface:"\u304B\u3055\u3070\u308B"},"\u4F55\u3052\u306A\u3044|\u306A\u306B\u3052\u306A\u3044":{band:"alternate",score:0,preferredSurface:"\u4F55\u6C17\u306A\u3044"},"\u61D0\u304F|\u306A\u3064\u304F":{band:"low",score:16,preferredSurface:"\u306A\u3064\u304F"},"\u96CC|\u3081\u3059":{band:"kana",score:15,preferredSurface:"\u30E1\u30B9"},"\u7121\u95C7|\u3080\u3084\u307F":{band:"kana",score:8,preferredSurface:"\u3080\u3084\u307F"},"\u6B8A\u66F4|\u3053\u3068\u3055\u3089":{band:"kana",score:8,preferredSurface:"\u3053\u3068\u3055\u3089"},"\u5927\u304C\u304B\u308A|\u304A\u304A\u304C\u304B\u308A":{band:"alternate",score:34,preferredSurface:"\u5927\u639B\u304B\u308A"},"\u87F9[\u304B\u306B]|\u304B\u306B":{band:"low",score:24,preferredSurface:"\u30AB\u30CB"},"\u6A9C[\u3072\u306E\u304D]|\u3072\u306E\u304D":{band:"kana",score:8,preferredSurface:"\u30D2\u30CE\u30AD"},"\u72F8[\u305F\u306C\u304D]|\u305F\u306C\u304D":{band:"low",score:24,preferredSurface:"\u30BF\u30CC\u30AD"},"\u4E00\u307E\u3068\u3081|\u3072\u3068\u307E\u3068\u3081":{band:"kana",score:8,preferredSurface:"\u3072\u3068\u307E\u3068\u3081"},"\u7269\u771F\u4F3C|\u3082\u306E\u307E\u306D":{band:"kana",score:8,preferredSurface:"\u3082\u306E\u307E\u306D"},"\u51FA\u3057\u3083\u3070\u308B|\u3067\u3057\u3083\u3070\u308B":{band:"kana",score:8,preferredSurface:"\u3067\u3057\u3083\u3070\u308B"},"\u86D9[\u304B\u3048\u308B]|\u304B\u3048\u308B":{band:"low",score:24,preferredSurface:"\u30AB\u30A8\u30EB"},"\u71D5[\u3064\u3070\u3081]|\u3064\u3070\u3081":{band:"low",score:34,preferredSurface:"\u30C4\u30D0\u30E1"},"\u8B33[\u3046\u305F]\u3046|\u3046\u305F\u3046":{band:"kana",score:15,preferredSurface:"\u3046\u305F\u3046"},"\u5699[\u304B]\u307F\u4ED8\u304F|\u304B\u307F\u3064\u304F":{band:"alternate",score:0,preferredSurface:"\u565B\u307F\u4ED8\u304F"},"\u73CA\u745A[\u3055\u3093\u3054]|\u3055\u3093\u3054":{band:"low",score:24,preferredSurface:"\u30B5\u30F3\u30B4"},"\u9280\u674F[\u3044\u3061\u3087\u3046]|\u3044\u3061\u3087\u3046":{band:"kana",score:8,preferredSurface:"\u30A4\u30C1\u30E7\u30A6"},"\u9DAF[\u3046\u3050\u3044\u3059]|\u3046\u3050\u3044\u3059":{band:"low",score:34,preferredSurface:"\u30A6\u30B0\u30A4\u30B9"},"\u88DC\u5861|\u307B\u3066\u3093":{band:"alternate",score:2,preferredSurface:"\u88DC\u586B"},"\u4F38\u3073\u4F38\u3073|\u306E\u3073\u306E\u3073":{band:"kana",score:15,preferredSurface:"\u306E\u3073\u306E\u3073"},"\u64E6\u308A\u629C\u3051\u308B|\u3059\u308A\u306C\u3051\u308B":{band:"kana",score:15,preferredSurface:"\u3059\u308A\u629C\u3051\u308B"}}}});var rl={};M(rl,{cleanWordSurface:()=>jo,isLoanwordSourceSurface:()=>Lr,kanjiReadingPriorityAdjustment:()=>Dn,kanjiReadingSurface:()=>$o,orthographyEntry:()=>qr,preferredWordSurface:()=>Or,shouldStudyKanjiReading:()=>Po});var jb,$b,jo,Lr,qr,Or,$o,Po,Dn,Jr=h(()=>{"use strict";Ag();jb=hg.entries,$b=/[\u3400-\u9fff]/u,jo=e=>e.replace(/\[[^\]]*\]/g,"").replace(/\s+/g,"")||e,Lr=({kanji:e,kana:t})=>/[A-Za-z]/.test(e)&&/[\u30a0-\u30ff]/u.test(t),qr=({kanji:e,kana:t})=>jb[`${e}|${t}`]??null,Or=e=>Lr(e)?e.kana:qr(e)?.preferredSurface||jo(e.kanji)||e.kana,$o=e=>{let t=qr(e);return t?.band==="alternate"?t.preferredSurface:jo(e.kanji)},Po=e=>{if(Lr(e)||qr(e)?.band==="kana")return!1;let r=$o(e);return r!==e.kana&&$b.test(r)},Dn=e=>qr(e)?.band==="low"?-30:0});var Ar=le((VI,kg)=>{kg.exports=require("../data/verb_pair_hints")});var vg,Cg,Dg=h(()=>{"use strict";vg=[{id:"\u3042\u306A\u305F-kanji-variant",members:[["\u3042\u306A\u305F","\u3042\u306A\u305F"],["\u8CB4\u65B9","\u3042\u306A\u305F"]],reason:"\u73B0\u4EE3\u9ED8\u8BA4\u5199\u4F5C\u5047\u540D\uFF0C\u8CB4\u65B9\u662F\u540C\u4E00\u8BCD\u7684\u65E7/\u6C49\u5B57\u5199\u6CD5\u3002"},{id:"\u3046\u308B\u3055\u3044-kanji-variant",members:[["\u3046\u308B\u3055\u3044","\u3046\u308B\u3055\u3044"],["\u7169\u3044","\u3046\u308B\u3055\u3044"]],reason:"\u3046\u308B\u3055\u3044\u4E0E\u7169\u3044\u662F\u540C\u4E00\u5F62\u5BB9\u8BCD\u7684\u5047\u540D/\u6C49\u5B57\u5199\u6CD5\u3002"},{id:"\u3067\u304D\u308B-kanji-variant",members:[["\u3067\u304D\u308B","\u3067\u304D\u308B"],["\u51FA\u6765\u308B","\u3067\u304D\u308B"]],reason:"\u73B0\u4EE3\u9ED8\u8BA4\u5199\u4F5C\u5047\u540D\uFF0C\u51FA\u6765\u308B\u662F\u540C\u4E00\u8BCD\u7684\u6C49\u5B57\u5199\u6CD5\u3002"},{id:"\u3069\u3046-kanji-variant",members:[["\u3069\u3046","\u3069\u3046"],["\u5982\u4F55","\u3069\u3046"]],reason:"\u3069\u3046\u4E0E\u5982\u4F55\uFF08\u3069\u3046\uFF09\u662F\u540C\u4E00\u526F\u8BCD\u7684\u5047\u540D/\u6C49\u5B57\u5199\u6CD5\u3002"},{id:"\u3044\u304B\u304C-kanji-variant",members:[["\u3044\u304B\u304C","\u3044\u304B\u304C"],["\u5982\u4F55","\u3044\u304B\u304C"]],reason:"\u3044\u304B\u304C\u4E0E\u5982\u4F55\uFF08\u3044\u304B\u304C\uFF09\u662F\u540C\u4E00\u8BCD\u7684\u5047\u540D/\u6C49\u5B57\u5199\u6CD5\uFF1B\u5982\u4F55\uFF08\u3069\u3046\uFF09\u662F\u53E6\u4E00\u8BFB\u6CD5\uFF0C\u4FDD\u7559\u3002"},{id:"\u3069\u3061\u3089-kanji-variant",members:[["\u3069\u3061\u3089","\u3069\u3061\u3089"],["\u4F55\u65B9","\u3069\u3061\u3089"]],reason:"\u73B0\u4EE3\u9ED8\u8BA4\u5199\u4F5C\u5047\u540D\uFF0C\u4F55\u65B9\uFF08\u3069\u3061\u3089\uFF09\u662F\u540C\u4E00\u4EE3\u8BCD\u7684\u6C49\u5B57\u5199\u6CD5\u3002"},{id:"\u3069\u306A\u305F-kanji-variant",members:[["\u3069\u306A\u305F","\u3069\u306A\u305F"],["\u4F55\u65B9","\u3069\u306A\u305F"]],reason:"\u73B0\u4EE3\u9ED8\u8BA4\u5199\u4F5C\u5047\u540D\uFF0C\u4F55\u65B9\uFF08\u3069\u306A\u305F\uFF09\u662F\u540C\u4E00\u4EE3\u8BCD\u7684\u6C49\u5B57\u5199\u6CD5\u3002"},{id:"\u3069\u308C-kanji-variant",members:[["\u3069\u308C","\u3069\u308C"],["\u4F55\u308C","\u3069\u308C"]],reason:"\u73B0\u4EE3\u9ED8\u8BA4\u5199\u4F5C\u5047\u540D\uFF0C\u4F55\u308C\u662F\u540C\u4E00\u4EE3\u8BCD\u7684\u6C49\u5B57\u5199\u6CD5\u3002"},{id:"\u307E\u3060-kanji-variant",members:[["\u307E\u3060","\u307E\u3060"],["\u672A\u3060","\u307E\u3060"]],reason:"\u307E\u3060\u4E0E\u672A\u3060\u662F\u540C\u4E00\u526F\u8BCD\u7684\u5047\u540D/\u6C49\u5B57\u5199\u6CD5\u3002"},{id:"\u305F\u307E\u306B-kanji-variant",members:[["\u305F\u307E\u306B","\u305F\u307E\u306B"],["\u5076\u306B","\u305F\u307E\u306B"]],reason:"\u73B0\u4EE3\u9ED8\u8BA4\u5199\u4F5C\u5047\u540D\uFF0C\u5076\u306B\u662F\u540C\u4E00\u526F\u8BCD\u7684\u6C49\u5B57\u5199\u6CD5\u3002"},{id:"\u3057\u3063\u304B\u308A-kanji-variant",members:[["\u3057\u3063\u304B\u308A","\u3057\u3063\u304B\u308A"],["\u78BA\u308A","\u3057\u3063\u304B\u308A"]],reason:"\u73B0\u4EE3\u9ED8\u8BA4\u5199\u4F5C\u5047\u540D\uFF0C\u78BA\u308A\u662F\u540C\u4E00\u526F\u8BCD\u7684\u6C49\u5B57\u5199\u6CD5\u3002"},{id:"\u3057\u307E\u3046-kanji-variant",members:[["\u3057\u307E\u3046","\u3057\u307E\u3046"],["\u4ED5\u821E\u3046","\u3057\u307E\u3046"]],reason:"\u3057\u307E\u3046\u4E0E\u4ED5\u821E\u3046\u662F\u540C\u4E00\u52A8\u8BCD\u7684\u5047\u540D/\u6C49\u5B57\u5199\u6CD5\u3002"},{id:"\u3046\u308C\u3057\u3044-kanji-variant",members:[["\u3046\u308C\u3057\u3044","\u3046\u308C\u3057\u3044"],["\u5B09\u3057\u3044","\u3046\u308C\u3057\u3044"]],reason:"\u3046\u308C\u3057\u3044\u4E0E\u5B09\u3057\u3044\u662F\u540C\u4E00\u5F62\u5BB9\u8BCD\u7684\u5047\u540D/\u6C49\u5B57\u5199\u6CD5\u3002"},{id:"\u3059\u3070\u3089\u3057\u3044-kanji-variant",members:[["\u3059\u3070\u3089\u3057\u3044","\u3059\u3070\u3089\u3057\u3044"],["\u7D20\u6674\u3089\u3057\u3044","\u3059\u3070\u3089\u3057\u3044"]],reason:"\u3059\u3070\u3089\u3057\u3044\u4E0E\u7D20\u6674\u3089\u3057\u3044\u662F\u540C\u4E00\u5F62\u5BB9\u8BCD\u7684\u5047\u540D/\u6C49\u5B57\u5199\u6CD5\u3002"},{id:"\u307E\u3063\u3059\u3050-kanji-variant",members:[["\u307E\u3063\u3059\u3050","\u307E\u3063\u3059\u3050"],["\u771F\u3063\u76F4\u3050","\u307E\u3063\u3059\u3050"]],reason:"\u307E\u3063\u3059\u3050\u4E0E\u771F\u3063\u76F4\u3050\u662F\u540C\u4E00\u5F62\u5BB9\u52A8\u8BCD\u7684\u5047\u540D/\u6C49\u5B57\u5199\u6CD5\u3002"},{id:"\u3086\u3046\u3079-kanji-variant",members:[["\u3086\u3046\u3079","\u3086\u3046\u3079"],["\u6628\u591C","\u3086\u3046\u3079"]],reason:"\u3086\u3046\u3079\u4E0E\u6628\u591C\u662F\u540C\u4E00\u540D\u8BCD\u7684\u5047\u540D/\u6C49\u5B57\u5199\u6CD5\u3002"},{id:"\u3046\u3061-kanji-variant",members:[["\u3046\u3061","\u3046\u3061"],["\u5185","\u3046\u3061"]],reason:"\u8868\u793A\u5BB6\u91CC/\u5185\u90E8\u7684\u3046\u3061\u4E0E\u5185\u662F\u540C\u4E00\u8BCD\u7684\u5047\u540D/\u6C49\u5B57\u5199\u6CD5\u3002"},{id:"\u3051\u304C-kanji-variant",members:[["\u3051\u304C","\u3051\u304C"],["\u602A\u6211","\u3051\u304C"]],reason:"\u3051\u304C\u4E0E\u602A\u6211\u662F\u540C\u4E00\u540D\u8BCD\u7684\u5047\u540D/\u6C49\u5B57\u5199\u6CD5\u3002"},{id:"\u304B\u3076\u308B-kanji-variant",members:[["\u304B\u3076\u308B","\u304B\u3076\u308B"],["\u88AB\u308B","\u304B\u3076\u308B"]],reason:"\u8868\u793A\u6234\u4E0A/\u8499\u4E0A\u7684\u304B\u3076\u308B\u4E0E\u88AB\u308B\u662F\u540C\u4E00\u52A8\u8BCD\u7684\u5047\u540D/\u6C49\u5B57\u5199\u6CD5\u3002"},{id:"\u306F\u304F-kanji-variant",members:[["\u306F\u304F","\u306F\u304F"],["\u5C65\u304F","\u306F\u304F"]],reason:"\u8868\u793A\u7A7F\u4E0B\u88C5/\u978B\u7684\u306F\u304F\u4E0E\u5C65\u304F\u662F\u540C\u4E00\u52A8\u8BCD\uFF1B\u6383\u304F\u3001\u5410\u304F\u4E0D\u662F\u6210\u5458\u3002"},{id:"\u3088\u308B-kanji-variant",members:[["\u3088\u308B","\u3088\u308B"],["\u5BC4\u308B","\u3088\u308B"]],reason:"\u8868\u793A\u9760\u8FD1/\u987A\u9053\u62DC\u8BBF\u7684\u3088\u308B\u4E0E\u5BC4\u308B\u662F\u540C\u4E00\u52A8\u8BCD\uFF1B\u591C\u662F\u53E6\u4E00\u8BCD\uFF0C\u4FDD\u7559\u3002"},{id:"\u305F\u3060\u3057-kanji-variant",members:[["\u4F46\u3057","\u305F\u3060\u3057"],["\u305F\u3060\u3057","\u305F\u3060\u3057"]],reason:"\u73B0\u4EE3\u9ED8\u8BA4\u5199\u4F5C\u5047\u540D\uFF0C\u4F46\u3057\u4E0E\u4F46\u3057\u662F\u540C\u4E00\u63A5\u7EED\u8BCD\u3002"},{id:"\u3055\u3089\u306B-kanji-variant",members:[["\u3055\u3089\u306B","\u3055\u3089\u306B"],["\u66F4\u306B","\u3055\u3089\u306B"]],reason:"\u73B0\u4EE3\u9ED8\u8BA4\u5199\u4F5C\u5047\u540D\uFF0C\u3055\u3089\u306B\u4E0E\u66F4\u306B\u306F\u540C\u4E00\u526F\u8BCD\u3002"},{id:"\u305F\u305A\u306D\u308B-kanji-variant",members:[["\u5C0B\u306D\u308B","\u305F\u305A\u306D\u308B"],["\u8A0A[\u305F\u305A]\u306D\u308B","\u305F\u305A\u306D\u308B"]],reason:"\u8868\u793A\u8BE2\u95EE\u7684\u5C0B\u306D\u308B\u4E0E\u8A0A\u306D\u308B\u662F\u540C\u4E00\u52A8\u8BCD\u7684\u5F02\u4F53\u5199\u6CD5\uFF1B\u5BFB\u8BBF\u4E49\u4FDD\u7559\u5728\u8F83\u5B8C\u6574\u8BCD\u6761\u3002"},{id:"\u304B\u305F\u3065\u3051\u308B-kanji-variant",members:[["\u7247\u4ED8\u3051\u308B","\u304B\u305F\u3065\u3051\u308B"],["\u7247\u3065\u3051\u308B","\u304B\u305F\u3065\u3051\u308B"]],reason:"\u7247\u4ED8\u3051\u308B\u4E0E\u7247\u3065\u3051\u308B\u662F\u540C\u4E00\u52A8\u8BCD\u7684\u9001\u308A\u4EEE\u540D\u53D8\u4F53\u3002"},{id:"\u3051\u3093\u304B-annotation-duplicate",members:[["\u55A7\u5629[\u3051\u3093\u304B]","\u3051\u3093\u304B"],["\u55A7\u5629","\u3051\u3093\u304B"]],reason:"\u65B9\u62EC\u53F7\u8BFB\u97F3\u6807\u6CE8\u88AB\u6E05\u7406\u540E\u662F\u540C\u4E00\u8BCD\u6761\u3002"},{id:"\u3046\u308F\u3055-annotation-duplicate",members:[["\u5642[\u3046\u308F\u3055]","\u3046\u308F\u3055"],["\u5642","\u3046\u308F\u3055"]],reason:"\u65B9\u62EC\u53F7\u8BFB\u97F3\u6807\u6CE8\u88AB\u6E05\u7406\u540E\u662F\u540C\u4E00\u8BCD\u6761\u3002"},{id:"\u305F\u305F\u304F-annotation-duplicate",members:[["\u53E9\u304F","\u305F\u305F\u304F"],["\u53E9[\u305F\u305F]\u304F","\u305F\u305F\u304F"]],reason:"\u65B9\u62EC\u53F7\u8BFB\u97F3\u6807\u6CE8\u88AB\u6E05\u7406\u540E\u662F\u540C\u4E00\u8BCD\u6761\u3002"},{id:"\u305D\u3070-annotation-duplicate",members:[["\u854E\u9EA6[\u305D\u3070]","\u305D\u3070"],["\u854E\u9EA6","\u305D\u3070"]],reason:"\u65B9\u62EC\u53F7\u8BFB\u97F3\u6807\u6CE8\u88AB\u6E05\u7406\u540E\u662F\u540C\u4E00\u8BCD\u6761\uFF1B\u5074\u662F\u53E6\u4E00\u8BCD\uFF0C\u4FDD\u7559\u3002"},{id:"\u3057\u304B\u3057-kanji-variant",members:[["\u3057\u304B\u3057","\u3057\u304B\u3057"],["\u7136\u3057","\u3057\u304B\u3057"]],reason:"\u73B0\u4EE3\u9ED8\u8BA4\u5199\u4F5C\u5047\u540D\uFF0C\u7136\u3057\u662F\u540C\u4E00\u63A5\u7EED\u8BCD\u7684\u6C49\u5B57\u5199\u6CD5\u3002"},{id:"\u305F\u3060\u3044\u307E-kanji-variant",members:[["\u305F\u3060\u4ECA","\u305F\u3060\u3044\u307E"],["\u53EA\u4ECA","\u305F\u3060\u3044\u307E"]],reason:"\u305F\u3060\u4ECA\u4E0E\u53EA\u4ECA\u662F\u540C\u4E00\u526F\u8BCD\u7684\u8868\u8BB0\u53D8\u4F53\u3002"},{id:"\u5165\u53E3-\u9001\u308A\u4EEE\u540D-variant",members:[["\u5165\u53E3","\u3044\u308A\u3050\u3061"],["\u5165\u308A\u53E3","\u3044\u308A\u3050\u3061"]],reason:"\u5165\u53E3\u4E0E\u5165\u308A\u53E3\u662F\u540C\u4E00\u540D\u8BCD\u7684\u8868\u8BB0\u53D8\u4F53\uFF0C\u4E0D\u5E94\u4F5C\u4E3A\u6C49\u5B57\u7528\u6CD5\u8FA8\u6790\u3002"},{id:"\u6669\u3054\u98EF-\u6669\u5FA1\u98EF-variant",members:[["\u6669\u3054\u98EF","\u3070\u3093\u3054\u306F\u3093"],["\u6669\u5FA1\u98EF","\u3070\u3093\u3054\u306F\u3093"]],reason:"\u6669\u3054\u98EF\u4E0E\u6669\u5FA1\u98EF\u662F\u540C\u4E00\u540D\u8BCD\u7684\u8868\u8BB0\u53D8\u4F53\u3002"},{id:"\u6C17\u3092\u4ED8\u3051\u308B-\u6C17\u3092\u3064\u3051\u308B-variant",members:[["\u6C17\u3092\u4ED8\u3051\u308B","\u304D\u3092\u3064\u3051\u308B"],["\u6C17\u3092\u3064\u3051\u308B","\u304D\u3092\u3064\u3051\u308B"]],reason:"\u6C17\u3092\u4ED8\u3051\u308B\u4E0E\u6C17\u3092\u3064\u3051\u308B\u662F\u540C\u4E00\u60EF\u7528\u8868\u8FBE\u7684\u8868\u8BB0\u53D8\u4F53\u3002"}],Cg=[{id:"synonym-things-east-west",members:[["\u7269","\u3082\u306E"],["\u6771\u897F","\u3068\u3046\u3056\u3044"]],reason:"\u4E2D\u6587\u2018\u4E1C\u897F\u2019\u540C\u5F62\uFF1B\u7269\u662F\u4E1C\u897F\uFF0C\u6771\u897F\u662F\u4E1C\u4E0E\u897F\uFF0C\u4E0D\u662F\u65E5\u8BED\u8FD1\u4E49\u8BCD\u3002"},{id:"synonym-thousand-kilo",members:[["\u5343","\u305B\u3093"],["(\u30D5) kilo","\u30AD\u30ED"]],reason:"\u5343\u662F\u6570\u8BCD\uFF0C\u30AD\u30ED\u662F\u53EF\u8868\u793A\u5343\u514B/\u5343\u7C73\u7B49\u5355\u4F4D\uFF0C\u4E0D\u80FD\u4E92\u6362\u3002"},{id:"synonym-can-tank",members:[["\u7F36","\u304B\u3093"],["tank","\u30BF\u30F3\u30AF"]],reason:"\u7F36\u662F\u7F50\u5934/\u7F50\uFF0C\u30BF\u30F3\u30AF\u662F\u50A8\u7F50\u6216\u5927\u578B\u5BB9\u5668\uFF0C\u4E2D\u6587\u9996\u4E49\u78B0\u649E\u4E0D\u6784\u6210\u8FD1\u4E49\u3002"},{id:"synonym-ice-ice-cream",members:[["\u6C37","\u3053\u304A\u308A"],["ice","\u30A2\u30A4\u30B9"]],reason:"\u6C37\u662F\u51B0\uFF0C\u30A2\u30A4\u30B9\u8FD8\u53EF\u6307\u51B0\u6DC7\u6DCB\uFF0C\u4E0D\u662F\u540C\u4E00\u8BCD\u4E49\u3002"},{id:"synonym-date-calendar-appointment",members:[["date","\u30C7\u30FC\u30C8"],["\u65E5\u4ED8","\u3072\u3065\u3051"],["\u65E5\u306B\u3061","\u3072\u306B\u3061"],["\u671F\u65E5","\u304D\u3058\u3064"]],reason:"\u30C7\u30FC\u30C8\u662F\u7EA6\u4F1A\uFF0C\u5176\u4ED6\u6210\u5458\u662F\u65E5\u671F/\u671F\u9650\uFF0C\u539F\u4E2D\u6587\u9996\u4E49\u5C5E\u4E8E\u8BEF\u8BD1\u6216\u591A\u4E49\u78B0\u649E\u3002"},{id:"synonym-receipt-ticketing",members:[["\u9818\u53CE\u66F8","\u308A\u3087\u3046\u3057\u3085\u3046\u3057\u3087"],["\u767A\u5238","\u306F\u3063\u3051\u3093"]],reason:"\u9818\u53CE\u66F8\u662F\u6536\u636E\uFF0C\u767A\u5238\u662F\u51FA\u7968/\u53D1\u884C\u7968\u5238\uFF0C\u4E0D\u662F\u53D1\u7968\u7684\u540C\u4E49\u8BCD\u3002"},{id:"synonym-title-question",members:[["\u984C\u540D","\u3060\u3044\u3081\u3044"],["\u984C","\u3060\u3044"],["\u8A2D\u554F","\u305B\u3064\u3082\u3093"]],reason:"\u984C\u540D\u662F\u6807\u9898\uFF0C\u984C/\u8A2D\u554F\u662F\u9898\u76EE\u6216\u8BBE\u95EE\uFF0C\u4E0D\u80FD\u4F5C\u4E3A\u4E00\u7EC4\u53EF\u4E92\u6362\u8BCD\u3002"},{id:"synonym-quality-mass",members:[["\u8CEA","\u3057\u3064"],["\u8CEA\u91CF","\u3057\u3064\u308A\u3087\u3046"]],reason:"\u8CEA\u662F\u8D28\u91CF/\u7D20\u8D28\uFF0C\u8CEA\u91CF\u662F\u7269\u7406\u5B66\u7684\u8D28\u91CF\uFF08mass\uFF09\uFF0C\u4E2D\u6587\u540C\u5B57\u4E0D\u540C\u4E49\u3002"},{id:"synonym-ecology-eco",members:[["\u751F\u614B","\u305B\u3044\u305F\u3044"],["eco","\u30A8\u30B3"]],reason:"\u751F\u614B\u662F\u751F\u6001\u72B6\u6001\uFF0C\u30A8\u30B3\u662F\u73AF\u4FDD/\u751F\u6001\u53CB\u597D\uFF0C\u4E0D\u80FD\u4E92\u6362\u3002"},{id:"synonym-literary-entertainment",members:[["\u82B8\u80FD","\u3052\u3044\u306E\u3046"],["\u6587\u82B8","\u3076\u3093\u3052\u3044"]],reason:"\u82B8\u80FD\u662F\u6F14\u827A/\u5A31\u4E50\uFF0C\u6587\u82B8\u662F\u6587\u5B66\u827A\u672F\uFF0C\u4E2D\u6587\u2018\u6587\u827A\u2019\u9020\u6210\u8BEF\u5408\u5E76\u3002"},{id:"synonym-lesson-curriculum",members:[["lesson","\u30EC\u30C3\u30B9\u30F3"],["curriculum","\u30AB\u30EA\u30AD\u30E5\u30E9\u30E0"]],reason:"\u30EC\u30C3\u30B9\u30F3\u662F\u5355\u8282\u8BFE/\u8BFE\u7A0B\uFF0C\u30AB\u30EA\u30AD\u30E5\u30E9\u30E0\u662F\u8BFE\u7A0B\u4F53\u7CFB\uFF0C\u4E0D\u662F\u540C\u4E49\u8BCD\u3002"},{id:"synonym-potted-plant-garden-tree",members:[["\u9262\u690D\u3048","\u306F\u3061\u3046\u3048"],["\u690D\u6728","\u3046\u3048\u304D"]],reason:"\u9262\u690D\u3048\u662F\u76C6\u683D\u690D\u7269\uFF0C\u690D\u6728\u662F\u5EAD\u9662\u6811\u6728/\u56ED\u6797\u690D\u7269\uFF0C\u4E2D\u6587\u9996\u4E49\u8FC7\u5BBD\u3002"},{id:"synonym-decisive-absolutely-not",members:[["\u65AD\u7136","\u3060\u3093\u305C\u3093"],["\u65AD\u3058\u3066","\u3060\u3093\u3058\u3066"]],reason:"\u65AD\u7136\u662F\u65AD\u7136/\u660E\u663E\u5730\uFF0C\u65AD\u3058\u3066\u5E38\u7528\u4E8E\u2018\u7EDD\u4E0D\u2019\uFF0C\u4E0D\u662F\u540C\u4E49\u8BCD\u3002"},{id:"synonym-terminal-station-device",members:[["terminal","\u30BF\u30FC\u30DF\u30CA\u30EB"],["\u7AEF\u672B","\u305F\u3093\u307E\u3064"]],reason:"\u30BF\u30FC\u30DF\u30CA\u30EB\u53EF\u6307\u7EC8\u70B9\u7AD9\uFF0C\u7AEF\u672B\u662F\u7EC8\u7AEF\u8BBE\u5907\uFF0C\u4E2D\u6587\u9996\u4E49\u4E0D\u5E94\u5408\u7EC4\u3002"},{id:"synonym-route-circuit",members:[["\u8DEF\u7DDA","\u308D\u305B\u3093"],["\u56DE\u7DDA","\u304B\u3044\u305B\u3093"]],reason:"\u8DEF\u7DDA\u662F\u8DEF\u7EBF\uFF0C\u56DE\u7DDA\u662F\u901A\u4FE1\u7EBF\u8DEF/\u7535\u8DEF\uFF0C\u4E2D\u6587\u2018\u7EBF\u8DEF\u2019\u9020\u6210\u8BEF\u5408\u5E76\u3002"}]});var ki=le((JI,Ig)=>{Ig.exports=new Proxy({},{get:(e,t)=>t==="__esModule"?!1:()=>({})})});var ol={};M(ol,{CONFUSION_TYPES:()=>zb,TYPE_META:()=>Go,TYPE_PRIORITY:()=>Ko,confusionGroups:()=>Qe,confusionGroupsForWord:()=>hr,displayForm:()=>be,duplicateMergeTargets:()=>Ui,duplicateWordIds:()=>xi,firstSense:()=>Ii,groupWordParts:()=>Fg,groupWords:()=>Vb,masteredConfusionKeys:()=>Yb,resetConfusionGroups:()=>xn,setConfusionMastered:()=>nl,warmConfusionGroups:()=>qb});var Mg,xg,xe,Pb,In,Mi,Ii,Mn,Hb,Ko,Qr,Kb,ut,Gb,Bb,Xb,vi,Ho,Ci,xn,xi,Ui,Ug,Qe,Yb,nl,zb,Go,be,Fg,Vb,Di,hr,qb,sr=h(()=>{"use strict";Mg=N($(),1);Jr();P();G();xg=N(Ar(),1);Dg();tr();xe=N(ki(),1),Pb=8,In=/[㐀-鿿]/,Mi=/[A-Za-z]/,Ii=e=>{let t=0;for(let r=0;r<e.length;r+=1){let n=e[r];if(n==="\uFF08"||n==="(")t+=1;else if(n==="\uFF09"||n===")")t=Math.max(0,t-1);else if(t===0&&"\uFF1B;\uFF0C,\u3001".includes(n))return e.slice(0,r).trim()}return e.trim()},Mn=e=>e.senseKey||Ii(e.meaning),Hb=e=>({id:e.id,kanji:e.kanji,kana:e.kana,meaning:e.meaning,exampleJp:e.exampleJp,exampleMeaning:e.exampleMeaning,jlptLevel:e.jlptLevel,senseKey:Mn(e)}),Ko=["pair","kanji-choice","reading-register","reading-sense","homophone","stem","synonym","near-synonym"],Qr=(e,t)=>{let r=new Map;return e.forEach(n=>{let o=t(n);if(!o)return;let s=r.get(o);s?s.push(n):r.set(o,[n])}),r},Kb=e=>{let t=new Map,r=new Set,n=(a,d)=>{r.add(a.id),t.set(a.id,d.id)},o=Qr(e,a=>`${a.kanji}\0${a.kana}`);o.forEach(a=>{if(!a[0].kanji||a.length<2)return;let[d,...u]=[...a].sort((l,c)=>ut(l)-ut(c)||l.id-c.id);u.forEach(l=>n(l,d))}),Qr(e.filter(a=>!r.has(a.id)),a=>a.kana).forEach((a,d)=>{if(a.length!==2)return;let u=a.filter(m=>Mi.test(m.kanji)),l=a.filter(m=>m.kanji===d);if(u.length!==1||l.length!==1)return;let[c,f]=[...a].sort((m,g)=>ut(m)-ut(g)||m.id-g.id);n(f,c)});let s=e.filter(a=>!r.has(a.id));Qr(s,a=>`${a.kana}\0${Mn(a)}`).forEach(a=>{if(a.length<2)return;let d=a.filter(c=>In.test(c.kanji));if(d.length===a.length)return;if(d.length){let c=[...d].sort((f,m)=>ut(f)-ut(m)||f.id-m.id)[0];a.filter(f=>!In.test(f.kanji)).forEach(f=>n(f,c));return}let u=c=>c.kanji===c.kana?1:0,l=[...a].sort((c,f)=>ut(c)-ut(f)||u(c)-u(f)||c.id-f.id)[0];a.filter(c=>c.id!==l.id).forEach(c=>n(c,l))}),vg.forEach(a=>{let d=a.members.map(([l,c])=>o.get(`${l}\0${c}`)?.find(f=>!r.has(f.id))).filter(l=>!!l);if(d.length<2)return;let u=[...d].sort((l,c)=>ut(l)-ut(c)||l.id-c.id)[0];d.filter(l=>l.id!==u.id).forEach(l=>n(l,u))});let i=(a,d=new Set)=>{let u=t.get(a);return u===void 0||d.has(a)?a:(d.add(a),i(u,d))};return new Map([...t.keys()].map(a=>[a,i(a)]))},ut=e=>(e.exampleJp?0:2)+(e.jlptLevel?0:1),Gb=(e,t)=>e==="reading-register"||e==="reading-sense"?t.kana:be(t),Bb=(e,t)=>{let r=Gb(e,t);return Mi.test(t.kanji)?`${r}\0${t.kanji}`:r},Xb=e=>{let t=xi(),r=e.filter(m=>!t.has(m.id)),n=[],o=new Map,s=(m,g,S,w=`${m}:${g}`)=>{let y=new Map;S.forEach(C=>{let L=Bb(m,C),I=y.get(L);(!I||ut(C)<ut(I))&&y.set(L,C)});let _=[...y.values()];if(_.length<2||_.length>Pb)return;let b=m==="synonym"&&new Set(_.map(C=>Ii(C.meaning))).size>1?"near-synonym":m,k={key:w,type:b,label:g,members:_.map(Hb)};n.push(k);for(let C of _){let L=o.get(C.id);L?L.push(k):o.set(C.id,[k])}},i=xg.default,a=new Set,d=Qr(r,m=>m.kanji),u=Qr(r,m=>m.kana);r.forEach(m=>{let g=i[m.kanji]??i[m.kana];if(!g)return;let S=g[1],w=g[2],y=[...new Set([...(d.get(S)??[]).filter(b=>!w||b.kana===w),...u.get(S)??[]])].sort((b,k)=>b.order-k.order);if(!y.length)return;let _=[m.kanji||m.kana,S].sort().join(" / ");a.has(_)||(a.add(_),s("pair",_,[m,...y]))}),u.forEach((m,g)=>{if(m.length<2)return;if(new Set(m.map(w=>Mn(w))).size>1){s("homophone",g,m);return}m.every(w=>In.test(w.kanji))&&s("kanji-choice",g,m)}),d.forEach((m,g)=>{if(!In.test(g)||new Set(m.map(w=>w.kana)).size<2)return;let S=new Set(m.map(w=>Mn(w)));s(S.size===1?"reading-register":"reading-sense",g,m)});let l=r.filter(m=>(m.verbType==="godan"||m.verbType==="ichidan")&&In.test(m.kanji));Qr(l,m=>m.kanji.match(In)?.[0]??"").forEach((m,g)=>{let S=new Map(m.map(y=>[y,new Set(Mn(y).match(/[㐀-鿿]/g)??[])])),w=m.filter(y=>{let _=S.get(y);return m.some(b=>b.id!==y.id&&[...S.get(b)].some(k=>_.has(k)))});s("stem",g,w)});let c=m=>{Qr(r,m?g=>Ii(g.meaning):Mn).forEach((g,S)=>{if(g.length<2||new Set(g.map(_=>_.pos)).size>1)return;let w=new Set(g.map(_=>`${_.kanji}\0${_.kana}`));Cg.some(_=>_.members.length===g.length&&_.members.every(([b,k])=>w.has(`${b}\0${k}`)))||m&&o.get(g[0].id)?.some(_=>g.every(b=>_.members.some(k=>k.id===b.id)))||s("synonym",S,g,`${m?"synonym-now":"synonym"}:${S}`)})};c(!1),c(!0);let f=new Map;return n.forEach(m=>{let g=m.members.map(w=>w.id).sort((w,y)=>w-y).join(","),S=f.get(g);(!S||Ko.indexOf(m.type)<Ko.indexOf(S.type))&&f.set(g,m)}),[...f.values()]},vi=null,Ho=null,Ci=null,xn=()=>{vi=null,Ho=null,Ci=null,Di=null},xi=()=>new Set(Ui().keys()),Ui=()=>(Ci||(Ci=Kb(Ug())),Ci),Ug=()=>{if(Ho)return Ho;let e=p("PRAGMA table_info(words)").some(r=>r.name==="sense_key");return Ho=JSON.parse(E(`
    SELECT json_group_array(json_array(id, kanji, kana, meaning, pos, verb_type,
      example_jp, example_meaning, jlpt_level, ${e?"sense_key":"''"}))
    FROM words
  `,[],"[]")).map((r,n)=>({order:n,id:Number(r[0]??0),kanji:String(r[1]??""),kana:String(r[2]??""),meaning:String(r[3]??""),pos:String(r[4]??""),verbType:String(r[5]??""),exampleJp:String(r[6]??""),exampleMeaning:String(r[7]??""),jlptLevel:String(r[8]??""),senseKey:String(r[9]??"")})).filter(r=>r.id&&!Mi.test(r.kana)),Ho},Qe=()=>(vi||(vi=Xb(Ug())),vi),Yb=()=>new Set(p("SELECT group_key FROM confusion_mastered").map(e=>String(e.group_key??""))),nl=(e,t)=>{V();let r=(0,Mg.getDatabase)();t?r.run("INSERT OR REPLACE INTO confusion_mastered (group_key, mastered_on) VALUES (?, date('now','localtime'))",[e]):r.run("DELETE FROM confusion_mastered WHERE group_key = ?",[e]),D()},zb=["pair","homophone","kanji-choice","reading-sense","reading-register","stem","synonym","near-synonym"],Go={pair:{name:"\u81EA\u4ED6\u52A8\u8BCD",Icon:xe.ArrowLeftRight},homophone:{name:"\u540C\u97F3\u5F02\u4E49",Icon:xe.Volume2},"kanji-choice":{name:"\u6C49\u5B57\u7528\u6CD5",Icon:xe.PenLine},"reading-register":{name:"\u8BFB\u97F3\u8BED\u4F53",Icon:xe.Crown},"reading-sense":{name:"\u4E00\u5F62\u591A\u8BFB",Icon:xe.Type},stem:{name:"\u540C\u8BCD\u6839",Icon:xe.Sprout},synonym:{name:"\u9996\u4E49\u76F8\u540C",Icon:xe.Handshake},"near-synonym":{name:"\u91CA\u4E49\u76F8\u8FD1",Icon:xe.Handshake}},be=e=>Or({kanji:e.kanji??"",kana:e.kana??""}),Fg=e=>{if(e.type==="reading-register"||e.type==="reading-sense")return e.members.map(n=>({text:n.kana,reading:""}));let t=e.members.map(be),r=new Set(t).size!==t.length;return e.members.map((n,o)=>{let s=r&&Mi.test(n.kanji);return{text:s?n.kanji:t[o],reading:s?"":n.kana}})},Vb=e=>Fg(e).map(t=>t.text).join(" / "),Di=null,hr=e=>{if(!Di){let t=new Map;Qe().forEach(r=>{r.members.forEach(n=>{let o=t.get(n.id);o?o.push(r):t.set(n.id,[r])})}),t.forEach(r=>r.sort((n,o)=>Ko.indexOf(n.type)-Ko.indexOf(o.type))),Di=t}return Di.get(e)??[]},qb=()=>{ee("\u8FA8\u6790 \xB7 \u5206\u7EC4\u7D22\u5F15",()=>hr(0))}});var Jb,Qb,Wg,Un,Bo,jg,$g,Fi=h(()=>{"use strict";P();tr();Jb={N5:0,N4:1,N3:2,N2:3,N1:4},Qb=2.5,Wg=e=>Jb[e]??Qb,Un=null,Bo=()=>{Un=null},jg=()=>{if(Un)return Un;try{Un=ee("\u8FA8\u6790 \xB7 \u719F\u6089\u5EA6\u7D22\u5F15",()=>new Set(p("SELECT word_id FROM progress WHERE fsrs_last_review IS NOT NULL OR fsrs_due IS NOT NULL").map(e=>Number(e.word_id??0)).filter(e=>e>0)))}catch{Un=new Set}return Un},$g=(e,t,r)=>Wg(t)<=Wg(e)||jg().has(r)});function Zb(e,t){let r=Array.from(e),n=Array.from(t),o=new Array(n.length+1),s=new Array(n.length+1);for(let i=0;i<=n.length;i+=1)o[i]=i;for(let i=1;i<=r.length;i+=1){s[0]=i;for(let d=1;d<=n.length;d+=1)s[d]=Math.min(o[d]+1,s[d-1]+1,o[d-1]+(r[i-1]===n[d-1]?0:1));let a=o;o=s,s=a}return o[n.length]}function ji(e,t){return e===t?1:Math.max(1-Zb(e,t)/Math.max(Array.from(e).length,Array.from(t).length,1),0)}function il(e,t){let r=ji(e,t);return e&&t&&e[0]===t[0]&&(r+=.08),e&&t&&e[e.length-1]===t[t.length-1]&&(r+=.08),Array.from(e).length===Array.from(t).length&&(r+=.06),Math.min(r,1)}function al(e){let t=Array.from(e).length;return t<=2?.9:t===3?.82:t===4?.74:.68}function dl(e){let t=Array.from(e).length;return t<=3?1:t<=5?2:3}function Hg(e){let t=Number(e.id??0);if(t){let n=sl.get(t);if(n)return n}let r=rL(e);return t&&sl.set(t,r),r}function rL(e){let t=String(e.kana??"");if(!t)return[];let r=String(e.pos??"").split("\u30FB")[0],n=Number(e.id??0),o=Array.from(t).length,s=dl(t),i=al(t),a=eL(),d=xi(),u=[];for(let m=o-s;m<=o+s;m+=1){let g=a.get(m);g&&u.push(...g)}let l=String(e.jlpt_level??"");return u.flatMap(m=>{if(m.id===n||d.has(m.id))return[];if(!$g(l,m.jlptLevel,m.id))return[];let g=m.kana;if(g===t)return[];let S=ji(t,g),w=il(t,g),y=S*.65+w*.35;return r&&m.pos.includes(r)&&(y+=.04),e.verb_type&&e.verb_type===m.verbType&&(y+=.04),y<i?[]:[{similarity:y,candidate:m}]}).sort((m,g)=>g.similarity-m.similarity||g.candidate.importance-m.candidate.importance).slice(0,3).map(({candidate:m})=>({id:m.id,kana:m.kana,kanji:m.kanji,meaning:m.meaning,kind:"sound"}))}var sl,Pg,Wi,eL,tL,ul,Xo=h(()=>{"use strict";P();sr();Fi();tr();sl=new Map,Pg=()=>{sl.clear(),Wi=null};Wi=null,eL=()=>Wi||ee("\u8FA8\u6790 \xB7 \u5019\u9009\u8BCD\u7D22\u5F15",()=>{let e=new Map;for(let t of p("SELECT id, meaning, kana, kanji, pos, verb_type, importance, jlpt_level FROM words")){let r=String(t.kana??"");if(!r)continue;let n=Array.from(r).length,o={id:Number(t.id??0),meaning:String(t.meaning??""),kana:r,kanji:String(t.kanji??""),pos:String(t.pos??""),verbType:t.verb_type,importance:Number(t.importance??0),jlptLevel:String(t.jlpt_level??""),length:n},s=e.get(n);s?s.push(o):e.set(n,[o])}return Wi=e,e}),tL=/[^\u3400-\u9fff]+$/,ul=(e,t)=>{let r=o=>o.replace(tL,""),n=r(String(e.kanji??""));return!!n&&n===r(String(t.kanji??""))}});function Gg(e){let t=cl.find(d=>d.members.some(u=>nL(u,e)));if(!t)return iL(e);let r=Number(e.id??0),n=sL(t).filter(d=>d.id!==r),o=Kg(e),s=new Set(n.map(d=>d.id)),i=[...n,...o.filter(d=>!s.has(d.id))];if(!i.length)return null;let a=o.some(d=>!s.has(d.id));return{title:t.title,source:"manual",distinction:a?`${t.distinction}\u9898\u9762\u9996\u4E49\u76F8\u540C\u7684\u5176\u4ED6\u8BCD\u4E5F\u5217\u5728\u540E\u9762\uFF0C\u8BF7\u7ED3\u5408\u8BCD\u5F62\u3001\u8BED\u5883\u548C\u8BCD\u6027\u533A\u5206\u3002`:t.distinction,items:i}}var cl,nL,oL,ll,$i,sL,Kg,iL,Yo=h(()=>{"use strict";P();kr();cl=[{id:"mawari-kanji-choice",title:"\u307E\u308F\u308A\uFF1A\u56DE\u308A\uFF0F\u5468\u308A",distinction:"\u56DE\u308A\u662F\u65CB\u8F6C\u3001\u8FD0\u8F6C\u6216\u8F6E\u6B21\uFF1B\u5468\u308A\u662F\u5468\u56F4\u3001\u9644\u8FD1\u7684\u4EBA\u6216\u4E8B\u7269\u3002\u99C5\u306E\u307E\u308F\u308A\uFF08\u8F66\u7AD9\u5468\u56F4\uFF09\u5199\u4F5C\u300C\u99C5\u306E\u5468\u308A\u300D\u3002",members:[["\u56DE\u308A","\u307E\u308F\u308A","\u65CB\u8F6C"],["\u5468\u308A","\u307E\u308F\u308A","\u5468\u56F4\uFF1B\u9644\u8FD1"]]},{id:"honorific-come-go-be",title:"\u6765\uFF0F\u53BB\uFF0F\u5728\uFF08\u5C0A\u656C\u8BED\uFF09",distinction:"\u5F88\u591A\u666E\u901A\u201C\u6765\uFF0F\u53BB\uFF0F\u5728\u201D\u7684\u63D0\u793A\u90FD\u80FD\u5BF9\u5E94\u8FD9\u4E9B\u5C0A\u656C\u8868\u8FBE\uFF1B\u304A\u898B\u3048\u306B\u306A\u308B\u66F4\u504F\u201C\u6765\u5230\u3001\u5230\u573A\u201D\u3002",members:[["\u3044\u3089\u3063\u3057\u3083\u308B","\u3044\u3089\u3063\u3057\u3083\u308B","\u6765\u3001\u53BB\u3001\u5728\uFF08\u5C0A\u656C\u8BED\uFF09"],["\u304A\u3044\u3067\u306B\u306A\u308B","\u304A\u3044\u3067\u306B\u306A\u308B","\u6765\u3001\u53BB\u3001\u5728\uFF08\u5C0A\u656C\u8BED\uFF09"],["\u304A\u898B\u3048\u306B\u306A\u308B","\u304A\u307F\u3048\u306B\u306A\u308B","\u6765\u5230\u3001\u5230\u573A\uFF08\u5C0A\u656C\u8BED\uFF09"]]},{id:"honorific-eat-drink",title:"\u5403\uFF0F\u559D\uFF08\u656C\u8BED\uFF09",distinction:"\u53EC\u3057\u4E0A\u304C\u308B\u62AC\u9AD8\u5BF9\u65B9\uFF1B\u3044\u305F\u3060\u304F\u662F\u81EA\u5DF1\u8C26\u900A\u5730\u5403\u3001\u559D\u6216\u63A5\u53D7\u3002",members:[["\u98DF\u3079\u308B","\u305F\u3079\u308B","\u5403\uFF08\u666E\u901A\u8BF4\u6CD5\uFF09"],["\u53EC\u3057\u4E0A\u304C\u308B","\u3081\u3057\u3042\u304C\u308B","\u5403\u3001\u559D\uFF08\u5C0A\u656C\u8BED\uFF09"],["\u9802\u304F","\u3044\u305F\u3060\u304F","\u5403\u3001\u559D\uFF1B\u5F97\u5230\uFF08\u8C26\u8BA9\u8BED\uFF09"]]},{id:"honorific-say",title:"\u8BF4\uFF08\u656C\u8BED\uFF09",distinction:"\u304A\u3063\u3057\u3083\u308B\u662F\u5BF9\u65B9\u8BF4\uFF1B\u7533\u3059\u662F\u81EA\u5DF1\u8C26\u900A\u5730\u8BF4\u3002\u4E0D\u80FD\u4E92\u76F8\u66FF\u4EE3\u3002",members:[["\u304A\u3063\u3057\u3083\u308B","\u304A\u3063\u3057\u3083\u308B","\u8BF4\uFF08\u5C0A\u656C\u8BED\uFF09"],["\u7533\u3059","\u3082\u3046\u3059","\u8BF4\u3001\u79F0\u4E3A\uFF08\u8C26\u8BA9\u8BED\uFF09"]]},{id:"honorific-see",title:"\u770B\uFF08\u656C\u8BED\uFF09",distinction:"\u3054\u89A7\u306B\u306A\u308B\u62AC\u9AD8\u5BF9\u65B9\uFF1B\u62DD\u898B\u3059\u308B\u964D\u4F4E\u81EA\u5DF1\u3002",members:[["\u3054\u89A7\u306B\u306A\u308B","\u3054\u3089\u3093\u306B\u306A\u308B","\u770B\uFF08\u5C0A\u656C\u8BED\uFF09"],["\u62DD\u898B","\u306F\u3044\u3051\u3093","\u62DC\u89C1\u3001\u89C2\u770B\uFF08\u8C26\u8BA9\u8BED\uFF09"],["\u898B\u308B","\u307F\u308B","\u770B\uFF08\u666E\u901A\u8BF4\u6CD5\uFF09"]]},{id:"open",title:"\u5F00",distinction:"\u958B\u304F\uFF08\u3042\u304F\uFF09\u662F\u4E1C\u897F\u6253\u5F00\uFF1B\u958B\u304F\uFF08\u3072\u3089\u304F\uFF09\u5E38\u7528\u4E8E\u4E66\u3001\u6D3B\u52A8\u3001\u4F1A\u8BAE\uFF1B\u958B\u3051\u308B\u662F\u4EBA\u4E3A\u6253\u5F00\u3002",members:[["\u958B\u304F","\u3042\u304F","\u6253\u5F00\u3001\u5F00\u7740\uFF08\u81EA\u52A8\u8BCD\uFF09"],["\u958B\u304F","\u3072\u3089\u304F","\u6253\u5F00\uFF1B\u5F00\u529E\uFF08\u81EA\u52A8\u8BCD\uFF09"],["\u958B\u3051\u308B","\u3042\u3051\u308B","\u6253\u5F00\uFF08\u4ED6\u52A8\u8BCD\uFF09"]]},{id:"close",title:"\u5173",distinction:"\u9589\u307E\u308B\u662F\u81EA\u5DF1\u5173\u4E0A\uFF1B\u9589\u3081\u308B\u662F\u628A\u67D0\u7269\u5173\u4E0A\u3002",members:[["\u9589\u307E\u308B","\u3057\u307E\u308B","\u5173\u4E0A\uFF08\u81EA\u52A8\u8BCD\uFF09"],["\u9589\u3081\u308B","\u3057\u3081\u308B","\u5173\u4E0A\uFF08\u4ED6\u52A8\u8BCD\uFF09"]]},{id:"turn-on",title:"\u5F00\uFF0F\u4EAE\uFF0F\u63A5\u901A",distinction:"\u3064\u304F\u662F\u81EA\u5DF1\u4EAE\u3001\u63A5\u901A\u6216\u9644\u7740\uFF1B\u3064\u3051\u308B\u662F\u4EBA\u4E3A\u6253\u5F00\u3001\u63A5\u4E0A\u6216\u9644\u7740\u3002",members:[["\u3064\u304F","\u3064\u304F","\u4EAE\uFF1B\u63A5\u901A\uFF1B\u9644\u7740\uFF08\u81EA\u52A8\u8BCD\uFF09"],["\u3064\u3051\u308B","\u3064\u3051\u308B","\u6253\u5F00\uFF1B\u63A5\u4E0A\uFF1B\u9644\u7740\uFF08\u4ED6\u52A8\u8BCD\uFF09"]]},{id:"disappear",title:"\u6D88\u5931\uFF0F\u5173\u6389",distinction:"\u6D88\u3048\u308B\u662F\u81EA\u5DF1\u6D88\u5931\uFF1B\u6D88\u3059\u662F\u4EBA\u4E3A\u6D88\u9664\u6216\u5173\u6389\u3002",members:[["\u6D88\u3048\u308B","\u304D\u3048\u308B","\u6D88\u5931\uFF1B\u7184\u706D\uFF08\u81EA\u52A8\u8BCD\uFF09"],["\u6D88\u3059","\u3051\u3059","\u6D88\u9664\uFF1B\u5173\u6389\uFF08\u4ED6\u52A8\u8BCD\uFF09"]]},{id:"enter-put-in",title:"\u8FDB\u5165\uFF0F\u653E\u5165",distinction:"\u5165\u308B\u662F\u8FDB\u53BB\uFF1B\u5165\u308C\u308B\u662F\u628A\u4E1C\u897F\u653E\u8FDB\u53BB\u3002",members:[["\u5165\u308B","\u306F\u3044\u308B","\u8FDB\u5165\uFF08\u81EA\u52A8\u8BCD\uFF09"],["\u5165\u308C\u308B","\u3044\u308C\u308B","\u653E\u5165\uFF1B\u88C5\u5165\uFF08\u4ED6\u52A8\u8BCD\uFF09"]]},{id:"leave-take-out",title:"\u51FA\u53BB\uFF0F\u62FF\u51FA",distinction:"\u51FA\u308B\u662F\u51FA\u6765\u3001\u51FA\u53BB\uFF1B\u51FA\u3059\u662F\u62FF\u51FA\u3001\u63D0\u4EA4\u6216\u53D1\u51FA\u3002",members:[["\u51FA\u308B","\u3067\u308B","\u51FA\u53BB\uFF1B\u51FA\u6765\uFF08\u81EA\u52A8\u8BCD\uFF09"],["\u51FA\u3059","\u3060\u3059","\u62FF\u51FA\uFF1B\u63D0\u4EA4\uFF1B\u53D1\u51FA\uFF08\u4ED6\u52A8\u8BCD\uFF09"]]},{id:"start",title:"\u5F00\u59CB",distinction:"\u59CB\u307E\u308B\u662F\u4E8B\u60C5\u5F00\u59CB\uFF1B\u59CB\u3081\u308B\u662F\u67D0\u4EBA\u5F00\u59CB\u67D0\u4E8B\u3002",members:[["\u59CB\u307E\u308B","\u306F\u3058\u307E\u308B","\u5F00\u59CB\uFF08\u81EA\u52A8\u8BCD\uFF09"],["\u59CB\u3081\u308B","\u306F\u3058\u3081\u308B","\u5F00\u59CB\u505A\uFF08\u4ED6\u52A8\u8BCD\uFF09"]]},{id:"decide",title:"\u51B3\u5B9A",distinction:"\u6C7A\u307E\u308B\u662F\u88AB\u51B3\u5B9A\u3001\u5B9A\u4E0B\u6765\uFF1B\u6C7A\u3081\u308B\u662F\u4E3B\u52A8\u51B3\u5B9A\u3002",members:[["\u6C7A\u307E\u308B","\u304D\u307E\u308B","\u51B3\u5B9A\u4E0B\u6765\uFF08\u81EA\u52A8\u8BCD\uFF09"],["\u6C7A\u3081\u308B","\u304D\u3081\u308B","\u51B3\u5B9A\uFF08\u4ED6\u52A8\u8BCD\uFF09"]]},{id:"change",title:"\u6539\u53D8",distinction:"\u5909\u308F\u308B\u662F\u53D1\u751F\u53D8\u5316\uFF1B\u5909\u3048\u308B\u662F\u6539\u53D8\u67D0\u7269\u3002",members:[["\u5909\u308F\u308B","\u304B\u308F\u308B","\u53D8\u5316\uFF08\u81EA\u52A8\u8BCD\uFF09"],["\u5909\u3048\u308B","\u304B\u3048\u308B","\u6539\u53D8\uFF08\u4ED6\u52A8\u8BCD\uFF09"]]},{id:"continue",title:"\u7EE7\u7EED",distinction:"\u7D9A\u304F\u662F\u6301\u7EED\uFF1B\u7D9A\u3051\u308B\u662F\u7EE7\u7EED\u505A\u67D0\u4E8B\u3002",members:[["\u7D9A\u304F","\u3064\u3065\u304F","\u6301\u7EED\uFF08\u81EA\u52A8\u8BCD\uFF09"],["\u7D9A\u3051\u308B","\u3064\u3065\u3051\u308B","\u7EE7\u7EED\u505A\uFF08\u4ED6\u52A8\u8BCD\uFF09"]]},{id:"increase",title:"\u589E\u52A0",distinction:"\u5897\u3048\u308B\u662F\u6570\u91CF\u81EA\u7136\u589E\u52A0\uFF1B\u5897\u3084\u3059\u662F\u4EBA\u4E3A\u589E\u52A0\u6570\u91CF\u3002",members:[["\u5897\u3048\u308B","\u3075\u3048\u308B","\u589E\u52A0\uFF08\u81EA\u52A8\u8BCD\uFF09"],["\u5897\u3084\u3059","\u3075\u3084\u3059","\u589E\u52A0\u67D0\u7269\uFF08\u4ED6\u52A8\u8BCD\uFF09"]]},{id:"find",title:"\u627E\u5230",distinction:"\u898B\u3064\u304B\u308B\u662F\u88AB\u627E\u5230\uFF1B\u898B\u3064\u3051\u308B\u662F\u627E\u5230\u67D0\u7269\u3002",members:[["\u898B\u3064\u304B\u308B","\u307F\u3064\u304B\u308B","\u88AB\u627E\u5230\uFF08\u81EA\u52A8\u8BCD\uFF09"],["\u898B\u3064\u3051\u308B","\u307F\u3064\u3051\u308B","\u627E\u5230\uFF08\u4ED6\u52A8\u8BCD\uFF09"]]},{id:"fix-heal",title:"\u4FEE\u597D\uFF0F\u6CBB\u597D",distinction:"\u76F4\u308B\uFF0F\u76F4\u3059\u7528\u4E8E\u7269\u54C1\u3001\u9519\u8BEF\uFF1B\u6CBB\u308B\uFF0F\u6CBB\u3059\u7528\u4E8E\u75BE\u75C5\u3001\u4F24\u75C5\u3002",members:[["\u76F4\u308B","\u306A\u304A\u308B","\u4FEE\u597D\uFF1B\u6539\u6B63\uFF08\u81EA\u52A8\u8BCD\uFF09"],["\u76F4\u3059","\u306A\u304A\u3059","\u4FEE\u7406\uFF1B\u6539\u6B63\uFF08\u4ED6\u52A8\u8BCD\uFF09"],["\u6CBB\u308B","\u306A\u304A\u308B","\u75CA\u6108\uFF08\u81EA\u52A8\u8BCD\uFF09"],["\u6CBB\u3059","\u306A\u304A\u3059","\u6CBB\u597D\uFF08\u4ED6\u52A8\u8BCD\uFF09"]]},{id:"remember-recall",title:"\u8BB0\u5F97\uFF0F\u60F3\u8D77",distinction:"\u899A\u3048\u308B\u662F\u8BB0\u4F4F\u3001\u5B66\u4F1A\uFF1B\u601D\u3044\u51FA\u3059\u662F\u4ECE\u8BB0\u5FC6\u4E2D\u56DE\u60F3\u8D77\u6765\u3002",members:[["\u899A\u3048\u308B","\u304A\u307C\u3048\u308B","\u8BB0\u4F4F\uFF1B\u5B66\u4F1A"],["\u601D\u3044\u51FA\u3059","\u304A\u3082\u3044\u3060\u3059","\u60F3\u8D77\u6765\uFF1B\u56DE\u5FC6\u8D77"]]},{id:"know-understand",title:"\u77E5\u9053\uFF0F\u660E\u767D",distinction:"\u77E5\u308B\u662F\u83B7\u5F97\u4FE1\u606F\uFF1B\u5206\u304B\u308B\u662F\u7406\u89E3\u5185\u5BB9\u6216\u5F04\u660E\u767D\u3002",members:[["\u77E5\u308B","\u3057\u308B","\u77E5\u9053\uFF1B\u5F97\u77E5"],["\u5206\u304B\u308B","\u308F\u304B\u308B","\u660E\u767D\uFF1B\u7406\u89E3"]]},{id:"think-consider",title:"\u60F3\uFF0F\u8003\u8651",distinction:"\u601D\u3046\u504F\u611F\u89C9\u3001\u8BA4\u4E3A\uFF1B\u8003\u3048\u308B\u504F\u601D\u8003\u3001\u8003\u8651\u3002",members:[["\u601D\u3046","\u304A\u3082\u3046","\u60F3\uFF1B\u8BA4\u4E3A"],["\u8003\u3048\u308B","\u304B\u3093\u304C\u3048\u308B","\u601D\u8003\uFF1B\u8003\u8651"]]},{id:"see",title:"\u770B\uFF0F\u770B\u89C1\uFF0F\u7ED9\u770B",distinction:"\u898B\u308B\u662F\u4E3B\u52A8\u770B\uFF1B\u898B\u3048\u308B\u662F\u81EA\u7136\u770B\u5F97\u89C1\uFF1B\u898B\u305B\u308B\u662F\u7ED9\u522B\u4EBA\u770B\u3002",members:[["\u898B\u308B","\u307F\u308B","\u770B"],["\u898B\u3048\u308B","\u307F\u3048\u308B","\u770B\u5F97\u89C1\uFF1B\u6620\u5165\u773C\u5E18"],["\u898B\u305B\u308B","\u307F\u305B\u308B","\u7ED9\u522B\u4EBA\u770B\uFF1B\u5C55\u793A"]]},{id:"hear",title:"\u542C\uFF0F\u542C\u89C1",distinction:"\u805E\u304F\u662F\u4E3B\u52A8\u542C\u6216\u8BE2\u95EE\uFF1B\u805E\u3053\u3048\u308B\u662F\u58F0\u97F3\u81EA\u7136\u4F20\u5165\u8033\u4E2D\u3002",members:[["\u805E\u304F","\u304D\u304F","\u542C\uFF1B\u8BE2\u95EE"],["\u805E\u3053\u3048\u308B","\u304D\u3053\u3048\u308B","\u542C\u5F97\u89C1\uFF1B\u542C\u8D77\u6765"]]},{id:"choose-decide",title:"\u9009\u62E9\uFF0F\u51B3\u5B9A",distinction:"\u9078\u3076\u662F\u4ECE\u5019\u9009\u4E2D\u9009\uFF1B\u6C7A\u3081\u308B\u662F\u4F5C\u51FA\u51B3\u5B9A\u3002",members:[["\u9078\u3076","\u3048\u3089\u3076","\u9009\u62E9"],["\u6C7A\u3081\u308B","\u304D\u3081\u308B","\u51B3\u5B9A"]]},{id:"prepare",title:"\u51C6\u5907",distinction:"\u6E96\u5099\u504F\u4E3A\u4E8B\u60C5\u505A\u51C6\u5907\uFF1B\u7528\u610F\u504F\u51C6\u5907\u5177\u4F53\u7269\u54C1\u3002",members:[["\u6E96\u5099","\u3058\u3085\u3093\u3073","\u51C6\u5907"],["\u7528\u610F","\u3088\u3046\u3044","\u51C6\u5907\u3001\u5907\u597D"]]},{id:"explain-introduce",title:"\u8BF4\u660E\uFF0F\u4ECB\u7ECD",distinction:"\u8AAC\u660E\u662F\u89E3\u91CA\u5185\u5BB9\uFF1B\u7D39\u4ECB\u662F\u628A\u4EBA\u6216\u4E8B\u7269\u4ECB\u7ECD\u7ED9\u522B\u4EBA\u3002",members:[["\u8AAC\u660E","\u305B\u3064\u3081\u3044","\u8BF4\u660E\uFF1B\u89E3\u91CA"],["\u7D39\u4ECB","\u3057\u3087\u3046\u304B\u3044","\u4ECB\u7ECD"]]},{id:"participate-attend",title:"\u53C2\u52A0\uFF0F\u51FA\u5E2D",distinction:"\u53C2\u52A0\u504F\u53C2\u4E0E\u6D3B\u52A8\uFF1B\u51FA\u5E2D\u504F\u51FA\u5E2D\u4F1A\u8BAE\u3001\u8BFE\u7A0B\u7B49\u6B63\u5F0F\u573A\u5408\u3002",members:[["\u53C2\u52A0","\u3055\u3093\u304B","\u53C2\u52A0"],["\u51FA\u5E2D","\u3057\u3085\u3063\u305B\u304D","\u51FA\u5E2D"]]},{id:"experience",title:"\u7ECF\u9A8C\uFF0F\u4F53\u9A8C",distinction:"\u7D4C\u9A13\u504F\u7D2F\u8BA1\u7ECF\u5386\uFF1B\u4F53\u9A13\u504F\u4EB2\u8EAB\u7ECF\u5386\u67D0\u4EF6\u4E8B\u3002",members:[["\u7D4C\u9A13","\u3051\u3044\u3051\u3093","\u7ECF\u9A8C\uFF1B\u7ECF\u5386"],["\u4F53\u9A13","\u305F\u3044\u3051\u3093","\u4EB2\u8EAB\u4F53\u9A8C"]]},{id:"plan-promise",title:"\u8BA1\u5212\uFF0F\u7EA6\u5B9A",distinction:"\u4E88\u5B9A\u662F\u9884\u5B9A\u5B89\u6392\uFF1B\u7D04\u675F\u662F\u548C\u522B\u4EBA\u7EA6\u597D\u6216\u4F5C\u51FA\u627F\u8BFA\u3002",members:[["\u4E88\u5B9A","\u3088\u3066\u3044","\u9884\u5B9A\uFF1B\u8BA1\u5212"],["\u7D04\u675F","\u3084\u304F\u305D\u304F","\u7EA6\u5B9A\uFF1B\u627F\u8BFA"]]},{id:"reason-cause",title:"\u7406\u7531\uFF0F\u539F\u56E0",distinction:"\u539F\u56E0\u662F\u4E8B\u60C5\u53D1\u751F\u7684\u5BA2\u89C2\u539F\u56E0\uFF1B\u7406\u7531\u662F\u4EBA\u505A\u67D0\u4E8B\u7684\u7406\u7531\u3002",members:[["\u539F\u56E0","\u3052\u3093\u3044\u3093","\u539F\u56E0"],["\u7406\u7531","\u308A\u3086\u3046","\u7406\u7531"]]},{id:"safe-relieved",title:"\u5B89\u5168\uFF0F\u653E\u5FC3",distinction:"\u5B89\u5168\u662F\u5BA2\u89C2\u6CA1\u6709\u5371\u9669\uFF1B\u5B89\u5FC3\u662F\u4E3B\u89C2\u611F\u5230\u653E\u5FC3\u3002",members:[["\u5B89\u5168","\u3042\u3093\u305C\u3093","\u5B89\u5168"],["\u5B89\u5FC3","\u3042\u3093\u3057\u3093","\u653E\u5FC3\uFF1B\u5B89\u5FC3"]]},{id:"always-usually",title:"\u603B\u662F\uFF0F\u5E73\u65F6",distinction:"\u3044\u3064\u3082\u504F\u6BCF\u6B21\u3001\u603B\u662F\uFF1B\u666E\u6BB5\u504F\u5E73\u5E38\u72B6\u6001\u3002",members:[["\u3044\u3064\u3082","\u3044\u3064\u3082","\u603B\u662F\uFF1B\u4E00\u76F4"],["\u666E\u6BB5","\u3075\u3060\u3093","\u5E73\u65F6\uFF1B\u5E73\u5E38"]]},{id:"sometimes",title:"\u5076\u5C14\uFF0F\u6709\u65F6",distinction:"\u305F\u307E\u306B\u9891\u7387\u66F4\u4F4E\uFF1B\u3068\u304D\u3069\u304D\u662F\u4E2D\u6027\u7684\u201C\u6709\u65F6\u201D\u3002",members:[["\u305F\u307E\u306B","\u305F\u307E\u306B","\u5076\u5C14"],["\u6642\u3005","\u3068\u304D\u3069\u304D","\u6709\u65F6\uFF1B\u65F6\u5E38"]]},{id:"finally",title:"\u7EC8\u4E8E\uFF0F\u6700\u7EC8",distinction:"\u3084\u3063\u3068\u5F3A\u8C03\u56F0\u96BE\u540E\u5B9E\u73B0\uFF1B\u3068\u3046\u3068\u3046\u5E38\u5E26\u7ED3\u679C\u611F\uFF1B\u3064\u3044\u306B\u8F83\u6B63\u5F0F\u3002",members:[["\u3084\u3063\u3068","\u3084\u3063\u3068","\u7EC8\u4E8E\uFF1B\u597D\u4E0D\u5BB9\u6613"],["\u3068\u3046\u3068\u3046","\u3068\u3046\u3068\u3046","\u7EC8\u4E8E\uFF1B\u6700\u7EC8"],["\u3064\u3044\u306B","\u3064\u3044\u306B","\u7EC8\u4E8E\uFF1B\u6700\u7EC8"]]},{id:"gradually-rapidly",title:"\u9010\u6E10\uFF0F\u4E0D\u65AD",distinction:"\u3060\u3093\u3060\u3093\u662F\u6E10\u53D8\uFF1B\u3069\u3093\u3069\u3093\u662F\u5FEB\u901F\u3001\u8FDE\u7EED\u5730\u53D1\u5C55\u3002",members:[["\u3060\u3093\u3060\u3093","\u3060\u3093\u3060\u3093","\u9010\u6E10"],["\u3069\u3093\u3069\u3093","\u3069\u3093\u3069\u3093","\u4E0D\u65AD\u5730\uFF1B\u5FEB\u901F\u5730"]]},{id:"probably-surely",title:"\u5927\u6982\uFF0F\u4E00\u5B9A",distinction:"\u305F\u3076\u3093\u662F\u4E0D\u786E\u5B9A\u63A8\u6D4B\uFF1B\u304D\u3063\u3068\u662F\u8F83\u5F3A\u786E\u4FE1\u3002",members:[["\u305F\u3076\u3093","\u305F\u3076\u3093","\u5927\u6982\uFF1B\u53EF\u80FD"],["\u304D\u3063\u3068","\u304D\u3063\u3068","\u4E00\u5B9A\uFF1B\u60F3\u5FC5"]]},{id:"properly",title:"\u597D\u597D\u5730\uFF0F\u8BA4\u771F\u5730",distinction:"\u3061\u3083\u3093\u3068\u504F\u53E3\u8BED\uFF1B\u304D\u3061\u3093\u3068\u504F\u6574\u9F50\u89C4\u8303\uFF1B\u3057\u3063\u304B\u308A\u504F\u7262\u56FA\u53EF\u9760\u3002",members:[["\u3061\u3083\u3093\u3068","\u3061\u3083\u3093\u3068","\u597D\u597D\u5730\uFF1B\u786E\u5B9E"],["\u304D\u3061\u3093\u3068","\u304D\u3061\u3093\u3068","\u6574\u9F50\u5730\uFF1B\u89C4\u77E9\u5730"],["\u3057\u3063\u304B\u308A","\u3057\u3063\u304B\u308A","\u7262\u56FA\u5730\uFF1B\u8BA4\u771F\u5730"]]},{id:"for-now",title:"\u59D1\u4E14\uFF0F\u5148",distinction:"\u4E00\u5FDC\u662F\u6700\u4F4E\u9650\u5EA6\u5B8C\u6210\uFF1B\u3068\u308A\u3042\u3048\u305A\u662F\u5148\u505A\u773C\u524D\u7684\u4E00\u6B65\u3002",members:[["\u4E00\u5FDC","\u3044\u3061\u304A\u3046","\u59D1\u4E14\uFF1B\u6682\u4E14"],["\u3068\u308A\u3042\u3048\u305A","\u3068\u308A\u3042\u3048\u305A","\u5148\uFF1B\u6682\u4E14"]]},{id:"on-purpose-special-effort",title:"\u6545\u610F\uFF0F\u7279\u610F",distinction:"\u308F\u3056\u3068\u662F\u6545\u610F\u505A\uFF1B\u308F\u3056\u308F\u3056\u662F\u7279\u610F\u8D39\u529B\u53BB\u505A\u3002",members:[["\u308F\u3056\u3068","\u308F\u3056\u3068","\u6545\u610F"],["\u308F\u3056\u308F\u3056","\u308F\u3056\u308F\u3056","\u7279\u610F\uFF1B\u4E13\u7A0B"]]}],nL=(e,t)=>{let r=String(t.kanji??""),n=String(t.kana??"");return e[0]===r&&e[1]===n},oL=(e,t)=>String(e.kanji??"")===t[0]&&String(e.kana??"")===t[1],ll=new Map,$i=()=>{ll.clear(),Zr()},sL=e=>{let t=ll.get(e.id);if(t)return t;let r=e.members.flatMap(([i,a])=>[i,a]),n=e.members.map(()=>"(kanji = ? AND kana = ?)").join(" OR "),o=p(`SELECT id, meaning, kana, kanji FROM words WHERE ${n}`,r),s=e.members.flatMap(i=>{let a=o.find(d=>oL(d,i));return a?[{id:Number(a.id??0),kana:String(a.kana??i[1]),kanji:String(a.kanji??i[0]),meaning:String(a.meaning??i[2]),note:i[2],manual:!0}]:[]});return ll.set(e.id,s),s},Kg=e=>{let t=ml(Number(e.id??0));if(!t.length)return[];let r=t.map(()=>"?").join(", ");return p(`SELECT id, meaning, kana, kanji FROM words WHERE id IN (${r})`,t).map(n=>({id:Number(n.id??0),kana:String(n.kana??""),kanji:String(n.kanji??""),meaning:String(n.meaning??""),note:String(n.meaning??""),manual:!1}))},iL=e=>{let t=en(Number(e.id??0)),r=Kg(e);return!t||!r.length?null:{title:`\u9898\u9762\u9996\u4E49\u76F8\u540C\uFF1A${t}`,distinction:"\u8FD9\u4E9B\u8BCD\u5728\u9898\u9762\u663E\u793A\u7684\u9996\u4E49\u76F8\u540C\uFF0C\u90FD\u53EF\u80FD\u662F\u5408\u7406\u7B54\u6848\uFF1B\u8BF7\u7ED3\u5408\u65E5\u8BED\u8BCD\u5F62\u3001\u8BED\u5883\u548C\u8BCD\u6027\u533A\u5206\u3002",source:"auto",items:r}}});var Gi=le((gM,Bg)=>{var pl=require("../shared/content-store"),Pi=e=>{if(pl[e]==null)throw new Error(`\u5185\u5BB9 ${e} \u672A ready\uFF1A\u6D88\u8D39\u524D\u5FC5\u987B await readyForRoute / readyForHomeMode`)},Hi=(e,t)=>{let r=pl[e];for(let n of t)r=r?.[n];return r},Ki=(e,t,r="object")=>{let n=r==="array"?[]:{};return new Proxy(n,{get(o,s,i){if(s==="__esModule")return!1;if(s==="default"&&t.length===0)return Ki(e,t,r);if(pl[e]==null&&t.length===0&&r!=="array"&&["readings","japanese_to_simplified","points","aliases","kanji"].includes(s))return Ki(e,[s]);Pi(e);let a=Hi(e,[...t,s]);return a===void 0?r==="array"&&s in n?Reflect.get(n,s,i):void 0:a&&typeof a=="object"?Ki(e,[...t,s],Array.isArray(a)?"array":"object"):a},has(o,s){if(Pi(e),r==="array"&&s==="length")return!0;let i=Hi(e,t);return!!i&&typeof i=="object"&&s in i},ownKeys(){Pi(e);let o=Hi(e,t);return o&&typeof o=="object"?Reflect.ownKeys(o):r==="array"?["length"]:[]},getOwnPropertyDescriptor(o,s){Pi(e);let i=Hi(e,t);if(r==="array"&&s==="length")return Object.getOwnPropertyDescriptor(i&&typeof i=="object"?i:n,"length");if(!i||typeof i!="object")return;let a=Object.getOwnPropertyDescriptor(i,s);return a?{...a,configurable:!0}:void 0}})};Bg.exports=(e,t)=>Ki(e,[],t)});var zg=le((_M,Yg)=>{var Xg=Gi()("kanjiVariants");Yg.exports={__esModule:!0,default:Xg,get japanese_to_simplified(){return Xg.japanese_to_simplified}}});var qg,Vg=h(()=>{qg={\u30C1\u30A7\u30C3\u30AF:"check",\u30B3\u30D4\u30FC:"copy",\u30D7\u30EC\u30BC\u30F3\u30C8:"present",\u30AB\u30FC\u30C6\u30F3:"curtain",\u30B3\u30F3\u30AF\u30EA\u30FC\u30C8:"concrete",\u30B5\u30A4\u30BA:"size",\u30B5\u30FC\u30D3\u30B9\u30BB\u30F3\u30BF\u30FC:"service center",\u30B7\u30E5\u30FC\u30C8:"shoot",\u30CE\u30FC\u30C8:"note",\u30D1\u30F3\u30AF:"puncture / punk",\u30D4\u30AF\u30CB\u30C3\u30AF:"picnic",\u30D4\u30B6:"pizza",\u30D5\u30EA\u30FC\u30BA:"freeze",\u30D6\u30ED\u30FC\u30C1:"brooch",\u30D7\u30E9\u30B9\u30C1\u30C3\u30AF:"plastic",\u30E1\u30FC\u30C8\u30EB:"metre",\u30E9\u30B8\u30AA:"radio",\u30B7\u30F3\u30D7\u30EB:"simple",\u30B8\u30E3\u30B9\u30DF\u30F3\u8336:"jasmine",\u30C9\u30E9\u30DE:"drama",\u751F\u7523\u30B3\u30B9\u30C8:"cost",\u30B5\u30F3\u30C0\u30EB:"sandal",\u30AD\u30E3\u30F3\u30D7:"camp",\u30AF\u30E9\u30B9:"class",\u30AF\u30EC\u30B8\u30C3\u30C8\u30AB\u30FC\u30C9:"credit card",\u30B3\u30FC\u30D2\u30FC:"coffee",\u30B3\u30F3\u30B5\u30FC\u30C8:"concert",\u30B4\u30FC\u30EB\u30C7\u30F3\u30A6\u30A3\u30FC\u30AF:"Golden Week",\u30B8\u30E7\u30AE\u30F3\u30B0:"jogging",\u30B9\u30A4\u30C3\u30C1:"switch",\u30BF\u30A4\u30E0\u30B5\u30FC\u30D3\u30B9:"time service",\u30C6\u30FC\u30D7:"tape",\u30C7\u30B6\u30A4\u30CA\u30FC:"designer",\u30D1\u30B9\u30DD\u30FC\u30C8:"passport",\u30D5\u30A1\u30C3\u30AF\u30B9:"fax",\u30D9\u30C3\u30C9:"bed",\u30DB\u30FC\u30E0\u30D1\u30FC\u30C6\u30A3\u30FC:"home party",\u30A2\u30D1\u30FC\u30C8:"apartment",\u30A2\u30E1\u30EA\u30AB\u4EBA:"American",\u751F\u30D3\u30FC\u30EB:"beer",\u30AA\u30FC\u30B9\u30C8\u30E9\u30EA\u30A2\u4EBA:"Australian",\u30A2\u30E1\u30EA\u30AB:"America",\u30C7\u30A3\u30BA\u30CB\u30FC\u30E9\u30F3\u30C9:"Disneyland",\u30A8\u30EC\u30D9\u30FC\u30BF\u30FC:"elevator",\u30B9\u30B1\u30B8\u30E5\u30FC\u30EB:"schedule",\u30C1\u30FC\u30E0:"team",\u793E\u4EA4\u30C0\u30F3\u30B9:"dance"}});var fl={};M(fl,{resetUserQuestionMeanings:()=>Vo,saveUserQuestionMeaning:()=>El,userQuestionMeaning:()=>Bi,userQuestionMeaningCount:()=>dL});var Jg,zo,Vo,Qg,Bi,dL,El,Fn=h(()=>{"use strict";Jg=N($(),1);P();zo=null,Vo=()=>{zo=null},Qg=()=>{if(zo)return zo;let e=new Map;try{p("SELECT word_id, prompt_meaning FROM word_question_meanings").forEach(t=>{let r=Number(t.word_id??0),n=String(t.prompt_meaning??"").trim();r&&n&&e.set(r,n)})}catch{}return zo=e,e},Bi=e=>Qg().get(e),dL=()=>Qg().size,El=(e,t)=>{let r=(0,Jg.getDatabase)(),n=t.trim();return n?r.run(`INSERT INTO word_question_meanings (word_id, prompt_meaning, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(word_id) DO UPDATE SET
         prompt_meaning = excluded.prompt_meaning,
         updated_at = excluded.updated_at`,[e,n]):r.run("DELETE FROM word_question_meanings WHERE word_id = ?",[e]),zo=null,n}});var Yi=le((SM,t_)=>{var Xi=require("../shared/content-store"),e_=(e,t)=>`${e}\0${t}`,gl=null,_l=null,Zg=()=>{if(!Xi.questionMeanings)throw new Error("\u5185\u5BB9 questionMeanings \u672A ready\uFF1A\u5148 await readyForRoute");return _l===Xi.questionMeanings||(_l=Xi.questionMeanings,gl=new Map(_l.map(e=>[e_(e.kanji,e.kana),e.questionMeaning]))),gl};t_.exports={reviewedQuestionMeaning:(e,t)=>Zg().get(e_(e,t)),reviewedQuestionMeaningEntries:()=>(Zg(),Xi.questionMeanings)}});var Nl={};M(Nl,{buildKanjiComponents:()=>c_,buildVerbPair:()=>m_,hasKanjiText:()=>NL,honorificLabel:()=>E_,isFavorite:()=>f_,isKanji:()=>yl,mistakeScore:()=>g_,primaryMeaning:()=>p_,promptMeaning:()=>jn,questionMeaning:()=>Wn,rowObjectToCard:()=>re});function EL(e,t,r){if(!/[\u30a0-\u30ff]/.test(`${e}${t}`))return"";let n=n_[e]||n_[t];if(n)return n;let o=/^\s*[（(\[]\s*(?:法|フ|仏|德|独|オ|蘭|葡|ポ|伊|イ|露|ロ)\s*[）)\]]/;return/[A-Za-z]/.test(e)?e.split(/[；;]/).find(s=>/[A-Za-z]/.test(s)&&!o.test(s))?.trim()??"":o.test(r)?"":r.match(/[A-Za-z]+(?:[ .'-]+[A-Za-z]+)*/)?.[0]?.replace(/[ .;,-]+$/,"")??""}function fL(e){let t=e.replace(/[Ａ-Ｚ]/g,r=>String.fromCharCode(r.charCodeAt(0)-65248));return t.length>=2&&t.length<=4&&t===t.toUpperCase()}function gL(e){return/[A-ZＡ-Ｚ]/.test(e)}function u_(e){return e.replace(mL,(t,r,n)=>{let o=r>0?n[r-1]:"",s=r+t.length<n.length?n[r+t.length]:"";return t.length<=4&&gL(t)&&pL.test(`${o}${s}`)||fL(t)?t:""})}function l_(e){return e.replace(TL,t=>{let r=wl.test(t)||/[A-Za-zＡ-Ｚａ-ｚ]/.test(t),n=/[「『“"]\s*[」』”"]/.test(t);return r||n?"":t}).replace(/[「『]\s*[」』]/g,"").replace(/([。．；;，,、])[；;，,、]+/g,"$1")}function yL(e){return e.replace(/[（(［〔\[][^（(）)［\]〔〕]*[）)］〕\]]/g,t=>wl.test(t)?"":t).replace(/[「『“][^「」『』“”]*[」』”]/g,t=>wl.test(t)?"":t).replace(SL,"").replace(/[（(［〔\[]\s*[）)］〕\]]/g,"").replace(/[「『]\s*[」』]/g,"").replace(/([；;，,、])[；;，,、]+/g,"$1").replace(/^[\s；;，,、.:：/·]+/,"").replace(/[；;，,、\s]+$/,"").trim()}function Wn(e,t="",r="",n=0){let o=n?Bi(n):void 0;if(o)return o;let s=(0,Sl.reviewedQuestionMeaning)(t,r);return s||yL(l_(u_(e))).replace(/[（(\[]\s*(?:英|美)\s*[）)\]]/g,"").replace(/[（(]\s*[）)]/g,"").replace(/\s*([；;，,])\s*/g,"$1").replace(/^[\s；;，,、.:：/]+/,"").replace(/[；;，,、\s]+$/,"").trim()}function yl(e){return e>="\u4E00"&&e<="\u9FFF"}function NL(e){return Array.from(e).some(yl)}function c_(e){let t=new Set;return Array.from(e).flatMap(r=>{if(!yl(r)||t.has(r))return[];t.add(r);let n=cL[r]??r;return[{char:r,simplified:n,marked:n!==r,source:"auto"}]})}function RL(e,t,r){let n=e.prepare(`
    SELECT kana, kanji, meaning
    FROM words
    WHERE kana = ? OR kanji = ?
    ORDER BY CASE WHEN kanji = ? THEN 0 ELSE 1 END
    LIMIT 1
  `);try{if(n.bind([r,t,t]),!n.step())return null;let o=n.getAsObject(),{kana:s,kanji:i,meaning:a}=o;return{kana:String(s??r),kanji:String(i??t),meaning:String(a??"")}}finally{n.free()}}function m_(e,t,r){let n=t in r_?t:!t||t===r?r:"",o=r_[n];if(!o)return null;let[s,i,a]=o,d=RL(e,i,a);return{voice:s,pairVoice:s==="\u4ED6\u52A8\u8BCD"?"\u81EA\u52A8\u8BCD":"\u4ED6\u52A8\u8BCD",kana:d?.kana??a,kanji:d?.kanji??i,meaning:d?.meaning??""}}function p_(e){for(let t of["\uFF1B",";","\uFF0C"])if(e.includes(t))return e.split(t,1)[0].trim();return e.trim()}function jn(e,t,r,n=""){let o=Bi(t);if(o)return o;if(o_[t])return o_[t];let s=(0,Sl.reviewedQuestionMeaning)(r,n);if(s)return s;if(s_[r])return s_[r];let i=e.trim();if(!i)return"";let d=i.split(/[；;，,]/).map(l=>l.trim()).filter(Boolean).slice(0,3)[0]||i;d=d.replace(/^[⓪①②③④⑤⑥⑦⑧⑨⑩]+/,"").trim();let u="";for(;u!==d;)u=d,d=d.replace(/^[（(][^）)]{1,40}[）)]/,"").trim();if(d=l_(u_(d)).trim(),d=d.replace(/^[〈《][^〉》]{1,20}[〉》]/,"").trim(),d.includes("\u3002")&&(d=d.split("\u3002",1)[0].trim()),r&&r.length<=5&&!/[ぁ-ゟァ-ヿA-Za-z〜～]/.test(r)){let l="";Array.from(d).some((c,f)=>c!==Array.from(r)[f]?!0:(l+=c,!1)),l.length>=2&&(d=l)}return d.slice(0,8)}function E_(e,t=""){return/(謙譲語|謙讓語|谦让语|谦让|謙讓)/.test(e)?"\u8C26\u8BED":/(谦称|謙称|謙稱)/.test(e)?"\u8C26\u79F0":e.includes("\u81EA\u8C26")?"\u81EA\u8C26":/(敬语|敬語|尊敬表达|尊敬語|敬称|敬意|对外敬语)/.test(e)?"\u656C\u8BED":bL[t]??""}function f_(e,t){let r=(0,Tl.getDatabase)().prepare("SELECT 1 FROM content_favorites WHERE item_type = ? AND item_id = ? LIMIT 1");try{return r.bind([e,String(t)]),r.step()}finally{r.free()}}function g_(e){let t=Number(e.forgot_count??0)*2+Number(e.fuzzy_count??0),r=t+Number(e.right_count??0);if(r===0)return 0;let n=Math.min(Number(e.mistake_streak??0)*.08,.32);return Math.min(t/r+n,1)}function re(e){let t=Number(e.id??e.word_id??0),r=String(e.meaning??""),n=String(e.kana??""),o=String(e.kanji||n),s=Number(e.importance??3),i=g_(e),a={id:t,meaning:r,questionMeaning:Wn(r,o,n,t),primaryMeaning:p_(r),promptMeaning:jn(r,t,o,n),honorificLabel:E_(r,o),kana:n,kanji:o,englishOrigin:EL(o,n,r),pos:String(e.pos??""),jlptLevel:String(e.jlpt_level??""),importance:s,importanceScore:Math.round(Math.min(Math.max(s*1.4+i*3,0),10)*10)/10,isFavorite:f_("word",t),note:String(e.note??""),example:{jp:String(e.example_jp??""),meaning:String(e.example_meaning??""),furigana:Wo(e.example_furigana),tokens:el(e.example_tokens,String(e.example_jp??""),e.example_lemmas)},kanjiComponents:c_(o),conjugations:e.verb_type?[{label:"\u52A8\u8BCD\u7C7B\u578B",value:lL(String(e.verb_type))}]:[],verbPair:m_((0,Tl.getDatabase)(),o,n)};return i_(a,"confusions",()=>Hg(e)),i_(a,"similarMeaning",()=>Gg(e)),a}var Tl,a_,d_,Sl,uL,lL,cL,r_,n_,mL,pL,_L,wL,TL,wl,SL,o_,s_,bL,i_,yt=h(()=>{"use strict";Tl=N($(),1);hi();Xo();Yo();a_=N(zg(),1),d_=N(Ar(),1);Vg();Fn();Sl=N(Yi(),1),uL={godan:"\u4E00\u7C7B\u52A8\u8BCD\uFF08\u4E94\u6BB5\uFF09",iku:"\u4E00\u7C7B\u52A8\u8BCD\uFF08\u4E94\u6BB5\uFF09",ichidan:"\u4E8C\u7C7B\u52A8\u8BCD\uFF08\u4E00\u6BB5\uFF09",suru:"\u4E09\u7C7B\u52A8\u8BCD\uFF08\u30B5\u53D8\uFF09",kuru:"\u4E09\u7C7B\u52A8\u8BCD\uFF08\u30AB\u53D8\uFF09"},lL=e=>uL[e]??e,cL=a_.default.japanese_to_simplified??{},r_=Object.fromEntries(Object.entries(d_.default).flatMap(([e,t])=>t.length<4?[]:[[e,[t[0],t[1],t[2],t[3]]]])),n_=qg,mL=/[A-Za-zＡ-Ｚａ-ｚ]+/g,pL=/[\u3400-\u9fff]/;_L='(?:[\u300C\u300E\u201C"][^\u300C\u300D\u300E\u300F\u201C\u201D"]*[\u300D\u300F\u201D"]|[\uFF08(\uFF3B\u3014][^\uFF08()\uFF09\uFF3B\\]\u3014\u3015]*[\uFF09)\uFF3D\u3015]|[\u3041-\u3096\u309D\u309E\u30A1-\u30FA\u30FC\u30FD\u30FE\uFF66-\uFF9F\u30FB]+|[A-Za-z\uFF21-\uFF3A\uFF41-\uFF5A]+|[\xB7\\s])*',wL="(?:\u7701\u7565|\u7E2E\u7565|\u7F29\u7565|\u7B80\u79F0|\u7C21\u79F0|\u7565\u79F0|\u7565\u8A9E|\u7565\u8BED|\u7F29\u5199|\u7E2E\u5199|\u7565)(?:\u8BED|\u8A9E|\u8BCD|\u8A5E)?",TL=new RegExp(`${_L}(?:\u7684|\u306E|\u4E4B)\\s*${wL}`,"g");wl=/[ぁ-ゖゝゞァ-ヺーヽヾｦ-ﾟ]/,SL=/[ぁ-ゖゝゞァ-ヺーヽヾｦ-ﾟ]+/g;o_={596:"\u656C\u79F0",750:"\u804C\u4E1A\u8005",847:"\u5BF9\u8C61\u5730\u70B9",952:"\u5929\u5987\u7F57",1519:"\u5E97\u94FA\u4EBA\u5458",1528:"\u6536\u4FE1\u5730\u5740",2008:"\u79CD\u7C7B\u6570",2084:"\u5E72\u70B8\u98DF\u54C1",2138:"\u64CD\u4F5C",2280:"\u4E8B\u60C5\u4EF6\u6570",2303:"\u6CD5\u56FD",2340:"\u5361\u4E01\u8F66",2358:"\u4F53\u80B2\u4E2D\u5FC3",2379:"\u513F\u7AE5\u8282",2392:"\u805A\u4F1A",2398:"\u5E7F\u5C9B",2401:"\u7EF4\u751F\u7D20\u5242",2425:"\u9AD8\u7EA7\u516C\u5BD3",2428:"\u90AE\u7BB1\u5730\u5740",2446:"\u6635\u79F0\u540E\u7F00",2464:"\u4E0D\u4E45",2480:"\u5927\u697C",2494:"\u8DEF\u4E0A\u5C0F\u5FC3",2495:"\u8BF7\u591A\u5173\u7167",2519:"\u6253\u5DE5",2524:"\u5404\u79CD\u5404\u6837",2525:"\u795E\u6237",2539:"\u5A01\u58EB\u5FCC",2579:"\u6839\u636E",2582:"\u541B\u79F0",2624:"\u5404\u79CD\u5404\u6837"},s_={\u8B1B\u5EA7:"\u8BB2\u5EA7",\u7DD1\u8336:"\u7EFF\u8336",\u8272\u925B\u7B46:"\u5F69\u8272\u94C5\u7B14",\u5BCC\u58EB\u5C71:"\u5BCC\u58EB\u5C71",\u5730\u5473:"\u6734\u7D20",\u6D3E\u624B:"\u82B1\u54E8",\u521D\u8A63:"\u65B0\u5E74\u53C2\u62DC"};bL={\u3044\u3089\u3063\u3057\u3083\u308B:"\u656C\u8BED",\u304A\u3063\u3057\u3083\u308B:"\u656C\u8BED",\u306A\u3055\u308B:"\u656C\u8BED",\u304F\u3060\u3055\u308B:"\u656C\u8BED",\u3054\u89A7\u306B\u306A\u308B:"\u656C\u8BED",\u304A\u3044\u3067\u306B\u306A\u308B:"\u656C\u8BED",\u304A\u8D8A\u3057\u306B\u306A\u308B:"\u656C\u8BED",\u304A\u53EC\u3057\u306B\u306A\u308B:"\u656C\u8BED",\u53EC\u3057\u4E0A\u304C\u308B:"\u656C\u8BED",\u4F3A\u3046:"\u8C26\u8BED",\u53C2\u308B:"\u8C26\u8BED",\u7533\u3059:"\u8C26\u8BED",\u7533\u3057\u4E0A\u3052\u308B:"\u8C26\u8BED",\u9802\u304F:"\u8C26\u8BED",\u3044\u305F\u3060\u304F:"\u8C26\u8BED",\u5DEE\u3057\u4E0A\u3052\u308B:"\u8C26\u8BED",\u81F4\u3059:"\u8C26\u8BED",\u304A\u308B:"\u8C26\u8BED",\u5B58\u3058\u308B:"\u8C26\u8BED",\u5B58\u3058\u4E0A\u3052\u308B:"\u8C26\u8BED",\u62DD\u898B:"\u8C26\u8BED",\u9802\u6234:"\u8C26\u8BED",\u62DD\u501F:"\u8C26\u8BED",\u304A\u76EE\u306B\u304B\u304B\u308B:"\u8C26\u8BED",\u627F\u308B:"\u8C26\u8BED",\u304B\u3057\u3053\u307E\u308A\u307E\u3057\u305F:"\u8C26\u8BED"};i_=(e,t,r)=>{let n,o=!1;Object.defineProperty(e,t,{enumerable:!0,configurable:!0,get(){return o||(n=r(),o=!0),n}})}});var kl={};M(kl,{displayedPromptKeyOf:()=>Al,displayedPromptPeers:()=>hl,questionMeaningKeyOf:()=>en,questionMeaningPeers:()=>ml,resetQuestionMeaningIndex:()=>Zr});var Rl,Zr,LL,bl,en,ml,Ll,OL,Ol,Al,hl,kr=h(()=>{"use strict";P();yt();Rl=null,Zr=()=>{Rl=null,Ll=null},LL=()=>{let e=new Map,t=new Map;return p("SELECT id, kanji, kana, meaning FROM words").forEach(r=>{let n=Number(r.id??0);if(!n)return;let o=String(r.kanji||r.kana||""),s=jn(String(r.meaning??""),n,o,String(r.kana??""));if(!s)return;e.set(n,s);let i=t.get(s);i?i.push(n):t.set(s,[n])}),t.forEach((r,n)=>{r.length<2&&(t.delete(n),e.delete(r[0]))}),{keyByWord:e,wordsByKey:t}},bl=()=>(Rl??(Rl=LL()),Rl),en=e=>bl().keyByWord.get(e),ml=e=>{let t=bl().keyByWord.get(e);return t?(bl().wordsByKey.get(t)??[]).filter(r=>r!==e):[]},Ll=null,OL=()=>{let e=new Map,t=new Map;return p("SELECT id, kanji, kana, meaning FROM words").forEach(r=>{let n=Number(r.id??0);if(!n)return;let o=String(r.kanji||r.kana||""),s=Wn(String(r.meaning??""),o,String(r.kana??""),n)||String(r.meaning??"").trim();if(!s)return;e.set(n,s);let i=t.get(s);i?i.push(n):t.set(s,[n])}),t.forEach((r,n)=>{r.length<2&&(t.delete(n),e.delete(r[0]))}),{keyByWord:e,wordsByKey:t}},Ol=()=>(Ll??(Ll=OL()),Ll),Al=e=>Ol().keyByWord.get(e),hl=e=>{let t=Ol().keyByWord.get(e);return t?(Ol().wordsByKey.get(t)??[]).filter(r=>r!==e):[]}});function vL(e){let t=e.map(i=>Number(i.id??i.word_id??0)),r=new Map,n=(i,a)=>{i!==a&&(r.has(i)||r.set(i,new Set),r.has(a)||r.set(a,new Set),r.get(i).add(a),r.get(a).add(i))},o=new Map;e.forEach((i,a)=>{for(let d of hL(i)){let u=o.get(d)??[];u.push(t[a]),o.set(d,u)}});for(let i of o.values())for(let a=0;a<i.length;a+=1)for(let d=a+1;d<i.length;d+=1)n(i[a],i[d]);for(let i=0;i<e.length;i+=1)for(let a=i+1;a<e.length;a+=1)kL(e[i],e[a])&&n(t[i],t[a]);let s=new Set(t);return{conflicts:(i,a)=>r.get(i)?.has(a)??!1,has:i=>s.has(i)}}function qo(e,t,r="forward"){let n=t.map(o=>Number(o.id??o.word_id??0));return tn?.day===e&&tn.scope===r&&n.every(o=>tn.index.has(o))||(tn={index:vL(t),day:e,scope:r}),tn.index}var __,$n,AL,hL,kL,tn,w_,Jo=h(()=>{"use strict";__=N(Ar(),1);Yo();kr();Xo();$n=12,AL=__.default,hL=e=>{let t=String(e.kanji??""),r=String(e.kana??""),n=[];for(let i of[t,r]){let a=i&&AL[i];if(!a)continue;let d=String(a[1]??"");d&&n.push(`vp:${[i,d].sort().join("|")}`)}let o=cl.find(i=>i.members.some(([a,d])=>a===t&&d===r||a===r||d===r));o&&n.push(`sm:${o.id}`);let s=en(Number(e.id??0));return s&&n.push(`qm:${s}`),n},kL=(e,t)=>{let r=String(e.kana??""),n=String(t.kana??"");if(!r||!n||Math.abs(Array.from(r).length-Array.from(n).length)>dl(r))return!1;let s=ji(r,n)*.65+il(r,n)*.35,i=String(e.pos??"").split("\u30FB")[0];return i&&String(t.pos??"").includes(i)&&(s+=.04),e.verb_type&&e.verb_type===t.verb_type&&(s+=.04),s>=al(r)};tn=null;w_=()=>{tn=null}});var vr=le((DM,N_)=>{var T_="shushugo-progress-updated",S_="shushugo-today-word-plan-updated",vl=0,y_=[];N_.exports={PROGRESS_UPDATED_EVENT:T_,TODAY_WORD_PLAN_UPDATED_EVENT:S_,readTodayWordAudioPlanUpdate:()=>y_,notifyTodayWordPlanUpdated:e=>{y_=e;try{globalThis.window.dispatchEvent(new globalThis.Event(S_))}catch{}},withProgressEventsMuted:e=>{vl+=1;try{return e()}finally{vl-=1}},notifyProgressUpdated:()=>{if(!vl)try{globalThis.window.dispatchEvent(new globalThis.Event(T_))}catch{}}}});var Ul={};M(Ul,{FSRS_DEFAULT_RETENTION:()=>Dl,FSRS_LEARNING_STEPS:()=>b_,FSRS_MAX_INTERVAL_DAYS:()=>Il,FSRS_NO_STEPS:()=>Cl,FSRS_RELEARNING_STEPS:()=>L_,FSRS_STUBBORN_RELEARNING_STEPS:()=>O_,GRADUATION_STABILITY_DAYS:()=>C_,LEECH_LAPSE_THRESHOLD:()=>Ee,MASTERED_INTERVAL_DAYS:()=>zi,STUBBORN_DAILY_MISTAKES:()=>Ue,getScheduler:()=>Ml,intervalDays:()=>v_,isDue:()=>ML,isGraduated:()=>FL,isGraduatedForDay:()=>Nt,isLearning:()=>xL,isLeech:()=>UL,isMastered:()=>IL,ratingFor:()=>h_,recordReview:()=>Ze,retrievability:()=>xl});function Ze(e,t,r,n={}){let o=n.retention??Dl,s=n.maxInterval??Il,i=n.mode??"normal",d=Ml(o,s,i).repeat(k_(e,r),r)[h_(t,i)].card;return DL(d,r,s)}function xl(e,t){return Ml().get_retrievability(k_(e,t),t,!1)}function ML(e,t){return rn(e)?new Date(e.due).getTime()<=t.getTime():!0}function Nt(e,t){return!rn(e)||e.state===Le.State.Learning||e.state===Le.State.Relearning?!1:new Date(e.due).getTime()>t.getTime()}function xL(e){return rn(e)&&(e.state===Le.State.Learning||e.state===Le.State.Relearning||e.state===Le.State.New)}var Le,Dl,Il,b_,L_,O_,Ue,Cl,Ee,A_,R_,Ml,h_,rn,k_,CL,DL,zi,v_,IL,UL,C_,FL,Ke=h(()=>{"use strict";Le=require("../vendor/ts-fsrs.umd"),Dl=.9,Il=365,b_=["1m","10m"],L_=["10m","10m"],O_=["10m","10m","30m"],Ue=3,Cl=[],Ee=8,A_=864e5,R_=new Map,Ml=(e=Dl,t=Il,r="normal")=>{let n=`${e}|${t}|${r}`,o=R_.get(n);return o||(o=(0,Le.fsrs)({request_retention:e,maximum_interval:t,enable_fuzz:!1,enable_short_term:!0,learning_steps:[...r==="known"?Cl:b_],relearning_steps:[...r==="known"?Cl:r==="stubborn"?O_:L_]}),R_.set(n,o)),o},h_=(e,t="normal")=>{switch(e){case"know":return t==="known"?Le.Rating.Easy:Le.Rating.Good;case"fuzzy":return Le.Rating.Hard;case"forgot":return Le.Rating.Again;case"known_forever":return Le.Rating.Easy;default:return Le.Rating.Good}},rn=e=>!!e&&Number.isFinite(e.stability)&&e.stability>0&&!!e.due,k_=(e,t)=>rn(e)?{due:new Date(e.due),stability:e.stability,difficulty:e.difficulty,elapsed_days:0,scheduled_days:0,learning_steps:Number.isFinite(e.steps)?e.steps:0,reps:Number.isFinite(e.reps)?e.reps:1,lapses:Number.isFinite(e.lapses)?e.lapses:0,state:Number.isFinite(e.state)?e.state:Le.State.Review,last_review:new Date(e.lastReview||e.due)}:(0,Le.createEmptyCard)(t),CL=(e,t,r)=>{let n=t.getTime()+r*A_,o=new Date(e).getTime();return new Date(Math.min(o,n)).toISOString()},DL=(e,t,r)=>{let n=e.last_review??t;return{stability:e.stability,difficulty:e.difficulty,due:CL(e.due.toISOString(),n,r),lastReview:n.toISOString(),state:e.state,steps:e.learning_steps,reps:e.reps,lapses:e.lapses}};zi=180,v_=e=>(new Date(e.due).getTime()-new Date(e.lastReview).getTime())/A_,IL=e=>rn(e)?v_(e)>=zi:!1;UL=e=>rn(e)&&e.lapses>=Ee,C_=180,FL=e=>rn(e)&&e.stability>=C_});function qi(e,t,r,n={}){let o=Number(e.seen_count??0)===0,s=Number(e.fsrs_lapses??0),i={score:0,critical:0,importance:Number(e.importance??3)*7,mistake:Math.min(s*10,GL),queue:0,age:Math.min(Oo(e.last_seen_on)*3,30),review:o?0:35,new:0,jitter:n.randomize===!1?0:Math.random()*$L};if(o)i.new=45+Math.min(r,10),i.score=18,i.shuffle=Number(e.shuffle_rank??0)*18,i.importance=Number(e.importance??3)*4;else{let a=Number(e.fsrs_state??0),d=a===1||a===3;i.score=d?PL:e.fsrs_due==null||e.fsrs_stability==null?HL:BL(Number(e.fsrs_stability))}return s>=Ee&&(i.critical=KL),t!==void 0&&(t<=0?i.queue=45:i.queue=-80-t*25),i}function Ji(e){return Object.values(e).reduce((t,r)=>t+r,0)}var WL,jL,$L,PL,HL,KL,GL,BL,XL,Vi,Qi=h(()=>{"use strict";P();Ke();WL=50,jL=30,$L=60,PL=55,HL=50,KL=12,GL=40,BL=e=>WL*Math.max(0,1-Math.log2(1+Math.max(e,0))/Math.log2(1+jL)),XL=1/8,Vi=(e,t,r,n=Math.random())=>{if(t<=0)return!1;if(e<=0)return!0;if(r===0)return!1;let o=t/(e+t);return n<Math.max(o,XL)}});var YL,zL,VL,qL,D_,JL,QL,I_,lt,Fl,Ft,ir=h(()=>{"use strict";YL=(e,t)=>e+Math.floor(Math.random()*(t-e+1)),zL=[3,8],VL=[9,14],qL=[16,26],D_=[8,20],JL=5,QL=20,I_=(e,t=YL,r=!1)=>{let n=e>=QL?qL:e>=JL?VL:zL,[o,s]=r?[Math.max(n[0],D_[0]),Math.max(n[1],D_[1])]:n;return t(o,s)},lt=3,Fl=.1,Ft=e=>e.mistakeStreak>=lt?!0:e.total<=0?!1:e.remaining<=Math.ceil(e.total*Fl)});function ea(e,t){return e.length?iO(sO(e,t),t.random??Math.random):null}var ZL,eO,tO,rO,nO,Zi,oO,sO,iO,Wl=h(()=>{"use strict";Jo();ZL=6,eO=.35,tO=2,rO=6,nO=.5,Zi=.7,oO=e=>{let t=e.map(n=>n.recall).sort((n,o)=>n-o);if(!t.length)return 0;let r=Math.floor(t.length/2);return t.length%2?t[r]:(t[r-1]+t[r])/2},sO=(e,t)=>{let r=(s,i)=>s.length?s:i,n=e,o=t.recentIds.slice(0,$n);if(o.length&&(n=r(n.filter(s=>!o.some(i=>t.interference.conflicts(s.id,i))),n)),t.answeredToday<ZL&&(n=r(n.filter(s=>!s.isLeech),n),n=r(n.filter(s=>s.recall>=eO),n)),t.wrongStreak>=tO){let s=oO(n);n=r(n.filter(i=>i.recall>=s),n)}return n},iO=(e,t)=>{if(!e.length)return null;let r=[...e].sort((i,a)=>a.score-i.score||i.id-a.id).slice(0,rO),n=r.map((i,a)=>nO**a),o=n.reduce((i,a)=>i+a,0),s=t()*o;for(let i=0;i<r.length;i+=1)if(s-=n[i],s<=0)return r[i];return r[r.length-1]}});var Yl={};M(Yl,{DUE_SQL:()=>gO,GRAMMAR_FSRS:()=>ct,KANJI_FSRS:()=>ta,LEECH_DAILY_INTAKE:()=>Bl,LEECH_SQL:()=>na,MASTERED_SQL:()=>ge,NOT_MASTERED_SQL:()=>fO,RECENT_LAPSE_HOURS:()=>W_,REVERSE_FSRS:()=>jl,WORD_FSRS:()=>ue,backfillFsrsFromHistory:()=>Hl,cappedDueCount:()=>Xl,clearFsrsState:()=>F_,ensureFsrsColumns:()=>j,ensureGrammarFsrs:()=>Pl,ensureKanjiReadingFsrs:()=>$l,fsrsDueCount:()=>Gl,fsrsDueWordIds:()=>sn,fsrsMasteredCount:()=>_O,migrateFullHistoryDailyEasy:()=>Kl,migrateRecentDailyEasyReviews:()=>ra,plannedDueCount:()=>Hn,readFsrsState:()=>Rt,recallFromRow:()=>nn,recordFsrsReview:()=>Oe,restoreFsrsState:()=>on,writeFsrsState:()=>bt});function j(e=ue){let t=(0,Pn.getDatabase)(),r=M_.get(t);if(r||(r=new Set,M_.set(t,r)),r.has(e.table))return;let n=new Set(p(`PRAGMA table_info(${e.table})`).map(s=>String(s.name??""))),o=x_.filter(([s])=>!n.has(s)).map(([s,i])=>`ALTER TABLE ${e.table} ADD COLUMN ${s} ${i}`);o.length&&t.exec(o.join(";")),r.add(e.table)}function nn(e,t=new Date){let r=U_(e);return r?xl(r,t):void 0}function Rt(e,t=ue){j(t);let r=p(`SELECT ${dO} FROM ${t.table} WHERE ${t.idColumn} = ?`,[e]);return U_(r[0]??null)}function bt(e,t,r=ue){j(r),(0,Pn.getDatabase)().run(`UPDATE ${r.table} SET fsrs_stability = ?, fsrs_difficulty = ?, fsrs_due = ?, fsrs_last_review = ?,
       fsrs_state = ?, fsrs_steps = ?, fsrs_reps = ?, fsrs_lapses = ? WHERE ${r.idColumn} = ?`,[t.stability,t.difficulty,t.due,t.lastReview,t.state,t.steps,t.reps,t.lapses,e])}function $l(){j(ta)}function Pl(){j(ct)}function F_(e,t=ue){j(t),(0,Pn.getDatabase)().run(`UPDATE ${t.table} SET ${x_.map(([r])=>`${r} = NULL`).join(", ")}
     WHERE ${t.idColumn} = ?`,[e])}function on(e,t,r=ue){t?bt(e,t,r):F_(e,r)}function Oe(e,t,r=new Date,n={},o=ue){let s=Rt(e,o),i=Ze(s,t,r,n);return bt(e,i,o),i}function Hl(){if(j(),O("fsrs_backfilled","")==="1")return{migrated:!1,words:0};let e=p(`
    SELECT r.word_id, r.answer, r.created_at, r.reviewed_on
    FROM reviews r
    JOIN (
      SELECT word_id, reviewed_on, MIN(id) AS mid
      FROM reviews
      GROUP BY word_id, reviewed_on
    ) f ON f.mid = r.id
    ORDER BY r.word_id ASC, r.created_at ASC, r.id ASC
  `),t=(0,Pn.getDatabase)(),r=new Map;for(let o of e){let s=Number(o.word_id),i=new Date(String(o.created_at??o.reviewed_on).replace(" ","T")).getTime();r.has(s)||r.set(s,[]),r.get(s).push({answer:String(o.answer),at:Number.isFinite(i)?i:Date.now()})}let n=0;t.run("BEGIN TRANSACTION");try{for(let[o,s]of r){s.sort((d,u)=>d.at-u.at);let i=null,a=0;for(let d of s){let u=d.at<=a?a+1e3:d.at;a=u,i=Ze(i,d.answer,new Date(u))}i&&(bt(o,i),n++)}t.run("COMMIT")}catch(o){throw t.run("ROLLBACK"),o}return R("fsrs_backfilled","1"),{migrated:!0,words:n}}function ra(e=new Date,t=lO,r=uO){if(O(r,"")==="1")return{migrated:!1,words:0,reviews:0};j();let n=B(e),{startDay:o}=mO(n,t),s=p(`
    SELECT r.id, r.word_id, r.answer, r.reviewed_on, r.created_at
    FROM reviews r
    JOIN progress p ON p.word_id = r.word_id
    WHERE p.known_forever = 0
    ORDER BY r.word_id ASC, r.id ASC
  `),i=new Map;s.forEach(c=>{let f=Number(c.word_id),m=Number(c.id),g=String(c.answer),S=String(c.reviewed_on??"");!Number.isFinite(f)||!Number.isFinite(m)||!S||(i.has(f)||i.set(f,[]),i.get(f).push({id:m,wordId:f,answer:g,studyDay:S,at:cO(S,c.created_at)}))});let a=new Map,d=0;i.forEach((c,f)=>{let m=new Map;c.forEach(S=>{m.has(S.studyDay)||m.set(S.studyDay,S)}),[...m.values()].some(S=>S.studyDay>=o&&S.studyDay<=n&&S.answer==="know")&&(a.set(f,c),d+=c.length)});let u=(0,Pn.getDatabase)(),l=0;u.run("BEGIN TRANSACTION");try{a.forEach((c,f)=>{let m=new Map;c.forEach(_=>{m.has(_.studyDay)||m.set(_.studyDay,_)});let g=[...c].sort((_,b)=>_.at-b.at||_.id-b.id),S=new Map,w=null,y=0;g.forEach(_=>{if(_.answer==="known_forever"||_.studyDay<o&&m.get(_.studyDay)?.id!==_.id)return;let b=_.studyDay>=o&&_.studyDay<=n,k=m.get(_.studyDay)?.id===_.id,C=S.get(_.studyDay)??0,L=_.answer==="forgot"||_.answer==="fuzzy",I=C+(L?1:0),x=b&&k&&_.answer==="know"?"known":b&&I>=3?"stubborn":"normal",U=_.at<=y?y+1e3:_.at;y=U,w=Ze(w,_.answer,new Date(U),{mode:x}),L&&b&&S.set(_.studyDay,I)}),w&&(bt(f,w),l+=1)}),u.run("COMMIT")}catch(c){throw u.run("ROLLBACK"),c}return R(r,"1"),{migrated:!0,words:l,reviews:d}}function Kl(e=new Date){return ra(e,EO,pO)}function _O(e=ue){return j(e),E(`SELECT COUNT(*) FROM ${e.table} WHERE ${e.eligible} AND ${ge}`,[],0)}function Gl(e=new Date,t=ue){j(t);let r=Rr(t.table);return E(`SELECT COUNT(*) FROM ${t.table}
     WHERE ${t.eligible} AND (fsrs_due IS NULL OR fsrs_due <= ?)
       AND ${r?te(r,`${t.table}.${t.idColumn}`,e,B(),t.table==="grammar_progress"?t.eligible:"1"):"1"}`,[e.toISOString()],0)}function Hn(e=new Date,t=ue,r=Bl){j(t);let n=Rr(t.table),o=p(`SELECT SUM(COALESCE(fsrs_lapses, 0) < ?) AS normal, SUM(COALESCE(fsrs_lapses, 0) >= ?) AS leech
     FROM ${t.table} WHERE ${t.eligible} AND (fsrs_due IS NULL OR fsrs_due <= ?)
       AND NOT ${n?pe(n,`${t.table}.${t.idColumn}`):"0"}`,[Ee,Ee,e.toISOString()])[0];return Number(o?.normal??0)+Math.min(Number(o?.leech??0),r)+Me(t,e).length}function Xl(e,t=new Date,r=ue){let n=Me(r,t).length;return Math.min(Math.max(0,e),Hn(t,r)-n)+n}function sn(e,t=new Date,r=ue,n=Bl){j(r);let o=Me(r,t).map(Number),s=Rr(r.table);if(r={...r,eligible:`(${r.eligible}) AND NOT ${s?pe(s,`${r.table}.${r.idColumn}`):"0"}`},e<=0)return o;let i=p(`SELECT ${r.idColumn} AS id FROM ${r.table}
     WHERE ${r.eligible} AND (fsrs_due IS NULL OR fsrs_due <= ?) AND COALESCE(fsrs_lapses, 0) >= ?
     ORDER BY RANDOM() LIMIT ?`,[t.toISOString(),Ee,n]).map(f=>Number(f.id));if(E(`SELECT COUNT(*) FROM ${r.table}
     WHERE ${r.eligible} AND (fsrs_due IS NULL OR fsrs_due <= ?) AND COALESCE(fsrs_lapses, 0) < ?`,[t.toISOString(),Ee],0)+i.length>e)return[...p(`SELECT ${r.idColumn} AS id FROM ${r.table}
       WHERE ${r.eligible} AND (fsrs_due IS NULL OR fsrs_due <= ?)
         AND (COALESCE(fsrs_lapses, 0) < ? OR ${r.idColumn} IN (${i.map(()=>"?").join(",")||"NULL"}))
       ORDER BY RANDOM() LIMIT ?`,[t.toISOString(),Ee,...i,e]).map(f=>Number(f.id)),...o];let d=new Date(t.getTime()-W_*36e5).toISOString(),u=p(`SELECT ${r.idColumn} AS id, COALESCE(fsrs_lapses, 0) AS lapses FROM ${r.table}
     WHERE ${r.eligible}
       AND (fsrs_due IS NULL OR fsrs_due <= ?)
     ORDER BY (fsrs_due IS NULL) DESC,
              (fsrs_lapses > 0 AND fsrs_last_review >= ?) DESC,
              fsrs_due ASC,
              ${r.idColumn} ASC
     LIMIT ?`,[t.toISOString(),d,e*3]),l=[],c=0;for(let f of u){if(l.length>=e)break;if(Number(f.lapses??0)>=Ee){if(c>=n)continue;c+=1}l.push(Number(f.id))}return[...l,...o]}var Pn,x_,aO,ue,ta,jl,ct,M_,dO,U_,uO,lO,cO,mO,pO,EO,ge,fO,gO,na,W_,Bl,ne=h(()=>{"use strict";Pn=N($(),1);P();He();Re();Ke();x_=[["fsrs_stability","REAL"],["fsrs_difficulty","REAL"],["fsrs_due","TEXT"],["fsrs_last_review","TEXT"],["fsrs_state","INTEGER"],["fsrs_steps","INTEGER"],["fsrs_reps","INTEGER"],["fsrs_lapses","INTEGER"]],aO=`word_id NOT IN (
  SELECT word_id FROM moji_migrated_reviews WHERE activated_on IS NULL
)`,ue={table:"progress",idColumn:"word_id",eligible:`known_forever = 0 AND ${J("progress")} AND ${aO}`},ta={table:"kanji_reading_memory",idColumn:"word_id",eligible:"1 = 1"},jl={table:"reverse_memory",idColumn:"word_id",eligible:"1 = 1"},ct={table:"grammar_progress",idColumn:"grammar_id",eligible:"known_forever = 0 AND seen_count > 0"},M_=new WeakMap;dO="fsrs_stability, fsrs_difficulty, fsrs_due, fsrs_last_review, fsrs_state, fsrs_steps, fsrs_reps, fsrs_lapses",U_=e=>!e||e.fsrs_stability==null||!e.fsrs_due?null:{stability:Number(e.fsrs_stability),difficulty:Number(e.fsrs_difficulty),due:String(e.fsrs_due),lastReview:String(e.fsrs_last_review??e.fsrs_due),state:e.fsrs_state==null?2:Number(e.fsrs_state),steps:e.fsrs_steps==null?0:Number(e.fsrs_steps),reps:e.fsrs_reps==null?1:Number(e.fsrs_reps),lapses:e.fsrs_lapses==null?0:Number(e.fsrs_lapses)};uO="fsrs_recent_daily_easy_v1",lO=8,cO=(e,t)=>{let r=new Date(`${e}T12:00:00`).getTime();if(t==null||String(t).trim()==="")return r;let n=new Date(String(t).replace(" ","T")).getTime();return Number.isFinite(n)?n:r},mO=(e,t)=>{let r=new Date(`${e}T12:00:00`);return r.setDate(r.getDate()-Math.max(t-1,0)),{startDay:B(r),endDay:e}};pO="fsrs_full_daily_easy_v1",EO=1e4;ge=`(fsrs_due IS NOT NULL AND fsrs_last_review IS NOT NULL
    AND julianday(fsrs_due) - julianday(fsrs_last_review) >= ${zi})`,fO=`NOT ${ge}`,gO="(fsrs_due IS NULL OR fsrs_due <= ?)",na=`COALESCE(fsrs_lapses, 0) >= ${Ee}`;W_=36,Bl=10});var Vl={};M(Vl,{NO_REVIEW_LIMIT:()=>j_,PLAN_REVIEW_AUTO:()=>sa,autoPlanReviewCap:()=>H_,autoReviewCap:()=>$_,dailyReviewCap:()=>Cr,encoreChunkSize:()=>Qo,encoreWeekKey:()=>P_,estimatedMinutesFor:()=>zl,fatigueDetected:()=>es,planReviewLimit:()=>Dr,readEncoreLog:()=>Kn,recentReviewAverages:()=>oa,recordEncore:()=>Zo,reviewBacklogCount:()=>yO});function Kn(e){let t=P_(e);try{let r=JSON.parse(O("encore_log","{}"));return{weekKey:t,weekCount:r.weekKey===t&&Number(r.weekCount)||0,day:e,dayWords:r.day===e&&Number(r.dayWords)||0}}catch{return{weekKey:t,weekCount:0,day:e,dayWords:0}}}function Zo(e,t){let r=Kn(e);R("encore_log",JSON.stringify({weekKey:r.weekKey,weekCount:r.weekCount+1,day:e,dayWords:r.dayWords+t}))}function oa(e=T()){let t=p(`
    SELECT reviewed_on, COUNT(DISTINCT word_id) AS words
    FROM reviews
    WHERE reviewed_on < ? AND reviewed_on >= date(?, '-30 day')
    GROUP BY reviewed_on
  `,[e,e]),r=t.reduce((i,a)=>i+Number(a.words??0),0),n=t.length?r/t.length:0,o=E(`
    SELECT COALESCE(SUM(seconds), 0)
    FROM word_study_time
    WHERE studied_on < ? AND studied_on >= date(?, '-30 day')
  `,[e,e],0),s=r>0&&o>0?Math.min(Math.max(o/r,6),45):SO;return{avgDailyWords:n,secondsPerWord:s}}function Cr(e,t=T()){return e===Ln?j_:e>0?Math.min(Math.max(Math.floor(e),1),ho):$_(oa(t).avgDailyWords)}function es(e=T()){let t=E("SELECT COUNT(*) FROM reviews WHERE reviewed_on = ?",[e],0);if(t<40)return!1;let r=p("SELECT answer FROM reviews WHERE reviewed_on = ? ORDER BY id DESC LIMIT 20",[e]);if(r.length<20)return!1;let n=a=>a==="forgot"||a==="fuzzy",o=r.filter(a=>n(a.answer)).length/r.length,i=E("SELECT COUNT(*) FROM reviews WHERE reviewed_on = ? AND answer IN ('forgot', 'fuzzy')",[e],0)/t;return o>=.4&&o>=i+.15}var wO,TO,SO,j_,$_,Qo,P_,zl,yO,sa,NO,H_,Dr,Lt=h(()=>{"use strict";P();ne();Se();wO=60,TO=150,SO=12,j_=1e9,$_=e=>Math.min(Math.max(Math.round(e*1.5),wO),TO),Qo=e=>{if(e<=0)return 0;if(e<=5)return e;let t=Math.ceil(e*.3/5)*5;return Math.min(Math.max(t,5),50,e)},P_=e=>{let t=new Date(`${e}T00:00:00`);t.setDate(t.getDate()-t.getDay());let r=String(t.getMonth()+1).padStart(2,"0"),n=String(t.getDate()).padStart(2,"0");return`${t.getFullYear()}-${r}-${n}`};zl=(e,t)=>e<=0?0:Math.max(Math.ceil(e*t/60),1);yO=()=>Gl();sa={grammar:{table:"grammar_reviews",key:"grammar_id",floor:20,ceiling:60},kanji:{table:"kanji_char_reviews",key:"char",floor:15,ceiling:40},confusion:{table:"confusion_reviews",key:"group_key",floor:8,ceiling:20}},NO=14,H_=(e,t=T())=>{let{table:r,key:n,floor:o,ceiling:s}=sa[e],i=p(`
    SELECT COUNT(DISTINCT ${n}) AS n FROM ${r}
    WHERE reviewed_on < ? AND reviewed_on >= date(?, '-${NO} day')
    GROUP BY reviewed_on
  `,[t,t]).map(d=>Number(d.n)).sort((d,u)=>d-u),a=i.length?(i[i.length-1>>1]+i[i.length>>1])/2:0;return Math.min(Math.max(Math.round(a*1.5),o),s)},Dr=(e,t,r=T())=>e===Qt?0:e>0?e:Math.min(H_(t,r),Cr(Xr(),r))});var K_,G_,B_,X_,Y_,z_,Gn,V_,ts,an,ia,rs,ns=h(()=>{"use strict";St();Gr();K_=6,G_=4,B_=.2,X_=3,Y_=.65,z_=21,Gn=(e="p")=>`(
  ${e}.seen_count >= ${K_}
  AND (
    ${e}.fsrs_stability IS NULL
    OR ${e}.fsrs_stability < ${z_}
  )
  AND (
    (
      COALESCE(${e}.fsrs_lapses, 0) >= ${G_}
      AND COALESCE(${e}.fsrs_lapses, 0) * 1.0
          / MAX(COALESCE(${e}.fsrs_reps, 0), 1) >= ${B_}
    )
    OR (
      COALESCE(${e}.forgot_count, 0) + COALESCE(${e}.fuzzy_count, 0) >= ${X_}
      AND (
        COALESCE(${e}.forgot_count, 0) * 2.0 + COALESCE(${e}.fuzzy_count, 0)
      ) / MAX(
        COALESCE(${e}.right_count, 0) + COALESCE(${e}.forgot_count, 0) * 2.0 + COALESCE(${e}.fuzzy_count, 0),
        1
      ) >= ${Y_}
    )
  )
)`,V_=e=>{let t=d=>Number(e[d]??0)||0;if(t("seen_count")<K_)return!1;let r=e.fsrs_stability==null?null:t("fsrs_stability");if(r!==null&&r>=z_)return!1;let n=t("fsrs_lapses"),o=t("fsrs_reps");if(n>=G_&&n/Math.max(o,1)>=B_)return!0;let s=t("forgot_count"),i=t("fuzzy_count"),a=s*2+i;return s+i<X_?!1:a/Math.max(t("right_count")+a,1)>=Y_},ts=(e="w")=>Li(`${e}.jlpt_level`,"words"),an=(e="w")=>`${ts(e)} ASC, ${yn(`${e}.id`)} ASC, ${e}.importance DESC, ABS(RANDOM()) ASC`,ia=(e={},t="w",r="p")=>{let n=[],o=[],s=e.level??"All",i=e.type??"all";return e.focus==="mistakes"&&n.push(Gn(r)),s!=="All"&&(s==="Unleveled"?n.push(`(${t}.jlpt_level IS NULL OR ${t}.jlpt_level = '')`):(n.push(`${t}.jlpt_level = ?`),o.push(s))),i==="favorite"?n.push(`EXISTS (
      SELECT 1 FROM content_favorites cf
      WHERE cf.item_type = 'word' AND cf.item_id = CAST(${t}.id AS TEXT)
    )`):i==="noun"?n.push(`(${t}.pos LIKE '%\u540D%' OR ${t}.pos LIKE '%\u540D\u8BCD%')`):i==="verb"?n.push(`(
      ${t}.pos LIKE '%\u52D5%' OR
      ${t}.pos LIKE '%\u52A8\u8BCD%' OR
      ${t}.pos LIKE '%\u81EA\u52A8%' OR
      ${t}.pos LIKE '%\u4ED6\u52A8%' OR
      ${t}.pos LIKE '%\u81EA\u52D5%' OR
      ${t}.pos LIKE '%\u4ED6\u52D5%'
    )`):i==="adjective"?n.push(`(${t}.pos LIKE '%\u5F62%' OR ${t}.pos LIKE '%\u5F62\u5BB9\u8BCD%')`):i==="adverb"&&n.push(`(${t}.pos LIKE '%\u526F%' OR ${t}.pos LIKE '%\u526F\u8BCD%')`),{clause:n.length?` AND ${n.join(" AND ")} `:"",params:o}},rs=(e={})=>(e.level??"All")!=="All"||(e.type??"all")!=="all"||e.focus==="mistakes"});function aa(e,t,r="forward"){let n=E("SELECT COUNT(*) FROM reviews WHERE reviewed_on = ? AND direction = ?",[e,r],0),o=p(`SELECT word_id, answer FROM reviews
     WHERE reviewed_on = ? AND direction = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,[e,r,Math.max(t,1)]),s=new Set;for(let a of o){let d=String(a.answer??"");if(d!=="forgot"&&d!=="fuzzy")break;s.add(Number(a.word_id))}let i=s.size;return{answeredToday:n,wordIds:o.map(a=>Number(a.word_id)),wrongStreak:i}}var Ot,q_,J_,_e,et,Bn,Xn,ar,Fe,Wt=h(()=>{"use strict";Se();ir();G();Ot=()=>Zt(),q_=e=>e==="forward"?"review_queue":`review_queue_${e}`,J_=e=>e==="forward"?"last_answered_word":`last_answered_word_${e}`,_e=(e="forward")=>{try{let t=JSON.parse(O(q_(e),"[]"));return Array.isArray(t)?t.flatMap(r=>{let n=Number(r?.word_id);return Number.isFinite(n)?[{word_id:n,due_after:Math.max(Number(r?.due_after??0),0)}]:[]}):[]}catch{return[]}},et=(e,t="forward")=>{R(q_(t),JSON.stringify(e))},Bn=(e,t="forward")=>{et(_e(t).flatMap(r=>r.word_id===e?[]:[{word_id:r.word_id,due_after:Math.max(r.due_after-1,0)}]),t)},Xn=(e,t=0,r=!1,n=!1,o="forward")=>{let s=_e(o).filter(i=>i.word_id!==e);s.push({word_id:e,due_after:r?0:I_(t,void 0,n)}),et(s,o)},ar=(e,t="forward")=>R(J_(t),String(e)),Fe=(e="forward")=>Number(O(J_(e),"0"))||0});var Ir,RO,ql,Q_,bO,os,rw,da,nw,ow,LO,OO,Jl,Z_,ew,tw,AO,jt,hO,dn,sw,iw,dr,ua,kO,Ql,Mr=h(()=>{"use strict";Ir=N($(),1);Se();yt();tr();Qi();ir();Jo();Wl();G();Lt();ne();Re();Ke();ns();Gr();He();St();Wt();RO=e=>nn(e)??Zi,ql=e=>E("SELECT COUNT(*) FROM stage1_tasks WHERE reviewed_on = ?",[e],0),Q_=new WeakMap,bO=3,os=(e="w")=>`(${me(e)} AND ${e}.id NOT IN (SELECT word_id FROM dictionary_discovered_words))`,rw=`FROM stage1_tasks t JOIN progress p ON p.word_id=t.word_id JOIN words w ON w.id=t.word_id WHERE t.reviewed_on=? AND t.task_type IN ('new','encore_new') AND ${os()} AND NOT ${J()} AND p.known_forever=0`,da=e=>E(`SELECT COUNT(*) FROM stage1_tasks t JOIN words w ON w.id=t.word_id WHERE t.reviewed_on=? AND t.task_type='new' AND NOT ${os()}`,[e],0),nw=e=>Math.max((Ot()>0?bO:0)-E(`SELECT COUNT(DISTINCT w.id) FROM reviews r JOIN words w ON w.id=r.word_id WHERE r.reviewed_on=? AND ${me()} AND NOT EXISTS(SELECT 1 FROM reviews e WHERE e.word_id=w.id AND e.reviewed_on<?) AND NOT ${fe("words","w.id")}`,[e,e],0),0),ow=e=>E(`SELECT COUNT(*) ${rw}`,[e],0),LO=e=>{p(`
    SELECT
      today_reviews.word_id,
      MIN(today_reviews.id) AS first_review_id,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM reviews earlier_reviews
          WHERE earlier_reviews.word_id = today_reviews.word_id
            AND earlier_reviews.reviewed_on < ?
        ) OR ${fe("words","today_reviews.word_id")}
        THEN 'review'
        ELSE 'new'
      END AS task_type
    FROM reviews today_reviews
    WHERE today_reviews.reviewed_on = ?
    GROUP BY today_reviews.word_id
    ORDER BY first_review_id ASC
  `,[e,e]).forEach((r,n)=>{(0,Ir.getDatabase)().run(`
      INSERT OR IGNORE INTO stage1_tasks (reviewed_on, word_id, task_type, order_index)
      VALUES (?, ?, ?, ?)
    `,[e,Number(r.word_id),String(r.task_type??"review"),n+1])})},OO=e=>{p(`
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
  `,[A().toISOString()]).forEach(r=>{(0,Ir.getDatabase)().run("UPDATE moji_migrated_reviews SET activated_on = ? WHERE word_id = ?",[e,Number(r.word_id)])})},Jl=(e,t={})=>{let r=(0,Ir.getDatabase)(),n=Y().includeOptionalExpressions,o=(Q_.get(r)??!1)!==n;Q_.set(r,n),r.run(`DELETE FROM stage1_tasks WHERE reviewed_on = ? AND word_id IN (
    SELECT t.word_id FROM stage1_tasks t JOIN words w ON w.id=t.word_id
    LEFT JOIN progress p ON p.word_id = w.id
    WHERE t.reviewed_on = ? AND NOT ${oe()}
  )`,[e,e]);let s=r.getRowsModified()>0;if(!t.topUp){let c=ql(e)>0;if(c&&!s&&!o){ew(e)&&Z_(e),Ut(ue,"stage1_tasks",e,A(),"review");return}!c&&!s&&E("SELECT 1 FROM reviews WHERE reviewed_on = ? LIMIT 1",[e],0)&&LO(e)}ew(e),OO(e);let i=E(`SELECT COUNT(*) FROM stage1_tasks WHERE reviewed_on = ? AND task_type = 'review'
      AND NOT ${Vr("words","stage1_tasks.word_id",e)}`,[e],0),a=Cr(Xr(),e),d=Math.max(a-i,0),u=E("SELECT COALESCE(MAX(order_index), 0) + 1 FROM stage1_tasks WHERE reviewed_on = ?",[e],1);sn(d,A()).map(c=>({word_id:c})).forEach(c=>{r.run(`
      INSERT OR IGNORE INTO stage1_tasks (reviewed_on, word_id, task_type, order_index)
      VALUES (?, ?, 'review', ?)
    `,[e,Number(c.word_id),u]),u+=1}),Z_(e),Ut(ue,"stage1_tasks",e,A(),"review")},Z_=e=>{let t=(0,Ir.getDatabase)(),r=E("SELECT COALESCE(MAX(order_index), 0) + 1 FROM stage1_tasks WHERE reviewed_on = ?",[e],1),n=Math.max(Ot()-da(e),0),o=n>0?p(`
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
    WHERE ${ye()}
      AND (NOT ${me()} OR d.word_id IS NOT NULL)
      AND p.word_id NOT IN (SELECT word_id FROM stage1_tasks WHERE reviewed_on = ?)
    ORDER BY
      CASE WHEN d.word_id IS NOT NULL THEN 0 ELSE 1 END,
      ${ts("w")},
      ${yn("w.id")},
      CASE WHEN carried.word_id IS NOT NULL THEN 0 ELSE 1 END,
      carried.first_planned_on ASC,
      ${an("w")}
    LIMIT ?
  `,[e,e,n]):[],s=Math.max(nw(e)-ow(e),0),i=s>0?p(`SELECT p.word_id FROM progress p JOIN words w ON w.id=p.word_id WHERE ${os()} AND ${ye()} AND p.word_id NOT IN (SELECT word_id FROM stage1_tasks WHERE reviewed_on=?) ORDER BY ${an("w")} LIMIT ?`,[e,s]):[];[...o,...i].forEach(a=>{t.run(`
      INSERT OR IGNORE INTO stage1_tasks (reviewed_on, word_id, task_type, order_index)
      VALUES (?, ?, 'new', ?)
    `,[e,Number(a.word_id),r]),r+=1})},ew=e=>{let t=E(`
    SELECT COUNT(*)
    FROM stage1_tasks t
    JOIN progress p ON p.word_id = t.word_id
    JOIN words w ON w.id = t.word_id
    WHERE t.reviewed_on = ?
      AND t.task_type = 'new'
      AND NOT ${os()}
      AND (${J()} OR p.known_forever = 1)
  `,[e],0),r=Math.max(Ot()-t,0);(0,Ir.getDatabase)().run(`
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
          JOIN words w ON w.id = t.word_id
          WHERE t.reviewed_on = ?
            AND t.task_type = 'new'
            AND NOT ${os()}
            AND NOT ${J()}
            AND p.known_forever = 0
        )
        WHERE row_number > ?
      )
  `,[e,e,r]);let n=nw(e);return ow(e)<=n?!1:((0,Ir.getDatabase)().run(`DELETE FROM stage1_tasks WHERE reviewed_on=? AND word_id IN (SELECT word_id FROM (SELECT t.word_id, ROW_NUMBER() OVER (ORDER BY ${ts("w")}, ${yn("w.id")}, t.order_index, t.word_id) n ${rw}) WHERE n>?)`,[e,e,n]),!0)},tw="capped-random-v4",AO=e=>{if(O("stage1_plan_version","")===tw)return;E(`
    SELECT COUNT(DISTINCT r.word_id)
    FROM reviews r
    JOIN stage1_tasks t ON t.word_id = r.word_id AND t.reviewed_on = r.reviewed_on
    WHERE t.reviewed_on = ?
  `,[e],0)===0&&((0,Ir.getDatabase)().run("DELETE FROM stage1_tasks WHERE reviewed_on = ?",[e]),et([])),R("stage1_plan_version",tw)},jt=()=>{let e=T();AO(e),Jl(e)},hO=(e,t)=>p(`
  SELECT w.kanji, w.kana, w.example_jp AS example
  FROM stage1_tasks t
  JOIN words w ON w.id = t.word_id
  JOIN progress p ON p.word_id = t.word_id
  WHERE t.reviewed_on = ?
    AND p.known_forever = 0
    AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?)
  ORDER BY t.order_index ASC, t.word_id ASC
`,[e,t.toISOString()]).map(r=>({kanji:String(r.kanji??""),kana:String(r.kana??""),example:String(r.example??"")})),dn=()=>hO(T(),A()),sw=()=>{let e=new Date(`${T()}T12:00:00`);e.setDate(e.getDate()+1);let t=new Date(e);t.setDate(t.getDate()+1),t.setHours(4,0,0,0);let r=p(`
    SELECT w.kanji, w.kana, w.example_jp AS example
    FROM words w JOIN progress p ON p.word_id = w.id
    WHERE p.known_forever = 0 AND ${J()}
      AND p.fsrs_due IS NOT NULL AND p.fsrs_due <= ?
      AND ${te("words","p.word_id",t,T(e))}
    ORDER BY p.fsrs_due ASC, w.id ASC
  `,[t.toISOString()]).map(s=>({kanji:String(s.kanji??""),kana:String(s.kana??""),example:String(s.example??"")})),n=Ot(),o=p(`
    SELECT w.kanji, w.kana, w.example_jp AS example
    FROM words w JOIN progress p ON p.word_id = w.id
    WHERE ${ye()}
      AND NOT ${me()}
    ORDER BY ${an("w")}
    LIMIT ?
  `,[Math.max(n*4,n)]).map(s=>({kanji:String(s.kanji??""),kana:String(s.kana??""),example:String(s.example??"")}));return[...r,...o]},iw=()=>{let e=T(),t=p(`
    SELECT w.id, w.kana, w.kanji, w.pos, w.verb_type
    FROM stage1_tasks t
    JOIN words w ON w.id = t.word_id
    JOIN progress p ON p.word_id = t.word_id
    WHERE t.reviewed_on = ?
      AND p.known_forever = 0
      AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?)
  `,[e,A().toISOString()]);t.length&&ee("\u9996\u9875\u7A7A\u95F2 \xB7 \u5E72\u6270\u7D22\u5F15",()=>qo(e,t))},dr=()=>{let e=T();jt();let t=ql(e),r=E(`
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
  `,[A().toISOString(),e]),o=s=>{let i=n.find(a=>String(a.lane)===s);return{total:Number(i?.total??0),done:Number(i?.done??0)}};return{completed:Math.min(Number(r??0),t),total:t,newLane:o("new"),reviewLane:o("review")}},ua=e=>E(`
  SELECT COUNT(*)
  FROM progress p
  WHERE p.known_forever = 0
    AND ${J()}
    AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?)
    AND ${te("words","p.word_id",A(),e)}
    -- \u8FD8\u6CA1\u8F6E\u5230\u6FC0\u6D3B\u7684\u5BFC\u5165\u8BCD\u4E0D\u7B97\u79EF\u538B,\u5426\u5219\u7EED\u676F\u4F1A\u628A\u51E0\u5343\u4E2A\u5BFC\u5165\u8BCD\u4E00\u6B21\u6027\u5012\u51FA\u6765
    AND p.word_id NOT IN (SELECT word_id FROM moji_migrated_reviews WHERE activated_on IS NULL)
    AND p.word_id NOT IN (SELECT word_id FROM stage1_tasks WHERE reviewed_on = ?)
`,[A().toISOString(),e],0),kO=(e,t)=>{let r=H(`
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
  `,[e,t]);return r?re(r):null},Ql=(e=new Set,t={})=>{let r=t.deterministic===!0,n=T();ee("\u9009\u5361 \xB7 \u4ECA\u65E5\u8BA1\u5212\u68C0\u67E5",jt);let o=new Map(_e().map(v=>[v.word_id,v.due_after])),s=E(`
    SELECT COUNT(*)
    FROM stage1_tasks t
    JOIN progress p ON p.word_id = t.word_id
    WHERE t.reviewed_on = ?
      AND t.task_type = 'new'
      AND NOT ${J()}
      AND p.known_forever = 0
  `,[n],0),i=ee("\u9009\u5361 \xB7 \u5019\u9009\u67E5\u8BE2",()=>p(`
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
      ${ts("w")} AS new_level_rank,
      ${yn("w.id")} AS new_tier_rank,
      ${me()} AS collocation,
      EXISTS (SELECT 1 FROM dictionary_discovered_words d WHERE d.word_id = w.id) AS discovered,
      ${J()} AS started
    FROM stage1_tasks t
    JOIN words w ON w.id = t.word_id
    JOIN progress p ON p.word_id = t.word_id
    WHERE t.reviewed_on = ?
      AND p.known_forever = 0
      -- \u51E1\u300C\u672C\u5B66\u4E60\u65E5\u5185\u4ECD\u5230\u671F\u300D\u7684\u90FD\u8981\u51FA:\u8FD8\u6CA1\u7B54\u7684\u3001\u4EE5\u53CA\u7B54\u9519/\u65B0\u8BCD\u5B66\u4E60\u4E2D
      -- (\u88AB\u6392\u5230\u51E0\u5206\u949F\u540E\u3001\u4ECD <= \u4ECA\u65E5\u8FB9\u754C)\u7684\u3002\u6BD5\u4E1A(due \u6392\u5230\u660E\u5929+)\u624D\u79FB\u51FA\u5F53\u5929\u3002
      AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?)
  `,[n,A().toISOString()]));Sr("\u5019\u9009\u5361\u6570",i.length);let a=v=>ee("\u9009\u5361 \xB7 \u5361\u7247\u7EC4\u88C5",()=>kO(n,Number(v.id))),d=i.filter(v=>!e.has(Number(v.id))),u=Fe(),l=d.find(v=>Number(v.id)===u),c=Ft({mistakeStreak:Number(l?.mistake_streak??0),remaining:d.length,total:ql(n)});if(l&&Number(l.mistake_streak??0)>=lt&&(o.get(u)??0)<=0)return a(l);let m=d.length>1&&!c?d.filter(v=>Number(v.id)!==u):d,g=aa(n,$n),S=ee("\u9009\u5361 \xB7 \u5E72\u6270\u7D22\u5F15",()=>qo(n,i)),w=v=>g.wordIds.some(ae=>S.conflicts(Number(v.id),ae)),y=m.filter(v=>v.started||!v.collocation);y.some(v=>!w(v))&&E(`SELECT COUNT(*) FROM stage1_tasks t JOIN words w ON w.id=t.word_id WHERE t.reviewed_on=? AND t.word_id=? AND t.task_type LIKE '%new' AND ${me()}`,[n,u],0)&&(m=y);let _=m.filter(v=>String(v.task_type)==="review"),b=m.filter(v=>["new","encore_new"].includes(String(v.task_type))),k=b.filter(v=>!v.started).sort((v,ae)=>Number(ae.discovered)-Number(v.discovered)||Number(v.new_level_rank)-Number(ae.new_level_rank)||Number(v.new_tier_rank)-Number(ae.new_tier_rank)||Number(v.order_index)-Number(ae.order_index))[0],C=k?b.filter(v=>v===k||v.started):b,L=E(`
    SELECT COUNT(DISTINCT r.word_id)
    FROM reviews r
    JOIN stage1_tasks t ON t.word_id = r.word_id AND t.reviewed_on = r.reviewed_on
    WHERE t.reviewed_on = ?
  `,[n],0),U=(Vi(_.length,b.length,L,r?1:void 0)&&!(_.length&&C.every(w))?C:_.length?_:C).map(v=>{let ae=o.get(Number(v.id))??0,rt=qi(v,o.get(Number(v.id)),s,{randomize:!r});return{score:Ji(rt),dueAfter:ae,row:v}});if(!U.length)return null;let F=U.filter(v=>v.dueAfter<=0);if(!F.length)return U.sort((v,ae)=>v.dueAfter-ae.dueAfter||ae.score-v.score),a(U[0].row);let K=new Map(F.map(v=>[v.row,v])),Q=ea(F.map(v=>({id:Number(v.row.id),score:v.score,recall:RO(v.row),isLeech:Number(v.row.fsrs_lapses??0)>=Ee})),{answeredToday:g.answeredToday,recentIds:g.wordIds,wrongStreak:g.wrongStreak,interference:S,...r?{random:()=>0}:{}});if(!Q)return null;let Z=[...K.keys()].find(v=>Number(v.id)===Q.id);return a(Z||F[0].row)}});var aw,xr,Yn,zn=h(()=>{"use strict";P();aw=N($(),1);dt();Re();xr="fsrs-v1",Yn=({wordId:e,answer:t,reviewedOn:r,direction:n,schedulerMode:o="normal",reviewedAt:s=Date.now(),eventSource:i="study"})=>{Je();let a=(0,aw.getDatabase)();return Cn("words",e,()=>(a.run(`
      INSERT INTO reviews (
        word_id, answer, score_after, reviewed_on, direction,
        reviewed_at, scheduler_mode, fsrs_params_version, event_source
      ) VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?)
    `,[e,t,r,n,s,o,xr,i]),E("SELECT last_insert_rowid()",[],0)))}});var la,dw,Zl,ec,uw,ca,ss,lw,tc,cw,mw,rc,ma=h(()=>{"use strict";G();la=2,dw="last_answer",Zl=e=>!!e&&typeof e=="object"&&!Array.isArray(e),ec=()=>{let e=O(dw,"");if(!e)return[];try{let t=JSON.parse(e);return Zl(t)?[t]:Array.isArray(t)?t.filter(Zl):[]}catch{return[]}},uw=e=>{R(dw,JSON.stringify(e.slice(-la)))},ca=e=>{uw([...ec(),e])},ss=e=>{let t=ec(),r=t.length?t[t.length-1]:null;return!!r&&r.mode===e&&r.reviewed_on===T()},lw=e=>{if(!ss(e))return null;let t=ec(),r=t.pop();return uw(t),r},tc="undo_pinned_card",cw=(e,t)=>{R(tc,JSON.stringify({word_id:e,mode:t}))},mw=e=>{let t=O(tc,"");if(!t)return null;try{let r=JSON.parse(t);if(!Zl(r)||r.mode!==e)return null;let n=Number(r.word_id);return Number.isFinite(n)&&n>0?n:null}catch{return null}},rc=()=>{R(tc,"")}});var pw,X,vO,un=h(()=>{"use strict";pw=N($(),1);P();tr();dt();G();Nr();ne();X=()=>Br("word-progress",vO),vO=()=>{let e=(0,pw.getDatabase)();V(),E("SELECT EXISTS (SELECT 1 FROM words w WHERE NOT EXISTS (SELECT 1 FROM progress p WHERE p.word_id = w.id))",[],1)&&er(()=>{e.run(`
      INSERT OR IGNORE INTO progress (word_id)
      SELECT id FROM words
    `)}),e.run("UPDATE words SET shuffle_rank = ABS(RANDOM()) / 9223372036854775807.0 WHERE shuffle_rank IS NULL"),O("first_study_day","")||R("first_study_day",T()),ee("\u542F\u52A8 \xB7 \u8BED\u6CD5\u8FDB\u5EA6\u521D\u59CB\u5316",Ie);try{j(),Hl(),ra(),Kl()}catch(r){console.warn("[fsrs] \u5355\u8BCD\u56DE\u586B\u8DF3\u8FC7:",r)}try{$l()}catch(r){console.warn("[fsrs] \u6C49\u5B57\u8BFB\u97F3\u5EFA\u8868\u8DF3\u8FC7:",r)}try{Pl()}catch(r){console.warn("[fsrs] \u8BED\u6CD5\u5EFA\u5217\u8DF3\u8FC7:",r)}D()}});var oc={};M(oc,{patternAttachment:()=>nc,patternPieces:()=>CO,splitFormationRules:()=>fw});var fw,gw,_w,Ew,CO,DO,IO,nc,sc=h(()=>{"use strict";fw=e=>{let t=String(e??"").trim();if(!t)return[];let r=t.indexOf("\uFF0F");if(r<=0)return[t];let n=t.slice(0,r).trim(),o=t.slice(r+1).trim();return!n.includes("\uFF0B")||!o.includes("\uFF0B")?[t]:[n,o]},gw=/[～〜~]/,_w=/[～〜~]/g,Ew=/[＋+]/,CO=e=>{let t=[],r="";for(let n of String(e??""))gw.test(n)?(r&&t.push({text:r,slot:!1}),r="",t.push({text:n,slot:!0})):r+=n;return r&&t.push({text:r,slot:!1}),t},DO=e=>String(e).split(_w).map(t=>t.replace(/^[／/、，,]+|[／/、，,]+$/g,"").trim()).filter(Boolean),IO=(e,t,r)=>{if(!Ew.test(e))return null;let n=e.split(Ew).map(i=>i.trim()).filter(Boolean),o=n[0]??"";if(!o||gw.test(o))return null;let s=DO(t);if(s.some(i=>o.includes(i)||i.includes(o)))return null;if(r>=2){if(n.length>2||s.length!==r)return null;let i=new Map;if(s.forEach(a=>i.set(a,(i.get(a)??0)+1)),![...i.values()].every(a=>a>=2))return null}return o},nc=(e,t)=>{let r=String(e??""),n=(r.match(_w)??[]).length;if(!n)return null;let o=fw(t).map(s=>IO(s,r,n)).filter(s=>!!s);return o.length?[...new Set(o)].join("\uFF0F"):null}});var gc={};M(gc,{GRAMMAR_DEFAULT_REVIEW_CAP:()=>xO,GRAMMAR_ENCORE_SIZE:()=>Ow,PLAN_GRAMMAR_LEVEL:()=>At,extendGrammarQuizPlan:()=>GO,getGrammarQuizSession:()=>qn,grammarAudioPlan:()=>KO,grammarNewQuota:()=>uc,grammarPlanDone:()=>pc,grammarPlanRemaining:()=>mc,grammarQuizRanking:()=>BO,grammarReviewEntity:()=>pa,grammarReviewPool:()=>as,scopeLevels:()=>ac,submitGrammarQuizAnswer:()=>Ec,undoLastGrammarQuizAnswer:()=>fc});var Vn,ur,MO,At,ac,lr,pa,xO,Sw,as,UO,FO,WO,ic,dc,yw,jO,Nw,uc,ww,$O,Ea,lc,is,Tw,PO,HO,Rw,cc,bw,Lw,mc,pc,KO,qn,Ec,fc,Ow,GO,BO,ds=h(()=>{"use strict";Vn=N($(),1);hi();Nr();G();Lt();Se();wt();St();Re();ne();Ke();ir();Qi();Wt();sc();ur="grammar",MO=/^N[1-5]$/,At="plan",ac=e=>e===At?Tr(On("grammar")):MO.test(e)?[e]:[],lr=(e,t="g.level")=>{let r=ac(e);return r.length?`${t} IN (${r.map(n=>`'${n}'`).join(", ")})`:"0"},pa=e=>ac(e).length?{...ct,eligible:`${ct.eligible}
      AND grammar_id IN (SELECT id FROM grammar_points WHERE ${lr(e,"level")})`}:ct,xO=sa.grammar.ceiling,Sw=(e,t)=>Dr(e,"grammar",t),as=(e,t)=>{Ie();let r=pa(e);j(r);let n=A(),o=Me(r,n).length;return{due:Hn(n,r),prior:o,review:t==null?0:Xl(Sw(t),n,r)}},UO=e=>E(`SELECT COUNT(*) FROM grammar_points WHERE ${lr(e,"level")}`,[],0),FO=(e,t)=>E(`
  SELECT COUNT(DISTINCT r.grammar_id)
  FROM grammar_reviews r
  JOIN grammar_points g ON g.id = r.grammar_id
  WHERE r.reviewed_on = ? AND ${lr(e)}
`,[t],0),WO=(e,t)=>E(`
  SELECT COUNT(DISTINCT r.grammar_id)
  FROM grammar_reviews r
  JOIN grammar_points g ON g.id = r.grammar_id
  WHERE r.reviewed_on = ? AND ${lr(e)}
    AND EXISTS (SELECT 1 FROM grammar_reviews earlier WHERE earlier.grammar_id = r.grammar_id AND earlier.reviewed_on < ?)
`,[t,t],0),ic=(e,t)=>E(`
  SELECT COUNT(DISTINCT r.grammar_id)
  FROM grammar_reviews r
  JOIN grammar_points g ON g.id = r.grammar_id
  WHERE r.reviewed_on = ? AND ${lr(e)}
    AND NOT EXISTS (
      SELECT 1 FROM grammar_reviews earlier
      WHERE earlier.grammar_id = r.grammar_id AND earlier.reviewed_on < ?
    )
    AND NOT ${fe("grammar","r.grammar_id")}
`,[t,t],0),dc=(e,t)=>E(`
  SELECT COUNT(DISTINCT r.grammar_id)
  FROM grammar_reviews r
  JOIN grammar_points g ON g.id = r.grammar_id
  JOIN grammar_progress p ON p.grammar_id = r.grammar_id
  WHERE r.reviewed_on = ? AND ${lr(e)}
    AND (p.known_forever = 1 OR (p.fsrs_due IS NOT NULL AND p.fsrs_due > ?))
`,[t,A().toISOString()],0),yw=e=>`quiz_encore:${e}`,jO=e=>{try{let t=JSON.parse(E("SELECT value FROM grammar_state WHERE key = ?",[yw(e)],"")||"null");return!t||typeof t!="object"?{day:"",count:0}:{day:String(t.day??""),count:Math.max(Number(t.count??0)||0,0)}}catch{return{day:"",count:0}}},Nw=(e,t)=>{let r=jO(e);return r.day===t?r.count:0},uc=(e,t=T())=>{let r=Math.max(Tu()+Nw(e,t)-ic(e,t),0),n=Ao("grammar");return n===null?r:Math.min(r,n)},ww=!1,$O=()=>{ww||(ww=!0,(0,Vn.getDatabase)().run("DELETE FROM grammar_state WHERE key LIKE 'quiz_round:%'"))},Ea=(e,t)=>{Ie(),j(ct),$O();let r=st().grammarReviewCap,n=Math.min(Sw(r,t),UO(e));if(!/^\d{4}-\d{2}-\d{2}$/.test(t))throw new Error(`bad study day: ${t}`);let o=pa(e),s=`grammar_id IN (SELECT grammar_id FROM grammar_reviews WHERE reviewed_on = '${t}')`,i=A(),a=p(`SELECT grammar_id AS id FROM grammar_progress WHERE ${o.eligible} AND ${s}
       AND (fsrs_due IS NULL OR fsrs_due <= ?)`,[i.toISOString()]).map(f=>Number(f.id)),d=sn(Math.max(0,n-WO(e,t)),i,{...o,eligible:`(${o.eligible}) AND NOT ${s}`}),u=[...a,...d.filter(f=>!a.includes(f))],l=uc(e,t),c=l<=0?[]:p(`
    SELECT g.id
    FROM grammar_points g
    JOIN grammar_progress p ON p.grammar_id = g.id
    WHERE ${lr(e)}
      AND p.seen_count = 0
      AND p.known_forever = 0
    ORDER BY ${Li("g.level","grammar")} ASC, g.sort_order ASC
    LIMIT ?
  `,[l]).map(f=>Number(f.id));return{reviewIds:u,newIds:c}},lc=`
  g.id, g.pattern, g.formation, g.meaning, g.level,
  g.example_jp, g.example_meaning, g.example_furigana, g.example_tokens, g.example_lemmas,
  COALESCE(p.forgot_count, 0) AS forgot_count,
  COALESCE(p.right_count, 0) AS right_count,
  COALESCE(p.seen_count, 0) AS seen_count,
  COALESCE(p.mistake_streak, 0) AS mistake_streak,
  COALESCE(p.known_forever, 0) AS known_forever
`,is=e=>{let t=String(e.pattern??""),r=String(e.formation??""),n=String(e.example_jp??""),o=Wo(e.example_furigana);return{id:Number(e.id),pattern:t,formation:r,attachment:nc(t,r),meaning:String(e.meaning??""),exampleJp:n,exampleMeaning:String(e.example_meaning??""),exampleFurigana:o,exampleTokens:String(e.example_tokens??""),exampleLemmas:String(e.example_lemmas??""),level:String(e.level??""),forgotCount:Number(e.forgot_count??0),rightCount:Number(e.right_count??0),isNew:Number(e.seen_count??0)===0}},Tw=e=>{if(!e.length)return[];let t=e.map(()=>"?").join(","),r=p(`
    SELECT ${lc}
    FROM grammar_points g
    LEFT JOIN grammar_progress p ON p.grammar_id = g.id
    WHERE g.id IN (${t}) AND COALESCE(p.known_forever, 0) = 0
  `,e),n=new Map(r.map(o=>[Number(o.id),o]));return e.map(o=>n.get(o)).filter(Boolean)},PO=(e,t)=>{let{reviewIds:r,newIds:n}=Ea(e,t),o=new Map(_e(ur).map(_=>[_.word_id,_.due_after])),s=Tw(r),i=Tw(n),a=[...s,...i];if(!a.length)return null;let d=Fe(ur),u=a.find(_=>Number(_.id)===d);if(u&&Number(u.mistake_streak??0)>=lt&&(o.get(d)??0)<=0)return is(u);let l=Ft({mistakeStreak:Number(u?.mistake_streak??0),remaining:a.length,total:a.length+dc(e,t)}),c=a.length>1&&!l?a.filter(_=>Number(_.id)!==d):a,f=c.filter(_=>Number(_.seen_count??0)>0),m=c.filter(_=>Number(_.seen_count??0)===0),g=Vi(f.length,m.length,FO(e,t))?m:f.length?f:m,S=g.length?g:c;if(!S.length)return null;let w=S.filter(_=>(o.get(Number(_.id))??0)<=0);if(w.length)return is(w[0]);let y=[...S].sort((_,b)=>(o.get(Number(_.id))??0)-(o.get(Number(b.id))??0));return is(y[0])},HO=2,Rw=e=>`quiz_undo:${e}`,cc=e=>{try{let t=E("SELECT value FROM grammar_state WHERE key = ?",[Rw(e)],"");if(!t)return[];let r=JSON.parse(t);return Array.isArray(r)?r.filter(n=>n?.reviewedOn===T()):[]}catch{return[]}},bw=(e,t)=>{(0,Vn.getDatabase)().run("INSERT OR REPLACE INTO grammar_state (key, value) VALUES (?, ?)",[Rw(e),JSON.stringify(t.slice(-HO))])},Lw=(e,t)=>{let r=T(),{reviewIds:n,newIds:o}=Ea(e,r),s=dc(e,r),i=n.length+o.length;return{card:t,level:e,done:s,total:s+i,remaining:i,newDone:ic(e,r),newQuota:ic(e,r)+uc(e,r),canUndo:cc(e).length>0}},mc=(e,t=T())=>{let{reviewIds:r,newIds:n}=Ea(e,t);return r.length+n.length},pc=(e,t=T())=>dc(e,t),KO=e=>{let{reviewIds:t,newIds:r}=Ea(e,T()),n=t.length?p(`SELECT g.id FROM grammar_points g JOIN grammar_progress p ON p.grammar_id=g.id
    WHERE ${lr(e)} AND p.known_forever=0 AND p.seen_count>0 AND (p.fsrs_due IS NULL OR p.fsrs_due<=?)
      AND ${te("grammar","p.grammar_id",A(),T(),pa(e).eligible)}`,[A().toISOString()]).map(s=>Number(s.id)):[],o=[...new Set([...n,...r])];return o.length?p(`SELECT example_jp FROM grammar_points WHERE id IN (${o.map(()=>"?").join(",")})`,o).map(s=>String(s.example_jp??"")).filter(Boolean):[]},qn=e=>{let t=T();return Lw(e,PO(e,t))},Ec=(e,t,r)=>{Ie(),j(ct);let n=(0,Vn.getDatabase)(),o=T(),s=p(`
    SELECT seen_count, known_forever, last_seen_on, right_count, fuzzy_count, forgot_count, mistake_streak
    FROM grammar_progress
    WHERE grammar_id = ?
  `,[t])[0],i={grammarId:t,reviewedOn:o,reviewId:0,seenCount:Number(s?.seen_count??0),knownForever:Number(s?.known_forever??0)===1?1:0,lastSeenOn:s?.last_seen_on==null?null:String(s.last_seen_on),rightCount:Number(s?.right_count??0),fuzzyCount:Number(s?.fuzzy_count??0),forgotCount:Number(s?.forgot_count??0),mistakeStreak:Number(s?.mistake_streak??0),fsrs:Rt(t,ct),queue:_e(ur),lastAnswered:Fe(ur)};Bn(t,ur);let a=r==="known_forever",d=a||r==="know"?0:i.mistakeStreak+1,l=E(`
    SELECT COUNT(*) FROM grammar_reviews
    WHERE grammar_id = ? AND reviewed_on = ? AND answer IN ('forgot','fuzzy')
  `,[t,o],0)+(r==="forgot"||r==="fuzzy"?1:0)>=Ue,f=E("SELECT COUNT(*) FROM grammar_reviews WHERE grammar_id = ? AND reviewed_on = ?",[t,o],0)===0&&r==="know"?"known":l?"stubborn":"normal",m=!1,g=!1,S=0;if(!a)try{let w=Oe(t,r,new Date,{mode:f},ct);m=Nt(w,A()),S=Math.max((new Date(w.due).getTime()-Date.now())/6e4,0),g=!m&&Nt(Ze(w,"know",new Date,{mode:l?"stubborn":"normal"}),A())}catch(w){console.warn("[fsrs] \u8BED\u6CD5\u8BB0\u5F55\u8DF3\u8FC7:",w),m=r==="know"}return!m&&!a&&Xn(t,S,d>=lt,g,ur),ar(t,ur),n.run(`
    UPDATE grammar_progress
    SET seen_count = COALESCE(seen_count, 0) + 1,
        last_seen_on = ?,
        right_count = ?,
        fuzzy_count = ?,
        forgot_count = ?,
        mistake_streak = ?,
        known_forever = ?
    WHERE grammar_id = ?
  `,[o,i.rightCount+(r==="know"?1:0),i.fuzzyCount+(r==="fuzzy"?1:0),i.forgotCount+(r==="forgot"?1:0),d,a?1:0,t]),i.reviewId=Cn("grammar",t,()=>(n.run(`
      INSERT INTO grammar_reviews (grammar_id, answer, score_after, reviewed_on)
      VALUES (?, ?, 0, ?)
    `,[t,r,o]),E("SELECT last_insert_rowid()",[],0))),bw(e,[...cc(e),i]),Promise.resolve().then(()=>N(nt(),1)).then(({scheduleSave:w})=>w()),qn(e)},fc=e=>{Ie();let t=cc(e);if(!t.length)return qn(e);let r=t.pop(),n=(0,Vn.getDatabase)();n.run(`
    UPDATE grammar_progress
    SET seen_count = ?, known_forever = ?, last_seen_on = ?, right_count = ?,
        fuzzy_count = ?, forgot_count = ?, mistake_streak = ?
    WHERE grammar_id = ?
  `,[r.seenCount,r.knownForever,r.lastSeenOn,r.rightCount,r.fuzzyCount??0,r.forgotCount,r.mistakeStreak,r.grammarId]),r.reviewId&&n.run("DELETE FROM grammar_reviews WHERE id = ?",[r.reviewId]),br("grammar",r.grammarId),on(r.grammarId,r.fsrs??null,ct),et(r.queue??[],ur),ar(r.lastAnswered??0,ur),bw(e,t),Promise.resolve().then(()=>N(nt(),1)).then(({scheduleSave:s})=>s());let o=p(`
    SELECT ${lc}
    FROM grammar_points g
    LEFT JOIN grammar_progress p ON p.grammar_id = g.id
    WHERE g.id = ?
  `,[r.grammarId])[0];return Lw(e,o?is(o):null)},Ow=10,GO=(e,t=Ow)=>{let r=T();return E(`
    SELECT COUNT(*)
    FROM grammar_points g
    JOIN grammar_progress p ON p.grammar_id = g.id
    WHERE ${lr(e)} AND p.seen_count = 0 AND p.known_forever = 0
  `,[],0)>0&&(0,Vn.getDatabase)().run("INSERT OR REPLACE INTO grammar_state (key, value) VALUES (?, ?)",[yw(e),JSON.stringify({day:r,count:Nw(e,r)+Math.max(t,0)})]),Promise.resolve().then(()=>N(nt(),1)).then(({scheduleSave:o})=>o()),qn(e)},BO=e=>(Ie(),j(ct),p(`
    SELECT ${lc}, COALESCE(p.fsrs_lapses, 0) AS lapses
    FROM grammar_points g
    LEFT JOIN grammar_progress p ON p.grammar_id = g.id
    WHERE g.level = ?
    ORDER BY COALESCE(p.forgot_count, 0) DESC,
             COALESCE(p.seen_count, 0) ASC,
             g.sort_order ASC
  `,[e]).map(t=>({...is(t),seenCount:Number(t.seen_count??0),knownForever:Number(t.known_forever??0)===1,lapses:Number(t.lapses??0)})))});var mt,fa,_c=h(()=>{"use strict";mt=N($(),1);G();ne();Ke();zn();Re();fa=e=>{let{entity:t,reviewsTable:r,tasksTable:n}=e,o=t.idColumn,s=t.table,i=()=>{let L=typeof e.extraExclude=="function"?e.extraExclude():e.extraExclude;return`known_forever = 0${L?` AND ${L}`:""}`},a=()=>j(t),d=Rr(s),u=()=>({...t,eligible:`${i()} AND seen_count > 0`}),l=L=>{let x=d&&E("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'level_prior_baselines'",[],0)>0?p(`
      SELECT stability, difficulty, due, last_review, state, steps, reps, lapses
      FROM level_prior_baselines WHERE entity = ? AND entity_key = ?
    `,[d,L])[0]:void 0;if(x){(0,mt.getDatabase)().run(`
        UPDATE ${s}
        SET seen_count = 1, right_count = 0, fuzzy_count = 0, forgot_count = 0, mistake_streak = 0, known_forever = 0, last_seen_on = NULL,
            fsrs_stability = ?, fsrs_difficulty = ?, fsrs_due = ?, fsrs_last_review = ?,
            fsrs_state = ?, fsrs_steps = ?, fsrs_reps = ?, fsrs_lapses = ?
        WHERE ${o} = ?
      `,[x.stability,x.difficulty,x.due,x.last_review,x.state,x.steps,x.reps,x.lapses,L]);return}let U=e.startingState?.(L);if(U){(0,mt.getDatabase)().run(`
        UPDATE ${s}
        SET seen_count = 0, right_count = 0, fuzzy_count = 0, forgot_count = 0,
            mistake_streak = 0, known_forever = 0, last_seen_on = NULL
        WHERE ${o} = ?
      `,[L]),bt(L,U,t);return}(0,mt.getDatabase)().run(`
      UPDATE ${s}
      SET seen_count = 0, right_count = 0, fuzzy_count = 0, forgot_count = 0, mistake_streak = 0, known_forever = 0, last_seen_on = NULL,
          fsrs_stability = NULL, fsrs_difficulty = NULL, fsrs_due = NULL, fsrs_last_review = NULL,
          fsrs_state = NULL, fsrs_steps = NULL, fsrs_reps = NULL, fsrs_lapses = NULL
      WHERE ${o} = ?
    `,[L])},c=(L,I,x)=>{let U=I==="forgot"?[1,0,0,1]:I==="fuzzy"?[1,0,1,0]:[1,1,0,0],F=E(`SELECT mistake_streak FROM ${s} WHERE ${o} = ?`,[L],0);(0,mt.getDatabase)().run(`
      UPDATE ${s}
      SET seen_count = seen_count + ?, right_count = right_count + ?, fuzzy_count = fuzzy_count + ?, forgot_count = forgot_count + ?,
          mistake_streak = ?, last_seen_on = ?
      WHERE ${o} = ?
    `,[...U,I==="forgot"?F+1:0,x,L])},f=(L,I,x=T())=>E(`SELECT COUNT(*) FROM ${r} WHERE ${o} = ? AND reviewed_on = ?`,[L,x],0)===0&&(I==="know"||I==="known_forever")?"known":E(`SELECT COUNT(*) FROM ${r} WHERE ${o} = ? AND reviewed_on = ? AND answer IN ('forgot','fuzzy')`,[L,x],0)+(I==="forgot"||I==="fuzzy"?1:0)>=Ue?"stubborn":"normal",m=(L,I,x=new Date,U,F={})=>{let K=Object.entries(F),Q=[o,"answer","reviewed_on","reviewed_at","scheduler_mode","fsrs_params_version"];if(K.some(([_t])=>!/^[a-z][a-z0-9_]*$/u.test(_t)||Q.includes(_t)||_t==="id"||_t.startsWith("sync_")))throw new Error("Invalid extra review column");let Z=[...Q,...K.map(([_t])=>_t)];if(a(),!E(`SELECT COUNT(*) FROM ${s} WHERE ${o} = ?`,[L],0))throw new Error(`Unknown ${s} row: ${L}`);U??(U=f(L,I));let v=I==="known_forever"?"know":I,ae=Oe(L,v,x,{mode:U},t),rt=T();c(L,v,rt),I==="known_forever"&&(0,mt.getDatabase)().run(`UPDATE ${s} SET known_forever = 1 WHERE ${o} = ?`,[L]);let Kr=()=>(0,mt.getDatabase)().run(`
      INSERT INTO ${r} (${Z.join(", ")})
      VALUES (${Z.map(()=>"?").join(", ")})
    `,[L,I,rt,x.getTime(),U,xr,...K.map(([,_t])=>_t)]);return d?Cn(d,L,Kr):Kr(),ae},g=(L,I=x=>{(0,mt.getDatabase)().run(`INSERT OR IGNORE INTO ${s} (${o}) VALUES (?)`,[x])})=>{a();let x=L?[...new Set([...L])]:p(`SELECT DISTINCT ${o} FROM ${r}`).map(K=>String(K[o])),U=(0,mt.getDatabase)(),F=0;for(let K of x){let Q=p(`SELECT answer, reviewed_on, reviewed_at, scheduler_mode FROM ${r} WHERE ${o} = ? ORDER BY reviewed_at ASC, id ASC`,[K]);if(Q.length){I(K),l(K);for(let Z of Q){let v=String(Z.answer);if(!["forgot","fuzzy","know","known_forever"].includes(v))continue;let ae=Number(Z.reviewed_at),rt=Number.isFinite(ae)?new Date(ae):new Date(`${String(Z.reviewed_on)}T12:00:00`),Kr=v==="known_forever"?"know":v;Oe(K,Kr,rt,{mode:String(Z.scheduler_mode??"normal")},t),c(K,Kr,String(Z.reviewed_on??T())),v==="known_forever"&&U.run(`UPDATE ${s} SET known_forever = 1 WHERE ${o} = ?`,[K])}F+=1}}return F};return{ensure:a,stepMode:f,record:m,replay:g,undoLast:(L=T())=>{a();let I=p(`SELECT id, ${o} AS k FROM ${r} WHERE reviewed_on = ? ORDER BY reviewed_at DESC, id DESC LIMIT 1`,[L])[0];if(!I)return null;let x=String(I.k);return(0,mt.getDatabase)().run(`DELETE FROM ${r} WHERE id = ?`,[I.id]),d&&br(d,x),g([x])||l(x),x},createTasks:(L,I,x=T())=>{a();let U=(0,mt.getDatabase)();if(E(`SELECT COUNT(*) FROM ${n} WHERE reviewed_on = ?`,[x],0)>0){Ut(u(),n,x,e.dayEnd?.(x)??A());let v=ae=>E(`SELECT COUNT(*) FROM ${n} t JOIN ${s} m ON m.${o} = t.${o} WHERE t.reviewed_on = ? AND ${ae}`,[x],0);return{review:v("m.seen_count > 0"),fresh:v("m.seen_count = 0")}}let F=(e.dayEnd?.(x)??A()).toISOString(),K=p(`
      SELECT ${o} FROM ${s}
      WHERE ${i()} AND seen_count > 0 AND fsrs_due IS NOT NULL AND fsrs_due <= ?
        AND NOT ${d?pe(d,`${s}.${o}`):"0"}
      ORDER BY RANDOM() LIMIT ?
    `,[F,Math.max(0,L.review)]).map(v=>String(v[o])),Q=Me(u(),new Date(F),x),Z=I().slice(0,Math.max(0,L.fresh));U.run("BEGIN");try{[...K,...Q,...Z].forEach((v,ae)=>{U.run(`INSERT OR IGNORE INTO ${n} (reviewed_on, ${o}, order_index) VALUES (?, ?, ?)`,[x,v,ae])}),U.run("COMMIT")}catch(v){throw U.run("ROLLBACK"),v}return{review:K.length+Q.length,fresh:Z.length}},clearTasks:(L=T())=>{a(),(0,mt.getDatabase)().run(`DELETE FROM ${n} WHERE reviewed_on = ?`,[L])},pickNext:(L=T(),I=new Set)=>{a();let x=(e.dayEnd?.(L)??A()).toISOString();Ut(u(),n,L,new Date(x));let U=p(`
      SELECT t.${o} AS k, m.fsrs_due, m.fsrs_state
      FROM ${n} t JOIN ${s} m ON m.${o} = t.${o}
      WHERE t.reviewed_on = ? AND m.known_forever = 0
      ORDER BY t.order_index
    `,[L]);for(let F of U){let K=String(F.k);if(I.has(K))continue;if(!(!(F.fsrs_state!=null&&Number(F.fsrs_state)!==2)&&F.fsrs_due!=null&&String(F.fsrs_due)>x))return K}return null},progress:(L=T())=>{a();let I=(e.dayEnd?.(L)??A()).toISOString();Ut(u(),n,L,new Date(I));let x=E(`SELECT COUNT(*) FROM ${n} WHERE reviewed_on = ?`,[L],0),U=E(`
      SELECT COUNT(*) FROM ${n} t JOIN ${s} m ON m.${o} = t.${o}
      WHERE t.reviewed_on = ? AND (m.known_forever = 1 OR (m.fsrs_state = 2 AND m.fsrs_due > ?))
    `,[L,I],0);return{total:x,done:U,remaining:Math.max(0,x-U)}},dueCount:()=>(a(),E(`SELECT COUNT(*) FROM ${s} WHERE ${i()} AND seen_count > 0 AND fsrs_due <= ?
      AND NOT ${d?pe(d,`${s}.${o}`):"0"}`,[A().toISOString()],0)+Me(u()).length),priorCount:()=>(a(),Me(u()).length),get exclude(){return i()}}}});var hw=le((Qx,Aw)=>{Aw.exports=new Proxy({},{get(e,t){let r=require("../shared/content-store");if(t==="__esModule")return!1;if(t!=="then"){if(!r.kanjiUnitRuntime)throw new Error("\u6C49\u5B57\u5355\u5143\u7D22\u5F15\u8FD8\u6CA1\u4ECE\u5206\u5305\u52A0\u8F7D\uFF1A\u5148 await content.ready()");return t==="default"?r.kanjiUnitRuntime:r.kanjiUnitRuntime[t]}}})});var yc={};M(yc,{allKanjiUnits:()=>pt,kanjiUnitByKey:()=>us,kanjiUnitExamples:()=>ls,kanjiUnitIndexLoaded:()=>Ge,kanjiUnitIndexVersion:()=>zO,kanjiUnitLevels:()=>Tc,kanjiUnitWordIds:()=>Jn,kanjiUnitsUpToLevel:()=>Sc,loadKanjiUnitIndex:()=>$t});var cr,wc,XO,YO,$t,Ge,zO,Tc,pt,us,Jn,ls,Sc,Ur=h(()=>{"use strict";cr=null,wc=null,XO=(e,t,r,n,o)=>[e,t,r,n,o].join("|"),YO=e=>{let t=[],r=new Map,n=new Map,o=new Map;return e.units.forEach((s,i)=>{let[a,d,u,l,c,f,m]=s,g=a===0?"char":"jukujikun",S=[];f&1&&S.push("on"),f&2&&S.push("kun");let w=XO(g,d,u,l,c),y=e.wordIds[i]??[],_={unitKey:w,unitType:g,char:d,base:u,surface:l,reading:c,kinds:S,levelRank:m,occurrenceCount:y.length};t.push(_),r.set(w,_),n.set(w,y),o.set(w,(e.examples[i]??[]).map(([b,k,C,L,I])=>({wordId:b,start:k,length:C,reading:L,variant:e.variants[I]??"base"})))}),{version:e.version,levels:e.levels,units:t,byKey:r,wordIdsByKey:n,examplesByKey:o}},$t=()=>cr?Promise.resolve():(wc??(wc=Promise.resolve().then(()=>N(hw(),1)).then(e=>{cr=YO(e.default??e)}).catch(e=>{throw wc=null,e})),wc),Ge=()=>cr!==null,zO=()=>cr?.version??"",Tc=()=>cr?.levels??[],pt=()=>cr?.units??[],us=e=>cr?.byKey.get(e)??null,Jn=e=>cr?.wordIdsByKey.get(e)??[],ls=e=>cr?.examplesByKey.get(e)??[],Sc=e=>pt().filter(t=>t.levelRank<=e)});var vw=le((Zx,kw)=>{kw.exports=new Proxy({},{get(e,t){let r=require("../shared/content-store");if(t==="__esModule")return!1;if(t!=="then"){if(!r.kanjiReadingUsage)throw new Error("\u4E00\u5B57\u591A\u97F3\u8BF4\u660E\u8868\u8FD8\u6CA1\u4ECE\u5206\u5305\u52A0\u8F7D\uFF1A\u5148 await content.ready()");return t==="default"?r.kanjiReadingUsage:r.kanjiReadingUsage[t]}}})});var hc={};M(hc,{allKanjiReadingQuestionChars:()=>Lc,allKanjiReadingUsage:()=>QO,assignKanjiReadingPair:()=>VO,clauseText:()=>Ac,decodeUsagePayload:()=>Cw,kanjiReadingQuestionFor:()=>ga,kanjiReadingUsageFor:()=>Oc,kanjiReadingUsageLoaded:()=>bc,kanjiReadingUsageVersion:()=>JO,loadKanjiReadingUsage:()=>cs,readingLine:()=>ZO,shuffleKanjiReadingOptions:()=>Rc});var Rc,VO,Fr,Nc,qO,Cw,cs,bc,JO,QO,Lc,Oc,ga,Ac,ZO,ms=h(()=>{"use strict";Rc=(e,t=Math.random)=>{let r=[...e];for(let n=r.length-1;n>0;n-=1){let o=Math.floor(t()*(n+1));[r[n],r[o]]=[r[o],r[n]]}return r},VO=(e,t,r)=>{let n={...e};delete n[t];for(let[o,s]of Object.entries(n))s===r&&delete n[Number(o)];return n[t]=r,n},Fr=null,Nc=null,qO=new Set(["num","oku","list"]),Cw=e=>{let t=e.chars.map(([r,n,o,s])=>{let i=s.map(([a,d,u,l,c,f])=>{let m=[];return d&1&&m.push("on"),d&2&&m.push("kun"),{base:a,kinds:m,clause:u>=0?e.clauses[u]??null:null,arg:l,count:c,manual:u<0,examples:f.map(g=>{let[S,w,y]=g.split("|");return{surface:S??"",kana:w??"",meaning:y??""}})}});return{char:r,levelRank:n,summary:o,readings:i,hasManual:i.some(a=>a.manual),hasSpecific:i.some(a=>a.manual||a.clause!==null&&qO.has(a.clause))}});return{version:e.version,levels:e.levels,chars:t,byChar:new Map(t.map(r=>[r.char,r])),questions:new Map(Object.entries(e.questions??{}))}},cs=()=>Fr?Promise.resolve():(Nc??(Nc=Promise.resolve().then(()=>N(vw(),1)).then(e=>{Fr=Cw(e.default??e)}).catch(e=>{throw Nc=null,e})),Nc),bc=()=>Fr!==null,JO=()=>Fr?.version??"",QO=()=>Fr?.chars??[],Lc=()=>[...Fr?.questions.keys()??[]],Oc=e=>Fr?.byChar.get(e)??null,ga=e=>Fr?.questions.get(e)??null,Ac=e=>{if(e.manual)return e.arg;switch(e.clause){case"num":return"\u8DDF\u5728\u6570\u5B57\u540E\u9762";case"oku":{let t=e.arg.split("\uFF0F").filter(Boolean);return t.length?`\u5E26\u9001\u5047\u540D ${t.map(r=>`\u301C${r}`).join("\uFF0F")}`:"\u5E26\u9001\u5047\u540D"}case"list":return"\u5728\u5F53\u524D\u8BCD\u5E93\u4E3B\u8981\u89C1\u4E8E\u4E0B\u9762\u8FD9\u4E9B\u8BCD";case"on":return"\u97F3\u8BFB \u2014\u2014 \u6C49\u8BED\u590D\u5408\u8BCD\u91CC";case"kun":return"\u8BAD\u8BFB \u2014\u2014 \u5355\u72EC\u7528\u3001\u5E26\u9001\u5047\u540D\uFF0C\u6216\u548C\u8BED\u8BCD\u91CC";default:return""}},ZO=e=>e.readings.map(t=>t.base).join(" / ")});var _a=le((eU,Iw)=>{var Dw=Gi()("kanjiReadings");Iw.exports={__esModule:!0,default:Dw,get readings(){return Dw.readings}}});var Es,Qn,kc,eA,tA,rA,nA,ps,vc,Cc,wa,oA,sA,Mw,xw,Uw,Fw,Ww,iA,jw,$w,Pw=h(()=>{"use strict";Es=N($(),1);G();Ur();ms();Qn=e=>e.normalize("NFKC").replace(/[ァ-ヶ]/gu,t=>String.fromCharCode(t.charCodeAt(0)-96)),kc=e=>/^[ぁ-ゖ]+$/u.test(e),eA=["\u304B\u304C","\u304D\u304E","\u304F\u3050","\u3051\u3052","\u3053\u3054","\u3055\u3056","\u3057\u3058","\u3059\u305A","\u305B\u305C","\u305D\u305E","\u305F\u3060","\u3061\u3062","\u3064\u3065","\u3066\u3067","\u3068\u3069","\u306F\u3070\u3071","\u3072\u3073\u3074","\u3075\u3076\u3077","\u3078\u3079\u307A","\u307B\u307C\u307D"],tA={\u304D:"\u304B\u304F\u3053",\u304E:"\u304C\u3050\u3054",\u3057:"\u3055\u3059\u305D",\u3058:"\u3056\u305A\u305E",\u3061:"\u305F\u3064\u3068",\u306B:"\u306A\u306C\u306E",\u3072:"\u306F\u3075\u307B",\u3073:"\u3070\u3076\u307C",\u3074:"\u3071\u3077\u307D",\u307F:"\u307E\u3080\u3082",\u308A:"\u3089\u308B\u308D"},rA=(e,t)=>{let r=Qn(e),n=t.map(Qn);for(let s=0;s<r.length;s+=1){let i=r[s],a="\u304A\u3053\u3054\u305D\u305E\u3068\u3069\u306E\u307B\u307C\u307D\u3082\u3088\u3087\u308D\u3046\u304F\u3050\u3059\u305A\u3064\u3065\u306C\u3075\u3076\u3077\u3080\u3086\u3085\u308B\u3094\u3049\u3045".includes(i)?"\u3046":"\u3048\u3051\u3052\u305B\u305C\u3066\u3067\u306D\u3078\u3079\u307A\u3081\u308C\u3047".includes(i)?"\u3044":"";a&&(i==="\u3046"&&s>0&&"\u304A\u3053\u3054\u305D\u305E\u3068\u3069\u306E\u307B\u307C\u307D\u3082\u3088\u3087\u308D\u3046\u304F\u3050\u3059\u305A\u3064\u3065\u306C\u3075\u3076\u3077\u3080\u3086\u3085\u308B\u3094\u3049\u3045".includes(r[s-1])||n.push(r[s+1]===a?r.slice(0,s+1)+r.slice(s+2):r.slice(0,s+1)+a+r.slice(s+1)))}let o=eA.find(s=>s.includes(r[0]??""));if(r&&o)for(let s of o)n.push(s+r.slice(1));for(let[s,i]of Object.entries(tA))for(let a=0;a<3;a+=1){let d=s+"\u3083\u3085\u3087"[a];for(let u of[s,i[a]]){r.includes(d)&&n.push(r.replace(d,u));let l=r.indexOf(u);l>=0&&!"\u3083\u3085\u3087".includes(r[l+1]??" ")&&n.push(r.slice(0,l)+d+r.slice(l+1))}}return n.push(r.endsWith("\u3093")?r.slice(0,-1):r+"\u3093"),/[つく]$/u.test(r)&&n.push(r.slice(0,-1)+"\u3063"),r.endsWith("\u3063")&&n.push(r.slice(0,-1)+"\u3064",r.slice(0,-1)+"\u304F"),[...new Set(n)].filter(s=>kc(s)&&s!==r)},nA=new Set(["rendaku","sokuon","handaku","rendaku-handaku","on-drop"]),ps=null,vc=e=>{if(!ps){ps=new Map;for(let t of pt()){if(t.unitType!=="char")continue;let r=ps.get(t.char)??[];r.push(t),ps.set(t.char,r)}}return ps.get(e)??[]},Cc=new WeakMap,wa=new WeakMap,oA=()=>{let e=(0,Es.getDatabase)(),t=wa.get(e);if(!t){t=new Map;for(let r of p("SELECT id, kanji, kana FROM words")){let n=String(r.kanji??""),o=t.get(n)??[];o.push({wordId:Number(r.id),kana:String(r.kana??"")}),t.set(n,o)}wa.set(e,t)}return t},sA=(e,t,r)=>{let n=2166136261;for(let o of`${t}:${r}`)n=Math.imul(n^o.charCodeAt(0),16777619)>>>0;return Rc(e,()=>(n=Math.imul(n,1664525)+1013904223>>>0,n/4294967296))},Mw=e=>e.flatMap(t=>ls(t.unitKey).map(r=>({...r,base:t.base}))),xw=(e,t,r)=>{let n=[];for(let o of t){let s=r.get(o.wordId);if(!s)continue;let i=String(s.kanji??"");if(/[\[\]]/u.test(i)||i.slice(o.start,o.start+o.length)!==e||o.variant!=="base"&&!nA.has(o.variant))continue;let a=o.variant==="base"?0:1,d=n[a];if(d&&(Number(d.row.seen)-Number(s.seen)||Number(d.row.importance)-Number(s.importance)||Number(s.id)-Number(d.row.id))>=0)continue;let u=Qn(o.reading),l=Qn(o.base);!kc(u)||!kc(l)||(n[a]={row:s,example:o,answer:u,base:l})}return n.flatMap(({row:o,example:s,answer:i,base:a})=>[{wordId:s.wordId,word:String(o.kanji??""),start:s.start,length:s.length,kana:String(o.kana??""),meaning:String(o.meaning??""),answer:i,base:a,variant:s.variant}])},Uw=(e,t)=>{let r=oA().get(e.word)??[];return n=>!r.some(o=>{if(o.wordId===e.wordId)return!1;let s=t.filter(i=>i.wordId===o.wordId&&i.start===e.start&&i.length===e.length);return s.length?s.some(i=>Qn(i.reading)===n):Qn(o.kana).includes(n)})},Fw=(e,t,r)=>{let n=[...e.variant==="base"?[]:[e.base],...t.map(o=>o.base)];return rA(e.answer,n).filter(Uw(e,r)).slice(0,3)},Ww=(e,t)=>t.length>0&&(e.variant==="base"||t.includes(e.base)),iA=e=>{if(!Ge())return null;let t=(0,Es.getDatabase)(),r=Cc.get(t);if(r||(r=new Map,Cc.set(t,r)),r.has(e))return r.get(e);let n=vc(e),o=Mw(n),s=[...new Set(o.map(l=>l.wordId))],i=s.length?p(`
    SELECT w.id, w.kanji, w.kana, w.meaning, COALESCE(p.seen_count, 0) AS seen, COALESCE(w.importance, 0) AS importance
    FROM words w LEFT JOIN progress p ON p.word_id = w.id
    WHERE w.id IN (${s.map(()=>"?").join(",")})
  `,s):[],a=xw(e,o,new Map(i.map(l=>[Number(l.id),l]))),d=[];for(let l of a){if(!l)continue;let c=Fw(l,n,o);Ww(l,c)&&d.push({...l,options:sA([l.answer,...c],e,l.wordId)})}let u=d.length?{items:d}:null;return r.set(e,u),u},jw=e=>iA(e),$w=e=>{if(!Ge()||!e.length)return[];let t=(0,Es.getDatabase)(),r=new Map(e.map(d=>[d,Mw(vc(d))])),n=new Set([...r.values()].flatMap(d=>d.map(u=>u.wordId))),o=new Map,s=new Map,i=JSON.parse(E(`
    SELECT json_group_array(json_array(w.id, w.kanji, w.kana, COALESCE(p.seen_count, 0), COALESCE(w.importance, 0)))
    FROM words w LEFT JOIN progress p ON p.word_id = w.id
  `,[],"[]"));for(let[d,u,l,c,f]of i){let m=Number(d),g=String(u??"");n.has(m)&&o.set(m,{id:d,kanji:u,kana:l,seen:c,importance:f});let S=s.get(g)??[];S.push({wordId:m,kana:String(l??"")}),s.set(g,S)}wa.has(t)||wa.set(t,s);let a=Cc.get((0,Es.getDatabase)());return e.filter(d=>{if(a?.has(d))return a.get(d)!==null;let u=vc(d),l=r.get(d);return xw(d,l,o).some(c=>{let f=Uw(c,l);if(c.variant!=="base")return c.base!==c.answer&&f(c.base);let m=c.answer.endsWith("\u3093")?c.answer.slice(0,-1):c.answer+"\u3093";return m&&f(m)?!0:Ww(c,Fw(c,u,l))})})}});var Ra={};M(Ra,{KANJI_CHAR_FSRS:()=>Dc,clearKanjiCharTasks:()=>Wc,createKanjiCharTasks:()=>Sa,ensureKanjiCharTables:()=>Pt,kanjiCharCard:()=>Ic,kanjiCharDataLoaded:()=>Ta,kanjiCharPool:()=>Na,kanjiCharPriorCount:()=>Uc,kanjiCharProgress:()=>ya,kanjiCharStepMode:()=>cA,loadKanjiCharData:()=>fs,materializeKanjiChars:()=>gs,pickKanjiCharNext:()=>xc,recordKanjiCharReview:()=>Fc,replayKanjiCharReviews:()=>mA,undoLastKanjiCharReview:()=>jc});var Zn,Kw,Dc,aA,fs,Ta,Pt,gs,dA,Ic,uA,Hw,Mc,lA,Et,Sa,xc,ya,Uc,cA,Fc,Wc,jc,mA,Na,eo=h(()=>{"use strict";Zn=N($(),1);St();G();ne();zn();_c();dt();Ur();ms();Kw=N(_a(),1);Pw();Dc={table:"kanji_char_memory",idColumn:"char",eligible:"known_forever = 0"},aA=Kw.default.readings,fs=()=>Promise.all([$t(),cs()]).then(()=>{}),Ta=()=>Ge()&&bc(),Pt=()=>{let e=(0,Zn.getDatabase)();e.run(`
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
      fsrs_params_version TEXT NOT NULL DEFAULT '${xr}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `),e.run("CREATE INDEX IF NOT EXISTS idx_kanji_char_reviews_char_on ON kanji_char_reviews (char, reviewed_on)"),e.run(`
    CREATE TABLE IF NOT EXISTS kanji_char_tasks (
      reviewed_on TEXT NOT NULL,
      char TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      PRIMARY KEY (reviewed_on, char)
    )
  `),j(Dc)},gs=()=>{Pt();let e=new Map;for(let n of pt()){if(n.unitType!=="char"||!n.char)continue;let o=e.get(n.char);(o===void 0||n.levelRank<o)&&e.set(n.char,n.levelRank)}let t=(0,Zn.getDatabase)();return er(()=>(t.run(`
      INSERT OR IGNORE INTO kanji_char_memory (char, level_rank)
      SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]')
      FROM json_each(?) ORDER BY CAST(key AS INTEGER)
    `,[JSON.stringify([...e])]),t.getRowsModified()))},dA=6,Ic=e=>{let t=p("SELECT level_rank FROM kanji_char_memory WHERE char = ?",[e])[0];if(!t)return null;let r=new Set;for(let i of pt())i.unitType==="char"&&i.char===e&&Jn(i.unitKey).forEach(a=>r.add(a));let n=r.size?p(`
        SELECT w.id, w.kanji, w.kana, w.meaning, w.jlpt_level, COALESCE(p.seen_count, 0) AS seen, COALESCE(w.importance, 0) AS importance
        FROM words w LEFT JOIN progress p ON p.word_id = w.id
        WHERE w.id IN (${[...r].map(()=>"?").join(",")})
        ORDER BY seen DESC, importance DESC, w.id ASC
        LIMIT ${dA}
      `,[...r]).map(i=>({wordId:Number(i.id),kanji:String(i.kanji??""),kana:String(i.kana??""),meaning:String(i.meaning??""),level:String(i.jlpt_level??"")})):[],o=aA[e]??{},s=Oc(e)?.readings.map(i=>({base:i.base,kinds:i.kinds,note:Ac(i)}))??[];return{char:e,levelRank:Number(t.level_rank),on:o.on??[],kun:o.kun??[],usage:s,examples:n,question:ga(e)??void 0,choice:ga(e)?void 0:jw(e)??void 0}},uA=()=>{let e=new Map;for(let t of pt())t.unitType==="char"&&t.char&&e.set(t.char,(e.get(t.char)??0)+t.occurrenceCount);return e},Hw=new WeakMap,Mc=()=>{let e=(0,Zn.getDatabase)(),t=Hw.get(e);if(t)return t;let r=new Set(Lc());if(!Ta())return r;let n=[...new Set(pt().filter(o=>o.unitType==="char").map(o=>o.char))];for(let o of $w(n.filter(s=>!r.has(s))))r.add(o);return Hw.set(e,r),r},lA=()=>{let e=[...Mc()];return e.length?`char IN (${e.map(t=>`'${t.replace(/'/gu,"''")}'`).join(",")})`:"0"},Et=fa({entity:Dc,reviewsTable:"kanji_char_reviews",tasksTable:"kanji_char_tasks",extraExclude:lA}),Sa=(e,t,r=T())=>{Pt();let n=Mc();if(!n.size)throw new Error("\u6C49\u5B57\u9898\u5C1A\u672A\u52A0\u8F7D\uFF0C\u4E0D\u80FD\u751F\u6210\u6C49\u5B57\u5361\u6E05\u5355");return p("SELECT char FROM kanji_char_tasks WHERE reviewed_on = ?",[r]).some(o=>!n.has(String(o.char)))&&(0,Zn.getDatabase)().run("DELETE FROM kanji_char_tasks WHERE reviewed_on = ?",[r]),Et.createTasks(e,()=>{let o=uA(),s=zr("kanji");return p(`SELECT char, level_rank FROM kanji_char_memory WHERE ${Et.exclude} AND seen_count = 0 AND level_rank <= ?`,[t]).map(i=>({char:String(i.char),rank:s[Number(i.level_rank)]??0})).sort((i,a)=>i.rank-a.rank||(o.get(a.char)??0)-(o.get(i.char)??0)||i.char.localeCompare(a.char)).map(i=>i.char)},r)},xc=(e=T(),t=new Set)=>{Pt();let r=Mc(),n=new Set(t);for(let o=0;o<1e3;o+=1){let s=Et.pickNext(e,n);if(!s)return null;if(r.has(s))return s;n.add(s)}return null},ya=(e=T())=>(Pt(),Et.progress(e)),Uc=Et.priorCount,cA=Et.stepMode,Fc=(e,t,r=new Date,n)=>(Pt(),Et.record(e,t,r,n)),Wc=(e=T())=>{Pt(),Et.clearTasks(e)},jc=()=>(Pt(),Et.undoLast()),mA=e=>(Pt(),Et.replay(e,t=>(0,Zn.getDatabase)().run("INSERT OR IGNORE INTO kanji_char_memory (char, level_rank) VALUES (?, 5)",[t]))),Na=e=>(Pt(),{due:Et.dueCount(),unseen:E(`SELECT COUNT(*) FROM kanji_char_memory WHERE ${Et.exclude} AND seen_count = 0 AND level_rank <= ?`,[e],0)})});var _s=le((EU,Gw)=>{var $c=require("../shared/content-store"),ba=()=>{if(!$c.distinctionReviews)throw new Error("\u5185\u5BB9 distinctionReviews \u672A ready\uFF1A\u5148 await readyForHomeMode / readyForRoute");return $c.distinctionReviews};Gw.exports={loadDistinctionReviews:()=>require("../shared/content").load("distinctionReviews").then(()=>{}),distinctionReviewsLoaded:()=>!!$c.distinctionReviews,get DISTINCTION_REVIEWS(){return ba().DISTINCTION_REVIEWS},get distinctionReviewMap(){return ba().distinctionReviewMap},distinctionReviewFor:e=>ba().distinctionReviewFor(e),distinctionNotesFor:(...e)=>ba().distinctionNotesFor(...e)}});var Bw,Xw=h(()=>{"use strict";Bw={"stem:\u5411":[{title:"\u5355\u65B9\u671D\u5411\u76EE\u6807",words:{\u5411\u304B\u3046:"\u81EA",\u5411\u304F:"\u81EA",\u5411\u3051\u308B:"\u4ED6"}},{title:"\u5E26\u300C\u5408\u3046\u300D\uFF1A\u53CC\u65B9\u4E92\u76F8",words:{\u5411\u304B\u3044\u5408\u3046:"\u81EA",\u5411\u304D\u5408\u3046:"\u81EA"}}],"stem:\u9589":[{title:"\u8BFB \u3057\u3081\uFF0F\u3057\u307E\uFF1A\u95E8\u7A97\u5173\u4E0A",words:{\u9589\u3081\u308B:"\u4ED6",\u9589\u307E\u308B:"\u81EA"}},{title:"\u8BFB \u3068\u3058\uFF0F\u3068\u3056\uFF1A\u5408\u62E2\u3001\u5C01\u4F4F",words:{\u9589\u3058\u308B:"\u81EA\u4ED6",\u9589\u3056\u3059:"\u4ED6",\u9589\u3058\u8FBC\u3081\u308B:"\u4ED6"}}],"stem:\u5165":[{title:"\u8FDB\u53BB\u3001\u653E\u8FDB\u53BB",words:{\u5165\u308B:"\u81EA",\u5165\u308C\u308B:"\u4ED6",\u5165\u308A\u8FBC\u3080:"\u81EA"}},{title:"\u5165\u308C\u66FF\u301C\uFF1A\u4E92\u6362",words:{\u5165\u308C\u66FF\u308F\u308B:"\u81EA",\u5165\u308C\u66FF\u3048\u308B:"\u4ED6"}},{title:"\u8BFB \u3044\u308A\uFF1A\u6DF7\u6742\u3001\u590D\u6742",words:{\u5165\u308A\u4EA4\u3058\u308B:"\u81EA",\u5165\u308A\u7D44\u3080:"\u81EA"}}],"stem:\u624B":[{title:"\u4E1C\u897F\u79BB\u624B\uFF1A\u4EA4\u51FA\u6216\u653E\u6389",words:{\u624B\u6E21\u3059:"\u4ED6",\u624B\u653E\u3059:"\u4ED6"}},{title:"\u4EB2\u624B\u53BB\u505A",words:{\u624B\u304C\u3051\u308B:"\u4ED6"}}],"stem:\u8003":[{title:"\u601D\u8003\u672C\u8EAB",words:{\u8003\u3048\u308B:"\u4ED6"}},{title:"\u8003\u3048\uFF0B\u540E\u9879\uFF1A\u91CD\u60F3\uFF0F\u9677\u8FDB\u53BB",words:{\u8003\u3048\u76F4\u3059:"\u4ED6",\u8003\u3048\u8FBC\u3080:"\u81EA"}}],"stem:\u6C7A":[{title:"\u51B3\u5B9A\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u6C7A\u3081\u308B:"\u4ED6",\u6C7A\u307E\u308B:"\u81EA"}},{title:"\u301C\u3064\u3051\u308B\uFF1A\u6B66\u65AD",words:{\u6C7A\u3081\u3064\u3051\u308B:"\u4ED6"}}],"stem:\u53D7":[{title:"\u63A5\u4F4F\u4E1C\u897F\u6216\u51B2\u51FB",words:{\u53D7\u3051\u308B:"\u4ED6",\u53D7\u3051\u53D6\u308B:"\u4ED6",\u53D7\u3051\u6B62\u3081\u308B:"\u4ED6"}},{title:"\u8BA9\u5BF9\u65B9\u8FDB\u6765\uFF1A\u63A5\u7EB3\u3001\u53D7\u7406",words:{\u53D7\u3051\u5165\u308C\u308B:"\u4ED6",\u53D7\u3051\u4ED8\u3051\u308B:"\u4ED6"}}],"stem:\u4F7F":[{title:"\u600E\u4E48\u7528",words:{\u4F7F\u3046:"\u4ED6",\u4F7F\u3044\u5206\u3051\u308B:"\u4ED6",\u4F7F\u3044\u3053\u306A\u3059:"\u4ED6"}},{title:"\u7528\u5230\u6D88\u8017",words:{\u4F7F\u3044\u679C\u305F\u3059:"\u4ED6",\u4F7F\u3044\u8FBC\u3080:"\u4ED6"}}],"stem:\u8CB7":[{title:"\u4E70\u5230\u81EA\u5DF1\u624B\u91CC",words:{\u8CB7\u3046:"\u4ED6",\u8CB7\u3044\u6C42\u3081\u308B:"\u4ED6",\u8CB7\u3044\u53D6\u308B:"\u4ED6"}},{title:"\u4E70\u7ED9\u522B\u4EBA\uFF0F\u5168\u90E8\u4E70\u5149",words:{\u8CB7\u3044\u4E0E\u3048\u308B:"\u4ED6",\u8CB7\u3044\u5360\u3081\u308B:"\u4ED6"}}],"stem:\u58F2":[{title:"\u4EBA\u5356\u4E1C\u897F\uFF08\u4ED6\uFF09",words:{\u58F2\u308B:"\u4ED6",\u58F2\u308A\u51FA\u3059:"\u4ED6"}},{title:"\u5546\u54C1\u4F5C\u4E3B\u8BED\uFF1A\u5356\u5F97\u600E\u6837\uFF08\u81EA\uFF09",words:{\u58F2\u308C\u308B:"\u81EA",\u58F2\u308A\u5207\u308C\u308B:"\u81EA",\u58F2\u308C\u6B8B\u308B:"\u81EA"}}],"stem:\u6301":[{title:"\u62FF\u7740\u3001\u5E26\u5728\u8EAB\u4E0A",words:{\u6301\u3064:"\u4ED6",\u6301\u3061\u6B69\u304F:"\u4ED6"}},{title:"\u5E26\u5F80\u54EA\u91CC\uFF1A\u56DE\u3001\u8FDB\u3001\u51FA",words:{\u6301\u3061\u5E30\u308B:"\u4ED6",\u6301\u3061\u8FBC\u3080:"\u4ED6",\u6301\u3061\u51FA\u3059:"\u4ED6"}}],"stem:\u7ACB":[{title:"\u7AD9\u3001\u7AD6",words:{\u7ACB\u3064:"\u81EA",\u7ACB\u3066\u308B:"\u4ED6",\u7ACB\u3061\u4E0A\u304C\u308B:"\u81EA",\u7ACB\u3061\u4E26\u3076:"\u81EA"}},{title:"\u79BB\u5F00",words:{\u7ACB\u3061\u53BB\u308B:"\u81EA",\u7ACB\u3061\u9000\u304F:"\u81EA"}},{title:"\u56DE\u5230\u539F\u5904",words:{\u7ACB\u3061\u8FD4\u308B:"\u81EA",\u7ACB\u3061\u623B\u308B:"\u81EA"}}],"stem:\u8AAD":[{title:"\u8BFB\u3001\u8BFB\u61C2",words:{\u8AAD\u3080:"\u4ED6",\u8AAD\u307F\u53D6\u308B:"\u4ED6",\u8AAD\u307F\u8FBC\u3080:"\u4ED6"}},{title:"\u8BFB\u7684\u65B9\u5F0F\uFF1A\u51FA\u58F0\uFF0F\u518D\u8BFB",words:{\u8AAD\u307F\u4E0A\u3052\u308B:"\u4ED6",\u8AAD\u307F\u8FD4\u3059:"\u4ED6"}}],"stem:\u805E":[{title:"\u4E0D\u5E26\u540E\u9879\uFF1A\u542C\u3001\u542C\u5F97\u89C1\u3001\u8BA9\u4EBA\u542C",words:{\u805E\u304F:"\u4ED6",\u805E\u3053\u3048\u308B:"\u81EA",\u805E\u304B\u305B\u308B:"\u4ED6"}},{title:"\u542C\u5230\u624B\uFF1A\u542C\u61C2\u3001\u542C\u5230\u98CE\u58F0",words:{\u805E\u304D\u53D6\u308B:"\u4ED6",\u805E\u304D\u3064\u3051\u308B:"\u4ED6"}},{title:"\u95EE\uFF1A\u518D\u95EE\u3001\u95EE\u51FA",words:{\u805E\u304D\u76F4\u3059:"\u4ED6",\u805E\u304D\u51FA\u3059:"\u4ED6"}}],"stem:\u6B62":[{title:"\u8BFB \u3068\u307E\uFF0F\u3068\u3081\uFF1A\u52A8\u7684\u4E1C\u897F\u505C\u4E0B",words:{\u6B62\u307E\u308B:"\u81EA",\u6B62\u3081\u308B:"\u4ED6"}},{title:"\u8BFB \u3084\u3080\uFF0F\u3084\u3081\u308B\uFF1A\u6301\u7EED\u7684\u4E8B\u505C\u6B62",words:{\u6B62\u3080:"\u81EA",\u3084\u3081\u308B:"\u4ED6"}}],"stem:\u63A2":[{title:"\u4E00\u822C\u5730\u627E",words:{\u63A2\u3059:"\u4ED6"}},{title:"\u627E\u5230\u624B\uFF0F\u5230\u5904\u627E",words:{\u63A2\u3057\u51FA\u3059:"\u4ED6",\u63A2\u3057\u56DE\u308B:"\u4ED6"}}],"stem:\u7740":[{title:"\u8BFB \u304D\uFF1A\u7A7F\u8863\u670D",words:{\u7740\u308B:"\u4ED6",\u7740\u66FF\u3048\u308B:"\u81EA\u4ED6"}},{title:"\u8BFB \u3064\u304F\uFF1A\u5230\u8FBE",words:{\u7740\u304F:"\u81EA",\u305F\u3069\u308A\u7740\u304F:"\u81EA"}}],"stem:\u4E26":[{title:"\u6392\u5217\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u4E26\u3076:"\u81EA",\u4E26\u3079\u308B:"\u4ED6"}},{title:"\u4E00\u6761\u6761\u8BF4\u51FA\u6765",words:{\u4E26\u3079\u7ACB\u3066\u308B:"\u4ED6"}}],"stem:\u964D":[{title:"\u8BFB \u304A\u308A\u308B\uFF1A\u4EBA\u4ECE\u4E0A\u9762\u4E0B\u6765",words:{\u964D\u308A\u308B:"\u81EA"}},{title:"\u8BFB \u3075\u308B\uFF1A\u96E8\u96EA\u843D\u4E0B",words:{\u964D\u308B:"\u81EA",\u964D\u308A\u51FA\u3059:"\u81EA",\u964D\u308A\u7D9A\u304F:"\u81EA",\u964D\u308A\u6CE8\u3050:"\u81EA"}}],"stem:\u4E57":[{title:"\u5750\u8F66\u3001\u6362\u8F66",words:{\u4E57\u308B:"\u81EA",\u4E57\u308A\u63DB\u3048\u308B:"\u4ED6",\u4E57\u308A\u7D99\u3050:"\u4ED6"}},{title:"\u6BD4\u55BB\uFF1A\u8D8A\u8FC7\u3001\u633A\u8FC7\u96BE\u5173",words:{\u4E57\u308A\u8D8A\u3048\u308B:"\u81EA",\u4E57\u308A\u5207\u308B:"\u81EA\u4ED6"}}],"stem:\u8A00":[{title:"\u8BF4\u51FA\u53E3",words:{\u8A00\u3046:"\u4ED6",\u8A00\u3044\u51FA\u3059:"\u4ED6",\u8A00\u3044\u653E\u3064:"\u4ED6",\u8A00\u3044\u5207\u308B:"\u4ED6"}},{title:"\u8BF4\u7ED9\u4EBA\uFF1A\u529D\u3001\u6362\u8BF4\u6CD5\u3001\u7559\u8BDD",words:{\u8A00\u3044\u805E\u304B\u305B\u308B:"\u4ED6",\u8A00\u3044\u63DB\u3048\u308B:"\u4ED6",\u8A00\u3044\u6B8B\u3059:"\u4ED6"}}],"stem:\u547C":[{title:"\u628A\u4EBA\u53EB\u8FC7\u6765",words:{\u547C\u3076:"\u4ED6",\u547C\u3073\u5BC4\u305B\u308B:"\u4ED6",\u547C\u3073\u8FBC\u3080:"\u4ED6"}},{title:"\u8BA9\u4EBA\u505C\u4E0B",words:{\u547C\u3073\u6B62\u3081\u308B:"\u4ED6"}}],"stem:\u4E0A":[{title:"\u4E3B\u4F53\u5F80\u4E0A\uFF08\u81EA\uFF09",words:{\u4E0A\u304C\u308B:"\u81EA",\u4E0A\u308B:"\u81EA"}},{title:"\u628A\u4E1C\u897F\u5F04\u4E0A\u6765\uFF08\u4ED6\uFF09",words:{\u304F\u307F\u4E0A\u3052\u308B:"\u4ED6"}}],"stem:\u5207":[{title:"\u5207\u6389\u4E00\u90E8\u5206",words:{\u5207\u308A\u53D6\u308B:"\u4ED6",\u5207\u308A\u843D\u3068\u3059:"\u4ED6",\u5207\u308A\u6368\u3066\u308B:"\u4ED6"}},{title:"\u5207\u5F00\u3001\u5206\u5F00",words:{\u5207\u308B:"\u4ED6",\u5207\u308A\u96E2\u3059:"\u4ED6",\u5207\u308A\u958B\u304F:"\u4ED6"}},{title:"\u8F6C\u4E49\uFF1A\u6362\u3001\u5F00\u53E3",words:{\u5207\u308A\u66FF\u3048\u308B:"\u4ED6",\u5207\u308A\u51FA\u3059:"\u4ED6"}}],"stem:\u5206":[{title:"\u5206\u5F00\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u5206\u3051\u308B:"\u4ED6",\u5206\u304B\u308C\u308B:"\u81EA"}},{title:"\u5206\u7ED9\u522B\u4EBA",words:{\u5206\u3051\u4E0E\u3048\u308B:"\u4ED6"}}],"stem:\u901A":[{title:"\u901A\u8FC7\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u901A\u308B:"\u81EA",\u901A\u3059:"\u4ED6"}},{title:"\u3068\u304A\u308A\uFF0B\u540E\u9879\uFF1A\u8DEF\u8FC7",words:{\u901A\u308A\u304B\u304B\u308B:"\u81EA",\u901A\u308A\u904E\u304E\u308B:"\u81EA"}},{title:"\u8BFB \u3064\u3046\u3058\u308B\uFF1A\u76F8\u901A",words:{\u901A\u3058\u308B:"\u81EA\u4ED6"}}],"stem:\u62BC":[{title:"\u6309\u3001\u538B\u3001\u786C\u63A8\u5230\u5E95",words:{\u62BC\u3059:"\u4ED6",\u62BC\u3055\u3048\u308B:"\u4ED6",\u62BC\u3057\u5207\u308B:"\u4ED6"}},{title:"\u5F80\u91CC\u585E",words:{\u62BC\u3057\u8FBC\u3080:"\u4ED6",\u62BC\u3057\u8FBC\u3081\u308B:"\u4ED6"}},{title:"\u5F80\u5916\u3001\u5F80\u65C1\u8FB9\u63A8",words:{\u62BC\u3057\u51FA\u3059:"\u4ED6",\u62BC\u3057\u3084\u308B:"\u4ED6"}}],"stem:\u5438":[{title:"\u5438\u8FDB\u6765",words:{\u5438\u3046:"\u4ED6",\u5438\u3044\u8FBC\u3080:"\u4ED6"}},{title:"\u5438\u8D70\u3001\u5438\u4E0A\u6765",words:{\u5438\u3044\u53D6\u308B:"\u4ED6",\u5438\u3044\u4E0A\u3052\u308B:"\u4ED6"}}],"stem:\u80B2":[{title:"\u6210\u957F\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u80B2\u3064:"\u81EA",\u80B2\u3066\u308B:"\u4ED6"}},{title:"\u517B\u5F97\u66F4\u6DF1\u3001\u517B\u5230\u5E95",words:{\u80B2\u3080:"\u4ED6",\u80B2\u3066\u4E0A\u3052\u308B:"\u4ED6"}}],"stem:\u4E0B":[{title:"\u8BFB \u3055\u304C\uFF0F\u3055\u3052\uFF1A\u4F4D\u7F6E\u3001\u6570\u503C\u964D\u4F4E",words:{\u4E0B\u304C\u308B:"\u81EA",\u4E0B\u3052\u308B:"\u4ED6"}},{title:"\u8BFB \u304A\u308A\uFF0F\u304A\u308D\uFF1A\u4ECE\u4E0A\u9762\u4E0B\u6765\u3001\u653E\u4E0B",words:{\u4E0B\u308A\u308B:"\u81EA",\u4E0B\u308D\u3059:"\u4ED6"}},{title:"\u8BFB \u3057\u305F\u307E\u308F\u308B\uFF1A\u4F4E\u4E8E\u57FA\u51C6",words:{\u4E0B\u56DE\u308B:"\u4ED6"}}],"stem:\u904E":[{title:"\u65F6\u95F4\u3001\u5730\u70B9\u81EA\u5DF1\u8FC7\u53BB\uFF08\u81EA\uFF09",words:{\u904E\u304E\u308B:"\u81EA",\u904E\u304E\u53BB\u308B:"\u81EA"}},{title:"\u8BA9\u65F6\u95F4\u3001\u4E8B\u60C5\u8FC7\u53BB\uFF08\u4ED6\uFF09",words:{\u904E\u3054\u3059:"\u4ED6",\u3084\u308A\u904E\u3054\u3059:"\u4ED6"}}],"stem:\u5EFA":[{title:"\u5EFA\u9020\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u5EFA\u3064:"\u81EA",\u5EFA\u3066\u308B:"\u4ED6"}},{title:"\u91CD\u5EFA",words:{\u5EFA\u3066\u76F4\u3059:"\u4ED6"}}],"stem:\u4F3C":[{title:"\u50CF",words:{\u4F3C\u308B:"\u81EA",\u4F3C\u901A\u3046:"\u81EA"}},{title:"\u76F8\u914D",words:{\u4F3C\u5408\u3046:"\u81EA"}}],"stem:\u96C6":[{title:"\u4EBA\u805A\u5230\u4E00\u8D77\uFF08\u81EA\uFF09",words:{\u96C6\u307E\u308B:"\u81EA",\u96C6\u3046:"\u81EA"}},{title:"\u628A\u4E1C\u897F\u6536\u96C6\u8D77\u6765\uFF08\u4ED6\uFF09",words:{\u96C6\u3081\u308B:"\u4ED6",\u304B\u304D\u96C6\u3081\u308B:"\u4ED6"}}],"stem:\u5897":[{title:"\u6570\u91CF\u589E\u52A0\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u5897\u3048\u308B:"\u81EA",\u5897\u3084\u3059:"\u4ED6"}},{title:"\u8BFB \u307E\u3059\uFF1A\u4E66\u9762\u3001\u7A0B\u5EA6\u52A0\u6DF1",words:{\u5897\u3059:"\u81EA\u4ED6"}}],"stem:\u6253":[{title:"\u6572\u6253\uFF08\u91CD\u6253\u4E5F\u662F\u6253\uFF09",words:{\u6253\u3064:"\u4ED6",\u6253\u3061\u76F4\u3059:"\u4ED6"}},{title:"\u6253\u8FDB\u53BB\u3001\u5168\u5FC3\u6295\u5165",words:{\u6253\u3061\u8FBC\u3080:"\u4ED6"}}],"stem:\u6295":[{title:"\u6254\u51FA\u53BB\u3001\u6254\u6389\u3001\u653E\u5F03",words:{\u6295\u3052\u308B:"\u4ED6",\u6295\u3052\u6368\u3066\u308B:"\u4ED6",\u6295\u3052\u51FA\u3059:"\u4ED6"}},{title:"\u629B\u7ED9\u5BF9\u65B9\uFF0F\u6295\u8FDB\u53BB",words:{\u6295\u3052\u304B\u3051\u308B:"\u4ED6",\u6295\u3058\u308B:"\u4ED6"}}],"stem:\u9003":[{title:"\u81EA\u5DF1\u9003\uFF08\u81EA\uFF09",words:{\u9003\u3052\u308B:"\u81EA",\u9003\u308C\u308B:"\u81EA"}},{title:"\u8BA9\u5B83\u8DD1\u4E86\u3001\u9519\u8FC7\uFF08\u4ED6\uFF09",words:{\u9003\u304C\u3059:"\u4ED6",\u9003\u3059:"\u4ED6"}}],"stem:\u52D5":[{title:"\u52A8\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u52D5\u304F:"\u81EA",\u52D5\u304B\u3059:"\u4ED6"}},{title:"\u8BFB \u3069\u3046\u3058\u308B\uFF1A\u5185\u5FC3\u52A8\u6447",words:{\u52D5\u3058\u308B:"\u81EA"}}],"stem:\u843D":[{title:"\u6389\u4E0B\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u843D\u3061\u308B:"\u81EA",\u843D\u3068\u3059:"\u4ED6"}},{title:"\u9677\u8FDB\u53BB\u3001\u60C5\u7EEA\u4F4E\u843D",words:{\u843D\u3061\u8FBC\u3080:"\u81EA"}}],"stem:\u6D41":[{title:"\u8BFB \u306A\u304C\u308C\uFF1A\u4E1C\u897F\u81EA\u5DF1\u6D41\uFF08\u81EA\uFF09",words:{\u6D41\u308C\u308B:"\u81EA",\u6D41\u308C\u7740\u304F:"\u81EA",\u6D41\u308C\u8FBC\u3080:"\u81EA"}},{title:"\u8BFB \u306A\u304C\u3057\uFF1A\u4EBA\u628A\u6DB2\u4F53\u704C\u8FDB\u53BB\uFF08\u4ED6\uFF09",words:{\u6D41\u3057\u8FBC\u3080:"\u4ED6"}},{title:"\u8BFB \u306F\u3084\u308B\uFF1A\u6D41\u884C",words:{\u6D41\u884C\u308B:"\u81EA"}}],"stem:\u6620":[{title:"\u6620\u51FA\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u6620\u308B:"\u81EA",\u6620\u3059:"\u4ED6"}},{title:"\u6E05\u695A\u5730\u5448\u73B0\u51FA\u6765",words:{\u6620\u3057\u51FA\u3059:"\u4ED6"}}],"stem:\u89E6":[{title:"\u78B0\u5230\u3001\u63D0\u53CA",words:{\u89E6\u308B:"\u81EA",\u89E6\u308C\u308B:"\u81EA"}},{title:"\u5E26\u300C\u5408\u3046\u300D\uFF1A\u4E92\u76F8\u63A5\u89E6",words:{\u89E6\u308C\u5408\u3046:"\u81EA"}}],"stem:\u7D44":[{title:"\u62FC\u6210\u4E00\u4E2A\u6574\u4F53",words:{\u7D44\u3080:"\u81EA\u4ED6",\u7D44\u307F\u7ACB\u3066\u308B:"\u4ED6",\u7D44\u307F\u5408\u308F\u305B\u308B:"\u4ED6"}},{title:"\u653E\u8FDB\u5DF2\u6709\u7684\u6574\u4F53",words:{\u7D44\u307F\u8FBC\u3080:"\u4ED6",\u7D44\u307F\u5165\u308C\u308B:"\u4ED6"}}],"stem:\u54B2":[{title:"\u5F00\u82B1",words:{\u54B2\u304F:"\u81EA"}},{title:"\u5F00\u5F97\u591A\u3001\u5F00\u5F97\u76DB",words:{\u54B2\u304D\u4E71\u308C\u308B:"\u81EA",\u54B2\u304D\u8A87\u308B:"\u81EA"}}],"stem:\u5272":[{title:"\u7834\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u5272\u308B:"\u4ED6",\u5272\u308C\u308B:"\u81EA"}},{title:"\u5206\u914D",words:{\u5272\u308A\u5F53\u3066\u308B:"\u4ED6",\u5272\u308A\u632F\u308B:"\u4ED6"}},{title:"\u8F6C\u4E49\uFF1A\u6253\u6298\u3001\u60F3\u5F00",words:{\u5272\u308A\u5F15\u304F:"\u4ED6",\u5272\u308A\u5207\u308B:"\u4ED6"}}],"stem:\u690D":[{title:"\u79CD\u4E0B\u53BB",words:{\u690D\u3048\u308B:"\u4ED6",\u690D\u3048\u4ED8\u3051\u308B:"\u4ED6"}},{title:"\u79FB\u683D",words:{\u690D\u3048\u66FF\u3048\u308B:"\u4ED6"}}],"stem:\u6298":[{title:"\u6298\u65AD\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u6298\u308B:"\u4ED6",\u6298\u308C\u308B:"\u81EA"}},{title:"\u6298\u53E0\u8D77\u6765",words:{\u6298\u308A\u7573\u3080:"\u4ED6"}}],"stem:\u6355":[{title:"\u8BFB \u3064\u304B\u307E\uFF1A\u6293\u4F4F\uFF0F\u88AB\u6293\u4F4F",words:{\u6355\u307E\u3048\u308B:"\u4ED6",\u6355\u307E\u308B:"\u81EA"}},{title:"\u8BFB \u3068\u3089\uFF1A\u6355\u83B7\u3001\u628A\u63E1\uFF0F\u88AB\u675F\u7F1A",words:{\u6355\u3089\u3048\u308B:"\u4ED6",\u6355\u3089\u308F\u308C\u308B:"\u81EA"}}],"stem:\u51B7":[{title:"\u8BFB \u3072\u3048\uFF1A\u53D8\u51B7",words:{\u51B7\u3048\u308B:"\u81EA",\u51B7\u3048\u8FBC\u3080:"\u81EA"}},{title:"\u8BFB \u3055\u3081\uFF0F\u3055\u307E\uFF1A\u70ED\u7684\u53D8\u51C9",words:{\u51B7\u3081\u308B:"\u81EA",\u51B7\u307E\u3059:"\u4ED6"}}],"stem:\u6210":[{title:"\u306A\u308B \u7CFB\uFF1A\u53D8\u6210\u3001\u6210\u7ACB\uFF08\u81EA\uFF09",words:{\u306A\u308B:"\u81EA",\u6210\u308A\u7ACB\u3064:"\u81EA"}},{title:"\u4EBA\u628A\u4E8B\u505A\u6210\uFF08\u4ED6\uFF09",words:{\u6210\u3057\u9042\u3052\u308B:"\u4ED6"}}],"stem:\u6398":[{title:"\u6316",words:{\u6398\u308B:"\u4ED6"}},{title:"\u6316\u7684\u65B9\u5411\uFF1A\u5F80\u6DF1\uFF0F\u6316\u51FA\u6765",words:{\u6398\u308A\u4E0B\u3052\u308B:"\u4ED6",\u6398\u308A\u8D77\u3053\u3059:"\u4ED6"}}],"stem:\u4F38":[{title:"\u957F\u5EA6\u3001\u80FD\u529B\u589E\u957F",words:{\u4F38\u3073\u308B:"\u81EA",\u4F38\u3070\u3059:"\u4ED6",\u4F38\u3073\u60A9\u3080:"\u81EA"}},{title:"\u4F38\u51FA\u624B\uFF08\u4E66\u9762\uFF09",words:{\u4F38\u3079\u308B:"\u4ED6"}}],"stem:\u632F":[{title:"\u6325\u52A8\u3001\u53D1\u6325",words:{\u632F\u308B:"\u4ED6",\u632F\u308A\u56DE\u3059:"\u4ED6",\u632F\u308B\u3046:"\u4ED6"}},{title:"\u56DE\u5934",words:{\u632F\u308A\u5411\u304F:"\u81EA",\u632F\u308A\u8FD4\u308B:"\u81EA\u4ED6"}},{title:"\u4E3E\u6B62\u3001\u62DB\u5F85",words:{\u632F\u308B\u821E\u3046:"\u81EA\u4ED6"}}],"stem:\u7DE0":[{title:"\u6536\u7D27\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u7DE0\u307E\u308B:"\u81EA",\u7DE0\u3081\u308B:"\u4ED6"}},{title:"\u52D2\u7D27\u3001\u538B\u5236",words:{\u7DE0\u3081\u3064\u3051\u308B:"\u4ED6"}}],"stem:\u525D":[{title:"\u8BFB \u3080\u304F\uFF0F\u3080\u3051\u308B\uFF1A\u5265\u76AE",words:{\u3080\u304F:"\u4ED6",\u5265\u3051\u308B:"\u81EA"}},{title:"\u8BFB \u306F\u304C\uFF1A\u63ED\u4E0B\u8D34\u7740\u7684\u4E1C\u897F",words:{\u5265\u304C\u3059:"\u4ED6",\u5265\u304C\u308C\u308B:"\u81EA"}}],"stem:\u629C":[{title:"\u8BFB \u306C\u3051\uFF1A\u81EA\u5DF1\u8131\u843D\uFF08\u81EA\uFF09",words:{\u629C\u3051\u308B:"\u81EA",\u629C\u3051\u843D\u3061\u308B:"\u81EA"}},{title:"\u8BFB \u306C\u304D\uFF0F\u306C\u304F\uFF1A\u628A\u5B83\u62D4\u51FA\u6765\uFF08\u4ED6\uFF09",words:{\u629C\u304F:"\u4ED6",\u629C\u304D\u51FA\u3059:"\u4ED6"}},{title:"\u8BFB \u306C\u304D\u3093\u3067\u308B\uFF1A\u51FA\u4F17",words:{\u629C\u304D\u3093\u51FA\u308B:"\u81EA"}}],"stem:\u62B1":[{title:"\u8BFB \u3060\u304F\uFF1A\u62B1\u4F4F",words:{\u62B1\u304F:"\u4ED6"}},{title:"\u8BFB \u304B\u304B\u3048\uFF1A\u62B1\u7740\u3001\u63FD\u4E0B\u8D1F\u62C5",words:{\u62B1\u3048\u308B:"\u4ED6",\u62B1\u3048\u8FBC\u3080:"\u4ED6"}}],"stem:\u653E":[{title:"\u8BFB \u307B\u3046\uFF1A\u6254\u3001\u4E22\u5F00\u4E0D\u7BA1",words:{\u653E\u308B:"\u4ED6",\u653E\u308A\u51FA\u3059:"\u4ED6",\u653E\u3063\u3066\u304A\u304F:"\u4ED6"}},{title:"\u8BFB \u306F\u306A\u3059\uFF1A\u653E\u5F00\u3001\u653E\u8D70",words:{\u653E\u3059:"\u4ED6"}}],"stem:\u57CB":[{title:"\u586B\u6EE1\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u57CB\u307E\u308B:"\u81EA",\u57CB\u3081\u308B:"\u4ED6"}},{title:"\u57CB\u5F97\u66F4\u6DF1\uFF1A\u5D4C\u5165\uFF0F\u88AB\u57CB\u6CA1",words:{\u57CB\u3081\u8FBC\u3080:"\u4ED6",\u57CB\u3082\u308C\u308B:"\u81EA"}}],"stem:\u6DF7":[{title:"\u8BFB \u307E\u305C\uFF0F\u307E\u3056\uFF1A\u6DF7\u5408",words:{\u6DF7\u3056\u308B:"\u81EA",\u6DF7\u305C\u308B:"\u4ED6"}},{title:"\u8BFB \u307E\u3058\uFF1A\u6DF7\u8FDB\u53BB\u3001\u4EA4\u878D",words:{\u6DF7\u3058\u308B:"\u81EA",\u6DF7\u3058\u308A\u5408\u3046:"\u81EA"}}],"stem:\u6EB6":[{title:"\u6EB6\u5316\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u6EB6\u3051\u308B:"\u81EA",\u6EB6\u304B\u3059:"\u4ED6"}},{title:"\u878D\u8FDB\u53BB",words:{\u6EB6\u3051\u8FBC\u3080:"\u81EA"}}],"stem:\u8A70":[{title:"\u585E\u6EE1\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u8A70\u307E\u308B:"\u81EA",\u8A70\u3081\u308B:"\u4ED6"}},{title:"\u5927\u91CF\u585E\u8FDB\u53BB",words:{\u8A70\u3081\u8FBC\u3080:"\u4ED6"}}],"stem:\u6D6E":[{title:"\u8BFB \u3046\u304B\u3076 \u7CFB\uFF1A\u6D6E\u73B0",words:{\u6D6E\u304B\u3076:"\u81EA",\u6D6E\u304B\u3079\u308B:"\u4ED6",\u6D6E\u304B\u3073\u4E0A\u304C\u308B:"\u81EA"}},{title:"\u8BFB \u3046\u304F\uFF1A\u6D6E\u8D77\u3001\u8131\u79BB\u539F\u4F4D",words:{\u6D6E\u304F:"\u81EA"}}],"stem:\u63FA":[{title:"\u81EA\u5DF1\u6643\uFF08\u81EA\uFF09",words:{\u63FA\u308C\u308B:"\u81EA",\u63FA\u308C\u52D5\u304F:"\u81EA",\u63FA\u3089\u3050:"\u81EA"}},{title:"\u7528\u529B\u6447\u5B83\uFF08\u4ED6\uFF09",words:{\u63FA\u3055\u3076\u308B:"\u4ED6"}}],"stem:\u8DF3":[{title:"\u8BFB \u3068\u3076\uFF1A\u8DF3\u8D77\u3001\u8D8A\u8FC7",words:{\u8DF3\u3076:"\u81EA"}},{title:"\u8BFB \u306F\u306D\uFF1A\u5F39\u8D77",words:{\u8DF3\u306D\u308B:"\u81EA",\u8DF3\u306D\u4E0A\u304C\u308B:"\u81EA"}}],"stem:\u99C6":[{title:"\u8DD1\u3001\u8DD1\u8FC7\u3001\u5230\u5904\u8DD1",words:{\u99C6\u3051\u308B:"\u81EA",\u99C6\u3051\u629C\u3051\u308B:"\u81EA",\u99C6\u3051\u5DE1\u308B:"\u81EA"}},{title:"\u8DD1\u8FDB\u3001\u8DD1\u4E0A",words:{\u99C6\u3051\u8FBC\u3080:"\u81EA",\u99C6\u3051\u4E0A\u304C\u308B:"\u81EA"}},{title:"\u8DD1\u5230\u67D0\u5904\u3001\u67D0\u4EBA\u8EAB\u8FB9",words:{\u99C6\u3051\u3064\u3051\u308B:"\u81EA",\u99C6\u3051\u5BC4\u308B:"\u81EA"}}],"stem:\u6307":[{title:"\u6307",words:{\u6307\u3059:"\u4ED6",\u6307\u5DEE\u3059:"\u4ED6"}},{title:"\u660E\u786E\u6307\u51FA\u6765",words:{\u6307\u3057\u793A\u3059:"\u4ED6"}}],"stem:\u5BC4":[{title:"\u628A\u4E1C\u897F\u632A\u8FD1\uFF08\u4ED6\uFF09",words:{\u5BC4\u305B\u308B:"\u4ED6"}},{title:"\u81EA\u5DF1\u9760\u4E0A\u53BB\uFF08\u81EA\uFF09",words:{\u5BC4\u308A\u639B\u304B\u308B:"\u81EA",\u5BC4\u308A\u6DFB\u3046:"\u81EA"}}],"stem:\u8FD1":[{title:"\u9760\u8FD1\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u8FD1\u3065\u304F:"\u81EA",\u8FD1\u3065\u3051\u308B:"\u4ED6"}},{title:"\u4E3B\u52A8\u51D1\u8FD1",words:{\u8FD1\u5BC4\u308B:"\u81EA"}}],"stem:\u7E2E":[{title:"\u8DDD\u79BB\u3001\u65F6\u95F4\u7F29\u77ED\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u7E2E\u3081\u308B:"\u4ED6",\u7E2E\u307E\u308B:"\u81EA"}},{title:"\u4E1C\u897F\u672C\u8EAB\u7F29\u6C34\u3001\u754F\u7F29",words:{\u7E2E\u3080:"\u81EA"}}],"stem:\u7A4D":[{title:"\u5806\u8D77\u6765",words:{\u7A4D\u3080:"\u4ED6",\u7A4D\u3082\u308B:"\u81EA"}},{title:"\u5C42\u5C42\u7D2F\u79EF\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u7A4D\u307F\u91CD\u306D\u308B:"\u4ED6",\u7A4D\u307F\u91CD\u306A\u308B:"\u81EA"}},{title:"\u5B9A\u671F\u5B58\u94B1",words:{\u7A4D\u307F\u7ACB\u3066\u308B:"\u4ED6"}}],"stem:\u67D3":[{title:"\u8BFB \u305D\u3081\uFF0F\u305D\u307E\uFF1A\u67D3\u8272",words:{\u67D3\u3081\u308B:"\u4ED6",\u67D3\u307E\u308B:"\u81EA"}},{title:"\u8BFB \u3057\u307F\uFF1A\u6E17\u8FDB\u53BB\u3001\u7559\u4E0B",words:{\u67D3\u307F\u308B:"\u81EA",\u67D3\u307F\u8FBC\u3080:"\u81EA",\u67D3\u307F\u4ED8\u304F:"\u81EA"}}],"stem:\u554F":[{title:"\u95EE",words:{\u554F\u3046:"\u4ED6",\u554F\u3044\u304B\u3051\u308B:"\u4ED6"}},{title:"\u95EE\u6E05\u695A\uFF1A\u67E5\u8BE2\u3001\u8FFD\u95EE",words:{\u554F\u3044\u5408\u308F\u305B\u308B:"\u4ED6",\u554F\u3044\u8A70\u3081\u308B:"\u4ED6"}}],"stem:\u7A81":[{title:"\u8BFB \u3064\u3063\uFF1A\u731B\u51B2",words:{\u7A81\u3063\u8FBC\u3080:"\u81EA\u4ED6",\u7A81\u3063\u8D70\u308B:"\u81EA"}},{title:"\u8BFB \u3064\u304D\uFF1A\u523A",words:{\u7A81\u304D\u523A\u3059:"\u4ED6"}}],"stem:\u81A8":[{title:"\u8BFB \u3075\u304F\u3089\u3080\uFF0F\u3075\u304F\u3089\u307E\u3059\uFF1A\u9F13\u8D77\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u81A8\u3089\u3080:"\u81EA",\u81A8\u3089\u307E\u3059:"\u4ED6"}},{title:"\u8BFB \u3075\u304F\u308C\uFF1A\u9F13\u8D77\u6765\u3001\u80C0\u5927",words:{\u81A8\u308C\u308B:"\u81EA",\u81A8\u308C\u4E0A\u304C\u308B:"\u81EA"}}],"stem:\u5F37":[{title:"\u8BFB \u3064\u3088\uFF1A\u53D8\u5F3A\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u5F37\u307E\u308B:"\u81EA",\u5F37\u3081\u308B:"\u4ED6"}},{title:"\u8BFB \u3057\u3044\u308B\uFF1A\u5F3A\u8FEB",words:{\u5F37\u3044\u308B:"\u4ED6"}}],"stem:\u50B7":[{title:"\u8BFB \u304D\u305A\uFF1A\u53D7\u4F24\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u50B7\u3064\u304F:"\u81EA",\u50B7\u3064\u3051\u308B:"\u4ED6"}},{title:"\u8BFB \u3044\u305F\uFF1A\u635F\u574F\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u50B7\u3080:"\u81EA",\u50B7\u3081\u308B:"\u4ED6"}}],"stem:\u5148":[{title:"\u5728\u524D\u9762",words:{\u5148\u7ACB\u3064:"\u81EA",\u5148\u3093\u3058\u308B:"\u81EA"}},{title:"\u62A2\u5148\u5192\u8FDB",words:{\u5148\u8D70\u308B:"\u81EA"}}],"stem:\u5F31":[{title:"\u53D8\u5F31\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u5F31\u307E\u308B:"\u81EA",\u5F31\u3081\u308B:"\u4ED6"}},{title:"\u8EAB\u4F53\u8870\u5F31\u3001\u4E3A\u96BE",words:{\u5F31\u308B:"\u81EA"}}],"stem:\u7D61":[{title:"\u7F20\u4F4F",words:{\u7D61\u3080:"\u81EA",\u7D61\u307E\u308B:"\u81EA"}},{title:"\u5E26\u300C\u5408\u3046\u300D\uFF1A\u4E92\u76F8\u7F20",words:{\u7D61\u307F\u5408\u3046:"\u81EA"}}],"stem:\u7DF4":[{title:"\u63A8\u6572",words:{\u7DF4\u308B:"\u4ED6"}},{title:"\u7DF4\u308A\uFF0B\u540E\u9879\uFF1A\u7EC3\u597D\uFF0F\u91CD\u7EC3",words:{\u7DF4\u308A\u4E0A\u3052\u308B:"\u4ED6",\u7DF4\u308A\u76F4\u3059:"\u4ED6"}}],"stem:\u7E54":[{title:"\u7EC7\u51FA\u4E1C\u897F",words:{\u7E54\u308B:"\u4ED6",\u7E54\u308A\u6210\u3059:"\u4ED6"}},{title:"\u7EC7\u8FDB\u53BB\uFF1A\u7EB3\u5165",words:{\u7E54\u308A\u8FBC\u3080:"\u4ED6"}}],"stem:\u548C":[{title:"\u8BFB \u3084\u308F\u3089\uFF1A\u7F13\u548C\uFF08\u81EA\u4ED6\u5BF9\uFF09",words:{\u548C\u3089\u3050:"\u81EA",\u548C\u3089\u3052\u308B:"\u4ED6"}},{title:"\u8BFB \u306A\u3054\u3080\uFF1A\u5FC3\u60C5\u653E\u677E",words:{\u548C\u3080:"\u81EA"}}],"synonym:\u91CD\u8981\u7684":[{title:"\u53E3\u8BED\u3001\u5E26\u73CD\u60DC",words:{\u5927\u5207:"",\u5927\u4E8B:""}},{title:"\u4E66\u9762\u3001\u5BA2\u89C2\u8BF4\u660E",words:{\u91CD\u8981:"",\u809D\u8981:""}}],"synonym:\u6D88\u5931":[{title:"\u65E5\u5E38\uFF1A\u6CA1\u4E86\u3001\u706D\u4E86",words:{\u306A\u304F\u306A\u308B:"\u81EA",\u6D88\u3048\u308B:"\u81EA"}},{title:"\u5F7B\u5E95\u79BB\u53BB\uFF08\u4E66\u9762\uFF09",words:{\u6D88\u3048\u53BB\u308B:"\u81EA",\u5931\u305B\u308B:"\u81EA"}}],"synonym:\u5435\u95F9\u7684":[{title:"\u548C\u8BED\uFF1A\u70E6\u4EBA\uFF0C\u4E5F\u80FD\u8BF4\u4EBA",words:{\u3046\u308B\u3055\u3044:"",\u3084\u304B\u307E\u3057\u3044:""}},{title:"\u9A12 \u5B57\uFF1A\u73B0\u573A\u5608\u6742",words:{\u9A12\u3005\u3057\u3044:"",\u9A12\u304C\u3057\u3044:""}}],"synonym:\u56E0\u6B64":[{title:"\u53E3\u8BED\uFF1A\u76F4\u63A5\u4E0B\u7ED3\u8BBA",words:{\u3060\u304B\u3089:"",\u3067\u3059\u304B\u3089:""}},{title:"\u627F\u63A5\u4E0B\u6587\uFF1A\u7ED3\u679C\uFF0F\u63A5\u7740\u505A",words:{\u305D\u308C\u3067:"",\u305D\u3053\u3067:""}},{title:"\u4E66\u9762\uFF1A\u8BF4\u660E\u56E0\u679C",words:{\u305D\u306E\u305F\u3081:"",\u3057\u305F\u304C\u3063\u3066:""}}],"synonym:\u66F4\u52A0":[{title:"\u53E3\u8BED\u3001\u6BD4\u8F83",words:{\u3082\u3063\u3068:"",\u3088\u308A:""}},{title:"\u66F4\u8FDB\u4E00\u5C42\uFF08\u4E66\u9762\uFF0F\u9012\u8FDB\uFF09",words:{\u4E00\u5C64:"",\u306A\u304A\u3055\u3089:""}}],"synonym:\u573A\u6240":[{title:"\u6CDB\u6307\u5730\u65B9",words:{\u6240:"",\u5834\u6240:""}},{title:"\u7279\u5B9A\u7684\uFF1A\u573A\u5408\u3001\u666F\u70B9",words:{\u5834:"",\u30B9\u30DD\u30C3\u30C8:""}}],"synonym:\u524D\u9762":[{title:"\u548C\u8BED\uFF1A\u4E5F\u80FD\u6307\u65F6\u95F4",words:{\u524D:"",\u5148:""}},{title:"\u6C49\u8BED\uFF1A\u53EA\u6307\u7A7A\u95F4\u65B9\u5411",words:{\u524D\u65B9:"",\u524D\u9762:""}}],"synonym:\u8863\u670D":[{title:"\u65E5\u5E38\uFF0F\u6B63\u5F0F\u8BF4\u8863\u670D",words:{\u670D:"",\u8863\u670D:""}},{title:"\u5206\u7C7B\u7528\u8BED\u3001\u4E66\u9762",words:{\u8863\u985E:"",\u8863:""}}],"synonym:\u7EC8\u4E8E":[{title:"\u7B49\u4E86\u5F88\u4E45\uFF0C\u7ED3\u679C\u6765\u4E86",words:{\u3084\u3063\u3068:"",\u3068\u3046\u3068\u3046:"",\u3064\u3044\u306B:""}},{title:"\u5173\u5934\u4E34\u8FD1",words:{\u3044\u3088\u3044\u3088:""}}],"synonym:\u4E0D\u64C5\u957F\u7684":[{title:"\u53E3\u8BED\u5E38\u7528",words:{\u4E0B\u624B:"",\u82E6\u624B:""}},{title:"\u4E0D \u5B57\u5934\uFF1A\u4E66\u9762",words:{\u4E0D\u5F97\u624B:"",\u4E0D\u5F97\u610F:""}}],"synonym:\u89D2\u843D":[{title:"\u62D0\u89D2\u3001\u4E13\u533A",words:{\u89D2:"",\u30B3\u30FC\u30CA\u30FC:""}},{title:"\u8FB9\u89D2\u3001\u504F\u50FB\u5904",words:{\u9685:"",\u7247\u9685:""}}],"synonym:\u505A\u6CD5":[{title:"\u505A\u4E8B\u7684\u65B9\u6CD5",words:{\u3084\u308A\u65B9:"",\u4ED5\u65B9:""}},{title:"\u505A\u6210\u7684\u6837\u5B50\u3001\u89C4\u683C",words:{\u4F5C\u308A:"",\u4ED5\u69D8:""}}],"synonym:\u5DEE\u5F02":[{title:"\u65E5\u5E38\uFF1A\u4E0D\u540C\u3001\u5DEE\u8DDD",words:{\u9055\u3044:"",\u5DEE:""}},{title:"\u4E66\u9762\u8BBA\u8FF0",words:{\u76F8\u9055:"",\u5DEE\u7570:""}}],"synonym:\u9519\u8BEF":[{title:"\u65E5\u5E38\u3001\u5DE5\u4F5C\u4E0A\u7684\u5931\u8BEF",words:{\u9593\u9055\u3044:"",\u30DF\u30B9:""}},{title:"\u6B63\u5F0F\uFF1A\u5185\u5BB9\u6216\u8BA4\u8BC6\u9519\u4E86",words:{\u8AA4\u308A:"",\u932F\u8AA4:"",\u8AA4\u8B2C:""}},{title:"\u5E26\u8D23\u4EFB\u7684\u8FC7\u5931",words:{\u904E\u3061:""}}],"synonym:\u5173\u7CFB":[{title:"\u4E8B\u7269\u3001\u4EBA\u4E4B\u95F4\u7684\u5173\u8054",words:{\u95A2\u4FC2:"",\u95A2\u308F\u308A:""}},{title:"\u4EBA\u548C\u4EBA\u4E4B\u95F4\u7684\u4EA4\u60C5\u3001\u8EAB\u4EFD",words:{\u4EF2:"",\u9593\u67C4:""}}],"synonym:\u60F3\u8D77":[{title:"\u60F3\u8D77\u8FC7\u53BB\u7684\u4E8B",words:{\u601D\u3044\u51FA\u3059:"\u4ED6",\u601D\u3044\u8D77\u3053\u3059:"\u4ED6"}},{title:"\u8111\u4E2D\u6D6E\u73B0\u753B\u9762",words:{\u601D\u3044\u6D6E\u304B\u3076:"\u81EA",\u601D\u3044\u6D6E\u304B\u3079\u308B:"\u4ED6"}},{title:"\u60F3\u5230\u7EBF\u7D22",words:{\u601D\u3044\u5F53\u305F\u308B:"\u81EA"}}],"synonym:\u6BD4\u8D5B":[{title:"\u5BF9\u6297\u3001\u6BD4\u8D5B\u4E2D\u7684\u8868\u73B0",words:{\u8A66\u5408:"",\u30D7\u30EC\u30FC:""}},{title:"\u6309\u901F\u5EA6\u6216\u8BC4\u6BD4\u5B9A\u540D\u6B21",words:{\u30EC\u30FC\u30B9:"",\u30B3\u30F3\u30AF\u30FC\u30EB:""}}],"synonym:\u4E8B\u60C5":[{title:"\u6CDB\u6307\u4E8B\u60C5\u3001\u4E8B\u9879",words:{\u3053\u3068:"",\u4E8B\u67C4:""}},{title:"\u8981\u53BB\u529E\u7684\u4E8B",words:{\u7528\u4E8B:"",\u7528\u4EF6:""}}],"synonym:\u60C5\u51B5":[{title:"\u5047\u8BBE\u3001\u4E2A\u6848",words:{\u5834\u5408:"",\u30B1\u30FC\u30B9:""}},{title:"\u80CC\u666F\u7F18\u7531\u3001\u5BA2\u89C2\u72B6\u6001",words:{\u4E8B\u60C5:"",\u72B6\u6CC1:""}}],"synonym:\u7279\u522B":[{title:"\u5728\u80AF\u5B9A\u53E5\u91CC\u70B9\u51FA\u4E00\u9879",words:{\u7279\u306B:"",\u3068\u308A\u308F\u3051:""}},{title:"\u5426\u5B9A\u53E5\u3001\u523B\u610F\u5F3A\u8C03",words:{\u53D6\u308A\u7ACB\u3066\u3066:"",\u3053\u3068\u3055\u3089:""}}],"synonym:\u5546\u54C1":[{title:"\u4E00\u822C\u8BF4\u6CD5",words:{\u54C1\u7269:"",\u5546\u54C1:""}},{title:"\u7279\u6307\uFF1A\u5356\u54C1\u3001\u5468\u8FB9",words:{\u58F2\u308A\u7269:"",\u30B0\u30C3\u30BA:""}}],"synonym:\u8FD4\u56DE":[{title:"\u65E5\u5E38\uFF1A\u56DE\u6765\u3001\u8FD8\u56DE\u6765",words:{\u623B\u308B:"\u81EA",\u8FD4\u308B:"\u81EA",\u5F15\u304D\u8FD4\u3059:"\u81EA"}},{title:"\u7ACB\u3061\u301C\uFF1A\u56DE\u5230\u539F\u70B9\uFF08\u4E66\u9762\uFF09",words:{\u7ACB\u3061\u8FD4\u308B:"\u81EA",\u7ACB\u3061\u623B\u308B:"\u81EA"}}],"synonym:\u6545\u4E61":[{title:"\u6545\u4E61\u672C\u8EAB",words:{\u3075\u308B\u3055\u3068:"",\u6545\u90F7:""}},{title:"\u5730\u65B9\u7279\u8272\u3001\u51FA\u8EAB\u5730",words:{\u90F7\u571F:"",\u90F7\u91CC:""}}],"synonym:\u62FC\u547D\u7684":[{title:"\u52AA\u529B",words:{\u4E00\u751F\u61F8\u547D:"",\u61F8\u547D:""}},{title:"\u5E26\u5371\u673A\u611F\uFF1A\u6025\u3001\u9669",words:{\u5FC5\u6B7B:"",\u8E8D\u8D77:"",\u547D\u304C\u3051:""}}],"synonym:\u7A81\u7136":[{title:"\u4E8B\u60C5\u7A81\u7136\u53D1\u751F",words:{\u6025\u306B:"",\u7A81\u7136:""}},{title:"\u6BEB\u65E0\u9884\u544A\u3001\u4E00\u4E0B\u5B50\u7684\u52A8\u4F5C",words:{\u3044\u304D\u306A\u308A:"",\u3070\u3063\u3068:""}}],"synonym:\u8D85\u8FC7":[{title:"\u8D8A\u8FC7\u754C\u9650\u3001\u6570\u503C",words:{\u8D85\u3048\u308B:"\u4ED6",\u8D85\u3059:"\u4ED6",\u4E0A\u56DE\u308B:"\u4ED6"}},{title:"\u79FB\u52A8\u4E2D\u8FFD\u8FC7\u53BB",words:{\u8FFD\u3044\u8D8A\u3059:"\u4ED6"}}],"synonym:\u773C\u524D":[{title:"\u7A7A\u95F4\uFF1A\u5C31\u5728\u9762\u524D",words:{\u76EE\u306E\u524D:""}},{title:"\u65F6\u95F4\uFF1A\u9A6C\u4E0A\u8981\u53D1\u751F",words:{\u76EE\u524D:"",\u5BF8\u524D:""}},{title:"\u773C\u524D\u5229\u76CA",words:{\u76EE\u5148:""}}],"synonym:\u4E3E\u8D77":[{title:"\u4E3E\uFF1A\u81EA\u4ED6\u5BF9",words:{\u6319\u3052\u308B:"\u4ED6",\u6319\u304C\u308B:"\u81EA"}},{title:"\u62AC\u8D77\u3001\u9AD8\u4E3E",words:{\u6301\u3061\u4E0A\u3052\u308B:"\u4ED6",\u63B2\u3052\u308B:"\u4ED6"}}],"synonym:\u7ACB\u523B":[{title:"\u3059\u3050 \u7CFB\uFF1A\u9A6C\u4E0A\u505A",words:{\u3059\u3050:"",\u3059\u3050\u306B:""}},{title:"\u8F6C\u773C\u95F4\uFF0F\u6293\u4F4F\u65F6\u673A",words:{\u305F\u3061\u307E\u3061:"",\u3059\u304B\u3055\u305A:""}}],"synonym:\u56FE\u8868":[{title:"\u56FE",words:{\u30B0\u30E9\u30D5:"",\u56F3:""}},{title:"\u6C49\u8BED\uFF1A\u6B63\u5F0F\u7EDF\u79F0\u3001\u793A\u610F\u56FE",words:{\u56F3\u8868:"",\u56F3\u5F0F:""}}],"synonym:\u8DEF\u7EBF":[{title:"\u5916\u6765\u8BED",words:{\u30B3\u30FC\u30B9:"",\u30EB\u30FC\u30C8:""}},{title:"\u548C\u8BED \u9053\u301C\uFF1A\u8D70\u6CD5\u3001\u8109\u7EDC",words:{\u9053\u9806:"",\u9053\u7B4B:""}}],"synonym:\u4E3B\u9898":[{title:"\u4F5C\u54C1\u3001\u7814\u7A76\u7684\u6838\u5FC3",words:{\u30C6\u30FC\u30DE:"",\u4E3B\u984C:"",\u30E2\u30C1\u30FC\u30D5:""}},{title:"\u90AE\u4EF6\u3001\u6587\u4EF6\u7684\u6807\u9898",words:{\u4EF6\u540D:""}}],"synonym:\u89E3\u5F00":[{title:"\u8BFB \u3068\u304F\uFF0F\u3068\u3051\u308B\uFF1A\u89E3\u5F00\u3001\u89E3\u9898",words:{\u89E3\u304F:"\u4ED6",\u89E3\u3051\u308B:"\u81EA"}},{title:"\u8BFB \u307B\u3069\uFF0F\u307B\u3050\uFF1A\u677E\u5F00\u3001\u653E\u677E",words:{\u307B\u3069\u3051\u308B:"\u81EA",\u307B\u3050\u3059:"\u4ED6",\u307B\u3050\u308C\u308B:"\u81EA"}}],"synonym:\u6BD4\u4F8B":[{title:"\u5360\u6BD4",words:{\u5272\u5408:"",\u6BD4\u4F8B:""}},{title:"\u4EFD\u989D\u3001\u6C47\u7387",words:{\u5272\u308A:"",\u30EC\u30FC\u30C8:""}}],"synonym:\u987A\u5E8F":[{title:"\u5148\u540E\u6B21\u5E8F",words:{\u9806\u756A:"",\u9806:"",\u9806\u5E8F:""}},{title:"\u6392\u597D\u7684\u9635\u5BB9\u3001\u7B49\u7EA7",words:{\u30AA\u30FC\u30C0\u30FC:"",\u5E8F\u5217:""}}],"synonym:\u76EE\u6807":[{title:"\u8981\u8FBE\u6210\u7684\u6307\u6807\u3001\u5BF9\u8C61",words:{\u76EE\u6A19:"",\u30BF\u30FC\u30B2\u30C3\u30C8:""}},{title:"\u80CC\u540E\u7684\u610F\u56FE\u3001\u76EE\u7684",words:{\u72D9\u3044:"",\u76EE\u5F53\u3066:""}},{title:"\u9884\u8BA1\u3001\u5934\u7EEA",words:{\u3081\u3069:""}}],"synonym:\u9053\u7406":[{title:"\u7F18\u6545\u3001\u7406\u7531",words:{\u8A33:"",\u7406\u5C48:""}},{title:"\u903B\u8F91\u3001\u60C5\u7406",words:{\u8AD6\u7406:"",\u9053\u7406:""}}],"synonym:\u4EFB\u6027\u7684":[{title:"\u53EA\u987E\u81EA\u5DF1",words:{\u308F\u304C\u307E\u307E:"",\u8EAB\u52DD\u624B:"",\u52DD\u624B:""}},{title:"\u968F\u5FC3\u3001\u591A\u53D8",words:{\u6C17\u307E\u307E:"",\u6C17\u307E\u3050\u308C:""}}],"synonym:\u5DE8\u5927\u7684":[{title:"\u89C4\u6A21\u3001\u6570\u91CF\u5927",words:{\u5DE8\u5927:"",\u83AB\u5927:""}},{title:"\u5F71\u54CD\u3001\u7A0B\u5EA6\u5927\uFF08\u4E66\u9762\uFF09",words:{\u591A\u5927:"",\u751A\u5927:""}}],"synonym:\u987A\u5229\u7684":[{title:"\u8FDB\u5C55\u3001\u72B6\u6001\u597D",words:{\u9806\u8ABF:"",\u597D\u8ABF:""}},{title:"\u6D41\u7545\u65E0\u963B",words:{\u30B9\u30E0\u30FC\u30BA:"",\u5186\u6ED1:""}}],"synonym:\u660E\u663E\u7684":[{title:"\u6E05\u695A\u53EF\u89C1",words:{\u660E\u3089\u304B:"",\u660E\u767D:"",\u6B74\u7136:""}},{title:"\u9732\u9AA8\u3001\u4E0D\u906E\u63A9",words:{\u3042\u304B\u3089\u3055\u307E:""}}],"synonym:\u4F38\u51FA":[{title:"\u5DEE\u3057\u301C\uFF1A\u9012\u7ED9\u5BF9\u65B9",words:{\u5DEE\u3057\u4F38\u3079\u308B:"\u4ED6",\u5DEE\u3057\u51FA\u3059:"\u4ED6"}},{title:"\u5F80\u524D\u4F38",words:{\u7A81\u304D\u51FA\u3059:"\u4ED6",\u4F38\u3079\u308B:"\u4ED6"}}],"synonym:\u5916\u89C2":[{title:"\u5916 \u5B57\u5934\uFF1A\u5916\u90E8\u6837\u5B50",words:{\u5916\u898B:"",\u5916\u89B3:""}},{title:"\u898B \u5B57\u5934\uFF1A\u770B\u8D77\u6765\u3001\u5356\u76F8",words:{\u898B\u304B\u3051:"",\u898B\u6804\u3048:""}}],"reading-sense:\u5206":[{title:"\u65F6\u95F4\uFF1A\u5206\u949F",words:{\u3075\u3093:""}},{title:"\u4EFD\u989D",words:{\u3076\u3093:"",\u3076:""}}],"reading-sense:\u9593":[{title:"\u65F6\u95F4\uFF1A\u671F\u95F4",words:{\u304B\u3093:""}},{title:"\u95F4\u9694\uFF1A\u4E24\u8005\u4E4B\u95F4",words:{\u3042\u3044\u3060:""}},{title:"\u7A7A\u9699",words:{\u307E:""}}],"reading-sense:\u89D2":[{title:"\u4F4D\u7F6E\uFF1A\u62D0\u89D2",words:{\u304B\u3069:""}},{title:"\u51E0\u4F55\uFF1A\u89D2\u5EA6",words:{\u304B\u304F:""}},{title:"\u52A8\u7269\u7684\u89D2",words:{\u3064\u306E:""}}],"synonym:\u8B66\u5BDF":[{title:"\u673A\u6784",words:{\u8B66\u5BDF:""}},{title:"\u6267\u6CD5\u4EBA\u5458",words:{\u8B66\u5BDF\u5B98:"",\u8B66\u5B98:""}}],"synonym:\u539F\u56E0":[{title:"\u6C49\u8BED\uFF1A\u539F\u56E0\u3001\u7F18\u7531",words:{\u539F\u56E0:"",\u6240\u4EE5:""}},{title:"\u4E5F\u80FD\u8868\u793A\u76EE\u7684",words:{\u305F\u3081:""}}],"synonym:\u9057\u61BE\u7684":[{title:"\u4E2A\u4EBA\u611F\u53D7\uFF1A\u53EF\u60DC\u3001\u6094\u6068",words:{\u6B8B\u5FF5:"",\u7121\u5FF5:""}},{title:"\u6B63\u5F0F\u8BC4\u4EF7",words:{\u907A\u61BE:""}}],"synonym:\u65F6\u95F4":[{title:"\u9636\u6BB5\u3001\u65F6\u671F",words:{\u6642\u671F:""}},{title:"\u65F6\u957F\u3001\u65F6\u523B",words:{\u6642\u9593:""}},{title:"\u6BD4\u8D5B\u8BA1\u65F6",words:{\u30BF\u30A4\u30E0:""}}],"synonym:\u4F4F\u6240":[{title:"\u767B\u8BB0\u7684\u5730\u5740",words:{\u4F4F\u6240:""}},{title:"\u5C45\u4F4F\u7684\u623F\u5C4B",words:{\u4F4F\u307E\u3044:"",\u4F4F\u5C45:""}}],"synonym:\u6765":[{title:"\u671D\u8BF4\u8BDD\u4EBA\u65B9\u5411\u6765",words:{\u6765\u308B:"\u81EA"}},{title:"\u5C0A\u656C\u8BED\uFF1A\u6765\u3001\u53BB\u3001\u5728",words:{\u3044\u3089\u3063\u3057\u3083\u308B:"\u81EA",\u304A\u3044\u3067\u306B\u306A\u308B:"\u81EA"}}],"synonym:\u505A":[{title:"\u4E2D\u6027\u8BF4\u6CD5",words:{\u3059\u308B:"\u81EA\u4ED6"}},{title:"\u53E3\u8BED",words:{\u3084\u308B:"\u4ED6"}},{title:"\u8C26\u8BA9\u8BED",words:{\u3044\u305F\u3059:"\u4ED6"}}],"synonym:\u533B\u751F":[{title:"\u65E5\u5E38\u79F0\u547C",words:{\u533B\u8005:""}},{title:"\u6B63\u5F0F\u804C\u4E1A\u540D\u79F0",words:{\u533B\u5E2B:""}},{title:"\u5916\u6765\u8BED\uFF1A\u4E5F\u6307\u535A\u58EB",words:{\u30C9\u30AF\u30BF\u30FC:""}}],"synonym:\u5B66\u751F":[{title:"\u5728\u6821\u5B66\u4E60\u8005",words:{\u5B66\u751F:"",\u751F\u5F92:""}},{title:"\u6559\u5E08\u6240\u6559\u7684\u4EBA",words:{\u6559\u3048\u5B50:""}}],"synonym:\u4E08\u592B":[{title:"\u4E2D\u6027\u914D\u5076\u79F0\u547C",words:{\u592B:""}},{title:"\u4E5F\u6307\u4E3B\u4EBA",words:{\u4E3B\u4EBA:"",\u4EAD\u4E3B:""}}],"synonym:\u59BB\u5B50":[{title:"\u4E2D\u6027\u914D\u5076\u79F0\u547C",words:{\u59BB:""}},{title:"\u4F20\u7EDF\u5BB6\u5EAD\u79F0\u547C",words:{\u5BB6\u5185:"",\u5973\u623F:""}}],"synonym:\u5305":[{title:"\u643A\u5E26\u7528\u5305",words:{\u304B\u3070\u3093:"",\u30D0\u30C3\u30B0:""}},{title:"\u67D4\u8F6F\u888B\u5B50",words:{\u888B:""}}],"synonym:\u7968":[{title:"\u4E58\u8F66\u3001\u5165\u573A\u51ED\u8BC1",words:{\u30C1\u30B1\u30C3\u30C8:"",\u5207\u7B26:""}},{title:"\u9009\u7968\u3001\u7968\u6570",words:{\u7968:""}}],"synonym:\u8BF7":[{title:"\u793C\u8C8C\u9080\u8BF7",words:{\u3069\u3046\u305E:""}},{title:"\u90D1\u91CD\u6073\u8BF7",words:{\u3069\u3046\u304B:"",\u4F55\u3068\u305E:""}}],"synonym:\u5DF2\u7ECF":[{title:"\u4E00\u822C\u8BF4\u660E\u5DF2\u7ECF\u53D1\u751F",words:{\u3082\u3046:"",\u3059\u3067\u306B:""}},{title:"\u591A\u63A5\u5426\u5B9A\uFF1A\u5982\u4ECA\u4E0D\u518D",words:{\u3082\u306F\u3084:""}}],"synonym:\u996E\u6599":[{title:"\u65E5\u5E38\u7EDF\u79F0",words:{\u98F2\u307F\u7269:""}},{title:"\u5916\u6765\u8BED\uFF1A\u83DC\u5355\u3001\u5546\u54C1",words:{\u30C9\u30EA\u30F3\u30AF:""}},{title:"\u6B63\u5F0F\u5206\u7C7B",words:{\u98F2\u6599:""}}],"synonym:\u8F66\u7AD9":[{title:"\u94C1\u8DEF\u3001\u5730\u94C1\u7AD9",words:{\u99C5:""}},{title:"\u5916\u6765\u8BED\uFF1A\u670D\u52A1\u7AD9\u70B9",words:{\u30B9\u30C6\u30FC\u30B7\u30E7\u30F3:""}},{title:"\u516C\u4EA4\u505C\u9760\u5904",words:{\u505C\u7559\u6240:""}}],"synonym:\u5404\u4F4D":[{title:"\u65E5\u5E38\u79F0\u547C\u542C\u4F17",words:{\u7686\u3055\u3093:""}},{title:"\u793C\u8C8C\u5730\u6307\u4E00\u7FA4\u4EBA",words:{\u65B9\u3005:""}},{title:"\u4E66\u9762\u79F0\u547C\u6536\u4FE1\u4EBA",words:{\u5404\u4F4D:""}}],"synonym:\u5BF9\u9762":[{title:"\u5411\u3053\u3046\uFF1A\u90A3\u4E00\u8FB9",words:{\u5411\u3053\u3046:"",\u5411\u3053\u3046\u5074:""}},{title:"\u6B63\u76F8\u5BF9\u7684\u4F4D\u7F6E",words:{\u5411\u304B\u3044:""}}],"synonym:\u64C5\u957F\u7684":[{title:"\u6280\u80FD\u719F\u7EC3\u7684\u8BC4\u4EF7",words:{\u4E0A\u624B:""}},{title:"\u5F97 \u5B57\u5934\uFF1A\u5F3A\u9879",words:{\u5F97\u610F:"",\u5F97\u624B:""}}],"synonym:\u4EBA":[{title:"\u65E5\u5E38\u6307\u4E2A\u4EBA",words:{\u4EBA:""}},{title:"\u4EBA\u7C7B\u3001\u672C\u6027",words:{\u4EBA\u9593:""}},{title:"\u63A5\u5728\u8EAB\u4EFD\u7C7B\u522B\u540E",words:{\u8005:""}}],"synonym:\u8EAB\u4F53":[{title:"\u548C\u8BED\uFF1A\u65E5\u5E38\u8868\u8FBE",words:{\u4F53:"",\u8EAB:""}},{title:"\u6C49\u8BED\uFF1A\u6B63\u5F0F\u4EBA\u4F53\u6982\u5FF5",words:{\u8EAB\u4F53:""}}],"synonym:\u5929\u6C14":[{title:"\u65E5\u5E38\u5929\u6C14",words:{\u5929\u6C17:""}},{title:"\u5BA2\u89C2\u8BB0\u5F55\u5929\u6C14",words:{\u5929\u5019:""}},{title:"\u9002\u5408\u67D0\u6D3B\u52A8\u7684\u5929\u6C14",words:{\u65E5\u548C:""}}],"synonym:\u665A\u996D":[{title:"\u5BB6\u5EAD\u65E5\u5E38\u79F0\u547C",words:{\u6669\u3054\u98EF:"",\u5915\u98EF:""}},{title:"\u6B63\u5F0F\u9910\u6B21\u540D\u79F0",words:{\u5915\u98DF:""}}],"synonym:\u611F\u89C9":[{title:"\u4E3B\u89C2\u5370\u8C61",words:{\u611F\u3058:""}},{title:"\u611F\u5B98\u80FD\u529B",words:{\u611F\u899A:""}},{title:"\u63A5\u8BCD\u540E\u8868\u793A\u503E\u5411",words:{\u6C17\u5473:""}}],"synonym:\u5F04\u9519":[{title:"\u9593\u9055\u301C\uFF1A\u65E5\u5E38\u8BF4\u505A\u9519",words:{\u9593\u9055\u3048\u308B:"\u4ED6",\u9593\u9055\u3046:"\u81EA\u4ED6"}},{title:"\u4E66\u9762\u8BF4\u5224\u65AD\u5931\u8BEF",words:{\u8AA4\u308B:"\u81EA\u4ED6"}}],"synonym:\u60F3\u6CD5":[{title:"\u8003\u3048\u301C\uFF1A\u610F\u89C1\u3001\u601D\u8003",words:{\u8003\u3048:"",\u8003\u3048\u65B9:""}},{title:"\u5916\u6765\u8BED\uFF1A\u5177\u4F53\u521B\u610F",words:{\u30A2\u30A4\u30C7\u30A2:""}}],"synonym:\u8BA4\u771F\u7684":[{title:"\u6027\u683C\u8E0F\u5B9E",words:{\u771F\u9762\u76EE:""}},{title:"\u9762\u5BF9\u4E8B\u60C5\u7684\u6001\u5EA6",words:{\u771F\u5263:"",\u672C\u6C17:""}}],"synonym:\u5EA7\u4F4D":[{title:"\u4E5F\u6307\u5E2D\u4F4D\u3001\u540D\u989D",words:{\u5E2D:""}},{title:"\u4F9B\u4EBA\u5750\u7684\u4F4D\u7F6E\u3001\u5EA7\u6905",words:{\u5EA7\u5E2D:"",\u30B7\u30FC\u30C8:""}}],"synonym:\u5185\u5BB9":[{title:"\u6587\u7AE0\u3001\u8282\u76EE\u4FE1\u606F",words:{\u5185\u5BB9:""}},{title:"\u5BB9\u5668\u91CC\u7684\u4E1C\u897F",words:{\u4E2D\u8EAB:""}},{title:"\u6570\u5B57\u5A92\u4F53\u4F5C\u54C1",words:{\u30B3\u30F3\u30C6\u30F3\u30C4:""}}],"synonym:\u8EAB\u9AD8":[{title:"\u80CC \u5B57\u5934\uFF1A\u65E5\u5E38\u8EAB\u9AD8",words:{\u80CC:"",\u80CC\u4E08:""}},{title:"\u6B63\u5F0F\u6D4B\u91CF\u3001\u767B\u8BB0",words:{\u8EAB\u9577:""}}],"synonym:\u800C\u4E14":[{title:"\u8865\u5145\u3001\u9012\u52A0\u4FE1\u606F",words:{\u305D\u308C\u306B:"",\u305D\u306E\u3046\u3048:""}},{title:"\u5F3A\u8C03\u8D85\u51FA\u9884\u671F",words:{\u3057\u304B\u3082:""}}],"synonym:\u6280\u672F":[{title:"\u6280\u672F\u4F53\u7CFB\u3001\u5DE5\u827A",words:{\u6280\u8853:""}},{title:"\u5177\u4F53\u6280\u5DE7\u3001\u624B\u6CD5",words:{\u30C6\u30AF\u30CB\u30C3\u30AF:"",\u6280\u6CD5:""}}],"synonym:\u76F8\u53CD\u7684":[{title:"\u65B9\u5411\u3001\u7ACB\u573A\u76F8\u53CD",words:{\u9006:"",\u53CD\u5BFE:""}},{title:"\u8868\u91CC\u4E0D\u4E00\u81F4",words:{\u88CF\u8179:""}}],"synonym:\u7D27\u6025\u7684":[{title:"\u4E5F\u5F62\u5BB9\u7A81\u7136\u3001\u9661\u5CED",words:{\u6025:""}},{title:"\u5C3D\u5FEB\u5904\u7406",words:{\u65E9\u6025:""}},{title:"\u6B63\u5F0F\u5371\u6025\u72B6\u6001",words:{\u7DCA\u6025:""}}],"synonym:\u627E\u5230":[{title:"\u4E1C\u897F\u4F5C\u4E3B\u8BED\uFF08\u81EA\uFF09",words:{\u898B\u3064\u304B\u308B:"\u81EA",\u898B\u5F53\u305F\u308B:"\u81EA"}},{title:"\u5BFB\u627E\u8005\u4F5C\u4E3B\u8BED\uFF08\u4ED6\uFF09",words:{\u898B\u3064\u3051\u308B:"\u4ED6"}}],"synonym:\u7559\u4E0B":[{title:"\u5269\u4E0B\u7684\u4EBA\u7269\u4F5C\u4E3B\u8BED\uFF08\u81EA\uFF09",words:{\u6B8B\u308B:"\u81EA"}},{title:"\u628A\u5BF9\u8C61\u7559\u4E0B\uFF08\u4ED6\uFF09",words:{\u6B8B\u3059:"\u4ED6",\u53D6\u308A\u6B8B\u3059:"\u4ED6"}}],"synonym:\u7EBF":[{title:"\u7EBF\u6761\u3001\u8DEF\u7EBF\u3001\u754C\u7EBF",words:{\u7DDA:"",\u30E9\u30A4\u30F3:""}},{title:"\u7F1D\u7EAB\u3001\u7F16\u7EC7\u6750\u6599",words:{\u7CF8:""}}],"synonym:\u8868\u9762":[{title:"\u7269\u4F53\u6B63\u9762\u3001\u5916\u5C42",words:{\u8868:"",\u8868\u9762:""}},{title:"\u5916\u8868\u4E0E\u771F\u5B9E\u76F8\u5BF9",words:{\u4E0A\u8FBA:""}}],"synonym:\u5206\u5F00":[{title:"\u4E3B\u52A8\u5206\u5F00\uFF08\u4ED6\uFF09",words:{\u5206\u3051\u308B:"\u4ED6",\u5207\u308A\u96E2\u3059:"\u4ED6"}},{title:"\u6574\u4F53\u81EA\u884C\u5206\u5F00\uFF08\u81EA\uFF09",words:{\u5206\u304B\u308C\u308B:"\u81EA"}}],"synonym:\u65B9\u6CD5":[{title:"\u4E00\u822C\u505A\u6CD5",words:{\u65B9\u6CD5:""}},{title:"\u89E3\u51B3\u95EE\u9898\u7684\u5BF9\u7B56",words:{\u65B9\u7B56:""}},{title:"\u5916\u6765\u8BED\uFF1A\u4F53\u7CFB\u5316\u7A0B\u5E8F",words:{\u30E1\u30BD\u30C3\u30C9:""}}],"synonym:\u80CC\u9762":[{title:"\u8BFB \u3046\u3089\uFF1A\u65E5\u5E38\u80CC\u9762",words:{\u88CF:"",\u88CF\u5074:""}},{title:"\u8BFB \u308A\u3081\u3093\uFF1A\u6B63\u5F0F\u8BF4\u6CD5",words:{\u88CF\u9762:""}}],"synonym:\u597D\u597D\u5730":[{title:"\u80AF\u5B9A\u5730\u8BF4\u505A\u597D",words:{\u3061\u3083\u3093\u3068:"",\u304D\u3061\u3093\u3068:""}},{title:"\u591A\u63A5\u5426\u5B9A\uFF1A\u4E0D\u5145\u5206",words:{\u308D\u304F\u306B:""}}],"synonym:\u8F7B\u677E\u7684":[{title:"\u4E0D\u8D39\u529B\u3001\u8212\u670D",words:{\u697D:""}},{title:"\u6C17 \u5B57\u5934\uFF1A\u5FC3\u7406\u65E0\u62D8\u675F",words:{\u6C17\u697D:"",\u6C17\u8EFD:""}}],"synonym:\u540C\u4F34":[{title:"\u540C\u4E00\u7FA4\u4F53\u7684\u4F19\u4F34",words:{\u4EF2\u9593:""}},{title:"\u51FA\u884C\u3001\u966A\u540C\u5173\u7CFB",words:{\u9023\u308C:"",\u540C\u4F34:""}}],"synonym:\u521A\u624D":[{title:"\u53E3\u8BED\u8BF4\u4E0D\u4E45\u524D",words:{\u3055\u3063\u304D:"",\u305F\u3063\u305F\u4ECA:""}},{title:"\u793C\u8C8C\u3001\u6B63\u5F0F\u8BF4\u6CD5",words:{\u5148\u307B\u3069:""}}],"synonym:\u538B\u529B":[{title:"\u5916\u6765\u8BED\uFF1A\u8EAB\u5FC3\u8D1F\u62C5",words:{\u30B9\u30C8\u30EC\u30B9:"",\u30D7\u30EC\u30C3\u30B7\u30E3\u30FC:""}},{title:"\u4E5F\u6307\u7269\u7406\u538B\u529B",words:{\u5727\u529B:""}}],"synonym:\u6293\u4F4F":[{title:"\u6355 \u5B57\u5934\uFF1A\u902E\u6355\u3001\u6355\u83B7",words:{\u6355\u307E\u3048\u308B:"\u4ED6",\u6355\u3089\u3048\u308B:"\u4ED6"}},{title:"\u7528\u624B\u6293\u53D6",words:{\u3064\u304B\u3080:"\u4ED6"}}],"synonym:\u6837\u5B50":[{title:"\u89C2\u5BDF\u5230\u7684\u72B6\u6001",words:{\u69D8\u5B50:""}},{title:"\u88C5\u51FA\u6765\u7684\u59FF\u6001",words:{\u632F\u308A:""}},{title:"\u4E66\u9762\u8BF4\u5B58\u5728\u65B9\u5F0F",words:{\u3042\u308A\u3088\u3046:""}}],"synonym:\u5BA2\u5385":[{title:"\u5BB6\u5EAD\u8D77\u5C45\u5BA4",words:{\u5C45\u9593:"",\u30EA\u30D3\u30F3\u30B0:""}},{title:"\u63A5\u5F85\u3001\u4F4F\u5BBF\u5BA2\u623F",words:{\u5BA2\u5BA4:""}}],"synonym:\u5E03\u6599":[{title:"\u5E03 \u5B57\u5934\uFF1A\u7EC7\u7269",words:{\u5E03:"",\u5E03\u5730:""}},{title:"\u4E5F\u6307\u9762\u56E2\u7B49\u5E95\u6599",words:{\u751F\u5730:""}}],"synonym:\u6682\u65F6":[{title:"\u4E00\u6BB5\u65F6\u95F4",words:{\u3057\u3070\u3089\u304F:"",\u5F53\u5206:""}},{title:"\u5148\u505A\u4E00\u6B65\u518D\u8BF4",words:{\u3044\u3063\u305F\u3093:""}}],"synonym:\u5C31\u4E1A":[{title:"\u83B7\u5F97\u804C\u4F4D",words:{\u5C31\u8077:""}},{title:"\u4ECE\u4E8B\u5DE5\u4F5C\u3001\u52B3\u52A8",words:{\u5C31\u696D:"",\u5C31\u52B4:""}}],"synonym:\u8BBE\u8BA1":[{title:"\u5DE5\u7A0B\u3001\u7CFB\u7EDF\u89C4\u5212",words:{\u8A2D\u8A08:""}},{title:"\u5916\u6765\u8BED\uFF1A\u89C6\u89C9\u5916\u89C2",words:{\u30C7\u30B6\u30A4\u30F3:""}},{title:"\u6784\u601D\u65B0\u65B9\u6848",words:{\u8003\u6848:""}}],"synonym:\u5E74\u957F":[{title:"\u76F8\u5BF9\u67D0\u4EBA\u5E74\u9F84\u5927",words:{\u5E74\u4E0A:"",\u5E74\u9577:""}},{title:"\u4E2D\u8001\u5E74",words:{\u5E74\u914D:""}}],"synonym:\u679C\u7136":[{title:"\u65E5\u5E38\u786E\u8BA4\uFF1A\u3084 \u7CFB",words:{\u3084\u3063\u3071\u308A:"",\u3084\u306F\u308A:""}},{title:"\u4E66\u9762\u8BF4\u4E0D\u51FA\u6240\u6599",words:{\u6848\u306E\u5B9A:""}}],"synonym:\u4E0D\u4E45":[{title:"\u5F88\u5FEB\u5373\u5C06\u53D1\u751F",words:{\u9593\u3082\u306A\u304F:""}},{title:"\u8FC7\u4E00\u9635\u540E\u51FA\u73B0\u7ED3\u679C",words:{\u3084\u304C\u3066:""}},{title:"\u8FD1\u65E5",words:{\u8FD1\u3005:""}}],"synonym:\u518D\u6B21":[{title:"\u65E5\u5E38\u8BF4\u6CD5",words:{\u3082\u3046\u4E00\u5EA6:""}},{title:"\u518D \u5B57\u5934\uFF1A\u8F83\u4E66\u9762",words:{\u518D\u3073:"",\u518D\u5EA6:""}}],"synonym:\u603B\u4E4B":[{title:"\u6682\u4E0D\u8BA1\u8F83\u67D0\u9879",words:{\u3068\u306B\u304B\u304F:"",\u3068\u3082\u304B\u304F:""}},{title:"\u5F52\u7EB3\u524D\u6587\u7ED3\u8BBA",words:{\u8981\u3059\u308B\u306B:""}}],"synonym:\u6210\u5458":[{title:"\u5916\u6765\u8BED\uFF1A\u56E2\u961F\u6210\u5458",words:{\u30E1\u30F3\u30D0\u30FC:""}},{title:"\u793E\u56E2\u3001\u90E8\u95E8\u6210\u5458",words:{\u90E8\u54E1:""}},{title:"\u4E66\u9762\u8BF4\u7EC4\u7EC7\u6210\u5458",words:{\u6210\u54E1:""}}],"synonym:\u4EF7\u503C":[{title:"\u4E8B\u7269\u7684\u4EF7\u503C\u3001\u8EAB\u4EF7",words:{\u4FA1\u5024:"",\u5024\u6253\u3061:""}},{title:"\u4ED8\u51FA\u503C\u5F97",words:{\u304B\u3044:""}}],"synonym:\u679C\u5B9E":[{title:"\u679C\u5B9E\uFF0C\u4E5F\u6BD4\u55BB\u6210\u679C",words:{\u5B9F:"",\u679C\u5B9F:""}},{title:"\u6811\u6728\u7684\u679C\u5B50\u3001\u575A\u679C",words:{\u6728\u306E\u5B9F:""}}],"synonym:\u5206\u6570":[{title:"\u6C49\u8BED\uFF1A\u5F97\u5206",words:{\u70B9\u6570:"",\u5F97\u70B9:""}},{title:"\u5916\u6765\u8BED\uFF1A\u6BD4\u8D5B\u8BB0\u5F55",words:{\u30B9\u30B3\u30A2:""}}],"synonym:\u7530\u5730":[{title:"\u65F1\u7530",words:{\u7551:""}},{title:"\u6C34\u7530",words:{\u7530\u3093\u307C:""}},{title:"\u65F1\u7530\u3001\u6C34\u7530\u603B\u79F0",words:{\u7530\u7551:""}}],"synonym:\u5206\u91CF":[{title:"\u6570\u91CF\u3001\u4EFD\u989D",words:{\u91CF:"",\u5206\u91CF:""}},{title:"\u91CD\u91CF\u3001\u5F71\u54CD\u529B",words:{\u91CD\u307F:""}}],"synonym:\u79EF\u6512":[{title:"\u81EA\u884C\u7D2F\u79EF\uFF08\u81EA\uFF09",words:{\u305F\u307E\u308B:"\u81EA"}},{title:"\u4E3B\u52A8\u79EF\u6512\uFF08\u4ED6\uFF09",words:{\u305F\u3081\u308B:"\u4ED6",\u7A4D\u307F\u7ACB\u3066\u308B:"\u4ED6"}}],"synonym:\u63D0\u524D":[{title:"\u4E3B\u52A8\u8C03\u524D\uFF08\u4ED6\uFF09",words:{\u65E9\u3081\u308B:"\u4ED6",\u7E70\u308A\u4E0A\u3052\u308B:"\u4ED6"}},{title:"\u81EA\u884C\u63D0\u524D\uFF08\u81EA\uFF09",words:{\u65E9\u307E\u308B:"\u81EA"}}],"synonym:\u6346\u7ED1":[{title:"\u7E1B \u5B57\u5934\uFF1A\u6346\u7ED1\u3001\u675F\u7F1A",words:{\u7E1B\u308B:"\u4ED6",\u7E1B\u308A\u4ED8\u3051\u308B:"\u4ED6"}},{title:"\u6346\u6210\u4E00\u675F\uFF0C\u4E5F\u6307\u5F52\u7EB3",words:{\u304F\u304F\u308B:"\u4ED6"}}],"synonym:\u670D\u88C5":[{title:"\u6C49\u8BED\uFF1A\u670D\u9970\u540D\u79F0",words:{\u670D\u88C5:"",\u8863\u88C5:""}},{title:"\u548C\u8BED\uFF1A\u5916\u8868\u4E3E\u6B62",words:{\u306A\u308A\u3075\u308A:""}}],"synonym:\u897F\u5F0F":[{title:"\u897F\u5F0F\u7ED3\u6784\u3001\u98CE\u683C",words:{\u6D0B\u5F0F:"",\u6D0B\u98A8:""}},{title:"\u5355\u5B57\uFF1A\u897F\u6D0B\u3001\u6D77\u6D0B",words:{\u6D0B:""}}],"synonym:\u788E\u7247":[{title:"\u5207\u4E0B\u7684\u7247\u3001\u5757",words:{\u5207\u308C:"",\u7D30\u5207\u308C:""}},{title:"\u7834\u88C2\u540E\u7684\u788E\u7247",words:{\u7834\u7247:""}}],"synonym:\u642D\u914D":[{title:"\u5408\u308F\u305B\uFF1A\u914D\u5408\u3001\u7EC4\u5408",words:{\u5408\u308F\u305B:"",\u7D44\u307F\u5408\u308F\u305B:""}},{title:"\u5916\u6765\u8BED\uFF1A\u89C6\u89C9\u9020\u578B",words:{\u30B3\u30FC\u30C7\u30A3\u30CD\u30FC\u30C8:""}}],"synonym:\u5BDF\u89C9":[{title:"\u63A8\u6D4B\u3001\u4F53\u8C05\u4ED6\u4EBA",words:{\u5BDF\u3057:""}},{title:"\u5BDF\u89C9\u4FE1\u606F\u3001\u5F02\u5E38",words:{\u5BDF\u77E5:""}},{title:"\u611F\u5B98\u611F\u77E5",words:{\u611F\u77E5:""}}],"synonym:\u975E\u5E38":[{title:"\u4E66\u9762\u5F3A\u8C03\u7A0B\u5EA6\u9AD8",words:{\u3044\u3068\u3082:"",\u8AA0\u306B:""}},{title:"\u5E38\u63A5\u300C\u8A00\u3048\u306A\u3044\u300D",words:{\u4F55\u3068\u3082:""}}],"synonym:\u8BF4\u6CD5":[{title:"\u63AA\u8F9E\u3001\u8BF4\u8BDD\u65B9\u5F0F",words:{\u8A00\u3044\u65B9:"",\u7269\u8A00\u3044:""}},{title:"\u5B66\u8BF4\u3001\u4E3B\u5F20",words:{\u8AAC:""}}],"synonym:\u4F20\u8BF4":[{title:"\u548C\u8BED\uFF1A\u53E3\u8033\u6D41\u4F20",words:{\u6614\u8A71:"",\u8A00\u3044\u4F1D\u3048:""}},{title:"\u6C49\u8BED\uFF1A\u5386\u53F2\u795E\u79D8\u8272\u5F69",words:{\u4F1D\u8AAC:""}}],"synonym:\u79BB\u5F00":[{title:"\u7A7A\u95F4\u3001\u5173\u7CFB\u8131\u79BB",words:{\u96E2\u308C\u308B:"\u81EA"}},{title:"\u53BB \u5B57\uFF1A\u79BB\u53BB",words:{\u53BB\u308B:"\u81EA\u4ED6",\u7ACB\u3061\u53BB\u308B:"\u81EA"}}],"synonym:\u8BB0\u53F7":[{title:"\u5370 \u5B57\uFF1A\u6807\u8BB0",words:{\u5370:"",\u76EE\u5370:""}},{title:"\u6B63\u5F0F\u7B26\u53F7\u7C7B\u522B",words:{\u8A18\u53F7:""}}],"synonym:\u957F\u5904":[{title:"\u4E00\u822C\u4F18\u70B9",words:{\u9577\u6240:""}},{title:"\u7ADE\u4E89\u4F18\u52BF",words:{\u5F37\u307F:""}},{title:"\u91C7\u7528\u67D0\u505A\u6CD5\u7684\u597D\u5904",words:{\u5229\u70B9:""}}],"synonym:\u6F14\u5458":[{title:"\u620F\u5267\u3001\u5F71\u89C6\u8868\u6F14\u8005",words:{\u4FF3\u512A:"",\u5F79\u8005:""}},{title:"\u7535\u89C6\u827A\u4EBA\u3001\u7EFC\u827A\u5609\u5BBE",words:{\u30BF\u30EC\u30F3\u30C8:""}}],"synonym:\u8BBA\u70B9":[{title:"\u7406\u8BBA\u3001\u4E3B\u5F20",words:{\u8AD6:""}},{title:"\u8BA8\u8BBA\u7684\u7126\u70B9",words:{\u8AD6\u70B9:""}},{title:"\u6587\u7AE0\u7684\u4E2D\u5FC3\u5185\u5BB9",words:{\u8AD6\u65E8:""}}],"synonym:\u5C71\u9876":[{title:"\u4E0D\u9650\u4E8E\u5C71\u7684\u9876\u7AEF",words:{\u9802\u4E0A:"",\u9802:""}},{title:"\u4E13\u6307\u5C71\u7684\u6700\u9AD8\u5904",words:{\u5C71\u9802:""}}],"synonym:\u9633\u5149":[{title:"\u7167\u5C04\u611F\u3001\u6652\u611F",words:{\u65E5\u5DEE\u3057:""}},{title:"\u6C49\u8BED\uFF1A\u592A\u9633\u5149",words:{\u65E5\u5149:"",\u967D\u5149:""}}],"synonym:\u8DF3\u8D77":[{title:"\u4E0A\u304C\u308B\uFF1A\u5411\u4E0A\u8DF3",words:{\u98DB\u3073\u4E0A\u304C\u308B:"\u81EA",\u8DF3\u306D\u4E0A\u304C\u308B:"\u81EA"}},{title:"\u5F39\u8DF3\u3001\u98DE\u6E85",words:{\u8DF3\u306D\u308B:"\u81EA"}}],"synonym:\u8981\u70B9":[{title:"\u5185\u5BB9\u7684\u6838\u5FC3\u91CD\u70B9",words:{\u8981\u70B9:""}},{title:"\u5916\u6765\u8BED\uFF1A\u4E5F\u6307\u5206\u6570",words:{\u30DD\u30A4\u30F3\u30C8:""}},{title:"\u5173\u952E\u4F4D\u7F6E\u3001\u73AF\u8282",words:{\u8981\u6240:""}}],"synonym:\u7A0D\u5FAE":[{title:"\u7A0B\u5EA6\u7A0D\u8BB8",words:{\u3084\u3084:"",\u3044\u3055\u3055\u304B:""}},{title:"\u67D0\u79CD\u4E0D\u660E\u5BF9\u8C61",words:{\u4F55\u3089\u304B:""}}],"synonym:\u66FF\u6362":[{title:"\u4EA4\u6362\u4F4D\u7F6E\u3001\u5185\u5BB9",words:{\u5165\u308C\u66FF\u3048\u308B:"\u4ED6"}},{title:"\u7528\u65B0\u5BF9\u8C61\u4EE3\u66FF\u65E7\u5BF9\u8C61",words:{\u7F6E\u304D\u63DB\u3048\u308B:"\u4ED6",\u5DEE\u3057\u66FF\u3048\u308B:"\u4ED6"}}],"synonym:\u6E05\u695A\u7684":[{title:"\u5916\u6765\u8BED\uFF1A\u4E5F\u6307\u901A\u8FC7",words:{\u30AF\u30EA\u30A2:""}},{title:"\u6C49\u8BED\uFF1A\u6E05\u695A\u660E\u786E",words:{\u660E\u77AD:"",\u5206\u660E:""}}],"synonym:\u5730\u4F4D":[{title:"\u4F4D \u5B57\uFF1A\u8EAB\u4EFD\u3001\u7B49\u7EA7",words:{\u4F4D:"",\u5730\u4F4D:""}},{title:"\u5916\u6765\u8BED\uFF1A\u4E5F\u6307\u72B6\u6001",words:{\u30B9\u30C6\u30FC\u30BF\u30B9:""}}],"synonym:\u6069\u60E0":[{title:"\u5F97\u5230\u7684\u5229\u76CA\u3001\u6069\u6CFD",words:{\u6069\u6075:"",\u6075\u307F:""}},{title:"\u611F\u53D7\u5230\u7684\u53EF\u8D35",words:{\u3042\u308A\u304C\u305F\u307F:""}}],"synonym:\u6781\u5176":[{title:"\u4FEE\u9970\u4E00\u90E8\u3001\u308F\u305A\u304B",words:{\u3054\u304F:""}},{title:"\u6B63\u5F0F\u5F3A\u8C03\u7A0B\u5EA6",words:{\u6975\u3081\u3066:"",\u81F3\u3063\u3066:""}}],"synonym:\u8003\u8651":[{title:"\u628A\u6761\u4EF6\u7EB3\u5165\u5224\u65AD",words:{\u8003\u616E:""}},{title:"\u987E\u53CA\u4ED6\u4EBA\u5904\u5883",words:{\u914D\u616E:""}},{title:"\u614E\u91CD\u6DF1\u601D",words:{\u601D\u616E:""}}],"synonym:\u7EBF\u7D22":[{title:"\u8C03\u67E5\u3001\u89E3\u51B3\u7684\u7A81\u7834\u53E3",words:{\u7CF8\u53E3:""}},{title:"\u81EA\u5DF1\u8BB0\u5F97\u6216\u731C\u5230",words:{\u5FC3\u5F53\u305F\u308A:""}},{title:"\u53EF\u4F9D\u51ED\u7684\u5224\u65AD\u4F9D\u636E",words:{\u624B\u304C\u304B\u308A:""}}],"synonym:\u77AC\u95F4":[{title:"\u77ED\u6682\u65F6\u523B\u3001\u65F6\u95F4",words:{\u77AC\u9593:"",\u77AC\u6642:""}},{title:"\u7A81\u53D1\u72B6\u51B5\u4E0B\u7684\u53CD\u5E94",words:{\u3068\u3063\u3055:""}}],"synonym:\u81A8\u80C0":[{title:"\u9F13\u8D77\u3001\u589E\u5927",words:{\u81A8\u3089\u3080:"\u81EA",\u81A8\u308C\u308B:"\u81EA"}},{title:"\u4E0A\u304C\u308B\uFF1A\u6025\u5267\u66B4\u589E",words:{\u81A8\u308C\u4E0A\u304C\u308B:"\u81EA"}}],"synonym:\u6D8C\u51FA":[{title:"\u6E67 \u5B57\uFF1A\u4ECE\u5185\u90E8\u4EA7\u751F",words:{\u6E67\u304F:"\u81EA",\u6E67\u304D\u51FA\u308B:"\u81EA"}},{title:"\u8D85\u51FA\u5BB9\u91CF\u800C\u6EA2\u51FA",words:{\u3042\u3075\u308C\u51FA\u3059:"\u81EA"}}],"synonym:\u987D\u56FA\u7684":[{title:"\u9811 \u5B57\uFF1A\u56FA\u6267",words:{\u9811\u56FA:"",\u9811\u8FF7:""}},{title:"\u548C\u8BED\uFF1A\u575A\u6301\u3001\u62D2\u7EDD",words:{\u304B\u305F\u304F\u306A:""}}],"synonym:\u770B\u7A7F":[{title:"\u8BC6\u7834\u771F\u76F8\u3001\u9690\u7792",words:{\u898B\u629C\u304F:"\u4ED6",\u898B\u900F\u304B\u3059:"\u4ED6"}},{title:"\u770B\u6E05\u5168\u5C40\u3001\u9884\u89C1\u672A\u6765",words:{\u898B\u901A\u3059:"\u4ED6"}}],"synonym:\u7528\u5C3D":[{title:"\u628A\u8D44\u6E90\u7528\u5B8C\uFF08\u4ED6\uFF09",words:{\u4F7F\u3044\u679C\u305F\u3059:"\u4ED6",\u5207\u3089\u3059:"\u4ED6"}},{title:"\u8D44\u6E90\u81EA\u7136\u8017\u5C3D\uFF08\u81EA\uFF09",words:{\u5C3D\u304D\u308B:"\u81EA"}}],"synonym:\u5B89\u6392":[{title:"\u5916\u6765\u8BED\uFF1A\u4E5F\u6307\u6539\u7F16",words:{\u30A2\u30EC\u30F3\u30B8:""}},{title:"\u6B65\u9AA4\u5148\u540E\u987A\u5E8F",words:{\u6BB5\u53D6\u308A:""}},{title:"\u4EBA\u5458\u3001\u7269\u8D44\u3001\u624B\u7EED",words:{\u624B\u914D:""}}],"synonym:\u5D4C\u5165":[{title:"\u306F\u307E\u308B\uFF0F\u306F\u3081\u308B\uFF1A\u5D4C\u5408",words:{\u306F\u307E\u308B:"\u81EA",\u306F\u3081\u308B:"\u4ED6"}},{title:"\u4FB5\u5360\u7A7A\u95F4\u3001\u65F6\u95F4",words:{\u98DF\u3044\u8FBC\u3080:"\u81EA"}}],"synonym:\u6B65\u4F10":[{title:"\u5916\u6765\u8BED\uFF1A\u901F\u5EA6\u3001\u8FDB\u5EA6",words:{\u30DA\u30FC\u30B9:""}},{title:"\u811A\u6B65\uFF0C\u4E5F\u6709\u6BD4\u55BB\u4E49",words:{\u6B69\u307F:"",\u8DB3\u53D6\u308A:""}}],"synonym:\u575A\u56FA\u7684":[{title:"\u65E5\u5E38\u7ED3\u5B9E\u8010\u7528",words:{\u9811\u4E08:""}},{title:"\u6B63\u5F0F\u8BF4\u7262\u56FA\u53EF\u9760",words:{\u5F37\u56FA:"",\u5805\u7262:""}}],"synonym:\u652F\u63F4":[{title:"\u4E00\u822C\u63F4\u52A9",words:{\u652F\u63F4:""}},{title:"\u9488\u5BF9\u505C\u6EDE\u8FFD\u52A0\u63AA\u65BD",words:{\u3066\u3053\u5165\u308C:""}},{title:"\u5916\u6765\u8BED\uFF1A\u4E5F\u6307\u5907\u4EFD",words:{\u30D0\u30C3\u30AF\u30A2\u30C3\u30D7:""}}],"synonym:\u652F\u6301":[{title:"\u8D5E\u540C\u3001\u652F\u6491",words:{\u652F\u6301:""}},{title:"\u534F\u52A9\u3001\u670D\u52A1",words:{\u30B5\u30DD\u30FC\u30C8:""}},{title:"\u80CC\u540E\u63A8\u52A8\u884C\u52A8",words:{\u5F8C\u62BC\u3057:""}}],"synonym:\u624B\u52BF":[{title:"\u8EAB\u4F53\u6574\u4F53\u52A8\u4F5C",words:{\u8EAB\u632F\u308A:""}},{title:"\u624B\u90E8\u52A8\u4F5C",words:{\u624B\u632F\u308A:""}},{title:"\u5916\u6765\u8BED\uFF1A\u6709\u610F\u4F20\u8FBE",words:{\u30B8\u30A7\u30B9\u30C1\u30E3\u30FC:""}}],"synonym:\u9886\u57DF":[{title:"\u4E00\u822C\u6D3B\u52A8\u3001\u7814\u7A76\u8303\u56F4",words:{\u9818\u57DF:"",\u57DF:""}},{title:"\u81EA\u5DF1\u8D1F\u8D23\u7684\u8303\u56F4",words:{\u9818\u5206:""}}],"synonym:\u6B3A\u9A97":[{title:"\u4F7F\u5BF9\u65B9\u53D7\u9A97",words:{\u3060\u307E\u3059:"\u4ED6",\u6B3A\u304F:"\u4ED6"}},{title:"\u4F2A\u9020\u8EAB\u4EFD\u3001\u8BF4\u6CD5",words:{\u507D\u308B:"\u81EA\u4ED6"}}],"synonym:\u6838\u5FC3":[{title:"\u5355\u5B57\uFF1A\u4E5F\u6307\u539F\u5B50\u6838",words:{\u6838:""}},{title:"\u8BAE\u9898\u7684\u4E2D\u5FC3\u8981\u70B9",words:{\u6838\u5FC3:""}},{title:"\u7EC4\u7EC7\u3001\u7CFB\u7EDF\u9AA8\u5E72",words:{\u4E2D\u6838:""}}],"synonym:\u6D6A\u8D39":[{title:"\u4E71\u82B1\u94B1\u3001\u8017\u8D39\u8D44\u6E90",words:{\u7121\u99C4\u9063\u3044:"",\u6D6A\u8CBB:""}},{title:"\u5916\u6765\u8BED\uFF1A\u635F\u8017\u6D41\u5931",words:{\u30ED\u30B9:""}}],"synonym:\u89E6\u611F":[{title:"\u89E6\u308A\uFF1A\u89E6\u6478\u624B\u611F",words:{\u89E6\u308A:"",\u808C\u89E6\u308A:""}},{title:"\u4E5F\u6307\u5FC3\u7406\u5370\u8C61",words:{\u611F\u89E6:""}}],"synonym:\u611A\u8822\u7684":[{title:"\u53E3\u8BED\u9A82\u4EBA",words:{\u3070\u304B:""}},{title:"\u4E66\u9762\u8BF4\u7F3A\u4E4F\u5224\u65AD",words:{\u611A\u304B:""}},{title:"\u5177\u4F53\u7B28\u62D9\u5931\u8BEF",words:{\u3078\u307E:""}}],"synonym:\u7EC6\u81F4\u7684":[{title:"\u8BA1\u5212\u3001\u51C6\u5907\u5468\u5BC6",words:{\u7DBF\u5BC6:"",\u5165\u5FF5:""}},{title:"\u5173\u6000\u3001\u611F\u60C5\u7EC6\u817B",words:{\u7D30\u3084\u304B:""}}],"synonym:\u5996\u602A":[{title:"\u90AA\u6076\u9B54\u7269",words:{\u9B54\u7269:""}},{title:"\u5916\u5F62\u602A\u7269\u3001\u8D85\u5E38\u8005",words:{\u5316\u3051\u7269:""}},{title:"\u53E4\u5178\u6587\u5B66\u9B3C\u602A",words:{\u7269\u306E\u602A:""}}],"synonym:\u50B2\u6162\u7684":[{title:"\u6162 \u5B57\uFF1A\u81EA\u5927",words:{\u50B2\u6162:"",\u9AD8\u6162:""}},{title:"\u6446\u67B6\u5B50\uFF1A\u5C0A\u5927\u3076\u308B",words:{\u5C0A\u5927:""}}],"synonym-now:\u51C6\u5907":[{title:"\u4E3A\u505A\u4E8B\u9884\u5148\u5B89\u6392",words:{\u6E96\u5099:"",\u7528\u610F:""}},{title:"\u4E5F\u6307\u9632\u5907",words:{\u5099\u3048:""}}],"synonym-now:\u5305":[{title:"\u643A\u5E26\u7528\u5305",words:{\u304B\u3070\u3093:""}},{title:"\u88C5\u4E1C\u897F\u7684\u888B\u5B50",words:{\u888B:""}},{title:"\u5916\u6765\u8BED\uFF1A\u5305\u88C5\u3001\u9762\u819C",words:{\u30D1\u30C3\u30AF:""}}],"synonym-now:\u60F3\u6CD5":[{title:"\u610F\u89C1\u3001\u601D\u60F3",words:{\u8003\u3048:""}},{title:"\u5916\u6765\u8BED\uFF1A\u5177\u4F53\u521B\u610F",words:{\u30A2\u30A4\u30C7\u30A2:""}},{title:"\u4E00\u65F6\u8D77\u610F",words:{\u601D\u3044\u3064\u304D:""}}],"synonym-now:\u6837\u5B50":[{title:"\u5916\u8868\u88C5\u675F",words:{\u683C\u597D:""}},{title:"\u89C2\u5BDF\u5230\u7684\u60C5\u51B5",words:{\u69D8\u5B50:""}},{title:"\u88C5\u51FA\u6765\u7684\u59FF\u6001",words:{\u632F\u308A:""}}],"synonym-now:\u4E8B\u60C5":[{title:"\u6CDB\u6307\u4E8B\u60C5\u3001\u4E8B\u9879",words:{\u3053\u3068:"",\u4E8B\u67C4:""}},{title:"\u8981\u529E\u7684\u4E8B\u52A1",words:{\u7528\u4E8B:"",\u7528\u4EF6:""}},{title:"\u53D1\u751F\u7684\u4E8B\u4EF6",words:{\u51FA\u6765\u4E8B:""}}],"synonym-now:\u5F00\u59CB":[{title:"\u6C49\u8BED\uFF1A\u5F00\u59CB",words:{\u958B\u59CB:""}},{title:"\u5916\u6765\u8BED\uFF1A\u4E5F\u6307\u8D77\u70B9",words:{\u30B9\u30BF\u30FC\u30C8:""}},{title:"\u548C\u8BED\uFF1A\u5F00\u7AEF",words:{\u59CB\u307E\u308A:"",\u624B\u59CB\u3081:""}}],"synonym-now:\u4E60\u60EF":[{title:"\u6C49\u8BED\uFF1A\u4E60\u60EF\u3001\u98CE\u4FD7",words:{\u7FD2\u6163:"",\u6163\u7FD2:""}},{title:"\u4E2A\u4EBA\u6BDB\u75C5",words:{\u7656:""}},{title:"\u9002\u5E94\u3001\u719F\u6089",words:{\u6163\u308C:""}}],"synonym-now:\u8DEF\u7EBF":[{title:"\u9053 \u5B57\u5934\uFF1A\u8D70\u6CD5\u3001\u8109\u7EDC",words:{\u9053\u9806:"",\u9053\u7B4B:""}},{title:"\u7EBF\u8DEF\u3001\u65B9\u9488",words:{\u8DEF\u7DDA:""}}],"synonym-now:\u5F3A\u786C\u7684":[{title:"\u548C\u8BED\uFF1A\u987D\u5F3A\u96BE\u5BF9\u4ED8",words:{\u3057\u305F\u305F\u304B:""}},{title:"\u5F37 \u5B57\u5934\uFF1A\u6001\u5EA6\u5F3A\u786C",words:{\u5F37\u5F15:"",\u5F37\u786C:""}}],"synonym-now:\u5916\u89C2":[{title:"\u5355\u5B57\uFF1A\u4E5F\u6307\u89C2\u70B9",words:{\u89B3:""}},{title:"\u5916 \u5B57\u5934\uFF1A\u5916\u5F62",words:{\u5916\u898B:"",\u5916\u89B3:""}},{title:"\u770B\u8D77\u6765\u7684\u6837\u5B50",words:{\u898B\u304B\u3051:""}}],"synonym-now:\u6784\u60F3":[{title:"\u767A\uFF0F\u7740 \u5B57\u5934\uFF1A\u60F3\u6CD5",words:{\u767A\u60F3:"",\u7740\u60F3:""}},{title:"\u69CB \u5B57\u5934\uFF1A\u8BBE\u60F3",words:{\u69CB\u60F3:""}}],"synonym-now:\u90E8\u95E8":[{title:"\u653F\u5E9C\u7701\u5385",words:{\u7701:""}},{title:"\u7EC4\u7EC7\u5185\u90E8\u90E8\u95E8",words:{\u90E8\u9580:"",\u90E8\u7F72:""}}],"synonym-now:\u95F4\u9699":[{title:"\u4E8B\u60C5\u4E4B\u95F4\u7684\u7A7A\u5F53",words:{\u5408\u9593:""}},{title:"\u4E2D\u65AD\uFF0C\u4E5F\u6307\u5207\u53E3",words:{\u5207\u308C\u76EE:""}},{title:"\u591A\u63A5\u5426\u5B9A\uFF1A\u4E0D\u65AD",words:{\u7D76\u3048\u9593:""}}]}});var pA,to,ro,La=h(()=>{"use strict";Xw();pA=(e,t,r)=>{let n=Math.max(0,...e.map(o=>r(o).length));for(let o=0;o<n;o+=1){let s=e.findIndex(i=>r(i)[o]===t);if(s>=0)return s}return-1},to=(e,t,r,n)=>{let o=Bw[e];if(!o)return t.map(a=>({member:a,voice:n(a),subgroup:""}));let s=[...t];return[...o.flatMap(a=>Object.entries(a.words).flatMap(([d,u])=>{let l=pA(s,d,r);if(l<0)return[];let[c]=s.splice(l,1);return[{member:c,voice:u||null,subgroup:a.title}]})),...s.map(a=>({member:a,voice:n(a),subgroup:""}))]},ro=e=>e==="\u81EA\u52A8\u8BCD"?"\u81EA":e==="\u4ED6\u52A8\u8BCD"?"\u4ED6":null});var va={};M(va,{CONFUSION_FSRS:()=>Pc,clearConfusionTasks:()=>Xc,confusionCardPool:()=>ka,confusionCardProgress:()=>ha,confusionPriorCount:()=>Gc,createConfusionTasks:()=>Aa,ensureConfusionCardTables:()=>Ht,groupLevelRank:()=>zw,matchable:()=>mr,matchingCard:()=>Hc,materializeConfusionCards:()=>Ts,pickConfusionNext:()=>Kc,recordConfusionReview:()=>Bc,replayConfusionReviews:()=>wA,undoLastConfusionReview:()=>Yc});var Oa,ws,Yw,Pc,EA,fA,gA,ht,Ht,mr,_A,zw,Ts,Hc,Aa,Kc,ha,Gc,Bc,Xc,Yc,wA,ka,ln=h(()=>{"use strict";Oa=N($(),1);St();G();ne();_c();dt();sr();ws=N(_s(),1),Yw=N(Ar(),1);La();Pc={table:"confusion_progress",idColumn:"group_key",eligible:"known_forever = 0"},EA=e=>`'${e.replace(/'/gu,"''")}'`,fA=()=>`group_key IN (${Qe().filter(mr).map(t=>t.key).map(EA).join(",")||"NULL"})`,gA="group_key NOT IN (SELECT group_key FROM confusion_mastered)",ht=fa({entity:Pc,reviewsTable:"confusion_reviews",tasksTable:"confusion_tasks",extraExclude:()=>`${fA()} AND ${gA}`}),Ht=()=>{let e=(0,Oa.getDatabase)();e.run(`
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
  `),j(Pc)},mr=e=>{let t=(0,ws.distinctionReviewFor)(e.key);return!t||t.level!=="major"||e.type==="synonym"||e.type==="near-synonym"||e.members.length<2||!t.summary.trim()?!1:new Set(e.members.map(n=>`${be(n)}\0${n.kana}`)).size===e.members.length},_A={N5:0,N4:1,N3:2,N2:3,N1:4},zw=e=>Math.max(...e.members.map(t=>_A[t.jlptLevel]??4)),Ts=()=>{Ht();let e=(0,Oa.getDatabase)(),t=new Map(p("SELECT group_key, level_rank FROM confusion_progress").map(n=>[String(n.group_key),Number(n.level_rank)])),r=0;return er(()=>{e.run("BEGIN");try{let n=Qe().filter(mr).map(i=>[i.key,zw(i)]),o=n.filter(([i])=>!t.has(i));e.run(`
        INSERT INTO confusion_progress (group_key, level_rank)
        SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]')
        FROM json_each(?) ORDER BY CAST(key AS INTEGER)
      `,[JSON.stringify(o)]),r=e.getRowsModified();let s=n.filter(([i,a])=>t.has(i)&&t.get(i)!==a);s.length&&e.run(`
        UPDATE confusion_progress SET level_rank = batch.value ->> '$[1]'
        FROM json_each(?) AS batch WHERE group_key = batch.value ->> '$[0]'
      `,[JSON.stringify(s)]),e.run("COMMIT")}catch(n){throw e.run("ROLLBACK"),n}}),r},Hc=e=>{let t=Qe().find(s=>s.key===e),r=t?(0,ws.distinctionReviewFor)(t.key):null;if(!t||!r||!mr(t))return null;let n=(0,ws.distinctionNotesFor)(r.summary,t.members.map(s=>({key:String(s.id),forms:[be(s),s.kanji,s.kana]}))),o=Yw.default;return{groupKey:t.key,type:t.type,label:t.label,overview:r.summary.split(/[；;]/u)[0].trim(),members:to(t.key,t.members,s=>[be(s),s.kanji,s.kana],s=>ro((o[s.kanji]??o[s.kana])?.[0])).map(({member:s,voice:i,subgroup:a})=>({id:s.id,surface:be(s),kana:s.kana,note:n.get(String(s.id)),exampleJp:s.exampleJp,exampleMeaning:s.exampleMeaning,voice:i,subgroup:a})),summary:r.summary,notes:n}},Aa=(e,t=4,r=T())=>{Ht();let n=new Set(Qe().filter(mr).map(s=>s.key));return p("SELECT group_key FROM confusion_tasks WHERE reviewed_on = ?",[r]).some(s=>!n.has(String(s.group_key)))&&(0,Oa.getDatabase)().run("DELETE FROM confusion_tasks WHERE reviewed_on = ?",[r]),ht.createTasks(e,()=>{let s=new Set(p("SELECT word_id FROM progress WHERE seen_count > 0").map(d=>Number(d.word_id))),i=zr("confusion"),a=new Map(p(`SELECT group_key, level_rank FROM confusion_progress WHERE ${ht.exclude} AND seen_count = 0 AND level_rank <= ?`,[t]).map(d=>[String(d.group_key),i[Number(d.level_rank)]??0]));return Qe().filter(d=>mr(d)).filter(d=>a.has(d.key)).map(d=>({key:d.key,rank:a.get(d.key)??0,learned:d.members.filter(u=>s.has(u.id)).length,size:d.members.length})).sort((d,u)=>d.rank-u.rank||u.learned-d.learned||d.size-u.size||d.key.localeCompare(u.key)).map(d=>d.key)},r)},Kc=(e=T(),t=new Set)=>{Ht();let r=new Set(t),n=new Set(Qe().filter(mr).map(o=>o.key));for(let o=0;o<1e3;o+=1){let s=ht.pickNext(e,r);if(!s)return null;if(n.has(s))return s;r.add(s)}return null},ha=(e=T())=>(Ht(),ht.progress(e)),Gc=ht.priorCount,Bc=(e,t,r=new Date,n)=>(Ht(),ht.record(e,t,r,n)),Xc=(e=T())=>{Ht(),ht.clearTasks(e)},Yc=()=>(Ht(),ht.undoLast()),wA=e=>(Ht(),ht.replay(e)),ka=(e=4)=>(Ht(),{due:ht.dueCount(),unseen:E(`SELECT COUNT(*) FROM confusion_progress WHERE ${ht.exclude} AND seen_count = 0 AND level_rank <= ?`,[e],0)})});var rm={};M(rm,{getConfusionCardSession:()=>Qc,getKanjiCardSession:()=>Vc,loadMixedCardData:()=>SA,mixedCardCounts:()=>Ia,mixedCardDataLoaded:()=>Ss,refreshMixedCardTasks:()=>tm,submitConfusionCardAnswer:()=>Zc,submitKanjiCardAnswer:()=>qc,targetLevelRank:()=>Da,undoConfusionCardAnswer:()=>em,undoKanjiCardAnswer:()=>Jc});var Ca,TA,Da,qw,Jw,SA,Ss,Vw,zc,Vc,qc,Jc,Qc,Zc,em,tm,Ia,ys=h(()=>{"use strict";Se();Lt();G();eo();ln();Ca=N(_s(),1),TA={N5:0,N4:1,N3:2,N2:3,N1:4},Da=()=>TA[Y().jlptTarget]??2,qw=(e,t)=>Dr(e,"kanji",t),Jw=(e,t)=>Dr(e,"confusion",t),SA=()=>Promise.all([fs(),(0,Ca.loadDistinctionReviews)()]).then(()=>{}),Ss=()=>Ta()&&(0,Ca.distinctionReviewsLoaded)(),Vw=null,zc=e=>{if(Vw!==e){if(!Ss())throw new Error("\u6DF7\u5408\u5361\u5185\u5BB9\u672A ready\uFF1A\u5148 await readyForHomeMode / readyForRoute");gs(),Ts(),Vw=e}},Vc=(e,t=T())=>{zc(e);let r=st();Sa({fresh:r.kanjiDailyGoal,review:qw(r.kanjiReviewCap,t)},Da(),t);let n=xc(t),o=ya(t);return{card:n?Ic(n):null,...o}},qc=(e,t)=>Fc(e,t),Jc=()=>jc(),Qc=(e,t=T())=>{zc(e);let r=st();Aa({fresh:r.confusionDailyGoal,review:Jw(r.confusionReviewCap,t)},Da(),t);let n=Kc(t),o=ha(t);return{card:n?Hc(n):null,...o}},Zc=(e,t)=>Bc(e,t),em=()=>Yc(),tm=e=>{Wc(),Xc(),Ss()&&Ia(e)},Ia=(e,t=T())=>{zc(e);let r=st(),n=Da();Sa({fresh:r.kanjiDailyGoal,review:qw(r.kanjiReviewCap,t)},n,t);let o=ya(t);Aa({fresh:r.confusionDailyGoal,review:Jw(r.confusionReviewCap,t)},n,t);let s=ha(t);return{kanjiDone:o.done,kanjiRemaining:o.remaining,confusionDone:s.done,confusionRemaining:s.remaining}}});var nm,Zw,Ns,Rs,yA,pr,cn,eT,NA,Qw,mn,RA,tT,bs,Ls=h(()=>{"use strict";nm=N($(),1);G();ne();Jr();Ke();Re();Gr();Zw={id:"forward",phase:"stage1",entity:ue,taskTable:"stage1_tasks",wordFilterSql:"",label:"\u6B63\u5411"},Ns={id:"reverse",phase:"stage2",entity:jl,taskTable:"stage2_progress",wordFilterSql:"",label:"\u53CD\u5411"},Rs={id:"kanji_reading",phase:"kanji",entity:ta,taskTable:"kanji_reading_progress",wordFilterSql:"w.kanji <> w.kana",label:"\u6C49\u5B57"},yA=[Zw,Ns,Rs],pr=e=>yA.find(t=>t.phase===e)??Zw,cn=(e,t)=>e.id!=="kanji_reading"||Po({kanji:String(t.kanji??""),kana:String(t.kana??"")}),eT=(e,t)=>{if(e.id!=="kanji_reading"||!t.length)return t;let r=t.map(()=>"?").join(","),n=new Set(p(`
    SELECT id, kanji, kana FROM words WHERE id IN (${r})
  `,t).filter(o=>cn(e,o)).map(o=>Number(o.id)));return t.filter(o=>n.has(o))},NA=[["seen_count","INTEGER NOT NULL DEFAULT 0"],["right_count","INTEGER NOT NULL DEFAULT 0"],["fuzzy_count","INTEGER NOT NULL DEFAULT 0"],["forgot_count","INTEGER NOT NULL DEFAULT 0"],["mistake_streak","INTEGER NOT NULL DEFAULT 0"],["last_seen_on","TEXT"]],Qw=new WeakMap,mn=e=>{let t=(0,nm.getDatabase)();j(e.entity);let r=Qw.get(t);if(r||(r=new Set,Qw.set(t,r)),r.has(e.entity.table))return;let n=new Set(p(`PRAGMA table_info(${e.entity.table})`).map(o=>String(o.name??"")));for(let[o,s]of NA)n.has(o)||t.run(`ALTER TABLE ${e.entity.table} ADD COLUMN ${o} ${s}`);r.add(e.entity.table)},RA=.5,tT=(e,t)=>{if(e.id==="forward"||t<=0)return[];mn(e);let r=e.entity.table,n=p(`
    SELECT p.word_id, p.fsrs_lapses, w.kanji, w.kana, ${pe("words","p.word_id")} AS pending_prior
    FROM progress p
    JOIN words w ON w.id = p.word_id
    WHERE p.seen_count > 0
      AND p.known_forever = 0
      AND COALESCE(p.fsrs_lapses, 0) < ?
      AND ${te("words","p.word_id")}
      ${e.id==="kanji_reading"?`AND NOT (${No("w.id")})`:""}
      ${e.wordFilterSql?`AND ${e.wordFilterSql}`:""}
      AND NOT EXISTS (SELECT 1 FROM ${r} m WHERE m.word_id = p.word_id)
    ORDER BY p.fsrs_due ASC, p.word_id ASC
  `,[Ee]).filter(d=>cn(e,d));e.id==="kanji_reading"&&n.sort((d,u)=>Dn({kanji:String(u.kanji??""),kana:String(u.kana??"")})-Dn({kanji:String(d.kanji??""),kana:String(d.kana??"")}));let o=(0,nm.getDatabase)(),s=new Date().toISOString(),i=[],a=n.filter(d=>!d.pending_prior).slice(0,t);for(let d of[...a,...n.filter(u=>u.pending_prior)]){let u=Number(d.word_id);o.run(`INSERT OR IGNORE INTO ${r} (word_id, seen_count) VALUES (?, 0)`,[u]);let l=Rt(u,ue);l&&bt(u,{...l,stability:Math.max(l.stability*RA,.1),due:s,lastReview:s,reps:0,lapses:0,steps:0},e.entity),i.push(u)}return i},bs=(e,t=T())=>E(`SELECT COUNT(*) FROM ${e.taskTable} WHERE reviewed_on = ?`,[t],0)});var Ma,bA,LA,OA,AA,hA,kA,xa,no,vA,Ua,om,sm=h(()=>{"use strict";Ma=N($(),1);yt();Se();Qi();ir();Jo();Wl();G();Lt();ne();Re();Ke();Jr();Wt();Ls();bA=e=>nn(e)??Zi,LA=(e,t)=>E(`SELECT COUNT(*)
   FROM ${e.taskTable} t
   JOIN ${e.entity.table} m ON m.word_id = t.word_id
   WHERE t.reviewed_on = ? AND COALESCE(m.seen_count, 0) = 0`,[t],0),OA=(e,t)=>{if(e.id!=="kanji_reading")return;p(`
    SELECT t.word_id, w.kanji, w.kana
    FROM ${e.taskTable} t
    JOIN words w ON w.id = t.word_id
    WHERE t.reviewed_on = ?
  `,[t]).filter(n=>!cn(e,n)).forEach(n=>(0,Ma.getDatabase)().run(`DELETE FROM ${e.taskTable} WHERE reviewed_on = ? AND word_id = ?`,[t,Number(n.word_id)]))},AA=(e,t,r)=>{let n=e.id==="kanji_reading"?Math.max(t*2,32):t,o=new Set(Me(e.entity,r).map(Number)),s=eT(e,sn(n,r,e.entity));return[...s.filter(i=>!o.has(i)).slice(0,Math.max(0,t)),...s.filter(i=>o.has(i))]},hA=(e,t=T(),r=!1)=>{mn(e);let n=(0,Ma.getDatabase)();if(OA(e,t),bs(e,t)>0){Ut(e.entity,e.taskTable,t);return}kA(e,t);let o=Cr(Xr(),t),s=E(`SELECT COUNT(*) FROM ${e.taskTable}
    WHERE reviewed_on = ? AND NOT ${Vr("words",`${e.taskTable}.word_id`,t)}`,[t],0),i=Math.max(o-s,0),a=bs(e,t)+1;AA(e,i,A()).forEach(u=>{n.run(`
      INSERT OR IGNORE INTO ${e.taskTable} (reviewed_on, word_id, order_index)
      VALUES (?, ?, ?)
    `,[t,u,a]),a+=1});let d=r?Math.max(Ot()-LA(e,t),0):0;d>0&&tT(e,d).forEach(u=>{n.run(`
        INSERT OR IGNORE INTO ${e.taskTable} (reviewed_on, word_id, order_index)
        VALUES (?, ?, ?)
      `,[t,u,a]),a+=1}),Ut(e.entity,e.taskTable,t)},kA=(e,t)=>{p(`
    SELECT r.word_id, MIN(r.id) AS first_review_id, w.kanji, w.kana
    FROM reviews r
    JOIN words w ON w.id = r.word_id
    WHERE r.reviewed_on = ? AND r.direction = ? AND r.answer != 'known_forever'
    GROUP BY r.word_id
    ORDER BY first_review_id ASC
  `,[t,e.id]).filter(n=>cn(e,n)).forEach((n,o)=>{(0,Ma.getDatabase)().run(`
      INSERT OR IGNORE INTO ${e.taskTable} (reviewed_on, word_id, order_index)
      VALUES (?, ?, ?)
    `,[t,Number(n.word_id),o+1])})},xa=(e,t=!1)=>{hA(e,T(),t)},no=e=>{let t=T();xa(e);let r=bs(e,t),n=E(`
    SELECT COUNT(DISTINCT t.word_id)
    FROM ${e.taskTable} t
    JOIN ${e.entity.table} m ON m.word_id = t.word_id
    LEFT JOIN progress p ON p.word_id = t.word_id
    WHERE t.reviewed_on = ?
      AND (
        COALESCE(p.known_forever, 0) = 1
        OR (m.fsrs_due IS NOT NULL AND m.fsrs_due > ?)
      )
  `,[t,A().toISOString()],0);return{total:r,completed:Math.min(n,r)}},vA=e=>`
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
    LEFT JOIN word_notes n ON n.word_id = w.id`,Ua=(e,t)=>{mn(e);let r=H(`SELECT ${vA(e)} WHERE m.word_id = ?`,[t]);return r&&cn(e,r)?re(r):null},om=(e,t=new Set,r={})=>{let n=r.deterministic===!0,o=T();xa(e);let s=new Map(_e(e.id).map(_=>[_.word_id,_.due_after])),i=p(`
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
  `,[o,A().toISOString()]),a=i.filter(_=>!t.has(Number(_.id))&&cn(e,_));if(!a.length)return null;let d=Fe(e.id),u=a.find(_=>Number(_.id)===d),l=Ft({mistakeStreak:Number(u?.mistake_streak??0),remaining:a.length,total:bs(e,o)});if(u&&Number(u.mistake_streak??0)>=lt&&(s.get(d)??0)<=0)return re(u);let m=(a.length>1&&!l?a.filter(_=>Number(_.id)!==d):a).map(_=>{let b=qi(_,s.get(Number(_.id)),0,{randomize:!n});return e.id==="kanji_reading"&&(b.orthography=Dn({kanji:String(_.kanji??""),kana:String(_.kana??"")})),{score:Ji(b),dueAfter:s.get(Number(_.id))??0,row:_}});if(!m.length)return null;let g=m.filter(_=>_.dueAfter<=0);if(!g.length)return m.sort((_,b)=>_.dueAfter-b.dueAfter||b.score-_.score),re(m[0].row);let S=aa(o,$n,e.id),w=ea(g.map(_=>({id:Number(_.row.id),score:_.score,recall:bA(_.row),isLeech:Number(_.row.fsrs_lapses??0)>=Ee})),{answeredToday:S.answeredToday,recentIds:S.wordIds,wrongStreak:S.wrongStreak,interference:qo(o,i,e.id),...n?{random:()=>0}:{}});if(!w)return null;let y=g.find(_=>Number(_.row.id)===w.id)?.row;return re(y??g[0].row)}});var rT,CA,nT,im,oT,Fa,sT,am=h(()=>{"use strict";yt();ir();G();Wt();He();rT="picked_word_ids",CA=300,nT=e=>{let t=Array.from(new Set(e.map(r=>Math.round(Number(r))).filter(r=>Number.isFinite(r)&&r>0))).slice(0,CA);return R(rT,JSON.stringify(t)),D(),t},im=()=>{try{let e=JSON.parse(O(rT,"[]"));if(!Array.isArray(e))return[];let t=e.map(n=>Number(n)).filter(n=>Number.isFinite(n)&&n>0);if(!t.length)return[];let r=new Set(p(`SELECT w.id FROM words w LEFT JOIN progress p ON p.word_id=w.id
      WHERE w.id IN (${t.map(()=>"?").join(",")}) AND ${oe()}`,t).map(n=>Number(n.id)));return t.filter(n=>r.has(n))}catch{return[]}},oT=()=>{let e=im();if(!e.length)return[];let t=e.map(()=>"?").join(",");return p(`
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
  `,[...e,T(),A().toISOString(),T()])},Fa=()=>{let e=im().length;return{total:e,remaining:Math.min(oT().length,e)}},sT=()=>{let e=oT();if(!e.length)return null;let t=Fe(),r=e.find(s=>Number(s.id)===t),n=Ft({mistakeStreak:Number(r?.mistake_streak??0),remaining:e.length,total:im().length}),o=e.length>1&&!n?e.filter(s=>Number(s.id)!==t):e;return re(o[0]??e[0])}});var iT,lm,dm,aT,um,DA,Wa,IA,ja,dT,uT,lT,cT,mT,pn,oo,MA,pT,ET,fT,Os=h(()=>{"use strict";iT=N(vr(),1);yt();G();Mr();lm="daily_relief_v2",dm=6,aT=12,um=100,DA=300,Wa=(e=T())=>({studyDate:e,wordIds:[],completed:0}),IA=(e,t)=>{if(!e||typeof e!="object")return Wa(t);let r=e,n=Array.isArray(r.wordIds)?r.wordIds.map(Number).filter(s=>Number.isFinite(s)):[],o=Array.from(new Set(n));return{studyDate:t,wordIds:o,completed:Math.min(Math.max(Number(r.completed??0),0),o.length)}},ja=(e=T())=>{let t=O(lm,"");if(!t)return Wa(e);try{let r=JSON.parse(t);return r.studyDate!==e?Wa(e):IA(r,e)}catch{return Wa(e)}},dT=e=>(R(lm,JSON.stringify(e)),D(),(0,iT.notifyProgressUpdated)(),e),uT=e=>{let t=new Date(`${e}T12:00:00`);return t.setDate(t.getDate()-1),t.toISOString().slice(0,10)},lT=e=>{let t=uT(e);return p(`
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
  `,[t,e,aT]).map(r=>({wordId:Number(r.word_id),rememberedCount:Number(r.remembered_count??0)}))},cT=e=>E(`
    SELECT COUNT(DISTINCT word_id)
    FROM reviews
    WHERE reviewed_on = ?
      AND direction = 'forward'
  `,[uT(e)],0),mT=(e,t)=>{if(e.length<dm||t<um)return 0;let r=Math.min(1,(t-um)/(DA-um)),n=Math.round(dm+r*(aT-dm));return Math.min(e.length,n)},pn=()=>{let e=T();jt();let t=ja(e),r=O(lm,""),n=!1;if(r)try{n=JSON.parse(r).studyDate===e}catch{n=!1}if(t.wordIds.length>0||n)return t;let o=lT(e),s=mT(o,cT(e)),i=o.slice(0,s).map(a=>a.wordId);return dT({studyDate:e,wordIds:i,completed:0})},oo=()=>{let e=ja();return{total:e.wordIds.length,completed:e.completed,pending:Math.max(e.wordIds.length-e.completed,0)}},MA=e=>{let t=H(`
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
  `,[e]);return t?re(t):null},pT=()=>{let e=pn(),t=e.wordIds[e.completed];return t==null?null:MA(t)},ET=()=>{let e=ja();return e.completed>=e.wordIds.length?e:dT({...e,completed:e.completed+1})},fT=e=>e===T()?ja().completed:mT(lT(e),cT(e))});var gT,mm,cm,_T,xA,$a,Pa,pm,UA,FA,As,WA,jA,wT,so,TT,ST,Ha=h(()=>{"use strict";G();gT=N(vr(),1);yt();ne();Mr();Os();mm="daily_tail_v2",cm=3,_T=7,xA=3,$a=(e=T())=>({studyDate:e,wordIds:[],completed:0}),Pa=(e=T())=>{let t=O(mm,"");if(!t)return $a(e);try{let r=JSON.parse(t);if(r.studyDate!==e)return $a(e);let n=Array.isArray(r.wordIds)?r.wordIds.map(Number).filter(o=>Number.isFinite(o)):[];return{studyDate:e,wordIds:n,completed:Math.min(Math.max(Number(r.completed??0),0),n.length)}}catch{return $a(e)}},pm=e=>(R(mm,JSON.stringify(e)),D(),(0,gT.notifyProgressUpdated)(),e),UA=14,FA=()=>{let e=T(),t=A().toISOString(),r=new Set(pn().wordIds);return p(`
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
  `,[t,UA,e,e]).map(o=>({row:o,recall:nn(o)??0})).filter(o=>!r.has(Number(o.row.id))).filter(o=>o.recall>=.82).sort(()=>Math.random()-.5).slice(0,_T).map(o=>o.row)},As=()=>{let e=T(),t=Pa(e),r=O(mm,""),n=!1;if(r)try{n=JSON.parse(r).studyDate===e}catch{n=!1}if(t.wordIds.length>0||n)return t;if(dr().total<=0)return $a(e);let s=FA().map(a=>Number(a.id)),i=s.length>=cm?cm+Math.floor(Math.random()*(Math.min(_T,s.length)-cm+1)):0;return pm({studyDate:e,wordIds:s.slice(0,i),completed:0})},WA=e=>{let t=H(`
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
  `,[e]);return t?re(t):null},jA=e=>{R("phase_date",T()),R("phase","stage1"),R("current_card",String(e))},wT=()=>{let e=As(),t=dr();if(t.total<=0||t.completed<t.total)return null;let r=e.wordIds[e.completed];if(r==null)return null;let n=WA(r);return n&&jA(r),n},so=()=>{let e=Pa();return{total:e.wordIds.length,completed:e.completed,pending:Math.max(e.wordIds.length-e.completed,0)}},TT=(e={})=>{let t=Pa();if(t.completed>=t.wordIds.length)return t;let r=t.wordIds[t.completed],n=t.wordIds.filter(s=>s===r).length,o=e.requeue&&n<xA?[...t.wordIds,r]:t.wordIds;return pm({...t,wordIds:o,completed:t.completed+1})},ST=e=>{let t=Pa();if(t.completed<=0)return t;let r=[...t.wordIds];return r[r.length-1]===e&&r.filter(n=>n===e).length>1&&r.pop(),pm({...t,wordIds:r,completed:t.completed-1})}});var Ba={};M(Ba,{KANJI_UNIT_FSRS:()=>Ka,KANJI_UNIT_QUOTA_DEFAULT:()=>Em,KANJI_UNIT_QUOTA_MAX:()=>wm,KANJI_UNIT_QUOTA_MIN:()=>_m,KANJI_UNIT_SCHEDULER_FLAG:()=>gm,REVIEWS_PER_NEW_UNIT:()=>NT,buildUnitsByWord:()=>bT,coverageScore:()=>fm,createKanjiUnitTasks:()=>hs,ensureKanjiUnitTables:()=>Gt,getKanjiUnitDailyQuota:()=>Tm,getKanjiUnitTargetLevelRank:()=>HA,isKanjiUnitSchedulerEnabled:()=>Er,kanjiUnitCardByKey:()=>Ga,kanjiUnitEta:()=>KA,kanjiUnitProgress:()=>ym,kanjiUnitStepMode:()=>OT,loadKanjiUnitIndex:()=>$t,materializeKanjiUnitIndex:()=>RT,pickKanjiUnitNext:()=>Sm,recordKanjiUnitReview:()=>Nm,replayKanjiUnitReviews:()=>zA,setKanjiUnitDailyQuota:()=>PA,setKanjiUnitKnownForever:()=>Rm,setKanjiUnitSchedulerEnabled:()=>GA});var Kt,gm,yT,_m,wm,Em,$A,Tm,PA,HA,NT,KA,Er,GA,Ka,Ga,BA,Gt,RT,fm,XA,bT,hs,YA,Sm,ym,LT,OT,Nm,zA,Rm,ks=h(()=>{"use strict";Kt=N($(),1);G();ne();Ur();Ke();zn();wt();St();Se();gm="feature.kanji_unit_scheduler_v1",yT="kanji_unit_daily_quota",_m=5,wm=200,Em=30,$A=e=>{try{return E("SELECT value FROM app_state WHERE key = ?",[e],"")||null}catch{return null}},Tm=()=>{let e=$A(yT);if(e===null)return Em;let t=Number(e);return!Number.isFinite(t)||t<=0?Em:Math.min(Math.max(Math.floor(t),_m),wm)},PA=e=>{let t=Math.min(Math.max(Math.floor(e),_m),wm);(0,Kt.getDatabase)().run(`
    INSERT INTO app_state (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `,[yT,String(t)])},HA=()=>Math.max(W.indexOf(Y().jlptTarget),0),NT=9,KA=(e=Tm())=>{let t=Tc(),r=new Set(p("SELECT unit_key FROM kanji_unit_memory WHERE COALESCE(seen_count, 0) > 0").map(o=>String(o.unit_key))),n=Math.max(e/NT,.1);return t.map((o,s)=>{let i=Sc(s),a=i.filter(d=>!r.has(d.unitKey)).length;return{levelRank:s,level:o,unitsNeeded:i.length,unitsRemaining:a,days:Math.ceil(a/n)}})},Er=()=>{try{return globalThis.localStorage?.getItem(gm)!=="0"}catch{return!0}},GA=e=>{try{globalThis.localStorage?.setItem(gm,e?"1":"0")}catch{}},Ka={table:"kanji_unit_memory",idColumn:"unit_key",eligible:"1 = 1"},Ga=(e,t=0)=>{let r=us(e),n=ls(e)[t];if(!r||!n)return null;let o=p("SELECT * FROM words WHERE id = ?",[n.wordId])[0];if(!o)return null;let s=String(o.kanji??"");return{unit:r,exampleWordId:n.wordId,exampleWord:o,targetSegment:{start:n.start,length:n.length,text:s.slice(n.start,n.start+n.length)},actualReading:n.reading,variant:n.variant}},BA=(e,t)=>{let r=new Set(p(`PRAGMA table_info(${e})`).map(o=>String(o.name??""))),n=(0,Kt.getDatabase)();for(let[o,s]of Object.entries(t))r.has(o)||n.run(`ALTER TABLE ${e} ADD COLUMN ${o} ${s}`)},Gt=()=>{let e=(0,Kt.getDatabase)();e.run(`
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
      fsrs_params_version TEXT NOT NULL DEFAULT '${xr}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(unit_key) REFERENCES kanji_units(unit_key)
    )
  `),BA("kanji_unit_memory",{fsrs_stability:"REAL",fsrs_difficulty:"REAL",fsrs_due:"TEXT",fsrs_last_review:"TEXT",fsrs_state:"INTEGER",fsrs_steps:"INTEGER",fsrs_reps:"INTEGER",fsrs_lapses:"INTEGER"}),j(Ka)},RT=()=>{Gt();let e=pt();if(!e.length)return 0;let t=(0,Kt.getDatabase)();if(E("SELECT COUNT(*) FROM kanji_units",[],0)>=e.length)return 0;let n=!1;try{t.run("BEGIN"),n=!0}catch{n=!1}let o=0;try{let s=JSON.stringify(e.map(i=>[i.unitKey,i.unitType,i.char,i.base,i.surface,i.reading,JSON.stringify(i.kinds)]));t.run(`
      INSERT OR IGNORE INTO kanji_units
        (unit_key, unit_type, char, base, surface, reading, kinds)
      SELECT value ->> '$[0]', value ->> '$[1]', value ->> '$[2]', value ->> '$[3]',
             value ->> '$[4]', value ->> '$[5]', value ->> '$[6]'
      FROM json_each(?) ORDER BY CAST(key AS INTEGER)
    `,[s]),o=t.getRowsModified(),t.run(`
      INSERT OR IGNORE INTO kanji_unit_memory (unit_key)
      SELECT value ->> '$[0]' FROM json_each(?) ORDER BY CAST(key AS INTEGER)
    `,[s]),n&&t.run("COMMIT")}catch(s){throw n&&t.run("ROLLBACK"),s}return o},fm=(e,t)=>{if(!us(e))return 0;let n=Jn(e),o=n.length,s=0,i=0;for(let d of n){i+=t.wordMeta.get(d)?.importance??0;let u=t.unitsByWord.get(d);u&&u.every(l=>l===e||t.knownUnits.has(l))&&(s+=1)}let a=n.length?i/n.length:0;return o+s*3+a*.5},XA=(e,t,r)=>e<r?50:t[e]??100+e,bT=()=>{let e=new Map;for(let t of pt())for(let r of Jn(t.unitKey)){let n=e.get(r);n?n.push(t.unitKey):e.set(r,[t.unitKey])}return e},hs=(e=T(),t=Tm())=>{if(t<=0)return{units:[],reviewCount:0,newCount:0,crowdedOut:!1};RT();let r=(0,Kt.getDatabase)(),n=p("SELECT unit_key FROM kanji_unit_tasks WHERE reviewed_on = ? ORDER BY order_index",[e]).map(y=>String(y.unit_key));if(n.length){let y=new Set(p(`
      SELECT t.unit_key FROM kanji_unit_tasks t
      JOIN kanji_unit_memory m ON m.unit_key = t.unit_key
      WHERE t.reviewed_on = ? AND COALESCE(m.seen_count, 0) > 0
    `,[e]).map(_=>String(_.unit_key)));return{units:n,reviewCount:n.filter(_=>y.has(_)).length,newCount:n.filter(_=>!y.has(_)).length,crowdedOut:!1}}let o=new Map;p(`
    SELECT w.id, COALESCE(w.importance, 0) AS importance, COALESCE(p.seen_count, 0) AS seen
    FROM words w LEFT JOIN progress p ON p.word_id = w.id
  `).forEach(y=>o.set(Number(y.id),{seen:Number(y.seen??0),importance:Number(y.importance??0)}));let s=bT(),i=new Set(p("SELECT unit_key FROM kanji_unit_memory WHERE COALESCE(seen_count, 0) > 0").map(y=>String(y.unit_key))),a={wordMeta:o,knownUnits:i,unitsByWord:s},d=(y,_)=>fm(_,a)-fm(y,a)||y.localeCompare(_,"ja"),l=p(`
    SELECT m.unit_key
    FROM kanji_unit_memory m
    LEFT JOIN kanji_unit_flags f ON f.unit_key = m.unit_key
    WHERE COALESCE(f.known_forever, 0) = 0
      AND COALESCE(m.seen_count, 0) > 0
      AND (m.fsrs_due IS NULL OR m.fsrs_due <= ?)
  `,[A().toISOString()]).map(y=>String(y.unit_key)).sort(d).slice(0,t),c=zr("kanji"),f=gg("kanji"),m=y=>XA(us(y)?.levelRank??5,c,f),g=Math.max(t-l.length,0),S=g>0?p(`
        SELECT m.unit_key
        FROM kanji_unit_memory m
        LEFT JOIN kanji_unit_flags f ON f.unit_key = m.unit_key
        WHERE COALESCE(f.known_forever, 0) = 0
          AND COALESCE(m.seen_count, 0) = 0
      `).map(y=>String(y.unit_key)).sort((y,_)=>m(y)-m(_)||d(y,_)).slice(0,g):[],w=[...l,...S];return w.forEach((y,_)=>r.run(`
    INSERT OR IGNORE INTO kanji_unit_tasks (reviewed_on, unit_key, order_index)
    VALUES (?, ?, ?)
  `,[e,y,_+1])),{units:w,reviewCount:l.length,newCount:S.length,crowdedOut:S.length===0&&l.length>=t&&YA()}},YA=()=>E(`
  SELECT COUNT(*) FROM kanji_unit_memory m
  LEFT JOIN kanji_unit_flags f ON f.unit_key = m.unit_key
  WHERE COALESCE(f.known_forever, 0) = 0 AND COALESCE(m.seen_count, 0) = 0
`,[],0)>0,Sm=(e=T(),t=new Set)=>(Gt(),p(`
    SELECT t.unit_key
    FROM kanji_unit_tasks t
    JOIN kanji_unit_memory m ON m.unit_key = t.unit_key
    LEFT JOIN kanji_unit_flags f ON f.unit_key = t.unit_key
    WHERE t.reviewed_on = ?
      AND COALESCE(f.known_forever, 0) = 0
      AND (m.fsrs_due IS NULL OR m.fsrs_due <= ?)
    ORDER BY t.order_index ASC
  `,[e,new Date().toISOString()]).map(n=>String(n.unit_key)).find(n=>!t.has(n))??null),ym=(e=T())=>{Gt();let t=A();hs(e);let r=E("SELECT COUNT(*) FROM kanji_unit_tasks WHERE reviewed_on = ?",[e],0),n=E(`
    SELECT COUNT(*)
    FROM kanji_unit_tasks t
    JOIN kanji_unit_memory m ON m.unit_key = t.unit_key
    LEFT JOIN kanji_unit_flags f ON f.unit_key = t.unit_key
    WHERE t.reviewed_on = ?
      AND (COALESCE(f.known_forever, 0) = 1 OR m.fsrs_due > ?)
  `,[e,t.toISOString()],0);return{total:r,completed:Math.min(r,n)}},LT=(e,t,r)=>{let n=t==="know"?[1,1,0,0]:t==="fuzzy"?[1,0,1,0]:[1,0,0,1],o=E("SELECT mistake_streak FROM kanji_unit_memory WHERE unit_key = ?",[e],0),s=t==="forgot"?o+1:0;(0,Kt.getDatabase)().run(`
    UPDATE kanji_unit_memory
    SET seen_count = seen_count + ?, right_count = right_count + ?,
        fuzzy_count = fuzzy_count + ?, forgot_count = forgot_count + ?,
        mistake_streak = ?, last_seen_on = ?
    WHERE unit_key = ?
  `,[...n,s,r,e])},OT=(e,t,r=T())=>E("SELECT COUNT(*) FROM kanji_unit_reviews WHERE unit_key = ? AND reviewed_on = ?",[e,r],0)===0&&t==="know"?"known":E(`SELECT COUNT(*) FROM kanji_unit_reviews
     WHERE unit_key = ? AND reviewed_on = ? AND answer IN ('forgot','fuzzy')`,[e,r],0)+(t==="forgot"||t==="fuzzy"?1:0)>=Ue?"stubborn":"normal",Nm=(e,t,r=new Date,n)=>{if(Gt(),!E("SELECT COUNT(*) FROM kanji_units WHERE unit_key = ?",[e],0))throw new Error(`Unknown kanji unit: ${e}`);n??(n=OT(e,t));let s=Oe(e,t,r,{mode:n},Ka),i=T();return LT(e,t,i),(0,Kt.getDatabase)().run(`
    INSERT INTO kanji_unit_reviews
      (unit_key, answer, reviewed_on, reviewed_at, scheduler_mode, fsrs_params_version)
    VALUES (?, ?, ?, ?, ?, ?)
  `,[e,t,i,r.getTime(),n,xr]),s},zA=e=>{Gt();let t=e?[...new Set([...e])]:p("SELECT DISTINCT unit_key FROM kanji_unit_reviews").map(n=>String(n.unit_key)),r=0;for(let n of t){let o=p(`
      SELECT answer, reviewed_on, reviewed_at, scheduler_mode
      FROM kanji_unit_reviews
      WHERE unit_key = ?
      ORDER BY reviewed_at ASC, id ASC
    `,[n]);if(o.length){(0,Kt.getDatabase)().run(`
      UPDATE kanji_unit_memory
      SET seen_count = 0, right_count = 0, fuzzy_count = 0, forgot_count = 0,
          mistake_streak = 0, last_seen_on = NULL,
          fsrs_stability = NULL, fsrs_difficulty = NULL, fsrs_due = NULL,
          fsrs_last_review = NULL, fsrs_state = NULL, fsrs_steps = NULL,
          fsrs_reps = NULL, fsrs_lapses = NULL
      WHERE unit_key = ?
    `,[n]);for(let s of o){let i=String(s.answer);if(i!=="forgot"&&i!=="fuzzy"&&i!=="know")continue;let a=Number(s.reviewed_at),d=Number.isFinite(a)?new Date(a):new Date(`${String(s.reviewed_on)}T12:00:00`);Oe(n,i,d,{mode:String(s.scheduler_mode??"normal")},Ka),LT(n,i,String(s.reviewed_on??T()))}r+=1}}return r},Rm=(e,t)=>{Gt(),(0,Kt.getDatabase)().run(`
    INSERT INTO kanji_unit_flags (unit_key, known_forever, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(unit_key) DO UPDATE SET known_forever = excluded.known_forever, updated_at = excluded.updated_at
  `,[e,t?1:0])}});function Ce(e="stage1",t={},r={}){X();let n=T(),o=ia(t,"w");pn();let s=oo(),i=dr();As();let a=so(),d={completed:s.completed+i.completed+a.completed,total:s.total+i.total+a.total},u=i.total>0&&i.completed>=i.total,l=u&&s.pending===0&&a.pending===0,c=Math.max(d.total-d.completed,0),f=we(()=>E(`
    SELECT COUNT(*)
    FROM words w
    JOIN progress p ON p.word_id = w.id
    WHERE ${oe()} ${o.clause}
  `,o.params,0)),m=we(()=>E(`
    SELECT COUNT(*)
    FROM progress p
    JOIN words w ON w.id = p.word_id
    WHERE p.known_forever = 1 ${o.clause}
  `,o.params,0)),g=we(()=>E("SELECT COUNT(DISTINCT word_id) FROM reviews WHERE reviewed_on = ? AND direction = 'forward'",[n],0)),S=we(()=>E(`
    SELECT COUNT(*)
    FROM progress p
    JOIN words w ON w.id = p.word_id
    WHERE p.known_forever = 0 AND ${J()}
      AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?) ${o.clause}
      AND ${te("words","p.word_id")}
  `,[A().toISOString(),...o.params],0)),w=we(()=>E(`
    SELECT COUNT(*)
    FROM progress p
    JOIN words w ON w.id = p.word_id
    WHERE ${ye()} ${o.clause}
    `,o.params,0)),y=we(()=>({poolSize:E(`
      SELECT COUNT(*)
      FROM progress p
      WHERE p.known_forever = 0 AND ${Gn("p")}
    `,[],0),answeredToday:E(`
      SELECT COUNT(DISTINCT r.word_id)
      FROM reviews r
      JOIN progress p ON p.word_id = r.word_id
      WHERE r.reviewed_on = ? AND r.direction = 'forward' AND ${Gn("p")}
    `,[n],0)})),_=we(()=>no(Ns)),b=we(()=>r.kanjiUnits??(Er()&&Ge())?ym():no(Rs)),k=we(()=>mc(At)),C=we(()=>pc(At)),L=we(()=>Ia((0,AT.getDatabase)())),I=we(()=>c+k()+L().kanjiRemaining+L().confusionRemaining),x=we(()=>Math.max(_().total-_().completed,0)),U=we(()=>Math.max(b().total-b().completed,0)),F=we(()=>Fa().remaining),K={classic:c,get mixed(){return I()},get mistakes(){return y().poolSize},quick:c,get reverse(){return x()},get kanji(){return U()},get picked(){return F()}},Q=we(()=>p("SELECT checked_on FROM checkins ORDER BY checked_on").map(rt=>String(rt.checked_on??""))),Z=we(()=>E("SELECT seconds FROM word_study_time WHERE studied_on = ?",[n],0)),v=we(()=>{let rt=ua(n),{secondsPerWord:Kr}=oa(n),_t=g()>0&&Z()>0?Math.min(Math.max(Z()/g(),6),60):Kr,df=Qo(rt),cR=Math.max(Math.round(Zt()/2),5),Qd=df>0?df:Math.min(cR,w()),uf=Kn(n);return{available:Qd>0&&!ko(),size:Qd,estimatedMinutes:zl(Qd,_t),remaining:rt,unseenRemaining:w(),secondsPerWord:_t,totalLearned:E(`SELECT COUNT(*) FROM progress p
         WHERE p.known_forever = 1
           OR EXISTS (SELECT 1 FROM reviews r WHERE r.word_id=p.word_id AND r.direction='forward')
           OR (p.seen_count > 0 AND NOT EXISTS (
             SELECT 1 FROM level_prior_baselines b WHERE b.entity='words' AND b.entity_key=CAST(p.word_id AS TEXT)
           ))`,[],0),weekEncoreCount:uf.weekCount,todayEncoreWords:uf.dayWords,fatigued:es(n)}}),ae=we(()=>E(`
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
      AND NOT ${fe("words","today_reviews.word_id")}
    `,[n,n],0));return{get encore(){return v()},dailyRelief:s,get total(){return f()},get knownForever(){return m()},get masteredToday(){return E(`SELECT COUNT(DISTINCT r.word_id)
         FROM reviews r
         JOIN progress p ON p.word_id = r.word_id
         WHERE r.reviewed_on = ?
           AND r.direction = 'forward'
           AND (p.known_forever = 1 OR ${ge})`,[n],0)},get reviewedToday(){return g()},get lowCount(){return S()},get unseenCount(){return w()},get newToday(){return ae()},get oldToday(){return Math.max(0,g()-ae())},get newQuota(){return Ot()},get mistakes(){return y()},modeCounts:K,get grammarRemaining(){return k()},get grammarDone(){return C()},get kanjiCardRemaining(){return L().kanjiRemaining},get kanjiCardDone(){return L().kanjiDone},get confusionCardRemaining(){return L().confusionRemaining},get confusionCardDone(){return L().confusionDone},stage1ProgressDone:d.completed,stage1ProgressTotal:d.total,stage1NewDone:i.newLane.done,stage1NewTotal:i.newLane.total,stage1ReviewDone:i.reviewLane.done+s.completed+a.completed,stage1ReviewTotal:i.reviewLane.total+s.total+a.total,phase:e,stage1Done:u,dailyPlanDone:l,get stage2Total(){return _().total},get stage2Completed(){return _().completed},get kanjiTotal(){return b().total},get kanjiCompleted(){return b().completed},studyDate:n,get checkins(){return Q()},get dailyStudyStats(){return VA(n)},get wordStudySecondsToday(){return Z()},get taskDone(){return b().total>0?b().completed>=b().total:_().total>0?_().completed>=_().total:l}}}var AT,VA,we,bm=h(()=>{"use strict";He();Se();ds();St();Re();AT=N($(),1);ys();G();Lt();un();Wt();Mr();sm();Ls();am();ns();Os();Ha();ne();ks();Ur();VA=(e=T())=>{let t=new Map,r=n=>{let o=t.get(n);return o||(o={date:n,seconds:0,wordCount:0,grammarCount:0,reliefCount:0,total:0},t.set(n,o)),o};p(`
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
  `,[e,e]).forEach(n=>{let o=String(n.reviewed_on??"");o&&(r(o).grammarCount=Number(n.grammar_count??0))}),p("SELECT checked_on FROM checkins ORDER BY checked_on").forEach(n=>{let o=String(n.checked_on??"");o&&r(o)});for(let n of t.values())(n.date===e||n.wordCount>0)&&(n.reliefCount=fT(n.date)),n.total=n.wordCount+n.grammarCount+n.reliefCount;return Array.from(t.values()).sort((n,o)=>n.date.localeCompare(o.date))},we=e=>{let t=null;return()=>(t??(t={value:e()})).value}});var qA,hT,kT=h(()=>{"use strict";yt();ir();G();ns();Wt();qA=e=>{let t=Number(e.fsrs_lapses??0),r=Number(e.fsrs_difficulty??0),n=Math.max(Number(e.fsrs_stability??0),0),o=Number(e.forgot_count??0),s=Number(e.fuzzy_count??0),i=Number(e.right_count??0),a=o*2+s,d=a/Math.max(i+a,1);return t*100+r*8+d*50-Math.min(n,365)*.03},hT=()=>{let e=T(),t=A().toISOString(),r=p(`
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
      AND ${Gn("p")}
      AND (
        p.last_seen_on IS NULL
        OR p.last_seen_on <> ?
        OR p.fsrs_due IS NULL
        OR p.fsrs_due <= ?
      )
  `,[e,t]);if(!r.length)return null;let n=new Map(_e().map(c=>[c.word_id,c.due_after])),o=Fe(),s=r.find(c=>Number(c.id)===o),i=Ft({mistakeStreak:Number(s?.mistake_streak??0),remaining:r.length,total:r.length}),d=(r.length>1&&!i?r.filter(c=>Number(c.id)!==o):r).map(c=>({row:c,dueAfter:n.get(Number(c.id))??0,risk:qA(c)})),u=d.filter(c=>c.dueAfter<=0),l=u.length?u:d;return l.sort((c,f)=>u.length?f.risk-c.risk:c.dueAfter-f.dueAfter||f.risk-c.risk),l[0]?re(l[0].row):null}});var Lm,vT,CT,DT=h(()=>{"use strict";Lm=N($(),1);G();ne();Ke();ir();Wt();Ls();ma();zn();Re();vT=(e,t,r)=>{mn(e);let n=(0,Lm.getDatabase)(),o=e.entity.table,s=T(),i=H(`SELECT * FROM ${o} WHERE word_id = ?`,[t]);i||n.run(`INSERT OR IGNORE INTO ${o} (word_id, seen_count) VALUES (?, 0)`,[t]);let a={phase:e.phase,mode:e.phase,direction:e.id,reviewed_on:s,word_id:t,memory_exists:!!i,known_forever:Number(E("SELECT known_forever FROM progress WHERE word_id = ?",[t],0)??0),last_answered_word:Fe(e.id),seen_count:Number(i?.seen_count??0),right_count:Number(i?.right_count??0),fuzzy_count:Number(i?.fuzzy_count??0),forgot_count:Number(i?.forgot_count??0),mistake_streak:Number(i?.mistake_streak??0),last_seen_on:i?.last_seen_on??null,fsrs:Rt(t,e.entity),review_queue:_e(e.id)};Bn(t,e.id);let d=Number(i?.right_count??0),u=Number(i?.fuzzy_count??0),l=Number(i?.forgot_count??0),c=Number(i?.mistake_streak??0),f=r==="known_forever";f?(n.run("UPDATE progress SET known_forever = 1 WHERE word_id = ?",[t]),c=0):(d+=r==="know"?1:0,u+=r==="fuzzy"?1:0,l+=r==="forgot"?1:0,c=r==="know"?0:c+1);let g=E(`SELECT COUNT(*) FROM reviews
     WHERE word_id = ? AND reviewed_on = ? AND direction = ? AND answer IN ('forgot','fuzzy')`,[t,s,e.id],0)+(r==="forgot"||r==="fuzzy"?1:0)>=Ue,w=E("SELECT COUNT(*) FROM reviews WHERE word_id = ? AND reviewed_on = ? AND direction = ?",[t,s,e.id],0)===0&&r==="know"?"known":g?"stubborn":"normal",y=!1,_=!1,b=0;if(!f)try{let C=Oe(t,r,new Date,{mode:w},e.entity);y=Nt(C,A()),b=Math.max((new Date(C.due).getTime()-Date.now())/6e4,0),_=!y&&Nt(Ze(C,"know",new Date,{mode:g?"stubborn":"normal"}),A())}catch(C){console.warn(`[fsrs] ${e.label}\u8BB0\u5F55\u8DF3\u8FC7:`,C),y=r==="know"}!y&&!f&&Xn(t,b,c>=lt,_,e.id),ar(t,e.id),n.run(`
    UPDATE ${o}
    SET seen_count = COALESCE(seen_count, 0) + 1,
        last_seen_on = ?,
        right_count = ?,
        fuzzy_count = ?,
        forgot_count = ?,
        mistake_streak = ?
    WHERE word_id = ?
  `,[s,d,u,l,c,t]);let k=Yn({wordId:t,answer:r,reviewedOn:s,direction:e.id,schedulerMode:w});ca({...a,review_id:k})},CT=(e,t)=>{mn(e);let r=(0,Lm.getDatabase)(),n=Number(t.word_id);r.run(`
    UPDATE ${e.entity.table}
    SET seen_count = ?, right_count = ?, fuzzy_count = ?, forgot_count = ?,
        mistake_streak = ?, last_seen_on = ?
    WHERE word_id = ?
  `,[Number(t.seen_count??0),Number(t.right_count??0),Number(t.fuzzy_count??0),Number(t.forgot_count??0),Number(t.mistake_streak??0),t.last_seen_on??null,n]),on(n,t.fsrs??null,e.entity),r.run("UPDATE progress SET known_forever = ? WHERE word_id = ?",[Number(t.known_forever??0),n]),Array.isArray(t.review_queue)&&et(t.review_queue.flatMap(o=>{if(!o||typeof o!="object")return[];let s=o,i=Number(s.word_id);return Number.isFinite(i)?[{word_id:i,due_after:Math.max(Number(s.due_after??0),0)}]:[]}),e.id),t.last_answered_word!=null&&ar(Number(t.last_answered_word),e.id),t.review_id!=null&&(r.run("DELETE FROM reviews WHERE id = ?",[Number(t.review_id)]),br("words",n))}});var IT,MT,Am,xT,hm,Om,UT,JA,km,FT,WT,jT,$T,PT=h(()=>{"use strict";G();Lt();yt();En();IT=3,MT="daily_review_v2",Am=()=>{let e={studyDate:T(),rounds:0,invites:0,lastRoundAnswerCount:0,snoozeUntilAnswerCount:0,declined:!1};try{let t=JSON.parse(O(MT,"{}"));return t.studyDate===e.studyDate?{...e,...t}:e}catch{return e}},xT=e=>{R(MT,JSON.stringify(e)),D()},hm=()=>Number(E("SELECT COUNT(*) FROM reviews WHERE reviewed_on = ?",[T()],0)),Om=`(
  SELECT COUNT(*)
  FROM reviews today_reviews
  WHERE today_reviews.word_id = t.word_id
    AND today_reviews.reviewed_on = ?
    AND today_reviews.direction = 'forward'
)`,UT="(p.known_forever = 0 AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?))",JA=()=>{let e=T(),t=A().toISOString();return p(`
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
      ${Om} AS today_seen_count,
      COALESCE(n.note, '') AS note
    FROM stage1_tasks t
    JOIN words w ON w.id = t.word_id
    JOIN progress p ON p.word_id = t.word_id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE t.reviewed_on = ?
      AND ${UT}
      AND ${Om} >= ${IT}
    ORDER BY today_seen_count DESC, COALESCE(p.fsrs_lapses, 0) DESC, p.fsrs_due ASC, w.id ASC
    LIMIT 8
  `,[e,e,t,e])},km=()=>Number(E(`
  SELECT COUNT(*) FROM stage1_tasks t
  JOIN words w ON w.id = t.word_id
  JOIN progress p ON p.word_id = t.word_id
  WHERE t.reviewed_on = ? AND ${UT}
    AND ${Om} >= ${IT}
`,[T(),A().toISOString(),T()],0)),FT=()=>JA().map(re),WT=()=>{let e=Am();if(e.declined||e.rounds>=2)return!1;let t=hm();return t<e.snoozeUntilAnswerCount||e.rounds===1&&t-e.lastRoundAnswerCount<30||es()?!1:km()>=5},jT=()=>{let e=Am(),t=e.invites+1;xT({...e,invites:t,declined:t>=2,snoozeUntilAnswerCount:t>=2?0:hm()+20})},$T=()=>{let e=Am();xT({...e,rounds:e.rounds+1,lastRoundAnswerCount:hm(),invites:0,snoozeUntilAnswerCount:0})}});function vm(){let e=E("SELECT value FROM app_state WHERE key = ?",[GT],null);if(e!=null)try{return JSON.parse(String(e))}catch{return HT()}return HT()}function HT(){return{memoryStrength:1,firstTimeCorrectRate:.5,retentionRate7Days:.5,avgReviewsToMaster:10,totalReviews:0,lastUpdated:new Date().toISOString()}}function e0(e){(0,KT.getDatabase)().run(`
    INSERT OR REPLACE INTO app_state (key, value)
    VALUES (?, ?)
  `,[GT,JSON.stringify(e)])}function t0(){let e=B(),t=p(`
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
  `,[e,e])[0];if(!t)return .5;let r=Number(t.correct??0),n=Number(t.total??0);return n===0?.5:r/n}function r0(){j();let e=p(`
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
  `)[0];if(!e)return .5;let t=Number(e.retained??0),r=Number(e.total??0);return r===0?.5:t/r}function n0(){j();let e=E(`
    SELECT
      AVG(review_count) AS avg_reviews
    FROM (
      SELECT p.word_id, COUNT(r.id) AS review_count
      FROM progress p
      JOIN reviews r ON r.word_id = p.word_id AND r.direction = 'forward'
      WHERE p.known_forever = 1 OR ${ge}
      GROUP BY p.word_id
    )
  `,[],null);return Number(e)||10}function o0(){return E("SELECT COUNT(*) FROM reviews WHERE direction = 'forward'",[],0)}function s0(e,t,r){let n=e*.3,o=t*.4,s=Math.min(1,5/r)*.3;return .5+(n+o+s)*1.5}function BT(){let e=vm(),t=o0();if(t<QA||t-e.totalReviews<ZA)return;let n=t0(),o=r0(),s=n0(),i=s0(n,o,s),a={memoryStrength:i,firstTimeCorrectRate:n,retentionRate7Days:o,avgReviewsToMaster:s,totalReviews:t,lastUpdated:new Date().toISOString()};e0(a),console.log("\u{1F4CA} \u8BB0\u5FC6\u753B\u50CF\u5DF2\u66F4\u65B0:",{memoryStrength:i.toFixed(2),firstTimeCorrectRate:(n*100).toFixed(1)+"%",retentionRate7Days:(o*100).toFixed(1)+"%",avgReviewsToMaster:s.toFixed(1)})}function XT(e){return e>=1.5?"\u4F18\u79C0":e>=1.2?"\u826F\u597D":e>=.8?"\u6B63\u5E38":"\u9700\u52A0\u5F3A"}var KT,GT,QA,ZA,YT=h(()=>{"use strict";KT=N($(),1);ne();P();GT="user_memory_profile",QA=100,ZA=50});var Dm={};M(Dm,{getEfficiencyAnalytics:()=>JT,getErrorAnalytics:()=>qT,getMasteryAnalytics:()=>VT,getStudyAnalytics:()=>Cm,getStudyTimeAnalytics:()=>zT});function zT(){let e=B(),t=p(`
    SELECT
      studied_on AS date,
      CAST(seconds / 60.0 AS INTEGER) AS minutes,
      0 AS wordCount
    FROM word_study_time
    WHERE studied_on BETWEEN date(?, '-30 days') AND ?
    ORDER BY studied_on DESC
  `,[e,e]).map(u=>({date:String(u.date),minutes:Number(u.minutes??0),wordCount:0})),r=E("SELECT SUM(seconds) FROM word_study_time",[],0),n=Math.floor(r/3600),o=p(`
    SELECT checked_on FROM checkins ORDER BY checked_on DESC
  `).map(u=>String(u.checked_on)),s=0,i=B();for(let u=0;u<o.length;u++){let l=new Date(i);l.setDate(l.getDate()-u);let c=l.toISOString().slice(0,10);if(o[u]===c)s++;else break}let a=t.length>0?Math.round(t.reduce((u,l)=>u+l.minutes,0)/t.length):0;return{dailyMinutes:t,bestTimeOfDay:[],totalHours:n,streakDays:s,avgDailyMinutes:a}}function VT(){let e=i0(),t=p(`
    SELECT
      COALESCE(w.jlpt_level, '\u672A\u5206\u7EA7') AS level,
      COUNT(*) AS total,
      SUM(CASE WHEN ${e} THEN 1 ELSE 0 END) AS studied,
      SUM(CASE WHEN ${e} AND (p.known_forever = 1 OR ${ge}) THEN 1 ELSE 0 END) AS mastered,
      SUM(CASE WHEN ${e} AND NOT (p.known_forever = 1 OR ${ge})
        AND COALESCE(p.fsrs_lapses, 0) = 0 THEN 1 ELSE 0 END) AS learning,
      SUM(CASE WHEN ${e} AND NOT (p.known_forever = 1 OR ${ge})
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
      SUM(CASE WHEN p.known_forever = 1 OR ${ge} THEN 1 ELSE 0 END) AS masteredCount
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
    )`,[B(),B()],10);return t.forEach(s=>{let i=s.total-s.mastered,a=o>0?Math.ceil(i/o):999;n[s.level]=a}),{byLevel:t,byPartOfSpeech:r,estimatedDaysToComplete:n}}function qT(){let e=p(`
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
  `),r={forgot:Number(t?.forgot??0),fuzzy:Number(t?.fuzzy??0),know:Number(t?.know??0)};return{mostDifficultWords:e,errorTypeDistribution:r}}function JT(){let e=E(`SELECT AVG(review_count) FROM (
      SELECT p.word_id, COUNT(r.id) AS review_count
      FROM progress p
      JOIN reviews r ON r.word_id = p.word_id AND r.direction = 'forward'
      WHERE p.known_forever = 1 OR ${ge}
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
  `),i=Number(s?.sample_size??0),a=i>0?Number(s?.retained??0)/i:0;BT();let u=vm().memoryStrength,l=XT(u),c="stable";i>0&&a>.7?c="improving":i>0&&a<.4&&(c="declining");let f=E("SELECT COUNT(*) FROM reviews WHERE direction = 'forward'",[],0);return{avgReviewsToMaster:e==null?0:Math.round(e*10)/10,newWordsPerHour:o,retentionRate7Days:Math.round(a*100),retentionSampleSize:i,efficiencyTrend:c,memoryStrength:Math.round(u*100)/100,memoryStrengthLabel:l,memorySampleSize:f}}function Cm(){return j(),{studyTime:zT(),mastery:VT(),errors:qT(),efficiency:JT(),generatedAt:new Date().toISOString()}}var i0,Im=h(()=>{"use strict";P();YT();ne();He();i0=()=>`(p.known_forever = 1 OR EXISTS (
    SELECT 1 FROM reviews r WHERE r.word_id = w.id AND r.direction = 'forward'
  ) OR (p.seen_count > 0${E("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='level_prior_baselines'",[],0)>0?` AND NOT EXISTS (
    SELECT 1 FROM level_prior_baselines b WHERE b.entity='words' AND b.entity_key=CAST(p.word_id AS TEXT)
  )`:""}))`});var Gm={};M(Gm,{FOLDER_NAME_MAX:()=>QT,UNFILED_FOLDER:()=>gn,addFavorite:()=>vs,addFavorites:()=>Pm,createFavoriteFolder:()=>Fm,deleteFavoriteFolder:()=>jm,getFavoriteItems:()=>Km,lastFavoriteFolder:()=>xm,listFavoriteFolders:()=>Mm,renameFavoriteFolder:()=>Wm,setFavoriteFolder:()=>$m,toggleFavorite:()=>Hm,unfiledFavoriteCount:()=>Um});function Mm(){return V(),p(`
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
  `).map(t=>({name:String(t.name??""),count:Number(t.n??0)}))}function xm(){return V(),O(eS,gn)}function Um(){return V(),E("SELECT COUNT(*) FROM content_favorites WHERE folder = ''",[],0)}function Fm(e){V();let t=ZT(e);return t?((0,fn.getDatabase)().run("INSERT OR IGNORE INTO favorite_folders (name) VALUES (?)",[t]),D(),t):""}function Wm(e,t){V();let r=ZT(t);if(!r||r===e)return e;let n=(0,fn.getDatabase)();return n.run("INSERT OR IGNORE INTO favorite_folders (name) VALUES (?)",[r]),n.run("DELETE FROM favorite_folders WHERE name = ?",[e]),n.run("UPDATE content_favorites SET folder = ? WHERE folder = ?",[r,e]),D(),r}function jm(e){V();let t=(0,fn.getDatabase)();t.run("UPDATE content_favorites SET folder = '' WHERE folder = ?",[e]),t.run("DELETE FROM favorite_folders WHERE name = ?",[e]),D()}function $m(e,t,r){V(),(0,fn.getDatabase)().run("UPDATE content_favorites SET folder = ? WHERE item_type = ? AND item_id = ?",[r,e,String(t)]),D()}function vs(e,t,r=gn){V();let n=(0,fn.getDatabase)(),o=String(t);n.run("INSERT OR IGNORE INTO content_favorites (item_type, item_id, folder) VALUES (?, ?, ?)",[e,o,r]),n.run("UPDATE content_favorites SET folder = ? WHERE item_type = ? AND item_id = ?",[r,e,o]),R(eS,r),D()}function Pm(e,t,r=gn){return t.forEach(n=>vs(e,n,r)),t.length}function Hm(e,t,r=gn){V();let n=String(t);return xo(e,n)?((0,fn.getDatabase)().run("DELETE FROM content_favorites WHERE item_type = ? AND item_id = ?",[e,n]),D(),{isFavorite:!1}):(vs(e,n,r),{isFavorite:!0})}function Km(e="all",t){V();let r=[],n=[];return e!=="all"&&(r.push("item_type = ?"),n.push(e)),t!==void 0&&(r.push("folder = ?"),n.push(t)),p(`
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
      `,[a]);return u?[{type:i,id:a,folder:d,title:String(u.prompt||u.pattern||""),subtitle:String(u.meaning??""),meta:`${String(u.level??"")} \xB7 ${String(Number(u.level_ordinal??0)).padStart(3,"0")}`}]:[{type:i,id:a,folder:d,title:"",subtitle:"",meta:""}]}return[]})}var fn,gn,QT,ZT,eS,Bm=h(()=>{"use strict";fn=N($(),1);G();gn="",QT=20,ZT=e=>e.replace(/\s+/g," ").trim().slice(0,QT);eS="favorite_last_folder"});var Xm,tS,rS,nS,oS=h(()=>{"use strict";G();Ke();Xm=8,tS=(e=B())=>p(`
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
  `,[e,e,Xm,Ue]).map(t=>({id:Number(t.id??0),kanji:String(t.kanji??""),kana:String(t.kana??""),meaning:String(t.meaning??""),lapses:Number(t.lapses??0),wrongToday:Number(t.wrong_today??0),isFavorite:Number(t.favorited??0)===1})),rS=(e=B())=>p(`
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
  `,[e,e,Xm,Ue]).map(t=>({id:Number(t.id??0),pattern:String(t.pattern??""),meaning:String(t.meaning??""),level:String(t.level??""),lapses:Number(t.lapses??0),wrongToday:Number(t.wrong_today??0)})),nS=(e=60)=>{let t=B(),r=s=>new Map(p(s,[t,Ue,Xm]).map(i=>[String(i.day??""),Number(i.n??0)])),n=r(`
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
  `);return[...new Set([...n.keys(),...o.keys()])].sort((s,i)=>s<i?1:-1).slice(0,e).map(s=>({date:s,words:n.get(s)??0,grammar:o.get(s)??0}))}});var tp={};M(tp,{UNFILED_FOLDER:()=>gn,addAnswerPreview:()=>I0,addFavorite:()=>vs,addFavorites:()=>Pm,addWordStudySeconds:()=>P0,addWordToTodayEncore:()=>E0,addWordsToQueue:()=>f0,advanceDailyRelief:()=>ET,advanceDailyTail:()=>TT,answerPreviewsFresh:()=>M0,completeTodayWordPlan:()=>c0,continueKanjiStudy:()=>v0,continueStage2Study:()=>k0,continueTodayPlanStudy:()=>h0,createFavoriteFolder:()=>Fm,dailyReviewBatch:()=>FT,dailyReviewCandidateCount:()=>km,declineDailyReviewInvite:()=>jT,deleteFavoriteFolder:()=>jm,ensureDailyRelief:()=>pn,ensureDailyTail:()=>As,ensureProgressInitialized:()=>X,getDailyReliefNext:()=>pT,getDailyReliefProgress:()=>oo,getDailyReviewCard:()=>Bt,getDailyTailNext:()=>wT,getDailyTailProgress:()=>so,getFavoriteItems:()=>Km,getGrammarPointFavorite:()=>qu,getQuickStudySession:()=>b0,getQuickStudySessionForWords:()=>O0,getReviewQueue:()=>_e,getStubbornGrammarToday:()=>rS,getStubbornHistoryDays:()=>nS,getStubbornWordsToday:()=>tS,getStudyAnalytics:()=>Cm,getWordSession:()=>je,getWordStats:()=>Ce,jumpToSimilarWord:()=>R0,lastFavoriteFolder:()=>xm,listFavoriteFolders:()=>Mm,markTodayWordCheckin:()=>m0,markWordKnownForever:()=>T0,pickedProgress:()=>Fa,questionMeaningRivals:()=>j0,recordStubbornQuickStudy:()=>L0,refreshTodayWordPlan:()=>zm,renameFavoriteFolder:()=>Wm,rewindDailyTail:()=>ST,setFavoriteFolder:()=>$m,setReviewQueue:()=>et,setWordsKnownForever:()=>Vm,setWordsKnownForeverIds:()=>dS,shouldInviteDailyReview:()=>WT,startAnswerPreviews:()=>D0,startDailyReviewRound:()=>$T,startEncore:()=>p0,startPickedStudy:()=>y0,submitKanjiUnitAnswer:()=>C0,submitQuickStudyBatch:()=>A0,submitWordAnswer:()=>Jm,submitWordAnswerWithPreview:()=>U0,takeAnswerPreview:()=>x0,todayWordAudioPlan:()=>dn,toggleFavorite:()=>Hm,tomorrowWordAudioPlan:()=>sw,undoLastWordAnswer:()=>F0,unfiledFavoriteCount:()=>Um,unmarkWordKnownForever:()=>S0,updateWordNote:()=>W0,updateWordQuestionMeaning:()=>$0,warmStage1SelectionCache:()=>iw,wordCardById:()=>Bt});function zm(){X();let e=T(),t=fr(),r=dr();return t==="stage1"&&r.completed<r.total&&((0,$e.getDatabase)().run("DELETE FROM stage1_tasks WHERE reviewed_on = ? AND word_id NOT IN (SELECT word_id FROM reviews WHERE reviewed_on = ? AND direction = 'forward')",[e,e]),Jl(e,{topUp:!0}),D()),(0,se.notifyProgressUpdated)(),(0,se.notifyTodayWordPlanUpdated)(dn()),Ce(fr())}function c0(){X();let e=T();jt();let r=p(`
    SELECT t.word_id
    FROM stage1_tasks t
    JOIN progress p ON p.word_id = t.word_id
    WHERE t.reviewed_on = ?
      AND p.known_forever = 0
      AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?)
  `,[e,A().toISOString()]).map(n=>Number(n.word_id)).filter(n=>Number.isFinite(n));if(r.length){let n=r.map(()=>"?").join(","),o=new Date;r.forEach(s=>{try{Oe(s,"know",o)}catch(i){console.warn("[fsrs] \u4E00\u952E\u5B8C\u6210\u8BB0\u5F55\u8DF3\u8FC7:",i)}}),(0,$e.getDatabase)().run(`
      UPDATE progress
      SET seen_count = seen_count + 1,
          last_seen_on = ?,
          right_count = right_count + 1,
          mistake_streak = 0
      WHERE word_id IN (${n})
        AND known_forever = 0
    `,[e,...r]),r.forEach(s=>Yn({wordId:s,answer:"know",reviewedOn:e,direction:"forward",schedulerMode:"normal",eventSource:"bulk_complete"})),et(_e().filter(s=>!r.includes(s.word_id)))}return Xa(),We("done"),D(),(0,se.notifyProgressUpdated)(),{stats:Ce("done"),completedCount:r.length}}function m0(){return X(),Xa(),D(),(0,se.notifyProgressUpdated)(),Ce(fr())}function p0(e){if(X(),ko())return je();let t=T();jt();let r=Qo(ua(t)),n=e&&e>0?Math.min(Math.round(e),100):r>0?r:Math.max(Math.round(Zt()/2),5);if(n<=0)return je();let o=(0,$e.getDatabase)(),s=E("SELECT COALESCE(MAX(order_index), 0) + 1 FROM stage1_tasks WHERE reviewed_on = ?",[t],1),i=p(`
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
        AND ${ye()}
        AND NOT ${me()}
        AND p.word_id NOT IN (SELECT word_id FROM stage1_tasks WHERE reviewed_on = ?)
      ORDER BY ${an("w")}
      LIMIT ?
    `,[t,a]);d.forEach((u,l)=>{o.run(`
        INSERT OR IGNORE INTO stage1_tasks (reviewed_on, word_id, task_type, order_index)
        VALUES (?, ?, 'encore_new', ?)
      `,[t,Number(u.word_id),s+i.length+l])}),i.length+d.length>0&&Zo(t,i.length+d.length)}else i.length>0&&Zo(t,i.length);return We("stage1"),D(),(0,se.notifyProgressUpdated)(),(0,se.notifyTodayWordPlanUpdated)(dn()),je()}function E0(e){X(),jt();let t=Math.round(Number(e));if(!Number.isFinite(t)||t<=0)return!1;let r=T();if(!E(`SELECT 1 FROM words w JOIN progress p ON p.word_id = w.id WHERE w.id = ? AND p.known_forever = 0 AND ${oe()} LIMIT 1`,[t],0)||!E(`SELECT 1 FROM progress WHERE word_id = ? AND (fsrs_due IS NULL OR fsrs_due <= ?)
      AND ${te("words","progress.word_id")} LIMIT 1`,[t,A().toISOString()],0)||E("SELECT 1 FROM stage1_tasks WHERE reviewed_on = ? AND word_id = ? LIMIT 1",[r,t],0))return!1;let i=(0,$e.getDatabase)();return i.run("INSERT OR IGNORE INTO dictionary_discovered_words (word_id) VALUES (?)",[t]),i.run(`
    INSERT OR IGNORE INTO stage1_tasks (reviewed_on, word_id, task_type, order_index)
    VALUES (?, ?, 'encore_new', ?)
  `,[r,t,E("SELECT COALESCE(MAX(order_index), 0) + 1 FROM stage1_tasks WHERE reviewed_on = ?",[r],1)]),We("stage1"),D(),(0,se.notifyProgressUpdated)(),(0,se.notifyTodayWordPlanUpdated)(dn()),!0}function f0(e){X(),jt();let t=(0,$e.getDatabase)(),r=T(),n=Ot(),o=new Set,s=[],i=0,a=0;if(e.forEach(c=>{let f=Math.round(Number(c));if(!Number.isFinite(f)||f<=0||o.has(f))return;let m=H(`SELECT p.seen_count, p.known_forever, ${J()} AS started FROM progress p JOIN words w ON w.id = p.word_id WHERE w.id = ? AND ${oe()} LIMIT 1`,[f]);if(m){if(o.add(f),Number(m.known_forever??0)===1){a+=1;return}if(Number(m.started??0)>0){i+=1;return}s.push(f)}}),!s.length)return{added:0,today:0,alreadyLearning:i,known:a};let d=()=>{let c=s.map(()=>"?").join(","),f=E(`
      SELECT t.word_id
      FROM stage1_tasks t
      JOIN progress p ON p.word_id = t.word_id
      JOIN words w ON w.id = t.word_id
      WHERE t.reviewed_on = ?
        AND t.task_type = 'new'
        AND NOT ${J()}
        AND p.known_forever = 0
        AND (NOT ${me()} OR w.id IN (SELECT word_id FROM dictionary_discovered_words))
        AND t.word_id NOT IN (${c})
      ORDER BY t.order_index DESC
      LIMIT 1
    `,[r,...s],0);return f?(t.run("DELETE FROM stage1_tasks WHERE reviewed_on = ? AND word_id = ?",[r,f]),!0):!1},u=E("SELECT COALESCE(MAX(order_index), 0) + 1 FROM stage1_tasks WHERE reviewed_on = ?",[r],1),l=0;return s.forEach(c=>{if(t.run("INSERT OR IGNORE INTO dictionary_discovered_words (word_id) VALUES (?)",[c]),E("SELECT 1 FROM stage1_tasks WHERE reviewed_on = ? AND word_id = ? LIMIT 1",[r,c],0)){da(r)>n&&!d()&&t.run(`UPDATE stage1_tasks SET task_type='encore_new' WHERE reviewed_on=? AND word_id=? AND task_type='new' AND word_id IN (SELECT id FROM words w WHERE ${me()})`,[r,c]),l+=1;return}l>=n||da(r)>=n&&!d()||(t.run(`
      INSERT OR IGNORE INTO stage1_tasks (reviewed_on, word_id, task_type, order_index)
      VALUES (?, ?, 'new', ?)
    `,[r,c,u]),u+=1,l+=1)}),l>0&&We("stage1"),D(),(0,se.notifyProgressUpdated)(),l>0&&(0,se.notifyTodayWordPlanUpdated)(dn()),{added:s.length,today:l,alreadyLearning:i,known:a}}function dS(e,t){X();let r=T(),n=[];return e.forEach(o=>{let s=w0(o);s!==null&&(t?g0(s,r):_0(s,r))&&n.push(s)}),n.length>0&&(D(),(0,se.notifyProgressUpdated)()),n}function Vm(e,t){return dS(e,t).length}function y0(e){X();let t=nT(e);return(0,se.notifyProgressUpdated)(),{count:t.length,session:je({focus:"picked"})}}function je(e={}){if(X(),!e.focus&&Er()&&Ge()&&fr()==="kanji")return qm();let{card:t,phase:r}=ee("\u9009\u5361",()=>aS(e));return{card:t,phase:r,stats:ee("\u7EDF\u8BA1",()=>Ce(r,e)),canUndo:ss(Ya(r,e))}}function R0(e,t,r={}){if(X(),!Number.isFinite(t)||t===e)throw new Error("\u76F8\u4F3C\u8BCD\u76EE\u6807\u65E0\u6548");let n=Bt(t);if(!n)throw new Error("\u627E\u4E0D\u5230\u8FD9\u4E2A\u76F8\u4F3C\u8BCD");let o=Jm(e,"fuzzy",r);return Xt(n),{card:n,phase:o.phase,stats:o.stats,canUndo:o.canUndo}}function b0(e=50,t=[]){X();let r=Math.max(1,Math.round(e)),n=fr(),o=[],s=new Set(t.map(a=>Number(a)).filter(a=>Number.isFinite(a))),i=()=>n==="stage1"?Ql(s,{deterministic:!0}):n==="stage2"||n==="kanji"?om(pr(n),s,{deterministic:!0}):null;for(;o.length<r;){let a=i();if(!a||s.has(a.id))break;o.push(a),s.add(a.id)}return{cards:o,phase:n,stats:Ce(n)}}function L0(e){e<=0||(Zo(T(),e),D(),(0,se.notifyProgressUpdated)())}function O0(e){return X(),{cards:e.map(r=>Bt(Number(r))).filter(r=>!!r),phase:"stage1",stats:Ce("stage1")}}function A0(e,t){if(X(),!e.length)return je();let r=t==="stage2"||t==="kanji"?t:"stage1",n=null;return e.forEach(({wordId:o,answer:s},i)=>{We(r),Xt({id:o}),n=Jm(o,s),i<e.length-1&&We(r)}),n??je()}function h0(e){X(),We("stage1"),jt();let r=e!=null&&E(`
    SELECT COUNT(*) FROM stage1_tasks t JOIN progress p ON p.word_id = t.word_id
    WHERE t.reviewed_on = ? AND t.word_id = ? AND p.known_forever = 0
      AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?)
  `,[T(),e,A().toISOString()],0)>0?Bt(e):null;r&&Xt(r);let n=r?{card:r,phase:"stage1",stats:Ce("stage1"),canUndo:!1}:je();return(0,se.notifyProgressUpdated)(),n}function k0(){return uS(Ns)}function v0(){return uS(Rs)}function C0(e,t){return X(),!Er()||!Ge()||Cs!==e||(t==="known_forever"?Rm(e,!0):Nm(e,t),Cs=null,Xt(null),D(),(0,se.notifyProgressUpdated)()),je()}function Jm(e,t,r={},n=!1,o=!1){return o&&(We("stage1"),Xt({id:e})),ee("\u8BB0\u8D26",()=>Qm(e,t,r,n)),je(r)}function Qm(e,t,r,n=!1){if(X(),!d0(e))return;let o=(0,$e.getDatabase)(),s=T(),i=rs(r)?"stage1":fr();if(i==="stage2"||i==="kanji"){vT(pr(i),e,t),D(),(0,se.notifyProgressUpdated)();return}let a=H("SELECT * FROM progress WHERE word_id = ?",[e]);if(!a)return;let d={phase:"stage1",mode:Ya("stage1",r),reviewed_on:s,word_id:e,last_answered_word:Fe(),seen_count:Number(a.seen_count??0),known_forever:Number(a.known_forever??0),last_seen_on:a.last_seen_on,right_count:Number(a.right_count??0),fuzzy_count:Number(a.fuzzy_count??0),forgot_count:Number(a.forgot_count??0),mistake_streak:Number(a.mistake_streak??0),fsrs:Rt(e),...n&&t==="forgot"?{always_spell:E("SELECT always_spell FROM spelling_memory WHERE word_id = ?",[e],0)}:{},review_queue:_e()};Bn(e);let u=Number(a.known_forever??0),l=Number(a.right_count??0),c=Number(a.fuzzy_count??0),f=Number(a.forgot_count??0),m=Number(a.mistake_streak??0);t==="known_forever"?(u=1,m=0):(l+=t==="know"?1:0,c+=t==="fuzzy"?1:0,f+=t==="forgot"?1:0,m=t==="know"?0:m+1);let g=!1,S=!1,w=0,_=E(`SELECT COUNT(*) FROM reviews
       WHERE word_id = ? AND reviewed_on = ? AND direction = 'forward'
         AND answer IN ('forgot','fuzzy')`,[e,s],0)+(t==="forgot"||t==="fuzzy"?1:0)>=Ue,C=E("SELECT COUNT(*) FROM reviews WHERE word_id = ? AND reviewed_on = ? AND direction = 'forward'",[e,s],0)===0&&t==="know"?"known":_?"stubborn":"normal";if(!u)try{let U=Oe(e,t,new Date,{mode:C});g=Nt(U,A()),w=Math.max((new Date(U.due).getTime()-Date.now())/6e4,0),S=!g&&Nt(Ze(U,"know",new Date,{mode:_?"stubborn":"normal"}),A())}catch(U){console.warn("[fsrs] \u8BB0\u5F55\u8DF3\u8FC7:",U),g=t==="know"}let L=!g,I=m>=lt;L&&!u&&Xn(e,w,I,S&&V_(a)),ar(e),o.run(`
    UPDATE progress
    SET seen_count = seen_count + 1,
        known_forever = ?,
        last_seen_on = ?,
        right_count = ?,
        fuzzy_count = ?,
        forgot_count = ?,
        mistake_streak = ?
    WHERE word_id = ?
  `,[u,s,l,c,f,m,e]);let x=Yn({wordId:e,answer:t,reviewedOn:s,direction:"forward",schedulerMode:C});n&&t==="forgot"&&o.run(`INSERT INTO spelling_memory (word_id, always_spell) VALUES (?, 1)
      ON CONFLICT(word_id) DO UPDATE SET always_spell = 1`,[e]),ca({...d,review_id:x}),D(),(0,se.notifyProgressUpdated)()}function D0(e){return{wordId:e,db:(0,$e.getDatabase)(),day:T(),changes:Zm(),byAnswer:{}}}function I0(e,t,r={}){if(!ep(e))return;let n=performance.now(),o=(0,$e.getDatabase)();o.run("SAVEPOINT preview_next_card");try{e.byAnswer[t]=(0,se.withProgressEventsMuted)(()=>{Qm(e.wordId,t,r);let s=Nt(Rt(e.wordId),A()),{card:i,phase:a}=aS(r),d=T(),u=a==="stage1"?E(`
        SELECT COUNT(*) FROM stage1_tasks t JOIN progress p ON p.word_id = t.word_id
        WHERE t.reviewed_on = ? AND p.known_forever = 0 AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?)
      `,[d,A().toISOString()],0):0,l=a==="stage1"?E("SELECT COUNT(*) FROM stage1_tasks WHERE reviewed_on = ?",[d],0):0;return{card:i,phase:a,graduatedForDay:s,sharedWithinClass:a==="stage1"&&i!=null&&i.id!==e.wordId&&u>Math.ceil(l*Fl)+2}})}catch(s){console.warn("[preview] \u9884\u7B97\u4E0B\u4E00\u5F20\u5931\u8D25\uFF0C\u8FD9\u4E00\u5F20\u8D70\u540C\u6B65\u8DEF\u5F84",s)}finally{o.run("ROLLBACK TO preview_next_card"),o.run("RELEASE preview_next_card")}e.changes=Zm(),Sr("\u540E\u53F0\u9884\u7B97\u4E00\u6B21",performance.now()-n)}function x0(e,t,r){if(!e||e.wordId!==t||!ep(e))return null;let n=e.byAnswer[r],o=sS[r]?e.byAnswer[sS[r]]:void 0,s=n??(o?.sharedWithinClass?o:void 0);return s?.card?s:null}function U0(e,t,r,n={},o=!1){return ee("\u8BB0\u8D26",()=>Qm(e,t,n,o)),Xt(r.card),{card:r.card,phase:r.phase,stats:ee("\u7EDF\u8BA1",()=>Ce(r.phase,n)),canUndo:ss(Ya(r.phase,n))}}function F0(e={}){X();let t=(0,$e.getDatabase)(),r=lw(Ym(e));if(!r)return iS(e);if(r.phase==="stage2"||r.phase==="kanji"){let i=pr(String(r.phase));if(r.direction&&r.direction!==i.id)return iS(e);CT(i,r),We(String(r.phase))}else r.phase==="stage1"&&(t.run(`
      UPDATE progress
      SET seen_count = ?,
          known_forever = ?,
          last_seen_on = ?,
          right_count = ?,
          fuzzy_count = ?,
          forgot_count = ?,
          mistake_streak = ?
      WHERE word_id = ?
    `,[Number(r.seen_count??0),Number(r.known_forever??0),r.last_seen_on==null?null:String(r.last_seen_on),Number(r.right_count??0),Number(r.fuzzy_count??0),Number(r.forgot_count??0),Number(r.mistake_streak??0),Number(r.word_id)]),r.review_id!=null&&(t.run("DELETE FROM reviews WHERE id = ?",[Number(r.review_id)]),br("words",Number(r.word_id))),on(Number(r.word_id),r.fsrs??null),r.always_spell!=null&&t.run("UPDATE spelling_memory SET always_spell = ? WHERE word_id = ?",[Number(r.always_spell),Number(r.word_id)]),Array.isArray(r.review_queue)&&et(r.review_queue.flatMap(i=>{if(!i||typeof i!="object")return[];let a=i,d=Number(a.word_id);return Number.isFinite(d)?[{word_id:d,due_after:Math.max(Number(a.due_after??0),0)}]:[]})),r.last_answered_word!=null&&ar(Number(r.last_answered_word)),rs(e)||We("stage1"));D(),(0,se.notifyProgressUpdated)();let n=String(r.mode??r.phase??"stage1"),o=Number(r.word_id),s=n==="stage2"||n==="kanji"?Ua(pr(n),o):Bt(o);return s?(Xt(s),cw(s.id,n),{card:s,phase:n,stats:Ce(n,e),canUndo:ss(n)}):je(e)}function W0(e,t){let r=(0,$e.getDatabase)(),n=t.trim();return n?r.run("INSERT OR REPLACE INTO word_notes (word_id, note, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",[e,n]):r.run("DELETE FROM word_notes WHERE word_id = ?",[e]),D(),{wordId:e,note:n}}function j0(e){let t=hl(e);if(!t.length)return[];let r=t.map(()=>"?").join(", ");return p(`SELECT id, kanji, kana, meaning FROM words WHERE id IN (${r})`,t).map(n=>({id:Number(n.id??0),label:String(n.kanji||n.kana||""),kana:String(n.kana??""),meaning:String(n.meaning??"")}))}function $0(e,t){let r=El(e,t);$i(),w_(),setTimeout(()=>Al(e),0),D();let n=p("SELECT id, kanji, kana, meaning FROM words WHERE id = ?",[e])[0],o=String(n?.kanji||n?.kana||""),s=String(n?.kana??""),i=String(n?.meaning??"");return{wordId:e,questionMeaning:n?Wn(i,o,s,e):r,promptMeaning:n?jn(i,e,o,s):r,isOverridden:!!r}}function P0(e,t=Date.now()){return Je(),jf(T(),e,t),D(),{seconds:e,stats:Ce("stage1")}}var $e,se,fr,We,Xa,a0,Xt,Bt,d0,Ya,Ym,u0,aS,l0,g0,_0,w0,T0,S0,Cs,N0,qm,uS,Zm,ep,M0,sS,iS,En=h(()=>{"use strict";He();$e=N($(),1);Re();kr();Fn();Yo();Jo();Se();yt();se=N(vr(),1);Mr();tr();ir();G();Lt();dt();fi();zn();ne();Ke();Wt();ma();un();bm();ns();kT();am();Ls();sm();DT();Mr();ks();Ur();Wt();un();bm();Mr();Os();Ha();PT();Im();Nr();Bm();oS();fr=()=>{let e=T();O("phase_date","")!==e&&(R("phase_date",e),R("phase","stage1"));let t=O("phase","stage1");if(t==="stage2"||t==="kanji"){if(t==="kanji"&&Er()&&Ge())return t;let r=no(pr(t));if(r.total>0&&r.completed>=r.total)return R("phase","done"),"done"}return t},We=e=>{R("phase_date",T()),R("phase",e)},Xa=()=>{(0,$e.getDatabase)().run("INSERT OR IGNORE INTO checkins (checked_on) VALUES (?)",[T()])},a0=e=>{let t=ia(e,"w");t.clause+=` AND ${te("words","p.word_id")} AND ${oe()}`;let r=_e().filter(a=>a.due_after<=0).map(a=>a.word_id);if(r.length){let a=r.map(()=>"?").join(","),d=H(`
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
      AND ${J()}
      AND COALESCE(p.fsrs_lapses, 0) >= ?
      ${t.clause}
    ORDER BY p.fsrs_lapses DESC, p.fsrs_due ASC, w.importance DESC
    LIMIT 1
  `,[Ee,...t.params]);if(n)return re(n);let o=H(`
    SELECT w.*, p.seen_count, p.known_forever,
           p.last_seen_on, p.right_count, p.fuzzy_count, p.forgot_count,
           p.mistake_streak, COALESCE(n.note, '') AS note
    FROM words w
    JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE p.known_forever = 0
      AND ${J()}
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
      AND ${ye()}
      AND NOT ${me()}
      ${t.clause}
    ORDER BY ${an("w")}
    LIMIT 1
  `,t.params);if(s)return re(s);let i=H(`
    SELECT w.*, p.seen_count, p.known_forever,
           p.last_seen_on, p.right_count, p.fuzzy_count, p.forgot_count,
           p.mistake_streak, COALESCE(n.note, '') AS note
    FROM words w
    JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    WHERE p.known_forever = 0
      AND (${J()} OR NOT ${me()})
      ${t.clause}
    ORDER BY p.fsrs_due ASC, p.last_seen_on ASC, w.importance DESC, w.shuffle_rank DESC
    LIMIT 1
  `,t.params);return i?re(i):null},Xt=e=>{R("current_card",e&&e.id!=null?String(e.id):"0")},Bt=e=>{let t=H(`
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
  `,[e]);return t?re(t):null},d0=e=>{let t=O("current_card","");return t===""?!0:t===String(e)?(R("current_card","0"),rc(),!0):!1},Ya=(e,t={})=>t.focus==="mistakes"?"mistakes":t.focus==="picked"?"picked":rs(t)?"filtered":e,Ym=(e={})=>Ya(fr(),e),u0=(e={})=>{let t=Ym(e),r=mw(t);if(!r)return null;let n=t==="stage2"||t==="kanji"?Ua(pr(t),r):Bt(r);return n?{card:n,phase:t==="filtered"?"filtered":t}:(rc(),null)},aS=(e={})=>{let t=u0(e)??l0(e);return Xt(t.card),t},l0=(e={})=>{if(e.focus==="mistakes")return{card:hT(),phase:"mistakes"};if(e.focus==="picked")return{card:sT(),phase:"picked"};if(rs(e))return{card:a0(e),phase:"filtered"};let t=fr();if(t==="done")return{card:null,phase:"done"};if(t==="stage2"||t==="kanji"){let n=om(pr(t));return n?{card:n,phase:t}:(We("done"),Xa(),{card:null,phase:"done"})}let r=Ql();return r?{card:r,phase:"stage1"}:(Xa(),We("done"),{card:null,phase:"done"})};g0=(e,t)=>{let r=H("SELECT known_forever FROM progress WHERE word_id = ?",[e]);return!r||Number(r.known_forever??0)===1?!1:((0,$e.getDatabase)().run(`
    UPDATE progress
    SET seen_count = seen_count + 1,
        known_forever = 1,
        last_seen_on = ?,
        mistake_streak = 0
    WHERE word_id = ?
  `,[t,e]),Yn({wordId:e,answer:"known_forever",reviewedOn:t,direction:"forward",schedulerMode:"known_forever",eventSource:"known_forever"}),!0)},_0=(e,t)=>{let r=H("SELECT known_forever FROM progress WHERE word_id = ?",[e]);if(!r||Number(r.known_forever??0)!==1)return!1;let n=(0,$e.getDatabase)(),o=E(`
    SELECT id FROM reviews
    WHERE word_id = ? AND reviewed_on = ? AND direction = 'forward' AND answer = 'known_forever'
    ORDER BY id DESC
    LIMIT 1
  `,[e,t],0);return o?(n.run("DELETE FROM reviews WHERE id = ?",[o]),n.run("UPDATE progress SET known_forever = 0, seen_count = MAX(seen_count - 1, 0) WHERE word_id = ?",[e])):n.run("UPDATE progress SET known_forever = 0 WHERE word_id = ?",[e]),!0},w0=e=>{let t=Math.round(Number(e));return Number.isFinite(t)&&t>0?t:null};T0=e=>Vm([e],!0)>0,S0=e=>Vm([e],!1)>0;Cs=null,N0=e=>{let t=Ga(e);return t?{text:t.targetSegment.text,start:t.targetSegment.start,length:t.targetSegment.length,reading:t.actualReading,unitType:t.unit.unitType,char:t.unit.char,base:t.unit.base,surface:t.unit.surface}:null},qm=()=>{Gt(),hs(T());let e=Sm(T());if(!e)return Cs=null,Xt(null),{card:null,phase:"done",stats:Ce("kanji",{},{kanjiUnits:!0}),unitKey:null,unitTarget:null,canUndo:!1};let t=Ga(e),r=t?Bt(t.exampleWordId):null;return r?(Cs=e,Xt(r),{card:r,phase:"kanji",stats:Ce("kanji",{},{kanjiUnits:!0}),unitKey:e,unitTarget:N0(e),canUndo:!1}):(Cs=null,qm())};uS=e=>{if(X(),e.id==="kanji_reading"&&Er()&&!Ge()&&$t(),e.id==="kanji_reading"&&Er()&&Ge()){Gt(),hs(T()),We("kanji");let r=qm();return(0,se.notifyProgressUpdated)(),r}xa(e,!0);let t=no(e);if(t.total>0&&t.completed<t.total){We(e.phase);let r=je();return(0,se.notifyProgressUpdated)(),r}return We("done"),je()};Zm=()=>E("SELECT total_changes()",[],0);ep=e=>e.db===(0,$e.getDatabase)()&&e.day===T()&&e.changes===Zm(),M0=(e,t)=>!!(e&&e.wordId===t&&e.byAnswer.know&&e.byAnswer.forgot&&ep(e)),sS={fuzzy:"forgot",known_forever:"know"};iS=(e={})=>{let t=Ym(e),r=Number(O("current_card","0"))||0,n=r?t==="stage2"||t==="kanji"?Ua(pr(t),r):Bt(r):null;if(!n)return je(e);let o=t==="done"?fr():t;return{card:n,phase:o,stats:Ce(o,e),canUndo:!1}}});var dp=le((T1,_S)=>{_S.exports=new Proxy({},{get:(e,t)=>t==="__esModule"?!1:()=>({})})});var TS=le((S1,wS)=>{wS.exports=new Proxy({},{get(e,t){let r=require("../shared/content-store");if(t==="__esModule")return!1;if(t!=="then"){if(!r.pitchAccent)throw new Error("\u97F3\u9AD8\u91CD\u97F3\u8868\u8FD8\u6CA1\u4ECE\u5206\u5305\u52A0\u8F7D\uFF1A\u5148 await content.ready()");return t==="default"?r.pitchAccent:r.pitchAccent[t]}}})});var cp={};M(cp,{loadPitchAccent:()=>lp,lookupAccent:()=>Z0,pitchAccentLoaded:()=>SS,pitchPattern:()=>rh,splitMorae:()=>th,usePitchAccentReady:()=>nh});function Z0(e,t){if(!Ds)return null;let r=Ds[`${e||t}|${t}`];return r===void 0?null:Array.isArray(r)?r[0]??null:r}function th(e){let t=[];for(let r of e)t.length&&eh.test(r)?t[t.length-1]+=r:t.push(r);return t}function rh(e,t){return Array.from({length:e},(r,n)=>{let o=n+1;return{high:t===1?o===1:o>1&&(t===0||o<=t),drop:t!==0&&o===t}})}function nh(){let[e,t]=(0,za.useState)(SS());return(0,za.useEffect)(()=>{if(e)return;let r=!0;return lp().then(()=>{r&&t(!0)}),()=>{r=!1}},[e]),e}var za,Ds,up,lp,SS,eh,mp=h(()=>{"use strict";za=N(dp(),1),Ds=null,up=null,lp=()=>Ds?Promise.resolve():(up??(up=Promise.resolve().then(()=>N(TS(),1)).then(e=>{Ds=e.default.accents}).catch(e=>{throw up=null,e})),up),SS=()=>Ds!==null;eh=/[ぁぃぅぇぉゃゅょゎァィゥェォャュョヮヵヶ]/});var nd={};M(nd,{KANA:()=>ft,KANA_MASTERY_DAYS:()=>Np,deferWordPlanUntilKanaComplete:()=>gh,enforceKanaGate:()=>Lp,getAnsweredKana:()=>fh,getKanaProgress:()=>bp,getKanaStates:()=>td,kanaComplete:()=>gr,kanaMasteredCount:()=>hS,kanaProgressFrom:()=>rd,kanaQuizChoices:()=>mh,kanaStateFrom:()=>AS,pickKanaIndex:()=>ph,recordKanaAnswer:()=>_h,replayKanaReviews:()=>wh});var Za,LS,ao,ft,mh,ph,OS,Rp,ed,Np,AS,td,Eh,rd,bp,fh,hS,gr,gh,Lp,_h,wh,xs=h(()=>{"use strict";Za=N($(),1);P();ne();Se();LS=N(vr(),1),ao=N(nt(),1),ft=[["\u3042","a"],["\u3044","i"],["\u3046","u"],["\u3048","e"],["\u304A","o"],["\u304B","ka"],["\u304D","ki"],["\u304F","ku"],["\u3051","ke"],["\u3053","ko"],["\u3055","sa"],["\u3057","shi"],["\u3059","su"],["\u305B","se"],["\u305D","so"],["\u305F","ta"],["\u3061","chi"],["\u3064","tsu"],["\u3066","te"],["\u3068","to"],["\u306A","na"],["\u306B","ni"],["\u306C","nu"],["\u306D","ne"],["\u306E","no"],["\u306F","ha"],["\u3072","hi"],["\u3075","fu"],["\u3078","he"],["\u307B","ho"],["\u307E","ma"],["\u307F","mi"],["\u3080","mu"],["\u3081","me"],["\u3082","mo"],["\u3084","ya"],["\u3086","yu"],["\u3088","yo"],["\u3089","ra"],["\u308A","ri"],["\u308B","ru"],["\u308C","re"],["\u308D","ro"],["\u308F","wa"],["\u3092","wo"],["\u3093","n"],["\u30A2","a"],["\u30A4","i"],["\u30A6","u"],["\u30A8","e"],["\u30AA","o"],["\u30AB","ka"],["\u30AD","ki"],["\u30AF","ku"],["\u30B1","ke"],["\u30B3","ko"],["\u30B5","sa"],["\u30B7","shi"],["\u30B9","su"],["\u30BB","se"],["\u30BD","so"],["\u30BF","ta"],["\u30C1","chi"],["\u30C4","tsu"],["\u30C6","te"],["\u30C8","to"],["\u30CA","na"],["\u30CB","ni"],["\u30CC","nu"],["\u30CD","ne"],["\u30CE","no"],["\u30CF","ha"],["\u30D2","hi"],["\u30D5","fu"],["\u30D8","he"],["\u30DB","ho"],["\u30DE","ma"],["\u30DF","mi"],["\u30E0","mu"],["\u30E1","me"],["\u30E2","mo"],["\u30E4","ya"],["\u30E6","yu"],["\u30E8","yo"],["\u30E9","ra"],["\u30EA","ri"],["\u30EB","ru"],["\u30EC","re"],["\u30ED","ro"],["\u30EF","wa"],["\u30F2","wo"],["\u30F3","n"]],mh=(e,t=0)=>{let r=new Set([ft[e][1]]);for(let o=7;r.size<4;o+=11)r.add(ft[(e+o)%ft.length][1]);let n=[...r];for(let o=n.length-1;o>0;o-=1){let s=(Math.floor(Math.random()*(o+1))+t)%(o+1);[n[o],n[s]]=[n[s],n[o]]}return n},ph=(e,t,r=Math.random)=>{let n=ft.flatMap(([d],u)=>(e[d]??0)<2?[u]:[]);if(!n.length)return null;let o=d=>d.filter(u=>ft[u][0]!==t),s=o(n.slice(0,8)),i=o(ft.flatMap(([d],u)=>(e[d]??0)>=2?[u]:[])),a=i.length&&(!s.length||r()<.25)?i:s.length?s:n;return a[Math.floor(r()*a.length)]},OS="kana_deferred_word_goal",Rp={table:"kana_memory",idColumn:"symbol",eligible:"1=1"},ed=()=>Br("kana-rows",()=>{let e=(0,Za.getDatabase)();for(let[t]of ft)e.run("INSERT OR IGNORE INTO kana_memory (symbol) VALUES (?)",[t]);j(Rp)}),Np=3,AS=(e,t)=>{let r=[],n="",o=0;for(let a of e){if(a.reviewed_on!==n&&(n=a.reviewed_on,o=0),a.answer!=="know"){r=[],o=0;continue}o+=1,!r.includes(a.reviewed_on)&&o>=(r.length===0?2:1)&&r.push(a.reviewed_on)}let s=n===t?o:0,i=r.length>=Np?"mastered":r.includes(t)?"passed":e.length?r.length===0?"learning":"review":"new";return{stage:i,days:r.length,todayCorrect:s,masteredOn:i==="mastered"?r[Np-1]:void 0}},td=(e=T())=>{ed();let t=new Map;for(let r of p("SELECT symbol, answer, reviewed_on FROM kana_reviews ORDER BY reviewed_at, id")){let n=t.get(String(r.symbol))??[];n.push({answer:String(r.answer),reviewed_on:String(r.reviewed_on)}),t.set(String(r.symbol),n)}return Object.fromEntries(ft.map(([r])=>[r,AS(t.get(r)??[],e)]))},Eh=e=>e.stage==="mastered"?2:e.days>0?1:0,rd=e=>Object.fromEntries(Object.entries(e).map(([t,r])=>[t,Eh(r)])),bp=()=>rd(td()),fh=()=>(ed(),new Set(p("SELECT symbol FROM kana_memory WHERE seen_count > 0").map(e=>String(e.symbol)))),hS=(e=bp())=>ft.filter(([t])=>(e[t]??0)>=2).length,gr=e=>O("kana_completed","0")==="1"||hS(e??bp())===ft.length,gh=e=>{R(OS,String(Math.max(0,Math.round(e)))),R("kana_completed",gr()?"1":"0");let t=Y();gr()||ot({...t,dailyGoal:0}),(0,ao.requestFullSnapshot)(),(0,ao.scheduleSave)(0)},Lp=()=>{if(O("starting_level","")!=="kana-none"||gr())return;let e=Y();e.dailyGoal!==0&&ot({...e,dailyGoal:0})},_h=(e,t)=>{if(ed(),!ft.some(([d])=>d===e))throw new Error("\u672A\u77E5\u7684\u5047\u540D\u5361");let r=gr(),n=new Date;Oe(e,t?"know":"forgot",n,{},Rp);let o=(0,Za.getDatabase)();o.run("INSERT INTO kana_reviews (symbol,answer,reviewed_on,reviewed_at) VALUES (?,?,?,?)",[e,t?"know":"forgot",T(n),n.getTime()]);let s=td(T(n)),i=rd(s);o.run("UPDATE kana_memory SET correct_streak=?, seen_count=seen_count+1 WHERE symbol=?",[i[e],e]);let a=gr(i);if(a&&!r){R("kana_completed","1");let d=Math.max(0,Number(O(OS,"0"))||0),u=Y(),l=`${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`;R("jlpt_plan_started_on",l),ot({...u,jlptPlanStartedOn:l,dailyGoal:d>0&&u.dailyGoal===0?d:u.dailyGoal},{keepPlanAnchor:!0})}return(0,ao.requestFullSnapshot)(),(0,ao.scheduleSave)(0),(0,LS.notifyProgressUpdated)(),{progress:i,states:s,completed:a}},wh=()=>{ed();let e=(0,Za.getDatabase)(),t=p("SELECT DISTINCT symbol FROM kana_reviews").map(i=>String(i.symbol));for(let i of t){let a=p("SELECT answer, reviewed_at FROM kana_reviews WHERE symbol=? ORDER BY reviewed_at, id",[i]);e.run(`UPDATE kana_memory SET correct_streak=0, seen_count=?,
      fsrs_stability=NULL, fsrs_difficulty=NULL, fsrs_due=NULL, fsrs_last_review=NULL,
      fsrs_state=NULL, fsrs_steps=NULL, fsrs_reps=NULL, fsrs_lapses=NULL WHERE symbol=?`,[a.length,i]);for(let d of a)Oe(i,d.answer==="know"?"know":"forgot",new Date(Number(d.reviewed_at)),{},Rp)}let r=td(),n=rd(r);for(let i of t)e.run("UPDATE kana_memory SET correct_streak=? WHERE symbol=?",[n[i]??0,i]);let o=O("kana_completed","0")==="1",s=gr(n);if(s&&!o){let i=Object.values(r).map(a=>a.masteredOn??"").sort().pop();i&&R("jlpt_plan_started_on",i)}R("kana_completed",s?"1":"0")}});var kp={};M(kp,{kanjiReadingsLoaded:()=>MS,loadKanjiReadings:()=>hp,splitFurigana:()=>Lh,useFuriganaReady:()=>Th});function Th(){let[e,t]=(0,od.useState)(MS());return(0,od.useEffect)(()=>{if(e)return;let r=!0;return hp().then(()=>{r&&t(!0)}),()=>{r=!1}},[e]),e}function yh(e){if(!e)return[];let t=[[e,0]],r=e[0],n=e.slice(1);return vS[r]&&t.push([vS[r]+n,1]),CS[r]&&t.push([CS[r]+n,1]),/[つちく]$/.test(e)&&t.push([`${e.slice(0,-1)}\u3063`,1]),t.push([`${e}\u3063`,2]),t}function Nh(e){let t=DS.get(e);if(t)return t;let r=Us?.[e],n=new Map,o=(i,a)=>{if(i)for(let[d,u]of yh(i)){let l=a+u;(!n.has(d)||n.get(d)>l)&&n.set(d,l)}};r?.on?.forEach((i,a)=>{o(i,a===0?0:1),/[ちつ]$/.test(i)&&i.length>1&&o(i.slice(0,-1),2)}),r?.kun?.forEach((i,a)=>{let[d,u=""]=i.split(".");o(d,a===0?0:1);for(let c=1;c<=u.length;c+=1)o(d+u.slice(0,c),c<u.length?3:2);let l=Sh[u[0]??""];l&&o(d+l,3)});let s=[...n.entries()].sort((i,a)=>i[1]-a[1]);return DS.set(e,s),s}function bh(e){let t=[];for(let r of e){let n=Rh(r),o=t[t.length-1];o&&(o.script===n||r==="\u30FC")?o.text+=r:t.push({text:r,isKanji:n==="kanji",script:n})}return t}function Lh(e,t){if(!Us||!e||!t)return null;let r=`${e}\0${t}`;if(Ap.has(r))return Ap.get(r)??null;let n=Oh(e,t);return Ap.set(r,n),n}function Oh(e,t){if(e===t||![...e].some(xS))return null;let r=kS(t),n=bh(e),o=0,s=null,i=(d,u,l,c)=>{if(o++>IS||s&&c>=s.penalty)return;if(d===n.length){u===r.length&&(s={picks:[...l],penalty:c});return}let f=n[d];if(!f.isKanji){let m=kS(f.text);if(!r.startsWith(m,u))return;l.push({text:f.text,reading:t.slice(u,u+m.length),isKanji:!1}),i(d+1,u+m.length,l,c),l.pop();return}a(d,0,u,l,c)},a=(d,u,l,c,f)=>{if(o++>IS)return;let m=n[d];if(u===m.text.length){i(d+1,l,c,f);return}let g=m.text[u],S=d===n.length-1&&u===m.text.length-1;for(let[w,y]of Nh(g))r.startsWith(w,l)&&(S&&l+w.length!==r.length||(c.push({text:g,reading:t.slice(l,l+w.length),isKanji:!0}),a(d,u+1,l+w.length,c,f+y),c.pop()))};return i(0,0,[],0),s?s.picks:null}var od,Us,Op,hp,MS,xS,kS,vS,CS,Sh,DS,Rh,Ap,IS,vp=h(()=>{"use strict";od=N(dp(),1),Us=null,Op=null,hp=()=>Us?Promise.resolve():(Op??(Op=Promise.resolve().then(()=>N(_a(),1)).then(e=>{Us=e.default.readings}).catch(e=>{throw Op=null,e})),Op),MS=()=>Us!==null;xS=e=>e>="\u4E00"&&e<="\u9FFF"||e==="\u3005",kS=e=>e.replace(/[ァ-ヶ]/g,t=>String.fromCodePoint((t.codePointAt(0)??0)-96)),vS={\u304B:"\u304C",\u304D:"\u304E",\u304F:"\u3050",\u3051:"\u3052",\u3053:"\u3054",\u3055:"\u3056",\u3057:"\u3058",\u3059:"\u305A",\u305B:"\u305C",\u305D:"\u305E",\u305F:"\u3060",\u3061:"\u3062",\u3064:"\u3065",\u3066:"\u3067",\u3068:"\u3069",\u306F:"\u3070",\u3072:"\u3073",\u3075:"\u3076",\u3078:"\u3079",\u307B:"\u307C"},CS={\u306F:"\u3071",\u3072:"\u3074",\u3075:"\u3077",\u3078:"\u307A",\u307B:"\u307D"},Sh={\u3046:"\u3044",\u304F:"\u304D",\u3050:"\u304E",\u3059:"\u3057",\u3064:"\u3061",\u306C:"\u306B",\u3076:"\u3073",\u3080:"\u307F",\u308B:"\u308A"};DS=new Map;Rh=e=>xS(e)?"kanji":e>="\u30A1"&&e<="\u30FA"?"katakana":e>="\u3041"&&e<="\u3096"?"hiragana":"other";Ap=new Map,IS=2e4});async function US(e){e==="mixed"?await Promise.all([$t(),cs()]):e==="kanji"&&await $t()}var FS=h(()=>{"use strict";Ur();ms();vp();mp()});var $S={};M($S,{applyLevelStartingPoint:()=>Ch});async function Ch(e,t,r){X(),Ie(),await fs(),gs(),Ts();let n=(0,WS.getDatabase)(),o=W.indexOf(e.startingLevel);n.run("BEGIN");try{for(let s of kh){let i=p("SELECT entity_key FROM level_prior_baselines WHERE entity = ?",[s.name]).map(d=>String(d.entity_key)),a=new Map;if(o>=0){let d=p(`
          SELECT CAST(t.${s.key} AS TEXT) AS entity_key, ${s.level} AS level_rank
          FROM ${s.table} t
          WHERE t.known_forever = 0
            AND (${s.name==="words"?`NOT ${J("t")}`:"t.seen_count = 0"} OR EXISTS (
              SELECT 1 FROM level_prior_baselines b WHERE b.entity = ? AND b.entity_key = CAST(t.${s.key} AS TEXT)
            ))
            AND NOT EXISTS (SELECT 1 FROM ${s.reviewTable} r WHERE r.${s.reviewKey} = t.${s.key})
            ${s.name==="words"?`AND t.word_id IN (SELECT w.id FROM words w JOIN progress p ON p.word_id = w.id WHERE ${oe()})`:""}
        `,[s.name]);for(let u of d){let l=Number(u.level_rank);if(l>o)continue;let c=l<o?100:e.familiarity[s.name],f=Cp(c);if(f<=0)continue;let m=l<o?30:14,g=String(u.entity_key),S=hh(s.name,g,m,t),w=new Date(Math.min(t.getTime(),Date.parse(S)-f*864e5)).toISOString();a.set(g,{familiarity:c,stability:f,due:S,lastReview:w})}}for(let d of i)a.has(d)||E(`SELECT COUNT(*) FROM ${s.reviewTable} WHERE ${s.reviewKey} = ?`,[d],0)>0||E(`SELECT known_forever FROM ${s.table} WHERE ${s.key} = ?`,[d],0)||(n.run(`UPDATE ${s.table} SET ${vh} WHERE ${s.key} = ?`,[d]),n.run("DELETE FROM level_prior_baselines WHERE entity = ? AND entity_key = ?",[s.name,d]));for(let[d,u]of a)n.run(`
          INSERT OR REPLACE INTO level_prior_baselines
            (entity, entity_key, stability, difficulty, due, last_review, state, steps, reps, lapses, starting_level, familiarity, updated_at)
          VALUES (?, ?, ?, 5, ?, ?, 2, 0, 0, 0, ?, ?, ?)
        `,[s.name,d,u.stability,u.due,u.lastReview,e.startingLevel,u.familiarity,t.toISOString()]),n.run(`UPDATE ${s.table} SET
          seen_count = 1, known_forever = 0, fsrs_stability = ?, fsrs_difficulty = 5,
          fsrs_due = ?, fsrs_last_review = ?, fsrs_state = 2, fsrs_steps = 0,
          fsrs_reps = 0, fsrs_lapses = 0
          WHERE ${s.key} = ?`,[u.stability,u.due,u.lastReview,d])}R("level_prior_applied",r),n.run("COMMIT")}catch(s){throw n.run("ROLLBACK"),s}(0,sd.requestFullSnapshot)(),(0,sd.scheduleSave)(0),(0,jS.notifyProgressUpdated)()}var WS,jS,sd,Ah,hh,kh,vh,PS=h(()=>{"use strict";He();WS=N($(),1);P();Nr();eo();ln();jS=N(vr(),1),sd=N(nt(),1);un();wt();id();Ah=e=>{let t=2166136261;for(let r of e)t=Math.imul(t^r.charCodeAt(0),16777619);return t>>>0},hh=(e,t,r,n)=>new Date(n.getFullYear(),n.getMonth(),n.getDate()+Ah(`${e}:${t}`)%r,12).toISOString(),kh=[{name:"words",table:"progress",key:"word_id",level:"(SELECT CASE w.jlpt_level WHEN 'N5' THEN 0 WHEN 'N4' THEN 1 WHEN 'N3' THEN 2 WHEN 'N2' THEN 3 WHEN 'N1' THEN 4 ELSE 99 END FROM words w WHERE w.id = t.word_id)",reviewTable:"reviews",reviewKey:"word_id"},{name:"grammar",table:"grammar_progress",key:"grammar_id",level:"(SELECT CASE g.level WHEN 'N5' THEN 0 WHEN 'N4' THEN 1 WHEN 'N3' THEN 2 WHEN 'N2' THEN 3 WHEN 'N1' THEN 4 ELSE 99 END FROM grammar_points g WHERE g.id = t.grammar_id)",reviewTable:"grammar_reviews",reviewKey:"grammar_id"},{name:"kanji",table:"kanji_char_memory",key:"char",level:"level_rank",reviewTable:"kanji_char_reviews",reviewKey:"char"},{name:"confusion",table:"confusion_progress",key:"group_key",level:"level_rank",reviewTable:"confusion_reviews",reviewKey:"group_key"}],vh=`seen_count = 0, right_count = 0, fuzzy_count = 0, forgot_count = 0,
  known_forever = 0, last_seen_on = NULL, fsrs_stability = NULL, fsrs_difficulty = NULL,
  fsrs_due = NULL, fsrs_last_review = NULL, fsrs_state = NULL, fsrs_steps = NULL,
  fsrs_reps = NULL, fsrs_lapses = NULL`});var Up={};M(Up,{applyLevelStartingPoint:()=>Ip,effectiveStartingLevel:()=>xp,familiarityDefaults:()=>Mh,getLevelPlanSettings:()=>jr,hydrateLevelPlanPreferences:()=>Wh,recalibrateLevelStartingPoint:()=>jh,saveLevelPlanSettings:()=>Fh,shouldShowLevelSetup:()=>Uh,stabilityFor:()=>Cp});async function Ip(e,t=new Date){let r=KS(e);if(O(De.applied,"")===r)return;await US("mixed");let{applyLevelStartingPoint:n}=await Promise.resolve().then(()=>(PS(),$S));await n(e,t,r)}async function Fh({planEnabled:e=!0,...t}){let r=jr(),n=t.examKind??r?.examKind??"jlpt",o=GS(t.familiarity),s=r?.startingLevel===t.startingLevel&&r.target===t.target&&r.examKind===n&&r.examDate===t.examDate&&JSON.stringify(r.familiarity)===JSON.stringify(o),i={...t,examKind:n,familiarity:o,startedOn:t.startedOn||(s?r.startedOn:Dp())};await Ip({...i,startingLevel:Mp(i)??i.startingLevel}),R(De.startingLevel,i.startingLevel),R(De.familiarity,JSON.stringify(i.familiarity)),R(De.target,i.target),R(De.examKind,i.examKind),R(De.examDate,i.examDate),R(De.startedOn,i.startedOn),R("jlpt_plan_enabled",e?"1":"0");let a=Y();return R("level_plan_quotas",JSON.stringify(Object.fromEntries(bn.map(d=>[d,a[d]])))),ot({...a,jlptPlanEnabled:e,jlptTarget:i.target,planExamKind:i.examKind,jlptExamDate:i.examDate,jlptPlanStartedOn:i.startedOn},{keepPlanAnchor:!0,fromLevelPlanSync:!0}),(0,ad.requestFullSnapshot)(),(0,ad.scheduleSave)(0),i}var HS,ad,Dh,KS,Ih,De,Dp,Fs,GS,Mh,Cp,xh,jr,Uh,Wh,Mp,xp,jh,id=h(()=>{"use strict";HS=N($(),1);P();ys();ad=N(nt(),1);En();wt();Rn();Se();xs();FS();Dh="level-prior-v1",KS=e=>JSON.stringify({version:Dh,level:e.startingLevel,familiarity:e.familiarity}),Ih=new Set(["kana-none","kana",...W,"beyond"]),De={startingLevel:"starting_level",familiarity:"type_familiarity",target:"jlpt_plan_target",examKind:"jlpt_plan_exam_kind",examDate:"jlpt_plan_exam_date",startedOn:"jlpt_plan_started_on",applied:"level_prior_applied"},Dp=(e=new Date)=>`${e.getFullYear()}-${String(e.getMonth()+1).padStart(2,"0")}-${String(e.getDate()).padStart(2,"0")}`,Fs=e=>Math.max(0,Math.min(100,Math.round(Number(e)||0))),GS=(e={})=>({words:Fs(e.words),grammar:Fs(e.grammar),kanji:Fs(e.kanji),confusion:Fs(e.confusion)}),Mh=e=>{let t=W.includes(e)?75:0;return{words:t,grammar:t,kanji:t,confusion:t}},Cp=e=>{let t=[[0,0],[25,3],[50,10],[75,30],[100,90]],r=Fs(e);for(let n=1;n<t.length;n+=1){let[o,s]=t[n],[i,a]=t[n-1];if(r<=o){if(r===o)return s;let d=(r-i)/(o-i);return a===0?s*d:Math.exp(Math.log(a)+(Math.log(s)-Math.log(a))*d)}}return 90},xh=e=>{try{return GS(JSON.parse(e))}catch{return null}},jr=()=>{let e=O(De.startingLevel,""),t=xh(O(De.familiarity,""));if(!Ih.has(e)||!t)return null;let r=O(De.target,""),n=W.includes(r)?r:Y().jlptTarget;return{startingLevel:e,familiarity:t,target:n,examKind:Ro(O(De.examKind,"jlpt"))?O(De.examKind,"jlpt"):"jlpt",examDate:O(De.examDate,""),startedOn:O(De.startedOn,"")||Dp()}},Uh=()=>O(De.startingLevel,"")?!1:[["reviews","1=1"],["grammar_reviews","1=1"],["kanji_char_reviews","1=1"],["confusion_reviews","1=1"],["kana_reviews","1=1"],["progress","seen_count > 0 OR known_forever = 1"],["grammar_progress","seen_count > 0 OR known_forever = 1"],["checkins","1=1"]].every(([e,t])=>{try{return E(`SELECT COUNT(*) FROM ${e} WHERE ${t}`,[],0)===0}catch{return!0}});Wh=()=>{let e=jr();if(!e)return;let t={};try{t=JSON.parse(O("level_plan_quotas","{}"))}catch{}if(e.startingLevel==="kana-none"&&O("kana_completed","0")==="1"&&t.dailyGoal===0){let n=Number(O("kana_deferred_word_goal","0"));Number.isFinite(n)&&n>0&&(t.dailyGoal=n,R("level_plan_quotas",JSON.stringify(t)))}let r=Object.fromEntries(bn.filter(n=>Number.isFinite(t[n])).map(n=>[n,t[n]]));ot({...Y(),...r,jlptPlanEnabled:O("jlpt_plan_enabled","1")!=="0",jlptTarget:e.target,planExamKind:e.examKind,jlptExamDate:e.examDate,jlptPlanStartedOn:e.startedOn},{keepPlanAnchor:!0,fromLevelPlanSync:!0}),Lp()},Mp=(e,t=new Date)=>{if(!W.includes(e.startingLevel))return null;let r=e.startingLevel,n=new Date(`${e.startedOn}T12:00:00`);if(!Number.isFinite(n.getTime())||t.getTime()-n.getTime()<14*864e5)return r;let o=p(`
    SELECT w.jlpt_level AS level, COUNT(*) AS total,
      SUM(CASE WHEN first.answer IN ('know', 'known_forever') THEN 1 ELSE 0 END) AS correct
    FROM (
      SELECT r.word_id, r.answer, r.reviewed_on
      FROM reviews r
      JOIN (SELECT word_id, MIN(id) AS id FROM reviews WHERE direction = 'forward' GROUP BY word_id) f ON f.id = r.id
    ) first JOIN words w ON w.id = first.word_id
    WHERE first.reviewed_on >= ?
    GROUP BY w.jlpt_level
  `,[Dp(new Date(t.getTime()-14*864e5))]),s=new Map(o.map(l=>[String(l.level),{total:Number(l.total),rate:Number(l.correct)/Math.max(1,Number(l.total))}])),i=W.indexOf(r),a=s.get(r);if(a&&a.total>=50&&a.rate<.55)return W[Math.max(0,i-1)];let d=W[i+1],u=d?s.get(d):void 0;return u&&u.total>=50&&u.rate>=.85?d:r},xp=(e=new Date)=>{let t=jr();return t?Mp(t,e):null},jh=async(e=new Date)=>{let t=jr();if(!t)return!1;let r={...t,startingLevel:Mp(t,e)??t.startingLevel};return O(De.applied,"")===KS(r)?!1:(await Ip(r,e),zm(),tm((0,HS.getDatabase)()),!0)}});var Dy=le((Jj,Cy)=>{var Td=Gi()("grammarKeyPoints");Cy.exports={__esModule:!0,default:Td,get points(){return Td.points},get aliases(){return Td.aliases},get kanji(){return Td.kanji}}});var Py=le((o$,$y)=>{$y.exports=new Proxy({},{get:(e,t)=>t==="__esModule"?!1:()=>({})})});var Nd=le((s$,Hy)=>{var Av=()=>{try{return require("../runtime/entitlements").cachedEntitlement()}catch{return{active:!1,plan:"free",expiresAt:null,source:"local-default"}}},yd=()=>{let e=Av();return{isPro:!!e.active,productId:e.plan,source:e.source,expiresAt:e.expiresAt,updatedAt:e.fetchedAt||null}},gE=new Set,fE=e=>{let t={...yd(),...e};try{require("../runtime/entitlements").storeEntitlement({isPro:!!t.isPro,plan:t.productId,source:t.source,expiresAt:t.expiresAt})}catch(n){console.warn("[entitlements] \u6743\u76CA\u6CA1\u5B58\u4E0B\u6765",n)}let r=yd();return gE.forEach(n=>{try{n(r)}catch(o){console.warn("[entitlements] \u8BA2\u9605\u56DE\u8C03\u51FA\u9519",o)}}),r},hv={pro_monthly:"\u6708\u5EA6 Pro",pro_quarterly:"\u5B63\u5EA6 Pro",pro_yearly:"\u5E74\u5EA6 Pro",pro_lifetime:"\u6C38\u4E45 Pro",pro_trial:"\u8BA1\u5212\u8BD5\u7528",pro_launch_gift:"\u9996\u6708\u8D60\u9001\u4F1A\u5458"},kv=e=>hv[String(e||"").replace(/^shushugo_/,"")]||"\u514D\u8D39\u7248",vv=({productId:e,expiresAt:t})=>{if(!t)return String(e||"").replace(/^shushugo_/,"")==="pro_lifetime"?"\u957F\u671F\u6709\u6548":"\u5230\u671F\u65E5\u5F85\u786E\u8BA4";let r=new Date(t);return Number.isNaN(r.getTime())?"\u5230\u671F\u65E5\u5F85\u786E\u8BA4":`\u5230\u671F\u65E5 ${r.getFullYear()}-${String(r.getMonth()+1).padStart(2,"0")}-${String(r.getDate()).padStart(2,"0")}`};Hy.exports={productLabel:kv,entitlementExpiryLabel:vv,devForcePro:()=>!1,setDevForcePro:()=>{},getEntitlements:yd,canUseFeature:(e,t=yd())=>!!t.isPro,saveEntitlements:fE,grantPro:(e,t,r)=>fE({isPro:!0,productId:e,source:t,expiresAt:r}),clearEntitlements:()=>fE({isPro:!1,source:"free",productId:void 0,expiresAt:null}),subscribeEntitlements:e=>(gE.add(e),()=>gE.delete(e))}});var Zy={};M(Zy,{customWordId:()=>Qy,importExternalWordList:()=>sC,materializeCustomWords:()=>oC,parseExternalWordListText:()=>LE,previewExternalWordList:()=>Jy});var Ad,Vy,$v,Xe,RE,hd,Ld,Od,Ye,Pv,Hv,Kv,Gv,bE,Bv,LE,Xv,zs,Yv,zv,Vv,qv,qy,Jy,Jv,Qv,Zv,eC,tC,rC,Qy,nC,oC,sC,eN=h(()=>{"use strict";Ad=N($(),1);En();G();Vy=N(vr(),1);Xo();sr();Fi();Ke();ne();Yo();$v=new Set(["word","term","title","entry","spell","surface","headword","\u5355\u8BCD","\u55AE\u8A5E","\u8BCD","\u8A5E","\u8BCD\u6761","\u8A5E\u689D","\u8868\u8BB0","\u8868\u8A18","\u898B\u51FA\u3057","\u65E5\u6587","kana","reading","yomi","pronunciation","pron","\u5047\u540D","\u304B\u306A","\u4EEE\u540D","\u8BFB\u97F3","\u8AAD\u307F","meaning","translation","definition","explain","briefInfo","excerpt","\u91CA\u4E49","\u91CA\u610F","\u4E2D\u6587","\u610F\u601D","\u7FFB\u8BD1","score","memory","\u719F\u6089\u5EA6","\u719F\u77E5\u5EA6","\u8BB0\u5FC6","\u8A18\u61B6","\u505A\u9898\u5206\u6570","\u6B63\u786E\u7387"]),Xe={term:["word","term","title","entry","spell","surface","headword","\u5355\u8BCD","\u55AE\u8A5E","\u8BCD","\u8A5E","\u8BCD\u6761","\u8A5E\u689D","\u8868\u8BB0","\u8868\u8A18","\u898B\u51FA\u3057","\u65E5\u6587"],kana:["kana","reading","yomi","pronunciation","pron","\u5047\u540D","\u304B\u306A","\u4EEE\u540D","\u8BFB\u97F3","\u8AAD\u307F","\u767A\u97F3","\u53D1\u97F3"],meaning:["meaning","translation","definition","explain","briefInfo","excerpt","\u91CA\u4E49","\u91CA\u610F","\u4E2D\u6587","\u610F\u601D","\u7FFB\u8BD1","\u8A33","\u8A33\u6587","\u4E2D\u56FD\u8A9E"],pos:["pos","partofspeech","\u54C1\u8BCD","\u54C1\u8A5E","\u8BCD\u6027","\u8A5E\u6027"],exampleJp:["examplejp","example","sentence","\u4F8B\u53E5","\u4F8B\u6587","\u65E5\u6587\u4F8B\u53E5"],exampleMeaning:["examplemeaning","examplecn","\u4F8B\u53E5\u7FFB\u8BD1","\u4F8B\u53E5\u91CA\u4E49","\u4E2D\u6587\u4F8B\u53E5"],jlptLevel:["jlpt","level","\u7B49\u7EA7","\u7D1A\u5225","\u7EA7\u522B","\u96E3\u5EA6","\u96BE\u5EA6"],note:["note","memo","notes","\u7B14\u8BB0","\u7B46\u8A18","\u5907\u6CE8","\u5099\u8003"],score:["score","memoryscore","\u719F\u6089\u5EA6","\u719F\u77E5\u5EA6","\u8BB0\u5FC6\u5206","\u8A18\u61B6\u5206","\u505A\u9898\u5206\u6570","\u6B63\u786E\u7387","\u6B63\u7B54\u7387","\u638C\u63E1\u5EA6"],seenCount:["seencount","reviewcount","testcount","qcnt","testtimes","\u6B21\u6570","\u590D\u4E60\u6B21\u6570","\u6D4B\u8BD5\u6B21\u6570","\u505A\u9898\u6B21\u6570"],rightCount:["rightcount","correctcount","\u6B63\u786E","\u6B63\u786E\u6570","\u4F1A\u4E86"],fuzzyCount:["fuzzycount","halfcount","\u6A21\u7CCA","\u72B9\u8C6B"],forgotCount:["forgotcount","wrongcount","incorrectcount","qwrcnt","\u9519\u8BEF","\u9519\u9898","\u5FD8\u8BB0","\u4E0D\u4F1A"],lastSeenOn:["lastseenon","reviewedon","updatedat","\u6700\u540E\u590D\u4E60","\u4E0A\u6B21\u590D\u4E60","\u6700\u8FD1\u5B66\u4E60"]},RE=e=>e.toLowerCase().replace(/[\s_\-()[\]（）【】:：/\\.,，。]/g,""),hd=e=>String(e??"").replace(/\uFEFF/g,"").trim(),Ld=e=>/[\u3040-\u30ff\u3400-\u9fff々〆〤]/.test(e),Od=e=>/^[\u3040-\u30ffー・〜~\s]+$/.test(e.trim()),Ye=(e,t)=>{let r=new Map(Object.keys(e).map(n=>[RE(n),n]));for(let n of t){let o=r.get(RE(n));if(o){let s=hd(e[o]);if(s)return s}}return""},Pv=(e,t)=>{let r=[],n=[],o="",s=!1;for(let i=0;i<e.length;i+=1){let a=e[i],d=e[i+1];if(s){a==='"'&&d==='"'?(o+='"',i+=1):a==='"'?s=!1:o+=a;continue}a==='"'?s=!0:a===t?(n.push(o.trim()),o=""):a===`
`?(n.push(o.trim()),r.push(n),n=[],o=""):a!=="\r"&&(o+=a)}return n.push(o.trim()),n.some(Boolean)&&r.push(n),r.filter(i=>i.some(Boolean))},Hv=e=>{let t=e.split(/\r?\n/).slice(0,8).join(`
`);return["	",",",";","|"].map(n=>({delimiter:n,count:t.split(n).length-1})).sort((n,o)=>o.count-n.count)[0]?.delimiter??"	"},Kv=e=>e.filter(r=>$v.has(RE(r))).length>=1||e.filter(r=>!Ld(r)&&/[a-zA-Z]/.test(r)).length>=Math.max(2,e.length/2),Gv=e=>{let t=Pv(e,Hv(e));if(!t.length)return[];if(Kv(t[0])){let r=t[0].map((n,o)=>hd(n)||`column_${o+1}`);return t.slice(1).map(n=>Object.fromEntries(r.map((o,s)=>[o,n[s]??""])))}return t.map(r=>Object.fromEntries(r.map((n,o)=>[`column_${o+1}`,n])))},bE=e=>{if(Array.isArray(e))return e.flatMap(bE);if(!e||typeof e!="object")return[];let t=e,r=["words","items","list","data","records","vocabulary"].find(n=>Array.isArray(t[n]));return r?bE(t[r]):[t]},Bv=e=>{let t=e.split(/\n\s*\n/).map(n=>n.trim()).filter(Boolean);return(t.length>1?t:e.split(/\r?\n/).map(n=>n.trim()).filter(Boolean)).map(n=>{let o=n.split(/\t| {2,}|,|，|、/).map(s=>s.trim()).filter(Boolean);return Object.fromEntries(o.map((s,i)=>[`column_${i+1}`,s]))})},LE=e=>{let t=e.replace(/\uFEFF/g,"").trim();if(!t)return[];if(/^[\[{]/.test(t))try{let n=bE(JSON.parse(t));if(n.length)return n}catch{}let r=Gv(t);return r.length?r:Bv(t)},Xv=e=>{let t=Object.values(e).map(hd).filter(Boolean),r=t.filter(Ld),n=Ye(e,Xe.kana)||r.find(i=>Od(i))||"",o=Ye(e,Xe.term)||r.find(i=>!Od(i))||n||"",s=Ye(e,Xe.meaning)||t.find(i=>!Ld(i)&&i.length>1)||"";return{term:o,kana:n,meaning:s}},zs=e=>{let t=e.replace(/,/g,"").match(/-?\d+(?:\.\d+)?/);return t?Number(t[0]):null},Yv=e=>{let t=e.match(/20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}/);if(!t)return null;let[r,n,o]=t[0].split(/\D+/).map(Number);return!r||!n||!o?null:`${r}-${String(n).padStart(2,"0")}-${String(o).padStart(2,"0")}`},zv=e=>{let t=Ye(e,Xe.score),r=Object.values(e).map(hd).join(" "),n=zs(t);if(n!==null){if(n>=-40&&n<=10)return Math.round(n);let o=n<=1?n*100:n;if(o>=0&&o<=100)return Math.max(-15,Math.min(10,Math.round((o-60)/4)))}return/已掌握|完全记住|熟知|known|master/i.test(r)?8:/模糊|一般|fuzzy|again/i.test(r)?-2:/忘记|不会|错误|错题|forgot|wrong/i.test(r)?-10:0},Vv=(e,t)=>t||(/する$/.test(e)?"\u540D\u8BCD\u30FB\u3059\u308B\u52A8\u8BCD":/[うくぐすつぬぶむる]$/.test(e)?"\u52A8\u8BCD":/い$/.test(e)&&!Od(e)?"\u3044\u5F62\u5BB9\u8BCD":"\u5BFC\u5165\u8BCD"),qv=(e,t)=>/する/.test(e)||/suru|する/.test(t)?"suru":/动词|動詞/.test(t)?/る$/.test(e)?"ichidan":"godan":null,qy=e=>{let{term:t,kana:r,meaning:n}=Xv(e);if(!t||!Ld(t))return null;let o=t.replace(/\s+/g,""),s=(r||(Od(o)?o:"")).replace(/\s+/g,""),i=o,a=s||o,d=zv(e),u=Math.max(zs(Ye(e,Xe.seenCount))??0,d===0?0:1),l=Math.max(zs(Ye(e,Xe.rightCount))??0,d>4?1:0),c=Math.max(zs(Ye(e,Xe.fuzzyCount))??0,d<4&&d>-8?1:0),f=Math.max(zs(Ye(e,Xe.forgotCount))??0,d<=-8?1:0),m=Vv(o,Ye(e,Xe.pos));return{term:o,kana:a,kanji:i,meaning:n||"\u81EA\u5B9A\u4E49\u5BFC\u5165",pos:m,verbType:qv(o,m),importance:Math.max(1,Math.min(5,d<=-8?5:d<=2?4:3)),exampleJp:Ye(e,Xe.exampleJp),exampleMeaning:Ye(e,Xe.exampleMeaning),jlptLevel:Ye(e,Xe.jlptLevel).match(/N[1-5]/i)?.[0].toUpperCase()??null,memoryScore:d,seenCount:u,rightCount:l,fuzzyCount:c,forgotCount:f,lowHistory:d<=-10?1:0,lastSeenOn:Yv(Ye(e,Xe.lastSeenOn)),note:Ye(e,Xe.note)}},Jy=e=>{let t=LE(e),r=new Set,n=[],o=0,s=0;t.forEach(a=>{let d=qy(a);if(!d){s+=1;return}let u=`${d.kanji}\0${d.kana}`;if(r.has(u)){o+=1;return}r.add(u),n.push(d)});let i=[];return t.length&&n.length/t.length<.5&&i.push("\u53EF\u8BC6\u522B\u884C\u504F\u5C11\uFF0C\u8BF7\u786E\u8BA4\u6587\u4EF6\u91CC\u6709\u65E5\u6587\u8BCD\u6761\u548C\u91CA\u4E49\u5217\u3002"),n.some(a=>a.meaning==="\u81EA\u5B9A\u4E49\u5BFC\u5165")&&i.push("\u90E8\u5206\u8BCD\u6CA1\u6709\u8BC6\u522B\u5230\u4E2D\u6587\u91CA\u4E49\uFF0C\u5DF2\u7528\u5360\u4F4D\u91CA\u4E49\u5BFC\u5165\u3002"),{totalRows:t.length,validRows:n.length,duplicateRows:o,skippedRows:s,samples:n.slice(0,5),warnings:i}},Jv=(e,t)=>E("SELECT id FROM words WHERE kanji = ? AND kana = ?",[e,t],0)||E("SELECT id FROM words WHERE kanji = ? OR kana = ? LIMIT 1",[e,t],0),Qv=e=>Math.max(0,8-e.memoryScore)+e.forgotCount*2+e.fuzzyCount+Math.min(e.seenCount,20)/10,Zv=6,eC=(e,t)=>{let r=f=>Math.max(0,Math.min(Math.round(f),Zv)),n=r(t.rightCount),o=r(t.fuzzyCount),s=r(t.forgotCount),i=(f,m)=>Array(m).fill(f),d=t.memoryScore>=4?[...i("forgot",s),...i("fuzzy",o),...i("know",n)]:[...i("know",n),...i("fuzzy",o),...i("forgot",s)];d.length||(d=[t.memoryScore>=4?"know":t.memoryScore>-8?"fuzzy":"forgot"]);let u=new Date(`${t.lastSeenOn??""}T12:00:00`),l=Number.isNaN(u.getTime())?Date.now()-d.length*6e4:u.getTime(),c=null;d.forEach((f,m)=>{let g=t.memoryScore>=8&&f==="know"&&m===d.length-1?"known":"normal";c=Ze(c,f,new Date(l),{mode:g}),l+=6e4}),c&&bt(e,c)},tC=1e12,rC=1e12,Qy=(e,t)=>{let r=`${e}\0${t}`,n=2166136261,o=16777619;for(let s=0;s<r.length;s+=1){let i=r.charCodeAt(s);n=Math.imul(n^i,16777619)>>>0,o=Math.imul(o^i+s,2246822507)>>>0}return tC+(n*4294967296+o)%rC},nC=(e,t)=>{let r=(0,Ad.getDatabase)(),n=Qy(e,t);for(;E("SELECT 1 FROM words WHERE id = ? LIMIT 1",[n],0)===1;){let o=H("SELECT kanji, kana FROM words WHERE id = ?",[n]);if(String(o?.kanji??"")===e&&String(o?.kana??"")===t)break;n+=1}return n},oC=()=>{let e=(0,Ad.getDatabase)(),t=E("SELECT COUNT(*) FROM custom_words c WHERE NOT EXISTS (SELECT 1 FROM words w WHERE w.id = c.word_id)",[],0);return t?(e.run(`
    INSERT INTO words (
      id, meaning, kana, kanji, pos, verb_type, importance,
      shuffle_rank, example_jp, example_meaning, jlpt_level
    )
    SELECT
      c.word_id, c.meaning, c.kana, c.kanji, c.pos, c.verb_type, c.importance,
      ABS(RANDOM()) / 9223372036854775807.0, c.example_jp, c.example_meaning, c.jlpt_level
    FROM custom_words c
    WHERE NOT EXISTS (SELECT 1 FROM words w WHERE w.id = c.word_id)
  `),e.run("INSERT OR IGNORE INTO progress (word_id) SELECT word_id FROM custom_words"),xn(),Bo(),t):0},sC=e=>{X();let t=Jy(e),r=LE(e).map(qy).filter(u=>!!u),n=(0,Ad.getDatabase)();j();let o=T(),s=0,i=0,a=0,d=new Set;n.run("BEGIN TRANSACTION");try{r.forEach(u=>{let l=`${u.kanji}\0${u.kana}`;if(d.has(l))return;d.add(l);let c=Jv(u.kanji,u.kana);c?(n.run(`
          UPDATE words
          SET meaning = CASE WHEN meaning = '' OR meaning = '\u81EA\u5B9A\u4E49\u5BFC\u5165' THEN ? ELSE meaning END,
              pos = CASE WHEN pos = '' OR pos = '\u5BFC\u5165\u8BCD' THEN ? ELSE pos END,
              verb_type = COALESCE(verb_type, ?),
              importance = MAX(importance, ?),
              example_jp = COALESCE(NULLIF(example_jp, ''), ?),
              example_meaning = COALESCE(NULLIF(example_meaning, ''), ?),
              jlpt_level = COALESCE(jlpt_level, ?)
          WHERE id = ?
        `,[u.meaning,u.pos,u.verbType,u.importance,u.exampleJp,u.exampleMeaning,u.jlptLevel,c]),i+=1):(c=nC(u.kanji,u.kana),n.run(`
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
        `,[u.seenCount,u.lastSeenOn??o,u.rightCount,u.fuzzyCount,u.forgotCount,c]),eC(c,u)),u.note&&n.run(`
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
        `,[c,o,Qv(u)]),a+=1)}),R("external_word_list_last_import",JSON.stringify({importedOn:o,inserted:s,updated:i,queuedForReview:a})),n.run("COMMIT")}catch(u){throw n.run("ROLLBACK"),u}return $i(),Pg(),xn(),Bo(),Promise.resolve().then(()=>N(nt(),1)).then(({requestFullSnapshot:u})=>u()),D(),(0,Vy.notifyProgressUpdated)(),{...t,inserted:s,updated:i,queuedForReview:a}}});var CE=le((D$,EN)=>{var go="kalimba",Cd=null,lN=new Map,Dd=16e3,cN=Math.PI*2;function mN(e){go=["kalimba","marimba","epiano"].includes(e)?e:"kalimba"}function OC(e){return go==="marimba"?Math.sin(e):go==="epiano"?Math.sin(e)*.78+Math.sin(e*2)*.22:2/Math.PI*Math.asin(Math.sin(e))}function ie(e,t,r,n,o=!1){return{freq:e,start:t,duration:r,gain:n,sine:o}}function pN(e,t,r,n){let o=(e%12+12)%12/12,s=Array.from({length:9},(a,d)=>{let u=32.703*2**(d+o),l=Math.log2(u/523.25);return{freq:u,weight:Math.exp(-l*l/(2*.85**2))}}),i=s.reduce((a,d)=>a+d.weight,0);return s.map(a=>ie(a.freq,t,r*Math.min(2.2,Math.max(.3,(523.25/a.freq)**.8)),n*a.weight/i))}function AC(e){if(e.startsWith("know-")){let t=Number(e.slice(5));return[...pN(t,0,.16,.23),...pN(t+4,.09,.22,.23)]}return e==="wrong"?[ie(440,0,.18,.12),ie(349.23,.1,.26,.11)]:e==="flip"?[ie(880,0,.06,.06)]:e==="complete"?[ie(523.25,0,.2,.23),ie(659.25,.12,.2,.23),ie(783.99,.24,.32,.25)]:e==="countdown"?[ie(880,0,.1,.105),ie(1046.5,.045,.13,.09)]:e==="relief"?[ie(783.99,0,.09,.13),ie(1046.5,.055,.14,.11)]:e==="save"?[ie(1046.5,0,.07,.16,!0),ie(880,.06,.07,.14,!0),ie(783.99,.12,.1,.12,!0)]:e==="chirp"?[ie(880,0,.05,.1,!0),ie(1046.5,.05,.05,.1,!0),ie(880,.1,.05,.1,!0),ie(1046.5,.15,.08,.1,!0)]:e==="ignite"?[ie(392,0,.14,.16),ie(523.25,.07,.16,.18),ie(783.99,.14,.32,.2)]:e==="gold"?[ie(659.25,0,.1,.12),ie(783.99,.06,.12,.13),ie(1046.5,.12,.38,.15)]:[]}function hC(e){let t=Math.max(...e.map(i=>i.start+i.duration),0)+.04,r=Math.ceil(t*Dd),n=new ArrayBuffer(44+r*2),o=new DataView(n),s=(i,a)=>{for(let d=0;d<4;d++)o.setUint8(i+d,a.charCodeAt(d))};s(0,"RIFF"),o.setUint32(4,36+r*2,!0),s(8,"WAVE"),s(12,"fmt "),o.setUint32(16,16,!0),o.setUint16(20,1,!0),o.setUint16(22,1,!0),o.setUint32(24,Dd,!0),o.setUint32(28,Dd*2,!0),o.setUint16(32,2,!0),o.setUint16(34,16,!0),s(36,"data"),o.setUint32(40,r*2,!0);for(let i=0;i<r;i++){let a=i/Dd,d=0;for(let u of e){let l=a-u.start;if(l<0||l>=u.duration)continue;let c=Math.min(1,l/.012),f=Math.exp(-5.5*l/u.duration);d+=(u.sine?Math.sin(cN*u.freq*l):OC(cN*u.freq*l))*c*f*u.gain}o.setInt16(44+i*2,Math.max(-1,Math.min(1,d))*32767,!0)}return n}function vt(e){if(!(typeof wx>"u"||!wx.createInnerAudioContext||!wx.getFileSystemManager||!wx.env?.USER_DATA_PATH))try{let t=`${go}-${e}`,r=lN.get(t);r||(r=`${wx.env.USER_DATA_PATH}/shushugo-sfx-v1-${t}.wav`,wx.getFileSystemManager().writeFileSync(r,hC(AC(e))),lN.set(t,r)),Cd||(Cd=wx.createInnerAudioContext()),Cd.stop(),Cd.src=r,Cd.play()}catch(t){console.warn("[sounds] \u97F3\u6548\u4E0D\u53EF\u7528",t)}}EN.exports={setSoundTimbre:mN,playKnow:(e=0)=>vt(`know-${(e%12+12)%12}`),playDontKnow:()=>vt("wrong"),playFlip:()=>vt("flip"),playComplete:()=>vt("complete"),playCountdownTick:()=>vt("countdown"),playReliefDeal:()=>vt("relief"),playSave:()=>vt("save"),playStreakChirp:()=>vt("chirp"),playStreakIgnite:()=>vt("ignite"),playStreakGold:()=>vt("gold"),soundAvailable:()=>typeof wx<"u"&&!!(wx.createInnerAudioContext&&wx.getFileSystemManager&&wx.env?.USER_DATA_PATH),previewTimbre(e){let t=go;mN(e),vt("know-0"),go=t}}});var gN=le((I$,fN)=>{fN.exports={setMascotSkin(){},setWalkStyle(){}}});var YD={};M(YD,{achievements:()=>sf,analytics:()=>Dm,confusionCards:()=>va,confusionGroups:()=>ol,dailyPlan:()=>Gp,database:()=>zD,dbUtils:()=>cu,distinctionQuiz:()=>dE,duplicateMerge:()=>EE,examDates:()=>du,favorites:()=>Gm,fsrsScheduler:()=>Ul,fsrsStore:()=>Yl,furigana:()=>tl,furiganaSplit:()=>kp,grammarApi:()=>Ju,grammarFormation:()=>oc,grammarKeyPoints:()=>pE,grammarQuiz:()=>gc,jlptPlan:()=>nu,jlptStatus:()=>yp,kanaProgress:()=>nd,kanjiCharCards:()=>Ra,kanjiReadingUsage:()=>hc,kanjiUnitIndex:()=>yc,kanjiUnitScheduler:()=>Ba,levelPlan:()=>Up,mixedCards:()=>rm,mixedSession:()=>mE,orthography:()=>rl,pitchAccent:()=>cp,planContent:()=>jp,preferences:()=>yu,progressApi:()=>np,questionMeaningIndex:()=>kl,reviewBudget:()=>Vl,sounds:()=>VD,streak:()=>vE,studyCore:()=>zu,studyFocus:()=>QE,studyLoad:()=>Xp,studyMode:()=>Sp,studyTotals:()=>af,syncMerge:()=>AE,syncSchema:()=>$u,syncSnapshot:()=>NE,syncTables:()=>Du,tokenDictionary:()=>ap,userQuestionMeanings:()=>fl,vocabTest:()=>sE,weekly:()=>tf,weeklyReports:()=>nf,wordApi:()=>tp,wordCard:()=>Nl,wordDistinctions:()=>fp,wordLibrary:()=>zp,wordStudyUtils:()=>qp,yuzu:()=>PE,yuzuCatalog:()=>ME});module.exports=_R(YD);var zD=N($());var np={};M(np,{getProgressOverview:()=>K0,seenWordCount:()=>H0});He();G();Nr();En();ne();tr();Re();var _n=`(p.known_forever = 1 OR EXISTS (SELECT 1 FROM reviews r WHERE r.word_id = p.word_id AND r.direction = 'forward')
  OR (p.seen_count > 0 AND NOT EXISTS (SELECT 1 FROM level_prior_baselines b WHERE b.entity='words' AND b.entity_key=CAST(p.word_id AS TEXT))))`,rp=`(p.known_forever = 1 OR EXISTS (SELECT 1 FROM grammar_reviews r WHERE r.grammar_id = p.grammar_id)
  OR (p.seen_count > 0 AND NOT EXISTS (SELECT 1 FROM level_prior_baselines b WHERE b.entity='grammar' AND b.entity_key=CAST(p.grammar_id AS TEXT))))`,H0=()=>H(`SELECT COUNT(*) AS n FROM progress p WHERE ${_n}`)?.n??0;function K0(){ee("\u542F\u52A8 \xB7 \u5355\u8BCD\u8FDB\u5EA6\u521D\u59CB\u5316",X),Ie();let e=A().toISOString(),t=H(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN ${_n} THEN 1 ELSE 0 END) AS seen,
      SUM(CASE WHEN ${_n} AND (p.known_forever = 1 OR ${ge}) THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN p.known_forever = 0 AND p.seen_count > 0 AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?) AND ${te("words","p.word_id")} THEN 1 ELSE 0 END) AS low,
      SUM(CASE WHEN NOT ${_n} THEN 1 ELSE 0 END) AS unseen
    FROM words w
    JOIN progress p ON p.word_id = w.id
    WHERE ${oe()}
  `,[e]),r=p(`
    SELECT
      COALESCE(w.jlpt_level, '\u672A\u5206\u7EA7') AS level,
      COUNT(*) AS total,
      SUM(CASE WHEN ${_n} THEN 1 ELSE 0 END) AS seen,
      SUM(CASE WHEN ${_n} AND (p.known_forever = 1 OR ${ge}) THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN p.known_forever = 0 AND p.seen_count > 0 AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?) AND ${te("words","p.word_id")} THEN 1 ELSE 0 END) AS low,
      SUM(CASE WHEN NOT ${_n} THEN 1 ELSE 0 END) AS unseen
    FROM words w
    JOIN progress p ON p.word_id = w.id
    WHERE w.jlpt_level IN ('N5', 'N4', 'N3', 'N2', 'N1') AND ${oe()}
    GROUP BY w.jlpt_level
    ORDER BY CASE w.jlpt_level WHEN 'N5' THEN 1 WHEN 'N4' THEN 2 WHEN 'N3' THEN 3 WHEN 'N2' THEN 4 WHEN 'N1' THEN 5 ELSE 9 END
  `,[e]).map(o=>({level:String(o.level??""),total:Number(o.total??0),seen:Number(o.seen??0),completed:Number(o.completed??0),low:Number(o.low??0),unseen:Number(o.unseen??0)})),n=p(`
    SELECT
      g.level,
      COUNT(*) AS total,
      SUM(CASE WHEN ${rp} THEN 1 ELSE 0 END) AS seen,
      SUM(CASE WHEN ${rp} AND (p.known_forever = 1 OR ${ge}) THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN p.known_forever = 0 AND p.seen_count > 0 AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?) AND ${te("grammar","p.grammar_id")} THEN 1 ELSE 0 END) AS low,
      SUM(CASE WHEN NOT ${rp} THEN 1 ELSE 0 END) AS unseen
    FROM grammar_points g
    JOIN grammar_progress p ON p.grammar_id = g.id
    GROUP BY g.level
    ORDER BY CASE g.level WHEN 'N5' THEN 1 WHEN 'N4' THEN 2 WHEN 'N3' THEN 3 WHEN 'N2' THEN 4 WHEN 'N1' THEN 5 ELSE 9 END
  `,[e]).map(o=>({level:String(o.level??""),total:Number(o.total??0),seen:Number(o.seen??0),completed:Number(o.completed??0),low:Number(o.low??0),unseen:Number(o.unseen??0)}));return{words:{total:Number(t?.total??0),seen:Number(t?.seen??0),completed:Number(t?.completed??0),low:Number(t?.low??0),unseen:Number(t?.unseen??0)},wordsByLevel:r,grammar:n}}var ap={};M(ap,{lookupTokenEntries:()=>Q0});G();var lS=N(Ar(),1),op=lS.default,io=e=>e.replace(/[ァ-ヶ]/gu,t=>String.fromCodePoint((t.codePointAt(0)??0)-96)),sp=new Set;Object.entries(op).forEach(([,e])=>{let t=e?.[1],r=e?.[2];if(!t||!r)return;let n=op[t];if(!n?.[2])return;let o=io(n[2]),s=io(r);sp.add(`${o}${s}`),sp.add(`${s}${o}`)});var cS={\u3046:"\u3048",\u304F:"\u3051",\u3050:"\u3052",\u3059:"\u305B",\u3064:"\u3066",\u306C:"\u306D",\u3076:"\u3079",\u3080:"\u3081",\u308B:"\u308C"};var Wr=e=>String(e??"").replace(/[\s]/gu,""),mS=e=>{let t=[...e];return t[t.length-1]??""},G0=e=>[...e].slice(0,-1).join(""),pS=(e,t)=>`${G0(e)}${t}`;var B0=(e,t)=>{let r=mS(e);return t[r]?pS(e,t[r]):null};var ES=e=>{let t=Wr(e),r=[];if(t.endsWith("\u3089\u308C\u308B")&&t.length>3&&r.push(`${t.slice(0,-3)}\u308B`),t.endsWith("\u308B")&&t.length>1){let n=t.slice(0,-1),o=mS(n),s=Object.entries(cS).find(([,i])=>i===o)?.[0];s&&r.push(pS(n,s))}return r.filter((n,o)=>n&&r.indexOf(n)===o)},X0=(e,t)=>{let r=io(Wr(e));if(!r)return[];let n="";if(t==="godan"){let i=B0(r,cS);n=i?`${i}\u308B`:""}else t==="ichidan"&&r.endsWith("\u308B")?n=`${r.slice(0,-1)}\u3089\u308C\u308B`:t==="suru"||r==="\u3059\u308B"?n="\u3067\u304D\u308B":(t==="kuru"||r==="\u304F\u308B")&&(n="\u3053\u3089\u308C\u308B");if(!n)return[];let o=n.endsWith("\u308B")?n.slice(0,-1):n;return[o,...["","\u307E\u3059","\u307E\u305B\u3093","\u307E\u3057\u305F","\u307E\u305B\u3093\u3067\u3057\u305F","\u306A\u3044","\u306A\u304B\u3063\u305F","\u306A\u3051\u308C\u3070","\u306A\u304F\u3066","\u3066","\u305F","\u305F\u3089","\u3066\u3044\u308B","\u3066\u3044\u307E\u3059","\u3066\u3044\u305F","\u3066\u3044\u307E\u3057\u305F","\u3066\u3044\u306A\u3044","\u3066\u3044\u307E\u305B\u3093","\u3066\u3057\u307E\u3046","\u3066\u3057\u307E\u3044\u307E\u3059","\u3066\u3057\u307E\u3063\u305F","\u3066\u3057\u307E\u3044\u307E\u3057\u305F"].map(i=>`${o}${i}`),n]},fS=(e,t,r)=>{let n=io(Wr(e));return!!n&&X0(t,r).some(o=>n===o||n.startsWith(o)&&[...n.slice(o.length)].length<=6)},gS=(e,t,r="",n="")=>{let o=Wr(e),s=Wr(t);if(!o||!s||o===s)return!1;let i=(u,l)=>{let c=op[u];return Array.isArray(c)?c.slice(1,3).some(f=>Wr(f)===l):!1};if(i(o,s)||i(s,o))return!0;if(!r||!n)return!1;let a=io(Wr(r)),d=io(Wr(n));return sp.has(`${a}${d}`)};var ip=e=>/^[ぁ-ゖァ-ヺー]+$/u.test(e)&&e.length>=2,Y0=e=>/[\p{Script=Han}]/u.test(e),z0=e=>e.replace(/[ァ-ヶ]/gu,t=>String.fromCodePoint((t.codePointAt(0)??0)-96)),V0=e=>[...e].find(t=>/[\p{Script=Han}]/u.test(t))??"",q0=e=>/动词|動詞/u.test(String(e??"")),J0=(e,t)=>({id:String(e.lookup_source??"jlpt")==="supplement"?String(e.id??""):Number(e.id??0),studyWordId:e.study_word_id==null?null:Number(e.study_word_id),source:String(e.lookup_source??"jlpt")==="supplement"?"supplement":"jlpt",kanji:String(e.kanji??""),kana:String(e.kana??""),meaning:String(e.meaning??""),pos:String(e.pos??""),verbType:String(e.verb_type??""),jlptLevel:String(e.jlpt_level??""),exampleJp:String(e.example_jp??""),exampleMeaning:String(e.example_meaning??""),category:String(e.category??""),usageNote:String(e.usage_note??""),sourceName:String(e.source_name??""),matchedForm:t}),Q0=(e,t="",r=4,n="",o=[])=>{let s=e.trim(),i=n.trim()||s;if(!i)return[];let a=ip(s);try{let d=(m,g=!1)=>p(`
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
    `,[m,g?1:0,m,m,g?1:0,m,m,r]),u=m=>m.map(g=>J0(g,String(g.kanji||g.kana||i))),l=n.trim()&&s!==i&&Y0(s)?[s,i]:[i];for(let m of l){let g=d(m,ip(m)||!n.trim()&&a);if(g.length)return u(g)}let c=[t,...o.map(m=>m.reading??"")];for(let m of l)for(let g of ES(m)){let w=d(g,ip(g)).filter(y=>!q0(y.pos)||gS(m,g,t,String(y.kana??""))?!1:c.some(_=>fS(_,String(y.kana??""),String(y.verb_type??""))));if(w.length)return u(w)}let f=[...o.slice(0,1).map(m=>m.reading??""),t].map(m=>z0(m.trim())).filter(Boolean);for(let m of f){let g=d(m,!0),S=V0(s),w=g.filter(y=>a||S&&String(y.kanji??"").startsWith(S));if(w.length)return u(w)}if(/^[おご]/u.test(i)&&i.length>1){let m=d(i.slice(1),!0);if(m.length)return u(m)}return[]}catch{return[]}};mp();Jr();G();P();En();yt();var fp={};M(fp,{wordDistinctions:()=>oh});sr();Xo();var Va=N(_s(),1),qa=N(ki(),1);La();var yS=N(Ar(),1),pp=e=>({id:e.id,word:be({kanji:e.kanji,kana:e.kana}),kana:e.kana,meaning:e.meaning,exampleJp:e.example?.jp??"",exampleMeaning:e.example?.meaning??"",jlptLevel:e.jlptLevel,note:"",isCurrent:!0,voice:null,subgroup:""}),Ep=e=>({id:Number(e.id??0),word:be(e),kana:e.kana,meaning:e.meaning,exampleJp:"",exampleMeaning:"",jlptLevel:"",note:e.note&&e.note!==e.meaning?e.note:"",isCurrent:!1,voice:null,subgroup:""});function oh(e){let t=[],r=new Set,n=new Set,o=l=>{let c=new Set,f=l.members.filter(S=>{let w=`${S.word}|${S.kana}`;return c.has(w)?!1:(c.add(w),!0)}),m=new Set(f.filter(S=>S.isCurrent).map(S=>`${S.word}|${S.kana}`)),g=f.filter(S=>{if(S.isCurrent)return!0;let w=`${S.word}|${S.kana}`;return!m.has(w)&&(S.id<=0||!r.has(S.id))&&!n.has(w)});g.some(S=>!S.isCurrent)&&(t.push({...l,members:g}),g.forEach(S=>{S.isCurrent||(S.id>0&&r.add(S.id),n.add(`${S.word}|${S.kana}`))}))},s=e.similarMeaning;if(s&&s.source==="manual"){let l=s.items.filter(c=>c.manual!==!1);o({key:`manual:${s.title}`,name:"\u91CA\u4E49\u8FA8\u6790",Icon:qa.NotebookPen,summary:s.distinction,level:"major",members:[pp(e),...l.map(c=>Ep({...c,note:""}))],masterable:!1})}let i=yS.default;hr(e.id).forEach(l=>{let c=Go[l.type],f=(0,Va.distinctionReviewFor)(l.key),m=f?.level==="major"?(0,Va.distinctionNotesFor)(f.summary,l.members.map(g=>({key:String(g.id),forms:[be(g),g.kanji,g.kana]}))):new Map;o({key:l.key,name:c.name,Icon:c.Icon,summary:f?.summary??"",level:f?.level??null,members:to(l.key,l.members,g=>[be(g),g.kanji,g.kana],g=>ro((i[g.kanji]??i[g.kana])?.[0])).map(({member:g,voice:S,subgroup:w})=>({id:g.id,word:be(g),kana:g.kana,meaning:g.meaning,exampleJp:g.exampleJp,exampleMeaning:g.exampleMeaning,jlptLevel:g.jlptLevel,note:m.get(String(g.id))??"",isCurrent:g.id===e.id,voice:S,subgroup:w})),masterable:!0})});let a=e.confusions.filter(l=>l.kind==="sound"&&!r.has(l.id)),d=a.filter(l=>ul(e,l));d.length&&o({key:`derived:${e.id}`,name:Go.stem.name,Icon:Go.stem.Icon,summary:"",level:null,members:[pp(e),...d.map(Ep)],masterable:!1});let u=a.filter(l=>!ul(e,l));return u.length&&o({key:`sound:${e.id}`,name:"\u97F3\u5F62\u76F8\u8FD1",Icon:qa.Eye,summary:"",level:null,members:[pp(e),...u.map(Ep)],masterable:!1}),t}kr();Fn();var Sp={};M(Sp,{STUDY_MODES:()=>Ms,STUDY_MODE_EVENT:()=>NS,VISIBLE_STUDY_MODES:()=>sh,activateMistakesForToday:()=>dh,defaultStudyMode:()=>_p,getStudyMode:()=>ih,saveStudyMode:()=>ah,studyModeInfo:()=>bS});P();var Be=N(ki(),1),Ja="mn-active-study-mode",Is="mn-auto-mistakes-mode",Ms=[{id:"classic",title:"\u7ECF\u5178\u6A21\u5F0F",short:"\u7ECF\u5178",label:"Classic",subtitle:"\u4ECA\u65E5\u8BA1\u5212",description:"\u5F53\u65E5\u5230\u671F\u96C6\uFF0C\u91CA\u4E49 \u2192 \u65E5\u8BED\u3002",Icon:Be.CalendarCheck},{id:"mixed",title:"\u6DF7\u5408\u5B66\u4E60",short:"\u6DF7\u5408",label:"Mixed",subtitle:"\u5355\u8BCD \xB7 \u8BED\u6CD5 \xB7 \u6C49\u5B57 \xB7 \u8FA8\u6790",description:"\u80CC\u8BCD\u65F6\u63D2\u64AD\u8BED\u6CD5\u3001\u5355\u72EC\u6C49\u5B57\u548C\u8FA8\u6790\u8FDE\u7EBF\uFF0C\u6BCF\u65E5\u91CF\u5706\u73AF\u4E0A\u7684\u56DB\u6BB5\u5168\u51FA\u3002",Icon:Be.Shuffle},{id:"mistakes",title:"\u5B66\u4E60\u9519\u9898\u672C",short:"\u9519\u9898\u672C",label:"Mistakes",subtitle:"\u957F\u671F\u8584\u5F31\u8BCD",description:"\u53EA\u5237\u957F\u671F\u8584\u5F31\u8BCD\uFF0C\u4E0D\u5360\u4ECA\u65E5\u8BA1\u5212\u3002",Icon:Be.Brain},{id:"quick",title:"\u5FEB\u901F\u590D\u4E60",short:"\u5FEB\u901F",label:"Quick",subtitle:"\u4E00\u9875 50 \u5F20",description:"\u4ECA\u65E5\u8BA1\u5212\u4E00\u9875\u94FA 50 \u5F20\u7FFB\u7740\u770B\u3002",Icon:Be.NotebookPen,page:"quick-study"},{id:"reverse",title:"\u53CD\u5411\u5B66\u4E60",short:"\u53CD\u5411",label:"Reverse",subtitle:"\u65E5\u8BED \u2192 \u91CA\u4E49",description:"\u51FA\u65E5\u8BED\uFF0C\u56DE\u5FC6\u91CA\u4E49\u3002\u81EA\u5DF1\u4E00\u5957\u5230\u671F\u96C6\u3002",Icon:Be.Repeat},{id:"kanji",title:"\u6C49\u5B57\u8BFB\u97F3",short:"\u6C49\u5B57",label:"Kanji",subtitle:"\u770B\u8868\u8BB0 \u2192 \u56DE\u5FC6\u8BFB\u97F3",description:"\u53EA\u906E\u6C49\u5B57\u7684\u8BFB\u97F3\uFF0C\u70B9\u5361\u63ED\u6653\u3002",Icon:Be.Languages},{id:"picked",title:"\u81EA\u9009\u6E05\u5355",short:"\u81EA\u9009",label:"Picked",subtitle:"\u4F60\u5728\u8BCD\u5E93\u91CC\u52FE\u7684\u8BCD",description:"\u53EA\u51FA\u52FE\u4E2D\u7684\u8BCD\uFF0C\u4E0D\u770B\u5230\u671F\u3002",Icon:Be.Target,hidden:!0,transient:!0}],NS="mn:study-mode",sh=Ms.filter(e=>!e.hidden),RS=new Set(Ms.map(e=>e.id)),_p="classic",bS=e=>Ms.find(t=>t.id===e)??Ms[0],wp=e=>typeof e=="string"&&RS.has(e)?e:_p,Tp=()=>{let e=localStorage.getItem(Is);if(!e)return null;try{let t=JSON.parse(e);return typeof t.studyDate!="string"?null:{studyDate:t.studyDate,returnMode:wp(t.returnMode),dismissed:t.dismissed===!0}}catch{return null}},gp=()=>{let e=localStorage.getItem(Ja);return e&&RS.has(e)?e:_p};function ih(e=new Date){let t=Tp();return t?.studyDate===B(e)?t.dismissed?gp():"mistakes":(t&&(t.dismissed||localStorage.setItem(Ja,t.returnMode),localStorage.removeItem(Is)),gp())}function ah(e,t=new Date){let r=wp(e);bS(r).transient||localStorage.setItem(Ja,r);let n=Tp();return n?.studyDate===B(t)?localStorage.setItem(Is,JSON.stringify({...n,dismissed:!0})):n&&localStorage.removeItem(Is),typeof window<"u"&&window.dispatchEvent(new Event(NS)),r}function dh(e,t=new Date){let r=wp(e);if(r==="mistakes")return r;let n=Tp();return n?.studyDate===B(t)?n.dismissed?gp():"mistakes":(localStorage.setItem(Ja,r),localStorage.setItem(Is,JSON.stringify({studyDate:B(t),returnMode:r})),"mistakes")}ne();Ke();var Gp={};M(Gp,{PLAN_KINDS:()=>wn,PLAN_LABELS:()=>js,SECONDS_PER_CARD:()=>$p,STUDY_INTENSITY:()=>sy,applyExamPreset:()=>qh,applyStudyIntensity:()=>Jh,arrangedPlan:()=>Yh,dailyPlanView:()=>Hp,examPreset:()=>oy,hasPendingPlanTotal:()=>Hh,learnedLevel:()=>Vh,previewCurrentLevelPlan:()=>ry,remainingPlanWords:()=>Pp,saveDailyPlan:()=>Kp,segmentLength:()=>zh});He();Se();var yp={};M(yp,{getJlptPlanStatus:()=>Qa});He();G();un();Nr();Se();St();Re();Rn();wt();var uh=e=>`(w.jlpt_level IN (${Tr(e).map(r=>`'${r}'`).join(", ")}) OR w.jlpt_level IS NULL OR w.jlpt_level = '')`,lh=e=>`g.level IN (${Tr(e).map(r=>`'${r}'`).join(", ")})`,ch=(e=new Date)=>{let t=A(e);return t.setDate(t.getDate()-1),t};function Qa(e=new Date){X(),Ie();let t=Su(),r=t.target,n=t.examDate?Dt(t.examDate):null,o=Dt(t.startedOn),s=n??bo(t.examKind,o??e),i=T(e),a=A(e).toISOString(),d=ch(e).toISOString(),u=uh(r),l=lh(r),c=`word_id IN (SELECT w.id FROM words w WHERE ${u})`,f=`grammar_id IN (SELECT g.id FROM grammar_points g WHERE ${l})`,m=E(`SELECT COUNT(*) FROM words w LEFT JOIN progress p ON p.word_id = w.id WHERE ${u} AND ${oe()}`,[],0),g=E(`
    SELECT COUNT(*) FROM words w
    JOIN progress p ON p.word_id = w.id
    WHERE ${u} AND NOT ${me()} AND ${ye()}
  `,[],0),S=E(`
    SELECT COUNT(*) FROM words w JOIN progress p ON p.word_id = w.id
    WHERE ${u} AND (p.known_forever = 1 OR EXISTS (SELECT 1 FROM reviews r WHERE r.word_id = p.word_id))
  `,[],0),w=E(`
    SELECT COUNT(*) FROM words w
    JOIN progress p ON p.word_id = w.id
    WHERE ${u} AND ${J()} AND p.known_forever = 0
      AND (p.fsrs_due IS NULL OR (p.fsrs_due <= ? AND p.fsrs_due >= ?))
      AND NOT ${Vr("words","p.word_id",i)}
  `,[a,d],0)+Fo("words",new Date(a),i).filter(Z=>E(`SELECT 1 FROM words w WHERE w.id = ? AND ${u}`,[Z],0)).length+Uo("words",i,c),y=E(`
    SELECT COUNT(*) FROM words w
    JOIN progress p ON p.word_id = w.id
    WHERE ${u} AND ${J()} AND p.known_forever = 0
      AND p.fsrs_due IS NOT NULL AND p.fsrs_due < ?
      AND NOT ${pe("words","p.word_id")}
  `,[d],0),_=E(`SELECT COUNT(*) FROM grammar_points g WHERE ${l}`,[],0),b=E(`
    SELECT COUNT(*) FROM grammar_points g
    JOIN grammar_progress p ON p.grammar_id = g.id
    WHERE ${l} AND p.seen_count = 0 AND p.known_forever = 0
  `,[],0),k=E(`
    SELECT COUNT(*) FROM grammar_points g JOIN grammar_progress p ON p.grammar_id = g.id
    WHERE ${l} AND (p.known_forever = 1 OR EXISTS (SELECT 1 FROM grammar_reviews r WHERE r.grammar_id = p.grammar_id))
  `,[],0),C=E(`
    SELECT COUNT(*) FROM grammar_points g
    JOIN grammar_progress p ON p.grammar_id = g.id
    WHERE ${l} AND p.seen_count > 0 AND p.known_forever = 0
      AND (p.fsrs_due IS NULL OR (p.fsrs_due <= ? AND p.fsrs_due >= ?))
      AND NOT ${Vr("grammar","p.grammar_id",i)}
  `,[a,d],0)+Fo("grammar",new Date(a),i,f).length+Uo("grammar",i,f),L=E(`
    SELECT COUNT(*) FROM grammar_points g
    JOIN grammar_progress p ON p.grammar_id = g.id
    WHERE ${l} AND p.seen_count > 0 AND p.known_forever = 0
      AND p.fsrs_due IS NOT NULL AND p.fsrs_due < ?
      AND NOT ${pe("grammar","p.grammar_id")}
  `,[d],0),I=E(`
    SELECT COUNT(DISTINCT r.word_id)
    FROM reviews r
    JOIN words w ON w.id = r.word_id
    WHERE r.reviewed_on = ? AND ${u}
      AND NOT EXISTS (
        SELECT 1 FROM reviews earlier
        WHERE earlier.word_id = r.word_id AND earlier.reviewed_on < ?
      )
      AND NOT ${fe("words","r.word_id")}
  `,[i,i],0),x=E(`
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
      AND NOT ${fe("grammar","r.grammar_id")}
  `,[i,i],0),F=E(`
    SELECT COUNT(DISTINCT r.grammar_id)
    FROM grammar_reviews r
    JOIN grammar_points g ON g.id = r.grammar_id
    WHERE r.reviewed_on = ? AND ${l}
  `,[i],0),K=tu({today:e,examDate:s,planStartedOn:o,unseenWords:g,unseenGrammar:b,freshDueWords:w,overdueWords:y,freshDueGrammar:C,overdueGrammar:L}),Q={newWordsDone:I,reviewWordsDone:Math.max(x-I,0),newGrammarDone:U,reviewGrammarDone:Math.max(F-U,0)};return{enabled:t.enabled,target:r,examKind:t.examKind,finished:e>=ii(t.examKind,s),examDate:s,examDateSource:n?"manual":"auto",plan:K,done:Q,shortfall:ru(K,Q),coverage:{words:{seen:S,total:m},grammar:{seen:k,total:_}}}}wt();G();eo();ln();Lt();ne();Re();ds();Os();Ha();id();var BS={words:12,grammar:25,kanji:10,confusion:40},$h=[3,2,1.5,1.5,.5,.5,.5,.5],Ph=e=>e<=30?"light":e<=60?"steady":e<=90?"heavy":"aggressive";function XS(e){let t=Math.max(1,Math.min(12,e.weeks??8)),r=Math.ceil(Math.max(0,e.intakeDaysLeft??t*7)/7),n=Array.from({length:t},(i,a)=>{let d=0,u=0;for(let l of Object.keys(BS)){let c=Number(e.existingDuePerWeek?.[a]?.[l]??0)/7;for(let f=0;f<=a&&f<r;f+=1){let m=a-f;c+=e.dailyNew[l]*($h[m]??.5)}u+=c,d+=c*BS[l]}return{week:a+1,minutes:Math.round(d/60),answers:Math.round(u)}}),o=n.reduce((i,a)=>a.minutes>i.minutes?a:i,n[0]),s=n[Math.min(3,n.length-1)].minutes;return{perWeek:n,peakWeek:o.week,steadyMinutes:s,tier:Ph(s)}}var jp={};M(jp,{CONTENT_BY_LEVEL:()=>Fp,CONTENT_MATRIX:()=>qS,VISIBLE_STARTS:()=>zS,expectedContent:()=>JS,previewLevelPlan:()=>Wp});wt();var Fp={N5:{words:912,grammar:122,kanji:448,confusion:8},N4:{words:846,grammar:136,kanji:362,confusion:33},N3:{words:1906,grammar:145,kanji:408,confusion:58},N2:{words:3235,grammar:153,kanji:390,confusion:91},N1:{words:4020,grammar:197,kanji:362,confusion:154}},zS=["kana-none","kana",...W],Ws=["words","grammar","kanji","confusion"],VS=()=>({words:0,grammar:0,kanji:0,confusion:0}),qS=Object.fromEntries(zS.map(e=>[e,Object.fromEntries(W.map(t=>{let r=W.indexOf(e),n=W.indexOf(t),o=VS();for(let s=r+1;s<=n;s+=1)for(let i of Ws)o[i]+=Fp[W[s]][i];return[t,o]}))])),JS=(e,t,r,n)=>{if(e==="beyond")return VS();let o={...qS[e][t]};if(W.includes(e)&&W.indexOf(e)<=W.indexOf(t))for(let s of Ws)r?.[s]===0&&(o[s]+=Fp[e][s]);return o},YS={words:50,grammar:12,kanji:50,confusion:20},Wp=e=>{let t=e.today??new Date,r=Jt(t,e.examDate),n=Jt(e.startedOn??t,e.examDate),o=si(n),s=e.startingLevel==="kana-none"&&!e.kanaCompleted?7:0,i=Math.max(0,r-o-s),a={...JS(e.startingLevel,e.target,e.familiarity,e.includeOptionalExpressions)};Number.isFinite(e.remainingWords)&&(a.words=Math.max(0,Math.floor(e.remainingWords)));let d=Object.fromEntries(Ws.map(c=>[c,Math.ceil(a[c]/Math.max(1,i))])),u=Object.fromEntries(Ws.map(c=>[c,Math.min(d[c],YS[c])])),l=r>0&&i>0&&Ws.every(c=>d[c]<=YS[c]);return{content:a,required:d,daily:u,daysLeft:r,intakeDays:i,reviewDays:o,kanaDays:s,feasible:l}};Rn();xs();un();var wn=["words","grammar","kanji","confusion"],Hh=(e,t)=>e!==null&&Number(e)!==t,js={words:"\u5355\u8BCD",grammar:"\u8BED\u6CD5",kanji:"\u6C49\u5B57",confusion:"\u8FA8\u6790"},$p={words:12,grammar:25,kanji:10,confusion:40},Kh={N5:0,N4:1,N3:2,N2:3,N1:4},uo=(e,t)=>e<=0?0:Math.ceil(e/Math.max(1,t)),ZS=()=>Hn(A()),ey=e=>{let t=Tr(e).map(r=>`'${r}'`).join(", ");return{due:as(At).due,unseen:E(`
      SELECT COUNT(*) FROM grammar_progress p JOIN grammar_points g ON g.id = p.grammar_id
      WHERE g.level IN (${t}) AND p.known_forever = 0 AND p.seen_count = 0
    `,[],0)}},Gh=(e,t)=>{if(e===Ln)return t;let r=Cr(e);return Math.min(t,r)},ty=()=>oo().total+so().total,QS=(e,t,r)=>Math.min(t,Dr(e,r)),Pp=(e,t,r,n)=>{if(e==="beyond")return 0;let o=W.indexOf(e),s=W.indexOf(t),i=o<0?0:o+(r?.words===0?0:1),a=W.slice(i,s+1);if(!a.length)return 0;X();let d=a.map(l=>`'${l}'`).join(", ");return E(`
    SELECT COUNT(*) FROM words w
    LEFT JOIN progress p ON p.word_id = w.id
    WHERE (w.jlpt_level IN (${d})${i===0?" OR w.jlpt_level IS NULL OR w.jlpt_level = ''":""})
      AND NOT ${me()}
      AND ${ye("w","p",n)}
  `,[],0)},ry=e=>Wp({...e,remainingWords:Pp(e.startingLevel,e.target,e.familiarity,e.includeOptionalExpressions)}),Hp=(e=st())=>{let t=Qa(),r=e.jlptTarget,n=Kh[r]??2,o=t.plan.intakeDaysLeft,s=ty(),i=ZS()+s,a=ey(r),d=Na(n),u=ka(n),l={words:Me(ue).length,grammar:as(At).prior,kanji:Uc(),confusion:Gc()},c=[{kind:"words",label:js.words,fresh:ai()?0:e.dailyGoal,review:Gh(e.reviewCap,i-s-l.words)+s+l.words,pool:{due:i,unseen:Pp("kana",r,void 0,e.includeOptionalExpressions)},suggest:{fresh:t.plan.newWords,review:i}},{kind:"grammar",label:js.grammar,fresh:e.grammarDailyGoal,review:as(At,e.grammarReviewCap).review,pool:a,suggest:{fresh:t.plan.newGrammar,review:a.due}},{kind:"kanji",label:js.kanji,fresh:e.kanjiDailyGoal,review:QS(e.kanjiReviewCap,d.due-l.kanji,"kanji")+l.kanji,pool:d,suggest:{fresh:o>0?uo(d.unseen,o):0,review:d.due}},{kind:"confusion",label:js.confusion,fresh:e.confusionDailyGoal,review:QS(e.confusionReviewCap,u.due-l.confusion,"confusion")+l.confusion,pool:u,suggest:{fresh:o>0?uo(u.unseen,o):0,review:u.due}}],f=c.reduce((g,S)=>g+S.fresh+S.review,0),m=Math.round(c.reduce((g,S)=>g+(S.fresh+S.review)*$p[S.kind],0)/60);return{total:f,segments:c,daysLeft:t.plan.daysLeft,minutes:m,wordExtras:s,priorExtras:l}},ny="mn-daily-plan-baseline",Bh=e=>({words:e.dailyGoal,grammar:e.grammarDailyGoal,kanji:e.kanjiDailyGoal,confusion:e.confusionDailyGoal}),Xh=()=>{try{let e=JSON.parse(localStorage.getItem(ny)??"null");if(e&&wn.every(t=>Number.isFinite(e[t])))return e}catch{}return Bh(de)},Yh=e=>{let t=Xh();return Object.fromEntries(e.segments.map(r=>[r.kind,{fresh:t[r.kind],review:r.pool.due}]))},Kp=(e,t=!1,r=Hp())=>{let n=Y();if(t)try{localStorage.setItem(ny,JSON.stringify(Object.fromEntries(wn.map(i=>[i,e[i].fresh]))))}catch{}let o=i=>r.segments.find(a=>a.kind===i)?.review??0,s=(i,a)=>{let d=e[i];if(d.fresh+d.review===0)return Qt;if(d.review===o(i))return a;let u=d.review-(r.priorExtras?.[i]??0);return u>0?u:Qt};ot({...n,dailyGoal:e.words.fresh,reviewCap:e.words.review===o("words")?n.reviewCap:Math.max(1,e.words.review-r.wordExtras-(r.priorExtras?.words??0)),grammarDailyGoal:e.grammar.fresh,grammarReviewCap:s("grammar",n.grammarReviewCap),kanjiDailyGoal:e.kanji.fresh,kanjiReviewCap:s("kanji",n.kanjiReviewCap),confusionDailyGoal:e.confusion.fresh,confusionReviewCap:s("confusion",n.confusionReviewCap)})},zh=e=>Math.log1p(Math.max(0,e)),Vh=()=>{if(jr())return xp();let e=p(`
    SELECT w.jlpt_level AS level, SUM(${J()} OR p.known_forever = 1) AS seen, COUNT(*) AS total
    FROM progress p JOIN words w ON w.id = p.word_id WHERE ${oe()} GROUP BY w.jlpt_level
  `),t=new Map(e.map(n=>[String(n.level),Number(n.seen)/Math.max(1,Number(n.total))])),r=null;for(let n of W){if((t.get(n)??0)<.5)break;r=n}return r},oy=e=>{let t=Qa(),r=jr(),n=r?ry({startingLevel:r.startingLevel,familiarity:r.familiarity,target:e,examDate:t.examDate,startedOn:Dt(r.startedOn)??void 0,kanaCompleted:r.startingLevel==="kana-none"&&gr()}):null,o=n?.intakeDays??t.plan.intakeDaysLeft,s=W.indexOf(e),i=W.slice(0,s+1).map(b=>`'${b}'`).join(", "),a=n?.content.words??E(`
    SELECT COUNT(*) FROM progress p JOIN words w ON w.id = p.word_id
    WHERE w.jlpt_level IN (${i}) AND NOT ${me()} AND ${ye()}
  `,[],0),d=n?.content.grammar??E(`
    SELECT COUNT(*) FROM grammar_progress p JOIN grammar_points g ON g.id = p.grammar_id
    WHERE g.level IN (${i}) AND p.seen_count = 0 AND p.known_forever = 0
  `,[],0),u=n?.content.kanji??E("SELECT COUNT(*) FROM kanji_char_memory WHERE known_forever = 0 AND seen_count = 0 AND level_rank <= ?",[s],0),l=n?.content.confusion??E("SELECT COUNT(*) FROM confusion_progress WHERE known_forever = 0 AND seen_count = 0 AND level_rank <= ? AND group_key NOT IN (SELECT group_key FROM confusion_mastered)",[s],0),c=ka(s),f={words:{fresh:n?.daily.words??Math.min(50,uo(a,o)),review:ZS()+ty()},grammar:{fresh:n?.daily.grammar??Math.min(12,uo(d,o)),review:ey(e).due},kanji:{fresh:n?.daily.kanji??Math.min(50,uo(u,o)),review:Na(s).due},confusion:{fresh:n?.daily.confusion??Math.min(20,uo(l,o)),review:c.due}},m=Math.round(wn.reduce((b,k)=>b+(f[k].fresh+f[k].review)*$p[k],0)/60),g={words:"progress",grammar:"grammar_progress",kanji:"kanji_char_memory",confusion:"confusion_progress"},S=Array.from({length:56},(b,k)=>{let C=A();return C.setDate(C.getDate()+k),C}),w=Object.fromEntries(wn.map(b=>[b,Oi(b,S)])),y=Array.from({length:8},(b,k)=>{let C=new Date;C.setHours(0,0,0,0),C.setDate(C.getDate()+k*7);let L=new Date(C);return L.setDate(L.getDate()+7),Object.fromEntries(Object.keys(g).map(I=>[I,E(`SELECT COUNT(*) FROM ${g[I]} WHERE known_forever = 0 AND fsrs_due >= ? AND fsrs_due < ?
        AND NOT ${pe(I,`${g[I]}.${Qu[I].idColumn}`)}`,[C.toISOString(),L.toISOString()],0)+w[I].slice(k*7,(k+1)*7).reduce((x,U)=>x+U,0)]))}),_=XS({dailyNew:Object.fromEntries(wn.map(b=>[b,f[b].fresh])),existingDuePerWeek:y,intakeDaysLeft:o,weeks:8});return{plan:f,minutes:m,load:_,daysLeft:t.plan.daysLeft,intakeDays:o,remaining:{words:a,grammar:d,kanji:u,confusion:l},expected:n}},qh=e=>{let t=oy(e),r=Y();return ot({...r,jlptTarget:e}),Kp(t.plan,!0),t},sy={light:{label:"\u8F7B\u677E",words:10,grammar:2,kanji:3,confusion:2},normal:{label:"\u6807\u51C6",words:15,grammar:5,kanji:5,confusion:5},hard:{label:"\u52A0\u628A\u52B2",words:30,grammar:8,kanji:10,confusion:8}},Jh=e=>{let t=Hp(),r=o=>t.segments.find(s=>s.kind===o)?.review??0,n=Object.fromEntries(wn.map(o=>[o,{fresh:sy[e][o],review:r(o)}]));return Kp(n,!0,t),{plan:n}};var Xp={};M(Xp,{dailyStudyLoad:()=>ok});He();G();Se();ne();Re();St();var Qh=14,Zh=7,Bp=(e,t)=>{let r=new Date(`${e}T12:00:00`);return r.setDate(r.getDate()+t),B(r)},lo=ue,ek=(e,t)=>{let r=new Map,n=(o,s,i)=>{if(!o)return;let a=r.get(o)??{cards:0,fresh:0};a[s]+=i,r.set(o,a)};return p(`
    SELECT reviewed_on, COUNT(DISTINCT word_id) AS cards
    FROM reviews
    WHERE direction = 'forward' AND reviewed_on BETWEEN ? AND ?
    GROUP BY reviewed_on
  `,[e,t]).forEach(o=>n(String(o.reviewed_on??""),"cards",Number(o.cards??0))),p(`
    SELECT reviewed_on, COUNT(*) AS fresh
    FROM (
      SELECT word_id, MIN(reviewed_on) AS reviewed_on
      FROM reviews
      WHERE direction = 'forward' AND NOT ${fe("words","reviews.word_id")}
      GROUP BY word_id
    )
    WHERE reviewed_on BETWEEN ? AND ?
    GROUP BY reviewed_on
  `,[e,t]).forEach(o=>n(String(o.reviewed_on??""),"fresh",Number(o.fresh??0))),r},tk=(e,t)=>{let r=new Array(e).fill(0);if(e<=0)return r;let n=[],o=A(t);for(let u=0;u<=e;u+=1){let l=new Date(o);l.setDate(l.getDate()+u),n.push(l.getTime())}let s=new Date(n[0]).toISOString(),i=new Date(n[e]).toISOString();j(lo),p(`
    SELECT fsrs_due FROM ${lo.table}
    WHERE ${lo.eligible} AND fsrs_due >= ? AND fsrs_due < ?
      AND NOT ${pe("words","progress.word_id")}
  `,[s,i]).forEach(u=>{let l=new Date(String(u.fsrs_due??"")).getTime();if(!Number.isFinite(l))return;let c=0;for(;c<e-1&&l>=n[c+1];)c+=1;r[c]+=1});let a=Array.from({length:e+1},(u,l)=>{let c=A(t);return c.setDate(c.getDate()+l),c}),d=Oi("words",a);return r.forEach((u,l)=>{r[l]+=d[l+1]}),r},rk=e=>{let t=A(e).toISOString();return j(lo),Number(p(`
    SELECT COUNT(*) AS n FROM ${lo.table}
    WHERE ${lo.eligible} AND (fsrs_due IS NULL OR fsrs_due <= ?)
      AND ${te("words","progress.word_id",A(e),T(e))}
  `,[t])[0]?.n??0)},nk=()=>Number(p(`
  SELECT COUNT(*) AS n FROM progress p JOIN words w ON w.id = p.word_id WHERE ${ye()}
`)[0]?.n??0),ok=(e={})=>{let t=e.now??new Date,r=Math.max(e.pastDays??Qh,1),n=Math.max(e.futureDays??Zh,0),o=T(t),s=Bp(o,-(r-1)),i=ek(s,o),a=[];for(let w=r-1;w>=0;w-=1){let y=Bp(o,-w),_=i.get(y)??{cards:0,fresh:0};a.push({date:y,fresh:_.fresh,review:Math.max(_.cards-_.fresh,0),pending:0,forecast:!1,today:w===0})}let d=Math.max(Zt(),0),u=nk(),l=a[a.length-1];if(l?.today){let w=Math.min(Math.max(d-l.fresh,0),u);l.pending=rk(t)+w,u-=w}let c=tk(n,t);for(let w=0;w<n;w+=1){let y=Math.min(d,u);u-=y,a.push({date:Bp(o,w+1),fresh:y,review:c[w]??0,pending:0,forecast:!0,today:!1})}let f=w=>w.fresh+w.review+w.pending,m=a.filter(w=>!w.forecast&&!w.today),g=a.filter(w=>w.forecast),S=w=>w.length?Math.round(w.reduce((y,_)=>y+f(_),0)/w.length):0;return{bars:a,pastAverage:S(m),forecastAverage:S(g)}};var zp={};M(zp,{DEFAULT_LIBRARY_FILTERS:()=>dk,MEMORY_BANDS:()=>$s,POS_BUCKETS:()=>ik,bandMeta:()=>sk,classifyPos:()=>Ps,queryWordLibrary:()=>mk,resetWordLibraryCaches:()=>Yp,romajiToKana:()=>ay,tallyWordLibrary:()=>Ek,wordLibraryDetail:()=>fk,wordLibraryIds:()=>gk});ne();Re();G();En();var $s=[{id:"mastered",label:"\u5DF2\u638C\u63E1",hint:"\u95F4\u9694\u5DF2\u7ECF\u62C9\u5230\u534A\u5E74\u4EE5\u4E0A\uFF0C\u6216\u4F60\u624B\u52A8\u6807\u4E86\u719F\u77E5"},{id:"d5",label:"3 \u4E2A\u6708+",hint:"\u8BB0\u5F97\u5F88\u7262\uFF0C\u4E09\u4E2A\u6708\u540E\u624D\u9700\u8981\u518D\u770B\u4E00\u773C"},{id:"d4",label:"1\u20133 \u4E2A\u6708",hint:"\u7A33\u56FA\uFF0C\u957F\u95F4\u9694\u590D\u4E60\u4E2D"},{id:"d3",label:"1\u20133 \u5468",hint:"\u6B63\u5728\u53D8\u719F"},{id:"d2",label:"3\u20137 \u5929",hint:"\u8FD8\u4E0D\u7262\uFF0C\u9694\u51E0\u5929\u5C31\u4F1A\u5FD8"},{id:"d1",label:"1\u20133 \u5929",hint:"\u751F\u758F\uFF0C\u6491\u4E0D\u8FC7\u51E0\u5929"},{id:"d0",label:"\u4E0D\u5230 1 \u5929",hint:"\u57FA\u672C\u6CA1\u8BB0\u4F4F\uFF0C\u660E\u5929\u5C31\u4F1A\u5FD8"},{id:"unseen",label:"\u672A\u5B66",hint:"\u8FD8\u6CA1\u5B66\u8FC7\u8FD9\u4E2A\u8BCD"}],sk=e=>$s.find(t=>t.id===e)??$s[$s.length-1],ik=[{id:"noun",label:"\u540D\u8BCD"},{id:"suru",label:"\u3059\u308B\u52A8\u8BCD"},{id:"verb",label:"\u52A8\u8BCD"},{id:"adj",label:"\u5F62\u5BB9\u8BCD"},{id:"adv",label:"\u526F\u8BCD"},{id:"pron",label:"\u4EE3\u8BCD\xB7\u8FDE\u4F53"},{id:"affix",label:"\u63A5\u8F9E\xB7\u52A9\u8BCD"},{id:"other",label:"\u611F\u53F9\xB7\u60EF\u7528\xB7\u5176\u4ED6"}],Ps=e=>{let t=(e??"").trim();return t?/サ变|サ変|する/.test(t)?"suru":/形容词|形容詞|形动|形動|^形$/.test(t)?"adj":/动词|動詞|他动|自动|他動|自動/.test(t)?"verb":/^名|^代名/.test(t)?"noun":/副词|副詞/.test(t)?"adv":/^代|連体|连体/.test(t)?"pron":/接尾|接頭|接头|^接|造|助$|助词|格助|終助|接助|助动/.test(t)?"affix":"other":"other"},dd=null,ak=()=>{if(dd)return dd;let e=new Map;return p("SELECT DISTINCT pos FROM words").forEach(t=>{let r=String(t.pos??""),n=Ps(r),o=e.get(n)??[];o.push(r),e.set(n,o)}),dd=e,e},Yp=()=>{dd=null},dk={level:"all",band:"all",pos:"all",search:"",sort:"level"},iy={a:"\u3042",i:"\u3044",u:"\u3046",e:"\u3048",o:"\u304A",ka:"\u304B",ki:"\u304D",ku:"\u304F",ke:"\u3051",ko:"\u3053",ga:"\u304C",gi:"\u304E",gu:"\u3050",ge:"\u3052",go:"\u3054",sa:"\u3055",si:"\u3057",shi:"\u3057",su:"\u3059",se:"\u305B",so:"\u305D",za:"\u3056",zi:"\u3058",ji:"\u3058",zu:"\u305A",ze:"\u305C",zo:"\u305E",ta:"\u305F",ti:"\u3061",chi:"\u3061",tu:"\u3064",tsu:"\u3064",te:"\u3066",to:"\u3068",da:"\u3060",di:"\u3062",du:"\u3065",de:"\u3067",do:"\u3069",na:"\u306A",ni:"\u306B",nu:"\u306C",ne:"\u306D",no:"\u306E",ha:"\u306F",hi:"\u3072",hu:"\u3075",fu:"\u3075",he:"\u3078",ho:"\u307B",ba:"\u3070",bi:"\u3073",bu:"\u3076",be:"\u3079",bo:"\u307C",pa:"\u3071",pi:"\u3074",pu:"\u3077",pe:"\u307A",po:"\u307D",ma:"\u307E",mi:"\u307F",mu:"\u3080",me:"\u3081",mo:"\u3082",ya:"\u3084",yu:"\u3086",yo:"\u3088",ra:"\u3089",ri:"\u308A",ru:"\u308B",re:"\u308C",ro:"\u308D",wa:"\u308F",wi:"\u3046\u3043",we:"\u3046\u3047",wo:"\u3092",kya:"\u304D\u3083",kyu:"\u304D\u3085",kyo:"\u304D\u3087",gya:"\u304E\u3083",gyu:"\u304E\u3085",gyo:"\u304E\u3087",sya:"\u3057\u3083",syu:"\u3057\u3085",syo:"\u3057\u3087",sha:"\u3057\u3083",shu:"\u3057\u3085",sho:"\u3057\u3087",zya:"\u3058\u3083",zyu:"\u3058\u3085",zyo:"\u3058\u3087",jya:"\u3058\u3083",jyu:"\u3058\u3085",jyo:"\u3058\u3087",ja:"\u3058\u3083",ju:"\u3058\u3085",jo:"\u3058\u3087",je:"\u3058\u3047",tya:"\u3061\u3083",tyu:"\u3061\u3085",tyo:"\u3061\u3087",cya:"\u3061\u3083",cyu:"\u3061\u3085",cyo:"\u3061\u3087",cha:"\u3061\u3083",chu:"\u3061\u3085",cho:"\u3061\u3087",che:"\u3061\u3047",dya:"\u3062\u3083",dyu:"\u3062\u3085",dyo:"\u3062\u3087",nya:"\u306B\u3083",nyu:"\u306B\u3085",nyo:"\u306B\u3087",hya:"\u3072\u3083",hyu:"\u3072\u3085",hyo:"\u3072\u3087",bya:"\u3073\u3083",byu:"\u3073\u3085",byo:"\u3073\u3087",pya:"\u3074\u3083",pyu:"\u3074\u3085",pyo:"\u3074\u3087",mya:"\u307F\u3083",myu:"\u307F\u3085",myo:"\u307F\u3087",rya:"\u308A\u3083",ryu:"\u308A\u3085",ryo:"\u308A\u3087",fa:"\u3075\u3041",fi:"\u3075\u3043",fe:"\u3075\u3047",fo:"\u3075\u3049",fya:"\u3075\u3083",fyu:"\u3075\u3085",fyo:"\u3075\u3087",va:"\u3094\u3041",vi:"\u3094\u3043",vu:"\u3094",ve:"\u3094\u3047",vo:"\u3094\u3049",tsa:"\u3064\u3041",tsi:"\u3064\u3043",tse:"\u3064\u3047",tso:"\u3064\u3049",she:"\u3057\u3047",thi:"\u3066\u3043",thu:"\u3066\u3085",dhi:"\u3067\u3043",dhu:"\u3067\u3085",twa:"\u3068\u3041",twi:"\u3068\u3043",twu:"\u3068\u3045",twe:"\u3068\u3047",two:"\u3068\u3049",dwa:"\u3069\u3041",dwi:"\u3069\u3043",dwu:"\u3069\u3045",dwe:"\u3069\u3047",dwo:"\u3069\u3049",kwa:"\u304F\u3041",kwi:"\u304F\u3043",kwe:"\u304F\u3047",kwo:"\u304F\u3049",gwa:"\u3050\u3041",gwi:"\u3050\u3043",gwe:"\u3050\u3047",gwo:"\u3050\u3049",wha:"\u3046\u3041",whi:"\u3046\u3043",whe:"\u3046\u3047",who:"\u3046\u3049",ye:"\u3044\u3047",ca:"\u304B",ci:"\u3057",cu:"\u304F",ce:"\u305B",co:"\u3053",xa:"\u3041",xi:"\u3043",xu:"\u3045",xe:"\u3047",xo:"\u3049",la:"\u3041",li:"\u3043",lu:"\u3045",le:"\u3047",lo:"\u3049",xya:"\u3083",xyu:"\u3085",xyo:"\u3087",lya:"\u3083",lyu:"\u3085",lyo:"\u3087",xtu:"\u3063",xtsu:"\u3063",ltu:"\u3063",ltsu:"\u3063",xwa:"\u308E",lwa:"\u308E"},uk=Object.keys(iy).sort((e,t)=>t.length-e.length),ay=e=>{let t=e.normalize("NFKC").toLowerCase().replace(/\s+/g,""),r="";for(let n=0;n<t.length;){let o=t.slice(n);if(o.startsWith("n'")){r+="\u3093",n+=2;continue}if(o.startsWith("nn")){r+="\u3093",n+=n+2<t.length&&/[aiueoy]/.test(t[n+2])?1:2;continue}let s=t[n],i=t[n+1];if(s==="n"&&(!i||!/[aiueoyn]/.test(i))){r+="\u3093",n+=1;continue}if(s==="t"&&o.startsWith("tch")||s===i&&/[bcdfghjklmpqrstvwxyz]/.test(s)){r+="\u3063",n+=1;continue}if(s==="-"){r+="\u30FC",n+=1;continue}let a=uk.find(d=>o.startsWith(d));a?(r+=iy[a],n+=a.length):(r+=s,n+=1)}return r},lk=e=>e.replace(/[ぁ-ゖ]/g,t=>String.fromCharCode(t.charCodeAt(0)+96)),ud=`
  CASE
    WHEN p.known_forever = 1 OR ${ge} THEN 'mastered'
    WHEN p.seen_count = 0 THEN 'unseen'
    WHEN p.fsrs_stability IS NULL THEN 'd0'
    WHEN p.fsrs_stability < 1 THEN 'd0'
    WHEN p.fsrs_stability < 3 THEN 'd1'
    WHEN p.fsrs_stability < 7 THEN 'd2'
    WHEN p.fsrs_stability < 21 THEN 'd3'
    WHEN p.fsrs_stability < 90 THEN 'd4'
    ELSE 'd5'
  END
`,ld=()=>`
  (p.known_forever = 0 AND p.seen_count > 0 AND (p.fsrs_due IS NULL OR p.fsrs_due <= ?) AND ${te("words","p.word_id")})
`,ck="CASE w.jlpt_level WHEN 'N5' THEN 1 WHEN 'N4' THEN 2 WHEN 'N3' THEN 3 WHEN 'N2' THEN 4 WHEN 'N1' THEN 5 ELSE 9 END",dy=e=>{let t=[],r=[];if(e.level==="unranked"?t.push("(w.jlpt_level IS NULL OR w.jlpt_level NOT IN ('N5','N4','N3','N2','N1'))"):e.level!=="all"&&(t.push("w.jlpt_level = ?"),r.push(e.level)),e.pos!=="all"){let o=ak().get(e.pos)??[];o.length===0?t.push("1 = 0"):(t.push(`w.pos IN (${o.map(()=>"?").join(",")})`),o.forEach(s=>r.push(s)))}let n=e.search.trim();if(n){let o=`%${n}%`,s=/^[A-Za-z'\s-]+$/.test(n)?ay(n):"";s&&!/[a-z]/i.test(s)?(t.push("(w.kanji LIKE ? OR w.kana LIKE ? OR w.meaning LIKE ? OR w.kana LIKE ? OR w.kana LIKE ?)"),r.push(o,o,o,`%${s}%`,`%${lk(s)}%`)):(t.push("(w.kanji LIKE ? OR w.kana LIKE ? OR w.meaning LIKE ?)"),r.push(o,o,o))}return{sql:t.length?`WHERE ${t.join(" AND ")}`:"",params:r}},uy=(e,t)=>{let r=dy(e);if(e.band==="all")return r;let n="",o=[];return e.band==="due"?(n=ld(),o.push(t)):e.band==="leech"?n=na.replace(/fsrs_lapses/g,"p.fsrs_lapses"):(n=`${ud} = ?`,o.push(e.band)),{sql:r.sql?`${r.sql} AND ${n}`:`WHERE ${n}`,params:[...r.params,...o]}},ly={level:`${ck} ASC, w.importance DESC, w.id ASC`,weakest:`CASE WHEN p.seen_count = 0 AND p.known_forever = 0 THEN 1 ELSE 0 END ASC,
            COALESCE(p.fsrs_stability, 999999) ASC, w.importance DESC, w.id ASC`,recent:"CASE WHEN p.fsrs_last_review IS NULL THEN 1 ELSE 0 END ASC, p.fsrs_last_review DESC, w.id ASC",kana:"w.kana ASC, w.id ASC"},cy=e=>{let t=String(e.pos??"");return{id:Number(e.id??0),kanji:String(e.kanji??""),kana:String(e.kana??""),meaning:String(e.meaning??""),pos:t,posBucket:Ps(t),level:String(e.jlpt_level??"")||"\u672A\u5206\u7EA7",band:String(e.band??"unseen"),stability:e.fsrs_stability===null||e.fsrs_stability===void 0?null:Number(e.fsrs_stability),dueAt:e.fsrs_due?String(e.fsrs_due):null,lastReview:e.fsrs_last_review?String(e.fsrs_last_review):null,lapses:Number(e.fsrs_lapses??0),reps:Number(e.fsrs_reps??0),isDue:Number(e.is_due??0)===1,isLeech:Number(e.fsrs_lapses??0)>=8,isKnownForever:Number(e.known_forever??0)===1}},cd=()=>{X(),j()};function mk(e,t,r){cd();let n=A().toISOString(),o=uy(e,n);return p(`
    SELECT
      w.id, w.kanji, w.kana, w.meaning, w.pos, w.jlpt_level,
      p.known_forever,
      p.fsrs_stability, p.fsrs_due, p.fsrs_last_review, p.fsrs_lapses, p.fsrs_reps,
      ${ud} AS band,
      CASE WHEN ${ld()} THEN 1 ELSE 0 END AS is_due
    FROM words w
    JOIN progress p ON p.word_id = w.id
    ${o.sql}
    ORDER BY ${ly[e.sort]}
    LIMIT ? OFFSET ?
  `,[n,...o.params,r,t]).map(cy)}var pk=()=>$s.reduce((e,t)=>({...e,[t.id]:0}),{});function Ek(e){cd();let t=A().toISOString(),r=dy(e),n=pk(),o=0,s=0,i=0;return p(`
    SELECT
      ${ud} AS band,
      COUNT(*) AS n,
      SUM(CASE WHEN ${ld()} THEN 1 ELSE 0 END) AS due_n,
      SUM(CASE WHEN ${na.replace(/fsrs_lapses/g,"p.fsrs_lapses")} THEN 1 ELSE 0 END) AS leech_n
    FROM words w
    JOIN progress p ON p.word_id = w.id
    ${r.sql}
    GROUP BY band
  `,[t,...r.params]).forEach(a=>{let d=String(a.band??"unseen"),u=Number(a.n??0);d in n&&(n[d]=u),o+=u,s+=Number(a.due_n??0),i+=Number(a.leech_n??0)}),{total:o,bands:n,due:s,leech:i}}function fk(e){cd();let t=A().toISOString(),r=p(`
    SELECT
      w.id, w.kanji, w.kana, w.meaning, w.pos, w.jlpt_level, w.example_jp, w.example_meaning,
      p.known_forever,
      p.fsrs_stability, p.fsrs_due, p.fsrs_last_review, p.fsrs_lapses, p.fsrs_reps,
      ${ud} AS band,
      CASE WHEN ${ld()} THEN 1 ELSE 0 END AS is_due,
      COALESCE(n.note, '') AS note,
      CASE WHEN f.item_id IS NULL THEN 0 ELSE 1 END AS favorite
    FROM words w
    JOIN progress p ON p.word_id = w.id
    LEFT JOIN word_notes n ON n.word_id = w.id
    LEFT JOIN content_favorites f ON f.item_type = 'word' AND f.item_id = CAST(w.id AS TEXT)
    WHERE w.id = ?
    LIMIT 1
  `,[t,e])[0];return r?{...cy(r),example:{jp:String(r.example_jp??""),meaning:String(r.example_meaning??"")},note:String(r.note??""),isFavorite:Number(r.favorite??0)===1}:null}function gk(e,t=500){cd();let r=A().toISOString(),n=uy(e,r);return p(`
    SELECT w.id
    FROM words w
    JOIN progress p ON p.word_id = w.id
    ${n.sql}
    ORDER BY ${ly[e.sort]}
    LIMIT ?
  `,[...n.params,t]).map(o=>Number(o.id??0))}sr();var dE={};M(dE,{buildQuestions:()=>cv,playableGroupKeys:()=>lv,quizGroups:()=>uv,settleGroup:()=>mv});sr();var Bs=N(_s(),1),ky=N(Ar(),1);ln();La();var iE=N(Yi(),1);P();var sE={};M(sE,{CONFIDENCE_BONUS:()=>rE,GUESS_FLOOR_CAP:()=>Jp,PENALTY:()=>pd,VOCAB_TEST_LEVELS:()=>Ae,VOCAB_TEST_PROBE_PER_LEVEL:()=>Zp,VOCAB_TEST_QUESTION_COUNT:()=>fd,VOCAB_TEST_SECONDS:()=>Qp,buildVocabTestQuestions:()=>nE,calibrateLevelsV3:()=>Oy,clearVocabTestSession:()=>ev,extendVocabTestPlan:()=>by,finishVocabTest:()=>Zk,getVocabTestHistory:()=>ov,getVocabTestResult:()=>Ay,getVocabTestSession:()=>oE,guessRate:()=>eE,kanjiCoreReading:()=>yy,recordVocabTestRun:()=>rv,secondsForQuestion:()=>Sy,shuffle:()=>zt,startVocabTest:()=>Jk,submitVocabTestAnswer:()=>Qk,vocabTestStorageValue:()=>sv});var wy=N(_a(),1);G();var Ty=N($(),1);sr();kr();var tE=N(Yi(),1);Jr();var qp={};M(qp,{answerHotkeyLabels:()=>wk,answerOptions:()=>_k,answerReadingText:()=>Rk,cardLabel:()=>Nk,concealedReadingParts:()=>bk,formatDuration:()=>hk,isLoanwordSourceCard:()=>yk,kanaToRomaji:()=>Ok,levelOptions:()=>Tk,monthDays:()=>kk,moraCount:()=>co,primaryAnswerText:()=>Vp,secondaryAnswerText:()=>py,typeOptions:()=>Sk});Jr();var _k=[{value:"forgot",label:"\u5FD8\u8BB0"},{value:"fuzzy",label:"\u6A21\u7CCA",secondary:!0},{value:"know",label:"\u8BA4\u8BC6"},{value:"known_forever",label:"\u719F\u77E5",secondary:!0}],wk={forgot:"V",fuzzy:"B",know:"N",known_forever:"M"},Tk=[{value:"All",label:"\u5168\u90E8"},{value:"N5",label:"N5"},{value:"N4",label:"N4"},{value:"N3",label:"N3"},{value:"N2",label:"N2"},{value:"N1",label:"N1"},{value:"Unleveled",label:"\u672A\u5206\u7EA7"}],Sk=[{value:"all",label:"\u5168\u90E8\u7C7B\u578B"},{value:"noun",label:"\u540D\u8BCD"},{value:"verb",label:"\u52A8\u8BCD"},{value:"adjective",label:"\u5F62\u5BB9\u8BCD"},{value:"adverb",label:"\u526F\u8BCD"},{value:"favorite",label:"\u6536\u85CF"}],yk=e=>Lr(e),Vp=e=>Or(e),py=e=>{if(Lr(e))return e.kanji;let t=qr(e);return t?.band==="kana"||t?.band==="low"?jo(e.kanji):e.kana},Nk=e=>{let t=Vp(e),r=py(e);return t===r?t:`${t} / ${r}`},Rk=(e,t=Vp(e))=>!t||!/[\u3400-\u9fff]/u.test(t)?"":e.kana,bk=e=>e?.length?e.map(t=>t.isKanji?{text:"",hidden:!0}:{text:t.text,hidden:!1}):[{text:"",hidden:!0}],my={\u3042:"a",\u3044:"i",\u3046:"u",\u3048:"e",\u304A:"o",\u304B:"ka",\u304D:"ki",\u304F:"ku",\u3051:"ke",\u3053:"ko",\u3055:"sa",\u3057:"shi",\u3059:"su",\u305B:"se",\u305D:"so",\u305F:"ta",\u3061:"chi",\u3064:"tsu",\u3066:"te",\u3068:"to",\u306A:"na",\u306B:"ni",\u306C:"nu",\u306D:"ne",\u306E:"no",\u306F:"ha",\u3072:"hi",\u3075:"fu",\u3078:"he",\u307B:"ho",\u307E:"ma",\u307F:"mi",\u3080:"mu",\u3081:"me",\u3082:"mo",\u3084:"ya",\u3086:"yu",\u3088:"yo",\u3089:"ra",\u308A:"ri",\u308B:"ru",\u308C:"re",\u308D:"ro",\u308F:"wa",\u3092:"wo",\u3093:"n",\u304C:"ga",\u304E:"gi",\u3050:"gu",\u3052:"ge",\u3054:"go",\u3056:"za",\u3058:"ji",\u305A:"zu",\u305C:"ze",\u305E:"zo",\u3060:"da",\u3062:"ji",\u3065:"zu",\u3067:"de",\u3069:"do",\u3070:"ba",\u3073:"bi",\u3076:"bu",\u3079:"be",\u307C:"bo",\u3071:"pa",\u3074:"pi",\u3077:"pu",\u307A:"pe",\u307D:"po",\u3041:"a",\u3043:"i",\u3045:"u",\u3047:"e",\u3049:"o",\u3083:"ya",\u3085:"yu",\u3087:"yo",\u30A1:"a",\u30A3:"i",\u30A5:"u",\u30A7:"e",\u30A9:"o",\u30E3:"ya",\u30E5:"yu",\u30E7:"yo",\u30A2:"a",\u30A4:"i",\u30A6:"u",\u30A8:"e",\u30AA:"o",\u30AB:"ka",\u30AD:"ki",\u30AF:"ku",\u30B1:"ke",\u30B3:"ko",\u30B5:"sa",\u30B7:"shi",\u30B9:"su",\u30BB:"se",\u30BD:"so",\u30BF:"ta",\u30C1:"chi",\u30C4:"tsu",\u30C6:"te",\u30C8:"to",\u30CA:"na",\u30CB:"ni",\u30CC:"nu",\u30CD:"ne",\u30CE:"no",\u30CF:"ha",\u30D2:"hi",\u30D5:"fu",\u30D8:"he",\u30DB:"ho",\u30DE:"ma",\u30DF:"mi",\u30E0:"mu",\u30E1:"me",\u30E2:"mo",\u30E4:"ya",\u30E6:"yu",\u30E8:"yo",\u30E9:"ra",\u30EA:"ri",\u30EB:"ru",\u30EC:"re",\u30ED:"ro",\u30EF:"wa",\u30F2:"wo",\u30F3:"n",\u30AC:"ga",\u30AE:"gi",\u30B0:"gu",\u30B2:"ge",\u30B4:"go",\u30B6:"za",\u30B8:"ji",\u30BA:"zu",\u30BC:"ze",\u30BE:"zo",\u30C0:"da",\u30C2:"ji",\u30C5:"zu",\u30C7:"de",\u30C9:"do",\u30D0:"ba",\u30D3:"bi",\u30D6:"bu",\u30D9:"be",\u30DC:"bo",\u30D1:"pa",\u30D4:"pi",\u30D7:"pu",\u30DA:"pe",\u30DD:"po"},Lk={kya:"kya",kiya:"kya",kyu:"kyu",kiyu:"kyu",kyo:"kyo",kiyo:"kyo",sha:"sha",shiya:"sha",shu:"shu",shiyu:"shu",sho:"sho",shiyo:"sho",cha:"cha",chiya:"cha",chu:"chu",chiyu:"chu",cho:"cho",chiyo:"cho",nya:"nya",niya:"nya",nyu:"nyu",niyu:"nyu",nyo:"nyo",niyo:"nyo",hya:"hya",hiya:"hya",hyu:"hyu",hiyu:"hyu",hyo:"hyo",hiyo:"hyo",mya:"mya",miya:"mya",myu:"myu",miyu:"myu",myo:"myo",miyo:"myo",rya:"rya",riya:"rya",ryu:"ryu",riyu:"ryu",ryo:"ryo",riyo:"ryo",gya:"gya",giya:"gya",gyu:"gyu",giyu:"gyu",gyo:"gyo",giyo:"gyo",ja:"ja",jiya:"ja",ju:"ju",jiyu:"ju",jo:"jo",jiyo:"jo",bya:"bya",biya:"bya",byu:"byu",biyu:"byu",byo:"byo",biyo:"byo",pya:"pya",piya:"pya",pyu:"pyu",piyu:"pyu",pyo:"pyo",piyo:"pyo"},Ok=e=>{let t=[],r=!1;for(let n=0;n<e.length;n+=1){let o=e[n];if(o==="\u3063"||o==="\u30C3"){r=!0;continue}if(o==="\u30FC"){t[t.length-1]=`${t[t.length-1]??""}-`;continue}let s=my[o],i=my[e[n+1]],a=s??o;i&&["\u3083","\u3085","\u3087","\u30E3","\u30E5","\u30E7"].includes(e[n+1])&&(a=Lk[`${a}${i}`]??a,n+=1),r&&/^[bcdfghjklmnpqrstvwxyz]/.test(a)&&(a=`${a[0]}${a}`),r=!1,t.push(a)}return t.join(" ")},Ak=/[ぁぃぅぇぉゃゅょゎァィゥェォャュョヮ]/,co=e=>{let t=0;for(let r of e.replace(/[～〜（）()\s・]/g,""))Ak.test(r)||(t+=1);return t},hk=e=>{let t=Math.max(0,Math.round(e)),r=Math.floor(t/60),n=t%60;if(r>=60){let o=Math.floor(r/60),s=r%60;return`${o}\u5C0F\u65F6${s.toString().padStart(2,"0")}\u5206`}return r>0?`${r}\u5206${n.toString().padStart(2,"0")}\u79D2`:`${n}\u79D2`},kk=e=>{let t=e?new Date(`${e}T00:00:00`):new Date,r=t.getFullYear(),n=t.getMonth(),o=new Date(r,n,1),s=new Date(r,n+1,0).getDate(),i=Array.from({length:o.getDay()},()=>null),a=Array.from({length:s},(d,u)=>{let l=u+1;return{day:l,date:`${r}-${String(n+1).padStart(2,"0")}-${String(l).padStart(2,"0")}`}});return{title:`${r}\u5E74${n+1}\u6708`,cells:[...i,...a]}};He();var Ed="vocab_test_session_v1",Ae=["N5","N4","N3","N2","N1"],fd=80,pd=1.15,Jp=.3,rE=1.1,Qp={reading:15,meaning:10},Sy=e=>Qp[e.kind]??Qp.reading,Yt=3,$r=e=>String(e??"").trim(),kt=(e,t,r)=>Math.min(r,Math.max(t,e)),zt=(e,t=Math.random)=>{let r=[...e];for(let n=r.length-1;n>0;n-=1){let o=Math.floor(kt(t(),0,.999999999)*(n+1));[r[n],r[o]]=[r[o],r[n]]}return r},gd="[\\u3040-\\u309F\\u30A0-\\u30FF\\u30FC]+",vk=new RegExp(`^${gd}`),Ck=new RegExp(`${gd}$`),yy=(e,t)=>{let r=e.trim(),n=t.trim();if(!r||!n)return null;let o=r.match(vk)?.[0]??"";if(o){if(!n.startsWith(o))return null;r=r.slice(o.length),n=n.slice(o.length)}let s=r.match(Ck)?.[0]??"";if(s){if(!n.endsWith(s))return null;r=r.slice(0,-s.length),n=n.slice(0,-s.length)}return!r||!n||new RegExp(gd).test(r)||r===e.trim()?null:{core:r,reading:n}},Dk=e=>{let t=$o(e),r=yy(t,e.kana),n=(r?.reading??e.kana).trim();return{...e,posBucket:Ps(e.pos??""),morae:co(n),loan:Lr({kanji:e.kanji,kana:e.kana}),readingSurface:t,core:r,readingValue:n}},Ny=()=>p(`
  SELECT w.id, w.kanji, w.kana, w.meaning, w.pos, w.jlpt_level AS level
  FROM words w LEFT JOIN progress p ON p.word_id = w.id
  WHERE w.jlpt_level IN ('N5', 'N4', 'N3', 'N2', 'N1') AND ${oe()}
    AND TRIM(COALESCE(meaning, '')) <> ''
    AND TRIM(COALESCE(kana, '')) <> ''
`).map(e=>({id:Number(e.id??0),kanji:$r(e.kanji),kana:$r(e.kana),meaning:(0,tE.reviewedQuestionMeaning)($r(e.kanji),$r(e.kana))??$r(e.meaning),pos:$r(e.pos),level:$r(e.level)})).filter(e=>e.id>0&&Ae.includes(e.level)),Ik=new RegExp(gd),Mk=2,xk=e=>{if(!Po(e))return!1;if(e.core){let t=co(e.core.reading);return t>=Mk&&t*2>=co(e.kana)}return!Ik.test(e.readingSurface)},md=(e,t)=>t==="reading"?$o(e):Or(e),Uk=e=>{let t=new Map,r=new Map,n=(o,s,i)=>{if(!s||!i)return;let a=o.get(s)??new Set;a.add(i),o.set(s,a)};return e.forEach(o=>{[Or(o),o.readingSurface].forEach(s=>{n(t,s,o.kana.trim()),n(t,s,o.readingValue),n(r,s,o.meaning.trim())})}),{readings:t,meanings:r}},Fk=e=>{let t=wy.default.readings,r=new Map;for(let n of e)for(let o of Gs(n.core?.core??n.readingSurface)){if(r.has(o))continue;let s=t[o];r.set(o,new Set([...s?.on??[],...(s?.kun??[]).map(i=>i.split(".")[0])].filter(Boolean)))}return r},Wk=new Map(`
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
`.trim().split(/\s+/).map(e=>[e[0],e[1]])),Ey=e=>[...e].map(t=>Wk.get(t)??t).join(""),Gs=e=>[...e].filter(t=>/\p{Script=Han}/u.test(t)),jk=(e,t)=>{let r=Ey(t);return Gs(Ey(e)).filter(n=>r.includes(n)).length},Hs=(e,t,r)=>Gs(e).filter(n=>[...r.get(n)??[]].some(o=>t.includes(o))).length,$k=(e,t)=>{let r=e.readingValue,n=new Set;for(let s of Gs(e.core?.core??e.readingSurface)){let i=[...t.get(s)??[]];for(let a of i)if(r.includes(a))for(let d of i)n.add(r.replace(a,d))}let o=["\u3042\u3044\u3046\u3048\u304A","\u304B\u304D\u304F\u3051\u3053","\u304C\u304E\u3050\u3052\u3054","\u3055\u3057\u3059\u305B\u305D","\u3056\u3058\u305A\u305C\u305E","\u305F\u3061\u3064\u3066\u3068","\u3060\u3062\u3065\u3067\u3069","\u306A\u306B\u306C\u306D\u306E","\u306F\u3072\u3075\u3078\u307B","\u3070\u3073\u3076\u3079\u307C","\u3071\u3074\u3077\u307A\u307D","\u307E\u307F\u3080\u3081\u3082","\u3089\u308A\u308B\u308C\u308D"];return[...r].forEach((s,i)=>{let a=o.find(d=>d.includes(s));for(let d of a??"")n.add(r.slice(0,i)+d+r.slice(i+1))}),[...n]},Pk=e=>{try{let t=new Set;return hr(e).forEach(r=>{r.members.forEach(n=>{n.id!==e&&t.add(n.id)})}),t}catch{return new Set}},fy=e=>{try{return en(e)}catch{return}},mo=(e,t)=>(t==="reading"?e.readingValue:e.meaning).trim(),Ry=(e,t)=>e.includes(t)||t.includes(e),Hk=/[ゃゅょぁぃぅぇぉャュョァィゥェォ]/,Kk=e=>{let t=[];for(let r of e.replace(/[～〜（）()\s・]/g,""))Hk.test(r)&&t.length?t[t.length-1]+=r:t.push(r);return t},Gk=(e,t)=>!!(e&&t)&&[...e].some(r=>/[\u4E00-\u9FFF]/.test(r)&&t.includes(r)),Bk=(e,t,r,n,o)=>{let s=mo(e,r),i=r==="meaning"?fy(e.id):void 0,a=md(e,r),d=(r==="reading"?n.readings:n.meanings).get(a)??new Set,u=Gs(e.core?.core??a).map(w=>[...o.get(w)??[]]),l=w=>u.filter(y=>y.some(_=>w.includes(_))).length,c=r==="reading"?l(s):0,f=t.filter(w=>{if(w.id===e.id)return!1;let y=mo(w,r);if(!y||y===s||d.has(y))return!1;if(r==="reading"){let _=l(y);if(Ry(s,y)||_<c||_>c+1)return!1}return!(i&&fy(w.id)===i)}),m=w=>r!=="reading"||Math.abs(w.morae-e.morae)<=1,g=w=>w.posBucket===e.posBucket,S=w=>w.loan===e.loan;return[f.filter(w=>w.level===e.level&&g(w)&&S(w)&&m(w)),f.filter(w=>g(w)&&S(w)&&m(w)),f.filter(w=>S(w)&&m(w)),f.filter(S),f]},Xk=(e,t,r)=>{let n=Kk(t),o=Math.max(1,Math.ceil(n.length/2)),s=f=>n.slice(0,f).join(""),i=f=>n.slice(-f).join(""),a=f=>m=>m.readingValue!==t&&m.readingValue.startsWith(s(f)),d=f=>m=>m.readingValue!==t&&m.readingValue.endsWith(i(f)),u=f=>r.some(f),l=u(a(o))?a(o):a(1),c=u(d(o))?d(o):d(1);return[l,c,f=>Gk(e.kanji,f.kanji)||l(f)||c(f)]},Yk=(e,t,r,n,o)=>{let s=xk(e)?"reading":"meaning",i=mo(e,s);if(!i)return null;let a=Pk(e.id),d=[],u=new Set([i]),l=Bk(e,t,s,n,o);if(((s==="reading"?n.readings:n.meanings).get(md(e,s))??new Set).forEach(_=>u.add(_)),s==="reading"){let _=e.core?.core??e.readingSurface,b=Hs(_,i,o),k=$k(e,o).filter(F=>!u.has(F)&&!Ry(i,F)&&Math.abs(co(F)-e.morae)<=1&&Hs(_,F,o)>=b&&Hs(_,F,o)<=b+1),C=[...l[2],...k.map(F=>({...e,id:-1,readingValue:F}))],L=new Map,I=F=>(L.has(F)||L.set(F,Hs(_,F,o)),L.get(F)),x=C.filter(F=>I(F.readingValue)===b),U=new Set(x.map(F=>F.readingValue)).size>=Yt?x:C;Xk(e,i,U).forEach(F=>{let K=zt(U.filter(F),r).sort((Q,Z)=>I(Q.readingValue)-I(Z.readingValue)||+(Z.posBucket===e.posBucket)-+(Q.posBucket===e.posBucket)).find(Q=>!u.has(Q.readingValue));K&&(u.add(K.readingValue),d.push(K.readingValue))});for(let F of zt(U,r).sort((K,Q)=>I(K.readingValue)-I(Q.readingValue))){if(d.length>=Yt)break;let K=F.readingValue;u.has(K)||(u.add(K),d.push(K))}}let f=s==="reading"?e.core?.core??e.readingSurface:md(e,s),m=new Map,g=_=>(m.has(_)||m.set(_,s==="reading"?Hs(f,_,o):jk(f,_)),m.get(_)),S=g(i);if(s==="meaning"&&new Set(l[4].filter(_=>g(_.meaning)===S).map(_=>_.meaning)).size<Yt)return null;let w=[...new Set(l[4].map(_=>Math.abs(g(mo(_,s))-S)))].sort((_,b)=>_-b);for(let _ of w){for(let b of l){if(d.length>=Yt)break;let k=zt(b.filter(C=>Math.abs(g(mo(C,s))-S)===_),r).sort((C,L)=>Number(a.has(L.id))-Number(a.has(C.id)));for(let C of k){if(d.length>=Yt)break;let L=mo(C,s);u.has(L)||(u.add(L),d.push(L))}}if(d.length>=Yt)break}if(d.length<Yt)return null;let y=zt([i,...d],r);return{id:e.id,level:e.level,kind:s,prompt:md(e,s),readingScope:s==="reading"?e.core?.core:void 0,options:y,answerIndex:y.indexOf(i),answer:i}},gy={N5:261,N4:334,N3:934,N2:1539,N1:1435},_y=9,zk=(e=fd)=>{let t={};Ae.forEach(s=>{t[s]=_y});let r=e-_y*Ae.length;if(r<=0)return t;let n=Ae.reduce((s,i)=>s+gy[i],0),o=Ae.map(s=>{let i=r*gy[s]/n;return{level:s,whole:Math.floor(i),fraction:i-Math.floor(i)}});o.forEach(s=>{t[s.level]+=s.whole,r-=s.whole}),o.sort((s,i)=>i.fraction-s.fraction);for(let s=0;r>0;s=(s+1)%o.length,r-=1)t[o[s].level]+=1;return t},Zp=4,Vk=(e,t,r)=>{let n={};if(Ae.forEach(d=>{n[d]=0}),r<=0)return n;let o=Ae.map(d=>{let u=kt(e[d]??.5,.15,.85);return{level:d,weight:(t[d]??0)*Math.sqrt(u*(1-u))}}),s=o.reduce((d,u)=>d+u.weight,0);if(s<=0)return Ae.forEach((d,u)=>{n[d]=Math.floor(r/Ae.length)+(u<r%Ae.length?1:0)}),n;let i=r,a=o.map(d=>{let u=r*d.weight/s;return{level:d.level,whole:Math.floor(u),fraction:u-Math.floor(u)}});a.forEach(d=>{n[d.level]+=d.whole,i-=d.whole}),a.sort((d,u)=>u.fraction-d.fraction);for(let d=0;i>0;d=(d+1)%a.length,i-=1)n[a[d].level]+=1;return n},nE=(e,t=Math.random,r={})=>{let n=e.map(f=>({...f,meaning:(0,tE.reviewedQuestionMeaning)(f.kanji,f.kana)??f.meaning})).map(Dk),o=Uk(n),s=Fk(n),i=Object.fromEntries(Ae.map(f=>[f,n.filter(m=>m.level===f).length])),a=r.targets??zk(),d=r.total??fd,u=[],l=new Set(r.excludeIds??[]),c=(f,m)=>{for(let g of zt(f,t)){if(u.length>=d||u.filter(w=>w.level===g.level).length>=m)break;if(l.has(g.id))continue;let S=Yk(g,n,t,o,s);S&&(l.add(g.id),u.push(S))}};return Ae.forEach(f=>c(n.filter(m=>m.level===f),a[f]??0)),u.length<d&&c(n,d),{questions:zt(u,t),populationByLevel:i}},qk=e=>{if(!e)return null;try{let t=JSON.parse(e);if(t.version!==1||!Array.isArray(t.questions)||!Array.isArray(t.responses))return null;let r=t.questions.filter(n=>!!(n&&Number.isFinite(Number(n.id))&&typeof n.prompt=="string"&&Array.isArray(n.options)&&n.options.length===Yt+1&&Number.isInteger(Number(n.answerIndex))));return r.length?{version:1,scoreVersion:t.scoreVersion===3?3:t.scoreVersion===2?2:1,runId:$r(t.runId)||`vocab-${Date.now()}`,startedAt:Number(t.startedAt)||Date.now(),finishedAt:t.finishedAt==null?null:Number(t.finishedAt),currentIndex:kt(Math.floor(Number(t.currentIndex)||0),0,r.length),questions:r,responses:t.responses.filter(Boolean).map(n=>({questionIndex:Number(n.questionIndex),questionId:Number(n.questionId),answerState:n.answerState,selectedOption:n.selectedOption==null?null:Number(n.selectedOption),responseMs:n.responseMs==null?null:Number(n.responseMs),answeredAt:Number(n.answeredAt)||Date.now()})),populationByLevel:Object.fromEntries(Object.entries(t.populationByLevel??{}).map(([n,o])=>[n,Number(o)||0])),plannedTotal:Math.max(Number(t.plannedTotal)||0,r.length)}:null}catch{return null}},Ks=e=>(R(Ed,JSON.stringify(e)),D(),e),oE=()=>(V(),qk(O(Ed,""))),Jk=(e=Math.random)=>{V();let t=Ny(),r=Object.fromEntries(Ae.map(i=>[i,Zp])),n=Zp*Ae.length,{questions:o,populationByLevel:s}=nE(t,e,{targets:r,total:n});if(o.length<10)throw new Error("\u5F53\u524D\u8BCD\u5E93\u53EF\u7528\u4E8E\u6D4B\u9A8C\u7684\u8BCD\u592A\u5C11\uFF0C\u65E0\u6CD5\u5F00\u59CB\u6D4B\u91CF\u3002");return Ks({version:1,scoreVersion:3,runId:`vocab-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,startedAt:Date.now(),finishedAt:null,currentIndex:0,questions:o,responses:[],populationByLevel:s,plannedTotal:fd})},by=(e,t=Math.random)=>{let r=e.plannedTotal-e.questions.length;if(r<=0)return e;let n=Object.fromEntries(Ae.map(a=>{let d=Ly(a,e);return[a,d.rate]})),o=Vk(n,e.populationByLevel,r),{questions:s}=nE(Ny(),t,{targets:o,total:r,excludeIds:e.questions.map(a=>a.id)});if(!s.length)return e;let i=[...e.questions,...s];return Ks({...e,questions:i,plannedTotal:Math.min(e.plannedTotal,i.length)})},Qk=(e,t,r)=>{let n=oE();if(!n||n.finishedAt||n.currentIndex>=n.questions.length)return n;let o=n.questions[n.currentIndex],s={questionIndex:n.currentIndex,questionId:o.id,answerState:e,selectedOption:t,responseMs:r,answeredAt:Date.now()},i=n.currentIndex+1,a=Ks({...n,currentIndex:i,responses:[...n.responses,s],finishedAt:i>=n.questions.length&&i>=n.plannedTotal?Date.now():null});if(i>=a.questions.length&&a.questions.length<a.plannedTotal){let d=by(a);return d.questions.length>a.questions.length?d:Ks({...a,plannedTotal:a.questions.length,finishedAt:a.finishedAt??Date.now()})}return a},Zk=()=>{let e=oE();return!e||e.finishedAt?e:Ks({...e,finishedAt:Date.now()})},ev=()=>{V(),R(Ed,""),D()},eE=(e,t)=>{let r=4*e+3*t;return r>0?4*e/r:0},Ly=(e,t)=>{let r=t.responses.filter(l=>t.questions[l.questionIndex]?.level===e),n=r.filter(l=>l.answerState==="correct").length,o=r.filter(l=>l.answerState==="wrong").length,s=r.filter(l=>l.answerState==="unknown").length,i=r.filter(l=>l.answerState==="timeout").length,a=t.scoreVersion>=2?pd:1/Yt,d=r.length?(n-o*a)/r.length:null,u=d==null?null:kt(d,0,1);return{level:e,total:t.populationByLevel[e]??0,answered:r.length,correct:n,wrong:o,unknown:s,timeout:i,rate:u==null?null:Math.round(u*100)/100}},Oy=e=>{let t=e.filter(n=>n.answered>=5&&n.rate!=null).map(n=>n.rate),r=t.length?kt(Math.min(Jp,...t),0,Jp):0;return{floor:r,levels:e.map(n=>({...n,rate:n.rate==null?null:Math.round(kt((n.rate-r)/(1-r)*rE,0,1)*100)/100}))}},Ay=e=>{if(!e)return null;let t=Ae.map(k=>Ly(k,e)),r=e.scoreVersion===3?Oy(t):null,n=r?.levels??t,o=r?(rE/(1-r.floor))**2:1,s=n.reduce((k,C)=>k+C.total,0),i=n.reduce((k,C)=>k+C.total*(C.rate??0),0),a=0;n.forEach(k=>{let{total:C,answered:L,rate:I,correct:x,wrong:U,unknown:F,timeout:K}=k;if(!L||I==null){a+=o*C*C;return}if(e.scoreVersion===1){let v=eE(U,F+K);a+=C*C*(I*(1-I)+(1-I)*v/Yt)/L;return}let Q=x-U*pd,Z=x+U*pd**2;a+=o*C*C*(L<2?1:Math.max(0,Z-Q**2/L)/(L*(L-1)))});let d=e.responses.length?Math.ceil(1.96*Math.sqrt(Math.max(0,a))):s,u=Math.round(i),l=n.find(k=>k.rate!=null&&k.answered>=5&&k.rate<.6)?.level??"N1+",c=e.responses.length,f=c/Math.max(1,e.plannedTotal),m=n.reduce((k,C)=>({wrong:k.wrong+C.wrong,unanswered:k.unanswered+C.unknown+C.timeout,timeout:k.timeout+C.timeout}),{wrong:0,unanswered:0,timeout:0}),g=eE(m.wrong,m.unanswered),S=c?m.timeout/c:0,w=n.map(k=>k.rate).filter(k=>k!=null),y=w.reduce((k,C,L)=>L>0&&C>w[L-1]+.15?k+1:k,0),_=c?kt(4*m.wrong/(3*c),0,1):0,b=Math.round(kt((f*60+(1-S)*40)*(1-_)-y*8,0,100));return{scoreVersion:e.scoreVersion,estimated:u,lower:kt(u-d,0,s),upper:kt(u+d,0,s),population:s,answered:c,totalQuestions:e.plannedTotal,confidence:b,gamma:Math.round(g*100)/100,guessedShare:Math.round(_*100)/100,timeoutShare:Math.round(S*100)/100,recommendation:l,levels:n}},tv=e=>{let t=e.responses.reduce((r,n)=>{let o=e.questions[n.questionIndex],s=Sy(o??{kind:"reading"})*1e3;return r+kt(Number(n.responseMs??0),0,s)},0);return Math.max(0,Math.round(t/1e3))},rv=e=>{if(!e||e.responses.length===0)return;let t=Ay(e);if(!t)return;V();let r=e.finishedAt??Date.now();(0,Ty.getDatabase)().run(`
    INSERT OR IGNORE INTO vocab_test_history (
      run_id, started_at, finished_at, duration_seconds,
      answered, total_questions, estimated, lower_bound, upper_bound, confidence, recommendation, levels_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,[e.runId,new Date(e.startedAt).toISOString(),new Date(r).toISOString(),tv(e),t.answered,t.totalQuestions,t.estimated,t.lower,t.upper,t.confidence,t.recommendation,e.scoreVersion>=2?JSON.stringify({version:e.scoreVersion,levels:t.levels.map(n=>[n.level,n.rate,n.answered])}):JSON.stringify(t.levels.map(n=>[n.level,n.rate,n.answered]))]),D()},nv=e=>{try{let t=JSON.parse(e||"[]"),r=t?.version===3?3:t?.version===2?2:1,n=Array.isArray(t)?t:t?.levels;if(!Array.isArray(n))return{scoreVersion:r,levels:[]};let o=n.map(s=>({level:String(s?.[0]??""),rate:s?.[1]==null?null:Number(s[1]),answered:Number(s?.[2]??0)})).filter(s=>s.level);return{scoreVersion:r,levels:o}}catch{return{scoreVersion:1,levels:[]}}},ov=(e=20)=>(V(),p(`
    SELECT * FROM vocab_test_history ORDER BY finished_at DESC LIMIT ?
  `,[e]).map(t=>({runId:String(t.run_id??""),startedAt:Date.parse(String(t.started_at??""))||0,finishedAt:Date.parse(String(t.finished_at??""))||0,durationSeconds:Math.min(Number(t.duration_seconds??0),Number(t.answered??0)*20),answered:Number(t.answered??0),totalQuestions:Number(t.total_questions??0),estimated:Number(t.estimated??0),lower:Number(t.lower_bound??0),upper:Number(t.upper_bound??0),confidence:Number(t.confidence??0),recommendation:String(t.recommendation??""),...nv(String(t.levels_json??""))}))),sv=()=>E("SELECT value FROM app_state WHERE key = ?",[Ed],"");var iv=e=>e.split(/[；;]/)[0].trim(),aE=e=>{if(!(0,Bs.distinctionReviewFor)(e.key)||!mr(e))return!1;let r=new Set,n=new Set;return e.members.every(o=>{if(n.has(o.id))return!1;n.add(o.id);let s=(0,iE.reviewedQuestionMeaning)(o.kanji,o.kana);if(!s)return!1;let i=iv(s);return r.has(i)?!1:(r.add(i),!0)})},av=e=>{let t=new Map;return e.forEach(r=>hr(r).forEach(n=>t.set(n.key,n))),[...t.values()]},dv=()=>new Set(p("SELECT DISTINCT word_id FROM reviews WHERE reviewed_on = ? AND direction = 'forward'",[T()]).map(e=>Number(e.word_id??0)).filter(Boolean)),hy=()=>{let e=E("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='level_prior_baselines'",[],0)>0;return new Set(p(`SELECT p.word_id FROM progress p WHERE p.known_forever = 1
    OR EXISTS (SELECT 1 FROM reviews r WHERE r.word_id = p.word_id AND r.direction = 'forward')
    OR (p.seen_count > 0${e?` AND NOT EXISTS (
      SELECT 1 FROM level_prior_baselines b WHERE b.entity='words' AND b.entity_key=CAST(p.word_id AS TEXT)
    )`:""})`).map(t=>Number(t.word_id??0)).filter(Boolean))};function uv(e){let t;if(e.kind==="group")t=Qe().filter(r=>r.key===e.key);else if(e.kind==="type")t=Qe().filter(r=>r.type===e.type);else if(t=av(e.kind==="today"?dv():hy()),e.kind==="learned"){let r=hy();t=t.filter(n=>n.members.filter(o=>r.has(o.id)).length>=2)}return t.filter(aE)}var lv=()=>new Set(Qe().filter(aE).map(e=>e.key));function cv(e,t=Math.random){let r=[],n=ky.default;for(let o of zt(e,t)){let s=(0,Bs.distinctionReviewFor)(o.key);if(!aE(o)||!s||r.length+o.members.length>24)continue;let i=(0,Bs.distinctionNotesFor)(s.summary,o.members.map(u=>({key:String(u.id),forms:[be(u),u.kanji,u.kana]}))),a=zt(o.members.map(u=>({id:u.id,surface:be(u),kana:u.kana,exampleJp:u.exampleJp,exampleMeaning:u.exampleMeaning})),t),d=to(o.key,o.members,u=>[be(u),u.kanji,u.kana],u=>ro((n[u.kanji]??n[u.kana])?.[0])).map(({member:u,voice:l,subgroup:c})=>({id:u.id,voice:l,subgroup:c}));for(let u of o.members){let l=(0,iE.reviewedQuestionMeaning)(u.kanji,u.kana);l&&r.push({groupKey:o.key,prompt:l,options:a,answerId:u.id,summary:s.summary,overview:s.summary.split(/[；;]/u)[0].trim(),explained:d,notes:i})}if(r.length===24)return r}return r}var mv=(e,t)=>{nl(e,t)};ln();eo();ks();ms();Ur();ys();var mE={};M(mE,{MIXED_EVERY:()=>_d,answerMixedOther:()=>wv,canUndoMixed:()=>Tv,mixedTurnDue:()=>gv,mixedUndoKind:()=>wd,pickMixedNext:()=>fv,recordMixedWordAnswer:()=>_v,resetMixedSession:()=>pv,undoMixedOther:()=>Sv,undoMixedWord:()=>yv});var lE=N($(),1);ds();ys();ma();var _d=5,uE=["grammar","kanji","confusion"],q={wordsSince:0,rotation:0,rotationBefore:0,undo:[],grammarCanUndo:!1},cE=()=>At,pv=()=>{q.wordsSince=0,q.rotation=0,q.rotationBefore=0,q.undo=[],q.grammarCanUndo=!1},vy=e=>{if(e==="grammar"){let r=qn(cE());return r.card?{kind:e,card:r.card}:null}if(!Ss())return null;if(e==="kanji"){let r=Vc((0,lE.getDatabase)()).card;return r?{kind:e,card:r}:null}let t=Qc((0,lE.getDatabase)()).card;return t?{kind:e,card:t}:null},Ev=()=>{for(let e=0;e<uE.length;e+=1){let t=vy(uE[(q.rotation+e)%uE.length]);if(t)return q.rotationBefore=q.rotation,q.rotation+=e+1,t}return null},fv=({word:e,afterWord:t=!1})=>(t&&(q.wordsSince+=1),e&&q.wordsSince<_d?"word":(e&&(q.wordsSince=0),Ev()??(e?"word":null))),gv=()=>q.wordsSince+1>=_d,_v=()=>{q.undo=[...q.undo,"word"].slice(-la)},wv=(e,t)=>{e.kind==="grammar"?q.grammarCanUndo=Ec(cE(),e.card.id,t).canUndo:e.kind==="kanji"?qc(e.card.char,t):Zc(e.card.groupKey,t),q.undo=[...q.undo,e.kind].slice(-la)},wd=()=>q.undo[q.undo.length-1]??null,Tv=(e,t)=>{let r=wd();return e&&!r?!1:r==="grammar"?q.grammarCanUndo:r==="kanji"||r==="confusion"?!0:t},Sv=()=>{let e=wd();if(!e||e==="word")return null;if(q.undo=q.undo.slice(0,-1),e==="grammar"){let t=fc(cE());return q.grammarCanUndo=t.canUndo,t.card?{kind:e,card:t.card}:null}return e==="kanji"?Jc():em(),vy(e)},yv=({otherShowing:e})=>{wd()==="word"&&(q.undo=q.undo.slice(0,-1)),e&&(q.wordsSince=_d-1,q.rotation=q.rotationBefore)};ds();Nr();var pE={};M(pE,{grammarKanjiHint:()=>xy,grammarKanjiHintFor:()=>Lv,grammarKeyPoint:()=>My,grammarKeyPointFor:()=>bv});var Sd=N(Dy(),1),Nv=Sd.default.points,Iy=Sd.default.aliases,Rv=Sd.default.kanji,My=e=>{let t=Nv[e];return typeof t=="string"?t:""},bv=e=>My(Iy[e.id]??e.title),xy=e=>{let t=Rv[e];if(!Array.isArray(t)||t.length!==3)return null;let[r,n,o]=t;return typeof r!="string"||typeof n!="string"||typeof o!="string"?null:{kana:r,kanji:n,hook:o}},Lv=e=>{let t=Iy[e.id];return xy(typeof t=="string"?t:e.title)};sc();vp();hi();var EE={};M(EE,{duplicateMergePlan:()=>jy,mergeDuplicateWords:()=>Ov});var Fy=N($(),1);sr();P();vu();var Wy=N(vr(),1);kr();Fn();var Uy=e=>{let t=String(e.kanji??""),r=String(e.kana??"");return t&&t!==r?`${t}/${r}`:r||t};function jy(){let e=Ui();if(!e.size)return{pairs:[],reviews:0,bothStudied:0};let t=p(`
    SELECT w.id, w.kanji, w.kana, COALESCE(p.seen_count, 0) AS seen_count,
           (SELECT COUNT(*) FROM reviews r WHERE r.word_id = w.id) AS reviews
    FROM words w
    LEFT JOIN progress p ON p.word_id = w.id
  `),r=new Map(t.map(o=>[Number(o.id),o])),n=[];return e.forEach((o,s)=>{let i=r.get(s),a=r.get(o);!i||!a||n.push({fromId:s,intoId:o,fromLabel:Uy(i),intoLabel:Uy(a),reviews:Number(i.reviews??0),bothStudied:Number(i.seen_count??0)>0&&Number(a.seen_count??0)>0})}),{pairs:n,reviews:n.reduce((o,s)=>o+s.reviews,0),bothStudied:n.filter(o=>o.bothStudied).length}}function Ov(){let e=jy(),t=(0,Fy.getDatabase)(),r=E("SELECT COUNT(*) FROM reviews",[],0);if(!e.pairs.length)return{merged:0,movedReviews:0,reviewsBefore:r,reviewsAfter:r};let n=new Map(e.pairs.map(s=>[s.fromId,s.intoId])),o=0;t.run("BEGIN TRANSACTION");try{e.pairs.forEach(s=>{o+=ku(t,s.fromId,s.intoId)}),hu(s=>n.get(s)??s),t.run("COMMIT")}catch(s){throw t.run("ROLLBACK"),s}return xn(),Yp(),Vo(),Zr(),Promise.resolve().then(()=>N(nt(),1)).then(({requestFullSnapshot:s})=>s()),D(),(0,Wy.notifyProgressUpdated)(),{merged:e.pairs.length,movedReviews:o,reviewsBefore:r,reviewsAfter:E("SELECT COUNT(*) FROM reviews",[],0)}}dt();var NE={};M(NE,{MAX_UNCOMPRESSED_SNAPSHOT_BYTES:()=>_r,SUPPORTED_SYNC_PROTOCOL_VERSIONS:()=>Gy,SYNC_PROTOCOL_VERSION:()=>SE,SYNC_SNAPSHOT_FORMAT:()=>TE,compressSyncSnapshot:()=>Wv,decompressSyncSnapshot:()=>jv,exportSyncSnapshot:()=>Fv,getSnapshotCapacity:()=>Cv,isUserSyncSnapshot:()=>yE});var wE=N(Py(),1),Rd=N($(),1);dt();Yr();var bd=N(Nd(),1);async function Ky(){if(typeof __non_webpack_require__>"u"||typeof __non_webpack_require__.async!="function")throw new Error("\u5F53\u524D\u5FAE\u4FE1\u57FA\u7840\u5E93\u4E0D\u652F\u6301\u5F02\u6B65\u52A0\u8F7D\u540C\u6B65\u538B\u7F29\u6A21\u5757\u3002");let e=await __non_webpack_require__.async("./account/fflate.umd.js");return e.default??e}var TE="master-nihongo-user-sqlite-v1",SE=2,Gy=new Set([1,SE]),_r=48e6,_E=0,Cv=()=>({bytes:_E,limit:_r,ratio:_E/_r}),po="sync_snapshot_meta",Dv=["sync_tombstones"],Xs=e=>`"${e.replace(/"/g,'""')}"`,Ys=(e,t,r=[])=>(()=>{let n=e.prepare(t);try{return r.length&&n.bind(r),n.step()?n.get()[0]:void 0}finally{n.free()}})(),By=(e,t)=>!!Ys(e,"SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",[t]),Iv={stage1_tasks:14,stage2_progress:14,kanji_progress:14,kanji_reading_progress:14,kanji_unit_tasks:14,kanji_char_tasks:14,confusion_tasks:14,spelling_tasks:14},Mv=e=>new Date(Date.now()-e*24*60*60*1e3).toISOString().slice(0,10),xv=(e,t)=>{let r=e.prepare(`PRAGMA table_info(${Xs(t)})`),n=[];try{for(;r.step();)n.push(String(r.getAsObject().name))}finally{r.free()}return n},Uv=(e,t,r,n="")=>{if(!By(e,r))return;let o=String(Ys(e,"SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",[r])??"");if(!o)throw new Error(`\u65E0\u6CD5\u5BFC\u51FA\u540C\u6B65\u8868\u7ED3\u6784\uFF1A${r}`);t.run(o);let s=r==="app_state"?[...pi]:r==="grammar_state"?[...Ei]:[],i=Iv[r],a=[],d="";s.length?(d=` WHERE key NOT IN (${s.map(()=>"?").join(", ")})`,a.push(...s)):i&&(d=" WHERE reviewed_on >= ?",a.push(Mv(i))),n&&(d=d?`${d} AND (${n})`:` WHERE ${n}`);let u=xv(e,r);if(!u.length)return;let l=`INSERT INTO ${Xs(r)} (${u.map(Xs).join(", ")}) VALUES (${u.map(()=>"?").join(", ")})`,c=e.prepare(`SELECT ${u.map(Xs).join(", ")} FROM ${Xs(r)}${d}`),f=t.prepare(l);t.run("BEGIN");try{for(a.length&&c.bind(a);c.step();)f.run(c.get());t.run("COMMIT")}catch(m){throw t.run("ROLLBACK"),m}finally{c.free(),f.free()}};async function Fv(){Je();let e=(0,Rd.getDatabase)(),t=await(0,Rd.createDatabase)();try{t.run(`
      CREATE TABLE ${po} (
        format TEXT PRIMARY KEY,
        protocol_version INTEGER NOT NULL
      )
    `),t.run(`INSERT INTO ${po} (format, protocol_version) VALUES (?, ?)`,[TE,SE]);let r=(0,bd.canUseFeature)("weeklyReportCloudHistory",(0,bd.getEntitlements)()),n=new Set([...Do(r).map(a=>a.table),...Dv]),o=[...Cu(),...r?[]:["weekly_reports"]],s=o.length?`table_name NOT IN (${o.map(a=>`'${a.replace(/'/g,"''")}'`).join(", ")})`:"";for(let a of n)Uv(e,t,a,a==="sync_tombstones"?s:"");let i=new Uint8Array(t.export());return _E=i.byteLength,i}finally{t.close()}}var yE=e=>{if(!By(e,po)||Ys(e,`SELECT format FROM ${po} LIMIT 1`)!==TE)return!1;let t=Ys(e,`SELECT COUNT(*) FROM pragma_table_info('${po}') WHERE name = 'protocol_version'`);return Number(t)?Gy.has(Number(Ys(e,`SELECT protocol_version FROM ${po} LIMIT 1`))):!0},Xy=e=>e.buffer.slice(e.byteOffset,e.byteOffset+e.byteLength);async function Wv(e){if(e.byteLength>_r)throw new Error(`\u5B66\u4E60\u6570\u636E\u5FEB\u7167 ${(e.byteLength/1e6).toFixed(1)} MB\uFF0C\u8D85\u8FC7 ${_r/1e6} MB \u4E0A\u9650\uFF0C\u4E91\u5907\u4EFD\u5DF2\u505C\u6B62\u3002\u672C\u673A\u6570\u636E\u5B8C\u597D\uFF0C\u8BF7\u5728\u8BBE\u7F6E\u9875\u5BFC\u51FA\u672C\u5730\u5907\u4EFD\u5E76\u8054\u7CFB\u652F\u6301\u3002`);if(wE.Capacitor.getPlatform()==="wechat"){let{gzipSync:r}=await Ky();return{bytes:r(e),compression:"gzip"}}if(typeof CompressionStream>"u")return{bytes:e,compression:"none"};let t=new Blob([Xy(e)]).stream().pipeThrough(new CompressionStream("gzip"));return{bytes:new Uint8Array(await new Response(t).arrayBuffer()),compression:"gzip"}}async function jv(e,t){if(t==="none"){if(e.byteLength>_r)throw new Error("\u4E91\u7AEF\u5B66\u4E60\u6570\u636E\u8D85\u8FC7\u5B89\u5168\u5927\u5C0F\u9650\u5236\u3002");return e}if(wE.Capacitor.getPlatform()==="wechat"){let{gunzipSync:d}=await Ky(),u=d(e);if(u.byteLength>_r)throw new Error("\u4E91\u7AEF\u5B66\u4E60\u6570\u636E\u89E3\u538B\u540E\u8D85\u8FC7\u5B89\u5168\u5927\u5C0F\u9650\u5236\uFF0C\u5DF2\u505C\u6B62\u5904\u7406\u3002");return u}if(typeof DecompressionStream>"u")throw new Error("\u5F53\u524D\u7CFB\u7EDF\u7248\u672C\u65E0\u6CD5\u89E3\u538B\u4E91\u7AEF\u5B66\u4E60\u6570\u636E\uFF08\u9700\u8981 iOS/Safari 16.4 \u4EE5\u4E0A\uFF09\uFF0C\u8BF7\u5347\u7EA7\u540E\u91CD\u8BD5\u3002");let n=new Blob([Xy(e)]).stream().pipeThrough(new DecompressionStream("gzip")).getReader(),o=[],s=0;try{for(;;){let{done:d,value:u}=await n.read();if(d)break;if(s+=u.byteLength,s>_r)throw await n.cancel(),new Error(`\u4E91\u7AEF\u5B66\u4E60\u6570\u636E\u89E3\u538B\u540E\u8D85\u8FC7 ${_r/1e6} MB\uFF0C\u5DF2\u505C\u6B62\u5904\u7406\u3002`);o.push(u)}}finally{n.releaseLock()}let i=new Uint8Array(s),a=0;for(let d of o)i.set(d,a),a+=d.byteLength;return i}var AE={};M(AE,{mergeDatabaseBytes:()=>wC});var fo=N($(),1);dt();Yr();P();var kd=N(Nd(),1);fi();var Yy="grammar-highlights-updated",zy="grammar-positions-updated";Fi();kr();Fn();ne();Re();var rN="",iC="legacy",Pr=e=>`"${e.replace(/"/g,'""')}"`,Te=(e,t)=>{let r=e.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1");try{return r.bind([t]),r.step()}finally{r.free()}},Eo=(e,t)=>{if(!Te(e,t))return new Set;let r=e.prepare(`PRAGMA table_info(${Pr(t)})`);try{let n=new Set;for(;r.step();)n.add(String(r.get()[1]));return n}finally{r.free()}},aC=(e,t,r)=>{let n=new Set(["sync_updated_at","sync_origin_device","sync_uid"]),o=new Set(["sync_snapshot_meta","sync_tombstones","direction_tasks","mode_tasks","achievement_unlocked",...r.filter(d=>d.cloud!==!1).map(d=>d.table)]),s=e.prepare("SELECT name FROM sqlite_master WHERE type = 'table'"),i=[];try{for(;s.step();)i.push(String(s.get()[0]??""))}finally{s.free()}let a=i.filter(d=>d&&d!=="sqlite_sequence"&&!o.has(d));if(a.length)throw new Error(`\u4E91\u7AEF\u5B66\u4E60\u6570\u636E\u5305\u542B\u5F53\u524D\u7248\u672C\u65E0\u6CD5\u4FDD\u7559\u7684\u8868\uFF1A${a.join(", ")}\uFF0C\u8BF7\u5148\u66F4\u65B0\u5E94\u7528\u3002`);for(let d of r){if(!Te(e,d.table))continue;if(!Te(t,d.table))throw new Error(`\u4E91\u7AEF\u5B66\u4E60\u6570\u636E\u9700\u8981\u8868 ${d.table}\uFF0C\u5F53\u524D\u7248\u672C\u65E0\u6CD5\u65E0\u635F\u4FDD\u5B58\uFF0C\u8BF7\u5148\u66F4\u65B0\u5E94\u7528\u3002`);let u=Eo(t,d.table),l=[...Eo(e,d.table)].filter(c=>!u.has(c)&&!n.has(c));if(l.length)throw new Error(`\u4E91\u7AEF\u5B66\u4E60\u6570\u636E\u7684 ${d.table} \u5305\u542B\u5F53\u524D\u7248\u672C\u65E0\u6CD5\u4FDD\u7559\u7684\u5217\uFF1A${l.join(", ")}\uFF0C\u8BF7\u5148\u66F4\u65B0\u5E94\u7528\u3002`)}},OE=(e,t)=>{if(!Te(e,t))return[];let r=e.prepare(`SELECT * FROM ${Pr(t)}`);try{let n=[];for(;r.step();)n.push(r.getAsObject());return n}finally{r.free()}},nN=(e,t)=>e.keys.map(r=>String(t[r]??"")).join(rN),dC=e=>String(e?.[ve]??"1970-01-01T00:00:00.000Z"),uC=e=>String(e?.[Ne]??iC),oN=(e,t)=>e.changedAt!==t.changedAt?e.changedAt>t.changedAt?1:-1:e.originDevice===t.originDevice?0:e.originDevice>t.originDevice?1:-1,tN=(e,t,r)=>{let n=new Map;for(let o of r){if(!Te(e,o.table))continue;let s=new Map;for(let i of OE(e,o.table)){let a=o.strategy==="append"&&!String(i.sync_uid??"")?`${String(i.sync_origin_device??t)}:${String(i.id??`${i.word_id??i.grammar_id??i.unit_key??""}|${i.answer??""}|${i.reviewed_on??""}|${i.created_at??""}`)}`:nN(o,i);Io(o.table,String(i.key??""))||s.set(a,{key:a,row:i,deleted:!1,changedAt:dC(i),originDevice:uC(i)||t})}n.set(o.table,s)}if(Te(e,"sync_tombstones"))for(let o of OE(e,"sync_tombstones")){let s=String(o.table_name??""),i=String(o.row_key??"");if(!r.find(l=>l.table===s)||!n.has(s)||Io(s,i))continue;let d={key:i,deleted:!0,changedAt:String(o.deleted_at??"1970-01-01T00:00:00.000Z"),originDevice:String(o.origin_device??t)||t},u=n.get(s)?.get(i);(!u||oN(d,u)>0)&&n.get(s)?.set(i,d)}return{rows:n}},lC=(e,t,r)=>{let n=new Map,o=t.rows.get(e.table)??new Map,s=r.rows.get(e.table)??new Map,i=new Set([...o.keys(),...s.keys()]);for(let a of i){let d=o.get(a),u=s.get(a);if(!d){u&&n.set(a,u);continue}if(!u){n.set(a,d);continue}(e.strategy==="append"||e.strategy==="union"||e.strategy==="lww")&&n.set(a,oN(d,u)>=0?d:u)}return n},cC=(e,t)=>{if(!e.deleted)return{...t??{},...e.row??{}}},mC=(e,t)=>e instanceof Uint8Array||t instanceof Uint8Array?!(e instanceof Uint8Array)||!(t instanceof Uint8Array)||e.length!==t.length?!1:e.every((r,n)=>r===t[n]):e===t,pC=(e,t,r)=>{if(!e||!t)return!1;for(let n of r)if(!mC(e[n],t[n]))return!1;return!0},EC=(e,t,r)=>{let n=r.split(rN),o=t.keys.map(s=>`${Pr(s)} = ?`).join(" AND ");e.run(`DELETE FROM ${Pr(t.table)} WHERE ${o}`,n)},fC=(e,t)=>{if(!Te(e,t.table))return[];let r=new Set(t.keys),n=e.prepare(`PRAGMA table_info(${Pr(t.table)})`);try{let o=[];for(;n.step();){let s=n.get();Number(s[5]??0)>0&&!r.has(String(s[1]))&&o.push(String(s[1]))}return o}finally{n.free()}},gC=(e,t,r,n)=>{if(!Te(e,r.table))return;let o=Eo(e,r.table),s=OE(e,r.table),i=new Map(s.map(l=>[nN(r,l),l])),a=new Set(o),d=fC(e,r),u=[];for(let[l,c]of n){if(Io(r.table,l))continue;let f=i.get(l),m=cC(c,f);if(!m){f&&u.push(()=>EC(t,r,l));continue}r.strategy==="append"&&!String(m.sync_uid??"")&&(m.sync_uid=l);for(let y of d)f&&f[y]!=null?m[y]=f[y]:delete m[y];if(pC(f,m,a))continue;let g=Object.keys(m).filter(y=>a.has(y));if(!g.length)continue;let S=g.map(Pr).join(", "),w=g.map(()=>"?").join(", ");u.push(()=>t.run(`INSERT OR REPLACE INTO ${Pr(r.table)} (${S}) VALUES (${w})`,g.map(y=>m[y])))}u.forEach(l=>l())},_C=(e,t,r)=>{if(!Te(e,"sync_tombstones"))return;for(let o of r.keys())e.run("DELETE FROM sync_tombstones WHERE table_name = ?",[o]);let n=Eo(e,"sync_tombstones");for(let[o,s]of r)for(let i of s.values()){if(!i.deleted)continue;let a={table_name:o,row_key:i.key,deleted_at:i.changedAt,origin_device:i.originDevice},d=Object.keys(a).filter(u=>n.has(u));t.run(`INSERT OR REPLACE INTO sync_tombstones (${d.map(Pr).join(", ")})
         VALUES (${d.map(()=>"?").join(", ")})`,d.map(u=>a[u]))}};async function wC(e){Je();let t=(0,fo.getDatabase)(),r=await(0,fo.openDatabase)(e);try{let n=Te(r,"words")&&Te(r,"progress")&&Te(r,"app_state"),o=yE(r);if(!n&&!o)throw new Error("\u4E91\u7AEF\u5B66\u4E60\u6570\u636E\u683C\u5F0F\u65E0\u6548\uFF0C\u5DF2\u4FDD\u7559\u672C\u673A\u6570\u636E\u3002");let s=Do((0,kd.canUseFeature)("weeklyReportCloudHistory",(0,kd.getEntitlements)()));for(let w of s){if(!Te(t,w.table)||!Te(r,w.table))continue;Wu(w.table);let y=Eo(t,w.table);[...Eo(r,w.table)].some(_=>_.startsWith("fsrs_")&&!y.has(_))&&j({table:w.table,idColumn:"",eligible:""})}o&&aC(r,t,at);let i=Te(t,"kanji_unit_reviews")?(await Promise.resolve().then(()=>(ks(),Ba))).replayKanjiUnitReviews:void 0,a=Te(t,"kanji_char_reviews")?(await Promise.resolve().then(()=>(eo(),Ra))).replayKanjiCharReviews:void 0,d=Te(t,"confusion_reviews")?(await Promise.resolve().then(()=>(ln(),va))).replayConfusionReviews:void 0,u=Te(t,"kana_reviews")?(await Promise.resolve().then(()=>(xs(),nd))).replayKanaReviews:void 0,l=Te(t,"custom_words")?(await Promise.resolve().then(()=>(eN(),Zy))).materializeCustomWords:void 0,c=tN(t,"local",s),f=tN(r,"remote",s),m=new Map;_i();let g=lu(t);t.run("BEGIN TRANSACTION");try{for(let w of s){let y=lC(w,c,f);m.set(w.table,y),gC(t,g,w,y)}_C(t,g,m),g.free(),i?.(),a?.(),d?.(),u?.();for(let w of["words","grammar","kanji","confusion"])Ai(w);$f(),l?.(),t.run("COMMIT")}catch(w){throw g.free(),t.run("ROLLBACK"),w}finally{wi()}Bo(),Vo(),Zr(),typeof window<"u"&&(window.dispatchEvent(new Event(Yy)),window.dispatchEvent(new Event(zy)));let S=(0,fo.exportDatabase)();if(!S)throw new Error("\u5F53\u524D\u6CA1\u6709\u53EF\u5408\u5E76\u7684\u672C\u5730\u6570\u636E\u5E93\u3002");return S}finally{r.close()}}Yr();var PE={};M(PE,{DEFAULT_STUDY_FOCUS_MINUTES:()=>Ct,FOCUS_SLOT_MINUTES:()=>NN,STUDY_FOCUS_MINUTES:()=>Fd,YUZU:()=>ce,YUZU_EVENT:()=>SN,applyYuzuEquipment:()=>yN,bookReferralReward:()=>IC,bookTeamReward:()=>DC,buyItem:()=>jC,buyRepairCard:()=>PC,claimDailyPlanYuzu:()=>FC,claimStudyFocusYuzu:()=>FE,equipItem:()=>LN,equippedItem:()=>_o,focusMinimumMs:()=>Wd,focusMinimumWords:()=>Js,focusRoundRewards:()=>UC,grantReferralSet:()=>MC,grantRepairCard:()=>ON,nextStudyFocusYuzu:()=>UE,ownsItem:()=>jd,proGiftClaimed:()=>HC,proGiftEligible:()=>AN,repairCards:()=>$d,repairDay:()=>GC,repairDayWithCard:()=>KC,repairPrice:()=>jE,repairableDays:()=>$E,settleYuzu:()=>WC,unequip:()=>$C,voiceUnlocked:()=>CC,yuzuBalance:()=>Ud,yuzuToday:()=>xC});var Vt={early:"title-early",night:"title-night",hunter:"title-hunter",slow:"title-slow",grove:"title-grove",capy:"title-capy",yuyou:"title-yuyou"};var wo=N($(),1);P();Mr();Lt();var vE={};M(vE,{computeStreak:()=>SC,shiftDay:()=>gt,weekDays:()=>yC});var hE=e=>Date.parse(`${e}T00:00:00Z`),TC=e=>new Date(e).toISOString().slice(0,10),kE=e=>/^\d{4}-\d{2}-\d{2}$/.test(e)&&!Number.isNaN(hE(e)),gt=(e,t)=>kE(e)?TC(hE(e)+t*864e5):e,SC=(e,t)=>{if(!kE(t))return 0;let r=new Set(e),n=r.has(t)?t:gt(t,-1),o=0;for(;r.has(n);)o+=1,n=gt(n,-1);return o},yC=e=>{if(!kE(e))return[];let t=new Date(hE(e)).getUTCDay(),r=t===0?6:t-1,n=gt(e,-r);return Array.from({length:7},(o,s)=>gt(n,s))};P();var vd={answers:20,seconds:300},NC=[7,14,30,50,100,200,365,500,1e3];function RC(e){return e<=0?0:e<7?1:e<30?2:e<100?3:e<365?4:5}function bC(e,t,r,n,o){let s=[...e].filter(([m,g])=>m<=t&&g!=="none").map(([m])=>m).sort(),i=new Set(s),a=e.get(t)??"none",d=a!=="none"?t:gt(t,-1),u=0,l=0;for(;i.has(d);){u+=1,e.get(d)==="gold"&&(l+=1);let m=gt(d,-1);if(m===d)break;d=m}let c=0,f=0;return s.forEach((m,g)=>{f=g>0&&gt(s[g-1],1)===m?f+1:1,c=Math.max(c,f)}),{today:t,todayStatus:a,streak:u,longest:c,litDays:s.length,atRisk:u>0&&a==="none"&&(r>=20||r<4),tier:RC(u),nextMilestone:NC.find(m=>m>u)??null,todayAnswers:n,todaySeconds:o,everLitBefore:s.filter(m=>m<t).length,goldInStreak:l}}var sN=[["reviews","reviewed_on"],["grammar_reviews","reviewed_on"],["kanji_unit_reviews","reviewed_on"],["spelling_reviews","reviewed_on"],["jlpt_answers","answered_on"]];function iN(){let e=new Map,t=new Map,r=new Set(p("SELECT name FROM sqlite_master WHERE type = 'table'").map(s=>String(s.name)));for(let[s,i]of sN)if(r.has(s))for(let a of p(`SELECT ${i} AS day, COUNT(*) AS answers FROM ${s} GROUP BY ${i}`)){let d=String(a.day);e.set(d,(e.get(d)??0)+Number(a.answers))}for(let s of p("SELECT studied_on AS day, SUM(seconds) AS seconds FROM word_study_time GROUP BY studied_on"))t.set(String(s.day),Number(s.seconds));let n=new Map;for(let s of new Set([...e.keys(),...t.keys()]))((e.get(s)??0)>=vd.answers||(t.get(s)??0)>=vd.seconds)&&n.set(s,"lit");let o=new Set(p("SELECT key FROM yuzu_ledger WHERE kind IN ('repair', 'repair_card') GROUP BY key").map(s=>String(s.key)));for(let s of p("SELECT checked_on FROM checkins GROUP BY checked_on")){let i=String(s.checked_on);n.set(i,o.has(i)?"repaired":"gold")}return{statuses:n,answers:e,seconds:t}}function LC(){return iN().statuses}function aN(e=new Date){let{statuses:t,answers:r,seconds:n}=iN(),o=T(e);return bC(t,o,e.getHours(),r.get(o)??0,n.get(o)??0)}function dN(){let e=LC(),t=[...e.keys()].sort()[0];if(!t)return[];let r=T();return Array.from({length:7},(n,o)=>gt(r,-o-1)).filter(n=>n>t&&!e.has(n))}function uN(e=new Date){let t=T(e),r=i=>Number(p(i,[t])[0]?.n??0);if(r("SELECT COUNT(*) AS n FROM checkins WHERE checked_on = ?")>0)return r("SELECT COUNT(*) AS n FROM yuzu_ledger WHERE kind IN ('repair', 'repair_card') AND key = ?")>0?"repaired":"gold";let n=new Set(p("SELECT name FROM sqlite_master WHERE type = 'table'").map(i=>String(i.name))),o=0;for(let[i,a]of sN)n.has(i)&&(o+=r(`SELECT COUNT(*) AS n FROM ${i} WHERE ${a} = ?`));let s=r("SELECT COALESCE(SUM(seconds), 0) AS n FROM word_study_time WHERE studied_on = ?");return o>=vd.answers||s>=vd.seconds?"lit":"none"}var wN=N(CE(),1),xd=N(gN(),1),TN=N(Nd(),1);var Id=()=>!1,DE=()=>Promise.resolve();var ME={};M(ME,{CATEGORY_LABEL:()=>kC,EQUIPPABLE:()=>Md,VOICE_ITEM_PREFIX:()=>IE,YUZU_ITEMS:()=>_N,itemById:()=>Vs,teamTitleName:()=>vC});var IE="voice-",kC={theme:"\u914D\u8272\u4E3B\u9898",mascot:"\u5409\u7965\u7269\u76AE\u80A4",icon:"App \u56FE\u6807",voice:"\u53D1\u97F3\u58F0\u97F3",sound:"\u7B54\u9898\u97F3\u6548",walk:"\u8D70\u6CD5",title:"\u961F\u4F0D\u79F0\u53F7",misc:"\u5176\u4ED6"},Md=new Set(["theme","mascot","icon","sound","walk","title"]),_N=[{id:"theme-dusk",name:"\u665A\u971E",description:"\u6A59\u7C89\u6696\u8C03\u7684\u914D\u8272",category:"theme",price:0,invite:!0},{id:"theme-matcha",name:"\u62B9\u8336",description:"\u9752\u7EFF\u4E3B\u8272\u6362\u6210\u62B9\u8336\u7EFF",category:"theme",price:2e3},{id:"theme-sakura",name:"\u6A31",description:"\u7C89\u5E95\u6A31\u8272",category:"theme",price:2e3},{id:"theme-night",name:"\u6DF1\u591C\u98DF\u5802",description:"\u6697\u7425\u73C0\u6696\u8C03\u7684\u591C\u95F4\u914D\u8272",category:"theme",price:2e3},{id:"theme-paper",name:"\u7EB8\u672C",description:"\u5976\u6CB9\u7EB8\u8272\u3001\u58A8\u8272\u4E3B\u952E\u3001\u7EC6\u7EBF\u5206\u9694\uFF0C\u50CF\u4E00\u672C\u5B89\u9759\u7684\u5355\u8BCD\u672C",category:"theme",price:3e3},{id:"theme-round",name:"\u5706\u5706",description:"\u767D\u5E95\u5706\u4F53\u3001\u4F1A\u6309\u4E0B\u53BB\u7684\u7ACB\u4F53\u6309\u94AE\u3001\u67DA\u5B50\u6A59\u70B9\u7F00",category:"theme",price:3e3},{id:"mascot-croc",name:"\u9CC4\u9C7C",description:"\u6362\u4E00\u53EA\u9CC4\u9C7C:\u8868\u60C5\u3001\u9875\u9762\u56FE\u6807\u3001\u7A7A\u72B6\u6001\u63D2\u753B\u6574\u5957\u6362\u3002\u5C0F\u8DEF\u4E0A\u8D70\u7684\u8FD8\u662F\u6C34\u8C5A",category:"mascot",price:3e3},{id:"icon-happy",name:"\u5F00\u5FC3\u56FE\u6807",description:"\u628A App \u56FE\u6807\u6362\u6210\u5F00\u5FC3\u8868\u60C5",category:"icon",price:5e3,art:"app-icon-happy"},{id:"icon-onsen",name:"\u6CE1\u6C64\u56FE\u6807",description:"\u628A App \u56FE\u6807\u6362\u6210\u6CE1\u6C64\u7684\u6C34\u8C5A",category:"icon",price:5e3,art:"app-icon-onsen"},{id:"voice-voicevox-10",name:"\u96E8\u6674\u306F\u3046",description:"\u8F7B\u5FEB\u5973\u58F0\u3002\u5207\u6362\u5355\u8BCD\u53D1\u97F3\uFF1B\u4F8B\u53E5\u4ECD\u7528\u9ED8\u8BA4\u58F0",category:"voice",price:6e3,art:"item-voice-female-2"},{id:"voice-voicevox-11",name:"\u7384\u91CE\u6B66\u5B8F",description:"\u6C89\u7A33\u7537\u58F0\u3002\u5207\u6362\u5355\u8BCD\u53D1\u97F3\uFF1B\u4F8B\u53E5\u4ECD\u7528\u9ED8\u8BA4\u58F0",category:"voice",price:6e3,art:"item-voice-male"},{id:"sound-marimba",name:"\u6728\u7434",description:"\u7B54\u9898\u97F3\u6362\u6210\u6728\u7434:\u66F4\u5706\u3001\u66F4\u77ED",category:"sound",price:3e3,art:"item-sound-marimba-2"},{id:"sound-epiano",name:"\u7535\u94A2",description:"\u7B54\u9898\u97F3\u6362\u6210\u7535\u94A2:\u5E26\u4E00\u70B9\u6BDB\u8FB9\u7684\u6696\u97F3",category:"sound",price:3e3,art:"item-sound-epiano-2"},{id:"walk-alt",name:"\u6EDA\u7740\u8D70",description:"\u5B66\u4E60\u9875\u5C0F\u8DEF\u548C\u52A0\u8F7D\u65F6\uFF0C\u6C34\u8C5A\u6539\u6210\u6EDA\u7740\u8D70",category:"walk",price:4e3,art:"roll-frame"},{id:"report-cover",name:"\u5468\u62A5\u5C01\u9762",description:"\u5468\u62A5\u5C01\u9762\u6362\u4E00\u5F20",category:"misc",price:3e3,soon:!0,art:"card-daily"},{id:Vt.yuyou,name:"\u67DA\u53CB",description:"\u961F\u4F0D\u540D\u5355\u91CC\uFF0C\u540D\u5B57\u65C1\u6302\u4E0A\u300C\u67DA\u53CB\u300D",category:"title",price:0,invite:!0},{id:Vt.early,name:"\u6668\u8BFB\u6D3E",description:"\u961F\u4F0D\u540D\u5355\u91CC\uFF0C\u540D\u5B57\u65C1\u6302\u4E0A\u300C\u6668\u8BFB\u6D3E\u300D",category:"title",price:3e3},{id:Vt.night,name:"\u591C\u8BFB\u6D3E",description:"\u961F\u4F0D\u540D\u5355\u91CC\uFF0C\u540D\u5B57\u65C1\u6302\u4E0A\u300C\u591C\u8BFB\u6D3E\u300D",category:"title",price:3e3},{id:Vt.hunter,name:"\u5355\u8BCD\u730E\u4EBA",description:"\u961F\u4F0D\u540D\u5355\u91CC\uFF0C\u540D\u5B57\u65C1\u6302\u4E0A\u300C\u5355\u8BCD\u730E\u4EBA\u300D",category:"title",price:3e3},{id:Vt.slow,name:"\u6162\u6162\u6765",description:"\u961F\u4F0D\u540D\u5355\u91CC\uFF0C\u540D\u5B57\u65C1\u6302\u4E0A\u300C\u6162\u6162\u6765\u300D",category:"title",price:3e3},{id:Vt.grove,name:"\u67DA\u5B50\u5E84\u56ED\u4E3B",description:"\u961F\u4F0D\u540D\u5355\u91CC\uFF0C\u540D\u5B57\u65C1\u6302\u4E0A\u300C\u67DA\u5B50\u5E84\u56ED\u4E3B\u300D",category:"title",price:3e3},{id:Vt.capy,name:"\u6C34\u8C5A\u672C\u8C5A",description:"\u961F\u4F0D\u540D\u5355\u91CC\uFF0C\u540D\u5B57\u65C1\u6302\u4E0A\u300C\u6C34\u8C5A\u672C\u8C5A\u300D",category:"title",price:3e3}],Vs=e=>_N.find(t=>t.id===e),vC=e=>{let t=e?Vs(e):void 0;return t?.category==="title"?t.name:""};var ce={study:50,studyWords:100,plan:50,streak7:300,encore:50,achievement:200,focus:[100,50,25,23,12,6,3,2,1],focusMinimumMs:300*1e3,focusMinimumWords:10,repair:[500,1e3,2e3],repairWindowDays:7},SN="shushugo:yuzu",wr=()=>{if(O("yuzu_scale_10","")==="1")return;let e=(0,wo.getDatabase)();e.run("BEGIN");try{O("yuzu_scale_10","")!=="1"&&(e.run("UPDATE yuzu_ledger SET amount = amount * 10 WHERE amount != 0"),R("yuzu_scale_10","1")),e.run("COMMIT"),D()}catch(t){throw e.run("ROLLBACK"),t}},tt=()=>{yN(),typeof window<"u"&&window.dispatchEvent(new Event(SN))},yN=()=>{if(!(typeof document>"u"))try{let e=_o("theme");e?document.documentElement.setAttribute("data-skin",e):document.documentElement.removeAttribute("data-skin"),(0,wN.setSoundTimbre)(_o("sound").replace("sound-","")||"kalimba"),(0,xd.setMascotSkin)(_o("mascot")),(0,xd.setWalkStyle)(_o("walk"))}catch{}},CC=(e,t)=>!e||e===t||jd(IE+e),ze=(e,t,r)=>((0,wo.getDatabase)().run("INSERT OR IGNORE INTO yuzu_ledger (kind, key, amount, day) VALUES (?, ?, ?, ?)",[e,t,r,T()]),E("SELECT changes()",[],0)>0),DC=(e,t,r)=>!t||!Number.isSafeInteger(r)||r<=0||(wr(),!ze(e,t,r))?!1:(D(),tt(),!0),IC=(e,t,r)=>!t||!Number.isSafeInteger(r)||r<=0||(wr(),!ze(e,t,r))?!1:(D(),tt(),!0),MC=()=>{wr();let e=ze("buy","theme-dusk",0),t=ze("buy",Vt.yuyou,0);(e||t)&&(D(),tt())},Ud=()=>(wr(),E("SELECT COALESCE(SUM(amount), 0) FROM yuzu_ledger",[],0)),xC=()=>(wr(),p("SELECT kind, key, amount FROM yuzu_ledger WHERE day = ? AND kind != 'focus_claim' ORDER BY rowid",[T()]).map(e=>({kind:String(e.kind),key:String(e.key),amount:Number(e.amount)}))),NN=5,Ct=10,Fd=[5,10,15,20,30],qs=(()=>{let e=[],t=0;for(let r of ce.focus)for(let n=0;n<2;n++){let o=Math.round(t);t+=r/2,e.push(Math.round(t)-o)}return e})(),xE=e=>Math.max(1,Math.round(e/NN)),RN=e=>e.reduce((t,r)=>t+r,0),Wd=e=>Math.ceil(ce.focusMinimumMs*e/Ct/6e4)*6e4,Js=e=>Math.round(ce.focusMinimumWords*e/Ct),UC=e=>{let t=xE(e),r=[];for(let n=0;n<qs.length;n+=t)r.push(RN(qs.slice(n,n+t)));for(;r.length&&!r[r.length-1];)r.pop();return r},bN=e=>p("SELECT key FROM yuzu_ledger WHERE kind = 'focus' AND day = ?",[e]).reduce((t,r)=>{let n=String(r.key).split(":").pop()??"",o=n.startsWith("s")?Number(n.slice(1)):Number(n)*2;return Number.isFinite(o)?Math.max(t,o):t},0),UE=(e=T(),t=Ct)=>{let r=bN(e);return RN(qs.slice(r,r+xE(t)))},FE=(e,t=Ct)=>{wr();let r=p(`SELECT completed_at FROM study_focus_windows
    WHERE id = ? AND kind = 'focus' AND active_ms >= ? AND words >= ?`,[e,Wd(t),Js(t)])[0];if(!r||E("SELECT COUNT(*) FROM yuzu_ledger WHERE kind = 'focus_claim' AND key = ?",[e],0))return 0;let n=B(new Date(Number(r.completed_at))),o=(0,wo.getDatabase)(),s=0;o.run("SAVEPOINT claim_study_focus");try{let i=bN(n);for(let a=i;a<Math.min(i+xE(t),qs.length);a++){let d=qs[a];d<=0||(o.run("INSERT OR IGNORE INTO yuzu_ledger(kind, key, amount, day) VALUES ('focus', ?, ?, ?)",[`${n}:s${a+1}`,d,n]),E("SELECT changes()",[],0)&&(s+=d))}o.run("INSERT OR IGNORE INTO yuzu_ledger(kind, key, amount, day) VALUES ('focus_claim', ?, 0, ?)",[e,n]),o.run("RELEASE claim_study_focus")}catch(i){throw o.run("ROLLBACK TO claim_study_focus"),o.run("RELEASE claim_study_focus"),i}return D(),s&&tt(),s},FC=()=>{wr();let e=dr();return e.total<=0||e.completed<e.total||!ze("plan",T(),ce.plan)?0:(D(),tt(),ce.plan)},WC=()=>{wr();let e=T(),t=0;if(E("SELECT COUNT(DISTINCT word_id) FROM reviews WHERE reviewed_on = ? AND direction = 'forward'",[e],0)>=ce.studyWords&&ze("study",e,ce.study)&&(t+=ce.study),uN()==="gold"){let{goldInStreak:o}=aN();o%7===0&&ze("streak",e,ce.streak7)&&(t+=ce.streak7)}Kn(e).dayWords>0&&ze("encore",e,ce.encore)&&(t+=ce.encore),p("SELECT id FROM achievements WHERE id NOT IN (SELECT key FROM yuzu_ledger WHERE kind = 'achievement')").forEach(o=>{ze("achievement",String(o.id),ce.achievement)&&(t+=ce.achievement)});let n=AN()&&ON("pro",!1);return(t||n)&&(D(),tt()),t},jd=e=>E("SELECT COUNT(*) FROM yuzu_ledger WHERE kind = 'buy' AND key = ?",[e],0)>0,jC=e=>{let t=Vs(e);return!t||t.soon||t.invite||jd(e)||Ud()<t.price||t.category==="icon"&&!Id()?!1:(ze("buy",e,-t.price),Md.has(t.category)&&!_o(t.category)&&LN(e),D(),tt(),!0)},WE=e=>`yuzu_equipped:${e}`,_o=e=>O(WE(e),""),LN=e=>{let t=Vs(e);!t||!Md.has(t.category)||!jd(e)||t.category==="icon"&&!Id()||(R(WE(t.category),e),t.category==="icon"&&DE(e),D(),tt())},$C=e=>{e==="icon"&&!Id()||(R(WE(e),""),e==="icon"&&DE(""),D(),tt())},jE=()=>{wr();let e=gt(T(),-30),t=E("SELECT COUNT(*) FROM yuzu_ledger WHERE kind IN ('repair', 'card_buy') AND day >= ?",[e],0);return ce.repair[Math.min(t,ce.repair.length-1)]},$E=()=>dN(),$d=()=>Math.max(0,E("SELECT COUNT(*) FROM yuzu_ledger WHERE kind IN ('card', 'card_buy')",[],0)-E("SELECT COUNT(*) FROM yuzu_ledger WHERE kind = 'repair_card'",[],0)),ON=(e,t=!0)=>{if(E("SELECT COUNT(*) FROM yuzu_ledger WHERE kind IN ('card', 'card_overflow') AND key = ?",[e],0)||$d()>=1)return!1;let r=ze("card",e,0);return r&&t&&(D(),tt()),r},PC=()=>{if($d()>=1)return!1;let e=jE();if(Ud()<e)return!1;let t=`${T()}:${E("SELECT COUNT(*) FROM yuzu_ledger WHERE kind = 'card_buy' AND day = ?",[T()],0)+1}`;return ze("card_buy",t,-e)?(D(),tt(),!0):!1},AN=()=>{try{let e=(0,TN.getEntitlements)();return e.isPro&&e.source!=="trial"}catch{return!1}},HC=()=>E("SELECT COUNT(*) FROM yuzu_ledger WHERE kind IN ('card', 'card_overflow') AND key = 'pro'",[],0)>0,KC=e=>!$E().includes(e)||$d()<1?!1:(ze("repair_card",e,0),(0,wo.getDatabase)().run("INSERT OR IGNORE INTO checkins (checked_on) VALUES (?)",[e]),D(),tt(),!0),GC=e=>{if(!$E().includes(e))return!1;let t=jE();if(Ud()<t)return!1;let r=(0,wo.getDatabase)();return ze("repair",e,-t),r.run("INSERT OR IGNORE INTO checkins (checked_on) VALUES (?)",[e]),D(),tt(),!0};var QE={};M(QE,{STUDY_FOCUS_BASELINE_DAYS:()=>kN,STUDY_FOCUS_MIN_WORDS:()=>XE,STUDY_FOCUS_PARTIAL_KEY:()=>BE,STUDY_FOCUS_REWARDS:()=>BC,STUDY_FOCUS_REWARD_MIN_MS:()=>XC,STUDY_FOCUS_WINDOW_MS:()=>To,claimStudyFocusReward:()=>oD,continueStudyFocus:()=>sD,enterStudyFocus:()=>MN,finishStudyFocusAtDailyCompletion:()=>iD,getStudyFocusMinutes:()=>YE,getStudyFocusSnapshot:()=>he,isStudyFocusArmed:()=>zC,leaveStudyFocus:()=>aD,recordStudyFocusAnswer:()=>tD,recordStudyFocusTime:()=>eD,resumeStudyFocus:()=>ZC,sameStudyFocusState:()=>QC,setStudyFocusArmed:()=>VC,setStudyFocusMinutes:()=>YC,startStudyFocus:()=>nD,stopStudyFocus:()=>JE,studyFocusCounts:()=>VE,summarizeStudyFocus:()=>qE,undoStudyFocusAnswer:()=>rD});var GE=N($(),1);P();var To=Ct*60*1e3,BC=ce.focus,XC=ce.focusMinimumMs,BE="study_focus_partial_windows",XE=ce.focusMinimumWords,kN=30,HE="mn-study-focus-armed",vN="mn-study-focus-minutes",YE=()=>{try{let e=Number(localStorage.getItem(vN));return Fd.includes(e)?e:Ct}catch{return Ct}},YC=e=>{if(Fd.includes(e)){try{localStorage.setItem(vN,String(e))}catch{}try{let t=Ve();t.focus||(t.reward=null)}catch{}}},zC=()=>{try{return localStorage.getItem(HE)==="1"}catch{return!1}},VC=e=>{try{e?localStorage.setItem(HE,"1"):localStorage.removeItem(HE)}catch{}if(!e)try{Ve().source||JE()}catch{}},hN=new WeakMap,zE=e=>({id:`focus-${e}-${Math.random().toString(36).slice(2,12)}`,startedAt:e,activeMs:0,answers:{}}),CN=e=>e==="know"||e==="known_forever"||e==="fuzzy"||e==="forgot",qC=e=>{if(!e||typeof e!="object")return!1;let t=e;return typeof t.id=="string"&&typeof t.startedAt=="number"&&Number.isFinite(t.startedAt)&&typeof t.activeMs=="number"&&Number.isFinite(t.activeMs)&&t.activeMs>=0&&t.activeMs<To&&!!t.answers&&typeof t.answers=="object"&&!Array.isArray(t.answers)&&Object.entries(t.answers).every(([r,n])=>Number.isInteger(Number(r))&&Number(r)>0&&CN(n))},Ve=()=>{let e=(0,GE.getDatabase)(),t=hN.get(e);if(!t){let r={};try{let n=JSON.parse(O(BE,"{}"));n&&typeof n=="object"&&!Array.isArray(n)&&(r=Object.fromEntries(Object.entries(n).filter(([,o])=>qC(o))))}catch{}t={source:null,pausedFrom:null,pausedAt:0,baselines:r,focus:null,focusMs:To,completedAt:null,summary:null,unsavedMs:0,reward:null,rewardClaimed:!1,answerHistory:[]},hN.set(e,t)}return t},Tn=e=>{R(BE,JSON.stringify(e.baselines)),e.unsavedMs=0,D()},VE=e=>{let t=Object.values(e);return{words:t.length,remembered:t.filter(r=>r==="know"||r==="known_forever").length,fuzzy:t.filter(r=>r==="fuzzy").length,forgotten:t.filter(r=>r==="forgot").length}},qE=(e,t,r=Ct)=>{let n=VE(e),o=t.length?t.reduce((s,i)=>s+i.remembered,0)/t.length*r/Ct:null;return{...n,minutes:r,minWords:Js(r),rememberedRate:n.words?n.remembered/n.words*100:null,qualified:n.words>=Js(r),baselineWindows:t.length,baselineRemembered:o,rememberedDelta:o===null?null:n.remembered-o,efficiencyChangePercent:o===null||o===0?null:(n.remembered-o)/o*100}},KE=(e,t,r,n)=>{let o=VE(e.answers);t==="baseline"&&o.words<XE||(0,GE.getDatabase)().run(`INSERT OR IGNORE INTO study_focus_windows
    (id, kind, source, started_at, completed_at, active_ms, words, remembered, fuzzy, forgotten)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,[e.id,t,r,e.startedAt,n,t==="baseline"?To:e.activeMs,o.words,o.remembered,o.fuzzy,o.forgotten])},DN=(e,t)=>p(`
  SELECT words, remembered, fuzzy, forgotten FROM study_focus_windows
  WHERE kind = 'baseline' AND source = ? AND completed_at <= ? AND completed_at >= ? AND words >= ?`,[e,t,t-kN*864e5,XE]).map(r=>({words:Number(r.words),remembered:Number(r.remembered),fuzzy:Number(r.fuzzy),forgotten:Number(r.forgotten)})),JC=(e,t,r)=>(e.reward?.day!==t&&(e.reward={day:t,value:UE(t,r)}),e.reward.value),IN=(e,t)=>{e.focus=zE(t),e.focusMs=YE()*6e4},he=(e=Date.now())=>{let t=Ve(),r=t.focus?t.focusMs:YE()*6e4;return{status:t.summary?"break":t.focus?"running":"off",minutes:r/6e4,remainingSeconds:Math.max(0,Math.ceil((r-(t.focus?.activeMs??0))/1e3)),focusWindowId:t.focus?.id??null,activeMs:t.focus?.activeMs??0,summary:t.summary,nextReward:t.summary&&!t.summary.qualified?0:JC(t,B(new Date(t.completedAt??e)),r/6e4),rewardClaimed:t.rewardClaimed,paused:!t.source&&!!t.focus}},QC=(e,t)=>e.status===t.status&&e.minutes===t.minutes&&e.nextReward===t.nextReward&&e.summary===t.summary&&e.rewardClaimed===t.rewardClaimed,MN=(e,t=Date.now())=>{var o;let r=Ve();return r.focus&&!r.summary&&!r.source&&r.pausedFrom===e&&B(new Date(r.pausedAt))===B(new Date(t))||(r.focus=null,r.rewardClaimed=!1),r.pausedFrom=null,r.summary=null,r.completedAt=null,r.reward=null,r.source=e,r.answerHistory=[],(o=r.baselines)[e]??(o[e]=zE(t)),he(t)},ZC=(e,t=Date.now())=>Ve().source===e?he(t):MN(e,t),eD=(e,t=Date.now(),r)=>{let n=Ve();if(!n.source||r!==void 0&&r!==n.source||n.summary||!Number.isFinite(e)||e<=0)return he(t);let o=Math.min(e,n.focus?n.focusMs-n.focus.activeMs:e),s=o;for(;s>0;){let i=n.baselines[n.source],a=Math.min(s,To-i.activeMs);i.activeMs+=a,s-=a,i.activeMs===To&&(KE(i,"baseline",n.source,t-s),n.baselines[n.source]=zE(t-s))}return n.focus&&(n.focus.activeMs+=o,n.focus.activeMs===n.focusMs&&(KE(n.focus,"focus",n.source,t),n.summary=qE(n.focus.answers,DN(n.source,n.focus.startedAt),n.focusMs/6e4),n.completedAt=t)),n.unsavedMs+=o,n.answerHistory=n.answerHistory.filter(i=>i.baselineId===n.baselines[n.source].id||i.focusId===n.focus?.id),(n.unsavedMs>=15e3||n.summary)&&Tn(n),he(t)},tD=(e,t,r=Date.now())=>{let n=Ve();if(!n.source||n.summary||!Number.isInteger(e)||e<=0||!CN(t))return he(r);let o=n.baselines[n.source];return n.answerHistory.push({wordId:e,baselineId:o.id,baselinePrevious:o.answers[String(e)],focusId:n.focus?.id,focusPrevious:n.focus?.answers[String(e)]}),o.answers[String(e)]=t,n.focus&&(n.focus.answers[String(e)]=t),Tn(n),he(r)},rD=(e,t=Date.now())=>{let r=Ve();if(!r.source||r.summary)return he(t);let n=r.answerHistory.length-1;for(;n>=0&&r.answerHistory[n].wordId!==e;)n--;if(n<0)return he(t);let[o]=r.answerHistory.splice(n,1),s=(i,a,d)=>{!i||i.id!==a||(d?i.answers[String(e)]=d:delete i.answers[String(e)])};return s(r.baselines[r.source],o.baselineId,o.baselinePrevious),s(r.focus,o.focusId,o.focusPrevious),Tn(r),he(t)},nD=(e=Date.now())=>{let t=Ve();return t.source&&!t.focus&&(IN(t,e),t.rewardClaimed=!1),he(e)},oD=()=>{let e=Ve();if(!e.source||!e.focus||!e.summary?.qualified||e.rewardClaimed||he().nextReward<=0)return 0;let r=FE(e.focus.id,e.focusMs/6e4);return e.rewardClaimed=!0,r},sD=(e=Date.now())=>{let t=Ve();return!t.source||!t.focus||!t.summary||t.summary.qualified&&he(e).nextReward>0&&!t.rewardClaimed?!1:(t.reward=null,t.rewardClaimed=!1,IN(t,e),t.summary=null,t.completedAt=null,!0)},JE=(e=Date.now())=>{let t=Ve();return t.focus=null,t.summary=null,t.completedAt=null,t.reward=null,t.rewardClaimed=!1,Tn(t),he(e)},iD=(e=Date.now())=>{let t=Ve();if(!t.source||!t.focus||t.summary)return he(e);let r=t.focusMs/6e4;return t.focus.activeMs<Wd(r)?(t.focus=null,t.reward=null,t.rewardClaimed=!1,Tn(t),he(e)):(KE(t.focus,"focus",t.source,e),t.summary=qE(t.focus.answers,DN(t.source,t.focus.startedAt),r),t.completedAt=e,Tn(t),he(e))},aD=(e,t=Date.now())=>{let r=Ve();if(!r.source||e!==void 0&&r.source!==e)return!1;let n=!!r.focus&&!r.summary;return n?(r.pausedFrom=r.source,r.pausedAt=t,Tn(r)):JE(t),r.source=null,n};Bm();var tf={};M(tf,{ETA_MAX_WEEKS:()=>SD,KEYWORD_RARITY:()=>GN,SPEED_BANDS:()=>zN,TIME_REF_MIN_MINUTES:()=>VN,WEEKLY_HIGHLIGHT_MIN_PEAK:()=>$N,WEEKLY_REPORT_MIN_DAYS:()=>OD,buildReferences:()=>qN,buildWeeklyReport:()=>Xd,formatDateCn:()=>LD,getGoalEta:()=>yD,getKeywordCandidates:()=>BN,getRollingSpeed:()=>RD,getSlotDistribution:()=>KN,getSpeedBand:()=>TD,getStreak:()=>ED,getWeekWindow:()=>So,getWeeklyHighlight:()=>PN,getWeeklyMetrics:()=>ef,getWeeklyRevisitWords:()=>HN,hashSeed:()=>XN,isWeekend:()=>FN,passesThreshold:()=>Yd,pickKeyword:()=>YN,reportPeriodStart:()=>uD,weekStartOf:()=>cD,windowDays:()=>UN});P();var qe=e=>{let t=e.getFullYear(),r=String(e.getMonth()+1).padStart(2,"0"),n=String(e.getDate()).padStart(2,"0");return`${t}-${r}-${n}`},dD=e=>`${qe(e)} ${String(e.getHours()).padStart(2,"0")}:${String(e.getMinutes()).padStart(2,"0")}`,Bd=(e,t,r=0)=>{let n=new Date(`${e}T00:00:00`);return n.setHours(t,r,0,0),n},ZE=e=>e instanceof Date?new Date(e):/^\d{4}-\d{2}-\d{2}$/.test(e)?Bd(e,12):new Date(e),Pd=(e,t)=>{if(typeof e=="number"&&Number.isFinite(e))return e;if(typeof e=="string"&&e.trim()){let o=Number(e);if(Number.isFinite(o)&&o>0)return o;let i=/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)$/.test(e)?`${e.replace(" ","T")}Z`:e.includes("T")?e:e.replace(" ","T"),a=new Date(i);if(Number.isFinite(a.getTime()))return a.getTime()}let r=String(t??""),n=/^\d{4}-\d{2}-\d{2}$/.test(r)?Bd(r,12):new Date(r);return Number.isFinite(n.getTime())?n.getTime():NaN},qt=e=>p("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",[e]).length>0,Kd=(e,t)=>{let r=new Date(e);return r.setDate(r.getDate()+t),r},uD=e=>{let t=new Date(e);return t.setHours(14,0,0,0),t.setDate(t.getDate()-t.getDay()),e<t.getTime()&&t.setDate(t.getDate()-7),`${qe(t)} 14:00`},lD=e=>{let t=ZE(e);if(!Number.isFinite(t.getTime()))return Bd(qe(new Date),14);let r=new Date(t);return r.setHours(14,0,0,0),r.setDate(r.getDate()-r.getDay()),t.getTime()<r.getTime()&&r.setDate(r.getDate()-7),r},xN=(e,t)=>{let r=Kd(e,t*7),n=Kd(r,-7);return{start:qe(n),end:qe(Kd(r,-1)),startAt:n.getTime(),endAt:r.getTime()}};function So(e=new Date,t=0){return xN(lD(e),t)}function cD(e){let t=ZE(e);return Number.isFinite(t.getTime())?(t.setDate(t.getDate()-t.getDay()),qe(t)):e}function UN(e){let t=[],r=Bd(e.start,0);for(let n=0;n<7;n+=1)t.push(qe(r)),r.setDate(r.getDate()+1);return t}var FN=e=>{let t=ZE(e).getDay();return t===0||t===6},yo=()=>{let e=[];if(qt("reviews")){let r=new Set(p("PRAGMA table_info(reviews)").map(n=>String(n.name??""))).has("event_source")?"event_source":"'legacy' AS event_source";for(let n of p(`SELECT id, word_id, answer, direction, reviewed_on, reviewed_at, created_at, ${r} FROM reviews`)){let o=Pd(n.reviewed_at??n.created_at,n.reviewed_on);e.push({kind:"word",id:`word:${String(n.id)}`,wordId:Number(n.word_id),answer:String(n.answer??""),direction:String(n.direction??"forward"),eventSource:String(n.event_source??"legacy"),day:String(n.reviewed_on??qe(new Date(o))),at:o})}}if(qt("grammar_reviews"))for(let t of p("SELECT id, grammar_id, answer, reviewed_on, created_at FROM grammar_reviews")){let r=Pd(t.created_at,t.reviewed_on);e.push({kind:"grammar",id:`grammar:${String(t.id)}`,grammarId:String(t.grammar_id),answer:String(t.answer??""),day:String(t.reviewed_on??qe(new Date(r))),at:r})}if(qt("grammar_activity_events"))for(let t of p("SELECT id, grammar_id, answer, activity_on, activity_at, created_at FROM grammar_activity_events")){let r=Pd(t.activity_at??t.created_at,t.activity_on);e.push({kind:"grammar",id:`grammar-activity:${String(t.id)}`,grammarId:String(t.grammar_id),answer:String(t.answer??"read"),day:String(t.activity_on??qe(new Date(r))),at:r})}if(qt("kanji_unit_reviews"))for(let t of p("SELECT id, unit_key, answer, reviewed_on, reviewed_at, created_at FROM kanji_unit_reviews")){let r=Pd(t.reviewed_at??t.created_at,t.reviewed_on);e.push({kind:"kanji",id:`kanji:${String(t.id)}`,answer:String(t.answer??""),day:String(t.reviewed_on??qe(new Date(r))),at:r})}return e.filter(t=>t.answer!=="known_forever").filter(t=>t.eventSource!=="bulk_complete").filter(t=>Number.isFinite(t.at))},Qs=(e,t)=>e.at>=t.startAt&&e.at<t.endAt,Gd=e=>{let t=new Date(e.at);return Number.isFinite(t.getTime())?qe(t):e.day},Hd=(e,t,r)=>e===r?t.start:e,WN=(e,t)=>{let r=new Set;for(let n of e)n.at<t&&r.add(Gd(n));return r},jN=(e,t)=>{let r=WN(e,t.endAt),n=0,o=new Date(t.endAt-1);for(;r.has(qe(o));)n+=1,o.setDate(o.getDate()-1);return n},mD=e=>{let t=new Map;for(let r of e){if(r.kind!=="word"||r.direction!=="forward"||r.wordId==null)continue;let n=t.get(r.wordId);(!n||r.at<n.at||r.at===n.at&&r.id<n.id)&&t.set(r.wordId,r)}return[...t.values()]},pD=e=>{if(qt("study_time_by_period")){let t=E("SELECT COALESCE(SUM(seconds), 0) FROM study_time_by_period WHERE period_start = ?",[dD(new Date(e.startAt))],0);if(t>0)return t}return qt("word_study_time")?E("SELECT COALESCE(SUM(seconds), 0) FROM word_study_time WHERE studied_on BETWEEN ? AND ?",[e.start,e.end],0):0};function ED(e=So()){return jN(yo(),e)}function ef(e){let t=yo(),r=t.filter(b=>Qs(b,e)),n=mD(t),o=n.filter(b=>Qs(b,e)),s=qe(new Date(e.endAt-1)),i=new Map;if(qt("word_study_time"))for(let b of p("SELECT studied_on, seconds FROM word_study_time WHERE studied_on BETWEEN ? AND ? AND seconds > 0",[e.start,s])){let k=Hd(String(b.studied_on),e,s);i.set(k,(i.get(k)??0)+Math.max(0,Number(b.seconds??0)))}let d=UN(e).map(b=>({date:b,reviews:r.filter(k=>Hd(Gd(k),e,s)===b).length,newWords:o.filter(k=>Hd(Gd(k),e,s)===b).length,seconds:i.get(b)??0})),u=r.filter(b=>b.kind==="word").length,l=r.filter(b=>b.kind==="grammar").length,c=r.filter(b=>b.kind==="kanji").length,f=r.length,m=Math.max(0,Math.round(pD(e))),g=new Set(r.map(b=>Hd(Gd(b),e,s))),S=new Set([...g,...i.keys()]),w=S.size>0?S.size:m>0?1:0,y=n.filter(b=>b.at<e.endAt).length,_=WN(t,e.endAt);if(qt("word_study_time"))for(let b of p("SELECT studied_on FROM word_study_time WHERE studied_on <= ? AND seconds > 0",[s]))_.add(String(b.studied_on));return{window:e,days:w,minutes:Math.round(m/60),totalSeconds:m,totalReviews:f,wordReviews:u,grammarReviews:l,kanjiReviews:c,newWords:o.length,reviewCount:Math.max(0,f-o.length),daily:d,streak:jN(t,e),cumulativeDays:Math.max(_.size,m>0?1:0),cumulativeWords:y}}var $N=2;function PN(e){let t=e.daily.filter(n=>n.reviews>0);if(t.length<2)return null;let r=t.reduce((n,o)=>o.reviews>n.reviews?o:n);return r.reviews<$N?null:{date:r.date,text:`${r.date} \u5B8C\u6210\u4E86 ${r.reviews} \u6B21\u5B66\u4E60\u8BB0\u5F55`}}function HN(e){let t=yo().filter(o=>Qs(o,e)),r=new Map;for(let o of t){if(o.kind!=="word"||o.direction!=="forward"||o.wordId==null||!["forgot","fuzzy"].includes(o.answer))continue;let s=r.get(o.wordId);r.set(o.wordId,{count:(s?.count??0)+1,latest:Math.max(s?.latest??0,o.at)})}if(!r.size||!qt("words"))return[];let n=new Map;for(let o of p("SELECT id, kanji, kana FROM words WHERE id IN ("+[...r.keys()].map(()=>"?").join(",")+")",[...r.keys()]))n.set(Number(o.id),String(o.kanji||o.kana||`\u8BCD\u6761 ${o.id}`));if(qt("custom_words"))for(let o of p("SELECT word_id, kanji, kana FROM custom_words WHERE word_id IN ("+[...r.keys()].map(()=>"?").join(",")+")",[...r.keys()]))n.set(Number(o.word_id),String(o.kanji||o.kana||`\u8BCD\u6761 ${o.word_id}`));return[...r.entries()].filter(([o])=>n.has(o)).map(([o,s])=>({wordId:o,text:n.get(o),count:s.count,latest:s.latest})).sort((o,s)=>s.count-o.count||s.latest-o.latest||o.wordId-s.wordId).slice(0,8).map(({wordId:o,text:s,count:i})=>({wordId:o,text:s,count:i}))}var fD=e=>e>=22||e<4?"deepNight":e<8?"earlyMorning":e<12?"morning":e<17?"afternoon":e<20?"dusk":"night";function KN(e){let t={deepNight:0,earlyMorning:0,morning:0,afternoon:0,dusk:0,night:0},r=0,n=0;for(let o of yo().filter(s=>Qs(s,e))){let s=new Date(o.at).getHours();t[fD(s)]+=1,r+=1,(s>=7&&s<9||s>=17&&s<19)&&(n+=1)}return{counts:t,total:r,commuteShare:r>0?n/r:0}}var gD=e=>{if(e.length<2)return Number.POSITIVE_INFINITY;let t=e.reduce((n,o)=>n+o,0)/e.length;if(t===0)return Number.POSITIVE_INFINITY;let r=e.reduce((n,o)=>n+(o-t)**2,0)/e.length;return Math.sqrt(r)/t},GN={\u590D\u4E60\u6D3E:2,\u94C1\u4EBA:2,\u5300\u901F\u524D\u8FDB:3,\u653B\u575A\u624B:3,\u591C\u884C\u8005:3,\u901A\u52E4\u515A:4,\u5F00\u8352\u8005:4,\u5468\u672B\u7A81\u51FB\u624B:4,\u65E9\u8D77\u9E1F:5,\u5355\u65E5\u7206\u53D1:5},_D=e=>{let t=null;for(let r of Object.keys(e))e[r]!==0&&(t===null||e[r]>e[t])&&(t=r);return t};function BN(e,t){let r=[],n=_D(t.counts);n==="deepNight"&&r.push("\u591C\u884C\u8005"),n==="earlyMorning"&&r.push("\u65E9\u8D77\u9E1F"),t.total>0&&t.commuteShare>=.35&&r.push("\u901A\u52E4\u515A");let o=e.daily.filter(a=>FN(a.date)).reduce((a,d)=>a+d.reviews,0);e.totalReviews>0&&o/e.totalReviews>=.4&&r.push("\u5468\u672B\u7A81\u51FB\u624B"),e.streak>=14&&r.push("\u94C1\u4EBA"),gD(e.daily.map(a=>a.newWords))<.3&&r.push("\u5300\u901F\u524D\u8FDB");let s=e.daily.filter(a=>a.newWords>0);if(s.length>0){let a=Math.max(...s.map(u=>u.newWords)),d=s.reduce((u,l)=>u+l.newWords,0)/s.length;d>0&&a/d>=3&&r.push("\u5355\u65E5\u7206\u53D1")}e.reviewCount>e.newWords&&r.push("\u590D\u4E60\u6D3E"),e.newWords>e.reviewCount&&r.push("\u5F00\u8352\u8005");let i=new Map;for(let a of yo().filter(d=>d.kind==="word"&&Qs(d,e.window)))a.wordId!=null&&i.set(a.wordId,(i.get(a.wordId)??0)+1);return[...i.values()].some(a=>a>=5)&&r.push("\u653B\u575A\u624B"),r.map(a=>({keyword:a,rarity:GN[a]??3}))}var XN=e=>{let t=2166136261;for(let r=0;r<e.length;r+=1)t^=e.charCodeAt(r),t=Math.imul(t,16777619);return t>>>0},wD=e=>{let t=e>>>0;return()=>{t=t+1831565813|0;let r=Math.imul(t^t>>>15,1|t);return r=r+Math.imul(r^r>>>7,61|r)^r,((r^r>>>14)>>>0)/4294967296}};function YN(e,t){if(e.length===0)return null;if(e.length===1)return e[0];let r=e.reduce((s,i)=>s+i.rarity,0),n=wD(XN(t))()*r,o=0;for(let s of e)if(o+=s.rarity,n<o)return s;return e[e.length-1]}var zN=[{level:4,threshold:100,label:"\u672C\u5468\u63A5\u89E6\u91CF\u5F88\u9AD8"},{level:3,threshold:64,label:"\u672C\u5468\u63A5\u89E6\u91CF\u5F88\u5145\u5B9E"},{level:2,threshold:43,label:"\u672C\u5468\u63A5\u89E6\u91CF\u7A33\u5B9A"},{level:1,threshold:22,label:"\u672C\u5468\u63A5\u89E6\u4E86\u4E0D\u5C11\u65B0\u8BCD"}];function TD(e){return zN.find(t=>e>=t.threshold)??null}var SD=104;function yD(){return null}var ND=()=>{let e=yo();return e.length?e.reduce((t,r)=>Math.min(t,r.at),Number.POSITIVE_INFINITY):Number.POSITIVE_INFINITY};function RD(e,t=4){let r=ND(),n=0,o=0,s=new Date(e.endAt);for(let i=0;i<t;i+=1){let a=xN(Kd(s,-i*7),0);a.endAt<=r||(n+=ef(a).newWords,o+=1)}return o>0?n/o:0}var VN=1,bD=e=>{let t=Math.floor(e/60),r=e%60;return t>0&&r>0?`${t} \u5C0F\u65F6 ${r} \u5206`:t>0?`${t} \u5C0F\u65F6`:`${r} \u5206\u949F`},LD=e=>{let t=e.split("-");return t.length===3?`${t[0]} \u5E74 ${Number(t[1])} \u6708 ${Number(t[2])} \u65E5`:e};function qN(e){let{metrics:t}=e,r=[];return t.totalSeconds>=60*VN&&r.push({kind:"time",text:`\u8FD9\u6BB5\u65F6\u95F4\u4F60\u6295\u5165\u4E86 ${bD(Math.floor(t.totalSeconds/60))}`}),t.totalReviews>0&&r.push({kind:"review",text:`\u8FD9\u6BB5\u65F6\u95F4\u4F60\u5B8C\u6210\u4E86 ${t.totalReviews} \u6B21\u5B66\u4E60`}),t.streak>0&&!(e.takenKeywords??[]).includes("\u94C1\u4EBA")&&r.push({kind:"streak",text:`\u4F60\u8FDE\u7EED ${t.streak} \u5929\u4E0E\u65E5\u8BED\u89C1\u9762`}),r}function Xd(e,t=0,r=new Date){let n=So(r,t),o=ef(n),s=KN(n),i=BN(o,s),a=YN(i,`${e}:${n.startAt}`);return{window:n,metrics:o,keyword:a,keywordCandidates:i,speedBand:null,eta:null,references:qN({metrics:o,speedBand:null,eta:null,takenKeywords:a?[a.keyword]:[]}),highlight:PN(o),revisitWords:HN(n)}}var OD=1,Yd=e=>e.totalReviews>0||e.totalSeconds>0;var nf={};M(nf,{WEEKLY_BACKFILL_MAX_WEEKS:()=>nR,WEEKLY_REPORT_SCHEMA_VERSION:()=>Zs,WEEKLY_REPORT_UPDATED_EVENT:()=>JN,backfillWeeklyReports:()=>DD,generateLatestWeeklyReport:()=>kD,generateWeeklyReport:()=>rR,getWeeklyReport:()=>qd,getWeeklyReportNotice:()=>MD,listWeeklyReports:()=>tR,markWeeklyReportRead:()=>vD,reportWindowLabel:()=>xD,reportWindowLabelCompact:()=>UD,saveWeeklyReport:()=>rf});var Sn=N($(),1);P();var Zs=3,JN="shushugo-weekly-report-updated",Vd=()=>{(0,Sn.getDatabase)().run(`
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
  `);let e=p("PRAGMA table_info(weekly_reports)").map(t=>String(t.name??""));e.includes("source_revision")||(0,Sn.getDatabase)().run("ALTER TABLE weekly_reports ADD COLUMN source_revision TEXT"),e.includes("sync_updated_at")||(0,Sn.getDatabase)().run("ALTER TABLE weekly_reports ADD COLUMN sync_updated_at TEXT"),e.includes("sync_origin_device")||(0,Sn.getDatabase)().run("ALTER TABLE weekly_reports ADD COLUMN sync_origin_device TEXT")},AD=()=>{let e=[],t=[["reviews","SELECT COUNT(*) count, COALESCE(MAX(id), 0) max_id, COALESCE(MAX(created_at), '') max_at FROM reviews"],["grammar_reviews","SELECT COUNT(*) count, COALESCE(MAX(id), 0) max_id, COALESCE(MAX(created_at), '') max_at FROM grammar_reviews"],["grammar_activity_events","SELECT COUNT(*) count, COALESCE(MAX(id), 0) max_id, COALESCE(MAX(created_at), '') max_at FROM grammar_activity_events"],["kanji_unit_reviews","SELECT COUNT(*) count, COALESCE(MAX(id), 0) max_id, COALESCE(MAX(created_at), '') max_at FROM kanji_unit_reviews"],["word_study_time","SELECT COUNT(*) count, COALESCE(SUM(seconds), 0) total FROM word_study_time"],["study_time_by_period","SELECT COUNT(*) count, COALESCE(SUM(seconds), 0) total FROM study_time_by_period"]];for(let[r,n]of t)try{let o=p("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",[r]).length?p(n)[0]:null;e.push(`${r}:${JSON.stringify(o??null)}`)}catch{e.push(`${r}:null`)}return e.join("|")},QN=e=>{try{let t=JSON.parse(String(e.content_json??"")),r=eR(t);return!r?.window?.start||!r?.metrics?null:{schemaVersion:Number(e.schema_version??Zs),generatedAt:Number(e.generated_at??0),readAt:e.read_at==null?null:Number(e.read_at),sourceRevision:e.source_revision==null?void 0:String(e.source_revision),report:r}}catch{return null}},ZN=e=>{let t=e.getFullYear(),r=String(e.getMonth()+1).padStart(2,"0"),n=String(e.getDate()).padStart(2,"0");return`${t}-${r}-${n}`},zd=e=>{let t=Number(e);return Number.isFinite(t)?t:0},hD=e=>{let r=(Array.isArray(e.metrics?.daily)?e.metrics.daily:[]).map(i=>({...i,date:String(i.date??""),reviews:zd(i.reviews),newWords:zd(i.newWords),seconds:zd(i.seconds)}));if(r.length<=7)return r;let n=ZN(new Date(e.window.endAt-1)),o=r.findIndex(i=>i.date===e.window.start),s=r.findIndex(i=>i.date===n&&i.date!==e.window.start);return o>=0&&s>=0&&(r[o]={...r[o],reviews:r[o].reviews+r[s].reviews,newWords:r[o].newWords+r[s].newWords,seconds:r[o].seconds+r[s].seconds},r.splice(s,1)),r.slice(0,7)},eR=e=>{let t=hD(e),r=zd(e.metrics?.days),n=e.highlight??null,o=ZN(new Date(e.window.endAt-1));return{...e,metrics:{...e.metrics,days:Math.min(Math.max(r,0),7),daily:t},highlight:n&&n.date===o?{...n,date:e.window.start}:n,revisitWords:e.revisitWords??[]}};function qd(e){Vd();let t=p("SELECT schema_version, generated_at, content_json, read_at, source_revision FROM weekly_reports WHERE week_start = ?",[e])[0];return t?QN(t):null}function tR(){return Vd(),p("SELECT schema_version, generated_at, content_json, read_at, source_revision FROM weekly_reports ORDER BY week_start DESC").flatMap(e=>{let t=QN(e);return t?[t]:[]})}function rf(e,t=Date.now()){Vd();let r=eR(e),o=qd(r.window.start)?.readAt??null,s=AD();return(0,Sn.getDatabase)().run(`
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
  `,[r.window.start,r.window.end,t,Zs,JSON.stringify(r),o,s,new Date().toISOString()]),typeof window<"u"&&window.dispatchEvent(new Event(JN)),{schemaVersion:Zs,generatedAt:t,readAt:o,sourceRevision:s,report:r}}function rR(e="local",t=0,r=new Date,n=!1){let o=So(r,t),s=qd(o.start);if(s&&s.schemaVersion>=Zs&&(!n||s.readAt!=null))return s;let i=Xd(e,t,r);return Yd(i.metrics)?rf(i):null}function kD(e="local",t=new Date,r=!1){return rR(e,0,t,r)}function vD(e,t=Date.now()){Vd();let r=p("SELECT read_at FROM weekly_reports WHERE week_start = ? LIMIT 1",[e])[0];return!r||r.read_at!=null?!1:((0,Sn.getDatabase)().run("UPDATE weekly_reports SET read_at = ?, sync_updated_at = ? WHERE week_start = ?",[t,new Date().toISOString(),e]),!0)}var nR=12,CD=3;function DD(e="local",t={}){let r=Math.max(1,Math.min(nR,t.maxWeeks??6)),n=t.now??new Date,o=0,s=0,i=0;for(let a=0;a<r;a+=1){let d=So(n,-a);if(s+=1,qd(d.start)){i=0;continue}let u=Xd(e,-a,n);if(!Yd(u.metrics)){if(i+=1,i>=CD)break;continue}rf(u),o+=1,i=0}return{generated:o,scanned:s,stoppedByLimit:s>=r}}var ID=600*60*1e3;function MD(e=new Date){let t=tR()[0]??null;if(!t)return{state:"none",weekStart:null};let r=t.report.window.start;if(t.readAt!=null)return{state:"read",weekStart:r};let n=t.report.window.endAt,o=e.getTime();return!Number.isFinite(n)||o<n?{state:"none",weekStart:r}:o>=n+ID?{state:"expired",weekStart:r}:{state:"new",weekStart:r}}var oR=e=>{let t=new Date(e.endAt);return`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`},xD=e=>{let t=r=>{let[,n,o]=r.split("-");return`${Number(n)} \u6708 ${Number(o)} \u65E5`};return`${t(e.start)} 14:00\u2014${t(oR(e))} 14:00`},UD=e=>{let t=r=>{let[,n,o]=r.split("-");return`${Number(n)}/${Number(o)}`};return`${t(e.start)}\u2014${t(oR(e))}`};Im();wt();id();xs();Rn();Se();var VD=N(CE());var sf={};M(sf,{ACHIEVEMENTS:()=>Hr,CATEGORY_ORDER:()=>sR,TIER_LABEL:()=>iR,achievementBoard:()=>GD,achievementSummary:()=>BD,evaluateAchievements:()=>KD,unlockedAchievementIds:()=>PD});var uR=N($(),1);P();G();var Hr=[{id:"first-know",name:"\u5F00\u5F20",description:"\u7B54\u5BF9\u7B2C\u4E00\u4E2A\u8BCD",category:"\u8D77\u6B65",tier:"common",goal:1,value:e=>e.totalKnow},{id:"first-note",name:"\u597D\u8BB0\u6027\u4E0D\u5982\u70C2\u7B14\u5934",description:"\u7ED9\u67D0\u4E2A\u8BCD\u5199\u4E0B\u7B2C\u4E00\u6761\u4FBF\u7B7E",category:"\u8D77\u6B65",tier:"common",goal:1,value:e=>e.notes},{id:"first-confusion",name:"\u660E\u5BDF\u79CB\u6BEB",description:"\u5728\u7591\u96BE\u8FA8\u6790\u91CC\u6807\u638C\u63E1\u7B2C\u4E00\u7EC4",category:"\u8D77\u6B65",tier:"common",goal:1,value:e=>e.confusionMastered},{id:"first-kanji",name:"\u8BA4\u5B57",description:"\u5F00\u59CB\u6C49\u5B57\u8BFB\u97F3\u6A21\u5F0F",category:"\u8D77\u6B65",tier:"common",goal:1,value:e=>e.kanjiWords},{id:"first-reverse",name:"\u53CD\u8FC7\u6765",description:"\u7528\u4E00\u6B21\u53CD\u5411\u6A21\u5F0F\uFF1A\u770B\u7740\u4E2D\u6587\u5199\u65E5\u8BED",category:"\u8D77\u6B65",tier:"common",goal:1,value:e=>e.reverseReviews},{id:"words-100",name:"\u767E\u8BCD\u65A9",description:"100 \u4E2A\u8BCD\u8FDB\u5165\u590D\u4E60",category:"\u91CC\u7A0B\u7891",tier:"common",goal:100,value:e=>e.distinctWords},{id:"words-1000",name:"\u5343\u8BCD\u65A9",description:"1,000 \u4E2A\u8BCD\u8FDB\u5165\u590D\u4E60",category:"\u91CC\u7A0B\u7891",tier:"common",goal:1e3,value:e=>e.distinctWords},{id:"words-3000",name:"\u4E09\u5343\u9662",description:"3,000 \u4E2A\u8BCD\u8FDB\u5165\u590D\u4E60",category:"\u91CC\u7A0B\u7891",tier:"rare",goal:3e3,value:e=>e.distinctWords},{id:"reviews-10000",name:"\u4E00\u4E07\u6B21",description:"\u7D2F\u8BA1\u4F5C\u7B54 10,000 \u6B21",category:"\u91CC\u7A0B\u7891",tier:"common",goal:1e4,value:e=>e.totalReviews},{id:"reviews-50000",name:"\u4E94\u4E07\u6B21",description:"\u7D2F\u8BA1\u4F5C\u7B54 50,000 \u6B21",category:"\u91CC\u7A0B\u7891",tier:"epic",goal:5e4,value:e=>e.totalReviews},{id:"mastered-10",name:"\u7B2C\u4E00\u6279\u6BD5\u4E1A\u751F",description:"10 \u4E2A\u8BCD\u7684\u590D\u4E60\u95F4\u9694\u62C9\u5230 180 \u5929\u4EE5\u4E0A",category:"\u91CC\u7A0B\u7891",tier:"common",goal:10,value:e=>e.masteredWords},{id:"mastered-100",name:"\u9000\u4F11\u540D\u5355",description:"100 \u4E2A\u8BCD\u7684\u590D\u4E60\u95F4\u9694\u62C9\u5230 180 \u5929\u4EE5\u4E0A",category:"\u91CC\u7A0B\u7891",tier:"rare",goal:100,value:e=>e.masteredWords},{id:"hours-100",name:"\u4E00\u767E\u5C0F\u65F6",description:"\u7D2F\u8BA1\u5B66\u4E60\u6EE1 100 \u5C0F\u65F6",category:"\u91CC\u7A0B\u7891",tier:"rare",goal:6e3,value:e=>e.minutesTotal},{id:"one-year",name:"\u4E00\u5468\u5E74",description:"\u4ECE\u7B2C\u4E00\u6B21\u5B66\u4E60\u90A3\u5929\u8D77\u6EE1 365 \u5929",category:"\u91CC\u7A0B\u7891",tier:"rare",goal:365,value:e=>e.daysSinceFirst},{id:"streak-7",name:"\u4E00\u5468\u4E0D\u65AD",description:"\u8FDE\u7EED 7 \u5929\u6709\u5B66\u4E60\u8BB0\u5F55",category:"\u6BC5\u529B",tier:"common",goal:7,value:e=>e.longestDayStreak},{id:"streak-30",name:"\u6EE1\u6708",description:"\u8FDE\u7EED 30 \u5929\u6709\u5B66\u4E60\u8BB0\u5F55",category:"\u6BC5\u529B",tier:"rare",goal:30,value:e=>e.longestDayStreak},{id:"streak-100",name:"\u767E\u65E5",description:"\u8FDE\u7EED 100 \u5929\u6709\u5B66\u4E60\u8BB0\u5F55",category:"\u6BC5\u529B",tier:"epic",goal:100,value:e=>e.longestDayStreak},{id:"comeback-7",name:"\u5F52\u961F",description:"\u65AD\u4E86\u4E00\u5468\u4EE5\u4E0A\uFF0C\u53C8\u56DE\u6765\u4E86",category:"\u6BC5\u529B",tier:"common",goal:7,value:e=>e.longestComebackGap},{id:"comeback-30",name:"\u4E45\u522B\u91CD\u9022",description:"\u65AD\u4E86\u4E00\u4E2A\u6708\u4EE5\u4E0A\uFF0C\u53C8\u56DE\u6765\u4E86",category:"\u6BC5\u529B",tier:"rare",hidden:!0,goal:30,value:e=>e.longestComebackGap},{id:"five-minutes",name:"\u4E94\u5206\u949F\u4E5F\u662F\u5B66",description:"\u6709\u4E00\u5929\u53EA\u5B66\u4E86\u4E0D\u5230\u4E94\u5206\u949F \u2014\u2014 \u4F46\u6CA1\u65AD",category:"\u6BC5\u529B",tier:"common",goal:1,value:e=>e.shortestStudyDayMinutes>0&&e.shortestStudyDayMinutes<5?1:0},{id:"day-1000",name:"\u4E00\u65E5\u5343\u8BCD",description:"\u5355\u65E5\u4F5C\u7B54 1,000 \u6B21",category:"\u6BC5\u529B",tier:"rare",goal:1e3,value:e=>e.maxReviewsInDay},{id:"marathon",name:"\u9A6C\u62C9\u677E",description:"\u5355\u65E5\u5B66\u4E60\u65F6\u957F\u6EE1 8 \u5C0F\u65F6",category:"\u6BC5\u529B",tier:"epic",goal:480,value:e=>e.maxMinutesInDay},{id:"know-streak-25",name:"\u987A\u98CE\u5C40",description:"\u8FDE\u7740\u7B54\u5BF9 25 \u6B21",category:"\u624B\u611F",tier:"common",goal:25,value:e=>e.longestKnowStreak},{id:"know-streak-50",name:"\u4E00\u6C14\u5475\u6210",description:"\u8FDE\u7740\u7B54\u5BF9 50 \u6B21",category:"\u624B\u611F",tier:"rare",goal:50,value:e=>e.longestKnowStreak},{id:"accuracy-90",name:"\u7A33\u5982\u8001\u72D7",description:"\u67D0\u5929\u7B54\u6EE1 100 \u6B21\uFF0C\u6B63\u786E\u7387\u8FD8\u6709\u4E5D\u6210",category:"\u624B\u611F",tier:"rare",goal:90,value:e=>Math.floor(e.bestDailyAccuracy*100)},{id:"known-forever-20",name:"\u65AD\u820D\u79BB",description:"\u4E00\u5929\u91CC\u70B9 20 \u6B21\u300C\u719F\u77E5\u300D\uFF0C\u628A\u8BCD\u8BF7\u51FA\u590D\u4E60\u961F\u5217",category:"\u624B\u611F",tier:"common",goal:20,value:e=>e.maxKnownForeverInDay},{id:"forgot-streak-10",name:"\u5148\u51B7\u9759",description:"\u8FDE\u7740\u70B9\u4E86 10 \u6B21\u300C\u5FD8\u8BB0\u300D\u3002\u559D\u53E3\u6C34\uFF0C\u8FD9\u4E0D\u602A\u4F60",category:"\u7FFB\u8F66",tier:"common",goal:10,value:e=>e.longestForgotStreak},{id:"forgot-streak-20",name:"\u518D\u51B7\u9759\u4E00\u70B9",description:"\u8FDE\u7740\u70B9\u4E86 20 \u6B21\u300C\u5FD8\u8BB0\u300D\u3002\u771F\u7684\uFF0C\u53BB\u7761\u5427",category:"\u7FFB\u8F66",tier:"rare",goal:20,value:e=>e.longestForgotStreak},{id:"leech-1",name:"\u8FD9\u8BCD\u8DDF\u6211\u6709\u4EC7",description:"\u6709\u4E00\u4E2A\u8BCD\u88AB\u4F60\u5FD8\u4E86\u6574\u6574 8 \u6B21",category:"\u7FFB\u8F66",tier:"common",goal:1,value:e=>e.leeches},{id:"leech-100",name:"\u4EC7\u4EBA\u540D\u5355",description:"100 \u4E2A\u8BCD\u5404\u88AB\u4F60\u5FD8\u4E86 8 \u6B21\u4EE5\u4E0A",category:"\u7FFB\u8F66",tier:"rare",goal:100,value:e=>e.leeches},{id:"relapse-forever",name:"\u6211\u660E\u660E\u80CC\u8FC7",description:"\u70B9\u8FC7\u300C\u719F\u77E5\u300D\u7684\u8BCD\uFF0C\u540E\u6765\u53C8\u5FD8\u4E86",category:"\u7FFB\u8F66",tier:"common",goal:1,value:e=>e.relapsedForever},{id:"fuzzy-half",name:"\u5047\u88C5\u5728\u5B66",description:"\u67D0\u5929\u7B54\u4E86 50 \u6B21\u4EE5\u4E0A\uFF0C\u4E00\u534A\u90FD\u70B9\u7684\u300C\u6A21\u7CCA\u300D",category:"\u7FFB\u8F66",tier:"common",goal:50,value:e=>Math.floor(e.worstDailyFuzzyShare*100)},{id:"thrice-a-day",name:"\u4E8C\u8FDB\u5BAB",description:"\u540C\u4E00\u4E2A\u8BCD\uFF0C\u5728\u540C\u4E00\u5929\u91CC\u88AB\u4F60\u5FD8\u4E86\u4E09\u6B21",category:"\u7FFB\u8F66",tier:"common",goal:1,value:e=>e.thriceForgotSameDay},{id:"backlog-500",name:"\u9E35\u9E1F",description:"\u5230\u671F\u6C60\u79EF\u538B\u5230 500 \u4E2A",category:"\u7FFB\u8F66",tier:"common",goal:500,value:e=>e.dueBacklog},{id:"backlog-1000",name:"\u503A\u53F0\u9AD8\u7B51",description:"\u5230\u671F\u6C60\u79EF\u538B\u5230 1,000 \u4E2A",category:"\u7FFB\u8F66",tier:"rare",goal:1e3,value:e=>e.dueBacklog},{id:"ghosted",name:"\u5931\u8054",description:"\u6574\u6574\u4E24\u5468\u6CA1\u6253\u5F00\u8FC7 \u2014\u2014 \u73B0\u5728\u56DE\u6765\u4E86\u5C31\u4E0D\u7B97\u6570\u4E86",category:"\u7FFB\u8F66",tier:"common",hidden:!0,goal:14,value:e=>e.longestComebackGap},{id:"night-100",name:"\u591C\u732B\u5B50",description:"\u534A\u591C 0 \u70B9\u5230 4 \u70B9\u4E4B\u95F4\u7B54\u8FC7 100 \u6B21",category:"\u602A\u7656",tier:"common",goal:100,value:e=>e.nightReviews},{id:"night-1000",name:"\u4E0E\u6708\u4EAE\u4E3A\u4F34",description:"\u534A\u591C 0 \u70B9\u5230 4 \u70B9\u4E4B\u95F4\u7B54\u8FC7 1,000 \u6B21",category:"\u602A\u7656",tier:"rare",goal:1e3,value:e=>e.nightReviews},{id:"early-50",name:"\u65E9\u8D77\u7684\u9E1F",description:"\u65E9\u4E0A 5 \u70B9\u5230 8 \u70B9\u4E4B\u95F4\u7B54\u8FC7 50 \u6B21",category:"\u602A\u7656",tier:"common",goal:50,value:e=>e.earlyReviews},{id:"day-and-night",name:"\u663C\u591C\u4E0D\u5206",description:"\u540C\u4E00\u5929\u91CC\uFF0C\u51CC\u6668\u4E09\u70B9\u548C\u65E9\u4E0A\u4E03\u70B9\u4F60\u90FD\u5728\u7B54\u9898",category:"\u602A\u7656",tier:"epic",hidden:!0,goal:1,value:e=>e.dayAndNight},{id:"burst",name:"\u624B\u901F",description:"\u540C\u4E00\u79D2\u91CC\u7B54\u6389\u4E86 5 \u5F20\u5361",category:"\u602A\u7656",tier:"common",hidden:!0,goal:5,value:e=>e.sameSecondBurst},{id:"new-year",name:"\u5143\u65E6\u4E5F\u5B66",description:"1 \u6708 1 \u65E5\u90A3\u5929\u4F60\u5728\u80CC\u5355\u8BCD",category:"\u602A\u7656",tier:"rare",hidden:!0,goal:1,value:e=>e.studiedOnNewYear},{id:"leap-day",name:"\u95F0\u65E5",description:"2 \u6708 29 \u65E5\u90A3\u5929\u4F60\u5728\u80CC\u5355\u8BCD\u3002\u4E0B\u6B21\u673A\u4F1A\u56DB\u5E74\u540E",category:"\u602A\u7656",tier:"epic",hidden:!0,goal:1,value:e=>e.studiedOnLeapDay},{id:"notes-50",name:"\u7B14\u8BB0\u72C2\u9B54",description:"\u5199\u4E0B 50 \u6761\u4FBF\u7B7E",category:"\u6DF1\u6316",tier:"rare",goal:50,value:e=>e.notes},{id:"confusion-100",name:"\u8FA8\u6790\u5927\u5E08",description:"\u5728\u7591\u96BE\u8FA8\u6790\u91CC\u6807\u638C\u63E1 100 \u7EC4",category:"\u6DF1\u6316",tier:"rare",goal:100,value:e=>e.confusionMastered},{id:"favorites-50",name:"\u6536\u85CF\u5BB6",description:"\u6536\u85CF 50 \u4E2A\u8BCD",category:"\u6DF1\u6316",tier:"common",goal:50,value:e=>e.favorites},{id:"all-three",name:"\u5168\u5BB6\u6876",description:"\u5355\u8BCD\u3001\u6C49\u5B57\u3001\u8BED\u6CD5\u4E09\u6761\u7EBF\u90FD\u5F00\u8FC7",category:"\u6DF1\u6316",tier:"rare",goal:3,value:e=>(e.distinctWords>0?1:0)+(e.kanjiWords>0?1:0)+(e.grammarPoints>0?1:0)}],sR=["\u8D77\u6B65","\u91CC\u7A0B\u7891","\u6BC5\u529B","\u624B\u611F","\u7FFB\u8F66","\u602A\u7656","\u6DF1\u6316"],iR={common:"\u5E38\u89C4",rare:"\u7A00\u6709",epic:"\u53F2\u8BD7"};P();Re();var FD=e=>{try{return p(e)}catch{return[]}},z=(e,t=[])=>{try{return Number(E(e,t,0)??0)}catch{return 0}},WD=()=>{let e=-new Date().getTimezoneOffset();return`${e>=0?"+":"-"}${Math.abs(e)} minutes`},aR=e=>z(`
  WITH ordered AS (SELECT answer, ROW_NUMBER() OVER (ORDER BY id) AS rn FROM reviews),
  grouped AS (
    SELECT answer, rn - ROW_NUMBER() OVER (PARTITION BY answer ORDER BY rn) AS island
    FROM ordered
  )
  SELECT COALESCE(MAX(runs.streak), 0) FROM (
    SELECT COUNT(*) AS streak FROM grouped WHERE answer = ? GROUP BY island
  ) AS runs
`,[e]),jD=()=>{let e=FD(`
    SELECT day FROM (
      SELECT DISTINCT reviewed_on AS day FROM reviews
      UNION
      SELECT studied_on AS day FROM word_study_time WHERE seconds > 0
    ) WHERE day IS NOT NULL AND day <> '' ORDER BY day
  `).map(o=>String(o.day)),t=e.length?1:0,r=e.length?1:0,n=0;for(let o=1;o<e.length;o+=1){let s=Date.parse(`${e[o-1]}T00:00:00Z`),i=Math.round((Date.parse(`${e[o]}T00:00:00Z`)-s)/864e5);i===1?(r+=1,t=Math.max(t,r)):(r=1,n=Math.max(n,i-1))}return{longest:t,longestGap:n}},$D=e=>{let t=new Map,r={};return Object.keys(e).forEach(n=>{Object.defineProperty(r,n,{enumerable:!0,get:()=>(t.has(n)||t.set(n,e[n]()),t.get(n))})}),r},of=()=>{let t=`CAST(strftime('%H', datetime(created_at, '${WD()}')) AS INTEGER)`,r=null,n=()=>r??(r=jD());return $D({totalReviews:()=>z("SELECT COUNT(*) FROM reviews"),totalKnow:()=>z("SELECT COUNT(*) FROM reviews WHERE answer IN ('know','known_forever')"),knownForeverTotal:()=>z("SELECT COUNT(*) FROM reviews WHERE answer = 'known_forever'"),distinctWords:()=>z("SELECT COUNT(DISTINCT word_id) FROM reviews"),longestKnowStreak:()=>aR("know"),longestForgotStreak:()=>aR("forgot"),studyDays:()=>z(`
      SELECT COUNT(*) FROM (
        SELECT reviewed_on AS day FROM reviews
        UNION
        SELECT studied_on FROM word_study_time WHERE seconds > 0
      )
    `),longestDayStreak:()=>n().longest,longestComebackGap:()=>n().longestGap,nightReviews:()=>z(`SELECT COUNT(*) FROM reviews WHERE ${t} BETWEEN 0 AND 3`),earlyReviews:()=>z(`SELECT COUNT(*) FROM reviews WHERE ${t} BETWEEN 5 AND 7`),maxReviewsInDay:()=>z("SELECT COALESCE(MAX(n),0) FROM (SELECT COUNT(*) AS n FROM reviews GROUP BY reviewed_on)"),maxMinutesInDay:()=>z("SELECT COALESCE(MAX(seconds),0)/60 FROM word_study_time"),minutesTotal:()=>z("SELECT COALESCE(SUM(seconds),0)/60 FROM word_study_time"),shortestStudyDayMinutes:()=>z(`
      SELECT COALESCE(MIN(seconds), 0)/60 FROM word_study_time WHERE seconds > 0
    `),bestDailyAccuracy:()=>z(`
      SELECT COALESCE(MAX(rate), 0) FROM (
        SELECT SUM(CASE WHEN answer IN ('know','known_forever') THEN 1.0 ELSE 0 END) / COUNT(*) AS rate
        FROM reviews GROUP BY reviewed_on HAVING COUNT(*) >= 100
      )
    `),worstDailyFuzzyShare:()=>z(`
      SELECT COALESCE(MAX(share), 0) FROM (
        SELECT SUM(CASE WHEN answer = 'fuzzy' THEN 1.0 ELSE 0 END) / COUNT(*) AS share
        FROM reviews GROUP BY reviewed_on HAVING COUNT(*) >= 50
      )
    `),maxKnownForeverInDay:()=>z(`
      SELECT COALESCE(MAX(n), 0) FROM (
        SELECT COUNT(*) AS n FROM reviews WHERE answer = 'known_forever' GROUP BY reviewed_on
      )
    `),masteredWords:()=>z(`
      SELECT COUNT(*) FROM progress
      WHERE fsrs_due IS NOT NULL AND fsrs_last_review IS NOT NULL
        AND julianday(fsrs_due) - julianday(fsrs_last_review) >= 180
    `),leeches:()=>z("SELECT COUNT(*) FROM progress WHERE COALESCE(fsrs_lapses, 0) >= 8"),relapsedForever:()=>z(`
      SELECT COUNT(*) FROM (
        SELECT word_id FROM reviews WHERE answer = 'known_forever'
        INTERSECT
        SELECT word_id FROM reviews WHERE answer = 'forgot'
          AND id > (SELECT MIN(id) FROM reviews r2 WHERE r2.word_id = reviews.word_id AND r2.answer = 'known_forever')
      )
    `),thriceForgotSameDay:()=>z(`
      SELECT COUNT(*) FROM (
        SELECT word_id FROM reviews WHERE answer = 'forgot'
        GROUP BY word_id, reviewed_on HAVING COUNT(*) >= 3
      )
    `),dueBacklog:()=>z(`SELECT COUNT(*) FROM progress WHERE fsrs_due IS NOT NULL AND date(fsrs_due) <= date('now','localtime')
      AND ${te("words","progress.word_id")}`),notes:()=>z("SELECT COUNT(*) FROM word_notes WHERE TRIM(note) <> ''"),confusionMastered:()=>z("SELECT COUNT(*) FROM confusion_mastered"),favorites:()=>z("SELECT COUNT(*) FROM content_favorites"),reverseReviews:()=>z("SELECT COUNT(*) FROM reviews WHERE direction <> 'forward'"),kanjiWords:()=>z("SELECT COUNT(*) FROM kanji_reading_memory WHERE seen_count > 0"),grammarPoints:()=>z("SELECT COUNT(*) FROM grammar_progress"),daysSinceFirst:()=>z(`
      SELECT COALESCE(CAST(julianday('now','localtime') - julianday(MIN(reviewed_on)) AS INTEGER), 0) FROM reviews
    `),studiedOnNewYear:()=>z("SELECT COUNT(*) FROM reviews WHERE strftime('%m-%d', reviewed_on) = '01-01'"),studiedOnLeapDay:()=>z("SELECT COUNT(*) FROM reviews WHERE strftime('%m-%d', reviewed_on) = '02-29'"),sameSecondBurst:()=>z(`
      SELECT COALESCE(MAX(n), 0) FROM (
        SELECT COUNT(*) AS n FROM reviews GROUP BY created_at
      )
    `),dayAndNight:()=>z(`
      SELECT COUNT(*) FROM (
        SELECT reviewed_on FROM reviews
        GROUP BY reviewed_on
        HAVING SUM(CASE WHEN ${t} = 3 THEN 1 ELSE 0 END) > 0
           AND SUM(CASE WHEN ${t} = 7 THEN 1 ELSE 0 END) > 0
      )
    `)})};var Jd=()=>{V();let e=new Map;return p("SELECT id, unlocked_on FROM achievements").forEach(t=>{e.set(String(t.id??""),String(t.unlocked_on??""))}),e},PD=()=>new Set(Jd().keys()),dR=0,HD=6e4,lR=(e,t)=>{let r=Hr.filter(i=>!t.has(i.id));if(!r.length)return[];let n=r.filter(i=>i.value(e)>=i.goal);if(!n.length)return[];let o=(0,uR.getDatabase)(),s=new Date().toLocaleDateString("sv");return n.forEach(i=>{o.run("INSERT OR IGNORE INTO achievements (id, unlocked_on) VALUES (?, ?)",[i.id,s]),t.set(i.id,s)}),D(),n},KD=(e={})=>{let t=Date.now();return!e.force&&t-dR<HD?[]:(dR=t,lR(of(),Jd()))},GD=()=>{let e=Jd(),t=of();return lR(t,e),{items:Hr.map(n=>{let o=Math.max(0,Math.min(n.goal,Math.floor(n.value(t))));return{...n,unlocked:e.has(n.id),unlockedOn:e.get(n.id)??null,progress:o}}),unlocked:e.size,total:Hr.length}},BD=()=>{let e=Jd(),t=new Map(Hr.map(n=>[n.id,n])),r=[...e.entries()].sort((n,o)=>o[1].localeCompare(n[1])).map(([n])=>t.get(n)).filter(n=>!!n).slice(0,3);return{unlocked:e.size,total:Hr.length,recent:r}};Lt();var af={};M(af,{studyTotals:()=>XD});P();var XD=()=>{let e=E("SELECT SUM(seconds) FROM word_study_time",[],0)??0,t=E(`
    SELECT COUNT(*) FROM (
      SELECT studied_on AS day FROM word_study_time WHERE seconds > 0
      UNION
      SELECT reviewed_on AS day FROM reviews
    )
  `,[],0)??0;return{minutes:Math.floor(e/60),days:t}};
