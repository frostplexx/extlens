const input = document.getElementById("input");
const save = document.getElementById("save");

save.addEventListener("click", () => {
  const value = input.value;
  chrome.storage.local.set({ value });
});
