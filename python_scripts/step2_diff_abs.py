import pandas as pd
import numpy as np
import sys
import json
import io
import traceback

log_buffer = io.StringIO()
def log_error(message): print(f"ERROR_DIFF_ABS: {message}", file=log_buffer)
def log_info(message): print(f"INFO_DIFF_ABS: {message}", file=log_buffer)

def calculate_diff_abs(input_json_str):
    try:
        input_data = json.loads(input_json_str)
        series_data = input_data.get('series_data') # Ожидаем [[ts, val], ...]
        periods = int(input_data.get('periods', 1)) # Период для diff, по умолчанию 1
        series_name = input_data.get('series_name', 'Unknown') # Для логирования

        if not series_data or not isinstance(series_data, list):
            return json.dumps({"error": "Invalid input: 'series_data' missing or not a list."})
        if periods <= 0:
             return json.dumps({"error": "Invalid input: 'periods' must be positive."})

        log_info(f"Calculating absolute difference for '{series_name}' with periods={periods}")

        # Создаем Series
        timestamps = [pd.to_datetime(p[0], errors='coerce') for p in series_data]
        values = [p[1] for p in series_data]
        valid_mask = [pd.notna(ts) for ts in timestamps]
        if not any(valid_mask): return json.dumps({"error": "No valid timestamps found."})
        valid_timestamps = [ts for ts, mask in zip(timestamps, valid_mask) if mask]
        valid_values = [val for val, mask in zip(values, valid_mask) if mask]
        series = pd.Series(valid_values, index=pd.DatetimeIndex(valid_timestamps), dtype=np.float64)
        series = series[~series.index.duplicated(keep='first')].sort_index()
        if series.empty: return json.dumps({"error": "Series is empty after cleaning."})

        # Вычисляем абсолютное приращение
        diff_series = series.diff(periods=periods)
        # Первые 'periods' значений будут NaN, это нормально
        # diff_series = diff_series.dropna() # Можно удалить NaN, но лучше оставить для сохранения индекса

        # Конвертируем результат обратно
        result_data = [
            [idx.isoformat(), (float(val) if pd.notna(val) else None)]
            for idx, val in diff_series.items()
        ]
        log_info(f"Calculation successful. Result length: {len(result_data)}")
        return json.dumps({"result_data": result_data})

    except json.JSONDecodeError: return json.dumps({"error": "Invalid JSON input."})
    except ValueError as ve: return json.dumps({"error": f"Value error: {str(ve)}"})
    except Exception as e:
        log_error(f"Unexpected error: {str(e)}")
        traceback.print_exc(file=log_buffer)
        return json.dumps({"error": f"An unexpected error occurred: {str(e)}"})

if __name__ == "__main__":
    input_json = sys.stdin.read()
    result = calculate_diff_abs(input_json)
    sys.stderr.write(log_buffer.getvalue()) # Вывод логов в stderr
    print(result) # Вывод результата (JSON) в stdout