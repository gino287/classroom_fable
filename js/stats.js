/*
 * stats.js — 把原始資料算成畫面要用的數字（純計算，不碰畫面）
 *
 * 出處表
 * - 輸入：data/lectures_real.json 的一堂課（lec）＋ data/sim/ 的一個模擬結果檔（sim），格式見 docs/data_format.md
 * - 輸出：每題的模擬／真實答對率、每張投影片的狀態統計、相似度指標
 * - 相似度門檻（像／有點像／不像）是我們自己訂的，理由見 docs/decision_log.md 決定 8
 */
const Stats = {
  // 全班模擬答對率：每題 correct 的平均。回傳 {qid: 0~1}
  simRates(sim) {
    const sum = {}, n = {};
    for (const st of sim.students) for (const a of st.answers) {
      sum[a.qid] = (sum[a.qid] || 0) + a.correct;
      n[a.qid] = (n[a.qid] || 0) + 1;
    }
    const out = {};
    for (const q in sum) out[q] = sum[q] / n[q];
    return out;
  },

  // 每張投影片三種狀態各幾人。回傳 {slide_id: {understood, confused, lost, n, stuck}}，stuck = (困惑+卡住)/n
  slideStates(sim) {
    const out = {};
    for (const st of sim.students) for (const s of st.slides) {
      const o = out[s.slide_id] || (out[s.slide_id] = { understood: 0, confused: 0, lost: 0, n: 0 });
      o[s.state]++; o.n++;
    }
    for (const id in out) out[id].stuck = (out[id].confused + out[id].lost) / out[id].n;
    return out;
  },

  // 真實卡點：只有「有題目對應」的投影片才有真實資料。答錯率 = 1 - 該投影片所有題目課後答對率的平均
  realSlideWrong(lec) {
    const by = {};
    for (const q of lec.questions) (by[q.slide_id] || (by[q.slide_id] = [])).push(q);
    const out = {};
    for (const id in by) {
      const qs = by[id];
      out[id] = { wrong: 1 - qs.reduce((s, q) => s + q.real.post_rate, 0) / qs.length, qids: qs.map(q => q.qid) };
    }
    return out;
  },

  // 皮爾森相關係數。任一邊完全沒有變化（例如真實答對率全部一樣）時算不出來，回傳 null
  pearson(a, b) {
    const n = a.length, ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
    return saa === 0 || sbb === 0 ? null : sab / Math.sqrt(saa * sbb);
  },

  // Wilson 區間：樣本很少時（高中版每堂只有 2~5 人）比「平均 ± 標準誤」可靠。回傳 [下界, 上界]
  wilson(p, n, z = 1.96) {
    if (!n) return [0, 1];
    const d = 1 + z * z / n, c = p + z * z / (2 * n), h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
    return [Math.max(0, (c - h) / d), Math.min(1, (c + h) / d)];
  },

  // 取分數最高的前 k 個 key（同分時 key 小的在前，結果才固定）
  topK(scoreByKey, k) {
    return Object.keys(scoreByKey).map(Number)
      .sort((x, y) => scoreByKey[y] - scoreByKey[x] || x - y).slice(0, k);
  },

  // 一堂課的總結：畫面最上面那一排用
  summary(lec, sim) {
    const simRate = Stats.simRates(sim);
    const qs = lec.questions.filter(q => simRate[q.qid] !== undefined);
    const s = qs.map(q => simRate[q.qid]), r = qs.map(q => q.real.post_rate);
    const mae = s.reduce((t, x, i) => t + Math.abs(x - r[i]), 0) / (qs.length || 1);
    const k = Math.min(3, qs.length);
    const wrongReal = {}, wrongSim = {};
    qs.forEach(q => { wrongReal[q.qid] = 1 - q.real.post_rate; wrongSim[q.qid] = 1 - simRate[q.qid]; });
    const hardReal = Stats.topK(wrongReal, k), hardSim = Stats.topK(wrongSim, k);
    const corr = Stats.pearson(s, r);
    let verdict = "無法判斷", cls = "na";
    if (corr !== null) {
      if (corr >= 0.7) { verdict = "像"; cls = "good"; }
      else if (corr >= 0.4) { verdict = "有點像"; cls = "mid"; }
      else { verdict = "不像"; cls = "bad"; }
    }
    return { simRate, corr, mae, verdict, cls, hardReal, hardSim, hit: hardReal.filter(q => hardSim.includes(q)).length, k };
  },
};
