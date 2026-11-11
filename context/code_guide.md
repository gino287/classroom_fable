# Classroom Simulacra 程式碼導讀（2026-11-09）

目的：看懂他們的程式在做什麼，決定最小重現要拿哪些部分。
用法：每一節都可以單獨複製給 GPT 追問。

## 0. 網址

| 東西 | 網址 |
| --- | --- |
| 論文（arXiv） | https://arxiv.org/abs/2502.02780 |
| 程式碼和資料（GitHub） | https://github.com/songlinxu/ClassroomSimulacra |
| 資料在 repo 裡的位置 | `dataset/CogEdu/dataset_cogedu_5.csv`（主要）、`dataset/slide_all.json`、`dataset/test_all.json` |
| 程式碼在 repo 裡的位置 | `experiment/` 資料夾 |
| TIR 的 Python 套件版（作者另外整理的） | https://github.com/songlinxu/MiniHuman-Toolkit |

下載：`git clone https://github.com/songlinxu/ClassroomSimulacra.git`

## 1. 整個 repo 有什麼

```
ClassroomSimulacra/
├── dataset/
│   ├── CogEdu/dataset_cogedu_5.csv   ← 主要資料，每一列 = 一個學生答一題（tab 分隔）
│   ├── dataset_organized.csv         ← 同樣格式的整理版
│   ├── slide_all.json                ← 每堂課每張投影片的文字
│   └── test_all.json                 ← 每堂課每題的題目、對應投影片、答案
└── experiment/
    ├── llm_respond.py                (82 行)  呼叫 LLM
    ├── utils.py                      (157 行) 組 prompt、解析 LLM 回答的小工具
    ├── reflection_generation_new.py  (886 行) 主程式：不加 TIR 的預測、TIR 反思、測試
    └── bertLLMKT.py                  (303 行) BertKT＋TIR（用反思訓練 BERT），最小重現用不到
```

## 2. 資料怎麼流（一張圖看懂）

```
dataset_cogedu_5.csv
  │ 1. 丟掉課前測（只留 test_type = post test）
  │ 2. 依 data_type 分成 train（訓練學生）和 test（測試學生，18 人）
  ▼
挑一個學生 × 一堂課
  │ 3. 依 xy_type 切成 past（前 5 題）和 future（其餘題）
  ▼
組 prompt（utils.py）
  │ past 每題：題目＋那題對應的投影片文字＋這個學生答對或答錯
  │ future 每題：題目＋那題對應的投影片文字（不給答案）
  ▼
呼叫 LLM（llm_respond.py，temperature = 0）
  │ LLM 回：「Question 6: Correct, Reason: ...; Question 7: Wrong, Reason: ...」
  ▼
用正規表達式抓出每題 Correct/Wrong（utils.py）
  │
  ▼
跟真實答案比 → 這個學生 future 題的預測準確率 → 寫進 CSV
```

**最重要的一個發現**：LLM 每題只看到「那一題對應的那張投影片」（資料的 `course_content` 欄位），不是整堂課的投影片。這跟我們要做的「學生上完整堂課」不一樣。

## 3. llm_respond.py：呼叫 LLM

只有一個函式 `_response_llm_gpt(message_list, model_type)`。

- `model_type` 是數字，對應關係：3 = gpt-3.5-turbo、**4 = gpt-4o-mini**、5 = Llama-3-70B（透過 Hugging Face）、6 = gpt-4o。
- `temperature=0`：每次回答盡量一樣，方便重現。
- API key 寫死在檔案最上面，而且是空字串 `openai.api_key = ""`，要自己填（我們會改成從環境變數讀）。
- 出錯時會隨機等一段時間再重試，直到拿到回答。

**最小重現**：重寫一個簡化版，只留 OpenAI 那條路，保留 `temperature=0`。

## 4. utils.py：組 prompt、解析回答

| 函式 | 做什麼 | 最小重現 |
| --- | --- | --- |
| `_generate_past_question_correctness_info` | 把 past 每題組成文字：題目、對應投影片、學生答對或答錯 | **照搬** |
| `_generate_future_question_info` | 把 future 每題組成文字：題目、對應投影片 | **照搬** |
| `_extract_llm_predict_correctness` | 用正規表達式從 LLM 回答抓「question 6: correct」這種字，變成 `{6: 1, 7: 0}` | **照搬** |
| `_extract_llm_predict_reason` | 同上，抓每題的理由 | 照搬（看理由用） |
| `_generate_specific_eval_string` | 告訴 LLM 哪幾題它猜錯了（TIR 反思用） | 不用 |
| 其他（`question_dict_to_string` 等） | 字典和文字互轉 | 需要時照搬 |

past 的一題組出來長這樣（原文的英文，下面附中文）：

```
Question 3: In an ART network, the interface layer activates the category layer through ____ ...
This question is related to course materials below:
Details about ART1. Input layer: sends signals to ...
The student has a WRONG answer for this question 3.
```

- 第 3 題：在 ART 網路中，介面層透過 ____ 啟動類別層……
- 這題跟下面的課程教材有關：（接著是對應投影片的文字）
- 這個學生這題答錯了。

## 5. reflection_generation_new.py：主程式

分成兩個類別。

### 5.1 `LLM_Predictor`：負責跟 LLM 對話

| 方法 | 做什麼 | 屬於 |
| --- | --- | --- |
| `ideal_predict` | **不加 TIR**：給 past 和 future，直接叫 LLM 猜 future 每題對錯 | **最小重現要的** |
| `cot_predict` | 同上，但多一段「一步一步分析」的指示（CoT） | 最小重現可選 |
| `iterative_reflect` | TIR 訓練：告訴 LLM 它猜錯哪幾題 → 叫它反思 → 用反思重猜 → 比準確率 → 進步就往同方向、退步就換方向 → 重複 | TIR，之後才用 |
| `guide_predict` | 把反思加進對話，叫 LLM 重新猜（就是論文說的 novice：它看不到答案，只看到反思） | TIR |
| `guide_predict_from_history` | TIR 測試：拿其他學生的反思當示範，去猜新學生 | TIR |

`ideal_predict` 的 prompt 由三段接起來：任務說明 + past 題目 + future 題目 + 輸出格式。任務說明原文：

> Your task is to predict the student answer correctness of several future questions, based on the student answer correctness of past questions, as well as the potential correlation of concepts between past questions and future questions.

- 你的任務是預測這個學生在幾題未來題目上會不會答對。
- 根據是：這個學生過去題目的對錯，以及過去題目和未來題目之間可能相關的概念。

輸出格式原文（重點句）：

> Your output format should be: Question ID: Correct or Wrong, Reason: reason.

- 你的輸出格式要是：題號：Correct 或 Wrong，理由：……

注意：這個 prompt 是**第三人稱**，叫 LLM「預測這個學生」，不是叫 LLM「當這個學生」。這就是為什麼你覺得 TIR 不像在模擬一個人。

### 5.2 `Experiment_Reflection`：負責整個實驗流程

| 方法 | 做什麼 |
| --- | --- |
| `dataset_prepare` | 讀 CSV、丟掉課前測、抽一部分訓練學生來做反思 |
| `dataset_prepare_for_prediction` | 讀 CSV、丟掉課前測、`data_type == 'test'` 當測試學生 |
| `run_reflect_student` | 對一個訓練學生：先 `ideal_predict` 或 `cot_predict` → 再 `iterative_reflect` → 存最好的那次反思 |
| `run_predict_reuse_reflect_student` | 對一個測試學生：先算**不加 TIR** 的預測，再算**加 TIR** 的預測，兩個準確率一起寫進 `predict_post.csv`（欄位 `future_accuracy_init` 和 `future_accuracy_post`） |
| `run_exp_reflect` / `run_exp_predict_reuse_reflect` | 實驗入口，設定模型、路徑、參數 |

實際跑的參數（程式最下面）：
- 反思用 `llm_model_type=4`（gpt-4o-mini），`iter_threshold=3`（**論文沒寫的迭代上限，實際用 3**）。
- 測試用 `llm_model_type=6`（gpt-4o）、`baseline_type='CoT'`、每堂課 4 位學生的反思當示範。

## 6. 要小心的地方

1. **檔案一被執行就會開始跑實驗**：第 872 行左右直接呼叫了 `run_exp_reflect()`，沒有放在 `if __name__ == "__main__":` 裡。不能直接 import 這個檔案，會開始花錢呼叫 API。
2. API key 寫死在程式裡，而且是空的。
3. 結果寫到 `../study_results_gpt4o-.../` 這種資料夾，路徑要自己改。
4. 用了 `multiprocessing` 平行跑很多學生，除錯時不好讀。我們的最小版本先用一般迴圈。
5. LLM 回答格式不對時，那個學生會被直接跳過（印出 "NO MATCH" 或 "failed"），算準確率時要記得有幾個被跳過。

## 7. 最小重現要拿哪些

**目標**：用 gpt-4o-mini 跑「不加 TIR」的 `ideal_predict`，在 18 位測試學生上算 future 題的預測準確率。

| 要的 | 從哪裡拿 | 怎麼拿 |
| --- | --- | --- |
| 讀資料、丟課前測、選 test 學生、切 past/future | `dataset_prepare_for_prediction`、`run_predict_reuse_reflect_student` 前半 | 重寫成簡單版 |
| 組 prompt 的兩個函式 | `utils.py` | 照搬 |
| `ideal_predict` 的 prompt 文字 | `reflection_generation_new.py` | **一字不改照搬**（數字才能比） |
| 呼叫 LLM | `llm_respond.py` | 簡化重寫，key 從環境變數讀 |
| 解析回答 | `utils.py` 的 `_extract_llm_predict_correctness` | 照搬 |
| 算準確率、存結果 | 自己寫 | 每題的預測、真實答案、理由都存下來，方便人工看 |

**不需要**：`iterative_reflect`、`guide_predict*`、`bertLLMKT.py`、`multiprocessing`。

**多做一步（對我們的研究）**：把每個學生的預測加總成「每堂課每題的全班預測正確率」，算出「用了個人資料時，全班卡點能預測多準」。

**費用**：18 位測試學生、54 個（學生×課程）組合，約 54 次呼叫，gpt-4o-mini 約 0.02 美元。

**要對照的數字**：論文文字只寫「沒有 TIR 時，所有 LLM 都低於 SimpleKT 的 0.656」，各 LLM 精確值只畫在圖 9。所以我們預期不加 TIR 的 gpt-4o-mini 準確率低於 0.656，再從圖 9 讀大概的數值比較。
