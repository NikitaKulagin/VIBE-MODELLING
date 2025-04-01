import React, { useState, useEffect, useMemo, useRef } from 'react'; // <<< Добавляем useRef
import axios from 'axios'; // <<< Убедитесь, что axios импортирован
import './BlockThreeModeling.css'; // Импортируем CSS
import ModelProgressVisualizer from './ModelProgressVisualizer'; // <<< Импортируем визуализатор

// Иконки для статуса регрессоров
const IncludeIcon = () => <span style={{ color: '#198754', fontWeight: 'bold', fontSize: '1.2em' }}>✓</span>; // Зеленая галочка
const ExcludeIcon = () => <span style={{ color: '#6c757d', fontWeight: 'bold', fontSize: '1.1em' }}>✗</span>; // Серый крестик

// --- Вспомогательная функция для расчета комбинаций C(n, k) ---
// Помещаем её *вне* компонента
function combinations(n, k) {
    if (k < 0 || k > n) {
        return 0;
    }
    if (k === 0 || k === n) {
        return 1;
    }
    // Оптимизация: C(n, k) == C(n, n-k)
    if (k > n / 2) {
        k = n - k;
    }
    let res = 1;
    for (let i = 1; i <= k; ++i) {
        // Деление делаем последним, чтобы уменьшить ошибки округления
        res = res * (n - i + 1) / i;
    }
    // Округляем, т.к. результат всегда должен быть целым
    return Math.round(res);
}
// --- Конец вспомогательной функции ---


function BlockThreeModeling({ enrichedData }) { // Принимаем enrichedData как пропс
    // --- Состояния ---
    const [availableSeries, setAvailableSeries] = useState([]); // Список имен всех рядов
    const [dependentVariable, setDependentVariable] = useState(''); // Имя выбранной зависимой переменной (Y)
    const [regressorStatus, setRegressorStatus] = useState({}); // Статус регрессоров { name: 'include'/'exclude', ... }
    const [constantStatus, setConstantStatus] = useState('include'); // 'include', 'exclude', 'test'
    const [lagDepth, setLagDepth] = useState(0); // Глубина лагов N
    const [targetTimeframe, setTargetTimeframe] = useState(''); // Частота данных
    const [selectedTests, setSelectedTests] = useState({ vif: true, heteroskedasticity: true, pValue: true }); // Выбранные тесты
    const [pValueThreshold, setPValueThreshold] = useState(0.05); // Порог p-value
    const [selectedMetrics, setSelectedMetrics] = useState({ rSquared: true, mae: true, mape: false, rmse: false }); // Выбранные метрики
    const [estimatedRuns, setEstimatedRuns] = useState(0); // Оценка числа прогонов
    // Состояния для запуска
    const [isRunning, setIsRunning] = useState(false); // Идет ли процесс моделирования
    const [runError, setRunError] = useState(null);   // Ошибка при запуске/выполнении
    const [jobId, setJobId] = useState(null);         // ID запущенного процесса (для будущего отслеживания)
    const [isPaused, setIsPaused] = useState(false); // Отслеживаем паузу
    // Состояние для прогресса
    const [progressData, setProgressData] = useState(null); // Данные с эндпоинта прогресса
    // Ref для интервала
    const pollingIntervalRef = useRef(null); // Храним ID интервала

    // --- Эффекты ---

    // Обновление списка доступных рядов и сброс состояния при изменении входных данных
    useEffect(() => {
        if (enrichedData && typeof enrichedData === 'object') {
            const seriesNames = Object.keys(enrichedData);
            setAvailableSeries(seriesNames);

            // Извлекаем частоту
            if (seriesNames.length > 0) {
                const firstSeriesKey = seriesNames[0];
                const freq = enrichedData[firstSeriesKey]?.frequency || 'N/A';
                setTargetTimeframe(freq);
            } else {
                setTargetTimeframe('');
            }

            // Сброс выбора Y и статуса регрессоров
            const initialY = seriesNames.length > 0 ? seriesNames[0] : '';
            setDependentVariable(initialY);

            // Инициализация статуса регрессоров
            const initialStatus = {};
            seriesNames.forEach(name => {
                if (name !== initialY) {
                    initialStatus[name] = 'include';
                }
            });
            setRegressorStatus(initialStatus);
            setConstantStatus('include');
            setLagDepth(0);
            setSelectedTests({ vif: true, heteroskedasticity: true, pValue: true });
            setPValueThreshold(0.05);
            setSelectedMetrics({ rSquared: true, mae: true, mape: false, rmse: false });
            // Сброс состояния запуска
            setIsRunning(false);
            setRunError(null);
            setJobId(null);
            setIsPaused(false); // Сброс паузы
            setProgressData(null); // Сброс данных прогресса
            // Очищаем интервал, если он был
            if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
                pollingIntervalRef.current = null;
            }

        } else {
            setAvailableSeries([]);
            setDependentVariable('');
            setRegressorStatus({});
            setConstantStatus('include');
            setLagDepth(0);
            setTargetTimeframe('');
            setSelectedTests({ vif: true, heteroskedasticity: true, pValue: true });
            setPValueThreshold(0.05);
            setSelectedMetrics({ rSquared: true, mae: true, mape: false, rmse: false });
            setIsRunning(false);
            setRunError(null);
            setJobId(null);
            setIsPaused(false); // Сброс паузы
            setProgressData(null); // Сброс данных прогресса
            if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
                pollingIntervalRef.current = null;
            }
        }
    }, [enrichedData]);

    // Обновление статуса регрессоров при смене зависимой переменной
    useEffect(() => {
        if (!dependentVariable || availableSeries.length === 0) return;

        const initialStatus = {};
        availableSeries.forEach(name => {
            if (name !== dependentVariable) {
                initialStatus[name] = regressorStatus[name] || 'include';
            }
        });
        setRegressorStatus(initialStatus);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dependentVariable, availableSeries]);

    // --- КОРРЕКТНЫЙ useEffect для расчета числа прогонов ---
    useEffect(() => {
        const includedRegressors = Object.entries(regressorStatus)
                                        .filter(([_, status]) => status === 'include')
                                        .map(([name, _]) => name);
        const k = includedRegressors.length; // Количество включенных регрессоров
        const N = lagDepth; // Глубина лагов

        let totalBaseModels = 0;

        // Перебираем все возможные размеры подмножеств регрессоров (m) от 0 до k
        for (let m = 0; m <= k; m++) {
            // Количество способов выбрать m регрессоров из k
            const numCombinations = combinations(k, m);

            // Количество лаговых комбинаций для подмножества размера m
            const numLagCombinations = Math.pow(N + 1, m);

            totalBaseModels += numCombinations * numLagCombinations;
        }

        let calculatedRuns = 0;

        // Корректируем на статус константы
        if (constantStatus === 'include') {
            calculatedRuns = totalBaseModels;
        } else if (constantStatus === 'exclude') {
            // Вычитаем модель без регрессоров (m=0) и без константы
            calculatedRuns = totalBaseModels - 1;
        } else { // constantStatus === 'test'
            // Удваиваем все модели, кроме пустой (m=0), которая дает только 1 вариант (с константой)
             calculatedRuns = (totalBaseModels - 1) * 2 + 1;
        }

        // Исключаем невалидные случаи (например, exclude и нет регрессоров)
        if (constantStatus === 'exclude' && k === 0) {
             calculatedRuns = 0;
        }
         // Если k=0 и constant='test', то будет только 1 модель (только константа)
         if (k === 0 && constantStatus === 'test') {
             calculatedRuns = 1;
         }

        // Устанавливаем итоговое значение, не меньше 0
        setEstimatedRuns(Math.max(0, Math.round(calculatedRuns)));

    }, [regressorStatus, lagDepth, constantStatus]); // Зависимости расчета
    // --- Конец КОРРЕКТНОГО useEffect ---

     // --- Эффект для очистки интервала при размонтировании ---
     useEffect(() => {
        // Функция очистки, которая будет вызвана при размонтировании компонента
        return () => {
            if (pollingIntervalRef.current) {
                console.log("Clearing polling interval on unmount.");
                clearInterval(pollingIntervalRef.current);
            }
        };
    }, []); // Пустой массив зависимостей, чтобы выполнилось только при монтировании/размонтировании

    // --- Функция для опроса прогресса ---
    const pollProgress = async (currentJobId) => {
        if (!currentJobId) return;
        console.log(`Polling progress for job: ${currentJobId}`);
        try {
            const response = await axios.get(`http://localhost:5001/api/search_progress/${currentJobId}`);
            setProgressData(response.data); // Обновляем данные прогресса

            // Проверяем статус и останавливаем опрос, если нужно
            if (response.data.status === 'finished' || response.data.status === 'stopped') {
                console.log(`Job ${currentJobId} finished or stopped. Stopping polling.`);
                setIsRunning(false); // Обновляем статус isRunning
                setIsPaused(false); // Сбрасываем паузу
                if (pollingIntervalRef.current) {
                    clearInterval(pollingIntervalRef.current);
                    pollingIntervalRef.current = null;
                }
            }
        } catch (error) {
            console.error(`Error polling progress for job ${currentJobId}:`, error);
            setRunError(`Failed to get progress: ${error.message}`);
            // Опционально: останавливаем опрос при ошибке
            // if (pollingIntervalRef.current) {
            //     clearInterval(pollingIntervalRef.current);
            //     pollingIntervalRef.current = null;
            // }
            // setIsRunning(false);
        }
    };


    // --- Обработчики ---
    const handleDependentVarChange = (event) => {
        setDependentVariable(event.target.value);
    };

    const toggleRegressorStatus = (name) => {
        setRegressorStatus(prevStatus => ({
            ...prevStatus,
            [name]: prevStatus[name] === 'include' ? 'exclude' : 'include'
        }));
    };

    const handleConstantStatusChange = (newStatus) => {
        setConstantStatus(newStatus);
    };

    const handleLagChange = (event) => {
        const value = parseInt(event.target.value, 10);
        setLagDepth(isNaN(value) || value < 0 ? 0 : value);
    };

    const handleTestChange = (event) => {
        const { name, checked } = event.target;
        setSelectedTests(prev => ({ ...prev, [name]: checked }));
    };

    const handlePValueThresholdChange = (event) => {
        const value = parseFloat(event.target.value);
        setPValueThreshold(isNaN(value) ? 0.05 : Math.max(0, Math.min(1, value)));
    };

    const handleMetricChange = (event) => {
        const { name, checked } = event.target;
        setSelectedMetrics(prev => ({ ...prev, [name]: checked }));
    };

    // --- Обработчик ЗАПУСКА МОДЕЛИРОВАНИЯ ---
    const handleRunModeling = async () => {
        if (!dependentVariable || !enrichedData[dependentVariable]) {
            alert("Please select a valid dependent variable.");
            return;
        }

        setIsRunning(true);
        setIsPaused(false); // Сбрасываем паузу при новом запуске
        setRunError(null);
        setJobId(null); // Сбрасываем предыдущий jobId
        setProgressData(null); // Сбрасываем старые данные прогресса
        if (pollingIntervalRef.current) { // Очищаем старый интервал, если был
             clearInterval(pollingIntervalRef.current);
             pollingIntervalRef.current = null;
        }


        // 1. Собираем данные для Y
        const yVariable = {
            name: dependentVariable,
            data: enrichedData[dependentVariable].data
        };

        // 2. Собираем данные для включенных X
        const includedRegressorsData = {};
        Object.entries(regressorStatus).forEach(([name, status]) => {
            if (status === 'include' && enrichedData[name]) {
                includedRegressorsData[name] = enrichedData[name].data;
            }
        });

        // 3. Формируем payload
        const payload = {
            dependentVariable: yVariable,
            regressors: includedRegressorsData, // Объект { имя: [[ts, val], ...], ... }
            config: {
                constantStatus: constantStatus,
                maxLagDepth: lagDepth,
                tests: selectedTests,
                pValueThreshold: pValueThreshold,
                metrics: selectedMetrics,
                targetTimeframe: targetTimeframe // Добавляем частоту
                // Добавить сюда другие параметры конфигурации, если нужно
            }
        };

        console.log("Starting regression search with payload:", payload);

        try {
            // Отправляем запрос на новый эндпоинт
            const response = await axios.post('http://localhost:5001/api/start_regression_search', payload);

            if (response.data && response.data.jobId) {
                const newJobId = response.data.jobId;
                setJobId(newJobId);
                console.log(`Regression search started. Job ID: ${newJobId}. Starting polling...`);
                // --- ЗАПУСКАЕМ POLLING ---
                setProgressData({ status: 'running', progress: 0, totalModels: estimatedRuns, results: {} }); // Начальное состояние
                pollingIntervalRef.current = setInterval(() => {
                    pollProgress(newJobId); // Передаем ID в функцию опроса
                }, 2000); // Опрашиваем каждые 2 секунды
                // ---
            } else {
                throw new Error(response.data?.error || "Invalid response from server.");
            }
        } catch (err) {
            console.error("Error starting regression search:", err);
            setRunError(err.response?.data?.error || err.message || "Failed to start search.");
            setIsRunning(false);
        }
    };
    // ---

    // --- Обработчики ПАУЗЫ/СТОПА ---
    const handlePauseModeling = async () => {
        if (!jobId || !isRunning) return;
        const newPausedState = !isPaused;
        console.log(`${newPausedState ? 'Pausing' : 'Resuming'} job: ${jobId}`);
        setRunError(null);
        try {
            await axios.post(`http://localhost:5001/api/pause_search/${jobId}`, { pause: newPausedState });
            setIsPaused(newPausedState);
            console.log(`Job ${jobId} ${newPausedState ? 'paused' : 'resumed'} successfully.`);
            // Обновляем статус в progressData для немедленного отображения
            setProgressData(prev => prev ? {...prev, status: newPausedState ? 'paused' : 'running'} : null);
        } catch (err) {
             console.error(`Error ${newPausedState ? 'pausing' : 'resuming'} job ${jobId}:`, err);
             setRunError(err.response?.data?.error || err.message || `Failed to ${newPausedState ? 'pause' : 'resume'} job.`);
        }
    };

    const handleStopModeling = async () => {
        if (!jobId || !isRunning) return;
        console.log(`Stopping job: ${jobId}`);
        setRunError(null);

         // --- ОСТАНАВЛИВАЕМ POLLING ---
         if (pollingIntervalRef.current) {
             clearInterval(pollingIntervalRef.current);
             pollingIntervalRef.current = null;
             console.log("Polling stopped.");
         }
         // ---

        try {
            await axios.post(`http://localhost:5001/api/stop_search/${jobId}`);
            console.log(`Job ${jobId} stop request sent successfully.`);
        } catch (err) {
             console.error(`Error stopping job ${jobId}:`, err);
             setRunError(err.response?.data?.error || err.message || "Failed to stop job.");
        } finally {
             // Сбрасываем состояния на фронтенде независимо от ответа сервера
             setIsRunning(false);
             setIsPaused(false);
             // Обновляем статус в progressData
             setProgressData(prev => prev ? {...prev, status: 'stopped'} : { status: 'stopped' });
             // jobId можно оставить для информации
        }
    };
    // ---

    // --- Мемоизация списка регрессоров ---
    const potentialRegressors = useMemo(() => {
        return availableSeries.filter(name => name !== dependentVariable);
    }, [availableSeries, dependentVariable]);

    // --- JSX ---
    if (!enrichedData || availableSeries.length === 0) {
        return (
            <div className="blockThreeContainer">
                <h4>3. Modeling - Regression</h4>
                <p className="noDataMessage">Waiting for enriched data from Block 2...</p>
            </div>
        );
    }

    return (
        <div className="blockThreeContainer">
            {/* Отображение частоты рядом с заголовком */}
            <h4>3. Modeling - Regression {targetTimeframe && <span className="timeframe-tag-b3">Freq: {targetTimeframe}</span>}</h4>

            {/* Выбор зависимой переменной (Y) */}
            <div className="modeling-section">
                <label htmlFor="dependent-var-select">Dependent Variable (Y):</label>
                <select
                    id="dependent-var-select"
                    value={dependentVariable}
                    onChange={handleDependentVarChange}
                    className="modeling-select"
                    disabled={isRunning} // Блокируем во время выполнения
                >
                    {availableSeries.length === 0 && <option value="">-- No series available --</option>}
                    {availableSeries.map(name => (
                        <option key={name} value={name}>{name}</option>
                    ))}
                </select>
            </div>

            {/* Выбор регрессоров (X) */}
            <div className="modeling-section">
                <label>Potential Regressors (X):</label>
                <div className="regressor-list">
                    {potentialRegressors.length > 0 ? (
                        potentialRegressors.map(name => {
                            const status = regressorStatus[name] || 'exclude';
                            const isIncluded = status === 'include';
                            const plaqueClass = `regressor-plaque ${isIncluded ? 'regressor-included' : 'regressor-excluded'}`;
                            const buttonTitle = isIncluded ? 'Exclude from modeling' : 'Include in modeling';

                            return (
                                <div key={name} className={plaqueClass}>
                                    <button
                                        className="regressor-status-button"
                                        onClick={() => toggleRegressorStatus(name)}
                                        title={buttonTitle}
                                        disabled={isRunning} // Блокируем во время выполнения
                                    >
                                        {isIncluded ? <IncludeIcon /> : <ExcludeIcon />}
                                    </button>
                                    <span className="regressor-name" title={name}>{name}</span>
                                </div>
                            );
                        })
                    ) : (
                        <p className="noDataMessage-small">No potential regressors available (Select a different Y?).</p>
                    )}
                </div>
            </div>

            {/* Настройки модели */}
            <div className="modeling-section model-options-section">
                <label className="section-label">Model Options:</label>
                <div className="options-grid">
                    {/* Константа */}
                    <div className="option-group">
                        <label className="option-label">Constant Term:</label>
                        <div className="segmented-control">
                            <button type="button" className={`segment-button ${constantStatus === 'include' ? 'active' : ''}`} onClick={() => handleConstantStatusChange('include')} disabled={isRunning}>Include</button>
                            <button type="button" className={`segment-button ${constantStatus === 'exclude' ? 'active' : ''}`} onClick={() => handleConstantStatusChange('exclude')} disabled={isRunning}>Exclude</button>
                            <button type="button" className={`segment-button ${constantStatus === 'test' ? 'active' : ''}`} onClick={() => handleConstantStatusChange('test')} disabled={isRunning}>Test</button>
                        </div>
                    </div>
                    {/* Глубина лагов */}
                    <div className="option-group">
                        <label htmlFor="lag-depth-input" className="option-label">Max Lag Depth (N):</label>
                        <input
                            type="number" id="lag-depth-input" value={lagDepth}
                            onChange={handleLagChange} min="0" step="1"
                            className="modeling-input-number-styled"
                            disabled={isRunning} // Блокируем во время выполнения
                        />
                    </div>
                </div>
            </div>

            {/* Выбор Статистических Тестов */}
            <div className="modeling-section tests-metrics-section">
                <label className="section-label">Statistical Tests:</label>
                <div className="checkbox-grid">
                    <label className={`checkbox-label ${isRunning ? 'disabled-label' : ''}`}>
                        <input type="checkbox" name="vif" checked={selectedTests.vif} onChange={handleTestChange} disabled={isRunning} />
                        VIF (Collinearity)
                    </label>
                    <label className={`checkbox-label ${isRunning ? 'disabled-label' : ''}`}>
                        <input type="checkbox" name="heteroskedasticity" checked={selectedTests.heteroskedasticity} onChange={handleTestChange} disabled={isRunning} />
                        Heteroskedasticity (BP)
                    </label>
                    <label className={`checkbox-label inline-input ${isRunning ? 'disabled-label' : ''}`}>
                        <input type="checkbox" name="pValue" checked={selectedTests.pValue} onChange={handleTestChange} disabled={isRunning} />
                        Max p-value ≤
                        <input
                            type="number" value={pValueThreshold} onChange={handlePValueThresholdChange}
                            min="0" max="1" step="0.01" className="threshold-input"
                            disabled={!selectedTests.pValue || isRunning} // Деактивируем, если тест не выбран ИЛИ идет выполнение
                        />
                    </label>
                </div>
            </div>

            {/* Выбор Метрик Точности */}
            <div className="modeling-section tests-metrics-section">
                <label className="section-label">Accuracy Metrics:</label>
                <div className="checkbox-grid">
                    <label className={`checkbox-label ${isRunning ? 'disabled-label' : ''}`}>
                        <input type="checkbox" name="rSquared" checked={selectedMetrics.rSquared} onChange={handleMetricChange} disabled={isRunning} />
                        R-squared (R²)
                    </label>
                    <label className={`checkbox-label ${isRunning ? 'disabled-label' : ''}`}>
                        <input type="checkbox" name="mae" checked={selectedMetrics.mae} onChange={handleMetricChange} disabled={isRunning} />
                        MAE
                    </label>
                    <label className={`checkbox-label ${isRunning ? 'disabled-label' : ''}`}>
                        <input type="checkbox" name="mape" checked={selectedMetrics.mape} onChange={handleMetricChange} disabled={isRunning} />
                        MAPE
                    </label>
                    <label className={`checkbox-label ${isRunning ? 'disabled-label' : ''}`}>
                        <input type="checkbox" name="rmse" checked={selectedMetrics.rmse} onChange={handleMetricChange} disabled={isRunning} />
                        RMSE
                    </label>
                </div>
            </div>

            {/* Отображение числа прогонов и кнопки Run/Pause/Stop */}
            <div className="modeling-section run-section">
                 <div className="estimated-runs">
                     Estimated model runs: <span>{estimatedRuns.toLocaleString()}</span>
                 </div>
                 {runError && <p className="error-text run-error">{runError}</p>}

                 {/* Контейнер для кнопок управления */}
                 <div className="run-controls-container">
                     <button
                        className="run-button"
                        onClick={handleRunModeling}
                        disabled={estimatedRuns === 0 || !dependentVariable || isRunning} // Нельзя запустить, если уже запущено
                     >
                        {isRunning ? 'Running...' : 'Run Model Search'} {/* Меняем текст кнопки */}
                     </button>

                     {/* Кнопки Пауза/Стоп показываются только во время выполнения */}
                     {isRunning && (
                         <>
                             <button
                                className={`pause-button ${isPaused ? 'paused' : ''}`} // Добавляем класс для стилизации паузы
                                onClick={handlePauseModeling}
                                disabled={!jobId} // Нельзя нажать, пока не получен jobId
                             >
                                {isPaused ? 'Resume' : 'Pause'}
                             </button>
                             <button
                                className="stop-button"
                                onClick={handleStopModeling}
                                disabled={!jobId} // Нельзя нажать, пока не получен jobId
                             >
                                Stop
                             </button>
                         </>
                     )}
                 </div>
                 {/* --- */}

                 {jobId && <p className="job-id-display">Job ID: {jobId} {progressData?.status ? `(${progressData.status})` : ''}</p>}
            </div>

             {/* --- ДОБАВЛЕН КОМПОНЕНТ ВИЗУАЛИЗАЦИИ ПРОГРЕССА --- */}
             {/* Показываем, если есть jobId или данные прогресса */}
             {(jobId || progressData) && (
                 <div className="modeling-section progress-visualization-section">
                      <ModelProgressVisualizer progressData={progressData} />
                 </div>
             )}
             {/* --- */}


        </div> // Конец blockThreeContainer
    );
}

export default BlockThreeModeling;