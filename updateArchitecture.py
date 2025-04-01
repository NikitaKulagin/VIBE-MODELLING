#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Обновлённый скрипт для автоматического обновления ARCHITECTURE.md.
Поддерживаются файлы: Swift, Python, JavaScript и HTML.
Парсинг включает:
  - Извлечение комментариев (однострочных и многострочных) для файлов, классов и функций.
  - Для классов/структур – сохранение списка полей и методов.
  - По файлам и функциям – поиск импортов/подключений к другим файлам проекта.
Добавлена возможность игнорировать указанные директории и файлы.
"""

import os
import re
import argparse

# ==============================
# Параметры командной строки для игнорирования
# ==============================
def parse_args():
    parser = argparse.ArgumentParser(
        description="Обновление ARCHITECTURE.md с извлечением информации о проекте."
    )
    parser.add_argument(
        "--ignore-dir",
        action="append",
        help="Директория для игнорирования (можно указывать несколько раз)",
    )
    parser.add_argument(
        "--ignore-file",
        action="append",
        help="Файл для игнорирования (можно указывать несколько раз)",
    )
    return parser.parse_args()


# Глобальные переменные для игнорируемых директорий и файлов
ARGS = parse_args()
IGNORED_DIRS = ARGS.ignore_dir if ARGS.ignore_dir else []
IGNORED_FILES = ARGS.ignore_file if ARGS.ignore_file else []

# ==============================
# Регулярные выражения
# ------------------------------
# Swift
SWIFT_CLASS_REGEX = r'^\s*(class|struct)\s+([A-Za-z0-9_]+)'
SWIFT_FUNC_REGEX = r'^\s*func\s+([A-Za-z0-9_]+)\('
SWIFT_FIELD_REGEX = r'^\s*(var|let)\s+([A-Za-z0-9_]+)\s*[:=]'
SWIFT_DOC_REGEX = r'^\s*///\s*(.*)'

# Python
PYTHON_CLASS_REGEX = r'^\s*class\s+([A-Za-z0-9_]+)\s*(\(|:)'
PYTHON_FUNC_REGEX = r'^\s*def\s+([A-Za-z0-9_]+)\('

# JavaScript
JS_CLASS_REGEX = r'^\s*class\s+([A-Za-z0-9_]+)\s*(?:extends\s+[A-Za-z0-9_]+\s*)?{'
JS_FUNC_REGEX = r'^\s*function\s+([A-Za-z0-9_]+)\s*\('
# Обновлённый шаблон для методов: исключаем зарезервированные слова (if, for, while, switch, catch, function)
JS_METHOD_REGEX = r'^\s*(?!if\b|for\b|while\b|switch\b|catch\b|function\b)([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*{'
JS_FIELD_REGEX = r'^\s*([A-Za-z0-9_]+)\s*=\s*.+;'

# ==============================
# Вспомогательная функция для поиска импортов
# ==============================
def extract_imports_from_file(lines, lang, project_files):
    """
    Извлекает строки импортов/подключений из переданных строк файла
    для указанного языка. Фильтрует только те импорты, которые, по
    эвристике, относятся к файлам проекта.
    """
    imports = []
    if lang == "python":
        import_regex = re.compile(r'^\s*(import\s+([A-Za-z0-9_\.]+)|from\s+([A-Za-z0-9_\.]+)\s+import)')
        for line in lines:
            m = import_regex.match(line)
            if m:
                module = m.group(2) or m.group(3)
                # Если относительный импорт или если по имени найден файл
                if module.startswith('.'):
                    imports.append(module)
                else:
                    for pf in project_files:
                        if pf.endswith(module.replace('.', os.sep) + ".py") or pf.endswith(module + ".py"):
                            imports.append(module)
                            break
    elif lang == "swift":
        import_regex = re.compile(r'^\s*import\s+([A-Za-z0-9_]+)')
        for line in lines:
            m = import_regex.match(line)
            if m:
                module = m.group(1)
                for pf in project_files:
                    if pf.lower().endswith(module.lower() + ".swift"):
                        imports.append(module)
                        break
    elif lang == "js":
        import_regex = re.compile(r'^\s*import\s+.*\s+from\s+[\'"](.+?)[\'"]')
        require_regex = re.compile(r'^\s*(?:const|let|var)\s+.*=\s+require\([\'"](.+?)[\'"]\)')
        for line in lines:
            m = import_regex.match(line)
            if m:
                module = m.group(1)
                if module.startswith('.') or module.startswith('/'):
                    imports.append(module)
                else:
                    for pf in project_files:
                        if pf.lower().endswith(module.lower() + ".js"):
                            imports.append(module)
                            break
            else:
                m = require_regex.match(line)
                if m:
                    module = m.group(1)
                    if module.startswith('.') or module.startswith('/'):
                        imports.append(module)
                    else:
                        for pf in project_files:
                            if pf.lower().endswith(module.lower() + ".js"):
                                imports.append(module)
                                break
    elif lang == "html":
        script_regex = re.compile(r'<script\s+[^>]*src=["\'](.+?)["\']', re.IGNORECASE)
        link_regex = re.compile(r'<link\s+[^>]*href=["\'](.+?)["\']', re.IGNORECASE)
        for line in lines:
            m = script_regex.search(line)
            if m:
                src = m.group(1)
                if not (src.startswith("http://") or src.startswith("https://") or src.startswith("//")):
                    imports.append(src)
            m = link_regex.search(line)
            if m:
                href = m.group(1)
                if not (href.startswith("http://") or href.startswith("https://") or href.startswith("//")):
                    imports.append(href)
    return list(set(imports))  # Убираем дубли

# ==============================
# Функция генерации дерева папок
# ==============================
def generate_directory_tree(root_dir):
    """
    Рекурсивно генерирует строковое представление структуры папок
    в виде дерева, аналогичного выводу команды tree.
    Если директория указана в IGNORED_DIRS, то ее содержимое не раскрывается,
    а отображается как "└── ..." в дереве.
    """
    tree_lines = []
    def _tree(current_dir, prefix=""):
        try:
            entries = sorted(os.listdir(current_dir))
        except PermissionError:
            return
        # Исключаем скрытые файлы/директории
        entries = [e for e in entries if not e.startswith('.')]
        entries_count = len(entries)
        for idx, entry in enumerate(entries):
            path = os.path.join(current_dir, entry)
            connector = "└── " if idx == entries_count - 1 else "├── "
            if os.path.isdir(path):
                # Если директория игнорируется, показываем её и вместо содержимого выводим "..."
                if entry in IGNORED_DIRS:
                    tree_lines.append(prefix + connector + entry + "/")
                    extension = "    " if idx == entries_count - 1 else "│   "
                    tree_lines.append(prefix + extension + "└── ...")
                else:
                    tree_lines.append(prefix + connector + entry + "/")
                    extension = "    " if idx == entries_count - 1 else "│   "
                    _tree(path, prefix + extension)
            else:
                tree_lines.append(prefix + connector + entry)
    tree_lines.append(os.path.basename(root_dir) + "/")
    _tree(root_dir)
    return "\n".join(tree_lines)

# ==============================
# Обновлённый парсер Python-файлов
# ==============================
def parse_python_file(file_path, root_dir, project_files):
    """
    Парсит Python-файл: ищет классы и функции, для классов дополнительно
    извлекает поля (присваивания) и методы, а также пытается вычленить docstring
    или блок комментариев. Также собирает строки импортов и комментарии уровня файла.
    """
    results = []
    with open(file_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    file_imports = extract_imports_from_file(lines, "python", project_files)
    total_lines = len(lines)

    # Извлечение комментариев уровня файла (docstring или комментарии с #)
    file_description = ""
    idx = 0
    while idx < total_lines and lines[idx].strip() == "":
        idx += 1
    if idx < total_lines:
        stripped = lines[idx].strip()
        if stripped.startswith('"""') or stripped.startswith("'''"):
            delimiter = stripped[:3]
            if stripped.count(delimiter) >= 2 and len(stripped) > 6:
                file_description = stripped.strip(delimiter).strip()
                idx += 1
            else:
                doc_lines = []
                idx += 1
                while idx < total_lines and delimiter not in lines[idx]:
                    doc_lines.append(lines[idx].strip())
                    idx += 1
                if idx < total_lines:
                    last_line = lines[idx].strip().replace(delimiter, "").strip()
                    if last_line:
                        doc_lines.append(last_line)
                    idx += 1
                file_description = " ".join(doc_lines)
        elif stripped.startswith("#"):
            comment_lines = []
            while idx < total_lines and lines[idx].strip().startswith("#"):
                comment_lines.append(lines[idx].strip()[1:].strip())
                idx += 1
            file_description = " ".join(comment_lines)
    
    if file_description:
        results.append({
            "type": "file_comment",
            "name": os.path.basename(file_path),
            "description": file_description
        })

    i = idx
    while i < total_lines:
        line = lines[i]
        stripped = line.strip()
        # Обнаружение класса
        class_match = re.match(PYTHON_CLASS_REGEX, stripped)
        if class_match:
            class_name = class_match.group(1)
            class_description = ""
            j = i + 1
            while j < total_lines and lines[j].strip() == "":
                j += 1
            if j < total_lines:
                if lines[j].strip().startswith('"""') or lines[j].strip().startswith("'''"):
                    delimiter = lines[j].strip()[:3]
                    if lines[j].strip().count(delimiter) >= 2 and len(lines[j].strip()) > 6:
                        class_description = lines[j].strip().strip(delimiter).strip()
                        j += 1
                    else:
                        doc_lines = []
                        j += 1
                        while j < total_lines and delimiter not in lines[j]:
                            doc_lines.append(lines[j].strip())
                            j += 1
                        if j < total_lines:
                            last_line = lines[j].strip().replace(delimiter, "").strip()
                            if last_line:
                                doc_lines.append(last_line)
                            j += 1
                        class_description = " ".join(doc_lines)
                elif lines[j].strip().startswith("#"):
                    comment_lines = []
                    while j < total_lines and lines[j].strip().startswith("#"):
                        comment_lines.append(lines[j].strip()[1:].strip())
                        j += 1
                    class_description = " ".join(comment_lines)
            # Считываем блок класса по отступам
            class_indent = len(line) - len(line.lstrip())
            block_lines = []
            while j < total_lines:
                if lines[j].strip() == "":
                    j += 1
                    continue
                current_indent = len(lines[j]) - len(lines[j].lstrip())
                if current_indent <= class_indent:
                    break
                block_lines.append(lines[j])
                j += 1
            # Извлечение методов и полей из блока класса
            methods = []
            fields = []
            k = 0
            while k < len(block_lines):
                sub_line = block_lines[k]
                sub_stripped = sub_line.strip()
                func_match = re.match(PYTHON_FUNC_REGEX, sub_stripped)
                if func_match:
                    method_name = func_match.group(1)
                    method_doc = ""
                    if k+1 < len(block_lines) and (block_lines[k+1].strip().startswith('"""') or block_lines[k+1].strip().startswith("'''")):
                        delimiter = block_lines[k+1].strip()[:3]
                        if block_lines[k+1].strip().count(delimiter) >= 2 and len(block_lines[k+1].strip()) > 6:
                            method_doc = block_lines[k+1].strip().strip(delimiter).strip()
                            k += 2
                        else:
                            doc_lines = []
                            k += 2
                            while k < len(block_lines) and delimiter not in block_lines[k]:
                                doc_lines.append(block_lines[k].strip())
                                k += 1
                            if k < len(block_lines):
                                last_line = block_lines[k].strip().replace(delimiter, "").strip()
                                if last_line:
                                    doc_lines.append(last_line)
                                k += 1
                            method_doc = " ".join(doc_lines)
                    elif k+1 < len(block_lines) and block_lines[k+1].strip().startswith("#"):
                        comment_lines = []
                        k += 1
                        while k < len(block_lines) and block_lines[k].strip().startswith("#"):
                            comment_lines.append(block_lines[k].strip()[1:].strip())
                            k += 1
                        method_doc = " ".join(comment_lines)
                    else:
                        k += 1
                    methods.append({
                        "name": method_name,
                        "description": method_doc,
                        "imports": []  # Для простоты не ищем импорты внутри методов
                    })
                else:
                    # Поиск полей – строки с присваиванием на уровне класса
                    field_match = re.match(r'^\s*([A-Za-z0-9_]+)\s*=\s*.+', sub_line)
                    if field_match:
                        fields.append(field_match.group(1))
                    k += 1
            results.append({
                "type": "class",
                "name": class_name,
                "description": class_description,
                "fields": fields,
                "methods": methods,
                "imports": []
            })
            i = j
            continue
        # Обнаружение функции на верхнем уровне
        func_match = re.match(PYTHON_FUNC_REGEX, stripped)
        if func_match:
            func_name = func_match.group(1)
            func_doc = ""
            j = i + 1
            while j < total_lines and lines[j].strip() == "":
                j += 1
            if j < total_lines:
                if lines[j].strip().startswith('"""') or lines[j].strip().startswith("'''"):
                    delimiter = lines[j].strip()[:3]
                    if lines[j].strip().count(delimiter) >= 2 and len(lines[j].strip()) > 6:
                        func_doc = lines[j].strip().strip(delimiter).strip()
                        j += 1
                    else:
                        doc_lines = []
                        j += 1
                        while j < total_lines and delimiter not in lines[j]:
                            doc_lines.append(lines[j].strip())
                            j += 1
                        if j < total_lines:
                            last_line = lines[j].strip().replace(delimiter, "").strip()
                            if last_line:
                                doc_lines.append(last_line)
                            j += 1
                        func_doc = " ".join(doc_lines)
                elif lines[j].strip().startswith("#"):
                    comment_lines = []
                    while j < total_lines and lines[j].strip().startswith("#"):
                        comment_lines.append(lines[j].strip()[1:].strip())
                        j += 1
                    func_doc = " ".join(comment_lines)
            results.append({
                "type": "def",
                "name": func_name,
                "description": func_doc,
                "imports": []
            })
            i = j
            continue
        i += 1
    if file_imports:
        results.append({
            "type": "file_imports",
            "name": os.path.basename(file_path),
            "imports": file_imports
        })
    return results

# ==============================
# Парсинг JavaScript
# ==============================
def parse_js_file(file_path, root_dir, project_files):
    """
    Парсит JS-файл: ищет объявления классов (с методами и полями) и функций.
    Для накопления комментариев учитываются как однострочные (//) так и многострочные (/* … */).
    Также собираются импорты.
    """
    results = []
    with open(file_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    file_imports = extract_imports_from_file(lines, "js", project_files)
    doc_buffer = []
    i = 0
    total_lines = len(lines)
    while i < total_lines:
        line = lines[i]
        stripped = line.strip()
        # Накопление однострочных комментариев
        if stripped.startswith("//"):
            doc_buffer.append(stripped[2:].strip())
            i += 1
            continue
        # Накопление многострочных комментариев
        if stripped.startswith("/*"):
            comment_content = stripped.lstrip("/*").strip()
            while i < total_lines and "*/" not in lines[i]:
                i += 1
                if i < total_lines:
                    comment_line = lines[i].strip()
                    if "*/" in comment_line:
                        comment_line = comment_line.split("*/")[0]
                    comment_content += " " + comment_line
            doc_buffer.append(comment_content.strip())
            i += 1
            continue
        # Обнаружение класса
        class_match = re.match(JS_CLASS_REGEX, stripped)
        if class_match:
            class_name = class_match.group(1)
            description = " ".join(doc_buffer) if doc_buffer else ""
            doc_buffer = []
            # Извлекаем тело класса (подсчёт фигурных скобок)
            body_lines = []
            brace_count = 0
            if "{" in line:
                brace_count += line.count("{") - line.count("}")
            j = i + 1
            while j < total_lines and brace_count > 0:
                body_line = lines[j]
                brace_count += body_line.count("{") - body_line.count("}")
                body_lines.append(body_line)
                j += 1
            methods = []
            fields = []
            for bl in body_lines:
                bl_stripped = bl.strip()
                m_method = re.match(JS_METHOD_REGEX, bl_stripped)
                if m_method:
                    methods.append(m_method.group(1))
                m_field = re.match(JS_FIELD_REGEX, bl_stripped)
                if m_field:
                    fields.append(m_field.group(1))
            results.append({
                "type": "class",
                "name": class_name,
                "description": description,
                "fields": fields,
                "methods": methods,
                "imports": []
            })
            i = j
            continue
        # Обнаружение функции (топ-левел)
        func_match = re.match(JS_FUNC_REGEX, stripped)
        if func_match:
            func_name = func_match.group(1)
            description = " ".join(doc_buffer) if doc_buffer else ""
            doc_buffer = []
            results.append({
                "type": "function",
                "name": func_name,
                "description": description,
                "imports": []
            })
            i += 1
            continue
        i += 1
    if file_imports:
        results.append({
            "type": "file_imports",
            "name": os.path.basename(file_path),
            "imports": file_imports
        })
    return results

# ==============================
# Парсинг HTML
# ==============================
def parse_html_file(file_path, root_dir, project_files):
    """
    Для HTML-файлов парсинг сводится к извлечению внешних подключений –
    тегов <script src="..."> и <link href="...">, которые являются ссылками на
    файлы проекта.
    """
    results = []
    with open(file_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    file_imports = extract_imports_from_file(lines, "html", project_files)
    results.append({
        "type": "html",
        "name": os.path.basename(file_path),
        "description": "HTML файл",
        "imports": file_imports
    })
    return results

# ==============================
# Основная функция
# ==============================
def main():
    root_dir = os.path.dirname(os.path.abspath(__file__))
    arch_file = os.path.join(root_dir, "ARCHITECTURE.md")
    structure_data = {}

    # Собираем множество файлов проекта (относительные пути)
    project_files = set()
    for current_path, dirs, files in os.walk(root_dir):
        dirs[:] = [d for d in dirs if not d.startswith('.') and d not in IGNORED_DIRS]
        rel_path = os.path.relpath(current_path, root_dir)
        if rel_path == ".":
            rel_path = "."
        for file_name in files:
            if file_name.startswith('.') or file_name in IGNORED_FILES:
                continue
            rel_file = os.path.join(rel_path, file_name)
            project_files.add(rel_file)

    # Второй обход для сбора подробной информации
    for current_path, dirs, files in os.walk(root_dir):
        dirs[:] = [d for d in dirs if not d.startswith('.') and d not in IGNORED_DIRS]
        rel_path = os.path.relpath(current_path, root_dir)
        if rel_path == ".":
            rel_path = "."
        if rel_path not in structure_data:
            structure_data[rel_path] = {
                "files": [],
                "details": []
            }
        for file_name in files:
            if file_name.startswith('.') or file_name in IGNORED_FILES:
                continue
            file_path = os.path.join(current_path, file_name)
            structure_data[rel_path]["files"].append(file_name)
            lower_name = file_name.lower()
            parsed = None
            if lower_name.endswith(".swift"):
                parsed = parse_swift_file(file_path, root_dir, project_files)
                lang = "swift"
            elif lower_name.endswith(".py"):
                parsed = parse_python_file(file_path, root_dir, project_files)
                lang = "python"
            elif lower_name.endswith(".js"):
                parsed = parse_js_file(file_path, root_dir, project_files)
                lang = "js"
            elif lower_name.endswith(".html"):
                parsed = parse_html_file(file_path, root_dir, project_files)
                lang = "html"
            if parsed:
                structure_data[rel_path]["details"].append({
                    "filename": file_name,
                    "lang": lang,
                    "elements": parsed
                })

    # Генерируем дерево папок проекта и вставляем его в начало контента
    tree_text = generate_directory_tree(root_dir)
    lines = []
    lines.append("## Структура проекта")
    lines.append("")
    lines.append("```")
    lines.extend(tree_text.splitlines())
    lines.append("```")
    lines.append("")

    # Формируем оставшуюся часть содержимого ARCHITECTURE.md как список строк
    for path_key in sorted(structure_data.keys()):
        lines.append(f"### Папка: {path_key}")
        files_list = structure_data[path_key]["files"]
        details_list = structure_data[path_key]["details"]
        if files_list:
            lines.append("Содержимые файлы:")
            for fn in sorted(files_list):
                lines.append(f"- {fn}")
        else:
            lines.append("*(Нет файлов)*")
        if details_list:
            lines.append("\n**Детали по файлам:**")
            for detail in details_list:
                fname = detail["filename"]
                lang = detail["lang"]
                # Оборачиваем обработку файла в try/except для логирования имени файла при ошибке
                try:
                    lines.append(f"- **Файл**: {fname} (язык: {lang})")
                    for elem in detail["elements"]:
                        elem_type = elem.get("type", "")
                        elem_name = elem.get("name", "")
                        description = elem.get("description", "")
                        lines.append(f"  - {elem_type.capitalize()}: **{elem_name}**")
                        if description:
                            lines.append(f"    - *Описание:* {description}")
                        if elem.get("fields"):
                            lines.append(f"    - *Поля:* {', '.join(elem['fields'])}")
                        if elem.get("methods"):
                            for m in elem['methods']:
                                if isinstance(m, dict):
                                    mname = m.get("name", "")
                                    mdesc = m.get("description", "")
                                    if mdesc:
                                        lines.append(f"    - *Метод:* {mname} - {mdesc}")
                                    else:
                                        lines.append(f"    - *Метод:* {mname}")
                                else:
                                    # Если m не словарь, то предполагаем, что это строка
                                    lines.append(f"    - *Метод:* {m}")
                        if elem.get("imports"):
                            lines.append(f"    - *Импорты:* {', '.join(elem['imports'])}")
                except Exception as e:
                    lines.append(f"**Ошибка при обработке файла {fname}: {str(e)}**")
        lines.append("")
    return lines

# ==============================
# Обновление ARCHITECTURE.md
# ==============================
def update_architecture_md(content_lines):
    """
    Обновляет файл ARCHITECTURE.md, вставляя сгенерированный контент между маркерами.
    Если маркеры отсутствуют, они добавляются в конец файла.
    """
    root_dir = os.path.dirname(os.path.abspath(__file__))
    arch_file = os.path.join(root_dir, "ARCHITECTURE.md")
    auto_gen_start = '<!-- AUTO-GENERATED-CONTENT:START -->'
    auto_gen_end = '<!-- AUTO-GENERATED-CONTENT:END -->'
    new_auto_content = "\n".join(content_lines)
    if os.path.exists(arch_file):
        with open(arch_file, "r", encoding="utf-8") as f:
            existing_content = f.read()
    else:
        existing_content = f"# ARCHITECTURE.md\n\n{auto_gen_start}\n{auto_gen_end}\n"
    pattern = re.compile(
        r'(?P<before>.*?){start_marker}.*?{end_marker}(?P<after>.*)'.format(
            start_marker=re.escape(auto_gen_start),
            end_marker=re.escape(auto_gen_end)
        ),
        re.DOTALL
    )
    match = pattern.match(existing_content)
    if match:
        updated_content = "{before}{start}\n{content}\n{end}{after}".format(
            before=match.group('before'),
            start=auto_gen_start,
            content=new_auto_content,
            end=auto_gen_end,
            after=match.group('after')
        )
    else:
        updated_content = existing_content + "\n{start}\n{content}\n{end}\n".format(
            start=auto_gen_start,
            content=new_auto_content,
            end=auto_gen_end
        )
    with open(arch_file, "w", encoding="utf-8") as f:
        f.write(updated_content)
    print(f"[OK] Файл ARCHITECTURE.md успешно обновлён в {arch_file}")

# ==============================
# Запуск скрипта
# ==============================
if __name__ == "__main__":
    lines = main()
    update_architecture_md(lines)
