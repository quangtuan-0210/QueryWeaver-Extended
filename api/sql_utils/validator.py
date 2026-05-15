import sqlglot
from sqlglot import exp
from sqlglot.errors import ParseError

class SQLValidator:
    def __init__(self, restricted_columns=None):
        # KHÔNG CẦN SCHEMA NỮA
        self.restricted_columns = [col.lower() for col in (restricted_columns or [])]

    def validate(self, query: str, dialect: str = "mysql"):
        try:
            # 1. Phân tích AST và tạo chuỗi cấu trúc cây
            ast = sqlglot.parse_one(query, read=dialect)
            ast_tree_str = repr(ast) # ĐÂY CHÍNH LÀ NỘI DUNG ĐỂ IN RA NÚT XEM CÂY
            
            errors = []
            
            # 2. Quét lỗi Rule và Join
            errors.extend(self._validate_rules(ast))
            errors.extend(self._validate_joins(ast))

            if errors:
                return False, errors, ast_tree_str
            
            return True, ast.sql(dialect=dialect), ast_tree_str

        except ParseError as e:
            return False, [f"Cú pháp SQL không hợp lệ: {str(e)}"], "Không thể tạo AST do lỗi cú pháp"
        except Exception as e:
            return False, [f"Lỗi hệ thống máy quét: {str(e)}"], "Lỗi không xác định"

    def _validate_rules(self, ast):
        errors = []
        
        # Cấm DELETE, UPDATE
        if not isinstance(ast, exp.Select):
            errors.append("Rule Violation: Chỉ cho phép dùng lệnh SELECT.")
            return errors 

        # Cấm SELECT *
        for star in ast.find_all(exp.Star):
            if not isinstance(star.parent, exp.Count):
                errors.append("Rule Violation: Không được dùng 'SELECT *'.")
                break

        # Bắt buộc có LIMIT < 20
        limit_node = ast.args.get("limit")
        if not limit_node:
            errors.append("Rule Violation: Bắt buộc phải có LIMIT ở cuối câu.")
        else:
            try:
                limit_val = int(str(limit_node.expression))
                if limit_val >= 20:
                    errors.append(f"Rule Violation: LIMIT phải < 20 (Đang là {limit_val}).")
            except Exception:
                pass

        return errors

    def _validate_joins(self, ast):
        errors = []
        for join in ast.find_all(exp.Join):
            if not join.args.get("on") and not join.args.get("using"):
                errors.append("JOIN Violation: Thiếu điều kiện ON hoặc USING.")
        return errors