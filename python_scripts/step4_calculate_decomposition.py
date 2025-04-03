# python_scripts/step4_calculate_decomposition.py
import sys
import json
import traceback
import pandas as pd
import numpy as np
import statsmodels.api as sm
import io
import math
from datetime import datetime

# --- Функции логирования (пишем в буфер, выводим в stderr в конце) ---
log_buffer = io.StringIO()
def log_error(message): print(f"ERROR_DECOMP: {message}", file=log_buffer)
def log_info(message): print(f"INFO_DECOMP: {message}", file=log_buffer)
def log_warn(message): print(f"WARN_DECOMP: {message}", file=log_buffer)

# --- Функция для очистки данных от невалидных JSON значений (NaN/inf) ---
def sanitize_for_json(data):
    if isinstance(data, dict):
        return {k: sanitize_for_json(v) for k, v in data.items()}
    elif isinstance(data, list):
        return [sanitize_for_json(item) for item in data]
    elif isinstance(data, float):
        if math.isinf(data) or math.isnan(data):
            return None
        return data
    elif isinstance(data, (np.float_, np.float16, np.float32, np.float64)):
        if np.isinf(data) or np.isnan(data):
            return None
        return float(data)
    elif isinstance(data, (np.int_, np.intc, np.intp, np.int8, np.int16, np.int32, np.int64, np.uint8, np.uint16, np.uint32, np.uint64)):
         return int(data)
    elif isinstance(data, (datetime, pd.Timestamp)):
         # Преобразуем datetime в ISO строку для JSON
         return data.isoformat()
    return data

# --- Функция для преобразования Series в формат [[timestamp_iso, value]] ---
def series_to_list(series):
    # Убедимся, что индекс - это DatetimeIndex
    if not isinstance(series.index, pd.DatetimeIndex):
        log_warn("Series index is not DatetimeIndex, attempting conversion.")
        try:
            series.index = pd.to_datetime(series.index)
        except Exception as e:
            log_error(f"Failed to convert series index to DatetimeIndex: {e}")
            return [] # Возвращаем пустой список в случае ошибки

    # Заменяем NaN/inf на None перед преобразованием
    series_clean = series.replace([np.inf, -np.inf], np.nan).where(pd.notna(series), None)

    # Преобразуем в нужный формат
    return [
        [timestamp.isoformat(), value]
        for timestamp, value in series_clean.items()
    ]

# --- Основная функция расчета декомпозиции ---
def calculate_decomposition(payload):
    try:
        log_info("--- Starting Decomposition Calculation ---")
        model_id = payload.get('model_id', 'N/A') # Получаем ID для логов

        # 1. Извлечение данных и спецификации
        y_spec = payload.get('dependentVariable')
        all_x_spec = payload.get('regressors') # {name: [[ts, val],...], ...}
        model_spec = payload.get('modelSpecification', {})
        regressors_with_lags = model_spec.get('regressors_with_lags', {})
        include_constant = model_spec.get('include_constant', True)

        if not y_spec or not y_spec.get('name') or not y_spec.get('data') or not all_x_spec or not model_spec:
            raise ValueError("Invalid payload: missing dependentVariable, regressors, or modelSpecification.")

        log_info(f"Model ID: {model_id}")
        log_info(f"Y: {y_spec['name']}")
        log_info(f"Specified Regressors/Lags: {regressors_with_lags}")
        log_info(f"Include Constant: {include_constant}")

        # 2. Подготовка данных Y
        y_df = pd.DataFrame(y_spec['data'], columns=['timestamp', 'value'])
        y_df['timestamp'] = pd.to_datetime(y_df['timestamp'], errors='coerce')
        y_df = y_df.dropna(subset=['timestamp']).set_index('timestamp')
        y_series = y_df['value'].astype(float).sort_index()
        y_series = y_series[~y_series.index.duplicated(keep='first')]
        if y_series.empty: raise ValueError("Dependent variable series is empty after cleaning.")
        log_info(f"Prepared Y series, length: {len(y_series)}")

        # 3. Подготовка данных X (всех доступных)
        all_x_df = pd.DataFrame(index=y_series.index) # Начинаем с индекса Y
        for name, data in all_x_spec.items():
            if not data: # Пропускаем, если данные пустые
                log_warn(f"No data provided for regressor '{name}', skipping.")
                continue
            temp_df = pd.DataFrame(data, columns=['timestamp', 'value'])
            temp_df['timestamp'] = pd.to_datetime(temp_df['timestamp'], errors='coerce')
            temp_df = temp_df.dropna(subset=['timestamp']).set_index('timestamp')
            if not temp_df.empty:
                temp_series = temp_df['value'].astype(float).sort_index()
                temp_series = temp_series[~temp_series.index.duplicated(keep='first')]
                # Используем reindex для выравнивания и заполнения пропусков NaN
                all_x_df[name] = temp_series.reindex(all_x_df.index, method=None)
            else:
                log_warn(f"Regressor '{name}' is empty after cleaning, skipping.")

        log_info(f"Prepared all X DataFrame, shape: {all_x_df.shape}")

        # 4. Создание лагированных признаков для *конкретной* модели
        X_lagged_df = pd.DataFrame(index=y_series.index)
        final_regressor_names = []
        for feature, lag in regressors_with_lags.items():
            if feature in all_x_df.columns:
                lagged_col_name = f"{feature}_L{lag}"
                if lag == 0:
                    X_lagged_df[lagged_col_name] = all_x_df[feature]
                elif lag > 0:
                    X_lagged_df[lagged_col_name] = all_x_df[feature].shift(lag)
                else:
                    log_warn(f"Invalid lag {lag} for feature {feature} in specification, skipping.")
                    continue # Пропускаем этот регрессор
                final_regressor_names.append(lagged_col_name)
            else:
                log_warn(f"Feature '{feature}' specified in model but not found in available regressors, skipping.")

        log_info(f"Created lagged X for model, shape: {X_lagged_df.shape}, columns: {final_regressor_names}")

        # 5. Объединение Y и X_lagged, очистка от NaN
        model_data = pd.concat([y_series.rename('__Y__'), X_lagged_df], axis=1)
        model_data_clean = model_data.dropna()

        if model_data_clean.empty or len(model_data_clean) < len(final_regressor_names) + (1 if include_constant else 0) + 1:
             raise ValueError(f"Not enough observations ({len(model_data_clean)}) after lagging and cleaning for model {model_id}.")

        Y_clean = model_data_clean['__Y__']
        X_clean = model_data_clean[final_regressor_names]
        log_info(f"Cleaned data for model fitting, shape: {model_data_clean.shape}")

        # 6. Добавление константы
        if include_constant:
            X_final = sm.add_constant(X_clean, has_constant='add')
            log_info("Added constant to X.")
        else:
            X_final = X_clean

        # 7. Запуск OLS
        log_info("Fitting OLS model...")
        model_results = sm.OLS(Y_clean, X_final).fit()
        log_info("OLS fitting complete.")

        # 8. Получение коэффициентов
        coefficients = model_results.params
        log_info(f"Coefficients: {coefficients.to_dict()}")

        # 9. Расчет предсказанных значений Y-hat
        predicted_y = model_results.predict(X_final)
        log_info(f"Calculated predicted Y, length: {len(predicted_y)}")

        # 10. Расчет вкладов
        contributions = {}
        log_info("Calculating contributions...")
        for factor_name in X_final.columns: # Итерируем по КОЛОНКАМ X_final (включая 'const')
            if factor_name in coefficients:
                coeff_value = coefficients[factor_name]
                # Вклад = значение фактора * его коэффициент
                contribution_series = X_final[factor_name] * coeff_value
                contributions[factor_name] = contribution_series
                log_info(f"  - Calculated contribution for: {factor_name}")
            else:
                log_warn(f"Coefficient for factor '{factor_name}' not found in results, skipping contribution.")

        # 11. Формирование результата
        output_data = {
            "actual_y": series_to_list(Y_clean),
            "predicted_y": series_to_list(predicted_y),
            "contributions": {name: series_to_list(series) for name, series in contributions.items()}
        }

        # 12. Очистка результата перед выводом
        sanitized_output = sanitize_for_json(output_data)
        log_info("Decomposition calculation finished successfully.")
        return sanitized_output

    except Exception as e:
        log_error(f"Error during decomposition calculation: {str(e)}")
        traceback.print_exc(file=log_buffer)
        # Возвращаем очищенный результат ошибки
        return sanitize_for_json({"error": f"Decomposition failed: {str(e)}"})

    finally:
        # Выводим все логи в stderr в самом конце
        sys.stderr.write(log_buffer.getvalue())
        sys.stderr.flush()


# --- Точка входа ---
if __name__ == "__main__":
    try:
        # Читаем весь ввод из stdin
        input_json_str = sys.stdin.read()
        if not input_json_str:
            raise ValueError("No input received from stdin.")

        # Парсим JSON
        payload = json.loads(input_json_str)

        # Выполняем расчет
        result_data = calculate_decomposition(payload)

        # Печатаем результат (JSON) в stdout
        # Используем allow_nan=False для доп. проверки, хотя sanitize должен все убрать
        print(json.dumps(result_data, allow_nan=False))

    except json.JSONDecodeError as json_err:
        # Ошибка парсинга JSON
        err_msg = f"Failed to decode input JSON: {json_err}. Input was: '{input_json_str[:200]}...'"
        log_error(err_msg)
        print(json.dumps({"error": err_msg}))
        sys.stderr.write(log_buffer.getvalue()) # Выводим логи
        sys.stderr.flush()

    except Exception as main_err:
        # Любая другая ошибка на верхнем уровне
        err_msg = f"Critical error in main execution: {main_err}"
        log_error(err_msg)
        traceback.print_exc(file=log_buffer)
        print(json.dumps({"error": err_msg}))
        sys.stderr.write(log_buffer.getvalue()) # Выводим логи
        sys.stderr.flush()