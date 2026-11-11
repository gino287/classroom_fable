/*
 * app.js — 管狀態、載入資料、處理點擊和鍵盤、播放、簡報模式、自我測試
 *
 * 出處表
 * - 資料：data/lectures_real.json（真實，24 堂課）＋ data/sim/index.json（列出有哪些模擬結果檔）
 * - 狀態都放在 App.S，並同步到網址的 # 後面（例如 #school=e&lec=1&tab=compare），
 *   所以重新整理不會跑掉，也可以把某個畫面的網址存起來 demo 用
 * - 自我測試：網址加 #selftest 會把 24 堂課 × 2 步 × 3 分頁全部畫一次，結果顯示在頁面上
 */
const SCHOOLS = { e: "elementary school", h: "high school" };
const SCHOOL_ZH = { e: "小學版", h: "高中版" };
const TABS = [["replay", "① 上課回放"], ["compare", "② 課後測：模擬 vs 真實"], ["heat", "③ 卡點熱圖"]];
const SPEEDS = [1, 2, 4];
const $ = id => document.getElementById(id);

const App = {
  // S = 目前畫面的全部狀態。slide 是「第幾張」的索引（從 0 開始），不是 slide_id
  S: { school: "e", lec: 1, tab: "replay", slide: 0, step: 1, student: null, playing: false, speed: 1, sort: "qid", showPre: false, present: false, pstep: 0 },
  real: [], index: [], cache: {},
  lec: null, sim: null, sim1: null, sum: null, hasStep2: false,
  timer: null,

  async getJSON(path) {
    if (!App.cache[path]) {
      const res = await fetch(path);
      if (!res.ok) throw new Error(`讀不到 ${path}（HTTP ${res.status}）`);
      App.cache[path] = await res.json();
    }
    return App.cache[path];
  },

  // 找某堂課某一步的模擬結果檔。同一堂課有多個來源時，不是 MOCK 的優先（之後放真的結果就會自動蓋過假資料）
  findSim(school, lec, step) {
    const hits = App.index.filter(x => x.school === school && x.lecture_id === lec && (x.step || 1) === step);
    return hits.find(x => x.source !== "MOCK") || hits[0];
  },

  // 換課或換步驟時呼叫：載入資料、算總結
  async load() {
    const S = App.S, school = SCHOOLS[S.school];
    App.lec = App.real.find(l => l.school === school && l.lecture_id === S.lec);
    if (!App.lec) throw new Error(`lectures_real.json 裡沒有 ${school} 第 ${S.lec} 堂`);
    const e1 = App.findSim(school, S.lec, 1), e2 = App.findSim(school, S.lec, 2);
    if (!e1) throw new Error(`data/sim/index.json 裡沒有 ${school} 第 ${S.lec} 堂的模擬結果`);
    App.hasStep2 = !!e2;
    if (S.step === 2 && !e2) S.step = 1;
    App.sim1 = await App.getJSON(e1.file);
    App.sim = S.step === 2 ? await App.getJSON(e2.file) : App.sim1;
    App.sum = Stats.summary(App.lec, App.sim);
    S.slide = Math.max(0, Math.min(S.slide, App.lec.slides.length - 1));
    if (S.student && !App.sim.students.some(x => x.sid === S.student)) S.student = null;
  },

  render() {
    const S = App.S, mock = String(App.sim.source).toUpperCase().includes("MOCK");
    $("schoolSeg").innerHTML = Object.keys(SCHOOLS).map(k =>
      `<button class="${S.school === k ? "on" : ""}" data-act="school" data-v="${k}">${SCHOOL_ZH[k]}</button>`).join("");
    const lecIds = App.real.filter(l => l.school === SCHOOLS[S.school]).map(l => l.lecture_id).sort((a, b) => a - b);
    $("lecBtns").innerHTML = `<span class="muted">第</span>` + lecIds.map(i =>
      `<button class="${S.lec === i ? "on" : ""}" data-act="lec" data-v="${i}">${i}</button>`).join("") + `<span class="muted">堂</span>`;
    $("sourceBadge").className = mock ? "mock-badge" : "mock-badge realsim";
    $("sourceBadge").textContent = mock ? "MOCK 示意資料：AI 學生的部分是公式編的，不是模擬結果" : `模擬來源：${App.sim.source}`;
    $("summary").innerHTML = Views.summary();
    $("tabs").innerHTML = TABS.map(([k, name]) => `<button class="${S.tab === k ? "on" : ""}" data-act="tab" data-v="${k}">${name}</button>`).join("");
    $("view").innerHTML = Views[S.tab]();
    $("drawer").innerHTML = Views.drawer();
    $("drawer").classList.toggle("open", !!S.student);
    document.body.classList.toggle("present", S.present);
    document.body.classList.toggle("is-mock", mock);
    App.renderPresent();
    App.saveHash();
    $("tooltip").hidden = true;
  },

  // ---------- 網址 # 狀態 ----------
  saveHash() {
    const S = App.S, p = new URLSearchParams({ school: S.school, lec: S.lec, tab: S.tab, slide: App.lec.slides[S.slide].id, step: S.step });
    if (S.student) p.set("student", S.student);
    if (S.showPre) p.set("pre", 1);
    if (S.sort === "hard") p.set("sort", "hard");
    if (S.present) p.set("present", S.pstep + 1);
    history.replaceState(null, "", "#" + p);
  },
  readHash() {
    const p = new URLSearchParams(location.hash.slice(1)), S = App.S;
    if (SCHOOLS[p.get("school")]) S.school = p.get("school");
    if (+p.get("lec")) S.lec = +p.get("lec");
    if (TABS.some(t => t[0] === p.get("tab"))) S.tab = p.get("tab");
    if (+p.get("step") === 2) S.step = 2;
    S.student = p.get("student");
    S.showPre = p.has("pre");
    if (p.get("sort") === "hard") S.sort = "hard";
    if (+p.get("present")) { S.present = true; S.pstep = +p.get("present") - 1; }
    return +p.get("slide") || 1;   // slide_id，等資料載入後再換成索引
  },
  slideIndex(id) {
    const i = App.lec.slides.findIndex(s => s.id === +id);
    return i < 0 ? 0 : i;
  },

  // ---------- 播放 ----------
  setPlaying(on) {
    App.S.playing = on;
    clearInterval(App.timer);
    if (on) App.timer = setInterval(() => {
      if (App.S.slide >= App.lec.slides.length - 1) return App.setPlaying(false), App.render();
      App.S.slide++; App.render();
    }, 1800 / App.S.speed);
  },

  // ---------- 簡報模式：一步一步走，每步換畫面＋一句大字說明 ----------
  presentSteps() {
    const { lec, sim, sum } = App;
    const states = Stats.slideStates(sim);
    const simTop = Stats.topK(Object.fromEntries(Object.entries(states).map(([k, v]) => [k, v.stuck])), 1)[0];
    const hardest = lec.questions.find(q => q.qid === sum.hardReal[0]);
    const mock = document.body.classList.contains("is-mock") ? "（目前是 MOCK 假資料）" : "";
    return [
      { text: `這是一堂真實上過的課：${SCHOOL_ZH[App.S.school]}第 ${lec.lecture_id} 堂，${lec.slides.length} 張投影片。${sim.students.length} 位 AI 學生準備上課${mock}。`,
        go: S => { S.tab = "replay"; S.slide = 0; S.student = null; } },
      { text: "一張一張上課。每張投影片，AI 學生會說自己懂、困惑、還是卡住——這是 AI 的說法，沒辦法驗證。",
        go: S => { S.tab = "replay"; S.slide = 0; }, play: true },
      { text: `模擬說：投影片 ${simTop} 最多人沒聽懂（${Math.round(states[simTop].stuck * 100)}%）。`,
        go: S => { S.tab = "replay"; S.slide = App.slideIndex(simTop); } },
      { text: `可以驗證的是課後測。真實學生最難的是 Q${hardest.qid}（只有 ${Math.round(hardest.real.post_rate * 100)}% 答對），來自投影片 ${hardest.slide_id}。`,
        go: S => { S.tab = "compare"; S.sort = "qid"; S.step = 1; } },
      { text: `模擬跟真實像不像？這堂課：${sum.verdict}${sum.corr === null ? "" : `（r = ${sum.corr.toFixed(2)}）`}，最難 ${sum.k} 題抓到 ${sum.hit} 題。`,
        go: S => { S.tab = "compare"; S.sort = "hard"; } },
      { text: "把每張投影片排開：藍色是模擬的卡點，橘色是真實的答錯率。兩排深色的位置對得上，模擬才有用。",
        go: S => { S.tab = "heat"; } },
    ];
  },
  async gotoPresent(i) {
    const steps = App.presentSteps(), S = App.S;
    S.pstep = Math.max(0, Math.min(i, steps.length - 1));
    App.setPlaying(false);
    steps[S.pstep].go(S);
    await App.load();
    if (steps[S.pstep].play) App.setPlaying(true);
    App.render();
  },
  renderPresent() {
    const bar = $("presentBar"), S = App.S;
    bar.hidden = !S.present;
    if (!S.present) return;
    const steps = App.presentSteps();
    bar.innerHTML = `
      <button class="btn" data-act="p-prev" ${S.pstep === 0 ? "disabled" : ""}>← 上一步</button>
      <div class="p-text"><span class="p-n">${S.pstep + 1} / ${steps.length}</span>${steps[S.pstep].text}</div>
      <button class="btn primary" data-act="p-next" ${S.pstep === steps.length - 1 ? "disabled" : ""}>下一步 →</button>
      <button class="btn" data-act="p-exit" title="離開簡報模式（Esc）">離開</button>`;
  },

  // ---------- 所有點擊都走這裡（事件委派：只在 body 綁一次，靠 data-act 分辨）----------
  async act(act, v) {
    const S = App.S;
    let reload = false;
    switch (act) {
      case "school": S.school = v; S.slide = 0; S.student = null; reload = true; App.setPlaying(false); break;
      case "lec": S.lec = +v; S.slide = 0; S.student = null; reload = true; App.setPlaying(false); break;
      case "tab": S.tab = v; if (v !== "replay") App.setPlaying(false); break;
      case "slide": S.slide = App.slideIndex(v); S.tab = "replay"; App.setPlaying(false); break;
      case "goto-q": S.tab = "compare"; App.setPlaying(false); break;
      case "student": S.student = S.student === v ? null : v; break;
      case "student-at": { const [sid, id] = v.split("|"); S.student = sid; S.slide = App.slideIndex(id); break; }
      case "close": S.student = null; break;
      case "prev": S.slide = Math.max(0, S.slide - 1); App.setPlaying(false); break;
      case "next": S.slide = Math.min(App.lec.slides.length - 1, S.slide + 1); App.setPlaying(false); break;
      case "play":
        if (!S.playing && S.slide >= App.lec.slides.length - 1) S.slide = 0;   // 已經播到最後就從頭
        App.setPlaying(!S.playing); break;
      case "speed": S.speed = SPEEDS[(SPEEDS.indexOf(S.speed) + 1) % SPEEDS.length]; if (S.playing) App.setPlaying(true); break;
      case "step": S.step = +v; reload = true; break;
      case "sort": S.sort = S.sort === "hard" ? "qid" : "hard"; break;
      case "pre": S.showPre = !S.showPre; break;
      case "present": S.present = true; return App.gotoPresent(0);
      case "p-next": return App.gotoPresent(S.pstep + 1);
      case "p-prev": return App.gotoPresent(S.pstep - 1);
      case "p-exit": S.present = false; App.setPlaying(false); break;
    }
    if (reload) await App.load();
    App.render();
  },

  fail(err) {
    console.error(err);
    $("view").innerHTML = `<div class="card error"><b>載入失敗</b><p>${esc(err.message)}</p>
      <p>請確認是用 start.bat（或 python -m http.server）啟動，不是直接雙擊 index.html。</p></div>`;
  },

  async init() {
    document.body.addEventListener("click", e => {
      const el = e.target.closest("[data-act]");
      if (el && !el.disabled) App.act(el.dataset.act, el.dataset.v).catch(App.fail);
    });
    $("presentBtn").dataset.act = "present";
    document.addEventListener("keydown", e => {
      if (e.target.matches("input,textarea,select")) return;
      const S = App.S, k = e.key;
      const map = S.present
        ? { ArrowRight: "p-next", " ": "p-next", PageDown: "p-next", ArrowLeft: "p-prev", PageUp: "p-prev", Escape: "p-exit" }
        : { ArrowRight: "next", ArrowLeft: "prev", " ": "play", Escape: "close", p: "present", P: "present" };
      if (map[k]) { e.preventDefault(); App.act(map[k]).catch(App.fail); }
    });
    // 提示框：滑鼠移到有 data-tip 的元素上就顯示
    const tip = $("tooltip");
    document.body.addEventListener("mousemove", e => {
      const el = e.target.closest("[data-tip]");
      if (!el) return void (tip.hidden = true);
      tip.textContent = el.dataset.tip;
      tip.hidden = false;
      const w = tip.offsetWidth, h = tip.offsetHeight;
      tip.style.left = Math.min(window.innerWidth - w - 8, e.clientX + 14) + "px";
      tip.style.top = (e.clientY + 18 + h > window.innerHeight ? e.clientY - h - 10 : e.clientY + 18) + "px";
    });

    try {
      [App.real, App.index] = await Promise.all([App.getJSON("data/lectures_real.json"), App.getJSON("data/sim/index.json")]);
      if (location.hash === "#selftest") return App.selftest();
      const slideId = App.readHash();
      await App.load();
      App.S.slide = App.slideIndex(slideId);
      App.render();
    } catch (err) { App.fail(err); }
  },

  // ---------- 自我測試：每堂課、每一步、每個分頁都畫一次，再點幾個東西 ----------
  async selftest() {
    const log = [], S = App.S;
    let bad = 0;
    for (const lec of App.real) {
      for (const step of [1, 2]) {
        const name = `${lec.school} L${lec.lecture_id} step${step}`;
        try {
          Object.assign(S, { school: lec.school.startsWith("e") ? "e" : "h", lec: lec.lecture_id, step, slide: 0, student: null, present: false });
          await App.load();
          if (S.step !== step) throw new Error("沒有這一步的模擬檔");
          const r = App.sum.corr === null ? "n/a" : App.sum.corr.toFixed(2);   // 先記下來，後面的簡報模式會切回第 1 步
          for (const [tab] of TABS) { S.tab = tab; App.render(); if (!$("view").children.length) throw new Error(tab + " 是空的"); }
          // 資料一致性：每個學生都有每張投影片的狀態和每題的答案
          for (const st of App.sim.students) {
            if (st.slides.length !== lec.slides.length) throw new Error(`${st.sid} 的投影片數不對`);
            if (st.answers.length !== lec.questions.length) throw new Error(`${st.sid} 的答案數不對`);
          }
          await App.act("slide", lec.slides[lec.slides.length - 1].id);
          await App.act("student", App.sim.students[0].sid);
          if (!$("drawer").querySelector(".ans tbody tr")) throw new Error("學生面板沒有作答表");
          await App.act("tab", "compare"); await App.act("pre"); await App.act("sort"); await App.act("pre"); await App.act("sort");
          await App.act("present"); for (let i = 0; i < 6; i++) await App.act("p-next"); await App.act("p-exit");
          if (!document.querySelector(".mock-badge").textContent.includes("MOCK")) throw new Error("沒有 MOCK 標示");
          log.push(`PASS ${name}  r=${r}`);
        } catch (err) { bad++; log.push(`FAIL ${name}: ${err.message}`); }
      }
    }
    App.setPlaying(false);
    document.body.innerHTML = `<pre id="selftest">SELFTEST ${bad ? "FAILED" : "OK"}：${log.length - bad} / ${log.length} 通過\n${log.join("\n")}</pre>`;
  },
};

App.init();
