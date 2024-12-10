import Schema, { ValidateError } from 'async-validator';
import type CellHeader from './CellHeader';
import type Context from './Context';
import type {
    CellReadonlyMethod,
    CellRulesMethod,
    ChangeItem,
    Column,
    FilterMethod,
    Position,
    Rules,
    SelectableMethod,
    EVirtTableOptions,
} from './types';
import { generateShortUUID } from './util';
import { HistoryItemData } from './History';
export default class Database {
    private loading = false;
    private ctx: Context;
    private data: any[];
    private columns: Column[];
    private footerData: any[] = [];
    private rowKeyMap = new Map();
    private colIndexKeyMap = new Map();
    private headerMap = new Map();
    private rowIndexRowKeyMap = new Map();
    private checkboxKeyMap = new Map();
    private originalDataMap = new Map();
    private changedDataMap = new Map();
    private validationErrorMap = new Map();
    private itemRowKeyMap = new WeakMap();
    private bufferData: any[] = [];
    private sumHeight = 0;
    private filterMethod: FilterMethod | undefined;
    private positions: Position[] = []; //虚拟滚动位置
    constructor(ctx: Context, options: EVirtTableOptions) {
        this.ctx = ctx;
        const { data = [], columns = [], footerData = [] } = options;
        this.data = data;
        this.footerData = footerData;
        this.columns = columns;
        this.setLoading(true);
        this.init();
    }
    init() {
        this.clearBufferData();
        this.rowKeyMap.clear();
        this.checkboxKeyMap.clear();
        this.colIndexKeyMap.clear();
        this.rowIndexRowKeyMap.clear();
        this.originalDataMap.clear();
        this.changedDataMap.clear();
        this.validationErrorMap.clear();
        this.itemRowKeyMap = new WeakMap();
        this.initData(this.data);
    }
    /**
     * 清除缓存数据
     */
    clearBufferData() {
        this.bufferData = [];
    }
    /**
     * 初始化数据
     * @param dataList
     * @param level
     */
    private initData(dataList: any[], level: number = 0) {
        dataList.forEach((item, index) => {
            let hasChildren = false;
            if (Array.isArray(item.children)) {
                hasChildren = true;
                this.initData(item.children, level + 1);
            }
            const { ROW_KEY = '', DEFAULT_EXPAND_ALL, CELL_HEIGHT, SELECTABLE_METHOD, CHECKBOX_KEY } = this.ctx.config;
            const _rowKey = item[ROW_KEY]; // 行唯一标识,否则就rowKey
            const rowKey = _rowKey !== undefined && _rowKey !== null ? _rowKey : generateShortUUID();
            this.itemRowKeyMap.set(item, rowKey);
            const height = item._height || CELL_HEIGHT;
            const readonly = item._readonly;
            let selectable: SelectableMethod | boolean = true;
            if (typeof SELECTABLE_METHOD === 'function') {
                const selectableMethod: SelectableMethod = SELECTABLE_METHOD;
                selectable = selectableMethod;
            }
            // 存储checkboxKey，处理合并单元格选中
            if (CHECKBOX_KEY) {
                const checkboxKey = item[CHECKBOX_KEY];
                if (this.checkboxKeyMap.has(checkboxKey)) {
                    const checkboxKeys = this.checkboxKeyMap.get(checkboxKey);
                    checkboxKeys.push(rowKey);
                    this.checkboxKeyMap.set(checkboxKey, checkboxKeys);
                } else {
                    this.checkboxKeyMap.set(checkboxKey, [rowKey]);
                }
            }
            this.rowKeyMap.set(rowKey, {
                readonly,
                index,
                rowIndex: index,
                level,
                height,
                check: false,
                selectable,
                expand: DEFAULT_EXPAND_ALL,
                expandLazy: false,
                hasChildren,
                expandLoading: false,
                item,
            });
        });
    }
    /**
     *
     * @param rowKey 设置Row高度
     * @param height
     */
    setRowHeight(rowIndex: number, height: number) {
        const rowKey = this.rowIndexRowKeyMap.get(rowIndex);
        const row = this.rowKeyMap.get(rowKey);
        row.height = height;
        row.item._height = height;
        this.clearBufferData(); // 清除缓存数据
    }
    /**
     *
     * @returns 获取转化平铺数据
     */
    getAllRowsData() {
        let list: any[] = [];
        const recursiveData = (data: any[]) => {
            data.forEach((item) => {
                list.push(item);
                if (Array.isArray(item.children)) {
                    recursiveData(item.children);
                }
            });
        };
        recursiveData(this.data);
        return list;
    }
    private filterColumns(columns: Column[]) {
        return columns.reduce((acc: Column[], column) => {
            // 检查当前列的 hide 属性
            const shouldHide = typeof column.hide === 'function' ? column.hide() : column.hide;
            // 如果当前列不应该隐藏，则添加到结果中
            if (!shouldHide) {
                const newColumn = { ...column }; // 复制当前列
                // 递归处理子列
                if (newColumn.children && Array.isArray(newColumn.children)) {
                    newColumn.children = this.filterColumns(newColumn.children);
                }
                acc.push(newColumn);
            }
            return acc;
        }, []);
    }
    getColumns() {
        return this.filterColumns(this.columns);
    }
    setColumns(columns: Column[]) {
        this.columns = columns;
        this.clearBufferData();
    }
    setData(data: any[]) {
        this.data = data;
        if (this.columns.length) {
            this.init();
        }
    }
    /**
     * 统一转化数据，给画body使用，包括过滤树状等，统一入口
     * @returns
     */
    getData() {
        if (this.bufferData.length > 0) {
            return {
                data: this.bufferData,
                sumHeight: this.sumHeight,
                positions: this.positions,
            };
        }
        let list: any[] = [];
        let rowIndex = 0;
        this.sumHeight = 0;
        this.positions = [];
        const recursiveData = (data: any[]) => {
            data.forEach((item) => {
                list.push(item);
                const rowKey = this.itemRowKeyMap.get(item);
                const { expand, hasChildren, height } = this.rowKeyMap.get(rowKey);
                const top = this.sumHeight;
                this.sumHeight += height;
                this.rowIndexRowKeyMap.set(rowIndex, rowKey);
                this.positions.push({
                    top,
                    height,
                    bottom: this.sumHeight,
                });
                rowIndex += 1;
                if (expand && hasChildren) {
                    recursiveData(item.children);
                }
            });
        };
        this.rowIndexRowKeyMap.clear();
        let _data = this.data;
        if (typeof this.filterMethod === 'function') {
            _data = this.filterMethod(_data);
        }
        recursiveData(_data);
        this.bufferData = list;
        return {
            data: list,
            sumHeight: this.sumHeight,
            positions: this.positions,
        };
    }
    setFooterData(data: any[]) {
        this.footerData = data;
    }
    getFooterData() {
        return this.footerData;
    }

    /**
     * 设置过滤方法
     */
    setFilterMethod(filterMethod: FilterMethod) {
        this.filterMethod = filterMethod;
    }
    /**
     * 清空过滤方法
     */
    clearFilterMethod() {
        this.filterMethod = undefined;
    }
    /**
     * 根据rowKey,控制指定展开行
     * @param rowKey
     * @param expand
     */
    expandItem(rowKey: string, expand = false) {
        const row = this.rowKeyMap.get(rowKey);
        row.expand = expand;
        this.clearBufferData(); // 清除缓存数据
        this.ctx.emit('draw');
    }
    expandAll(expand: boolean) {
        this.rowKeyMap.forEach((row: any) => {
            row.expand = expand;
        });
        this.clearBufferData(); // 清除缓存数据
        this.ctx.emit('draw');
    }
    expandLoading(rowKey: string, loading = false) {
        const row = this.rowKeyMap.get(rowKey);
        row.expandLoading = loading;
        this.clearBufferData(); // 清除缓存数据
        this.ctx.emit('draw');
    }
    setExpandChildren(rowKey: string, children: any[]) {
        const row = this.rowKeyMap.get(rowKey);
        row.expand = true;
        row.expandLazy = true;
        row.item.children = children;
        this.initData(row.item.children, row.level + 1);
        this.clearBufferData(); // 清除缓存数据
    }
    getIsExpandLoading(rowKey: string) {
        const row = this.rowKeyMap.get(rowKey);
        return row.expandLoading;
    }
    getIsExpandLazy(rowKey: string) {
        const row = this.rowKeyMap.get(rowKey);
        return row.expandLazy;
    }
    /**
     * 根据rowKey获取是否展开
     * @param rowKey
     * @returns
     */
    getIsExpand(rowKey: string) {
        const row = this.rowKeyMap.get(rowKey);
        return row.expand;
    }
    /**
     * 根据rowKey获取行数据
     * @param rowKey
     * @returns
     */
    getRowForRowKey(rowKey: string) {
        return this.rowKeyMap.get(rowKey);
    }
    /**
     * 根据rowIndex获取rowKey
     * @param rowKey
     * @returns
     */
    getRowKeyForRowIndex(rowIndex: number) {
        return this.rowIndexRowKeyMap.get(rowIndex);
    }
    getRowKeyByItem(item: any) {
        return this.itemRowKeyMap.get(item);
    }
    getRowIndexForRowKey(rowKey: string) {
        return this.rowKeyMap.get(rowKey).index;
    }
    /**
     * 根据rowIndex和colIndex获取单元格数据
     * @param rowIndex
     * @param colIndex
     * @returns
     */
    getItemValueForRowIndexAndColIndex(rowIndex: number, colIndex: number) {
        const has = this.rowIndexRowKeyMap.has(rowIndex) && this.colIndexKeyMap.get(colIndex);
        if (!has) {
            return null;
        }
        const rowKey = this.rowIndexRowKeyMap.get(rowIndex);
        const key = this.colIndexKeyMap.get(colIndex);
        return {
            rowKey,
            key,
            value: this.getItemValue(rowKey, key),
        };
    }
    /**
     * 根据rowKey和key获取单元格数据
     * @param rowKey
     * @param key
     * @returns
     */
    getItemValue(rowKey: string, key: string) {
        const row = this.rowKeyMap.get(rowKey);

        if (row && row.item) {
            if (row.item[key] === undefined) {
                return null;
            }
            return row.item[key];
        }
        return null;
    }
    /**
     * 批量设置数据
     * @param list
     * @param history
     * @returns
     */
    batchSetItemValue(list: ChangeItem[], history = false) {
        let changeList: HistoryItemData[] = [];
        const rowKeyList: Set<string> = new Set();
        list.forEach((data) => {
            const { value, rowKey, key } = data;
            const { oldValue, newValue } = this.setItemValue(rowKey, key, value);
            rowKeyList.add(rowKey);
            changeList.push({
                rowKey,
                key,
                oldValue,
                newValue,
            });
        });
        // 触发change事件
        let rows: any[] = [];
        const _changeList: ChangeItem[] = changeList.map((item) => {
            const row = this.ctx.database.getRowDataItemForRowKey(item.rowKey);
            return {
                rowKey: item.rowKey,
                key: item.key,
                value: item.newValue,
                row,
            };
        });
        rowKeyList.forEach((rowKey) => {
            rows.push(this.ctx.database.getRowDataItemForRowKey(rowKey));
        });
        this.ctx.emit('change', _changeList, rows);
        // 推历史记录
        if (history) {
            this.ctx.history.pushState({
                changeList,
                scrollX: this.ctx.scrollX,
                scrollY: this.ctx.scrollY,
                type: 'multiple',
            });
        }
        return changeList;
    }
    /**
     *设置单一数据
     * @param rowKey
     * @param key
     * @param value
     * @param history 是否添加历史记录
     * @param reDraw 是否刷新重绘
     * @param isEditor 是否是编辑器
     * @returns
     */
    setItemValue(rowKey: string, key: string, value: any, history = false, reDraw = false, isEditor = false) {
        // 异常情况
        if (!this.rowKeyMap.has(rowKey)) {
            return {};
        }
        const { item } = this.rowKeyMap.get(rowKey);
        let oldValue = item[key];
        // 只读返回旧值
        if (this.ctx.database.getReadonly(rowKey, key)) {
            return {
                oldValue,
                newValue: oldValue,
            };
        }
        // 处理对象
        if (item[key] !== null && typeof item[key] === 'object') {
            oldValue = JSON.parse(JSON.stringify(item[key]));
        }
        const changeKey = `${rowKey}\u200b_${key}`;
        // 设置原始值,只设置一次
        if (!this.originalDataMap.has(changeKey)) {
            this.originalDataMap.set(changeKey, oldValue);
        }
        this.changedDataMap.set(changeKey, value);
        item[key] = value;
        // 是否是否是编辑器进来的
        if (isEditor) {
            const row = this.ctx.database.getRowDataItemForRowKey(rowKey);
            const changeItem: ChangeItem = {
                rowKey,
                key,
                value,
                row,
            };
            this.ctx.emit('change', [changeItem], [row]);
            this.ctx.emit('editChange', {
                rowKey,
                key,
                oldValue,
                value,
                originalValue: this.originalDataMap.get(changeKey),
                row,
            });
        }
        // 迭代改变值事件,有改变一次值就触发，包括批量的
        if (this.ctx.hasEvent('iterationChange')) {
            this.ctx.emit('iterationChange', {
                rowKey,
                key,
                oldValue,
                value,
                originalValue: this.originalDataMap.get(changeKey),
                row: this.ctx.database.getRowDataItemForRowKey(rowKey),
            });
        }
        // 添加历史记录
        if (history) {
            this.ctx.history.pushState({
                type: 'single',
                scrollX: this.ctx.scrollX,
                scrollY: this.ctx.scrollY,
                changeList: [
                    {
                        rowKey,
                        key,
                        oldValue,
                        newValue: value,
                    },
                ],
            });
        }
        // 实时校验错误
        this.getValidator(rowKey, key);
        // 重绘
        if (reDraw) {
            this.ctx.emit('draw');
        }
        return {
            oldValue,
            newValue: value,
        };
    }
    /**
     * 根据rowKey 获取行数据
     * @param rowKey
     * @returns
     */
    getRowDataItemForRowKey(rowKey: string) {
        if (!this.rowKeyMap.has(rowKey)) {
            return {};
        }
        const { item } = this.rowKeyMap.get(rowKey);
        return item;
    }
    /**
     *
     * @param rowKey 设置选中状态ByCheckboxKey，用于合并Checkbox单元格时声明唯一key
     * @param check
     */
    private setRowSelectionByCheckboxKey(rowKey: string, check: boolean) {
        const { CHECKBOX_KEY } = this.ctx.config;
        if (CHECKBOX_KEY) {
            if (!this.rowKeyMap.has(rowKey)) {
                return false;
            }
            const { item } = this.rowKeyMap.get(rowKey);
            const checkboxKey = item[CHECKBOX_KEY];
            if (this.checkboxKeyMap.has(checkboxKey)) {
                const rowKeys = this.checkboxKeyMap.get(checkboxKey);
                rowKeys.forEach((rowKey: string) => {
                    const row = this.rowKeyMap.get(rowKey);
                    row.check = check;
                });
            }
        }
    }
    /**
     * 根据rowKey 取反选中
     * @param rowKey
     */
    toggleRowSelection(rowKey: string) {
        const row = this.rowKeyMap.get(rowKey);
        row.check = !row.check;
        this.setRowSelectionByCheckboxKey(rowKey, row.check);
        this.ctx.emit('toggleRowSelection', row);
        const rows = this.getSelectionRows();
        this.ctx.emit('selectionChange', rows);
        this.ctx.emit('draw');
    }
    /**
     * 根据rowKey 设置选中状态
     * @param rowKey
     */
    setRowSelection(rowKey: string, check: boolean) {
        const row = this.rowKeyMap.get(rowKey);
        row.check = check;
        this.setRowSelectionByCheckboxKey(rowKey, row.check);
        const rows = this.getSelectionRows();
        this.ctx.emit('setRowSelection', rows);
        this.ctx.emit('draw');
    }
    getSelectionRows() {
        let rows: any[] = [];
        this.rowKeyMap.forEach((row: any) => {
            if (row.check) {
                rows.push(row.item);
            }
        });
        return rows;
    }
    /**
     * 根据rowKey 获取选中状态
     * @param rowKey
     */
    getRowSelection(rowKey: string) {
        const { check } = this.rowKeyMap.get(rowKey);
        return check;
    }
    /**
     * 根据rowKey 获取选中状态
     * @param rowKey
     */
    getRowSelectable(rowKey: string) {
        const { selectable, item, rowIndex } = this.rowKeyMap.get(rowKey);
        if (typeof selectable === 'function') {
            return selectable({
                row: item,
                rowIndex,
            });
        }
        return selectable;
    }
    /**
     * 全选
     * @param rowKey
     */
    toggleAllSelection() {
        this.rowKeyMap.forEach((row: any) => {
            const _selectable = row.selectable;
            if (typeof _selectable === 'function') {
                const selectable = _selectable({
                    row: row.item,
                    rowIndex: row.rowIndex,
                });
                if (selectable) {
                    row.check = true;
                }
            } else {
                if (_selectable) {
                    row.check = true;
                }
            }
        });
        const rows = this.getSelectionRows();
        this.ctx.emit('toggleAllSelection', rows);
        this.ctx.emit('selectionChange', rows);
        this.ctx.emit('draw');
    }
    /**
     * 清除选中
     * @param rowKey
     */
    clearSelection() {
        this.rowKeyMap.forEach((row: any) => {
            const _selectable = row.selectable;
            if (typeof _selectable === 'function') {
                const selectable = _selectable({
                    row: row.item,
                    rowIndex: row.rowIndex,
                });
                if (selectable) {
                    row.check = false;
                }
            } else {
                if (_selectable) {
                    row.check = false;
                }
            }
        });
        const rows = this.getSelectionRows();
        this.ctx.emit('clearSelection');
        this.ctx.emit('selectionChange', rows);
        this.ctx.emit('draw');
    }
    /**
     * 获取选中状态，表头用
     * @param rowKey
     */
    getCheckedState() {
        let total = 0;
        let totalChecked = 0;
        let totalSelectable = 0;
        this.rowKeyMap.forEach((row: any) => {
            total += 1;
            if (row.check) {
                totalChecked += 1;
            }
            const _selectable = row.selectable;
            if (typeof _selectable === 'function') {
                const selectable = _selectable({
                    row: row.item,
                    rowIndex: row.rowIndex,
                });
                if (selectable) {
                    totalSelectable += 1;
                }
            } else {
                if (_selectable) {
                    totalSelectable += 1;
                }
            }
        });
        const indeterminate = totalSelectable && totalSelectable > totalChecked && totalChecked > 0;
        const selectable = totalSelectable !== 0;
        const check = totalSelectable && totalSelectable === totalChecked;
        return {
            check,
            indeterminate,
            selectable,
        };
    }
    /**
     * 更新列索引
     * @param list 表头末级列表
     */
    updateColIndexKeyMap(list: CellHeader[] = []) {
        this.colIndexKeyMap.clear();
        list.forEach((column) => {
            this.colIndexKeyMap.set(column.colIndex, column.key);
        });
    }
    /**
     * 获取以改变数据
     */
    getChangedData() {
        let list: {
            rowKey: string;
            colKey: string;
            row: any;
            originalValue: any;
            value: any;
        }[] = [];
        this.changedDataMap.forEach((value, key) => {
            const originalValue = this.originalDataMap.get(key);
            const rowKey = key.split('\u200b_')[0];
            const colKey = key.split('\u200b_')[1];
            if (originalValue !== value) {
                list.push({
                    rowKey,
                    colKey,
                    originalValue,
                    row: this.rowKeyMap.get(rowKey),
                    value,
                });
            }
        });
        return list;
    }
    getChangedRows() {
        const rowKeyList: Set<string> = new Set();
        this.changedDataMap.forEach((value, key) => {
            const originalValue = this.originalDataMap.get(key);
            const rowKey = key.split('\u200b_')[0];
            if (originalValue !== value) {
                rowKeyList.add(rowKey);
            }
        });
        let rows: any[] = [];
        rowKeyList.forEach((rowKey) => {
            rows.push(this.ctx.database.getRowDataItemForRowKey(rowKey));
        });
        return rows;
    }
    /**
     * 获取改变值是否已经改变
     * @param rowKey
     * @param key
     * @returns
     */
    isHasChangedData(rowKey: string, key: string) {
        const changedKey = `${rowKey}\u200b_${key}`;
        if (!this.changedDataMap.has(changedKey)) {
            return false;
        }
        const originalValue = this.originalDataMap.get(changedKey);
        const changedValue = this.changedDataMap.get(changedKey);
        return originalValue !== changedValue;
    }
    getPositionForRowIndex(rowIndex: number): Position {
        if (rowIndex < this.positions.length) {
            return this.positions[rowIndex];
        }
        return {
            height: 0,
            top: 0,
            bottom: 0,
        };
    }

    setHeader(key: string, cellHeader: CellHeader): boolean {
        if (!key) {
            return false;
        }
        this.headerMap.set(key, cellHeader);
        return true;
    }
    getReadonly(rowKey: string, key: string) {
        const row = this.rowKeyMap.get(rowKey);
        const colHeader = this.headerMap.get(key);
        const rowReadonly = row?.readonly;
        const colReadonly = colHeader?.readonly;
        const { CELL_READONLY_METHOD } = this.ctx.config;
        // 自定义只读
        if (typeof CELL_READONLY_METHOD === 'function') {
            const cellReadonlyMethod: CellReadonlyMethod = CELL_READONLY_METHOD;
            const readonly = cellReadonlyMethod({
                row: row.item,
                rowIndex: row.rowIndex,
                colIndex: colHeader.colIndex,
                column: colHeader.column,
                value: this.getItemValue(rowKey, key),
            });
            if (readonly !== undefined) {
                return readonly;
            }
        }
        return colReadonly || rowReadonly;
    }
    clearValidate() {
        this.validationErrorMap.clear();
    }
    getValidator(rowKey: string, key: string) {
        return new Promise((resolve) => {
            const row = this.rowKeyMap.get(rowKey);
            const colHeader = this.headerMap.get(key);
            const { CELL_RULES_METHOD } = this.ctx.config;
            const column = colHeader.column;
            let rules = column.rules;
            // 自定义只读
            if (typeof CELL_RULES_METHOD === 'function') {
                const cellRulesMethod: CellRulesMethod = CELL_RULES_METHOD;
                const _rules = cellRulesMethod({
                    row: row.item,
                    rowIndex: row.rowIndex,
                    colIndex: colHeader.colIndex,
                    column,
                    value: this.getItemValue(rowKey, key),
                });
                if (_rules) {
                    rules = _rules;
                }
            }
            if (rules) {
                let descriptor: Rules = {};
                let data: any = {};
                data[key] = this.getItemValue(rowKey, key);
                if (Array.isArray(rules) && rules.length) {
                    const _rules = rules.map((item) => {
                        return {
                            ...item,
                            row: row.item,
                            column,
                            rowIndex: row.rowIndex,
                            colIndex: colHeader.colIndex,
                        };
                    });
                    descriptor[key] = _rules;
                } else {
                    descriptor[key] = {
                        ...rules,
                        row: row.item,
                        column,
                        rowIndex: row.rowIndex,
                        colIndex: colHeader.colIndex,
                    };
                }

                const validator = new Schema(descriptor);
                validator
                    .validate(data)
                    .then(() => {
                        this.setValidationError(rowKey, key, []);
                        resolve([]);
                    })
                    .catch(({ errors }) => {
                        const _errors = errors.map((error: any) => ({
                            ...error,
                            column,
                            key,
                            row: row.item,
                            rowKey,
                        }));
                        this.setValidationError(rowKey, key, _errors);
                        resolve(_errors);
                    });
            } else {
                resolve([]);
            }
        });
    }
    getHeightByRowIndexRowSpan(rowIndex: number, rowSpan: number) {
        let sumHeight = 0;
        for (let i = 0; i < rowSpan; i++) {
            const position = this.positions[rowIndex + i];
            if (position) {
                sumHeight += position.height;
            }
        }
        return sumHeight;
    }
    setLoading(loading: boolean) {
        this.loading = loading;
        this.ctx.emit('loadingChange', loading);
    }
    getLoading() {
        return this.loading;
    }
    setValidationErrorByRowIndex(rowIndex: number, key: string, message: string) {
        const rowKey = this.rowIndexRowKeyMap.get(rowIndex);
        const _key = `${rowKey}\u200b_${key}`;
        const errors: ValidateError[] = [
            {
                message,
            },
        ];
        this.validationErrorMap.set(_key, errors);
    }
    setValidationError(rowKey: string, key: string, errors: any[]) {
        const _key = `${rowKey}\u200b_${key}`;
        this.validationErrorMap.set(_key, errors);
    }
    getValidationError(rowKey: string, key: string) {
        const _key = `${rowKey}\u200b_${key}`;
        return this.validationErrorMap.get(_key) || [];
    }
}
