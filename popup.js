const form = document.querySelector("form");
const list = document.querySelector("ul");
const input = document.getElementById("searchInput");
const findButton = document.getElementById("findButton");

function getKeywords() {
  return Array.from(list.querySelectorAll("li")).map((k) => k.textContent);
}

// Handle form submit to add a keyword
form.addEventListener("submit", (event) => {
  event.preventDefault();
  const keyword = input.value.trim();
  if (keyword) {
    console.log("Adding keyword:", keyword);
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

// When starting the search, re-query the list to get current items
findButton.addEventListener("click", () => {
    chrome.runtime.sendMessage(
    { action: "getResult", payload: getKeywords() },
    (response) => {
      console.log("received response:", response);
      alert("received response => " + (response === undefined ? "(no response)" : JSON.stringify(response)));
    },
  );
});
