import pandas as pd
import numpy as np
import sys
import json
import io
import traceback

log_buffer = io.StringIO()
def log_error(message): print(f"ERROR_NORM: {message}", file=log_buffer)
def log_info(message): print(f"INFO_NORM: {message}", file=log_buffer)

def normalize_series(input_json_str):
    try:
        input_data = json.loads(input_json_str)
        numerator_data = input_data.get('numerator_data') # [[ts, val], ...]
        denominator_data = input_data.get('denominator_data') # [[ts, val], ...]
        numerator_name = input_data.get('numerator_name', 'Num')
        denominator_name = input_data.get('denominator_name', 'Denom')

        if not numerator_data or not denominator_data: return json.dumps({"error": "Missing numerator or denominator data."})

        log_info(f"Normalizing '{numerator_name}' by '{denominator_name}'")

        # Создаем Series для числителя
        ts_num = [pd.to_datetime(p[0], errors='coerce') for p in numerator_data]
        val_num = [p[1] for p in numerator_data]
        mask_num = [pd.notna(ts) for ts in ts_num]
        if not any(mask_num): return json.dumps({"error": "Numerator has no valid timestamps."})
        series_num = pd.Series([v for v, m in zip(val_num, mask_num) if m], index=pd.DatetimeIndex([t for t, m in zip(ts_num, mask_num) if m]), dtype=np.float64)
        series_num = series_num[~series_num.index.duplicated(keep='first')].sort_index()

        # Создаем Series для знаменателя
        ts_den = [pd.to_datetime(p[0], errors='coerce') for p in denominator_data]
        val_den = [p[1] for p in denominator_data]
        mask_den = [pd.notna(ts) for ts in ts_den]
        if not any(mask_den): return json.dumps({"error": "Denominator has no valid timestamps."})
        series_den = pd.Series([v for v, m in zip(val_den, mask_den) if m], index=pd.DatetimeIndex([t for t, m in zip(ts_den, mask_den) if m]), dtype=np.float64)
        series_den = series_den[~series_den.index.duplicated(keep='first')].sort_index()

        if series_num.empty or series_den.empty: return json.dumps({"error": "Numerator or Denominator series empty after cleaning."})

        # Выравниваем ряды по индексу (важно!)
        # Используем outer join, чтобы сохранить все даты, интерполируем знаменатель при необходимости
        aligned_num, aligned_den = series_num.align(series_den, join='outer')

        # Интерполируем пропуски в знаменателе, если необходимо (например, если частоты разные)
        # TODO: Возможно, нужна более умная интерполяция или ресемплинг перед делением
        aligned_den_filled = aligned_den.interpolate(method='linear').ffill().bfill()

        # Выполняем деление
        normalized_series = aligned_num / aligned_den_filled
        # Заменяем inf/-inf на NaN (деление на 0)
        normalized_series.replace([np.inf, -np.inf], np.nan, inplace=True)
        # Удаляем строки, где результат NaN (возможно, из-за отсутствия данных в числителе)
        normalized_series.dropna(inplace=True)

        if normalized_series.empty: return json.dumps({"error": "Result is empty after normalization (check for division by zero or missing data)."})

        # Конвертируем результат
        result_data = [[idx.isoformat(), (float(val) if pd.notna(val) else None)] for idx, val in normalized_series.items()]
        log_info(f"Normalization successful. Result length: {len(result_data)}")
        return json.dumps({"result_data": result_data})

    except Exception as e:
        log_error(f"Unexpected error: {str(e)}")
        traceback.print_exc(file=log_buffer)
        return json.dumps({"error": f"An unexpected error occurred: {str(e)}"})

if __name__ == "__main__":
    input_json = sys.stdin.read()
    result = normalize_series(input_json)
    sys.stderr.write(log_buffer.getvalue())
    print(result)