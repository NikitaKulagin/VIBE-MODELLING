import React, { useMemo } from 'react';
import Plot from 'react-plotly.js'; // Импортируем Plotly
import './ModelScatterPlot.css'; // Создадим позже для стилей

// Определяем цвета для разных статусов/валидности
const STATUS_COLORS = {
    valid: 'rgba(40, 167, 69, 0.7)',      // Зеленый (полупрозрачный)
    invalid_stats: 'rgba(220, 53, 69, 0.7)', // Красный (полупрозрачный)
    // invalid_constraints: 'rgba(255, 193, 7, 0.7)', // Желтый (пока не используется)
    error: 'rgba(108, 117, 125, 0.6)',    // Серый (полупрозрачный)
    skipped: 'rgba(13, 202, 240, 0.6)',   // Голубой (полупрозрачный)
};
const DEFAULT_COLOR = 'rgba(200, 200, 200, 0.5)'; // Цвет по умолчанию

// Функция для безопасного извлечения метрики (может быть вложенной)
const getMetricValue = (modelResult, metricKey) => {
    if (!modelResult || !modelResult.data) return null;

    // Простые случаи (прямые метрики или кол-во регрессоров)
    if (metricKey === 'numRegressors') {
        // Считаем количество ключей в data.coefficients, исключая 'const'
        return modelResult.data.coefficients
            ? Object.keys(modelResult.data.coefficients).filter(k => k !== 'const').length
            : 0;
    }
     if (metricKey === 'n_obs') {
        return modelResult.data.n_obs;
    }
     if (metricKey === 'aic') {
        return modelResult.data.aic;
    }
     if (metricKey === 'bic') {
        return modelResult.data.bic;
    }

    // Вложенные метрики (внутри data.metrics)
    if (modelResult.data.metrics && metricKey in modelResult.data.metrics) {
        const value = modelResult.data.metrics[metricKey];
        // Возвращаем null, если значение не числовое (например, Infinity для MAPE)
        return typeof value === 'number' && isFinite(value) ? value : null;
    }

    return null; // Метрика не найдена
};


function ModelScatterPlot({ modelData, xAxisMetric, yAxisMetric, onPointClick }) {

    // --- Подготовка данных для Plotly с использованием useMemo ---
    const plotData = useMemo(() => {
        if (!modelData) return [];

        // Инициализируем структуры для разных статусов
        const traces = {
            valid: { x: [], y: [], text: [], customdata: [], type: 'scattergl', mode: 'markers', name: 'Valid', marker: { color: STATUS_COLORS.valid, size: 6 } },
            invalid_stats: { x: [], y: [], text: [], customdata: [], type: 'scattergl', mode: 'markers', name: 'Invalid (Stats)', marker: { color: STATUS_COLORS.invalid_stats, size: 6 } },
            // invalid_constraints: { x: [], y: [], text: [], customdata: [], type: 'scattergl', mode: 'markers', name: 'Invalid (Constr.)', marker: { color: STATUS_COLORS.invalid_constraints, size: 6 } },
            error: { x: [], y: [], text: [], customdata: [], type: 'scattergl', mode: 'markers', name: 'Error', marker: { color: STATUS_COLORS.error, size: 5, symbol: 'x' } },
            skipped: { x: [], y: [], text: [], customdata: [], type: 'scattergl', mode: 'markers', name: 'Skipped', marker: { color: STATUS_COLORS.skipped, size: 5, symbol: 'diamond' } },
        };

        // Итерируем по всем результатам моделей
        Object.entries(modelData).forEach(([modelId, result]) => {
            if (!result || result.status !== 'completed') {
                 // Пока не отображаем не завершенные модели на графике
                 // Можно добавить trace для 'pending'/'running' если нужно
                 if (result?.status === 'error') {
                     // Добавляем ошибки на график (без координат, если нет метрик)
                     traces.error.customdata.push({ id: modelId, status: 'error', error: result.error });
                     traces.error.text.push(`ID: ${modelId}<br>Status: error`);
                     // Ставим координаты в null или 0, чтобы точка не рендерилась с мусором
                     traces.error.x.push(null);
                     traces.error.y.push(null);
                 } else if (result?.status === 'skipped') {
                     traces.skipped.customdata.push({ id: modelId, status: 'skipped', reason: result.reason });
                     traces.skipped.text.push(`ID: ${modelId}<br>Status: skipped`);
                     traces.skipped.x.push(null);
                     traces.skipped.y.push(null);
                 }
                return;
            }

            // Извлекаем значения для осей X и Y
            const xValue = getMetricValue(result, xAxisMetric);
            const yValue = getMetricValue(result, yAxisMetric);

            // Добавляем точку только если обе координаты валидны
            if (xValue !== null && yValue !== null) {
                let traceKey = 'error'; // По умолчанию
                if (result.data?.is_valid) {
                    traceKey = 'valid';
                } else {
                    // TODO: Различать invalid_stats и invalid_constraints, если бэкенд будет это возвращать
                    traceKey = 'invalid_stats';
                }

                traces[traceKey].x.push(xValue);
                traces[traceKey].y.push(yValue);
                // Формируем текст для ховера
                traces[traceKey].text.push(
                    `ID: ${modelId}<br>` +
                    `${xAxisMetric}: ${xValue.toFixed ? xValue.toFixed(3) : xValue}<br>` + // Форматируем числа
                    `${yAxisMetric}: ${yValue.toFixed ? yValue.toFixed(3) : yValue}<br>` +
                    `Status: ${traceKey}`
                );
                // Сохраняем ID модели для обработчика клика
                traces[traceKey].customdata.push({ id: modelId });
            }
        });

        // Возвращаем массив трейсов, исключая пустые
        return Object.values(traces).filter(trace => trace.x.length > 0 || trace.customdata.length > 0);

    }, [modelData, xAxisMetric, yAxisMetric]); // Пересчитываем при изменении данных или осей

    // --- Конфигурация макета (Layout) для Plotly ---
    const layout = useMemo(() => ({
        // title: 'Model Performance Scatter Plot',
        xaxis: {
            title: xAxisMetric, // Название оси X
            // automargin: true,
             zeroline: false,
        },
        yaxis: {
            title: yAxisMetric, // Название оси Y
            // automargin: true,
             zeroline: false,
        },
        hovermode: 'closest', // Режим ховера
        autosize: true, // Автоматический размер
        margin: { l: 50, r: 20, t: 30, b: 40 }, // Отступы
        legend: {
            orientation: "h", // Горизонтальная легенда
            yanchor: "bottom",
            y: -0.2, // Положение под графиком
            xanchor: "center",
            x: 0.5
        },
        // Убираем фон графика для лучшей интеграции
        plot_bgcolor: 'rgba(0,0,0,0)',
        paper_bgcolor: 'rgba(0,0,0,0)',
    }), [xAxisMetric, yAxisMetric]); // Пересчитываем при изменении осей

    // --- Обработчик клика Plotly ---
    const handlePlotClick = (data) => {
        if (data.points.length > 0) {
            const pointData = data.points[0].customdata;
            if (pointData && pointData.id && onPointClick) {
                onPointClick(pointData.id); // Вызываем callback родителя с ID модели
            }
        }
    };

    // --- Рендер ---
    return (
        <div className="model-scatter-plot">
            {plotData.length > 0 ? (
                <Plot
                    data={plotData}
                    layout={layout}
                    style={{ width: '100%', height: '100%' }} // Занимает все место родителя
                    useResizeHandler={true} // Автоматически подстраивается под размер контейнера
                    config={{
                        responsive: true, // Адаптивность
                        displaylogo: false, // Не показывать лого Plotly
                        modeBarButtonsToRemove: ['select2d', 'lasso2d', 'toImage'] // Убираем лишние кнопки
                    }}
                    onClick={handlePlotClick} // Добавляем обработчик клика
                />
            ) : (
                <div className="plot-placeholder">No completed models with valid metrics to display for selected axes.</div>
            )}
        </div>
    );
}

// Значения по умолчанию для пропсов (если они не переданы)
ModelScatterPlot.defaultProps = {
    xAxisMetric: 'r_squared', // Метрика R² по умолчанию для X
    yAxisMetric: 'numRegressors', // Количество регрессоров по умолчанию для Y
    onPointClick: (modelId) => console.log('Scatter point clicked (default handler):', modelId),
};

export default ModelScatterPlot;