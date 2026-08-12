/**
 * paycomStrategy.js
 * Strategy for Paycom application forms (paycomonline.net).
 *
 * Paycom's ATS portal lives on paycomonline.net (NOT paycom.com which is
 * the corporate marketing site).  Forms are dynamically rendered with
 * configurable fields per employer, so we rely on label / aria-label /
 * placeholder / nearby-text heuristics rather than hard-coded DOM IDs.
 */
class PaycomStrategy extends GenericStrategy {
    constructor() {
        super();
        this.CONFIDENCE_THRESHOLD = 65; // Slightly lower for Paycom's varied field labels
    }

    async execute(normalizedData, resumeFile = null) {
        // Paycom forms are often dynamically loaded — wait for form stabilization
        await this._waitForPaycomForm();

        // Run the generic strategy which handles standard inputs, file upload, etc.
        await super.execute(normalizedData, resumeFile);

        // After generic pass, handle any Paycom-specific custom dropdowns
        this._handlePaycomCustomDropdowns(normalizedData);
    }

    /**
     * Wait for Paycom's dynamic form to finish rendering.
     * Polls until at least 3 input fields are visible or 4 seconds elapse.
     */
    async _waitForPaycomForm() {
        const maxWait = 4000;
        const interval = 300;
        const start = Date.now();
        let lastCount = 0;
        let stableChecks = 0;

        while (Date.now() - start < maxWait) {
            const count = document.querySelectorAll(
                'input:not([type="hidden"]), textarea, select'
            ).length;

            if (count >= 3 && count === lastCount) {
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
     * Override findValueForInput with Paycom-specific matching.
     * Paycom forms use diverse label text; we combine label, aria-label,
     * placeholder, name, id, and nearby container text for matching.
     */
    findValueForInput(input, normalizedData) {
        const features = this.extractFeatures(input);
        const combined = [
            features.label_text,
            features.aria_label,
            features.placeholder,
            features.name_attr,
            features.id_attr,
            features.nearby_text
        ].join(' ').toLowerCase();

        const identity = normalizedData?.identity || {};
        const contact = normalizedData?.contact || {};
        const employment = normalizedData?.employment || {};
        const education = normalizedData?.education?.[0] || {};

        // --- Identity ---
        if (this._matches(combined, ['first name', 'first_name', 'firstname', 'fname', 'given name'])) {
            return { value: identity.first_name, confidence: 95, fieldKey: 'identity.first_name' };
        }
        if (this._matches(combined, ['middle name', 'middle_name', 'middlename', 'middle initial', 'm.i.'])) {
            return { value: identity.middle_name, confidence: 90, fieldKey: 'identity.middle_name' };
        }
        if (this._matches(combined, ['last name', 'last_name', 'lastname', 'lname', 'surname', 'family name'])) {
            return { value: identity.last_name, confidence: 95, fieldKey: 'identity.last_name' };
        }

        // --- Contact ---
        if (this._matches(combined, ['email', 'e-mail', 'email address'])) {
            return { value: contact.email, confidence: 95, fieldKey: 'contact.email' };
        }
        if (this._matches(combined, ['phone', 'mobile', 'telephone', 'cell', 'phone number'])) {
            return { value: contact.phone, confidence: 95, fieldKey: 'contact.phone' };
        }
        if (this._matches(combined, ['address', 'street address', 'address line 1', 'address1']) && !combined.includes('email')) {
            return { value: contact.address, confidence: 90, fieldKey: 'contact.address' };
        }
        if (this._matches(combined, ['city', 'town']) && !combined.includes('state')) {
            return { value: contact.city, confidence: 90, fieldKey: 'contact.city' };
        }
        if (this._matches(combined, ['state', 'province', 'region']) && !combined.includes('city')) {
            return { value: contact.state, confidence: 90, fieldKey: 'contact.state' };
        }
        if (this._matches(combined, ['zip', 'postal code', 'zip code', 'zipcode'])) {
            return { value: contact.zip_code, confidence: 90, fieldKey: 'contact.zip_code' };
        }
        if (this._matches(combined, ['country'])) {
            return { value: contact.country, confidence: 90, fieldKey: 'contact.country' };
        }
        if (this._matches(combined, ['linkedin'])) {
            return { value: contact.linkedin, confidence: 90, fieldKey: 'contact.linkedin' };
        }

        // --- Employment ---
        if (this._matches(combined, ['job title', 'position title', 'current title', 'current role', 'title'])) {
            const role = employment.history?.[0]?.position || employment.current_role;
            return { value: role, confidence: 85, fieldKey: 'employment.current_role' };
        }
        if (this._matches(combined, ['company', 'employer', 'organization', 'company name'])) {
            const company = employment.history?.[0]?.company || employment.history?.[0]?.name || employment.current_company;
            return { value: company, confidence: 85, fieldKey: 'employment.current_company' };
        }

        // --- Legal / EEO ---
        if (this._matches(combined, ['authorized to work', 'legally authorized', 'work authorization', 'eligible to work'])) {
            return { value: identity.authorized_to_work || 'Yes', confidence: 95, fieldKey: 'identity.authorized_to_work' };
        }
        if (this._matches(combined, ['sponsorship', 'sponsor', 'visa', 'require sponsorship'])) {
            return { value: identity.sponsorship_required || 'No', confidence: 95, fieldKey: 'identity.sponsorship_required' };
        }
        if (this._matches(combined, ['how did you hear', 'how did you find', 'source', 'referral source'])) {
            return { value: normalizedData?.summary?.source || 'Job Board', confidence: 80, fieldKey: 'summary.source' };
        }

        // --- Desired Salary / Availability ---
        if (this._matches(combined, ['desired salary', 'salary expectation', 'expected salary', 'compensation'])) {
            return { value: identity.expected_salary || 'Negotiable', confidence: 80, fieldKey: 'identity.expected_salary' };
        }
        if (this._matches(combined, ['start date', 'available to start', 'availability', 'earliest start'])) {
            return { value: normalizedData?.availability?.start_date || 'Immediately', confidence: 80, fieldKey: 'availability.start_date' };
        }

        // Fall back to generic matching
        return super.findValueForInput(input, normalizedData);
    }

    /**
     * Handle Paycom's custom dropdowns that may not be native <select> elements.
     * Some Paycom forms use div-based dropdowns with hidden inputs.
     */
    _handlePaycomCustomDropdowns(normalizedData) {
        // Look for custom dropdown triggers with hidden input backing
        const dropdownTriggers = document.querySelectorAll(
            '[role="listbox"], [role="combobox"], [aria-haspopup="listbox"]'
        );

        dropdownTriggers.forEach(trigger => {
            const container = trigger.closest('.form-group, .field-container, .form-field, div[class*="field"]');
            if (!container) return;

            const label = container.querySelector('label')?.innerText?.toLowerCase() || '';
            const hiddenInput = container.querySelector('input[type="hidden"]') || container.querySelector('input');

            if (!hiddenInput || hiddenInput.value) return;

            // Try to match the label to our data
            const contact = normalizedData?.contact || {};
            const identity = normalizedData?.identity || {};

            let targetValue = null;
            if (label.includes('state') || label.includes('province')) {
                targetValue = contact.state;
            } else if (label.includes('country')) {
                targetValue = contact.country;
            } else if (label.includes('gender')) {
                targetValue = identity.gender;
            }

            if (targetValue && hiddenInput) {
                this.setInputValue(hiddenInput, targetValue);
            }
        });
    }

    /**
     * Helper: check if combined text matches any of the given keywords.
     */
    _matches(combined, keywords) {
        return keywords.some(kw => combined.includes(kw));
    }
}

// Register with Strategy Registry
if (typeof ATSStrategyRegistry !== 'undefined') {
    ATSStrategyRegistry.register(
        (url, doc) => url.includes('paycomonline.net') || url.includes('paycom.com'),
        PaycomStrategy
    );
}
