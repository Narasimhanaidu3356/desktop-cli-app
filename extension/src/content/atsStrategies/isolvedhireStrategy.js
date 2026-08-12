/**
 * isolvedhireStrategy.js
 * Strategy for iSolved Hire (Canyon State Electric) application forms.
 */
class IsolvedhireStrategy extends GenericStrategy {
    constructor() {
        super();
        this.CONFIDENCE_THRESHOLD = 65;
    }

    /**
     * Executes the iSolved Hire form filling sequence.
     */
    async execute(normalizedData, resumeFile = null) {
        // console.log("Executing IsolvedhireStrategy...");

        // 1. Call super execute to fill standard fields (First Name, Last Name, Email, Phone, etc.)
        const result = await super.execute(normalizedData, resumeFile);

        // 2. Perform a custom sweep for policy selects and legal consent checkboxes
        const inputs = document.querySelectorAll('input, select');
        for (const input of inputs) {
            if (input.disabled || input.readOnly) continue;

            const tagName = input.tagName.toLowerCase();
            const labelText = (this.getLabelText(input) || "").toLowerCase();
            const combinedText = [
                (input.name || ""),
                (input.id || ""),
                labelText,
                (input.getAttribute('aria-label') || "")
            ].join(" ").toLowerCase();

            // Explicit check for Applicant Communication Policy dropdown
            if (tagName === 'select') {
                if (labelText.includes("communication policy") || combinedText.includes("communication policy")) {
                    for (let i = 0; i < input.options.length; i++) {
                        const optText = input.options[i].text.toLowerCase();
                        if (optText.includes("yes") || optText.includes("agree") || optText.includes("accept")) {
                            input.selectedIndex = i;
                            input.dispatchEvent(new Event('change', { bubbles: true }));
                            break;
                        }
                    }
                }
            } 
            // Explicit check for Terms and Privacy Policy agreement checkboxes
            else if (tagName === 'input' && input.type === 'checkbox') {
                const isAgreement = 
                    labelText.includes("privacy policy") || 
                    labelText.includes("terms of service") || 
                    labelText.includes("agree to isolved") || 
                    combinedText.includes("privacy policy") || 
                    combinedText.includes("terms of service");

                if (isAgreement && !input.checked) {
                    input.checked = true;
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    this.setInputValue(input, null, 'green'); // Visual green outline feedback
                }
            }
        }

        return result;
    }

    /**
     * Finds the best value match from resume data, incorporating custom fallbacks
     * for communication preference selects and legal checkboxes.
     */
    findValueForInput(input, data) {
        const features = this.extractFeatures(input);
        const labelText = features.label_text.toLowerCase();
        const combinedText = features.normalized_combined.toLowerCase();
        const name = (input.name || "").toLowerCase();
        const id = (input.id || "").toLowerCase();

        // 1. Phone type next to phone number (e.g. select element with options Cell, Home, etc.)
        if (labelText.includes("cell") || labelText.includes("phone type") || name.includes("phone_type") || id.includes("phonetype")) {
            return { value: "Cell", confidence: 95, fieldKey: "custom.phone_type" };
        }

        // 2. Preferred communication method (Text Message, Email, etc.)
        if (labelText.includes("preferred method of communication") || combinedText.includes("preferred method of communication") || id.includes("communication_method")) {
            return { value: "Text Message", confidence: 95, fieldKey: "custom.preferred_communication" };
        }

        // 3. Agreement / Communication Policy dropdown
        if (labelText.includes("applicant communication policy") || combinedText.includes("applicant communication policy") || id.includes("communication_policy")) {
            return { value: "Yes", confidence: 95, fieldKey: "custom.communication_policy_agreement" };
        }

        // 4. Privacy Policy / Terms of Service Agreement checkbox
        if (labelText.includes("privacy policy") || labelText.includes("terms of service") || labelText.includes("agree to isolved") || combinedText.includes("privacy policy") || combinedText.includes("terms of service")) {
            return { value: "Yes", confidence: 95, fieldKey: "custom.privacy_policy_agreement" };
        }

        return super.findValueForInput(input, data);
    }
}

// Register with Strategy Registry
if (typeof ATSStrategyRegistry !== 'undefined') {
    ATSStrategyRegistry.register(
        (url, doc) => url.includes('isolvedhire.com') || (doc && (doc.querySelector('[id*="isolved"]') !== null || doc.body.innerText.includes('isolved'))),
        IsolvedhireStrategy
    );
}
