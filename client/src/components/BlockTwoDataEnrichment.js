import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios'; // <<< Добавляем импорт axios
import './BlockTwoDataEnrichment.css'; // <<< Импортируем CSS

// --- Иконка Карандаш ---
const PencilIcon = ({ size = 14, color = "currentColor" }) => ( <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill={color} viewBox="0 0 16 16"> <path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708l-3-3zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207l6.5-6.5zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11l.178-.178z"/> </svg> );
// --- Иконка Закрытия (для модального окна) ---
const CloseIcon = ({ size = 16, color = "#6c757d" }) => ( <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill={color} viewBox="0 0 16 16"> <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z"/> </svg> );
// --- Конец иконок ---

// --- Стили для модального окна (добавляем к существующим стилям) ---
// (Предполагается, что стили из BlockTwoDataEnrichment.css загружены)
const modalOverlayStyle = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
const modalContentStyle = { background: 'white', padding: '20px 30px', borderRadius: '8px', minWidth: '400px', maxWidth: '80%', maxHeight: '80vh', overflowY: 'auto', position: 'relative' };
const modalCloseButtonStyle = { position: 'absolute', top: '10px', right: '10px', background: 'none', border: 'none', fontSize: '1.2em', cursor: 'pointer', padding: '5px' };
const normalizeGridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '8px', marginTop: '15px', maxHeight: '60vh', overflowY: 'auto' };
const normalizePlaqueStyle = { border: '1px solid #ccc', padding: '8px', borderRadius: '4px', cursor: 'pointer', textAlign: 'center', fontSize: '0.85em', backgroundColor: '#f8f9fa', transition: 'background-color 0.2s ease' };
const normalizePlaqueHoverStyle = { backgroundColor: '#e2e6ea' };
// --- Конец стилей модального окна ---


function BlockTwoDataEnrichment({ processedData, setEnrichedData, setViewingSeries, viewingSeries }) {
    // --- Состояния ---
    const [internalData, setInternalData] = useState(null);
    const [seriesOrder, setSeriesOrder] = useState([]);
    const [editingName, setEditingName] = useState(null);
    const [tempName, setTempName] = useState('');
    const inputRef = useRef(null);
    // <<< Добавляем состояния >>>
    const [isTransforming, setIsTransforming] = useState(null);
    const [transformError, setTransformError] = useState(null);
    const [showNormalizeModal, setShowNormalizeModal] = useState(false);
    const [seriesToNormalize, setSeriesToNormalize] = useState(null);
    // --- Конец состояний ---

    // --- Функции ---
    // Синхронизация с processedData (без изменений)
    useEffect(() => {
        console.log("Block 2 received processedData:", processedData);
        if (processedData && typeof processedData === 'object' && !Array.isArray(processedData)) {
             try {
                 const initialInternalData = {}; const initialOrder = Object.keys(processedData);
                 initialOrder.forEach(key => { initialInternalData[key] = { ...JSON.parse(JSON.stringify(processedData[key])), isSynthetic: processedData[key].isSynthetic || false }; });
                 setInternalData(initialInternalData); setSeriesOrder(initialOrder);
                 if (setEnrichedData) { setEnrichedData(initialInternalData); }
             } catch (e) { setInternalData(null); setSeriesOrder([]); if (setEnrichedData) { setEnrichedData(null); } console.error("Failed copy:", e); }
        } else { setInternalData(null); setSeriesOrder([]); if (setEnrichedData) { setEnrichedData(null); } }
        setEditingName(null);
    }, [processedData, setEnrichedData]);

    // Фокус на input (без изменений)
    useEffect(() => { if (editingName && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [editingName]);

    // Действия редактирования/удаления/клика (без изменений)
    const startEditing = (seriesName, event) => { if(event) event.stopPropagation(); setEditingName(seriesName); setTempName(seriesName); };
    const cancelEditing = () => { setEditingName(null); };
    const saveRename = (oldName) => { /* ... (логика переименования с сохранением порядка) ... */ };
    const handleInputKeyDown = (event, oldName) => { if (event.key === 'Enter') { saveRename(oldName); } else if (event.key === 'Escape') { cancelEditing(); } };
    const handleDelete = (seriesName, event) => { /* ... (логика удаления с обновлением порядка) ... */ };
    const handlePlaqueClick = (seriesName) => { if (editingName === seriesName) return; if (setViewingSeries && internalData && internalData[seriesName]) { setViewingSeries(internalData[seriesName]); } };

    // <<< Добавляем функцию applyTransformation >>>
    const applyTransformation = async (operation, seriesName, options = {}) => {
        if (!internalData || !internalData[seriesName]) return;
        const sourceSeries = internalData[seriesName];
        let prefix = ''; let baseForName = seriesName;
        switch(operation) {
            case 'diff_abs': prefix = `diffAbs${options.periods || 1}_`; break;
            case 'diff_pct': prefix = `diffPct${options.periods || 1}_`; break;
            case 'normalize': prefix = `normBy_${options.denominatorName}_`; break;
            default: prefix = `${operation}_`;
        }
        let newSeriesName = prefix + baseForName;
        let counter = 1; const initialNewName = newSeriesName;
        while (internalData[newSeriesName]) { newSeriesName = `${initialNewName}_${counter}`; counter++; }

        setIsTransforming(seriesName); setTransformError(null);
        const payload = { operation, series_name: seriesName, series_data: sourceSeries.data, periods: options.periods || 1, denominator_name: options.denominatorName, denominator_data: options.denominatorData, };
        console.log(`Applying transformation: ${operation} to ${seriesName} -> ${newSeriesName}`);
        try {
            const response = await axios.post('http://localhost:5001/api/transform_series', payload);
            if (response.data && response.data.result_data && Array.isArray(response.data.result_data)) {
                const newSeriesData = response.data.result_data;
                const updatedData = { ...internalData };
                const newSeriesObject = { name: newSeriesName, data: newSeriesData, metadata: { ...sourceSeries.metadata, Source: seriesName, Transform: operation, ...(options.periods && { Period: options.periods }), ...(options.denominatorName && { Denominator: options.denominatorName }), }, frequency: sourceSeries.frequency, isSynthetic: true };
                updatedData[newSeriesName] = newSeriesObject;
                const sourceIndex = seriesOrder.indexOf(seriesName);
                const updatedOrder = [...seriesOrder]; updatedOrder.splice(sourceIndex + 1, 0, newSeriesName);
                setInternalData(updatedData); setSeriesOrder(updatedOrder);
                if (setEnrichedData) { setEnrichedData(updatedData); } console.log(`Created new series: ${newSeriesName}`);
            } else { throw new Error(response.data?.error || "Invalid data structure received."); }
        } catch (err) { console.error(`Error applying ${operation} to ${seriesName}:`, err); setTransformError(err.response?.data?.error || err.message || `Failed to apply ${operation}.`); }
        finally { setIsTransforming(null); }
    };

    // <<< Добавляем функцию getYoYPeriod >>>
    const getYoYPeriod = (frequency) => {
        const freqUpper = frequency?.toUpperCase();
        if (freqUpper === 'M') return 12; if (freqUpper === 'Q') return 4; if (freqUpper === 'A' || freqUpper === 'Y') return 1; return 1;
    };

    // <<< Обновляем обработчики кнопок >>>
    const handleDiffAbs = (seriesName, event) => {
        event.stopPropagation(); if (!internalData || !internalData[seriesName]) return;
        const period = getYoYPeriod(internalData[seriesName].frequency);
        applyTransformation('diff_abs', seriesName, { periods: period });
    };
    const handleDiffPct = (seriesName, event) => {
        event.stopPropagation(); if (!internalData || !internalData[seriesName]) return;
        const period = getYoYPeriod(internalData[seriesName].frequency);
        applyTransformation('diff_pct', seriesName, { periods: period });
    };
    const openNormalizeModal = (seriesName, event) => {
        event.stopPropagation(); if (!internalData || !seriesOrder || seriesOrder.length < 2) { alert("Need at least two series."); return; }
        setSeriesToNormalize(seriesName); setShowNormalizeModal(true); setTransformError(null);
    };
    const closeNormalizeModal = () => { setShowNormalizeModal(false); setSeriesToNormalize(null); };
    const handleSelectDenominator = (denominatorName) => {
        if (seriesToNormalize && denominatorName && internalData[denominatorName]) { applyTransformation('normalize', seriesToNormalize, { denominatorName: denominatorName, denominatorData: internalData[denominatorName].data }); }
        else { console.error("Error selecting denominator:", denominatorName); }
        closeNormalizeModal();
    };
    // --- Конец функций ---

    const seriesCount = seriesOrder.length;

    // --- JSX ---
    return (
        // Используем className вместо style
        <div className="blockTwoContainer">
            <h4>2. Data Enrichment & Transformation</h4>
            {/* Отображение ошибки трансформации */}
            {transformError && <p className="error-text">{transformError}</p>}

            {/* Сообщение об отсутствии данных */}
            {(!internalData || seriesCount === 0) && ( <p className="noDataMessage"> {processedData === null ? "Waiting..." : "No series data..."} </p> )}

            {/* Список рядов */}
            {internalData && seriesCount > 0 && (
                <div className="seriesListContainer">
                    {seriesOrder.map(name => {
                        const series = internalData[name];
                        if (!series) return null;
                        const isEditingThis = editingName === name;
                        const isLoadingThis = isTransforming === name;

                        return (
                            <div key={name} className="seriesPlaqueTwo" onClick={() => handlePlaqueClick(name)} >
                                {/* Кнопка Rename */}
                                <button className="renameIconButton" onClick={(e) => startEditing(name, e)} title={`Rename ${name}`} disabled={isLoadingThis}> <PencilIcon /> </button>
                                {/* Имя или Поле ввода */}
                                <div className="seriesNameContainer">
                                    {isEditingThis ? ( <input ref={inputRef} type="text" value={tempName} onChange={(e) => setTempName(e.target.value)} onBlur={() => saveRename(name)} onKeyDown={(e) => handleInputKeyDown(e, name)} className="editingInput" onClick={(e) => e.stopPropagation()} /> )
                                    : ( <span className="seriesNameSpan" onDoubleClick={(e) => startEditing(name, e)} title={`...`}> {name} {series.isSynthetic && (<span className="syntheticTag" title="Synthetic Series">S</span>)} </span> )}
                                </div>
                                {/* Кнопки действий */}
                                <div className="actionButtonsContainer">
                                    {isLoadingThis ? ( <span style={{ fontStyle: 'italic', fontSize: '0.8em' }}>Processing...</span> )
                                    : ( <>
                                            {/* <<< Обновленные кнопки Diff и Norm By >>> */}
                                            <button className="actionButton" onClick={(e) => handleDiffAbs(name, e)} title={`Calculate Absolute YoY Difference`} disabled={isTransforming}>Diff Abs YoY</button>
                                            <button className="actionButton" onClick={(e) => handleDiffPct(name, e)} title={`Calculate Percentage YoY Difference`} disabled={isTransforming}>Diff % YoY</button>
                                            <button className="actionButton" onClick={(e) => openNormalizeModal(name, e)} title={`Normalize By...`} disabled={isTransforming}>Norm By...</button>
                                            <button className="actionButton actionButtonDelete" onClick={(e) => handleDelete(name, e)} title={`Delete ${name}`} disabled={isTransforming}>Del</button>
                                        </>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* --- Модальное окно для выбора знаменателя --- */}
            {showNormalizeModal && seriesToNormalize && internalData && (
                <div style={modalOverlayStyle} onClick={closeNormalizeModal}>
                    <div style={modalContentStyle} onClick={(e) => e.stopPropagation()}>
                        <button style={modalCloseButtonStyle} onClick={closeNormalizeModal} title="Close"> <CloseIcon /> </button>
                        <h5>Select Denominator for "{seriesToNormalize}"</h5>
                        <p style={{fontSize: '0.9em', color: '#666'}}>Click on the series name to use it as the denominator.</p>
                        <div style={normalizeGridStyle}>
                            {seriesOrder
                                .filter(name => name !== seriesToNormalize)
                                .map(denomName => (
                                    <div
                                        key={denomName}
                                        style={normalizePlaqueStyle} // Используем inline для простоты здесь
                                        onClick={() => handleSelectDenominator(denomName)}
                                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = normalizePlaqueHoverStyle.backgroundColor}
                                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = normalizePlaqueStyle.backgroundColor}
                                    >
                                        {denomName}
                                    </div>
                                ))
                            }
                            {seriesOrder.filter(name => name !== seriesToNormalize).length === 0 && ( <p>No other series available.</p> )}
                        </div>
                    </div>
                </div>
            )}
            {/* --- Конец модального окна --- */}

        </div> // Конец blockTwoContainer
    );
}

export default BlockTwoDataEnrichment;