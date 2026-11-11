# 資料格式（v0.1）

寫於 2026-11-11。介面只讀三種檔案，都在 `data/` 裡。

## 1. 真實資料：`data/lectures_real.json`（沒改）

Gino 準備的檔，由 `data/make_sample.py` 產生。一個陣列，24 堂課，每堂：

```json
{
  "school": "elementary school",
  "lecture_id": 1,
  "slides": [{"id": 1, "text": "…"}],
  "questions": [
    {"qid": 1, "slide_id": 9, "text": "…", "answer": "B",
     "real": {"pre_rate": 0.733, "post_rate": 0.562, "n_pre": 15, "n_post": 16}}
  ],
  "n_students_post": 16
}
```

## 2. 模擬結果的清單：`data/sim/index.json`（新增）

介面靠這個檔知道有哪些模擬結果可以讀。每個模擬結果檔一行：

```json
{"school": "elementary school", "lecture_id": 1, "step": 1, "source": "MOCK",
 "file": "data/sim/MOCK_elementary_L01_step1.json"}
```

同一堂課、同一步如果有兩行，**`source` 不是 `"MOCK"` 的優先**。所以放進真的結果後，假資料會自動被蓋過，不用刪。

## 3. 模擬結果檔：`data/sim/*.json`（草案 v0 的小幅擴充）

```json
{
  "format_version": "0.1",
  "school": "elementary school",
  "lecture_id": 1,
  "source": "MOCK",
  "step": 1,
  "revealed_qids": [],
  "settings": {"model": "…", "temperature": 0.7, "n_students": 16, "seed": 1, "notes": "…"},
  "students": [
    {
      "sid": "s01",
      "persona": {"level": "average", "prior_knowledge": "none", "description": "一個程度普通、沒學過 AI 的小學生"},
      "slides": [{"slide_id": 8, "state": "confused", "thought": "演繹和歸納我搞混了"}],
      "answers": [{"qid": 3, "answer": "A", "correct": 0, "reason": "從事實得到規則，應該是演繹吧"}]
    }
  ]
}
```

### 跟草案 v0 的差別和理由

| 欄位 | 改了什麼 | 為什麼 |
| --- | --- | --- |
| `format_version` | 新增，目前 `"0.1"` | 之後格式再改時，介面可以分辨舊檔 |
| `step` | 新增，`1` 或 `2`；沒寫當作 `1` | 「第 2 步：看到小測驗結果後更新」需要跟第 1 步的結果並排比較，所以兩步各存一個檔 |
| `revealed_qids` | 新增，第 2 步時列出哪幾題的全班結果已經揭露 | 畫面要把這幾題標成「已揭露」，不能把它們算進預測準確度 |
| `settings.seed` | 建議加 | 重現用 |
| `source` | 規則寫清楚：字串裡含 `MOCK`（不分大小寫）就會在畫面上標 MOCK | 誠實原則 |

其他欄位都沒動。

### 介面對資料的要求（之後真的模擬要照做）

1. **每個學生的 `slides` 要涵蓋每一張投影片**，`answers` 要涵蓋每一題。缺的投影片畫面會當成「懂」，缺的題目不會算進答對率——都會讓數字悄悄變好看，所以請不要缺。（`#selftest` 會檢查數量。）
2. `state` 只能是 `understood`、`confused`、`lost`。
3. `correct` 是 0 或 1。全班模擬答對率 = 該題 `correct` 的平均。
4. `slide_id`、`qid` 要對得上 `lectures_real.json` 裡同一堂課的 `id`、`qid`。
5. `persona.level` 用 `low`／`average`／`high`（熱圖用它排序；其他值也能顯示，只是排在中間）。`prior_knowledge` 用 `none`／`some`／`strong`（其他值會原樣顯示）。
6. `answer` 可以是 `null`（沒作答）。
7. 班級人數不限 16 人，但教室座位圖是 4 欄，人數太多會需要捲動。

### 還沒決定的（見 `open_questions.md`）

- 第 2 步的格式：現在是「另一個完整的檔」。如果真的模擬在第 2 步只重答沒揭露的題目，`slides` 要不要重複存一份？
- 是否要存每題的原始 LLM 回覆（除錯用）。建議存在別的檔，不要放進介面讀的檔，檔案會太大。
