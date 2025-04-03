import React, { useState, useMemo, useCallback } from 'react';
import './ModelDashboard.css'; // Стили для дашборда

// Импортируем дочерние компоненты
import JobSummaryStats from './JobSummaryStats';
import ModelScatterPlot from './ModelScatterPlot';
import ModelResultsTable from './ModelResultsTable';

// --- Определяем доступные метрики для осей графика ---
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

// --- Иконки для кнопки сворачивания/разворачивания ---
const ChevronDown = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fillRule="evenodd" d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"/></svg>;
const ChevronUp = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fillRule="evenodd" d="M7.646 4.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1-.708.708L8 5.707l-5.646 5.647a.5.5 0 0 1-.708-.708l6-6z"/></svg>;


function ModelDashboard({ progressData, totalRuns }) {
    // --- Состояния Дашборда ---
    const [scatterXAxis, setScatterXAxis] = useState('r_squared');
    const [scatterYAxis, setScatterYAxis] = useState('numRegressors');
    const [filters, setFilters] = useState({ showOnlyValid: false });
    const [selectedModelDetails, setSelectedModelDetails] = useState(null);
    // <<< ИЗМЕНЕНИЕ: Начальное состояние false, чтобы панель была свернута, пока ничего не выбрано >>>
    const [isDetailsVisible, setIsDetailsVisible] = useState(false);

    // --- Расчет сводной статистики (без изменений) ---
    const summaryStats = useMemo(() => {
        // ... (код без изменений) ...
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
                    else invalidStatsCount++;
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

    // --- Подготовка и фильтрация данных для графика и таблицы (без изменений) ---
    const filteredModelData = useMemo(() => {
        // ... (код без изменений) ...
        if (!progressData || !progressData.results) return {};
        const results = progressData.results;
        const filtered = {};
        Object.entries(results).forEach(([id, result]) => {
            if (result?.status !== 'completed') return;
            if (filters.showOnlyValid && !result.data?.is_valid) return;
            filtered[id] = result;
        });
        return filtered;
    }, [progressData, filters]);

    // --- Обработчики ---
    const handleXAxisChange = (event) => setScatterXAxis(event.target.value);
    const handleYAxisChange = (event) => setScatterYAxis(event.target.value);
    const handleFilterChange = (event) => {
        const { name, type, checked, value } = event.target;
        setFilters(prevFilters => ({ ...prevFilters, [name]: type === 'checkbox' ? checked : value }));
    };

    // Обработчик клика на точку графика или строку таблицы
    const handleModelSelect = useCallback((modelId) => {
        const result = progressData?.results?.[modelId];
        // <<< ИЗМЕНЕНИЕ: Логика установки isDetailsVisible >>>
        if (modelId && result && result.status === 'completed') {
            // Если выбрана та же модель, что и была, переключаем видимость
            if (selectedModelDetails?.id === modelId) {
                setIsDetailsVisible(prev => !prev);
            } else {
            // Если выбрана новая модель, устанавливаем ее и показываем детали
                setSelectedModelDetails({ id: modelId, ...result.data });
                setIsDetailsVisible(true);
            }
        } else {
            // Если клик мимо или модель не найдена/не завершена,
            // сбрасываем выбор и скрываем (сворачиваем) панель
            setSelectedModelDetails(null);
            setIsDetailsVisible(false);
        }
    }, [progressData, selectedModelDetails]); // Зависимости остались прежними

    // Обработчик кнопки для сворачивания/разворачивания деталей
    const toggleDetailsVisibility = () => {
        // Позволяем переключать видимость только если модель выбрана
        if (selectedModelDetails) {
            setIsDetailsVisible(prev => !prev);
        }
    };

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

            {/* 2. Фильтры */}
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
                 </div>
            </div>

            {/* 3. Scatter Plot */}
            <div className="dashboard-section scatter-plot-section">
                <div className="section-header">
                    <h4>Model Scatter Plot</h4>
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
                 <div className="plot-content-wrapper">
                     <ModelScatterPlot
                        modelData={filteredModelData}
                        xAxisMetric={scatterXAxis}
                        yAxisMetric={scatterYAxis}
                        onPointClick={handleModelSelect}
                        selectedModelId={selectedModelDetails?.id}
                    />
                 </div>
            </div>

            {/* 4. Панель Деталей Выбранной Модели */}
            {/* <<< ИЗМЕНЕНИЕ: Убрали класс hidden, контейнер рендерится всегда >>> */}
            <div className={`dashboard-section selected-model-details-section ${isDetailsVisible ? 'expanded' : 'collapsed'}`}>
                 {/* Заголовок и кнопка рендерятся только если модель выбрана */}
                 {selectedModelDetails ? (
                     <div className="section-header details-header" onClick={toggleDetailsVisibility} title={isDetailsVisible ? 'Hide Details' : 'Show Details'}> {/* Добавили onClick и title на весь хедер */}
                         <h5>Details for Model: {selectedModelDetails.id}</h5>
                         <button className="toggle-details-btn"> {/* Убрали onClick отсюда */}
                             {isDetailsVisible ? <ChevronUp /> : <ChevronDown />}
                         </button>
                     </div>
                 ) : (
                     // <<< ИЗМЕНЕНИЕ: Показываем заголовок-заглушку, если модель не выбрана >>>
                     <div className="section-header details-header placeholder-header">
                         <h5>Model Details</h5>
                         {/* Можно добавить иконку или текст, указывающий на неактивность */}
                     </div>
                 )}
                 {/* Содержимое рендерится только если модель выбрана И панель развернута */}
                 {selectedModelDetails && isDetailsVisible && (
                     <div className="details-content">
                         <pre>
                             {JSON.stringify(selectedModelDetails, null, 2)}
                         </pre>
                     </div>
                 )}
                 {/* <<< ИЗМЕНЕНИЕ: Убрали отдельный placeholder, т.к. панель теперь всегда видна >>> */}
                 {/* {!selectedModelDetails && (
                     <div className="details-placeholder">Click on a point/row to see details</div>
                 )} */}
            </div>


            {/* 5. Таблица Результатов */}
            <div className="dashboard-section results-table-section">
                 <div className="section-header">
                     <h4>Model Results Table</h4>
                 </div>
                 <div className="table-content-wrapper">
                     <ModelResultsTable
                        modelData={filteredModelData}
                        onRowClick={handleModelSelect}
                        selectedModelId={selectedModelDetails?.id}
                    />
                 </div>
            </div>

        </div> // Конец .model-dashboard
    );
}

export default ModelDashboard;