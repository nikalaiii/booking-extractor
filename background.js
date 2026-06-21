/* 
основная проблема яка зявилась при инйекции в хром, ето то шо он як якась девственница блять не може нормально
впускать в себе експортні модулі, йобаний підарас блять. в ітоге пришлось як далбайоб писать весь код в одну хуйню.
як результат - легше уже прочитать санскрит чим цей піздец.
не знаю як тут вообще можна хоть шось понять, але попробую описать коментами.
*/

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getResult") {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs || !tabs[0]) {
        sendResponse({ error: "no-active-tab" });
        return;
      }
      const tab = tabs[0];
      try {
        // инйекция скрипта в хром. используеться контекст текущей страницы
        const injectionResults = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (keywords) => {
            // головний обєкт екстрактора. в ідеалі він мав би бути в окремому модулі.
            // але кому тут блять не похуй де він єбеться? нахуй ООП, я так чуствую, я так пишу
            const extractor = {
              // метод для очистки цен букінга, тут убирається все кроме намберов
              onlyNumbers: (text) => (text || "").replace(/\D/g, "").trim(),

              // чистим запрос от фронта. в ідеалі це робить фронт. але кому ж тут не похуй хто це має делать
              cleanKeywords: (keywords) => {
                const kws = (keywords || [])
                  .filter(Boolean)
                  .map((k) => String(k).toLowerCase().trim());
                return kws;
              },

              // у букінга якогось хуя копируєються додаткові фрази кроме обичних названий тайтлов
              // і тому їм так само як євреям прийшлось робить блятьське обрізаніє
              cleanTitle: (text) =>
                (text || "")
                  .replace(/\n.*$/s, "")
                  .replace(/\s*Відкривається в новому вікні.*$/u, "")
                  .trim(),

                  // шукаєм ключаві теги які мають в собі те шо нам нада. поиск по тест атрибутам
                  // я сам в ахуе як я до такого зміг додуматься
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

              // оставляєм тільки ті теги які запрошує фронт, робим простенький фільтр на інклюд
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

            // после описания и недо-декларации обектива, начинаєм його єбать на практике,
            // тут нічо сложного, гпт і так уже написав шо ми робим.
            // find property card containers correctly
            const containers = Array.from(
              document.querySelectorAll(
                '[data-testid="property-card-container"]',
              ),
            );

            // get date textContent and extract numeric parts
            const startNode = document.querySelector(
              '[data-testid="date-display-field-start"]',
            );
            const endNode = document.querySelector(
              '[data-testid="date-display-field-end"]',
            );
            const startDate = extractor.onlyNumbers(
              startNode ? startNode.textContent : "",
            );
            const endDate = extractor.onlyNumbers(
              endNode ? endNode.textContent : "",
            );

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
