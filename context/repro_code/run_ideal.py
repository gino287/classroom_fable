"""
最小重現：Classroom Simulacra 的「不加 TIR」預測（ideal_predict，論文圖 9 的 Standard）。

做什麼
  對每一組（學生 × 一堂課）：給 LLM 這個學生前 5 題（past）的題目、對應投影片、對錯，
  再給後面幾題（future）的題目和對應投影片，請 LLM 猜這個學生 future 每題會不會答對。
  最後算準確率，並多算一個我們研究要的東西：每堂課每題的「全班預測答對率」。

出處表
| 部分 | 原本在哪 | 照搬或修改 |
| --- | --- | --- |
| 丟掉課前測、用 data_type 選測試學生 | reflection_generation_new.py: dataset_prepare_for_prediction | 照原本邏輯重寫 |
| 依 xy_type 切 past / future | reflection_generation_new.py: run_predict_reuse_reflect_student | 照原本邏輯重寫 |
| prompt 文字（TASK_STR、FORMAT_STR、system） | reflection_generation_new.py: LLM_Predictor.ideal_predict | 一字不改照搬 |
| 組題目文字、解析回答 | utils.py（見 cs_utils.py） | 一字不改照搬 |
| 呼叫 LLM | llm_respond.py: _response_llm_gpt | 簡化重寫：只留 OpenAI；key 從 .env 讀；temperature=0、max_tokens=3000 跟原本一樣 |
| 格式不對就跳過這組 | run_predict_reuse_reflect_student | 照原本邏輯，但會記錄被跳過幾組 |
| 評分、簡單基線、全班層級、可續跑 | 原本沒有 | 我們新增 |

用法（在 paper_research 資料夾執行）
  python repro/run_ideal.py --dry-run --scope test --limit 1          # 只印 prompt，不花錢
  python repro/run_ideal.py --scope test --student u1 --lecture 1     # 跑一個學生一堂課
  python repro/run_ideal.py --scope test                              # 18 位測試學生，54 組，對照論文
  python repro/run_ideal.py --scope all                               # 全部 167 組，算全班層級
"""
import argparse
import json
import os
import time
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from openai import OpenAI

from cs_utils import (
    _extract_llm_predict_correctness,
    _extract_llm_predict_reason,
    _generate_future_question_info,
    _generate_past_question_correctness_info,
)

# ---------------------------------------------------------------------------
# prompt：從 ideal_predict 一字不改照搬
# 中文意思：
#   TASK_STR   你的任務是預測這個學生在幾題未來題目會不會答對，
#              根據這個學生過去題目的對錯，以及過去和未來題目之間可能相關的概念。
#   FORMAT_STR 請預測這個學生未來每一題會不會答對，每題都要回答，並附上理由。
#              格式：Question 題號: Correct 或 Wrong, Reason: 理由。
#              後面是格式範例，以及兩個「不要這樣寫」的範例（不要加星號、不要用 Correct/Wrong 以外的字）。
# ---------------------------------------------------------------------------
SYSTEM_PROMPT = "You are an intelligent assistant."

TASK_STR = (
    'Your task is to predict the student answer correctness of several future questions, based on the student answer correctness of past questions, '
    + 'as well as the potential correlation of concepts between past questions and future questions.\n\n'
)

FORMAT_STR = (
    'Based on the info above, please predict whether this student will answer each of the future questions correctly or not.'
    + 'Note that you should give response for each one of the future questions. Please give both prediction results with your reasons per future question.'
    + 'Your output format should be: Question ID: Correct or Wrong, Reason: reason. \n'
    + 'For example, Question 1: Correct, Reason: your reason 1; Question 2: Wrong, Reason: your reason 2; Question 3: Wrong, Reason: your reason 3.  \n'
    + 'Do NOT include astericks. Do NOT use anything other than Correct/Wrong.\n'
    + 'Here is an example of what you should NOT do, * Question 1: **Right**, Reason: your reason; *Question 2: **Incorrect**; *Question 3: **Incorrect**, Reason: your reason 3.  \n'
    + 'Here is another example of what you should NOT do, **Question 1:** Correct, Reason: your reason; **Question 2:** Correct, Reason: your reason; **Question 3:** Correct, Reason: your reason. \n'
)

CORRECT_PATTERN = r"question\s*(\d+)\s*:\s*(correct|wrong)"
REASON_PATTERN = r'question\s*(\d+)\s*:\s*(\w+)\s*,\s*reason\s*:\s*(.*?)\s*(?=;|\.)'

# 估算費用用（美元 / 每百萬 token），跑之前請到 OpenAI 定價頁確認
PRICE = {"gpt-4o-mini": (0.15, 0.60), "gpt-4o": (2.50, 10.00)}


# ---------------------------------------------------------------------------
# 資料
# ---------------------------------------------------------------------------
def load_data(path):
    df = pd.read_csv(path, sep="\t")
    # 原論文只用課後測；不丟的話同一題會有兩列，cs_utils 裡的 assert 會報錯
    df = df[df["test_type"] != "pre test"]
    return df


def select_pairs(df, scope, school=None, lecture=None, student=None):
    """回傳要跑的（school, student_id, course_name）清單。"""
    if scope == "test":
        df = df[df["data_type"] == "test"]
    if school:
        df = df[df["school"] == school]
    if lecture is not None:
        df = df[df["course_name"] == lecture]
    if student:
        df = df[df["student_id"] == student]
    pairs = df[["school", "student_id", "course_name"]].drop_duplicates()
    pairs = pairs.sort_values(["school", "course_name", "student_id"])
    return list(pairs.itertuples(index=False, name=None))


def build_prompt(past_df, future_df):
    past_str = _generate_past_question_correctness_info(past_df, include_course=True)
    future_str = _generate_future_question_info(future_df, include_course=True)
    return TASK_STR + past_str + future_str + FORMAT_STR


# ---------------------------------------------------------------------------
# 呼叫 LLM
# ---------------------------------------------------------------------------
def call_llm(client, model, prompt, max_retries=5):
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": prompt},
    ]
    for attempt in range(max_retries):
        try:
            completion = client.chat.completions.create(
                model=model, messages=messages, temperature=0, max_tokens=3000, timeout=120
            )
            usage = completion.usage
            return completion.choices[0].message.content, usage.prompt_tokens, usage.completion_tokens
        except Exception as e:  # 網路或流量限制，等一下再試
            wait = 2 ** attempt
            print(f"  呼叫失敗（{e}），{wait} 秒後重試")
            time.sleep(wait)
    raise RuntimeError("重試太多次仍然失敗")


# ---------------------------------------------------------------------------
# 評分
# ---------------------------------------------------------------------------
def accuracy_and_f1(preds, labels):
    """preds、labels 都是 0/1 的 list。F1 以「答對 = 1」為正類，跟論文一樣。"""
    n = len(labels)
    acc = sum(1 for p, y in zip(preds, labels) if p == y) / n
    tp = sum(1 for p, y in zip(preds, labels) if p == 1 and y == 1)
    fp = sum(1 for p, y in zip(preds, labels) if p == 1 and y == 0)
    fn = sum(1 for p, y in zip(preds, labels) if p == 0 and y == 1)
    precision = tp / (tp + fp) if tp + fp else 0
    recall = tp / (tp + fn) if tp + fn else 0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0
    return acc, f1


def evaluate(records):
    """records：每一組（學生 × 課）的結果。報三種預測：LLM、全猜答對、前 5 題過半規則。"""
    ok = [r for r in records if not r["skipped"]]
    out = {"組數": len(records), "跳過組數（格式不對）": len(records) - len(ok)}
    if not ok:
        return out

    labels, llm, all_correct, past_rule = [], [], [], []
    pair_acc = []
    for r in ok:
        qids = sorted(r["labels"])
        y = [r["labels"][q] for q in qids]
        p = [r["predictions"][q] for q in qids]
        rule = 1 if r["past_accuracy"] >= 0.5 else 0
        labels += y
        llm += p
        all_correct += [1] * len(y)
        past_rule += [rule] * len(y)
        pair_acc.append(sum(1 for a, b in zip(p, y) if a == b) / len(y))

    out["future 題數"] = len(labels)
    for name, preds in [("LLM", llm), ("全猜答對", all_correct), ("前 5 題過半規則", past_rule)]:
        acc, f1 = accuracy_and_f1(preds, labels)
        out[name] = {"準確率（全部題目一起平均）": round(acc, 3), "F1": round(f1, 3)}
    out["LLM"]["準確率（每組先平均再平均）"] = round(sum(pair_acc) / len(pair_acc), 3)
    return out


def class_level(records):
    """把每個學生的預測加總成「每堂課每題」的全班預測答對率，並跟真實答對率比。"""
    rows = []
    for r in records:
        if r["skipped"]:
            continue
        for q, y in r["labels"].items():
            rows.append({"school": r["school"], "lecture": r["lecture"], "question_id": q,
                         "pred": r["predictions"][q], "real": y})
    if not rows:
        return None, None
    df = pd.DataFrame(rows)
    table = (df.groupby(["school", "lecture", "question_id"])
               .agg(n_students=("real", "size"), pred_rate=("pred", "mean"), real_rate=("real", "mean"))
               .reset_index())

    # 每個班：預測和真實的「哪題比較難」排名有多像（Spearman = 先排名再算 Pearson）
    per_class = []
    for (school, lecture), g in table.groupby(["school", "lecture"]):
        rho = None
        if len(g) >= 3 and g["pred_rate"].nunique() > 1 and g["real_rate"].nunique() > 1:
            rho = g["pred_rate"].rank().corr(g["real_rate"].rank())
        per_class.append({"school": school, "lecture": lecture, "n_questions": len(g),
                          "n_students": int(g["n_students"].max()),
                          "spearman": None if rho is None else round(rho, 3),
                          "mae": round((g["pred_rate"] - g["real_rate"]).abs().mean(), 3)})
    return table, pd.DataFrame(per_class)


# ---------------------------------------------------------------------------
# 主程式
# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="ClassroomSimulacra/dataset/CogEdu/dataset_cogedu_5.csv")
    ap.add_argument("--scope", choices=["test", "all"], default="test",
                    help="test：18 位測試學生（對照論文）；all：全部學生（算全班層級）")
    ap.add_argument("--school", help="elementary school 或 high school")
    ap.add_argument("--lecture", type=int)
    ap.add_argument("--student", help="例如 u1")
    ap.add_argument("--limit", type=int, help="最多跑幾組")
    ap.add_argument("--model", default="gpt-4o-mini")
    ap.add_argument("--dry-run", action="store_true", help="只印 prompt，不呼叫 API")
    ap.add_argument("--out", default="results")
    args = ap.parse_args()

    load_dotenv()
    df = load_data(args.data)
    pairs = select_pairs(df, args.scope, args.school, args.lecture, args.student)
    if args.limit:
        pairs = pairs[: args.limit]
    print(f"要跑 {len(pairs)} 組（學生 × 課）")

    out_dir = Path(args.out) / f"ideal_{args.model}_{args.scope}"
    out_dir.mkdir(parents=True, exist_ok=True)
    log_path = out_dir / "records.jsonl"

    # 可續跑：已經跑過的組不再呼叫 API（中斷或加跑時不重複花錢）
    done = {}
    if log_path.exists():
        for line in log_path.read_text(encoding="utf-8").splitlines():
            r = json.loads(line)
            # json 的 key 一定是字串，轉回 int
            r["labels"] = {int(k): v for k, v in r["labels"].items()}
            r["predictions"] = {int(k): v for k, v in r["predictions"].items()}
            done[(r["school"], r["student_id"], r["lecture"])] = r

    client = None if args.dry_run else OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    records = []
    for i, (school, student, lecture) in enumerate(pairs, 1):
        key = (school, student, int(lecture))
        if key in done:
            records.append(done[key])
            continue

        rows = df[(df["school"] == school) & (df["student_id"] == student) & (df["course_name"] == lecture)]
        past = rows[rows["xy_type"] == "past"]
        future = rows[rows["xy_type"] == "future"]
        prompt = build_prompt(past, future)

        if args.dry_run:
            print(f"\n===== [{i}] {school} / {student} / 第 {lecture} 堂（past {len(past)} 題、future {len(future)} 題）=====")
            print(prompt)
            continue

        print(f"[{i}/{len(pairs)}] {school} / {student} / 第 {lecture} 堂")
        response, tok_in, tok_out = call_llm(client, args.model, prompt)
        predictions = _extract_llm_predict_correctness(response, pattern=CORRECT_PATTERN)
        reasons = _extract_llm_predict_reason(response, pattern=REASON_PATTERN)
        labels = future.set_index("question_id")["correctness"].astype(int).to_dict()

        record = {
            "school": school, "student_id": student, "lecture": int(lecture),
            "past_accuracy": float(past["correctness"].mean()),
            "labels": labels, "predictions": predictions, "reasons": reasons,
            # 跟原本一樣：LLM 沒有每題都回答（或格式不對）就跳過這組
            "skipped": sorted(predictions) != sorted(labels),
            "tokens_in": tok_in, "tokens_out": tok_out,
            "prompt": prompt, "response": response,
        }
        if record["skipped"]:
            print(f"  格式不對，跳過。題號 label={sorted(labels)} pred={sorted(predictions)}")
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
        records.append(record)

    if args.dry_run or not records:
        return

    summary = evaluate(records)
    tok_in = sum(r["tokens_in"] for r in records)
    tok_out = sum(r["tokens_out"] for r in records)
    if args.model in PRICE:
        price_in, price_out = PRICE[args.model]
        summary["費用估算（美元）"] = round(tok_in / 1e6 * price_in + tok_out / 1e6 * price_out, 4)
    summary["token"] = {"輸入": tok_in, "輸出": tok_out}

    table, per_class = class_level(records)
    if table is not None:
        table.to_csv(out_dir / "class_level_questions.csv", index=False)
        per_class.to_csv(out_dir / "class_level_summary.csv", index=False)
        valid = per_class["spearman"].dropna()
        summary["全班層級"] = {
            "班數": len(per_class),
            "平均每班學生數": round(per_class["n_students"].mean(), 1),
            "可算排名相關的班數": len(valid),
            "平均排名相關": round(valid.mean(), 3) if len(valid) else None,
            "平均誤差（每題全班答對率）": round(per_class["mae"].mean(), 3),
        }

    (out_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"\n結果在 {out_dir}/：records.jsonl（每組的 prompt、回答、理由）、summary.json、class_level_*.csv")


if __name__ == "__main__":
    main()
