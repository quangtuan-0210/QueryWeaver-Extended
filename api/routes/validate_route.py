import sqlglot
from sqlglot import exp
from fastapi import APIRouter
from pydantic import BaseModel
from api.sql_utils.validator import SQLValidator
import traceback

router = APIRouter()

class ValidateRequest(BaseModel):
    sql: str
    schema_text: str = ""
    dialect: str = "mysql" 

def ast_to_json(node):
    """
    Hàm chuyển đổi cây AST thành JSON, đã CẮT TỈA các cờ True/False cho gọn mắt.
    """
    # Nếu là giá trị cuối cùng (không phải node)
    if not isinstance(node, exp.Expression):
        # NẾU LÀ KIỂU TRUE/FALSE (BOOL) -> TRẢ VỀ NONE ĐỂ GIẤU ĐI
        if isinstance(node, bool):
            return None
        return {"name": str(node)}
        
    result = {"name": node.__class__.__name__}
    children = []
    
    for key, val in node.args.items():
        if val is None or val == []:
            continue
            
        if isinstance(val, list):
            for item in val:
                child = ast_to_json(item)
                if child is not None: # Chỉ thêm nếu không phải None
                    children.append(child)
        else:
            child = ast_to_json(val)
            if child is not None: # Chỉ thêm nếu không phải None
                children.append(child)
            
    if children:
        result["children"] = children
        
    return result

@router.post("/validate")
async def validate_sql_endpoint(request: ValidateRequest):
    try:
        my_validator = SQLValidator()
        
        # Validator cũ vẫn chạy bình thường để lấy logic kiểm tra an toàn
        is_valid, result, _ = my_validator.validate(request.sql, dialect="mysql")
        
        # --- ĐOẠN CODE MỚI: TẠO JSON CHO REACT-D3-TREE ---
        try:
            # Parse câu SQL thành cây AST của sqlglot
            parsed_expr = sqlglot.parse_one(request.sql, dialect="mysql")
            # Chuyển đổi cây AST thành JSON
            json_ast = ast_to_json(parsed_expr)
        except Exception as parse_err:
            # Nếu câu SQL sai cú pháp nặng không parse nổi, nhả về lỗi
            json_ast = {"name": "Lỗi Cú Pháp", "children": [{"name": str(parse_err)}]}
        
        if is_valid:
            return {
                "status": "success", 
                "is_valid": True, 
                "final_ast": result,
                "ast_tree": json_ast # LÚC NÀY NÓ ĐÃ LÀ JSON CHUẨN XỊN
            }
        else:
            return {
                "status": "failed", 
                "is_valid": False, 
                "logs": result if isinstance(result, list) else [result],
                "ast_tree": json_ast # DÙ LỖI VẪN TRẢ JSON ĐỂ VẼ CÂY
            }
            
    except Exception as e:
        return {
            "status": "failed", 
            "is_valid": False, 
            "logs": [f"🛑 Backend bị sập: {str(e)}"],
            "ast_tree": {
                "name": "Backend Error",
                "children": [{"name": str(e)}]
            }
        }