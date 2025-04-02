import React, { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import axios from 'axios';

// Импортируем все компоненты блоков
import BlockOneDataImport from './components/BlockOneDataImport';
import BlockTwoDataEnrichment from './components/BlockTwoDataEnrichment';
import BlockThreeModeling from './components/BlockThreeModeling';
// import BlockFourResults from './components/BlockFourResults'; // Задел на будущее
import TimeSeriesChart from './components/TimeSeriesChart';
// import ModelProgressVisualizer from './components/ModelProgressVisualizer'; // Больше не используется напрямую
import ModelDashboard from './components/ModelDashboard'; // <<< НОВЫЙ ИМПОРТ

// --- Стили и иконка для кнопки Reset ---
const resetButtonStyleApp = { background: '#f8f9fa', border: '1px solid #ccc', borderRadius: '4px', width: '32px', height: '32px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: '0', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', color: '#343a40', marginLeft: '10px' };
const resetButtonStyleHoverApp = { backgroundColor: '#e2e6ea', borderColor: '#adb5bd', color: '#000' };
const HomeIconApp = ({ size = 18, color = "currentColor" }) => ( <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill={color} viewBox="0 0 16 16"> <path d="M8.354 1.146a.5.5 0 0 0-.708 0l-6 6A.5.5 0 0 0 1.5 7.5v7a.5.5 0 0 0 .5.5h4.5a.5.5 0 0 0 .5-.5v-4h2v4a.5.5 0 0 0 .5.5H14a.5.5 0 0 0 .5-.5v-7a.5.5 0 0 0-.146-.354L13 5.793V2.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v1.293L8.354 1.146zM2.5 14V7.707l5.5-5.5 5.5 5.5V14H10v-4a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5v4H2.5z"/> </svg> );
const chartControlsContainerStyle = { paddingTop: '10px', textAlign: 'left', fontSize: '0.85em', color: '#555', flexShrink: 0 /* Не сжимать контейнер управления */ };
// --- Конец стилей ---


function App() {
  // --- Основные состояния данных по блокам ---
  const [backendMessage, setBackendMessage] = useState('Connecting to backend...');
  const [viewingSeries, setViewingSeries] = useState(null); // Данные для графика TimeSeriesChart
  const [processedData, setProcessedData] = useState(null); // Данные после Блока 1 (агрегация)
  const [enrichedData, setEnrichedData] = useState(null);   // Данные после Блока 2 (обогащение)
  const [dataForModeling, setDataForModeling] = useState(null); // Данные, выбранные в Блоке 2 для передачи в Блок 3

  // --- Состояния для управления процессом моделирования (Блок 3) ---
  const [activeJobId, setActiveJobId] = useState(null); // ID текущей запущенной задачи моделирования
  const [estimatedRunsForJob, setEstimatedRunsForJob] = useState(0); // Оценка кол-ва прогонов для текущей задачи
  const [modelProgressData, setModelProgressData] = useState(null); // Данные прогресса, получаемые с бэкенда
  const [pollingError, setPollingError] = useState(null); // Ошибка при опросе прогресса

  // --- Ref'ы ---
  const chartRefApp = useRef(null); // Ref для доступа к методам TimeSeriesChart (напр., resetZoom)
  const pollingIntervalRef = useRef(null); // Ref для хранения ID интервала опроса прогресса

  // --- Состояние UI ---
  const [isResetHoveredApp, setIsResetHoveredApp] = useState(false); // Для стиля кнопки Reset Zoom

  // --- Эффекты жизненного цикла ---

  // 1. Проверка связи с бэкендом при монтировании компонента
  useEffect(() => {
    axios.get('http://localhost:5001/api/test')
      .then(response => setBackendMessage(response.data.message))
      .catch(error => {
        setBackendMessage('Error connecting to backend.');
        console.error("Backend connection error:", error);
      });
  }, []); // Пустой массив зависимостей - выполняется один раз при монтировании

  // 2. Сброс данных для моделирования и состояния задачи при изменении обогащенных данных
  useEffect(() => {
    // Если enrichedData изменились (например, после действий в Блоке 2),
    // то предыдущая задача моделирования (если она была) становится неактуальной.
    console.log("Enriched data changed, resetting data for modeling and job state.");
    setDataForModeling(null); // Сбрасываем данные, которые были выбраны для моделирования
    setActiveJobId(null);     // Сбрасываем ID активной задачи
    setEstimatedRunsForJob(0); // Сбрасываем оценку прогонов
    setModelProgressData(null); // Сбрасываем данные прогресса
    setPollingError(null);    // Сбрасываем ошибку опроса

    // Останавливаем опрос, если он был активен
    if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
        console.log("Polling stopped due to enriched data change.");
    }
  }, [enrichedData]); // Зависимость от enrichedData

  // --- Логика Опроса Прогресса Моделирования ---

  // Функция для выполнения одного запроса на получение прогресса
  const pollProgress = useCallback(async (jobId) => {
      if (!jobId) return; // Не делаем запрос, если нет ID задачи
      // console.log(`Polling progress for job: ${jobId}`); // Раскомментировать для отладки
      try {
          const response = await axios.get(`http://localhost:5001/api/search_progress/${jobId}`);
          setModelProgressData(response.data); // Обновляем состояние с данными прогресса
          setPollingError(null); // Сбрасываем ошибку при успешном запросе

          // Проверяем статус задачи из ответа
          const status = response.data?.status;
          if (status === 'finished' || status === 'stopped' || status === 'error') {
              // Если задача завершена, остановлена или завершилась с ошибкой, прекращаем опрос
              console.log(`Job ${jobId} status is ${status}. Stopping polling.`);
              if (pollingIntervalRef.current) {
                  clearInterval(pollingIntervalRef.current);
                  pollingIntervalRef.current = null;
              }
              // Не сбрасываем activeJobId здесь, чтобы UI мог показать финальный статус
          }
      } catch (error) {
          console.error(`Error polling progress for job ${jobId}:`, error);
          // Устанавливаем сообщение об ошибке опроса
          setPollingError(`Polling failed: ${error.response?.data?.error || error.message}`);
          // Важно: Не останавливаем опрос при ошибке сети, чтобы приложение могло
          // автоматически возобновить получение данных при восстановлении связи.
          // Можно добавить логику остановки после N неудачных попыток, если нужно.
      }
  }, []); // useCallback, т.к. функция используется в useEffect и не должна меняться без необходимости

  // 3. Запуск/остановка интервального опроса при изменении activeJobId
  useEffect(() => {
      // Если появился активный ID задачи
      if (activeJobId) {
          console.log(`Starting polling for job ${activeJobId}`);
          // Очищаем предыдущий интервал (на случай, если он остался от предыдущей задачи)
          if (pollingIntervalRef.current) {
              clearInterval(pollingIntervalRef.current);
          }
          // Выполняем первый запрос немедленно, чтобы получить начальное состояние
          pollProgress(activeJobId);
          // Устанавливаем интервал для последующих запросов
          pollingIntervalRef.current = setInterval(() => {
              pollProgress(activeJobId);
          }, 2000); // Опрашиваем каждые 2 секунды
      } else {
          // Если activeJobId стал null (задача завершена, сброшена и т.д.)
          if (pollingIntervalRef.current) {
              console.log("Stopping polling because activeJobId is null.");
              clearInterval(pollingIntervalRef.current);
              pollingIntervalRef.current = null;
          }
      }

      // Функция очистки: будет вызвана при размонтировании компонента App
      // или перед следующим запуском этого useEffect (т.е. при изменении activeJobId)
      return () => {
          if (pollingIntervalRef.current) {
              // console.log("Clearing polling interval on cleanup."); // Отладка
              clearInterval(pollingIntervalRef.current);
              pollingIntervalRef.current = null;
          }
      };
  }, [activeJobId, pollProgress]); // Зависимости: ID задачи и сама функция опроса

  // --- Обработчики и Callback'и ---

  // Callback-функция, передаваемая в BlockThreeModeling.
  // Вызывается, когда пользователь запускает новую задачу моделирования.
  const handleJobStateChange = useCallback((jobId, estimatedRuns) => {
      console.log(`Job state changed via callback: Job ID = ${jobId}, Estimated Runs = ${estimatedRuns}`);
      setActiveJobId(jobId); // Устанавливаем новый ID (это запустит useEffect для опроса)
      setEstimatedRunsForJob(estimatedRuns); // Сохраняем оценку количества прогонов
      setModelProgressData(null); // Сбрасываем данные прогресса от предыдущей задачи
      setPollingError(null); // Сбрасываем ошибку опроса
  }, []); // useCallback, чтобы ссылка на функцию не менялась при каждом рендере App

  // Обработчик для кнопки сброса зума на графике
  const handleResetZoomApp = () => {
      if (chartRefApp.current) {
          chartRefApp.current.resetZoom();
      }
  };

  // Динамический стиль для кнопки Reset Zoom
  const currentResetButtonStyleApp = { ...resetButtonStyleApp, ...(isResetHoveredApp ? resetButtonStyleHoverApp : {}) };

  // --- Рендер Компонента ---
  return (
    <div className="App" style={{ display: 'flex', height: '100vh', fontFamily: 'sans-serif', overflow: 'hidden' }}>

      {/* ==================== ЛЕВАЯ ПАНЕЛЬ ==================== */}
      <div className="left-pane" style={{ width: '45%', borderRight: '1px solid #ccc', padding: '15px', boxSizing: 'border-box', overflowY: 'auto', backgroundColor: '#f8f9fa', display: 'flex', flexDirection: 'column' }}>
         {/* Заголовок и статус бэкенда */}
         <h2 style={{ marginTop: '0', borderBottom: '1px solid #eee', paddingBottom: '10px', flexShrink: 0 }}>Controls</h2>
         <p style={{ flexShrink: 0 }}><strong>Backend Status:</strong> {backendMessage}</p>
         <hr style={{ border: 'none', borderTop: '1px solid #eee', margin: '15px 0', width: '100%', flexShrink: 0 }}/>

         {/* --- Блок 1: Импорт Данных --- */}
         <div style={{ flexShrink: 0 }}>
           <BlockOneDataImport
                setViewingSeries={setViewingSeries} // Передаем функцию для обновления графика
                setProcessedData={setProcessedData} // Передаем функцию для обновления данных после Блока 1
            />
         </div>
         <hr style={{ border: 'none', borderTop: '1px solid #eee', margin: '15px 0', width: '100%', flexShrink: 0 }}/>

         {/* --- Блок 2: Обогащение Данных --- */}
         {/* Показываем Блок 2 только если есть данные после Блока 1 */}
         {processedData && (
             <div id="block2-controls" style={{ flexShrink: 0 }}>
                <BlockTwoDataEnrichment
                    processedData={processedData}      // Данные из Блока 1
                    setEnrichedData={setEnrichedData} // Функция для обновления данных после обогащения
                    setViewingSeries={setViewingSeries} // Функция для показа графика из этого блока
                    onSendDataToModeling={setDataForModeling} // Функция для передачи выбранных данных в Блок 3
                 />
             </div>
         )}
         {/* Разделитель после Блока 2 */}
         {processedData && <hr style={{ border: 'none', borderTop: '1px solid #eee', margin: '15px 0', width: '100%', flexShrink: 0 }}/>}

         {/* --- Блок 3: Моделирование --- */}
         {/* Показываем Блок 3 только если есть данные, выбранные для моделирования */}
         {enrichedData && ( // Используем enrichedData как условие рендера блока настроек
             <div id="block3-controls" style={{ flexShrink: 0 }}>
                 <BlockThreeModeling
                     enrichedData={dataForModeling} // Передаем данные, выбранные в Блоке 2
                     // Передаем callback для обновления состояния задачи в App при запуске
                     onJobStateChange={handleJobStateChange}
                     // Передаем текущий ID задачи и данные прогресса обратно в Block3,
                     // чтобы он мог корректно отображать и управлять кнопками Pause/Stop/Run
                     activeJobId={activeJobId}
                     progressData={modelProgressData}
                 />
             </div>
         )}
         {/* Убрали разделитель после Блока 3 */}

         {/* --- Блок 4: Результаты (Placeholder) --- */}
         {/* {modelResults && ( ... )} */}


         {/* Заполнитель, чтобы контент прижимался к верху */}
         <div style={{ flexGrow: 1 }}></div>

      </div> {/* Конец Левой Панели */}


      {/* ==================== ПРАВАЯ ПАНЕЛЬ ==================== */}
      <div className="right-pane" style={{ width: '55%', padding: '15px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Заголовок правой панели */}
        <h2 style={{ marginTop: '0', borderBottom: '1px solid #eee', paddingBottom: '10px', flexShrink: 0 }}>Visualization / Output</h2>

        {/* Основной контент правой панели (График или Дашборд Моделей) */}
        {/* <<< ИЗМЕНЕНИЕ ЗДЕСЬ: Условный рендеринг ModelDashboard или TimeSeriesChart >>> */}
        <div style={{ flexGrow: 1, overflow: 'hidden', position: 'relative', border: '1px solid #eee', borderRadius: '4px', marginBottom: '10px' }}>
             {/* Если есть активная задача или данные прогресса (даже для завершенной задачи), показываем дашборд */}
             {activeJobId || modelProgressData ? (
                 <ModelDashboard
                     progressData={modelProgressData} // Передаем актуальные данные прогресса
                     totalRuns={estimatedRunsForJob} // Передаем оценку общего числа прогонов
                 />
             ) : (
                 // Иначе (нет активной задачи и нет данных прогресса), показываем график временных рядов
                 <TimeSeriesChart ref={chartRefApp} seriesData={viewingSeries} />
             )}
        </div>

        {/* Контейнер для элементов управления ПОД графиком/дашбордом */}
        <div style={chartControlsContainerStyle}>
            {/* Показываем управление зумом только если НЕТ активной задачи И есть данные для графика */}
            {!activeJobId && viewingSeries && (
                <>
                    <span>Wheel/Select: Zoom, Shift+Drag: Pan</span>
                    <button
                        onClick={handleResetZoomApp}
                        style={currentResetButtonStyleApp}
                        onMouseEnter={() => setIsResetHoveredApp(true)}
                        onMouseLeave={() => setIsResetHoveredApp(false)}
                        title="Reset Zoom/Pan"
                    >
                        <HomeIconApp size={18} color={isResetHoveredApp ? '#000' : '#343a40'} />
                    </button>
                </>
            )}
             {/* Отображение ошибки опроса прогресса, если она есть */}
             {pollingError && <span style={{ color: 'red', marginLeft: '15px', fontSize: '0.9em' }}>Polling Error: {pollingError}</span>}
        </div>

      </div> {/* Конец Правой Панели */}

    </div> // Конец App div
  );
}

export default App;