import React, { useState, useMemo, useCallback } from 'react';
import './ModelDashboard.css'; // Стили для дашборда

// Импортируем дочерние компоненты
import JobSummaryStats from './JobSummaryStats';
import ModelScatterPlot from './ModelScatterPlot'; // Раскомментируем
import ModelResultsTable from './ModelResultsTable'; // Раскомментируем (используем новую версию TanStack)

// --- Определяем доступные метрики для осей графика ---
// Ключ - как он приходит из Python (или как мы его формируем в ModelResultsTable),
// Значение - как отображать пользователю
const AVAILABLE_METRICS = {
    r_squared: 'R-squared (R²)',
    adj_r_squared: 'Adj. R-squared',
    mae: 'MAE',
    mape: 'MAPE',
    rmse: 'RMSE',
    aic: 'AIC',
    bic: 'BIC',
    n_obs: 'Num. Observations',
    numRegressors: 'Num. Regressors', // Это вычисляемое поле
    // Добавьте другие метрики по мере необходимости
};

function ModelDashboard({ progressData, totalRuns }) {
    // --- Состояния Дашборда ---
    const [scatterXAxis, setScatterXAxis] = useState('r_squared'); // Метрика для оси X по умолчанию
    const [scatterYAxis, setScatterYAxis] = useState('numRegressors'); // Метрика для оси Y по умолчанию
    // Состояние для фильтров (пока простое, можно расширить)
    const [filters, setFilters] = useState({
        showOnlyValid: false, // Показывать только валидные модели?
        // Можно добавить диапазоны метрик: minRSquared: 0, maxMae: null, etc.
    });
    // Состояние для хранения деталей выбранной модели (из графика или таблицы)
    const [selectedModelDetails, setSelectedModelDetails] = useState(null);

    // --- Расчет сводной статистики (без изменений) ---
    const summaryStats = useMemo(() => {
        // ... (код расчета summaryStats остается таким же, как в предыдущей версии) ...
        if (!progressData || !progressData.results) {
            return { processed: 0, total: totalRuns || 0, valid: 0, invalidStats: 0, invalidConstraints: 0, skipped: 0, error: 0 };
        }
        const results = progressData.results;
        const modelIds = Object.keys(results);
        let validCount = 0, invalidStatsCount = 0, skippedCount = 0, errorCount = 0;
        modelIds.forEach(id => {
            const result = results[id];
            if (!result) return;
            switch (result.status) {
                case 'completed':
                    if (result.data?.is_valid) validCount++;
                    else invalidStatsCount++; // TODO: Различать причины невалидности
                    break;
                case 'skipped': skippedCount++; break;
                case 'error': errorCount++; break;
                default: break;
            }
        });
        return {
            processed: progressData.progress || modelIds.length,
            total: totalRuns || progressData.totalModels || modelIds.length || 0,
            valid: validCount, invalidStats: invalidStatsCount, invalidConstraints: 0,
            skipped: skippedCount, error: errorCount,
        };
    }, [progressData, totalRuns]);

    // --- Подготовка и фильтрация данных для графика и таблицы ---
    const filteredModelData = useMemo(() => {
        if (!progressData || !progressData.results) return {}; // Возвращаем пустой объект

        const results = progressData.results;
        const filtered = {};

        Object.entries(results).forEach(([id, result]) => {
            // Включаем только завершенные модели
            if (result?.status !== 'completed') return;

            // Применяем фильтр "только валидные"
            if (filters.showOnlyValid && !result.data?.is_valid) {
                return;
            }

            // TODO: Применить другие фильтры (по диапазонам метрик и т.д.)

            // Если модель прошла все фильтры, добавляем ее
            filtered[id] = result;
        });

        return filtered;
    }, [progressData, filters]); // Пересчитываем при изменении данных или фильтров

    // --- Обработчики ---
    const handleXAxisChange = (event) => {
        setScatterXAxis(event.target.value);
    };

    const handleYAxisChange = (event) => {
        setScatterYAxis(event.target.value);
    };

    const handleFilterChange = (event) => {
        const { name, type, checked, value } = event.target;
        setFilters(prevFilters => ({
            ...prevFilters,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    // Обработчик клика на точку графика или строку таблицы
    const handleModelSelect = useCallback((modelId) => {
        const result = progressData?.results?.[modelId];
        if (result && result.status === 'completed') {
            console.log(`Dashboard: Model selected - ${modelId}`, result.data);
            setSelectedModelDetails({ id: modelId, ...result.data });
        } else {
            setSelectedModelDetails(null); // Сбрасываем, если модель не найдена или не завершена
        }
    }, [progressData]); // Зависимость от progressData, чтобы иметь доступ к актуальным результатам

    // --- Рендер ---
    if (!progressData) {
        return <div className="dashboard-loading">Loading dashboard data...</div>;
    }

    return (
        <div className="model-dashboard">

            {/* 1. Сводная Статистика */}
            <div className="dashboard-section summary-stats-section">
                <JobSummaryStats stats={summaryStats} status={progressData.status} />
            </div>

            {/* --- Разделитель и Фильтры --- */}
            <div className="dashboard-section filter-section">
                 <h4>Filters & Options</h4>
                 <div className="filter-controls">
                     <label>
                         <input
                             type="checkbox"
                             name="showOnlyValid"
                             checked={filters.showOnlyValid}
                             onChange={handleFilterChange}
                         />
                         Show Only Valid Models
                     </label>
                     {/* TODO: Добавить другие фильтры */}
                 </div>
            </div>


            {/* 2. Scatter Plot */}
            <div className="dashboard-section scatter-plot-section">
                <div className="section-header">
                    <h4>Model Scatter Plot</h4>
                    {/* Элементы управления осями */}
                    <div className="plot-controls">
                        <label htmlFor="x-axis-select">X-Axis:</label>
                        <select id="x-axis-select" value={scatterXAxis} onChange={handleXAxisChange}>
                            {Object.entries(AVAILABLE_METRICS).map(([key, label]) => (
                                <option key={key} value={key}>{label}</option>
                            ))}
                        </select>
                        <label htmlFor="y-axis-select">Y-Axis:</label>
                        <select id="y-axis-select" value={scatterYAxis} onChange={handleYAxisChange}>
                            {Object.entries(AVAILABLE_METRICS).map(([key, label]) => (
                                <option key={key} value={key}>{label}</option>
                            ))}
                        </select>
                    </div>
                </div>
                 {/* Передаем отфильтрованные данные и выбранные оси */}
                 <ModelScatterPlot
                    // Передаем отфильтрованные данные
                    modelData={filteredModelData}
                    xAxisMetric={scatterXAxis}
                    yAxisMetric={scatterYAxis}
                    onPointClick={handleModelSelect} // Передаем callback
                />
            </div>

            {/* 3. Таблица Результатов */}
            <div className="dashboard-section results-table-section">
                 <div className="section-header">
                     <h4>Model Results Table</h4>
                     {/* TODO: Добавить контролы для таблицы (выбор колонок) */}
                     {/* <div className="table-controls">
                         <button>Configure Columns</button>
                     </div> */}
                 </div>
                 {/* Передаем отфильтрованные данные */}
                 <ModelResultsTable
                    // Передаем отфильтрованные данные
                    modelData={filteredModelData}
                    onRowClick={handleModelSelect} // Передаем callback
                />
            </div>

             {/* 4. Панель Деталей Выбранной Модели */}
             {selectedModelDetails && (
                <div className="dashboard-section selected-model-details-section">
                     <button className="close-details-btn" onClick={() => setSelectedModelDetails(null)} title="Close details">×</button>
                    <h5>Details for Model: {selectedModelDetails.id}</h5>
                    <pre>
                        {JSON.stringify(selectedModelDetails, null, 2)}
                    </pre>
                    {/* Можно добавить более красивый рендеринг */}
                </div>
            )}

        </div> // Конец .model-dashboard
    );
}

export default ModelDashboard;