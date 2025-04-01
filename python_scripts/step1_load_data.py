import pandas as pd
import numpy as np
import sys
import json
import traceback
from collections import defaultdict
from pandas.tseries.frequencies import to_offset
import io

# --- Вспомогательные функции ---
def safe_get_metadata(df, row_index, col_index, default=''):
    # ... (same as V9) ...
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
    """V10 Debug: Attempts pd.infer_freq first, then uses heuristics based on day differences."""
    if not isinstance(index, pd.DatetimeIndex) or len(index) < 3:
        log_debug(f"  infer_freq_v10: Index invalid or too short (Len: {len(index) if isinstance(index, pd.DatetimeIndex) else 'N/A'}). Returning None.")
        return None

    log_debug(f"  infer_freq_v10: Index Length={len(index)}. First 3 dates: {index[:3].tolist()}")

    # 1. Try pandas infer_freq first
    try:
        offset = pd.infer_freq(index, warn=False)
        log_debug(f"  infer_freq_v10: pd.infer_freq result: {offset}")
        if offset:
            base_freq = to_offset(offset).rule_code
            log_debug(f"  infer_freq_v10: Offset rule_code: {base_freq}")
            # Standardize common ones
            if 'Q' in base_freq: return 'Q'
            if 'M' in base_freq: return 'M'
            if 'A' in base_freq or 'Y' in base_freq: return 'A'
            if 'W' in base_freq: return 'W'
            if 'D' in base_freq: return 'D'
            if 'B' in base_freq: return 'B'
            # If pandas found something specific but not common, return it
            log_debug(f"  infer_freq_v10: Returning pandas inferred freq '{base_freq}'.")
            return base_freq # e.g., 'WOM-3FRI'
    except Exception as e_infer:
        log_debug(f"  infer_freq_v10: Error during pd.infer_freq: {e_infer}")
        # Don't return, proceed to heuristics

    log_debug("  infer_freq_v10: pd.infer_freq failed, trying heuristics based on day differences...")

    # 2. Heuristics: Analyze time differences (deltas)
    try:
        # Ensure index is sorted for meaningful diff
        if not index.is_monotonic_increasing:
            index = index.sort_values()
            log_debug("  infer_freq_v10: Index was not sorted, sorted now.")

        # Calculate differences in days
        deltas_days = index.to_series().diff().dt.days.dropna()

        if deltas_days.empty:
            log_debug("  infer_freq_v10: No differences calculated (maybe only 1 date?). Returning None.")
            return None

        log_debug(f"  infer_freq_v10: Calculated day deltas (first 5): {deltas_days.head().tolist()}")

        # Find the most common difference (mode)
        mode_delta = deltas_days.mode()
        if not mode_delta.empty:
            common_delta = mode_delta.iloc[0]
            log_debug(f"  infer_freq_v10: Most common delta (days): {common_delta}")

            # --- Define frequency based on common delta ---
            # These ranges are approximate and can be adjusted
            if 88 <= common_delta <= 93: # Approx 3 months
                log_debug("  infer_freq_v10: Common delta suggests Quarterly ('Q').")
                return 'Q'
            elif 28 <= common_delta <= 31: # Approx 1 month
                 log_debug("  infer_freq_v10: Common delta suggests Monthly ('M').")
                 return 'M'
            elif common_delta == 7: # Exactly 1 week
                 log_debug("  infer_freq_v10: Common delta suggests Weekly ('W').")
                 return 'W'
            elif common_delta == 1: # Daily
                 log_debug("  infer_freq_v10: Common delta suggests Daily ('D').")
                 return 'D'
            elif 360 <= common_delta <= 370: # Approx 1 year
                 log_debug("  infer_freq_v10: Common delta suggests Annual ('A').")
                 return 'A'
            # Add more heuristics if needed (e.g., for business days)
            else:
                 log_debug(f"  infer_freq_v10: Common delta {common_delta} doesn't match standard frequency heuristics.")
        else:
            log_debug("  infer_freq_v10: Could not determine a common delta.")

    except Exception as e_heuristics:
        log_debug(f"  infer_freq_v10: Error during heuristic analysis: {e_heuristics}")

    # If all methods fail
    log_debug("  infer_freq_v10: All methods failed. Returning None.")
    return None
# --- Конец Вспомогательных функций ---

# --- Функции detect_data_blocks_v8 и process_excel_universal_vX ---
# Используем детектор v8, но вызываем process_excel_universal_v10, который использует новую infer_freq

def detect_data_blocks_v8(df, min_series_len=10, date_threshold=0.8, numeric_threshold=0.6):
    # ... (detect_data_blocks_v8 function remains exactly the same as V8) ...
    log_debug("Starting block detection (v8 - Explicit Date Format)...")
    detected_blocks = []; rows, cols = df.shape; log_debug(f"DataFrame shape: rows={rows}, cols={cols}")
    potential_date_cols = []; log_debug("Scanning for potential date columns (using format %d.%m.%Y)...")
    date_format_to_try = '%d.%m.%Y'
    for c in range(cols):
        try:
            col_data = df.iloc[:, c];
            if col_data.isna().all(): continue
            parsed_dates = pd.to_datetime(col_data, format=date_format_to_try, errors='coerce')
            valid_dates_mask = parsed_dates.notna(); valid_dates = parsed_dates[valid_dates_mask]; num_valid_dates = len(valid_dates)
            num_non_na_original = max(1, len(col_data.dropna())); date_coverage = num_valid_dates / num_non_na_original
            if (not valid_dates.empty and date_coverage >= date_threshold and num_valid_dates >= min_series_len):
                 original_indices = df.index[valid_dates_mask]
                 log_debug(f"  Column {c}: PASSED date checks with format '{date_format_to_try}'. Index={c}, Valid dates={num_valid_dates}")
                 potential_date_cols.append({'index': c, 'datetime_index': pd.DatetimeIndex(valid_dates), 'original_row_indices': original_indices, 'coverage': date_coverage})
        except Exception as e: log_debug(f"  Column {c}: Error during date scan with format - {e}")
    potential_date_cols.sort(key=lambda x: x['index'])
    log_debug(f"Found {len(potential_date_cols)} potential date columns using format '{date_format_to_try}': {[d['index'] for d in potential_date_cols]}")
    processed_data_cols_in_any_block = set()
    for i, date_info in enumerate(potential_date_cols):
        date_col_idx = date_info['index']; current_block_data_cols = []
        log_debug(f"\nProcessing potential date column {date_col_idx}...")
        next_potential_date_col_idx = potential_date_cols[i+1]['index'] if i + 1 < len(potential_date_cols) else cols
        log_debug(f"  Searching for data columns between {date_col_idx + 1} and {next_potential_date_col_idx}")
        for data_col_idx in range(date_col_idx + 1, next_potential_date_col_idx):
            try:
                col_data = df.iloc[date_info['original_row_indices'], data_col_idx]; numeric_vals = pd.to_numeric(col_data, errors='coerce'); valid_numeric = numeric_vals.dropna()
                num_valid_numeric = len(valid_numeric); num_rows_at_date_indices = max(1, len(date_info['original_row_indices'])); numeric_coverage = num_valid_numeric / num_rows_at_date_indices
                if not valid_numeric.empty and num_valid_numeric >= min_series_len and numeric_coverage >= numeric_threshold:
                    log_debug(f"      Column {data_col_idx}: PASSED numeric threshold. Adding to block for date col {date_col_idx}."); current_block_data_cols.append(data_col_idx)
                else: log_debug(f"      Column {data_col_idx}: FAILED numeric threshold. Stopping block search."); break
            except Exception as e: log_debug(f"      Column {data_col_idx}: Error during numeric check - {e}. Stopping block search."); break
        if current_block_data_cols:
            log_debug(f"  Detected block for date column {date_col_idx} with data columns: {current_block_data_cols}")
            block_info = {'date_col_index': date_col_idx, 'datetime_index': date_info['datetime_index'], 'original_row_indices': date_info['original_row_indices'], 'data_col_indices': current_block_data_cols, 'orientation': 'column'}
            first_data_row_idx = date_info['original_row_indices'].min(); metadata_rows_indices = list(range(max(0, first_data_row_idx - 6), first_data_row_idx))
            block_info['potential_metadata_rows'] = metadata_rows_indices; log_debug(f"  Potential metadata rows for this block: {metadata_rows_indices}"); detected_blocks.append(block_info); processed_data_cols_in_any_block.update(current_block_data_cols)
        else: log_debug(f"  No associated data columns found for date column {date_col_idx}.")
    log_debug(f"Block detection finished. Found {len(detected_blocks)} blocks.")
    return detected_blocks


def process_excel_universal_v10(file_path, sheet_name=0):
    """V10 uses detect_data_blocks_v8 and NEW infer_frequency_robust_v10"""
    log_debug(f"Starting universal processing v10 for: {file_path}, sheet: {sheet_name}")
    try:
        df = pd.read_excel(file_path, sheet_name=sheet_name, header=None, index_col=None)
    # ...(Error handling)...
    except FileNotFoundError: return json.dumps({"error": f"File not found: {file_path}"})
    except Exception as e:
        if "No sheet named" in str(e): return json.dumps({"error": f"Sheet '{sheet_name}' not found."})
        return json.dumps({"error": f"Error reading Excel: {str(e)}", "trace": traceback.format_exc()})

    all_series_data = []
    blocks = detect_data_blocks_v8(df) # Use detector V8, which found date columns

    if not blocks:
        log_debug("No blocks detected (using v8 detector).")
        sys.stderr.write(log_buffer.getvalue())
        return json.dumps({"error": "Could not automatically detect any time series data blocks (v10_debug)." })

    metadata_level_names = ["Type", "Sector", "units", "Flow/Level", "Timeframe", "Description"]
    log_debug("\nProcessing detected blocks...")
    for block_num, block in enumerate(blocks):
        log_debug(f"--- Processing Block {block_num} (Date Col: {block['date_col_index']}) ---")
        if block['orientation'] == 'column':
            date_index_raw = block['datetime_index']
            # --- USE NEW FREQUENCY FUNCTION ---
            inferred_freq = infer_frequency_robust_v10(date_index_raw)
            # --- END NEW FREQUENCY FUNCTION ---
            log_debug(f"  Frequency determined for block (v10): {inferred_freq}")

            date_index_processed = date_index_raw
            block_metadata = defaultdict(dict)
            freq_fallback = None

            # --- Extract metadata & potential fallback (same as V8/V9) ---
            log_debug(f"  Extracting metadata from potential rows: {block.get('potential_metadata_rows')}")
            if block.get('potential_metadata_rows'):
                meta_rows = block['potential_metadata_rows']
                is_6row_meta = len(meta_rows) == 6
                for data_col_idx in block['data_col_indices']:
                    if is_6row_meta:
                        meta_dict = {name: safe_get_metadata(df, meta_rows[r_idx], data_col_idx) for r_idx, name in enumerate(metadata_level_names)}
                        block_metadata[data_col_idx] = meta_dict
                        if freq_fallback is None and 'Timeframe' in meta_dict:
                             tf_meta = meta_dict['Timeframe'].strip().upper();
                             if tf_meta in ['Q', 'M', 'A', 'W', 'D', 'B']: freq_fallback = tf_meta
                    else:
                        last_meta_row = max(meta_rows) if meta_rows else -1
                        if last_meta_row != -1: block_metadata[data_col_idx]['Header_Guess'] = safe_get_metadata(df, last_meta_row, data_col_idx)

            # Final frequency: Use inferred, then fallback, then Unknown
            final_freq = inferred_freq if inferred_freq else freq_fallback if freq_fallback else 'Unknown'
            log_debug(f"  Final frequency assigned: {final_freq}")

            # Adjust Q index AFTER determining frequency
            if final_freq == 'Q':
                 try:
                     date_index_processed = date_index_raw.to_period('Q').to_timestamp('Q')
                     log_debug("  Adjusted index to QuarterEnd.")
                 except Exception as pe:
                     log_debug(f"  Warning: Could not convert index to QuarterEnd. Error: {pe}")
                     date_index_processed = date_index_raw

            # --- Process data columns (same as V8/V9) ---
            log_debug(f"  Processing {len(block['data_col_indices'])} data columns...")
            for data_col_idx in block['data_col_indices']:
                try:
                    series_raw = df.iloc[block['original_row_indices'], data_col_idx]
                    series = pd.to_numeric(series_raw, errors='coerce')
                    series.index = date_index_processed
                    series.dropna(inplace=True);
                    if series.empty: continue
                    data_list = [[idx.isoformat(), (float(val) if pd.notna(val) else None)] for idx, val in series.items()]
                    meta = block_metadata.get(data_col_idx, {})
                    name = meta.get("Description") or meta.get("Header_Guess", f"Series_Col_{data_col_idx}")
                    all_series_data.append({"name": name, "frequency": final_freq, "metadata": meta, "data": data_list})
                except Exception as e_inner:
                     log_debug(f"    ERROR processing column {data_col_idx}: {e_inner}")

    # --- Final Output ---
    log_debug(f"\nFinished processing. Total series extracted: {len(all_series_data)}")
    if not all_series_data:
        sys.stderr.write(log_buffer.getvalue())
        return json.dumps({"error": "Detected blocks but failed to extract valid series data (v10_debug)." })

    sys.stderr.write(log_buffer.getvalue())
    return json.dumps(all_series_data)

if __name__ == "__main__":
    # ... (main block calls process_excel_universal_v10) ...
    if len(sys.argv) < 2: print(json.dumps({"error": "No Excel file path provided."})); sys.exit(1)
    file_path_arg = sys.argv[1]
    sheet_name_arg = sys.argv[2] if len(sys.argv) > 2 else 0
    result_json = process_excel_universal_v10(file_path_arg, sheet_name_arg) # Call v10
    print(result_json)