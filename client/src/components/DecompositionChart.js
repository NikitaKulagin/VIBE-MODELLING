import React, { useState, useMemo, useCallback, useEffect } from 'react';
import axios from 'axios';
import './ModelDashboard.css';

// Импортируем дочерние компоненты
import JobSummaryStats from './JobSummaryStats';
import ModelScatterPlot from './ModelScatterPlot';
import ModelResultsTable from './ModelResultsTable';
import DecompositionChart from './DecompositionChart'; // <<< НОВЫЙ ИМПОРТ
import ErrorBoundary from './ErrorBoundary'; // <<< ДОБАВИТЬ ИМПОРТ

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
    numRegressors: 'Num. Regressors',
};

// --- Иконки для кнопки сворачивания/разворачивания ---
const ChevronDown = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fillRule="evenodd" d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"/></svg>;
const ChevronUp = () => <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fillRule="evenodd" d="M7.646 4.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1-.708.708L8 5.707l-5.646 5.647a.5.5 0 0 1-.708-.708l6-6z"/></svg>;


function ModelDashboard({ progressData, totalRuns }) {
    // --- Состояния Дашборда ---
    const [scatterXAxis, setScatterXAxis] = useState('r_squared');
    const [scatterYAxis, setScatterYAxis] = useState('numRegressors');
    const [filters, setFilters] = useState({ showOnlyValid: false });
    const [selectedModelDetails, setSelectedModelDetails] = useState(null); // Содержит { id, coefficients, p_values, ... }
    const [isDetailsVisible, setIsDetailsVisible] = useState(false);

    // <<< НОВЫЕ СОСТОЯНИЯ для декомпозиции >>>
    const [decompositionData, setDecompositionData] = useState(null);
    const [isDecompLoading, setIsDecompLoading] = useState(false);
    const [decompError, setDecompError] = useState(null);
    // <<< КОНЕЦ НОВЫХ СОСТОЯНИЙ >>>

    // --- Расчет сводной статистики (без изменений) ---
    const summaryStats = useMemo(() => {
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
        console.log('[handleModelSelect] Clicked:', modelId);
        const result = progressData?.results?.[modelId];
        if (modelId && result && result.status === 'completed') {
            if (selectedModelDetails?.id === modelId) {
                console.log('[handleModelSelect] Toggling details visibility.');
                setIsDetailsVisible(prev => !prev);
                if (isDetailsVisible) {
                    console.log('[handleModelSelect] Hiding details, clearing decomp data.');
                    setDecompositionData(null);
                    setDecompError(null);
                }
            } else {
                console.log('[handleModelSelect] Selecting new model:', modelId);
                setSelectedModelDetails({ id: modelId, ...result.data });
                setIsDetailsVisible(true);
                setDecompositionData(null);
                // <<< ИЗМЕНЕНИЕ: Убрали setIsDecompLoading(true) отсюда >>>
                setDecompError(null);
                // console.log('[handleModelSelect] Set isDecompLoading to true.'); // Лог больше не актуален
            }
        } else {
            console.log('[handleModelSelect] Deselecting model or invalid click.');
            setSelectedModelDetails(null);
            setIsDetailsVisible(false);
            setDecompositionData(null);
            setDecompError(null);
        }
    }, [progressData, selectedModelDetails, isDetailsVisible]);

    // Обработчик кнопки для сворачивания/разворачивания деталей
    const toggleDetailsVisibility = () => {
        console.log('[toggleDetailsVisibility] Toggling.');
        if (selectedModelDetails) {
            setIsDetailsVisible(prev => !prev);
            if (isDetailsVisible) {
                console.log('[toggleDetailsVisibility] Hiding details, clearing decomp data.');
                setDecompositionData(null);
                setDecompError(null);
            }
        }
    };

    // --- useEffect для загрузки данных декомпозиции ---
    useEffect(() => {
        console.log('[Decomp useEffect] Checking conditions:', {
            selectedModelId: selectedModelDetails?.id, isDetailsVisible,
            hasDecompData: !!decompositionData, isDecompLoading, hasDecompError: !!decompError
        });

        if (selectedModelDetails && isDetailsVisible && !decompositionData && !isDecompLoading && !decompError) {
            console.log('[Decomp useEffect] Conditions met. Starting fetch.');

            const fetchDecomposition = async () => {
                // <<< ИЗМЕНЕНИЕ: Устанавливаем флаг загрузки здесь >>>
                setIsDecompLoading(true);
                setDecompError(null);
                const jobId = progressData?.jobId;
                const modelId = selectedModelDetails.id;

                console.log('[fetchDecomposition] Job ID:', jobId);
                console.log('[fetchDecomposition] Model ID:', modelId);

                if (!jobId) {
                    console.error('[fetchDecomposition] Job ID not found!');
                    setDecompError("Job ID not found in progress data.");
                    setIsDecompLoading(false);
                    return;
                }

                const regressors_with_lags = {};
                let include_constant = false;
                try {
                    if (selectedModelDetails.coefficients) {
                        Object.keys(selectedModelDetails.coefficients).forEach(key => {
                            if (key === 'const') { include_constant = true; }
                            else {
                                const parts = key.split('_L');
                                if (parts.length === 2) {
                                    const name = parts[0]; const lag = parseInt(parts[1], 10);
                                    if (!isNaN(lag)) { regressors_with_lags[name] = lag; }
                                    else { console.warn(`[fetchDecomposition] Could not parse lag for key: ${key}`); }
                                } else { console.warn(`[fetchDecomposition] Unexpected coefficient key format: ${key}`); }
                            }
                        });
                    } else { console.warn('[fetchDecomposition] selectedModelDetails.coefficients is missing!'); }
                } catch (specError) {
                    console.error('[fetchDecomposition] Error creating modelSpecification:', specError);
                    setDecompError("Error preparing model specification for request.");
                    setIsDecompLoading(false); return;
                }

                const modelSpecification = { regressors_with_lags, include_constant };

                console.log("[fetchDecomposition] Model Specification:", modelSpecification);
                const apiUrl = `http://localhost:5001/api/get_model_decomposition/${jobId}/${modelId}`;
                console.log("[fetchDecomposition] Sending POST request to:", apiUrl);

                try {
                    const response = await axios.post(apiUrl, { modelSpecification });
                    console.log("[fetchDecomposition] Received response status:", response.status);
                    console.log("[fetchDecomposition] Received response data:", response.data);

                    if (response.data && !response.data.error) {
                        setDecompositionData(response.data);
                        console.log("[fetchDecomposition] Decomposition data successfully set.");
                    } else { throw new Error(response.data?.error || "Invalid decomposition data received from server."); }
                } catch (err) {
                    console.error("[fetchDecomposition] Error during axios request:", err);
                    setDecompError(err.response?.data?.error || err.message || "Failed to fetch decomposition.");
                } finally {
                    console.log("[fetchDecomposition] Setting isDecompLoading to false.");
                    setIsDecompLoading(false);
                }
            };

            fetchDecomposition();
        } else {
             console.log('[Decomp useEffect] Conditions NOT met or already loading/loaded/errored.');
        }

        if (!isDetailsVisible || !selectedModelDetails) {
             if(isDecompLoading) {
                 console.log('[Decomp useEffect Cleanup] Hiding details or model changed, setting isDecompLoading to false.');
                 setIsDecompLoading(false);
             }
        }

    }, [selectedModelDetails, isDetailsVisible, decompositionData, isDecompLoading, decompError, progressData?.jobId]);


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
                         <input type="checkbox" name="showOnlyValid" checked={filters.showOnlyValid} onChange={handleFilterChange} />
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
                            {Object.entries(AVAILABLE_METRICS).map(([key, label]) => (<option key={key} value={key}>{label}</option>))}
                        </select>
                        <label htmlFor="y-axis-select">Y-Axis:</label>
                        <select id="y-axis-select" value={scatterYAxis} onChange={handleYAxisChange}>
                            {Object.entries(AVAILABLE_METRICS).map(([key, label]) => (<option key={key} value={key}>{label}</option>))}
                        </select>
                    </div>
                </div>
                 <div className="plot-content-wrapper">
                     <ModelScatterPlot
                        modelData={filteredModelData} xAxisMetric={scatterXAxis} yAxisMetric={scatterYAxis}
                        onPointClick={handleModelSelect} selectedModelId={selectedModelDetails?.id}
                    />
                 </div>
            </div>

            {/* 4. Таблица Результатов */}
            <div className="dashboard-section results-table-section">
                 <div className="section-header"><h4>Model Results Table</h4></div>
                 <div className="table-content-wrapper">
                     <ModelResultsTable
                        modelData={filteredModelData} onRowClick={handleModelSelect} selectedModelId={selectedModelDetails?.id}
                    />
                 </div>
            </div>

            {/* 5. Панель Деталей Выбранной Модели */}
            <div className={`dashboard-section selected-model-details-section ${isDetailsVisible ? 'expanded' : 'collapsed'}`}>
                 {selectedModelDetails ? (
                     <div className="section-header details-header" onClick={toggleDetailsVisibility} title={isDetailsVisible ? 'Hide Details' : 'Show Details'}>
                         <h5>Details for Model: {selectedModelDetails.id}</h5>
                         <button className="toggle-details-btn">{isDetailsVisible ? <ChevronUp /> : <ChevronDown />}</button>
                     </div>
                 ) : ( <div className="section-header details-header placeholder-header"><h5>Model Details</h5></div> )}
                 {selectedModelDetails && isDetailsVisible && (
                     <div className="details-content"><pre>{JSON.stringify(selectedModelDetails, null, 2)}</pre></div>
                 )}
            </div>

            {/* 6. График Декомпозиции */}
            {selectedModelDetails && isDetailsVisible && (
                <div className="dashboard-section decomposition-chart-section">
                    {(() => {
                        if (isDecompLoading) {
                            return <div style={{padding: '20px', textAlign: 'center', fontStyle: 'italic'}}>Loading decomposition...</div>;
                        }
                        if (decompError) {
                            return <div style={{padding: '15px', color: 'red', border: '1px solid red', borderRadius: '4px', backgroundColor: '#fdd'}}>Error fetching decomposition: {decompError}</div>;
                        }
                        if (decompositionData) {
                            return (
                                // <<< ОБЕРНУТЬ В ErrorBoundary >>>
                                <ErrorBoundary>
                                    <DecompositionChart
                                        decompositionData={decompositionData}
                                        selectedModelId={selectedModelDetails?.id}
                                    />
                                </ErrorBoundary>
                            );
                        }
                        return null;
                    })()}
                </div>
            )}

        </div> // Конец .model-dashboard
    );
}

export default ModelDashboard;