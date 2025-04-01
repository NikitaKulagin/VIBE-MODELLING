// TimeSeriesChart.js - УПРОЩЕННАЯ ВЕРСИЯ (без кнопки Reset внутри)

import React, { forwardRef } from 'react'; // Добавляем forwardRef
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend } from 'chart.js';
import zoomPlugin from 'chartjs-plugin-zoom';
import Hammer from 'hammerjs';

ChartJS.register( CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, zoomPlugin );

// --- Стили ---
// Оставляем только стили, нужные для самого графика и тега частоты
const chartFrequencyTagStyle = { /* ... */ position: 'absolute', top: '45px', right: '15px', padding: '4px 8px', backgroundColor: '#0d6efd', color: 'white', borderRadius: '5px', fontSize: '0.9em', fontWeight: 'bold', zIndex: 10 };
// Убрали reset* стили

// Контейнер теперь проще, только для relative позиционирования тега частоты
const chartContainerStyle = {
    position: 'relative',
    height: 'calc(85vh - 50px)', // <<< Уменьшаем высоту, чтобы оставить место для кнопки в App.js
    width: '100%'
};
// --- Конец стилей ---

// Используем forwardRef для передачи ref из App.js
const TimeSeriesChart = forwardRef(({ seriesData }, ref) => {

  // Проверка данных (без изменений)
  if (!seriesData || !seriesData.data || !Array.isArray(seriesData.data) || seriesData.data.length === 0) {
    return ( <div style={{ padding: '20px', textAlign: 'center', color: '#888' }}> Select a series from the list on the left to view the chart. </div> );
  }

  // Подготовка данных (без изменений)
  const labels = seriesData.data.map(point => { try { const date = new Date(point[0]); return isNaN(date.getTime()) ? 'Invalid' : date.toLocaleDateString(); } catch (e) { return 'Error'; }});
  const dataValues = seriesData.data.map(point => point[1]);
  const chartData = { labels: labels, datasets: [ { /* ... dataset data ... */ label: seriesData.name || 'Time Series', data: dataValues, fill: false, borderColor: 'rgb(75, 192, 192)', backgroundColor: 'rgba(75, 192, 192, 0.5)', tension: 0.1, pointRadius: 2, pointHoverRadius: 5, }, ], };

  // Опции графика (без afterFit для оси X)
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top', display: true },
      title: { display: true, text: () => { /* ... (без изменений) ... */ const name = seriesData.name || 'Unnamed Series'; const meta = seriesData.metadata || {}; const metaParts = [ meta.Type ? `Type: ${meta.Type}` : null, meta.Sector ? `Sector: ${meta.Sector}` : null, meta.units ? `Units: ${meta.units}` : null, meta['Flow/Level'] ? `Flow/Level: ${meta['Flow/Level']}` : null, ].filter(part => part !== null); let titleText = name; if (metaParts.length > 0) { titleText = [name, `(${metaParts.join(' | ')})`]; } return titleText; }, font: { size: 16 }, padding: { bottom: 10 } },
      tooltip: { mode: 'index', intersect: false },
      zoom: { // Настройки зума/пана без изменений
          pan: { enabled: true, mode: 'xy', modifierKey: 'shift', threshold: 10, }, // Можно вернуть threshold к 10
          zoom: { wheel: { enabled: true, }, pinch: { enabled: true }, drag: { enabled: true, backgroundColor: 'rgba(0, 123, 255, 0.3)' }, mode: 'xy', }
      }
    },
    scales: { // Убрали afterFit
        x: { title: { display: true, text: 'Date / Observation' }, ticks: { autoSkip: true, maxTicksLimit: 15 } },
        y: { title: { display: true, text: seriesData.metadata?.units || 'Value' }, },
    },
    hover: { mode: 'nearest', intersect: true }
  };

  // Рендер
  return (
      // Контейнер нужен для позиционирования тега частоты
      <div style={chartContainerStyle}>
          {/* Тег частоты */}
          {seriesData?.frequency && ( <span style={chartFrequencyTagStyle}> Freq: {seriesData.frequency} </span> )}

          {/* График. Передаем ref, полученный через forwardRef */}
          <Line ref={ref} options={chartOptions} data={chartData} />

          {/* Кнопку и подсказку убрали отсюда */}
      </div>
   );
}); // Оборачиваем в forwardRef

export default TimeSeriesChart;