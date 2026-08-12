/**
 * icimsStrategy.js
 * Strategy for Icims application forms.
 */
class IcimsStrategy extends GenericStrategy {
    constructor() {
        super();
        this.CONFIDENCE_THRESHOLD = 70;
    }

    async execute(normalizedData, resumeFile = null) {
        // console.log("Executing IcimsStrategy...");

        // Basic fallback execution. Override findValueForInput if specific DOM structures are known.
        await super.execute(normalizedData, resumeFile);
    }

    hasOption(select, value) {
        if (!select || !select.options) return false;
        const normalize = (s) => String(s).toLowerCase().replace(/[^\w\s]/g, '').trim();
        const val = normalize(value);
        for (let i = 0; i < select.options.length; i++) {
            if (normalize(select.options[i].text).includes(val) || normalize(select.options[i].value).includes(val)) {
                return true;
            }
        }
        return false;
    }

    findValueForInput(input, normalizedData) {
        if (input.tagName === 'SELECT') {
            const labelText = (this.getLabelText(input) || "").toLowerCase();
            
            let containerText = "";
            let fieldset = input.closest('fieldset, .form-group, .iCIMS_form_section, .iCIMS_profileData');
            if (fieldset) {
                containerText = (fieldset.innerText || "").toLowerCase();
            } else {
                let parent = input.parentElement?.parentElement?.parentElement;
                if (parent) {
                    containerText = (parent.innerText || "").toLowerCase();
                }
            }
            
            const nameIdTxt = `${input.name || ''} ${input.id || ''}`.toLowerCase();
            const ariaLabel = (input.getAttribute('aria-label') || "").toLowerCase();
            const combinedText = `${labelText} ${containerText} ${nameIdTxt} ${ariaLabel}`;

            // Phone Type
            if (combinedText.includes('phone') || combinedText.includes('number') || combinedText.includes('mobile')) {
                if (this.hasOption(input, 'mobile') || this.hasOption(input, 'cell')) {
                    return { value: 'Mobile', confidence: 100 };
                }
            }

            // Address Type
            if (combinedText.includes('address') || combinedText.includes('city') || combinedText.includes('zip') || combinedText.includes('home')) {
                if (this.hasOption(input, 'home')) {
                    return { value: 'Home', confidence: 100 };
                }
            }

            // Source (Primary category)
            if (this.hasOption(input, 'social media') || this.hasOption(input, 'job board')) {
                if (combinedText.includes('how did you hear') || combinedText.includes('source') || combinedText.includes('hear about us')) {
                    return { value: 'Social Media', confidence: 100 };
                }
            }

            // Specify (Sub-category)
            if (this.hasOption(input, 'linkedin')) {
                if (combinedText.includes('specify') || combinedText.includes('specific source') || !this.hasOption(input, 'social media')) {
                    return { value: 'LinkedIn', confidence: 100 };
                }
            }
        }

        return super.findValueForInput(input, normalizedData);
    }

    handleFileUpload(resumeFile) {
        if (!resumeFile || !resumeFile.data) return;

        // Try the standard generic strategy first
        super.handleFileUpload(resumeFile);
        if (this._hasUploadedResume) return;

        // Fallback for ICIMS: find the first available file input that is not a cover letter
        const sessionKey = `af_uploaded_${window.location.hostname}${window.location.pathname}`;
        const fileIdentifier = `${resumeFile.name}_${resumeFile.size}`;

        if (!this.isManual && sessionStorage.getItem(sessionKey) === fileIdentifier) {
            return;
        }

        const fileInputs = document.querySelectorAll('input[type="file"]');
        for (const input of fileInputs) {
            if ((input.files && input.files.length > 0) || input.dataset.afUploaded === 'true') continue;

            const features = this.extractFeatures(input);
            const labelTxt = features.label_text.toLowerCase();
            const combinedTxt = `${labelTxt} ${input.closest('div, fieldset')?.innerText || ""} ${input.parentElement?.parentElement?.innerText || ""} ${input.name || ""} ${input.id || ""}`.toLowerCase();

            // Skip cover letter fields explicitly
            const isCoverLetterField = labelTxt.includes("cover") || 
                                       (input.name || "").toLowerCase().includes("cover") || 
                                       (input.id || "").toLowerCase().includes("cover") ||
                                       (input.placeholder && input.placeholder.toLowerCase().includes("cover"));
            if (isCoverLetterField) continue;

            // In ICIMS, if it's a file input and not a cover letter, it's highly likely the resume input.
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
                input.files = dataTransfer.files;

                ['change', 'input', 'blur'].forEach(ev => {
                    input.dispatchEvent(new Event(ev, { bubbles: true, composed: true }));
                });

                // Trigger jQuery change event if jQuery is available on the page
                try {
                    const $ = window.jQuery || window.$;
                    if ($ && typeof $.fn !== 'undefined') {
                        $(input).trigger('change');
                    }
                } catch (e) { /* silent */ }

                input.dataset.afUploaded = 'true';
                sessionStorage.setItem(sessionKey, fileIdentifier);
                sessionStorage.setItem(`af_uploaded_${window.location.hostname}`, 'true'); // content.js compatibility
                this._hasUploadedResume = true;
                break;
            } catch (e) {
                console.error("AutoFill: Error attaching file to ICIMS", e);
            }
        }
    }
}

// Register with Strategy Registry
if (typeof ATSStrategyRegistry !== 'undefined') {
    ATSStrategyRegistry.register(
        (url, doc) => url.includes('icims.com'),
        IcimsStrategy
    );
}
