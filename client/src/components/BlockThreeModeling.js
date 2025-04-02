import React, { useState, useEffect, useMemo } from 'react'; // Убрали useRef
import axios from 'axios';
import './BlockThreeModeling.css'; // Импортируем CSS
// Убрали импорт ModelProgressVisualizer

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


// Принимаем новые пропсы: onJobStateChange, activeJobId, progressData
// enrichedData теперь содержит данные, выбранные в Блоке 2 для моделирования
function BlockThreeModeling({ enrichedData, onJobStateChange, activeJobId, progressData }) {
    // --- Состояния Компонента (для UI настроек) ---
    const [availableSeries, setAvailableSeries] = useState([]); // Список имен доступных рядов
    const [dependentVariable, setDependentVariable] = useState(''); // Выбранная зависимая переменная (Y)
    const [regressorStatus, setRegressorStatus] = useState({}); // Статус регрессоров { name: 'include'/'exclude', ... }
    const [constantStatus, setConstantStatus] = useState('include'); // Статус константы: 'include', 'exclude', 'test'
    const [lagDepth, setLagDepth] = useState(0); // Максимальная глубина лагов N
    const [targetTimeframe, setTargetTimeframe] = useState(''); // Частота данных (извлекается из enrichedData)
    const [selectedTests, setSelectedTests] = useState({ vif: true, heteroskedasticity: true, pValue: true }); // Выбранные стат. тесты
    const [pValueThreshold, setPValueThreshold] = useState(0.05); // Порог p-value для теста
    const [selectedMetrics, setSelectedMetrics] = useState({ rSquared: true, mae: true, mape: false, rmse: false }); // Выбранные метрики точности
    const [estimatedRuns, setEstimatedRuns] = useState(0); // Оценка числа прогонов на основе настроек
    const [runError, setRunError] = useState(null);   // Ошибка при взаимодействии с API (запуск/пауза/стоп)
    // Убрали состояния jobId, progressData, isPaused, pollingIntervalRef - они теперь управляются в App.js

    // --- Производные состояния (вычисляются из пропсов) ---
    // Задача считается запущенной, если есть activeJobId и статус задачи не финальный
    const isRunning = !!activeJobId && progressData?.status !== 'finished' && progressData?.status !== 'stopped' && progressData?.status !== 'error';
    // Задача на паузе, если статус 'paused'
    const isPaused = progressData?.status === 'paused';

    // --- Эффекты ---

    // 1. Инициализация и сброс состояния компонента при изменении входных данных (enrichedData)
    useEffect(() => {
        // Проверяем, что enrichedData существует и является объектом
        if (enrichedData && typeof enrichedData === 'object' && Object.keys(enrichedData).length > 0) {
            const seriesNames = Object.keys(enrichedData);
            setAvailableSeries(seriesNames);

            // Извлекаем частоту из первого ряда (предполагаем, что она одинакова)
            const firstSeriesKey = seriesNames[0];
            const freq = enrichedData[firstSeriesKey]?.frequency || 'N/A';
            setTargetTimeframe(freq);

            // Устанавливаем начальное значение для Y (первый ряд)
            const initialY = seriesNames[0];
            setDependentVariable(initialY);

            // Инициализируем статус регрессоров (все остальные - 'include')
            const initialStatus = {};
            seriesNames.forEach(name => {
                if (name !== initialY) {
                    initialStatus[name] = 'include';
                }
            });
            setRegressorStatus(initialStatus);

            // Сброс остальных настроек к значениям по умолчанию
            setConstantStatus('include');
            setLagDepth(0);
            setSelectedTests({ vif: true, heteroskedasticity: true, pValue: true });
            setPValueThreshold(0.05);
            setSelectedMetrics({ rSquared: true, mae: true, mape: false, rmse: false });
            setRunError(null); // Сбрасываем локальную ошибку
            // Сброс состояния задачи (activeJobId и т.д.) происходит в App.js при изменении enrichedData

        } else {
            // Если enrichedData пустые или некорректные, сбрасываем все
            setAvailableSeries([]);
            setDependentVariable('');
            setRegressorStatus({});
            setConstantStatus('include');
            setLagDepth(0);
            setTargetTimeframe('');
            setSelectedTests({ vif: true, heteroskedasticity: true, pValue: true });
            setPValueThreshold(0.05);
            setSelectedMetrics({ rSquared: true, mae: true, mape: false, rmse: false });
            setRunError(null);
        }
    }, [enrichedData]); // Зависимость только от enrichedData

    // 2. Обновление списка потенциальных регрессоров при смене зависимой переменной (Y)
    useEffect(() => {
        // Не выполняем, если Y не выбрана или нет доступных рядов
        if (!dependentVariable || availableSeries.length === 0) return;

        const newStatus = {};
        availableSeries.forEach(name => {
            if (name !== dependentVariable) {
                // Сохраняем предыдущий статус регрессора, если он был, иначе ставим 'include'
                newStatus[name] = regressorStatus[name] || 'include';
            }
        });
        setRegressorStatus(newStatus);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dependentVariable, availableSeries]); // Не включаем regressorStatus в зависимости, чтобы избежать бесконечного цикла

    // 3. Расчет оценочного числа прогонов при изменении настроек
    useEffect(() => {
        // Получаем список имен включенных регрессоров
        const includedRegressors = Object.entries(regressorStatus)
                                        .filter(([_, status]) => status === 'include')
                                        .map(([name, _]) => name);
        const k = includedRegressors.length; // Количество включенных регрессоров
        const N = lagDepth; // Глубина лагов

        let totalBaseModels = 0; // Количество моделей без учета статуса константы

        // Перебираем все возможные размеры подмножеств регрессоров (m) от 0 до k
        for (let m = 0; m <= k; m++) {
            // Количество способов выбрать m регрессоров из k (C(k, m))
            const numCombinations = combinations(k, m);
            // Количество комбинаций лагов (от 0 до N) для m регрессоров ((N+1)^m)
            const numLagCombinations = Math.pow(N + 1, m);
            // Добавляем к общему числу базовых моделей
            totalBaseModels += numCombinations * numLagCombinations;
        }

        let calculatedRuns = 0; // Итоговое расчетное число

        // Корректируем на статус константы
        if (constantStatus === 'include') {
            // Если константа всегда включена, число прогонов равно числу базовых моделей
            calculatedRuns = totalBaseModels;
        } else if (constantStatus === 'exclude') {
            // Если константа всегда выключена, вычитаем 1 модель (случай m=0, без регрессоров и без константы)
            // Но только если есть хотя бы одна базовая модель
             calculatedRuns = totalBaseModels > 0 ? totalBaseModels - 1 : 0;
             // Отдельно обрабатываем случай k=0 (нет регрессоров) - тогда 0 моделей
             if (k === 0) calculatedRuns = 0;
        } else { // constantStatus === 'test'
            // Если константу тестируем:
            // Модель без регрессоров (m=0) запускается 1 раз (только с константой)
            // Все остальные (totalBaseModels - 1) запускаются 2 раза (с константой и без)
            calculatedRuns = totalBaseModels > 0 ? (totalBaseModels - 1) * 2 + 1 : 0;
             // Отдельно обрабатываем случай k=0 (нет регрессоров) - тогда 1 модель (только с константой)
             if (k === 0) calculatedRuns = 1;
        }

        // Устанавливаем итоговое значение (не меньше 0)
        setEstimatedRuns(Math.max(0, Math.round(calculatedRuns)));

    }, [regressorStatus, lagDepth, constantStatus]); // Зависимости расчета

    // --- Обработчики UI ---
    const handleDependentVarChange = (event) => setDependentVariable(event.target.value);
    const toggleRegressorStatus = (name) => setRegressorStatus(prev => ({ ...prev, [name]: prev[name] === 'include' ? 'exclude' : 'include' }));
    const handleConstantStatusChange = (newStatus) => setConstantStatus(newStatus);
    const handleLagChange = (event) => setLagDepth(Math.max(0, parseInt(event.target.value, 10) || 0));
    // Обработчик для чекбоксов тестов
    const handleTestChange = (event) => {
        const { name, checked } = event.target;
        setSelectedTests(prev => ({ ...prev, [name]: checked }));
    };
    const handlePValueThresholdChange = (event) => setPValueThreshold(Math.max(0, Math.min(1, parseFloat(event.target.value) || 0.05)));
    // Обработчик для чекбоксов метрик
    const handleMetricChange = (event) => {
        const { name, checked } = event.target;
        setSelectedMetrics(prev => ({ ...prev, [name]: checked }));
    };

    // --- Обработчик ЗАПУСКА МОДЕЛИРОВАНИЯ ---
    const handleRunModeling = async () => {
        // Проверка наличия Y
        if (!dependentVariable || !enrichedData || !enrichedData[dependentVariable]) {
            alert("Please select a valid dependent variable.");
            return;
        }
        setRunError(null); // Сбрасываем предыдущую ошибку

        // 1. Собираем данные для Y
        const yVariable = {
            name: dependentVariable,
            data: enrichedData[dependentVariable].data,
            // Можно добавить частоту, если она нужна скрипту
            // frequency: enrichedData[dependentVariable]?.frequency
        };

        // 2. Собираем данные для ВСЕХ включенных регрессоров X
        const includedRegressorsData = {};
        Object.entries(regressorStatus).forEach(([name, status]) => {
            if (status === 'include' && enrichedData[name]) {
                includedRegressorsData[name] = enrichedData[name].data;
                 // Можно добавить частоту для каждого регрессора
                 // includedRegressorsData[name].frequency = enrichedData[name]?.frequency;
            }
        });

        // 3. Формируем payload для API
        const payload = {
            dependentVariable: yVariable,
            regressors: includedRegressorsData, // Передаем данные только включенных регрессоров
            config: { // Передаем конфигурацию моделирования
                constantStatus: constantStatus,
                maxLagDepth: lagDepth,
                tests: selectedTests,
                pValueThreshold: pValueThreshold,
                metrics: selectedMetrics,
                targetTimeframe: targetTimeframe // Передаем частоту
            }
        };

        console.log("Starting regression search with payload:", payload);

        try {
            // Отправляем POST-запрос на запуск задачи
            const response = await axios.post('http://localhost:5001/api/start_regression_search', payload);

            // Если бэкенд вернул jobId, значит задача успешно инициирована
            if (response.data && response.data.jobId) {
                // Вызываем callback-функцию, переданную из App.js,
                // чтобы обновить состояние App (установить activeJobId и estimatedRunsForJob)
                onJobStateChange(response.data.jobId, estimatedRuns);
                console.log(`Regression search initiated. Job ID: ${response.data.jobId}.`);
            } else {
                // Если ответ некорректный
                throw new Error(response.data?.error || "Invalid response from server when starting job.");
            }
        } catch (err) {
            // Обработка ошибок при запуске
            console.error("Error starting regression search:", err);
            const errorMsg = err.response?.data?.error || err.message || "Failed to start search.";
            setRunError(errorMsg); // Показываем ошибку пользователю
            // Сообщаем App, что запуск не удался (сбрасываем jobId)
            onJobStateChange(null, 0);
        }
    };

    // --- Обработчики ПАУЗЫ/ВОЗОБНОВЛЕНИЯ ---
    const handlePauseModeling = async () => {
        // Не выполняем, если нет активной задачи или она не в состоянии 'running'/'paused'
        if (!activeJobId || !isRunning) return;

        // Определяем, нужно поставить на паузу или возобновить
        const newPausedState = !isPaused; // isPaused вычисляется из progressData.status
        console.log(`${newPausedState ? 'Pausing' : 'Resuming'} job: ${activeJobId}`);
        setRunError(null); // Сбрасываем предыдущую ошибку

        try {
            // Отправляем запрос на бэкенд
            await axios.post(`http://localhost:5001/api/pause_search/${activeJobId}`, { pause: newPausedState });
            console.log(`Job ${activeJobId} ${newPausedState ? 'pause' : 'resume'} request sent.`);
            // Фактическое обновление статуса (isPaused) произойдет автоматически,
            // когда App.js получит обновленные данные через polling и передаст их сюда как progressData.
        } catch (err) {
             const errorMsg = err.response?.data?.error || err.message || `Failed to ${newPausedState ? 'pause' : 'resume'} job.`;
             console.error(`Error ${newPausedState ? 'pausing' : 'resuming'} job ${activeJobId}:`, err);
             setRunError(errorMsg); // Показываем ошибку
        }
    };

    // --- Обработчик ОСТАНОВКИ ---
    const handleStopModeling = async () => {
        // Не выполняем, если нет активной задачи или она не запущена/на паузе
        if (!activeJobId || !isRunning) return;
        console.log(`Stopping job: ${activeJobId}`);
        setRunError(null); // Сбрасываем ошибку

        try {
            // Отправляем запрос на остановку
            await axios.post(`http://localhost:5001/api/stop_search/${activeJobId}`);
            console.log(`Job ${activeJobId} stop request sent successfully.`);
            // Обновление статуса (isRunning станет false) произойдет автоматически
            // через polling в App.js.
            // Опционально: можно вызвать onJobStateChange(null, 0) здесь,
            // чтобы App немедленно убрал activeJobId и скрыл панель прогресса,
            // не дожидаясь следующего polling'а.
            // onJobStateChange(null, 0);
        } catch (err) {
             const errorMsg = err.response?.data?.error || err.message || "Failed to stop job.";
             console.error(`Error stopping job ${activeJobId}:`, err);
             setRunError(errorMsg); // Показываем ошибку
        }
    };

    // --- Мемоизация списка потенциальных регрессоров (X) ---
    // Создаем список регрессоров, исключая выбранную зависимую переменную Y
    const potentialRegressors = useMemo(() => {
        return availableSeries.filter(name => name !== dependentVariable);
    }, [availableSeries, dependentVariable]);

    // --- JSX Рендеринг Компонента ---
    // Если нет данных для моделирования, показываем сообщение
    if (!enrichedData || availableSeries.length === 0) {
        return (
            <div className="blockThreeContainer">
                <h4>3. Modeling - Regression</h4>
                <p className="noDataMessage">Select data for modeling in Block 2.</p>
            </div>
        );
    }

    // Основной рендер компонента
    return (
        <div className="blockThreeContainer">
            {/* Заголовок с частотой данных */}
            <h4>3. Modeling - Regression {targetTimeframe && <span className="timeframe-tag-b3">Freq: {targetTimeframe}</span>}</h4>

            {/* Выбор зависимой переменной (Y) */}
            <div className="modeling-section">
                <label htmlFor="dependent-var-select">Dependent Variable (Y):</label>
                <select
                    id="dependent-var-select"
                    value={dependentVariable}
                    onChange={handleDependentVarChange}
                    className="modeling-select"
                    disabled={isRunning} // Блокируем выбор во время выполнения задачи
                >
                    {/* Динамически генерируем опции */}
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
                            const status = regressorStatus[name] || 'exclude'; // Статус регрессора
                            const isIncluded = status === 'include';
                            return (
                                <div key={name} className={`regressor-plaque ${isIncluded ? 'regressor-included' : 'regressor-excluded'}`}>
                                    {/* Кнопка для включения/исключения регрессора */}
                                    <button
                                        className="regressor-status-button"
                                        onClick={() => toggleRegressorStatus(name)}
                                        title={isIncluded ? 'Exclude from modeling' : 'Include in modeling'}
                                        disabled={isRunning} // Блокируем во время выполнения
                                    >
                                        {isIncluded ? <IncludeIcon /> : <ExcludeIcon />}
                                    </button>
                                    {/* Имя регрессора */}
                                    <span className="regressor-name" title={name}>{name}</span>
                                </div>
                            );
                        })
                    ) : (
                        // Сообщение, если нет доступных регрессоров
                        <p className="noDataMessage-small">No potential regressors available (Select a different Y?).</p>
                    )}
                </div>
            </div>

            {/* Настройки модели (Константа, Лаги) */}
            <div className="modeling-section model-options-section">
                <label className="section-label">Model Options:</label>
                <div className="options-grid">
                    {/* Выбор статуса константы */}
                    <div className="option-group">
                        <label className="option-label">Constant Term:</label>
                        <div className="segmented-control">
                            <button type="button" className={`segment-button ${constantStatus === 'include' ? 'active' : ''}`} onClick={() => handleConstantStatusChange('include')} disabled={isRunning}>Include</button>
                            <button type="button" className={`segment-button ${constantStatus === 'exclude' ? 'active' : ''}`} onClick={() => handleConstantStatusChange('exclude')} disabled={isRunning}>Exclude</button>
                            <button type="button" className={`segment-button ${constantStatus === 'test' ? 'active' : ''}`} onClick={() => handleConstantStatusChange('test')} disabled={isRunning}>Test</button>
                        </div>
                    </div>
                    {/* Ввод максимальной глубины лагов */}
                    <div className="option-group">
                        <label htmlFor="lag-depth-input" className="option-label">Max Lag Depth (N):</label>
                        <input
                            type="number" id="lag-depth-input" value={lagDepth}
                            onChange={handleLagChange} min="0" step="1"
                            className="modeling-input-number-styled"
                            disabled={isRunning}
                        />
                    </div>
                </div>
            </div>

            {/* Выбор Статистических Тестов */}
            <div className="modeling-section tests-metrics-section">
                <label className="section-label">Statistical Tests:</label>
                <div className="checkbox-grid">
                    {/* Чекбокс VIF */}
                    <label className={`checkbox-label ${isRunning ? 'disabled-label' : ''}`}>
                        <input type="checkbox" name="vif" checked={selectedTests.vif} onChange={handleTestChange} disabled={isRunning} />
                        VIF (Collinearity)
                    </label>
                    {/* Чекбокс Heteroskedasticity */}
                    <label className={`checkbox-label ${isRunning ? 'disabled-label' : ''}`}>
                        <input type="checkbox" name="heteroskedasticity" checked={selectedTests.heteroskedasticity} onChange={handleTestChange} disabled={isRunning} />
                        Heteroskedasticity (BP)
                    </label>
                    {/* Чекбокс и поле для Max p-value */}
                    <label className={`checkbox-label inline-input ${isRunning ? 'disabled-label' : ''}`}>
                        <input type="checkbox" name="pValue" checked={selectedTests.pValue} onChange={handleTestChange} disabled={isRunning} />
                        Max p-value ≤
                        <input
                            type="number" value={pValueThreshold} onChange={handlePValueThresholdChange}
                            min="0" max="1" step="0.01" className="threshold-input"
                            // Блокируем поле ввода, если сам тест не выбран или задача запущена
                            disabled={!selectedTests.pValue || isRunning}
                        />
                    </label>
                </div>
            </div>

            {/* Выбор Метрик Точности */}
            <div className="modeling-section tests-metrics-section">
                <label className="section-label">Accuracy Metrics:</label>
                <div className="checkbox-grid">
                    <label className={`checkbox-label ${isRunning ? 'disabled-label' : ''}`}> <input type="checkbox" name="rSquared" checked={selectedMetrics.rSquared} onChange={handleMetricChange} disabled={isRunning} /> R-squared (R²) </label>
                    <label className={`checkbox-label ${isRunning ? 'disabled-label' : ''}`}> <input type="checkbox" name="mae" checked={selectedMetrics.mae} onChange={handleMetricChange} disabled={isRunning} /> MAE </label>
                    <label className={`checkbox-label ${isRunning ? 'disabled-label' : ''}`}> <input type="checkbox" name="mape" checked={selectedMetrics.mape} onChange={handleMetricChange} disabled={isRunning} /> MAPE </label>
                    <label className={`checkbox-label ${isRunning ? 'disabled-label' : ''}`}> <input type="checkbox" name="rmse" checked={selectedMetrics.rmse} onChange={handleMetricChange} disabled={isRunning} /> RMSE </label>
                </div>
            </div>

            {/* Секция Запуска Моделирования */}
            <div className="modeling-section run-section">
                 {/* Отображение оценочного числа прогонов */}
                 <div className="estimated-runs">
                     Estimated model runs: <span>{estimatedRuns.toLocaleString()}</span>
                 </div>
                 {/* Отображение ошибки запуска/паузы/стопа */}
                 {runError && <p className="error-text run-error">{runError}</p>}

                 {/* Контейнер для кнопок управления запуском */}
                 <div className="run-controls-container">
                     {/* Кнопка Run/Running */}
                     <button
                        className="run-button"
                        onClick={handleRunModeling}
                        // Блокируем, если нет моделей для запуска, не выбрана Y, или задача уже запущена
                        disabled={estimatedRuns === 0 || !dependentVariable || isRunning}
                     >
                        {isRunning ? 'Running...' : 'Run Model Search'}
                     </button>

                     {/* Кнопки Пауза/Стоп (показываются только во время выполнения) */}
                     {isRunning && (
                         <>
                             {/* Кнопка Pause/Resume */}
                             <button
                                className={`pause-button ${isPaused ? 'paused' : ''}`} // Стиль меняется в зависимости от статуса паузы
                                onClick={handlePauseModeling}
                                disabled={!activeJobId} // Блокируем, если нет ID задачи (на всякий случай)
                             >
                                {isPaused ? 'Resume' : 'Pause'}
                             </button>
                             {/* Кнопка Stop */}
                             <button
                                className="stop-button"
                                onClick={handleStopModeling}
                                disabled={!activeJobId} // Блокируем, если нет ID задачи
                             >
                                Stop
                             </button>
                         </>
                     )}
                 </div>
                 {/* Отображаем ID активной задачи и ее статус (если есть) */}
                 {activeJobId && <p className="job-id-display">Job ID: {activeJobId} {progressData?.status ? `(${progressData.status})` : '(starting...)'}</p>}
            </div>

             {/* Визуализатор прогресса УБРАН отсюда, он теперь в App.js */}

        </div> // Конец blockThreeContainer
    );
}

export default BlockThreeModeling;