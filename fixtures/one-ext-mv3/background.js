chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "fetch") {
    fetch(msg.url).then((r) => r.text()).then((t) => sendResponse(t));
    return true;
  }
});

// webRequest blocking is gone in MV3; the example.com block moved to rules.json.

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: "inject" });
    });
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["settings"], (items) => {
    const settings = items.settings || {};
    chrome.storage.local.set({ settings: { ...settings, injected: true } });
  });
});
