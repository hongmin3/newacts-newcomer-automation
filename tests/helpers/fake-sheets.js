const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function spreadsheet(id, initial = {}) {
  const sheets = new Map();
  const book = {
    getId: () => id,
    getSheetByName: name => sheets.get(name) || null,
    getSheets: () => [...sheets.values()],
    insertSheet: name => add(name, []),
    setActiveSheet() {},
    writes: 0,
    fail: null
  };
  function add(name, values) {
    const sheet = {
      rows: values.map(row => row.slice()), hidden: false,
      getName: () => name, getParent: () => book,
      getSheetId: () => [...sheets.keys()].indexOf(name) + 1,
      getLastRow: () => sheet.rows.length,
      getLastColumn: () => Math.max(1, ...sheet.rows.map(row => row.length)),
      getMaxRows: () => 10000,
      insertRowsAfter() {}, setFrozenRows() {},
      isSheetHidden: () => sheet.hidden,
      hideSheet() { sheet.hidden = true; },
      insertRowAfter(row) { sheet.rows.splice(row, 0, []); book.writes++; },
      getFilter: () => null,
      getDataRange: () => sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()),
      getRange(row, col, height = 1, width = 1) {
        const range = {
          getSheet: () => sheet, getRow: () => row,
          getValues: () => Array.from({length: height}, (_, y) =>
            Array.from({length: width}, (_, x) => sheet.rows[row - 1 + y]?.[col - 1 + x] ?? '')),
          getDisplayValues: () => range.getValues().map(row => row.map(String)),
          getValue: () => range.getValues()[0][0],
          setValues(values) {
            if (book.fail) book.fail({name, row, col, values, phase: 'before'});
            values.forEach((line, y) => {
              while (sheet.rows.length < row + y) sheet.rows.push([]);
              line.forEach((v, x) => sheet.rows[row - 1 + y][col - 1 + x] = v);
            });
            book.writes++;
            if (book.fail) book.fail({name, row, col, values, phase: 'after'});
            return range;
          },
          setValue: value => range.setValues([[value]]),
          setNumberFormat: () => range, setFontWeight: () => range,
          createFilter: () => range
        };
        return range;
      }
    };
    sheets.set(name, sheet);
    return sheet;
  }
  Object.entries(initial).forEach(([name, rows]) => add(name, rows));
  return book;
}

function load(file) {
  const properties = new Map();
  const sent = [];
  const context = vm.createContext({
    console: {log() {}, error() {}},
    PropertiesService: {getScriptProperties: () => ({
      getProperty: key => properties.get(key) ?? null,
      setProperty(key, value) { properties.set(key, value); },
      deleteProperty: key => properties.delete(key)
    })},
    LockService: {getScriptLock: () => ({tryLock: () => true, waitLock() {}, releaseLock() {}})},
    MailApp: {sendEmail: message => sent.push(message)},
    Utilities: {formatDate: date => new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Seoul'}).format(new Date(date))},
    SpreadsheetApp: {}
  });
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8'), context);
  return {context, properties, sent, evaluate: expr => vm.runInContext(expr, context)};
}
module.exports = {spreadsheet, load};
