const runState = { running: false };

const ATS = {
  greenhouse: {
    apply: ["a[href*='#app']", "a[href*='/apply']", "#apply_button", "button[data-mapped-element='applyButton']"],
    fields: {
      firstName: ["#first_name", "input[name='job_application[first_name]']", "input[autocomplete='given-name']"],
      lastName: ["#last_name", "input[name='job_application[last_name]']", "input[autocomplete='family-name']"],
      email: ["#email", "input[name='job_application[email]']", "input[type='email']"],
      phone: ["#phone", "input[name='job_application[phone]']", "input[type='tel']"],
      location: ["input[name*='location']", "input[autocomplete='address-level2']"],
      linkedinUrl: ["input[name*='linkedin' i]", "input[id*='linkedin' i]"],
      portfolioUrl: ["input[name*='website' i]", "input[name*='portfolio' i]"],
    },
    resume: ["#resume", "input[type='file'][name*='resume' i]", "input[type='file']"],
    submit: ["#submit_app_button", "button[type='submit']", "input[type='submit'][value*='Submit' i]"],
  },
  lever: {
    apply: ["a.postings-btn", "a[href$='/apply']", "a[href*='/apply?']"],
    fields: {
      fullName: ["input[name='name']", "input[autocomplete='name']"],
      email: ["input[name='email']", "input[type='email']"],
      phone: ["input[name='phone']", "input[type='tel']"],
      currentCompany: ["input[name='org']"],
      linkedinUrl: ["input[name='urls[LinkedIn]']", "input[name*='LinkedIn' i]"],
      portfolioUrl: ["input[name='urls[Portfolio]']", "input[name*='Portfolio' i]"],
      location: ["input[name*='location' i]"],
    },
    resume: ["input[type='file'][name*='resume' i]", "input[type='file']"],
    submit: ["button.template-btn-submit", "button[type='submit']", "input[type='submit']"],
  },
};

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function detectAts() {
  const host = location.hostname.toLowerCase();
  if (host === "greenhouse.io" || host.endsWith(".greenhouse.io")) return "greenhouse";
  if (host === "lever.co" || host.endsWith(".lever.co")) return "lever";
  return null;
}

function visible(element) {
  if (!element) return false;
  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
}

function first(selectors) {
  for (const selector of selectors || []) {
    const element = document.querySelector(selector);
    if (visible(element)) return element;
  }
  return null;
}

function buttonByText(pattern) {
  return [...document.querySelectorAll("a, button")].find((element) => visible(element) && pattern.test((element.textContent || "").trim()));
}

function formIsPresent(ats) {
  const config = ATS[ats];
  return Object.values(config.fields).some((list) => first(list)) || Boolean(first(config.resume));
}

async function findOrOpenForm(ats, applicationId) {
  if (formIsPresent(ats)) return true;
  const applyButton = first(ATS[ats].apply) || buttonByText(/^(apply|apply now|apply for this job)$/i);
  if (!applyButton) throw new Error("Apply button was not found");
  await report(applicationId, "opening_application_form", { buttonText: applyButton.textContent?.trim() });
  applyButton.click();
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(500);
    if (formIsPresent(ats)) return true;
  }
  // A navigation may be in progress; the content script on the next page will resume automatically.
  return false;
}

function setNativeValue(element, value) {
  if (value === undefined || value === null || value === "") return false;
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter ? setter.call(element, String(value)) : (element.value = String(value));
  ["input", "change", "blur"].forEach((name) => element.dispatchEvent(new Event(name, { bubbles: true })));
  return String(element.value || "").trim().length > 0;
}

function fillKnownFields(ats, candidate) {
  const values = ats === "greenhouse"
    ? { firstName: candidate.firstName, lastName: candidate.lastName, email: candidate.email, phone: candidate.phone, location: candidate.location, linkedinUrl: candidate.linkedinUrl, portfolioUrl: candidate.portfolioUrl }
    : { fullName: candidate.fullName, email: candidate.email, phone: candidate.phone, currentCompany: candidate.currentCompany, location: candidate.location, linkedinUrl: candidate.linkedinUrl, portfolioUrl: candidate.portfolioUrl };
  const filled = [];
  for (const [key, value] of Object.entries(values)) {
    const element = first(ATS[ats].fields[key]);
    if (element && setNativeValue(element, value)) filled.push(key);
  }
  return filled;
}

function fillByLabel(candidate) {
  const rules = [
    [/^address line 1|required address line 1/i, candidate.addressLine1],
    [/^address line 2/i, candidate.addressLine2],
    [/^city\b/i, candidate.city],
    [/state|province|territory/i, candidate.region],
    [/zip|postal code/i, candidate.postalCode],
    [/minimum salary|salary requirement/i, candidate.minimumSalary],
  ];
  const filled = [];
  for (const element of document.querySelectorAll("input:not([type='hidden']):not([type='file']):not([type='radio']):not([type='checkbox']), textarea")) {
    if (!visible(element) || String(element.value || "").trim()) continue;
    const label = fieldLabel(element);
    const rule = rules.find(([pattern, value]) => value !== undefined && value !== null && value !== "" && pattern.test(label));
    if (rule && setNativeValue(element, rule[1])) filled.push(label);
  }
  return filled;
}

function normalizeText(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function matchScore(actual, wanted) {
  const a = normalizeText(actual); const w = normalizeText(wanted);
  if (!a || !w) return 0;
  if (a === w) return 100;
  if (a.includes(w) || w.includes(a)) return 80;
  const aWords = new Set(a.split(" ")); const wWords = new Set(w.split(" "));
  const overlap = [...wWords].filter((word) => aWords.has(word)).length;
  return Math.round((overlap / Math.max(aWords.size, wWords.size)) * 70);
}

function referencedText(element, attribute) {
  return String(element.getAttribute(attribute) || "").split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ").trim();
}

function questionText(container, control) {
  const choiceControl = control?.matches?.("input[type='radio'], input[type='checkbox'], [role='radio']");
  const direct = (!choiceControl && control?.labels?.[0]?.textContent)
    || (!choiceControl && referencedText(control || container, "aria-labelledby"))
    || (!choiceControl && control?.getAttribute("aria-label"))
    || container.querySelector("legend, [class*='question-title' i], [class*='question-label' i], label:not(:has(input[type='radio']))")?.textContent
    || container.getAttribute("aria-label")
    || "";
  return direct.trim();
}

function controlContainer(control, type) {
  const explicit = control.closest("fieldset, [role='radiogroup'], .application-question, [data-testid*='question' i]");
  if (explicit) return explicit;
  let node = control.parentElement;
  for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
    const labels = node.querySelectorAll("label, legend, [class*='label' i]").length;
    const radios = node.querySelectorAll("input[type='radio'], [role='radio']").length;
    const dropdowns = node.querySelectorAll("select, [role='combobox'], [aria-haspopup='listbox']").length;
    if (labels && ((type === "radio" && radios >= 2) || (type === "dropdown" && dropdowns === 1))) return node;
  }
  return control.parentElement;
}

function explicitAnswer(question, answers = {}) {
  let best; let score = 0;
  for (const [candidateQuestion, answer] of Object.entries(answers)) {
    const candidateScore = matchScore(candidateQuestion, question);
    if (candidateScore > score) { score = candidateScore; best = answer; }
  }
  return score >= 55 ? best : undefined;
}

function answerForQuestion(question, candidate) {
  const direct = explicitAnswer(question, candidate.applicationAnswers);
  if (direct !== undefined) return String(direct);
  if (/u\.?s\.? citizen|citizenship/i.test(question) && candidate.citizenship !== undefined) {
    if (typeof candidate.citizenship === "boolean") return candidate.citizenship ? "Yes" : "No";
    const value = normalizeText(candidate.citizenship);
    return /not a citizen|non citizen|no/.test(value) ? "No" : /citizen|yes/.test(value) ? "Yes" : String(candidate.citizenship);
  }
  if (/security clearance|ts\/?sci|clearance/i.test(question) && candidate.securityClearance !== undefined) {
    if (typeof candidate.securityClearance === "boolean") return candidate.securityClearance ? "Yes" : "No";
    const value = normalizeText(candidate.securityClearance);
    return /none|no clearance|not active|no/.test(value) ? "No" : "Yes";
  }
  const rules = [
    [/authorized|authorised|legally eligible|right to work/i, candidate.authorizedToWork],
    [/require.*sponsorship|need.*sponsorship|visa sponsorship/i, candidate.requiresSponsorship],
    [/willing to relocate/i, candidate.willingToRelocate],
    [/background check/i, candidate.backgroundCheckConsent],
    [/commute|work from.*campus|on.?site|onsite/i, candidate.canCommute],
    [/^country\b/i, candidate.country],
    [/^gender\b/i, candidate.gender],
    [/hispanic|latino/i, candidate.hispanicLatino],
    [/veteran status|protected veteran/i, candidate.veteranStatus],
    [/disability status|have a disability/i, candidate.disabilityStatus],
  ];
  const rule = rules.find(([pattern, value]) => value !== undefined && value !== null && pattern.test(question));
  if (!rule) return undefined;
  if (typeof rule[1] === "boolean") return rule[1] ? "Yes" : "No";
  return String(rule[1]);
}

function chooseNative(select, answer) {
  const option = [...select.options].map((item) => ({ item, score: Math.max(matchScore(item.text, answer), matchScore(item.value, answer)) }))
    .sort((left, right) => right.score - left.score)[0];
  if (!option || option.score < 55) return false;
  select.value = option.item.value;
  ["input", "change", "blur"].forEach((name) => select.dispatchEvent(new Event(name, { bubbles: true })));
  return true;
}

async function chooseClickable(container, answer) {
  const choices = [...container.querySelectorAll("input[type='radio'], input[type='checkbox'], button, [role='radio'], [role='option'], [role='button']")];
  const best = choices.map((item) => ({ item, score: Math.max(matchScore(item.labels?.[0]?.textContent, answer), matchScore(item.value, answer), matchScore(item.textContent, answer), matchScore(item.getAttribute("aria-label"), answer)) }))
    .sort((left, right) => right.score - left.score)[0];
  if (!best || best.score < 55) return false;
  best.item.scrollIntoView({ block: "center" }); best.item.click();
  ["input", "change"].forEach((name) => best.item.dispatchEvent(new Event(name, { bubbles: true })));
  await sleep(100);
  return best.item.checked === true || best.item.getAttribute("aria-checked") === "true"
    || best.item.getAttribute("aria-pressed") === "true" || best.item.matches(":checked");
}

function popupOptions(control) {
  const ownedIds = [control.getAttribute("aria-controls"), control.getAttribute("aria-owns")].filter(Boolean);
  const owned = ownedIds.flatMap((id) => [...(document.getElementById(id)?.querySelectorAll("[role='option'], [role='menuitem'], li, button, [data-value]") || [])]);
  const global = [...document.querySelectorAll("[role='option'], [role='menuitem'], [role='listbox'] li, [role='menu'] li, .select__option, .react-select__option, .ant-select-item-option, [data-value], [data-testid*='option' i], [id*='option' i]")];
  return [...new Set([...owned, ...global])].filter((item) => visible(item) && normalizeText(item.textContent));
}

function dropdownShows(control, answer) {
  const text = control instanceof HTMLInputElement ? control.value : control.textContent;
  if (matchScore(text, answer) >= 55) return true;
  const selected = document.querySelector("[role='option'][aria-selected='true'], [role='menuitem'][aria-selected='true']");
  return Boolean(selected && matchScore(selected.textContent, answer) >= 55);
}

async function chooseCustomDropdown(container, answer, suppliedControl) {
  const control = suppliedControl || [...container.querySelectorAll("[role='combobox'], [aria-haspopup='listbox'], .select__control, .react-select__control, .ant-select-selector, button")]
    .find((item) => visible(item) && (/select|choose/i.test(item.textContent || "") || item.getAttribute("role") === "combobox" || item.getAttribute("aria-haspopup") === "listbox"));
  if (!control) return false;
  if (dropdownShows(control, answer)) return true;
  control.scrollIntoView({ block: "center" }); control.focus(); control.click();
  let options = [];
  for (let attempt = 0; attempt < 10 && !options.length; attempt += 1) { await sleep(100); options = popupOptions(control); }
  const best = options.map((item) => ({ item, score: Math.max(matchScore(item.textContent, answer), matchScore(item.getAttribute("aria-label"), answer)) }))
    .sort((left, right) => right.score - left.score)[0];
  if (best && best.score >= 55) {
    best.item.scrollIntoView({ block: "nearest" }); best.item.click(); await sleep(200);
    if (dropdownShows(control, answer) || best.item.getAttribute("aria-selected") === "true") return true;
  }
  // React-select and several Greenhouse controls support type-to-select even
  // when their portal options do not expose stable option classes.
  control.focus();
  if (control instanceof HTMLInputElement) {
    setNativeValue(control, answer); await sleep(150);
  } else {
    for (const character of String(answer)) control.dispatchEvent(new KeyboardEvent("keydown", { key: character, bubbles: true }));
  }
  control.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", bubbles: true }));
  control.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
  await sleep(250);
  if (dropdownShows(control, answer)) return true;
  control.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
  return false;
}

async function answerApplicationQuestions(candidate) {
  const answered = []; const unresolved = [];
  const processedRadioGroups = new Set();
  for (const radio of document.querySelectorAll("input[type='radio'], [role='radio']")) {
    if (!visible(radio)) continue;
    const groupKey = radio.name || radio.closest("[role='radiogroup'], fieldset") || radio;
    if (processedRadioGroups.has(groupKey)) continue;
    processedRadioGroups.add(groupKey);
    const container = controlContainer(radio, "radio");
    const question = questionText(container, radio); const answer = answerForQuestion(question, candidate);
    if (answer === undefined) continue;
    const ok = await chooseClickable(container, answer);
    (ok ? answered : unresolved).push(question.slice(0, 140));
  }
  const controls = [...document.querySelectorAll("select, [role='combobox'], [aria-haspopup='listbox'], .select__control, .react-select__control, .ant-select-selector")]
    .filter((control) => visible(control) && !control.parentElement?.closest("[role='combobox'], [aria-haspopup='listbox'], .select__control, .react-select__control, .ant-select-selector"));
  for (const control of controls) {
    const container = controlContainer(control, "dropdown");
    const question = questionText(container, control); const answer = answerForQuestion(question, candidate);
    if (answer === undefined) continue;
    const ok = control.tagName === "SELECT" ? chooseNative(control, answer) : await chooseCustomDropdown(container, answer, control);
    (ok ? answered : unresolved).push(question.slice(0, 140));
  }
  return { answered, unresolved };
}

function acceptApprovedConsents(candidate) {
  if (candidate.consentToTerms !== true) return [];
  const checked = [];
  for (const input of document.querySelectorAll("input[type='checkbox'][required]")) {
    const text = fieldLabel(input);
    if (/consent|agree|acknowledge|privacy policy|terms/i.test(text) && !input.checked) {
      input.click(); checked.push(text);
    }
  }
  return checked;
}

function decodeResume(stored) {
  const [header, encoded] = stored.dataUrl.split(",", 2);
  const mime = header.match(/data:([^;]+)/)?.[1] || stored.type || "application/pdf";
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], stored.name, { type: mime });
}

function uploadResume(ats, stored) {
  const input = first(ATS[ats].resume);
  if (!input) return false;
  const transfer = new DataTransfer();
  transfer.items.add(decodeResume(stored));
  input.files = transfer.files;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return input.files?.length === 1;
}

function fieldLabel(element) {
  return element.labels?.[0]?.innerText?.trim()
    || document.querySelector(`label[for='${CSS.escape(element.id || "__none")}']`)?.textContent?.trim()
    || element.getAttribute("aria-label") || element.name || element.id || "Unknown required field";
}

function hasValue(element) {
  if (["checkbox", "radio"].includes(element.type)) {
    if (element.type === "radio" && element.name) return Boolean(document.querySelector(`input[type='radio'][name='${CSS.escape(element.name)}']:checked`));
    return element.checked;
  }
  if (element.type === "file") return Boolean(element.files?.length);
  return String(element.value || "").trim() !== "";
}

function requiredMissing() {
  const candidates = [...document.querySelectorAll("input[required], textarea[required], select[required], [aria-required='true']")]
    .filter((element) => visible(element) && !element.disabled);
  return [...new Set(candidates.filter((element) => !hasValue(element)).map(fieldLabel))];
}

function hasCaptcha() {
  return Boolean(document.querySelector("iframe[src*='recaptcha'], iframe[src*='hcaptcha'], .g-recaptcha, .h-captcha, [class*='captcha' i], [id*='captcha' i]"));
}

function visibleValidationErrors() {
  return [...document.querySelectorAll("[role='alert'], .field-error, .error-message, .validation-error")]
    .filter(visible).map((element) => element.textContent?.trim()).filter(Boolean);
}

async function report(applicationId, status, detail = {}) {
  return chrome.runtime.sendMessage({ type: "TALENTSCREEN_EVENT", applicationId, status, detail });
}

async function confirmationDetected(ats, previousUrl) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(500);
    const text = document.body.innerText;
    const successText = /application (has been )?(submitted|received)|thank you for applying|thanks for applying/i.test(text);
    const urlChanged = location.href !== previousUrl;
    const submitGone = !first(ATS[ats].submit);
    if (successText || (urlChanged && submitGone)) return { confirmed: true, url: location.href };
    if (visibleValidationErrors().length) return { confirmed: false, errors: visibleValidationErrors() };
  }
  return { confirmed: false, errors: ["Submission confirmation was not detected"] };
}

async function run(payload) {
  if (runState.running) return;
  runState.running = true;
  const { applicationId, candidate, resumeFile } = payload;
  try {
    const ats = detectAts();
    if (!ats) throw new Error("Unsupported ATS");
    const formReady = await findOrOpenForm(ats, applicationId);
    if (!formReady) return;
    await report(applicationId, "filling", { ats });
    const filledFields = fillKnownFields(ats, candidate);
    const semanticFields = fillByLabel(candidate);
    const questionResults = await answerApplicationQuestions(candidate);
    const acceptedConsents = acceptApprovedConsents(candidate);
    const resumeUploaded = uploadResume(ats, resumeFile);
    await sleep(800);
    await report(applicationId, "validating", { filledFields, semanticFields, questionResults, acceptedConsents, resumeUploaded });
    if (hasCaptcha()) return report(applicationId, "captcha_detected", { message: "Automatic submission stopped" });
    const missingFields = [...new Set([...requiredMissing(), ...questionResults.unresolved])];
    if (missingFields.length) return report(applicationId, "unsupported_question", { missingFields });
    const submit = first(ATS[ats].submit);
    if (!submit || submit.disabled || submit.getAttribute("aria-disabled") === "true") throw new Error("Enabled submit button was not found");
    await report(applicationId, "submitting");
    const previousUrl = location.href;
    submit.click();
    const confirmation = await confirmationDetected(ats, previousUrl);
    if (!confirmation.confirmed) return report(applicationId, "failed", confirmation);
    await report(applicationId, "submitted", confirmation);
  } catch (error) {
    await report(applicationId, "failed", { message: error.message });
  } finally {
    runState.running = false;
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "TALENTSCREEN_START") run(message.payload);
});

chrome.runtime.sendMessage({ type: "TALENTSCREEN_PAGE_READY", url: location.href });
