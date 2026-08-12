/**
 * TalentScreen AutoFill - Google Analytics 4 Measurement Protocol Tracking
 * Handles event logging from the service worker background thread.
 */

const GA_MEASUREMENT_ID = 'G-H4BB4J5XK3'; // Replace with your GA4 Measurement ID
const GA_API_SECRET = 'SUDVDH2uTjePmUiKrwuVIA'; // Replace with your GA4 Measurement Protocol API Secret

class AnalyticsTracker {
  /**
   * Get or create a persistent client ID (UUID) for this installation.
   */
  static async getClientId() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['analytics_client_id'], (result) => {
        if (result.analytics_client_id) {
          resolve(result.analytics_client_id);
        } else {
          // Generate a simple UUID
          const uuid = 'af-' + Array.from(crypto.getRandomValues(new Uint8Array(16)))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('')
            .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
          chrome.storage.local.set({ analytics_client_id: uuid }, () => {
            resolve(uuid);
          });
        }
      });
    });
  }

  /**
   * Get candidate details (name and email) from the normalized resume data.
   */
  static async getCandidateInfo() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['normalizedData'], (result) => {
        if (result.normalizedData && result.normalizedData.identity) {
          resolve({
            email: result.normalizedData.identity.email || result.normalizedData.contact?.email || 'unknown',
            name: result.normalizedData.identity.full_name || 'unknown'
          });
        } else {
          resolve({ email: 'none', name: 'none' });
        }
      });
    });
  }

  /**
   * Sends an event to GA4 Measurement Protocol
   * @param {string} name - Event name (only letters, numbers, underscores)
   * @param {object} params - Event parameters
   */
  static async trackEvent(name, params = {}) {
    if (GA_MEASUREMENT_ID.startsWith('G-XXX') || GA_API_SECRET.startsWith('YOUR_API')) {
      console.warn(`[Analytics] Event '${name}' not sent: GA_MEASUREMENT_ID or GA_API_SECRET is not configured.`);
      return;
    }

    try {
      const clientId = await this.getClientId();
      const candidateInfo = await this.getCandidateInfo();

      // Combine standard parameters with custom dimensions
      const payloadParams = {
        candidate_email: candidateInfo.email,
        candidate_name: candidateInfo.name,
        engagement_time_msec: '100',
        ...params
      };

      const payload = {
        client_id: clientId,
        events: [
          {
            name: name,
            params: payloadParams
          }
        ]
      };

      const url = `https://www.google-analytics.com/mp/collect?measurement_id=${GA_MEASUREMENT_ID}&api_secret=${GA_API_SECRET}`;

      const response = await fetch(url, {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        console.error('[Analytics] Failed to send tracking event:', response.statusText);
      } else {
        console.log(`[Analytics] Tracked event: ${name}`, payloadParams);
      }
    } catch (error) {
      console.error('[Analytics] Error tracking event:', error);
    }
  }
}

// Make globally accessible in background script context
self.AnalyticsTracker =  AnalyticsTracker;
