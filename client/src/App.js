import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import axios from 'axios';

// Импортируем все компоненты блоков
import BlockOneDataImport from './components/BlockOneDataImport';
import BlockTwoDataEnrichment from './components/BlockTwoDataEnrichment'; // Добавили импорт
// import BlockThreeModeling from './components/BlockThreeModeling'; // Задел на будущее
// import BlockFourResults from './components/BlockFourResults'; // Задел на будущее
import TimeSeriesChart from './components/TimeSeriesChart';

// --- Стили и иконка для кнопки Reset ---
const resetButtonStyleApp = { background: '#f8f9fa', border: '1px solid #ccc', borderRadius: '4px', width: '32px', height: '32px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: '0', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', color: '#343a40', marginLeft: '10px' };
const resetButtonStyleHoverApp = { backgroundColor: '#e2e6ea', borderColor: '#adb5bd', color: '#000' };
const HomeIconApp = ({ size = 18, color = "currentColor" }) => ( <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill={color} viewBox="0 0 16 16"> <path d="M8.354 1.146a.5.5 0 0 0-.708 0l-6 6A.5.5 0 0 0 1.5 7.5v7a.5.5 0 0 0 .5.5h4.5a.5.5 0 0 0 .5-.5v-4h2v4a.5.5 0 0 0 .5.5H14a.5.5 0 0 0 .5-.5v-7a.5.5 0 0 0-.146-.354L13 5.793V2.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v1.293L8.354 1.146zM2.5 14V7.707l5.5-5.5 5.5 5.5V14H10v-4a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5v4H2.5z"/> </svg> );
const chartControlsContainerStyle = { paddingTop: '10px', textAlign: 'left', fontSize: '0.85em', color: '#555', flexShrink: 0 /* Не сжимать контейнер управления */ };
// --- Конец стилей ---


function App() {
  // --- Состояния ---
  const [backendMessage, setBackendMessage] = useState('Connecting to backend...');
  // Данные для графика
  const [viewingSeries, setViewingSeries] = useState(null);
  // Данные после Блока 1 (агрегация) - передаются в Блок 2
  const [processedData, setProcessedData] = useState(null);
  // Данные после Блока 2 (обогащение) - передаются в Блок 3
  const [enrichedData, setEnrichedData] = useState(null);
  // Состояние hover для кнопки Reset
  const [isResetHoveredApp, setIsResetHoveredApp] = useState(false);
  // Ref для доступа к графику
  const chartRefApp = useRef(null);
  // --- Конец состояний ---

  // Проверка связи с бэкендом
  useEffect(() => {
    axios.get('http://localhost:5001/api/test')
      .then(response => setBackendMessage(response.data.message))
      .catch(error => { setBackendMessage('Error connecting to backend.'); console.error("Backend connection error:", error); });
  }, []);

  // Функция сброса зума
  const handleResetZoomApp = () => {
      if (chartRefApp.current) { chartRefApp.current.resetZoom(); }
  };

  // Динамический стиль кнопки Reset
  const currentResetButtonStyleApp = { ...resetButtonStyleApp, ...(isResetHoveredApp ? resetButtonStyleHoverApp : {}) };


  // --- Рендер Компонента ---
  return (
    <div className="App" style={{ display: 'flex', height: '100vh', fontFamily: 'sans-serif', overflow: 'hidden' }}>

      {/* === ЛЕВАЯ ПАНЕЛЬ === */}
      <div className="left-pane" style={{ width: '45%', borderRight: '1px solid #ccc', padding: '15px', boxSizing: 'border-box', overflowY: 'auto', backgroundColor: '#f8f9fa', display: 'flex', flexDirection: 'column' }}>
         <h2 style={{ marginTop: '0', borderBottom: '1px solid #eee', paddingBottom: '10px', flexShrink: 0 }}>Controls</h2>
         <p style={{ flexShrink: 0 }}><strong>Backend Status:</strong> {backendMessage}</p>
         <hr style={{ border: 'none', borderTop: '1px solid #eee', margin: '15px 0', width: '100%', flexShrink: 0 }}/>

         {/* --- Блок 1: Импорт --- */}
         <div style={{ flexShrink: 0 }}>
           <BlockOneDataImport
                // Передаем функции обратного вызова для обновления состояний App
                setViewingSeries={setViewingSeries}
                setProcessedData={setProcessedData} // <<< Передаем эту функцию
            />
         </div>
         <hr style={{ border: 'none', borderTop: '1px solid #eee', margin: '15px 0', width: '100%', flexShrink: 0 }}/>

         {/* --- Блок 2: Обогащение --- */}
         {/* Показываем, только если есть данные после Блока 1 */}
         {processedData && (
             <div id="block2-controls" style={{ flexShrink: 0 }}>
                {/* Рендерим компонент Блока 2, передавая ему данные и функции */}
                <BlockTwoDataEnrichment
                    processedData={processedData}      // Данные из Блока 1
                    setEnrichedData={setEnrichedData} // Функция для обновления данных после обогащения
                    setViewingSeries={setViewingSeries} // Функция для показа графика из этого блока
                 />
             </div>
         )}
         {/* Разделитель показываем только если был Блок 2 */}
         {processedData && <hr style={{ border: 'none', borderTop: '1px solid #eee', margin: '15px 0', width: '100%', flexShrink: 0 }}/>}

         {/* --- Блок 3: Моделирование (Placeholder) --- */}
         {/* Показываем, только если есть данные после Блока 2 */}
         {enrichedData && (
             <div id="block3-controls" style={{ flexShrink: 0 }}>
                 <h4>3. Modeling</h4>
                 {/* <BlockThreeModeling enrichedData={enrichedData} ... /> */}
                 <p>(Block 3 Controls Placeholder)</p>
             </div>
         )}
         {enrichedData && <hr style={{ border: 'none', borderTop: '1px solid #eee', margin: '15px 0', width: '100%', flexShrink: 0 }}/>}


         {/* --- Блок 4: Результаты (Placeholder) --- */}
         {/* {modelResults && ( ... )} */}


         {/* Заполнитель пространства */}
         <div style={{ flexGrow: 1 }}></div>

      </div> {/* Конец Левой Панели */}


      {/* === ПРАВАЯ ПАНЕЛЬ === */}
      <div className="right-pane" style={{ width: '55%', padding: '15px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <h2 style={{ marginTop: '0', borderBottom: '1px solid #eee', paddingBottom: '10px', flexShrink: 0 }}>Visualization / Output</h2>

        {/* Контейнер для графика */}
        <div style={{ flexGrow: 1, overflow: 'hidden', position: 'relative' }}>
             {/* Передаем ref */}
             <TimeSeriesChart ref={chartRefApp} seriesData={viewingSeries} />
        </div>

        {/* Контейнер для элементов управления ПОД графиком */}
        <div style={chartControlsContainerStyle}>
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
        </div>

      </div> {/* Конец Правой Панели */}

    </div> // Конец App div
  );
}

export default App;