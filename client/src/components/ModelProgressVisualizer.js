import React from 'react';
import './ModelProgressVisualizer.css'; // Создадим позже

function ModelProgressVisualizer({ progressData }) {
    if (!progressData || !progressData.results) {
        return <div className="visualizer-placeholder">Waiting for results...</div>;
    }

    const results = progressData.results;
    const modelIds = Object.keys(results);
    const total = progressData.totalModels || modelIds.length; // Используем totalModels, если есть
    const processed = modelIds.length;

    // Простая визуализация статусов
    const statusCounts = modelIds.reduce((acc, id) => {
        const status = results[id]?.status || 'pending';
        acc[status] = (acc[status] || 0) + 1;
        return acc;
    }, {});

    return (
        <div className="model-progress-visualizer">
            <h4>Model Run Progress</h4>
            <p>Status: {progressData.status || 'idle'} | Processed: {processed} / {total}</p>
            <div className="status-summary">
                {Object.entries(statusCounts).map(([status, count]) => (
                    <span key={status} className={`status-badge status-${status}`}>
                        {status}: {count}
                    </span>
                ))}
            </div>
            {/* TODO: Добавить визуализацию сетки/куба */}
            <div className="results-grid-placeholder">
                {/* Здесь будет сетка квадратиков */}
                <p>(Grid visualization placeholder)</p>
            </div>
        </div>
    );
}

export default ModelProgressVisualizer;