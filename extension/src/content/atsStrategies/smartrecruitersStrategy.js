/**
 * smartrecruitersStrategy.js
 * Strategy for SmartRecruiters application forms (React SPA)
 * Enhanced with Shadow DOM traversal, form stabilization, React input support,
 * and mutation observer.
 *
 * KEY FIX: SmartRecruiters uses Shadow DOM to encapsulate form fields.
 * Standard document.querySelectorAll cannot see inside shadow roots.
 * This strategy now recursively traverses all open shadow roots.
 */
class SmartRecruitersStrategy extends GenericStrategy {
    constructor() {
        super();
        this.CONFIDENCE_THRESHOLD = 50; // Lower for SmartRecruiters' varied field labels

        this.config = {
            confidenceThreshold: 50,
            maxRetries: 3,
            retryDelay: 150,
            formStabilizationWait: 5000,
            formStabilizationCheckInterval: 400,
            minFieldsThreshold: 2,
            mutationObserverTimeout: 30000,
            secondPassDelay: 2500,
            debug: this.isDebugMode()
        };

        this.filledFields = new Set();
    }

    isDebugMode() {
        try {
            return localStorage.getItem('smartrecruiters_debug') === 'true';
        } catch (e) {
            return false;
        }
    }

    log(...args) {
        if (this.config.debug) {
            console.log('[SmartRecruiters]', ...args);
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // =========================================================================
    //  SHADOW DOM TRAVERSAL — The core fix for SmartRecruiters
    // =========================================================================

    /**
     * Recursively query all elements matching a selector, including those
     * inside open Shadow DOM boundaries.
     * @param {string} selector - CSS selector to match
     * @param {Node} root - Starting node (defaults to document)
     * @returns {Element[]} Array of all matching elements, including those in shadow roots
     */
    querySelectorAllDeep(selector, root = document) {
        const results = [];

        // 1. Query elements in the current root
        try {
            const matches = root.querySelectorAll(selector);
            results.push(...matches);
        } catch (e) {
            // Shadow roots that don't support querySelectorAll
        }

        // 2. Find all elements that may host a shadow root
        const allElements = root.querySelectorAll ? root.querySelectorAll('*') : [];
        for (const el of allElements) {
            if (el.shadowRoot) {
                // Recurse into the shadow root
                const shadowMatches = this.querySelectorAllDeep(selector, el.shadowRoot);
                results.push(...shadowMatches);
            }
        }

        // 3. Also check slots — slotted content lives in the light DOM
        //    but may reference labels in the shadow DOM
        return results;
    }

    /**
     * Get the closest ancestor matching a selector, crossing shadow DOM boundaries.
     * @param {Element} element
     * @param {string} selector
     * @returns {Element|null}
     */
    closestDeep(element, selector) {
        let current = element;
        while (current) {
            // Try standard closest
            if (current.closest) {
                const result = current.closest(selector);
                if (result) return result;
            }

            // Cross shadow boundary — go to the shadow host
            const root = current.getRootNode();
            if (root instanceof ShadowRoot) {
                current = root.host;
            } else {
                break;
            }
        }
        return null;
    }

    /**
     * Get label text for an element, searching up through shadow DOM boundaries.
     * SmartRecruiters often puts labels in <slot> elements or separate shadow subtrees.
     * @param {Element} field
     * @returns {string}
     */
    getLabelDeep(field) {
        const labels = [];

        // 1. Standard label associations
        if (field.labels && field.labels.length > 0) {
            for (const lbl of field.labels) {
                labels.push(lbl.textContent.trim());
            }
        }

        // 2. label[for] in same root
        if (field.id) {
            const root = field.getRootNode();
            const lbl = root.querySelector?.(`label[for="${field.id}"]`);
            if (lbl) labels.push(lbl.textContent.trim());
        }

        // 3. Wrapping <label>
        const wrappingLabel = this.closestDeep(field, 'label');
        if (wrappingLabel) labels.push(wrappingLabel.textContent.trim());

        // 4. aria-label / aria-labelledby
        const ariaLabel = field.getAttribute('aria-label');
        if (ariaLabel) labels.push(ariaLabel);

        const labelledBy = field.getAttribute('aria-labelledby');
        if (labelledBy) {
            const root = field.getRootNode();
            const lblEl = root.getElementById?.(labelledBy) || document.getElementById(labelledBy);
            if (lblEl) labels.push(lblEl.textContent.trim());
        }

        // 5. Walk up through shadow boundaries to find contextual label text
        let container = field.parentElement;
        let depth = 0;
        while (container && depth < 5) {
            // Look for label, legend, or heading in this container
            const labelEl = container.querySelector?.('label, legend, h3, h4, .field-label, [class*="label"], [class*="question"]');
            if (labelEl && labelEl !== field) {
                labels.push(labelEl.textContent.trim());
            }

            // Check the container's own text (if it's short enough to be a label)
            const directText = this._getDirectTextContent(container);
            if (directText && directText.length > 0 && directText.length < 200) {
                labels.push(directText);
            }

            container = container.parentElement;
            if (!container) {
                // Try crossing shadow boundary
                const root = (depth === 0 ? field : container || field).getRootNode();
                if (root instanceof ShadowRoot) {
                    container = root.host;
                }
            }
            depth++;
        }

        return labels.filter(Boolean).join(' ');
    }

    /**
     * Get only the direct text content of an element (not its children's text).
     */
    _getDirectTextContent(element) {
        let text = '';
        for (const node of element.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
                text += node.textContent;
            }
        }
        return text.trim();
    }

    // =========================================================================
    //  FIELD DETECTION — Uses deep traversal
    // =========================================================================

    /**
     * Wait for SPA form to stabilize, using deep DOM traversal
     */
    async waitForFormStabilization() {
        this.log('Waiting for form stabilization...');

        const startTime = Date.now();
        let lastFieldCount = 0;
        let stableCount = 0;
        const requiredStableChecks = 3;

        while (Date.now() - startTime < this.config.formStabilizationWait) {
            const fields = this.detectFields();
            const currentCount = fields.length;

            this.log(`Field count: ${currentCount} (last: ${lastFieldCount})`);

            if (currentCount === lastFieldCount && currentCount >= this.config.minFieldsThreshold) {
                stableCount++;
                if (stableCount >= requiredStableChecks) {
                    this.log(`Form stabilized with ${currentCount} fields`);
                    return true;
                }
            } else {
                stableCount = 0;
            }

            lastFieldCount = currentCount;
            await this.sleep(this.config.formStabilizationCheckInterval);
        }

        this.log(`Form stabilization timeout. Found ${lastFieldCount} fields`);
        return lastFieldCount >= this.config.minFieldsThreshold;
    }

    /**
     * Detect all form fields, including those inside Shadow DOM.
     */
    detectFields() {
        const selectors = [
            'input[type="text"]:not([type="hidden"])',
            'input[type="email"]',
            'input[type="tel"]',
            'input[type="url"]',
            'input[type="number"]',
            'input[type="date"]',
            'input:not([type])',
            'textarea',
            'select',
            'input[type="radio"]',
            'input[type="checkbox"]',
            '[role="combobox"]',
            '[role="textbox"]',
            '[contenteditable="true"]'
        ];

        // Use deep traversal to find fields inside shadow DOM
        let allFields = [];
        for (const selector of selectors) {
            const found = this.querySelectorAllDeep(selector);
            allFields.push(...found);
        }

        // Deduplicate
        allFields = [...new Set(allFields)];

        const fields = allFields.filter(field => {
            // Skip hidden fields
            if (field.type === 'hidden') return false;

            // Visibility check — must be in the layout
            // For shadow DOM elements, offsetParent may be null even if visible,
            // so we also check getBoundingClientRect
            const isVisible = field.offsetParent !== null ||
                field.type === 'radio' ||
                field.type === 'checkbox' ||
                (field.getBoundingClientRect && field.getBoundingClientRect().height > 0);
            if (!isVisible) return false;

            // Skip already filled fields (unless radio/checkbox)
            if (field.type !== 'radio' && field.type !== 'checkbox') {
                if (field.value && field.value.trim() !== '') return false;
            }

            return true;
        });

        return fields;
    }

    // =========================================================================
    //  FEATURE EXTRACTION — Shadow DOM aware
    // =========================================================================

    /**
     * Extract enhanced features from field, crossing shadow DOM boundaries
     */
    extractFeatures(field) {
        const features = [];

        // Get label text using our deep label finder
        const labelText = this.getLabelDeep(field);
        if (labelText) features.push(labelText);

        // Get all standard attributes
        ['aria-label', 'placeholder', 'name', 'id', 'data-testid', 'data-test', 'autocomplete', 'title'].forEach(attr => {
            const value = field.getAttribute(attr);
            if (value) features.push(value);
        });

        // Get surrounding text from parent container (with shadow DOM awareness)
        const parent = this.closestDeep(field, '[class*="question"], [class*="field"], .form-group, [class*="section"]');
        if (parent) {
            const text = parent.textContent;
            if (text && text.length < 500) {
                features.push(text);
            }
        }

        return features.join(' ').toLowerCase().replace(/\s+/g, ' ').trim();
    }

    // =========================================================================
    //  FIELD MATCHING
    // =========================================================================

    /**
     * Find best match for field
     */
    findBestMatch(field, data) {
        const text = this.extractFeatures(field);
        const fieldType = field.type?.toLowerCase() || 'text';

        this.log(`Matching field: "${text.substring(0, 100)}..." (type: ${fieldType})`);

        // First name
        if ((text.includes('first') && text.includes('name')) || text.includes('firstname') || text.includes('given name')) {
            return { value: data.identity?.first_name, confidence: 100, key: 'first_name' };
        }

        // Last name
        if ((text.includes('last') && text.includes('name')) || text.includes('lastname') || text.includes('surname') || text.includes('family name')) {
            return { value: data.identity?.last_name, confidence: 100, key: 'last_name' };
        }

        // Full name
        if (text.includes('full name') || (text.includes('name') && !text.includes('first') && !text.includes('last') && !text.includes('company'))) {
            const fullName = `${data.identity?.first_name || ''} ${data.identity?.last_name || ''}`.trim();
            if (fullName) {
                return { value: fullName, confidence: 90, key: 'full_name' };
            }
        }

        // Email
        if (text.includes('email') || text.includes('e-mail') || fieldType === 'email') {
            return { value: data.contact?.email, confidence: 100, key: 'email' };
        }

        // Phone
        if (text.includes('phone') || text.includes('mobile') || text.includes('telephone') || fieldType === 'tel') {
            return { value: data.contact?.phone, confidence: 100, key: 'phone' };
        }

        // LinkedIn
        if (text.includes('linkedin') && (text.includes('url') || text.includes('profile') || text.includes('link'))) {
            return { value: data.contact?.linkedin, confidence: 95, key: 'linkedin' };
        }

        // Website/Portfolio
        if ((text.includes('website') || text.includes('portfolio') || text.includes('personal site')) && !text.includes('company')) {
            return { value: data.contact?.website, confidence: 90, key: 'website' };
        }

        // City
        if ((text.includes('city') || text.includes('town')) && !text.includes('state')) {
            return { value: data.contact?.city, confidence: 90, key: 'city' };
        }

        // State
        if (text.includes('state') || text.includes('province') || text.includes('region')) {
            return { value: data.contact?.state, confidence: 90, key: 'state' };
        }

        // Zip/Postal Code
        if (text.includes('zip') || text.includes('postal')) {
            return { value: data.contact?.zip, confidence: 90, key: 'zip' };
        }

        // Country
        if (text.includes('country')) {
            return { value: data.contact?.country, confidence: 90, key: 'country' };
        }

        // Address
        if (text.includes('address') && !text.includes('email')) {
            return { value: data.contact?.address, confidence: 85, key: 'address' };
        }

        // Work authorization (radio/checkbox) - use custom_fields
        if ((text.includes('authorized') || text.includes('authorization')) && (text.includes('work') || text.includes('employment'))) {
            if (fieldType === 'radio' || fieldType === 'checkbox') {
                const workAuth = data.custom_fields?.legal?.work_auth_us !== undefined
                    ? data.custom_fields.legal.work_auth_us
                    : true;
                // Look for "Yes" option
                if (text.includes('yes') || field.value === '1' || field.value.toLowerCase() === 'yes') {
                    return { value: workAuth, confidence: 95, key: 'work_auth_yes' };
                }
            }
            // For text/select inputs, return "Yes"
            if (fieldType !== 'radio' && fieldType !== 'checkbox') {
                return { value: data.identity?.authorized_to_work || 'Yes', confidence: 95, key: 'work_auth' };
            }
        }

        // Sponsorship (radio/checkbox) - use custom_fields
        if (text.includes('sponsor') && (text.includes('visa') || text.includes('employment') || text.includes('require'))) {
            if (fieldType === 'radio' || fieldType === 'checkbox') {
                const needsSponsorship = data.custom_fields?.legal?.sponsorship_required_now ||
                    data.custom_fields?.legal?.sponsorship_required_future ||
                    false;
                // Look for "No" option (typically don't require sponsorship)
                if (text.includes('no') || field.value === '0' || field.value.toLowerCase() === 'no') {
                    return { value: !needsSponsorship, confidence: 95, key: 'sponsorship_no' };
                }
                // Look for "Yes" option
                if (text.includes('yes') || field.value === '1' || field.value.toLowerCase() === 'yes') {
                    return { value: needsSponsorship, confidence: 95, key: 'sponsorship_yes' };
                }
            }
            if (fieldType !== 'radio' && fieldType !== 'checkbox') {
                return { value: data.identity?.sponsorship_required || 'No', confidence: 95, key: 'sponsorship' };
            }
        }

        // Cover letter / message - use custom screening answers
        if (text.includes('cover letter') || text.includes('message to') || text.includes('why are you') || text.includes('why interested')) {
            const answer = data.custom_fields?.application_logistics?.screening_answers?.why_interested ||
                data.summary?.text ||
                "";
            return { value: answer, confidence: 70, key: 'cover_letter' };
        }

        // Why good fit / qualifications
        if (text.includes('good fit') || text.includes('qualified') || text.includes('qualifications') || text.includes('why you')) {
            const answer = data.custom_fields?.application_logistics?.screening_answers?.why_good_fit ||
                data.summary?.professional_statement ||
                "";
            return { value: answer, confidence: 70, key: 'why_good_fit' };
        }

        // Relocation - use custom_fields
        if (text.includes('relocate') || text.includes('relocation')) {
            if (fieldType === 'radio' || fieldType === 'checkbox') {
                const willingToRelocate = data.custom_fields?.application_logistics?.willing_to_relocate === 'yes';
                // Look for "Yes" option
                if (text.includes('yes') || field.value === '1' || field.value.toLowerCase() === 'yes') {
                    return { value: willingToRelocate, confidence: 80, key: 'relocate_yes' };
                }
                // Look for "No" option
                if (text.includes('no') || field.value === '0' || field.value.toLowerCase() === 'no') {
                    return { value: !willingToRelocate, confidence: 80, key: 'relocate_no' };
                }
            }
        }

        // Veteran status - use custom_fields (for diversity questions)
        if ((text.includes('veteran') || text.includes('protected veteran')) && (fieldType === 'select' || fieldType === 'radio')) {
            const veteranStatus = data.custom_fields?.eeo?.veteran_status || 'no';
            if (veteranStatus === 'no' && text.includes('not a protected veteran')) {
                return { value: true, confidence: 90, key: 'veteran_no' };
            }
            if (veteranStatus === 'yes' && text.includes('protected veteran')) {
                return { value: true, confidence: 90, key: 'veteran_yes' };
            }
            return { value: veteranStatus, confidence: 85, key: 'veteran_status' };
        }

        // Disability status - use custom_fields
        if (text.includes('disability') && (fieldType === 'select' || fieldType === 'radio')) {
            const disabilityStatus = data.custom_fields?.eeo?.disability_status || 'no';
            if (disabilityStatus === 'no' && (text.includes('do not have') || text.includes('not have'))) {
                return { value: true, confidence: 90, key: 'disability_no' };
            }
            if (disabilityStatus === 'yes' && text.includes('have a disability')) {
                return { value: true, confidence: 90, key: 'disability_yes' };
            }
            if (text.includes('not want to answer') || text.includes('prefer not')) {
                return { value: true, confidence: 85, key: 'disability_decline' };
            }
            return { value: disabilityStatus, confidence: 80, key: 'disability_status' };
        }

        // Gender - use custom_fields
        if (text.includes('gender') && (fieldType === 'select' || fieldType === 'radio')) {
            const gender = data.custom_fields?.eeo?.gender || 'male';
            if (text.includes('prefer not')) {
                return { value: true, confidence: 90, key: 'gender_decline' };
            }
            if (gender === 'male' && text.includes('male')) {
                return { value: true, confidence: 95, key: 'gender_male' };
            }
            if (gender === 'female' && text.includes('female')) {
                return { value: true, confidence: 95, key: 'gender_female' };
            }
            return { value: gender, confidence: 85, key: 'gender' };
        }

        // Race/Ethnicity - use custom_fields
        if ((text.includes('race') || text.includes('ethnicity')) && (fieldType === 'select' || fieldType === 'radio')) {
            const ethnicity = data.custom_fields?.eeo?.ethnicity || 'asian';
            if (text.includes('prefer not')) {
                return { value: true, confidence: 90, key: 'ethnicity_decline' };
            }
            if (ethnicity === 'asian' && text.includes('asian')) {
                return { value: true, confidence: 95, key: 'ethnicity_asian' };
            }
            return { value: ethnicity, confidence: 80, key: 'ethnicity' };
        }

        // How did you hear about this job
        if (text.includes('how did you hear') || text.includes('how did you find') || text.includes('source')) {
            return { value: data.summary?.source || 'LinkedIn', confidence: 75, key: 'source' };
        }

        return { value: null, confidence: 0, key: null };
    }

    // =========================================================================
    //  FIELD FILLING — React-aware + Shadow DOM aware
    // =========================================================================

    /**
     * Fill a single field with React support and verification
     */
    async fillField(field, value, data) {
        const fieldId = this.getFieldIdentifier(field);

        if (this.filledFields.has(fieldId)) {
            this.log(`Skipping already filled field: ${fieldId}`);
            return { success: true, skipped: true };
        }

        const text = this.extractFeatures(field);
        const match = this.findBestMatch(field, data);

        if (!match.value || match.confidence < this.config.confidenceThreshold) {
            this.log(`No match for field: "${text.substring(0, 50)}..." (confidence: ${match.confidence})`);
            return { success: false, skipped: true, reason: 'Low confidence' };
        }

        this.log(`Filling field: "${text.substring(0, 50)}..." with: ${match.key}`);

        try {
            const fieldType = field.type?.toLowerCase();

            // Handle radio buttons
            if (fieldType === 'radio') {
                if (match.value === true) {
                    field.click();
                    field.checked = true;
                    field.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                    this.filledFields.add(fieldId);
                    return { success: true, method: 'radio' };
                }
                return { success: false, skipped: true };
            }

            // Handle checkboxes
            if (fieldType === 'checkbox') {
                if (match.value === true) {
                    field.click();
                    field.checked = true;
                    field.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                    this.filledFields.add(fieldId);
                    return { success: true, method: 'checkbox' };
                }
                return { success: false, skipped: true };
            }

            // Handle select dropdowns
            if (field.tagName === 'SELECT') {
                const stringValue = String(match.value);
                const option = Array.from(field.options).find(opt =>
                    opt.text.toLowerCase().includes(stringValue.toLowerCase()) ||
                    opt.value.toLowerCase().includes(stringValue.toLowerCase())
                );

                if (option) {
                    field.value = option.value;
                    field.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                    this.filledFields.add(fieldId);
                    return { success: true, method: 'select' };
                }
                return { success: false, reason: 'Option not found' };
            }

            // Handle combobox (if ComboboxHandler available)
            if (field.getAttribute('role') === 'combobox' && typeof ComboboxHandler !== 'undefined') {
                const result = await ComboboxHandler.fillCombobox(field, match.value, {
                    debug: this.config.debug
                });
                if (result.success) {
                    this.filledFields.add(fieldId);
                }
                return result;
            }

            // Handle contenteditable elements
            if (field.getAttribute('contenteditable') === 'true' || field.getAttribute('role') === 'textbox') {
                field.focus();
                field.textContent = match.value;
                field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                field.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                field.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
                this.filledFields.add(fieldId);
                return { success: true, method: 'contenteditable' };
            }

            // Handle regular text inputs with React support
            // Use the native setter approach to bypass React's value interception
            const proto = field.tagName === 'TEXTAREA'
                ? window.HTMLTextAreaElement.prototype
                : window.HTMLInputElement.prototype;
            const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

            if (nativeSetter) {
                nativeSetter.call(field, match.value);
            } else {
                field.value = match.value;
            }

            // Clear React's internal value tracker so it sees the change
            const tracker = field._valueTracker;
            if (tracker) {
                tracker.setValue('');
            }

            // Dispatch events with composed:true to cross shadow DOM boundaries
            field.dispatchEvent(new Event('focus', { bubbles: true, composed: true }));
            field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            field.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            field.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));

            // Verify the value stuck
            await this.sleep(50);
            if (field.value === match.value) {
                this.filledFields.add(fieldId);
                return { success: true, method: 'native_setter' };
            }

            // Retry with ReactInputHelper if available
            if (typeof ReactInputHelper !== 'undefined') {
                const result = await ReactInputHelper.fillWithVerification(field, match.value, {
                    maxRetries: this.config.maxRetries,
                    retryDelay: this.config.retryDelay
                });
                if (result.success) {
                    this.filledFields.add(fieldId);
                }
                return result;
            }

            // Value may have been accepted even if it doesn't match exactly
            // (e.g., formatted phone numbers)
            if (field.value && field.value.trim() !== '') {
                this.filledFields.add(fieldId);
                return { success: true, method: 'partial' };
            }

            return { success: false, reason: 'Value did not persist' };

        } catch (error) {
            this.log('Error filling field:', error);
            return { success: false, error: error.message };
        }
    }

    // =========================================================================
    //  AUTOFILL EXECUTION
    // =========================================================================

    /**
     * Perform autofill pass
     */
    async autofillPass(data, resumeFile, passNumber) {
        this.log(`Starting autofill pass ${passNumber}...`);

        const fields = this.detectFields();
        this.log(`Found ${fields.length} fields to process`);

        let filled = 0;
        let failed = 0;
        let skipped = 0;

        for (const field of fields) {
            const result = await this.fillField(field, null, data);

            if (result.success && !result.skipped) {
                filled++;
            } else if (result.skipped) {
                skipped++;
            } else {
                failed++;
            }

            // Small delay between fields
            await this.sleep(50);
        }

        this.log(`Pass ${passNumber} complete: ${filled} filled, ${failed} failed, ${skipped} skipped`);

        return { filled, failed, skipped, total: fields.length };
    }

    /**
     * Start mutation observer for dynamically added fields.
     * Observes both the regular DOM and shadow roots.
     */
    startMutationObserver(data, resumeFile) {
        this.log('Starting mutation observer for dynamic fields...');

        const observerCallback = async (mutations) => {
            let hasNewFields = false;

            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        // Check if the added node contains form fields
                        const fields = node.querySelectorAll?.('input, textarea, select, [role="combobox"], [role="textbox"]');
                        if (fields && fields.length > 0) {
                            hasNewFields = true;
                        }

                        // If a shadow root was attached, observe it too
                        if (node.shadowRoot) {
                            this._observeShadowRoot(node.shadowRoot, observerCallback);
                        }
                    }
                }
            }

            if (hasNewFields) {
                this.log('New form fields detected via mutation observer');
                await this.sleep(500); // Wait for fields to fully render
                await this.autofillPass(data, resumeFile, 'mutation');
            }
        };

        const observer = new MutationObserver(observerCallback);
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Also observe existing shadow roots
        const allElements = document.querySelectorAll('*');
        for (const el of allElements) {
            if (el.shadowRoot) {
                this._observeShadowRoot(el.shadowRoot, observerCallback);
            }
        }

        // Auto-disconnect after timeout
        setTimeout(() => {
            observer.disconnect();
            this.log('Mutation observer disconnected (timeout)');
        }, this.config.mutationObserverTimeout);
    }

    /**
     * Observe a shadow root for mutations
     */
    _observeShadowRoot(shadowRoot, callback) {
        try {
            const observer = new MutationObserver(callback);
            observer.observe(shadowRoot, {
                childList: true,
                subtree: true
            });

            // Store observer for cleanup
            if (!this._shadowObservers) this._shadowObservers = [];
            this._shadowObservers.push(observer);
        } catch (e) {
            this.log('Could not observe shadow root:', e.message);
        }
    }

    getFieldIdentifier(field) {
        return field.id || field.name || field.getAttribute('data-testid') || field.outerHTML.substring(0, 100);
    }

    async execute(normalizedData, resumeFile = null) {
        this.log('Starting SmartRecruiters strategy...');
        this.filledFields.clear();

        try {
            // Wait for form to stabilize
            const formReady = await this.waitForFormStabilization();
            if (!formReady) {
                this.log('Form did not stabilize, proceeding anyway...');
            }

            // Also attempt the generic strategy for any standard DOM fields
            // (this handles resume upload and basic fields outside shadow DOM)
            try {
                await super.execute(normalizedData, resumeFile);
            } catch (e) {
                this.log('Generic strategy pass completed with note:', e.message);
            }

            // First pass with deep traversal
            const firstPass = await this.autofillPass(normalizedData, resumeFile, 1);

            // Wait for potential dynamic fields
            await this.sleep(this.config.secondPassDelay);

            // Second pass
            const secondPass = await this.autofillPass(normalizedData, resumeFile, 2);

            // Start mutation observer for fields that appear later
            this.startMutationObserver(normalizedData, resumeFile);

            const totalFilled = firstPass.filled + secondPass.filled;
            const totalAttempted = firstPass.total + secondPass.total - secondPass.skipped;

            this.log(`Strategy complete: ${totalFilled}/${totalAttempted} fields filled`);

            return {
                filled: totalFilled,
                attempted: totalAttempted,
                success: totalFilled > 0
            };

        } catch (error) {
            console.error('[SmartRecruiters] Strategy error:', error);
            throw error;
        }
    }
}

// Register with Strategy Registry
if (typeof ATSStrategyRegistry !== 'undefined') {
    ATSStrategyRegistry.register(
        (url, doc) => url.includes('smartrecruiters.com'),
        SmartRecruitersStrategy
    );
}
