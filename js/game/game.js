/*
 * game.js — 觀眾版（game.html）的主程式：狀態、載入資料、右側面板、時間軸、旁白、播放、自我測試
 *
 * 出處表
 * - 這是第二種前端：給一般觀眾看的「像素教室」。研究員版（index.html ＋ js/app.js、views.js）完全沒動
 * - 讀的資料跟研究員版一模一樣：data/lectures_real.json ＋ data/sim/index.json ＋ data/sim/*.json
 * - 算數字共用 js/stats.js（兩個版本的數字一定一致）；畫場景用 js/game/scene.js、sprites.js
 * - 一堂課被排成一條「時間軸」G.steps：每張投影片一步 → 課後測每題一步 → 最後一步成績單
 *   S.pos 是現在在第幾步。場景、右側面板、旁白都只看「現在這一步」，所以每個畫面只講一件事
 * - 狀態同步到網址 # 後面（例如 #school=e&lec=1&at=s8、at=q3、at=report），可以存書籤
 * - 只呈現第 1 步的模擬（課前預測）。「第 2 步：看到小測驗後更新」留在研究員版（理由見 decision_log 決定 18）
 * - 自我測試：game.html#selftest
 */
const SCHOOLS = { e: "elementary school", h: "high school" };
const SCHOOL_ZH = { e: "小學版", h: "高中版" };
const STATE = { understood: { zh: "懂", face: "happy" }, confused: { zh: "困惑", face: "confused" }, lost: { zh: "卡住", face: "lost" } };
const LEVEL_ZH = { low: "較弱", average: "普通", high: "較好" };
const PRIOR_ZH = { none: "沒學過", some: "學過一點", strong: "學過不少" };
const SPEEDS = [1, 2, 4];
const DWELL = { slide: 4200, q: 5200 };   // 播放時每一步停多久（毫秒，1× 速度）

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = x => Math.round(x * 100) + "%";
const icon = (kind, w, h, sid = "") => `<canvas class="ico" data-icon="${kind}" data-sid="${sid}" width="${w}" height="${h}"></canvas>`;

// 投影片文字是「標題. 重點. 重點.」接起來的，拆開來排成標題＋條列比較像投影片
function splitSlide(text) {
  const parts = text.split(/\.\s+/).map(s => s.trim().replace(/\.$/, "")).filter(Boolean);
  if (parts.length > 1 && parts[0].length <= 70) return { title: parts[0], points: parts.slice(1) };
  return { title: "", points: [text] };
}
// 題目文字長這樣：「題幹 <please select the best answer> A. xxx B. yyy」，拆成題幹和選項
function splitQuestion(text) {
  const [stem, rest = ""] = text.split(/<please[^>]*>/);
  const opts = rest.trim().split(/\s+(?=[A-H]\.\s)/).filter(o => /^[A-H]\.\s/.test(o)).map(o => ({ key: o[0], text: o.slice(2).trim() }));
  return { stem: stem.trim(), opts };
}

const G = {
  S: { school: "e", lec: 1, pos: 0, student: null, playing: false, speed: 1, help: false },
  real: [], index: [], cache: {},
  lec: null, sim: null, sum: null, states: null, steps: [], by: {}, order: [], heat: null, simTop: null,
  timer: null, spotN: 0,

  async getJSON(path) {
    if (!G.cache[path]) {
      const res = await fetch(path);
      if (!res.ok) throw new Error(`讀不到 ${path}（HTTP ${res.status}）`);
      G.cache[path] = await res.json();
    }
    return G.cache[path];
  },
  // 跟研究員版同一個規則：同一堂課有多個來源時，不是 MOCK 的優先
  findSim(school, lec) {
    const hits = G.index.filter(x => x.school === school && x.lecture_id === lec && (x.step || 1) === 1);
    return hits.find(x => x.source !== "MOCK") || hits[0];
  },
  isMock: () => String(G.sim.source).toUpperCase().includes("MOCK"),
  mockTag: () => G.isMock() ? `<span class="tag mock">MOCK</span>` : "",
  cur: () => G.steps[G.S.pos],

  // 換課時呼叫：載入資料、把常用的東西先算好
  async load(intro) {
    const S = G.S, school = SCHOOLS[S.school];
    G.lec = G.real.find(l => l.school === school && l.lecture_id === S.lec);
    if (!G.lec) throw new Error(`lectures_real.json 裡沒有 ${school} 第 ${S.lec} 堂`);
    const entry = G.findSim(school, S.lec);
    if (!entry) throw new Error(`data/sim/index.json 裡沒有 ${school} 第 ${S.lec} 堂的模擬結果`);
    const { lec } = G, sim = G.sim = await G.getJSON(entry.file);
    G.sum = Stats.summary(lec, sim);
    G.states = Stats.slideStates(sim);
    G.simTop = Stats.topK(Object.fromEntries(Object.entries(G.states).map(([k, v]) => [k, v.stuck])), 1)[0];
    G.steps = [...lec.slides.map(slide => ({ kind: "slide", slide })), ...lec.questions.map(q => ({ kind: "q", q })), { kind: "report" }];
    // 每個學生：用 slide_id、qid 查得到的表，還有答對幾題
    G.by = {};
    for (const st of sim.students) G.by[st.sid] = {
      slides: Object.fromEntries(st.slides.map(x => [x.slide_id, x])),
      answers: Object.fromEntries(st.answers.map(a => [a.qid, a])),
      score: st.answers.reduce((s, a) => s + a.correct, 0),
    };
    // 座位：把學生打散排（跟研究員版同一個排法；n 是 5 的倍數時這招會重複，就照原順序）
    const n = sim.students.length;
    G.order = n % 5 ? sim.students.map((_, i) => sim.students[(i * 5) % n]) : [...sim.students];
    // 最卡的投影片：只在「有題目的投影片」裡比，模擬和真實才是比同一批（decision_log 決定 7）
    const realWrong = Stats.realSlideWrong(lec), k = Math.min(3, Object.keys(realWrong).length);
    const realTop = Stats.topK(Object.fromEntries(Object.entries(realWrong).map(([id, v]) => [id, v.wrong])), k);
    const simTop = Stats.topK(Object.fromEntries(Object.keys(realWrong).map(id => [id, G.states[id] ? G.states[id].stuck : 0])), k);
    G.heat = { k, realTop, simTop, both: realTop.filter(x => simTop.includes(x)).length };
    S.pos = Math.max(0, Math.min(S.pos, G.steps.length - 1));
    if (S.student && !G.by[S.student]) S.student = null;
    Scene.setClass(G.order.map(st => st.sid), intro);
  },

  // ---------- 畫面 ----------
  render() {
    const S = G.S, step = G.cur(), mock = G.isMock();
    $("schoolSeg").innerHTML = Object.keys(SCHOOLS).map(k =>
      `<button class="${S.school === k ? "on" : ""}" data-act="school" data-v="${k}">${SCHOOL_ZH[k]}</button>`).join("");
    const lecIds = G.real.filter(l => l.school === SCHOOLS[S.school]).map(l => l.lecture_id).sort((a, b) => a - b);
    $("lecPick").innerHTML = `<span>第</span>` + lecIds.map(i =>
      `<button class="${S.lec === i ? "on" : ""}" data-act="lec" data-v="${i}">${i}</button>`).join("") + `<span>堂</span>`;
    $("sourceBadge").className = mock ? "mock-badge" : "mock-badge realsim";
    $("sourceBadge").textContent = mock ? "MOCK 示意資料：AI 學生是公式編的，不是模擬結果" : `模擬來源：${G.sim.source}`;
    // 「研究員版」的連結直接開到同一堂課、對應的分頁
    const tab = step.kind === "slide" ? `tab=replay&slide=${step.slide.id}` : "tab=compare";
    $("proLink").href = `index.html#school=${S.school}&lec=${S.lec}&${tab}`;

    $("side").innerHTML = step.kind === "slide" ? G.sideSlide(step) : step.kind === "q" ? G.sideQ(step) : G.sideReport();
    $("legend").innerHTML = G.legend(step);
    $("dialog").innerHTML = `<span class="speaker">旁白</span><span>${G.narration(step)}</span>`;
    $("timeline").innerHTML = G.timeline();
    $("help").hidden = !S.help;
    if (S.help) $("help").innerHTML = G.helpHTML();
    Scene.sel = S.student;
    Scene.show(step.kind, G.actorViews(step));
    G.renderOverlay();
    G.drawIcons();
    G.saveHash();
    $("tooltip").hidden = true;
  },
  drawIcons() {
    document.querySelectorAll("canvas[data-icon]").forEach(c => Sprites.icon(c, c.dataset.icon, c.dataset.sid));
  },

  // 這一步每個學生在場景裡要演什麼
  actorViews(step) {
    const out = {};
    for (const st of G.sim.students) {
      const info = G.by[st.sid];
      if (step.kind === "slide") out[st.sid] = { state: (info.slides[step.slide.id] || { state: "understood" }).state };
      else if (step.kind === "q") out[st.sid] = { mark: info.answers[step.q.qid] ? info.answers[step.q.qid].correct : null };
      else out[st.sid] = { score: info.score };
    }
    return out;
  },

  // ---------- 場景上的泡泡：一次只顯示一位學生的話，畫面才乾淨 ----------
  // 輪流的名單：上課時先卡住的、再困惑的；考試時是答錯的。都沒有就拿前兩位
  spotList(step) {
    if (step.kind === "report") return [];
    const rank = { lost: 0, confused: 1, understood: 2 };
    let list;
    if (step.kind === "slide") {
      list = G.order.map(st => ({ sid: st.sid, x: G.by[st.sid].slides[step.slide.id] })).filter(o => o.x && o.x.thought);
      const bad = list.filter(o => o.x.state !== "understood").sort((a, b) => rank[a.x.state] - rank[b.x.state]);
      return (bad.length ? bad : list.slice(0, 2)).map(o => o.sid);
    }
    list = G.order.map(st => ({ sid: st.sid, a: G.by[st.sid].answers[step.q.qid] })).filter(o => o.a && o.a.reason);
    const wrong = list.filter(o => !o.a.correct);
    return (wrong.length ? wrong : list.slice(0, 2)).map(o => o.sid);
  },
  renderOverlay() {
    const step = G.cur(), S = G.S, list = G.spotList(step);
    const sid = S.student || list[G.spotN % (list.length || 1)];
    const a = sid && Scene.actor(sid), info = sid && G.by[sid];
    let html = "";
    if (a && a.seated && step.kind !== "report") {
      let cls, text;
      if (step.kind === "slide") { const x = info.slides[step.slide.id]; if (x) { cls = x.state; text = x.thought; } }
      else { const ans = info.answers[step.q.qid]; if (ans) { cls = ans.correct ? "understood" : "lost"; text = ans.reason; } }
      if (text) {
        // 泡泡放在學生頭上；太靠左右邊時往中間推，免得超出畫面
        const left = Math.max(22, Math.min(78, a.sx / Scene.W * 100)), top = (a.sy - 33) / Scene.H * 100;
        html = `<button class="bubble ${cls}" style="left:${left}%;top:${top}%" data-act="student" data-v="${sid}">
          <span class="b-who">${sid}${step.kind === "slide" ? " 心裡想" : " 說他的理由"}<span class="tag ai">AI 說法</span></span>${esc(text)}</button>`;
      }
    }
    if (!Scene.introDone()) html += `<button class="skip" data-act="skip">跳過進場 ▶▶</button>`;
    $("overlay").innerHTML = html + `<span class="nametag" id="nametag" hidden></span>`;
  },

  // ---------- 圖例：場景正下方，永遠看得到；內容跟著現在是上課還是考試換 ----------
  legend(step) {
    const ai = `<span class="lg"><i class="lg-dash"></i>虛線＝AI 學生自己說的，<b>無法驗證</b></span>`;
    if (step.kind === "slide") return `
      <span class="lg">${icon("happy", 16, 14)}懂</span>
      <span class="lg">${icon("q", 16, 18)}困惑</span>
      <span class="lg">${icon("swirl", 16, 18)}卡住（完全跟不上）</span>
      <span class="lg">${icon("bulb", 16, 18)}剛想通</span>${ai}`;
    if (step.kind === "q") return `
      <span class="lg">${icon("ok", 16, 16)}答對</span>
      <span class="lg">${icon("ng", 16, 16)}答錯</span>
      <span class="lg"><i class="lg-solid"></i>實心＝作答結果，<b>可以跟真實班對照</b></span>${ai}`;
    return `<span class="lg">${icon("7", 16, 16)}牌子上的數字＝這位學生答對幾題（共 ${G.lec.questions.length} 題）</span>
      <span class="lg">點學生可以看他的整張考卷</span>`;
  },

  narration(step) {
    const { sum, lec } = G;
    if (step.kind === "slide") {
      const id = step.slide.id, o = G.states[id] || { understood: 0, confused: 0, lost: 0 }, t = splitSlide(step.slide.text).title;
      const head = `老師講到第 ${id} 張${t ? `「${esc(t)}」` : ""}。`;
      const mood = o.confused + o.lost === 0 ? "全班都說聽懂了。"
        : `${o.understood} 位說聽懂，<b class="c-confused">${o.confused} 位困惑</b>，<b class="c-lost">${o.lost} 位卡住</b>。`;
      return head + mood + (id === G.simTop ? `<span class="chip hot">模擬裡全班最卡的一張</span>` : "");
    }
    if (step.kind === "q") {
      const q = step.q, s = sum.simRate[q.qid] ?? 0, r = q.real.post_rate, d = Math.round((s - r) * 100);
      const say = Math.abs(d) < 10 ? "兩班差不多" : d > 0 ? "模擬班太樂觀" : "模擬班太悲觀";
      return `課後測第 ${q.qid} 題：<b class="c-sim">模擬班 ${pct(s)} 答對</b>，<b class="c-real">真實班 ${pct(r)} 答對</b>——${say}。`;
    }
    return `下課！${lec.questions.length} 題考完了。這堂課模擬班跟真實班「<b>${sum.verdict}</b>」。點學生可以看他的考卷。`;
  },

  // ---------- 右側：上課中 ----------
  sideSlide(step) {
    const { lec } = G, slide = step.slide, { title, points } = splitSlide(slide.text);
    const o = G.states[slide.id] || { understood: 0, confused: 0, lost: 0, n: 1 };
    const qs = lec.questions.filter(q => q.slide_id === slide.id);
    const foot = qs.length
      ? `這張課後會考：` + qs.map(q => `<button class="link" data-act="q" data-v="${q.qid}">第 ${q.qid} 題</button>`).join("、")
      : `這張課後沒有出題（所以沒有真實資料可以對照）`;
    const meter = ["understood", "confused", "lost"].map(k =>
      `<div class="m-cell ${k}">${icon(STATE[k].face, 16, 14)}<b>${o[k]}</b><span>${STATE[k].zh}</span></div>`).join("");
    const bar = ["understood", "confused", "lost"].map(k => `<i class="${k}" style="width:${o[k] / o.n * 100}%"></i>`).join("");
    return `
      <section class="panel board">
        <div class="panel-h">投影幕<span class="count">第 ${G.S.pos + 1} / ${lec.slides.length} 張</span><span class="tag real">真實教材</span></div>
        <div class="screen">
          ${title ? `<h2>${esc(title)}</h2>` : ""}
          ${title ? `<ul>${points.map(p => `<li>${esc(p)}</li>`).join("")}</ul>` : `<p>${esc(points[0])}</p>`}
        </div>
        <div class="panel-f">${foot}</div>
      </section>
      <section class="panel mood">
        <div class="panel-h">全班現在<span class="tag ai">AI 說法・無法驗證</span>${G.mockTag()}</div>
        <div class="meter">${meter}</div>
        <div class="stack">${bar}</div>
      </section>
      ${G.studentCard(step)}`;
  },

  // ---------- 右側：課後測 ----------
  sideQ(step) {
    const { lec, sum, sim } = G, q = step.q, { stem, opts } = splitQuestion(q.text);
    const s = sum.simRate[q.qid] ?? 0, r = q.real.post_rate, d = Math.round((s - r) * 100);
    const [lo, hi] = Stats.wilson(r, q.real.n_post);
    const nRight = sim.students.filter(st => (G.by[st.sid].answers[q.qid] || {}).correct).length;
    const body = opts.length
      ? `<ul class="opts">${opts.map(o => `<li class="${o.key === q.answer ? "right" : ""}"><b>${o.key}</b>${esc(o.text)}${o.key === q.answer ? `<span class="chip good">正解</span>` : ""}</li>`).join("")}</ul>`
      : `<div class="fill">填答題　<span class="chip good">正解</span> ${esc(q.answer)}</div>`;
    const hardRank = sum.hardReal.indexOf(q.qid);
    const chips = [];
    if (hardRank >= 0) chips.push(`<span class="chip hot">真實班第 ${hardRank + 1} 難的題目</span>`);
    if (q.real.pre_rate !== null && q.real.post_rate < q.real.pre_rate)
      chips.push(`<span class="chip bad" data-tip="真實班上課前 ${pct(q.real.pre_rate)} 答對，上完課剩 ${pct(r)}。">真實班上完課反而變差（${pct(q.real.pre_rate)} → ${pct(r)}）</span>`);
    if (q.real.n_post < 8) chips.push(`<span class="chip bad">⚠ 真實班只有 ${q.real.n_post} 人作答，數字很不穩</span>`);
    const verdict = Math.abs(d) < 10 ? `兩班差不多（差 ${Math.abs(d)} 個百分點）`
      : `模擬班${d > 0 ? "高" : "低"}了 ${Math.abs(d)} 個百分點——${d > 0 ? "太樂觀" : "太悲觀"}`;
    return `
      <section class="panel board">
        <div class="panel-h">課後測<span class="count">第 ${lec.questions.indexOf(q) + 1} / ${lec.questions.length} 題</span><span class="tag real">真實題目</span></div>
        <div class="screen quiz"><h2>Q${q.qid}　${esc(stem)}</h2>${body}</div>
        <div class="panel-f">這題考的是 <button class="link" data-act="slide" data-v="${q.slide_id}">第 ${q.slide_id} 張投影片</button>（原始資料的標記）</div>
      </section>
      <section class="panel vs">
        <div class="panel-h">這題全班答對率<span class="tag solid">可驗證</span></div>
        <div class="vs-row"><span class="who sim">模擬班</span>${G.mockTag()}
          <div class="vs-track"><i class="sim" style="width:${s * 100}%"></i></div><b>${pct(s)}</b><small>${nRight} / ${sim.students.length} 人</small></div>
        <div class="vs-row" data-tip="真實班 ${q.real.n_post} 人作答。淡色那一段是 95% 區間（${pct(lo)}–${pct(hi)}）：人越少、範圍越寬、數字越不可靠。"><span class="who real">真實班</span>
          <div class="vs-track"><u style="left:${lo * 100}%;width:${(hi - lo) * 100}%"></u><i class="real" style="width:${r * 100}%"></i></div><b>${pct(r)}</b><small>${q.real.n_post} 人作答</small></div>
        <div class="vs-say ${Math.abs(d) < 10 ? "good" : Math.abs(d) >= 20 ? "bad" : ""}">${verdict}</div>
        <div class="chips">${chips.join("")}</div>
      </section>
      ${G.studentCard(step)}`;
  },

  // ---------- 右側下方：選中的學生（小卡）----------
  studentCard(step) {
    const S = G.S, st = G.sim.students.find(x => x.sid === S.student);
    if (!st) return `<section class="panel hintcard">${icon("avatar", 18, 24, G.order[0].sid)}
      <div><b>點教室裡的一位學生</b><br>看他是誰、這一刻在想什麼。</div></section>`;
    const info = G.by[st.sid], p = st.persona || {};
    let now = "";
    if (step.kind === "slide") {
      const x = info.slides[step.slide.id];
      if (x) now = `<div class="think ${x.state}"><span class="b-who"><span class="pill ${x.state}">${STATE[x.state].zh}</span>這張他心裡想<span class="tag ai">AI 說法</span></span>${esc(x.thought)}</div>`;
    } else {
      const a = info.answers[step.q.qid];
      if (a) now = `<div class="ansline"><span class="pill ${a.correct ? "ok" : "ng"}">${a.correct ? "○ 答對" : "✕ 答錯"}</span>他答：<b>${esc(a.answer ?? "（沒作答）")}</b><span class="tag solid">可驗證</span></div>
        <div class="think"><span class="b-who">他說的理由<span class="tag ai">AI 說法</span></span>${esc(a.reason || "")}</div>`;
    }
    const cur = step.kind === "slide" ? step.slide.id : null;
    const strip = G.lec.slides.map(s => {
      const x = info.slides[s.id] || { state: "understood", thought: "" };
      return `<button class="cell ${x.state} ${s.id === cur ? "cur" : ""}" data-act="slide" data-v="${s.id}"
        data-tip="第 ${s.id} 張：${STATE[x.state].zh}｜「${esc(x.thought)}」（AI 說法）"></button>`;
    }).join("");
    return `
      <section class="panel student">
        <div class="st-head">${icon("avatar", 18, 24, st.sid)}
          <div class="st-who"><b>${st.sid}</b>${G.mockTag()}<div>${esc(p.description || "")}</div>
            <div class="muted">程度 ${LEVEL_ZH[p.level] || esc(p.level || "—")}・先備知識 ${PRIOR_ZH[p.prior_knowledge] || esc(p.prior_knowledge || "—")}</div></div>
          <button class="btn icon" data-act="close" title="關閉（Esc）">✕</button></div>
        ${now}
        <div class="sub">他整堂課的狀態（一格一張投影片）<span class="tag ai">AI 說法</span></div>
        <div class="ministrip">${strip}</div>
        <div class="st-foot">課後測答對 <b>${info.score} / ${st.answers.length}</b><span class="tag solid">可驗證</span>
          <span class="spacer"></span><button class="btn small" data-act="paper">看整張考卷 →</button></div>
      </section>`;
  },

  // ---------- 右側：成績單（最後一步）。有選學生時改顯示他的考卷 ----------
  sideReport() {
    const { lec, sum, sim, heat, S } = G;
    if (S.student) return G.paper();
    const flat = new Set(lec.questions.map(q => q.real.post_rate)).size === 1;
    const rows = lec.questions.map(q => {
      const s = sum.simRate[q.qid] ?? 0, r = q.real.post_rate, hard = sum.hardReal.includes(q.qid) && !flat;
      return `<button class="rrow ${hard ? "hard" : ""}" data-act="q" data-v="${q.qid}"
        data-tip="Q${q.qid}：${esc(splitQuestion(q.text).stem)}｜模擬班 ${pct(s)}｜真實班 ${pct(r)}（${q.real.n_post} 人）">
        <span class="r-q">Q${q.qid}${hard ? `<em>難</em>` : ""}</span>
        <span class="r-bars"><i class="sim" style="width:${s * 100}%"></i><i class="real" style="width:${r * 100}%"></i></span>
        <span class="r-n"><b class="c-sim">${pct(s)}</b><b class="c-real">${pct(r)}</b></span></button>`;
    }).join("");
    const next = S.lec < 12 ? `<button class="btn primary" data-act="lec" data-v="${S.lec + 1}">下一堂 ▶</button>` : "";
    return `
      <section class="panel report">
        <div class="panel-h">成績單：模擬班 vs 真實班${G.mockTag()}</div>
        <div class="verdict ${sum.cls}" data-tip="比的是每題答對率的高低走勢（相關係數 r，1 = 完全一樣）。r ≥ 0.7 算像、0.4–0.7 有點像、其餘不像。門檻是我們自己訂的，沒有文獻依據。">
          <span class="v-k">模擬班跟真實班</span><span class="v-v">${sum.verdict}</span>
          <span class="v-sub">${sum.corr === null ? "真實班每題答對率都一樣，算不出來" : `走勢相似度 r = ${sum.corr.toFixed(2)}`}</span></div>
        <div class="facts">
          <div data-tip="每題｜模擬班答對率 − 真實班答對率｜的平均，越小越準。"><b>${Math.round(sum.mae * 100)}</b><span>每題平均差幾個百分點</span></div>
          <div data-tip="真實班最難的 ${sum.k} 題：Q${sum.hardReal.join("、Q")}；模擬班最難的 ${sum.k} 題：Q${sum.hardSim.join("、Q")}。"><b>${sum.hit} / ${sum.k}</b><span>真實最難的題，模擬抓到幾題</span></div>
          <div data-tip="只比有出題的投影片。模擬最卡：第 ${heat.simTop.join("、")} 張；真實答錯最多：第 ${heat.realTop.join("、")} 張。"><b>${heat.both} / ${heat.k}</b><span>最卡的投影片，兩班重疊幾張</span></div>
        </div>
        ${lec.n_students_post < 8 ? `<div class="note warn">⚠ 這堂課真實班只有 ${lec.n_students_post} 人，上面的數字很不穩。</div>` : ""}
        <div class="sub">每題答對率<span class="who sim">模擬班</span><span class="who real">真實班</span><span class="muted">（點一題回去看）</span></div>
        <div class="rrows">${rows}</div>
        <div class="r-btns">
          <button class="btn" data-act="replay">↺ 再看一次</button>${next}
          <a class="btn" href="${$("proLink").href}">詳細數據（研究員版）↗</a>
        </div>
      </section>`;
  },
  paper() {
    const { lec, sim, S } = G, st = sim.students.find(x => x.sid === S.student), info = G.by[st.sid], p = st.persona || {};
    const byQ = Object.fromEntries(lec.questions.map(q => [q.qid, q]));
    const rows = st.answers.map(a => {
      const q = byQ[a.qid] || { answer: "?", text: "" };
      return `<div class="prow ${a.correct ? "ok" : "ng"}" data-tip="${esc(splitQuestion(q.text).stem)}">
        <button class="link" data-act="q" data-v="${a.qid}">Q${a.qid}</button>
        <span class="pill ${a.correct ? "ok" : "ng"}">${a.correct ? "○" : "✕"}</span>
        <span class="p-ans">${esc(a.answer ?? "（沒作答）")}${a.correct ? "" : `<small>正解 ${esc(q.answer)}</small>`}</span>
        <span class="p-why">${esc(a.reason || "")}</span></div>`;
    }).join("");
    return `
      <section class="panel paper">
        <div class="st-head">${icon("avatar", 18, 24, st.sid)}
          <div class="st-who"><b>${st.sid} 的考卷</b>${G.mockTag()}<div>${esc(p.description || "")}</div>
            <div class="muted">程度 ${LEVEL_ZH[p.level] || esc(p.level || "—")}・先備知識 ${PRIOR_ZH[p.prior_knowledge] || esc(p.prior_knowledge || "—")}</div></div>
          <button class="btn small" data-act="close">← 回成績單</button></div>
        <div class="st-foot">答對 <b>${info.score} / ${st.answers.length}</b>
          <span class="tag solid">○✕ 可驗證</span><span class="tag ai">理由是 AI 說法</span></div>
        <div class="prows">${rows}</div>
      </section>`;
  },

  // ---------- 最下面的時間軸：上課 → 課後測 → 成績單 ----------
  timeline() {
    const { lec, S, sum } = G, nS = lec.slides.length, nQ = lec.questions.length;
    const slides = lec.slides.map((s, i) => {
      const o = G.states[s.id] || { confused: 0, lost: 0, n: 1, stuck: 0 }, hasQ = lec.questions.some(q => q.slide_id === s.id);
      return `<button class="tl ${i === S.pos ? "cur" : ""} ${i < S.pos ? "past" : ""}" data-act="goto" data-v="${i}"
        data-tip="第 ${s.id} 張：${pct(o.stuck)} 沒聽懂（困惑 ${o.confused}、卡住 ${o.lost}）${hasQ ? "・課後有考" : ""}">
        <span class="tl-bar"><i class="confused" style="height:${o.confused / o.n * 100}%"></i><i class="lost" style="height:${o.lost / o.n * 100}%"></i></span>
        <span class="tl-n">${s.id}${hasQ ? "<em>◆</em>" : ""}</span></button>`;
    }).join("");
    const qs = lec.questions.map((q, i) => {
      const s = sum.simRate[q.qid] ?? 0, r = q.real.post_rate, p = nS + i;
      return `<button class="tl q ${p === S.pos ? "cur" : ""} ${p < S.pos ? "past" : ""}" data-act="goto" data-v="${p}"
        data-tip="Q${q.qid}：模擬班 ${pct(s)}、真實班 ${pct(r)} 答對">
        <span class="tl-bar two"><i class="sim" style="height:${s * 100}%"></i><i class="real" style="height:${r * 100}%"></i></span>
        <span class="tl-n">Q${q.qid}</span></button>`;
    }).join("");
    const end = nS + nQ;
    return `
      <div class="controls">
        <button class="btn icon" data-act="prev" title="上一步（←）">◀</button>
        <button class="btn icon play" data-act="play" title="播放／暫停（空白鍵）">${S.playing ? "❚❚" : "▶"}</button>
        <button class="btn icon" data-act="next" title="下一步（→）">▶|</button>
        <button class="btn small" data-act="speed" title="切換播放速度">速度 ${S.speed}×</button>
      </div>
      <div class="tgroup" style="flex:${nS}"><div class="tg-h"><b>① 上課</b>${nS} 張投影片<span><i class="sw confused"></i>困惑 <i class="sw lost"></i>卡住　柱子越高＝越多人沒聽懂　◆＝課後有考</span></div><div class="tg-items">${slides}</div></div>
      <div class="tgroup" style="flex:${nQ * 1.25}"><div class="tg-h"><b>② 課後測</b>${nQ} 題<span><i class="sw sim"></i>模擬班 <i class="sw real"></i>真實班 答對率</span></div><div class="tg-items">${qs}</div></div>
      <div class="tgroup end"><div class="tg-h"><b>③</b></div><div class="tg-items">
        <button class="tl endbtn ${S.pos === end ? "cur" : ""}" data-act="goto" data-v="${end}">成績單</button></div></div>`;
  },

  helpHTML() {
    return `<div class="help-card">
      <h2>這個畫面在看什麼？</h2>
      <p>一班 <b>AI 學生</b>（電腦扮演的學生）上了一堂<b>真實上過的課</b>，考了同一份<b>課後測</b>。我們想知道：AI 班卡住的地方，跟真實班級像不像？</p>
      <div class="help-grid">
        <div><h3>① 上課</h3>
          <p>${icon("happy", 16, 14)} 沒有符號＝他說聽懂了</p>
          <p>${icon("q", 16, 18)} 困惑　${icon("swirl", 16, 18)} 卡住（完全跟不上）</p>
          <p>右邊「投影幕」是老師現在講的那一張。</p></div>
        <div><h3>② 課後測</h3>
          <p>${icon("ok", 16, 16)} 答對　${icon("ng", 16, 16)} 答錯</p>
          <p>右邊兩條橫條：<span class="who sim">模擬班</span>和<span class="who real">真實班</span>各有多少人答對。</p></div>
        <div><h3>③ 成績單</h3>
          <p>${icon("7", 16, 16)} 每位學生答對幾題</p>
          <p>整堂課模擬班跟真實班像不像。</p></div>
      </div>
      <div class="help-honest">
        <p><i class="lg-dash"></i><b>虛線框、雲朵泡泡</b>＝AI 學生自己說的想法和感覺。沒有真實資料可以對照，<b>無法驗證</b>。</p>
        <p><i class="lg-solid"></i><b>實心牌子、實心橫條</b>＝作答對錯和答對率。<b>可以</b>跟真實班的成績對照。</p>
        ${G.isMock() ? `<p><span class="tag mock">MOCK</span>目前 AI 學生的資料是用公式編的示意資料，<b>不是</b>真的模擬結果。真實班的部分是真的。</p>` : ""}
      </div>
      <p class="muted">操作：空白鍵 播放／暫停　← → 上一步／下一步　點學生看他的想法　Esc 關閉</p>
      <button class="btn primary" data-act="help">知道了</button>
    </div>`;
  },

  // ---------- 網址 # 狀態 ----------
  saveHash() {
    const S = G.S, step = G.cur();
    const at = step.kind === "slide" ? "s" + step.slide.id : step.kind === "q" ? "q" + step.q.qid : "report";
    const p = new URLSearchParams({ school: S.school, lec: S.lec, at });
    if (S.student) p.set("student", S.student);
    history.replaceState(null, "", "#" + p);
  },
  readHash() {
    const p = new URLSearchParams(location.hash.slice(1)), S = G.S;
    if (SCHOOLS[p.get("school")]) S.school = p.get("school");
    if (+p.get("lec")) S.lec = +p.get("lec");
    S.student = p.get("student");
    return p;
  },
  // 把 "s8"、"q3"、"report" 換成時間軸上的第幾步
  posOf(at) {
    const i = G.steps.findIndex(st => at === "report" ? st.kind === "report"
      : st.kind === "slide" ? at === "s" + st.slide.id : st.kind === "q" && at === "q" + st.q.qid);
    return i < 0 ? 0 : i;
  },

  // ---------- 播放 ----------
  setPlaying(on) {
    const S = G.S;
    S.playing = on;
    clearTimeout(G.timer);
    if (!on) return;
    G.timer = setTimeout(() => {
      if (S.pos >= G.steps.length - 1) return G.setPlaying(false), G.render();
      S.pos++; G.spotN = 0; S.student = null;
      G.setPlaying(S.pos < G.steps.length - 1);   // 走到成績單就停
      G.render();
    }, (DWELL[G.cur().kind] || 4000) / S.speed);
  },

  // ---------- 所有點擊都走這裡（事件委派，跟研究員版同一個寫法）----------
  async act(act, v) {
    const S = G.S, last = G.steps.length - 1;
    let reload = false;
    const jump = pos => { S.pos = Math.max(0, Math.min(last, pos)); G.spotN = 0; G.setPlaying(false); };
    switch (act) {
      case "school": S.school = v; S.pos = 0; S.student = null; reload = true; G.setPlaying(false); break;
      case "lec": S.lec = +v; S.pos = 0; S.student = null; reload = true; G.setPlaying(false); break;
      case "goto": jump(+v); break;
      case "slide": jump(G.posOf("s" + v)); break;
      case "q": jump(G.posOf("q" + v)); break;
      case "prev": jump(S.pos - 1); break;
      case "next": jump(S.pos + 1); break;
      case "replay": jump(0); S.student = null; break;
      case "paper": jump(last); break;
      case "student": S.student = S.student === v ? null : v; break;
      case "close": if (S.help) S.help = false; else S.student = null; break;
      case "play":
        Scene.skipIntro();
        if (!S.playing && S.pos >= last) { S.pos = 0; S.student = null; }   // 已經在成績單就從頭播
        G.setPlaying(!S.playing); break;
      case "speed": S.speed = SPEEDS[(SPEEDS.indexOf(S.speed) + 1) % SPEEDS.length]; if (S.playing) G.setPlaying(true); break;
      case "help": S.help = !S.help; break;
      case "skip": Scene.skipIntro(); break;
    }
    if (reload) await G.load(true);
    G.render();
  },

  fail(err) {
    console.error(err);
    $("side").innerHTML = `<section class="panel error"><b>載入失敗</b><p>${esc(err.message)}</p>
      <p>請確認是用 start.bat（或 python -m http.server）啟動，不是直接雙擊 game.html。</p></section>`;
  },

  // 場景要多大：在可用空間裡放得下的最大 320:200，剩下的寬度給右側面板
  layout() {
    const main = $("main"), below = $("legend").offsetHeight + $("dialog").offsetHeight;
    const k = Math.max(1, Math.min((main.clientHeight - below) / Scene.H, main.clientWidth * 0.64 / Scene.W));
    $("sceneWrap").style.width = $("stage").style.width = Math.floor(Scene.W * k) + "px";
    $("sceneWrap").style.height = Math.floor(Scene.H * k) + "px";
  },

  async init() {
    document.body.addEventListener("click", e => {
      const el = e.target.closest("[data-act]");
      if (el && !el.disabled) G.act(el.dataset.act, el.dataset.v).catch(G.fail);
    });
    document.addEventListener("keydown", e => {
      if (e.target.matches("input,textarea,select")) return;
      const map = { ArrowRight: "next", ArrowLeft: "prev", " ": "play", Escape: "close" };
      if (map[e.key]) { e.preventDefault(); G.act(map[e.key]).catch(G.fail); }
    });
    // 場景的滑鼠：把螢幕座標換成 320×200 的邏輯座標，再問 Scene 點到誰
    const canvas = $("scene");
    const pick = e => {
      const b = canvas.getBoundingClientRect();
      return Scene.hit((e.clientX - b.left) / b.width * Scene.W, (e.clientY - b.top) / b.height * Scene.H);
    };
    canvas.addEventListener("click", e => { const a = pick(e); if (a) G.act("student", a.sid).catch(G.fail); });
    canvas.addEventListener("mousemove", e => {
      const a = pick(e), tag = $("nametag");
      canvas.style.cursor = a ? "pointer" : "default";
      if (!tag) return;
      tag.hidden = !a;
      if (a) { tag.textContent = a.sid; tag.style.left = a.sx / Scene.W * 100 + "%"; tag.style.top = (a.sy + 13) / Scene.H * 100 + "%"; }
    });
    canvas.addEventListener("mouseleave", () => { if ($("nametag")) $("nametag").hidden = true; });
    // 提示框：滑鼠移到有 data-tip 的元素上就顯示（跟研究員版同一個寫法）
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
    window.addEventListener("resize", G.layout);
    // 場景上的泡泡每 3.2 秒換下一位學生；進場動畫結束時也要重畫一次（把「跳過進場」收掉、泡泡放出來）
    let introWas = false;
    setInterval(() => {
      if (!G.sim) return;
      const intro = !Scene.introDone();
      if (intro !== introWas) { introWas = intro; G.renderOverlay(); }
    }, 250);
    setInterval(() => { if (G.sim && Scene.introDone() && !G.S.student) { G.spotN++; G.renderOverlay(); } }, 3200);

    try {
      Scene.init(canvas);
      [G.real, G.index] = await Promise.all([G.getJSON("data/lectures_real.json"), G.getJSON("data/sim/index.json")]);
      if (location.hash === "#selftest") return G.selftest();
      const p = G.readHash();
      await G.load(p.get("intro") !== "0");        // 網址加 intro=0 可以跳過進場（截圖和測試用）
      G.S.pos = G.posOf(p.get("at") || "s" + G.lec.slides[0].id);
      if (p.has("help")) G.S.help = true;
      G.render();
      G.layout();
    } catch (err) { G.fail(err); }
  },

  // ---------- 自我測試：24 堂課的每一步都畫一次，再點幾個東西 ----------
  async selftest() {
    const log = [], S = G.S;
    let bad = 0;
    for (const lec of G.real) {
      const name = `${lec.school} L${lec.lecture_id}`;
      try {
        Object.assign(S, { school: lec.school.startsWith("e") ? "e" : "h", lec: lec.lecture_id, pos: 0, student: null, help: false });
        await G.load(false);
        if (G.steps.length !== lec.slides.length + lec.questions.length + 1) throw new Error("時間軸步數不對");
        if (Scene.actors.length !== G.sim.students.length) throw new Error("場景裡的學生數不對");
        for (const st of G.sim.students) {
          if (st.slides.length !== lec.slides.length) throw new Error(`${st.sid} 的投影片數不對`);
          if (st.answers.length !== lec.questions.length) throw new Error(`${st.sid} 的答案數不對`);
        }
        const sid = G.sim.students[0].sid;
        for (let i = 0; i < G.steps.length; i++) {
          const kind = G.steps[i].kind;
          await G.act("goto", i);
          Scene.draw(Scene.now() + 5);                      // 場景畫得出來（+5 秒：讓符號的進場動畫都跑完）
          if (!$("side").querySelector(".panel")) throw new Error(`第 ${i} 步右側是空的`);
          if (kind !== "report" && !$("overlay").querySelector(".bubble")) throw new Error(`第 ${i} 步沒有泡泡`);
          if (!$("legend").children.length || !$("dialog").textContent) throw new Error(`第 ${i} 步沒有圖例或旁白`);
          await G.act("student", sid);
          if (!$("side").querySelector(kind === "report" ? ".paper .prow" : ".student .ministrip")) throw new Error(`第 ${i} 步學生卡不對`);
          await G.act("close");
        }
        if (!$("side").querySelector(".report .rrow")) throw new Error("成績單沒有題目列");
        // 真的送出滑鼠和鍵盤事件（不是直接呼叫 G.act）：點第一個座位的學生、按 → 和 ←
        G.layout();
        const a0 = Scene.actors[0], box = $("scene").getBoundingClientRect();
        $("scene").dispatchEvent(new MouseEvent("click", { bubbles: true,
          clientX: box.left + a0.sx / Scene.W * box.width, clientY: box.top + (a0.sy - 12) / Scene.H * box.height }));
        if (S.student !== a0.sid) throw new Error("用滑鼠點場景裡的學生沒反應");
        await G.act("close"); await G.act("goto", 0);
        document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
        if (S.pos !== 1) throw new Error("按 → 沒有到下一步");
        document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
        if (S.pos !== 0) throw new Error("按 ← 沒有回上一步");
        await G.act("goto", G.steps.length - 1);
        await G.act("help"); if (!$("help").querySelector(".help-card")) throw new Error("說明沒出現"); await G.act("help");
        await G.act("play"); await G.act("play"); await G.act("speed"); await G.act("replay");
        if (S.pos !== 0) throw new Error("再看一次沒有回到開頭");
        if (!$("sourceBadge").textContent.includes("MOCK")) throw new Error("沒有 MOCK 標示");
        // 兩個版本的數字要一致：這裡的 r 應該跟研究員版 #selftest 印出來的第 1 步 r 一樣
        log.push(`PASS ${name}  ${G.steps.length} 步  r=${G.sum.corr === null ? "n/a" : G.sum.corr.toFixed(2)}`);
      } catch (err) { bad++; log.push(`FAIL ${name}: ${err.message}`); }
    }
    G.setPlaying(false);
    G.sim = null;   // 讓定時更新泡泡的計時器停手（頁面馬上要被換成測試結果）
    document.body.innerHTML = `<pre id="selftest">SELFTEST ${bad ? "FAILED" : "OK"}：${log.length - bad} / ${log.length} 通過\n${log.join("\n")}</pre>`;
  },
};

G.init();
