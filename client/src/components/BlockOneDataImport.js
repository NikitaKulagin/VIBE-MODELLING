import React, { useState, useCallback, useEffect, useMemo } from 'react';
import axios from 'axios';
import { useDropzone } from 'react-dropzone';
import './BlockOneDataImport.css'; // <<< Импортируем CSS файл

// --- Иконки ---
const CheckIcon = () => <span style={{ color: '#28a745', fontWeight: 'bold' }}>✔</span>;
const ExcludeIcon = () => <span style={{ color: '#dc3545', fontWeight: 'bold' }}>ø</span>;
// --- Конец иконок ---

function BlockOneDataImport({ setViewingSeries, setProcessedData }) {
    // --- Состояния ---
    const [detectedSeries, setDetectedSeries] = useState(null);
    const [isLoadingSheets, setIsLoadingSheets] = useState(false);
    const [isLoadingData, setIsLoadingData] = useState(false); // Для process_sheets
    const [error, setError] = useState(null);
    const [selectedFile, setSelectedFile] = useState(null);
    const [fileName, setFileName] = useState('');
    const [availableSheets, setAvailableSheets] = useState([]);
    const [selectedSheets, setSelectedSheets] = useState(new Set());
    const [sheetsLoaded, setSheetsLoaded] = useState(false);
    const [selectedSeriesForProcessing, setSelectedSeriesForProcessing] = useState(new Set());
    const [targetFrequency, setTargetFrequency] = useState('Q');
    const [isProcessingForBlock2, setIsProcessingForBlock2] = useState(false); // Для aggregate_series
    const [metadataKeys, setMetadataKeys] = useState([]);
    const [filterCategory, setFilterCategory] = useState('');
    const [filterValue, setFilterValue] = useState('');
    const [categoryValues, setCategoryValues] = useState([]);
    // --- Конец состояний ---

    // --- Функции ---
    const resetState = useCallback(() => {
        setSelectedFile(null); setFileName(''); setAvailableSheets([]); setSelectedSheets(new Set());
        setSheetsLoaded(false); setError(null); setDetectedSeries(null);
        setIsLoadingSheets(false); setIsLoadingData(false);
        setSelectedSeriesForProcessing(new Set()); setIsProcessingForBlock2(false); setTargetFrequency('Q');
        setMetadataKeys([]); setFilterCategory(''); setFilterValue(''); setCategoryValues([]);
        if(setProcessedData) setProcessedData(null); if(setViewingSeries) setViewingSeries(null);
    }, [setProcessedData, setViewingSeries]);

    const fetchSheetNames = useCallback(async (file) => {
        if (!file) return;
        setIsLoadingSheets(true); setError(null);
        const formData = new FormData(); formData.append('excelFile', file);
        try {
            const response = await axios.post('http://localhost:5001/api/get_sheet_names', formData, { headers: { 'Content-Type': 'multipart/form-data' }, });
            if (response.data && Array.isArray(response.data.sheetNames)) {
                setAvailableSheets(response.data.sheetNames); setSheetsLoaded(true);
            } else { throw new Error("Invalid format for sheet names received."); }
        } catch (err) { setError(err.response?.data?.error || 'Could not fetch sheet names.'); resetState(); }
        finally { setIsLoadingSheets(false); }
    }, [resetState]);

    const onDrop = useCallback(acceptedFiles => {
        if (acceptedFiles.length > 0) {
            const file = acceptedFiles[0];
            const types = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];
            if (types.includes(file.type) || file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
                resetState(); setSelectedFile(file); setFileName(file.name); fetchSheetNames(file);
            } else { resetState(); setError(`Invalid file type.`); }
        }
    }, [resetState, fetchSheetNames]);

    const handleSheetToggle = (sheetName) => {
        setSelectedSheets(prev => {
            const ns = new Set(prev);
            if (ns.has(sheetName)) ns.delete(sheetName); else ns.add(sheetName);
            // Сбрасываем все последующие шаги при смене листов
            setDetectedSeries(null); if(setProcessedData) setProcessedData(null);
            setSelectedSeriesForProcessing(new Set()); setMetadataKeys([]);
            setFilterCategory(''); setFilterValue(''); setCategoryValues([]);
            return ns;
        });
    };

    const handleProcessSelectedSheets = async () => {
        if (!selectedFile || selectedSheets.size === 0) return;
        setIsLoadingData(true); setError(null); setDetectedSeries(null);
        if(setProcessedData) setProcessedData(null); setSelectedSeriesForProcessing(new Set()); setMetadataKeys([]);
        const formData = new FormData();
        formData.append('excelFile', selectedFile);
        formData.append('selectedSheets', JSON.stringify(Array.from(selectedSheets)));
        try {
            const response = await axios.post('http://localhost:5001/api/process_sheets', formData, { headers: { 'Content-Type': 'multipart/form-data' }, });
            let finalData = [];
            if (Array.isArray(response.data)) { finalData = response.data; }
            else if (response.data?.data) { finalData = response.data.data; if(response.data.warning) setError(`Warning: ${response.data.warning}`); }
            else { throw new Error("Unexpected data format."); }

            setDetectedSeries(finalData);
            if (finalData.length > 0) {
                setSelectedSeriesForProcessing(new Set(finalData.map(s => s.name))); // Выбираем все
                const firstSeriesMeta = finalData[0]?.metadata;
                if (firstSeriesMeta && typeof firstSeriesMeta === 'object') {
                    const keys = Object.keys(firstSeriesMeta).filter(key => key !== 'Description' && key !== 'Timeframe');
                    setMetadataKeys(keys);
                } else { setMetadataKeys([]); }
            } else { setMetadataKeys([]); }
        } catch (err) {
            setError(err.response?.data?.error || 'File processing failed.');
            setDetectedSeries(null); setSelectedSeriesForProcessing(new Set()); setMetadataKeys([]);
        } finally { setIsLoadingData(false); }
    };

    const handleSeriesSelectionToggle = (seriesName, event) => {
        event.stopPropagation(); // Предотвратить клик по плашке
        setSelectedSeriesForProcessing(prev => {
            const ns = new Set(prev);
            if (ns.has(seriesName)) ns.delete(seriesName); else ns.add(seriesName);
            if(setProcessedData) setProcessedData(null); // Сбросить результат агрегации
            return ns;
        });
    };

    const handlePlaqueClick = (series) => {
        if (setViewingSeries) { setViewingSeries(series); }
    };

    // --- ИЗМЕНЕННАЯ ФУНКЦИЯ handleAggregateSelectedSeries ---
    const handleAggregateSelectedSeries = async () => {
        if (selectedSeriesForProcessing.size === 0 || !detectedSeries) return;
        setIsProcessingForBlock2(true); setError(null);
        if(setProcessedData) setProcessedData(null); // Сброс предыдущего результата

        const seriesToProcess = detectedSeries.filter(series =>
            selectedSeriesForProcessing.has(series.name)
        );
        const payload = {
            target_frequency: targetFrequency,
            series_list: seriesToProcess // Отправляем полные объекты
        };
        console.log("Sending data for aggregation:", payload);

        try {
            // <<< РЕАЛЬНЫЙ ВЫЗОВ БЭКЕНДА >>>
            const response = await axios.post('http://localhost:5001/api/aggregate_series', payload);
            console.log("Aggregation response:", response.data);

            if (response.data && typeof response.data === 'object' && !response.data.error) {
                const aggregatedData = response.data; // { seriesName1: [[ts,val],...], ... }
                const processedDataForApp = {};
                Object.keys(aggregatedData).forEach(seriesName => {
                    const originalSeries = seriesToProcess.find(s => s.name === seriesName);
                    if (originalSeries) {
                        processedDataForApp[seriesName] = {
                            name: seriesName,
                            data: aggregatedData[seriesName], // Агрегированные данные
                            metadata: originalSeries.metadata, // Исходные метаданные
                            frequency: targetFrequency, // Целевая частота
                            isSynthetic: false
                        };
                    } else { console.warn(`Original series not found for aggregated key: ${seriesName}`); }
                });

                if (setProcessedData) {
                    setProcessedData(processedDataForApp); // Передаем результат в App.js
                    console.log("Processed data set in App state:", processedDataForApp);
                } else { console.warn("setProcessedData prop is not provided"); }
            } else { throw new Error(response.data?.error || "Unknown aggregation error structure."); }
        } catch (err) {
            console.error("Aggregation error:", err);
            setError(err.response?.data?.error || err.message || "Aggregation failed.");
            if(setProcessedData) setProcessedData(null);
        } finally {
            setIsProcessingForBlock2(false);
        }
    };
    // --- КОНЕЦ ИЗМЕНЕНИЙ ---

    const selectAllSeries = () => {
        if (!detectedSeries) return;
        setSelectedSeriesForProcessing(new Set(detectedSeries.map(s => s.name)));
        if(setProcessedData) setProcessedData(null);
    };

    const unselectAllSeries = () => {
        setSelectedSeriesForProcessing(new Set());
        if(setProcessedData) setProcessedData(null);
    };

    const clearFilter = () => {
        setFilterCategory(''); setFilterValue(''); setCategoryValues([]);
        selectAllSeries();
    };

    // useEffect для обновления значений фильтра
    useEffect(() => {
        if (filterCategory && detectedSeries) {
            const values = new Set( detectedSeries.map(s => s.metadata?.[filterCategory]).filter(value => value != null && value !== '') );
            setCategoryValues(Array.from(values).sort());
            setFilterValue('');
        } else { setCategoryValues([]); }
    }, [filterCategory, detectedSeries]);

    // useEffect для применения фильтра
    useEffect(() => {
        if (filterCategory && filterValue && detectedSeries) {
            const filteredSelection = new Set();
            detectedSeries.forEach(series => { if (series.metadata?.[filterCategory] === filterValue) { filteredSelection.add(series.name); } });
            setSelectedSeriesForProcessing(filteredSelection);
            if(setProcessedData) setProcessedData(null);
        }
    }, [filterValue, filterCategory, detectedSeries, setProcessedData]);
    // --- Конец функций ---

    // Dropzone config и классы
    const { getRootProps, getInputProps, isFocused, isDragAccept, isDragReject } = useDropzone({ onDrop, accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'], 'application/vnd.ms-excel': ['.xls'] }, multiple: false });
    const dropzoneClassName = useMemo(() => `dropzone ${isFocused ? 'dropzone-focused' : ''} ${isDragAccept ? 'dropzone-accept' : ''} ${isDragReject ? 'dropzone-reject' : ''}`, [isFocused, isDragAccept, isDragReject]);

    // Опции частоты
    const frequencyOptions = [
        { value: 'Q', label: 'Quarterly (Q)' },
        { value: 'M', label: 'Monthly (M)' },
        { value: 'A', label: 'Annual (A)' },
        { value: 'W', label: 'Weekly (W)' },
        { value: 'D', label: 'Daily (D)' },
    ];

    // --- JSX с использованием CSS классов ---
    return (
        <div className="blockOneContainer">
            <h4>1. Import Data</h4>

            {/* Dropzone */}
            <div {...getRootProps({ className: dropzoneClassName })}>
                 <input {...getInputProps()} />
                 {fileName ? (
                     <p className="dropzone-selected-file">Selected: {fileName}</p>
                 ) : (
                     <>
                        <p>Drag 'n' drop an Excel file here, or click to select file</p>
                        <em style={{fontSize: '0.9em'}}>(Only *.xlsx and *.xls files will be accepted)</em>
                     </>
                 )}
             </div>

            {/* Индикаторы и выбор листов */}
             {isLoadingSheets && <p className="loading-text">Loading sheet names...</p>}
             {sheetsLoaded && availableSheets.length > 0 && (
                 <div style={{ margin: '15px 0' }}>
                     <h5 style={{marginBottom: '8px'}}>Select sheets to process:</h5>
                     <div className="sheet-chip-container">
                         {availableSheets.map(name => {
                            const isSelected = selectedSheets.has(name);
                            const chipClassName = `sheet-chip ${isSelected ? 'sheet-chip-selected' : ''}`;
                            return (
                                <div
                                    key={name}
                                    onClick={() => handleSheetToggle(name)}
                                    className={chipClassName}
                                    title={`Click to ${isSelected ? 'deselect' : 'select'} sheet "${name}"`}
                                >
                                    {name}
                                </div>
                             );
                         })}
                     </div>
                 </div>
             )}
             {/* Кнопка Process Sheets */}
             {sheetsLoaded && availableSheets.length > 0 && (
                 <button
                    onClick={handleProcessSelectedSheets}
                    disabled={isLoadingData || selectedSheets.size === 0}
                    className="process-sheets-button"
                 >
                    {isLoadingData ? 'Processing...' : `Process Selected (${selectedSheets.size}) Sheets`}
                 </button>
             )}
             {isLoadingData && <p className="loading-text">Processing selected sheets...</p>}
             {error && <p className="error-text">{error}</p>}

            {/* Отображение результатов */}
            {detectedSeries && Array.isArray(detectedSeries) && (
                <div className="series-display-container">
                    {/* Контейнер с плашками и панель управления */}
                    {detectedSeries.length > 0 && (
                        <>
                            <h5>Detected Time Series ({detectedSeries.length} found):</h5>
                             {/* Блок управления выбором и фильтр */}
                             <div className="series-controls">
                                 <button onClick={selectAllSeries} className="series-control-button">Select All</button>
                                 <button onClick={unselectAllSeries} className="series-control-button">Unselect All</button>
                                 {/* Фильтр */}
                                 {metadataKeys.length > 0 && !filterCategory && (
                                      <>
                                          <label htmlFor="filter-cat" className="filter-label">Filter by:</label>
                                          <select id="filter-cat" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="filter-select" >
                                              <option value="">-- Select Category --</option>
                                              {metadataKeys.map(key => <option key={key} value={key}>{key}</option>)}
                                          </select>
                                      </>
                                 )}
                                 {filterCategory && categoryValues.length > 0 && (
                                      <>
                                          <label htmlFor="filter-val" className="filter-value-label">{filterCategory}:</label>
                                          <select id="filter-val" value={filterValue} onChange={(e) => setFilterValue(e.target.value)} className="filter-select" >
                                              <option value="">-- Select Value --</option>
                                              {categoryValues.map(val => <option key={val} value={val}>{val}</option>)}
                                          </select>
                                          <button onClick={clearFilter} className="clear-filter-button" title="Clear filter and select all">Clear Filter</button>
                                      </>
                                 )}
                             </div>

                            {/* Контейнер с плашками */}
                            <div className="series-grid-container">
                                <div className="series-grid">
                                    {detectedSeries.map((series, index) => {
                                        const isSelectedForProcessing = selectedSeriesForProcessing.has(series.name);
                                        const plaqueClassName = `series-plaque ${isSelectedForProcessing ? '' : 'series-plaque-unselected'}`; // Убрали selected класс, используем только unselected для затемнения
                                        const toggleButtonClassName = `series-toggle-button ${isSelectedForProcessing ? 'series-toggle-button-selected' : 'series-toggle-button-unselected'}`;
                                        return (
                                            <div
                                                key={`${series.name}-${index}`}
                                                className={plaqueClassName}
                                                onClick={() => handlePlaqueClick(series)}
                                                title={`${series.metadata?.Description || series.name}\nClick to view chart. Use button to include/exclude.`}
                                            >
                                                <button
                                                    className={toggleButtonClassName}
                                                    onClick={(e) => handleSeriesSelectionToggle(series.name, e)}
                                                    title={isSelectedForProcessing ? 'Exclude from next step' : 'Include in next step'}
                                                >
                                                    {isSelectedForProcessing ? <CheckIcon /> : <ExcludeIcon />}
                                                </button>
                                                <div className="series-plaque-header">
                                                    <span className="series-name"> {series.name || 'Unnamed Series'} </span>
                                                    <span className="frequency-tag"> {series.frequency || 'N/A'} </span>
                                                </div>
                                                <span className="series-meta">
                                                    {`T:${series.metadata?.Type||'-'} S:${series.metadata?.Sector||'-'} U:${series.metadata?.units||'-'} F/L:${series.metadata?.['Flow/Level']||'-'}`}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </>
                    )}

                    {/* Панель агрегации */}
                    {detectedSeries.length > 0 && (
                        <div className="aggregation-panel">
                           <h5>Prepare Data for Next Step</h5>
                           <div className="aggregation-controls">
                               <div>
                                   <label htmlFor="target-freq" className="aggregation-label">Target Frequency:</label>
                                   <div className="freq-select-container">
                                       <select
                                            id="target-freq"
                                            value={targetFrequency}
                                            onChange={(e) => setTargetFrequency(e.target.value)}
                                            disabled={isProcessingForBlock2}
                                            className="freq-select"
                                        >
                                           {frequencyOptions.map(option => (
                                               <option key={option.value} value={option.value}>
                                                   {option.label}
                                               </option>
                                           ))}
                                       </select>
                                       {/* Стрелку добавляет CSS через ::after к .freq-select-container */}
                                   </div>
                               </div>
                               <button
                                    onClick={handleAggregateSelectedSeries}
                                    disabled={isProcessingForBlock2 || selectedSeriesForProcessing.size === 0}
                                    className="prepare-button"
                                >
                                    {isProcessingForBlock2 ? 'Processing...' : `Prepare ${selectedSeriesForProcessing.size} series (${targetFrequency})`}
                               </button>
                           </div>
                        </div>
                    )}
                    {/* Сообщение если рядов нет */}
                    {detectedSeries.length === 0 && !isLoadingData && (
                        <p style={{marginTop: '15px'}}>No time series could be extracted.</p>
                    )}
                </div>
            )}
        </div> // Конец основного div
    );
}

export default BlockOneDataImport;