import React, { useMemo } from 'react';
import Plot from 'react-plotly.js';
import './ModelScatterPlot.css';

// ... (STATUS_COLORS и getMetricValue остаются без изменений) ...
const STATUS_COLORS = {
    valid: 'rgba(40, 167, 69, 0.7)',
    invalid_stats: 'rgba(220, 53, 69, 0.7)',
    error: 'rgba(108, 117, 125, 0.6)',
    skipped: 'rgba(13, 202, 240, 0.6)',
};
const DEFAULT_COLOR = 'rgba(200, 200, 200, 0.5)';

const getMetricValue = (modelResult, metricKey) => {
    if (!modelResult || !modelResult.data) return null;
    if (metricKey === 'numRegressors') {
        return modelResult.data.coefficients
            ? Object.keys(modelResult.data.coefficients).filter(k => k !== 'const').length
            : 0;
    }
     if (metricKey === 'n_obs') return modelResult.data.n_obs;
     if (metricKey === 'aic') return modelResult.data.aic;
     if (metricKey === 'bic') return modelResult.data.bic;
    if (modelResult.data.metrics && metricKey in modelResult.data.metrics) {
        const value = modelResult.data.metrics[metricKey];
        return typeof value === 'number' && isFinite(value) ? value : null;
    }
    return null;
};


function ModelScatterPlot({ modelData, xAxisMetric, yAxisMetric, onPointClick, selectedModelId }) {

    const plotData = useMemo(() => {
        // ... (логика подготовки plotData остается без изменений) ...
        if (!modelData) return [];
        const traces = {
            valid: { x: [], y: [], text: [], customdata: [], type: 'scattergl', mode: 'markers', name: 'Valid', marker: { color: STATUS_COLORS.valid, size: 6, opacity: 0.7 } },
            invalid_stats: { x: [], y: [], text: [], customdata: [], type: 'scattergl', mode: 'markers', name: 'Invalid (Stats)', marker: { color: STATUS_COLORS.invalid_stats, size: 6, opacity: 0.7 } },
            error: { x: [], y: [], text: [], customdata: [], type: 'scattergl', mode: 'markers', name: 'Error', marker: { color: STATUS_COLORS.error, size: 5, symbol: 'x', opacity: 0.6 } },
            skipped: { x: [], y: [], text: [], customdata: [], type: 'scattergl', mode: 'markers', name: 'Skipped', marker: { color: STATUS_COLORS.skipped, size: 5, symbol: 'diamond', opacity: 0.6 } },
        };
        const selectedTrace = { x: [], y: [], text: [], customdata: [], type: 'scattergl', mode: 'markers', name: 'Selected', marker: { color: 'rgba(255, 165, 0, 1)', size: 10, symbol: 'star', line: { color: 'black', width: 1 } }, showlegend: false };

        Object.entries(modelData).forEach(([modelId, result]) => {
            if (!result) return;
            const isSelected = modelId === selectedModelId;
            let currentTrace = null;
            let traceKey = null;
            if (result.status === 'completed') {
                traceKey = result.data?.is_valid ? 'valid' : 'invalid_stats';
            } else if (result.status === 'error') {
                traceKey = 'error';
            } else if (result.status === 'skipped') {
                traceKey = 'skipped';
            }
            if (traceKey) {
                currentTrace = traces[traceKey];
            } else { return; }

            const xValue = getMetricValue(result, xAxisMetric);
            const yValue = getMetricValue(result, yAxisMetric);
            const hoverText = `ID: ${modelId}<br>` +
                              (xValue !== null ? `${xAxisMetric}: ${xValue.toFixed ? xValue.toFixed(3) : xValue}<br>` : '') +
                              (yValue !== null ? `${yAxisMetric}: ${yValue.toFixed ? yValue.toFixed(3) : yValue}<br>` : '') +
                              `Status: ${result.status}${result.data?.is_valid === false ? ' (Invalid Stats)' : ''}`;

            if (xValue !== null && yValue !== null) {
                 if (isSelected) {
                     selectedTrace.x.push(xValue);
                     selectedTrace.y.push(yValue);
                     selectedTrace.text.push(hoverText);
                     selectedTrace.customdata.push({ id: modelId });
                 } else {
                     currentTrace.x.push(xValue);
                     currentTrace.y.push(yValue);
                     currentTrace.text.push(hoverText);
                     currentTrace.customdata.push({ id: modelId });
                 }
            }
        });
        const finalTraces = Object.values(traces).filter(trace => trace.x.length > 0);
        if (selectedTrace.x.length > 0) { finalTraces.push(selectedTrace); }
        return finalTraces;
    }, [modelData, xAxisMetric, yAxisMetric, selectedModelId]);

    // --- Конфигурация макета (Layout) для Plotly ---
    const layout = useMemo(() => ({
        // <<< ИЗМЕНЕНИЕ: Убрали autosize >>>
        // autosize: true,
        xaxis: {
            title: xAxisMetric,
            zeroline: false,
            // Убрали automargin
        },
        yaxis: {
            title: yAxisMetric,
            zeroline: false,
            automargin: true, // Оставили для Y
        },
        hovermode: 'closest',
        margin: { l: 60, r: 20, t: 10, b: 80 }, // Оставляем увеличенный margin.b
        legend: {
            orientation: "h",
            yanchor: "bottom",
            y: -0.3, // Оставляем сдвинутую легенду
            xanchor: "center",
            x: 0.5
        },
        plot_bgcolor: 'rgba(0,0,0,0)',
        paper_bgcolor: 'rgba(0,0,0,0)',
        // <<< ИЗМЕНЕНИЕ: Добавили uirevision >>>
        // Это значение будет меняться только при смене осей,
        // предотвращая сброс масштаба при обновлении данных.
        uirevision: `${xAxisMetric}-${yAxisMetric}`,
    }), [xAxisMetric, yAxisMetric]); // Зависимости layout

    // --- Обработчик клика Plotly ---
    const handlePlotClick = (data) => {
        // ... (обработчик клика без изменений) ...
        if (data.points.length > 0) {
            const pointData = data.points[0].customdata;
            if (pointData && pointData.id && onPointClick) {
                onPointClick(pointData.id);
            }
        } else if (onPointClick) {
             onPointClick(null);
        }
    };

    // --- Рендер ---
    return (
        // <<< ИЗМЕНЕНИЕ: Убрали класс model-scatter-plot, если он не используется в CSS >>>
        // <div className="model-scatter-plot">
        <>
            {plotData.length > 0 ? (
                <Plot
                    data={plotData}
                    layout={layout}
                    // <<< ИЗМЕНЕНИЕ: Явно указываем style, чтобы он занимал 100% контейнера >>>
                    style={{ width: '100%', height: '100%' }}
                    useResizeHandler={true} // По-прежнему пытаемся использовать авторесайз
                    config={{
                        responsive: true,
                        displaylogo: false,
                        modeBarButtonsToRemove: ['select2d', 'lasso2d', 'toImage']
                    }}
                    onClick={handlePlotClick}
                    // <<< ИЗМЕНЕНИЕ: Добавляем revision для данных, чтобы Plotly знал, когда обновлять >>>
                    // Используем длину данных как простой индикатор изменения
                    revision={plotData.reduce((sum, trace) => sum + trace.x.length, 0)}
                />
            ) : (
                <div className="plot-placeholder">No completed models with valid metrics to display.</div>
            )}
        </>
        // </div>
    );
}

// Значения по умолчанию для пропсов
ModelScatterPlot.defaultProps = {
    xAxisMetric: 'r_squared',
    yAxisMetric: 'numRegressors',
    onPointClick: (modelId) => console.log('Scatter point clicked (default handler):', modelId),
    selectedModelId: null,
};

export default ModelScatterPlot;