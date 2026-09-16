// =====================================================================
// GasMock — محاكي محلي صغير لواجهات Google Apps Script المستخدمة في Code.gs
// الغرض: تشغيل منطق الباك اند كامل (قراءة/كتابة/حذف/كاش/جلسات) على مصفوفات
// بالذاكرة، مع عدّ كل "عملية شيت" (round-trip) حتى نقارن الأداء قبل/بعد.
// ليست محاكاة كاملة — تغطي بس الدوال اللي بيناديها Code.gs فعلاً.
// =====================================================================
'use strict';

const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');

function makeOps() {
  return {
    getValues: 0, setValues: 0, setValue: 0, appendRow: 0,
    deleteRow: 0, deleteRows: 0, getLastRow: 0, getLastColumn: 0,
    clearContent: 0, setNumberFormat: 0
  };
}

function opsTotal(ops) {
  return Object.keys(ops).reduce(function (s, k) { return s + ops[k]; }, 0);
}

class Sheet {
  constructor(name, ops) {
    this._name = name;
    this._ops = ops;
    this.data = []; // صفوف: كل صف مصفوفة خلايا
  }
  getName() { return this._name; }
  _ensure(row, col) {
    while (this.data.length < row) this.data.push([]);
    const r = this.data[row - 1];
    while (r.length < col) r.push('');
  }
  _cell(row, col) { const r = this.data[row - 1] || []; return r[col - 1] === undefined ? '' : r[col - 1]; }
  getLastRow() {
    this._ops.getLastRow++;
    for (let i = this.data.length - 1; i >= 0; i--) {
      const row = this.data[i] || [];
      for (let c = 0; c < row.length; c++) {
        const v = row[c];
        if (v !== '' && v !== null && v !== undefined) return i + 1;
      }
    }
    return 0;
  }
  getLastColumn() {
    this._ops.getLastColumn++;
    let max = 0;
    for (let i = 0; i < this.data.length; i++) {
      const row = this.data[i] || [];
      for (let c = row.length - 1; c >= 0; c--) {
        const v = row[c];
        if (v !== '' && v !== null && v !== undefined) { if (c + 1 > max) max = c + 1; break; }
      }
    }
    return max;
  }
  getRange(row, col, numRows, numCols) {
    numRows = numRows === undefined ? 1 : numRows;
    numCols = numCols === undefined ? 1 : numCols;
    const sh = this;
    return {
      getValues() {
        sh._ops.getValues++;
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const line = [];
          for (let c = 0; c < numCols; c++) line.push(sh._cell(row + r, col + c));
          out.push(line);
        }
        return out;
      },
      setValues(values) {
        sh._ops.setValues++;
        for (let r = 0; r < values.length; r++) {
          sh._ensure(row + r, col + numCols - 1);
          const line = sh.data[row - 1 + r];
          for (let c = 0; c < values[r].length; c++) line[col - 1 + c] = values[r][c];
        }
        return this;
      },
      setValue(v) {
        sh._ops.setValue++;
        sh._ensure(row, col);
        sh.data[row - 1][col - 1] = v;
        return this;
      },
      setNumberFormat() { sh._ops.setNumberFormat++; return this; },
      clearContent() {
        sh._ops.clearContent++;
        for (let r = 0; r < numRows; r++) {
          sh._ensure(row + r, col + numCols - 1);
          const line = sh.data[row - 1 + r];
          for (let c = 0; c < numCols; c++) line[col - 1 + c] = '';
        }
        return this;
      }
    };
  }
  getDataRange() {
    const lr = Math.max(this.getLastRow(), 1);
    const lc = Math.max(this.getLastColumn(), 1);
    return this.getRange(1, 1, lr, lc);
  }
  appendRow(values) {
    this._ops.appendRow++;
    const at = this.getLastRow() + 1;
    for (let c = 0; c < values.length; c++) {
      this._ensure(at, c + 1);
      this.data[at - 1][c] = values[c];
    }
  }
  deleteRow(row) { this._ops.deleteRow++; this.data.splice(row - 1, 1); }
  deleteRows(row, n) { this._ops.deleteRows++; this.data.splice(row - 1, n); }
}

class Spreadsheet {
  constructor() { this.sheets = new Map(); this.ops = makeOps(); }
  getSheetByName(n) { return this.sheets.get(n) || null; }
  insertSheet(n) { const s = new Sheet(n, this.ops); this.sheets.set(n, s); return s; }
  deleteSheet(s) { this.sheets.delete(s.getName()); }
  getSheets() { return Array.from(this.sheets.values()); }
}

function makeEnvironment(codePath, options) {
  options = options || {};
  const ss = new Spreadsheet();
  const cacheStore = new Map();
  const propsStore = new Map();
  const logs = [];
  const urlFetches = [];
  const cacheOps = { get: 0, put: 0, remove: 0, removeAll: 0, hit: 0, miss: 0 };

  const sandbox = {};
  sandbox.console = console;
  sandbox.SpreadsheetApp = {
    getActiveSpreadsheet: () => ss
  };
  sandbox.Utilities = {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    getUuid: () => crypto.randomUUID(),
    computeDigest: (alg, value) => {
      const h = crypto.createHash('sha256').update(String(value), 'utf8').digest();
      return Array.from(h).map((b) => (b > 127 ? b - 256 : b)); // نفس سلوك Apps Script: بايتات موقّعة
    }
  };
  sandbox.LockService = {
    getScriptLock: () => ({ waitLock() {}, releaseLock() {} })
  };
  sandbox.CacheService = {
    getScriptCache: () => ({
      get(k) { cacheOps.get++; if (cacheStore.has(k)) { cacheOps.hit++; return cacheStore.get(k); } cacheOps.miss++; return null; },
      put(k, v) {
        cacheOps.put++;
        if (String(v).length > 100000) throw new Error('Argument too large: value'); // نفس حد CacheService الحقيقي (100KB/مفتاح)
        cacheStore.set(k, String(v));
      },
      remove(k) { cacheOps.remove++; cacheStore.delete(k); },
      removeAll(keys) { cacheOps.removeAll++; keys.forEach((k) => cacheStore.delete(k)); }
    })
  };
  sandbox.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => (propsStore.has(k) ? propsStore.get(k) : null),
      setProperty: (k, v) => { propsStore.set(k, String(v)); },
      deleteProperty: (k) => { propsStore.delete(k); },
      getKeys: () => Array.from(propsStore.keys())
    })
  };
  sandbox.ContentService = {
    createTextOutput: (s) => ({
      _s: s,
      setMimeType() { return this; },
      getContent() { return this._s; }
    }),
    MimeType: { JSON: 'application/json', PLAIN_TEXT: 'text/plain' }
  };
  sandbox.MimeType = { JSON: 'application/json', PLAIN_TEXT: 'text/plain' };
  sandbox.Logger = { log: (s) => { logs.push(String(s)); } };
  sandbox.ScriptApp = {
    getProjectTriggers: () => [],
    newTrigger: () => ({ timeBased: () => ({ everyDays: () => ({ atHour: () => ({ create: () => ({}) }) }) }) })
  };
  sandbox.UrlFetchApp = {
    fetch: (url, opts) => { urlFetches.push(url); return { getContentText: () => '{"ok":true}', getResponseCode: () => 200 }; }
  };
  sandbox.DriveApp = {
    getFoldersByName: () => ({ hasNext: () => false }),
    createFolder: () => ({
      createFile: () => ({ getName: () => 'x', setTrashed: () => {} }),
      getFilesByType: () => ({ hasNext: () => false })
    })
  };

  vm.createContext(sandbox);
  const code = fs.readFileSync(codePath, 'utf8');
  vm.runInContext(code, sandbox, { filename: codePath });

  return {
    sandbox,
    ss,
    cacheStore,
    propsStore,
    logs,
    urlFetches,
    cacheOps,
    resetOps() { ss.ops = makeOps(); Array.from(ss.sheets.values()).forEach((s) => { s._ops = ss.ops; }); },
    ops() { return ss.ops; },
    opsTotal() { return opsTotal(ss.ops); },
    sheetRows(name) {
      const sh = ss.getSheetByName(name);
      if (!sh) return -1;
      const last = sh.getLastRow();
      return last <= 1 ? 0 : last - 1;
    },
    // يحوّل رد فعل web app لمخرج JSON
    callGet(params) {
      const q = Object.assign({}, params);
      const res = sandbox.doGet({ parameter: q });
      return JSON.parse(res.getContent());
    },
    callPost(body) {
      const res = sandbox.doPost({ postData: { contents: JSON.stringify(body) } });
      return JSON.parse(res.getContent());
    }
  };
}

module.exports = { makeEnvironment, opsTotal };
