# python_scripts/step3_run_regression_master.py
import sys
import json
import traceback
import pandas as pd
import numpy as np
import statsmodels.api as sm
from statsmodels.stats.outliers_influence import variance_inflation_factor
from statsmodels.stats.diagnostic import het_breuschpagan
import io
import warnings
import itertools
import time # Для периодической отправки

# Игнорируем предупреждения от statsmodels, если нужно
warnings.filterwarnings("ignore")

log_buffer = io.StringIO()

# --- Функции логирования ---
def log_error(message): print(f"ERROR_MASTER: {message}", file=log_buffer)
def log_info(message): print(f"INFO_MASTER: {message}", file=log_buffer)
def log_warn(message): print(f"WARN_MASTER: {message}", file=log_buffer)

# --- Функция для создания лагированных признаков (из старого скрипта) ---
def create_lagged_features(df, features_with_lags):
    lagged_df = pd.DataFrame(index=df.index)
    original_feature_names = []
    for feature, lag in features_with_lags.items():
        if feature in df.columns:
            if lag == 0:
                lagged_df[f"{feature}_L0"] = df[feature]
                original_feature_names.append(f"{feature}_L0")
            elif lag > 0:
                lagged_df[f"{feature}_L{lag}"] = df[feature].shift(lag)
                original_feature_names.append(f"{feature}_L{lag}")
            else:
                 log_warn(f"Invalid lag {lag} for feature {feature}, skipping.")
        else:
            log_warn(f"Feature {feature} not found in input data, skipping.")
    return lagged_df, original_feature_names

# --- Функция для запуска ОДНОЙ регрессии (из старого скрипта, немного адаптирована) ---
def run_single_ols(y_series, all_x_df, spec, config, model_id):
    try:
        # 1. Создание лагированных регрессоров X для текущей спецификации
        features_to_lag = spec.get('regressors', {})
        X_lagged_df, final_regressor_names = create_lagged_features(all_x_df, features_to_lag)

        # 2. Объединение и очистка от NaN
        model_data = pd.concat([y_series.rename('__Y__'), X_lagged_df], axis=1)
        model_data_clean = model_data.dropna()

        if model_data_clean.empty or len(model_data_clean) < len(final_regressor_names) + 2:
             # Возвращаем статус 'skipped' вместо ошибки
             return {"status": "skipped", "reason": f"Not enough observations ({len(model_data_clean)})"}

        Y = model_data_clean['__Y__']
        X = model_data_clean[final_regressor_names]

        # 3. Добавление константы
        include_constant = spec.get('include_constant', True)
        if include_constant:
            X = sm.add_constant(X, has_constant='add')

        # 4. Запуск OLS
        model_results = sm.OLS(Y, X).fit()

        # 5. Сбор результатов
        results_data = {
            "coefficients": model_results.params.to_dict(),
            "p_values": model_results.pvalues.to_dict(),
            "n_obs": int(model_results.nobs),
            "rsquared": model_results.rsquared,
            "rsquared_adj": model_results.rsquared_adj,
            "aic": model_results.aic,
            "bic": model_results.bic,
            "metrics": {},
            "test_results": {},
            "is_valid": True # Начинаем с предположения о валидности
        }

        # 6. Расчет метрик
        metrics_config = config.get('metrics', {})
        predictions = model_results.predict(X)
        residuals = Y - predictions
        if metrics_config.get('mae'): results_data["metrics"]["mae"] = np.mean(np.abs(residuals))
        if metrics_config.get('mape'): results_data["metrics"]["mape"] = np.mean(np.abs(residuals / Y)) * 100 if np.all(Y != 0) else np.inf
        if metrics_config.get('rmse'): results_data["metrics"]["rmse"] = np.sqrt(np.mean(residuals**2))
        if metrics_config.get('rSquared'):
             results_data["metrics"]["r_squared"] = model_results.rsquared
             results_data["metrics"]["adj_r_squared"] = model_results.rsquared_adj

        # 7. Проведение тестов
        tests_config = config.get('tests', {})
        X_for_tests = X.drop('const', axis=1, errors='ignore')

        # p-value test
        results_data["test_results"]["p_value_ok"] = True
        if tests_config.get('pValue'):
            threshold = config.get('pValueThreshold', 0.05)
            pvals_no_const = model_results.pvalues.drop('const', errors='ignore')
            if not pvals_no_const.empty and pvals_no_const.max() > threshold:
                results_data["test_results"]["p_value_ok"] = False
                results_data["is_valid"] = False

        # VIF test
        results_data["test_results"]["vif_ok"] = True
        if tests_config.get('vif') and X_for_tests.shape[1] >= 2:
            try:
                vif_values = [variance_inflation_factor(X_for_tests.values, i) for i in range(X_for_tests.shape[1])]
                results_data["test_results"]["vif_values"] = dict(zip(X_for_tests.columns, vif_values))
                if max(vif_values) > 10:
                    results_data["test_results"]["vif_ok"] = False
                    results_data["is_valid"] = False
            except Exception as vif_e:
                 log_warn(f"VIF calculation failed for {model_id}: {vif_e}")
                 results_data["test_results"]["vif_ok"] = False
                 results_data["is_valid"] = False

        # Heteroskedasticity (Breusch-Pagan) test
        results_data["test_results"]["heteroskedasticity_ok"] = True
        if tests_config.get('heteroskedasticity') and not X.empty:
             try:
                 bp_test = het_breuschpagan(model_results.resid, model_results.model.exog)
                 results_data["test_results"]["bp_pvalue"] = bp_test[1]
                 if bp_test[1] < 0.05:
                     results_data["test_results"]["heteroskedasticity_ok"] = False
                     results_data["is_valid"] = False
             except Exception as bp_e:
                 log_warn(f"Breusch-Pagan test failed for {model_id}: {bp_e}")
                 results_data["test_results"]["heteroskedasticity_ok"] = False
                 results_data["is_valid"] = False

        return {"status": "completed", "data": results_data}

    except Exception as e:
        log_error(f"Error in run_single_ols for {model_id}: {str(e)}")
        # traceback.print_exc(file=log_buffer) # Можно раскомментировать для детального трейсбека
        return {"status": "error", "error": f"Failed OLS: {str(e)}"}

# --- Основная функция ---
def run_regression_master(input_json_str):
    processed_results = {}
    total_models_calculated = 0
    try:
        payload = json.loads(input_json_str)
        log_info("--- Starting Regression Master ---")

        # 1. Извлечение данных и конфигурации
        y_spec = payload.get('dependentVariable')
        all_x_spec = payload.get('regressors') # {name: [[ts, val],...], ...}
        config = payload.get('config', {})

        if not y_spec or not y_spec.get('name') or not y_spec.get('data') or not all_x_spec:
            raise ValueError("Invalid payload structure: missing dependentVariable or regressors.")

        log_info(f"Y: {y_spec['name']}")
        log_info(f"Available X: {list(all_x_spec.keys())}")
        log_info(f"Config: {config}")

        # 2. Подготовка данных Y
        y_df = pd.DataFrame(y_spec['data'], columns=['timestamp', 'value'])
        y_df['timestamp'] = pd.to_datetime(y_df['timestamp'], errors='coerce')
        y_df = y_df.dropna(subset=['timestamp']).set_index('timestamp')
        y_series = y_df['value'].astype(float).sort_index()
        y_series = y_series[~y_series.index.duplicated(keep='first')]
        if y_series.empty: raise ValueError("Dependent variable series is empty after cleaning.")

        # 3. Подготовка данных X (всех)
        all_x_df = pd.DataFrame(index=y_df.index)
        for name, data in all_x_spec.items():
            temp_df = pd.DataFrame(data, columns=['timestamp', 'value'])
            temp_df['timestamp'] = pd.to_datetime(temp_df['timestamp'], errors='coerce')
            temp_df = temp_df.dropna(subset=['timestamp']).set_index('timestamp')
            temp_series = temp_df['value'].astype(float).sort_index()
            temp_series = temp_series[~temp_series.index.duplicated(keep='first')]
            all_x_df[name] = temp_series
        all_x_df = all_x_df.reindex(y_series.index) # Выравниваем по Y

        # 4. Генерация спецификаций и запуск моделей
        included_regressor_names = list(all_x_spec.keys())
        k = len(included_regressor_names)
        N = config.get('maxLagDepth', 0)
        constant_status = config.get('constantStatus', 'include')
        lag_values = list(range(N + 1)) # [0, 1, ..., N]

        model_counter = 0
        batch_results = {}
        last_update_time = time.time()
        models_since_last_update = 0
        UPDATE_INTERVAL_SECONDS = 1.5 # Как часто отправлять обновления (в секундах)
        UPDATE_BATCH_SIZE = 500      # Или каждые N моделей

        log_info(f"Generating models: k={k}, N={N}, constant='{constant_status}'")

        for m in range(k + 1): # Размер подмножества регрессоров
            for subset_indices in itertools.combinations(range(k), m):
                subset_names = [included_regressor_names[i] for i in subset_indices]

                # Генерируем комбинации лагов для этого подмножества
                lag_combinations = itertools.product(lag_values, repeat=m)

                for lags in lag_combinations:
                    regressors_with_lags = dict(zip(subset_names, lags))

                    # Формируем спецификации в зависимости от статуса константы
                    specs_to_run = []
                    if constant_status == 'include':
                        model_counter += 1
                        specs_to_run.append({"model_id": f"m_{model_counter}", "regressors": regressors_with_lags, "include_constant": True})
                    elif constant_status == 'exclude':
                        if m > 0: # Не запускаем модель без регрессоров и без константы
                            model_counter += 1
                            specs_to_run.append({"model_id": f"m_{model_counter}", "regressors": regressors_with_lags, "include_constant": False})
                    else: # constant_status == 'test'
                        model_counter += 1
                        specs_to_run.append({"model_id": f"m_{model_counter}_c", "regressors": regressors_with_lags, "include_constant": True})
                        if m > 0: # Модель без регрессоров тестировать на константу нет смысла
                            model_counter += 1
                            specs_to_run.append({"model_id": f"m_{model_counter}_nc", "regressors": regressors_with_lags, "include_constant": False})

                    # Запускаем OLS для каждой сформированной спецификации
                    for current_spec in specs_to_run:
                        model_id = current_spec["model_id"]
                        # Запускаем OLS
                        result = run_single_ols(y_series, all_x_df, current_spec, config, model_id)
                        batch_results[model_id] = result # Сохраняем результат в батч
                        total_models_calculated += 1
                        models_since_last_update += 1

                        # Проверяем, не пора ли отправить обновление прогресса
                        current_time = time.time()
                        if models_since_last_update >= UPDATE_BATCH_SIZE or (current_time - last_update_time) >= UPDATE_INTERVAL_SECONDS:
                             progress_update = {
                                 "type": "progress",
                                 "processed_batch": batch_results,
                                 "total_calculated": total_models_calculated
                             }
                             # Печатаем JSON в stdout + НОВАЯ СТРОКА
                             print(f"PROGRESS_UPDATE:{json.dumps(progress_update)}", flush=True)
                             log_info(f"Sent progress update. Batch size: {len(batch_results)}. Total calculated: {total_models_calculated}")
                             # Сбрасываем батч и счетчики
                             batch_results = {}
                             models_since_last_update = 0
                             last_update_time = current_time

        # Отправляем оставшиеся результаты, если они есть
        if batch_results:
            progress_update = {
                "type": "progress",
                "processed_batch": batch_results,
                "total_calculated": total_models_calculated
            }
            print(f"PROGRESS_UPDATE:{json.dumps(progress_update)}", flush=True)
            log_info(f"Sent final batch update. Batch size: {len(batch_results)}. Total calculated: {total_models_calculated}")

        # Финальное сообщение
        final_result = {
            "type": "final",
            "status": "finished",
            "total_models_calculated": total_models_calculated,
            "message": "Regression search finished successfully."
        }
        print(f"FINAL_RESULT:{json.dumps(final_result)}", flush=True)
        log_info("Regression Master Finished.")

    except Exception as e:
        log_error(f"Critical error in regression master: {str(e)}")
        traceback.print_exc(file=log_buffer)
        error_result = {
            "type": "final",
            "status": "error",
            "total_models_calculated": total_models_calculated,
            "error": f"Master script failed: {str(e)}"
        }
        # Печатаем ошибку в stdout, чтобы Node.js ее получил как финальный результат
        print(f"FINAL_RESULT:{json.dumps(error_result)}", flush=True)

    finally:
        # Выводим все логи в stderr в самом конце
        sys.stderr.write(log_buffer.getvalue())
        sys.stderr.flush()


if __name__ == "__main__":
    input_json_str = sys.stdin.read()
    run_regression_master(input_json_str)