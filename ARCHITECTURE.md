# ARCHITECTURE.md

<!-- AUTO-GENERATED-CONTENT:START -->
## Структура проекта

```
VIBE_MODELING/
├── VIBE_MODELLING.docx
├── Z1 Div and Corp Loans+levels.xlsx
├── client/
│   ├── README.md
│   ├── node_modules/
│   │   └── ...
│   ├── package-lock.json
│   ├── package.json
│   ├── public/
│   │   ├── favicon.ico
│   │   ├── index.html
│   │   ├── logo192.png
│   │   ├── logo512.png
│   │   ├── manifest.json
│   │   └── robots.txt
│   └── src/
│       ├── App.css
│       ├── App.js
│       ├── components/
│       │   ├── BlockOneDataImport.css
│       │   ├── BlockOneDataImport.js
│       │   ├── BlockTwoDataEnrichment.css
│       │   ├── BlockTwoDataEnrichment.js
│       │   └── TimeSeriesChart.js
│       ├── index.css
│       └── index.js
├── node_modules/
│   └── ...
├── package-lock.json
├── package.json
├── python_scripts/
│   ├── get_sheets.py
│   ├── step1_load_data.py
│   ├── step1b_aggregate_data.py
│   ├── step2_diff_abs.py
│   ├── step2_diff_pct.py
│   └── step2_normalize.py
├── server.js
├── updateArchitecture.py
└── uploads/
```

### Папка: .
Содержимые файлы:
- VIBE_MODELLING.docx
- Z1 Div and Corp Loans+levels.xlsx
- package-lock.json
- package.json
- server.js
- updateArchitecture.py

**Детали по файлам:**
- **Файл**: updateArchitecture.py (язык: python)
  - File_comment: **updateArchitecture.py**
    - *Описание:* !/usr/bin/env python3 -*- coding: utf-8 -*-
  - Def: **parse_args**
  - Def: **extract_imports_from_file**
    - *Описание:* Извлекает строки импортов/подключений из переданных строк файла для указанного языка. Фильтрует только те импорты, которые, по эвристике, относятся к файлам проекта.
  - Def: **generate_directory_tree**
    - *Описание:* Рекурсивно генерирует строковое представление структуры папок в виде дерева, аналогичного выводу команды tree. Если директория указана в IGNORED_DIRS, то ее содержимое не раскрывается, а отображается как "└── ..." в дереве.
  - Def: **_tree**
  - Def: **parse_python_file**
    - *Описание:* Парсит Python-файл: ищет классы и функции, для классов дополнительно извлекает поля (присваивания) и методы, а также пытается вычленить docstring или блок комментариев. Также собирает строки импортов и комментарии уровня файла.
  - Def: **parse_js_file**
    - *Описание:* Парсит JS-файл: ищет объявления классов (с методами и полями) и функций. Для накопления комментариев учитываются как однострочные (//) так и многострочные (/* … */). Также собираются импорты.
  - Def: **parse_html_file**
    - *Описание:* Для HTML-файлов парсинг сводится к извлечению внешних подключений – тегов <script src="..."> и <link href="...">, которые являются ссылками на файлы проекта.
  - Def: **main**
  - Def: **update_architecture_md**
    - *Описание:* Обновляет файл ARCHITECTURE.md, вставляя сгенерированный контент между маркерами. Если маркеры отсутствуют, они добавляются в конец файла.
  - File_imports: **updateArchitecture.py**
    - *Импорты:* re
- **Файл**: server.js (язык: js)
  - Function: **runPythonScript**
    - *Описание:* ----------------------------------------------------------------------------- REQUIRED MODULES ----------------------------------------------------------------------------- ----------------------------------------------------------------------------- EXPRESS APP INITIALIZATION & CONFIGURATION ----------------------------------------------------------------------------- Увеличиваем лимиты для обработки потенциально больших данных в JSON и URL-encoded формах ----------------------------------------------------------------------------- MULTER CONFIGURATION (for File Uploads) ----------------------------------------------------------------------------- ----------------------------------------------------------------------------- HELPER FUNCTION FOR RUNNING PYTHON SCRIPTS -----------------------------------------------------------------------------

### Папка: client
Содержимые файлы:
- README.md
- package-lock.json
- package.json

### Папка: client/public
Содержимые файлы:
- favicon.ico
- index.html
- logo192.png
- logo512.png
- manifest.json
- robots.txt

**Детали по файлам:**
- **Файл**: index.html (язык: html)
  - Html: **index.html**
    - *Описание:* HTML файл
    - *Импорты:* %PUBLIC_URL%/logo192.png, %PUBLIC_URL%/favicon.ico, %PUBLIC_URL%/manifest.json

### Папка: client/src
Содержимые файлы:
- App.css
- App.js
- index.css
- index.js

**Детали по файлам:**
- **Файл**: index.js (язык: js)
  - File_imports: **index.js**
    - *Импорты:* ./App
- **Файл**: App.js (язык: js)
  - Function: **App**
    - *Описание:* Импортируем все компоненты блоков import BlockThreeModeling from './components/BlockThreeModeling'; // Задел на будущее import BlockFourResults from './components/BlockFourResults'; // Задел на будущее --- Стили и иконка для кнопки Reset --- --- Конец стилей ---
  - File_imports: **App.js**
    - *Импорты:* ./components/TimeSeriesChart, ./components/BlockOneDataImport, ./components/BlockTwoDataEnrichment

### Папка: client/src/components
Содержимые файлы:
- BlockOneDataImport.css
- BlockOneDataImport.js
- BlockTwoDataEnrichment.css
- BlockTwoDataEnrichment.js
- TimeSeriesChart.js

**Детали по файлам:**
- **Файл**: BlockTwoDataEnrichment.js (язык: js)
  - Function: **BlockTwoDataEnrichment**
    - *Описание:* --- Иконка Карандаш --- --- Иконка Закрытия (для модального окна) --- --- Конец иконок --- --- Стили для модального окна (добавляем к существующим стилям) --- (Предполагается, что стили из BlockTwoDataEnrichment.css загружены) --- Конец стилей модального окна ---
- **Файл**: BlockOneDataImport.js (язык: js)
  - Function: **BlockOneDataImport**
    - *Описание:* --- Иконки --- --- Конец иконок ---

### Папка: python_scripts
Содержимые файлы:
- get_sheets.py
- step1_load_data.py
- step1b_aggregate_data.py
- step2_diff_abs.py
- step2_diff_pct.py
- step2_normalize.py

**Детали по файлам:**
- **Файл**: step2_normalize.py (язык: python)
  - Def: **log_error**
  - Def: **log_info**
  - Def: **normalize_series**
- **Файл**: step1b_aggregate_data.py (язык: python)
  - Def: **log_error**
  - Def: **log_warn**
  - Def: **log_info**
  - Def: **get_period_order**
  - Def: **aggregate_series_data**
- **Файл**: step1_load_data.py (язык: python)
  - Def: **safe_get_metadata**
    - *Описание:* ... (same as V9) ...
  - Def: **log_debug**
  - Def: **infer_frequency_robust_v10**
    - *Описание:* V10 Debug: Attempts pd.infer_freq first, then uses heuristics based on day differences.
  - Def: **detect_data_blocks_v8**
    - *Описание:* ... (detect_data_blocks_v8 function remains exactly the same as V8) ...
  - Def: **process_excel_universal_v10**
    - *Описание:* V10 uses detect_data_blocks_v8 and NEW infer_frequency_robust_v10
- **Файл**: step2_diff_pct.py (язык: python)
  - Def: **log_error**
  - Def: **log_info**
  - Def: **calculate_diff_pct**
- **Файл**: get_sheets.py (язык: python)
  - Def: **log_debug**
- **Файл**: step2_diff_abs.py (язык: python)
  - Def: **log_error**
  - Def: **log_info**
  - Def: **calculate_diff_abs**

### Папка: uploads
*(Нет файлов)*

<!-- AUTO-GENERATED-CONTENT:END -->
