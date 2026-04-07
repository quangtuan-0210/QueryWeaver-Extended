"""MSSQL loader for loading database schemas into FalkorDB graphs."""

import datetime
import decimal
import logging
import re
from typing import AsyncGenerator, Dict, Any, List, Tuple
 
import tqdm
import pymssql

from api.loaders.base_loader import BaseLoader
from api.loaders.graph_loader import load_to_graph

class MSSQLQueryError(Exception):
    """Exception raised for MSSQL query execution errors."""

class MSSQLConnectionError(Exception):
    """Exception raised for MSSQL connection errors."""

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

class MSSQLLoader(BaseLoader):
    """
    Loader for SQL Server (MSSQL) databases that connects and extracts schema information.
    """

    SCHEMA_MODIFYING_OPERATIONS = {
        'CREATE', 'ALTER', 'DROP', 'RENAME', 'TRUNCATE'
    }

    SCHEMA_PATTERNS = [
        r'^\s*CREATE\s+TABLE',
        r'^\s*CREATE\s+INDEX',
        r'^\s*CREATE\s+UNIQUE\s+INDEX',
        r'^\s*ALTER\s+TABLE',
        r'^\s*DROP\s+TABLE',
        r'^\s*DROP\s+INDEX',
        r'^\s*RENAME\s+TABLE',
        r'^\s*TRUNCATE\s+TABLE',
        r'^\s*CREATE\s+VIEW',
        r'^\s*DROP\s+VIEW',
        r'^\s*CREATE\s+DATABASE',
        r'^\s*DROP\s+DATABASE',
        r'^\s*CREATE\s+SCHEMA',
        r'^\s*DROP\s+SCHEMA',
    ]

    @staticmethod
    def _execute_sample_query(
        cursor, table_name: str, col_name: str, sample_size: int = 3
    ) -> List[Any]:
        """
        Execute query to get random sample values for a column.
        MSSQL implementation using a subquery to bypass the DISTINCT + ORDER BY NEWID() limitation.
        """
        query = f"""
            SELECT TOP {sample_size} [{col_name}]
            FROM (
                SELECT DISTINCT [{col_name}]
                FROM [{table_name}]
                WHERE [{col_name}] IS NOT NULL
            ) AS SampleData
            ORDER BY NEWID();
        """
        cursor.execute(query)

        sample_results = cursor.fetchall()
        return [row[col_name] for row in sample_results if row[col_name] is not None]
    
    @staticmethod
    def _serialize_value(value):
        if isinstance(value, (datetime.date, datetime.datetime)):
            return value.isoformat()
        if isinstance(value, datetime.time):
            return value.isoformat()
        if isinstance(value, decimal.Decimal):
            return float(value)
        if value is None:
            return None
        return value

    @staticmethod
    def _parse_mssql_url(connection_url: str) -> Dict[str, str]:
        """Parse MSSQL connection URL into components."""
        if connection_url.startswith('mssql+pymssql://'):
            url = connection_url[16:]
        else:
            raise ValueError(
                "Invalid MSSQL URL format. Expected "
                "mssql+pymssql://username:password@host:port/database"
            )

        if '@' not in url:
            raise ValueError("MSSQL URL must include username and host")

        credentials, host_db = url.split('@', 1)

        if ':' in credentials:
            username, password = credentials.split(':', 1)
        else:
            username = credentials
            password = ""

        if '/' not in host_db:
            raise ValueError("MSSQL URL must include database name")

        host_port, database = host_db.split('/', 1)

        if '?' in database:
            database = database.split('?')[0]

        if ':' in host_port:
            host, port = host_port.split(':', 1)
            port = int(port)
        else:
            host = host_port
            port = 1433

        return {
            'server': host,
            'port': str(port),
            'user': username,
            'password': password,
            'database': database
        }

    @staticmethod
    async def load(prefix: str, connection_url: str) -> AsyncGenerator[tuple[bool, str], None]:
        try:
            conn_params = MSSQLLoader._parse_mssql_url(connection_url)

            # Connect to MSSQL database (pymssql doesn't need DictCursor class, just pass as_dict=True to cursor)
            conn = pymssql.connect(**conn_params)
            cursor = conn.cursor(as_dict=True)

            db_name = conn_params['database']

            yield True, "Extracting table information..."
            entities = MSSQLLoader.extract_tables_info(cursor, db_name)

            yield True, "Extracting relationship information..."
            relationships = MSSQLLoader.extract_relationships(cursor, db_name)

            cursor.close()
            conn.close()

            yield True, "Loading data into graph..."
            await load_to_graph(f"{prefix}_{db_name}", entities, relationships,
                                 db_name=db_name, db_url=connection_url)

            yield True, (f"SQL Server schema loaded successfully. "
                         f"Found {len(entities)} tables.")

        except pymssql.Error as e:
            logging.error("MSSQL connection error: %s", e)
            yield False, f"Failed to connect to SQL Server database: {str(e)}"
        except Exception as e:
            logging.error("Error loading MSSQL schema: %s", e)
            yield False, f"Failed to load SQL Server database schema: {str(e)}"

    @staticmethod
    def extract_tables_info(cursor, db_name: str) -> Dict[str, Any]:
        entities = {}

        cursor.execute("""
            SELECT TABLE_NAME as TABLE_NAME, NULL as TABLE_COMMENT
            FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_CATALOG = %s AND TABLE_TYPE = 'BASE TABLE'
            ORDER BY TABLE_NAME;
        """, (db_name,))

        tables = cursor.fetchall()

        for table_info in tqdm.tqdm(tables, desc="Extracting table information"):
            table_name = table_info['TABLE_NAME']
            table_comment = table_info['TABLE_COMMENT']

            columns_info = MSSQLLoader.extract_columns_info(cursor, db_name, table_name)
            foreign_keys = MSSQLLoader.extract_foreign_keys(cursor, db_name, table_name)

            table_description = table_comment if table_comment else f"Table: {table_name}"
            col_descriptions = [col_info['description'] for col_info in columns_info.values()]

            entities[table_name] = {
                'description': table_description,
                'columns': columns_info,
                'foreign_keys': foreign_keys,
                'col_descriptions': col_descriptions
            }

        return entities

    @staticmethod
    def extract_columns_info(cursor, db_name: str, table_name: str) -> Dict[str, Any]:
        cursor.execute("""
            SELECT
                c.COLUMN_NAME,
                c.DATA_TYPE,
                c.IS_NULLABLE,
                c.COLUMN_DEFAULT,
                CASE 
                    WHEN pk.COLUMN_NAME IS NOT NULL THEN 'PRI'
                    WHEN fk.COLUMN_NAME IS NOT NULL THEN 'MUL'
                    ELSE '' 
                END as COLUMN_KEY,
                NULL as COLUMN_COMMENT
            FROM INFORMATION_SCHEMA.COLUMNS c
            LEFT JOIN (
                SELECT ku.TABLE_CATALOG, ku.TABLE_SCHEMA, ku.TABLE_NAME, ku.COLUMN_NAME
                FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS AS tc
                INNER JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE AS ku
                    ON tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
            ) pk ON c.TABLE_CATALOG = pk.TABLE_CATALOG AND c.TABLE_SCHEMA = pk.TABLE_SCHEMA AND c.TABLE_NAME = pk.TABLE_NAME AND c.COLUMN_NAME = pk.COLUMN_NAME
            LEFT JOIN (
                 SELECT ku.TABLE_CATALOG, ku.TABLE_SCHEMA, ku.TABLE_NAME, ku.COLUMN_NAME
                FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS AS tc
                INNER JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE AS ku
                    ON tc.CONSTRAINT_TYPE = 'FOREIGN KEY' AND tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
            ) fk ON c.TABLE_CATALOG = fk.TABLE_CATALOG AND c.TABLE_SCHEMA = fk.TABLE_SCHEMA AND c.TABLE_NAME = fk.TABLE_NAME AND c.COLUMN_NAME = fk.COLUMN_NAME
            WHERE c.TABLE_CATALOG = %s AND c.TABLE_NAME = %s
            ORDER BY c.ORDINAL_POSITION;
        """, (db_name, table_name))

        columns = cursor.fetchall()
        columns_info = {}

        for col_info in columns:
            col_name = col_info['COLUMN_NAME']
            data_type = col_info['DATA_TYPE']
            is_nullable = col_info['IS_NULLABLE']
            column_default = col_info['COLUMN_DEFAULT']
            column_key = col_info['COLUMN_KEY']
            column_comment = col_info['COLUMN_COMMENT']

            if column_key == 'PRI':
                key_type = 'PRIMARY KEY'
            elif column_key == 'MUL':
                key_type = 'FOREIGN KEY'
            elif column_key == 'UNI':
                key_type = 'UNIQUE KEY'
            else:
                key_type = 'NONE'

            description_parts = []
            if column_comment:
                description_parts.append(column_comment)
            else:
                description_parts.append(f"Column {col_name} of type {data_type}")

            if key_type != 'NONE':
                description_parts.append(f"({key_type})")

            if is_nullable == 'NO':
                description_parts.append("(NOT NULL)")

            if column_default is not None:
                description_parts.append(f"(Default: {column_default})")

            sample_values = MSSQLLoader._execute_sample_query(
                cursor, table_name, col_name
            )

            columns_info[col_name] = {
                'type': data_type,
                'null': is_nullable,
                'key': key_type,
                'description': ' '.join(description_parts),
                'default': column_default,
                'sample_values': sample_values
            }

        return columns_info

    @staticmethod
    def extract_foreign_keys(cursor, db_name: str, table_name: str) -> List[Dict[str, str]]:
        cursor.execute("""
            SELECT
                fk.name AS CONSTRAINT_NAME,
                cp.name AS COLUMN_NAME,
                tr.name AS REFERENCED_TABLE_NAME,
                cr.name AS REFERENCED_COLUMN_NAME
            FROM sys.foreign_keys fk
            INNER JOIN sys.tables tp ON fk.parent_object_id = tp.object_id
            INNER JOIN sys.tables tr ON fk.referenced_object_id = tr.object_id
            INNER JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
            INNER JOIN sys.columns cp ON fkc.parent_column_id = cp.column_id AND fkc.parent_object_id = cp.object_id
            INNER JOIN sys.columns cr ON fkc.referenced_column_id = cr.column_id AND fkc.referenced_object_id = cr.object_id
            WHERE tp.name = %s;
        """, (table_name,))

        foreign_keys = []
        for fk_info in cursor.fetchall():
            foreign_keys.append({
                'constraint_name': fk_info['CONSTRAINT_NAME'],
                'column': fk_info['COLUMN_NAME'],
                'referenced_table': fk_info['REFERENCED_TABLE_NAME'],
                'referenced_column': fk_info['REFERENCED_COLUMN_NAME']
            })

        return foreign_keys

    @staticmethod
    def extract_relationships(cursor, db_name: str) -> Dict[str, List[Dict[str, str]]]:
        cursor.execute("""
            SELECT
                tp.name AS TABLE_NAME,
                fk.name AS CONSTRAINT_NAME,
                cp.name AS COLUMN_NAME,
                tr.name AS REFERENCED_TABLE_NAME,
                cr.name AS REFERENCED_COLUMN_NAME
            FROM sys.foreign_keys fk
            INNER JOIN sys.tables tp ON fk.parent_object_id = tp.object_id
            INNER JOIN sys.tables tr ON fk.referenced_object_id = tr.object_id
            INNER JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
            INNER JOIN sys.columns cp ON fkc.parent_column_id = cp.column_id AND fkc.parent_object_id = cp.object_id
            INNER JOIN sys.columns cr ON fkc.referenced_column_id = cr.column_id AND fkc.referenced_object_id = cr.object_id
            ORDER BY TABLE_NAME, CONSTRAINT_NAME;
        """)

        relationships = {}
        for rel_info in cursor.fetchall():
            constraint_name = rel_info['CONSTRAINT_NAME']

            if constraint_name not in relationships:
                relationships[constraint_name] = []

            relationships[constraint_name].append({
                'from': rel_info['TABLE_NAME'],
                'to': rel_info['REFERENCED_TABLE_NAME'],
                'source_column': rel_info['COLUMN_NAME'],
                'target_column': rel_info['REFERENCED_COLUMN_NAME'],
                'note': f'Foreign key constraint: {constraint_name}'
            })

        return relationships

    @staticmethod
    def is_schema_modifying_query(sql_query: str) -> Tuple[bool, str]:
        if not sql_query or not sql_query.strip():
            return False, ""

        normalized_query = sql_query.strip().upper()
        first_word = normalized_query.split()[0] if normalized_query.split() else ""
        
        if first_word in MSSQLLoader.SCHEMA_MODIFYING_OPERATIONS:
            for pattern in MSSQLLoader.SCHEMA_PATTERNS:
                if re.match(pattern, normalized_query, re.IGNORECASE):
                    return True, first_word
            return True, first_word

        return False, ""

    @staticmethod
    async def refresh_graph_schema(graph_id: str, db_url: str) -> Tuple[bool, str]:
        try:
            logging.info("Schema modification detected. Refreshing graph schema.")
            from api.extensions import db

            graph = db.select_graph(graph_id)
            await graph.delete()

            parts = graph_id.split('_')
            if len(parts) >= 2:
                prefix = '_'.join(parts[:-1])
            else:
                prefix = graph_id

            success, message = False, "Started"
            async for step_success, step_msg in MSSQLLoader.load(prefix, db_url):
                success, message = step_success, step_msg

            if success:
                logging.info("Graph schema refreshed successfully.")
                return True, message

            logging.error("Schema refresh failed")
            return False, "Failed to reload schema"

        except Exception as e:
            logging.error("Error refreshing graph schema: %s", str(e))
            return False, "Error refreshing graph schema"

    @staticmethod
    def execute_sql_query(sql_query: str, db_url: str) -> List[Dict[str, Any]]:
        try:
            conn_params = MSSQLLoader._parse_mssql_url(db_url)
            conn = pymssql.connect(**conn_params)
            cursor = conn.cursor(as_dict=True)

            cursor.execute(sql_query)

            if cursor.description is not None:
                results = cursor.fetchall()
                result_list = []
                for row in results:
                    serialized_row = {
                        key: MSSQLLoader._serialize_value(value)
                        for key, value in row.items()
                    }
                    result_list.append(serialized_row)
            else:
                affected_rows = cursor.rowcount
                sql_type = sql_query.strip().split()[0].upper()

                if sql_type in ['INSERT', 'UPDATE', 'DELETE']:
                    result_list = [{
                        "operation": sql_type,
                        "affected_rows": affected_rows,
                        "status": "success"
                    }]
                else:
                    result_list = [{
                        "operation": sql_type,
                        "status": "success"
                    }]

            conn.commit()
            cursor.close()
            conn.close()

            return result_list

        except pymssql.Error as e:
            if 'conn' in locals():
                conn.rollback()
                cursor.close()
                conn.close()
            logging.error("MSSQL query execution error: %s", e)
            raise MSSQLQueryError(f"MSSQL query execution error: {str(e)}") from e
        except Exception as e:
            if 'conn' in locals():
                conn.rollback()
                cursor.close()
                conn.close()
            logging.error("Error executing SQL query: %s", e)
            raise MSSQLQueryError(f"Error executing SQL query: {str(e)}") from e