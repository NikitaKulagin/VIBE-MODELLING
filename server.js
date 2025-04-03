// -----------------------------------------------------------------------------
// REQUIRED MODULES
// -----------------------------------------------------------------------------
const express = require('express');
const cors = require('cors');
const path = require('path');
const { spawn } = require('child_process'); // For running Python script
const fs = require('fs');                 // For file system operations
const multer = require('multer');         // For handling file uploads

// -----------------------------------------------------------------------------
// CONFIGURATION READING
// -----------------------------------------------------------------------------
let pythonCommand = 'python3'; // Default value
const configPath = path.join(__dirname, 'server_config.json');

try {
    if (fs.existsSync(configPath)) {
        const configFile = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(configFile);
        if (config.pythonExecutablePath && typeof config.pythonExecutablePath === 'string') {
            pythonCommand = config.pythonExecutablePath;
            console.log(`Using Python executable from config: ${pythonCommand}`);
        } else {
            console.warn(`Config file found, but 'pythonExecutablePath' is missing or invalid. Using default: ${pythonCommand}`);
        }
    } else {
        console.warn(`Config file not found at ${configPath}. Using default Python command: ${pythonCommand}`);
        // Optionally create a default config file if it doesn't exist
        // try {
        //     fs.writeFileSync(configPath, JSON.stringify({ pythonExecutablePath: 'python3' }, null, 2), 'utf8');
        //     console.log(`Created default config file: ${configPath}`);
        // } catch (writeErr) {
        //     console.error(`Could not create default config file:`, writeErr);
        // }
    }
} catch (err) {
    console.error(`Error reading or parsing config file ${configPath}:`, err);
    console.warn(`Using default Python command due to config error: ${pythonCommand}`);
}

// -----------------------------------------------------------------------------
// EXPRESS APP INITIALIZATION & CONFIGURATION
// -----------------------------------------------------------------------------
const app = express();
const port = 5001; // Port for the backend server

app.use(cors()); // Allow requests from the frontend (React app)
// Increase limits for potentially large data in JSON and URL-encoded forms
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// -----------------------------------------------------------------------------
// MULTER CONFIGURATION (for File Uploads)
// -----------------------------------------------------------------------------
const uploadDir = 'uploads/';
// Ensure upload directory exists
if (!fs.existsSync(uploadDir)){
    try {
      fs.mkdirSync(uploadDir);
      console.log(`Created directory: ${uploadDir}`);
    } catch (err) {
      console.error(`Error creating directory ${uploadDir}:`, err);
      process.exit(1); // Exit if cannot create upload directory
    }
} else {
    console.log(`Directory already exists: ${uploadDir}`);
}

// Configure multer storage
const storage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, uploadDir); },
    filename: function (req, file, cb) {
        // Create a unique filename to avoid collisions
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// -----------------------------------------------------------------------------
// HELPER FUNCTION FOR RUNNING PYTHON SCRIPTS (Uses configured pythonCommand)
// -----------------------------------------------------------------------------
function runPythonScript(scriptPath, args = [], inputData = null) {
    return new Promise((resolve, reject) => {
        // Use the pythonCommand read from the config file (or default)
        console.log(`Running Python script: ${path.basename(scriptPath)} using command '${pythonCommand}' with args: [${args.join(', ')}]`);
        const pythonProcess = spawn(pythonCommand, [scriptPath, ...args]);

        let scriptOutput = ''; // Buffer for stdout
        let errorOutput = '';  // Buffer for stderr

        // Listen for data from stdout
        pythonProcess.stdout.on('data', (data) => scriptOutput += data.toString());

        // Listen for data from stderr
        pythonProcess.stderr.on('data', (data) => {
            const stderrChunk = data.toString();
            errorOutput += stderrChunk;
            // Log stderr immediately for debugging, but trim it
            console.error(`${path.basename(scriptPath)} stderr chunk: ${stderrChunk.trim()}`);
        });

        // Handle process exit
        pythonProcess.on('close', (code) => {
            console.log(`${path.basename(scriptPath)} finished with code ${code}`);

            if (code !== 0) {
                // --- Process Failed (Non-zero exit code) ---
                console.error(`${path.basename(scriptPath)} exited with error code ${code}. Full Stderr: ${errorOutput}`);

                // Check specifically for ModuleNotFoundError in the accumulated stderr
                 if (errorOutput.includes("ModuleNotFoundError")) {
                     const moduleMatch = errorOutput.match(/No module named '([^']+)'/);
                     const missingModule = moduleMatch ? moduleMatch[1] : 'unknown';
                     return reject(new Error(`Script failed (${path.basename(scriptPath)}): ModuleNotFoundError: No module named '${missingModule}'. Please ensure required packages are installed in the Python environment specified by '${pythonCommand}'.`));
                 }
                // Try to parse a structured error from the *entire* stderr output
                try {
                    // Attempt to parse the whole stderr in case the error JSON is there
                    const structuredError = JSON.parse(errorOutput);
                    if (structuredError.error) {
                        return reject(new Error(`Script error (${path.basename(scriptPath)}): ${structuredError.error}`));
                    }
                } catch (e) { /* Ignore if stderr is not valid JSON */ }

                // If no specific error found, return a generic error message
                reject(new Error(`Script failed (${path.basename(scriptPath)}, code ${code}). Stderr: ${errorOutput.substring(0, 250)}... Check logs.`));

            } else {
                 // --- Process Succeeded (Zero exit code) ---
                try {
                    // Case 1: Script produced output to stdout (expected case)
                    if (scriptOutput) {
                        // Attempt to parse JSON from stdout
                        const result = JSON.parse(scriptOutput);
                        resolve(result);
                    }
                    // Case 2: Script produced NO output to stdout, but might have logged INFO/WARN to stderr
                    else if (errorOutput.includes("INFO_") || errorOutput.includes("WARN_")) {
                       console.warn(`${path.basename(scriptPath)} succeeded (code 0) but produced no JSON output to stdout (only logs in stderr).`);
                       // Resolve with a warning structure, indicating success but no primary data
                       resolve({ warning: `Script ${path.basename(scriptPath)} produced no primary output to stdout. Check logs in stderr for details.`, data: null });
                    }
                    // Case 3: Script produced NO output to stdout and NO indicative logs in stderr
                    else {
                         console.warn(`Script ${path.basename(scriptPath)} produced no output to stdout.`);
                         // Resolve with a warning or potentially empty data structure, depending on script's expected behavior
                         resolve({ warning: `Script ${path.basename(scriptPath)} produced no output.`, data: null });
                    }
                } catch (e) {
                    // Error parsing the JSON output from stdout
                    console.error(`Error parsing ${path.basename(scriptPath)} stdout JSON:`, e, `Raw stdout: ${scriptOutput}`);
                    reject(new Error(`Failed to parse script output (${path.basename(scriptPath)}). Raw: ${scriptOutput.substring(0, 250)}...`));
                }
            }
        });

        // Handle errors during the spawn process itself (e.g., command not found)
        pythonProcess.on('error', (spawnError) => {
             console.error(`Failed to start ${path.basename(scriptPath)} script using command '${pythonCommand}':`, spawnError);
             reject(new Error(`Failed to start script process (${path.basename(scriptPath)}). Command '${pythonCommand}' not found or permission denied? Check 'server_config.json'. Error: ${spawnError.message}`));
        });


        // Send input data via stdin if provided
        if (inputData !== null) {
            try {
                const inputString = JSON.stringify(inputData);
                // Log only a snippet if payload is large
                const logPayload = inputString.length > 500 ? inputString.substring(0, 500) + '...' : inputString;
                console.log(`Sending payload to ${path.basename(scriptPath)} stdin: ${logPayload}`);

                pythonProcess.stdin.write(inputString);
                pythonProcess.stdin.end(); // Close stdin to signal end of input
                console.log(`Payload sent to ${path.basename(scriptPath)} stdin.`);
            } catch (e) {
                console.error(`Error stringifying/sending payload to ${path.basename(scriptPath)}:`, e);
                pythonProcess.kill(); // Kill the process if stdin fails
                reject(new Error(`Failed to send data to script (${path.basename(scriptPath)}).`));
            }
        }
    });
}


// --- In-memory storage for active regression jobs ---
const activeJobs = {};
/* Structure of an entry in activeJobs:
   jobId: {
        status: 'starting' | 'running' | 'paused' | 'stopped' | 'finished' | 'error',
        config: {}, // Original config from the request
        dependentVariable: {}, // Original Y data (for reference)
        regressors: {}, // Original X data (for reference) - { name: [[ts, val],...], ... }
        results: { model_id: { status: 'completed'|'error'|'skipped', data?: {}, error?: string, reason?: string } }, // Accumulated results from Python
        progress: 0, // Number of models processed by Python script
        totalModels: null, // Estimated total models (can be null initially)
        startTime: number, // Timestamp of job start
        pythonProcess: ChildProcess | null, // Reference to the running Python process object
        stdoutBuffer: string, // Buffer for accumulating stdout data from Python
        error: string | null // Stores the last critical error message
   }
*/
// ---

// --- Helper function for delays (used in older versions, might be useful later) ---
// function sleep(ms) {
//   return new Promise(resolve => setTimeout(resolve, ms));
// }

// -----------------------------------------------------------------------------
// API ROUTES
// -----------------------------------------------------------------------------

// --- Test Route ---
app.get('/api/test', (req, res) => {
    console.log("GET /api/test received");
    res.json({ message: 'Backend is running!' });
});

// --- Get Sheet Names from Excel Route ---
app.post('/api/get_sheet_names', upload.single('excelFile'), async (req, res) => {
    console.log("POST /api/get_sheet_names received");
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded.' });
    }
    const scriptPath = path.join(__dirname, 'python_scripts', 'get_sheets.py');
    const filePath = req.file.path; // Path to the uploaded temporary file

    try {
        // Run the Python script to get sheet names
        const result = await runPythonScript(scriptPath, [filePath]);

        // Check the result structure
        if (Array.isArray(result)) {
             // Success: result is an array of sheet names
             console.log("get_sheets.py success, sending sheet names:", result);
             res.json({ sheetNames: result });
        } else if (result && result.error) {
             // Script reported a specific error
             throw new Error(result.error);
        } else {
             // Unexpected structure or warning from the script
             console.warn("get_sheets.py returned unexpected structure or warning:", result);
             if (result && result.warning) {
                 // If only a warning was returned, send it back with empty sheets
                 res.status(200).json({ sheetNames: [], warning: result.warning });
             } else {
                 // Otherwise, treat as a failure
                 throw new Error("Failed to retrieve sheet names correctly. Unexpected script output.");
             }
        }
    } catch (error) {
        // Handle errors from runPythonScript or thrown above
        console.error("Error in /api/get_sheet_names:", error.message);
        res.status(500).json({ error: error.message || 'Failed to get sheet names.' });
    } finally {
        // Ensure the temporary uploaded file is deleted
        fs.unlink(filePath, (err) => {
            if (err) console.error("Error deleting temp file (get_sheets):", err);
            else console.log("Temp file deleted (get_sheets):", filePath);
        });
    }
});

// --- Process Selected Sheets from Excel Route ---
app.post('/api/process_sheets', upload.single('excelFile'), async (req, res) => {
    console.log("POST /api/process_sheets received");
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded for processing.' });
    }

    const filePath = req.file.path;
    let selectedSheets = [];

    // Safely parse the list of selected sheets from the request body
    try {
        if (req.body.selectedSheets) {
            selectedSheets = JSON.parse(req.body.selectedSheets);
            if (!Array.isArray(selectedSheets)) throw new Error('selectedSheets is not an array.');
        }
    } catch (e) {
        console.error("Error parsing selectedSheets:", e);
        fs.unlinkSync(filePath); // Clean up before sending error response
        return res.status(400).json({ error: 'Invalid format for selected sheets.' });
    }

    // Check if any sheets were selected
    if (selectedSheets.length === 0) {
        fs.unlinkSync(filePath); // Clean up
        return res.status(400).json({ error: 'No sheets selected.' });
    }

    const scriptPath = path.join(__dirname, 'python_scripts', 'step1_load_data.py');
    console.log(`Processing file: ${filePath} for sheets: ${selectedSheets.join(', ')}`);

    let allResults = []; // To accumulate results from all sheets
    let processingErrors = []; // To collect errors for specific sheets

    // Process each selected sheet sequentially
    for (const sheetName of selectedSheets) {
        console.log(`  Processing sheet: "${sheetName}"...`);
        try {
             // Run the Python script for the current sheet
             const result = await runPythonScript(scriptPath, [filePath, sheetName]);

             if (result && result.error) {
                 // Error reported by the script for this sheet
                 throw new Error(result.error);
             }
             if (Array.isArray(result)) {
                 // Success for this sheet, add results to the main list
                 allResults = allResults.concat(result);
             } else if (result && result.warning) {
                 // Warning reported by the script for this sheet
                 console.warn(`Received warning for sheet "${sheetName}": ${result.warning}`);
                 // Optionally store warnings if needed
             } else {
                 // Unexpected output structure for this sheet
                 console.warn(`Received non-array/non-error result for sheet "${sheetName}", skipping. Result:`, result);
             }
        } catch (error) {
             // Catch errors during script execution or thrown above
             console.error(`Failed to process sheet "${sheetName}": ${error.message}`);
             processingErrors.push(`Sheet "${sheetName}": ${error.message}`);
        }
    }

    // Clean up the uploaded temporary file
    fs.unlink(filePath, (err) => {
        if (err) console.error("Error deleting temp file (process_sheets):", err);
        else console.log("Temp file deleted (process_sheets):", filePath);
    });

    // Determine the final response based on processing outcome
    if (allResults.length === 0 && processingErrors.length > 0) {
        // If all sheets failed
        return res.status(500).json({ error: `Processing failed for all selected sheets. Errors: ${processingErrors.join('; ')}` });
    } else if (processingErrors.length > 0) {
        // If some sheets failed, return successful results with a warning
        console.warn(`Processing finished with some errors: ${processingErrors.join('; ')}`);
        // Send back the successfully processed data and a warning message
        res.json({ data: allResults, warning: `Some sheets could not be processed: ${processingErrors.join('; ')}` });
    } else {
        // If all sheets succeeded
        console.log(`Processing successful. Total series extracted: ${allResults.length}`);
        // Send back the combined results (expected format is an array)
        res.json(allResults);
    }
});


// --- Aggregate Series Route ---
app.post('/api/aggregate_series', async (req, res) => {
    console.log("POST /api/aggregate_series received");
    const { target_frequency, series_list } = req.body;

    // Basic input validation
    if (!target_frequency || !series_list || !Array.isArray(series_list)) {
        return res.status(400).json({ error: 'Invalid input: target_frequency or series_list missing/invalid.' });
    }

    const scriptPath = path.join(__dirname, 'python_scripts', 'step1b_aggregate_data.py');
    const payload = { target_frequency, series_list }; // Data to send via stdin

    try {
        const result = await runPythonScript(scriptPath, [], payload);

        if (result && result.error) {
            throw new Error(result.error);
        }
        // Check if the result is a non-null object (expected output format)
        // And ensure it's not just a warning object
        if (typeof result === 'object' && result !== null && !result.warning) {
             console.log(`aggregate_series success. Returning ${Object.keys(result).length} processed series.`);
             res.json(result); // Send the result object (e.g., { series_name: [[ts, val],...] })
        } else if (result && result.warning && Object.keys(result).length === 1) {
             // Handle case where script only returns a warning
             console.warn("aggregate_series script returned only a warning:", result.warning);
             res.status(200).json({ warning: result.warning }); // Send warning back to client
        }
         else {
             // Handle unexpected result structure
             console.warn("aggregate_series script returned unexpected structure:", result);
             throw new Error("Aggregation script returned invalid data structure.");
        }
    } catch (error) {
         console.error("Error in /api/aggregate_series:", error.message);
         res.status(500).json({ error: error.message || 'Aggregation failed.' });
    }
});

// --- Transform Series Route ---
app.post('/api/transform_series', async (req, res) => {
    console.log("POST /api/transform_series received");
    const { operation, series_data, series_name, periods, denominator_data, denominator_name } = req.body;

    let scriptName;
    let scriptArgs = []; // Arguments passed on command line (usually none when using stdin)
    let inputPayload = {}; // Data sent via stdin

    // Determine the correct Python script and prepare payload based on the operation
    switch (operation) {
        case 'diff_abs':
            scriptName = 'step2_diff_abs.py';
            if (!series_data || !series_name) return res.status(400).json({ error: 'Missing series_data or series_name for diff_abs' });
            inputPayload = { series_data, series_name, periods: periods || 1 };
            break;
        case 'diff_pct':
            scriptName = 'step2_diff_pct.py';
            if (!series_data || !series_name) return res.status(400).json({ error: 'Missing series_data or series_name for diff_pct' });
            inputPayload = { series_data, series_name, periods: periods || 1 };
            break;
        case 'normalize':
            scriptName = 'step2_normalize.py';
            if (!series_data || !series_name || !denominator_data || !denominator_name) {
                 return res.status(400).json({ error: 'Missing numerator or denominator data/name for normalize' });
            }
            inputPayload = { numerator_data: series_data, numerator_name: series_name, denominator_data: denominator_data, denominator_name: denominator_name };
            break;
        default:
            // Handle unsupported operations
            console.log(`Unsupported operation requested: ${operation}`);
            return res.status(400).json({ error: `Unsupported operation: ${operation}` });
    }

    const scriptPath = path.join(__dirname, 'python_scripts', scriptName);
    console.log(`Calling ${scriptName} for operation '${operation}' on series '${series_name || 'N/A'}'`);

    try {
        // Run the appropriate transformation script
        const result = await runPythonScript(scriptPath, scriptArgs, inputPayload);

        if (result && result.error) {
            throw new Error(result.error);
        }
        // Check if the result contains the expected 'result_data' array
        if (result && result.result_data && Array.isArray(result.result_data)) {
            console.log(`${scriptName} successful. Returning ${result.result_data.length} data points.`);
            res.json(result); // Send the entire result object back
        } else if (result && result.warning && Object.keys(result).length === 1) {
             // Handle case where script only returns a warning
             console.warn("Transformation script returned only a warning:", result.warning);
             res.status(200).json({ warning: result.warning });
        }
        else {
            // Handle unexpected result structure
            console.warn("Transformation script returned unexpected structure:", result);
            throw new Error("Invalid data structure returned by transformation script.");
        }
    } catch (error) {
        console.error(`Error during transformation '${operation}':`, error.message);
        res.status(500).json({ error: error.message || `Transformation '${operation}' failed.` });
    }
});


// --- Endpoint to START the regression model search (using the master Python script) ---
app.post('/api/start_regression_search', async (req, res) => {
    console.log("\nPOST /api/start_regression_search received (Master Script Version)");
    const { dependentVariable, regressors, config } = req.body;

    // --- Input Validation ---
    if (!dependentVariable || !dependentVariable.name || !dependentVariable.data || !Array.isArray(dependentVariable.data)) {
        return res.status(400).json({ error: 'Invalid or missing dependentVariable data.' });
    }
    if (!regressors || typeof regressors !== 'object') {
         return res.status(400).json({ error: 'Invalid or missing regressors object.' });
    }
    if (!config || typeof config !== 'object') {
         return res.status(400).json({ error: 'Invalid or missing config object.' });
    }
    // Validate regressor data format
    for (const key in regressors) {
        if (!Array.isArray(regressors[key])) {
             return res.status(400).json({ error: `Invalid data format for regressor '${key}'. Expected array.` });
        }
    }

    const includedRegressorNames = Object.keys(regressors);
    console.log("Received Configuration:");
    console.log(`  Dependent Variable: ${dependentVariable.name}`);
    console.log(`  Regressors: ${includedRegressorNames.join(', ') || 'None'}`);
    console.log(`  Config:`, JSON.stringify(config));

    // --- Create and Register the Job ---
    const generatedJobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    activeJobs[generatedJobId] = {
        status: 'starting', // Initial status before process spawn
        config: config,
        dependentVariable: dependentVariable, // Store for reference
        regressors: regressors, // Store for reference
        results: {}, // Accumulate results here { model_id: { status, data/error } }
        progress: 0, // Counter for processed models
        totalModels: null, // Will be updated if Python reports it
        startTime: Date.now(),
        pythonProcess: null, // Reference to the spawned process
        stdoutBuffer: '',    // Buffer for stdout data
        error: null          // Store last critical error
    };
    console.log(`Generated Job ID: ${generatedJobId}. Preparing to start master Python script...`);

    // --- Spawn the Master Python Script ---
    const pythonScriptPath = path.join(__dirname, 'python_scripts', 'step3_run_regression_master.py');
    // Use the pythonCommand determined from config or default
    console.log(`Spawning master script: ${pythonCommand} ${pythonScriptPath}`);
    const pythonProcess = spawn(pythonCommand, [pythonScriptPath]);

    // Store the process reference and update job status
    activeJobs[generatedJobId].pythonProcess = pythonProcess;
    activeJobs[generatedJobId].status = 'running';
    console.log(`[${generatedJobId}] Python process spawned (PID: ${pythonProcess.pid}). Status set to 'running'.`);

    // --- Handle stdout (Progress Updates and Final Result) ---
    pythonProcess.stdout.on('data', (data) => {
        const job = activeJobs[generatedJobId];
        // Ignore data if job was stopped or errored
        if (!job || job.status === 'stopped' || job.status === 'error') return;

        job.stdoutBuffer += data.toString(); // Append incoming data to buffer
        let newlineIndex;

        // Process buffer line by line
        while ((newlineIndex = job.stdoutBuffer.indexOf('\n')) >= 0) {
            const line = job.stdoutBuffer.substring(0, newlineIndex).trim(); // Extract line
            job.stdoutBuffer = job.stdoutBuffer.substring(newlineIndex + 1); // Remove processed line from buffer

            if (!line) continue; // Skip empty lines

            // Check for PROGRESS_UPDATE marker
            if (line.startsWith('PROGRESS_UPDATE:')) {
                try {
                    const jsonString = line.substring('PROGRESS_UPDATE:'.length);
                    const update = JSON.parse(jsonString);
                    if (update.type === 'progress' && update.processed_batch) {
                        // Merge the batch results into the job's results object
                        Object.assign(job.results, update.processed_batch);
                        // Update the progress counter
                        job.progress = update.total_calculated || job.progress;
                        // console.log(`[${generatedJobId}] Progress update. Total: ${job.progress}. Batch: ${Object.keys(update.processed_batch).length}`); // Debug log
                    } else {
                         console.warn(`[${generatedJobId}] Received PROGRESS_UPDATE with unexpected structure:`, update);
                    }
                } catch (e) {
                    console.error(`[${generatedJobId}] Error parsing progress update JSON:`, e, `Line: ${line.substring(0, 200)}...`);
                }
            }
            // Check for FINAL_RESULT marker
            else if (line.startsWith('FINAL_RESULT:')) {
                 try {
                    const jsonString = line.substring('FINAL_RESULT:'.length);
                    const finalData = JSON.parse(jsonString);
                    // Set final job status ('finished' or 'error')
                    job.status = finalData.status || 'finished';
                    job.progress = finalData.total_models_calculated || job.progress; // Update final count
                    if(finalData.error) {
                        job.error = finalData.error; // Store error message
                        console.error(`[${generatedJobId}] Master script finished with error: ${finalData.error}`);
                    } else {
                        console.log(`[${generatedJobId}] Master script finished successfully. Final calculated count: ${job.progress}`);
                    }
                    // Clear process reference as it should have exited
                    job.pythonProcess = null;
                 } catch (e) {
                    console.error(`[${generatedJobId}] Error parsing final result JSON:`, e, `Line: ${line.substring(0, 200)}...`);
                    job.status = 'error';
                    job.error = 'Failed to parse final script output.';
                    job.pythonProcess = null;
                 }
                 // Stop processing stdout after receiving the final result
                 return;
            }
            // Log any other non-empty lines from stdout (e.g., Python prints for debugging)
            else {
                 console.log(`[${generatedJobId}] Python stdout (unparsed): ${line}`);
            }
        } // End while loop for processing lines
    });

    // --- Handle stderr (Log Python Errors/Warnings, Filter Warnings) ---
    pythonProcess.stderr.on('data', (data) => {
        const job = activeJobs[generatedJobId];
        const errorChunk = data.toString();

        // Process stderr line by line to filter warnings
        errorChunk.split('\n').forEach(errorLine => {
            if (errorLine.trim()) { // Process non-empty lines
                // Define patterns for common Python warnings to filter out
                const isWarning = errorLine.includes('Warning:') ||
                                  errorLine.includes('ConvergenceWarning') ||
                                  errorLine.includes('RuntimeWarning') ||
                                  errorLine.includes('UserWarning') ||
                                  errorLine.startsWith('WARN_MASTER:'); // Filter our custom warnings

                if (!isWarning) {
                    // Log lines that are likely actual errors
                    console.error(`[${generatedJobId}] Python stderr (Error?): ${errorLine.trim()}`);
                    // Store the last non-warning error message in the job object
                    if (job && job.status !== 'stopped') {
                         job.error = errorLine.trim();
                    }
                } else {
                     // Optionally log warnings if needed for debugging, but keep console cleaner
                     // console.log(`[${generatedJobId}] Python stderr (Warning): ${errorLine.trim()}`);
                }
            }
        });
    });


    // --- Handle Python Process Exit ---
    pythonProcess.on('close', (code) => {
        const job = activeJobs[generatedJobId];
        console.log(`[${generatedJobId}] Python process exited with code ${code}.`);
        if (job) {
            // If the process exited but the status isn't final yet, mark as error
            if (job.status !== 'finished' && job.status !== 'error' && job.status !== 'stopped') {
                job.status = 'error';
                job.error = job.error || `Python process exited unexpectedly with code ${code}. Check stderr logs.`;
                console.error(`[${generatedJobId}] Job status set to 'error' due to unexpected Python process exit.`);
            }
            // Clear the process reference now that it has exited
            job.pythonProcess = null;
        } else {
            // Should not happen if job registration is correct
            console.warn(`[${generatedJobId}] Python process closed, but job object was not found.`);
        }
    });

     // --- Handle Errors During Process Spawning ---
     pythonProcess.on('error', (spawnError) => {
         const job = activeJobs[generatedJobId];
         console.error(`[${generatedJobId}] Failed to start Python process using command '${pythonCommand}':`, spawnError);
         if(job) {
             job.status = 'error';
             job.error = `Failed to start Python process. Command '${pythonCommand}' not found or permission denied? Check 'server_config.json'. Error: ${spawnError.message}`;
             job.pythonProcess = null; // Process never started
         }
     });

    // --- Send Payload to Python Script via stdin ---
    try {
        const payloadString = JSON.stringify({ dependentVariable, regressors, config });
        pythonProcess.stdin.write(payloadString);
        pythonProcess.stdin.end(); // Close stdin to signal end of input
        console.log(`[${generatedJobId}] Payload sent to master script stdin.`);
    } catch (e) {
        console.error(`[${generatedJobId}] Error stringifying/sending payload to master script:`, e);
        // If sending data fails, kill the process and mark the job as errored
        pythonProcess.kill();
        if (activeJobs[generatedJobId]) {
            activeJobs[generatedJobId].status = 'error';
            activeJobs[generatedJobId].error = `Failed to send data to Python script: ${e.message}`;
            activeJobs[generatedJobId].pythonProcess = null;
        }
        // Respond to the client with an error
        return res.status(500).json({ error: 'Failed to send configuration to processing script.' });
    }

    // --- Respond to Client Immediately (202 Accepted) ---
    // The actual results will be available later via the progress endpoint
    res.status(202).json({ message: 'Regression search initiated.', jobId: generatedJobId });
});


// --- Endpoint to Pause/Resume a Job (Simple Status Change) ---
app.post('/api/pause_search/:jobId', async (req, res) => {
    const jobId = req.params.jobId;
    const shouldPause = req.body.pause; // Expecting { pause: true } or { pause: false }
    console.log(`\nPOST /api/pause_search/${jobId} received. Pause: ${shouldPause}`);
    const job = activeJobs[jobId];

    if (!job) {
        return res.status(404).json({ error: `Job ${jobId} not found.` });
    }

    // Check if the job is in a state that can be paused/resumed
    if (job.status === 'stopped' || job.status === 'finished' || job.status === 'error') {
        console.log(`Job ${jobId} cannot be paused/resumed. Current status: ${job.status}`);
        return res.status(400).json({ error: `Job ${jobId} is already ${job.status}.` });
    }

    // Update the status in the job object
    // Note: This implementation does NOT actually pause the Python script execution.
    // It only changes the status reported by the progress endpoint.
    job.status = shouldPause ? 'paused' : 'running';

    console.log(`Job ${jobId} status updated to: ${job.status} (Note: Python script execution state is not directly affected).`);
    res.status(200).json({ message: `Job ${jobId} status set to ${job.status}.`, currentStatus: job.status });
});

// --- Endpoint to Stop a Job (Terminates Python Process) ---
app.post('/api/stop_search/:jobId', async (req, res) => {
    const jobId = req.params.jobId;
    console.log(`\nPOST /api/stop_search/${jobId} received.`);
    const job = activeJobs[jobId];

    if (!job) {
        console.log(`Job ${jobId} not found or already inactive.`);
        // Return 200 OK as the desired state (stopped) is effectively met
        return res.status(200).json({ message: `Job ${jobId} not found or already inactive.` });
    }

    // Check if the job is already in a final state
    if (job.status === 'stopped' || job.status === 'finished' || job.status === 'error') {
         console.log(`Job ${jobId} is already ${job.status}. No action needed.`);
         return res.status(200).json({ message: `Job ${jobId} is already ${job.status}.` });
    }

    // Set the status to 'stopped' immediately
    job.status = 'stopped';
    console.log(`Job ${jobId} status set to 'stopped'.`);

    // Attempt to terminate the associated Python process if it exists and is running
    if (job.pythonProcess && !job.pythonProcess.killed) {
        console.log(`Attempting to kill Python process for job ${jobId} (PID: ${job.pythonProcess.pid})...`);
        // Send SIGTERM first for graceful shutdown
        const killed = job.pythonProcess.kill('SIGTERM');
        if (killed) {
            console.log(`SIGTERM signal sent to Python process for job ${jobId}.`);
            // Set a timeout to send SIGKILL if SIGTERM doesn't work quickly
            const killTimeout = setTimeout(() => {
                // Check again before sending SIGKILL
                if (job.pythonProcess && !job.pythonProcess.killed) {
                    console.warn(`[${jobId}] Python process did not exit after SIGTERM, sending SIGKILL.`);
                    job.pythonProcess.kill('SIGKILL'); // Force kill
                    job.pythonProcess = null; // Assume killed
                }
            }, 1500); // Wait 1.5 seconds

             // Listen for the 'close' event to clear the timeout if SIGTERM worked
             job.pythonProcess.once('close', () => { // Use 'once' to avoid multiple calls
                 clearTimeout(killTimeout);
                 console.log(`[${jobId}] Python process terminated after signal.`);
                 job.pythonProcess = null; // Clear reference
             });

        } else {
            console.warn(`Failed to send SIGTERM to Python process for job ${jobId}. It might have already exited.`);
             job.pythonProcess = null; // Clear reference as we can't control it
        }
    } else {
         console.log(`No active Python process found for job ${jobId} to kill, or already killed.`);
         // Ensure reference is cleared if process doesn't exist
         if(job) job.pythonProcess = null;
    }

    // Respond to the client confirming the stop request was processed
    res.status(200).json({ message: `Stop request processed for job ${jobId}. Status set to 'stopped'.` });
});


// --- Endpoint to Get Job Progress ---
app.get('/api/search_progress/:jobId', (req, res) => {
    const jobId = req.params.jobId;
    // Avoid excessive logging for this frequently called endpoint
    // console.log(`GET /api/search_progress/${jobId}`);
    const job = activeJobs[jobId];

    if (!job) {
        // If job doesn't exist (e.g., after server restart or invalid ID), return 404
        return res.status(404).json({ error: `Job ${jobId} not found.` });
    }

    // Return the current state of the job object
    res.status(200).json({
        jobId: jobId,
        status: job.status,
        progress: job.progress,
        totalModels: job.totalModels, // May be null initially
        results: job.results,         // Accumulated model results
        config: job.config,           // Original job configuration
        startTime: job.startTime,
        error: job.error              // Last recorded error message
    });
});
// ---

// +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
// +++ NEW ENDPOINT: Get Model Decomposition Data +++
// +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
app.post('/api/get_model_decomposition/:jobId/:modelId', async (req, res) => {
    const { jobId, modelId } = req.params;
    const { modelSpecification } = req.body; // Expecting { regressors_with_lags: {...}, include_constant: true/false }

    console.log(`\nPOST /api/get_model_decomposition/${jobId}/${modelId} received.`);

    // --- Validation ---
    const job = activeJobs[jobId];
    if (!job) {
        console.error(`[Decomposition] Job ${jobId} not found.`);
        return res.status(404).json({ error: `Job ${jobId} not found.` });
    }
    if (!modelId) {
        console.error(`[Decomposition] Model ID is missing.`);
        return res.status(400).json({ error: 'Model ID is required.' });
    }
    // Check if the requested model actually exists in the results (optional but good)
    // if (!job.results || !job.results[modelId] || job.results[modelId].status !== 'completed') {
    //     console.error(`[Decomposition] Model ${modelId} not found or not completed in job ${jobId}.`);
    //     return res.status(404).json({ error: `Model ${modelId} not found or not completed.` });
    // }
    if (!modelSpecification || typeof modelSpecification !== 'object' || !modelSpecification.regressors_with_lags) {
        console.error(`[Decomposition] Invalid or missing 'modelSpecification' in request body.`);
        return res.status(400).json({ error: 'Invalid or missing modelSpecification in request body.' });
    }
    if (typeof modelSpecification.include_constant === 'undefined') {
         console.warn(`[Decomposition] 'include_constant' missing in modelSpecification, defaulting to true.`);
         modelSpecification.include_constant = true; // Default if not provided
    }

    // --- Prepare Payload for Python Script ---
    const payload = {
        model_id: modelId, // Pass model ID for logging in Python
        dependentVariable: job.dependentVariable, // Get Y data from the stored job
        regressors: job.regressors, // Get ALL original X data from the stored job
        modelSpecification: modelSpecification // Get the specific model details from the request body
    };

    // --- Run Python Script ---
    const scriptPath = path.join(__dirname, 'python_scripts', 'step4_calculate_decomposition.py');
    console.log(`[Decomposition] Calling Python script for model ${modelId} in job ${jobId}...`);

    try {
        const result = await runPythonScript(scriptPath, [], payload);

        // Check for errors reported by the script itself
        if (result && result.error) {
            throw new Error(result.error);
        }

        // Check if the result has the expected structure
        if (result && result.actual_y && result.predicted_y && result.contributions) {
            console.log(`[Decomposition] Script successful for model ${modelId}. Returning data.`);
            res.json(result); // Send the decomposition data back
        } else {
            // Handle unexpected successful output structure
            console.warn(`[Decomposition] Script for model ${modelId} returned unexpected structure:`, result);
            throw new Error("Decomposition script returned invalid data structure.");
        }
    } catch (error) {
        // Handle errors from runPythonScript or thrown above
        console.error(`[Decomposition] Error processing model ${modelId} in job ${jobId}:`, error.message);
        res.status(500).json({ error: error.message || `Failed to calculate decomposition for model ${modelId}.` });
    }
});
// +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
// +++ END OF NEW ENDPOINT +++
// +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++


// -----------------------------------------------------------------------------
// START SERVER
// -----------------------------------------------------------------------------
app.listen(port, () => {
    console.log(`\n VIBE_MODELLING Backend server listening at http://localhost:${port} `);
    console.log(` Using Python command: ${pythonCommand} \n`);
});

// --- End of File ---