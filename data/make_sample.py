"""
從 Classroom Simulacra 原始資料產生前端用的範例檔（只含真實資料的部分）。
用法：python data/make_sample.py --repo <ClassroomSimulacra 資料夾>
輸出：data/lectures_real.json
"""
import argparse, json
from pathlib import Path
import pandas as pd

ap = argparse.ArgumentParser()
ap.add_argument("--repo", required=True)
ap.add_argument("--out", default="data/lectures_real.json")
args = ap.parse_args()
repo = Path(args.repo) / "dataset"
slides_all = json.loads((repo / "slide_all.json").read_text(encoding="utf-8"))
tests_all = json.loads((repo / "test_all.json").read_text(encoding="utf-8"))
df = pd.read_csv(repo / "CogEdu" / "dataset_cogedu_5.csv", sep="\t")

lectures = []
for school, by_lec in slides_all.items():
    for lec_key, slides in by_lec.items():
        lec = int(lec_key.split()[-1])
        d = df[(df.school == school) & (df.course_name == lec)]
        questions = []
        for qk, q in tests_all[school][lec_key].items():
            qid = int(qk[1:])
            post = d[(d.question_id == qid) & (d.test_type == "post test")]
            pre = d[(d.question_id == qid) & (d.test_type == "pre test")]
            if len(post) == 0:
                continue
            questions.append({
                "qid": qid, "slide_id": int(q["slide"]), "text": q["contents"], "answer": q["correct_answer"],
                "real": {"pre_rate": round(pre.correctness.mean(), 3) if len(pre) else None,
                         "post_rate": round(post.correctness.mean(), 3),
                         "n_pre": int(len(pre)), "n_post": int(len(post))},
            })
        lectures.append({
            "school": school, "lecture_id": lec,
            "slides": [{"id": int(k.split()[-1]), "text": v} for k, v in slides.items()],
            "questions": sorted(questions, key=lambda x: x["qid"]),
            "n_students_post": int(d[d.test_type == "post test"].student_id.nunique()),
        })
Path(args.out).write_text(json.dumps(lectures, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"寫入 {args.out}：{len(lectures)} 堂課")
