chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "inject") {
    const data = btoa(JSON.stringify({ source: "content" }));
    document.title = atob(data);
  }
  sendResponse({ ok: true });
});

fetch(chrome.runtime.getURL("assets/data.json"))
  .then((r) => r.json())
  .then((data) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", "https://example.com/api");
    xhr.send();
  });
