// PS Assist — minimal service worker.
// Unpacked extensions can't self-update, but when the folder's files are
// replaced on disk a runtime.reload() picks the new version up. The panel's
// "⟳ ricarica estensione" button sends this message.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg === "psassist-reload") chrome.runtime.reload();
});
