import sqlglot
from sqlglot import exp
from sqlglot.optimizer.qualify import qualify
from fastapi import APIRouter
from pydantic import BaseModel
from api.sql_utils.validator import SQLValidator
import traceback

router = APIRouter()

class ValidateRequest(BaseModel):
    sql: str
    schema_text: str = ""
    dialect: str = "mysql" 
    sensitive_columns: list[str] = [] # NHẬN DANH SÁCH CỘT CẤM TỪ GIAO DIỆN

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
        # --- ĐOẠN CODE MỚI: KIỂM TRA BẢO MẬT CỘT NHẠY CẢM ---
        if request.sensitive_columns:
            try:
                parsed_tree = sqlglot.parse_one(request.sql, dialect=request.dialect)
                qualified_tree = parsed_tree.copy()
                
                # Lột mặt nạ bí danh (VD: c.Name -> artists.Name)
                try: 
                    qualify(qualified_tree) 
                except: 
                    pass
                
                # Chuyển danh sách cấm thành chữ thường và xóa khoảng trắng
                lower_sensitive = [c.lower().strip() for c in request.sensitive_columns]
                
                # Quét toàn bộ Node Column trên cây AST
                for column_node in qualified_tree.find_all(exp.Column):
                    t_name = column_node.text("table").lower()
                    c_name = column_node.text("this").lower()
                    
                    full_col = f"{t_name}.{c_name}" if t_name else ""
                    
                    # Nếu tên cột hoặc định dạng bảng.cột nằm trong danh sách cấm
                    if full_col in lower_sensitive or c_name in [s.split('.')[-1] for s in lower_sensitive]:
                        return {
                            "status": "failed", 
                            "is_valid": False, 
                            "logs": [f"🚨 AI vi phạm quy tắc: Cố tình truy cập cột nhạy cảm '{c_name}'!"],
                            "ast_tree": {"name": "🔒 Security Blocked", "children": [{"name": "Từ chối truy cập dữ liệu nhạy cảm"}]}
                        }
            except Exception:
                # Bỏ qua nếu lỗi cú pháp nặng không parse nổi (sẽ bị bắt ở validator dưới)
                pass

        # --- VALIDATOR GỐC ---
        my_validator = SQLValidator()
        # Khởi tạo validator cũ vẫn chạy bình thường để lấy logic kiểm tra an toàn
        is_valid, result, _ = my_validator.validate(request.sql, dialect=request.dialect)
        
        # --- TẠO JSON CHO REACT-D3-TREE ---
        try:
            # Parse câu SQL thành cây AST của sqlglot
            parsed_expr = sqlglot.parse_one(request.sql, dialect=request.dialect)
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
            "logs": [f"Backend Error: {str(e)}"],
            "ast_tree": {"name": "Error", "children": [{"name": str(e)}]}
        }