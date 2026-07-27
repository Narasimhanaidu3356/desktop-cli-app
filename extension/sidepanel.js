const byId = (id) => document.getElementById(id);
let profile = null;
let resumeFile = null;

function pick(obj, paths) {
  for (const path of paths) {
    const value = path.split(".").reduce((current, key) => current?.[key], obj);
    if (value !== undefined && value !== null && value !== "") return value;
  }
}

function normalizeResume(json) {
  const basics = json.basics || json.personal || json;
  const location = basics.location || {};
  const address = json.address || json.personal?.address || (typeof location === "object" ? location : {});
  const locationAddress = pick(json, ["basics.location.address", "personal.address"]);
  const locationParts = typeof locationAddress === "string" ? locationAddress.split(",").map((part) => part.trim()) : [];
  const parsedRegion = locationParts.length > 1 ? locationParts.at(-1) : undefined;
  const usStateCodes = new Set(["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"]);
  const profiles = Array.isArray(basics.profiles) ? basics.profiles : [];
  const linkedin = profiles.find((item) => String(item.network || "").toLowerCase().includes("linkedin"));
  const portfolio = profiles.find((item) => !String(item.network || "").toLowerCase().includes("linkedin"));
  const firstName = pick(json, ["personal.firstName", "personal.first_name", "firstName", "first_name"]);
  const lastName = pick(json, ["personal.lastName", "personal.last_name", "lastName", "last_name"]);
  const fullName = pick(json, ["basics.name", "personal.fullName", "personal.full_name", "fullName", "full_name", "name"])
    || [firstName, lastName].filter(Boolean).join(" ");
  const rawAnswers = pick(json, ["applicationAnswers", "questionAnswers", "eligibility.applicationAnswers"]);
  const applicationAnswers = Array.isArray(rawAnswers)
    ? rawAnswers.reduce((answers, item) => {
        if (item?.question && item.answer !== undefined) answers[item.question] = item.answer;
        return answers;
      }, {})
    : (rawAnswers && typeof rawAnswers === "object" ? rawAnswers : {});
  if (!fullName || !pick(json, ["basics.email", "personal.email", "email"])) throw new Error("JSON Resume must contain a candidate name and email");
  return {
    fullName,
    firstName: firstName || String(fullName).split(" ")[0],
    lastName: lastName || String(fullName).split(" ").slice(1).join(" "),
    email: pick(json, ["basics.email", "personal.email", "email"]),
    phone: pick(json, ["basics.phone", "personal.phone", "phone"]),
    location: typeof location === "string" ? location : [location.city, location.region, location.countryCode || location.country].filter(Boolean).join(", ")
      || [json.personal?.city, json.personal?.state, json.personal?.country].filter(Boolean).join(", "),
    addressLine1: typeof address === "string" ? address : pick(json, ["basics.location.address", "personal.address_line_1", "personal.address", "address.line1", "address.addressLine1"]),
    addressLine2: pick(json, ["personal.address_line_2", "address.line2", "address.addressLine2"]),
    city: pick(json, ["basics.location.city", "personal.city", "address.city", "city"]) || (locationParts.length > 1 ? locationParts[0] : undefined),
    region: pick(json, ["basics.location.region", "personal.state", "personal.region", "address.state", "address.region", "state", "region"]) || parsedRegion,
    postalCode: pick(json, ["basics.location.postalCode", "personal.zip_code", "personal.postal_code", "address.zipCode", "address.postalCode", "zipCode", "postalCode"]),
    country: pick(json, ["basics.location.country", "basics.location.countryCode", "personal.country", "address.country", "country"]) || (usStateCodes.has(String(parsedRegion || "").toUpperCase()) ? "United States" : undefined),
    currentCompany: pick(json, ["work.0.name", "work.0.company", "professional.currentCompany", "currentCompany"]),
    currentTitle: pick(json, ["work.0.position", "professional.currentTitle", "currentTitle"]),
    linkedinUrl: pick(json, ["basics.url", "basics.website", "professional.linkedinUrl", "linkedinUrl"]) || linkedin?.url,
    portfolioUrl: pick(json, ["professional.portfolioUrl", "portfolioUrl"]) || portfolio?.url,
    authorizedToWork: pick(json, ["eligibility.authorizedToWork", "work_authorization.authorized_to_work", "authorizedToWork", "authorized_to_work"]),
    requiresSponsorship: pick(json, ["eligibility.requiresSponsorship", "work_authorization.require_sponsorship", "requiresSponsorship", "require_sponsorship"]),
    willingToRelocate: pick(json, ["eligibility.willingToRelocate", "willingToRelocate"]),
    citizenship: pick(json, ["eligibility.citizenship", "work_authorization.visa_status", "personal.citizenship", "citizenship", "visa_status"]),
    securityClearance: pick(json, ["eligibility.securityClearance", "eligibility.security_clearance", "eligibility.clearance", "securityClearance", "security_clearance", "clearance"]),
    minimumSalary: pick(json, ["preferences.minimumSalary", "preferences.minimum_salary", "minimumSalary", "minimum_salary", "salaryRequirement", "salary_requirement"]),
    backgroundCheckConsent: pick(json, ["eligibility.backgroundCheckConsent", "eligibility.background_check_consent", "backgroundCheckConsent", "background_check_consent"]),
    canCommute: pick(json, ["preferences.canCommute", "preferences.can_commute", "canCommute", "can_commute"]),
    gender: pick(json, ["demographics.gender", "gender"]),
    hispanicLatino: pick(json, ["demographics.hispanicLatino", "demographics.hispanic_latino", "hispanicLatino", "hispanic_latino"]),
    veteranStatus: pick(json, ["demographics.veteranStatus", "demographics.veteran_status", "veteranStatus", "veteran_status"]),
    disabilityStatus: pick(json, ["demographics.disabilityStatus", "demographics.disability_status", "disabilityStatus", "disability_status"]),
    applicationAnswers,
    consentToTerms: pick(json, ["consents.autoAccept", "consentToTerms"]),
  };
}

function fileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, type: file.type || "application/pdf", dataUrl: reader.result });
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function refresh() {
  const ready = Boolean(profile && resumeFile);
  byId("toggle").disabled = !ready;
  byId("profile").hidden = !profile;
  if (profile) {
    byId("candidateName").textContent = profile.fullName;
    byId("candidateEmail").textContent = profile.email;
    byId("initials").textContent = profile.fullName.split(" ").map((part) => part[0]).slice(0,2).join("").toUpperCase();
  }
}

byId("jsonFile").addEventListener("change", async (event) => {
  try {
    const file = event.target.files[0];
    profile = normalizeResume(JSON.parse(await file.text()));
    await chrome.storage.local.set({ candidateProfile: profile });
    byId("jsonName").textContent = file.name; byId("jsonReady").textContent = "Ready"; byId("message").textContent = "";
    refresh();
  } catch (error) { byId("message").textContent = error.message; }
});

byId("pdfFile").addEventListener("change", async (event) => {
  try {
    const file = event.target.files[0];
    if (!file || file.type !== "application/pdf") throw new Error("Please choose a PDF resume");
    resumeFile = await fileAsDataUrl(file);
    await chrome.storage.local.set({ resumeFile });
    byId("pdfName").textContent = file.name; byId("pdfReady").textContent = "Ready"; byId("message").textContent = "";
    refresh();
  } catch (error) { byId("message").textContent = error.message; }
});

byId("toggle").addEventListener("click", async () => {
  const { automationEnabled } = await chrome.storage.local.get("automationEnabled");
  await chrome.storage.local.set({ automationEnabled: !automationEnabled });
  renderEnabled(!automationEnabled);
});

function renderEnabled(enabled) {
  byId("toggle").textContent = enabled ? "Disable full automation" : "Enable full automation";
  byId("toggle").classList.toggle("enabled", enabled);
}

function renderActivity(event) {
  if (!event) return;
  const dot = byId("activity").querySelector("i");
  const label = byId("activity").querySelector("span");
  const status = String(event.status || "").replaceAll("_", " ");
  label.textContent = status.charAt(0).toUpperCase() + status.slice(1);
  dot.className = event.status === "submitted" ? "success" : ["failed","captcha_detected","unsupported_question"].includes(event.status) ? "error" : "active";
}

chrome.storage.onChanged.addListener((changes) => { if (changes.lastAutomationEvent) renderActivity(changes.lastAutomationEvent.newValue); });
chrome.storage.local.get(["candidateProfile", "resumeFile", "automationEnabled", "lastAutomationEvent"]).then((saved) => {
  profile = saved.candidateProfile || null; resumeFile = saved.resumeFile || null;
  if (profile) { byId("jsonName").textContent = "Stored JSON Resume"; byId("jsonReady").textContent = "Ready"; }
  if (resumeFile) { byId("pdfName").textContent = resumeFile.name; byId("pdfReady").textContent = "Ready"; }
  renderEnabled(Boolean(saved.automationEnabled)); renderActivity(saved.lastAutomationEvent); refresh();
});
