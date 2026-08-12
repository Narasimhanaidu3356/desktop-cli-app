/**
 * oraclecloudStrategy.js
 * Strategy for Oracle Recruiting Cloud (Oracle Cloud HCM / Dell Careers) application forms.
 */
class OracleCloudStrategy extends GenericStrategy {
    constructor() {
        super();
        this.CONFIDENCE_THRESHOLD = 65; // High confidence matching
    }

    /**
     * Recursively collects all elements from standard DOM and nested Shadow roots.
     */
    collectFields(root = document, fields = []) {
        if (!root) return fields;

        // Query standard inputs and Oracle JET custom elements
        const selectors = [
            'input', 'textarea', 'select',
            'oj-input-text', 'oj-input-number', 'oj-input-date', 'oj-input-password',
            'oj-text-area', 'oj-combobox-one', 'oj-select-single',
            'oj-checkboxset', 'oj-radioset', 'oj-switch',
            'oj-c-input-text', 'oj-c-text-area', 'oj-c-radioset', 'oj-c-checkboxset', 'oj-c-select-single'
        ];

        const inputs = root.querySelectorAll(selectors.join(', '));
        inputs.forEach(input => {
            if (!fields.includes(input)) {
                fields.push(input);
            }
        });

        // Recursively inspect Shadow DOM of all elements
        const allElements = root.querySelectorAll('*');
        allElements.forEach(el => {
            if (el.shadowRoot) {
                this.collectFields(el.shadowRoot, fields);
            }
        });

        return fields;
    }

    /**
     * Enhances label extraction by reading Oracle JET specific attributes like label-hint
     * or looking for oj-label components pointing to the elements.
     */
    extractFeatures(input) {
        const features = super.extractFeatures(input);

        // Extract Oracle JET label-hint property or attribute
        const labelHint = input.getAttribute('label-hint') || input.labelHint || '';
        if (labelHint) {
            features.label_text = (features.label_text + " " + labelHint).trim().toLowerCase();
        }

        // Support for associated oj-label components
        if (input.id) {
            const ojLabel = document.querySelector(`oj-label[for="${input.id}"]`);
            if (ojLabel) {
                features.label_text = (features.label_text + " " + ojLabel.innerText).trim().toLowerCase();
            }
        }

        // Re-compile normalized string with the enriched label text
        const normalizeIdName = str => (str || "").replace(/[-_]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
        features.normalized_combined = [
            normalizeIdName(input.name),
            normalizeIdName(input.id),
            features.label_text,
            input.getAttribute('aria-label') || ""
        ].join(" ").toLowerCase().replace(/[^a-z0-9]/g, ' ');

        return features;
    }

    /**
     * Programmatically sets values on standard inputs and JET elements,
     * triggering both standard and custom JET observers to ensure Knockout binding sync.
     */
    setInputValue(input, value, highlightType = 'green') {
        if (!input || (!value && highlightType !== 'red')) return;

        const tagName = input.tagName.toLowerCase();
        const isJetComponent = tagName.startsWith('oj-');

        if (value) {
            try {
                if (tagName === 'select') {
                    this.setSelectValue(input, value);
                } else {
                    // Set the underlying DOM property
                    input.value = value;

                    // Set standard React/framework value descriptors if applicable
                    const proto = tagName === 'textarea'
                        ? window.HTMLTextAreaElement.prototype
                        : window.HTMLInputElement.prototype;
                    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

                    if (nativeSetter) {
                        nativeSetter.call(input, value);
                    }

                    const tracker = input._valueTracker;
                    if (tracker) {
                        tracker.setValue('');
                    }

                    // JET-specific property update API
                    if (isJetComponent && typeof input.setProperty === 'function') {
                        input.setProperty('value', value);
                    }
                }

                // Dispatch events to trigger page reactive bindings
                const eventsToFire = ['input', 'change', 'blur'];
                if (isJetComponent) {
                    eventsToFire.push('valueChanged', 'ojValueChanged', 'rawValue-changed', 'rawValueChanged');
                }

                eventsToFire.forEach(eventType => {
                    const event = isJetComponent
                        ? new CustomEvent(eventType, { detail: { value: value, previousValue: null }, bubbles: true, composed: true })
                        : new Event(eventType, { bubbles: true, composed: true });
                    input.dispatchEvent(event);
                });

            } catch (error) {
                console.error("[OracleCloudStrategy] Error writing to field:", error);
            }
        }

        // Apply visual autofill highlighting
        const originalBg = input.style.backgroundColor;
        const originalBorder = input.style.border;

        if (highlightType === 'green') {
            input.style.backgroundColor = "#dcfce7";
            input.style.border = "2px solid #22c55e";
            setTimeout(() => {
                input.style.backgroundColor = originalBg;
                input.style.border = originalBorder;
            }, 3000);
        } else if (highlightType === 'red') {
            input.style.backgroundColor = "#fee2e2";
            input.style.border = "2px solid #ef4444";
        }
    }

    /**
     * Handles Oracle JET radio and checkbox group selections (oj-radioset, oj-checkboxset)
     * by evaluating options and setting the container selection array/value directly.
     */
    handleOjRadiosetCheckboxset(container, normalizedData) {
        const match = this.findValueForInput(container, normalizedData);
        if (!match || (!match.value && match.value !== "")) return;

        const targetValue = this.normalizeYesNoDecline(String(match.value));
        const isCheckboxset = container.tagName.toLowerCase().includes('checkboxset');

        const options = Array.from(container.querySelectorAll('oj-option, input'));
        if (options.length === 0) return;

        const matchedValues = [];

        for (const opt of options) {
            const optVal = opt.value || opt.getAttribute('value') || "";
            const optText = (opt.innerText || opt.textContent || "").toLowerCase().trim();
            const normalizedOptText = this.normalizeYesNoDecline(optText);
            const normalizedOptVal = this.normalizeYesNoDecline(optVal);

            let isMatch = false;

            if (targetValue === 'no' && (normalizedOptVal === 'no' || normalizedOptText === 'no' || optText.includes("not") || optText === 'n')) {
                isMatch = true;
            } else if (targetValue === 'yes' && (normalizedOptVal === 'yes' || normalizedOptText === 'yes' || optText === 'y' || optText === 'true')) {
                isMatch = true;
            } else if (targetValue === 'decline' && (normalizedOptVal === 'decline' || normalizedOptText === 'decline' || optText.includes('decline') || optText.includes('prefer not'))) {
                isMatch = true;
            } else {
                const cleanTarget = String(match.value).toLowerCase().trim();
                const cleanOptVal = String(optVal).toLowerCase().trim();
                if (cleanOptVal === cleanTarget || optText === cleanTarget || optText.includes(cleanTarget) || cleanTarget.includes(optText)) {
                    isMatch = true;
                }
            }

            if (isMatch) {
                matchedValues.push(optVal);
                if (!isCheckboxset) break;
            }
        }

        if (matchedValues.length > 0) {
            const newValue = isCheckboxset ? matchedValues : matchedValues[0];
            this.setInputValue(container, newValue, 'green');
        }
    }

    /**
     * Handles custom Oracle JET select fields (oj-select-single, oj-combobox-one)
     * by resolving child options or setting the value programmatically.
     */
    handleOjDropdown(container, normalizedData) {
        const match = this.findValueForInput(container, normalizedData);
        if (!match || !match.value) return;

        const targetValue = match.value;
        const options = Array.from(container.querySelectorAll('oj-option'));
        let bestValue = targetValue;
        let highestConfidence = 0;

        if (options.length > 0) {
            const normalize = (s) => String(s).toLowerCase().replace(/[^\w\s]/g, '').trim();
            const val = normalize(targetValue);
            const usVariations = this.getUSVariations();
            const isUS = usVariations.includes(val);
            const mappedVal = this.normalizeYesNoDecline(targetValue);

            for (const option of options) {
                const optText = normalize(option.text || option.innerText || "");
                const optVal = option.value || option.getAttribute('value') || "";
                const cleanOptVal = normalize(optVal);

                if (cleanOptVal === val || optText === val) {
                    bestValue = optVal;
                    highestConfidence = 100;
                    break;
                }

                if (mappedVal === 'no' && (optText.includes("not") || optText === 'no')) {
                    if (98 > highestConfidence) { bestValue = optVal; highestConfidence = 98; }
                }
                if (mappedVal === 'yes' && (optText === 'yes' || optText === 'true')) {
                    if (98 > highestConfidence) { bestValue = optVal; highestConfidence = 98; }
                }

                if (isUS && (usVariations.includes(cleanOptVal) || usVariations.includes(optText))) {
                    if (95 > highestConfidence) { bestValue = optVal; highestConfidence = 95; }
                }

                if (optText.startsWith(val) || val.startsWith(optText)) {
                    if (90 > highestConfidence) { bestValue = optVal; highestConfidence = 90; }
                } else if (optText.includes(val) || val.includes(optText)) {
                    if (70 > highestConfidence) { bestValue = optVal; highestConfidence = 70; }
                }
            }
        }

        this.setInputValue(container, bestValue, 'green');
    }

    /**
     * Executes the Oracle Recruiting Cloud Strategy form-filling sequence.
     */
    async execute(normalizedData, resumeFile = null) {
        // console.log("Executing Oracle Recruiting Cloud Strategy (Dell Careers)...");

        // 1. Initial Entry Clicker (Close modallings or skip starts)
        const entryClicked = this.handleInitialEntry();
        if (entryClicked) {
            await this.sleep(1000);
        }

        // 2. Handle Resume Attachment Upload
        if (resumeFile) {
            this.handleFileUpload(resumeFile);
        }

        // 3. Traverse and fill fields recursively (including all shadowroots)
        const allFields = this.collectFields(document);
        let fillCount = 0;
        let totalInteractable = 0;

        for (const field of allFields) {
            if (field.disabled || field.readOnly) continue;
            if (field.dataset.afUserLocked === 'true') continue;

            const tagName = field.tagName.toLowerCase();

            // Handle checkboxset / radioset containers
            if (tagName.includes('checkboxset') || tagName.includes('radioset')) {
                totalInteractable++;
                this.handleOjRadiosetCheckboxset(field, normalizedData);
                fillCount++;
                continue;
            }

            // Handle custom dropdowns
            if (tagName.includes('combobox') || tagName.includes('select-single')) {
                totalInteractable++;
                this.handleOjDropdown(field, normalizedData);
                fillCount++;
                continue;
            }

            // Handle standard and customized single-value inputs
            if (tagName === 'input' || tagName === 'textarea' || tagName === 'select' || tagName.startsWith('oj-input') || tagName.startsWith('oj-text-area')) {
                // Radio/Checkbox items inside sets or independently
                if (field.type === 'radio' || field.type === 'checkbox') {
                    totalInteractable++;
                    this.handleRadioCheckbox(field, normalizedData);
                    if (field.checked) fillCount++;
                    continue;
                }

                // Skip if already filled
                if (field.value && field.value.trim() !== '') {
                    totalInteractable++;
                    fillCount++;
                    continue;
                }

                totalInteractable++;
                const match = this.findValueForInput(field, normalizedData);
                if (match && match.value) {
                    if (match.confidence >= this.CONFIDENCE_THRESHOLD) {
                        this.setInputValue(field, match.value, 'green');
                        fillCount++;
                    }
                } else {
                    if (field.required || field.getAttribute('aria-required') === 'true') {
                        this.highlightUnmatchedRequired(field);
                    }
                }
            }
        }

        // Send execution telemetry back to sidepanel progress bar
        if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
            chrome.runtime.sendMessage({ action: 'update_progress', filled: fillCount, total: totalInteractable });
        }

        return { filled: fillCount, total: totalInteractable };
    }
}

// Register with Strategy Registry
if (typeof ATSStrategyRegistry !== 'undefined') {
    ATSStrategyRegistry.register(
        (url, doc) => url.includes('oraclecloud.com') || (doc && (doc.querySelector('oj-form-layout') !== null || doc.querySelector('[id*="candidateExperience"]') !== null)),
        OracleCloudStrategy
    );
}

