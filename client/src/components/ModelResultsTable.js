import React, { useMemo, useState, useEffect } from 'react';
import {
    useReactTable,
    getCoreRowModel,
    getSortedRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    flexRender,
} from '@tanstack/react-table';
import './ModelResultsTable.css';

// --- Вспомогательные компоненты для фильтрации ---

function GlobalFilter({ filter, setFilter }) {
    const [value, setValue] = useState(filter ?? '');
    useEffect(() => {
        const timeout = setTimeout(() => {
            setFilter(value || undefined);
        }, 300);
        return () => clearTimeout(timeout);
    }, [value, setFilter]);

    return (
        <span className="global-filter table-control-item">
            Search:{' '}
            <input
                value={value}
                onChange={e => setValue(e.target.value)}
                placeholder={`Search records...`}
                className="global-filter-input"
            />
        </span>
    );
}

function ColumnFilter({ column }) {
    const filterValue = column.getFilterValue();
    return (
        <input
            type="text"
            value={(filterValue ?? '')}
            onChange={e => column.setFilterValue(e.target.value)}
            placeholder={`Filter...`}
            className="column-filter-input"
            onClick={(e) => e.stopPropagation()}
        />
    );
}

// --- Основной компонент таблицы ---

function ModelResultsTable({ modelData, onRowClick, selectedModelId }) {

    const [sorting, setSorting] = useState([]);
    const [columnFilters, setColumnFilters] = useState([]);
    const [globalFilter, setGlobalFilter] = useState('');
    const [pagination, setPagination] = useState({
        pageIndex: 0,
        pageSize: 30, // <<< ИЗМЕНЕНИЕ ЗДЕСЬ: Установлено 30 по умолчанию
    });

    const data = useMemo(() => {
        if (!modelData) return [];
        return Object.entries(modelData)
            .filter(([id, result]) => result?.status === 'completed')
            .map(([id, result]) => ({
                model_id: id,
                is_valid: result.data?.is_valid,
                n_obs: result.data?.n_obs,
                r_squared: result.data?.metrics?.r_squared,
                adj_r_squared: result.data?.metrics?.adj_r_squared,
                mae: result.data?.metrics?.mae,
                mape: result.data?.metrics?.mape,
                rmse: result.data?.metrics?.rmse,
                aic: result.data?.aic,
                bic: result.data?.bic,
                p_value_ok: result.data?.test_results?.p_value_ok,
                vif_ok: result.data?.test_results?.vif_ok,
                heteroskedasticity_ok: result.data?.test_results?.heteroskedasticity_ok,
            }));
    }, [modelData]);

    const formatNumber = (value, digits = 3) => value?.toFixed ? value.toFixed(digits) : (value ?? '');
    const formatBoolean = (value) => value === true ? '✅' : (value === false ? '❌' : '');

    const columns = useMemo(() => [
        { accessorKey: 'model_id', header: 'ID', enableColumnFilter: false, enableSorting: false, className: 'col-model-id' },
        { accessorKey: 'is_valid', header: 'Valid', cell: info => formatBoolean(info.getValue()), enableColumnFilter: false, className: 'col-valid' },
        { accessorKey: 'n_obs', header: 'N Obs', enableColumnFilter: false, className: 'col-nobs numeric' },
        { accessorKey: 'r_squared', header: 'R²', cell: info => formatNumber(info.getValue(), 3), className: 'numeric' },
        { accessorKey: 'adj_r_squared', header: 'Adj R²', cell: info => formatNumber(info.getValue(), 3), className: 'numeric' },
        { accessorKey: 'mae', header: 'MAE', cell: info => formatNumber(info.getValue(), 3), className: 'numeric' },
        { accessorKey: 'mape', header: 'MAPE', cell: info => formatNumber(info.getValue(), 2), className: 'numeric' },
        { accessorKey: 'rmse', header: 'RMSE', cell: info => formatNumber(info.getValue(), 3), className: 'numeric' },
        { accessorKey: 'aic', header: 'AIC', cell: info => formatNumber(info.getValue(), 2), className: 'numeric' },
        { accessorKey: 'bic', header: 'BIC', cell: info => formatNumber(info.getValue(), 2), className: 'numeric' },
        { accessorKey: 'p_value_ok', header: 'PVal OK', cell: info => formatBoolean(info.getValue()), enableColumnFilter: false, className: 'col-test' },
        { accessorKey: 'vif_ok', header: 'VIF OK', cell: info => formatBoolean(info.getValue()), enableColumnFilter: false, className: 'col-test' },
        { accessorKey: 'heteroskedasticity_ok', header: 'Hetero OK', cell: info => formatBoolean(info.getValue()), enableColumnFilter: false, className: 'col-test' },
    ], []);

    const defaultColumn = useMemo(() => ({
        Filter: ColumnFilter,
    }), []);

    const table = useReactTable({
        data,
        columns,
        state: {
            sorting,
            columnFilters,
            globalFilter,
            pagination,
        },
        onSortingChange: setSorting,
        onColumnFiltersChange: setColumnFilters,
        onGlobalFilterChange: setGlobalFilter,
        onPaginationChange: setPagination,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        autoResetPageIndex: false,
        // debugTable: true,
    });

    // --- Рендер компонента ---

    if (!modelData) {
        return <div className="table-placeholder">Waiting for model results...</div>;
    }
    if (data.length === 0) {
         return <div className="table-placeholder">No completed models found to display.</div>;
    }

    return (
        <div className="model-results-table-container">
            <div className="table-controls-top">
                 <GlobalFilter
                    filter={globalFilter}
                    setFilter={setGlobalFilter}
                />
            </div>

            <div className="table-wrapper">
                <table className="model-results-table">
                    <thead>
                        {table.getHeaderGroups().map(headerGroup => (
                            <tr key={headerGroup.id}>
                                {headerGroup.headers.map(header => (
                                    <th
                                        key={header.id}
                                        colSpan={header.colSpan}
                                        className={`${header.column.columnDef.className || ''} ${header.column.getCanSort() ? 'sortable' : ''}`}
                                        style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                                        onClick={header.column.getToggleSortingHandler()}
                                    >
                                        {header.isPlaceholder
                                            ? null
                                            : flexRender(
                                                  header.column.columnDef.header,
                                                  header.getContext()
                                              )}
                                        <span className="sort-icon">
                                            {{
                                                asc: ' ▲',
                                                desc: ' ▼',
                                            }[header.column.getIsSorted()] ?? null}
                                        </span>
                                        {header.column.getCanFilter() ? (
                                            <div><ColumnFilter column={header.column} /></div>
                                        ) : null}
                                    </th>
                                ))}
                            </tr>
                        ))}
                    </thead>
                    <tbody>
                        {table.getRowModel().rows.map(row => {
                            const isSelected = row.original.model_id === selectedModelId;
                            return (
                                <tr
                                    key={row.id}
                                    onClick={() => onRowClick(row.original.model_id)}
                                    className={isSelected ? 'selected-row' : ''}
                                >
                                    {row.getVisibleCells().map(cell => (
                                        <td key={cell.id} className={cell.column.columnDef.className || ''} style={{ width: cell.column.getSize() !== 150 ? cell.column.getSize() : undefined }}>
                                            {flexRender(
                                                cell.column.columnDef.cell,
                                                cell.getContext()
                                            )}
                                        </td>
                                    ))}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <div className="pagination table-controls-bottom">
                <button onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage()}>{'<<'}</button>{' '}
                <button onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>{'<'}</button>{' '}
                <button onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>{'>'}</button>{' '}
                <button onClick={() => table.setPageIndex(table.getPageCount() - 1)} disabled={!table.getCanNextPage()}>{'>>'}</button>{' '}
                <span className="page-info">
                    Page{' '}
                    <strong>
                        {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
                    </strong>{' '}
                </span>
                <span className="goto-page">
                    | Go to page:{' '}
                    <input
                        type="number"
                        defaultValue={table.getState().pagination.pageIndex + 1}
                        onChange={e => {
                            const page = e.target.value ? Number(e.target.value) - 1 : 0;
                            table.setPageIndex(page);
                        }}
                        style={{ width: '60px' }}
                    />
                </span>{' '}
                <select
                    className="page-size-select"
                    value={table.getState().pagination.pageSize}
                    onChange={e => table.setPageSize(Number(e.target.value))}
                >
                    {/* <<< ИЗМЕНЕНИЕ ЗДЕСЬ: Добавлено 30 в массив опций */}
                    {[10, 15, 25, 30, 50, 100].map(size => (
                        <option key={size} value={size}>
                            Show {size}
                        </option>
                    ))}
                </select>
            </div>
        </div>
    );
}

ModelResultsTable.defaultProps = {
    onRowClick: (modelId) => console.log('Table row clicked (default handler):', modelId),
    selectedModelId: null,
};

export default ModelResultsTable;