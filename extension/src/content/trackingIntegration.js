/**
 * TalentScreen - Form Tracking Integration
 * Connects FormTracker with content script autofill logic
 * @version 2.0.0
 */

(function() {
    'use strict';

    // Integration wrapper for FormTracker
    const TrackingIntegration = {
        initialized: false,
        currentStrategy: null,

        /**
         * Initialize tracking for a new autofill session
         */
        init(atsType, strategy) {
            if (!window.FormTracker) {
                console.warn('[TrackingIntegration] FormTracker not available');
                return;
            }

            const jobUrl = window.location.href;
            const company = this.extractCompanyName() || '';

            FormTracker.startSession(atsType, jobUrl, company);
            this.currentStrategy = strategy;
            this.initialized = true;

            console.log('[TrackingIntegration] Session started', { atsType, company });
        },

        /**
         * Extract company name from page
         */
        extractCompanyName() {
            // Try common selectors for company name
            const selectors = [
                '[data-company-name]',
                '.company-name',
                '.employer-name',
                'h1',
                '.job-company'
            ];

            for (const selector of selectors) {
                const elem = document.querySelector(selector);
                if (elem && elem.textContent) {
                    return elem.textContent.trim();
                }
            }

            // Try to extract from title
            const titleMatch = document.title.match(/(.+?)\s*[-|–]\s*/);
            if (titleMatch) {
                return titleMatch[1].trim();
            }

            return '';
        },

        /**
         * Track field detection
         */
        trackField(element, label, type, options = {}) {
            if (!this.initialized || !window.FormTracker) return;

            const fieldId = this.generateFieldId(element);
            
            // Accurately parse the label and type
            const extractedLabel = label || this.extractLabel(element);
            const fieldType = type || element.type || element.tagName.toLowerCase();
            
            // Check standard attributes, label asterisks, and resume fields for required status
            const isRequired = element.required || 
                               element.hasAttribute('required') || 
                               element.getAttribute('aria-required') === 'true' ||
                               extractedLabel.includes('*') ||
                               (fieldType === 'file' && extractedLabel.toLowerCase().includes('resume'));
                               
            const fieldData = {
                label: extractedLabel,
                type: fieldType,
                required: isRequired,
                selector: this.getSelector(element),
                confidence: options.confidence || 1.0,
                name: element.name,
                id: element.id
            };

            FormTracker.registerField(fieldId, fieldData);
            return fieldId;
        },

        /**
         * Track successful fill
         */
        trackFilled(element, value, valueSource) {
            if (!this.initialized || !window.FormTracker) return;

            const fieldId = this.generateFieldId(element);
            FormTracker.markFilled(fieldId, value, valueSource);
        },

        /**
         * Track skipped field
         */
        trackSkipped(element, reason = 'no_data') {
            if (!this.initialized || !window.FormTracker) return;

            const fieldId = this.generateFieldId(element);
            FormTracker.markSkipped(fieldId, reason);
        },

        /**
         * Track failed field
         */
        trackFailed(element, error) {
            if (!this.initialized || !window.FormTracker) return;

            const fieldId = this.generateFieldId(element);
            FormTracker.markFailed(fieldId, error);
        },

        /**
         * Track field needing review
         */
        trackNeedsReview(element, reason) {
            if (!this.initialized || !window.FormTracker) return;

            const fieldId = this.generateFieldId(element);
            FormTracker.markNeedsReview(fieldId, reason);
        },

        /**
         * Scan for new fields (for multi-step forms)
         */
        scanNewFields() {
            if (!this.initialized || !window.FormTracker) return;

            FormTracker.scanForNewFields(() => {
                const fields = this.detectAllFields();
                return fields.map(f => ({
                    id: this.generateFieldId(f.element),
                    label: f.label,
                    type: f.type,
                    required: f.required
                }));
            });
        },

        /**
         * Detect all form fields on page
         */
        detectAllFields() {
            const fields = [];
            const formElements = document.querySelectorAll('input, select, textarea');

            formElements.forEach(elem => {
                if (elem.type === 'hidden' || elem.type === 'submit' || elem.type === 'button') {
                    return;
                }

                fields.push({
                    element: elem,
                    label: this.extractLabel(elem),
                    type: elem.type || elem.tagName.toLowerCase(),
                    required: elem.required || elem.hasAttribute('required')
                });
            });

            return fields;
        },

        /**
         * Process retries
         */
        async processRetries(fillCallback) {
            if (!this.initialized || !window.FormTracker) return;

            await FormTracker.processRetries(async (fieldId, state) => {
                try {
                    const element = this.findElementById(fieldId);
                    if (!element) return false;

                    return await fillCallback(element, state);
                } catch (error) {
                    console.error('[TrackingIntegration] Retry error:', error);
                    return false;
                }
            });
        },

        /**
         * Mark submission detected
         */
        trackSubmission() {
            if (!this.initialized || !window.FormTracker) return;

            FormTracker.markSubmissionDetected();
        },

        /**
         * End tracking session
         */
        endSession(status = 'completed') {
            if (!this.initialized || !window.FormTracker) return;

            FormTracker.endSession(status);
            this.initialized = false;
            this.currentStrategy = null;
        },

        /**
         * Generate consistent field ID
         */
        generateFieldId(element) {
            // Prevent collisions by stamping the element once
            if (element.dataset.afTrackingId) return element.dataset.afTrackingId;

            let id = '';
            if (element.id) return `id:${element.id}`;
            if (element.name) return `name:${element.name}`;

            const label = this.extractLabel(element);
            if (label && label !== 'unknown') id = `label:${label.toLowerCase().replace(/\s+/g, '-')}`;
            else id = `xpath:${this.getXPath(element)}`;
            
            // Add unique suffix if it's too generic to prevent overwriting
            id = `${id}-${Math.random().toString(36).substr(2, 5)}`;
            element.dataset.afTrackingId = id;
            
            return id;
        },

        /**
         * Extract label for field
         */
        extractLabel(element) {
            let label = '';
            
            // Try parent label first
            if (element.parentElement && element.parentElement.tagName === 'LABEL') {
                label = element.parentElement.innerText;
            } else if (element.id) {
                const labelEl = document.querySelector(`label[for="${element.id}"]`);
                if (labelEl) label = labelEl.innerText;
            }

            // Try closest wrapper for floating labels (React/Material-UI)
            if (!label) {
                // Use strict selectors to avoid matching the entire form container!
                const wrapper = element.closest('.MuiFormControl-root, .form-group, .field, [class^="field-"], [class^="form-group"]');
                if (wrapper) {
                    const inputsInWrapper = wrapper.querySelectorAll('input:not([type="hidden"]), select, textarea');
                    if (inputsInWrapper.length <= 1) {
                        const wrapperLabel = wrapper.querySelector('label') || wrapper.querySelector('[class*="label"]');
                        if (wrapperLabel) label = wrapperLabel.innerText;
                    }
                }
                
                // Extra fallback for strict React hierarchies
                if (!label && element.parentElement) {
                    let pLabel = element.parentElement.querySelector('label');
                    if (!pLabel && element.parentElement.parentElement) {
                        const inputsInParent = element.parentElement.parentElement.querySelectorAll('input:not([type="hidden"]), select, textarea');
                        if (inputsInParent.length <= 1) {
                            pLabel = element.parentElement.parentElement.querySelector('label');
                        }
                    }
                    if (pLabel) label = pLabel.innerText;
                }
            }

            // Try aria-labelledby
            if (!label && element.getAttribute('aria-labelledby')) {
                const labelElement = document.getElementById(element.getAttribute('aria-labelledby'));
                if (labelElement) label = labelElement.innerText;
            }

            // Try aria-label
            if (!label && element.getAttribute('aria-label')) label = element.getAttribute('aria-label');

            // Try placeholder
            if (!label && element.placeholder) label = element.placeholder;

            // Try data attributes
            if (!label && element.getAttribute('data-label')) label = element.getAttribute('data-label');
            if (!label && element.getAttribute('data-automation-id')) label = element.getAttribute('data-automation-id');
            
            // Check for file inputs explicitly
            if (!label && element.type === 'file') label = 'Resume / File Upload';

            // Try name or id
            if (!label) label = element.name || element.id || 'unknown';
            
            return label.split('\n')[0].trim(); // Split multi-line labels so they look clean in UI
        },

        /**
         * Get CSS selector for element
         */
        getSelector(element) {
            if (element.id) return `#${element.id}`;
            if (element.name) return `[name="${element.name}"]`;
            return element.tagName.toLowerCase();
        },

        /**
         * Get XPath for element
         */
        getXPath(element) {
            if (element.id) return `//*[@id="${element.id}"]`;

            const parts = [];
            while (element && element.nodeType === Node.ELEMENT_NODE) {
                let index = 0;
                let sibling = element.previousSibling;
                while (sibling) {
                    if (sibling.nodeType === Node.ELEMENT_NODE && sibling.tagName === element.tagName) {
                        index++;
                    }
                    sibling = sibling.previousSibling;
                }

                const tagName = element.tagName.toLowerCase();
                const pathIndex = index > 0 ? `[${index + 1}]` : '';
                parts.unshift(tagName + pathIndex);

                element = element.parentNode;
            }

            return parts.length ? '/' + parts.join('/') : '';
        },

        /**
         * Find element by field ID
         */
        findElementById(fieldId) {
            const [type, value] = fieldId.split(':', 2);

            if (type === 'id') {
                return document.getElementById(value);
            } else if (type === 'name') {
                return document.querySelector(`[name="${value}"]`);
            } else if (type === 'label') {
                const label = value.replace(/-/g, ' ');
                const allFields = this.detectAllFields();
                const found = allFields.find(f =>
                    f.label.toLowerCase().includes(label) ||
                    label.includes(f.label.toLowerCase())
                );
                return found ? found.element : null;
            } else if (type === 'xpath') {
                const result = document.evaluate(value, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                return result.singleNodeValue;
            }

            return null;
        }
    };

    // Make available globally
    window.TrackingIntegration = TrackingIntegration;

    // Listen for messages from sidepanel
    if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === 'get_tracking_data') {
                if (window.FormTracker) {
                    const data = FormTracker.exportSessionData();
                    sendResponse(data);
                } else {
                    sendResponse(null);
                }
                return true;
            }

            if (request.action === 'retry_failed_fields') {
                if (window.FormTracker && TrackingIntegration.initialized) {
                    TrackingIntegration.processRetries(async (element, state) => {
                        // This would need to call the actual fill logic
                        // For now, just return false to indicate retry not implemented
                        return false;
                    }).then(() => {
                        sendResponse({ success: true });
                    });
                    return true;
                } else {
                    sendResponse({ success: false, error: 'Not initialized' });
                }
                return true;
            }

            if (request.action === 'set_debug_mode') {
                if (window.FormTracker) {
                    FormTracker.setDebugMode(request.enabled);
                    sendResponse({ success: true });
                } else {
                    sendResponse({ success: false });
                }
                return true;
            }

            if (request.action === 'export_tracking_data') {
                if (window.FormTracker) {
                    const data = FormTracker.exportSessionData();
                    sendResponse(data);
                } else {
                    sendResponse(null);
                }
                return true;
            }
        });
    }

    console.log('[TrackingIntegration] Integration layer loaded');
})();
