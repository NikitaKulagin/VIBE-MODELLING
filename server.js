// -----------------------------------------------------------------------------
// REQUIRED MODULES
// -----------------------------------------------------------------------------
const express = require('express');
const cors = require('cors');
const path = require('path');
const { spawn } = require('child_process'); // For running Python script
const fs = require('fs');                 // For file system operations (like deleting temp file)
const multer = require('multer');         // For handling file uploads

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
                // Try to parse error from stderr first
                try { if (errorOutput) { const structuredError = JSON.parse(errorOutput); if (structuredError.error) return reject(new Error(`Script error (${path.basename(scriptPath)}): ${structuredError.error}`)); } } catch (e) { /* ignore */ }
                reject(new Error(`Script failed (${path.basename(scriptPath)}, code ${code}). Check logs.`));
            } else {
                try {
                    // Handle case where script succeeds but output is empty
                    if (!scriptOutput && errorOutput.includes("DEBUG:")) {
                       console.warn(`${path.basename(scriptPath)} succeeded but produced no JSON output (only DEBUG logs in stderr).`);
                       return reject(new Error(`Script ${path.basename(scriptPath)} produced no primary output.`));
                    }
                    if (!scriptOutput) {
                         return reject(new Error(`Script ${path.basename(scriptPath)} produced no output.`));
                    }

                    const result = JSON.parse(scriptOutput);
                    if (result.error) {
                        console.error(`${path.basename(scriptPath)} reported logical error:`, result.error);
                        return reject(new Error(result.error)); // Pass the logical error message
                    }
                    resolve(result); // Resolve with the parsed JSON result
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

        // Send input data via stdin if provided
        if (inputData !== null) {
            try {
                const inputString = JSON.stringify(inputData);
                console.log(`Sending payload to ${path.basename(scriptPath)} stdin...`);
                pythonProcess.stdin.write(inputString);
                pythonProcess.stdin.end();
                console.log("Payload sent to stdin.");
            } catch (e) {
                console.error(`Error stringifying/sending payload to ${path.basename(scriptPath)}:`, e);
                pythonProcess.kill(); // Kill process if sending data failed
                reject(new Error(`Failed to send data to script (${path.basename(scriptPath)}).`));
            }
        }
    });
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
        const sheetNames = await runPythonScript(scriptPath, [filePath]);
        if (!Array.isArray(sheetNames)) throw new Error("Script output is not a JSON array.");
        console.log("get_sheets.py success, sending sheet names:", sheetNames);
        res.json({ sheetNames: sheetNames });
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
        try { const result = await runPythonScript(scriptPath, [filePath, sheetName]); if (Array.isArray(result)) { allResults = allResults.concat(result); } else { console.warn(`Received non-array result for sheet "${sheetName}", skipping.`); } }
        catch (error) { console.error(`Failed to process sheet "${sheetName}": ${error.message}`); processingErrors.push(`Sheet "${sheetName}": ${error.message}`); }
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
        console.log(`aggregate_series success. Returning ${Object.keys(result).length} processed series.`);
        res.json(result);
    } catch (error) {
         console.error("Error in /api/aggregate_series:", error.message);
         res.status(500).json({ error: error.message || 'Aggregation failed.' });
    }
});

// --- !!! НОВЫЙ ЭНДПОИНТ: Трансформация рядов !!! ---
app.post('/api/transform_series', async (req, res) => {
    console.log("POST /api/transform_series received");
    // Извлекаем данные из тела запроса
    const { operation, series_data, series_name, periods, denominator_data, denominator_name } = req.body;

    let scriptName;
    let scriptArgs = [];
    let inputPayload = {};

    // Определяем скрипт и payload на основе операции
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
            inputPayload = {
                numerator_data: series_data, numerator_name: series_name,
                denominator_data: denominator_data, denominator_name: denominator_name
            };
            break;
        // Добавьте другие 'case' здесь для будущих операций
        default:
            console.log(`Unsupported operation requested: ${operation}`);
            return res.status(400).json({ error: `Unsupported operation: ${operation}` });
    }

    const scriptPath = path.join(__dirname, 'python_scripts', scriptName);
    console.log(`Calling ${scriptName} for operation '${operation}' on series '${series_name || 'N/A'}'`);

    try {
        // Запускаем скрипт через хелпер
        const result = await runPythonScript(scriptPath, scriptArgs, inputPayload);

        // Проверяем структуру ответа (ожидаем { result_data: [...] })
        if (result && result.result_data && Array.isArray(result.result_data)) {
            console.log(`${scriptName} successful. Returning ${result.result_data.length} data points.`);
            res.json(result); // Отправляем { result_data: [...] }
        } else {
            throw new Error("Invalid data structure returned by transformation script.");
        }
    } catch (error) {
        // Обрабатываем ошибки из runPythonScript
        console.error(`Error during transformation '${operation}':`, error.message);
        res.status(500).json({ error: error.message || `Transformation '${operation}' failed.` });
    }
});
// --- !!! КОНЕЦ НОВОГО ЭНДПОИНТА !!! ---


// --- Start Server ---
app.listen(port, () => {
    console.log(`VIBE_MODELLING Backend server listening at http://localhost:${port}`);
});

// --- End of File ---