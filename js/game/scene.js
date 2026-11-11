/*
 * scene.js — 觀眾版的教室場景：排座位、學生走進教室、每一格動畫、滑鼠點到誰
 *
 * 出處表
 * - 用途：只管「畫」。要畫什麼（每個學生現在的狀態、對錯、分數）由 game.js 用 Scene.show() 告訴它
 * - 畫法：sprites.js；場景固定 320×200 邏輯像素
 * - 動畫：瀏覽器的 requestAnimationFrame 每秒約 60 次呼叫 draw()，每次整張重畫（東西很少，不會慢）
 * - 「走路」只有開場：學生從右上角的門走到座位坐下，之後就坐著。這是純演出，不代表任何資料
 */
const Scene = {
  W: 320, H: 200,
  DOOR: [298, 62], TEACHER: [150, 168], WALK_SPEED: 150,   // 走路速度：每秒幾個邏輯像素
  ctx: null, roomImg: null, actors: [], mode: "slide", sel: null,

  now: () => performance.now() / 1000,

  init(canvas) {
    this.ctx = canvas.getContext("2d");
    // 背景不會變，先畫到一張看不見的 canvas 上，之後每格直接貼上去
    this.roomImg = document.createElement("canvas");
    this.roomImg.width = this.W; this.roomImg.height = this.H;
    Sprites.room(this.roomImg.getContext("2d"), this.W, this.H);
    const loop = () => { this.draw(this.now()); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  },

  // n 個學生的座位座標。16 人以內排 4 欄；人多就加欄、把間距縮小
  seats(n) {
    const cols = n <= 16 ? 4 : n <= 25 ? 5 : n <= 36 ? 6 : 8, rows = Math.ceil(n / cols);
    const gx = Math.min(58, 232 / Math.max(1, cols - 1)), gy = Math.min(28, 84 / Math.max(1, rows - 1));
    const out = [];
    for (let i = 0; i < n; i++) {
      const c = i % cols, row = Math.floor(i / cols);
      out.push({ x: Math.round(150 + (c - (cols - 1) / 2) * gx), y: Math.round(168 - (rows - 1 - row) * gy) });
    }
    return out;
  },

  // 換一班學生。intro = true 時播放「走進教室」
  setClass(sids, intro) {
    const pos = this.seats(sids.length), t = this.now();
    this.actors = sids.map((sid, i) => {
      const { x, y } = pos[i];
      return {
        sid, look: Sprites.look(sid), sx: x, sy: y, seated: !intro, start: t + 0.4 + i * 0.14,
        // 路線：門口 → 沿後牆走到自己那一欄旁邊的走道 → 往前走到自己那一排 → 側身進座位
        path: [this.DOOR, [x + 15, 62], [x + 15, y - 1], [x, y - 1]],
        view: {}, key: "", prev: {}, since: 0,
      };
    });
  },
  skipIntro() { this.actors.forEach(a => a.seated = true); },
  introDone() { return this.actors.every(a => a.seated); },

  // game.js 告訴場景現在要演什麼。views = {sid: {state} 或 {mark} 或 {score}}
  show(mode, views) {
    const t = this.now();
    this.mode = mode;
    this.actors.forEach((a, i) => {
      const v = views[a.sid] || {}, key = mode + JSON.stringify(v);
      if (key === a.key) return;
      a.prev = a.view; a.view = v; a.key = key;
      a.since = t + (i % 5) * 0.05;   // 符號不要全班同時跳出來，錯開一點比較生動
    });
  },

  // 走路中的位置：沿著 path 走了 dist 這麼遠時在哪裡。走完回傳 null
  along(path, dist) {
    for (let i = 1; i < path.length; i++) {
      const [x0, y0] = path[i - 1], [x1, y1] = path[i], len = Math.abs(x1 - x0) + Math.abs(y1 - y0);
      if (dist <= len) { const k = len ? dist / len : 0; return [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k]; }
      dist -= len;
    }
    return null;
  },

  draw(t) {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.drawImage(this.roomImg, 0, 0);
    // 先決定每個東西的 y，再由遠到近畫（y 小的在後面，會被前面的蓋住）
    const items = [];
    for (const a of this.actors) {
      items.push({ y: a.sy + 0.5, draw: () => Sprites.desk(ctx, a.sx, a.sy) });
      if (a.seated) { items.push({ y: a.sy, draw: () => Sprites.student(ctx, a.sx, a.sy, a.look, this.pose(a, t)) }); continue; }
      const tau = t - a.start;
      if (tau < 0) continue;                                   // 還在門外
      const p = this.along(a.path, tau * this.WALK_SPEED);
      if (!p) { a.seated = true; a.since = t; items.push({ y: a.sy, draw: () => Sprites.student(ctx, a.sx, a.sy, a.look, {}) }); continue; }
      items.push({ y: p[1], draw: () => Sprites.student(ctx, p[0], p[1], a.look, { walk: Math.floor(tau * 8) % 2 }) });
    }
    items.sort((p, q) => p.y - q.y).forEach(it => it.draw());
    Sprites.teacher(ctx, this.TEACHER[0], this.TEACHER[1], t, this.mode === "slide");

    // 第二輪：頭上的符號和牌子（最後畫，才不會被前排的人擋住）
    for (const a of [...this.actors].sort((p, q) => p.sy - q.sy)) {
      if (!a.seated || t < a.since) continue;
      // 泡泡在頭的右上方（ex = 泡泡左緣）；牌子舉在右手（px = 牌子中心）
      const v = a.view, k = Math.min(1, (t - a.since) / 0.35), ex = a.sx + 7, ey = a.sy - 14, px = a.sx + 13, py = a.sy - 7;
      if (this.mode === "slide") {
        if (v.state === "confused") Sprites.emote(ctx, ex, ey, "q", k);
        else if (v.state === "lost") Sprites.emote(ctx, ex, ey, "swirl", k);
        // 上一張還不懂、這一張懂了：亮一下燈泡
        else if (a.prev.state && a.prev.state !== "understood" && t - a.since < 1.4) Sprites.emote(ctx, ex, ey, "bulb", k);
      } else if (this.mode === "q") {
        if (v.mark === 1 || v.mark === 0) Sprites.placard(ctx, px, py, v.mark ? "ok" : "ng", k);
      } else if (v.score !== undefined) Sprites.placard(ctx, px, py, v.score, k);
      if (a.sid === this.sel) Sprites.arrow(ctx, a.sx, a.sy - 30, t);
    }
  },

  // 坐著時的小動作：眨眼、點頭（懂）、歪頭（困惑）、低頭冒汗（卡住）
  pose(a, t) {
    const v = a.view, ph = a.look.phase;
    let face = "happy";
    if (this.mode === "slide") face = { confused: "confused", lost: "lost" }[v.state] || "happy";
    else if (this.mode === "q" && v.mark === 0) face = "confused";
    const o = { face, blink: (t + ph) % 3.7 < 0.13 };
    if (face === "happy") o.dy = (t * 0.9 + ph) % 2.8 < 0.2 ? 1 : 0;
    if (face === "confused") o.tilt = Math.sin(t * 1.6 + ph) > 0 ? 1 : 0;
    if (face === "lost") { o.dy = 1; o.drop = Math.floor((t * 3 + ph) % 3); }
    return o;
  },

  // 邏輯座標 (x, y) 點到哪個學生。重疊時選比較前排的
  hit(x, y) {
    let best = null;
    for (const a of this.actors)
      if (a.seated && x >= a.sx - 12 && x <= a.sx + 20 && y >= a.sy - 32 && y <= a.sy + 11 && (!best || a.sy > best.sy)) best = a;
    return best;
  },
  actor(sid) { return this.actors.find(a => a.sid === sid); },
};
