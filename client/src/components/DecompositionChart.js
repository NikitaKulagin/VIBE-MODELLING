import React, { useMemo, useRef, useEffect } from 'react';
import {
    Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
    PointElement, Title, Tooltip, Legend, TimeScale, Filler
} from 'chart.js';
import { Chart } from 'react-chartjs-2';
import 'chartjs-adapter-date-fns';

// --- Регистрация компонентов ChartJS (без изменений) ---
ChartJS.register(
    CategoryScale, LinearScale, BarElement, LineElement, PointElement,
    Title, Tooltip, Legend, TimeScale, Filler
);

// --- Функция для генерации цветов ---
const generateColor = (index, alpha = 1.0) => { // <<< ИЗМЕНЕНО: alpha по умолчанию 1.0
    const colors = [
        `rgba(54, 162, 235, ${alpha})`, // Blue
        `rgba(255, 159, 64, ${alpha})`, // Orange
        `rgba(75, 192, 192, ${alpha})`, // Green
        `rgba(153, 102, 255, ${alpha})`,// Purple
        `rgba(255, 99, 132, ${alpha})`, // Red
        `rgba(255, 206, 86, ${alpha})`, // Yellow
        `rgba(201, 203, 207, ${alpha})`,// Grey
        `rgba(50, 205, 50, ${alpha})`,  // Lime Green
        `rgba(210, 105, 30, ${alpha})`, // Chocolate
        `rgba(0, 191, 255, ${alpha})`,  // Deep Sky Blue
    ];
    // Добавим больше цветов, если нужно
    const extendedColors = [
        ...colors,
        `rgba(255, 20, 147, ${alpha})`, // DeepPink
        `rgba(0, 128, 128, ${alpha})`,  // Teal
        `rgba(106, 90, 205, ${alpha})`, // SlateBlue
        `rgba(255, 140, 0, ${alpha})`,  // DarkOrange
        `rgba(60, 179, 113, ${alpha})`, // MediumSeaGreen
    ];
    return extendedColors[index % extendedColors.length];
};

// --- Основной компонент ---
function DecompositionChart({ decompositionData, selectedModelId }) {
    const chartRef = useRef(null);

    // --- Расчет диапазона оси Y (без изменений) ---
    const yAxisRange = useMemo(() => {
        if (!decompositionData || !decompositionData.actual_y || decompositionData.actual_y.length === 0) {
            return { min: undefined, max: undefined };
        }
        let minVal = Infinity; let maxVal = -Infinity;
        const updateRange = (value) => { if (value !== null && typeof value === 'number' && isFinite(value)) { if (value < minVal) minVal = value; if (value > maxVal) maxVal = value; } };
        decompositionData.actual_y.forEach(point => updateRange(point[1]));
        if (decompositionData.predicted_y) { decompositionData.predicted_y.forEach(point => updateRange(point[1])); }
        const numPoints = decompositionData.actual_y.length;
        const contributionDatasets = Object.values(decompositionData.contributions || {});
        if (contributionDatasets.length > 0) {
            for (let i = 0; i < numPoints; i++) {
                let positiveSum = 0; let negativeSum = 0;
                contributionDatasets.forEach(dataset => { const value = dataset[i]?.[1]; if (value !== null && typeof value === 'number' && isFinite(value)) { if (value >= 0) { positiveSum += value; } else { negativeSum += value; } } });
                updateRange(positiveSum); updateRange(negativeSum);
            }
        }
        if (minVal === Infinity) minVal = 0; if (maxVal === -Infinity) maxVal = 0;
        const range = maxVal - minVal; const buffer = range === 0 ? 5 : Math.abs(range * 0.1);
        return { min: minVal - buffer, max: maxVal + buffer };
    }, [decompositionData]);

    // --- Подготовка данных для Chart.js ---
    const chartData = useMemo(() => {
        if (!decompositionData || !decompositionData.actual_y || !Array.isArray(decompositionData.actual_y) || decompositionData.actual_y.length === 0) {
            return null;
        }
        const labels = decompositionData.actual_y.map(point => point[0]);

        // --- Создаем датасеты для вкладов (столбцы) ---
        const contributionDatasets = Object.entries(decompositionData.contributions || {})
            .map(([factorName, dataPoints], index) => {
                const isConstant = factorName.toLowerCase() === 'const';
                // <<< ИЗМЕНЕНО: Цвет константы тоже без прозрачности >>>
                const color = isConstant ? `rgba(150, 150, 150, 1.0)` : generateColor(index);

                return {
                    type: 'bar',
                    label: factorName,
                    data: dataPoints.map(point => point[1]),
                    backgroundColor: color,
                    borderColor: color, // <<< ДОБАВЛЕНО: Цвет границы = цвет заливки
                    borderWidth: 1,     // <<< ДОБАВЛЕНО: Толщина границы (можно 0, если не нужна)
                    stack: 'contributions',
                    order: isConstant ? 1 : 2,
                    barPercentage: 1.0,      // <<< ИЗМЕНЕНО: Убираем промежутки между категориями
                    categoryPercentage: 1.0, // <<< ИЗМЕНЕНО: Убираем промежутки внутри категории
                    yAxisID: 'y',
                };
            });

        // --- Создаем датасет для Actual Y (линия) ---
        const actualYDataset = {
            type: 'line', label: 'Actual Y', data: decompositionData.actual_y.map(point => point[1]),
            borderColor: 'rgba(0, 0, 0, 0.9)', // Чуть насыщеннее
            borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, fill: false, tension: 0.1,
            order: 0, yAxisID: 'y_lines', stack: null,
        };

        // --- Создаем датасет для Predicted Y (линия) ---
        const predictedYDataset = {
            type: 'line', label: 'Predicted Y', data: decompositionData.predicted_y.map(point => point[1]),
            borderColor: 'rgba(220, 53, 69, 0.9)', // Чуть насыщеннее
            borderWidth: 2, borderDash: [5, 5], pointRadius: 0, pointHoverRadius: 4,
            fill: false, tension: 0.1, order: 0, yAxisID: 'y_lines', stack: null,
        };

        return { labels: labels, datasets: [...contributionDatasets, actualYDataset, predictedYDataset] };
    }, [decompositionData]);

    // --- Конфигурация опций графика (без изменений) ---
    const chartOptions = useMemo(() => {
        return {
            responsive: true, maintainAspectRatio: false,
            plugins: { /* ... (без изменений) ... */
                 legend: { position: 'bottom', labels: { boxWidth: 12, padding: 15 }, },
                 title: { display: true, text: `Model Decomposition${selectedModelId ? ` for ${selectedModelId}` : ''}`, padding: { top: 10, bottom: 15 }, font: { size: 14 } },
                 tooltip: { mode: 'index', intersect: false, callbacks: { label: function(context) { let label = context.dataset.label || ''; if (label) { label += ': '; } if (context.parsed.y !== null) { label += context.parsed.y.toFixed(2); } return label; } }, },
            },
            scales: {
                x: { /* ... (без изменений) ... */
                    type: 'time', time: { tooltipFormat: 'PP' }, stacked: false,
                    title: { display: true, text: 'Time' }, grid: { display: false },
                    ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 15 }
                },
                y: { /* ... (без изменений, использует yAxisRange) ... */
                    type: 'linear', display: true, position: 'left', stacked: true,
                    title: { display: true, text: 'Value' }, grid: { color: 'rgba(0, 0, 0, 0.05)' },
                    min: yAxisRange.min, max: yAxisRange.max,
                },
                y_lines: { /* ... (без изменений, использует yAxisRange) ... */
                    type: 'linear', display: true, position: 'left', stacked: false,
                    grid: { drawOnChartArea: false, }, ticks: { display: false, },
                    title: { display: false }, min: yAxisRange.min, max: yAxisRange.max,
                }
            },
            interaction: { /* ... (без изменений) ... */
                 mode: 'index', intersect: false,
            },
            animation: { /* ... (без изменений) ... */
                 duration: 200,
            },
        };
    }, [selectedModelId, yAxisRange]);

    // --- Эффект для отладки (без изменений) ---
    useEffect(() => { /* ... */ }, [decompositionData, selectedModelId]);

    // --- Рендер компонента (без изменений) ---
    if (!chartData) { return null; }
    return (
        <div style={{ position: 'relative', height: '75vh', minHeight: '300px', width: '100%' }}>
            <Chart
                ref={chartRef}
                type='bar'
                data={chartData}
                options={chartOptions}
            />
        </div>
    );
}

export default DecompositionChart;