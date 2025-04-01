import pandas as pd
import numpy as np
import sys
import json
import io
import traceback

log_buffer = io.StringIO()
def log_error(message): print(f"ERROR_AGG: {message}", file=log_buffer)
def log_warn(message): print(f"WARN_AGG: {message}", file=log_buffer)
def log_info(message): print(f"INFO_AGG: {message}", file=log_buffer)

FREQ_MAP = {'Q': 'Q', 'M': 'M', 'A': 'A', 'Y': 'A', 'W': 'W', 'D': 'D', 'B': 'B'}

def get_period_order(freq_code):
    order = {'A': 5, 'Y': 5, 'Q': 4, 'M': 3, 'W': 2, 'B': 1, 'D': 1}
    return order.get(str(freq_code).upper(), 0)

def aggregate_series_data(input_json_str):
    try:
        input_data = json.loads(input_json_str)
        target_freq_code_simple = input_data.get('target_frequency')
        series_list = input_data.get('series_list')
        if not target_freq_code_simple or not series_list or not isinstance(series_list, list):
            return json.dumps({"error": "Invalid input JSON"})
        target_freq_pd = FREQ_MAP.get(target_freq_code_simple.upper())
        if not target_freq_pd:
            return json.dumps({"error": f"Unsupported target frequency: {target_freq_code_simple}"})
        log_info(f"Target frequency: {target_freq_code_simple} (Pandas code: {target_freq_pd})")
        processed_data = {}
        target_order = get_period_order(target_freq_code_simple)
    except Exception as e: return json.dumps({"error": f"Error parsing input: {str(e)}"})

    for series_obj in series_list:
        series_name = series_obj.get('name')
        data_points = series_obj.get('data')
        original_freq_simple = series_obj.get('frequency', 'Unknown')
        metadata = series_obj.get('metadata', {})
        flow_level = str(metadata.get('Flow/Level', '')).strip().lower()

        if not series_name or not data_points or not isinstance(data_points, list):
            log_warn(f"Skipping '{series_name or 'Unnamed'}': missing name or data.")
            continue

        log_info(f"\nProcessing series: '{series_name}' (Original freq: '{original_freq_simple}', Flow/Level: '{flow_level}')")

        try:
            # 1. Создаем Series
            timestamps = [pd.to_datetime(p[0], errors='coerce') for p in data_points]
            values = [p[1] for p in data_points]
            valid_mask = [pd.notna(ts) for ts in timestamps]
            if not any(valid_mask): log_warn(f"Skipping '{series_name}': No valid timestamps."); continue
            valid_timestamps = [ts for ts, mask in zip(timestamps, valid_mask) if mask]
            valid_values = [val for val, mask in zip(values, valid_mask) if mask]
            series = pd.Series(valid_values, index=pd.DatetimeIndex(valid_timestamps), dtype=np.float64)
            series = series[~series.index.duplicated(keep='first')].sort_index()
            if series.empty: log_warn(f"Skipping '{series_name}': Empty after cleaning."); continue
            log_info(f"  Initial series. Len: {len(series)}, Range: {series.index.min()} to {series.index.max()}")

            # 2. Определяем метод ресемплинга
            original_order = get_period_order(original_freq_simple)
            resampled_series = None

            # --- ИСПРАВЛЕНИЕ УСЛОВИЯ ---
            if original_freq_simple.upper() == target_freq_code_simple.upper():
                 log_info("  Original and target frequency match. No resampling needed.")
                 resampled_series = series
            elif original_order == 0 or target_order == 0:
                 log_warn(f"  Cannot reliably resample '{series_name}' due to unknown frequency.")
                 resampled_series = series # Пропускаем как есть
            # Downsampling: ИСХОДНАЯ частота > ЦЕЛЕВОЙ (например, M(3) -> Q(4) - НЕВЕРНО, нужно M(3) -> A(5))
            # Downsampling: ИСХОДНЫЙ порядок > ЦЕЛЕВОГО (например, D(1) -> M(3) - НЕВЕРНО, нужно D(1) -> W(2))
            # ПРАВИЛЬНО: Downsampling = ИСХОДНЫЙ порядок < ЦЕЛЕВОГО (M(3) < Q(4))
            elif original_order < target_order: # <<< ИСПРАВЛЕНО ЗДЕСЬ (M(3) < Q(4) => Downsampling)
                if flow_level == 'flow':
                    agg_method = 'sum'
                    log_info(f"  Downsampling (flow) using .resample('{target_freq_pd}').{agg_method}()")
                    resampled_series = series.resample(target_freq_pd).agg(agg_method)
                else: # level или default
                    agg_method = 'last'
                    log_info(f"  Downsampling (level/default) using .resample('{target_freq_pd}').{agg_method}()")
                    resampled_series = series.resample(target_freq_pd).agg(agg_method)
            # Upsampling: ИСХОДНЫЙ порядок > ЦЕЛЕВОГО (Q(4) > M(3))
            elif original_order > target_order: # <<< ИСПРАВЛЕНО ЗДЕСЬ
                 log_info(f"  Upsampling using .resample('{target_freq_pd}').interpolate('linear')")
                 resampled_series = series.resample(target_freq_pd).interpolate(method='linear')
                 resampled_series = resampled_series.ffill().bfill()
            # --- КОНЕЦ ИСПРАВЛЕНИЯ УСЛОВИЯ ---

            if resampled_series is None or resampled_series.empty:
                 log_warn(f"Skipping '{series_name}': Result after resampling was empty or None.")
                 continue

            # Логирование результата (оставляем)
            log_info(f"  Resampled series head for '{series_name}':\n{resampled_series.head().to_string()}")
            log_info(f"  Resampled series tail for '{series_name}':\n{resampled_series.tail().to_string()}")
            log_info(f"  NaN count in resampled series '{series_name}': {resampled_series.isna().sum()}")

            # 3. Конвертация в список
            final_data_list = [[idx.isoformat(), (float(val) if pd.notna(val) else None)] for idx, val in resampled_series.items()]
            processed_data[series_name] = final_data_list
            log_info(f"  Successfully processed '{series_name}'. New length: {len(final_data_list)}")

        except Exception as e:
            log_error(f"Failed to process series '{series_name}': {str(e)}")
            traceback.print_exc(file=log_buffer)
            continue

    log_info(f"\nFinished aggregation. Processed {len(processed_data)} series.")
    if not processed_data: return json.dumps({"error": "No series processed successfully."})
    else: return json.dumps(processed_data)

if __name__ == "__main__":
    input_json = sys.stdin.read()
    result = aggregate_series_data(input_json)
    sys.stderr.write(log_buffer.getvalue())
    print(result)