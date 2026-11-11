/*
 * views.js — 把資料畫成畫面（每個函式回傳一段 HTML 字串，由 app.js 放進頁面）
 *
 * 出處表
 * - 讀：App.S（目前狀態）、App.lec（真實資料的一堂課）、App.sim（目前步驟的模擬結果）、
 *       App.sim1（第 1 步的模擬結果，第 2 步時用來畫「更新前」）、App.sum（Stats.summary 的結果）
 * - 互動：元素上的 data-act / data-v 由 app.js 統一處理（事件委派），這裡不綁事件
 * - 誠實原則（docs/decision_log.md 決定 4）：
 *     實心標記 = 可以跟真實資料對照的數字（作答、答對率）
 *     虛線框   = 只是 AI 的說法（想法、理由、狀態），無法驗證
 * - 顏色：模擬＝藍、真實＝橘；懂／困惑／卡住＝綠／黃／紅，且一定搭配符號 ✓ ? ✕（不只靠顏色）
 */
const STATE = {
  understood: { zh: "懂", icon: "✓" },
  confused: { zh: "困惑", icon: "?" },
  lost: { zh: "卡住", icon: "✕" },
};
const LEVEL_ZH = { low: "較弱", average: "普通", high: "較好" };
const PRIOR_ZH = { none: "沒學過", some: "學過一點", strong: "學過不少" };

// 單一色相由淺到深的色階（數值越大越深）。藍＝模擬、橘＝真實
const RAMP_BLUE = ["#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281", "#0d366b"];
const RAMP_ORANGE = ["#fde6da", "#fbd3c0", "#f8bda2", "#f4a683", "#f08e63", "#eb6834", "#d2531f", "#b54516", "#93360f", "#732a0b"];

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pct = x => Math.round(x * 100) + "%";
// 色階上色：回傳 style 字串（背景色＋夠深時文字改白色）
function rampStyle(ramp, t) {
  const i = Math.min(ramp.length - 1, Math.floor(t * ramp.length));
  return `background:${ramp[i]};color:${i >= ramp.length * 0.45 ? "#fff" : "#0b0b0b"}`;
}
const isMock = () => App.sim.source !== "REAL_SIM" && String(App.sim.source).toUpperCase().includes("MOCK");
const mockTag = () => isMock() ? `<span class="tag mock">MOCK</span>` : "";

const Views = {
  // ---------- 最上面的總結 ----------
  summary() {
    const { lec, sum, sim } = App;
    const states = Stats.slideStates(sim);
    const realWrong = Stats.realSlideWrong(lec);
    const simTop = Stats.topK(Object.fromEntries(Object.entries(states).map(([k, v]) => [k, v.stuck])), 1)[0];
    const realTop = Stats.topK(Object.fromEntries(Object.entries(realWrong).map(([k, v]) => [k, v.wrong])), 1)[0];
    const nReal = lec.n_students_post;
    const corrTxt = sum.corr === null ? "—" : sum.corr.toFixed(2);
    // flat：真實每題答對率都一樣（高中版人太少時會發生），這時「最難的題」「最卡的投影片」沒有意義
    const flat = new Set(lec.questions.map(q => q.real.post_rate)).size === 1;
    const small = nReal < 8 ? `<span class="warn">⚠ 真實只有 ${nReal} 人，數字很不穩</span>` : "";
    return `
      <div class="hero">
        <div class="hero-line">
          <span class="who sim">模擬${mockTag()}</span>最多人沒聽懂：
          <button class="link" data-act="slide" data-v="${simTop}">投影片 ${simTop}</button>
          <span class="muted">（${pct(states[simTop].stuck)} 困惑或卡住）</span>
        </div>
        <div class="hero-line">
          <span class="who real">真實</span>答錯最多：
          <button class="link" data-act="slide" data-v="${realTop}">投影片 ${realTop}</button>
          <span class="muted">（對應題目答錯 ${pct(realWrong[realTop].wrong)}）</span>
          ${flat ? `<span class="chip">真實每題答對率都一樣，分不出卡點</span>`
            : simTop == realTop ? `<span class="chip good">✓ 同一張</span>` : `<span class="chip bad">✕ 不同張</span>`}
        </div>
      </div>
      <div class="tile ${sum.cls}" data-tip="每題「模擬答對率」和「真實答對率」的相關係數 r。r ≥ 0.7 算像、0.4–0.7 有點像、其餘不像（門檻是我們自己訂的）。">
        <div class="tile-k">模擬跟真實像不像</div>
        <div class="tile-v">${sum.verdict}<small>r = ${corrTxt}</small></div>
      </div>
      <div class="tile" data-tip="每題｜模擬答對率 − 真實答對率｜的平均。越小越準。">
        <div class="tile-k">每題平均差距</div>
        <div class="tile-v">${Math.round(sum.mae * 100)}<small>個百分點</small></div>
      </div>
      <div class="tile" data-tip="真實最難的 ${sum.k} 題：Q${sum.hardReal.join("、Q")}；模擬認為最難的 ${sum.k} 題：Q${sum.hardSim.join("、Q")}。">
        <div class="tile-k">最難 ${sum.k} 題抓到幾題</div>
        <div class="tile-v">${sum.hit} / ${sum.k}</div>
      </div>
      <div class="tile meta">
        <div class="tile-k">這堂課</div>
        <div class="meta-v">${lec.slides.length} 張投影片・${lec.questions.length} 題<br>
          模擬 ${sim.students.length} 人・真實 ${nReal} 人 ${small}</div>
      </div>`;
  },

  // ---------- 分頁 1：上課回放 ----------
  replay() {
    const { lec, sim, S, sum } = App;
    const slide = lec.slides[S.slide];
    const states = Stats.slideStates(sim);
    const cur = states[slide.id] || { understood: 0, confused: 0, lost: 0, n: 0 };
    const qsHere = lec.questions.filter(q => q.slide_id === slide.id);

    // 座位：把學生打散排，不要讓同程度的坐同一排（5 和 16 互質，所以每個座位剛好一人）
    const n = sim.students.length;
    const order = sim.students.map((_, i) => sim.students[(i * 5) % n]);
    const at = st => st.slides.find(x => x.slide_id === slide.id) || { state: "understood", thought: "" };
    const seats = order.map(st => {
      const s = at(st);
      return `<button class="seat ${s.state} ${S.student === st.sid ? "sel" : ""}" data-act="student" data-v="${st.sid}"
        data-tip="${st.sid}（程度${LEVEL_ZH[st.persona.level] || st.persona.level}）：${STATE[s.state].zh}">
        <span class="face">${STATE[s.state].icon}</span><span class="sid">${st.sid}</span></button>`;
    }).join("");

    // 想法泡泡：先放卡住的、再放困惑的，最多 4 個（畫面放不下全部）
    const rank = { lost: 0, confused: 1, understood: 2 };
    const bubbles = sim.students.map(st => ({ st, s: at(st) }))
      .sort((a, b) => rank[a.s.state] - rank[b.s.state]).slice(0, 4)
      .map(({ st, s }) => `<button class="bubble ${s.state}" data-act="student" data-v="${st.sid}">
        <span class="b-who"><span class="dot ${s.state}">${STATE[s.state].icon}</span>${st.sid}・${STATE[s.state].zh}</span>
        ${esc(s.thought)}</button>`).join("");

    const qInfo = qsHere.length ? qsHere.map(q => `<div class="slide-q">
        <button class="link" data-act="goto-q" data-v="${q.qid}">Q${q.qid}</button>
        <span class="muted">${esc(q.text.split("<please")[0])}</span>
        <div><span class="who real">真實</span>答對 ${pct(q.real.post_rate)}　<span class="who sim">模擬</span>答對 ${pct(sum.simRate[q.qid] ?? 0)}</div>
      </div>`).join("") : `<div class="muted">這張沒有對應的題目，所以沒有真實資料可以對照。</div>`;

    // 時間軸：每張投影片一根小柱子，高度 = 困惑＋卡住的比例
    const strip = lec.slides.map((s, i) => {
      const o = states[s.id] || { confused: 0, lost: 0, n: 1, stuck: 0 };
      const hasQ = lec.questions.some(q => q.slide_id === s.id);
      return `<button class="tl ${i === S.slide ? "cur" : ""} ${i < S.slide ? "past" : ""}" data-act="slide" data-v="${s.id}"
        data-tip="投影片 ${s.id}：${pct(o.stuck)} 沒聽懂（困惑 ${o.confused}、卡住 ${o.lost}）${hasQ ? "・有對應題目" : ""}">
        <span class="tl-q">${hasQ ? "◆" : ""}</span>
        <span class="tl-bar"><i class="confused" style="height:${o.confused / o.n * 100}%"></i><i class="lost" style="height:${o.lost / o.n * 100}%"></i></span>
        <span class="tl-n">${s.id}</span></button>`;
    }).join("");

    return `
    <div class="replay">
      <section class="card slidecard">
        <div class="card-h">投影片 <b>${slide.id}</b> / ${lec.slides.length}<span class="tag real">真實教材（只有文字）</span></div>
        <p class="slidetext">${esc(slide.text)}</p>
        <div class="slide-qs"><div class="sub">這張對應的課後測題目</div>${qInfo}</div>
      </section>
      <section class="card room">
        <div class="card-h">教室${mockTag()}
          <span class="counts">
            <span class="dot understood">✓</span>懂 ${cur.understood}
            <span class="dot confused">?</span>困惑 ${cur.confused}
            <span class="dot lost">✕</span>卡住 ${cur.lost}</span></div>
        <div class="podium">講台</div>
        <div class="seats">${seats}</div>
        <div class="hint">點一位學生看他的設定、想法和作答</div>
      </section>
      <section class="card thoughts">
        <div class="card-h">這張的想法<span class="tag ai">AI 說法・無法驗證</span>${mockTag()}</div>
        <div class="bubbles">${bubbles}</div>
      </section>
    </div>
    <section class="card timeline">
      <div class="controls">
        <button class="btn icon" data-act="prev" title="上一張（←）">⏮</button>
        <button class="btn icon play" data-act="play" title="播放／暫停（空白鍵）">${S.playing ? "⏸" : "▶"}</button>
        <button class="btn icon" data-act="next" title="下一張（→）">⏭</button>
        <button class="btn small" data-act="speed" title="切換播放速度">速度 ${S.speed}×</button>
      </div>
      <div class="strip">${strip}</div>
      <div class="tl-legend"><i class="sw confused"></i>困惑 <i class="sw lost"></i>卡住　◆ 有對應題目<br><span class="muted">柱子越高＝越多人沒聽懂</span></div>
    </section>`;
  },

  // ---------- 分頁 2：課後測，模擬 vs 真實 ----------
  compare() {
    const { lec, sim, sim1, S, sum } = App;
    const rate1 = Stats.simRates(sim1);
    const revealed = sim.revealed_qids || [];
    const nSim = sim.students.length;
    let qs = [...lec.questions];
    if (S.sort === "hard") qs.sort((a, b) => a.real.post_rate - b.real.post_rate || a.qid - b.qid);

    const rows = qs.map(q => {
      const r = q.real.post_rate, s = sum.simRate[q.qid] ?? 0, d = Math.round((s - r) * 100);
      const [lo, hi] = Stats.wilson(r, q.real.n_post);
      const hard = sum.hardReal.includes(q.qid), isRev = revealed.includes(q.qid);
      const pre = S.showPre && q.real.pre_rate !== null
        ? `<span class="mk pre" style="left:${q.real.pre_rate * 100}%"></span>` : "";
      const old = S.step === 2 && !isRev ? `<span class="mk sim old" style="left:${(rate1[q.qid] ?? 0) * 100}%"></span>` : "";
      const tip = `Q${q.qid}：${q.text.split("<please")[0]}｜模擬 ${pct(s)}（${nSim} 人）｜真實 ${pct(r)}（${q.real.n_post} 人，95% 區間 ${pct(lo)}–${pct(hi)}）` +
        (q.real.pre_rate !== null ? `｜真實課前 ${pct(q.real.pre_rate)}` : "");
      return `<div class="qrow ${hard ? "hard" : ""} ${isRev ? "rev" : ""}" data-tip="${esc(tip)}">
        <div class="qlabel"><b>Q${q.qid}</b>
          <button class="link" data-act="slide" data-v="${q.slide_id}" title="跳到這題對應的投影片">投影片 ${q.slide_id}</button>
          ${hard ? `<span class="chip hardchip">真實最難</span>` : ""}${isRev ? `<span class="chip">已揭露</span>` : ""}</div>
        <div class="track">
          <span class="ci" style="left:${lo * 100}%;width:${(hi - lo) * 100}%"></span>
          <span class="gap" style="left:${Math.min(r, s) * 100}%;width:${Math.abs(r - s) * 100}%"></span>
          ${pre}${old}
          <span class="mk sim" style="left:${s * 100}%"></span>
          <span class="mk real" style="left:${r * 100}%"></span>
        </div>
        <div class="qnum"><span>${pct(s)}</span><span>${pct(r)}</span><span class="diff ${Math.abs(d) >= 20 ? "big" : ""}">${d > 0 ? "+" : ""}${d}</span></div>
      </div>`;
    }).join("");

    const byId = Object.fromEntries(lec.questions.map(q => [q.qid, q]));
    const hardCards = sum.hardReal.map((qid, i) => {
      const q = byId[qid], caught = sum.hardSim.includes(qid);
      return `<div class="hardcard">
        <div class="hc-h"><b>第 ${i + 1} 難｜Q${qid}</b>
          <span class="chip ${caught ? "good" : "bad"}">${caught ? "✓ 模擬也抓到" : "✕ 模擬沒抓到"}</span></div>
        <div class="hc-t">${esc(q.text.split("<please")[0])}</div>
        <div class="hc-n"><span class="who real">真實</span>${pct(q.real.post_rate)}　<span class="who sim">模擬</span>${pct(sum.simRate[qid] ?? 0)}
          <button class="link" data-act="slide" data-v="${q.slide_id}">→ 投影片 ${q.slide_id}</button></div>
      </div>`;
    }).join("");

    const worse = lec.questions.filter(q => q.real.pre_rate !== null && q.real.post_rate < q.real.pre_rate).map(q => "Q" + q.qid);
    const stepNote = S.step === 2
      ? `<div class="note">第 2 步示意：揭露 Q${revealed.join("、Q")} 的全班真實結果後重新預測。空心藍圈＝更新前，實心藍圈＝更新後。${esc(sim.settings.notes || "")}</div>` : "";

    return `
    <div class="compare">
      <section class="card chart">
        <div class="card-h">每題全班答對率
          <span class="legend">
            <span class="mk sim inl"></span>模擬${mockTag()}
            <span class="mk real inl"></span>真實（課後）
            <span class="ci inl"></span>真實的 95% 區間
            ${S.showPre ? `<span class="mk pre inl"></span>真實（課前）` : ""}
          </span>
          <span class="spacer"></span>
          <span class="seg mini">
            <button class="${S.step === 1 ? "on" : ""}" data-act="step" data-v="1">第 1 步：課前預測</button>
            <button class="${S.step === 2 ? "on" : ""}" data-act="step" data-v="2" ${App.hasStep2 ? "" : "disabled"}>第 2 步：看到前幾題後</button>
          </span>
          <button class="btn small ${S.sort === "hard" ? "on" : ""}" data-act="sort">${S.sort === "hard" ? "依真實難度排" : "依題號排"}</button>
          <button class="btn small ${S.showPre ? "on" : ""}" data-act="pre">課前測</button>
        </div>
        <div class="qrow axis"><div class="qlabel"></div>
          <div class="track ticks"><span style="left:0">0%</span><span style="left:25%">25</span><span style="left:50%">50</span><span style="left:75%">75</span><span style="left:100%">100%</span></div>
          <div class="qnum head"><span>模擬</span><span>真實</span><span>差</span></div></div>
        <div class="qrows">${rows}</div>
        ${stepNote}
        ${S.showPre && worse.length ? `<div class="note">上完課反而變差的題目（真實）：${worse.join("、")}。</div>` : ""}
      </section>
      <section class="card hardest">
        <div class="card-h">真實最難的 ${sum.k} 題<span class="tag real">可驗證</span></div>
        ${new Set(lec.questions.map(q => q.real.post_rate)).size === 1
          ? `<div class="note warn">⚠ 這堂課真實每題答對率都一樣（只有 ${lec.n_students_post} 人作答），下面的「最難」只是照題號排，沒有意義。</div>` : ""}
        ${hardCards}
        <div class="hint">「最難」＝真實課後答對率最低。同分時題號小的在前。</div>
      </section>
    </div>`;
  },

  // ---------- 分頁 3：卡點熱圖 ----------
  heat() {
    const { lec, sim, S } = App;
    const states = Stats.slideStates(sim), realWrong = Stats.realSlideWrong(lec);
    const ids = lec.slides.map(s => s.id);
    const cols = `style="grid-template-columns:11.5rem repeat(${ids.length},1fr)"`;

    // 只在「有題目的投影片」裡比前 3 名，這樣模擬和真實比的是同一批投影片
    const k = Math.min(3, Object.keys(realWrong).length);
    const realTop = Stats.topK(Object.fromEntries(Object.entries(realWrong).map(([id, v]) => [id, v.wrong])), k);
    const simTop = Stats.topK(Object.fromEntries(Object.keys(realWrong).map(id => [id, states[id] ? states[id].stuck : 0])), k);
    const both = realTop.filter(x => simTop.includes(x));

    const head = ids.map((id, i) => `<button class="hc num ${i === S.slide ? "cur" : ""}" data-act="slide" data-v="${id}">${id}</button>`).join("");
    const simRow = ids.map(id => {
      const v = states[id] ? states[id].stuck : 0;
      return `<button class="hc val ${simTop.includes(id) ? "top" : ""}" style="${rampStyle(RAMP_BLUE, v)}" data-act="slide" data-v="${id}"
        data-tip="投影片 ${id}｜模擬：${pct(v)} 的學生困惑或卡住">${Math.round(v * 100)}</button>`;
    }).join("");
    const realRow = ids.map(id => {
      const o = realWrong[id];
      if (!o) return `<span class="hc val none" data-tip="投影片 ${id}｜沒有對應題目，沒有真實資料"></span>`;
      return `<button class="hc val ${realTop.includes(id) ? "top" : ""}" style="${rampStyle(RAMP_ORANGE, o.wrong)}" data-act="slide" data-v="${id}"
        data-tip="投影片 ${id}｜真實：Q${o.qids.join("、Q")} 平均答錯 ${pct(o.wrong)}">${Math.round(o.wrong * 100)}</button>`;
    }).join("");

    // 學生 × 投影片：依程度排（弱 → 好），同程度依編號
    const lv = { low: 0, average: 1, high: 2 };
    const studs = [...sim.students].sort((a, b) => (lv[a.persona.level] ?? 1) - (lv[b.persona.level] ?? 1) || a.sid.localeCompare(b.sid));
    const matrix = studs.map(st => {
      const by = Object.fromEntries(st.slides.map(x => [x.slide_id, x]));
      const cells = ids.map(id => {
        const x = by[id] || { state: "understood", thought: "" };
        return `<button class="hc st ${x.state}" data-act="student-at" data-v="${st.sid}|${id}"
          data-tip="${st.sid}・投影片 ${id}：${STATE[x.state].zh}｜「${esc(x.thought)}」（AI 說法）">${x.state === "understood" ? "" : STATE[x.state].icon}</button>`;
      }).join("");
      return `<button class="hl ${S.student === st.sid ? "sel" : ""}" data-act="student" data-v="${st.sid}">${st.sid} <small>${LEVEL_ZH[st.persona.level] || ""}</small></button>${cells}`;
    }).join("");

    return `
    <section class="card heat">
      <div class="card-h">哪幾張投影片最卡
        <span class="verdict-line">在有題目的 ${Object.keys(realWrong).length} 張投影片裡，最卡的 ${k} 張：
          <span class="who sim">模擬</span>${simTop.join("、")}　<span class="who real">真實</span>${realTop.join("、")}
          <span class="chip ${both.length >= 2 ? "good" : both.length === 1 ? "" : "bad"}">重疊 ${both.length} / ${k}</span></span>
      </div>
      <div class="grid" ${cols}>
        <span class="hl plain">投影片</span>${head}
        <span class="hl"><span class="who sim">模擬</span>沒聽懂 %${mockTag()}</span>${simRow}
        <span class="hl"><span class="who real">真實</span>答錯 %</span>${realRow}
      </div>
      <div class="heat-legend">
        <span>粗框＝最卡的 ${k} 張</span>
        <span><i class="hc val none sw2"></i>沒有對應題目（無真實資料）</span>
        <span>注意：上下兩排單位不同（狀態比例 vs 答錯率），比的是「哪幾張比較深」，不是數字大小。</span>
      </div>
      <div class="card-h sub2">每個學生 × 每張投影片<span class="tag ai">AI 說法・無法驗證</span>${mockTag()}
        <span class="counts"><span class="dot understood">✓</span>懂 <span class="dot confused">?</span>困惑 <span class="dot lost">✕</span>卡住</span></div>
      <div class="grid matrix" ${cols}>${matrix}</div>
    </section>`;
  },

  // ---------- 右側抽屜：單一學生 ----------
  drawer() {
    const { lec, sim, S } = App;
    const st = sim.students.find(x => x.sid === S.student);
    if (!st) return "";
    const slide = lec.slides[S.slide];
    const now = st.slides.find(x => x.slide_id === slide.id);
    const strip = st.slides.map(x => `<button class="hc st ${x.state} ${x.slide_id === slide.id ? "cur" : ""}" data-act="slide" data-v="${x.slide_id}"
      data-tip="投影片 ${x.slide_id}：${STATE[x.state].zh}｜「${esc(x.thought)}」">${x.state === "understood" ? "" : STATE[x.state].icon}</button>`).join("");
    const byQ = Object.fromEntries(lec.questions.map(q => [q.qid, q]));
    const right = st.answers.reduce((s, a) => s + a.correct, 0);
    const rows = st.answers.map(a => {
      const q = byQ[a.qid] || { answer: "?", slide_id: "?", text: "" };
      return `<tr data-tip="${esc(q.text)}">
        <td><b>Q${a.qid}</b><br><button class="link" data-act="slide" data-v="${q.slide_id}">投影片 ${q.slide_id}</button></td>
        <td class="${a.correct ? "ok" : "ng"}">${a.correct ? "✓" : "✕"} ${esc(a.answer ?? "（沒作答）")}<br><small>正解 ${esc(q.answer)}</small></td>
        <td class="reason">${esc(a.reason || "")}</td></tr>`;
    }).join("");
    return `
      <div class="drawer-h"><b>${st.sid}</b>${mockTag()}<span class="spacer"></span><button class="btn icon" data-act="close" title="關閉（Esc）">✕</button></div>
      <div class="persona">
        <div class="sub">設定（模擬開始前給的）</div>
        <div>${esc(st.persona.description || "")}</div>
        <div class="muted">程度：${LEVEL_ZH[st.persona.level] || esc(st.persona.level)}　先備知識：${PRIOR_ZH[st.persona.prior_knowledge] || esc(st.persona.prior_knowledge)}</div>
      </div>
      <div class="sub">每張投影片的狀態<span class="tag ai">AI 說法</span></div>
      <div class="dstrip">${strip}</div>
      ${now ? `<div class="bubble ${now.state} static"><span class="b-who"><span class="dot ${now.state}">${STATE[now.state].icon}</span>投影片 ${slide.id}・${STATE[now.state].zh}</span>${esc(now.thought)}</div>` : ""}
      <div class="sub">課後測作答：答對 ${right} / ${st.answers.length}
        <span class="tag real">答案對錯可驗證</span><span class="tag ai">理由是 AI 說法</span></div>
      <table class="ans"><thead><tr><th>題目</th><th>他的答案</th><th>他說的理由</th></tr></thead><tbody>${rows}</tbody></table>`;
  },
};
