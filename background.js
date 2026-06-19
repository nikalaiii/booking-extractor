// When asked, inject a small script into the active tab (no persistent content_scripts).

function digger(container) {
  if (!container) return { error: "container-not-found" };

  // 2. Шукаємо назву всередині контейнера
  // Booking часто використовує data-testid="title"
  const titleEl = container.querySelector('[data-testid="title"]');

  // 3. Якщо немає — пробуємо альтернативні селектори
  const fallbackEl = container.querySelector(
    'a[data-testid="title-link"], h3, h2, .fcab3ed991',
  );

  const finalEl = titleEl || fallbackEl;

  if (!finalEl) return { error: "title-not-found" };

  // 4. Повертаємо текст назви
  return finalEl.innerText.trim();
}

function extractor(containers, keywords) {
  return containers.filter(
    (container) =>
      container.title &&
      keywords.some((kw) =>
        container.title.toLowerCase().includes(kw.toLowerCase()),
      ),
  );
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getResult") {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs || !tabs[0]) {
        sendResponse({ error: "no-active-tab" });
        return;
      }
      const tab = tabs[0];
      try {
        // Run extraction inside the page context and return results
        const injectionResults = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (keywords) => {
            const containers = Array.from(document.querySelectorAll('[data-testid="property-card-container"]'));
            const cleanTitle = (text) =>
              (text || "").replace(/\n.*$/s, "").replace(/\s*Відкривається в новому вікні.*$/u, "").trim();

            const kws = (keywords || []).filter(Boolean).map(k => String(k).toLowerCase().trim());

            const results = containers.map((container, index) => {
              const titleEl = container.querySelector('[data-testid="title"]') ||
                container.querySelector('a[data-testid="title-link"], h3, h2, .fcab3ed991');
              const raw = titleEl ? titleEl.innerText : null;
              const title = raw ? cleanTitle(raw) : null;
              return { id: index, title };
            });

            const extracted = (kws.length)
              ? results.filter(r => r.title && kws.some(kw => r.title.toLowerCase().includes(kw)))
              : [];

            return { results, extracted };
          },
          args: [message.payload || []],
        });

        const payload = injectionResults && injectionResults[0] && injectionResults[0].result;
        const results = payload ? payload.results : [];
        const extracted = payload ? payload.extracted : [];

        if (extracted && extracted.length) {
          sendResponse({ ok: extracted });
        } else {
          sendResponse({ ok: `no-matches-found; results: ${JSON.stringify(results)}` });
        }
      } catch (err) {
        sendResponse({
          error: "injection-failed",
          details: err && err.message ? err.message : String(err),
        });
      }
    });

    // Keep the message channel open for async sendResponse
    return true;
  }
});
