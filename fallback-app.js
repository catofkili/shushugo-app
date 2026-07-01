(function () {
  const root = document.querySelector("#root");
  const data = [
    ["wa", "は", "N5", "提示主题：至于……", "名词 + は", "私は学生です。", "我是学生。"],
    ["ga", "が", "N5", "提示主语或新信息", "名词 + が", "雨が降っています。", "正在下雨。"],
    ["wo", "を", "N5", "提示动作对象", "名词 + を + 动词", "水を飲みます。", "喝水。"],
    ["ni", "に", "N5", "时间、目的地、存在位置", "时间/地点 + に", "七時に学校へ行きます。", "七点去学校。"],
    ["de", "で", "N5", "动作地点、工具、方式", "地点/工具 + で", "図書館で勉強します。", "在图书馆学习。"],
    ["no", "の", "N5", "所属或修饰", "名词 + の + 名词", "これは私の本です。", "这是我的书。"],
    ["desu", "です", "N5", "礼貌判断：是……", "名词/な形容词 + です", "今日は休みです。", "今天休息。"],
    ["masu", "ます", "N5", "动词礼貌现在/将来", "动词ます形", "毎日日本語を勉強します。", "每天学习日语。"],
    ["masen", "ません", "N5", "动词礼貌否定", "动词词干 + ません", "今日は行きません。", "今天不去。"],
    ["mashita", "ました", "N5", "动词礼貌过去", "动词词干 + ました", "昨日映画を見ました。", "昨天看了电影。"],
    ["masendeshita", "ませんでした", "N5", "动词礼貌过去否定", "动词词干 + ませんでした", "昨日は勉強しませんでした。", "昨天没有学习。"],
    ["iadj", "い形～", "N5", "い形容词", "い形容词 + 名词", "この本は面白いです。", "这本书很有趣。"],
    ["nadj", "な形～", "N5", "な形容词", "な形容词 + な + 名词", "静かな部屋です。", "安静的房间。"],
    ["te", "て-形", "N5", "连接动作、请求、状态", "动词て形", "朝ご飯を食べて、学校へ行きます。", "吃早饭，然后去学校。"],
    ["nai", "ない形", "N5", "动词普通否定形", "动词ない形", "今日は肉を食べない。", "今天不吃肉。"],
    ["ta", "た形", "N5", "动词普通过去形", "动词た形", "昨日ラーメンを食べた。", "昨天吃了拉面。"],
    ["tai", "たい", "N5", "想做……", "动词词干 + たい", "日本へ行きたいです。", "想去日本。"],
    ["teiru", "ている", "N5", "正在做；状态持续", "て形 + いる", "猫が寝ています。", "猫正在睡觉。"],
    ["temoii", "てもいい", "N5", "可以……；允许……", "て形 + もいい", "写真を撮ってもいいですか。", "可以拍照吗？"],
    ["nakereba", "なければならない", "N5", "必须……；不得不……", "ない形 + ければならない", "宿題をしなければなりません。", "必须做作业。"]
  ].map(([id, title, level, meaning, structure, japanese, chinese]) => ({
    id,
    title,
    level,
    meaning,
    structure,
    japanese,
    chinese,
    quiz: `「${title}」是什么意思？`,
    answer: meaning
  }));

  const comparisons = [
    ["は vs が", "は提示话题，が提示主语或新信息。", "私は学生です。 / 誰が来ましたか。"],
    ["に vs で", "に偏落点，で偏动作发生的现场。", "学校にいます。 / 学校で勉強します。"],
    ["へ vs に", "へ强调方向，に强调到达点。", "日本へ行きます。 / 日本に着きました。"],
    ["ている vs てある", "ている表示持续状态，てある暗示人为准备后的结果。", "窓が開いています。 / 窓が開けてあります。"],
    ["そう vs よう vs らしい", "そう偏外观或听说，よう偏比喻推测，らしい偏典型或传闻。", "雨が降りそうです。 / 夢のようです。"],
    ["ば vs たら vs なら vs と", "ば偏一般条件，たら偏发生后，なら承接话题，と偏自然结果。", "安ければ買います。 / 春になると暖かくなります。"]
  ];

  const state = {
    page: "dashboard",
    selected: data[0].id,
    quizIndex: 0,
    answerText: "",
    notice: ""
  };

  const read = (key, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(key)) || fallback;
    } catch {
      return fallback;
    }
  };
  const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const learned = () => read("fallback-learned", []);
  const reviews = () => read("fallback-reviews", []);
  const mistakes = () => read("fallback-mistakes", []);

  function setPage(page) {
    state.page = page;
    render();
  }

  function notify(message) {
    state.notice = message;
    render();
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => {
      state.notice = "";
      render();
    }, 1600);
  }

  function markLearned(id) {
    const next = Array.from(new Set([...learned(), id]));
    write("fallback-learned", next);
    notify("已标记为掌握，并保存到本地进度。");
  }

  function addReview(id) {
    const next = Array.from(new Set([...reviews(), id]));
    write("fallback-reviews", next);
    notify("已加入复习队列。");
  }

  function addMistake(item) {
    write("fallback-mistakes", [{ id: Date.now(), ...item }, ...mistakes()]);
  }

  function removeMistake(id) {
    write("fallback-mistakes", mistakes().filter((item) => item.id !== id));
    render();
  }

  function shell(content) {
    root.innerHTML = `
      <main class="fallback-shell">
        <nav class="fallback-nav">
          <div class="fallback-brand"><span class="fallback-logo">文</span><span>Grammar Trainer<br><small class="muted">static local mode</small></span></div>
          <div class="fallback-tabs">
            ${["dashboard", "library", "quiz", "review", "mistakes", "compare"].map((page) => `<button class="${state.page === page ? "active" : ""}" data-page="${page}">${page}</button>`).join("")}
          </div>
        </nav>
        ${content}
        ${state.notice ? `<div class="toast">${state.notice}</div>` : ""}
      </main>
    `;
    root.querySelectorAll("[data-page]").forEach((button) => button.addEventListener("click", () => setPage(button.dataset.page)));
  }

  function tile(point) {
    const status = learned().includes(point.id) ? "learned" : reviews().includes(point.id) ? "review" : "new";
    const markLabel = status === "learned" ? "Learned" : "Mark";
    return `<article class="grammar-tile">
      <div><span class="fallback-kicker">${point.level} · ${status}</span><div class="grammar-title jp">${point.title}</div></div>
      <div><strong>${point.meaning}</strong><br><span class="muted jp">${point.structure}</span></div>
      <div class="tile-actions">
        <button class="secondary-btn" data-open="${point.id}">Study</button>
        <button class="primary-btn" data-learn="${point.id}">${markLabel}</button>
      </div>
    </article>`;
  }

  function dashboard() {
    const learnedCount = learned().length;
    shell(`
      <section class="hero-grid">
        <div class="fallback-card">
          <p class="fallback-kicker">Daily training</p>
          <h1>今天用 10 分钟，把语法变成手感。</h1>
          <p class="muted">看小卡片、例句、比较和测验。进度、复习和错题会存在 localStorage。</p>
          <button class="primary-btn" data-page="review">Start 10-minute session</button>
        </div>
        <div class="stat-grid">
          <div class="fallback-card"><h2>${data.length - learnedCount}</h2><p class="muted">New</p></div>
          <div class="fallback-card"><h2>${reviews().length}</h2><p class="muted">Review</p></div>
          <div class="fallback-card"><h2>${mistakes().length}</h2><p class="muted">Mistakes</p></div>
        </div>
      </section>
      <h2>Today”s grammar</h2>
      <section class="grammar-grid">${data.filter((p) => !learned().includes(p.id)).slice(0, 4).map(tile).join("")}</section>
    `);
  }

  function library() {
    shell(`
      <section class="fallback-card">
        <input id="search" placeholder="Search title, meaning, structure">
      </section>
      <section class="grammar-grid" id="list">${data.map(tile).join("")}</section>
    `);
    const list = root.querySelector("#list");
    root.querySelector("#search").addEventListener("input", (event) => {
      const q = event.target.value.toLowerCase();
      list.innerHTML = data.filter((p) => `${p.title} ${p.meaning} ${p.structure}`.toLowerCase().includes(q)).map(tile).join("");
      bindActions();
    });
  }

  function detail() {
    const point = data.find((p) => p.id === state.selected) || data[0];
    shell(`
      <section class="fallback-card">
        <p class="fallback-kicker">${point.level}</p>
        <h1 class="grammar-title jp">${point.title}</h1>
        <h2>${point.meaning}</h2>
        <p class="chip jp">${point.structure}</p>
        <div class="example"><p class="jp">${point.japanese}</p><p>${point.chinese}</p></div>
        <p class="muted">拆句提示：点击例句词块可在完整版里看更细的词义。当前是无需 npm 的静态模式。</p>
        <button class="primary-btn" data-learn="${point.id}">Mark as learned</button>
        <button class="secondary-btn" data-review="${point.id}">Add to review</button>
      </section>
    `);
  }

  function quiz() {
    const point = data[state.quizIndex % data.length];
    shell(`
      <section class="fallback-card">
        <p class="fallback-kicker">Quiz · ${point.title}</p>
        <h1>${point.quiz}</h1>
        <div class="形-grid">
          <button class="secondary-btn" data-choice="${point.answer}">${point.answer}</button>
          <button class="secondary-btn" data-choice="表示强烈命令">表示强烈命令</button>
        </div>
        <div id="answer"></div>
        <button class="primary-btn" id="nextQuiz">Next</button>
      </section>
    `);
    root.querySelectorAll("[data-choice]").forEach((button) => {
      button.addEventListener("click", () => {
        const ok = button.dataset.choice === point.answer;
        if (!ok) addMistake({ grammar: point.title, user: button.dataset.choice, correct: point.answer, explanation: point.structure });
        root.querySelector("#answer").innerHTML = `<div class="answer ${ok ? "ok" : "bad"}">${ok ? "答对了" : `正确答案：${point.answer}`} · ${point.structure}</div>`;
      });
    });
    root.querySelector("#nextQuiz").addEventListener("click", () => {
      state.quizIndex += 1;
      render();
    });
  }

  function review() {
    const queue = reviews().map((id) => data.find((p) => p.id === id)).filter(Boolean);
    if (!queue.length) {
      shell(`<section class="fallback-card"><h1>Review clear</h1><p class="muted">还没有复习项目，去 Library 添加几个。</p></section>`);
      return;
    }
    const point = queue[0];
    shell(`
      <section class="fallback-card">
        <p class="fallback-kicker">Review</p>
        <h1 class="grammar-title jp">${point.title}</h1>
        <p>${point.meaning}</p>
        <div class="example"><p class="jp">${point.japanese}</p><p>${point.chinese}</p></div>
        <button class="secondary-btn" id="wrong">Wrong</button>
        <button class="primary-btn" id="right">Correct</button>
      </section>
    `);
    root.querySelector("#right").addEventListener("click", () => {
      write("fallback-reviews", reviews().filter((id) => id !== point.id));
      markLearned(point.id);
    });
    root.querySelector("#wrong").addEventListener("click", () => {
      addMistake({ grammar: point.title, user: "复习时答错", correct: point.meaning, explanation: point.structure });
      render();
    });
  }

  function mistakeBook() {
    shell(`
      <section class="fallback-card"><h1>错误本</h1><p class="muted">答错的题会存在这里。</p></section>
      <section class="grammar-grid">
        ${mistakes().map((m) => `<article class="fallback-card"><h3 class="jp">${m.grammar}</h3><p>你的答案：${m.user}</p><p>正确答案：${m.correct}</p><p class="muted">${m.explanation}</p><button class="secondary-btn" data-remove="${m.id}">Remove after retry</button></article>`).join("") || `<div class="fallback-card">还没有错题。</div>`}
      </section>
    `);
  }

  function compare() {
    shell(`
      <section class="grammar-grid">
        ${comparisons.map(([title, text, example]) => `<article class="fallback-card"><p class="fallback-kicker">${title}</p><h2>${text}</h2><p class="jp muted">${example}</p></article>`).join("")}
      </section>
    `);
  }

  function bindOpen() {
    root.querySelectorAll("[data-open]").forEach((button) => button.addEventListener("click", () => {
      state.selected = button.dataset.open;
      setPage("detail");
    }));
  }

  function bindActions() {
    bindOpen();
    root.querySelectorAll("[data-learn]").forEach((button) => button.addEventListener("click", () => markLearned(button.dataset.learn)));
    root.querySelectorAll("[data-review]").forEach((button) => button.addEventListener("click", () => addReview(button.dataset.review)));
    root.querySelectorAll("[data-remove]").forEach((button) => button.addEventListener("click", () => removeMistake(Number(button.dataset.remove))));
  }

  function render() {
    if (state.page === "dashboard") dashboard();
    if (state.page === "library") library();
    if (state.page === "detail") detail();
    if (state.page === "quiz") quiz();
    if (state.page === "review") review();
    if (state.page === "mistakes") mistakeBook();
    if (state.page === "compare") compare();
    bindActions();
  }

  window.addEventListener("error", (event) => {
    if (String(event.filename || "").includes("/src/main.tsx")) {
      render();
    }
  });

  setTimeout(() => {
    const text = root.textContent || "";
    if (text.includes("正在加载学习应用")) render();
  }, 600);
})();
