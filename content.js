console.log("CONTENT SCRIPT LOADED");
alert("CONTENT SCRIPT LOADED");

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "readDom") {
    console.log("content.js: received message", msg);
    const title = document.title;
    // echo payload back for debugging
    sendResponse({ title, payload: msg.payload });
  }
});
