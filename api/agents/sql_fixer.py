import requests
import json
import re
import os
from dotenv import load_dotenv

load_dotenv()

API_URL = os.getenv("LLM_API_URL", "http://localhost:8000/v1/chat/completions")
MODEL_NAME = os.getenv("LLM_MODEL_NAME", "unknown-model")

# Đã thêm tham số history="" vào cuối
def ask_llm_to_fix(bad_sql, error_msg, schema_info="", restricted_info="", history="",dialect: str="mysql"):
    system_prompt = (
        "Bạn là một SQL Optimizer cực kỳ nghiêm khắc.\n"
        f"LƯU Ý QUAN TRỌNG: Câu lệnh phải được viết chuẩn theo cú pháp của hệ quản trị CSDL '{dialect.upper()}'.\n"
        "- Nếu là 'TSQL' (SQL Server): Bắt buộc dùng SELECT TOP thay cho LIMIT.\n"
        "- Nếu là 'POSTGRES' hoặc 'MYSQL': Dùng LIMIT.\n\n"
        "DATABASE SCHEMA BẠN PHẢI TUÂN THỦ:\n"
        f"{schema_info}\n\n"
        "CÁC CỘT BỊ CẤM (KHÔNG ĐƯỢC DÙNG):\n"
        f"{restricted_info}\n\n"
        "HƯỚNG DẪN SỬA LỖI:\n"
        "1. Nếu lỗi là 'SELECT *', bạn CẤM tuyệt đối dùng dấu '*'. Hãy nhìn vào Schema bên trên, lấy TẤT CẢ các cột hợp lệ và liệt kê chúng ra (VD: SELECT col1, col2, col3...).\n"
        "2. Nếu lỗi là 'Column not resolved', bạn đã lấy sai tên cột. Hãy chỉ được chọn cột có trong Schema của bảng đó.\n"
        "3. TRẢ VỀ DUY NHẤT CÂU SQL. KHÔNG GIẢI THÍCH, KHÔNG CHÀO HỎI."
    )

    # Bơm "trí nhớ" vào để AI không đi vào vết xe đổ
    if history:
        system_prompt += f"\n\n⚠️ LƯU Ý QUAN TRỌNG: Lần trước bạn đã thử trả về câu lệnh '{history}' nhưng VẪN BỊ LỖI. TUYỆT ĐỐI KHÔNG lặp lại câu lệnh này, hãy tìm cách viết khác!"

    # Bổ sung thông tin về các cột bị cấm để AI biết đường né
    security_context = f"\nLƯU Ý BẢO MẬT: Tuyệt đối không sử dụng các cột hoặc điều kiện sau:\n{restricted_info}\n" if restricted_info else ""
    
    user_prompt = f"SQL gốc: {bad_sql}\nLỗi: {error_msg}\n{schema_info}\n{security_context}\nHãy sửa lại câu SQL."

    headers = {"Content-Type": "application/json"}
    payload = {
        "model": MODEL_NAME,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "temperature": 0.1,
        "max_tokens": 200
    }

    try:
        response = requests.post(API_URL, headers=headers, json=payload, timeout=30)
        response.raise_for_status() 
        
        result = response.json()
        fixed_sql = result['choices'][0]['message']['content'].strip()
        
        fixed_sql = re.sub(r"^```[a-zA-Z]*\n", "", fixed_sql)
        fixed_sql = re.sub(r"\n```$", "", fixed_sql)        
        fixed_sql = fixed_sql.strip()

        print(f"   🤖 [{MODEL_NAME}] Đề xuất bản vá: {fixed_sql}")
        return fixed_sql

    except requests.exceptions.ConnectionError:
        print(f"   ❌ [LỖI MẠNG] Không thể kết nối tới {API_URL}. Hãy kiểm tra server local.")
        return bad_sql
    except Exception as e:
        print(f"   ❌ [LỖI API] Có lỗi xảy ra: {e}")
        return bad_sql