import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  PageOrientation,
} from "./node_modules/docx/dist/index.mjs";

const form = document.querySelector("form");
const list = document.querySelector("ul");
const input = document.getElementById("searchInput");
const findButton = document.getElementById("findButton");
const clearButton = document.getElementById("clearButton");
const clearResultsButton = document.getElementById("clearResultsButton");
const downloadButton = document.getElementById("downloadButton");
const questionDialog = document.getElementById("questionDialog");
const questionButtonYes = document.getElementById("button-answer-yes");
const questionButtonNo = document.getElementById("button-answer-no");
const MAX_KEYWORDS = 20;

function getPageKeywords() {
  return Array.from(list.querySelectorAll("li"))
    .map((item) => {
      const keywordInput = item.querySelector(".keyword-input");
      return (keywordInput ? keywordInput.value : item.dataset.keyword || "").trim();
    })
    .filter(Boolean);
}

function getStorageInfo(name) {
  return new Promise((resolve) => {
    chrome.storage.local.get([name], (result) => {
      resolve(result[name] || []);
    });
  });
}

function normalizeStored(existing) {
  if (!Array.isArray(existing)) return [];
  return existing.map((item, index) => {
    if (item && item.prices && typeof item.prices === "object") {
      return {
        ...item,
        keyword: item.keyword || item.title || "",
        title: item.keyword || item.title || "",
        mergedPrices: item.mergedPrices || {},
      };
    }

    return {
      id: item.id != null ? item.id : index + 1,
      keyword: item.title || "",
      title: item.title || "",
      matchedTitle: item.title || "",
      prices: { initial: item.price || "" },
      mergedPrices: {},
    };
  });
}

function normalizeText(text) {
  return String(text || "").toLowerCase().trim();
}

function findResultForKeyword(results, keyword) {
  const normalizedKeyword = normalizeText(keyword);
  return results.find((result) => {
    const keywordText = normalizeText(result.keyword);
    const titleText = normalizeText(result.title);
    const matchedTitleText = normalizeText(result.matchedTitle);

    return (
      keywordText === normalizedKeyword ||
      titleText === normalizedKeyword ||
      matchedTitleText.includes(normalizedKeyword)
    );
  });
}

function orderResultsByKeywords(results, keywords) {
  if (!Array.isArray(results)) return [];

  const ordered = [];
  const used = new Set();

  (keywords || []).forEach((keyword) => {
    const result = findResultForKeyword(results, keyword);
    if (!result || used.has(result)) return;
    result.keyword = keyword;
    result.title = keyword;
    ordered.push(result);
    used.add(result);
  });

  results.forEach((result) => {
    if (!used.has(result)) ordered.push(result);
  });

  return ordered;
}

function ensureKeywordRows(results, keywords) {
  const nextResults = [...results];

  (keywords || []).forEach((keyword, index) => {
    const existingResult = findResultForKeyword(nextResults, keyword);
    if (existingResult) {
      existingResult.id = index + 1;
      existingResult.keyword = keyword;
      existingResult.title = keyword;
      return;
    }

    nextResults.push({
      id: index + 1,
      keyword,
      title: keyword,
      matchedTitle: "",
      prices: {},
      mergedPrices: {},
    });
  });

  return orderResultsByKeywords(nextResults, keywords);
}

function formatDateColumn(day, month = null) {
  const formattedDay = String(day).padStart(2, "0");
  return month == null
    ? formattedDay
    : `${formattedDay}.${String(month).padStart(2, "0")}`;
}

function parseDateToken(token) {
  const value = String(token || "").trim();
  const dotted = value.match(/^(\d{1,2})\.(\d{1,2})$/);
  if (dotted) {
    return { day: Number(dotted[1]), month: Number(dotted[2]) };
  }

  const digits = value.replace(/\D/g, "");
  if (digits.length > 0 && digits.length <= 2) {
    return { day: Number(digits), month: null };
  }
  if (digits.length >= 4) {
    return {
      day: Number(digits.slice(0, 2)),
      month: Number(digits.slice(2, 4)),
    };
  }

  return null;
}

function datesMatch(first, second) {
  return (
    first &&
    second &&
    first.day === second.day &&
    (first.month == null || second.month == null || first.month === second.month)
  );
}

function columnMatchesDate(column, date) {
  const parsed = parseDateToken(column);
  return datesMatch(parsed, date);
}

function parseDateRange(range) {
  const parts = String(range || "")
    .split(/\s*-\s*/)
    .map(parseDateToken)
    .filter(Boolean);

  return parts.length >= 2 ? { start: parts[0], end: parts[1] } : null;
}

function columnMatchesInterval(column, start, end) {
  const range = parseDateRange(column);
  return range && datesMatch(range.start, start) && datesMatch(range.end, end);
}

function expandTimeScopeToExistingColumns(timeScope, columns) {
  const range = parseDateRange(timeScope);
  if (!range) return null;

  const { start, end } = range;
  if (
    !start ||
    !end ||
    (start.month != null && end.month != null && start.month !== end.month) ||
    end.day <= start.day
  ) {
    return null;
  }

  const intervalColumns = [];
  for (let day = start.day; day < end.day; day += 1) {
    const intervalStart = { day, month: start.month };
    const intervalEnd = { day: day + 1, month: end.month };
    const existingColumn = (columns || []).find((column) =>
      columnMatchesInterval(column, intervalStart, intervalEnd),
    );
    intervalColumns.push(
      existingColumn ||
        `${formatDateColumn(day, start.month)} - ${formatDateColumn(
          day + 1,
          end.month,
        )}`,
    );
  }

  const allIntervalsExist = intervalColumns.every((column) =>
    (columns || []).includes(column),
  );

  if (allIntervalsExist && intervalColumns.length > 1) {
    return intervalColumns;
  }

  const targetColumns = [];
  for (let day = start.day; day < end.day; day += 1) {
    const date = { day, month: start.month };
    const existingColumn = (columns || []).find((column) =>
      columnMatchesDate(column, date),
    );
    targetColumns.push(existingColumn || formatDateColumn(day, start.month));
  }

  const allColumnsExist = targetColumns.every((column) =>
    (columns || []).includes(column),
  );

  return allColumnsExist && targetColumns.length > 1 ? targetColumns : null;
}

function getMergedSpanForColumn(result, column, columns) {
  const span = (result.mergedPrices || {})[column];
  if (!span || !Array.isArray(span.columns)) return null;

  const startIndex = columns.indexOf(column);
  if (startIndex === -1) return null;

  const isContinuous = span.columns.every(
    (spanColumn, index) => columns[startIndex + index] === spanColumn,
  );

  return isContinuous ? span : null;
}

function isColumnCoveredByEarlierSpan(result, column, columns) {
  const columnIndex = columns.indexOf(column);
  return Object.entries(result.mergedPrices || {}).some(
    ([startColumn, span]) => {
      if (!span || !Array.isArray(span.columns) || startColumn === column) {
        return false;
      }

      const startIndex = columns.indexOf(startColumn);
      return (
        startIndex !== -1 &&
        columnIndex > startIndex &&
        columnIndex < startIndex + span.columns.length
      );
    },
  );
}

function createPriceCells(result, columns, makeCell) {
  const cells = [];

  (columns || []).forEach((column) => {
    if (isColumnCoveredByEarlierSpan(result, column, columns || [])) return;

    const mergedSpan = getMergedSpanForColumn(result, column, columns || []);
    const value = mergedSpan
      ? mergedSpan.value
      : result.prices && result.prices[column] != null
        ? result.prices[column]
        : "";

    cells.push(makeCell(value, mergedSpan ? mergedSpan.columns.length : 1));
  });

  return cells;
}

function clearMergedSpansForColumns(result, columnsToClear) {
  const columnsSet = new Set(columnsToClear || []);
  result.mergedPrices = Object.fromEntries(
    Object.entries(result.mergedPrices || {}).filter(([, span]) => {
      return !span.columns.some((column) => columnsSet.has(column));
    }),
  );
}

function foldRangeColumnsIntoExistingIntervals(results, columns) {
  let changed = false;
  const nextColumns = [...(columns || [])];

  [...nextColumns].forEach((column) => {
    const targetColumns = expandTimeScopeToExistingColumns(
      column,
      nextColumns.filter((existingColumn) => existingColumn !== column),
    );

    if (!targetColumns) return;

    results.forEach((result) => {
      const rangePrice = result.prices?.[column];
      if (!rangePrice) return;

      const rowHasPriceInRange = targetColumns.some(
        (targetColumn) => result.prices[targetColumn],
      );

      if (!rowHasPriceInRange) {
        clearMergedSpansForColumns(result, targetColumns);
        targetColumns.forEach((targetColumn) => {
          result.prices[targetColumn] = rangePrice;
        });
        result.mergedPrices[targetColumns[0]] = {
          columns: targetColumns,
          value: rangePrice,
        };
      }

      delete result.prices[column];
      changed = true;
    });

    const nextColumnIndex = nextColumns.indexOf(column);
    if (nextColumnIndex !== -1) {
      nextColumns.splice(nextColumnIndex, 1);
      changed = true;
    }
  });

  return { results, columns: nextColumns, changed };
}

function checkUserSure() {
  return new Promise((resolve) => {
    questionDialog.classList.remove("hiden");

    const yesHandler = () => {
      questionDialog.classList.add("hiden");
      cleanup();
      resolve(true);
    };

    const noHandler = () => {
      questionDialog.classList.add("hiden");
      cleanup();
      resolve(false);
    };

    function cleanup() {
      questionButtonYes.removeEventListener("click", yesHandler);
      questionButtonNo.removeEventListener("click", noHandler);
    }

    questionButtonYes.addEventListener("click", yesHandler);
    questionButtonNo.addEventListener("click", noHandler);
  });
}

async function refreshResultsUI() {
  const resultsRaw = await getStorageInfo("results");
  const columns = await getStorageInfo("resultColumns");
  const keywords = await getStorageInfo("keywords");
  const normalized = ensureKeywordRows(normalizeStored(resultsRaw), keywords);
  const folded = foldRangeColumnsIntoExistingIntervals(normalized, columns);
  if (folded.changed) {
    await chrome.storage.local.set({
      results: folded.results,
      resultColumns: folded.columns,
    });
  }
  renderResults(folded.results, folded.columns);
}

async function syncKeywordInputs() {
  const keywords = getPageKeywords();
  await chrome.storage.local.set({ keywords });
  return keywords;
}

function renderKeywords(keywords) {
  list.innerHTML = "";

  (keywords || []).forEach((keyword) => {
    const li = document.createElement("li");
    li.dataset.keyword = keyword;

    const keywordInput = document.createElement("input");
    keywordInput.classList.add("keyword-input");
    keywordInput.type = "text";
    keywordInput.value = keyword;

    const upButton = document.createElement("button");
    upButton.classList.add("button-swipe-up");
    upButton.type = "button";
    upButton.textContent = "Up";

    const downButton = document.createElement("button");
    downButton.classList.add("button-swipe-down");
    downButton.type = "button";
    downButton.textContent = "Down";

    const deleteButton = document.createElement("button");
    deleteButton.classList.add("keyword-delete-button");
    deleteButton.type = "button";
    deleteButton.textContent = "x";

    li.appendChild(keywordInput);
    li.appendChild(upButton);
    li.appendChild(downButton);
    li.appendChild(deleteButton);
    list.appendChild(li);

    const saveEditedKeyword = async () => {
      const nextKeyword = keywordInput.value.trim();
      if (!nextKeyword || nextKeyword === keyword) {
        keywordInput.value = keyword;
        return;
      }

      const keywordsFromStorage = await getStorageInfo("keywords");
      const index = keywordsFromStorage.indexOf(keyword);
      if (index === -1) return;

      keywordsFromStorage[index] = nextKeyword;

      const results = normalizeStored(await getStorageInfo("results"));
      const updatedResults = results.map((result) => {
        if (
          normalizeText(result.keyword) === normalizeText(keyword) ||
          normalizeText(result.title) === normalizeText(keyword)
        ) {
          return { ...result, keyword: nextKeyword, title: nextKeyword };
        }

        return result;
      });

      await chrome.storage.local.set({
        keywords: keywordsFromStorage,
        results: updatedResults,
      });
      renderKeywords(keywordsFromStorage);
      refreshResultsUI();
    };

    keywordInput.addEventListener("change", saveEditedKeyword);
    keywordInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        keywordInput.blur();
      }
    });

    upButton.addEventListener("click", async () => {
      const keywordsFromStorage = await getStorageInfo("keywords");
      const index = keywordsFromStorage.indexOf(keyword);
      if (index <= 0) return;
      [keywordsFromStorage[index - 1], keywordsFromStorage[index]] = [
        keywordsFromStorage[index],
        keywordsFromStorage[index - 1],
      ];
      await chrome.storage.local.set({ keywords: keywordsFromStorage });
      renderKeywords(keywordsFromStorage);
      refreshResultsUI();
    });

    downButton.addEventListener("click", async () => {
      const keywordsFromStorage = await getStorageInfo("keywords");
      const index = keywordsFromStorage.indexOf(keyword);
      if (index === -1 || index === keywordsFromStorage.length - 1) return;
      [keywordsFromStorage[index + 1], keywordsFromStorage[index]] = [
        keywordsFromStorage[index],
        keywordsFromStorage[index + 1],
      ];
      await chrome.storage.local.set({ keywords: keywordsFromStorage });
      renderKeywords(keywordsFromStorage);
      refreshResultsUI();
    });

    deleteButton.addEventListener("click", async () => {
      const keywordsFromStorage = await getStorageInfo("keywords");
      const index = keywordsFromStorage.indexOf(keyword);
      if (index === -1) return;
      keywordsFromStorage.splice(index, 1);
      await chrome.storage.local.set({ keywords: keywordsFromStorage });
      renderKeywords(keywordsFromStorage);
      refreshResultsUI();
    });
  });
}

function renderResults(results, columns) {
  const resultsBody = document.getElementById("resultsBody");
  const thead = document.querySelector("#results thead");
  resultsBody.innerHTML = "";

  const headRow = thead.querySelector("tr");
  headRow.innerHTML = "";

  ["ID", "Title", ...(columns || [])].forEach((heading, index) => {
    const th = document.createElement("th");
    th.textContent = heading;
    if (index > 1) th.classList.add("price-column");
    headRow.appendChild(th);
  });

  if (!Array.isArray(results)) return;

  results.forEach((result) => {
    const row = document.createElement("tr");
    const idCell = document.createElement("td");
    const titleCell = document.createElement("td");

    idCell.textContent = result.id != null ? result.id : "";
    titleCell.textContent = result.title || result.keyword || "";

    row.appendChild(idCell);
    row.appendChild(titleCell);

    createPriceCells(result, columns || [], (value, span) => {
      const td = document.createElement("td");
      td.classList.add("price-column");
      if (span > 1) td.colSpan = span;
      td.textContent = value;
      return td;
    }).forEach((cell) => row.appendChild(cell));

    resultsBody.appendChild(row);
  });
}

async function saveResultsWithTimeScope(newResults, timeScope) {
  if (!Array.isArray(newResults) || newResults.length === 0) return;

  const existingRaw = await getStorageInfo("results");
  const columns = await getStorageInfo("resultColumns");
  const keywords = await getStorageInfo("keywords");
  const existing = ensureKeywordRows(normalizeStored(existingRaw), keywords);
  const nextColumns = Array.isArray(columns) ? [...columns] : [];
  const targetColumns = expandTimeScopeToExistingColumns(timeScope, nextColumns);

  newResults.forEach((result) => {
    const keyword = result.keyword || result.title || result.name || "";
    const matchedTitle = result.matchedTitle || result.originalTitle || "";
    const price = result.price != null ? result.price : "";
    let existingResult = findResultForKeyword(existing, keyword);

    if (!existingResult) {
      existingResult = {
        id: existing.length + 1,
        keyword,
        title: keyword,
        matchedTitle,
        prices: {},
        mergedPrices: {},
      };
      existing.push(existingResult);
    }

    existingResult.keyword = keyword;
    existingResult.title = keyword;
    existingResult.matchedTitle = existingResult.matchedTitle || matchedTitle;
    existingResult.prices = existingResult.prices || {};
    existingResult.mergedPrices = existingResult.mergedPrices || {};

    if (targetColumns) {
      const rowHasPriceInRange = targetColumns.some(
        (column) => existingResult.prices[column],
      );

      if (!rowHasPriceInRange) {
        clearMergedSpansForColumns(existingResult, targetColumns);
        targetColumns.forEach((column) => {
          existingResult.prices[column] = price;
        });
        existingResult.mergedPrices[targetColumns[0]] = {
          columns: targetColumns,
          value: price,
        };
      }

      return;
    }

    clearMergedSpansForColumns(existingResult, [timeScope]);
    existingResult.prices[timeScope] = price;
    if (!nextColumns.includes(timeScope)) nextColumns.push(timeScope);
  });

  const folded = foldRangeColumnsIntoExistingIntervals(existing, nextColumns);
  const orderedResults = ensureKeywordRows(folded.results, keywords);

  return new Promise((resolve) => {
    chrome.storage.local.set(
      { results: orderedResults, resultColumns: folded.columns },
      () => resolve({ results: orderedResults, columns: folded.columns }),
    );
  });
}

function createWordDocument(results, columns) {
  const tableRows = [];
  const fontSize = 8;
  const pageWidth = 15840;
  const margin = 400;
  const availableWidth = pageWidth - margin * 2;
  const totalColumns = 1 + (columns?.length || 0);
  const cellWidth = Math.floor(availableWidth / totalColumns);

  const makeCell = (text, columnSpan = 1) =>
    new TableCell({
      columnSpan,
      width: { size: cellWidth * columnSpan, type: "dxa" },
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
      children: [
        new Paragraph({
          children: [
            new TextRun({
              text: String(text ?? ""),
              size: fontSize * 2,
            }),
          ],
        }),
      ],
    });

  tableRows.push(
    new TableRow({
      children: [makeCell("Title"), ...(columns || []).map((col) => makeCell(col))],
    }),
  );

  results.forEach((result) => {
    tableRows.push(
      new TableRow({
        children: [
          makeCell(result.title || result.keyword || ""),
          ...createPriceCells(result, columns || [], makeCell),
        ],
      }),
    );
  });

  const table = new Table({
    width: { size: availableWidth, type: "dxa" },
    rows: tableRows,
  });

  const doc = new Document({
    creator: "Booking Extractor",
    sections: [
      {
        properties: {
          page: {
            size: {
              orientation: PageOrientation.LANDSCAPE,
            },
            margin: {
              top: margin,
              bottom: margin,
              left: margin,
              right: margin,
            },
          },
        },
        children: [table],
      },
    ],
  });

  Packer.toBlob(doc).then((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "results.docx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (getPageKeywords().length >= MAX_KEYWORDS) {
    alert(`Too many words. Max ${MAX_KEYWORDS}`);
    return;
  }

  const keyword = input.value.trim();
  if (!keyword) {
    alert("Please enter a keyword.");
    return;
  }

  const keywords = [...getPageKeywords(), keyword];
  await chrome.storage.local.set({ keywords });
  renderKeywords(keywords);
  refreshResultsUI();
  input.value = "";
});

clearButton.addEventListener("click", async () => {
  const isSure = await checkUserSure();
  if (!isSure) return;

  chrome.storage.local.set({ keywords: [] });
  list.innerHTML = "";
  refreshResultsUI();
});

document.addEventListener("DOMContentLoaded", async () => {
  const keywords = await getStorageInfo("keywords");
  const results = ensureKeywordRows(
    normalizeStored(await getStorageInfo("results")),
    keywords,
  );
  const columns = await getStorageInfo("resultColumns");
  const folded = foldRangeColumnsIntoExistingIntervals(results, columns);
  if (folded.changed) {
    await chrome.storage.local.set({
      results: folded.results,
      resultColumns: folded.columns,
    });
  }
  renderResults(folded.results, folded.columns);
  renderKeywords(keywords);
});

findButton.addEventListener("click", async () => {
  const keywords = await syncKeywordInputs();

  if (keywords.length === 0) {
    alert("Please add at least one keyword before searching.");
    return;
  }

  chrome.runtime.sendMessage(
    { action: "getResult", payload: keywords },
    (response) => {
      console.log("received response:", response);

      if (Array.isArray(response?.ok)) {
        const timeScope =
          response.timeScope ||
          (response.debug && response.debug.timeScope) ||
          new Date().toISOString();

        saveResultsWithTimeScope(response.ok, timeScope).then(
          ({ results, columns }) => {
            renderResults(results, columns);
          },
        );
        return;
      }

      if (response && response.error) {
        console.warn("Search error:", response.error, response.details || "");
      }
    },
  );
});

clearResultsButton.addEventListener("click", async () => {
  const isSure = await checkUserSure();
  if (!isSure) return;

  const resultsBody = document.getElementById("resultsBody");
  const thead = document.querySelector("#results thead");
  resultsBody.innerHTML = "";
  thead.querySelector("tr").innerHTML =
    "<th>ID</th><th>Title</th><th>Price</th>";
  chrome.storage.local.set({ results: [], resultColumns: [] });
});

downloadButton.addEventListener("click", async () => {
  const resultsRaw = await getStorageInfo("results");
  const columns = await getStorageInfo("resultColumns");
  const keywords = await getStorageInfo("keywords");
  const normalized = ensureKeywordRows(normalizeStored(resultsRaw), keywords);
  const folded = foldRangeColumnsIntoExistingIntervals(normalized, columns);
  if (folded.changed) {
    await chrome.storage.local.set({
      results: folded.results,
      resultColumns: folded.columns,
    });
  }

  if (!folded.results.length) {
    alert("No results available to download.");
    return;
  }

  createWordDocument(folded.results, folded.columns);
});
