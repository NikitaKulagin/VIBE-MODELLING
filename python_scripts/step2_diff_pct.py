import pandas as pd
import numpy as np
import sys
import json
import io
import traceback

log_buffer = io.StringIO()
def log_error(message): print(f"ERROR_DIFF_PCT: {message}", file=log_buffer)
def log_info(message): print(f"INFO_DIFF_PCT: {message}", file=log_buffer)

def calculate_diff_pct(input_json_str):
    try:
        input_data = json.loads(input_json_str)
        series_data = input_data.get('series_data')
        periods = int(input_data.get('periods', 1))
        series_name = input_data.get('series_name', 'Unknown')

        if not series_data or not isinstance(series_data, list): return json.dumps({"error": "Invalid input: 'series_data'"})
        if periods <= 0: return json.dumps({"error": "Invalid input: 'periods'"})

        log_info(f"Calculating percentage difference for '{series_name}' with periods={periods}")

        # Создаем Series
        timestamps = [pd.to_datetime(p[0], errors='coerce') for p in series_data]
        values = [p[1] for p in series_data]
        valid_mask = [pd.notna(ts) for ts in timestamps]
        if not any(valid_mask): return json.dumps({"error": "No valid timestamps."})
        valid_timestamps = [ts for ts, mask in zip(timestamps, valid_mask) if mask]
        valid_values = [val for val, mask in zip(values, valid_mask) if mask]
        series = pd.Series(valid_values, index=pd.DatetimeIndex(valid_timestamps), dtype=np.float64)
        series = series[~series.index.duplicated(keep='first')].sort_index()
        if series.empty: return json.dumps({"error": "Series empty after cleaning."})

        # Вычисляем процентное приращение и умножаем на 100
        diff_series = series.pct_change(periods=periods) * 100
        # Заменяем inf/-inf на NaN (может возникнуть при делении на 0)
        diff_series.replace([np.inf, -np.inf], np.nan, inplace=True)

        # Конвертируем результат
        result_data = [[idx.isoformat(), (float(val) if pd.notna(val) else None)] for idx, val in diff_series.items()]
        log_info(f"Calculation successful. Result length: {len(result_data)}")
        return json.dumps({"result_data": result_data})

    except Exception as e:
        log_error(f"Unexpected error: {str(e)}")
        traceback.print_exc(file=log_buffer)
        return json.dumps({"error": f"An unexpected error occurred: {str(e)}"})

if __name__ == "__main__":
    input_json = sys.stdin.read()
    result = calculate_diff_pct(input_json)
    sys.stderr.write(log_buffer.getvalue())
    print(result)