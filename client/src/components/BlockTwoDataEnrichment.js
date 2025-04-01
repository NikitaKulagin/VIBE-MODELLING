import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './BlockTwoDataEnrichment.css'; // Убедитесь, что CSS импортирован и обновлен

// --- Иконки ---
const PencilIcon = ({ size = 14, color = "currentColor" }) => ( <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill={color} viewBox="0 0 16 16"> <path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708l-3-3zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207l6.5-6.5zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11l.178-.178z"/> </svg> );
const CloseIcon = ({ size = 16, color = "#6c757d" }) => ( <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill={color} viewBox="0 0 16 16"> <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z"/> </svg> );
const CheckIcon = () => <span style={{ color: '#28a745', fontWeight: 'bold' }}>✔</span>;
const ExcludeIcon = () => <span style={{ color: '#dc3545', fontWeight: 'bold' }}>ø</span>;
// --- Конец иконок ---

// Стили модального окна
const modalOverlayStyle = { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0, 0, 0, 0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
const modalContentStyle = { background: 'white', padding: '20px 30px', borderRadius: '8px', minWidth: '400px', maxWidth: '80%', maxHeight: '80vh', overflowY: 'auto', position: 'relative' };
const modalCloseButtonStyle = { position: 'absolute', top: '10px', right: '10px', background: 'none', border: 'none', fontSize: '1.2em', cursor: 'pointer', padding: '5px' };
const normalizeGridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '8px', marginTop: '15px', maxHeight: '60vh', overflowY: 'auto' };
const normalizePlaqueStyle = { border: '1px solid #ccc', padding: '8px', borderRadius: '4px', cursor: 'pointer', textAlign: 'center', fontSize: '0.85em', backgroundColor: '#f8f9fa', transition: 'background-color 0.2s ease' };
const normalizePlaqueHoverStyle = { backgroundColor: '#e2e6ea' };


// --- Принимаем новый пропс onSendDataToModeling ---
function BlockTwoDataEnrichment({ processedData, setEnrichedData, setViewingSeries, viewingSeries, onSendDataToModeling }) {
    // --- Состояния ---
    const [internalData, setInternalData] = useState(null);
    const [seriesOrder, setSeriesOrder] = useState([]);
    const [editingName, setEditingName] = useState(null);
    const [tempName, setTempName] = useState('');
    const inputRef = useRef(null);
    const [isTransforming, setIsTransforming] = useState(null);
    const [transformError, setTransformError] = useState(null);
    const [showNormalizeModal, setShowNormalizeModal] = useState(false);
    const [seriesToNormalize, setSeriesToNormalize] = useState(null);
    const [selectedForModeling, setSelectedForModeling] = useState(new Set());
    // --- Конец состояний ---

    // --- Функции ---
    useEffect(() => {
        console.log("Block 2 received processedData:", processedData);
        let initialInternalData = null;
        let initialOrder = [];
        if (processedData && typeof processedData === 'object' && !Array.isArray(processedData)) {
             try {
                 initialInternalData = {};
                 initialOrder = Object.keys(processedData);
                 initialOrder.forEach(key => {
                     initialInternalData[key] = {
                         ...JSON.parse(JSON.stringify(processedData[key])),
                         isSynthetic: processedData[key].isSynthetic || false
                     };
                 });
                 setInternalData(initialInternalData);
                 setSeriesOrder(initialOrder);
                 setSelectedForModeling(new Set(initialOrder)); // Выбираем все по умолчанию
                 if (setEnrichedData) { setEnrichedData(initialInternalData); }
             } catch (e) {
                 setInternalData(null); setSeriesOrder([]); setSelectedForModeling(new Set());
                 if (setEnrichedData) { setEnrichedData(null); }
                 console.error("Failed copy in Block 2:", e);
             }
        } else {
             setInternalData(null); setSeriesOrder([]); setSelectedForModeling(new Set());
             if (setEnrichedData) { setEnrichedData(null); }
        }
        setEditingName(null); setTransformError(null);
    }, [processedData, setEnrichedData]);

    useEffect(() => { if (editingName && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [editingName]);

    const handleModelingSelectionToggle = (seriesName, event) => {
        event.stopPropagation();
        setSelectedForModeling(prev => {
            const newSet = new Set(prev);
            if (newSet.has(seriesName)) { newSet.delete(seriesName); } else { newSet.add(seriesName); }
            console.log("Selected for modeling:", Array.from(newSet));
            return newSet;
        });
    };

    // --- ДОБАВЛЕННЫЕ ОБРАБОТЧИКИ ---
    const handleSelectAllForModeling = () => {
        if (!seriesOrder) return;
        setSelectedForModeling(new Set(seriesOrder));
    };

    const handleUnselectAllForModeling = () => {
        setSelectedForModeling(new Set());
    };

    const handleSendDataClick = () => {
        if (!internalData || selectedForModeling.size === 0) {
            alert("Please select at least one series for modeling.");
            return;
        }
        const dataToSend = {};
        selectedForModeling.forEach(name => {
            if (internalData[name]) {
                // Копируем объект, чтобы избежать мутаций
                dataToSend[name] = { ...internalData[name] };
            }
        });
        console.log("Sending data to modeling:", dataToSend);
        if (onSendDataToModeling) {
            onSendDataToModeling(dataToSend); // Вызываем колбэк для App.js
        } else {
            console.warn("onSendDataToModeling prop not provided to BlockTwoDataEnrichment");
        }
    };
    // ---

    const startEditing = (seriesName, event) => { if(event) event.stopPropagation(); setEditingName(seriesName); setTempName(seriesName); };
    const cancelEditing = () => { setEditingName(null); };
    const saveRename = (oldName) => {
        if (!internalData || !oldName || !tempName || oldName === tempName) { cancelEditing(); return; }
        const newName = tempName.trim();
        if (!newName) { alert("Series name cannot be empty."); return; }
        if (internalData[newName]) { alert(`Series name "${newName}" already exists.`); setTempName(oldName); return; }

        const updatedData = { ...internalData };
        updatedData[newName] = { ...updatedData[oldName], name: newName };
        delete updatedData[oldName];
        const updatedOrder = seriesOrder.map(name => (name === oldName ? newName : name));

        setInternalData(updatedData); setSeriesOrder(updatedOrder); setEditingName(null);
        setSelectedForModeling(prev => {
            const newSet = new Set(prev);
            if (newSet.has(oldName)) { newSet.delete(oldName); newSet.add(newName); }
            return newSet;
        });
        if (setEnrichedData) { setEnrichedData(updatedData); }
        if (viewingSeries && viewingSeries.name === oldName && setViewingSeries) { setViewingSeries(updatedData[newName]); }
        console.log(`Renamed "${oldName}" to "${newName}"`);
     };
    const handleInputKeyDown = (event, oldName) => { if (event.key === 'Enter') { saveRename(oldName); } else if (event.key === 'Escape') { cancelEditing(); } };
    const handleDelete = (seriesName, event) => {
        event.stopPropagation();
        if (!internalData || !internalData[seriesName]) return;
        if (window.confirm(`Are you sure you want to delete the series "${seriesName}"?`)) {
            const updatedData = { ...internalData };
            delete updatedData[seriesName];
            const updatedOrder = seriesOrder.filter(name => name !== seriesName);

            setInternalData(updatedData); setSeriesOrder(updatedOrder);
            setSelectedForModeling(prev => {
                const newSet = new Set(prev);
                newSet.delete(seriesName);
                return newSet;
            });
            if (setEnrichedData) { setEnrichedData(updatedData); }
            if (viewingSeries && viewingSeries.name === seriesName && setViewingSeries) { setViewingSeries(null); }
            console.log(`Deleted series: ${seriesName}`);
        }
     };
    const handlePlaqueClick = (seriesName) => { if (editingName === seriesName) return; if (setViewingSeries && internalData && internalData[seriesName]) { setViewingSeries(internalData[seriesName]); } };

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
                setSelectedForModeling(prev => new Set(prev).add(newSeriesName)); // Выбираем новый ряд
                if (setEnrichedData) { setEnrichedData(updatedData); } console.log(`Created new series: ${newSeriesName}`);
            } else { throw new Error(response.data?.error || "Invalid data structure received."); }
        } catch (err) { console.error(`Error applying ${operation} to ${seriesName}:`, err); setTransformError(err.response?.data?.error || err.message || `Failed to apply ${operation}.`); }
        finally { setIsTransforming(null); }
    };

    const getYoYPeriod = (frequency) => {
        const freqUpper = frequency?.toUpperCase();
        if (freqUpper === 'M') return 12; if (freqUpper === 'Q') return 4; if (freqUpper === 'A' || freqUpper === 'Y') return 1; return 1;
    };

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
        event.stopPropagation(); if (!internalData || !seriesOrder || seriesOrder.length < 2) { alert("Need at least two series to normalize."); return; }
        setSeriesToNormalize(seriesName); setShowNormalizeModal(true); setTransformError(null);
    };
    const closeNormalizeModal = () => { setShowNormalizeModal(false); setSeriesToNormalize(null); };
    const handleSelectDenominator = (denominatorName) => {
        if (seriesToNormalize && denominatorName && internalData[denominatorName]) { applyTransformation('normalize', seriesToNormalize, { denominatorName: denominatorName, denominatorData: internalData[denominatorName].data }); }
        else { console.error("Error selecting denominator:", denominatorName); setTransformError("Failed to select denominator."); }
        closeNormalizeModal();
    };
    // --- Конец функций ---

    const seriesCount = seriesOrder.length;

    // --- JSX ---
    return (
        <div className="blockTwoContainer">
            <h4>2. Data Enrichment & Transformation</h4>
            {transformError && <p className="error-text">{transformError}</p>}
            {(!internalData || seriesCount === 0) && ( <p className="noDataMessage"> {processedData === null ? "Waiting for data from Block 1..." : "No series data available..."} </p> )}

            {/* --- ДОБАВЛЕННЫЕ КНОПКИ Select All / Unselect All --- */}
            {internalData && seriesCount > 0 && (
                <div className="select-all-controls">
                    <button onClick={handleSelectAllForModeling} className="select-all-button">Select All for Modeling</button>
                    <button onClick={handleUnselectAllForModeling} className="select-all-button">Unselect All</button>
                </div>
            )}
            {/* --- */}

            {/* Список рядов */}
            {internalData && seriesCount > 0 && (
                <div className="seriesListContainer">
                    {seriesOrder.map(name => {
                        const series = internalData[name];
                        if (!series) return null;
                        const isEditingThis = editingName === name;
                        const isLoadingThis = isTransforming === name;
                        const isSelectedForModeling = selectedForModeling.has(name);
                        const plaqueClassName = `seriesPlaqueTwo ${isSelectedForModeling ? '' : 'series-plaque-unselected'}`;
                        const toggleModelingButtonClassName = `b2-series-toggle-button ${isSelectedForModeling ? 'b2-series-toggle-button-selected' : 'b2-series-toggle-button-unselected'}`;

                        return (
                            <div key={name} className={plaqueClassName} onClick={() => handlePlaqueClick(name)} >
                                <button
                                    className={toggleModelingButtonClassName}
                                    onClick={(e) => handleModelingSelectionToggle(name, e)}
                                    title={isSelectedForModeling ? 'Exclude from Modeling' : 'Include in Modeling'}
                                    disabled={isLoadingThis}
                                >
                                    {isSelectedForModeling ? <CheckIcon /> : <ExcludeIcon />}
                                </button>
                                <button className="renameIconButton" onClick={(e) => startEditing(name, e)} title={`Rename ${name}`} disabled={isLoadingThis}> <PencilIcon /> </button>
                                <div className="seriesNameContainer">
                                    {isEditingThis ? (
                                        <input
                                            ref={inputRef} type="text" value={tempName}
                                            onChange={(e) => setTempName(e.target.value)}
                                            onBlur={() => saveRename(name)}
                                            onKeyDown={(e) => handleInputKeyDown(e, name)}
                                            className="editingInput" onClick={(e) => e.stopPropagation()}
                                        />
                                    ) : (
                                        <>
                                            <span className="seriesNameSpan" onDoubleClick={(e) => startEditing(name, e)} title={series.metadata?.Description || name}>
                                                {name}
                                            </span>
                                            {series.isSynthetic && ( <span className="syntheticTag" title="Synthetic Series">S</span> )}
                                        </>
                                    )}
                                </div>
                                <div className="actionButtonsContainer">
                                    {isLoadingThis ? ( <span style={{ fontStyle: 'italic', fontSize: '0.8em' }}>Processing...</span> )
                                    : ( <>
                                            <button className="actionButton" onClick={(e) => handleDiffAbs(name, e)} title={`Calculate Absolute YoY Difference (Period: ${getYoYPeriod(series.frequency)})`} disabled={isTransforming}>Diff Abs YoY</button>
                                            <button className="actionButton" onClick={(e) => handleDiffPct(name, e)} title={`Calculate Percentage YoY Difference (Period: ${getYoYPeriod(series.frequency)})`} disabled={isTransforming}>Diff % YoY</button>
                                            <button className="actionButton" onClick={(e) => openNormalizeModal(name, e)} title={`Normalize By...`} disabled={isTransforming || seriesCount < 2}>Norm By...</button>
                                            <button className="actionButton actionButtonDelete" onClick={(e) => handleDelete(name, e)} title={`Delete ${name}`} disabled={isTransforming}>Del</button>
                                        </>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Модальное окно для выбора знаменателя */}
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
                                        key={denomName} style={normalizePlaqueStyle}
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
            {/* Конец модального окна */}


            {/* Счетчик отобранных рядов */}
            {internalData && seriesCount > 0 && (
                <div className="selectedCountDisplay">
                    Selected for Modeling: {selectedForModeling.size} series
                </div>
            )}
            {/* Конец счетчика */}

            {/* --- ДОБАВЛЕННАЯ КНОПКА "Отправить в модуль моделирования" --- */}
            {internalData && seriesCount > 0 && (
                 <button
                    className="send-to-modeling-button"
                    onClick={handleSendDataClick}
                    disabled={selectedForModeling.size === 0} // Блокируем, если ничего не выбрано
                 >
                    Prepare Data for Modeling ({selectedForModeling.size})
                 </button>
            )}
            {/* --- */}

        </div> // Конец blockTwoContainer
    );
}

export default BlockTwoDataEnrichment;