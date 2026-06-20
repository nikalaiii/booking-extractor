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
            const extractor = {
              onlyNumbers: (text) => (text || "").replace(/\D/g, "").trim(),
              cleanKeywords: (keywords) => {
                const kws = (keywords || [])
                  .filter(Boolean)
                  .map((k) => String(k).toLowerCase().trim());
                return kws;
              },

              cleanTitle: (text) =>
                (text || "")
                  .replace(/\n.*$/s, "")
                  .replace(/\s*Відкривається в новому вікні.*$/u, "")
                  .trim(),

              extractElements: (containers) => {
                const results = containers.map((container, index) => {
                  const titleEl =
                    container.querySelector('[data-testid="title"]') ||
                    container.querySelector(
                      'a[data-testid="title-link"], h3, h2, .fcab3ed991',
                    );
                  const priceEl = container.querySelector(
                    '[data-testid="price-and-discounted-price"]',
                  );
                  const raw = titleEl ? titleEl.innerText : null;
                  const title = raw ? extractor.cleanTitle(raw) : null;
                  const price = priceEl
                    ? extractor.onlyNumbers(priceEl.innerText)
                    : null;
                  return { id: index, title, price };
                });
                return results;
              },

              filterExtracted: (results, keywords) => {
                const kws = extractor.cleanKeywords(keywords);
                const filtered = kws.length
                  ? results.filter(
                      (r) =>
                        r.title &&
                        kws.some((kw) => r.title.toLowerCase().includes(kw)),
                    )
                  : [];
                return filtered;
              },
            };
            // find property card containers correctly
            const containers = Array.from(
              document.querySelectorAll('[data-testid="property-card-container"]')
            );

            // get date textContent and extract numeric parts
            const startNode = document.querySelector('[data-testid="date-display-field-start"]');
            const endNode = document.querySelector('[data-testid="date-display-field-end"]');
            const startDate = extractor.onlyNumbers(startNode ? startNode.textContent : '');
            const endDate = extractor.onlyNumbers(endNode ? endNode.textContent : '');

            const scope = `${startDate} - ${endDate}`;

            const results = extractor.extractElements(containers);

            const filtered = extractor.filterExtracted(results, keywords);

            return { results, filtered, scope };
          },
          args: [message.payload || []],
        });

        const payload =
          injectionResults && injectionResults[0] && injectionResults[0].result;
        const results = payload ? payload.results : [];
        const filtered = payload ? payload.filtered : [];
        const scope = payload ? payload.scope : null;

        if (filtered && filtered.length) {
          sendResponse({ ok: filtered, timeScope: scope });
        } else {
          sendResponse({
            ok: false,
          });
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
