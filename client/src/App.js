import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import axios from 'axios';

// Импортируем все компоненты блоков
import BlockOneDataImport from './components/BlockOneDataImport';
import BlockTwoDataEnrichment from './components/BlockTwoDataEnrichment';
import BlockThreeModeling from './components/BlockThreeModeling';
import TimeSeriesChart from './components/TimeSeriesChart';
import ModelDashboard from './components/ModelDashboard';

// --- Стили и иконка для кнопки Reset ---
const resetButtonStyleApp = { background: '#f8f9fa', border: '1px solid #ccc', borderRadius: '4px', width: '32px', height: '32px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: '0', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', color: '#343a40', marginLeft: '10px' };
const resetButtonStyleHoverApp = { backgroundColor: '#e2e6ea', borderColor: '#adb5bd', color: '#000' };
const HomeIconApp = ({ size = 18, color = "currentColor" }) => ( <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill={color} viewBox="0 0 16 16"> <path d="M8.354 1.146a.5.5 0 0 0-.708 0l-6 6A.5.5 0 0 0 1.5 7.5v7a.5.5 0 0 0 .5.5h4.5a.5.5 0 0 0 .5-.5v-4h2v4a.5.5 0 0 0 .5.5H14a.5.5 0 0 0 .5-.5v-7a.5.5 0 0 0-.146-.354L13 5.793V2.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v1.293L8.354 1.146zM2.5 14V7.707l5.5-5.5 5.5 5.5V14H10v-4a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5v4H2.5z"/> </svg> );
const chartControlsContainerStyle = { paddingTop: '10px', textAlign: 'left', fontSize: '0.85em', color: '#555', flexShrink: 0 };

function App() {
  // --- Основные состояния данных по блокам ---
  const [backendMessage, setBackendMessage] = useState('Connecting to backend...');
  const [viewingSeries, setViewingSeries] = useState(null);
  const [processedData, setProcessedData] = useState(null);
  const [enrichedData, setEnrichedData] = useState(null);
  const [dataForModeling, setDataForModeling] = useState(null);

  // --- Состояния для управления процессом моделирования (Блок 3) ---
  const [activeJobId, setActiveJobId] = useState(null);
  const [estimatedRunsForJob, setEstimatedRunsForJob] = useState(0);
  const [modelProgressData, setModelProgressData] = useState(null);
  const [pollingError, setPollingError] = useState(null);

  // --- Ref'ы ---
  const chartRefApp = useRef(null);
  const pollingIntervalRef = useRef(null);

  // --- Состояние UI ---
  const [isResetHoveredApp, setIsResetHoveredApp] = useState(false);

  // <<< ДОБАВЛЕН ЛОГ В НАЧАЛЕ КОМПОНЕНТА >>>
  console.log('[App Render] State:', { activeJobId, modelProgressData: !!modelProgressData, pollingError });

  // --- Эффекты жизненного цикла ---

  // 1. Проверка связи с бэкендом
  useEffect(() => {
    axios.get('http://localhost:5001/api/test')
      .then(response => setBackendMessage(response.data.message))
      .catch(error => {
        setBackendMessage('Error connecting to backend.');
        console.error("Backend connection error:", error);
      });
  }, []);

  // 2. Сброс состояния при изменении enrichedData
  useEffect(() => {
    // console.log("[App useEffect] Enriched data changed, resetting modeling state.");
    setDataForModeling(null);
    setActiveJobId(null);
    setEstimatedRunsForJob(0);
    setModelProgressData(null);
    setPollingError(null);
  }, [enrichedData]);

  // --- Логика Опроса Прогресса Моделирования ---
  const pollProgress = useCallback(async (jobId) => {
      if (!jobId) return;
      // console.log(`[App pollProgress] Polling for jobId: ${jobId}`);
      try {
          const response = await axios.get(`http://localhost:5001/api/search_progress/${jobId}`);
          // console.log(`[App pollProgress] Received progress data for ${jobId}:`, response.data);
          setModelProgressData(response.data);
          setPollingError(null);
          const status = response.data?.status;
          if (status === 'finished' || status === 'stopped' || status === 'error') {
              console.log(`[App pollProgress] Job ${jobId} status is ${status}. Stopping polling.`);
              if (pollingIntervalRef.current) {
                  clearInterval(pollingIntervalRef.current);
                  pollingIntervalRef.current = null;
              }
          }
      } catch (error) {
          console.error(`[App pollProgress] Error polling progress for job ${jobId}:`, error);
          setPollingError(`Polling failed: ${error.response?.data?.error || error.message}`);
          // <<< ИЗМЕНЕНИЕ: Возвращаем сброс данных при ошибке опроса >>>
          setModelProgressData(null);
          console.log(`[App pollProgress] Setting pollingError and resetting modelProgressData.`);
      }
  }, []); // Пустой массив зависимостей

  // 3. Запуск/остановка интервального опроса
  useEffect(() => {
      if (activeJobId) {
          // console.log(`[App useEffect Polling] Starting polling for job ${activeJobId}`);
          if (pollingIntervalRef.current) { clearInterval(pollingIntervalRef.current); }
          pollProgress(activeJobId);
          pollingIntervalRef.current = setInterval(() => { pollProgress(activeJobId); }, 2000);
      } else {
          if (pollingIntervalRef.current) {
              // console.log("[App useEffect Polling] Stopping polling because activeJobId is null.");
              clearInterval(pollingIntervalRef.current);
              pollingIntervalRef.current = null;
          }
      }
      return () => {
          if (pollingIntervalRef.current) {
              // console.log("[App useEffect Polling Cleanup] Clearing interval.");
              clearInterval(pollingIntervalRef.current);
              pollingIntervalRef.current = null;
          }
      };
  }, [activeJobId, pollProgress]);

  // --- Обработчики и Callback'и ---
  const handleJobStateChange = useCallback((jobId, estimatedRuns) => {
      // console.log(`[App handleJobStateChange] Job state changed: Job ID = ${jobId}, Estimated Runs = ${estimatedRuns}`);
      setActiveJobId(jobId);
      setEstimatedRunsForJob(estimatedRuns);
      setModelProgressData(null);
      setPollingError(null);
  }, []);

  const handleResetZoomApp = () => {
      if (chartRefApp.current) { chartRefApp.current.resetZoom(); }
  };

  const currentResetButtonStyleApp = { ...resetButtonStyleApp, ...(isResetHoveredApp ? resetButtonStyleHoverApp : {}) };

  // --- Рендер Компонента ---
  return (
    <div className="App">

      {/* ==================== ЛЕВАЯ ПАНЕЛЬ ==================== */}
      <div className="left-pane">
         <h2>Controls</h2>
         <p style={{ flexShrink: 0 }}><strong>Backend Status:</strong> {backendMessage}</p>
         <hr/>
         <div style={{ flexShrink: 0 }}>
           <BlockOneDataImport setViewingSeries={setViewingSeries} setProcessedData={setProcessedData} />
         </div>
         <hr/>
         {processedData && (
             <div id="block2-controls" style={{ flexShrink: 0 }}>
                <BlockTwoDataEnrichment
                    processedData={processedData} setEnrichedData={setEnrichedData}
                    setViewingSeries={setViewingSeries} onSendDataToModeling={setDataForModeling}
                 />
             </div>
         )}
         {processedData && <hr/>}
         {enrichedData && (
             <div id="block3-controls" style={{ flexShrink: 0 }}>
                 <BlockThreeModeling
                     enrichedData={dataForModeling} onJobStateChange={handleJobStateChange}
                     activeJobId={activeJobId} progressData={modelProgressData}
                 />
             </div>
         )}
         <div style={{ flexGrow: 1 }}></div>
      </div>

      {/* ==================== ПРАВАЯ ПАНЕЛЬ ==================== */}
      <div className="right-pane">
        <h2>Visualization / Output</h2>
        {(activeJobId || modelProgressData) ? (
            <ModelDashboard
                progressData={modelProgressData}
                totalRuns={estimatedRunsForJob}
            />
        ) : (
            <div style={{ flexGrow: 1, minHeight: 0, border: '1px solid #eee', borderRadius: '4px', marginBottom: '10px' }}>
                 <TimeSeriesChart ref={chartRefApp} seriesData={viewingSeries} />
            </div>
        )}
        <div style={chartControlsContainerStyle}>
            {!activeJobId && viewingSeries && (
                <>
                    <span>Wheel/Select: Zoom, Shift+Drag: Pan</span>
                    <button onClick={handleResetZoomApp} style={currentResetButtonStyleApp}
                        onMouseEnter={() => setIsResetHoveredApp(true)} onMouseLeave={() => setIsResetHoveredApp(false)}
                        title="Reset Zoom/Pan" >
                        <HomeIconApp size={18} color={isResetHoveredApp ? '#000' : '#343a40'} />
                    </button>
                </>
            )}
             {pollingError && <span style={{ color: 'red', marginLeft: '15px', fontSize: '0.9em' }}>Polling Error: {pollingError}</span>}
        </div>
      </div>

    </div>
  );
}

export default App;