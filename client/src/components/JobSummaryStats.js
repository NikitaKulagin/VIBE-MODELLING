import React from 'react';
import './JobSummaryStats.css'; // Создадим этот файл для стилей

function JobSummaryStats({ stats, status }) {

    // Проверка на наличие данных
    if (!stats) {
        return <div className="job-summary-stats loading">Loading stats...</div>;
    }

    // Форматируем числа с разделителями для читаемости
    const formatNumber = (num) => (num || 0).toLocaleString();

    return (
        <div className="job-summary-stats">
            <div className="stat-item">
                <span className="stat-label">Status:</span>
                <span className={`stat-value status-text status-${status || 'idle'}`}>
                    {status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Idle'}
                </span>
            </div>
            <div className="stat-item">
                <span className="stat-label">Processed / Total:</span>
                <span className="stat-value">
                    {formatNumber(stats.processed)} / {formatNumber(stats.total)}
                </span>
            </div>
            <div className="stat-item">
                <span className="stat-label">Valid Models:</span>
                <span className="stat-value stat-valid">
                    {formatNumber(stats.valid)}
                </span>
            </div>
            <div className="stat-item">
                <span className="stat-label">Invalid (Stats):</span>
                <span className="stat-value stat-invalid-stats">
                    {formatNumber(stats.invalidStats)}
                </span>
            </div>
            {/* Пока не показываем Invalid (Constraints), так как нет данных
            <div className="stat-item">
                <span className="stat-label">Invalid (Constr.):</span>
                <span className="stat-value stat-invalid-constr">
                    {formatNumber(stats.invalidConstraints)}
                </span>
            </div>
             */}
            <div className="stat-item">
                <span className="stat-label">Skipped:</span>
                <span className="stat-value stat-skipped">
                    {formatNumber(stats.skipped)}
                </span>
            </div>
             <div className="stat-item">
                <span className="stat-label">Errors:</span>
                <span className="stat-value stat-error">
                    {formatNumber(stats.error)}
                </span>
            </div>
        </div>
    );
}

export default JobSummaryStats;