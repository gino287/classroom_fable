/*
 * sprites.js — 觀眾版（game.html）的像素畫：教室背景、學生、老師、頭上的符號
 *
 * 出處表
 * - 用途：全部用 canvas 的 fillRect 一格一格畫出來，沒有用任何圖片檔（不用擔心素材授權，也不用多帶檔案）
 * - 座標：都是「邏輯像素」，整個場景是 320×200，由 CSS 放大（image-rendering: pixelated 保持顆粒感）
 * - 學生的長相（膚色、髮型、衣服）是用學生編號 sid 算出來的，同一個 sid 每次都長一樣；
 *   長相跟程度、先備知識**無關**（故意的，避免讓人用外表猜程度）
 * - 誠實原則沿用研究員版（docs/decision_log.md 決定 4）：
 *     雲朵泡泡（emote）= AI 學生自己說的狀態，無法驗證
 *     實心牌子（placard）= 作答對錯／答對題數，可以跟真實班對照
 */
const INK = "#2b2540";

const Sprites = {
  SKIN: ["#f8d9bd", "#efc39c", "#dba676", "#bd8055", "#93603f"],
  HAIR: ["#2b2118", "#4a3120", "#7a4a25", "#c98a3a", "#1f2a44", "#8c3b2e"],
  SHIRT: ["#e45b5b", "#f0a03c", "#f2d24b", "#63b76c", "#4aa3df", "#7b6fd6", "#e17fb1", "#4fc1b0", "#f5f5f0"],

  // 5×7 的小圖案：# 的位置上色
  GLYPH: {
    q:     [".###.", "#...#", "....#", "..##.", "..#..", ".....", "..#.."],   // 問號＝困惑
    swirl: [".###.", "#...#", "#.#.#", "#.##.", "#....", ".####", "....."],   // 漩渦＝卡住
    bulb:  [".###.", "#####", "#####", "#####", ".###.", ".....", ".###."],   // 燈泡＝剛剛想通
    // 牌子上的圈和叉是 7×7（畫大一點、圓一點，才不會被看成數字 0）
    ok:    ["..###..", ".#...#.", "#.....#", "#.....#", "#.....#", ".#...#.", "..###.."],   // 圈＝答對
    ng:    ["#.....#", ".#...#.", "..#.#..", "...#...", "..#.#..", ".#...#.", "#.....#"],   // 叉＝答錯
  },
  // 3×5 的數字（成績單時學生舉的牌子）
  DIGIT: ["####.##.##.####", ".#.##..#..#.###", "###..#####..###", "###..####..####", "#.##.####..#..#",
          "####..###..####", "####..####.####", "###..#..#..#..#", "####.#####.####", "####.####..####"],

  r(ctx, c, x, y, w = 1, h = 1) { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); },
  bitmap(ctx, rows, x, y, c) {
    rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === "#") this.r(ctx, c, x + i, y + j); });
  },
  digit(ctx, d, x, y, c) {
    const s = this.DIGIT[d];
    for (let i = 0; i < 15; i++) if (s[i] === "#") this.r(ctx, c, x + i % 3, y + Math.floor(i / 3));
  },

  // 把字串變成一個固定的整數（FNV-1a 雜湊），用來從 sid 決定長相
  hash(s) {
    let h = 2166136261;
    for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return h >>> 0;
  },
  look(sid) {
    const h = this.hash(sid);
    return {
      skin: this.SKIN[h % 5], hair: this.HAIR[(h >>> 4) % 6], shirt: this.SHIRT[(h >>> 8) % 9],
      style: (h >>> 12) % 5, phase: (h % 628) / 100,   // phase：讓每個人眨眼、點頭的時間錯開
    };
  },

  // ---------- 教室背景（從講台往後看：後牆在上面，學生面向我們）----------
  room(ctx, W, H) {
    const r = (...a) => this.r(ctx, ...a);
    r("#f6e7c8", 0, 0, W, 54); r("#ecd9b0", 0, 44, W, 10); r("#b98a55", 0, 54, W, 3);   // 牆、牆裙、踢腳板
    r("#e6bd85", 0, 57, W, H - 57);                                                      // 木地板
    for (let y = 57, k = 0; y < H; y += 11, k++) {
      r("#d6a96f", 0, y, W, 1);
      for (let x = (k % 2) * 20 + 8; x < W; x += 40) r("#d6a96f", x, y + 1, 1, 10);
    }
    for (const x of [18, 86, 154]) {                                                     // 三扇窗
      r("#8a6a4a", x - 2, 8, 48, 32); r("#aee0f7", x, 10, 44, 28);
      r("#fff", x + 6, 15, 10, 3); r("#fff", x + 9, 13, 6, 2); r("#fff", x + 28, 21, 9, 3);   // 雲
      r("#fdf6e3", x + 21, 10, 2, 28); r("#fdf6e3", x, 23, 44, 2);
      r("#c9a67a", x - 4, 40, 52, 2);
    }
    r("#8a6a4a", 216, 10, 54, 30); r("#5f9e6e", 218, 12, 50, 26);                        // 公佈欄
    [["#fff", 222, 15, 9, 7], ["#f2d24b", 234, 14, 8, 8], ["#f6a6a6", 245, 16, 9, 6], ["#aee0f7", 257, 15, 8, 9],
     ["#fff", 224, 26, 12, 8], ["#f2d24b", 240, 27, 7, 7], ["#fff", 251, 28, 13, 6]].forEach(a => r(...a));
    r("#6e4a2c", 284, 6, 28, 48); r("#9a6a3c", 286, 8, 24, 46);                          // 門（學生從這裡走進來）
    r("#aee0f7", 290, 12, 16, 12); r("#ffd24a", 289, 33, 2, 3);
    r("#b5653a", 5, 62, 10, 8); r("#8f4c2a", 5, 62, 10, 2);                              // 盆栽
    r("#4f9a5b", 7, 52, 6, 10); r("#63b76c", 4, 55, 4, 5); r("#63b76c", 12, 54, 4, 6);
  },

  desk(ctx, cx, by) {
    const r = (...a) => this.r(ctx, ...a);
    r("rgba(0,0,0,.13)", cx - 12, by + 11, 24, 2);
    r("#e0b06e", cx - 11, by - 1, 22, 5); r("#f0c888", cx - 11, by - 1, 22, 1);
    r("#b07a3f", cx - 11, by + 4, 22, 4);
    r("#7a5230", cx - 10, by + 8, 2, 4); r("#7a5230", cx + 8, by + 8, 2, 4);
    r("#fff", cx - 4, by, 8, 3); r("#c9c9d6", cx, by, 1, 3);                             // 桌上的課本
  },

  /*
   * 學生（正面）。cx = 身體中心，by = 身體底端（坐著時是桌面的高度，走路時是腰）
   * o.face：happy／confused／lost；o.walk：有給（0 或 1）就畫站姿和腳，兩個值交替就是走路
   * o.dy、o.tilt：頭往下、往旁邊移 1 格，用來做點頭、歪頭；o.blink：眨眼
   */
  student(ctx, cx, by, look, o = {}) {
    const r = (...a) => this.r(ctx, ...a);
    const { skin, hair, shirt, style } = look, face = o.face || "happy";
    const hx = cx - 6 + (o.tilt || 0), hy = by - 21 + (o.dy || 0);
    if (o.walk !== undefined) {
      r("rgba(0,0,0,.18)", cx - 6, by + 6, 12, 2);
      const a = o.walk ? 1 : 0;
      r("#3d4a6b", cx - 4, by, 3, 6 - a); r("#3d4a6b", cx + 1, by, 3, 5 + a);
      r(INK, cx - 4, by + 5 - a, 3, 1); r(INK, cx + 1, by + 4 + a, 3, 1);
    }
    r(shirt, cx - 5, by - 9, 10, 1); r(shirt, cx - 6, by - 8, 12, 8);                    // 身體
    r("rgba(0,0,0,.12)", cx - 6, by - 2, 12, 2);
    r(skin, cx - 2, by - 10, 4, 2);                                                      // 脖子
    if (o.walk === undefined) { r(skin, cx - 7, by - 3, 2, 2); r(skin, cx + 5, by - 3, 2, 2); }   // 手放桌上
    r(skin, hx + 1, hy, 10, 11); r(skin, hx, hy + 1, 12, 9);                             // 頭
    r(hair, hx + 1, hy - 1, 10, 3); r(hair, hx, hy, 12, 3);                              // 頭髮（共同的部分）
    r(hair, hx, hy + 3, 1, 3); r(hair, hx + 11, hy + 3, 1, 3);
    if (style === 0) r(hair, hx + 2, hy + 3, 5, 1);                                      // 斜瀏海
    if (style === 1) { r(hair, hx - 1, hy + 2, 2, 11); r(hair, hx + 11, hy + 2, 2, 11); r(hair, hx + 1, hy + 3, 10, 1); }   // 長髮
    if (style === 2) { r(hair, hx - 3, hy + 2, 3, 5); r(hair, hx + 12, hy + 2, 3, 5); }  // 雙馬尾
    if (style === 3) { r(hair, hx + 2, hy - 2, 2, 1); r(hair, hx + 5, hy - 3, 2, 2); r(hair, hx + 9, hy - 2, 2, 1); }      // 刺蝟頭
    if (style === 4) { r(hair, hx - 1, hy + 1, 2, 8); r(hair, hx + 11, hy + 1, 2, 8); r(hair, hx + 1, hy + 3, 3, 1); r(hair, hx + 8, hy + 3, 3, 1); }   // 鮑伯頭
    const eye = INK, mouth = "#8a3b3b";
    if (face === "lost") {                                                               // 卡住：瞇成一條線、嘴巴張開、冒汗
      r(eye, hx + 2, hy + 6, 3, 1); r(eye, hx + 7, hy + 6, 3, 1);
      r(mouth, hx + 5, hy + 8, 2, 2);
      r("#6ec3f0", hx + 12, hy + 2 + (o.drop || 0), 1, 2);
    } else {
      const eh = o.blink ? 1 : 2, ey = hy + 5 + (o.blink ? 1 : 0);
      r(eye, hx + 3, ey, 1, eh); r(eye, hx + 8, ey, 1, eh);
      if (face === "confused") { r(mouth, hx + 4, hy + 9, 2, 1); r(mouth, hx + 6, hy + 8, 2, 1); }   // 歪嘴
      else {
        r(mouth, hx + 4, hy + 8, 1, 1); r(mouth, hx + 5, hy + 9, 2, 1); r(mouth, hx + 7, hy + 8, 1, 1);   // 微笑
        r("#f3a9a0", hx + 1, hy + 7, 2, 1); r("#f3a9a0", hx + 9, hy + 7, 2, 1);                           // 腮紅
      }
    }
  },

  // 老師（背影，站在畫面最下方；我們是從老師背後看全班）。top = 頭頂的 y
  teacher(ctx, cx, top, t, teaching) {
    const r = (...a) => this.r(ctx, ...a);
    const dy = Math.sin(t * 2.2) > 0.7 ? 1 : 0;
    r("#4b5d8a", cx - 9, top + 15, 18, 40); r("#4b5d8a", cx - 11, top + 17, 22, 40);
    r("#fdf6e3", cx - 4, top + 14, 8, 2);
    r("#efc39c", cx - 2, top + 13 + dy, 4, 2);
    r("#4a3120", cx - 6, top + dy, 12, 1); r("#4a3120", cx - 7, top + 1 + dy, 14, 12);
    r("#4a3120", cx - 3, top - 3 + dy, 6, 3);                                            // 包包頭
    r("#efc39c", cx - 8, top + 6 + dy, 1, 3); r("#efc39c", cx + 7, top + 6 + dy, 1, 3);  // 耳朵
    if (teaching) {                                                                      // 上課時舉著教鞭，慢慢擺動
      const sway = Math.sin(t * 1.3) > 0 ? 1 : 0;
      r("#4b5d8a", cx + 11, top + 10, 3, 9); r("#efc39c", cx + 11, top + 8, 3, 2);
      for (let i = 0; i < 9; i++) r("#7a5230", cx + 13 + Math.floor(i / (2 - sway)), top + 7 - i);
    }
  },

  // 雲朵泡泡（AI 說法）。畫在頭的右上方，才不會擋到後排同學的臉。x = 泡泡左緣，y = 泡泡最下緣；k = 0→1 的進場動畫（往上彈一下）
  emote(ctx, x, y, kind, k = 1) {
    const r = (...a) => this.r(ctx, ...a);
    const top = y - 17 - (k < 1 ? Math.round(Math.sin(k * Math.PI) * 4) : 0);
    r(INK, x + 1, top, 11, 11); r(INK, x, top + 1, 13, 9); r("#fff", x + 1, top + 1, 11, 9);
    r(INK, x, top + 11, 4, 4); r("#fff", x + 1, top + 12, 2, 2); r(INK, x - 2, top + 15, 2, 2);   // 思考泡泡的小圓點，往左下指向頭
    const color = { q: "#c98a00", swirl: "#d43f3f", bulb: "#e9a900" }[kind];
    this.bitmap(ctx, this.GLYPH[kind], x + 4, top + 2, color);
    if (kind === "bulb") r(INK, x + 5, top + 8, 3, 1);
  },

  // 實心牌子（可驗證），學生用右手舉著。cx = 牌子中心，y = 握把最下緣。kind：ok／ng／數字（答對題數）
  placard(ctx, cx, y, kind, k = 1) {
    const r = (...a) => this.r(ctx, ...a);
    const top = y - 15 - (k < 1 ? Math.round(Math.sin(k * Math.PI) * 4) : 0);
    r("#7a5230", cx, top + 11, 1, 4);
    const bg = kind === "ok" ? "#2e9e5b" : kind === "ng" ? "#d43f3f" : "#2a78d6";
    r(INK, cx - 6, top, 13, 11); r(bg, cx - 5, top + 1, 11, 9);
    if (kind === "ok" || kind === "ng") return this.bitmap(ctx, this.GLYPH[kind], cx - 3, top + 2, "#fff");
    const ds = String(kind).split("").map(Number), w = ds.length * 4 - 1;
    ds.forEach((d, i) => this.digit(ctx, d, cx - Math.floor(w / 2) + i * 4, top + 3, "#fff"));
  },

  // 選中的學生：頭上跳動的黃色箭頭
  arrow(ctx, cx, y, t) {
    const yy = y - (Math.sin(t * 6) > 0 ? 1 : 0);
    [[7, 0], [5, 1], [3, 2], [1, 3]].forEach(([w, j]) => {
      this.r(ctx, INK, cx - Math.floor(w / 2) - 1, yy + j, w + 2, 2);
      this.r(ctx, "#ffd24a", cx - Math.floor(w / 2), yy + j, w, 1);
    });
  },

  // 圖例和學生卡用的小圖：畫在一個小 canvas 上，跟場景裡的是同一套畫法，所以一定長得一樣
  icon(canvas, kind, sid) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const look = this.look(sid || "s01");
    if (kind === "avatar") this.student(ctx, 9, 24, look, {});                    // 16×24：半身像
    else if (["happy", "confused", "lost"].includes(kind)) this.student(ctx, 8, 23, look, { face: kind });   // 16×14：只看到頭
    else if (["q", "swirl", "bulb"].includes(kind)) this.emote(ctx, 2, 17, kind);  // 16×18
    else this.placard(ctx, 8, 16, kind);                                           // 16×16
  },
};
