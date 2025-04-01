import pandas as pd
import sys
import json
import io

log_buffer = io.StringIO()
def log_debug(message):
    print(f"DEBUG_GET_SHEETS: {message}", file=log_buffer)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        # Выводим ошибку в stderr, чтобы основной вывод был чистым JSON или отсутствовал
        print(json.dumps({"error": "No Excel file path provided to get_sheets.py."}), file=sys.stderr)
        sys.exit(1) # Выход с ошибкой

    file_path = sys.argv[1]
    log_debug(f"Attempting to read sheet names from: {file_path}")

    try:
        # Используем pandas.ExcelFile для эффективного получения имен листов
        xls = pd.ExcelFile(file_path)
        sheet_names = xls.sheet_names
        log_debug(f"Successfully read sheet names: {sheet_names}")
        # Выводим результат (список имен) в stdout как JSON
        print(json.dumps(sheet_names))

    except FileNotFoundError:
        log_debug(f"File not found: {file_path}")
        print(json.dumps({"error": f"File not found: {file_path}"}), file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        log_debug(f"Error reading sheet names: {e}")
        # Выводим ошибку в stderr
        print(json.dumps({"error": f"Error reading Excel file structure: {str(e)}"}), file=sys.stderr)
        sys.exit(1)
    finally:
        # Выводим весь лог в stderr в любом случае
        sys.stderr.write(log_buffer.getvalue())