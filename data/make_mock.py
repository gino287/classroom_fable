"""
產生「假的」模擬結果（MOCK），讓介面在真的模擬做出來之前有東西可以顯示。

出處表
- 用途：讀 data/lectures_real.json，替 24 堂課各產生兩個檔（第 1 步、第 2 步），寫到 data/sim/。
- 格式：docs/data_format.md（TASK.md 草案 v0 的小幅擴充）。
- 不呼叫任何 LLM／API，只用 Python 標準函式庫，固定亂數種子，重跑結果一樣。
- 用法：python data/make_mock.py            （在專案根目錄執行）
- 重要：這裡的所有數字、想法、理由都是用公式和句型模板編出來的，不是模擬結果。
        檔名、檔案裡的 "source" 欄位、畫面上都標 MOCK。

假資料怎麼編（細節見 docs/decision_log.md 決定 6）
1. 每題的「假模擬難度」= 真實課後答對率的 logit × fidelity + 全班偏差 bias + 雜訊。
   fidelity（像真實的程度）每堂課不一樣，所以有的課看起來很像、有的不像。
2. 每個假學生有一個能力值 theta；答對機率 = sigmoid(theta + 題目難度)。
3. 每張投影片的狀態（懂／困惑／卡住）由同一組能力值和投影片難度決定，
   所以「在第 8 張卡住的人，第 8 張對應的題目也比較容易錯」。
4. 第 2 步：假裝看到前 3 題的全班真實答對率，把全班能力往真實方向平移，其他不變。
"""
import json
import math
import random
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "sim"
N_STUDENTS = 16
N_REVEAL = 3          # 第 2 步揭露前幾題
SEED = 20261111

LEVELS = [("low", "程度較弱"), ("average", "程度普通"), ("high", "程度較好")]
PRIORS = [("none", "沒學過 AI"), ("some", "聽過一點 AI")]
SCHOOL_ZH = {"elementary school": "小學生", "high school": "高中生"}

# 句型模板。{t} 會換成投影片標題（投影片文字的第一句）。
THOUGHTS = {
    "understood": ["「{t}」這張我聽得懂。", "{t}，跟我想的差不多。", "這張的例子很清楚，懂了。"],
    "confused": ["「{t}」這裡有點亂，跟前面那張差在哪？", "{t}……好像懂又好像不懂。", "這張名詞好多，我不太確定意思。"],
    "lost": ["完全跟不上「{t}」。", "{t} 是什麼？老師講太快了。", "這張我放棄了，看不懂。"],
}
REASONS = {
    1: ["投影片「{t}」有講到，我記得。", "這題跟「{t}」那張的例子一樣。"],
    0: ["我把「{t}」那張的兩個概念搞混了。", "「{t}」那張我沒聽懂，用猜的。", "我記得好像是這個，但不確定。"],
}


def sigmoid(x):
    return 1 / (1 + math.exp(-x))


def logit(p):
    p = min(max(p, 0.04), 0.96)   # 避免 0 或 1 時變成無限大
    return math.log(p / (1 - p))


def slide_title(text):
    """投影片文字的第一句當標題，太長就截斷。"""
    t = text.split(". ")[0].strip(" .")
    return t if len(t) <= 40 else t[:38] + "…"


def is_filler(text):
    """封面、大綱、謝謝這類投影片，幾乎沒人會卡住。"""
    t = text.lower()
    return t.startswith("outline") or t.startswith("thanks") or len(text) < 60


def wrong_answer(q, rng):
    """編一個錯的答案：選擇題挑另一個選項；填充題給一個標明 MOCK 的佔位文字。"""
    part = q["text"].split("<please")[-1]
    letters = re.findall(r"\b([A-F])\.\s", part)
    others = [x for x in letters if x not in q["answer"]]
    if others:
        return rng.choice(others)
    return "（MOCK：答錯的自由作答）"


def make_lecture(lec, rng):
    """回傳 (第 1 步的 dict, 第 2 步的 dict)。"""
    slides, questions = lec["slides"], lec["questions"]
    # fidelity：這堂課的假模擬有多像真實。0.2（幾乎不像）到 1.0（很像）
    fidelity = rng.choice([0.1, 0.3, 0.5, 0.7, 0.9])
    noise_sd = 1.5 - fidelity
    # bias：假模擬把全班整體高估或低估多少（第 2 步要修正的就是這個）
    bias = rng.gauss(0, 0.8)

    # 每題的假模擬難度（數字越大越簡單）
    q_easy = {q["qid"]: fidelity * logit(q["real"]["post_rate"]) + bias + rng.gauss(0, noise_sd) for q in questions}

    # 每張投影片的難度：有題目的投影片跟著題目走，其他的用文字長度粗略估
    s_easy = {}
    for s in slides:
        qs = [q_easy[q["qid"]] for q in questions if q["slide_id"] == s["id"]]
        if qs:
            s_easy[s["id"]] = sum(qs) / len(qs) - bias + 0.3
        elif is_filler(s["text"]):
            s_easy[s["id"]] = 3.5
        else:
            s_easy[s["id"]] = 1.6 - len(s["text"]) / 300 + rng.gauss(0, 0.6)

    # 學生的固定部分：人設、能力、每張投影片和每題用的亂數（兩個步驟共用，才能公平比較）
    base = []
    for i in range(N_STUDENTS):
        level, level_zh = LEVELS[i * 3 // N_STUDENTS]          # 前 1/3 弱、中 1/3 普通、後 1/3 好
        prior, prior_zh = rng.choice(PRIORS)
        theta = {"low": -0.9, "average": 0.0, "high": 0.9}[level] + (0.3 if prior == "some" else 0) + rng.gauss(0, 0.35)
        base.append({
            "sid": f"s{i + 1:02d}", "theta": theta,
            "persona": {"level": level, "prior_knowledge": prior,
                        "description": f"一個{level_zh}、{prior_zh}的{SCHOOL_ZH[lec['school']]}"},
            "u_slide": {s["id"]: rng.random() for s in slides},
            "u_q": {q["qid"]: rng.random() for q in questions},
            "pick": rng.randrange(1000),
        })

    title = {s["id"]: slide_title(s["text"]) for s in slides}

    def build(step, shift, revealed):
        students = []
        for b in base:
            r2 = random.Random(b["pick"])            # 只用來挑句型，跟步驟無關
            theta = b["theta"] + shift
            slide_rows, state_of = [], {}
            for s in slides:
                p_ok = sigmoid(theta + s_easy[s["id"]])
                u = b["u_slide"][s["id"]]
                # u 小 → 懂；剩下的機率裡，約 6 成是困惑、4 成是卡住
                state = "understood" if u < p_ok else ("confused" if u < p_ok + (1 - p_ok) * 0.6 else "lost")
                state_of[s["id"]] = state
                slide_rows.append({"slide_id": s["id"], "state": state,
                                   "thought": r2.choice(THOUGHTS[state]).format(t=title[s["id"]])})
            answers = []
            for q in questions:
                # 投影片狀態會影響答題：懂的人加分，卡住的人扣分
                bonus = {"understood": 0.5, "confused": -0.4, "lost": -1.2}[state_of.get(q["slide_id"], "understood")]
                correct = 1 if b["u_q"][q["qid"]] < sigmoid(theta + q_easy[q["qid"]] + bonus) else 0
                answers.append({"qid": q["qid"],
                                "answer": q["answer"] if correct else wrong_answer(q, r2),
                                "correct": correct,
                                "reason": r2.choice(REASONS[correct]).format(t=title.get(q["slide_id"], "這堂課"))})
            students.append({"sid": b["sid"], "persona": b["persona"], "slides": slide_rows, "answers": answers})
        return {
            "format_version": "0.1",
            "school": lec["school"], "lecture_id": lec["lecture_id"],
            "source": "MOCK", "step": step, "revealed_qids": revealed,
            "settings": {"model": "MOCK（公式產生，沒有用 LLM）", "temperature": None, "n_students": N_STUDENTS,
                         "seed": SEED, "mock_fidelity": fidelity, "mock_bias": round(bias, 2),
                         "notes": "假資料：由 data/make_mock.py 用公式和句型模板產生，不是模擬結果。"},
            "students": students,
        }

    step1 = build(1, 0.0, [])

    # 第 2 步：比較前 N_REVEAL 題「假模擬」和「真實」的全班答對率，把全班能力平移
    revealed = [q["qid"] for q in questions[:N_REVEAL]]
    def sim_rate(doc, qid):
        return sum(a["correct"] for st in doc["students"] for a in st["answers"] if a["qid"] == qid) / N_STUDENTS
    gaps = [logit(q["real"]["post_rate"]) - logit(sim_rate(step1, q["qid"])) for q in questions[:N_REVEAL]]
    shift = 0.7 * sum(gaps) / len(gaps)
    step2 = build(2, shift, revealed)
    step2["settings"]["notes"] += f" 第 2 步：揭露第 {revealed} 題的全班真實答對率後，全班能力平移 {shift:+.2f}。"
    return step1, step2


def main():
    lectures = json.loads((ROOT / "lectures_real.json").read_text(encoding="utf-8"))
    OUT.mkdir(exist_ok=True)
    rng = random.Random(SEED)
    index = []
    # 排序後再產生，結果才不會跟 lectures_real.json 裡的順序有關
    for lec in sorted(lectures, key=lambda x: (x["school"], x["lecture_id"])):
        tag = "elementary" if lec["school"].startswith("elem") else "high"
        for doc in make_lecture(lec, rng):
            name = f"MOCK_{tag}_L{lec['lecture_id']:02d}_step{doc['step']}.json"
            (OUT / name).write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
            index.append({"school": lec["school"], "lecture_id": lec["lecture_id"],
                          "step": doc["step"], "source": "MOCK", "file": f"data/sim/{name}"})
    # index.json：介面靠這個檔知道有哪些模擬結果可以讀。之後放真的結果時，在這裡加一行。
    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    import sys
    sys.stdout.reconfigure(encoding="utf-8")   # Windows 終端機預設編碼印中文會變亂碼
    print(f"寫入 {len(index)} 個 MOCK 檔到 {OUT}")


if __name__ == "__main__":
    main()
