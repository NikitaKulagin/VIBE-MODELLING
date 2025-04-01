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

# Игнорируем предупреждения от statsmodels, если нужно
warnings.filterwarnings("ignore")

log_buffer = io.StringIO()

def log_error(message): print(f"ERROR_REG: {message}", file=log_buffer)
def log_info(message): print(f"INFO_REG: {message}", file=log_buffer)

def create_lagged_features(df, features_with_lags):
    """Создает DataFrame с лагированными признаками."""
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

def run_single_regression(input_json_str):
    model_id = "unknown_model" # Значение по умолчанию
    try:
        payload = json.loads(input_json_str)
        model_id = payload.get('model_id', model_id)
        log_info(f"--- Processing Model ID: {model_id} ---")

        # 1. Извлечение данных и конфигурации
        y_spec = payload.get('dependentVariable')
        all_x_spec = payload.get('regressors') # {name: [[ts, val],...], ...}
        spec = payload.get('specification') # { regressors: {name: lag, ...}, include_constant: bool }
        config = payload.get('config', {})

        if not y_spec or not y_spec.get('name') or not y_spec.get('data') or not all_x_spec or not spec:
            raise ValueError("Invalid payload structure: missing dependentVariable, regressors, or specification.")

        log_info(f"Y: {y_spec['name']}")
        log_info(f"X spec: {spec.get('regressors', {})}")
        log_info(f"Include Constant: {spec.get('include_constant', True)}")
        log_info(f"Config: {config}")

        # 2. Подготовка данных Y
        y_df = pd.DataFrame(y_spec['data'], columns=['timestamp', 'value'])
        y_df['timestamp'] = pd.to_datetime(y_df['timestamp'], errors='coerce')
        y_df = y_df.dropna(subset=['timestamp']).set_index('timestamp')
        y_series = y_df['value'].astype(float).sort_index()
        y_series = y_series[~y_series.index.duplicated(keep='first')]
        if y_series.empty: raise ValueError("Dependent variable series is empty after cleaning.")

        # 3. Подготовка данных X
        all_x_df = pd.DataFrame(index=y_df.index) # Начнем с индекса Y
        for name, data in all_x_spec.items():
            temp_df = pd.DataFrame(data, columns=['timestamp', 'value'])
            temp_df['timestamp'] = pd.to_datetime(temp_df['timestamp'], errors='coerce')
            temp_df = temp_df.dropna(subset=['timestamp']).set_index('timestamp')
            temp_series = temp_df['value'].astype(float).sort_index()
            temp_series = temp_series[~temp_series.index.duplicated(keep='first')]
            all_x_df[name] = temp_series
        all_x_df = all_x_df.reindex(y_series.index) # Выравниваем по Y

        # 4. Создание лагированных регрессоров X для текущей спецификации
        features_to_lag = spec.get('regressors', {})
        X_lagged_df, final_regressor_names = create_lagged_features(all_x_df, features_to_lag)

        # 5. Объединение и очистка от NaN
        model_data = pd.concat([y_series.rename('__Y__'), X_lagged_df], axis=1)
        model_data_clean = model_data.dropna()

        if model_data_clean.empty or len(model_data_clean) < len(final_regressor_names) + 2: # Нужно достаточно наблюдений
             raise ValueError(f"Not enough observations after lagging and cleaning NaNs (available: {len(model_data_clean)}).")

        Y = model_data_clean['__Y__']
        X = model_data_clean[final_regressor_names]

        # 6. Добавление константы
        include_constant = spec.get('include_constant', True)
        if include_constant:
            X = sm.add_constant(X, has_constant='add')
            log_info("Constant added to regressors.")

        # 7. Запуск OLS
        log_info(f"Running OLS with {len(Y)} observations and regressors: {list(X.columns)}")
        model_results = sm.OLS(Y, X).fit()
        log_info("OLS fitting completed.")

        # 8. Сбор результатов
        results = {
            "model_id": model_id,
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

        # 9. Расчет метрик (если запрошено)
        metrics_config = config.get('metrics', {})
        predictions = model_results.predict(X)
        residuals = Y - predictions
        if metrics_config.get('mae'): results["metrics"]["mae"] = np.mean(np.abs(residuals))
        if metrics_config.get('mape'): results["metrics"]["mape"] = np.mean(np.abs(residuals / Y)) * 100 if np.all(Y != 0) else np.inf
        if metrics_config.get('rmse'): results["metrics"]["rmse"] = np.sqrt(np.mean(residuals**2))
        # Добавляем R-квадраты в метрики для единообразия
        if metrics_config.get('rSquared'):
             results["metrics"]["r_squared"] = model_results.rsquared
             results["metrics"]["adj_r_squared"] = model_results.rsquared_adj

        # 10. Проведение тестов (если запрошено)
        tests_config = config.get('tests', {})
        X_for_tests = X.drop('const', axis=1, errors='ignore') # Тесты проводим без константы

        # p-value test
        results["test_results"]["p_value_ok"] = True
        if tests_config.get('pValue'):
            threshold = config.get('pValueThreshold', 0.05)
            pvals_no_const = model_results.pvalues.drop('const', errors='ignore')
            if not pvals_no_const.empty and pvals_no_const.max() > threshold:
                results["test_results"]["p_value_ok"] = False
                results["is_valid"] = False
                log_info(f"Test Failed: Max p-value > {threshold}")

        # VIF test
        results["test_results"]["vif_ok"] = True
        if tests_config.get('vif') and X_for_tests.shape[1] >= 2: # VIF нужен для >= 2 регрессоров
            try:
                vif_values = [variance_inflation_factor(X_for_tests.values, i) for i in range(X_for_tests.shape[1])]
                results["test_results"]["vif_values"] = dict(zip(X_for_tests.columns, vif_values))
                if max(vif_values) > 10: # Используем порог 10
                    results["test_results"]["vif_ok"] = False
                    results["is_valid"] = False
                    log_info(f"Test Failed: Max VIF > 10")
            except Exception as vif_e:
                 log_error(f"VIF calculation failed: {vif_e}")
                 results["test_results"]["vif_ok"] = False # Считаем невалидным при ошибке
                 results["is_valid"] = False

        # Heteroskedasticity (Breusch-Pagan) test
        results["test_results"]["heteroskedasticity_ok"] = True
        if tests_config.get('heteroskedasticity') and not X.empty:
             try:
                 # Используем остатки и экзогенные переменные (включая константу, если есть)
                 bp_test = het_breuschpagan(model_results.resid, model_results.model.exog)
                 results["test_results"]["bp_pvalue"] = bp_test[1] # p-value теста
                 if bp_test[1] < 0.05: # Если p-value < 0.05, отвергаем H0 (гомоскедастичность)
                     results["test_results"]["heteroskedasticity_ok"] = False
                     results["is_valid"] = False
                     log_info(f"Test Failed: Heteroskedasticity detected (BP p-value < 0.05)")
             except Exception as bp_e:
                 log_error(f"Breusch-Pagan test failed: {bp_e}")
                 results["test_results"]["heteroskedasticity_ok"] = False # Считаем невалидным при ошибке
                 results["is_valid"] = False

        log_info(f"Model {model_id} processing finished. Is Valid: {results['is_valid']}")
        return json.dumps(results)

    except Exception as e:
        log_error(f"Error processing spec {model_id}: {str(e)}")
        traceback.print_exc(file=log_buffer)
        error_result = {"model_id": model_id, "error": f"Failed to process model: {str(e)}", "is_valid": False, "status": "error"}
        return json.dumps(error_result)


if __name__ == "__main__":
    input_json_str = sys.stdin.read()
    final_result_json = run_single_regression(input_json_str)
    sys.stderr.write(log_buffer.getvalue()) # Вывод логов в stderr
    print(final_result_json) # Вывод результата (JSON) в stdout