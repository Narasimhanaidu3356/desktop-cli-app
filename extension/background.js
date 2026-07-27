const DEFAULT_API_URL = "http://localhost:8000/api";

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

async function getAutomationPayload() {
  const saved = await chrome.storage.local.get([
    "candidateProfile", "resumeFile", "automationEnabled", "apiUrl", "extensionToken",
  ]);
  if (!saved.automationEnabled || !saved.candidateProfile || !saved.resumeFile) return null;
  return {
    applicationId: `local-${Date.now()}`,
    candidate: saved.candidateProfile,
    resumeFile: saved.resumeFile,
  };
}

async function startInTab(tabId, frameId) {
  const payload = await getAutomationPayload();
  if (!payload) return false;
  try {
    const options = Number.isInteger(frameId) ? { frameId } : undefined;
    await chrome.tabs.sendMessage(tabId, { type: "TALENTSCREEN_START", payload }, options);
    return true;
  } catch {
    return false;
  }
}

async function reportToBackend(applicationId, status, detail) {
  if (applicationId.startsWith("local-")) return;
  const saved = await chrome.storage.local.get(["apiUrl", "extensionToken"]);
  if (!saved.extensionToken) return;
  await fetch(`${saved.apiUrl || DEFAULT_API_URL}/talentscreen/extension/applications/${applicationId}/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${saved.extensionToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ status, detail, occurredAt: new Date().toISOString() }),
  });
}

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local" || !changes.automationEnabled?.newValue) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) await startInTab(tab.id);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "TALENTSCREEN_PAGE_READY") {
    if (!sender.tab?.id) return;
    startInTab(sender.tab.id).then((started) => sendResponse({ ok: true, started }));
    return true;
  }
  if (message.type === "TALENTSCREEN_EVENT") {
    chrome.storage.local.set({ lastAutomationEvent: {
      applicationId: message.applicationId, status: message.status,
      detail: message.detail || {}, updatedAt: new Date().toISOString(),
    }});
    reportToBackend(message.applicationId, message.status, message.detail)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});
