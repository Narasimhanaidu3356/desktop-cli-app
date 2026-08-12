/**
 * TalentScreen - Whitebox Learning Autofill Extension
 * Side Panel Controller
 * @version 2.0.0
 */

document.addEventListener('DOMContentLoaded', () => {
    if (typeof chrome === 'undefined' || !chrome.storage) {
        console.error('[Sidepanel] Chrome API not available');
        return;
    }

    // Register window with background
    const port = chrome.runtime.connect({ name: "sidepanel" });
    chrome.windows.getCurrent((win) => {
        if (win && win.id) port.postMessage({ action: 'register_window', windowId: win.id });
    });

    // Notify background for analytics
    chrome.runtime.sendMessage({ action: 'sidepanel_opened' });

    // Supported ATS platforms
    const SUPPORTED_ATS = [
        'greenhouse.io', 'lever.co', 'myworkdayjobs.com', 'workday.com',
        'smartrecruiters.com', 'applytojob.com', 'ashbyhq.com', 'bamboohr.com',
        'icims.com', 'indeed.com', 'linkedin.com', 'workable.com',
        'taleo.net', 'successfactors.com', 'personio.com', 'recruitee.com',
        'teamtailor.com', 'ultipro.com', 'ukg.com', 'paycomonline.net',
        'paychex.com', 'oraclecloud.com', 'brassring.com', 'adp.com',
        'jobvite.com', 'rippling-ats.com', 'ats.rippling.com',
        'silkroad.com', 'kforce.com'
    ];

    // Setup View Elements
    const setupView = document.getElementById('setupView');
    const jsonInput = document.getElementById('jsonInput');
    const pdfInput = document.getElementById('pdfInput');
    const jsonStatus = document.getElementById('jsonStatus');
    const pdfStatus = document.getElementById('pdfStatus');
    const completeSetupBtn = document.getElementById('completeSetupBtn');

    // Unsupported View Elements
    const unsupportedView = document.getElementById('unsupportedView');
    const submitRequestBtn = document.getElementById('submitRequestBtn');
    const findJobsBtn = document.getElementById('findJobsBtn');

    // Active View Elements
    const activeView = document.getElementById('activeView');
    const feedbackBtn = document.getElementById('feedbackBtn');
    const fillFormBtn = document.getElementById('fillFormBtn');
    const historyList = document.getElementById('historyList');
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    const progressSection = document.getElementById('progressSection');
    const progressCount = document.getElementById('progressCount');
    const progressBar = document.getElementById('progressBar');

    // Modal and Dashboard Elements
    const manageModal = document.getElementById('manageModal');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const dashboardNavBtns = document.querySelectorAll('.dashboard-nav button');
    const editSection = document.getElementById('editSection');
    const jsonSection = document.getElementById('jsonSection');
    const settingsSection = document.getElementById('settingsSection');

    // Edit Information Section Elements
    const sectionTabs = document.querySelectorAll('.section-tabs button');
    const personalForm = document.getElementById('personalForm');
    const workForm = document.getElementById('workForm');
    const educationForm = document.getElementById('educationForm');
    const skillsForm = document.getElementById('skillsForm');
    const customForm = document.getElementById('customForm');
    const addWorkBtn = document.getElementById('addWorkBtn');
    const addEducationBtn = document.getElementById('addEducationBtn');
    const workEntriesContainer = document.getElementById('workEntries');
    const educationEntriesContainer = document.getElementById('educationEntries');

    // Update JSON Section Elements
    const updateJsonInput = document.getElementById('updateJsonInput');
    const updatePdfInput = document.getElementById('updatePdfInput');

    // Settings Section Elements
    const deleteProfileBtn = document.getElementById('deleteProfileBtn');

    // Status message element
    const statusDiv = document.getElementById('status');

    // State
    let currentResumeData = null;
    let currentResumeFile = null;
    let applicationHistory = [];
    let setupJsonUploaded = false;
    let setupPdfUploaded = false;

    // Widget elements
    const jobInfoCard = document.getElementById('jobInfoCard');
    const companyName = document.getElementById('companyName');
    const jobTitle = document.getElementById('jobTitle');
    const jobMeta = document.getElementById('jobMeta');

    const viewAutofillInfoBtn = document.getElementById('viewAutofillInfoBtn');

    // Resume file info elements
    const resumeFileName = document.getElementById('resumeFileName');
    const resumeFileSize = document.getElementById('resumeFileSize');

    // Initialize UI state
    async function init() {
        try {
            // Migrate legacy storage if needed
            await ResumeManager.migrateLegacy();

            chrome.storage.local.get(['resumeData', 'resumeFile', 'applicationHistory'], (result) => {
                if (chrome.runtime.lastError) {
                    console.error('[Sidepanel] Storage error:', chrome.runtime.lastError);
                    showStatus('Failed to load data from storage', 'error');
                    return;
                }

                currentResumeData = result.resumeData || null;
                currentResumeFile = result.resumeFile || null;
                applicationHistory = result.applicationHistory || [];

                updateUI();
                renderHistory();
            });
        } catch (error) {
            console.error('[Sidepanel] Init error:', error);
            showStatus('Failed to initialize: ' + error.message, 'error');
        }
    }

    // Update UI based on data state
    function updateUI() {
        const hasData = currentResumeData !== null && currentResumeFile !== null;
        const isSupported = checkPageSupport();

        // Hide all views first
        setupView.classList.add('hidden');
        unsupportedView.classList.add('hidden');
        activeView.classList.add('hidden');

        if (!isSupported) {
            // Show unsupported view
            unsupportedView.classList.remove('hidden');
        } else if (hasData) {
            // Show active view
            activeView.classList.remove('hidden');
            updateJobInfoCard();
            updateResumeFileDisplay();
        } else {
            // Show setup view
            setupView.classList.remove('hidden');
        }
    }

    // Check if current page is supported
    function checkPageSupport() {
        try {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (!tabs || !tabs[0]) return true; // Default to supported if can't check

                const url = tabs[0].url;
                if (!url) return true;

                const isSupported = SUPPORTED_ATS.some(ats => url.includes(ats));

                // Update UI based on support status
                if (!isSupported && url.startsWith('http')) {
                    // Only show unsupported for actual job sites (not chrome:// or file://)
                    updateUIForUnsupported();
                }
            });
        } catch (error) {
            console.error('[Sidepanel] Error checking page support:', error);
        }

        return true; // Default to supported
    }

    // Update UI for unsupported page
    function updateUIForUnsupported() {
        setupView.classList.add('hidden');
        activeView.classList.add('hidden');
        unsupportedView.classList.remove('hidden');
    }

    // Update job info card with current page info
    function updateJobInfoCard() {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs[0] || !tabs[0].url) return;

            const tabUrl = tabs[0].url;

            // Skip non-web pages: extension pages, mailto, about, new tab, etc.
            // These would expose the extension ID or garbage in the company name field.
            if (!tabUrl.startsWith('http://') && !tabUrl.startsWith('https://')) return;

            const url = new URL(tabUrl);
            const hostname = url.hostname.replace('www.', '');

            if (companyName) {
                companyName.textContent = hostname;
            }
            if (jobTitle) {
                jobTitle.textContent = tabs[0].title.substring(0, 50) + (tabs[0].title.length > 50 ? '...' : '');
            }
            if (jobMeta) {
                const isOptimized = SUPPORTED_ATS.some(ats => tabUrl.includes(ats));
                jobMeta.innerHTML = isOptimized
                    ? '<span style="color: #10b981; font-weight: 600;">✓ Optimized ATS Platform</span>'
                    : '<span style="color: #6366f1; font-weight: 600;">⚡ Smart Heuristics Active</span>';
            }
        });
    }

    // Update resume file display
    function updateResumeFileDisplay() {
        if (currentResumeFile && resumeFileName && resumeFileSize) {
            resumeFileName.textContent = currentResumeFile.name;
            const sizeKB = (currentResumeFile.size / 1024).toFixed(1);
            resumeFileSize.textContent = `${sizeKB} KB`;
        } else if (resumeFileName) {
            resumeFileName.textContent = 'No file uploaded';
            if (resumeFileSize) resumeFileSize.textContent = '';
        }
    }

    // Initialize gray action buttons
    function initActionButtons() {
        // View Autofill Information Button - opens settings page
        if (viewAutofillInfoBtn) {
            viewAutofillInfoBtn.addEventListener('click', () => {
                chrome.tabs.create({
                    url: chrome.runtime.getURL('/src/ui/settings.html')
                });
            });
        }
    }

    // === SETUP VIEW HANDLERS ===

    // JSON Upload (Setup)
    if (jsonInput) {
        jsonInput.addEventListener('change', (event) => {
            handleSetupJsonUpload(event.target.files[0]);
        });
    }

    function handleSetupJsonUpload(file) {
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const rawText = e.target.result;
                const text = rawText.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
                const json = JSON.parse(text);

                const validation = validateJsonData(json);
                if (validation.valid) {
                    currentResumeData = json;
                    setupJsonUploaded = true;
                    jsonStatus.textContent = `✓ ${file.name}`;
                    jsonStatus.classList.remove('hidden');
                    jsonStatus.classList.add('success');
                    checkSetupComplete();
                } else {
                    jsonStatus.textContent = `✗ ${validation.message}`;
                    jsonStatus.classList.remove('hidden');
                    jsonStatus.classList.add('error');
                    setupJsonUploaded = false;
                    checkSetupComplete();
                }
            } catch (error) {
                console.error('[Sidepanel] JSON parse error:', error);
                jsonStatus.textContent = `✗ Invalid JSON: ${error.message}`;
                jsonStatus.classList.remove('hidden');
                jsonStatus.classList.add('error');
                setupJsonUploaded = false;
                checkSetupComplete();
            }
        };
        reader.onerror = () => {
            jsonStatus.textContent = '✗ Failed to read file';
            jsonStatus.classList.remove('hidden');
            jsonStatus.classList.add('error');
            setupJsonUploaded = false;
            checkSetupComplete();
        };
        reader.readAsText(file);
    }

    // PDF Upload (Setup)
    const uploadPdfBtn = document.getElementById('uploadPdfBtn');
    if (uploadPdfBtn) {
        uploadPdfBtn.addEventListener('click', () => {
            pdfInput.click();
        });
    }

    if (pdfInput) {
        pdfInput.addEventListener('change', (event) => {
            handleSetupPdfUpload(event.target.files[0]);
        });
    }

    function handleSetupPdfUpload(file) {
        if (!file) return;

        const validation = validatePdfFile(file);
        if (!validation.valid) {
            pdfStatus.textContent = `✗ ${validation.message}`;
            pdfStatus.classList.remove('hidden');
            pdfStatus.classList.add('error');
            setupPdfUploaded = false;
            checkSetupComplete();
            return;
        }

        const MAX_SIZE = 10 * 1024 * 1024;
        if (file.size > MAX_SIZE) {
            pdfStatus.textContent = '✗ File too large (max 10MB)';
            pdfStatus.classList.remove('hidden');
            pdfStatus.classList.add('error');
            setupPdfUploaded = false;
            checkSetupComplete();
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                currentResumeFile = {
                    data: e.target.result,
                    name: file.name,
                    type: file.type,
                    size: file.size
                };
                setupPdfUploaded = true;
                pdfStatus.textContent = `✓ ${file.name}`;
                pdfStatus.classList.remove('hidden');
                pdfStatus.classList.add('success');
                checkSetupComplete();
            } catch (error) {
                console.error('[Sidepanel] PDF processing error:', error);
                pdfStatus.textContent = `✗ ${error.message}`;
                pdfStatus.classList.remove('hidden');
                pdfStatus.classList.add('error');
                setupPdfUploaded = false;
                checkSetupComplete();
            }
        };
        reader.onerror = () => {
            pdfStatus.textContent = '✗ Failed to read file';
            pdfStatus.classList.remove('hidden');
            pdfStatus.classList.add('error');
            setupPdfUploaded = false;
            checkSetupComplete();
        };
        reader.readAsDataURL(file);
    }

    // Check if setup is complete
    function checkSetupComplete() {
        if (setupJsonUploaded && setupPdfUploaded) {
            completeSetupBtn.disabled = false;
        } else {
            completeSetupBtn.disabled = true;
        }
    }

    // Complete Setup Button
    if (completeSetupBtn) {
        completeSetupBtn.addEventListener('click', async () => {
            if (!setupJsonUploaded || !setupPdfUploaded) {
                showStatus('Both JSON and PDF files are required', 'error');
                return;
            }

            try {
                const normalized = ResumeProcessor.normalize(currentResumeData);

                // Save to multi-resume storage
                await ResumeManager.add(currentResumeData, currentResumeFile);

                // Also save to legacy storage for backward compatibility
                chrome.storage.local.set({
                    resumeData: currentResumeData,
                    normalizedData: normalized,
                    resumeFile: currentResumeFile
                }, () => {
                    if (chrome.runtime.lastError) {
                        console.error('[Sidepanel] Storage error:', chrome.runtime.lastError);
                        showStatus('Failed to save: ' + chrome.runtime.lastError.message, 'error');
                        return;
                    }

                    setupJsonUploaded = false;
                    setupPdfUploaded = false;
                    jsonStatus.classList.add('hidden');
                    pdfStatus.classList.add('hidden');
                    updateUI();
                    showStatus('Setup complete! Ready to autofill.', 'success');
                });
            } catch (error) {
                console.error('[Sidepanel] Setup completion error:', error);
                showStatus('Failed to complete setup: ' + error.message, 'error');
            }
        });
    }

    // === PHASE 1: FEEDBACK BUTTON ===

    if (feedbackBtn) {
        feedbackBtn.addEventListener('click', () => {
            // Get current session data if available
            const sessionData = FormTracker ? FormTracker.getCurrentSession() : null;
            FeedbackModal.show(sessionData);
        });
    }

    // === PHASE 1: UNSUPPORTED VIEW HANDLERS ===

    if (submitRequestBtn) {
        submitRequestBtn.addEventListener('click', () => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (!tabs || !tabs[0]) return;

                const url = tabs[0].url;
                const title = tabs[0].title;
                const issueUrl = `https://github.com/WhiteboxHub/project-talentscreen-autofill-extension/issues/new?title=${encodeURIComponent('Add support for: ' + title)}&body=${encodeURIComponent('Please add support for this ATS platform:\n\nURL: ' + url + '\n\nAdditional details:\n')}`;

                chrome.tabs.create({ url: issueUrl });
            });
        });
    }

    if (findJobsBtn) {
        findJobsBtn.addEventListener('click', () => {
            const jobBoards = [
                'https://www.linkedin.com/jobs/',
                'https://www.indeed.com/',
                'https://www.glassdoor.com/Job/jobs.htm'
            ];

            // Open random job board
            const randomBoard = jobBoards[Math.floor(Math.random() * jobBoards.length)];
            chrome.tabs.create({ url: randomBoard });
        });
    }

    // === ACTIVE VIEW HANDLERS ===

    // Fill Form button - with confirmation if progress exists
    if (fillFormBtn) {
        fillFormBtn.addEventListener('click', async () => {
            if (!currentResumeData) {
                showStatus('No resume data loaded', 'error');
                return;
            }

            // Check if there's existing progress
            const hasProgress = await checkExistingProgress();

            if (hasProgress) {
                const confirmed = await ConfirmationDialog.show({
                    title: 'Autofill Again?',
                    message: 'Are you sure you want to autofill again? This will overwrite your current progress.',
                    confirmText: 'Yes, Autofill',
                    cancelText: 'Cancel',
                    dontAskAgainKey: 'dontAskAgainAutofill',
                    showDontAskAgain: true
                });

                if (!confirmed) {
                    return; // User cancelled
                }
            }

            try {
                chrome.storage.local.get(['resumeFile'], (storage) => {
                    if (chrome.runtime.lastError) {
                        console.error('[Sidepanel] Storage error:', chrome.runtime.lastError);
                        showStatus('Failed to retrieve data', 'error');
                        return;
                    }

                    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                        const activeTabId = tabs[0]?.id;
                        if (!activeTabId) {
                            showStatus('No active tab found', 'error');
                            return;
                        }

                        try {
                            const normalized = ResumeProcessor.normalize(currentResumeData);
                            chrome.tabs.sendMessage(activeTabId, {
                                action: "fill_form",
                                data: currentResumeData,
                                normalizedData: normalized,
                                resumeFile: storage.resumeFile,
                                manual: true
                            }, (response) => {
                                if (chrome.runtime.lastError) {
                                    console.error('[Sidepanel] Message error:', chrome.runtime.lastError);
                                    showStatus('Could not reach page. Try reloading the page.', 'error');
                                } else {
                                    showStatus('Autofill initiated!', 'success');
                                }
                            });
                        } catch (error) {
                            console.error('[Sidepanel] Fill error:', error);
                            showStatus('Failed to initiate autofill: ' + error.message, 'error');
                        }
                    });
                });
            } catch (error) {
                console.error('[Sidepanel] Fill button error:', error);
                showStatus('An error occurred: ' + error.message, 'error');
            }
        });
    }

    // === MANAGE INFORMATION DASHBOARD ===
    // Note: manageInfoBtn removed from UI, but dashboard still accessible via other means

    // Close Dashboard
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => {
            manageModal.classList.add('hidden');
        });
    }

    // Dashboard Navigation
    dashboardNavBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const section = btn.dataset.section;
            showDashboardSection(section);
        });
    });

    function showDashboardSection(section) {
        dashboardNavBtns.forEach(btn => {
            if (btn.dataset.section === section) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        editSection.classList.add('hidden');
        jsonSection.classList.add('hidden');
        settingsSection.classList.add('hidden');

        if (section === 'edit') {
            editSection.classList.remove('hidden');
            showFormSection('personal');
            populateEditForms();
        } else if (section === 'json') {
            jsonSection.classList.remove('hidden');
        } else if (section === 'settings') {
            settingsSection.classList.remove('hidden');
        }
    }

    // Edit Information Section Tabs
    sectionTabs.forEach(btn => {
        btn.addEventListener('click', () => {
            const formName = btn.dataset.form;
            showFormSection(formName);
        });
    });

    function showFormSection(formName) {
        sectionTabs.forEach(btn => {
            if (btn.dataset.form === formName) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        personalForm.classList.add('hidden');
        workForm.classList.add('hidden');
        educationForm.classList.add('hidden');
        skillsForm.classList.add('hidden');
        customForm.classList.add('hidden');

        if (formName === 'personal') personalForm.classList.remove('hidden');
        else if (formName === 'work') workForm.classList.remove('hidden');
        else if (formName === 'education') educationForm.classList.remove('hidden');
        else if (formName === 'skills') skillsForm.classList.remove('hidden');
        else if (formName === 'custom') customForm.classList.remove('hidden');
    }

    // Populate Edit Forms
    function populateEditForms() {
        if (!currentResumeData) return;

        let normalized = null;
        try {
            normalized = ResumeProcessor.normalize(currentResumeData);
        } catch (e) {
            console.error('[Sidepanel] Error normalizing resume data:', e);
        }

        const basics = currentResumeData.basics || {};
        const location = basics.location || {};
        const profiles = basics.profiles || [];
        const linkedin = profiles.find(p => p.network === 'LinkedIN' || p.network === 'LinkedIn');

        const normalizedContact = normalized?.contact || {};
        const normalizedIdentity = normalized?.identity || {};
        const normalizedSummary = normalized?.summary || {};

        // Parse full name into first/middle/last
        const nameParts = (basics.name || '').trim().split(' ');
        const firstName = nameParts[0] || '';
        const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
        const middleName = nameParts.length > 2 ? nameParts.slice(1, -1).join(' ') : '';

        // Personal Info Form - safely check if elements exist
        const firstNameEl = document.getElementById('edit-first-name');
        const middleNameEl = document.getElementById('edit-middle-name');
        const lastNameEl = document.getElementById('edit-last-name');
        const emailEl = document.getElementById('edit-email');
        const phoneTypeEl = document.getElementById('edit-phone-type');
        const phoneEl = document.getElementById('edit-phone');
        const countryEl = document.getElementById('edit-country');
        const cityEl = document.getElementById('edit-city');
        const regionEl = document.getElementById('edit-region');
        const addressEl = document.getElementById('edit-address');
        const postalCodeEl = document.getElementById('edit-postal-code');
        const countyEl = document.getElementById('edit-county');
        const linkedinEl = document.getElementById('edit-linkedin');
        const summaryEl = document.getElementById('edit-summary');

        if (firstNameEl) firstNameEl.value = normalizedIdentity.first_name || firstName;
        if (middleNameEl) middleNameEl.value = normalizedIdentity.middle_name || middleName;
        if (lastNameEl) lastNameEl.value = normalizedIdentity.last_name || lastName;
        if (emailEl) emailEl.value = normalizedContact.email || basics.email || '';
        if (phoneTypeEl) phoneTypeEl.value = basics.phoneType || 'mobile';
        if (phoneEl) phoneEl.value = normalizedContact.phone || basics.phone || '';
        if (countryEl) countryEl.value = normalizedContact.country || location.country || location.countryCode || '';
        if (cityEl) cityEl.value = normalizedContact.city || location.city || '';
        if (regionEl) regionEl.value = normalizedContact.state || location.region || '';
        if (addressEl) addressEl.value = normalizedContact.address || location.address || '';
        if (postalCodeEl) postalCodeEl.value = normalizedContact.zip_code || location.postalCode || '';
        if (countyEl) countyEl.value = location.county || '';
        if (linkedinEl) linkedinEl.value = normalizedContact.linkedin || linkedin?.url || '';
        if (summaryEl) summaryEl.value = normalizedSummary.long || basics.summary || '';

        // Work Experience
        populateWorkEntries();

        // Education
        populateEducationEntries();

        // Skills
        populateSkillsForm();

        // Custom Fields
        populateCustomForm();
    }

    function populateWorkEntries() {
        const work = currentResumeData.work || [];
        workEntriesContainer.innerHTML = '';

        work.forEach((job, index) => {
            addWorkEntry(job, index);
        });

        if (work.length === 0) {
            addWorkEntry({}, 0);
        }
    }

    function addWorkEntry(job = {}, index) {
        const entryDiv = document.createElement('div');
        entryDiv.className = 'form-entry';
        entryDiv.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <h4 style="margin: 0;">Position ${index + 1}</h4>
                <button type="button" class="remove-entry-btn" data-index="${index}">Remove</button>
            </div>
            <label>Company:</label>
            <input type="text" class="work-company" value="${job.name || ''}" />

            <label>Position:</label>
            <input type="text" class="work-position" value="${job.position || ''}" />

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                <div>
                    <label>Start Date:</label>
                    <input type="text" class="work-start" value="${job.startDate || ''}" placeholder="YYYY-MM-DD" />
                </div>
                <div>
                    <label>End Date:</label>
                    <input type="text" class="work-end" value="${job.endDate || ''}" placeholder="YYYY-MM-DD or leave blank" />
                </div>
            </div>

            <label>Summary:</label>
            <textarea class="work-summary" rows="2">${job.summary || ''}</textarea>
        `;
        workEntriesContainer.appendChild(entryDiv);

        const removeBtn = entryDiv.querySelector('.remove-entry-btn');
        removeBtn.addEventListener('click', () => {
            entryDiv.remove();
        });
    }

    if (addWorkBtn) {
        addWorkBtn.addEventListener('click', () => {
            const currentCount = workEntriesContainer.querySelectorAll('.form-entry').length;
            addWorkEntry({}, currentCount);
        });
    }

    function populateEducationEntries() {
        const education = currentResumeData.education || [];
        educationEntriesContainer.innerHTML = '';

        education.forEach((edu, index) => {
            addEducationEntry(edu, index);
        });

        if (education.length === 0) {
            addEducationEntry({}, 0);
        }
    }

    function addEducationEntry(edu = {}, index) {
        const entryDiv = document.createElement('div');
        entryDiv.className = 'form-entry';
        entryDiv.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <h4 style="margin: 0;">Education ${index + 1}</h4>
                <button type="button" class="remove-entry-btn" data-index="${index}">Remove</button>
            </div>
            <label>Institution:</label>
            <input type="text" class="edu-institution" value="${edu.institution || ''}" />

            <label>Degree:</label>
            <input type="text" class="edu-degree" value="${edu.studyType || ''}" placeholder="Bachelor's, Master's, etc." />

            <label>Field of Study:</label>
            <input type="text" class="edu-area" value="${edu.area || ''}" />

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                <div>
                    <label>Start Date:</label>
                    <input type="text" class="edu-start" value="${edu.startDate || ''}" placeholder="YYYY-MM-DD" />
                </div>
                <div>
                    <label>End Date:</label>
                    <input type="text" class="edu-end" value="${edu.endDate || ''}" placeholder="YYYY-MM-DD or leave blank" />
                </div>
            </div>
        `;
        educationEntriesContainer.appendChild(entryDiv);

        const removeBtn = entryDiv.querySelector('.remove-entry-btn');
        removeBtn.addEventListener('click', () => {
            entryDiv.remove();
        });
    }

    if (addEducationBtn) {
        addEducationBtn.addEventListener('click', () => {
            const currentCount = educationEntriesContainer.querySelectorAll('.form-entry').length;
            addEducationEntry({}, currentCount);
        });
    }

    function populateSkillsForm() {
        const skills = currentResumeData.skills || [];
        const allKeywords = skills.flatMap(s => s.keywords || []);
        const skillsEl = document.getElementById('edit-skills');
        if (skillsEl) skillsEl.value = allKeywords.join(', ');
    }

    function populateCustomForm() {
        const custom = currentResumeData.custom_fields || {};
        const eeo = custom.eeo || {};
        const legal = custom.legal || {};

        const genderEl = document.getElementById('edit-gender');
        const veteranEl = document.getElementById('edit-veteran');
        const workAuthEl = document.getElementById('edit-work-auth');
        const sponsorshipNowEl = document.getElementById('edit-sponsorship-now');
        const sponsorshipFutureEl = document.getElementById('edit-sponsorship-future');

        if (genderEl) genderEl.value = eeo.gender || '';
        if (veteranEl) veteranEl.value = eeo.veteran_status || '';
        if (workAuthEl) workAuthEl.checked = legal.work_auth_us || false;
        if (sponsorshipNowEl) sponsorshipNowEl.checked = legal.sponsorship_required_now || false;
        if (sponsorshipFutureEl) sponsorshipFutureEl.checked = legal.sponsorship_required_future || false;
    }

    // Save Personal Info Form
    if (personalForm) {
        personalForm.addEventListener('submit', (e) => {
            e.preventDefault();
            try {
                if (!currentResumeData.basics) currentResumeData.basics = {};
                if (!currentResumeData.basics.location) currentResumeData.basics.location = {};
                if (!currentResumeData.basics.profiles) currentResumeData.basics.profiles = [];

                // Construct full name from parts
                const firstName = document.getElementById('edit-first-name')?.value || '';
                const middleName = document.getElementById('edit-middle-name')?.value || '';
                const lastName = document.getElementById('edit-last-name')?.value || '';
                const fullName = [firstName, middleName, lastName].filter(p => p).join(' ');

                currentResumeData.basics.name = fullName;
                currentResumeData.basics.email = document.getElementById('edit-email')?.value || '';
                currentResumeData.basics.phoneType = document.getElementById('edit-phone-type')?.value || 'mobile';
                currentResumeData.basics.phone = document.getElementById('edit-phone')?.value || '';
                currentResumeData.basics.location.country = document.getElementById('edit-country')?.value || '';
                currentResumeData.basics.location.city = document.getElementById('edit-city')?.value || '';
                currentResumeData.basics.location.region = document.getElementById('edit-region')?.value || '';
                currentResumeData.basics.location.address = document.getElementById('edit-address')?.value || '';
                currentResumeData.basics.location.postalCode = document.getElementById('edit-postal-code')?.value || '';
                currentResumeData.basics.location.county = document.getElementById('edit-county')?.value || '';
                currentResumeData.basics.summary = document.getElementById('edit-summary')?.value || '';

                const linkedinUrl = document.getElementById('edit-linkedin')?.value || '';
                const linkedinProfile = currentResumeData.basics.profiles.find(p => p.network === 'LinkedIN' || p.network === 'LinkedIn');
                if (linkedinProfile) {
                    linkedinProfile.url = linkedinUrl;
                } else if (linkedinUrl) {
                    currentResumeData.basics.profiles.push({ network: 'LinkedIN', url: linkedinUrl });
                }

                saveResumeData('Personal information updated!');
            } catch (error) {
                console.error('[Sidepanel] Personal form save error:', error);
                showStatus('Failed to save: ' + error.message, 'error');
            }
        });
    }

    // Save Work Experience Form
    if (workForm) {
        workForm.addEventListener('submit', (e) => {
            e.preventDefault();
            try {
                const workEntries = Array.from(workEntriesContainer.querySelectorAll('.form-entry'));
                currentResumeData.work = workEntries.map(entry => {
                    return {
                        name: entry.querySelector('.work-company').value,
                        position: entry.querySelector('.work-position').value,
                        startDate: entry.querySelector('.work-start').value,
                        endDate: entry.querySelector('.work-end').value,
                        summary: entry.querySelector('.work-summary').value
                    };
                }).filter(job => job.name || job.position);

                saveResumeData('Work experience updated!');
            } catch (error) {
                console.error('[Sidepanel] Work form save error:', error);
                showStatus('Failed to save: ' + error.message, 'error');
            }
        });
    }

    // Save Education Form
    if (educationForm) {
        educationForm.addEventListener('submit', (e) => {
            e.preventDefault();
            try {
                const eduEntries = Array.from(educationEntriesContainer.querySelectorAll('.form-entry'));
                currentResumeData.education = eduEntries.map(entry => {
                    return {
                        institution: entry.querySelector('.edu-institution').value,
                        studyType: entry.querySelector('.edu-degree').value,
                        area: entry.querySelector('.edu-area').value,
                        startDate: entry.querySelector('.edu-start').value,
                        endDate: entry.querySelector('.edu-end').value
                    };
                }).filter(edu => edu.institution || edu.studyType);

                saveResumeData('Education updated!');
            } catch (error) {
                console.error('[Sidepanel] Education form save error:', error);
                showStatus('Failed to save: ' + error.message, 'error');
            }
        });
    }

    // Save Skills Form
    if (skillsForm) {
        skillsForm.addEventListener('submit', (e) => {
            e.preventDefault();
            try {
                const skillsText = document.getElementById('edit-skills').value;
                const keywords = skillsText.split(',').map(s => s.trim()).filter(s => s);

                currentResumeData.skills = [{
                    name: 'Skills',
                    keywords: keywords
                }];

                saveResumeData('Skills updated!');
            } catch (error) {
                console.error('[Sidepanel] Skills form save error:', error);
                showStatus('Failed to save: ' + error.message, 'error');
            }
        });
    }

    // Save Custom Fields Form
    if (customForm) {
        customForm.addEventListener('submit', (e) => {
            e.preventDefault();
            try {
                if (!currentResumeData.custom_fields) currentResumeData.custom_fields = {};
                if (!currentResumeData.custom_fields.eeo) currentResumeData.custom_fields.eeo = {};
                if (!currentResumeData.custom_fields.legal) currentResumeData.custom_fields.legal = {};

                currentResumeData.custom_fields.eeo.gender = document.getElementById('edit-gender').value;
                currentResumeData.custom_fields.eeo.veteran_status = document.getElementById('edit-veteran').value;
                currentResumeData.custom_fields.legal.work_auth_us = document.getElementById('edit-work-auth').checked;
                currentResumeData.custom_fields.legal.sponsorship_required_now = document.getElementById('edit-sponsorship-now').checked;
                currentResumeData.custom_fields.legal.sponsorship_required_future = document.getElementById('edit-sponsorship-future').checked;

                saveResumeData('Custom fields updated!');
            } catch (error) {
                console.error('[Sidepanel] Custom form save error:', error);
                showStatus('Failed to save: ' + error.message, 'error');
            }
        });
    }

    // === UPDATE JSON SECTION ===

    if (updateJsonInput) {
        updateJsonInput.addEventListener('change', (event) => {
            handleUpdateJson(event.target.files[0]);
        });
    }

    function handleUpdateJson(file) {
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const rawText = e.target.result;
                const text = rawText.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
                const json = JSON.parse(text);

                const validation = validateJsonData(json);
                if (validation.valid) {
                    currentResumeData = json;
                    saveResumeData('JSON updated successfully! Forms reloaded.');
                    populateEditForms();
                } else {
                    showStatus(`Validation Error: ${validation.message}`, 'error');
                }
            } catch (error) {
                console.error('[Sidepanel] JSON update error:', error);
                showStatus('Invalid JSON: ' + error.message, 'error');
            }
        };
        reader.onerror = () => {
            showStatus('Failed to read JSON file', 'error');
        };
        reader.readAsText(file);
    }

    if (updatePdfInput) {
        updatePdfInput.addEventListener('change', (event) => {
            handleUpdatePdf(event.target.files[0]);
        });
    }

    function handleUpdatePdf(file) {
        if (!file) return;

        const validation = validatePdfFile(file);
        if (!validation.valid) {
            showStatus(validation.message, 'error');
            return;
        }

        const MAX_SIZE = 10 * 1024 * 1024;
        if (file.size > MAX_SIZE) {
            showStatus('File too large (max 10MB)', 'error');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const resumeFileData = {
                    data: e.target.result,
                    name: file.name,
                    type: file.type,
                    size: file.size
                };

                chrome.storage.local.set({ resumeFile: resumeFileData }, () => {
                    if (chrome.runtime.lastError) {
                        console.error('[Sidepanel] Storage error:', chrome.runtime.lastError);
                        showStatus('Failed to save PDF: ' + chrome.runtime.lastError.message, 'error');
                        return;
                    }

                    currentResumeFile = resumeFileData;
                    showStatus('PDF updated successfully!', 'success');
                });
            } catch (error) {
                console.error('[Sidepanel] PDF update error:', error);
                showStatus('Failed to update PDF: ' + error.message, 'error');
            }
        };
        reader.onerror = () => {
            showStatus('Failed to read PDF file', 'error');
        };
        reader.readAsDataURL(file);
    }

    // === SETTINGS SECTION ===

    if (deleteProfileBtn) {
        deleteProfileBtn.addEventListener('click', () => {
            if (confirm('Are you sure you want to delete all resume data? This will return you to the setup screen.')) {
                try {
                    chrome.storage.local.set({
                        resumeData: null,
                        normalizedData: null,
                        resumeFile: null
                    }, () => {
                        if (chrome.runtime.lastError) {
                            console.error('[Sidepanel] Storage error:', chrome.runtime.lastError);
                            showStatus('Failed to clear data', 'error');
                            return;
                        }

                        currentResumeData = null;
                        currentResumeFile = null;
                        setupJsonUploaded = false;
                        setupPdfUploaded = false;
                        jsonStatus.classList.add('hidden');
                        pdfStatus.classList.add('hidden');
                        manageModal.classList.add('hidden');
                        updateUI();
                        showStatus('All data deleted. Please complete setup again.', 'success');
                    });
                } catch (error) {
                    console.error('[Sidepanel] Delete error:', error);
                    showStatus('Failed to delete data: ' + error.message, 'error');
                }
            }
        });
    }

    // === HELPER FUNCTIONS ===

    // Check if there's existing autofill progress on current page
    async function checkExistingProgress() {
        return new Promise((resolve) => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (!tabs || !tabs[0]) {
                    resolve(false);
                    return;
                }

                chrome.tabs.sendMessage(tabs[0].id, { action: 'check_progress' }, (response) => {
                    if (chrome.runtime.lastError) {
                        resolve(false);
                        return;
                    }

                    // Check if FormTracker has active session with progress
                    resolve(response && response.hasProgress);
                });
            });
        });
    }

    function saveResumeData(successMessage = 'Resume saved!') {
        try {
            const normalized = ResumeProcessor.normalize(currentResumeData);

            chrome.storage.local.set({
                resumeData: currentResumeData,
                normalizedData: normalized
            }, () => {
                if (chrome.runtime.lastError) {
                    console.error('[Sidepanel] Storage error:', chrome.runtime.lastError);
                    showStatus('Failed to save: ' + chrome.runtime.lastError.message, 'error');
                    return;
                }

                showStatus(successMessage, 'success');
            });
        } catch (error) {
            console.error('[Sidepanel] Save error:', error);
            showStatus('Failed to save: ' + error.message, 'error');
        }
    }

    function validateJsonData(data) {
        if (!data) return { valid: false, message: 'No data provided' };
        try {
            const norm = ResumeProcessor.normalize(data);
            const missing = [];

            if (!norm.identity?.first_name && !norm.identity?.full_name) missing.push("Name");
            if (!norm.contact?.email) missing.push("Email");

            if (missing.length > 0) {
                return { valid: false, message: `Missing required fields: ${missing.join(', ')}` };
            }
            return { valid: true };
        } catch (error) {
            return { valid: false, message: 'Invalid resume format: ' + error.message };
        }
    }

    function validatePdfFile(file) {
        if (!file) return { valid: false, message: 'No file selected' };
        const name = (file.name || '').toLowerCase();
        if (name.endsWith('.pdf') || name.endsWith('.doc') || name.endsWith('.docx')) {
            return { valid: true };
        }
        return { valid: false, message: 'Invalid format. Must be PDF, DOC, or DOCX' };
    }

    // === HISTORY ===

    function renderHistory() {
        if (!historyList) return;

        if (applicationHistory.length === 0) {
            historyList.innerHTML = '<p style="text-align: center; color: var(--text-muted); font-size: 0.75rem; padding: 12px;">No applications yet</p>';
            return;
        }

        const sorted = [...applicationHistory].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
        historyList.innerHTML = sorted.map(item => `
            <div class="history-item-compact">
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div style="flex: 1; min-width: 0;">
                        <p style="font-size: 0.8rem; font-weight: 600; margin: 0 0 2px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.company || 'Company'}</p>
                        <p style="font-size: 0.7rem; color: var(--text-muted); margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.role || 'Job Application'}</p>
                    </div>
                    <span style="font-size: 0.65rem; color: var(--text-muted); white-space: nowrap; margin-left: 8px;">${formatDate(item.date)}</span>
                </div>
            </div>
        `).join('');
    }

    function formatDate(dateStr) {
        try {
            const date = new Date(dateStr);
            const now = new Date();
            const diffMs = now - date;
            const diffMins = Math.floor(diffMs / 60000);
            const diffHours = Math.floor(diffMs / 3600000);
            const diffDays = Math.floor(diffMs / 86400000);

            if (diffMins < 60) return `${diffMins}m ago`;
            if (diffHours < 24) return `${diffHours}h ago`;
            if (diffDays < 7) return `${diffDays}d ago`;
            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        } catch (e) {
            return 'Recently';
        }
    }

    if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener('click', () => {
            if (confirm('Clear all application history?')) {
                try {
                    applicationHistory = [];
                    chrome.storage.local.set({ applicationHistory: [] }, () => {
                        if (chrome.runtime.lastError) {
                            showStatus('Failed to clear history', 'error');
                            return;
                        }
                        renderHistory();
                        showStatus('History cleared', 'success');
                    });
                } catch (error) {
                    console.error('[Sidepanel] Clear history error:', error);
                    showStatus('Failed to clear history: ' + error.message, 'error');
                }
            }
        });
    }

    // === PROGRESS TRACKING ===

    // === STORAGE CHANGE LISTENER ===

    chrome.storage.onChanged.addListener((changes, namespace) => {
        try {
            if (namespace === 'local') {
                if (changes.applicationHistory) {
                    applicationHistory = changes.applicationHistory.newValue || [];
                    renderHistory();
                }
                if (changes.resumeData) {
                    currentResumeData = changes.resumeData.newValue || null;
                    updateUI();
                }
            }
        } catch (error) {
            console.error('[Sidepanel] Storage change error:', error);
        }
    });

    // === FORM TRACKING UI ===

    const trackingSection = document.getElementById('trackingSection');
    const statFilled = document.getElementById('statFilled');
    const statSkipped = document.getElementById('statSkipped');
    const statFailed = document.getElementById('statFailed');
    const statNeedsReview = document.getElementById('statNeedsReview');
    const sessionInfo = document.getElementById('sessionInfo');
    const sessionAts = document.getElementById('sessionAts');
    const sessionCompany = document.getElementById('sessionCompany');
    const sessionStart = document.getElementById('sessionStart');
    const sessionCompletion = document.getElementById('sessionCompletion');
    const viewFieldsBtn = document.getElementById('viewFieldsBtn');

    // Tracking dashboard elements
    const currentSessionCard = document.getElementById('currentSessionCard');
    const sessionStatusBadge = document.getElementById('sessionStatusBadge');
    const trackingAts = document.getElementById('trackingAts');
    const trackingCompany = document.getElementById('trackingCompany');
    const trackingStartTime = document.getElementById('trackingStartTime');
    const trackingCompletion = document.getElementById('trackingCompletion');
    const fieldStatesList = document.getElementById('fieldStatesList');
    const failedFieldsCard = document.getElementById('failedFieldsCard');
    const failedFieldsList = document.getElementById('failedFieldsList');
    const needsReviewCard = document.getElementById('needsReviewCard');
    const needsReviewList = document.getElementById('needsReviewList');
    const trackingHistoryList = document.getElementById('trackingHistoryList');
    const retryFailedBtn = document.getElementById('retryFailedBtn');
    const clearTrackingHistoryBtn = document.getElementById('clearTrackingHistoryBtn');
    const debugModeToggle = document.getElementById('debugModeToggle');
    const exportTrackingBtn = document.getElementById('exportTrackingBtn');

    // Handle enhanced progress messages from FormTracker
    chrome.runtime.onMessage.addListener((msg) => {
        try {
            if (msg.action === 'update_progress') {
                updateProgressDisplay(msg);
                } else if (msg.action === 'tracking_completed') {
                    updateFieldStatusDisplay();
            } else if (msg.action === 'session_started') {
                handleSessionStarted(msg.session);
            } else if (msg.action === 'session_ended') {
                handleSessionEnded(msg.session);
            } else if (msg.action === 'session_paused') {
                handleSessionPaused(msg.reason);
            } else if (msg.action === 'needs_review') {
                handleNeedsReview(msg);
            }
        } catch (error) {
            console.error('[Sidepanel] Tracking message error:', error);
        }
    });

    function updateProgressDisplay(data) {
        const { filled, total, skipped, failed, needs_review } = data;

        // Update main progress bar
        progressSection.classList.remove('hidden');
        progressCount.textContent = `${filled}/${total} fields`;
        const percentage = total > 0 ? Math.round((filled / total) * 100) : 0;
        progressBar.style.width = `${percentage}%`;

        // Update detailed stats
        if (statFilled) statFilled.textContent = filled || 0;
        if (statSkipped) statSkipped.textContent = skipped || 0;
        if (statFailed) statFailed.textContent = failed || 0;
        if (statNeedsReview) statNeedsReview.textContent = needs_review || 0;

        if (sessionCompletion) {
            sessionCompletion.textContent = `${percentage}% (${filled}/${total} fields)`;
        }

        // Update tracking dashboard if open
        if (trackingCompletion) {
            trackingCompletion.textContent = `${percentage}%`;
        }
    }

    // Fetch and display detailed field status
    function updateFieldStatusDisplay() {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs || !tabs[0]) return;

            chrome.tabs.sendMessage(tabs[0].id, { action: 'get_form_fields' }, (response) => {
                if (chrome.runtime.lastError || !response) {
                    console.error('[Sidepanel] Error getting form fields:', chrome.runtime.lastError);
                    return;
                }

                const fieldStatusSection = document.getElementById('fieldStatusSection');
                const fieldSectionsContainer = document.getElementById('fieldSectionsContainer');
                const fieldStatusCount = document.getElementById('fieldStatusCount');
                
                if (!fieldStatusSection || !fieldSectionsContainer) return;

                const fields = response.fields || [];
                if (fields.length === 0) return;

                fieldStatusSection.classList.remove('hidden');

                // Group fields by category/section
                const sections = groupFieldsBySection(fields);
                
                // Create HTML for sections
                let html = '';
                let completedCount = 0;

                Object.entries(sections).forEach(([sectionName, fieldList]) => {
                    html += `<div class="field-section">`;
                    html += `<div class="field-section-title">${sectionName}</div>`;
                    
                    fieldList.forEach(field => {
                        const statusClass = getFieldStatusClass(field);
                        const statusIcon = getFieldStatusIcon(field);
                        const isCompleted = field.status === 'filled';
                        
                        if (isCompleted) completedCount++;
                        
                        html += `
                            <div class="field-item" data-scroll-id="${field.scrollId}" title="Click to view this field">
                                <div class="field-indicator ${statusClass}">${statusIcon}</div>
                                <div class="field-name ${field.status === 'failed' ? 'failed' : ''}">
                                    ${field.label}
                                </div>
                            </div>
                        `;
                    });
                    
                    html += `</div>`;
                });

                fieldSectionsContainer.innerHTML = html;
                fieldStatusCount.textContent = `${completedCount}/${fields.length}`;

                // Add click listeners to auto-scroll to the field on the page
                const fieldItems = fieldSectionsContainer.querySelectorAll('.field-item');
                fieldItems.forEach(item => {
                    item.addEventListener('click', () => {
                        const scrollId = item.getAttribute('data-scroll-id');
                        if (scrollId) {
                            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                                if (tabs && tabs[0]) {
                                    chrome.tabs.sendMessage(tabs[0].id, { action: 'scroll_to_field', scrollId: scrollId });
                                }
                            });
                        }
                    });
                });
            });
        });
    }

    // Group fields by section/category
    function groupFieldsBySection(fields) {
        const sections = {
            'Documents': [],
            'Legal & EEO': [],
            'Education': [],
            'Work Experience': [],
            'Contact': [],
            'Personal': [],
            'Skills': [],
            'Other': []
        };

        fields.forEach(field => {
            const label = field.label || field.id || '';
            const labelLower = label.toLowerCase();

            // 1. Documents
            if (labelLower.match(/\b(resume|cv|cover letter|transcript|attachment|document|file|upload)\b/)) {
                sections['Documents'].push(field);
            } 
            // 2. Legal & EEO (Evaluate before Work/Personal to catch "work authorization")
            else if (labelLower.match(/\b(veteran|disability|eeo|eeoc|equal opportunity|protected|accommodation|legal|consent|agreement|policy|sponsorship|visa|authorized to work|authorization|citizenship|clearance|gender|sex|race|ethnicity|hispanic|latino|identify)\b/)) {
                sections['Legal & EEO'].push(field);
            } 
            // 3. Education (Evaluate before Personal to catch "University Name")
            else if (labelLower.match(/\b(school|university|college|degree|major|gpa|graduation|education|study|academic)\b/)) {
                sections['Education'].push(field);
            } 
            // 4. Work Experience (Evaluate before Personal to catch "Company Name")
            else if (labelLower.match(/\b(job|company|employer|experience|employment|work|salary|current role|previous role|industry|department)\b/)) {
                sections['Work Experience'].push(field);
            } 
            // 5. Contact / Links
            else if (labelLower.match(/\b(linkedin|website|portfolio|github|social|url|link)\b/)) {
                sections['Contact'].push(field);
            } 
            // 6. Personal (Evaluated late to act as a catch-all for names/locations)
            else if (labelLower.match(/\b(first|last|full|name|email|phone|mobile|tel|address|city|state|zip|postal|country|age|dob|birth|location)\b/)) {
                sections['Personal'].push(field);
            } 
            // 7. Skills
            else if (labelLower.match(/\b(skill|language|certification|technical|programming|software)\b/)) {
                sections['Skills'].push(field);
            } 
            // 8. Other
            else {
                sections['Other'].push(field);
            }
        });

        // Remove empty sections
        Object.keys(sections).forEach(key => {
            if (sections[key].length === 0) delete sections[key];
        });

        return sections;
    }

    // Get CSS class for field status
    function getFieldStatusClass(field) {
        const status = field.status || 'detected';
        
        if (status === 'filled') return 'completed';
        if (!field.required && status !== 'failed') return 'optional';
        return 'incomplete';
    }

    // Get status icon text
    function getFieldStatusIcon(field) {
        const status = field.status || 'detected';
        
        if (status === 'filled') return '✓';
        if (status === 'failed') return '✕';
        return '';
    }


    function handleSessionStarted(session) {
        if (sessionInfo) {
            sessionInfo.classList.remove('hidden');
            if (sessionAts) sessionAts.textContent = session.atsType || 'unknown';
            if (sessionCompany) sessionCompany.textContent = session.company || 'N/A';
            if (sessionStart) sessionStart.textContent = formatTime(session.startTime);
            if (sessionCompletion) sessionCompletion.textContent = '0% (0/0 fields)';
        }
    }

    function handleSessionEnded(session) {
        if (sessionInfo) {
            sessionInfo.classList.add('hidden');
        }

        // Refresh tracking history
        loadTrackingHistory();
    }

    function handleSessionPaused(reason) {
        if (sessionStatusBadge) {
            sessionStatusBadge.textContent = `Paused: ${reason}`;
        }
        showStatus(`Session paused: ${reason}`, 'warning');
    }

    function handleNeedsReview(data) {
        showStatus(`Field "${data.label}" needs manual review: ${data.reason}`, 'warning');
    }

    // View Fields button - opens dashboard tracking tab
    if (viewFieldsBtn) {
        viewFieldsBtn.addEventListener('click', () => {
            if (manageModal) manageModal.classList.remove('hidden');
            showDashboardSection('tracking');
            loadTrackingData();
        });
    }

    // Load tracking data when tracking section is shown
    function loadTrackingData() {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs || !tabs[0]) {
                console.warn('[Sidepanel] No active tab for tracking data');
                return;
            }

            chrome.tabs.sendMessage(tabs[0].id, { action: 'get_tracking_data' }, (response) => {
                if (chrome.runtime.lastError) {
                    console.warn('[Sidepanel] Could not get tracking data:', chrome.runtime.lastError);
                    return;
                }

                if (!response) {
                    console.warn('[Sidepanel] No tracking data response');
                    return;
                }

                renderFieldStates(response.fieldStates || []);
                renderFailedFields(response.failures || []);
                renderNeedsReview(response.needsReview || []);
            });
        });
    }

    function renderFieldStates(fields) {
        if (!fieldStatesList) return;

        if (fields.length === 0) {
            fieldStatesList.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 16px;">No fields detected</p>';
            return;
        }

        fieldStatesList.innerHTML = fields.map(field => `
            <div class="field-state-row ${field.status}">
                <div class="field-info">
                    <strong>${field.label}</strong>
                    <span class="field-type">${field.type}${field.required ? ' (required)' : ''}</span>
                </div>
                <span class="status-badge status-${field.status}">${field.status}</span>
            </div>
        `).join('');
    }

    function renderFailedFields(failures) {
        if (!failedFieldsCard || !failedFieldsList) return;

        if (failures.length === 0) {
            failedFieldsCard.classList.add('hidden');
            return;
        }

        failedFieldsCard.classList.remove('hidden');
        failedFieldsList.innerHTML = failures.map(field => `
            <div class="failed-field-row">
                <div>
                    <strong>${field.label}</strong>
                    <p class="error-text">${field.error || 'Unknown error'}</p>
                    <small>Retry count: ${field.retryCount}</small>
                </div>
            </div>
        `).join('');
    }

    function renderNeedsReview(fields) {
        if (!needsReviewCard || !needsReviewList) return;

        if (fields.length === 0) {
            needsReviewCard.classList.add('hidden');
            return;
        }

        needsReviewCard.classList.remove('hidden');
        needsReviewList.innerHTML = fields.map(field => `
            <div class="review-field-row">
                <div>
                    <strong>${field.label}</strong>
                    <p class="warning-text">${field.error || 'Manual review required'}</p>
                </div>
            </div>
        `).join('');
    }

    // Retry failed fields
    if (retryFailedBtn) {
        retryFailedBtn.addEventListener('click', () => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (!tabs[0]) return;

                chrome.tabs.sendMessage(tabs[0].id, { action: 'retry_failed_fields' }, (response) => {
                    if (chrome.runtime.lastError) {
                        showStatus('Could not retry fields', 'error');
                        return;
                    }
                    showStatus('Retrying failed fields...', 'info');
                    setTimeout(loadTrackingData, 2000);
                });
            });
        });
    }

    // Fetch and initialize active session tracking from tab
    function initActiveSessionTracking() {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs || !tabs[0] || !tabs[0].url) return;
            if (!tabs[0].url.startsWith('http://') && !tabs[0].url.startsWith('https://')) return;

            chrome.tabs.sendMessage(tabs[0].id, { action: 'get_tracking_data' }, (response) => {
                if (chrome.runtime.lastError || !response || !response.currentSession) return;

                const session = response.currentSession;
                if (session.status === 'in_progress' || session.status === 'paused') {
                    handleSessionStarted(session);

                    updateProgressDisplay({
                        filled: session.fields.filled,
                        total: session.fields.total,
                        skipped: session.fields.skipped,
                        failed: session.fields.failed,
                        needs_review: session.fields.needs_review
                    });
                }
            });
        });
    }

    // Load tracking history
    function loadTrackingHistory() {
        if (typeof FormTracker !== 'undefined') {
            const history = FormTracker.getRecentHistory(10);
            renderTrackingHistory(history);
        } else {
            chrome.storage.local.get(['formTrackerHistory'], (result) => {
                const history = (result.formTrackerHistory || []).slice(-10).reverse();
                renderTrackingHistory(history);
            });
        }
    }

    function renderTrackingHistory(history) {
        if (!trackingHistoryList) return;

        if (history.length === 0) {
            trackingHistoryList.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 16px;">No history yet</p>';
            return;
        }

        trackingHistoryList.innerHTML = history.map(session => {
            let hostname = '';
            try {
                if (session.jobUrl) {
                    hostname = new URL(session.jobUrl).hostname.replace('www.', '');
                }
            } catch (e) {
                hostname = session.jobUrl || '';
            }

            return `
                <div class="tracking-history-item" style="border-left: 3px solid ${session.status === 'completed' ? 'var(--success)' : 'var(--warning)'};">
                    <div class="history-header">
                        <strong>${session.company || 'Job Application'}</strong>
                        <span class="status-badge status-${session.status}">${session.status}</span>
                    </div>
                    <div class="history-details" style="display: flex; flex-direction: column; gap: 4px; align-items: flex-start; width: 100%;">
                        ${hostname ? `
                        <div style="display: flex; align-items: center; gap: 4px; font-weight: 500;">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink: 0;"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
                            <span>${hostname}</span>
                        </div>` : ''}
                        <div style="display: flex; gap: 12px; margin-top: 2px; width: 100%; justify-content: space-between;">
                            <span>ATS: ${session.atsType}</span>
                            <span>Filled: ${session.fields?.filled || 0}/${session.fields?.total || 0}</span>
                            <span>${formatTime(session.startTime)}</span>
                        </div>
                    </div>
                    ${session.fields?.failed > 0 ? `<p class="error-text" style="font-size: 0.7rem; color: var(--error); margin: 4px 0 0 0;">${session.fields.failed} failed</p>` : ''}
                </div>
            `;
        }).join('');
    }

    // Clear tracking history
    if (clearTrackingHistoryBtn) {
        clearTrackingHistoryBtn.addEventListener('click', () => {
            if (confirm('Clear all tracking history?')) {
                chrome.storage.local.set({ formTrackerHistory: [] }, () => {
                    if (chrome.runtime.lastError) {
                        showStatus('Failed to clear tracking history', 'error');
                        return;
                    }
                    loadTrackingHistory();
                    showStatus('Tracking history cleared', 'success');
                });
            }
        });
    }

    // Debug mode toggle
    if (debugModeToggle) {
        // Load saved state
        chrome.storage.local.get(['formTrackerDebugMode'], (result) => {
            debugModeToggle.checked = result.formTrackerDebugMode || false;
        });

        debugModeToggle.addEventListener('change', () => {
            const enabled = debugModeToggle.checked;
            chrome.storage.local.set({ formTrackerDebugMode: enabled });

            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]) {
                    chrome.tabs.sendMessage(tabs[0].id, {
                        action: 'set_debug_mode',
                        enabled: enabled
                    });
                }
            });

            showStatus(`Debug mode ${enabled ? 'enabled' : 'disabled'}`, 'success');
        });
    }

    // Export tracking data
    if (exportTrackingBtn) {
        exportTrackingBtn.addEventListener('click', () => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (!tabs[0]) return;

                chrome.tabs.sendMessage(tabs[0].id, { action: 'export_tracking_data' }, (response) => {
                    if (chrome.runtime.lastError || !response) {
                        showStatus('Could not export tracking data', 'error');
                        return;
                    }

                    const dataStr = JSON.stringify(response, null, 2);
                    const blob = new Blob([dataStr], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `tracking-data-${Date.now()}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                    showStatus('Tracking data exported', 'success');
                });
            });
        });
    }

    // Helper: format time
    function formatTime(isoString) {
        try {
            const date = new Date(isoString);
            return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        } catch (e) {
            return '-';
        }
    }

    // Load tracking history when dashboard opens to tracking tab
    const originalShowDashboardSection = showDashboardSection;
    showDashboardSection = function (section) {
        originalShowDashboardSection(section);
        if (section === 'tracking') {
            loadTrackingData();
            loadTrackingHistory();
        }
    };

    // === STATUS MESSAGES ===

    let statusTimeout = null;
    function showStatus(msg, type = 'info') {
        if (statusTimeout) clearTimeout(statusTimeout);

        statusDiv.textContent = msg;
        statusDiv.className = `status-message status-${type}`;
        statusDiv.classList.remove('hidden');

        statusTimeout = setTimeout(() => {
            statusDiv.classList.add('hidden');
            statusTimeout = null;
        }, type === 'error' ? 5000 : 3000);
    }

    // Handle change resume button - opens settings to files section
    const changeResumeBtn = document.getElementById('changeResumeBtn');
    if (changeResumeBtn) {
        changeResumeBtn.addEventListener('click', () => {
            chrome.tabs.create({
                url: chrome.runtime.getURL('/src/ui/settings.html#files')
            });
        });
    }

    // === INITIALIZE ===
    init();
    loadTrackingHistory();
    initActiveSessionTracking();
    initActionButtons();
});
