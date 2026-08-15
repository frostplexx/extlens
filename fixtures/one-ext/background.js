chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "fetch") {
    fetch(msg.url).then((r) => r.text()).then((t) => sendResponse(t));
    return true;
  }
});

chrome.webRequest.onBeforeRequest.addListener(
  (details) => ({ cancel: true }),
  { urls: ["*://*.example.com/*"] },
  ["blocking"]
);

chrome.webRequest.onHeadersReceived.addListener(
  (details) => ({ responseHeaders: details.responseHeaders }),
  { urls: ["*://*.example.com/*"] },
  ["blocking", "responseHeaders"]
);

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: "inject" });
    });
  }
});

chrome.storage.local.get(["settings"], (items) => {
  const settings = items.settings || {};
  chrome.storage.local.set({ settings: { ...settings, injected: true } });
});
