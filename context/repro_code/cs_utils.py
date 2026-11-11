"""
從 Classroom Simulacra 原始程式碼「照搬」的小工具。

出處表
| 函式 | 原本在哪 | 照搬或修改 |
| --- | --- | --- |
| _generate_past_question_correctness_info | experiment/utils.py | 一字不改照搬 |
| _generate_future_question_info           | experiment/utils.py | 一字不改照搬 |
| _extract_llm_predict_correctness         | experiment/utils.py | 一字不改照搬 |
| _extract_llm_predict_reason              | experiment/utils.py | 一字不改照搬 |

為什麼不改：prompt 跟原版一字不差，重現出來的數字才能跟論文比。
原始碼：https://github.com/songlinxu/ClassroomSimulacra/blob/main/experiment/utils.py

快速說明（細節可以把函式貼給 GPT 問）
- 前兩個函式把 pandas 表格裡的題目組成文字，past 會附上「這個學生答對/答錯」，future 不附。
  每題都會附上那題對應的投影片文字（course_content 欄位）。
- 後兩個函式用正規表達式，從 LLM 的回答抓出「question 6: correct」和理由，變成 {6: 1} 這種字典。
"""
import re


def _generate_past_question_correctness_info(data_table,include_choice = True,include_course = True):
    question_id_list = list(set(data_table['question_id']))
    question_id_list.sort()
    question_str = '\nThe past questions are depicted below: \n'
    for question_id in question_id_list:
        data_question = data_table[data_table['question_id']==question_id]
        assert len(data_question) == 1
        question_content = data_question['question_content'].values[0]
        choice_content = data_question['choice_content'].values[0] if 'choice_content' in data_question.columns else ""
        course_content = data_question['course_content'].values[0]
        correctness = int(data_question['correctness'].values[0])
        assert correctness in [0,1]
        correctness_str = f'The student has a CORRECT answer for this question {question_id}.' if correctness == 1 else f'The student has a WRONG answer for this question {question_id}.'
        if include_choice == True:
            question_str += (
                f'\n Question {question_id}: {question_content}.\n'
                # +'Choices for this question: \n'
                +choice_content+'\n\n'
            )
            if include_course:
                question_str += (
                    '\n\n This question is related to course materials below: \n'
                    +course_content+'\n\n'
                )
            question_str += (
                correctness_str+'\n'
                # +'-'*80+'\n\n'
            )
        else:
            question_str += (
                f'\n Question {question_id}: {question_content}.\n'
                +correctness_str+'\n'
            )
    return question_str


def _generate_future_question_info(data_table,include_choice = True,include_course = True):
    question_id_list = list(set(data_table['question_id']))
    question_id_list.sort()
    question_str = '\nThe future questions are depicted below: \n'
    for question_id in question_id_list:
        data_question = data_table[data_table['question_id']==question_id]
        assert len(data_question) == 1
        question_content = data_question['question_content'].values[0]
        choice_content = data_question['choice_content'].values[0] if 'choice_content' in data_question.columns else ""
        course_content = data_question['course_content'].values[0]
        if include_choice == True:
            question_str += (
                f'\n Question {question_id}: {question_content}.\n'
                # +'Choices for this question: \n'
                +choice_content+'\n\n'
            )
            if include_course:
                question_str += (
                    '\n\n This question is related to course materials below: \n'
                    +course_content+'\n'
                    # +'-'*80+'\n\n'
                )
        else:
            question_str += (
                f'\n Question {question_id}: {question_content}.\n'
            )
    return question_str


def _extract_llm_predict_correctness(input_string,pattern = r"question\s*(\d+)\s*:\s*(correct|wrong)"):
    input_string_lower = input_string.lower()
    matches = re.findall(pattern, input_string_lower)
    # print(matches)
    result_dict = {}
    # Create dictionary from matches
    for key, value in matches:
        assert value in ['correct','wrong']
        result_dict[int(key)] = 1 if value == 'correct' else 0
    
    return result_dict


def _extract_llm_predict_reason(input_string,pattern): 
    input_string_lower = input_string.lower()
    matches = re.findall(pattern, input_string_lower)
    # print(matches)
    result_dict = {}
    # Create dictionary from matches
    for key, correctness, reason in matches:
        result_dict[int(key)] = reason.strip().replace('\n','. ').replace('\t','. ')
    
    return result_dict
