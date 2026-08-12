/**
 * TalentScreen - Whitebox Portal Watcher Content Script
 * Automatically extracts user email from Whitebox dashboard hidden element
 */

(function () {
  'use strict';

  function detectUserIdentity() {
    const identityEl = document.getElementById("wbl-user-identity");
    if (identityEl) {
      const email = identityEl.getAttribute("data-email");
      if (email && email.trim()) {
        chrome.storage.local.set({ userEmail: email.trim() }, () => {
          console.log("[TalentScreen] Telemetry user email saved:", email.trim());
        });
        return true;
      }
    }
    return false;
  }

  // Try immediately
  if (!detectUserIdentity()) {
    // If not found immediately, use a MutationObserver to watch for dynamic DOM updates (common in SPAs)
    const observer = new MutationObserver((mutations, obs) => {
      if (detectUserIdentity()) {
        obs.disconnect(); // Stop observing once found
      }
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });

    // Also fall back to page load completed
    window.addEventListener('load', () => {
      if (detectUserIdentity()) {
        observer.disconnect();
      }
    });
  }
})();
