const form = document.querySelector("form");
const list = document.querySelector("ul");
const input = document.getElementById("searchInput");
const findButton = document.getElementById("findButton");
const clearButton = document.getElementById("clearButton");
const clearResultsButton = document.getElementById("clearResultsButton");

function getPageKeywords() {
  return Array.from(list.querySelectorAll("li")).map((k) => k.textContent);
}

function getStorageInfo(name) {
  return new Promise((resolve) => {
    chrome.storage.local.get([name], (result) => {
      resolve(result[name] || []);
    });
  });
}
/*
Results storage format:
  results: [ { id, title, prices: { [timeScope]: price } } ]
  resultColumns: [ timeScope1, timeScope2, ... ]
*/

function normalizeStored(existing) {
  if (!Array.isArray(existing)) return [];
  return existing.map((it, idx) => {
    if (it && it.prices && typeof it.prices === 'object') return it;
    // legacy shape: {id, title, price}
    return { id: it.id != null ? it.id : idx, title: it.title || '', prices: { initial: it.price || '' } };
  });
}

function renderResults(results, columns) {
  const resultsBody = document.getElementById('resultsBody');
  const thead = document.querySelector('#results thead');
  resultsBody.innerHTML = '';
  // build header
  const headRow = thead.querySelector('tr');
  headRow.innerHTML = '';
  const idTh = document.createElement('th'); idTh.textContent = 'ID'; headRow.appendChild(idTh);
  const titleTh = document.createElement('th'); titleTh.textContent = 'Title'; headRow.appendChild(titleTh);
  (columns || []).forEach((col) => {
    const th = document.createElement('th'); th.textContent = col;
    th.classList.add('price-column');
    headRow.appendChild(th);
  });

  if (!Array.isArray(results)) return;
  results.forEach((result) => {
    const row = document.createElement('tr');
    const idTd = document.createElement('td'); idTd.textContent = result.id != null ? result.id : '';
    const titleTd = document.createElement('td'); titleTd.textContent = result.title || '';
    row.appendChild(idTd); row.appendChild(titleTd);
    (columns || []).forEach((col) => {
      const td = document.createElement('td');
      td.classList.add('price-column');
      const val = result.prices && result.prices[col] != null ? result.prices[col] : '';
      td.textContent = val;
      row.appendChild(td);
    });
    resultsBody.appendChild(row);
  });
}

async function saveResultsWithTimeScope(newResults, timeScope) {
  if (!Array.isArray(newResults) || newResults.length === 0) return;
  const existingRaw = await getStorageInfo('results');
  const columns = await getStorageInfo('resultColumns');
  const existing = normalizeStored(existingRaw);
  const cols = Array.isArray(columns) ? [...columns] : [];

  newResults.forEach((r, idx) => {
    const title = r.title || r.name || '';
    const price = r.price != null ? r.price : '';
    let found = existing.find((e) => e.title === title);
    if (found) {
      found.prices = found.prices || {};
      found.prices[timeScope] = price;
    } else {
      const newId = existing.length + 1;
      const obj = { id: newId, title, prices: { [timeScope]: price } };
      existing.push(obj);
    }
    if (!cols.includes(timeScope)) cols.push(timeScope);
  });

  return new Promise((resolve) => {
    chrome.storage.local.set({ results: existing, resultColumns: cols }, () => resolve({ results: existing, columns: cols }));
  });
}

// Handle form submit to add a keyword
form.addEventListener("submit", (event) => {
  event.preventDefault();
  const keyword = input.value.trim();
  if (keyword) {
    console.log("Adding keyword:", keyword);
    chrome.storage.local.set({ keywords: [...getPageKeywords(), keyword] });
    const newKeyword = document.createElement("li");
    newKeyword.textContent = keyword;
    newKeyword.id = `kw-${list.children.length + 1}`;
    list.appendChild(newKeyword);
    input.value = "";
  } else {
    alert("Please enter a keyword.");
  }
});

// Use event delegation so clicks on current and future <li> remove them
list.addEventListener("click", (event) => {
  const li = event.target.closest("li");
  if (!li) return;
  list.removeChild(li);
});

clearButton.addEventListener("click", () => {
  chrome.storage.local.set({ keywords: [] });
  list.innerHTML = "";
});

// Load keywords from storage on popup open
document.addEventListener("DOMContentLoaded", async () => {
  const keywords = await getStorageInfo("keywords");
  const results = await getStorageInfo("results");
  const columns = await getStorageInfo("resultColumns");
  const normalized = (results && results.length) ? normalizeStored(results) : [];
  renderResults(normalized, columns);
  keywords.forEach((keyword) => {
    const li = document.createElement("li");
    li.textContent = keyword;
    list.appendChild(li);
  });
});

// When starting the search, re-query the list to get current items
findButton.addEventListener("click", () => {
  if (getPageKeywords().length === 0) {
    alert("Please add at least one keyword before searching.");
    return;
  }
    chrome.runtime.sendMessage(
    { action: "getResult", payload: getPageKeywords() },
    (response) => {
      console.log("received response:", response);
      if (Array.isArray(response.ok)) {
        const timeScope = response.timeScope || (response.debug && response.debug.timeScope) || new Date().toISOString();
        saveResultsWithTimeScope(response.ok, timeScope).then(({ results, columns }) => {
          renderResults(results, columns);
        });
      } else if (response && response.ok && typeof response.ok === 'string') {
        // no matches, but possibly debug info
        console.warn('Search response:', response.ok, response.debug || '');
      }
    },
  );
});

clearResultsButton.addEventListener("click", () => {
  const resultsBody = document.getElementById("resultsBody");
  const thead = document.querySelector('#results thead');
  resultsBody.innerHTML = "";
  // reset header to default: ID, Title, Price
  const headRow = thead.querySelector('tr');
  headRow.innerHTML = '<th>ID</th><th>Title</th><th>Price</th>';
  chrome.storage.local.set({ results: [], resultColumns: [] });
});


