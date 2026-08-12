/**
 * kforceStrategy.js
 * Strategy for Kforce application forms.
 */
class KforceStrategy extends GenericStrategy {
    constructor() {
        super();
        this.CONFIDENCE_THRESHOLD = 70;
    }

    async execute(normalizedData, resumeFile = null) {
        // Ensure "From this computer" radio is checked if we have a resume to upload
        if (resumeFile) {
            const radioComputer = document.getElementById('resumeUploadType_0');
            if (radioComputer && !radioComputer.checked) {
                radioComputer.click();
                radioComputer.dispatchEvent(new Event('change', { bubbles: true }));
                await this.sleep(300); // Wait for dynamic rendering of file input
            }
        }

        // Wait briefly for any dynamic rendering
        await this.sleep(1000);

        await super.execute(normalizedData, resumeFile);

        this.handleRadios(normalizedData);
    }

    findValueForInput(input, normalizedData) {
        const id = (input.id || "").toLowerCase();

        if (id === 'firstname') return { value: this.getNestedValue(normalizedData, 'identity.first_name') || '', confidence: 100, fieldKey: 'identity.first_name' };
        if (id === 'lastname') return { value: this.getNestedValue(normalizedData, 'identity.last_name') || '', confidence: 100, fieldKey: 'identity.last_name' };
        if (id === 'emailaddress') return { value: this.getNestedValue(normalizedData, 'contact.email') || '', confidence: 100, fieldKey: 'contact.email' };
        if (id === 'emailaddressverify') return { value: this.getNestedValue(normalizedData, 'contact.email') || '', confidence: 100, fieldKey: 'contact.email_verify' };
        if (id === 'workemailaddress') return { value: this.getNestedValue(normalizedData, 'contact.email') || '', confidence: 100, fieldKey: 'contact.secondary_email' };
        if (id === 'phonenumberall') return { value: this.getNestedValue(normalizedData, 'contact.phone') || '', confidence: 100, fieldKey: 'contact.phone' };
        if (id === 'state') return { value: this.getNestedValue(normalizedData, 'contact.state') || '', confidence: 100, fieldKey: 'contact.state' };
        if (id === 'postalcode') return { value: this.getNestedValue(normalizedData, 'contact.zip_code') || '', confidence: 100, fieldKey: 'contact.zip_code' };
        if (id === 'countryid') return { value: this.getNestedValue(normalizedData, 'contact.country') || '', confidence: 100, fieldKey: 'contact.country' };

        return super.findValueForInput(input, normalizedData);
    }

    handleRadios(normalizedData) {
        const authToWork = this.normalizeYesNoDecline(this.getNestedValue(normalizedData, 'identity.authorized_to_work'));
        const requiresSponsorship = this.normalizeYesNoDecline(this.getNestedValue(normalizedData, 'identity.sponsorship_required'));

        const radioAny = document.getElementById('eligibility0');
        const radioNeedsSponsor = document.getElementById('eligibility2');

        if (radioAny && radioNeedsSponsor) {
            if (requiresSponsorship === 'yes') {
                if (!radioNeedsSponsor.checked) radioNeedsSponsor.click();
            } else if (authToWork === 'yes') {
                if (!radioAny.checked) radioAny.click();
            }
        }
    }

    triggerChange(element) {
        ['click', 'input', 'change'].forEach(ev => {
            element.dispatchEvent(new Event(ev, { bubbles: true }));
        });
    }
}

// Register with Strategy Registry
if (typeof ATSStrategyRegistry !== 'undefined') {
    ATSStrategyRegistry.register(
        (url, doc) => url.includes('kforce.com'),
        KforceStrategy
    );
}
