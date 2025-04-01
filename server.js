// -----------------------------------------------------------------------------
// REQUIRED MODULES
// -----------------------------------------------------------------------------
const express = require('express');
const cors = require('cors');
const path = require('path');
const { spawn } = require('child_process'); // For running Python script
const fs = require('fs');                 // For file system operations (like deleting temp file)
const multer = require('multer');         // For handling file uploads
// --- ИСПРАВЛЕННЫЙ ИМПОРТ itertools ---
const { combinations, product } = require('itertools'); // Установите: npm install itertools

// -----------------------------------------------------------------------------
// EXPRESS APP INITIALIZATION & CONFIGURATION
// -----------------------------------------------------------------------------
const app = express();
const port = 5001; // Port for the backend server

app.use(cors()); // Allow requests from the frontend (React app)
// Увеличиваем лимиты для обработки потенциально больших данных в JSON и URL-encoded формах
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// -----------------------------------------------------------------------------
// MULTER CONFIGURATION (for File Uploads)
// -----------------------------------------------------------------------------
const uploadDir = 'uploads/';
if (!fs.existsSync(uploadDir)){
    try {
      fs.mkdirSync(uploadDir);
      console.log(`Created directory: ${uploadDir}`);
    } catch (err) {
      console.error(`Error creating directory ${uploadDir}:`, err);
      process.exit(1); // Выход, если не удалось создать папку для загрузок
    }
} else {
    console.log(`Directory already exists: ${uploadDir}`);
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, uploadDir); },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// -----------------------------------------------------------------------------
// HELPER FUNCTION FOR RUNNING PYTHON SCRIPTS
// -----------------------------------------------------------------------------
function runPythonScript(scriptPath, args = [], inputData = null) {
    return new Promise((resolve, reject) => {
        console.log(`Running Python script: ${path.basename(scriptPath)} with args: [${args.join(', ')}]`);
        const pythonProcess = spawn('python', [scriptPath, ...args]);

        let scriptOutput = '';
        let errorOutput = '';
        pythonProcess.stdout.on('data', (data) => scriptOutput += data.toString());
        pythonProcess.stderr.on('data', (data) => { errorOutput += data.toString(); console.error(`${path.basename(scriptPath)} stderr: ${data.toString().trim()}`); });

        pythonProcess.on('close', (code) => {
            console.log(`${path.basename(scriptPath)} finished with code ${code}`);
            if (code !== 0) {
                console.error(`${path.basename(scriptPath)} exited with error code ${code}. Stderr: ${errorOutput}`);
                try { if (errorOutput) { const structuredError = JSON.parse(errorOutput); if (structuredError.error) return reject(new Error(`Script error (${path.basename(scriptPath)}): ${structuredError.error}`)); } } catch (e) { /* ignore */ }
                reject(new Error(`Script failed (${path.basename(scriptPath)}, code ${code}). Check logs.`));
            } else {
                try {
                    if (!scriptOutput && errorOutput.includes("DEBUG:")) {
                       console.warn(`${path.basename(scriptPath)} succeeded but produced no JSON output (only DEBUG logs in stderr).`);
                       return resolve({ warning: `Script ${path.basename(scriptPath)} produced no primary output.`, data: null });
                    }
                    if (!scriptOutput) {
                         return resolve({ warning: `Script ${path.basename(scriptPath)} produced no output.`, data: null });
                    }
                    const result = JSON.parse(scriptOutput);
                    resolve(result);
                } catch (e) {
                    console.error(`Error parsing ${path.basename(scriptPath)} output JSON:`, e, `Raw output: ${scriptOutput}`);
                    reject(new Error(`Failed to parse script output (${path.basename(scriptPath)}).`));
                }
            }
        });

        pythonProcess.on('error', (spawnError) => {
             console.error(`Failed to start ${path.basename(scriptPath)} script:`, spawnError);
             reject(new Error(`Failed to start script process (${path.basename(scriptPath)}).`));
        });

        if (inputData !== null) {
            try {
                const inputString = JSON.stringify(inputData);
                const logPayload = inputString.length > 500 ? inputString.substring(0, 500) + '...' : inputString;
                console.log(`Sending payload to ${path.basename(scriptPath)} stdin: ${logPayload}`);
                pythonProcess.stdin.write(inputString);
                pythonProcess.stdin.end();
                console.log("Payload sent to stdin.");
            } catch (e) {
                console.error(`Error stringifying/sending payload to ${path.basename(scriptPath)}:`, e);
                pythonProcess.kill();
                reject(new Error(`Failed to send data to script (${path.basename(scriptPath)}).`));
            }
        }
    });
}

// --- Хранилище активных задач (в памяти) ---
const activeJobs = {}; // { jobId: { status: 'running' | 'paused' | 'stopped' | 'finished', config: {}, results: {}, startTime: Date, /* ... */ } }
// ---

// --- Вспомогательная функция для сна ---
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// -----------------------------------------------------------------------------
// API ROUTES
// -----------------------------------------------------------------------------

// --- Test Route ---
app.get('/api/test', (req, res) => {
    console.log("GET /api/test received");
    res.json({ message: 'Backend is running!' });
});

// --- Get Sheet Names Route ---
app.post('/api/get_sheet_names', upload.single('excelFile'), async (req, res) => {
    console.log("POST /api/get_sheet_names received");
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
    const scriptPath = path.join(__dirname, 'python_scripts', 'get_sheets.py');
    const filePath = req.file.path;
    try {
        const result = await runPythonScript(scriptPath, [filePath]);
        if (Array.isArray(result)) {
             console.log("get_sheets.py success, sending sheet names:", result);
             res.json({ sheetNames: result });
        } else if (result && result.error) {
             throw new Error(result.error);
        } else {
             console.warn("get_sheets.py returned unexpected structure or warning:", result);
             throw new Error("Failed to retrieve sheet names correctly.");
        }
    } catch (error) {
        console.error("Error in /api/get_sheet_names:", error.message);
        res.status(500).json({ error: error.message || 'Failed to get sheet names.' });
    } finally {
        fs.unlink(filePath, (err) => { if (err) console.error("Error deleting temp file (get_sheets):", err); else console.log("Temp file deleted (get_sheets):", filePath); });
    }
});

// --- Process Selected Sheets Route ---
app.post('/api/process_sheets', upload.single('excelFile'), async (req, res) => {
    console.log("POST /api/process_sheets received");
    if (!req.file) return res.status(400).json({ error: 'No file uploaded for processing.' });
    const filePath = req.file.path;
    let selectedSheets = [];
    try { if (req.body.selectedSheets) { selectedSheets = JSON.parse(req.body.selectedSheets); if (!Array.isArray(selectedSheets)) throw new Error(); } }
    catch(e) { fs.unlinkSync(filePath); return res.status(400).json({ error: 'Invalid format for selected sheets.' }); }
    if (selectedSheets.length === 0) { fs.unlinkSync(filePath); return res.status(400).json({ error: 'No sheets selected.' }); }

    const scriptPath = path.join(__dirname, 'python_scripts', 'step1_load_data.py');
    console.log(`Processing file: ${filePath} for sheets: ${selectedSheets.join(', ')}`);
    let allResults = []; let processingErrors = [];
    for (const sheetName of selectedSheets) {
        console.log(`  Processing sheet: "${sheetName}"...`);
        try {
             const result = await runPythonScript(scriptPath, [filePath, sheetName]);
             if (result && result.error) { throw new Error(result.error); }
             if (Array.isArray(result)) { allResults = allResults.concat(result); }
             else if (result && result.warning) { console.warn(`Received warning for sheet "${sheetName}": ${result.warning}`); }
             else { console.warn(`Received non-array/non-error result for sheet "${sheetName}", skipping.`); }
        } catch (error) {
             console.error(`Failed to process sheet "${sheetName}": ${error.message}`);
             processingErrors.push(`Sheet "${sheetName}": ${error.message}`);
        }
    }
    fs.unlink(filePath, (err) => { if (err) console.error("Error deleting temp file (process_sheets):", err); else console.log("Temp file deleted (process_sheets):", filePath); });
    if (allResults.length === 0 && processingErrors.length > 0) { return res.status(500).json({ error: `Processing failed for all selected sheets. Errors: ${processingErrors.join('; ')}` }); }
    else if (processingErrors.length > 0) { console.warn(`Processing finished with some errors: ${processingErrors.join('; ')}`); res.json({ data: allResults, warning: `Some sheets could not be processed: ${processingErrors.join('; ')}` }); }
    else { console.log(`Processing successful. Total series extracted: ${allResults.length}`); res.json(allResults); }
});

// --- Aggregate Series Route ---
app.post('/api/aggregate_series', async (req, res) => {
    console.log("POST /api/aggregate_series received");
    const { target_frequency, series_list } = req.body;
    if (!target_frequency || !series_list || !Array.isArray(series_list)) { return res.status(400).json({ error: 'Invalid input: target_frequency or series_list missing/invalid.' }); }
    const scriptPath = path.join(__dirname, 'python_scripts', 'step1b_aggregate_data.py');
    const payload = { target_frequency, series_list };
    try {
        const result = await runPythonScript(scriptPath, [], payload);
        if (result && result.error) { throw new Error(result.error); }
        console.log(`aggregate_series success. Returning ${Object.keys(result).length} processed series.`);
        res.json(result);
    } catch (error) {
         console.error("Error in /api/aggregate_series:", error.message);
         res.status(500).json({ error: error.message || 'Aggregation failed.' });
    }
});

// --- Transform Series Route ---
app.post('/api/transform_series', async (req, res) => {
    console.log("POST /api/transform_series received");
    const { operation, series_data, series_name, periods, denominator_data, denominator_name } = req.body;
    let scriptName; let scriptArgs = []; let inputPayload = {};

    switch (operation) {
        case 'diff_abs':
            scriptName = 'step2_diff_abs.py';
            if (!series_data || !series_name) return res.status(400).json({ error: 'Missing data for diff_abs' });
            inputPayload = { series_data, series_name, periods: periods || 1 };
            break;
        case 'diff_pct':
            scriptName = 'step2_diff_pct.py';
            if (!series_data || !series_name) return res.status(400).json({ error: 'Missing data for diff_pct' });
            inputPayload = { series_data, series_name, periods: periods || 1 };
            break;
        case 'normalize':
            scriptName = 'step2_normalize.py';
            if (!series_data || !series_name || !denominator_data || !denominator_name) {
                 return res.status(400).json({ error: 'Missing data for normalize' });
            }
            inputPayload = { numerator_data: series_data, numerator_name: series_name, denominator_data: denominator_data, denominator_name: denominator_name };
            break;
        default:
            console.log(`Unsupported operation requested: ${operation}`);
            return res.status(400).json({ error: `Unsupported operation: ${operation}` });
    }

    const scriptPath = path.join(__dirname, 'python_scripts', scriptName);
    console.log(`Calling ${scriptName} for operation '${operation}' on series '${series_name || 'N/A'}'`);

    try {
        const result = await runPythonScript(scriptPath, scriptArgs, inputPayload);
        if (result && result.error) { throw new Error(result.error); }
        if (result && result.result_data && Array.isArray(result.result_data)) {
            console.log(`${scriptName} successful. Returning ${result.result_data.length} data points.`);
            res.json(result);
        } else {
            console.warn("Transformation script returned unexpected structure:", result);
            throw new Error("Invalid data structure returned by transformation script.");
        }
    } catch (error) {
        console.error(`Error during transformation '${operation}':`, error.message);
        res.status(500).json({ error: error.message || `Transformation '${operation}' failed.` });
    }
});

// --- Эндпоинт ЗАПУСКА перебора регрессий (С ИСПРАВЛЕННЫМ ITERTOOLS) ---
app.post('/api/start_regression_search', async (req, res) => {
    console.log("\nPOST /api/start_regression_search received");
    const { dependentVariable, regressors, config } = req.body;

    // --- Валидация ---
    if (!dependentVariable || !dependentVariable.name || !dependentVariable.data || !regressors || typeof regressors !== 'object' || !config) {
        console.error("Invalid payload received for regression search.");
        return res.status(400).json({ error: 'Invalid payload structure for regression search.' });
    }
    const includedRegressorNames = Object.keys(regressors);
    const k = includedRegressorNames.length;
    const N = config.maxLagDepth || 0;
    const constantStatus = config.constantStatus || 'include';

    console.log("Received Configuration:");
    console.log(`  Dependent Variable: ${dependentVariable.name}`);
    console.log(`  Regressors: ${includedRegressorNames.join(', ') || 'None'}`);
    console.log(`  Config:`, config);

    // --- Генерация спецификаций ---
    const specifications = [];
    let modelCounter = 0;
    const lagValues = Array.from({ length: N + 1 }, (_, i) => i); // [0, 1, ..., N]

    for (let m = 0; m <= k; m++) { // Размер подмножества
        // VVV Используем combinations напрямую VVV
        for (const subsetTuple of combinations(includedRegressorNames, m)) {
            const subset = Array.from(subsetTuple);
            const lagArrays = Array(m).fill(lagValues);
            // VVV Используем product напрямую VVV
            const lagIterator = product(...lagArrays);

            for (const lagTuple of lagIterator) {
                const lags = Array.from(lagTuple);
                const regressorsWithLags = {};
                subset.forEach((regName, index) => {
                    regressorsWithLags[regName] = lags[index];
                });

                if (constantStatus === 'include') {
                    modelCounter++;
                    specifications.push({ model_id: `model_${modelCounter}`, regressors: regressorsWithLags, include_constant: true });
                } else if (constantStatus === 'exclude') {
                    if (m > 0) {
                         modelCounter++;
                         specifications.push({ model_id: `model_${modelCounter}`, regressors: regressorsWithLags, include_constant: false });
                    }
                } else { // constantStatus === 'test'
                    modelCounter++;
                    specifications.push({ model_id: `model_${modelCounter}_const`, regressors: regressorsWithLags, include_constant: true });
                    if (m > 0) {
                        modelCounter++;
                        specifications.push({ model_id: `model_${modelCounter}_noconst`, regressors: regressorsWithLags, include_constant: false });
                    }
                }
            }
             // Обработка случая m=0
             if (m === 0) {
                 const lagIteratorForEmpty = product(...lagArrays);
                 let isEmptyHandled = false;
                 for (const _ of lagIteratorForEmpty) {
                     isEmptyHandled = true;
                     const regressorsWithLags = {};
                     if (constantStatus === 'include') {
                         modelCounter++;
                         specifications.push({ model_id: `model_${modelCounter}`, regressors: regressorsWithLags, include_constant: true });
                     } else if (constantStatus === 'test') {
                         modelCounter++;
                         specifications.push({ model_id: `model_${modelCounter}_const`, regressors: regressorsWithLags, include_constant: true });
                     }
                 }
                 if (!isEmptyHandled && (constantStatus === 'include' || constantStatus === 'test')) { // Добавляем если итератор был пуст
                      const regressorsWithLags = {};
                      modelCounter++;
                      specifications.push({ model_id: `model_${modelCounter}${constantStatus === 'test' ? '_const' : ''}`, regressors: regressorsWithLags, include_constant: true });
                 }
             }
        }
    }

    const totalModelsToRun = specifications.length;
    console.log(`Generated ${totalModelsToRun} model specifications.`);

    if (totalModelsToRun === 0) {
        return res.status(400).json({ error: 'No valid models to run based on configuration.' });
    }

    // --- Запуск задачи ---
    const generatedJobId = `job_${Date.now()}`;
    activeJobs[generatedJobId] = {
        status: 'running', config: config, dependentVariable: dependentVariable,
        regressors: regressors, results: {}, progress: 0,
        totalModels: totalModelsToRun, specifications: specifications, startTime: Date.now(),
    };
    console.log(`Generated Job ID: ${generatedJobId}. Starting background processing...`);

    // --- Асинхронный запуск перебора ---
    setImmediate(async () => {
        const job = activeJobs[generatedJobId];
        if (!job) return;
        const pythonScriptPath = path.join(__dirname, 'python_scripts', 'step3_run_regression.py');

        for (let i = 0; i < job.specifications.length; i++) {
            const spec = job.specifications[i];
            const model_id = spec.model_id;

            if (job.status === 'stopped') { console.log(`[${generatedJobId}] Job stopped.`); break; }
            while (job.status === 'paused') {
                console.log(`[${generatedJobId}] Job paused. Waiting...`);
                await sleep(2000);
                if (job.status === 'stopped') { console.log(`[${generatedJobId}] Job stopped during pause.`); break; }
            }
             if (job.status === 'stopped') break;

            console.log(`[${generatedJobId}] Processing model ${i + 1}/${job.totalModels}: ${model_id}`);
            job.results[model_id] = { status: 'running' };

            const pythonPayload = { model_id, dependentVariable: job.dependentVariable, regressors: job.regressors, specification: spec, config: job.config };

            try {
                const result = await runPythonScript(pythonScriptPath, [], pythonPayload);
                if (activeJobs[generatedJobId]?.status !== 'stopped') {
                     if (result && result.error) {
                         console.error(`[${generatedJobId}] Error in model ${model_id}: ${result.error}`);
                         job.results[model_id] = { status: 'error', error: result.error };
                     } else {
                         console.log(`[${generatedJobId}] Success for model ${model_id}. Valid: ${result?.is_valid}`);
                         job.results[model_id] = { status: 'completed', data: result };
                     }
                } else {
                     console.log(`[${generatedJobId}] Job stopped while model ${model_id} was running. Discarding result.`);
                     job.results[model_id] = { status: 'stopped' };
                }
            } catch (error) {
                 console.error(`[${generatedJobId}] Critical error running script for model ${model_id}: ${error.message}`);
                 if (activeJobs[generatedJobId]?.status !== 'stopped') {
                    job.results[model_id] = { status: 'error', error: error.message };
                 } else {
                     job.results[model_id] = { status: 'stopped' };
                 }
            }

            if (activeJobs[generatedJobId]?.status !== 'stopped') {
                job.progress = i + 1;
            }
        }

        if (activeJobs[generatedJobId] && activeJobs[generatedJobId].status !== 'stopped') {
            activeJobs[generatedJobId].status = 'finished';
            console.log(`[${generatedJobId}] Job finished.`);
        }
    });
    // --- Конец асинхронного запуска ---

    res.status(202).json({ message: 'Regression search started.', jobId: generatedJobId });
});

// --- Эндпоинт Пауза/Возобновление задачи ---
app.post('/api/pause_search/:jobId', async (req, res) => {
    const jobId = req.params.jobId;
    const shouldPause = req.body.pause;
    console.log(`\nPOST /api/pause_search/${jobId} received. Pause: ${shouldPause}`);
    const job = activeJobs[jobId];
    if (!job) { return res.status(404).json({ error: `Job ${jobId} not found.` }); }
    if (job.status === 'stopped' || job.status === 'finished') { return res.status(400).json({ error: `Job ${jobId} is already stopped or finished.` }); }
    job.status = shouldPause ? 'paused' : 'running';
    console.log(`Job ${jobId} status updated to: ${job.status}`);
    res.status(200).json({ message: `Job ${jobId} ${shouldPause ? 'paused' : 'resumed'}.`, currentStatus: job.status });
});

// --- Эндпоинт Остановка задачи ---
app.post('/api/stop_search/:jobId', async (req, res) => {
    const jobId = req.params.jobId;
    console.log(`\nPOST /api/stop_search/${jobId} received.`);
    const job = activeJobs[jobId];
    if (!job) { return res.status(200).json({ message: `Job ${jobId} not found or already stopped.` }); }
    if (job.status === 'stopped' || job.status === 'finished') { return res.status(200).json({ message: `Job ${jobId} is already stopped or finished.` }); }
    job.status = 'stopped';
    console.log(`Job ${jobId} status set to 'stopped'.`);
    res.status(200).json({ message: `Stop request sent for job ${jobId}.` });
});

// --- Эндпоинт Получение прогресса задачи ---
app.get('/api/search_progress/:jobId', (req, res) => {
    const jobId = req.params.jobId;
    console.log(`GET /api/search_progress/${jobId} received.`);
    const job = activeJobs[jobId];
    if (!job) { return res.status(404).json({ error: `Job ${jobId} not found.` }); }
    res.status(200).json({
        jobId: jobId, status: job.status, progress: job.progress,
        totalModels: job.totalModels, results: job.results,
        config: job.config, startTime: job.startTime
    });
});
// ---

// --- Start Server ---
app.listen(port, () => {
    console.log(`VIBE_MODELLING Backend server listening at http://localhost:${port}`);
});

// --- End of File ---