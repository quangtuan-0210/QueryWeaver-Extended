"""Analysis agent for analyzing user queries and generating database analysis."""

from typing import List
from .utils import BaseAgent, parse_response, run_completion


class AnalysisAgent(BaseAgent):
    # pylint: disable=too-few-public-methods
    """Agent for analyzing user queries and generating database analysis."""

    def get_analysis(  # pylint: disable=too-many-arguments, too-many-positional-arguments
        self,
        user_query: str,
        combined_tables: list,
        db_description: str,
        instructions: str | None = None,
        memory_context: str | None = None,
        database_type: str | None = None,
        user_rules_spec: str | None = None,
    ) -> dict:
        """Get analysis of user query against database schema."""
        formatted_schema = self._format_schema(combined_tables)
        # Add system message with database type if not already present
        if not self.messages or self.messages[0].get("role") != "system":
            self.messages.insert(0, {
                "role": "system",
                "content": (
                    f"You are a SQL expert. TARGET DATABASE: "
                    f"{database_type.upper() if database_type else 'UNKNOWN'}"
                )
            })

        prompt = self._build_prompt(
            user_query, formatted_schema, db_description,
            instructions, memory_context, database_type, user_rules_spec
        )
        self.messages.append({"role": "user", "content": prompt})

        response = run_completion(
            self.messages, self.custom_model, self.custom_api_key, temperature=0
        )
        analysis = parse_response(response)
        
        # Post-processing for ambiguities and missing_information
        for field in ["ambiguities", "missing_information"]:
            if isinstance(analysis.get(field), list):
                analysis[field] = [item.replace("-", " ") for item in analysis[field]]
                analysis[field] = "- " + "- ".join(analysis[field])
        
        self.messages.append({"role": "assistant", "content": analysis["sql_query"]})
        return analysis

    def _format_schema(self, schema_data: List) -> str:
        formatted_schema = []
        for table_info in schema_data:
            table_str = self._format_single_table(table_info)
            formatted_schema.append(table_str)
        return "\n".join(formatted_schema)

    def _format_single_table(self, table_info: List) -> str:
        table_name = table_info[0]
        table_description = table_info[1]
        foreign_keys = table_info[2]
        columns = table_info[3]

        table_str = f"Table: {table_name} - {table_description}\n"
        table_str += self._format_table_columns(columns)
        table_str += self._format_foreign_keys(foreign_keys)
        return table_str

    def _format_table_columns(self, columns: List) -> str:
        columns_str = ""
        for column in columns:
            col_name = column.get("columnName", "")
            col_type = column.get("dataType", None)
            col_description = column.get("description", "")
            col_key = column.get("keyType", None)
            nullable = column.get("nullable", False)

            key_info = (", PRIMARY KEY" if col_key == "PRI" else ", FOREIGN KEY" if col_key == "FK" else "")
            columns_str += f"  - {col_name} ({col_type},{key_info},{col_key},{nullable}): {col_description}\n"
        return columns_str

    def _format_foreign_keys(self, foreign_keys: dict) -> str:
        if not isinstance(foreign_keys, dict) or not foreign_keys:
            return ""
        fk_str = "  Foreign Keys:\n"
        for fk_name, fk_info in foreign_keys.items():
            fk_str += f"  - {fk_name}: {fk_info.get('column', '')} references {fk_info.get('referenced_table', '')}.{fk_info.get('referenced_column', '')}\n"
        return fk_str

    def _build_prompt(self, user_input: str, formatted_schema: str,
                      db_description: str, instructions, memory_context: str | None = None,
                      database_type: str | None = None, user_rules_spec: str | None = None) -> str:
        
        instructions = (instructions or "").strip()
        user_rules_spec = (user_rules_spec or "").strip()
        memory_context = (memory_context or "").strip()

        user_rules_section = f"\n<user_rules_spec>\n{user_rules_spec}\n</user_rules_spec>" if user_rules_spec else ""
        instructions_section = f"\n<instructions>\n{instructions}\n</instructions>" if instructions else ""
        memory_section = f"\n<memory_context>\n{memory_context}\n</memory_context>" if memory_context else ""

        prompt = f"""
            You are a professional Text-to-SQL system. You MUST strictly follow the rules below in priority order.

            TARGET DATABASE: {database_type.upper() if database_type else 'UNKNOWN'}

            IMMUTABLE SAFETY RULES:
            S1. Schema correctness: Use ONLY existing tables/columns.
            S2. Single statement: Output exactly ONE valid SQL statement.
            S3. Valid JSON output: Provide complete, valid JSON. No markdown.

            PRIORITY: <user_rules_spec> > <instructions> > Production Rules (P1-P14).

            DEFAULT PRODUCTION RULES:
            ... (P1-P13 as defined previously) ...
            P14. Visualization Intent: If the query asks for a chart, graph, or visualization (e.g., "vẽ biểu đồ", "đồ thị", "thống kê"), you MUST include a "visualization" object. 
                - Set "default_view" to "chart" if a chart is explicitly requested; otherwise "table".
                - Identify "chart_type" (bar, pie, line).
                - Identify "label_column" and "value_column" from your SQL.

            <database_description>{db_description}</database_description>
            <database_schema>{formatted_schema}</database_schema>
            {user_rules_section}{instructions_section}{memory_section}
            <user_query>{user_input}</user_query>

            Provide output ONLY in this JSON structure:
            {{
                "is_sql_translatable": true or false,
                "query_analysis": "...",
                "explanation": "...",
                "sql_query": "...",
                "visualization": {{
                    "type": "bar|pie|line|null",
                    "default_view": "chart|table",
                    "label_column": "column_name_for_labels",
                    "value_column": "column_name_for_values"
                }},
                "tables_used": [],
                "missing_information": [],
                "ambiguities": [],
                "confidence": 0-100
            }}
        """
        return prompt