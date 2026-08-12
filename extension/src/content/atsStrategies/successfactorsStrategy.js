/**
 * successfactorsStrategy.js
 * Strategy for SAP SuccessFactors application forms (sapsf.com, successfactors.com).
 *
 * SuccessFactors is a UI5-based SPA with:
 * - Dynamically generated field IDs (not stable across organizations)
 * - aria-* attributes for accessibility (reliable for matching)
 * - Custom SAP UI5 select/combobox controls (not native <select>)
 * - Form content loaded asynchronously after page shell renders
 *
 * This strategy uses aria labels, placeholder text, and container context
 * for field matching, and handles UI5 custom controls.
 */
class SuccessFactorsStrategy extends GenericStrategy {
    constructor() {
        super();
        this.CONFIDENCE_THRESHOLD = 65;
    }

    async execute(normalizedData, resumeFile = null) {
        // SuccessFactors forms are SPA-rendered — wait for form to stabilize
        await this._waitForSFForm();

        // Handle resume upload first (SF may have drag-drop zones or file inputs)
        if (resumeFile) {
            this.handleFileUpload(resumeFile);
        }

        // Handle initial entry (click Apply if on job listing page)
        const entryClicked = this.handleInitialEntry();
        if (entryClicked) {
            await this.sleep(2000);
            // Re-wait for form after navigation
            await this._waitForSFForm();
        }

        // Run generic strategy for standard inputs
        await super.execute(normalizedData, resumeFile);

        // After generic pass, handle SuccessFactors-specific UI5 controls
        await this._handleUI5Controls(normalizedData);

        // Handle any remaining aria-labeled fields the generic pass missed
        await this._handleAriaLabeledFields(normalizedData);
    }

    /**
     * Wait for SuccessFactors SPA form to finish rendering.
     * UI5 apps load form content asynchronously; we poll until fields appear.
     */
    async _waitForSFForm() {
        const maxWait = 5000;
        const interval = 400;
        const start = Date.now();
        let lastCount = 0;
        let stableChecks = 0;

        while (Date.now() - start < maxWait) {
            const count = document.querySelectorAll(
                'input:not([type="hidden"]), textarea, select, [role="combobox"], [role="textbox"], [role="listbox"]'
            ).length;

            if (count >= 2 && count === lastCount) {
                stableChecks++;
                if (stableChecks >= 2) return;
            } else {
                stableChecks = 0;
            }
            lastCount = count;
            await this.sleep(interval);
        }
    }

    /**
     * Override findValueForInput with SuccessFactors-specific matching.
     * SF uses aria-label, aria-describedby, placeholder, and data-* attributes
     * rather than predictable name/id patterns.
     */
    findValueForInput(input, normalizedData) {
        const identity = normalizedData?.identity || {};
        const contact = normalizedData?.contact || {};
        const employment = normalizedData?.employment || {};
        const education = normalizedData?.education?.[0] || {};

        // Gather all text signals from the field and its context
        const combined = this._getSFFieldContext(input);

        // --- Identity ---
        if (this._matches(combined, ['first name', 'first_name', 'firstname', 'fname', 'given name', 'prénom'])) {
            return { value: identity.first_name, confidence: 95, fieldKey: 'identity.first_name' };
        }
        if (this._matches(combined, ['middle name', 'middle_name', 'middlename', 'middle initial'])) {
            return { value: identity.middle_name, confidence: 90, fieldKey: 'identity.middle_name' };
        }
        if (this._matches(combined, ['last name', 'last_name', 'lastname', 'lname', 'surname', 'family name'])) {
            return { value: identity.last_name, confidence: 95, fieldKey: 'identity.last_name' };
        }

        // --- Contact ---
        if (this._matches(combined, ['email', 'e-mail', 'email address', 'e mail'])) {
            return { value: contact.email, confidence: 95, fieldKey: 'contact.email' };
        }
        if (this._matches(combined, ['phone', 'mobile', 'telephone', 'cell', 'phone number', 'tel'])) {
            return { value: contact.phone, confidence: 95, fieldKey: 'contact.phone' };
        }
        if (this._matches(combined, ['address', 'street', 'address line']) && !combined.includes('email')) {
            return { value: contact.address, confidence: 85, fieldKey: 'contact.address' };
        }
        if (this._matches(combined, ['city', 'town']) && !combined.includes('state') && !combined.includes('country')) {
            return { value: contact.city, confidence: 90, fieldKey: 'contact.city' };
        }
        if (this._matches(combined, ['state', 'province', 'region']) && !combined.includes('city')) {
            return { value: contact.state, confidence: 90, fieldKey: 'contact.state' };
        }
        if (this._matches(combined, ['zip', 'postal code', 'zip code', 'postcode'])) {
            return { value: contact.zip_code, confidence: 90, fieldKey: 'contact.zip_code' };
        }
        if (this._matches(combined, ['country'])) {
            return { value: contact.country, confidence: 90, fieldKey: 'contact.country' };
        }
        if (this._matches(combined, ['linkedin'])) {
            return { value: contact.linkedin, confidence: 90, fieldKey: 'contact.linkedin' };
        }
        if (this._matches(combined, ['website', 'portfolio', 'personal url'])) {
            return { value: contact.portfolio || contact.github, confidence: 85, fieldKey: 'contact.portfolio' };
        }

        // --- Employment ---
        if (this._matches(combined, ['current title', 'job title', 'current position', 'position title', 'title']) &&
            !combined.includes('company') && !combined.includes('school')) {
            const role = employment.history?.[0]?.position || employment.current_role;
            return { value: role, confidence: 85, fieldKey: 'employment.current_role' };
        }
        if (this._matches(combined, ['company', 'employer', 'organization', 'company name', 'current employer'])) {
            const company = employment.history?.[0]?.company || employment.history?.[0]?.name || employment.current_company;
            return { value: company, confidence: 85, fieldKey: 'employment.current_company' };
        }
        if (this._matches(combined, ['years of experience', 'total experience', 'work experience years'])) {
            return { value: employment.years_total, confidence: 85, fieldKey: 'employment.years_total' };
        }

        // --- Education ---
        if (this._matches(combined, ['school', 'university', 'college', 'institution'])) {
            return { value: education.institution, confidence: 85, fieldKey: 'education_flat.institution' };
        }
        if (this._matches(combined, ['degree', 'level of education'])) {
            return { value: education.degree, confidence: 85, fieldKey: 'education_flat.degree' };
        }
        if (this._matches(combined, ['major', 'field of study', 'specialization'])) {
            return { value: education.major || education.area, confidence: 85, fieldKey: 'education_flat.major' };
        }

        // --- Legal / EEO ---
        if (this._matches(combined, ['authorized to work', 'legally authorized', 'work authorization', 'eligible to work', 'legal right to work'])) {
            return { value: identity.authorized_to_work || 'Yes', confidence: 95, fieldKey: 'identity.authorized_to_work' };
        }
        if (this._matches(combined, ['sponsorship', 'sponsor', 'visa sponsorship', 'require sponsorship'])) {
            return { value: identity.sponsorship_required || 'No', confidence: 95, fieldKey: 'identity.sponsorship_required' };
        }
        if (this._matches(combined, ['gender', 'sex'])) {
            return { value: identity.gender, confidence: 85, fieldKey: 'identity.gender' };
        }
        if (this._matches(combined, ['veteran', 'military'])) {
            return { value: identity.veteran_status, confidence: 85, fieldKey: 'identity.veteran_status' };
        }
        if (this._matches(combined, ['disability', 'handicap'])) {
            return { value: identity.disability_status, confidence: 85, fieldKey: 'identity.disability_status' };
        }
        if (this._matches(combined, ['ethnicity', 'race'])) {
            return { value: identity.ethnicity, confidence: 85, fieldKey: 'identity.ethnicity' };
        }

        // --- Source / Referral ---
        if (this._matches(combined, ['how did you hear', 'source', 'referral', 'how did you find'])) {
            return { value: normalizedData?.summary?.source || 'Job Board', confidence: 80, fieldKey: 'summary.source' };
        }

        // --- Salary / Availability ---
        if (this._matches(combined, ['desired salary', 'salary expectation', 'compensation'])) {
            return { value: identity.expected_salary || 'Negotiable', confidence: 75, fieldKey: 'identity.expected_salary' };
        }
        if (this._matches(combined, ['start date', 'available to start', 'availability', 'earliest start'])) {
            return { value: normalizedData?.availability?.start_date || 'Immediately', confidence: 80, fieldKey: 'availability.start_date' };
        }
        if (this._matches(combined, ['relocate', 'relocation', 'willing to relocate'])) {
            return { value: identity.relocation_open || 'Yes', confidence: 85, fieldKey: 'identity.relocation_open' };
        }

        // --- Summary / Cover Letter ---
        if (this._matches(combined, ['cover letter', 'additional information', 'message'])) {
            return { value: normalizedData?.summary?.short || '', confidence: 70, fieldKey: 'summary.short' };
        }
        if (this._matches(combined, ['professional statement', 'describe your experience', 'about you'])) {
            return { value: normalizedData?.summary?.professional_statement || normalizedData?.summary?.short || '', confidence: 75, fieldKey: 'summary.professional_statement' };
        }

        // Fall back to generic matching
        return super.findValueForInput(input, normalizedData);
    }

    /**
     * Gather all contextual text for a SuccessFactors field.
     * Combines aria attributes, labels, placeholders, and container text.
     */
    _getSFFieldContext(input) {
        const parts = [];

        // Standard attributes
        parts.push(input.getAttribute('aria-label') || '');
        parts.push(input.getAttribute('placeholder') || '');
        parts.push(input.getAttribute('title') || '');
        parts.push(input.name || '');
        parts.push(input.id || '');

        // aria-describedby text
        const describedBy = input.getAttribute('aria-describedby');
        if (describedBy) {
            describedBy.split(/\s+/).forEach(id => {
                const el = document.getElementById(id);
                if (el) parts.push(el.textContent || '');
            });
        }

        // aria-labelledby text
        const labelledBy = input.getAttribute('aria-labelledby');
        if (labelledBy) {
            labelledBy.split(/\s+/).forEach(id => {
                const el = document.getElementById(id);
                if (el) parts.push(el.textContent || '');
            });
        }

        // Standard label
        parts.push(this.getLabelText(input) || '');

        // Walk up to find container label text (UI5 often wraps fields in divs with label siblings)
        let container = input.parentElement;
        let depth = 0;
        while (container && depth < 4) {
            // Check for label, span, or div that acts as a label
            const labelEl = container.querySelector(
                'label, .sapMLabel, [class*="Label"], [class*="label"], legend, .sapMTitle'
            );
            if (labelEl && labelEl !== input && !labelEl.contains(input)) {
                parts.push(labelEl.textContent || '');
            }

            // Check container's data attributes
            const dataLabel = container.getAttribute('data-sap-ui-label') ||
                              container.getAttribute('data-label') ||
                              container.getAttribute('aria-label');
            if (dataLabel) parts.push(dataLabel);

            // Short direct text
            const directText = Array.from(container.childNodes)
                .filter(n => n.nodeType === Node.TEXT_NODE)
                .map(n => n.textContent.trim())
                .filter(t => t.length > 0 && t.length < 100)
                .join(' ');
            if (directText) parts.push(directText);

            container = container.parentElement;
            depth++;
        }

        return parts.join(' ').toLowerCase().replace(/\s+/g, ' ').trim();
    }

    /**
     * Handle SAP UI5 custom select/combobox controls.
     * UI5 uses <div> with role="combobox" or custom select-like elements
     * that are not native <select> tags.
     */
    async _handleUI5Controls(normalizedData) {
        // Find UI5 comboboxes and custom selects
        const ui5Controls = document.querySelectorAll(
            '[role="combobox"]:not(select):not(input), ' +
            '.sapMComboBox, .sapMSelect, .sapMMultiComboBox, ' +
            '[class*="combobox"], [class*="Combobox"], ' +
            'sap-combobox, sap-select'
        );

        for (const control of ui5Controls) {
            // Skip already filled controls
            const input = control.querySelector('input') || control;
            if (input.value && input.value.trim() !== '') continue;

            // Get context for matching
            const combined = this._getSFFieldContext(control);
            const match = this._getMatchForContext(combined, normalizedData);

            if (match && match.value) {
                await this._fillUI5Control(control, match.value);
            }
        }
    }

    /**
     * Fill a UI5 custom control by simulating user interaction:
     * 1. Click to open the dropdown
     * 2. Find and click the matching option
     * 3. Fallback: set the inner input's value directly
     */
    async _fillUI5Control(control, value) {
        const stringValue = String(value).toLowerCase();

        // Try to find an inner input and set it directly first
        const innerInput = control.querySelector('input');
        if (innerInput) {
            this.setInputValue(innerInput, value);
            await this.sleep(100);

            // Check if the value was accepted
            if (innerInput.value && innerInput.value.toLowerCase().includes(stringValue)) {
                return;
            }
        }

        // Try clicking to open dropdown and find option
        try {
            // Click the control to open dropdown
            const trigger = control.querySelector('[class*="arrow"], [class*="icon"], button') || control;
            trigger.click();
            await this.sleep(300);

            // Look for the dropdown list items
            const listItems = document.querySelectorAll(
                '[role="option"], [role="listitem"], .sapMSelectListItem, ' +
                '.sapMComboBoxBaseItem, li[class*="item"], [class*="Option"]'
            );

            for (const item of listItems) {
                const itemText = (item.textContent || '').toLowerCase().trim();
                if (itemText.includes(stringValue) || stringValue.includes(itemText)) {
                    item.click();
                    await this.sleep(100);
                    return;
                }
            }

            // Close dropdown if no match found
            document.body.click();
        } catch (e) {
            // Silent — UI5 control interaction can be fragile
        }
    }

    /**
     * Handle fields that have aria-label but no matching name/id.
     * This catches fields that the generic strategy might miss.
     */
    async _handleAriaLabeledFields(normalizedData) {
        const allInputs = document.querySelectorAll(
            'input[aria-label]:not([type="hidden"]), ' +
            'textarea[aria-label], ' +
            'select[aria-label], ' +
            'input[aria-labelledby]:not([type="hidden"]), ' +
            'textarea[aria-labelledby]'
        );

        for (const input of allInputs) {
            // Skip filled fields
            if (input.value && input.value.trim() !== '') continue;
            if (input.disabled || input.readOnly) continue;
            if (input.dataset.afUserLocked === 'true') continue;

            const combined = this._getSFFieldContext(input);
            const match = this._getMatchForContext(combined, normalizedData);

            if (match && match.value && match.confidence >= this.CONFIDENCE_THRESHOLD) {
                this.setInputValue(input, match.value, 'green');
            }
        }
    }

    /**
     * Get a match result for a given context string.
     * Used by UI5 control and aria-label handlers.
     */
    _getMatchForContext(combined, normalizedData) {
        const identity = normalizedData?.identity || {};
        const contact = normalizedData?.contact || {};

        if (this._matches(combined, ['first name', 'firstname'])) return { value: identity.first_name, confidence: 95 };
        if (this._matches(combined, ['last name', 'lastname'])) return { value: identity.last_name, confidence: 95 };
        if (this._matches(combined, ['email'])) return { value: contact.email, confidence: 95 };
        if (this._matches(combined, ['phone', 'mobile', 'telephone'])) return { value: contact.phone, confidence: 95 };
        if (this._matches(combined, ['city', 'town'])) return { value: contact.city, confidence: 90 };
        if (this._matches(combined, ['state', 'province'])) return { value: contact.state, confidence: 90 };
        if (this._matches(combined, ['zip', 'postal'])) return { value: contact.zip_code, confidence: 90 };
        if (this._matches(combined, ['country'])) return { value: contact.country, confidence: 90 };
        if (this._matches(combined, ['address']) && !combined.includes('email')) return { value: contact.address, confidence: 85 };
        if (this._matches(combined, ['gender'])) return { value: identity.gender, confidence: 85 };
        if (this._matches(combined, ['veteran'])) return { value: identity.veteran_status, confidence: 85 };
        if (this._matches(combined, ['disability'])) return { value: identity.disability_status, confidence: 85 };
        if (this._matches(combined, ['ethnicity', 'race'])) return { value: identity.ethnicity, confidence: 85 };

        return null;
    }

    /**
     * Helper: check if combined text matches any of the given keywords.
     */
    _matches(combined, keywords) {
        return keywords.some(kw => combined.includes(kw));
    }

    /**
     * Override handleFileUpload for SuccessFactors-specific patterns.
     * SF sometimes uses drag-drop zones with hidden file inputs.
     */
    handleFileUpload(resumeFile) {
        if (!resumeFile || !resumeFile.data) return;

        // Try generic approach first
        super.handleFileUpload(resumeFile);
        if (this._hasUploadedResume) return;

        // Fallback: Look for SF-specific upload patterns
        const sessionKey = `af_uploaded_${window.location.hostname}${window.location.pathname}`;
        const fileIdentifier = `${resumeFile.name}_${resumeFile.size}`;

        if (!this.isManual && sessionStorage.getItem(sessionKey) === fileIdentifier) {
            return;
        }

        // SF may hide file inputs inside upload widgets
        const uploadAreas = document.querySelectorAll(
            '[class*="upload"], [class*="Upload"], [class*="dropzone"], ' +
            '[class*="FileUpload"], [class*="file-upload"], [class*="resume"]'
        );

        for (const area of uploadAreas) {
            const containerText = (area.textContent || '').toLowerCase();
            if (containerText.includes('cover letter')) continue;

            const fileInput = area.querySelector('input[type="file"]');
            if (fileInput && (!fileInput.files || fileInput.files.length === 0) && fileInput.dataset.afUploaded !== 'true') {
                try {
                    const byteString = atob(resumeFile.data.split(',')[1]);
                    const mimeString = resumeFile.data.split(',')[0].split(':')[1].split(';')[0];
                    const ab = new ArrayBuffer(byteString.length);
                    const ia = new Uint8Array(ab);
                    for (let i = 0; i < byteString.length; i++) {
                        ia[i] = byteString.charCodeAt(i);
                    }
                    const blob = new Blob([ab], { type: mimeString });
                    const file = new File([blob], resumeFile.name, { type: mimeString });

                    const dataTransfer = new DataTransfer();
                    dataTransfer.items.add(file);
                    fileInput.files = dataTransfer.files;

                    ['change', 'input', 'blur'].forEach(ev => {
                        fileInput.dispatchEvent(new Event(ev, { bubbles: true, composed: true }));
                    });

                    // Trigger jQuery change event if jQuery is available on the page
                    try {
                        const $ = window.jQuery || window.$;
                        if ($ && typeof $.fn !== 'undefined') {
                            $(fileInput).trigger('change');
                        }
                    } catch (e) { /* silent */ }

                    fileInput.dataset.afUploaded = 'true';
                    sessionStorage.setItem(sessionKey, fileIdentifier);
                    sessionStorage.setItem(`af_uploaded_${window.location.hostname}`, 'true'); // content.js compatibility
                    this._hasUploadedResume = true;
                    break;
                } catch (e) {
                    console.error('AutoFill: Error attaching file to SuccessFactors', e);
                }
            }
        }
    }
}

// Register with Strategy Registry
if (typeof ATSStrategyRegistry !== 'undefined') {
    ATSStrategyRegistry.register(
        (url, doc) => url.includes('sapsf.com') || url.includes('successfactors.com') || url.includes('successfactors.eu'),
        SuccessFactorsStrategy
    );
}
