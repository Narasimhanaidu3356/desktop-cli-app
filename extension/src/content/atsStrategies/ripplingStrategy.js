/**
 * ripplingStrategy.js
 * Strategy for Rippling application forms.
 */
class RipplingStrategy extends GenericStrategy {
    constructor() {
        super();
        this.CONFIDENCE_THRESHOLD = 70;
        this._hasUploadedRipplingResume = false;
        this._processingStep = false;
        this._stepProgressionAttempts = 0;
        this._lastProcessedUrl = null;
        this.MAX_STEP_ATTEMPTS = 5; // Prevent infinite loops
    }

    async execute(normalizedData, resumeFile = null) {
        // console.log("Executing RipplingStrategy...");

        // Prevent recursive step processing
        if (this._processingStep) return;

        // 1. Specific Handle for Location Field
        const locationInput = document.querySelector('input[aria-label="textbox"]');
        if (locationInput && !locationInput.value) {
            const loc = normalizedData.contact || {};
            const locationStr = [loc.city, loc.state, loc.country].filter(Boolean).join(', ');
            if (locationStr) {
                this.setInputValue(locationInput, locationStr, 'green');
            }
        }

        // 2. Explicit Resume Upload (Fallback if Generic misses it)
        if (resumeFile && !this._hasUploadedRipplingResume) {
            const fileInputs = Array.from(document.querySelectorAll('input[type="file"]'));
            for (const input of fileInputs) {
                // Skip if it already has a file selected
                if (input.files && input.files.length > 0) continue;

                // Check immediate parents (up to 3 levels) to avoid grabbing sibling fields.
                // If we go too high, we accidentally grab the Cover Letter section!
                let containerTxt = "";
                let curr = input.parentElement;
                for (let i = 0; i < 3 && curr && curr !== document.body; i++) {
                    containerTxt += " " + (curr.innerText || curr.getAttribute('aria-label') || "");
                    curr = curr.parentElement;
                }
                containerTxt = containerTxt.toLowerCase();

                if (!containerTxt.includes("cover letter") && !containerTxt.includes("additional")) {
                    this.setFileUpload(input, resumeFile);
                    break; // Only upload to the first matching field
                }
            }
        }

        // Run generic execution for the rest
        await super.execute(normalizedData, resumeFile);

        // 3. After filling current step, handle multi-step progression
        await this.handleMultiStepProgression();
    }

    /**
     * Handle multi-step form progression in Rippling
     */
    async handleMultiStepProgression() {
        // Prevent infinite loop - only attempt once per URL
        const currentUrl = window.location.href;
        if (this._lastProcessedUrl === currentUrl && this._stepProgressionAttempts >= this.MAX_STEP_ATTEMPTS) {
            console.log('[RipplingStrategy] Max step attempts reached, stopping progression');
            return;
        }

        // Reset counter if URL changed (new step loaded)
        if (this._lastProcessedUrl !== currentUrl) {
            this._lastProcessedUrl = currentUrl;
            this._stepProgressionAttempts = 0;
        }

        this._stepProgressionAttempts++;

        // Check if current form has unfilled required fields
        const requiredFields = Array.from(document.querySelectorAll('[required], [aria-required="true"]'));
        const unfilledRequired = requiredFields.filter(field => {
            if (field.offsetParent === null) return false; // Skip hidden fields
            if (field.type === 'hidden') return false;
            if (field.type === 'checkbox' || field.type === 'radio') {
                return !field.checked;
            }
            return !field.value || field.value.trim() === '';
        });

        // If there are unfilled required fields, don't proceed
        if (unfilledRequired.length > 0) {
            console.log(`[RipplingStrategy] ${unfilledRequired.length} required fields still unfilled, not proceeding`);
            return;
        }

        // Look for "Next", "Continue", or navigation buttons
        const nextButton = this.findNextButton();
        if (nextButton) {
            console.log(`[RipplingStrategy] Found next button (attempt ${this._stepProgressionAttempts}), proceeding to next step`);
            this._processingStep = true;
            
            // Scroll button into view and click
            try {
                nextButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
                await this.sleep(200);
                nextButton.click();
                
                // Give the page time to load the next step
                await this.sleep(1500);
            } catch (e) {
                console.error('[RipplingStrategy] Error clicking next button:', e);
            } finally {
                this._processingStep = false;
            }
        }
    }

    /**
     * Find the "Next" or "Continue" button on Rippling forms
     */
    findNextButton() {
        const selectors = [
            'button:not([style*="display: none"])',
            '[role="button"]',
            'a[role="button"]'
        ];

        const buttons = Array.from(document.querySelectorAll(selectors.join(', ')))
            .filter(b => b.offsetParent !== null && !b.disabled);

        // Look for buttons with "Next", "Continue", or "Submit" text
        const nextPatterns = [
            'next', 'continue', 'submit', 'apply', 
            'next step', 'proceed', 'forward'
        ];

        const nextBtn = buttons.find(b => {
            const text = (b.innerText || b.textContent || b.getAttribute('aria-label') || '').toLowerCase().trim();
            const className = (b.className || '').toLowerCase();
            const dataAttrs = [
                b.getAttribute('data-automation-id'),
                b.getAttribute('data-qa'),
                b.getAttribute('name')
            ].join(' ').toLowerCase();

            // Exclude cancel/back buttons
            if (text.includes('cancel') || text.includes('back') || text.includes('previous')) {
                return false;
            }

            // Check for next-like buttons
            return nextPatterns.some(pattern => 
                text.includes(pattern) || className.includes(pattern) || dataAttrs.includes(pattern)
            );
        });

        return nextBtn || null;
    }

    findValueForInput(input, data) {
        const features = this.extractFeatures(input);
        const labelTxt = features.label_text.toLowerCase();
        const combinedTxt = (features.label_text + " " + features.aria_label + " " + features.nearby_text).toLowerCase();

        const identity = data?.identity || {};

        // 1. Gender
        if (labelTxt.includes("gender") || combinedTxt.includes("what is your gender")) {
            return { value: identity.gender, confidence: 90, fieldKey: "identity.gender" };
        }

        // 1.5 Pronouns
        if (labelTxt.includes("pronoun") || combinedTxt.includes("pronoun")) {
            return { value: identity.pronouns, confidence: 90, fieldKey: "identity.pronouns" };
        }

        // 2. Race/Ethnicity
        if (labelTxt.includes("race") || labelTxt.includes("identify your race") || combinedTxt.includes("please identify your race")) {
            return { value: identity.ethnicity, confidence: 90, fieldKey: "identity.ethnicity" };
        }

        // 3. Hispanic/Latino
        if (labelTxt.includes("hispanic") || labelTxt.includes("latino") || combinedTxt.includes("hispanic or latino")) {
            return { value: identity.hispanic_latino, confidence: 90, fieldKey: "identity.hispanic_latino" };
        }

        // 4. Veteran Status
        if (labelTxt.includes("veteran status") || combinedTxt.includes("veteran")) {
            return { value: identity.veteran_status, confidence: 95, fieldKey: "identity.veteran_status" };
        }

        // 5. Disability Status
        if (labelTxt.includes("disability status") || labelTxt.includes("disability") || combinedTxt.includes("disability")) {
            return { value: identity.disability_status, confidence: 95, fieldKey: "identity.disability_status" };
        }

        // 6. SMS Agreement
        if (labelTxt.includes("receive text message updates") || labelTxt.includes("sms agreement") || labelTxt.includes("text message agreement")) {
            return { value: "Yes", confidence: 95, fieldKey: "custom.sms_agreement" };
        }

        return super.findValueForInput(input, data);
    }

    // Override to handle radio buttons better in Rippling context
    handleRadioCheckbox(input, data) {
        const features = this.extractFeatures(input);
        const labelTxt = (this.getLabelText(input) || "").toLowerCase();
        const valueMatch = this.findValueForInput(input, data);

        if (valueMatch && valueMatch.value) {
            const targetVal = String(valueMatch.value).toLowerCase().trim();

            // Gender - direct match
            if (valueMatch.fieldKey === "identity.gender") {
                if (labelTxt === targetVal || labelTxt.includes(targetVal)) {
                    input.checked = true;
                    this.setInputValue(input, null, 'green');
                    return;
                }
            }

            // Race/Ethnicity - direct match
            if (valueMatch.fieldKey === "identity.ethnicity") {
                if (labelTxt === targetVal || labelTxt.includes(targetVal)) {
                    input.checked = true;
                    this.setInputValue(input, null, 'green');
                    return;
                }
            }

            // Hispanic/Latino - yes/no matching
            if (valueMatch.fieldKey === "identity.hispanic_latino") {
                const isYes = targetVal.includes("yes") || targetVal.includes("hispanic");
                const labelIsYes = labelTxt.includes("yes") || labelTxt.includes("latino") || labelTxt.includes("hispanic");
                if (isYes === labelIsYes) {
                    input.checked = true;
                    this.setInputValue(input, null, 'green');
                    return;
                }
            }

            // Veteran Status - yes/no matching
            if (valueMatch.fieldKey === "identity.veteran_status") {
                const isYes = targetVal.includes("yes") || targetVal.includes("protected veteran");
                const isNo = targetVal.includes("no") || targetVal.includes("not a protected");
                const labelIsYes = labelTxt.includes("yes") || labelTxt.includes("protected veteran");
                const labelIsNo = labelTxt.includes("no") || labelTxt.includes("not a protected");
                
                if ((isYes && labelIsYes) || (isNo && labelIsNo)) {
                    input.checked = true;
                    this.setInputValue(input, null, 'green');
                    return;
                }
            }

            // Disability Status - yes/no matching
            if (valueMatch.fieldKey === "identity.disability_status") {
                const isYes = targetVal.includes("yes") || targetVal.includes("have a disability");
                const isNo = targetVal.includes("no") || targetVal.includes("don't have");
                const labelIsYes = labelTxt.includes("yes") || labelTxt.includes("have a disability");
                const labelIsNo = labelTxt.includes("no") || labelTxt.includes("don't have");
                
                if ((isYes && labelIsYes) || (isNo && labelIsNo)) {
                    input.checked = true;
                    this.setInputValue(input, null, 'green');
                    return;
                }
            }

            // SMS Agreement
            if (valueMatch.fieldKey === "custom.sms_agreement") {
                if (targetVal === "yes" && labelTxt === "yes") {
                    input.checked = true;
                    this.setInputValue(input, null, 'green');
                    return;
                }
            }
        }

        super.handleRadioCheckbox(input, data);
    }

    // Helper to reuse the logic from GenericStrategy but with a specific input
    setFileUpload(input, resumeFile) {
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

            // Use native setter to bypass React's value interception
            const nativeFilesSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'files')?.set;
            if (nativeFilesSetter) {
                nativeFilesSetter.call(input, dataTransfer.files);
            } else {
                input.files = dataTransfer.files;
            }

            ['focus', 'input', 'change', 'blur'].forEach(ev => {
                input.dispatchEvent(new Event(ev, { bubbles: true }));
            });
            
            // Dispatch proper DragEvents for React Dropzone compatibility
            const dropzone = input.closest('div[role="presentation"], div[role="button"], label') || input.parentElement;
            if (dropzone) {
                ['dragenter', 'dragover', 'drop'].forEach(eventName => {
                    let dragEvent;
                    try {
                        dragEvent = new DragEvent(eventName, { bubbles: true, cancelable: true, dataTransfer: dataTransfer });
                    } catch (err) {
                        dragEvent = new Event(eventName, { bubbles: true, cancelable: true });
                        Object.defineProperty(dragEvent, 'dataTransfer', { value: dataTransfer });
                    }
                    dropzone.dispatchEvent(dragEvent);
                });
            }
            
            // Add visual feedback to the container so you know it worked
            const container = input.closest('label') || input.parentElement;
            if (container) {
                container.style.backgroundColor = "#dcfce7";
                container.style.border = "2px dashed #22c55e";
            }

            this._hasUploadedRipplingResume = true;

            // Register success with the tracker so it shows up in the UI feature
            if (window.TrackingIntegration && window.TrackingIntegration.initialized) {
                window.TrackingIntegration.trackField(input, 'Resume / File Upload', 'file');
                window.TrackingIntegration.trackFilled(input, resumeFile.name, 'resume_upload');
            }
        } catch (e) {
            console.error("AutoFill: Error attaching file", e);
        }
    }
}

// Register with Strategy Registry
if (typeof ATSStrategyRegistry !== 'undefined') {
    ATSStrategyRegistry.register(
        (url, doc) => url.includes('rippling') || url.includes('ats.rippling.com') || doc.body.innerText.includes('Rippling'),
        RipplingStrategy
    );
}
