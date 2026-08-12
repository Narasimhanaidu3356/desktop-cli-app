let autoFillState = {
    hasRun: false,
    debouncing: false,

    get submissionAttempted() {
        return sessionStorage.getItem('autofill_submission_attempted') === 'true';
    },
    set submissionAttempted(val) {
        sessionStorage.setItem('autofill_submission_attempted', val ? 'true' : 'false');
    }
};

// --- GLOBAL FIELD MEMORY ---
// Protects completed fields from React DOM re-renders destroying state
window._afMemory = window._afMemory || new Set();

function extractLabelForMemory(input) {
    let label = '';
    if (input.labels && input.labels.length > 0) label = input.labels[0].innerText || input.labels[0].textContent;
    else if (input.id && document.querySelector(`label[for="${input.id}"]`)) label = document.querySelector(`label[for="${input.id}"]`).innerText;
    else if (input.closest('label')) label = input.closest('label').innerText;
    else if (input.getAttribute('aria-labelledby')) {
        const lEl = document.getElementById(input.getAttribute('aria-labelledby'));
        if (lEl) label = lEl.innerText;
    }

    if (!label) {
        const wrapper = input.closest('.MuiFormControl-root, .form-group, .field, [class*="field-"], [class*="formField"], div[role="group"]');
        if (wrapper) {
            const lEl = wrapper.querySelector('label') || wrapper.querySelector('[class*="label"], [class*="Label"]');
            if (lEl) label = lEl.innerText;
        }
    }

    if (!label) {
        let curr = input;
        for (let i = 0; i < 5; i++) {
            if (!curr) break;
            let sibling = curr.previousElementSibling;
            while (sibling) {
                let text = sibling.innerText?.trim();
                if (text && text.length > 2 && text.length < 2000) {
                    label = text;
                    break;
                }
                sibling = sibling.previousElementSibling;
            }
            if (label) break;
            curr = curr.parentElement;
        }
    }

    if (!label) label = input.getAttribute('aria-label') || input.placeholder;
    if (!label && input.type === 'file') label = 'Resume / File Upload';

    if (label) return label.replace(/\n/g, ' ').replace(/[\*:]/g, '').trim().toLowerCase();
    return null;
}

// Mark any field the USER physically edits, AND record script fills into memory
['input', 'change'].forEach(evt => {
    document.addEventListener(evt, (e) => {
        const target = e.target;
        if (target && target.matches && target.matches('input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"]')) {
            if (e.isTrusted) target.dataset.afUserLocked = 'true';

            // If it has a meaningful value, save it to memory so React can't wipe it out!
            // BUT: Don't add fields with default values like "Select" or "Choose"
            const val = target.type === 'checkbox' || target.type === 'radio' ? target.checked : target.value;
            if (val) {
                const strVal = String(val).trim().toLowerCase();
                // Skip default placeholder values
                if (!strVal.startsWith('select') && !strVal.startsWith('choose') && strVal !== '' && strVal.length > 0) {
                    const label = extractLabelForMemory(target);
                    if (label) window._afMemory.add(label);
                }
            }
        }
    }, true);
});

// Listen for messages from popup (Manual fallback or Edits)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "fill_form") {
        fillForm(request.normalizedData, true, request.resumeFile);
        sendResponse({ status: "done" });
    } else if (request.action === "get_page_context") {
        try {
            const strategy = ATSStrategyRegistry.getStrategy(window.location.href, document);
            if (strategy && typeof strategy.getPageContext === 'function') {
                sendResponse(strategy.getPageContext());
            } else {
                sendResponse({
                    pageTitle: document.title,
                    headerText: document.querySelector('h1')?.innerText || "",
                    url: window.location.href
                });
            }
        } catch (e) { sendResponse({}); }
        return true;
    } else if (request.action === "check_progress") {
        let hasProgress = false;
        if (typeof FormTracker !== 'undefined') {
            const session = FormTracker.getCurrentSession && FormTracker.getCurrentSession();
            hasProgress = session && session.fields && (session.fields.filled > 0 || session.fields.failed > 0);
        } else {
            const filledFields = document.querySelectorAll('input[data-autofilled], textarea[data-autofilled], select[data-autofilled]');
            hasProgress = filledFields.length > 0;
        }
        sendResponse({ hasProgress: hasProgress });
    } else if (request.action === "get_form_fields") {
        if (!window._finalFieldReport || window._finalFieldReport.length === 0) {
            runFinalFieldTracking();
        }
        sendResponse({ fields: window._finalFieldReport || [] });
    } else if (request.action === "scroll_to_field") {
        const element = document.querySelector(`[data-af-scroll-id="${request.scrollId}"]`);
        if (element) {
            let target = element;
            // Hidden elements can't be scrolled to, so find their visible wrapper container
            if (target.type === 'hidden' || target.type === 'file' || target.offsetWidth === 0) {
                const wrapper = target.closest('.MuiFormControl-root, .form-group, .field, [class*="field-"], [class*="formField"], div[role="group"], label') || target.parentElement;
                if (wrapper) target = wrapper;
            }

            target.scrollIntoView({ behavior: 'smooth', block: 'center' });

            // Flash a green border around the field for 2 seconds
            const originalBoxShadow = target.style.boxShadow;
            const originalTransition = target.style.transition;
            target.style.transition = 'box-shadow 0.3s ease-in-out';
            target.style.boxShadow = '0 0 0 4px rgba(0, 217, 165, 0.5)';

            setTimeout(() => {
                target.style.boxShadow = originalBoxShadow;
                setTimeout(() => { target.style.transition = originalTransition; }, 300);
            }, 2000);
        }
        sendResponse({ status: "scrolled" });
    }
});

// Hold the final evaluation report globally
window._finalFieldReport = [];

// 5. Manual Submission Tracking
document.addEventListener('mousedown', (e) => {
    const btn = e.target.closest('button, input[type="submit"], input[type="button"], a.btn');
    if (!btn) return;
    const txt = (btn.innerText || btn.value || "").toLowerCase();
    const className = (btn.className || "").toLowerCase();
    const href = (btn.getAttribute('href') || "").toLowerCase();

    // Skip LinkedIn or other third-party apply buttons
    if (txt.includes('linkedin') ||
        txt.includes('apply with linkedin') ||
        txt.includes('easy apply') ||
        className.includes('linkedin') ||
        href.includes('linkedin') ||
        txt.includes('indeed') ||
        className.includes('indeed')) {
        console.log('[Content] Ignoring third-party apply button:', txt);
        return;
    }

    if (txt.includes('submit') || txt.includes('finish') || txt.includes('apply')) {
        autoFillState.submissionAttempted = true;
        if (chrome.runtime?.id) {
            chrome.storage.local.set({ lastSubmittedUrl: window.location.href });
            chrome.runtime.sendMessage({ action: 'log_submission', url: window.location.href });
        }
    }
}, true);

function checkSuccessPage() {
    const keywords = ["thank you for applying", "application received", "application submitted", "successfully submitted"];
    const bodyText = document.body.innerText.toLowerCase();
    const isSuccessText = keywords.some(k => bodyText.includes(k));
    const isUrl = window.location.href.toLowerCase().match(/confirmation|thank-you|thank_you/);
    const inputs = document.querySelectorAll('input:not([type="hidden"]):not(footer input)');
    return (isSuccessText || isUrl) && inputs.length <= 5;
}

async function fillForm(data, manual = false, resume = null) {
    let counts = { filled: 0, total: 0 };
    try {
        const strategy = ATSStrategyRegistry.getStrategy(window.location.href, document);

        const atsType = strategy ? strategy.constructor.name.replace('Strategy', '').toLowerCase() : 'unknown';
        if (typeof TrackingIntegration !== 'undefined' && !TrackingIntegration.initialized) {
            TrackingIntegration.init(atsType, strategy ? strategy.constructor.name : null);
        } else if (typeof FormTracker !== 'undefined' && FormTracker.startSession && !FormTracker.getCurrentSession()) {
            FormTracker.startSession(atsType, window.location.href);
        }

        if (strategy) {
            strategy.isManual = manual;
            counts = await strategy.execute(data, resume) || counts;
        }
    } catch (err) { /* silent error for generic strategy */ }

    // --- Run Field Tracking ONLY AFTER form filling is completely done ---
    await new Promise(r => setTimeout(r, 1000)); // Let React settle
    runFinalFieldTracking();

    // Sync final field reports to FormTracker and end the session
    if (typeof FormTracker !== 'undefined' && FormTracker.getCurrentSession()) {
        const report = window._finalFieldReport || [];

        report.forEach(field => {
            FormTracker.registerField(field.id, {
                label: field.label,
                type: field.type,
                required: field.required,
                confidence: field.confidence || 1.0
            });

            if (field.status === 'filled') {
                FormTracker.markFilled(field.id, field.value, 'autofill');
            } else if (field.status === 'failed') {
                FormTracker.markFailed(field.id, 'Required field not filled');
            } else if (field.status === 'needs_review') {
                FormTracker.markNeedsReview(field.id, 'Needs manual review');
            } else {
                FormTracker.markSkipped(field.id, 'Optional field not filled');
            }
        });

        const hasFailures = report.some(f => f.status === 'failed');
        const sessionStatus = hasFailures ? 'partial' : 'completed';

        FormTracker.endSession(sessionStatus);
    } else if (typeof TrackingIntegration !== 'undefined' && TrackingIntegration.initialized) {
        TrackingIntegration.endSession('completed');
    }

    chrome.runtime.sendMessage({ action: 'tracking_completed' });

    const meta = extractJobMetadata();
    chrome.runtime.sendMessage({
        action: 'log_fill',
        data: {
            url: window.location.href,
            company: meta.company,
            role: meta.role,
            filled: counts.filled,
            total: counts.total
        }
    });
}

function runFinalFieldTracking() {
    const fieldsMap = new Map();

    // Only grab visible, interactive elements to avoid React hidden state gibberish
    const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="search"]), select, textarea, [role="combobox"], [role="textbox"], [contenteditable="true"]');

    inputs.forEach(input => {
        if (input.classList && input.classList.contains('select2-hidden-accessible')) return;
        if (input.type !== 'file' && input.offsetWidth === 0 && input.offsetHeight === 0 && !input.closest('[role="combobox"]')) return;

        // Assign a unique scroll ID so the side panel can navigate here
        if (!input.dataset.afScrollId) {
            input.dataset.afScrollId = 'af_scroll_' + Math.random().toString(36).substr(2, 9);
        }

        let rawLabelHtml = '';
        let label = '';

        if (input.labels && input.labels.length > 0) {
            label = input.labels[0].innerText;
            rawLabelHtml = input.labels[0].innerHTML;
        } else if (input.id && document.querySelector(`label[for="${input.id}"]`)) {
            const lEl = document.querySelector(`label[for="${input.id}"]`);
            if (lEl) {
                label = lEl.innerText;
                rawLabelHtml = lEl.innerHTML;
            }
        } else if (input.closest('label')) {
            const lEl = input.closest('label');
            label = lEl.innerText;
            rawLabelHtml = lEl.innerHTML;
        } else if (input.getAttribute('aria-labelledby')) {
            const lEl = document.getElementById(input.getAttribute('aria-labelledby'));
            if (lEl) {
                label = lEl.innerText;
                rawLabelHtml = lEl.innerHTML;
            }
        }

        if (!label) {
            const wrapper = input.closest('.MuiFormControl-root, .form-group, .field, [class*="field-"], [class*="formField"], div[role="group"]');
            if (wrapper) {
                const lEl = wrapper.querySelector('label') || wrapper.querySelector('[class*="label"], [class*="Label"]');
                if (lEl) {
                    label = lEl.innerText;
                    rawLabelHtml = lEl.innerHTML;
                } else {
                    const firstDiv = wrapper.querySelector('div');
                    if (firstDiv && firstDiv.innerText && firstDiv.innerText.length < 2000) {
                        label = firstDiv.innerText;
                        rawLabelHtml = firstDiv.innerHTML || label;
                    }
                }
            }
        }

        if (!label) {
            let curr = input;
            for (let i = 0; i < 5; i++) {
                if (!curr) break;
                let sibling = curr.previousElementSibling;
                while (sibling) {
                    let text = sibling.innerText?.trim();
                    if (text && text.length > 2 && text.length < 2000) {
                        label = text;
                        rawLabelHtml = sibling.innerHTML || text;
                        break;
                    }
                    sibling = sibling.previousElementSibling;
                }
                if (label) break;
                curr = curr.parentElement;
            }
        }

        if (!label) label = input.getAttribute('aria-label') || input.placeholder;
        if (!label && input.type === 'file') label = 'Resume / File Upload';

        if (!label) {
            let fallback = input.name || input.id || '';
            if (fallback && !fallback.includes(':') && fallback.length > 2 && !/\d{3,}/.test(fallback)) {
                label = fallback.replace(/([A-Z])/g, ' $1').replace(/[-_]/g, ' ').replace(/^./, str => str.toUpperCase());
            }
        }

        if (label) label = label.replace(/\n/g, ' ').replace(/[\*:]/g, '').trim();

        // Enhanced file upload detection with better Resume vs Cover Letter distinction
        let fileWasUploaded = false;
        let fileFieldType = ''; // 'resume', 'cover_letter', 'transcript', or ''

        // Step 1: For file inputs, determine field type by scanning immediate parent hierarchy
        if (input.type === 'file') {
            let container = input.parentElement;
            for (let i = 0; i < 3 && container && container !== document.body; i++) {
                const containerText = (container.innerText || '').toLowerCase();
                // Stop if we hit a container with multiple file inputs to avoid cross-contamination
                if (container.querySelectorAll('input[type="file"]').length > 1) break;

                if (containerText.includes('cover letter')) {
                    fileFieldType = 'cover_letter';
                    break;
                }
                if (containerText.includes('resume') || containerText.includes('cv')) {
                    fileFieldType = 'resume';
                    break;
                }
                if (containerText.includes('transcript')) {
                    fileFieldType = 'transcript';
                    break;
                }
                container = container.parentElement;
            }
        }

        // Step 2: Check if file was actually uploaded
        if (input.type === 'file') {
            // Check if the file input has files
            if (input.files && input.files.length > 0) {
                fileWasUploaded = true;
            }
            // Check for filename in the display
            else if (label && (label.toLowerCase().endsWith('.pdf') || label.toLowerCase().endsWith('.doc') || label.toLowerCase().endsWith('.docx'))) {
                fileWasUploaded = true;
            }
            // Check immediate parent area for filename
            else {
                const immediateParent = input.parentElement?.parentElement;
                if (immediateParent && immediateParent.innerText) {
                    if (immediateParent.innerText.match(/[a-zA-Z0-9_-]{3,}\.(pdf|doc|docx)\b/i) && !immediateParent.innerText.toLowerCase().includes('example')) {
                        fileWasUploaded = true;
                    }
                }
            }
            // Only apply session flag to Resume fields
            if (!fileWasUploaded && fileFieldType === 'resume') {
                if (sessionStorage.getItem(`af_uploaded_${window.location.hostname}`) === 'true') {
                    fileWasUploaded = true;
                }
            }
        }

        // Step 3: Set appropriate label for file fields based on detected type
        if (input.type === 'file') {
            if (fileFieldType === 'resume') {
                label = 'Resume';
            } else if (fileFieldType === 'cover_letter') {
                label = 'Cover Letter';
            } else if (fileFieldType === 'transcript') {
                label = 'Transcript';
            } else if (!label || label.toLowerCase().includes('drop or select')) {
                label = 'File Upload';
            }
        } else if (label && (label.toLowerCase().includes('drop or select') || label.toLowerCase().includes('upload'))) {
            label = 'File Upload';
        }

        if (!label || label.toLowerCase() === 'unknown' || label.length < 2 || label.length > 2000) return;

        let isFilled = fileWasUploaded;
        let val = fileWasUploaded ? 'File Uploaded' : '';

        const inputsToCheck = [input];
        // File uploads don't need sibling absorption, and doing so causes cross-contamination between Resume and Cover Letter
        if (input.type !== 'file' && !label.toLowerCase().includes('resume') && !label.toLowerCase().includes('cover')) {
            const wrapper = input.closest('.MuiFormControl-root, .form-group, .field, [class*="field-"], [class*="formField"]');
            if (wrapper) {
                const siblingInputs = wrapper.querySelectorAll('input, select, textarea');
                if (siblingInputs.length <= 4) {
                    siblingInputs.forEach(si => { if (si !== input) inputsToCheck.push(si); });
                }
            } else if (input.parentElement) {
                const siblingInputs = input.parentElement.querySelectorAll('input, select, textarea');
                if (siblingInputs.length <= 4) {
                    siblingInputs.forEach(si => { if (si !== input) inputsToCheck.push(si); });
                }
            }
        }

        if (!isFilled) {
            for (const targetInput of inputsToCheck) {
                if (targetInput.type === 'checkbox' || targetInput.type === 'radio') {
                    if (targetInput.checked) { isFilled = true; val = 'Selected'; break; }
                } else if (targetInput.type === 'file') {
                    if (targetInput.files?.length > 0) { isFilled = true; val = 'File Uploaded'; break; }
                } else if (targetInput.value !== undefined && targetInput.value !== null) {
                    const tVal = String(targetInput.value).trim();
                    const tValLower = tVal.toLowerCase();
                    if (tVal !== '' && !tValLower.startsWith('select') && !tValLower.startsWith('choose')) {
                        isFilled = true; val = tVal; break;
                    }
                } else if (targetInput.isContentEditable && targetInput.innerText.trim() !== '') {
                    const tVal = targetInput.innerText.trim();
                    const tValLower = tVal.toLowerCase();
                    if (!tValLower.startsWith('select') && !tValLower.startsWith('choose')) {
                        isFilled = true; val = tVal; break;
                    }
                } else if (targetInput.getAttribute('role') === 'textbox') {
                    const txt = targetInput.innerText.trim();
                    const txtLower = txt.toLowerCase();
                    if (txt && !txtLower.startsWith('select') && !txtLower.startsWith('choose')) {
                        isFilled = true; val = txt; break;
                    }
                } else if (targetInput.getAttribute('role') === 'combobox') {
                    const txt = targetInput.innerText.trim();
                    const txtLower = txt.toLowerCase();
                    if (txt && !label.includes(txt) && !txtLower.startsWith('select') && !txtLower.startsWith('choose')) {
                        isFilled = true; val = txt; break;
                    }
                }

                if (targetInput.dataset.afStatus === 'filled' || targetInput.dataset.afUserLocked === 'true' || targetInput.dataset.userFilled === 'true' || targetInput.dataset.afUploaded === 'true') {
                    isFilled = true;
                    if (!val) val = 'Completed';
                    break;
                }
            }
        }

        const normalizedLabel = label.toLowerCase().trim();
        if (!isFilled && window._afMemory?.has(normalizedLabel)) {
            // Double-check that the field actually has a meaningful value (not a default)
            let hasValidValue = false;
            for (const targetInput of inputsToCheck) {
                const checkVal = targetInput.type === 'checkbox' || targetInput.type === 'radio'
                    ? targetInput.checked
                    : String(targetInput.value || '').trim().toLowerCase();

                // Validate it's not a default placeholder value
                if (checkVal && !checkVal.startsWith('select') && !checkVal.startsWith('choose') && checkVal.length > 0) {
                    hasValidValue = true;
                    break;
                }
            }

            if (hasValidValue) {
                isFilled = true;
                if (!val) val = 'Completed';
            }
        }

        const isVisible = input.offsetWidth > 0 || input.offsetHeight > 0 || input.type === 'file';
        if (!isVisible && !isFilled && input.type === 'hidden') return;

        // Properly determine required status for file inputs
        const isRequired = input.required || input.getAttribute('aria-required') === 'true' ||
            rawLabelHtml.includes('*') || label.includes('*') ||
            (input.type === 'file' && (label.toLowerCase() === 'resume' || label.toLowerCase().includes('resume')));

        // Ensure optional file fields (like Cover Letter) don't show as completed unless actually filled
        let status = isFilled ? 'filled' : (isRequired ? 'failed' : 'detected');

        // Handle field deduplication - ensure unique file uploads don't get overwritten
        let finalLabel = label;
        if (fieldsMap.has(label)) {
            const existing = fieldsMap.get(label);
            // If the existing field is filled and the new one isn't, skip the new one
            if (existing.status === 'filled' && status !== 'filled') {
                return;
            }
            // For file inputs with same label, add a suffix to distinguish them
            if (input.type === 'file' && existing.type === 'file') {
                finalLabel = `${label} (${fileFieldType || input.name || 'Additional'})`.trim();
            }
        }

        const existing = fieldsMap.get(finalLabel);
        const finalRequired = existing ? (existing.required || isRequired) : isRequired;
        const finalStatus = isFilled ? 'filled' : (finalRequired ? 'failed' : 'detected');

        fieldsMap.set(finalLabel, {
            id: input.id || input.name || Math.random().toString(),
            scrollId: input.dataset.afScrollId,
            label: finalLabel,
            type: input.type || input.tagName?.toLowerCase() || 'text',
            status: finalStatus,
            value: val,
            required: finalRequired,
            confidence: 1.0
        });
    });

    window._finalFieldReport = Array.from(fieldsMap.values());
}

function showToast(msg, type = 'info') {
    const t = document.createElement('div');
    t.style.cssText = `position:fixed; top:20px; right:20px; z-index:2147483647; background:${type === 'error' ? '#ef4444' : 'rgba(0,0,0,0.8)'}; color:white; padding:10px 20px; border-radius:12px; font-family:sans-serif; font-size:13px; box-shadow: 0 4px 12px rgba(0,0,0,0.2);`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), type === 'error' ? 6000 : 3000);
}

function extractJobMetadata() {
    if (typeof JobMetadataExtractor !== 'undefined') {
        const metadata = JobMetadataExtractor.extract();
        return {
            company: metadata.company.substring(0, 50),
            role: metadata.jobTitle.substring(0, 70),
            location: metadata.location,
            jobType: metadata.jobType,
            salary: metadata.salary,
            full: metadata
        };
    }

    let company = "", role = "";
    const gC = document.querySelector('.company-name'), gR = document.querySelector('.app-title');
    if (gC) company = gC.innerText.trim(); if (gR) role = gR.innerText.trim();
    const lR = document.querySelector('.posting-header h2'), lC = document.querySelector('.posting-header .company-logo img')?.alt;
    if (lR) role = lR.innerText.trim(); if (lC) company = lC.replace(" logo", "").trim();
    if (!company || !role) {
        const m = document.title.match(/(.+) (at|\||-) (.+)/i);
        if (m) { role = m[1].trim(); company = m[3].trim(); } else role = document.title;
    }
    return { company: company.substring(0, 50) || "Company", role: role.substring(0, 70) || "Job" };
}

function extractJobDescription() {
    const ss = [
        '.job-description', '#job-description', '.description',
        '[class*="jobDescription"]', '[id*="jobDescription"]',
        '.posting-description', '.job-info', 'main', 'article',
        '#main-content', '.main-content'
    ];
    for (const s of ss) {
        const e = document.querySelector(s);
        if (e && e.innerText.trim().length > 300) {
            const clone = e.cloneNode(true);
            clone.querySelectorAll('script, style, nav, footer, header').forEach(n => n.remove());
            const text = clone.innerText.trim();
            if (text.length > 300) return text.substring(0, 5000);
        }
    }
    return document.body.innerText.substring(0, 5000);
}

// ============================================
// Phase 4: Smart Autofill Features
// ============================================

if (typeof DynamicFormWatcher !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            DynamicFormWatcher.init();
        });
    } else {
        DynamicFormWatcher.init();
    }

    document.addEventListener('dynamicFieldsDetected', (e) => {
        console.log('[Content] New fields detected:', e.detail.fields.length);
    });

    document.addEventListener('dropdownsLoaded', (e) => {
        console.log('[Content] Dropdowns loaded:', e.detail.dropdowns.length);
    });

    document.addEventListener('pageChanged', (e) => {
        console.log('[Content] Page changed:', e.detail.url);
        autoFillState.hasRun = false;
    });

    document.addEventListener('autoContinueAutofill', async () => {
        console.log('[Content] Auto-continuing autofill on new page');
        const result = await chrome.storage.local.get(['resumeData', 'normalizedData']);
        if (result.normalizedData) {
            fillForm(result.normalizedData, false, result.resumeFile);
        }
    });
}

if (typeof CaptchaDetector !== 'undefined') {
    window.addEventListener('load', () => {
        const captchaStatus = CaptchaDetector.getStatus();

        if (captchaStatus.present && !captchaStatus.solved) {
            console.warn('[Content] CAPTCHA detected:', captchaStatus.type);
            showToast(`⚠️ ${captchaStatus.message}`, 'info');

            chrome.runtime.sendMessage({
                action: 'captcha_detected',
                type: captchaStatus.type,
                message: captchaStatus.message
            });
        }
    });
}

console.log('[Content] Phase 4 features initialized');
