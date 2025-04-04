import pandas as pd
import numpy as np
import sys
import json
import traceback
from collections import defaultdict
from pandas.tseries.frequencies import to_offset
import io
from pandas.api.types import is_datetime64_any_dtype, is_numeric_dtype

# --- Вспомогательные функции ---
def safe_get_metadata(df, row_index, col_index, default=''):
    # ... (same as previous version) ...
    try:
        val = df.iloc[row_index, col_index];
        if pd.isna(val): return default;
        return str(val).strip()
    except IndexError: return default
    except Exception: return default

# --- Логирование ---
log_buffer = io.StringIO()
def log_debug(message):
    print(f"DEBUG: {message}", file=log_buffer)
# --- Конец Логирования ---


def infer_frequency_robust_v10(index):
    # ... (same as previous version, с подробным логированием) ...
    if not isinstance(index, pd.DatetimeIndex) or len(index) < 3:
        log_debug(f"  infer_freq_v10: Index invalid or too short (Len: {len(index) if isinstance(index, pd.DatetimeIndex) else 'N/A'}). Returning None.")
        return None
    log_debug(f"  infer_freq_v10: Index Length={len(index)}. First 5 dates: {index[:5].strftime('%Y-%m-%d').tolist()}")
    log_debug(f"  infer_freq_v10: Last 5 dates: {index[-5:].strftime('%Y-%m-%d').tolist()}")
    inferred_offset = None
    try:
        inferred_offset = pd.infer_freq(index, warn=True)
        log_debug(f"  infer_freq_v10: pd.infer_freq result: '{inferred_offset}'")
        if inferred_offset:
            try:
                base_freq = to_offset(inferred_offset).rule_code
                log_debug(f"  infer_freq_v10: Offset rule_code: '{base_freq}'")
                if 'Q' in base_freq: log_debug("  infer_freq_v10: Matched 'Q'"); return 'Q'
                if 'M' in base_freq: log_debug("  infer_freq_v10: Matched 'M'"); return 'M'
                if 'A' in base_freq or 'Y' in base_freq: log_debug("  infer_freq_v10: Matched 'A'/'Y'"); return 'A'
                if 'W' in base_freq: log_debug("  infer_freq_v10: Matched 'W'"); return 'W'
                if 'D' in base_freq: log_debug("  infer_freq_v10: Matched 'D'"); return 'D'
                if 'B' in base_freq: log_debug("  infer_freq_v10: Matched 'B'"); return 'B'
                log_debug(f"  infer_freq_v10: Returning specific pandas inferred freq '{base_freq}'.")
                return base_freq
            except ValueError as e_offset: log_debug(f"  infer_freq_v10: Could not convert inferred offset '{inferred_offset}' to rule code: {e_offset}. Proceeding to heuristics.")
            except AttributeError as e_attr: log_debug(f"  infer_freq_v10: Attribute error processing offset '{inferred_offset}': {e_attr}. Proceeding to heuristics.")
    except Exception as e_infer: log_debug(f"  infer_freq_v10: Error during pd.infer_freq: {e_infer}")
    log_debug("  infer_freq_v10: pd.infer_freq did not yield a standard frequency, trying heuristics based on day differences...")
    try:
        if not index.is_monotonic_increasing:
            log_debug("  infer_freq_v10: Index was not sorted, sorting now...")
            index = index.sort_values()
            log_debug(f"  infer_freq_v10: Sorted index. First 5: {index[:5].strftime('%Y-%m-%d').tolist()}")
        deltas = index.to_series().diff()
        deltas_days = deltas.dt.days.dropna()
        if deltas_days.empty:
            log_debug("  infer_freq_v10: No differences calculated. Returning None.")
            return None
        log_debug(f"  infer_freq_v10: Calculated day deltas (count={len(deltas_days)}). Value counts (top 5):")
        log_debug(deltas_days.value_counts().nlargest(5).to_string())
        mode_delta_series = deltas_days.mode()
        if not mode_delta_series.empty:
            common_delta = mode_delta_series.iloc[0]
            log_debug(f"  infer_freq_v10: Most common delta (days): {common_delta}")
            if 88 <= common_delta <= 93: log_debug("  infer_freq_v10: Heuristic: Common delta suggests Quarterly ('Q')."); return 'Q'
            elif 28 <= common_delta <= 31: log_debug("  infer_freq_v10: Heuristic: Common delta suggests Monthly ('M')."); return 'M'
            elif common_delta == 7: log_debug("  infer_freq_v10: Heuristic: Common delta suggests Weekly ('W')."); return 'W'
            elif common_delta == 1: log_debug("  infer_freq_v10: Heuristic: Common delta suggests Daily ('D')."); return 'D'
            elif 360 <= common_delta <= 370: log_debug("  infer_freq_v10: Heuristic: Common delta suggests Annual ('A')."); return 'A'
            else: log_debug(f"  infer_freq_v10: Heuristic: Common delta {common_delta} doesn't match standard frequency heuristics.")
        else: log_debug("  infer_freq_v10: Heuristic: Could not determine a common delta.")
    except Exception as e_heuristics:
        log_debug(f"  infer_freq_v10: Error during heuristic analysis: {e_heuristics}")
        log_debug(traceback.format_exc())
    log_debug("  infer_freq_v10: All frequency inference methods failed. Returning None.")
    return None
# --- Конец Вспомогательных функций ---

# --- Функция детекции блоков ---
# ### ИЗМЕНЕНО ### v14, изменен date_format по умолчанию
def detect_data_blocks_robust(df, min_series_len=10, date_threshold=0.9, numeric_threshold=0.6, date_format='%Y-%m-%d %H:%M:%S'):
    """
    Detects data blocks robustly (v14):
    1. Reads data as string.
    2. Tries parsing full column with specific date_format (defaulting to ISO format).
    3. Finds the first valid date index from this parsing.
    4. Checks date coverage AND type ratio on the slice *below* the first date.
    5. Checks if the *next* column is numeric (also on the slice).
    """
    log_debug(f"Starting block detection (robust v14: specific format '{date_format}' check + find first date + numeric check, date_thr={date_threshold}, numeric_thr={numeric_threshold})...") ### ИЗМЕНЕНО ### v14
    detected_blocks = []
    rows, cols = df.shape
    log_debug(f"DataFrame shape: rows={rows}, cols={cols}")
    log_debug(f"DataFrame index type: {type(df.index)}")

    potential_date_cols = []
    log_debug(f"Scanning for potential date columns (specific format '{date_format}' check + find first date + next col numeric check)...") ### ИЗМЕНЕНО ###

    for c in range(cols - 1):
        col_data = df.iloc[:, c] # Данные прочитаны как строки
        if col_data.isna().all():
            continue

        try:
            # --- Шаг 1: Попытка парсинга ВСЕЙ колонки с ЯВНЫМ ФОРМАТОМ (как строки) ---
            try:
                col_data_str_stripped = col_data.astype(str).str.strip() # Убеждаемся, что это строка и без пробелов
                log_debug(f"  Column {c}: First 10 stripped string values: {col_data_str_stripped.head(10).tolist()}")
                # Парсим с ожидаемым форматом (теперь ISO)
                parsed_dates_full_specific = pd.to_datetime(col_data_str_stripped, format=date_format, errors='coerce')
                log_debug(f"  Column {c}: Applied .astype(str).str.strip() to full column before specific format parsing.")
            except Exception as e_astype:
                 log_debug(f"  Column {c}: Error applying .astype(str).str.strip() or parsing full column with specific format: {e_astype}. Skipping column.")
                 continue

            # --- Шаг 2: Найти индекс первой валидной даты из этого парсинга ---
            first_valid_date_index = parsed_dates_full_specific.first_valid_index()

            if first_valid_date_index is None:
                log_debug(f"  Column {c}: No valid dates found matching format '{date_format}'.")
                continue

            log_debug(f"  Column {c}: First date matching format '{date_format}' found at index {first_valid_date_index}.")

            # --- Шаг 3: Проверить покрытие и тип НАЧИНАЯ с первой валидной даты ---
            parsed_dates_slice = parsed_dates_full_specific.loc[first_valid_date_index:]
            col_data_slice = col_data.loc[first_valid_date_index:] # Исходные данные среза (строки)

            valid_dates_mask_slice = parsed_dates_slice.notna()
            valid_dates_slice = parsed_dates_slice[valid_dates_mask_slice]
            num_valid_dates_slice = len(valid_dates_slice)

            num_non_na_original_slice = max(1, len(col_data_slice.dropna()))
            date_coverage_slice = num_valid_dates_slice / num_non_na_original_slice
            num_actually_dates_slice = valid_dates_mask_slice.sum()
            actual_date_ratio_slice = num_actually_dates_slice / num_non_na_original_slice if num_non_na_original_slice > 0 else 0

            log_debug(f"  Column {c}: Checking slice from index {first_valid_date_index} (specific format result). Non-NA Original in slice: {num_non_na_original_slice}, Valid Dates Parsed: {num_actually_dates_slice}, Coverage: {date_coverage_slice:.2f}, Actual Date Ratio: {actual_date_ratio_slice:.2f}")

            is_potential_date_col = (
                num_actually_dates_slice >= min_series_len
                and date_coverage_slice >= date_threshold
                and actual_date_ratio_slice >= date_threshold
            )

            if not is_potential_date_col:
                 # ... (логирование причин пропуска) ...
                 continue

            log_debug(f"  Column {c}: PASSED specific format and type checks on slice. Now checking next column ({c+1}) for numeric data...")

            # --- Шаг 4: Проверка СЛЕДУЮЩЕЙ колонки (c+1) на числа ---
            # ... (остальная часть Шага 4 без изменений) ...
            next_col_idx = c + 1
            original_indices_slice = col_data_slice.index[valid_dates_mask_slice]
            if original_indices_slice.empty: continue
            next_col_data_slice = df.loc[original_indices_slice].iloc[:, next_col_idx] # Данные здесь тоже строки
            # Преобразуем в числа
            numeric_vals_next = pd.to_numeric(next_col_data_slice, errors='coerce')
            valid_numeric_next = numeric_vals_next.dropna()
            num_valid_numeric_next = len(valid_numeric_next)
            num_rows_at_date_indices = max(1, len(original_indices_slice))
            numeric_coverage_next = num_valid_numeric_next / num_rows_at_date_indices
            log_debug(f"    Column {next_col_idx} (Next Col): Trying numeric parse on slice. Rows considered: {num_rows_at_date_indices}, Valid Numeric Found: {num_valid_numeric_next}, Coverage: {numeric_coverage_next:.2f}")
            is_next_col_numeric = (not valid_numeric_next.empty and num_valid_numeric_next >= min_series_len and numeric_coverage_next >= numeric_threshold)

            if is_next_col_numeric:
                log_debug(f"  Column {c}: PASSED combined check (date col {c} slice + numeric next col {next_col_idx} slice). Adding as potential date anchor.")
                potential_date_cols.append({'index': c, 'datetime_index': pd.DatetimeIndex(valid_dates_slice), 'original_row_indices': original_indices_slice, 'first_data_row_index': first_valid_date_index, 'coverage': date_coverage_slice})
            else:
                log_debug(f"  Column {c}: FAILED combined check. Reason: Next column {next_col_idx} did not pass numeric check on slice (coverage {numeric_coverage_next:.2f} < threshold {numeric_threshold} or length {num_valid_numeric_next} < {min_series_len}).")

        except Exception as e:
            log_debug(f"  Column {c}: Error during combined date/numeric scan - {e}")
            log_debug(traceback.format_exc())

    potential_date_cols.sort(key=lambda x: x['index'])
    log_debug(f"Found {len(potential_date_cols)} potential date anchors (passed combined check v14): {[d['index'] for d in potential_date_cols]}")
    processed_data_cols_in_any_block = set()

    # --- Поиск числовых колонок справа от якорей ---
    # ... (остальная часть функции detect_data_blocks_robust без изменений v5) ...
    for i, date_info in enumerate(potential_date_cols):
        date_col_idx = date_info['index']
        current_block_data_cols = []
        log_debug(f"\nProcessing potential date anchor {date_col_idx}...")
        next_potential_date_anchor_idx = potential_date_cols[i+1]['index'] if i + 1 < len(potential_date_cols) else cols
        log_debug(f"  Searching for data columns between index {date_col_idx + 1} and {next_potential_date_anchor_idx}")
        original_indices = date_info['original_row_indices']
        if original_indices.empty:
             log_debug(f"  Skipping anchor {date_col_idx}: original_row_indices is empty.")
             continue
        for data_col_idx in range(date_col_idx + 1, next_potential_date_anchor_idx):
            if data_col_idx in processed_data_cols_in_any_block: continue
            try:
                col_data = df.loc[original_indices].iloc[:, data_col_idx] # Данные здесь строки
                # Преобразуем в числа
                numeric_vals = pd.to_numeric(col_data, errors='coerce')
                valid_numeric = numeric_vals.dropna()
                num_valid_numeric = len(valid_numeric)
                num_rows_at_date_indices = max(1, len(original_indices))
                numeric_coverage = num_valid_numeric / num_rows_at_date_indices
                log_debug(f"      Column {data_col_idx}: Trying numeric parse on slice. Rows at date indices: {num_rows_at_date_indices}, Valid Numeric Found: {num_valid_numeric}, Coverage: {numeric_coverage:.2f}")
                if not valid_numeric.empty and num_valid_numeric >= min_series_len and numeric_coverage >= numeric_threshold:
                    log_debug(f"      Column {data_col_idx}: PASSED numeric threshold. Adding to block for date anchor {date_col_idx}.")
                    current_block_data_cols.append(data_col_idx)
                else:
                    reason = "unknown"
                    if valid_numeric.empty: reason = "no valid numeric values"
                    elif num_valid_numeric < min_series_len: reason = f"num valid numeric {num_valid_numeric} < min length {min_series_len}"
                    elif numeric_coverage < numeric_threshold: reason = f"coverage {numeric_coverage:.2f} < threshold {numeric_threshold}"
                    log_debug(f"      Column {data_col_idx}: FAILED numeric threshold. Reason: {reason}. Stopping block search for date anchor {date_col_idx}.")
                    break
            except Exception as e:
                log_debug(f"      Column {data_col_idx}: Error during numeric check - {e}.")
                log_debug(traceback.format_exc())
                break
        if current_block_data_cols:
            log_debug(f"  Detected block for date anchor {date_col_idx} with data columns: {current_block_data_cols}")
            first_data_row_actual_index = date_info['first_data_row_index']
            first_data_row_iloc = df.index.get_loc(first_data_row_actual_index)
            metadata_rows_iloc = list(range(first_data_row_iloc))
            block_info = {'date_col_index': date_col_idx, 'datetime_index': date_info['datetime_index'], 'original_row_indices': date_info['original_row_indices'], 'data_col_indices': current_block_data_cols, 'orientation': 'column', 'potential_metadata_rows_iloc': metadata_rows_iloc}
            log_debug(f"  Potential metadata rows (iloc positions) for this block: {metadata_rows_iloc}")
            detected_blocks.append(block_info)
            processed_data_cols_in_any_block.update(current_block_data_cols)
        else:
            log_debug(f"  No associated data columns found for date anchor {date_col_idx}.")

    log_debug(f"Block detection finished. Found {len(detected_blocks)} blocks.")
    return detected_blocks


def process_excel_universal_v10(file_path, sheet_name=0):
    """V10 uses detect_data_blocks_robust v14 and infer_frequency_robust_v10""" ### ИЗМЕНЕНО ###
    log_debug(f"Starting universal processing v10 for: {file_path}, sheet: {sheet_name}")
    try:
        # Читаем все как строки изначально!
        df = pd.read_excel(file_path, sheet_name=sheet_name, header=None, dtype=str)
        log_debug("Read Excel sheet with dtype=str")
    except FileNotFoundError: return json.dumps({"error": f"File not found: {file_path}"})
    except Exception as e:
        if "No sheet named" in str(e): return json.dumps({"error": f"Sheet '{sheet_name}' not found."})
        log_debug(f"Error reading Excel file: {e}\n{traceback.format_exc()}")
        return json.dumps({"error": f"Error reading Excel: {str(e)}"})

    all_series_data = []
    # Вызываем новую функцию детекции
    blocks = detect_data_blocks_robust(df)

    if not blocks:
        log_debug("No data blocks detected using robust detection v14.") ### ИЗМЕНЕНО ###
        sys.stderr.write(log_buffer.getvalue())
        return json.dumps({"error": "Could not automatically detect any time series data blocks (robust detection v14)." }) ### ИЗМЕНЕНО ###

    metadata_level_names = ["Type", "Sector", "units", "Flow/Level", "Timeframe", "Description"]
    log_debug("\nProcessing detected blocks...")
    # ... (остальная часть process_excel_universal_v10 без изменений) ...
    for block_num, block in enumerate(blocks):
        log_debug(f"--- Processing Block {block_num} (Date Col: {block['date_col_index']}) ---")
        if block['orientation'] == 'column':
            date_index_raw = block['datetime_index']
            inferred_freq = infer_frequency_robust_v10(date_index_raw)
            log_debug(f"  Frequency determined for block (v10): {inferred_freq}")
            date_index_processed = date_index_raw
            block_metadata = defaultdict(dict)
            freq_fallback = None
            log_debug(f"  Extracting metadata from potential rows (iloc positions): {block.get('potential_metadata_rows_iloc')}")
            if block.get('potential_metadata_rows_iloc'):
                meta_rows_iloc = block['potential_metadata_rows_iloc']
                actual_metadata_rows = len(meta_rows_iloc)
                log_debug(f"    Actual number of metadata rows found: {actual_metadata_rows}")
                if actual_metadata_rows >= 6:
                     relevant_meta_rows_iloc = meta_rows_iloc[-6:]
                     log_debug(f"    Using last {len(relevant_meta_rows_iloc)} rows for standard metadata: {relevant_meta_rows_iloc}")
                     for data_col_idx in block['data_col_indices']:
                         meta_dict = {name: safe_get_metadata(df, relevant_meta_rows_iloc[r_idx], data_col_idx) for r_idx, name in enumerate(metadata_level_names)}
                         block_metadata[data_col_idx] = meta_dict
                         if freq_fallback is None and 'Timeframe' in meta_dict:
                              tf_meta = meta_dict['Timeframe'].strip().upper();
                              if tf_meta in ['Q', 'M', 'A', 'W', 'D', 'B']:
                                  freq_fallback = tf_meta
                                  log_debug(f"    Found frequency fallback '{freq_fallback}' in metadata for col {data_col_idx}")
                else:
                    last_meta_row_iloc = max(meta_rows_iloc) if meta_rows_iloc else -1
                    if last_meta_row_iloc != -1:
                         for data_col_idx in block['data_col_indices']:
                             block_metadata[data_col_idx]['Header_Guess'] = safe_get_metadata(df, last_meta_row_iloc, data_col_idx)
                             log_debug(f"    Using header guess '{block_metadata[data_col_idx]['Header_Guess']}' from iloc row {last_meta_row_iloc} for col {data_col_idx}")

            final_freq = inferred_freq if inferred_freq else freq_fallback if freq_fallback else 'Unknown'
            log_debug(f"  Final frequency assigned for block: {final_freq}")
            date_index_processed = date_index_raw
            log_debug(f"  Using raw datetime index for processing.")
            log_debug(f"  Processing {len(block['data_col_indices'])} data columns for this block...")
            for data_col_idx in block['data_col_indices']:
                try:
                    original_indices = block['original_row_indices']
                    if original_indices.empty: continue
                    series_raw = df.loc[original_indices].iloc[:, data_col_idx] # Данные здесь строки
                    series = pd.to_numeric(series_raw, errors='coerce') # Преобразуем в числа
                    series.index = date_index_processed
                    series.dropna(inplace=True);
                    if series.empty:
                        log_debug(f"    Skipping column {data_col_idx}: empty after dropna.")
                        continue
                    if not isinstance(series.index, pd.DatetimeIndex) or series.index.hasnans:
                         log_debug(f"    Skipping column {data_col_idx}: index became invalid after dropna.")
                         continue
                    data_list = [[idx.isoformat(), (float(val) if pd.notna(val) else None)] for idx, val in series.items()]
                    meta = block_metadata.get(data_col_idx, {})
                    name = meta.get("Description") or meta.get("Header_Guess", f"Series_Col_{data_col_idx}")
                    all_series_data.append({"name": name, "frequency": final_freq, "metadata": meta, "data": data_list})
                    log_debug(f"    Successfully processed column {data_col_idx} as series '{name}'. Length: {len(data_list)}")
                except Exception as e_inner:
                     log_debug(f"    ERROR processing column {data_col_idx}: {e_inner}\n{traceback.format_exc()}")

    log_debug(f"\nFinished processing sheet '{sheet_name}'. Total series extracted: {len(all_series_data)}")
    if not all_series_data:
        sys.stderr.write(log_buffer.getvalue())
        return json.dumps({"error": f"Detected blocks but failed to extract valid series data from sheet '{sheet_name}' (robust detection v14)." }) ### ИЗМЕНЕНО ###

    sys.stderr.write(log_buffer.getvalue())
    return json.dumps(all_series_data)

if __name__ == "__main__":
    # ... (same as previous version) ...
    if len(sys.argv) < 2: print(json.dumps({"error": "No Excel file path provided."})); sys.exit(1)
    file_path_arg = sys.argv[1]
    sheet_name_arg = sys.argv[2] if len(sys.argv) > 2 else 0
    result_json = process_excel_universal_v10(file_path_arg, sheet_name_arg)
    print(result_json)