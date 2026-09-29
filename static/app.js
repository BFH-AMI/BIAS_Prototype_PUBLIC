(function () {
  const STORAGE_KEY = "bias_webtool_config_v1";
  const H2H_STATE_KEY = "bias_h2h_state_v1";
  const H2H_CANDIDATES_KEY = "bias_h2h_candidates_v1";
  const H2H_CANDIDATE_CATALOG_KEY = "bias_h2h_candidate_catalog_v1";
  const LLM_SELECTION_CACHE_KEY = "bias_llm_selection_cache_v1";
  const PRESELECTION_STATE_KEY = "bias_preselection_stage_v1";
  const CANDIDATE_RATINGS_KEY = "bias_candidate_ratings_stage_v1";
  const CANDIDATE_RATINGS_BACKUP_KEY = "bias_candidate_ratings_stage_v1_backup";
  const USER_FEEDBACK_STORAGE_KEY = "bias_user_feedback_questionnaire_v1";
  const USER_FEEDBACK_CONFIRMATION_KEY = "bias_user_feedback_confirmation_v1";
  const WORKFLOW_SESSION_KEY = "bias_workflow_session_id_v1";
  const WORKFLOW_SESSIONS_INDEX_KEY = "bias_workflow_sessions_index_v1";
  const WORKFLOW_SESSION_PROMPT_SEEN_KEY = "bias_workflow_session_prompt_seen_v1";
  const H2H_SCROLL_TOP_KEY = "bias_h2h_scroll_top_once";
  const CONFIG_VERSION = 3;
  const H2H_POOL_SIZE = 10;
  const H2H_CACHE_VERSION = 5;
  const CANDIDATE_ALIAS_FIRST_NAMES = [
    "Amber",
    "Azure",
    "Blue",
    "Bronze",
    "Coral",
    "Crimson",
    "Cyan",
    "Gold",
    "Green",
    "Indigo",
    "Ivory",
    "Jade",
    "Lilac",
    "Magenta",
    "Maroon",
    "Mint",
    "Ochre",
    "Olive",
    "Onyx",
    "Rose",
    "Ruby",
    "Saffron",
    "Sage",
    "Scarlet",
    "Silver",
    "Slate",
    "Teal",
    "Turquoise",
    "Umber",
    "Violet",
  ];
  const CANDIDATE_ALIAS_LAST_NAMES = [
    "Alder",
    "Ash",
    "Aspen",
    "Beech",
    "Birch",
    "Cedar",
    "Cherry",
    "Cypress",
    "Elm",
    "Fir",
    "Hazel",
    "Holly",
    "Juniper",
    "Larch",
    "Linden",
    "Maple",
    "Oak",
    "Olive",
    "Pine",
    "Poplar",
    "Redwood",
    "Rowan",
    "Sequoia",
    "Spruce",
    "Sycamore",
    "Walnut",
    "Willow",
    "Yew",
  ];
  const USER_FEEDBACK_LIKERT_ITEMS = [
    { key: "functionality", prompt: "The tool functions worked reliably across the workflow." },
    { key: "design", prompt: "The interface layout and visual design made the workflow easy to follow." },
    { key: "usefulness", prompt: "The tool added useful information beyond my normal evaluation process." },
    { key: "decision_confidence", prompt: "The tool improved my confidence in the final ranking or selection decision." },
    { key: "fairness_support", prompt: "The tool helped me reflect on fairness, bias, or consistency risks." },
    { key: "transparency", prompt: "The explanations, summaries, and audit outputs were transparent enough to trust." },
    { key: "efficiency", prompt: "The tool made the evaluation process more efficient overall." },
    { key: "future_use", prompt: "I would be willing to use this tool again in a future user evaluation." },
  ];
  const WORKFLOW_NAV_ITEMS = [
    { key: "overview", href: "/", label: "1. System Overview" },
    { key: "config", href: "/config", label: "2. Configure" },
    { key: "preselection", href: "/preselection", label: "3. Initial Screening" },
    { key: "model-snapshot", href: "/model-snapshot", label: "4. Selection Pool" },
    { key: "head-to-head", href: "/head-to-head", label: "5. Head-to-Head" },
    { key: "top-candidates", href: "/top-candidates", label: "6. Top Candidates" },
    { key: "candidate-ratings", href: "/candidate-ratings", label: "7. Candidate Ratings" },
    { key: "ratings-audits", href: "/ratings-audits", label: "8. Ratings And Audits" },
    { key: "feedback-questionnaire", href: "/feedback-questionnaire", label: "9. User Feedback" },
  ];

  const SESSION_SCOPED_STORAGE_KEYS = [
    STORAGE_KEY,
    H2H_STATE_KEY,
    H2H_CANDIDATES_KEY,
    H2H_CANDIDATE_CATALOG_KEY,
    LLM_SELECTION_CACHE_KEY,
    PRESELECTION_STATE_KEY,
    CANDIDATE_RATINGS_KEY,
    CANDIDATE_RATINGS_BACKUP_KEY,
    USER_FEEDBACK_STORAGE_KEY,
  ];

  let activeWorkflowSessionId = "";
  let workflowSessionReadyPromise = null;

  const SUBFEATURE_OPTIONS = {
    education: [
      "highest_degree_completed",
      "gpa_normalized_0_100",
      "master_thesis_grade_normalized_0_100",
      "bachelor_field",
      "master_field",
    ],
    experience: [
      "years_research_experience",
      "years_relevant_professional_experience",
      "years_teaching_experience",
      "career_gap_months",
      "time_since_last_academic_activity_months",
    ],
    research_outputs: [
      "num_peer_reviewed_publications",
      "num_first_author_publications",
      "num_conference_outputs",
      "num_posters_or_extended_abstracts",
      "has_independent_research_output",
    ],
    skills_and_methods: [
      "has_quantitative_methods",
      "has_qualitative_methods",
      "has_programming_or_technical_skills",
      "num_programming_languages",
      "has_experimental_or_empirical_design",
      "english_level",
      "local_language_level",
    ],
  };

  function initializeWorkflowNav() {
    const navs = document.querySelectorAll("[data-workflow-nav]");
    if (!navs.length) return;

    navs.forEach((nav) => {
      const activeKey = String(nav.getAttribute("data-active") || "").trim();
      nav.classList.add("nav");
      nav.innerHTML = WORKFLOW_NAV_ITEMS.map((item) => {
        const activeClass = item.key === activeKey ? ' class="active"' : "";
        return `<a${activeClass} href="${item.href}">${item.label}</a>`;
      }).join("");
    });
  }

  initializeWorkflowNav();

  function createWorkflowSessionId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
    return `workflow-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function loadWorkflowSessionsIndex() {
    try {
      const raw = localStorage.getItem(WORKFLOW_SESSIONS_INDEX_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      const sessions = parsed && parsed.sessions && typeof parsed.sessions === "object"
        ? parsed.sessions
        : {};
      return { sessions };
    } catch {
      return { sessions: {} };
    }
  }

  function saveWorkflowSessionsIndex(index) {
    try {
      const sessions = index && index.sessions && typeof index.sessions === "object"
        ? index.sessions
        : {};
      localStorage.setItem(WORKFLOW_SESSIONS_INDEX_KEY, JSON.stringify({ sessions }));
    } catch {
      // Ignore storage errors.
    }
  }

  function touchWorkflowSessionRecord(sessionId) {
    const sid = String(sessionId || "").trim();
    if (!sid) return;
    const index = loadWorkflowSessionsIndex();
    const now = new Date().toISOString();
    const existing = index.sessions[sid] && typeof index.sessions[sid] === "object"
      ? index.sessions[sid]
      : {};
    index.sessions[sid] = {
      created_at: String(existing.created_at || now),
      last_seen_at: now,
    };
    saveWorkflowSessionsIndex(index);
  }

  function makeSessionScopedStorageKey(baseKey, sessionId = "") {
    const sid = String(sessionId || activeWorkflowSessionId || "").trim();
    return sid ? `${String(baseKey || "")}::${sid}` : String(baseKey || "");
  }

  function getSessionStorageItem(baseKey) {
    try {
      const scopedKey = makeSessionScopedStorageKey(baseKey, getWorkflowSessionId());
      const scopedValue = localStorage.getItem(scopedKey);
      if (scopedValue !== null) return scopedValue;

      // One-time migration fallback from legacy non-scoped keys.
      const legacyValue = localStorage.getItem(baseKey);
      if (legacyValue !== null) {
        localStorage.setItem(scopedKey, legacyValue);
        localStorage.removeItem(baseKey);
      }
      return legacyValue;
    } catch {
      return null;
    }
  }

  function setSessionStorageItem(baseKey, value) {
    try {
      const scopedKey = makeSessionScopedStorageKey(baseKey, getWorkflowSessionId());
      localStorage.setItem(scopedKey, String(value));
      localStorage.removeItem(baseKey);
    } catch {
      // Ignore storage errors.
    }
  }

  function removeSessionStorageItem(baseKey) {
    try {
      const scopedKey = makeSessionScopedStorageKey(baseKey, getWorkflowSessionId());
      localStorage.removeItem(scopedKey);
      localStorage.removeItem(baseKey);
    } catch {
      // Ignore storage errors.
    }
  }

  function initializeWorkflowSession() {
    try {
      const current = String(localStorage.getItem(WORKFLOW_SESSION_KEY) || "").trim();

      if (current) {
        activeWorkflowSessionId = current;
        touchWorkflowSessionRecord(current);
        return;
      }

      const next = createWorkflowSessionId();
      localStorage.setItem(WORKFLOW_SESSION_KEY, next);
      activeWorkflowSessionId = next;
      touchWorkflowSessionRecord(next);

      // First-time bootstrap cleanup for legacy non-scoped caches.
      SESSION_SCOPED_STORAGE_KEYS.forEach((key) => {
        localStorage.removeItem(key);
      });
    } catch {
      activeWorkflowSessionId = createWorkflowSessionId();
    }
  }

  function promptWorkflowSessionChoice(existingSessionId) {
    return new Promise((resolve) => {
      if (!document.body) {
        resolve(window.confirm("A previous session was found. Continue it?"));
        return;
      }

      const overlay = document.createElement("div");
      overlay.style.position = "fixed";
      overlay.style.inset = "0";
      overlay.style.zIndex = "10000";
      overlay.style.display = "grid";
      overlay.style.placeItems = "center";
      overlay.style.background = "rgba(14, 20, 24, 0.45)";

      const dialog = document.createElement("div");
      dialog.style.width = "min(560px, calc(100vw - 28px))";
      dialog.style.background = "#fffdf8";
      dialog.style.borderRadius = "14px";
      dialog.style.border = "1px solid rgba(30, 42, 47, 0.18)";
      dialog.style.boxShadow = "0 18px 44px rgba(22, 30, 36, 0.28)";
      dialog.style.padding = "18px";
      dialog.style.fontFamily = '"Space Grotesk", "Avenir Next", "Segoe UI", sans-serif';
      dialog.style.color = "#1e2a2f";

      const heading = document.createElement("h3");
      heading.textContent = "Continue Previous Session?";
      heading.style.margin = "0 0 10px";

      const body = document.createElement("p");
      body.style.margin = "0 0 12px";
      body.style.lineHeight = "1.5";
      body.textContent = "A previous workflow session was found for this browser. Continue that session, or start a new one with clean state.";

      const sid = document.createElement("p");
      sid.style.margin = "0 0 14px";
      sid.style.fontSize = "0.9rem";
      sid.style.color = "#4f676f";
      sid.textContent = `Previous session ID: ${String(existingSessionId || "")}`;

      const actions = document.createElement("div");
      actions.style.display = "flex";
      actions.style.justifyContent = "flex-end";
      actions.style.gap = "10px";

      const newBtn = document.createElement("button");
      newBtn.type = "button";
      newBtn.textContent = "Start New Session";
      newBtn.className = "btn secondary";

      const continueBtn = document.createElement("button");
      continueBtn.type = "button";
      continueBtn.textContent = "Continue Previous";
      continueBtn.className = "btn primary";

      actions.append(newBtn, continueBtn);
      dialog.append(heading, body, sid, actions);
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      const finish = (keepPrevious) => {
        overlay.remove();
        resolve(Boolean(keepPrevious));
      };

      continueBtn.addEventListener("click", () => finish(true));
      newBtn.addEventListener("click", () => finish(false));
    });
  }

  async function ensureWorkflowSessionReady() {
    if (workflowSessionReadyPromise) return workflowSessionReadyPromise;

    workflowSessionReadyPromise = (async () => {
      initializeWorkflowSession();
      try {
        const current = String(localStorage.getItem(WORKFLOW_SESSION_KEY) || "").trim();
        const promptSeen = String(sessionStorage.getItem(WORKFLOW_SESSION_PROMPT_SEEN_KEY) || "") === "1";
        if (!current) {
          sessionStorage.setItem(WORKFLOW_SESSION_PROMPT_SEEN_KEY, "1");
          return;
        }

        if (promptSeen) {
          touchWorkflowSessionRecord(current);
          return;
        }

        const keepPrevious = await promptWorkflowSessionChoice(current);
        let next = current;
        if (!keepPrevious) {
          next = createWorkflowSessionId();
          localStorage.setItem(WORKFLOW_SESSION_KEY, next);
        }
        activeWorkflowSessionId = next;
        touchWorkflowSessionRecord(next);
        sessionStorage.setItem(WORKFLOW_SESSION_PROMPT_SEEN_KEY, "1");
      } catch {
        // Fall back to current active session.
      }
    })();

    return workflowSessionReadyPromise;
  }

  initializeWorkflowSession();

  function getWorkflowSessionId() {
    if (String(activeWorkflowSessionId || "").trim()) return String(activeWorkflowSessionId || "").trim();
    initializeWorkflowSession();
    if (String(activeWorkflowSessionId || "").trim()) return String(activeWorkflowSessionId || "").trim();
    return createWorkflowSessionId();
  }

  function defaultSelectedSubfeatures() {
    const defaults = {};
    Object.entries(SUBFEATURE_OPTIONS).forEach(([category, keys]) => {
      defaults[category] = keys.slice();
    });
    return defaults;
  }

  function defaultConfig() {
    return {
      config_version: CONFIG_VERSION,
      evaluator_mode: "cbr",
      initial_screening: {
        requirements: [],
        excluded_candidate_ids: [],
        model: "gpt-5.4-mini",
        prompt_path: "prompts/eval_agents/pre-screening.txt",
        additional_instructions: "",
      },
      h2h_eta: 0.1,
      cbr_weights: {
        education: 0.24,
        experience: 0.28,
        research_outputs: 0.22,
        skills_and_methods: 0.26,
      },
      education_backgrounds: {
        preferred: [
          "Science and Technology Studies (STS)",
          "Sociology",
          "History",
          "Geography",
          "Political science",
          "Philosophy",
          "Media Studies",
        ],
        acceptable: [],
      },
      selected_subfeatures: {
        ...defaultSelectedSubfeatures(),
        skills_and_methods: [
          "has_quantitative_methods",
          "has_qualitative_methods",
          "has_experimental_or_empirical_design",
          "english_level",
          "local_language_level",
        ],
      },
      llm_evaluator: {
        model: "gpt-5.4-mini",
        additional_instructions: "",
      },
      fairness_assistant: {
        model: "gpt-5.4-mini",
        additional_instructions: "",
      },
      ntnu_assistant: {
        model: "gpt-5.4-mini",
        additional_instructions: "",
      },
    };
  }

  function normalizeBackgroundEntries(backgrounds) {
    const source = backgrounds && typeof backgrounds === "object" ? backgrounds : {};
    const preferred = Array.isArray(source.preferred) ? source.preferred : [];
    const acceptable = Array.isArray(source.acceptable) ? source.acceptable : [];
    const entries = [];
    const seen = new Set();

    preferred.forEach((value) => {
      const text = String(value || "").trim();
      if (!text) return;
      const key = text.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      entries.push({ text, role: "preferred" });
    });

    acceptable.forEach((value) => {
      const text = String(value || "").trim();
      if (!text) return;
      const key = text.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      entries.push({ text, role: "acceptable" });
    });

    return entries;
  }

  function buildBackgroundEntryRow(entry = {}) {
    const row = document.createElement("tr");
    row.className = "background-entry-row";

    const fieldCell = document.createElement("td");
    fieldCell.className = "background-entry-field-cell";
    const textInput = document.createElement("input");
    textInput.type = "text";
    textInput.className = "background-entry-text";
    textInput.placeholder = "e.g., Science and Technology Studies";
    textInput.value = String(entry.text || "");
    if (textInput.value.trim()) {
      textInput.readOnly = true;
    }
    fieldCell.appendChild(textInput);

    const preferredCell = document.createElement("td");
    preferredCell.className = "background-entry-check-cell";
    const preferredLabel = document.createElement("label");
    preferredLabel.className = "background-role-toggle";
    const preferredInput = document.createElement("input");
    preferredInput.type = "checkbox";
    preferredInput.className = "background-role-preferred";
    preferredInput.checked = String(entry.role || "preferred") !== "acceptable";
    preferredLabel.setAttribute("aria-label", "Preferred");
    preferredLabel.append(preferredInput);
    preferredCell.appendChild(preferredLabel);

    const acceptableCell = document.createElement("td");
    acceptableCell.className = "background-entry-check-cell";
    const acceptableLabel = document.createElement("label");
    acceptableLabel.className = "background-role-toggle";
    const acceptableInput = document.createElement("input");
    acceptableInput.type = "checkbox";
    acceptableInput.className = "background-role-acceptable";
    acceptableInput.checked = String(entry.role || "preferred") === "acceptable";
    acceptableLabel.setAttribute("aria-label", "Acceptable");
    acceptableLabel.append(acceptableInput);
    acceptableCell.appendChild(acceptableLabel);

    preferredInput.addEventListener("change", () => {
      if (preferredInput.checked) {
        acceptableInput.checked = false;
      } else if (!acceptableInput.checked) {
        preferredInput.checked = true;
      }
    });

    acceptableInput.addEventListener("change", () => {
      if (acceptableInput.checked) {
        preferredInput.checked = false;
      } else if (!preferredInput.checked) {
        acceptableInput.checked = true;
      }
    });

    const removeCell = document.createElement("td");
    removeCell.className = "background-entry-remove-cell";

    const actionsWrap = document.createElement("div");
    actionsWrap.className = "background-entry-actions";

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "btn secondary background-entry-remove";
    editButton.textContent = "✎";
    editButton.title = "Edit field";
    editButton.setAttribute("aria-label", "Edit background field");
    editButton.addEventListener("click", () => {
      textInput.readOnly = !textInput.readOnly;
      if (!textInput.readOnly) {
        textInput.focus();
        textInput.select();
      }
    });

    textInput.addEventListener("blur", () => {
      if (String(textInput.value || "").trim()) {
        textInput.readOnly = true;
      }
    });

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "btn secondary background-entry-remove";
    removeButton.textContent = "🗑";
    removeButton.title = "Remove row";
    removeButton.setAttribute("aria-label", "Remove background row");
    removeButton.addEventListener("click", () => {
      row.remove();
    });

    actionsWrap.append(editButton, removeButton);
    removeCell.appendChild(actionsWrap);

    row.append(fieldCell, preferredCell, acceptableCell, removeCell);
    return row;
  }

  function setBackgroundEntries(backgrounds) {
    const wrap = document.getElementById("backgroundEntries");
    if (!wrap) return;

    wrap.innerHTML = "";
    const entries = normalizeBackgroundEntries(backgrounds);
    entries.forEach((entry) => {
      wrap.appendChild(buildBackgroundEntryRow(entry));
    });

    if (!entries.length) {
      wrap.appendChild(buildBackgroundEntryRow({ role: "preferred" }));
    }
  }

  function collectBackgroundEntries() {
    const wrap = document.getElementById("backgroundEntries");
    const preferred = [];
    const acceptable = [];
    if (!wrap) {
      return { preferred, acceptable };
    }

    const seenPreferred = new Set();
    const seenAcceptable = new Set();
    wrap.querySelectorAll(".background-entry-row").forEach((row) => {
      const textEl = row.querySelector(".background-entry-text");
      const preferredEl = row.querySelector(".background-role-preferred");
      const acceptableEl = row.querySelector(".background-role-acceptable");

      const text = String(textEl && textEl.value ? textEl.value : "").trim();
      if (!text) return;

      const key = text.toLowerCase();
      const isAcceptable = Boolean(acceptableEl && acceptableEl.checked);
      if (isAcceptable) {
        if (!seenAcceptable.has(key)) {
          acceptable.push(text);
          seenAcceptable.add(key);
        }
        return;
      }

      if (preferredEl && preferredEl.checked && !seenPreferred.has(key)) {
        preferred.push(text);
        seenPreferred.add(key);
      }
    });

    return { preferred, acceptable };
  }

  function buildRequirementEntryRow(value = "") {
    const row = document.createElement("tr");
    row.className = "background-entry-row";

    const textCell = document.createElement("td");
    textCell.className = "background-entry-field-cell";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "background-entry-text";
    input.placeholder = "e.g., MSc degree required in relevant discipline";
    input.value = String(value || "");
    textCell.appendChild(input);

    const removeCell = document.createElement("td");
    removeCell.className = "background-entry-remove-cell";
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "btn secondary background-entry-remove";
    removeButton.textContent = "x";
    removeButton.setAttribute("aria-label", "Remove requirement");
    removeButton.addEventListener("click", () => {
      row.remove();
    });
    removeCell.appendChild(removeButton);

    row.append(textCell, removeCell);
    return row;
  }

  function setRequirementEntries(requirements) {
    const wrap = document.getElementById("initialRequirementEntries");
    if (!wrap) return;

    wrap.innerHTML = "";
    const rows = Array.isArray(requirements) ? requirements : [];
    rows.forEach((item) => {
      const text = String(item || "").trim();
      if (!text) return;
      wrap.appendChild(buildRequirementEntryRow(text));
    });

    if (!wrap.children.length) {
      wrap.appendChild(buildRequirementEntryRow(""));
    }
  }

  function collectRequirementEntries() {
    const wrap = document.getElementById("initialRequirementEntries");
    if (!wrap) return [];

    const seen = new Set();
    const values = [];
    wrap.querySelectorAll(".background-entry-text").forEach((input) => {
      const text = String((input && input.value) || "").trim();
      if (!text) return;
      const key = text.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      values.push(text);
    });
    return values;
  }

  function loadPreselectionState() {
    try {
      const raw = getSessionStorageItem(PRESELECTION_STATE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function savePreselectionState(state) {
    const next = state && typeof state === "object" ? state : {};
    setSessionStorageItem(PRESELECTION_STATE_KEY, JSON.stringify(next));
    return next;
  }

  function parseConfigForm() {
    const selectedSubfeatures = {};
    document.querySelectorAll("input[data-subfeature-category][data-subfeature-key]").forEach((el) => {
      if (!(el instanceof HTMLInputElement) || !el.checked) return;
      const category = String(el.dataset.subfeatureCategory || "").trim();
      const key = String(el.dataset.subfeatureKey || "").trim();
      if (!category || !key) return;
      if (!selectedSubfeatures[category]) selectedSubfeatures[category] = [];
      selectedSubfeatures[category].push(key);
    });

    Object.keys(SUBFEATURE_OPTIONS).forEach((category) => {
      if (!Array.isArray(selectedSubfeatures[category])) {
        selectedSubfeatures[category] = [];
      }
    });

    return {
      evaluator_mode: "cbr",
      initial_screening: {
        requirements: collectRequirementEntries(),
        excluded_candidate_ids: [],
        model: String(document.getElementById("preselectionModelSelect")?.value || "gpt-5.4-mini"),
        prompt_path: "prompts/eval_agents/pre-screening.txt",
        additional_instructions: String(document.getElementById("preselectionAdditionalInstructions")?.value || ""),
      },
      h2h_eta: Number(document.getElementById("h2hEta")?.value || 0.1),
      cbr_weights: {
        education: Number(document.getElementById("wEducation").value || 0.24),
        experience: Number(document.getElementById("wExperience").value || 0.28),
        research_outputs: Number(document.getElementById("wResearchOutputs").value || 0.22),
        skills_and_methods: Number(document.getElementById("wSkillsMethods").value || 0.26),
      },
      education_backgrounds: collectBackgroundEntries(),
      selected_subfeatures: selectedSubfeatures,
      llm_evaluator: {
        model: String(document.getElementById("llmModelSelect")?.value || "gpt-5.4-mini"),
        additional_instructions: String(document.getElementById("llmAdditionalInstructions")?.value || ""),
      },
      fairness_assistant: {
        model: String(document.getElementById("fairnessModelSelect")?.value || "gpt-5.4-mini"),
        additional_instructions: String(document.getElementById("fairnessAdditionalInstructions")?.value || ""),
      },
      ntnu_assistant: {
        model: String(document.getElementById("ntnuModelSelect")?.value || "gpt-5.4-mini"),
        additional_instructions: String(document.getElementById("ntnuAdditionalInstructions")?.value || ""),
      },
    };
  }

  function setConfigPipelineTab(tab) {
    const key = String(tab || "initial").trim() || "initial";
    document.querySelectorAll("[data-config-tab]").forEach((button) => {
      const isActive = String(button.getAttribute("data-config-tab") || "") === key;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
    document.querySelectorAll("[data-config-panel]").forEach((panel) => {
      panel.hidden = String(panel.getAttribute("data-config-panel") || "") !== key;
    });
  }

  function setConfigForm(config) {
        const initialScreening = config.initial_screening || {};
        setRequirementEntries(initialScreening.requirements || []);
        const preselectionModelEl = document.getElementById("preselectionModelSelect");
        const preselectionInstructionsEl = document.getElementById("preselectionAdditionalInstructions");
        if (preselectionModelEl) {
          preselectionModelEl.value = String(initialScreening.model || "gpt-5.4-mini");
        }
        if (preselectionInstructionsEl) {
          preselectionInstructionsEl.value = String(initialScreening.additional_instructions || "");
        }

    if (!config) return;
    const etaEl = document.getElementById("h2hEta");
    if (etaEl) etaEl.value = Number(config.h2h_eta ?? 0.1);
    const w = config.cbr_weights || {};
    document.getElementById("wEducation").value = w.education ?? 0.24;
    document.getElementById("wExperience").value = w.experience ?? 0.28;
    document.getElementById("wResearchOutputs").value = w.research_outputs ?? 0.22;
    document.getElementById("wSkillsMethods").value = w.skills_and_methods ?? 0.26;
    const educationBackgrounds = config.education_backgrounds || {};
    setBackgroundEntries(educationBackgrounds);

    const defaults = defaultSelectedSubfeatures();
    const selectedSubfeatures = config.selected_subfeatures || defaults;
    document.querySelectorAll("input[data-subfeature-category][data-subfeature-key]").forEach((el) => {
      if (!(el instanceof HTMLInputElement)) return;
      const category = String(el.dataset.subfeatureCategory || "").trim();
      const key = String(el.dataset.subfeatureKey || "").trim();
      const selectedForCategory = Array.isArray(selectedSubfeatures[category])
        ? selectedSubfeatures[category]
        : (defaults[category] || []);
      el.checked = selectedForCategory.includes(key);
    });

    const llmConfig = config.llm_evaluator || {};
    const fairnessConfig = config.fairness_assistant || {};
    const ntnuConfig = config.ntnu_assistant || {};
    const llmModelEl = document.getElementById("llmModelSelect");
    const llmInstructionsEl = document.getElementById("llmAdditionalInstructions");
    const fairnessModelEl = document.getElementById("fairnessModelSelect");
    const fairnessInstructionsEl = document.getElementById("fairnessAdditionalInstructions");
    const ntnuModelEl = document.getElementById("ntnuModelSelect");
    const ntnuInstructionsEl = document.getElementById("ntnuAdditionalInstructions");
    if (llmModelEl) {
      llmModelEl.value = String(llmConfig.model || "gpt-5.4-mini");
    }
    if (llmInstructionsEl) {
      llmInstructionsEl.value = String(llmConfig.additional_instructions || "");
    }
    if (fairnessModelEl) {
      fairnessModelEl.value = String(fairnessConfig.model || "gpt-5.4-mini");
    }
    if (fairnessInstructionsEl) {
      fairnessInstructionsEl.value = String(fairnessConfig.additional_instructions || "");
    }
    if (ntnuModelEl) {
      ntnuModelEl.value = String(ntnuConfig.model || "gpt-5.4-mini");
    }
    if (ntnuInstructionsEl) {
      ntnuInstructionsEl.value = String(ntnuConfig.additional_instructions || "");
    }

    setConfigPipelineTab("initial");

    syncWeightLabels();
  }

  function buildPromptPreview(systemPrompt, additionalInstructions) {
    const prompt = String(systemPrompt || "").trim();
    const extra = String(additionalInstructions || "").trim();
    if (!extra) return prompt || "Prompt unavailable.";
    return `${prompt}\n\nADDITIONAL_INSTRUCTIONS:\n${extra}`;
  }

  async function hydrateConfigPromptPreviews(config) {
    const payload = await fetchJSON("/api/config-prompts");
    const source = config || getStoredConfig() || defaultConfig();
    const preselectionExtra = String(((source.initial_screening || {}).additional_instructions) || "");
    const llmExtra = String(((source.llm_evaluator || {}).additional_instructions) || "");
    const fairnessExtra = String(((source.fairness_assistant || {}).additional_instructions) || "");
    const ntnuExtra = String(((source.ntnu_assistant || {}).additional_instructions) || "");

    const preselectionPreview = document.getElementById("preselectionPromptPreview");
    const llmPreview = document.getElementById("llmSystemPromptPreview");
    const fairnessPreview = document.getElementById("fairnessSystemPromptPreview");
    const ntnuPreview = document.getElementById("ntnuSystemPromptPreview");
    if (preselectionPreview) preselectionPreview.textContent = buildPromptPreview(payload.preselection_prompt, preselectionExtra);
    if (llmPreview) llmPreview.textContent = buildPromptPreview(payload.llm_evaluator_system, llmExtra);
    if (fairnessPreview) fairnessPreview.textContent = buildPromptPreview(payload.fairness_assistant_system, fairnessExtra);
    if (ntnuPreview) ntnuPreview.textContent = buildPromptPreview(payload.ntnu_assistant_system, ntnuExtra);
  }

  function attachPromptPreviewSync() {
    const sync = () => {
      hydrateConfigPromptPreviews(parseConfigForm()).catch(() => {});
    };
    [
      "preselectionAdditionalInstructions",
      "llmAdditionalInstructions",
      "fairnessAdditionalInstructions",
      "ntnuAdditionalInstructions",
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input", sync);
    });
  }

  function saveConfigFromForm(statusMessage) {
    const config = parseConfigForm();
    saveStoredConfig(config);
    const status = document.getElementById("saveStatus");
    if (status) {
      status.textContent = statusMessage || "Settings saved.";
    }
    logStageEvent(
      "config",
      "save_settings",
      {
        config: summarizeConfigForLog(config),
      },
      {},
    );
    return config;
  }

  function syncWeightLabels() {
    const pairs = [
      ["h2hEta", "h2hEtaValue"],
      ["wEducation", "wEducationValue"],
      ["wExperience", "wExperienceValue"],
      ["wResearchOutputs", "wResearchOutputsValue"],
      ["wSkillsMethods", "wSkillsMethodsValue"],
    ];

    pairs.forEach(([inputId, labelId]) => {
      const input = document.getElementById(inputId);
      const label = document.getElementById(labelId);
      if (!input || !label) return;
      label.textContent = Number(input.value || 0).toFixed(2);
    });
  }

  function getH2HEta(config) {
    const source = config || getStoredConfig() || defaultConfig();
    const eta = Number(source && source.h2h_eta);
    if (!Number.isFinite(eta)) return 0.05;
    return Math.min(0.5, Math.max(0.01, eta));
  }

  function getStoredConfig() {
    try {
      const raw = getSessionStorageItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const defaults = defaultConfig();
      if (!parsed || typeof parsed !== "object") return defaults;
      if (!parsed.cbr_weights || typeof parsed.cbr_weights !== "object") {
        parsed.cbr_weights = { ...defaults.cbr_weights };
      }
      if (!parsed.education_backgrounds || typeof parsed.education_backgrounds !== "object") {
        parsed.education_backgrounds = {
          preferred: [...defaults.education_backgrounds.preferred],
          acceptable: [...defaults.education_backgrounds.acceptable],
        };
      }
      const backgroundEntries = normalizeBackgroundEntries(parsed.education_backgrounds);
      if (!backgroundEntries.length) {
        parsed.education_backgrounds = {
          preferred: [...defaults.education_backgrounds.preferred],
          acceptable: [...defaults.education_backgrounds.acceptable],
        };
      }
      const defaultSubfeatures = defaultSelectedSubfeatures();
      const defaultConfigSubfeatures = defaults.selected_subfeatures || defaultSubfeatures;
      const parsedSubfeatures = parsed.selected_subfeatures && typeof parsed.selected_subfeatures === "object"
        ? parsed.selected_subfeatures
        : {};
      const normalizedSubfeatures = {};
      Object.keys(SUBFEATURE_OPTIONS).forEach((category) => {
        const storedList = Array.isArray(parsedSubfeatures[category])
          ? parsedSubfeatures[category].map((item) => String(item || "").trim()).filter((item) => item)
          : null;
        if (!storedList || !storedList.length) {
          normalizedSubfeatures[category] = [...(defaultConfigSubfeatures[category] || [])];
          return;
        }

        const uniqueStored = [...new Set(storedList)];
        const isLegacyAllOnDefault = Number(parsed.config_version || 0) < CONFIG_VERSION
          && category === "skills_and_methods"
          && uniqueStored.length === SUBFEATURE_OPTIONS.skills_and_methods.length
          && SUBFEATURE_OPTIONS.skills_and_methods.every((key) => uniqueStored.includes(key));

        normalizedSubfeatures[category] = isLegacyAllOnDefault
          ? [...(defaultConfigSubfeatures[category] || [])]
          : uniqueStored;
      });
      parsed.selected_subfeatures = normalizedSubfeatures;
      if (!parsed.initial_screening || typeof parsed.initial_screening !== "object") {
        parsed.initial_screening = { ...defaults.initial_screening };
      }
      if (!Array.isArray(parsed.initial_screening.requirements)) {
        parsed.initial_screening.requirements = [...defaults.initial_screening.requirements];
      }
      if (!Array.isArray(parsed.initial_screening.excluded_candidate_ids)) {
        parsed.initial_screening.excluded_candidate_ids = [...defaults.initial_screening.excluded_candidate_ids];
      }
      if (!String(parsed.initial_screening.model || "").trim()) {
        parsed.initial_screening.model = defaults.initial_screening.model;
      }
      if (!String(parsed.initial_screening.prompt_path || "").trim()) {
        parsed.initial_screening.prompt_path = defaults.initial_screening.prompt_path;
      }
      if (!parsed.llm_evaluator || typeof parsed.llm_evaluator !== "object") {
        parsed.llm_evaluator = { ...defaults.llm_evaluator };
      }
      if (!String(parsed.llm_evaluator.model || "").trim()) {
        parsed.llm_evaluator.model = defaults.llm_evaluator.model;
      }
      if (!parsed.fairness_assistant || typeof parsed.fairness_assistant !== "object") {
        parsed.fairness_assistant = { ...defaults.fairness_assistant };
      }
      if (!String(parsed.fairness_assistant.model || "").trim()) {
        parsed.fairness_assistant.model = defaults.fairness_assistant.model;
      }
      if (!parsed.ntnu_assistant || typeof parsed.ntnu_assistant !== "object") {
        parsed.ntnu_assistant = { ...defaults.ntnu_assistant };
      }
      if (!String(parsed.ntnu_assistant.model || "").trim()) {
        parsed.ntnu_assistant.model = defaults.ntnu_assistant.model;
      }
      parsed.config_version = CONFIG_VERSION;
      return parsed;
    } catch {
      return null;
    }
  }

  function saveStoredConfig(config) {
    setSessionStorageItem(STORAGE_KEY, JSON.stringify({
      ...(config && typeof config === "object" ? config : {}),
      config_version: CONFIG_VERSION,
    }));
  }

  function getH2HState() {
    try {
      const raw = getSessionStorageItem(H2H_STATE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveH2HState(state) {
    setSessionStorageItem(H2H_STATE_KEY, JSON.stringify(state));
  }

  function getH2HCandidates() {
    try {
      const raw = getSessionStorageItem(H2H_CANDIDATES_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveH2HCandidates(candidates) {
    setSessionStorageItem(H2H_CANDIDATES_KEY, JSON.stringify(candidates));
  }

  function getH2HCandidateCatalog() {
    try {
      const raw = getSessionStorageItem(H2H_CANDIDATE_CATALOG_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveH2HCandidateCatalog(candidates) {
    setSessionStorageItem(H2H_CANDIDATE_CATALOG_KEY, JSON.stringify(candidates));
  }

  function buildLLMSelectionSignature(config) {
    const llm = (config && config.llm_evaluator && typeof config.llm_evaluator === "object")
      ? config.llm_evaluator
      : {};
    return JSON.stringify({
      model: String(llm.model || ""),
      additional_instructions: String(llm.additional_instructions || "").trim(),
    });
  }

  function buildH2HConfigSignature(config) {
    const source = config && typeof config === "object" ? config : {};
    return JSON.stringify({
      evaluator_mode: source.evaluator_mode || "cbr",
      h2h_eta: getH2HEta(source),
      cbr_weights: source.cbr_weights || {},
      education_backgrounds: source.education_backgrounds || {},
      selected_subfeatures: source.selected_subfeatures || {},
      llm_additional_instructions: ((source.llm_evaluator || {}).additional_instructions || ""),
    });
  }

  function getCachedLLMSelection() {
    try {
      const raw = getSessionStorageItem(LLM_SELECTION_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      if (typeof parsed.signature !== "string") return null;
      if (!parsed.llm_selection || typeof parsed.llm_selection !== "object") return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function saveCachedLLMSelection(signature, llmSelection) {
    setSessionStorageItem(LLM_SELECTION_CACHE_KEY, JSON.stringify({
      signature: String(signature || ""),
      llm_selection: llmSelection && typeof llmSelection === "object" ? llmSelection : {},
      updated_at: new Date().toISOString(),
    }));
  }

  function clearSelectionCaches() {
    removeSessionStorageItem(H2H_STATE_KEY);
    removeSessionStorageItem(H2H_CANDIDATES_KEY);
    removeSessionStorageItem(H2H_CANDIDATE_CATALOG_KEY);
    removeSessionStorageItem(LLM_SELECTION_CACHE_KEY);
    removeSessionStorageItem(PRESELECTION_STATE_KEY);
  }

  function mergeIntoH2HCandidateCatalog(candidates) {
    const candidateRichness = (candidate) => {
      if (!candidate || typeof candidate !== "object") return 0;
      let score = 0;
      if (String(candidate.summary_text || "").trim()) score += 4;
      if (candidate.cbr_breakdown && typeof candidate.cbr_breakdown === "object") score += 4;
      if (candidate.scores && typeof candidate.scores === "object") score += 3;
      if (candidate.materials && typeof candidate.materials === "object" && Object.keys(candidate.materials).length) score += 2;
      if (String(candidate.display_name || candidate.name || "").trim()) score += 1;
      score += Math.min(2, Math.floor(Object.keys(candidate).length / 6));
      return score;
    };

    const shouldReplaceCatalogEntry = (existing, incoming) => {
      if (!existing) return true;
      return candidateRichness(incoming) >= candidateRichness(existing);
    };

    const nextMap = new Map();
    getH2HCandidateCatalog().forEach((candidate) => {
      const key = String((candidate && candidate.application_id) || "").trim();
      if (!key) return;
      nextMap.set(key, candidate);
    });
    (Array.isArray(candidates) ? candidates : []).forEach((candidate) => {
      const key = String((candidate && candidate.application_id) || "").trim();
      if (!key) return;
      const existing = nextMap.get(key);
      if (shouldReplaceCatalogEntry(existing, candidate)) {
        nextMap.set(key, candidate);
      }
    });
    saveH2HCandidateCatalog(Array.from(nextMap.values()));
  }

  function ensureTopScrollAfterRoundSubmit() {
    if (sessionStorage.getItem(H2H_SCROLL_TOP_KEY) !== "1") return;
    sessionStorage.removeItem(H2H_SCROLL_TOP_KEY);
    if ("scrollRestoration" in history) {
      history.scrollRestoration = "manual";
    }
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    });
  }

  function hashString(value) {
    const text = String(value || "");
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function buildCandidateAlias(applicationId) {
    const id = String(applicationId || "").trim();
    if (!id) return "Unnamed Cedar";
    const firstHash = hashString(`${id}:first`);
    const lastHash = hashString(`${id}:last`);
    const firstName = CANDIDATE_ALIAS_FIRST_NAMES[firstHash % CANDIDATE_ALIAS_FIRST_NAMES.length];
    const lastName = CANDIDATE_ALIAS_LAST_NAMES[lastHash % CANDIDATE_ALIAS_LAST_NAMES.length];
    return `${firstName} ${lastName}`;
  }

  function buildCandidateAliasMap(applicationIds) {
    const aliasMap = {};
    applicationIds.forEach((applicationId) => {
      const id = String(applicationId || "").trim();
      if (!id) return;
      aliasMap[id] = buildCandidateAlias(id);
    });
    return aliasMap;
  }

  function applyCandidateDisplayNames(candidates, aliasMap) {
    candidates.forEach((candidate) => {
      const applicationId = String(candidate.application_id || candidate.name || "").trim();
      candidate.display_name = aliasMap[applicationId] || buildCandidateAlias(applicationId);
    });
  }

  function aliasForApplicationId(applicationId, candidates = []) {
    const id = String(applicationId || "").trim();
    const candidate = Array.isArray(candidates)
      ? candidates.find((entry) => String((entry && entry.application_id) || "") === id)
      : null;
    return (candidate && candidate.display_name) || buildCandidateAlias(id);
  }

  function ensureCandidateAliases(candidates, state) {
    const ids = candidates.map((candidate) => candidate.application_id);
    const hasReusableAliases = Boolean(
      state
      && state.aliasMap
      && ids.every((id) => typeof state.aliasMap[id] === "string")
    );

    const aliasMap = hasReusableAliases ? state.aliasMap : buildCandidateAliasMap(ids);
    applyCandidateDisplayNames(candidates, aliasMap);
    if (state) {
      state.aliasMap = aliasMap;
    }
    return aliasMap;
  }

  async function fetchJSON(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "Request failed");
    }
    return response.json();
  }

  function truncateForLog(value, maxLen = 400) {
    const text = String(value || "");
    const limit = Math.max(0, Number(maxLen || 0));
    if (!limit || text.length <= limit) return text;
    return `${text.slice(0, Math.max(0, limit - 1))}...`;
  }

  function summarizeConfigForLog(config) {
    const source = config && typeof config === "object" ? config : {};
    const selectedSubfeatures = source.selected_subfeatures && typeof source.selected_subfeatures === "object"
      ? source.selected_subfeatures
      : {};

    return {
      evaluator_mode: String(source.evaluator_mode || "cbr"),
      initial_screening: {
        requirement_count: Array.isArray(((source.initial_screening || {}).requirements))
          ? source.initial_screening.requirements.length
          : 0,
        excluded_candidate_count: Array.isArray(((source.initial_screening || {}).excluded_candidate_ids))
          ? source.initial_screening.excluded_candidate_ids.length
          : 0,
        model: String(((source.initial_screening || {}).model) || "gpt-5.4-mini"),
        has_additional_instructions: Boolean(String(((source.initial_screening || {}).additional_instructions) || "").trim()),
      },
      h2h_eta: Number(source.h2h_eta ?? 0.1),
      cbr_weights: source.cbr_weights && typeof source.cbr_weights === "object" ? source.cbr_weights : {},
      education_background_counts: {
        preferred: Array.isArray(((source.education_backgrounds || {}).preferred))
          ? source.education_backgrounds.preferred.length
          : 0,
        acceptable: Array.isArray(((source.education_backgrounds || {}).acceptable))
          ? source.education_backgrounds.acceptable.length
          : 0,
      },
      selected_subfeature_counts: Object.fromEntries(
        Object.entries(selectedSubfeatures).map(([key, value]) => [key, Array.isArray(value) ? value.length : 0]),
      ),
      llm_evaluator: {
        model: String(((source.llm_evaluator || {}).model) || "gpt-5.4-mini"),
        has_additional_instructions: Boolean(String(((source.llm_evaluator || {}).additional_instructions) || "").trim()),
      },
      fairness_assistant: {
        model: String(((source.fairness_assistant || {}).model) || "gpt-5.4-mini"),
        has_additional_instructions: Boolean(String(((source.fairness_assistant || {}).additional_instructions) || "").trim()),
      },
      ntnu_assistant: {
        model: String(((source.ntnu_assistant || {}).model) || "gpt-5.4-mini"),
        has_additional_instructions: Boolean(String(((source.ntnu_assistant || {}).additional_instructions) || "").trim()),
      },
    };
  }

  function summarizeCandidateContextForLog(ctx) {
    const source = ctx && typeof ctx === "object" ? ctx : {};
    const conversationHistory = Array.isArray(source.conversation_history) ? source.conversation_history : [];
    const qaHistory = Array.isArray(source.qa_history) ? source.qa_history : [];

    return {
      candidate_id: String(source.candidate_id || ""),
      candidate_display_name: String(source.candidate_display_name || ""),
      current_justification_excerpt: truncateForLog(source.current_justification || "", 300),
      current_ratings: source.current_ratings && typeof source.current_ratings === "object" ? source.current_ratings : {},
      history_counts: {
        conversation_history: conversationHistory.length,
        qa_history: qaHistory.length,
      },
      latest_conversation_entries: conversationHistory.slice(-2).map((entry) => ({
        type: String((entry && entry.type) || ""),
        question: truncateForLog((entry && entry.question) || "", 240),
      })),
      latest_qa_entries: qaHistory.slice(-2).map((entry) => ({
        role: String((entry && entry.role) || "assistant"),
        text: truncateForLog((entry && (entry.text || entry.raw_response_text || "")) || "", 300),
      })),
    };
  }

  async function logStageEvent(stage, action, inputs = {}, outputs = {}) {
    try {
      await fetch("/api/log-stage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: String(stage || "unknown"),
          action: String(action || "event"),
          inputs: inputs && typeof inputs === "object" ? inputs : {},
          outputs: outputs && typeof outputs === "object" ? outputs : {},
          session_id: getWorkflowSessionId(),
        }),
      });
    } catch {
      // Logging must never block workflow UX.
    }
  }

  async function logFinalRanking(state, candidates) {
    if (!state || state.finalRankingLogged) return;

    const h2h = await computeH2HState(candidates, state.comparisons || []);
    const rows = Array.isArray(h2h.rows) ? h2h.rows : [];
    const payload = {
      job_dir: state.jobDir || DEFAULT_JOB_DIR_FALLBACK(),
      source_path: state.sourcePath || DEFAULT_SOURCE_PATH_FALLBACK(),
      session_id: getWorkflowSessionId(),
      config_signature: state.configSignature || "",
      pool_signature: state.signature || "",
      rankings: rows.map((row, index) => ({
        rank: index + 1,
        application_id: row.application_id,
        score: row.score,
        wins: row.wins,
        losses: row.losses,
        comparisons: row.comparisons,
      })),
      comparisons: (state.comparisons || []).map((comparison) => ({
        left: comparison.left,
        right: comparison.right,
        winner: comparison.winner,
        loser: comparison.loser,
        rationale: comparison.rationale || "",
        section_winners: comparison.section_winners || {},
      })),
    };

    await fetchJSON("/api/log-ranking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    state.finalRankingLogged = true;
    saveH2HState(state);
  }

  function DEFAULT_JOB_DIR_FALLBACK() {
    return "data/jobs/STS_PhD_Position_2026";
  }

  function DEFAULT_SOURCE_PATH_FALLBACK() {
    return "data/jobs/STS_PhD_Position_2026/STS_PhD_Position_2026_applications_with_summaries.json";
  }

  function renderTopList(tableId, items, scoreKey) {
    const body = document.getElementById(tableId);
    body.innerHTML = "";
    items.forEach((item) => {
      const row = document.createElement("tr");
      row.innerHTML = `<td>${item.name}</td><td>${item.scores[scoreKey]}</td>`;
      body.appendChild(row);
    });
  }

  async function runPipeline(config) {
    const effectiveConfig = config || getStoredConfig() || defaultConfig();
    const result = await fetchJSON("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(effectiveConfig),
    });

    const rankedCandidates = Array.isArray((result || {}).ranked_candidates)
      ? (result || {}).ranked_candidates
      : (Array.isArray((result || {}).pool) ? (result || {}).pool : []);

    await logStageEvent(
      "pipeline",
      "run",
      {
        config: summarizeConfigForLog(effectiveConfig),
      },
      {
        candidate_count: Number(((result || {}).meta || {}).candidate_count || 0),
        pool_count: Array.isArray((result || {}).pool) ? result.pool.length : 0,
        evaluator_mode: String(((result || {}).meta || {}).evaluator_mode || "cbr"),
        cbr_ranking_top10: buildCbrRanking(rankedCandidates, 10),
      },
    );

    return result;
  }

  async function runPreselection(config, requirements) {
    const effectiveConfig = config || getStoredConfig() || defaultConfig();
    const result = await fetchJSON("/api/preselection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        run_config: effectiveConfig,
        requirements: Array.isArray(requirements) ? requirements : [],
      }),
    });

    await logStageEvent(
      "preselection",
      "agent_run",
      {
        requirement_count: Array.isArray(requirements) ? requirements.length : 0,
      },
      {
        omitted_count: Number((((result || {}).preselection || {}).omitted_candidates || []).length || 0),
      },
    );

    return result;
  }

  function buildCbrRanking(candidates, limit = 10) {
    const rows = Array.isArray(candidates) ? candidates : [];
    const ranking = [];

    rows.slice(0, Math.max(0, Number(limit || 0))).forEach((row, index) => {
      const applicationId = String(row && (row.application_id || row.name || "")).trim();
      if (!applicationId) return;
      const score = Number(
        (row && row.scores && row.scores.cbr)
        || (row && row.backend_score)
        || (row && row.cbr_score)
        || 0
      );
      ranking.push({
        rank: index + 1,
        application_id: applicationId,
        cbr_score: Number.isFinite(score) ? Number(score.toFixed(6)) : 0,
      });
    });

    return ranking;
  }

  function buildLlmRankings(llmSelection, limit = 10) {
    const source = llmSelection && typeof llmSelection === "object" ? llmSelection : {};
    let shortlist = Array.isArray(source.shortlist) ? source.shortlist : [];
    let longlist = Array.isArray(source.longlist) ? source.longlist : [];

    // Preserve ranking visibility even when shortlist/longlist are empty but preselected IDs exist.
    if (!shortlist.length && !longlist.length && Array.isArray(source.preselected_application_ids)) {
      const fallback = source.preselected_application_ids
        .map((id) => ({ application_id: String(id || "").trim() }))
        .filter((row) => row.application_id);
      shortlist = fallback.slice(0, 5);
      longlist = fallback.slice(5, 10);
    }

    const normalize = (rows) => {
      const ranking = [];
      (Array.isArray(rows) ? rows : []).slice(0, Math.max(0, Number(limit || 0))).forEach((row, index) => {
        const applicationId = String(row && (row.application_id || row.candidate_id || row.id || "")).trim();
        if (!applicationId) return;
        const selectionReason = String(
          (row && (row.selection_reason || row["selection_reason:"] || row.reason || row.rationale))
          || ""
        ).trim();
        ranking.push({
          rank: index + 1,
          application_id: applicationId,
          selection_reason: selectionReason,
        });
      });
      return ranking;
    };

    return {
      shortlist: normalize(shortlist),
      longlist: normalize(longlist),
    };
  }

  async function computeH2HState(candidates, comparisons, options = {}) {
    const config = getStoredConfig() || defaultConfig();
    return fetchJSON("/api/h2h/compute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidates: Array.isArray(candidates) ? candidates : [],
        comparisons: Array.isArray(comparisons) ? comparisons : [],
        eta: getH2HEta(config),
        exclude_top6_vs_top6: options.excludeTop6VsTop6 !== false,
      }),
    });
  }

  async function computeSnapshotViewModel(rankedCandidates, llmSelection) {
    return fetchJSON("/api/snapshot/view-model", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ranked_candidates: Array.isArray(rankedCandidates) ? rankedCandidates : [],
        llm_selection: llmSelection || null,
        pool_size: H2H_POOL_SIZE,
        rng_seed: 42,
      }),
    });
  }

  function buildRunConfigPayload(config) {
    const source = config || defaultConfig();
    return {
      cbr_weights: source.cbr_weights || defaultConfig().cbr_weights,
      education_backgrounds: source.education_backgrounds || { preferred: [], acceptable: [] },
      selected_subfeatures: source.selected_subfeatures || defaultSelectedSubfeatures(),
      max_matchups: Number(source.max_matchups || 20),
    };
  }

  async function runLLMEvaluate(config, handlers = {}) {
    const source = config || getStoredConfig() || defaultConfig();
    const llmConfig = source.llm_evaluator || {};
    const onStart = typeof handlers.onStart === "function" ? handlers.onStart : null;
    const onDelta = typeof handlers.onDelta === "function" ? handlers.onDelta : null;
    const onError = typeof handlers.onError === "function" ? handlers.onError : null;

    const request = fetch("/api/llm-evaluate-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        run_config: buildRunConfigPayload(source),
        llm_config: {
          model: String(llmConfig.model || "gpt-5.4-mini"),
          additional_instructions: String(llmConfig.additional_instructions || ""),
        },
      }),
    });

    const timeoutMs = 120000;
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("LLM evaluate request timed out")), timeoutMs);
    });

    const response = await Promise.race([request, timeout]);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "Request failed");
    }
    if (!response.body) {
      throw new Error("Streaming response body unavailable");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalSelection = null;

    const handleBlock = (block) => {
      const lines = block.split(/\r?\n/);
      const data = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.replace(/^data:\s?/, ""))
        .join("\n");
      if (!data) return;
      const payload = JSON.parse(data);
      if (payload.type === "start") {
        if (onStart) onStart(payload);
        return;
      }
      if (payload.type === "delta") {
        if (onDelta) onDelta(payload);
        return;
      }
      if (payload.type === "error") {
        if (onError) onError(payload);
        return;
      }
      if (payload.type === "done") {
        finalSelection = payload.llm_selection || payload.result || null;
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: !done });
        let separatorIndex = buffer.indexOf("\n\n");
        while (separatorIndex !== -1) {
          handleBlock(buffer.slice(0, separatorIndex));
          buffer = buffer.slice(separatorIndex + 2);
          separatorIndex = buffer.indexOf("\n\n");
        }
      }
      if (done) break;
    }

    if (buffer.trim()) {
      handleBlock(buffer);
    }

    if (!finalSelection) {
      throw new Error("Streaming response completed without a final LLM selection.");
    }

    return { llm_selection: finalSelection };
  }

  function renderLLMLiveSelection(state) {
    const liveResponse = String(state.responseText || "").trim();
    const promptSystem = String(state.promptSystem || "").trim();
    const promptUser = String(state.promptUser || "").trim();
    const responseStatus = [
      `model: ${escapeHtml(String(state.model || "unknown"))}`,
      `considered_candidates: ${Number(state.consideredCandidates || 0)}`,
      state.timeoutSeconds ? `timeout_seconds: ${Number(state.timeoutSeconds)}` : null,
      state.status ? `status: ${escapeHtml(String(state.status))}` : null,
      state.errorType ? `error_type: ${escapeHtml(String(state.errorType))}` : null,
      state.errorMessage ? `error_message: ${escapeHtml(String(state.errorMessage))}` : null,
      `response_text_length: ${liveResponse.length}`,
    ].filter(Boolean).join("<br />");

    return `
      <section class="llm-results-group">
        <details class="llm-result-item" open>
          <summary><span class="badge warn">Debug</span><span>LLM Status</span></summary>
          <div class="muted">${responseStatus}</div>
        </details>
        <details class="llm-result-item" open>
          <summary><span class="badge warn">Debug</span><span>System Prompt Sent To API</span></summary>
          <pre>${escapeHtml(promptSystem || "System prompt not available yet.")}</pre>
        </details>
        <details class="llm-result-item" open>
          <summary><span class="badge warn">Debug</span><span>User Prompt Sent To API</span></summary>
          <pre>${escapeHtml(promptUser || "User prompt not available yet.")}</pre>
        </details>
        <details class="llm-result-item" open>
          <summary><span class="badge warn">Debug</span><span>Live Raw Response Text</span></summary>
          <pre>${escapeHtml(liveResponse || "Waiting for the first streamed tokens...")}</pre>
        </details>
      </section>
    `;
  }

  function syncSnapshotLLMHeight() {
    const cbrWrap = document.getElementById("cbrTop10List");
    const llmWrap = document.getElementById("llmSelectionList");
    const toggle = document.getElementById("llmExpandToggle");
    if (!cbrWrap || !llmWrap || !toggle) return;

    const expanded = toggle.dataset.expanded === "true";
    const cbrHeight = Math.max(120, Math.ceil(cbrWrap.scrollHeight || cbrWrap.getBoundingClientRect().height || 120));

    if (!toggle.dataset.bound) {
      toggle.dataset.bound = "true";
      toggle.addEventListener("click", () => {
        const nextExpanded = toggle.dataset.expanded !== "true";
        toggle.dataset.expanded = nextExpanded ? "true" : "false";
        syncSnapshotLLMHeight();
      });
    }

    if (expanded) {
      llmWrap.style.maxHeight = "none";
      toggle.hidden = false;
      toggle.textContent = "Collapse";
      return;
    }

    llmWrap.style.maxHeight = `${cbrHeight}px`;
    const hasOverflow = llmWrap.scrollHeight > cbrHeight + 2;
    toggle.hidden = !hasOverflow;
    toggle.textContent = "Expand to view all";
  }

  function initSnapshotLLMHeightSync() {
    const cbrWrap = document.getElementById("cbrTop10List");
    const llmWrap = document.getElementById("llmSelectionList");
    const toggle = document.getElementById("llmExpandToggle");
    if (!cbrWrap || !llmWrap || !toggle) return;

    if (!toggle.dataset.observeBound) {
      const observer = new MutationObserver(() => {
        syncSnapshotLLMHeight();
      });
      observer.observe(cbrWrap, { childList: true, subtree: true, characterData: true });
      observer.observe(llmWrap, { childList: true, subtree: true, characterData: true });
      toggle.dataset.observeBound = "true";
    }

    syncSnapshotLLMHeight();
    setTimeout(syncSnapshotLLMHeight, 0);
  }

  function renderPreHeadToHeadComparison(cbrTop10, llmSelection, initialSelection) {
    const cbrWrap = document.getElementById("cbrTop10List");
    const llmWrap = document.getElementById("llmSelectionList");
    const initialWrap = document.getElementById("initialHeadToHeadList");
    if (!cbrWrap || !llmWrap || !initialWrap) return;

    const displayNameForRow = (row) => {
      const applicationId = String((row && (row.application_id || row.candidate_id || row.id || row.name)) || "").trim();
      return escapeHtml(String((row && row.display_name) || buildCandidateAlias(applicationId)));
    };

    const candidateNameHtml = (row) => {
      const applicationId = String((row && (row.application_id || row.candidate_id || row.id || row.name)) || "").trim();
      const label = displayNameForRow(row);
      if (!applicationId) return label;
      const href = `/candidate-profiles?candidate_id=${encodeURIComponent(applicationId)}`;
      return `<a class="info-link" href="${href}">${label}</a>`;
    };

    const renderNameList = (rows, emptyMessage, extraText = null) => {
      if (!Array.isArray(rows) || !rows.length) {
        return `<p class="muted">${emptyMessage}</p>`;
      }
      const items = rows.map((row) => {
        const labelHtml = candidateNameHtml(row);
        const suffix = typeof extraText === "function" ? extraText(row) : "";
        return `<li><strong>${labelHtml}</strong>${suffix ? ` <span class="muted">${suffix}</span>` : ""}</li>`;
      }).join("");
      return `<ul class="candidate-rank-list">${items}</ul>`;
    };

    const cbrSelectedIds = new Set((Array.isArray(cbrTop10) ? cbrTop10 : []).map((row) => String((row && row.application_id) || "").trim()));

    if (!Array.isArray(cbrTop10) || !cbrTop10.length) {
      cbrWrap.innerHTML = '<p class="muted">No CBR top candidates available.</p>';
    } else {
      cbrWrap.innerHTML = renderNameList(cbrTop10, "No CBR candidates available.");
    }

    if (llmSelection == null) {
      llmWrap.innerHTML = '<p class="muted">Loading LLM shortlist/longlist...</p>';
      syncSnapshotLLMHeight();
      setTimeout(syncSnapshotLLMHeight, 0);
      return;
    }

    const llmData = llmSelection || {};
    let shortlist = Array.isArray(llmData.shortlist) ? llmData.shortlist : [];
    let longlist = Array.isArray(llmData.longlist) ? llmData.longlist : [];

    // If the evaluator returns empty buckets, fall back to preselected IDs so UI still shows candidates.
    if (!shortlist.length && !longlist.length && Array.isArray(llmData.preselected_application_ids)) {
      const fallback = llmData.preselected_application_ids
        .map((id) => ({ application_id: String(id || "").trim() }))
        .filter((row) => row.application_id);
      shortlist = fallback.slice(0, 5);
      longlist = fallback.slice(5, 10);
    }

    const llmShortlistIds = new Set((Array.isArray(shortlist) ? shortlist : []).map((row) => String((row && row.application_id) || "").trim()));
    const llmLonglistIds = new Set((Array.isArray(longlist) ? longlist : []).map((row) => String((row && row.application_id) || "").trim()));

    const sourceLabelText = (row) => {
      const applicationId = String((row && row.application_id) || "").trim();
      const sourceTags = Array.isArray(row && row.source_tags) ? row.source_tags : [];
      const normalized = sourceTags.map((tag) => String(tag || "").toLowerCase());
      const labels = [];
      if (normalized.includes("wildcard") || normalized.includes("random_sample") || normalized.includes("random")) labels.push("Wildcard");
      if (normalized.includes("cbr") || cbrSelectedIds.has(applicationId)) labels.push("CBR");
      if (normalized.includes("llm_shortlist") || normalized.includes("shortlist") || llmShortlistIds.has(applicationId)) labels.push("LLM shortlist");
      if (normalized.includes("llm_longlist") || normalized.includes("longlist") || llmLonglistIds.has(applicationId)) labels.push("LLM longlist");
      if (!labels.length) labels.push("CBR baseline");
      return `Selected by: ${escapeHtml(labels.join(", "))}`;
    };

    const renderGroup = (title, rows, badgeClass) => {
      if (!rows.length) {
        return `<section class="llm-results-group"><h5>${title}</h5><p class="muted">No candidates returned.</p></section>`;
      }

      const items = rows.map((row) => {
        const labelHtml = candidateNameHtml(row);
        const reason = escapeHtml(String((row && row.selection_reason) || "").trim());
        return `
          <div class="llm-result-item">
            <div><span class="badge ${badgeClass}">${title}</span> <strong>${labelHtml}</strong></div>
            ${reason ? `<div class="muted" style="margin-top: 6px">${reason}</div>` : ""}
          </div>
        `;
      }).join("");

      return `<section class="llm-results-group"><h5>${title}</h5>${items}</section>`;
    };

    const renderInitialSelection = (rows) => {
      if (!Array.isArray(rows) || !rows.length) {
        return '<p class="muted">No head-to-head pool available yet.</p>';
      }

      return renderNameList(rows, "No head-to-head pool available yet.", sourceLabelText);
    };

    llmWrap.innerHTML = `
      <div class="llm-two-column-grid">
        ${renderGroup("Shortlist", shortlist, "ok")}
        ${renderGroup("Longlist", longlist, "warn")}
      </div>
    `;

    syncSnapshotLLMHeight();
    setTimeout(syncSnapshotLLMHeight, 0);

    initialWrap.innerHTML = renderInitialSelection(initialSelection);
  }

  async function loadPreHeadToHeadComparison(config, runResult) {
    const cbrWrap = document.getElementById("cbrTop10List");
    const llmWrap = document.getElementById("llmSelectionList");
    if (cbrWrap) cbrWrap.textContent = "Loading CBR candidates...";
    if (llmWrap) llmWrap.textContent = "Loading LLM selections...";
    const preselectionState = loadPreselectionState();
    const omittedIds = (Array.isArray(preselectionState.omitted_candidates)
      ? preselectionState.omitted_candidates
      : [])
      .map((row) => String((row && row.application_id) || "").trim())
      .filter((id) => id);
    const configExcludedIds = Array.isArray((((config || {}).initial_screening || {}).excluded_candidate_ids))
      ? config.initial_screening.excluded_candidate_ids.map((id) => String(id || "").trim()).filter((id) => id)
      : [];
    const excludedIdSet = new Set([...configExcludedIds, ...omittedIds]);
    const filterExcludedCandidates = (rows) => (Array.isArray(rows) ? rows : []).filter((row) => {
      const id = String((row && row.application_id) || "").trim();
      return id && !excludedIdSet.has(id);
    });

    const snapshotStats = {
      cbr_top_count: 0,
      llm_shortlist_count: 0,
      llm_longlist_count: 0,
      initial_selection_count: 0,
      cbr_ranking_top10: [],
      llm_shortlist_ranking: [],
      llm_longlist_ranking: [],
    };

    let cbrResult = runResult;
    try {
      if (!cbrResult) {
        cbrResult = await runPipeline({
          ...config,
          evaluator_mode: "cbr",
        });
      }
      const filteredCbrPool = filterExcludedCandidates((cbrResult && cbrResult.pool) || []);
      renderPreHeadToHeadComparison(
        filteredCbrPool.slice(0, 10),
        null,
        [],
      );
      snapshotStats.cbr_top_count = filteredCbrPool.slice(0, 10).length;
      snapshotStats.cbr_ranking_top10 = buildCbrRanking(filteredCbrPool.slice(0, 10), 10);
    } catch {
      if (cbrWrap) cbrWrap.innerHTML = '<p class="muted">Could not load CBR top candidates.</p>';
    }

    const llmSignature = buildLLMSelectionSignature(config);
    const cachedSelection = getCachedLLMSelection();
    let llmResult = null;
    if (cachedSelection && cachedSelection.signature === llmSignature) {
      llmResult = { llm_selection: cachedSelection.llm_selection };
      if (llmWrap) {
        llmWrap.innerHTML = '<p class="muted">Using saved LLM selection for current LLM settings...</p>';
      }
    } else {
      try {
        const liveState = {
          model: String((config && config.llm_evaluator && config.llm_evaluator.model) || "gpt-5.4-mini"),
          status: "Starting LLM stream...",
          responseText: "",
          promptSystem: "",
          promptUser: "",
          consideredCandidates: 0,
          timeoutSeconds: 0,
          errorType: "",
          errorMessage: "",
        };

        if (llmWrap) {
          llmWrap.innerHTML = renderLLMLiveSelection(liveState);
        }

        llmResult = await runLLMEvaluate(config, {
          onStart(payload) {
            liveState.model = String(payload.model || liveState.model || "gpt-5.4-mini");
            liveState.consideredCandidates = Number(payload.considered_candidates || 0);
            liveState.timeoutSeconds = Number(payload.timeout_seconds || 0);
            liveState.promptSystem = String(payload.prompt_system || "");
            liveState.promptUser = String(payload.prompt_user || "");
            liveState.status = "Streaming response from OpenAI...";
            if (llmWrap) {
              llmWrap.innerHTML = renderLLMLiveSelection(liveState);
            }
          },
          onDelta(payload) {
            liveState.responseText = String(payload.response_text || liveState.responseText || "");
            liveState.status = "Receiving streamed tokens...";
            if (llmWrap) {
              llmWrap.innerHTML = renderLLMLiveSelection(liveState);
            }
          },
          onError(payload) {
            liveState.errorType = String(payload.error_type || "Error");
            liveState.errorMessage = String(payload.error_message || payload.error || "Unknown LLM error");
            liveState.status = "LLM stream reported an error.";
            if (llmWrap) {
              llmWrap.innerHTML = renderLLMLiveSelection(liveState);
            }
          },
        });

        if (llmResult && llmResult.llm_selection) {
          const filteredSelection = {
            ...llmResult.llm_selection,
            shortlist: filterExcludedCandidates(llmResult.llm_selection.shortlist),
            longlist: filterExcludedCandidates(llmResult.llm_selection.longlist),
          };
          llmResult.llm_selection = filteredSelection;
          saveCachedLLMSelection(llmSignature, filteredSelection);
        }
      } catch (error) {
        if (llmWrap) {
          llmWrap.innerHTML = `
            <section class="llm-results-group">
              <details class="llm-result-item" open>
                <summary><span class="badge warn">Debug</span><span>LLM Request Error</span></summary>
                <pre>${escapeHtml(String((error && error.message) || error || "Unknown LLM request error"))}</pre>
              </details>
            </section>
          `;
        }
      }
    }

    if (llmResult && llmResult.llm_selection) {
      const rankedCandidates = filterExcludedCandidates(Array.isArray(cbrResult && cbrResult.ranked_candidates)
        ? cbrResult.ranked_candidates
        : ((cbrResult && cbrResult.pool) || []));
      const filteredLlmSelection = {
        ...llmResult.llm_selection,
        shortlist: filterExcludedCandidates(llmResult.llm_selection.shortlist),
        longlist: filterExcludedCandidates(llmResult.llm_selection.longlist),
      };
      const fallbackCbrTop = filterExcludedCandidates((cbrResult && cbrResult.pool) || []).slice(0, 10);
      renderPreHeadToHeadComparison(
        fallbackCbrTop,
        filteredLlmSelection,
        [],
      );

      let snapshotVm = null;
      try {
        snapshotVm = await computeSnapshotViewModel(
          rankedCandidates,
          filteredLlmSelection,
        );
      } catch {
        snapshotVm = null;
      }

      const cbrTop = Array.isArray(snapshotVm && snapshotVm.cbr_top)
        ? snapshotVm.cbr_top
        : fallbackCbrTop;
      const normalizedLlmSelection = (snapshotVm && snapshotVm.llm_selection)
        ? snapshotVm.llm_selection
        : filteredLlmSelection;
      const initialSelection = Array.isArray(snapshotVm && snapshotVm.initial_selection)
        ? snapshotVm.initial_selection
        : [];

      const aliasMap = buildCandidateAliasMap([
        ...cbrTop.map((row) => row && row.application_id),
        ...((normalizedLlmSelection.shortlist || []).map((row) => row && row.application_id)),
        ...((normalizedLlmSelection.longlist || []).map((row) => row && row.application_id)),
        ...initialSelection.map((row) => row && row.application_id),
      ]);
      applyCandidateDisplayNames(cbrTop, aliasMap);
      applyCandidateDisplayNames(initialSelection, aliasMap);
      applyCandidateDisplayNames(normalizedLlmSelection.shortlist || [], aliasMap);
      applyCandidateDisplayNames(normalizedLlmSelection.longlist || [], aliasMap);

      const poolCatalog = new Map();
      [
        ...getH2HCandidateCatalog(),
        ...cbrTop,
        ...(normalizedLlmSelection.shortlist || []),
        ...(normalizedLlmSelection.longlist || []),
        ...initialSelection,
      ].forEach((candidate) => {
        const id = String((candidate && candidate.application_id) || "").trim();
        if (!id) return;
        poolCatalog.set(id, candidate);
      });

      const normalizeSelectionRows = (rows) => (Array.isArray(rows) ? rows : [])
        .map((row) => {
          const id = String((row && row.application_id) || "").trim();
          return id ? (poolCatalog.get(id) || { application_id: id }) : null;
        })
        .filter(Boolean);

      const idsSignature = (rows) => rows
        .map((row) => String((row && row.application_id) || "").trim())
        .filter(Boolean)
        .join("|");

      const storedSelection = normalizeSelectionRows(getH2HCandidates());
      const storedState = getH2HState();
      const freshSelection = normalizeSelectionRows(initialSelection);
      const storedSignature = idsSignature(storedSelection);
      const freshSignature = idsSignature(freshSelection);
      const storedMatchesFresh = storedSignature === freshSignature;
      const currentConfigSignature = buildH2HConfigSignature(config);
      const storedSelectionIsCurrent = Boolean(
        storedSelection.length >= 2
        && storedState
        && storedState.cacheVersion === H2H_CACHE_VERSION
        && String(storedState.configSignature || "") === currentConfigSignature
        && String(storedState.signature || "") === storedSignature
      );

      // Keep saved Modify Pool edits for the current config/session, while still
      // discarding stale pools after Configure clears the H2H caches.
      const headToHeadSelection = storedSelectionIsCurrent || (storedSelection.length >= 2 && storedMatchesFresh)
        ? storedSelection
        : freshSelection;

      mergeIntoH2HCandidateCatalog(Array.from(poolCatalog.values()));
      applyCandidateDisplayNames(headToHeadSelection, aliasMap);
      if (headToHeadSelection.length) {
        saveH2HCandidates(headToHeadSelection);
      }
      const nextState = {
        ...(storedState && typeof storedState === "object" ? storedState : {}),
        cacheVersion: H2H_CACHE_VERSION,
        configSignature: currentConfigSignature,
        signature: idsSignature(headToHeadSelection),
        jobDir: String((((cbrResult || {}).metadata || {}).job_dir) || ((storedState || {}).jobDir) || DEFAULT_JOB_DIR_FALLBACK()),
        sourcePath: String((((cbrResult || {}).metadata || {}).source_path) || ((storedState || {}).sourcePath) || DEFAULT_SOURCE_PATH_FALLBACK()),
        comparisons: Array.isArray((storedState || {}).comparisons) ? storedState.comparisons : [],
        finalRankingLogged: false,
      };
      saveH2HState(nextState);
      renderPreHeadToHeadComparison(
        cbrTop,
        normalizedLlmSelection,
        headToHeadSelection,
      );
      snapshotStats.cbr_top_count = cbrTop.length;
      snapshotStats.llm_shortlist_count = Array.isArray(normalizedLlmSelection.shortlist)
        ? normalizedLlmSelection.shortlist.length
        : 0;
      snapshotStats.llm_longlist_count = Array.isArray(normalizedLlmSelection.longlist)
        ? normalizedLlmSelection.longlist.length
        : 0;
      snapshotStats.initial_selection_count = headToHeadSelection.length;
      snapshotStats.cbr_ranking_top10 = buildCbrRanking(cbrTop, 10);
      const llmRankings = buildLlmRankings(normalizedLlmSelection, 10);
      snapshotStats.llm_shortlist_ranking = llmRankings.shortlist;
      snapshotStats.llm_longlist_ranking = llmRankings.longlist;
    }

    return snapshotStats;
  }

  function candidateMap(candidates) {
    const map = {};
    candidates.forEach((c) => {
      map[c.application_id] = c;
    });
    return map;
  }

  function normalizeSectionKey(title) {
    return String(title || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  const CORE_SECTION_TITLE_BY_KEY = {
    education: "Education",
    thesis: "Thesis",
    "research experience": "Research Experience",
    publications: "Publications",
    "methods and skills": "Methods and Skills",
    "teaching and outreach": "Teaching and Outreach",
    "project proposal": "Project Proposal",
  };

  const CORE_SECTION_KEYS = new Set(Object.keys(CORE_SECTION_TITLE_BY_KEY));

  function filterToCoreSections(sections) {
    return (sections || []).filter((section) => CORE_SECTION_KEYS.has(normalizeSectionKey(section.title)));
  }

  function parseSummarySections(summaryText) {
    const text = String(summaryText || "").trim();
    if (!text) return [];

    const parseJsonLikeSummarySections = (rawText) => {
      const lines = String(rawText || "").split("\n");
      const normalizeLine = (line) => String(line || "")
        .replace(/\u00A0/g, " ")
        .replace(/^\s*#{1,6}\s*/, "")
        .replace(/\*\*/g, "")
        .trimEnd();
      const keyMatch = (line) => line.trim().match(/^"?([a-zA-Z_][a-zA-Z0-9_ ]*)"?\s*:\s*(.*)$/);
      const bracketDelta = (line) => {
        const openCount = (line.match(/[\[{]/g) || []).length;
        const closeCount = (line.match(/[\]}]/g) || []).length;
        return openCount - closeCount;
      };

      const sections = [];
      let depth = 0;
      let started = false;
      let current = null;

      lines.forEach((rawLine) => {
        const cleaned = normalizeLine(rawLine);
        if (!cleaned) return;

        if (!started) {
          if (cleaned.includes("{")) {
            started = true;
            depth += bracketDelta(cleaned);
          }
          return;
        }

        const match = depth === 1 ? keyMatch(cleaned) : null;
        if (match) {
          if (current) {
            sections.push({
              title: current.title,
              content: current.lines.join("\n").replace(/^[,\s]+|[,\s]+$/g, "").trim(),
            });
          }
          current = {
            title: String(match[1] || "Section").replace(/_/g, " ").trim(),
            lines: [],
          };
          const remainder = String(match[2] || "").replace(/^[,\s]+|[,\s]+$/g, "").trim();
          if (remainder) {
            current.lines.push(remainder);
          }
        } else if (current) {
          current.lines.push(cleaned);
        }

        depth += bracketDelta(cleaned);
      });

      if (current) {
        sections.push({
          title: current.title,
          content: current.lines.join("\n").replace(/^[,\s]+|[,\s]+$/g, "").trim(),
        });
      }

      return sections.filter((section) => String(section.content || "").trim());
    };

    const sections = [];
    const lines = text.split("\n");
    let currentTitle = "Summary";
    let currentLines = [];

    lines.forEach((line) => {
      const match = line.match(/^===\s*(.+?)\s*===$/);
      if (match) {
        if (currentLines.length || sections.length) {
          sections.push({ title: currentTitle, content: currentLines.join("\n").trim() });
        }
        currentTitle = match[1].trim();
        currentLines = [];
      } else {
        currentLines.push(line);
      }
    });

    if (currentLines.length || !sections.length) {
      sections.push({ title: currentTitle, content: currentLines.join("\n").trim() });
    }

    const normalizedSections = sections.filter((section) => section.content || section.title);
    const shouldTryJsonLikeFallback = normalizedSections.length <= 1
      && /summary of each section|"education"\s*:/i.test(text)
      && text.includes("{")
      && text.includes("}");

    if (shouldTryJsonLikeFallback) {
      const jsonLikeSections = parseJsonLikeSummarySections(text);
      if (jsonLikeSections.length >= 2) {
        return jsonLikeSections;
      }
    }

    return normalizedSections;
  }

  function splitComparableAndExtraSections(sections) {
    const firstExtraIndex = sections.findIndex(
      (section) => normalizeSectionKey(section.title) === "evidenced strengths"
    );
    if (firstExtraIndex < 0) {
      return {
        comparable: sections,
        extra: [],
      };
    }
    return {
      comparable: sections.slice(0, firstExtraIndex),
      extra: sections.slice(firstExtraIndex),
    };
  }

  function mergeComparableSections(leftSections, rightSections) {
    const merged = [];
    const seen = new Set();

    leftSections.concat(rightSections).forEach((section) => {
      const key = normalizeSectionKey(section.title);
      if (!key || seen.has(key)) return;
      seen.add(key);
      merged.push({ key, title: section.title });
    });

    return merged;
  }

  function sectionContentByKey(sections, key) {
    const found = sections.find((section) => normalizeSectionKey(section.title) === key);
    return found && found.content ? found.content : "No information provided for this section.";
  }

  const STRENGTH_SECTION_ALIASES = [
    "evidenced strengths",
    "strengths",
    "key strengths",
    "strengths and fit",
  ];

  const WEAKNESS_SECTION_ALIASES = [
    "evidenced limitations",
    "limitations",
    "weaknesses",
    "concerns",
    "gaps",
    "areas for improvement",
  ];

  function sectionKeyMatchesAliases(sectionKey, aliases) {
    const normalized = normalizeSectionKey(sectionKey);
    return aliases.some((alias) => normalized === alias || normalized.includes(alias));
  }

  function sectionContentByAliases(sections, aliases) {
    const found = (sections || []).find((section) => sectionKeyMatchesAliases(section.title, aliases));
    return found && String(found.content || "").trim()
      ? found.content
      : "No information provided for this section.";
  }

  function parseStructuredSubsections(content) {
    const lines = String(content || "").split("\n");
    const sections = [];
    let current = null;

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      const headerMatch = trimmed.match(/^[-*]?\s*([^:]{1,50}):\s*(.*)$/);
      if (headerMatch) {
        const title = headerMatch[1].trim();
        const value = headerMatch[2].trim();
        current = {
          title,
          bodyLines: value ? [value] : [],
        };
        sections.push(current);
        return;
      }

      if (!current) {
        current = { title: "Overview", bodyLines: [] };
        sections.push(current);
      }

      const bulletMatch = trimmed.match(/^[-*]\s*(.*)$/);
      if (bulletMatch) {
        current.bodyLines.push(`- ${bulletMatch[1].trim()}`);
      } else {
        current.bodyLines.push(trimmed);
      }
    });

    return sections;
  }

  function subsectionMapByTitle(content) {
    const parsed = parseStructuredSubsections(content);
    const map = {};
    parsed.forEach((item) => {
      map[item.title] = item.bodyLines;
    });
    return map;
  }

  function subsectionBodyToHtml(lines) {
    if (!Array.isArray(lines) || !lines.length) {
      return '<div class="section-paragraph">No details provided.</div>';
    }

    return lines.map((line) => {
      const txt = String(line || "").trim();
      if (!txt) return '<div class="section-spacer"></div>';
      if (txt.startsWith("- ")) {
        return `<div class="section-bullet"><span class="section-bullet-mark">-</span><div>${escapeHtml(txt.slice(2))}</div></div>`;
      }
      return `<div class="section-paragraph">${escapeHtml(txt)}</div>`;
    }).join("");
  }

  function alignedSubsectionTitles(leftContent, rightContent) {
    const leftMap = subsectionMapByTitle(leftContent);
    const rightMap = subsectionMapByTitle(rightContent);
    const titles = [];
    const seen = new Set();

    Object.keys(leftMap).concat(Object.keys(rightMap)).forEach((title) => {
      const key = normalizeSectionKey(title);
      if (!key || seen.has(key)) return;
      seen.add(key);
      titles.push(title);
    });

    if (!titles.length) return ["Overview"];
    return titles;
  }

  function renderAlignedSubcardsForSide(content, titles) {
    const sideMap = subsectionMapByTitle(content);
    return titles.map((title) => `
      <div class="subcard">
        <h5><strong>${escapeHtml(title)}</strong></h5>
        ${subsectionBodyToHtml(sideMap[title] || [])}
      </div>
    `).join("");
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function formatSectionContent(content) {
    return String(content || "")
      .replace(/\n- /g, "\n\n- ")
      .replace(/\n  - /g, "\n\n  - ");
  }

  function sectionContentToHtml(content) {
    const toCleanText = (value) => String(value == null ? "" : value)
      .replace(/^\s*"|"\s*$/g, "")
      .replace(/^\s*'+|'+\s*$/g, "")
      .replace(/\\"/g, '"')
      .trim();

    const tryParseStructuredJsonLike = (rawContent) => {
      const raw = String(rawContent || "").trim();
      if (!raw || (!raw.startsWith("[") && !raw.startsWith("{"))) return null;

      const normalized = raw
        .replace(/\u00A0/g, " ")
        .replace(/,\s*([}\]])/g, "$1");
      try {
        return JSON.parse(normalized);
      } catch {
        return null;
      }
    };

    const renderStructuredValue = (value, depth = 0) => {
      if (Array.isArray(value)) {
        return value.map((item) => {
          if (item && typeof item === "object") {
            return `<div class="section-bullet${depth > 0 ? " is-nested" : ""}"><span class="section-bullet-mark">-</span><div>${renderStructuredValue(item, depth + 1)}</div></div>`;
          }
          const text = escapeHtml(toCleanText(item));
          return `<div class="section-bullet${depth > 0 ? " is-nested" : ""}"><span class="section-bullet-mark">-</span><div>${text}</div></div>`;
        }).join("");
      }

      if (value && typeof value === "object") {
        return Object.entries(value).map(([key, nested]) => {
          const label = escapeHtml(toCleanText(String(key || "").replace(/_/g, " ")));
          if (Array.isArray(nested) || (nested && typeof nested === "object")) {
            return `<div class="section-subheading"><strong>${label}:</strong></div>${renderStructuredValue(nested, depth + 1)}`;
          }
          const body = escapeHtml(toCleanText(nested));
          return `<div class="section-subheading"><strong>${label}:</strong>${body ? ` ${body}` : ""}</div>`;
        }).join("");
      }

      const text = escapeHtml(toCleanText(value));
      return text ? `<div class="section-paragraph">${text}</div>` : "";
    };

    const structured = tryParseStructuredJsonLike(content);
    if (structured !== null) {
      const rendered = renderStructuredValue(structured);
      if (rendered) return rendered;
    }

    const lines = formatSectionContent(content).split("\n");
    const html = [];

    lines.forEach((line) => {
      const raw = line || "";
      const trimmed = raw
        .replace(/^\s*\*\*/g, "")
        .replace(/\*\*\s*$/g, "")
        .trim();
      if (!trimmed) {
        html.push('<div class="section-spacer"></div>');
        return;
      }

      if (trimmed === "[" || trimmed === "]" || trimmed === "{" || trimmed === "}" || trimmed === ",") {
        return;
      }

      const quotedListMatch = trimmed.match(/^"(.+)"\s*,?$/);
      if (quotedListMatch) {
        html.push(`<div class="section-bullet"><span class="section-bullet-mark">-</span><div>${escapeHtml(quotedListMatch[1].trim())}</div></div>`);
        return;
      }

      const bulletMatch = raw.match(/^(\s*)-\s+(.*)$/);
      if (bulletMatch) {
        const indent = bulletMatch[1].length > 0 ? " is-nested" : "";
        const body = bulletMatch[2].trim();
        const labelMatch = body.match(/^([^:]{1,40}):\s*(.*)$/);
        if (labelMatch) {
          const label = escapeHtml(labelMatch[1].trim());
          const remainder = escapeHtml(labelMatch[2].trim());
          html.push(`<div class="section-bullet${indent}"><span class="section-bullet-mark">-</span><div><strong>${label}:</strong>${remainder ? ` ${remainder}` : ""}</div></div>`);
        } else {
          html.push(`<div class="section-bullet${indent}"><span class="section-bullet-mark">-</span><div>${escapeHtml(body)}</div></div>`);
        }
        return;
      }

      const labelMatch = trimmed.match(/^([^:]{1,40}):\s*(.*)$/);
      if (labelMatch) {
        const label = escapeHtml(labelMatch[1].trim());
        const remainder = escapeHtml(labelMatch[2].trim());
        html.push(`<div class="section-subheading"><strong>${label}:</strong>${remainder ? ` ${remainder}` : ""}</div>`);
        return;
      }

      html.push(`<div class="section-paragraph">${escapeHtml(trimmed)}</div>`);
    });

    return html.join("");
  }

  function buildSectionComparisonModel(left, right) {
    const leftSections = parseSummarySections(left.summary_text);
    const rightSections = parseSummarySections(right.summary_text);
    const leftSplit = splitComparableAndExtraSections(leftSections);
    const rightSplit = splitComparableAndExtraSections(rightSections);
    const leftCoreComparable = filterToCoreSections(leftSplit.comparable).map((section) => {
      const key = normalizeSectionKey(section.title);
      return { ...section, title: CORE_SECTION_TITLE_BY_KEY[key] || section.title };
    });
    const rightCoreComparable = filterToCoreSections(rightSplit.comparable).map((section) => {
      const key = normalizeSectionKey(section.title);
      return { ...section, title: CORE_SECTION_TITLE_BY_KEY[key] || section.title };
    });

    return {
      comparable: mergeComparableSections(leftCoreComparable, rightCoreComparable),
      leftComparableSections: leftCoreComparable,
      rightComparableSections: rightCoreComparable,
      leftExtraSections: [],
      rightExtraSections: [],
    };
  }

  function renderSectionWinnerSummary(left, right, sectionModel, sectionChoices) {
    const container = document.getElementById("sectionWinnersSummary");
    if (!container) return;

    if (!sectionModel.comparable.length) {
      container.innerHTML = '<p class="muted">No directly comparable sections were found.</p>';
      return;
    }

    const rows = sectionModel.comparable.map((section) => {
      const winner = sectionChoices[section.key];
      let winnerText = "No preference";
      if (winner === left.application_id) winnerText = left.display_name;
      if (winner === right.application_id) winnerText = right.display_name;
      return `<tr><td>${section.title}</td><td>${winnerText}</td></tr>`;
    }).join("");

    const leftWins = Object.values(sectionChoices).filter((winner) => winner === left.application_id).length;
    const rightWins = Object.values(sectionChoices).filter((winner) => winner === right.application_id).length;
    const noPreference = sectionModel.comparable.length - leftWins - rightWins;

    container.innerHTML = `
      <p><strong>Section winners</strong></p>
      <table>
        <thead><tr><th>Section</th><th>Winner</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="muted">${left.display_name}: ${leftWins} | ${right.display_name}: ${rightWins} | No preference: ${noPreference}</p>
    `;
  }

  function renderExtraInfoCards(left, right, sectionModel) {
    const extraWrap = document.getElementById("extraInfoCards");
    if (!extraWrap) return;

    extraWrap.innerHTML = "";
    if (!sectionModel.leftExtraSections.length && !sectionModel.rightExtraSections.length) {
      return;
    }

    const leftCard = document.createElement("article");
    leftCard.className = "card";
    leftCard.innerHTML = `<h3>Additional Notes</h3>`;
    leftCard.appendChild(renderNotesBody(sectionModel.leftExtraSections, sectionModel.rightExtraSections));
    extraWrap.appendChild(leftCard);

    const rightCard = document.createElement("article");
    rightCard.className = "card";
    rightCard.innerHTML = `<h3>Additional Notes</h3>`;
    rightCard.appendChild(renderNotesBody(sectionModel.rightExtraSections, sectionModel.leftExtraSections));
    extraWrap.appendChild(rightCard);

    requestAnimationFrame(() => {
      alignSubcardHeights(leftCard, rightCard);
    });
  }

  function renderNotesBody(sections, peerSections) {
    const wrapper = document.createElement("div");
    wrapper.className = "section-summary-body";
    if (!sections.length) {
      wrapper.innerHTML = '<div class="section-paragraph">No additional notes available.</div>';
      return wrapper;
    }

    const selfMap = {};
    sections.forEach((section) => {
      selfMap[section.title] = section.content;
    });
    const peerMap = {};
    (peerSections || []).forEach((section) => {
      peerMap[section.title] = section.content;
    });

    const titles = [];
    const seen = new Set();
    Object.keys(selfMap).concat(Object.keys(peerMap)).forEach((title) => {
      const key = normalizeSectionKey(title);
      if (!key || seen.has(key)) return;
      seen.add(key);
      titles.push(title);
    });

    wrapper.innerHTML = titles.map((title) => (
      `<section class="notes-section subcard"><h5><strong>${escapeHtml(title)}</strong></h5>${sectionContentToHtml(selfMap[title] || "")}</section>`
    )).join("");
    return wrapper;
  }

  function alignSubcardHeights(leftContainer, rightContainer) {
    if (!leftContainer || !rightContainer) return;

    const leftCards = Array.from(leftContainer.querySelectorAll(".subcard"));
    const rightCards = Array.from(rightContainer.querySelectorAll(".subcard"));
    const count = Math.max(leftCards.length, rightCards.length);

    for (let index = 0; index < count; index += 1) {
      const leftCard = leftCards[index];
      const rightCard = rightCards[index];
      if (!leftCard || !rightCard) continue;

      leftCard.style.minHeight = "0px";
      rightCard.style.minHeight = "0px";
      leftCard.style.height = "auto";
      rightCard.style.height = "auto";

      const rowHeight = Math.ceil(Math.max(leftCard.getBoundingClientRect().height, rightCard.getBoundingClientRect().height));
      leftCard.style.height = `${rowHeight}px`;
      rightCard.style.height = `${rowHeight}px`;
    }
  }

  function renderSectionComparisonCards(left, right, sectionModel, sectionChoices, onChoiceChange) {
    const wrap = document.getElementById("sectionComparisonCards");
    if (!wrap) return;
    wrap.innerHTML = "";

    if (!sectionModel.comparable.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "No directly comparable sections were found in these summaries.";
      wrap.appendChild(empty);
      return;
    }

    sectionModel.comparable.forEach((section) => {
      const selected = sectionChoices[section.key] || "";
      const card = document.createElement("article");
      card.className = "card section-compare-card";

      const heading = document.createElement("h4");
      heading.textContent = section.title;
      card.appendChild(heading);

      const columns = document.createElement("div");
      columns.className = "section-compare-columns";

      const leftButton = document.createElement("button");
      leftButton.type = "button";
      leftButton.className = `section-choice-box${selected === left.application_id ? " selected" : ""}`;
      const leftBody = document.createElement("div");
      leftBody.className = "section-summary-body";
      const leftContent = sectionContentByKey(sectionModel.leftComparableSections, section.key);
      const rightContent = sectionContentByKey(sectionModel.rightComparableSections, section.key);
      const shouldAlignSubcards = ["thesis", "project proposal"].includes(normalizeSectionKey(section.title));
      const sharedTitles = shouldAlignSubcards ? alignedSubsectionTitles(leftContent, rightContent) : [];
      leftBody.innerHTML = shouldAlignSubcards
        ? renderAlignedSubcardsForSide(leftContent, sharedTitles)
        : sectionContentToHtml(leftContent);
      leftButton.appendChild(leftBody);
      leftButton.onclick = () => {
        const nextValue = selected === left.application_id ? null : left.application_id;
        onChoiceChange(section.key, nextValue);
      };

      const rightButton = document.createElement("button");
      rightButton.type = "button";
      rightButton.className = `section-choice-box${selected === right.application_id ? " selected" : ""}`;
      const rightBody = document.createElement("div");
      rightBody.className = "section-summary-body";
      rightBody.innerHTML = shouldAlignSubcards
        ? renderAlignedSubcardsForSide(rightContent, sharedTitles)
        : sectionContentToHtml(rightContent);
      rightButton.appendChild(rightBody);
      rightButton.onclick = () => {
        const nextValue = selected === right.application_id ? null : right.application_id;
        onChoiceChange(section.key, nextValue);
      };

      columns.appendChild(leftButton);
      columns.appendChild(rightButton);
      card.appendChild(columns);

      wrap.appendChild(card);

      if (shouldAlignSubcards) {
        requestAnimationFrame(() => {
          alignSubcardHeights(leftButton, rightButton);
        });
      }
    });
  }

  function renderCurrentPair(candidates, pair, sectionChoices) {
    const cmap = candidateMap(candidates);
    const left = cmap[pair[0]];
    const right = cmap[pair[1]];

    const sectionModel = buildSectionComparisonModel(left, right);
    const pairNames = document.getElementById("pairNames");
    const sectionCompareHeader = document.getElementById("sectionCompareHeader");
    if (pairNames) {
      pairNames.textContent = `${left.display_name} vs ${right.display_name}`;
    }
    if (sectionCompareHeader) {
      sectionCompareHeader.innerHTML = `
        <div class="section-compare-header-cell">${left.display_name}</div>
        <div class="section-compare-header-cell">${right.display_name}</div>
      `;
    }

    const refreshSectionViews = () => {
      renderSectionComparisonCards(left, right, sectionModel, sectionChoices, (sectionKey, value) => {
        if (value) {
          sectionChoices[sectionKey] = value;
        } else {
          delete sectionChoices[sectionKey];
        }
        refreshSectionViews();
      });
      renderSectionWinnerSummary(left, right, sectionModel, sectionChoices);
    };

    refreshSectionViews();
    renderExtraInfoCards(left, right, sectionModel);

    const choiceWrap = document.getElementById("choiceOptions");
    choiceWrap.innerHTML = `
      <div class="winner-choice-grid">
        <label class="winner-choice-card"><input type="radio" name="winnerChoice" value="${left.application_id}" /> <span>${left.display_name}</span></label>
        <label class="winner-choice-card"><input type="radio" name="winnerChoice" value="${right.application_id}" /> <span>${right.display_name}</span></label>
      </div>
    `;

    renderCategoryRadar(left, right);
    renderDetailedFeatureBreakdown(left, right);

    const toggleBtn = document.getElementById("toggleFeatureBreakdown");
    const detailWrap = document.getElementById("featureDetailedWrap");
    if (toggleBtn && detailWrap) {
      detailWrap.hidden = true;
      toggleBtn.textContent = "Show/Hide Details";
      toggleBtn.onclick = () => {
        const isHidden = detailWrap.hidden;
        detailWrap.hidden = !isHidden;
      };
    }
  }

  function categorySubfeatures(candidate, category) {
    const all = (candidate.cbr_breakdown && candidate.cbr_breakdown.subfeatures) || {};
    const categoryData = all[category] || {};
    return categoryData.subfeatures || {};
  }

  function isNumericRaw(value) {
    if (value === null || value === undefined || value === "") return false;
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value === "boolean") return false;
    const parsed = Number(value);
    return Number.isFinite(parsed);
  }

  function renderDetailedFeatureBreakdown(left, right) {
    const wrap = document.getElementById("featureDetailedWrap");
    if (!wrap) return;

    const categories = [
      { key: "education", label: "Education" },
      { key: "experience", label: "Experience" },
      { key: "research_outputs", label: "Research outputs" },
      { key: "skills_and_methods", label: "Skills & methods" },
    ];

    const sections = categories.map((category) => {
      const leftSub = categorySubfeatures(left, category.key);
      const rightSub = categorySubfeatures(right, category.key);
      const keys = [];
      const seen = new Set();
      Object.keys(leftSub).concat(Object.keys(rightSub)).forEach((key) => {
        if (seen.has(key)) return;
        seen.add(key);
        keys.push(key);
      });

      const rows = keys.map((key) => {
        const leftFeature = leftSub[key] || {};
        const rightFeature = rightSub[key] || {};
        const label = leftFeature.label || rightFeature.label || key;
        const leftRawValue = leftFeature.raw;
        const rightRawValue = rightFeature.raw;
        const leftRawText = escapeHtml(String(leftRawValue ?? "-"));
        const rightRawText = escapeHtml(String(rightRawValue ?? "-"));
        const showRawValues = !isNumericRaw(leftRawValue) || !isNumericRaw(rightRawValue);
        const leftScore = Number(leftFeature.score || 0);
        const rightScore = Number(rightFeature.score || 0);

        return `
          <div class="feature-row">
            <div class="feature-name">${escapeHtml(String(label))}</div>
            <div class="feature-bars-stack">
              <div class="feature-candidate-row">
                <div class="bar-track"><div class="bar-fill left" style="width:${Math.round(leftScore * 100)}%"></div></div>
                <div class="bar-value">${leftScore.toFixed(2)}</div>
              </div>
              <div class="feature-candidate-row">
                <div class="bar-track"><div class="bar-fill right" style="width:${Math.round(rightScore * 100)}%"></div></div>
                <div class="bar-value">${rightScore.toFixed(2)}</div>
              </div>
              ${showRawValues ? `<div class="feature-raw-values muted">${escapeHtml(String(left.display_name || "Candidate 1"))}: ${leftRawText} | ${escapeHtml(String(right.display_name || "Candidate 2"))}: ${rightRawText}</div>` : ""}
            </div>
          </div>
        `;
      }).join("");

      return `
        <section class="feature-detail-block">
          <h4>${category.label}</h4>
          <div class="feature-rows">${rows}</div>
        </section>
      `;
    }).join("");

    wrap.innerHTML = `<h4>Detailed Feature Bars</h4>${sections}`;
  }

  function categoryVector(candidate) {
    const scores = (candidate.cbr_breakdown && candidate.cbr_breakdown.aggregates)
      || (candidate.scores && typeof candidate.scores === "object" ? candidate.scores : {});
    return {
      education: Number(scores.education || 0),
      experience: Number(scores.experience || 0),
      research_outputs: Number(scores.research_outputs || 0),
      skills_and_methods: Number(scores.skills_and_methods || 0),
    };
  }

  function renderCategoryRadar(left, right) {
    const canvas = document.getElementById("categoryRadarChart");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const legend = document.getElementById("categoryRadarLegend");

    const leftVector = categoryVector(left);
    const rightVector = categoryVector(right);
    const labels = ["Education", "Experience", "Research", "Skills & methods"];

    const bounds = canvas.getBoundingClientRect();
    const width = Math.max(320, Math.floor(bounds.width || canvas.clientWidth || 640));
    const height = 300;
    const dpr = window.devicePixelRatio || 1;

    canvas.style.height = `${height}px`;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const margin = {
      top: 26,
      right: 58,
      bottom: 54,
      left: 58,
    };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const cx = margin.left + plotWidth / 2;
    const cy = margin.top + plotHeight / 2;
    const radius = Math.max(36, Math.min(plotWidth, plotHeight) * 0.42);
    const stepCount = 5;
    const tau = Math.PI * 2;

    const pointAt = (index, value01) => {
      const angle = -Math.PI / 2 + (index * tau) / labels.length;
      const r = radius * Math.max(0, Math.min(1, value01));
      return {
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r,
      };
    };

    const drawPolygon = (values, stroke, fill) => {
      ctx.beginPath();
      values.forEach((value, i) => {
        const p = pointAt(i, value);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
    };

    ctx.strokeStyle = "rgba(30, 42, 47, 0.22)";
    ctx.fillStyle = "rgba(30, 42, 47, 0.55)";
    ctx.font = "11px 'Space Grotesk', sans-serif";

    for (let s = 1; s <= stepCount; s += 1) {
      const level = s / stepCount;
      ctx.beginPath();
      labels.forEach((_, i) => {
        const p = pointAt(i, level);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.stroke();
    }

    labels.forEach((label, i) => {
      const axisEnd = pointAt(i, 1);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(axisEnd.x, axisEnd.y);
      ctx.stroke();

      const lxRaw = cx + (axisEnd.x - cx) * 1.14;
      const ly = cy + (axisEnd.y - cy) * 1.14;
      const textWidth = ctx.measureText(label).width;

      let lx = lxRaw;
      let align = lx < cx - 2 ? "right" : lx > cx + 2 ? "left" : "center";
      if (align === "left" && lx + textWidth > width - 6) {
        lx = width - 6 - textWidth;
      }
      if (align === "right" && lx - textWidth < 6) {
        lx = 6 + textWidth;
      }
      if (align === "center") {
        lx = Math.min(width - 6 - textWidth / 2, Math.max(6 + textWidth / 2, lx));
      }

      ctx.textAlign = align;
      ctx.textBaseline = ly < cy - 2 ? "bottom" : ly > cy + 2 ? "top" : "middle";
      ctx.fillText(label, lx, Math.min(height - 8, Math.max(10, ly)));
    });

    const leftValues = [
      leftVector.education,
      leftVector.experience,
      leftVector.research_outputs,
      leftVector.skills_and_methods,
    ];
    const rightValues = [
      rightVector.education,
      rightVector.experience,
      rightVector.research_outputs,
      rightVector.skills_and_methods,
    ];

    drawPolygon(leftValues, "#0f766e", "rgba(15, 118, 110, 0.20)");
    drawPolygon(rightValues, "#b45309", "rgba(180, 83, 9, 0.18)");

    if (legend) {
      legend.innerHTML = `
        <span style="display:inline-flex; align-items:center; gap:6px; margin-right:12px;">
          <span style="display:inline-block; width:10px; height:10px; background:#0f766e; border-radius:2px;"></span>${left.display_name}
        </span>
        <span style="display:inline-flex; align-items:center; gap:6px;">
          <span style="display:inline-block; width:10px; height:10px; background:#b45309; border-radius:2px;"></span>${right.display_name}
        </span>
      `;
    }
  }

  function renderRoundRankingPreview(rows) {
    const body = document.getElementById("rankingPreviewTable");
    if (!body) return;
    body.innerHTML = "";
    (rows || []).slice(0, 10).forEach((row) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${row.name}</td><td>${row.baseline_score}</td><td>${row.score}</td><td>${row.wins}</td><td>${row.losses}</td>`;
      body.appendChild(tr);
    });
  }

  async function loadOverviewPage() {
    await ensureWorkflowSessionReady();
    const data = await fetchJSON("/api/overview");
    document.getElementById("datasetSummary").textContent =
      `Dataset: ${data.candidate_count} candidates loaded from ${data.job_dir}.`;

    const notes = document.getElementById("qualityNotes");
    notes.innerHTML = "";
    data.quality_notes.forEach((note) => {
      const li = document.createElement("li");
      li.textContent = note;
      notes.appendChild(li);
    });

    await logStageEvent(
      "overview",
      "page_loaded",
      {},
      {
        job_dir: String(data.job_dir || ""),
        source_path: String(data.source_path || ""),
        candidate_count: Number(data.candidate_count || 0),
      },
    );
  }

  async function loadNTNUKnowledgeBasePage() {
    await ensureWorkflowSessionReady();
    const listWrap = document.getElementById("ntnuKbDocList");
    const rawTitle = document.getElementById("ntnuKbRawTitle");
    const rawSummary = document.getElementById("ntnuKbRawSummary");
    const rawText = document.getElementById("ntnuKbRawText");
    if (!listWrap || !rawTitle || !rawSummary || !rawText) return;

    const payload = await fetchJSON("/api/ntnu-knowledge-base");
    const docs = Array.isArray(payload && payload.documents) ? payload.documents : [];

    if (!docs.length) {
      listWrap.innerHTML = '<p class="muted">No NTNU knowledge-base documents found.</p>';
      return;
    }

    let activeFilename = "";

    const renderList = () => {
      listWrap.innerHTML = docs.map((doc) => {
        const filename = String((doc && doc.filename) || "").trim();
        const summary = String((doc && doc.summary) || "No summary available.");
        const selectedClass = filename === activeFilename ? " active" : "";
        return `
          <article class="profile-summary-section-card" style="margin-top:10px">
            <h4 style="margin:0 0 6px">
              <button type="button" class="ntnu-kb-doc-btn${selectedClass}" data-filename="${escapeHtml(filename)}">${escapeHtml(filename || "Untitled")}</button>
            </h4>
            <p style="margin:0">${escapeHtml(summary)}</p>
          </article>
        `;
      }).join("");

      listWrap.querySelectorAll(".ntnu-kb-doc-btn").forEach((button) => {
        button.addEventListener("click", () => {
          const filename = String(button.getAttribute("data-filename") || "").trim();
          if (!filename) return;
          void loadDoc(filename);
        });
      });
    };

    const loadDoc = async (filename) => {
      activeFilename = filename;
      renderList();
      rawTitle.textContent = filename;
      rawSummary.textContent = "Loading document...";
      rawText.textContent = "";

      try {
        const doc = await fetchJSON(`/api/ntnu-knowledge-base/${encodeURIComponent(filename)}`);
        rawTitle.textContent = String((doc && doc.filename) || filename);
        rawSummary.textContent = String((doc && doc.summary) || "No summary available.");
        rawText.textContent = String((doc && doc.raw_text) || "");
      } catch (error) {
        rawSummary.textContent = `Could not load document: ${String((error && error.message) || error || "Unknown error")}`;
        rawText.textContent = "";
      }
    };

    renderList();
    const firstFilename = String((docs[0] && docs[0].filename) || "").trim();
    if (firstFilename) {
      await loadDoc(firstFilename);
    }
  }

  // Parses a plain-text job ad into labelled sections and renders them
  // as readable `<details>` cards inside `container`.
  function renderJobAdSections(container, jobAdText) {
    if (!container) return;
    const text = String(jobAdText || "").trim();
    if (!text) {
      container.innerHTML = '<p class="muted">No job advertisement available.</p>';
      return;
    }

    // Section headings are lines that appear to be short titles (no punctuation,
    // ≤80 chars, often followed by a blank line or a line starting with content).
    // We split on double-newlines and heuristically detect headings.
    const paragraphs = text.split(/\n{2,}/);
    const HEADING_RE = /^[A-Z][A-Za-z0-9 ,/&–-]{0,79}$/;

    const sections = [];
    let current = null;

    paragraphs.forEach((para) => {
      const trimmed = para.trim();
      if (!trimmed) return;
      const firstLine = trimmed.split("\n")[0].trim();
      if (HEADING_RE.test(firstLine) && trimmed.split("\n").length <= 2) {
        current = { heading: firstLine, body: [] };
        sections.push(current);
        const rest = trimmed.split("\n").slice(1).join("\n").trim();
        if (rest) current.body.push(rest);
      } else {
        if (!current) {
          current = { heading: "Position Overview", body: [] };
          sections.push(current);
        }
        current.body.push(trimmed);
      }
    });

    if (!sections.length) {
      container.innerHTML = `<pre style="white-space:pre-wrap">${escapeHtml(text)}</pre>`;
      return;
    }

    container.innerHTML = sections.map((section, idx) => {
      const bodyHtml = section.body.map((para) => {
        const lines = para.split("\n").map((l) => l.trim()).filter(Boolean);
        const isListLike = lines.length > 1 && lines.every((l) => /^[-•*]/.test(l) || l.length < 120);
        if (isListLike) {
          return `<ul>${lines.map((l) => `<li>${escapeHtml(l.replace(/^[-•*]\s*/, ""))}</li>`).join("")}</ul>`;
        }
        return `<p>${escapeHtml(para.replace(/\n/g, " "))}</p>`;
      }).join("");

      return `
        <details${idx === 0 ? " open" : ""} class="job-ad-section">
          <summary><strong>${escapeHtml(section.heading)}</strong></summary>
          <div class="job-ad-body">${bodyHtml}</div>
        </details>`;
    }).join("");
  }

  async function loadConfigPage() {
    await ensureWorkflowSessionReady();
    const form = document.getElementById("configForm");
    if (!form) return;
    let overviewRequirements = [];

    try {
      const overviewData = await fetchJSON("/api/overview");
      renderJobAdSections(
        document.getElementById("jobAdSections"),
        overviewData.job_ad_full || overviewData.job_ad_preview || "",
      );
      overviewRequirements = Array.isArray(overviewData.must_have_requirements)
        ? overviewData.must_have_requirements.map((item) => String(item || "").trim()).filter((item) => item)
        : [];
    } catch {
      const el = document.getElementById("jobAdSections");
      if (el) el.innerHTML = '<p class="muted">Could not load job advertisement.</p>';
    }

    setConfigForm(defaultConfig());
    const saved = getStoredConfig();
    if (saved) setConfigForm(saved);
    if (!saved || !Array.isArray((((saved || {}).initial_screening || {}).requirements)) || !saved.initial_screening.requirements.length) {
      if (overviewRequirements.length) {
        const merged = getStoredConfig() || defaultConfig();
        merged.initial_screening = {
          ...(merged.initial_screening || {}),
          requirements: overviewRequirements,
        };
        saveStoredConfig(merged);
        setRequirementEntries(overviewRequirements);
      }
    }
    await hydrateConfigPromptPreviews(saved || defaultConfig()).catch(() => {
      const targets = [
        document.getElementById("preselectionPromptPreview"),
        document.getElementById("llmSystemPromptPreview"),
        document.getElementById("fairnessSystemPromptPreview"),
        document.getElementById("ntnuSystemPromptPreview"),
      ];
      targets.forEach((target) => {
        if (target) target.textContent = "Could not load prompt preview.";
      });
    });
    attachPromptPreviewSync();

    document.querySelectorAll("[data-config-tab]").forEach((el) => {
      const nextTab = String(el.getAttribute("data-config-tab") || "initial");
      el.addEventListener("click", () => setConfigPipelineTab(nextTab));
    });
    setConfigPipelineTab("initial");

    ["wEducation", "wExperience", "wResearchOutputs", "wSkillsMethods"].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input", syncWeightLabels);
    });
    const etaInput = document.getElementById("h2hEta");
    if (etaInput) etaInput.addEventListener("input", syncWeightLabels);
    syncWeightLabels();

    const addBackgroundBtn = document.getElementById("addBackgroundEntryBtn");
    if (addBackgroundBtn) {
      addBackgroundBtn.addEventListener("click", () => {
        const wrap = document.getElementById("backgroundEntries");
        if (!wrap) return;
        const row = buildBackgroundEntryRow({ role: "preferred" });
        wrap.appendChild(row);
        const input = row.querySelector(".background-entry-text");
        if (input) {
          input.readOnly = false;
          input.focus();
        }
      });
    }

    const addRequirementBtn = document.getElementById("addRequirementEntryBtn");
    if (addRequirementBtn) {
      addRequirementBtn.addEventListener("click", () => {
        const wrap = document.getElementById("initialRequirementEntries");
        if (!wrap) return;
        const row = buildRequirementEntryRow("");
        wrap.appendChild(row);
        const input = row.querySelector(".background-entry-text");
        if (input) input.focus();
      });
    }

    const resetBtn = document.getElementById("resetConfigBtn");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        const defaults = defaultConfig();
        removeSessionStorageItem(STORAGE_KEY);
        setConfigForm(defaults);
        hydrateConfigPromptPreviews(defaults).catch(() => {});
        const status = document.getElementById("saveStatus");
        if (status) {
          status.textContent = "Defaults restored. Save settings to keep them.";
        }
        logStageEvent(
          "config",
          "reset_defaults",
          {},
          {
            config: summarizeConfigForLog(defaults),
          },
        );
      });
    }

    const saveBtn = document.getElementById("saveConfigBtn");
    if (saveBtn) {
      saveBtn.addEventListener("click", () => {
        const savedConfig = saveConfigFromForm("Settings saved.");
        hydrateConfigPromptPreviews(savedConfig).catch(() => {});
      });
    }

    const continueBtn = document.getElementById("continueConfigBtn");
    if (continueBtn) {
      continueBtn.addEventListener("click", async (ev) => {
        ev.preventDefault();
        const savedConfig = saveConfigFromForm("Settings saved. Continuing...");
        clearSelectionCaches();
        await logStageEvent(
          "config",
          "save_and_continue",
          {
            config: summarizeConfigForLog(savedConfig),
          },
          {
            next_stage: "preselection",
          },
        );
        window.location.href = "/preselection";
      });
    }

    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const savedConfig = saveConfigFromForm("Settings saved.");
      hydrateConfigPromptPreviews(savedConfig).catch(() => {});
    });
  }

  async function loadPreselectionPage() {
    await ensureWorkflowSessionReady();
    const meta = document.getElementById("preselectionMeta");
    const omittedWrap = document.getElementById("preselectionOmittedList");
    const status = document.getElementById("preselectionStatus");
    const requirementsWrap = document.getElementById("preselectionRequirements");
    const runBtn = document.getElementById("runPreselectionBtn");
    const continueBtn = document.getElementById("continueToModelSnapshotBtn");
    if (!meta || !omittedWrap || !status || !requirementsWrap || !runBtn || !continueBtn) return;

    const config = getStoredConfig() || defaultConfig();
    let requirements = Array.isArray((((config || {}).initial_screening || {}).requirements))
      ? config.initial_screening.requirements.map((item) => String(item || "").trim()).filter((item) => item)
      : [];

    if (!requirements.length) {
      try {
        const overview = await fetchJSON("/api/overview");
        requirements = Array.isArray(overview.must_have_requirements)
          ? overview.must_have_requirements.map((item) => String(item || "").trim()).filter((item) => item)
          : [];
      } catch {
        requirements = [];
      }
    }

    config.initial_screening = {
      ...(config.initial_screening || {}),
      requirements,
      excluded_candidate_ids: Array.isArray((config.initial_screening || {}).excluded_candidate_ids)
        ? config.initial_screening.excluded_candidate_ids
        : [],
    };
    saveStoredConfig(config);

    requirementsWrap.innerHTML = requirements.length
      ? `<ul>${requirements.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
      : '<p class="muted">No requirements available. Go back to Configure and add must-have requirements.</p>';

    const runResult = await runPipeline({
      ...config,
      initial_screening: {
        ...(config.initial_screening || {}),
        excluded_candidate_ids: [],
      },
    }).catch(() => null);
    const candidateRows = Array.isArray((runResult && runResult.ranked_candidates))
      ? runResult.ranked_candidates
      : [];
    const candidateNameById = new Map(candidateRows.map((row) => [
      String((row && row.application_id) || "").trim(),
      String((row && (row.display_name || row.name || row.application_id)) || "").trim(),
    ]));

    const state = loadPreselectionState();
    let omittedCandidates = Array.isArray(state.omitted_candidates)
      ? state.omitted_candidates
      : [];

    const parseOmissionFields = (row) => {
      const splitCombinedText = (text) => {
        const source = String(text || "").trim();
        if (!source) {
          return {
            failedRequirement: "Not specified",
            evidence: "Not specified",
          };
        }

        const causalSplit = source.split(/\b(?:because|since|due to|based on|evidenced by|as shown by)\b/i);
        if (causalSplit.length >= 2) {
          return {
            failedRequirement: causalSplit[0].trim().replace(/[\s:;,-]+$/, "") || "Not specified",
            evidence: causalSplit.slice(1).join(" ").trim() || "Not specified",
          };
        }

        const semicolonIndex = source.indexOf(";");
        if (semicolonIndex > 0 && semicolonIndex < source.length - 1) {
          return {
            failedRequirement: source.slice(0, semicolonIndex).trim().replace(/[\s:;,-]+$/, "") || "Not specified",
            evidence: source.slice(semicolonIndex + 1).trim() || "Not specified",
          };
        }

        const colonIndex = source.indexOf(":");
        if (colonIndex > 0 && colonIndex < source.length - 1) {
          return {
            failedRequirement: source.slice(0, colonIndex).trim() || "Not specified",
            evidence: source.slice(colonIndex + 1).trim() || "Not specified",
          };
        }

        const dashSplit = source.split(/\s[-–]\s/);
        if (dashSplit.length >= 2) {
          return {
            failedRequirement: dashSplit[0].trim() || "Not specified",
            evidence: dashSplit.slice(1).join(" - ").trim() || "Not specified",
          };
        }

        const sentenceSplit = source.match(/^(.+?[.!?])\s+(.+)$/);
        if (sentenceSplit) {
          return {
            failedRequirement: sentenceSplit[1].trim() || "Not specified",
            evidence: sentenceSplit[2].trim() || "Not specified",
          };
        }

        return {
          failedRequirement: source,
          evidence: "Not specified",
        };
      };

      const requirementRaw = String((row && (row.failed_requirement || row.requirement || row.requirement_text)) || "").trim();
      const evidenceRaw = String((row && (row.evidence || row.evidence_text || row.justification)) || "").trim();
      const reason = String((row && row.reason) || "").trim();

      if (requirementRaw || evidenceRaw) {
        if (!evidenceRaw && requirementRaw) {
          return splitCombinedText(requirementRaw);
        }
        return {
          failedRequirement: requirementRaw || "Not specified",
          evidence: evidenceRaw || "Not specified",
        };
      }

      if (!reason) {
        return {
          failedRequirement: "Not specified",
          evidence: "Not specified",
        };
      }

      return splitCombinedText(reason);
    };

    const renderOmitted = () => {
      if (!omittedCandidates.length) {
        omittedWrap.innerHTML = '<p class="muted">No candidates are currently omitted.</p>';
        return;
      }

      omittedWrap.innerHTML = `<div class="preselection-omitted-table-wrap"><table class="preselection-omitted-table"><thead><tr><th>Candidate</th><th>Failed Requirement</th><th>Evidence</th></tr></thead><tbody>${omittedCandidates.map((row) => {
        const id = String((row && row.application_id) || "").trim();
        const label = escapeHtml(aliasForApplicationId(id, candidateRows));
        const parsed = parseOmissionFields(row);
        return `<tr>
          <td><div class="preselection-candidate-cell"><button type="button" class="btn secondary background-entry-remove preselection-remove-btn" data-remove-id="${escapeHtml(id)}" title="Return candidate to selection pool" aria-label="Return candidate to selection pool">x</button><a class="info-link" href="/candidate-profiles?candidate_id=${encodeURIComponent(id)}&source=omitted">${label}</a></div></td>
          <td>${escapeHtml(parsed.failedRequirement)}</td>
          <td>${escapeHtml(parsed.evidence)}</td>
        </tr>`;
      }).join("")}</tbody></table></div>`;

      omittedWrap.querySelectorAll(".preselection-remove-btn").forEach((button) => {
        button.addEventListener("click", () => {
          const removeId = String(button.getAttribute("data-remove-id") || "").trim();
          omittedCandidates = omittedCandidates.filter((row) => String((row && row.application_id) || "").trim() !== removeId);
          savePreselectionState({
            ...loadPreselectionState(),
            omitted_candidates: omittedCandidates,
          });
          status.textContent = "Candidate returned to selection pool.";
          renderOmitted();
        });
      });
    };

    const applyOmittedToConfig = () => {
      const nextConfig = getStoredConfig() || defaultConfig();
      const excludedIds = omittedCandidates
        .map((row) => String((row && row.application_id) || "").trim())
        .filter((id) => id);
      nextConfig.initial_screening = {
        ...(nextConfig.initial_screening || {}),
        requirements,
        excluded_candidate_ids: excludedIds,
      };
      saveStoredConfig(nextConfig);
      clearSelectionCaches();
      savePreselectionState({
        ...loadPreselectionState(),
        omitted_candidates: omittedCandidates,
        requirements,
      });
      return excludedIds.length;
    };

    if (!omittedCandidates.length && requirements.length) {
      status.textContent = "Running initial screening...";
      const response = await runPreselection(config, requirements).catch(() => null);
      omittedCandidates = Array.isArray((((response || {}).preselection || {}).omitted_candidates))
        ? response.preselection.omitted_candidates
        : [];
      savePreselectionState({
        ...state,
        requirements,
        omitted_candidates: omittedCandidates,
      });
      const omittedCount = applyOmittedToConfig();
      status.textContent = `Initial screening complete. ${omittedCount} candidate(s) omitted.`;
    } else {
      const omittedCount = applyOmittedToConfig();
      status.textContent = omittedCount
        ? `Loaded previous initial screening state with ${omittedCount} omitted candidate(s).`
        : "No candidates omitted yet.";
    }

    renderOmitted();
    meta.textContent = `Review omitted candidates before continuing to selection pool. ${requirements.length} requirement(s) active.`;

    runBtn.addEventListener("click", async () => {
      status.textContent = "Running initial screening...";
      runBtn.disabled = true;
      omittedCandidates = [];
      applyOmittedToConfig();
      renderOmitted();
      try {
        const latestConfig = getStoredConfig() || defaultConfig();
        const response = await runPreselection(latestConfig, requirements);
        omittedCandidates = Array.isArray((((response || {}).preselection || {}).omitted_candidates))
          ? response.preselection.omitted_candidates
          : [];
        const omittedCount = applyOmittedToConfig();
        status.textContent = `Initial screening complete. ${omittedCount} candidate(s) omitted.`;
        renderOmitted();
      } catch (error) {
        status.textContent = `Initial screening failed: ${String((error && error.message) || error || "Unknown error")}`;
      } finally {
        runBtn.disabled = false;
      }
    });

    continueBtn.addEventListener("click", async () => {
      const omittedCount = applyOmittedToConfig();
      await logStageEvent(
        "preselection",
        "continue_to_model_snapshot",
        {
          requirement_count: requirements.length,
          omitted_count: omittedCount,
        },
        {
          next_stage: "model-snapshot",
        },
      );
      window.location.href = "/model-snapshot";
    });
  }

  async function loadModelSnapshotPage() {
    await ensureWorkflowSessionReady();
    const config = getStoredConfig() || defaultConfig();
    const preselectionState = loadPreselectionState();
    const omittedIds = (Array.isArray(preselectionState.omitted_candidates)
      ? preselectionState.omitted_candidates
      : [])
      .map((row) => String((row && row.application_id) || "").trim())
      .filter((id) => id);
    if (omittedIds.length) {
      const existingExcluded = Array.isArray((((config || {}).initial_screening || {}).excluded_candidate_ids))
        ? config.initial_screening.excluded_candidate_ids.map((id) => String(id || "").trim()).filter((id) => id)
        : [];
      const mergedExcluded = Array.from(new Set([...existingExcluded, ...omittedIds]));
      config.initial_screening = {
        ...(config.initial_screening || {}),
        excluded_candidate_ids: mergedExcluded,
      };
      saveStoredConfig(config);
    }
    const meta = document.getElementById("snapshotMeta");
    initSnapshotLLMHeightSync();
    if (meta) {
      meta.textContent = "Loading CBR and LLM model selections...";
    }

    try {
      const snapshotStats = await loadPreHeadToHeadComparison(config, null);
      if (meta) {
        meta.textContent = "Snapshot ready. Review and continue to head-to-head rounds.";
      }
      await logStageEvent(
        "model_snapshot",
        "snapshot_ready",
        {
          config: summarizeConfigForLog(config),
        },
        {
          cbr_top_count: Number((snapshotStats && snapshotStats.cbr_top_count) || 0),
          llm_shortlist_count: Number((snapshotStats && snapshotStats.llm_shortlist_count) || 0),
          llm_longlist_count: Number((snapshotStats && snapshotStats.llm_longlist_count) || 0),
          initial_selection_count: Number((snapshotStats && snapshotStats.initial_selection_count) || 0),
          cbr_ranking_top10: Array.isArray((snapshotStats && snapshotStats.cbr_ranking_top10))
            ? snapshotStats.cbr_ranking_top10
            : [],
          llm_shortlist_ranking: Array.isArray((snapshotStats && snapshotStats.llm_shortlist_ranking))
            ? snapshotStats.llm_shortlist_ranking
            : [],
          llm_longlist_ranking: Array.isArray((snapshotStats && snapshotStats.llm_longlist_ranking))
            ? snapshotStats.llm_longlist_ranking
            : [],
        },
      );
    } catch {
      if (meta) {
        meta.textContent = "Could not load full snapshot data. You can still continue to head-to-head.";
      }
      await logStageEvent(
        "model_snapshot",
        "snapshot_partial",
        {
          config: summarizeConfigForLog(config),
        },
        {
          status: "partial_or_failed",
        },
      );
    }

    const continueBtn = document.getElementById("continueToHeadToHeadBtn");
    if (continueBtn) {
      continueBtn.onclick = () => {
        logStageEvent(
          "model_snapshot",
          "continue_to_head_to_head",
          {},
          { next_stage: "head-to-head" },
        );
        window.location.href = "/head-to-head";
      };
    }

    if (!window.__biasSnapshotResizeBound) {
      window.__biasSnapshotResizeBound = true;
      window.addEventListener("resize", () => {
        syncSnapshotLLMHeight();
      });
    }

    syncSnapshotLLMHeight();
    setTimeout(syncSnapshotLLMHeight, 0);

    const modifyBtn = document.getElementById("modifyHeadToHeadPoolBtn");
    if (modifyBtn) {
      modifyBtn.onclick = () => {
        logStageEvent(
          "model_snapshot",
          "modify_head_to_head_pool",
          {},
          { next_stage: "candidate-profiles" },
        );
        window.location.href = "/candidate-profiles";
      };
    }
  }

  async function loadHeadToHeadPage() {
    await ensureWorkflowSessionReady();
    ensureTopScrollAfterRoundSubmit();

    const runMeta = document.getElementById("runMeta");
    runMeta.textContent = "Preparing candidate pool...";
    const config = getStoredConfig() || defaultConfig();
    const configSignature = buildH2HConfigSignature(config);
    const existing = getH2HState();

    let resultMeta = null;
    let runResult = null;
    let candidates = getH2HCandidates();
    let usedCache = false;

    const cacheHasSectionedSummary = Array.isArray(candidates)
      && candidates.every((c) => String(c.summary_text || "").includes("=== "));

    const hasValidCachedCandidates = Boolean(
      Array.isArray(candidates)
      && candidates.length >= 2
      && candidates.length <= H2H_POOL_SIZE
      && cacheHasSectionedSummary
    );

    if (!hasValidCachedCandidates) {
      runResult = await runPipeline(config);
      candidates = (runResult.pool || []).slice(0, H2H_POOL_SIZE);
      resultMeta = runResult.meta || null;
      saveH2HCandidates(candidates);
      mergeIntoH2HCandidateCatalog(candidates);
    } else {
      usedCache = true;
      mergeIntoH2HCandidateCatalog(candidates);
    }

    if (!Array.isArray(candidates) || candidates.length < 2) {
      runMeta.textContent = "Need at least 2 candidates in the comparison pool.";
      return;
    }

    const signature = candidates.map((c) => c.application_id).join("|");

    let state;
    const existingMatches = Boolean(
      existing
      && existing.cacheVersion === H2H_CACHE_VERSION
      && existing.signature === signature
      && existing.configSignature === configSignature
    );

    if (!existingMatches) {
      state = {
        cacheVersion: H2H_CACHE_VERSION,
        signature,
        configSignature,
        aliasMap: null,
        finalRankingLogged: false,
        jobDir: (resultMeta && resultMeta.job_dir) || DEFAULT_JOB_DIR_FALLBACK(),
        sourcePath: (resultMeta && resultMeta.source_path) || DEFAULT_SOURCE_PATH_FALLBACK(),
        comparisons: [],
      };
    } else {
      state = existing;
      state.comparisons = Array.isArray(state.comparisons) ? state.comparisons : [];
    }

    ensureCandidateAliases(candidates, state);
    saveH2HState(state);
    saveH2HCandidates(candidates);

    const h2hState = await computeH2HState(candidates, state.comparisons || []);
    const completed = Number(h2hState.completed_eligible_pairs || 0);
    const eligible = Number(h2hState.eligible_pair_count || 0);
    const suggestedComparisons = Math.max(0, Math.floor(eligible / 2));
    document.getElementById("roundProgress").textContent =
      `${Math.min(completed, suggestedComparisons)}/${suggestedComparisons} suggested comparisons.`;

    const nextPair = Array.isArray(h2hState.next_pair) && h2hState.next_pair.length === 2 ? h2hState.next_pair : null;
    if (!nextPair) {
      runMeta.textContent = "No available pair to compare.";
      return;
    }

    if (resultMeta) {
      runMeta.textContent = `Using ${resultMeta.candidate_count} candidates from ${resultMeta.job_dir}. Comparing pool of ${candidates.length}.`;
    } else if (usedCache) {
      runMeta.textContent = `Using cached comparison pool of ${candidates.length} candidates.`;
    } else {
      runMeta.textContent = `Comparing pool of ${candidates.length} candidates.`;
    }
    const sectionChoices = {};
    renderCurrentPair(candidates, nextPair, sectionChoices);
    renderRoundRankingPreview(h2hState.rows || []);

    await logStageEvent(
      "head_to_head",
      "page_loaded",
      {
        pool_size: candidates.length,
        comparison_count: Array.isArray(state.comparisons) ? state.comparisons.length : 0,
      },
      {
        eligible_pairs: Number(h2hState.eligible_pair_count || 0),
        completed_pairs: Number(h2hState.completed_eligible_pairs || 0),
        next_pair: Array.isArray(nextPair) ? nextPair : [],
      },
    );

    document.getElementById("submitComparisonBtn").onclick = () => {
      const selected = document.querySelector('input[name="winnerChoice"]:checked');
      const rationale = (document.getElementById("comparisonRationale").value || "").trim();
      if (!selected) {
        document.getElementById("roundStatus").textContent = "Select a final winner for this round.";
        return;
      }
      if (!rationale) {
        document.getElementById("roundStatus").textContent = "Please add a brief rationale.";
        return;
      }

      const winner = selected.value;
      const loser = winner === nextPair[0] ? nextPair[1] : nextPair[0];
      state.comparisons.push({
        left: nextPair[0],
        right: nextPair[1],
        winner,
        loser,
        rationale,
        section_winners: { ...sectionChoices },
      });
      saveH2HState(state);
      logStageEvent(
        "head_to_head",
        "round_submitted",
        {
          left: nextPair[0],
          right: nextPair[1],
          winner,
          loser,
          rationale_length: rationale.length,
          section_winner_count: Object.keys(sectionChoices).length,
        },
        {
          comparison_count: state.comparisons.length,
        },
      );
      sessionStorage.setItem(H2H_SCROLL_TOP_KEY, "1");
      window.location.reload();
    };

    document.getElementById("finishRoundsBtn").onclick = async () => {
      const status = document.getElementById("roundStatus");
      try {
        await logFinalRanking(state, candidates);
      } catch (error) {
        if (status) {
          status.textContent = "Could not save final ranking to backend log.";
        }
        return;
      }
      await logStageEvent(
        "head_to_head",
        "finish_rounds",
        {
          comparison_count: Array.isArray(state.comparisons) ? state.comparisons.length : 0,
        },
        {
          next_stage: "top-candidates",
        },
      );
      window.location.href = "/top-candidates";
    };
  }

  async function loadTopCandidatesPage() {
    await ensureWorkflowSessionReady();
    const candidates = getH2HCandidates();
    const state = getH2HState();
    const shortlistWrap = document.getElementById("shortlistCandidatesList");
    const longlistWrap = document.getElementById("longlistCandidatesList");
    const fairnessStatus = document.getElementById("topFairnessStatus");
    const fairnessSummary = document.getElementById("topFairnessSummary");
    if (!candidates.length || !state) {
      document.getElementById("topMeta").textContent = "No head-to-head data found. Run rounds first.";
      return;
    }

    ensureCandidateAliases(candidates, state);
    try {
      await logFinalRanking(state, candidates);
    } catch {
      // Preserve page functionality even if backend log writing fails.
    }
    saveH2HState(state);
    saveH2HCandidates(candidates);

    const h2hState = await computeH2HState(candidates, state.comparisons || []);
    const rows = Array.isArray(h2hState.rows) ? h2hState.rows : [];
    const shortlistRows = rows.slice(0, 6);
    const longlistRows = rows.slice(6);
    document.getElementById("topMeta").textContent = `${Array.isArray(state.comparisons) ? state.comparisons.length : 0} comparisons recorded. ${shortlistRows.length} in shortlist, ${longlistRows.length} in longlist.`;

    const renderGroupedList = (target, listRows, emptyMessage) => {
      if (!target) return;
      if (!Array.isArray(listRows) || !listRows.length) {
        target.innerHTML = `<p class="muted">${emptyMessage}</p>`;
        return;
      }
      const items = listRows.map((row) => {
        const id = String((row && row.application_id) || "").trim();
        const name = escapeHtml(String((row && row.name) || id || "candidate"));
        const profileUrl = `/candidate-profiles?candidate_id=${encodeURIComponent(id)}`;
        return `<li><strong><a class="info-link" href="${profileUrl}">${name}</a></strong> <span class="muted">(W ${Number(row.wins || 0)} / L ${Number(row.losses || 0)})</span></li>`;
      }).join("");
      target.innerHTML = `<ul class="candidate-rank-list">${items}</ul>`;
    };

    renderGroupedList(shortlistWrap, shortlistRows, "No shortlisted candidates yet.");
    renderGroupedList(longlistWrap, longlistRows, "No longlist candidates yet.");

    await logStageEvent(
      "top_candidates",
      "page_loaded",
      {
        comparison_count: Array.isArray(state.comparisons) ? state.comparisons.length : 0,
      },
      {
        top_candidate_ids: shortlistRows.map((row) => String(row.application_id || "")),
        top_scores: shortlistRows.map((row) => Number(row.score || 0)),
      },
    );

    if (fairnessSummary) {
      fairnessSummary.innerHTML = '<p class="muted">Analyzing decision trends and fairness flags...</p>';
    }

    const byId = candidateMap(candidates);
    const candidateMetadata = rows.map((row) => {
      const id = String((row && row.application_id) || "").trim();
      const candidate = byId[id] || {};
      return {
        application_id: id,
        display_name: String((candidate && candidate.display_name) || (row && row.name) || id),
        summary_text: String((candidate && candidate.summary_text) || ""),
        rank: Number(row && row.rank ? row.rank : 0),
        score: Number((row && row.score) || 0),
        wins: Number((row && row.wins) || 0),
        losses: Number((row && row.losses) || 0),
      };
    });

    const aliasedComparisons = (state.comparisons || []).map((comparison) => {
      const mappedWinners = {};
      Object.entries(comparison.section_winners || {}).forEach(([sectionKey, winnerId]) => {
        mappedWinners[sectionKey] = aliasForApplicationId(winnerId, candidates);
      });

      return {
        left: aliasForApplicationId(comparison.left, candidates),
        right: aliasForApplicationId(comparison.right, candidates),
        winner: aliasForApplicationId(comparison.winner, candidates),
        loser: aliasForApplicationId(comparison.loser, candidates),
        rationale: String(comparison.rationale || ""),
        section_winners: mappedWinners,
      };
    });

    const fairnessConfig = ((getStoredConfig() || defaultConfig()).fairness_assistant) || {};
    try {
      if (fairnessStatus) fairnessStatus.textContent = "Reviewing trend patterns and rationale consistency...";
      const fairnessResponse = await requestFairnessQAStream({
        question: "Summarize decision-making trends from these head-to-head outcomes and rationales. Flag any inconsistencies, unfairness signals, or questionable rationales. Keep it succinct.",
        optional_context: {
          stage: "top_candidates",
          shortlist: shortlistRows.map((row) => ({
            application_id: String(row.application_id || ""),
            name: String(row.name || row.application_id || "candidate"),
            score: Number(row.score || 0),
          })),
          longlist: longlistRows.map((row) => ({
            application_id: String(row.application_id || ""),
            name: String(row.name || row.application_id || "candidate"),
            score: Number(row.score || 0),
          })),
          candidate_metadata: candidateMetadata,
          decisions: aliasedComparisons,
        },
        fairness_config: {
          model: String(fairnessConfig.model || "gpt-5.4-mini"),
          key_name: String(fairnessConfig.key_name || "OPENAI_KEY"),
          config_path: String(fairnessConfig.config_path || "prompts/CONFIG.txt"),
          prompt_dir: String(fairnessConfig.prompt_dir || "prompts/eval_assistants"),
          additional_instructions: String(fairnessConfig.additional_instructions || ""),
        },
      });

      const payload = fairnessResponse && typeof fairnessResponse.response === "object"
        ? fairnessResponse.response
        : {};
      const trends = Array.isArray(payload.trends) ? payload.trends : [];
      const rawFlags = Array.isArray(payload.issues)
        ? payload.issues
        : (Array.isArray(payload.potential_risks) ? payload.potential_risks : []);
      const flags = rawFlags.map((item) => {
        if (item && typeof item === "object") return item;
        return {
          type: "Potential concern",
          description: String(item || ""),
          severity: "medium",
        };
      }).filter((item) => String(item.description || item.message || "").trim());
      const summaryText = String(payload.summary || payload.answer || fairnessResponse.response_text || "").trim();

      const trendsHtml = trends.length
        ? `<div><strong>Decision trends</strong><ul>${trends.map((item) => `<li>${escapeHtml(String(item || ""))}</li>`).join("")}</ul></div>`
        : "";

      const flagsHtml = Array.isArray(flags) && flags.length
        ? `<div><strong>Flags</strong>${formatFairnessIssuesHtml(flags)}</div>`
        : '<div><strong>Flags</strong><div class="fairness-item ok">No specific inconsistencies or fairness concerns were flagged.</div></div>';

      if (fairnessSummary) {
        fairnessSummary.innerHTML = `
          ${summaryText ? `<div class="fairness-item"><strong>Summary</strong><div>${escapeHtml(summaryText)}</div></div>` : ""}
          ${trendsHtml}
          ${flagsHtml}
        `;
      }
      if (fairnessStatus) fairnessStatus.textContent = "Fairness review complete.";
    } catch (error) {
      if (fairnessStatus) fairnessStatus.textContent = "Could not complete fairness review.";
      if (fairnessSummary) {
        fairnessSummary.innerHTML = `<div class="fairness-item warn">${escapeHtml(String((error && error.message) || error || "Unknown fairness review error"))}</div>`;
      }
    }
  }

  function renderSingleCandidateRadar(candidate) {
    const canvas = document.getElementById("profileRadarChart");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const vector = categoryVector(candidate);
    const labels = ["Education", "Experience", "Research", "Skills & methods"];
    const values = [
      vector.education,
      vector.experience,
      vector.research_outputs,
      vector.skills_and_methods,
    ];

    const bounds = canvas.getBoundingClientRect();
    const width = Math.max(320, Math.floor(bounds.width || canvas.clientWidth || 640));
    const height = 280;
    const dpr = window.devicePixelRatio || 1;

    canvas.style.height = `${height}px`;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.max(34, Math.min(width, height) * 0.34);
    const stepCount = 5;
    const tau = Math.PI * 2;
    const pointAt = (index, value01) => {
      const angle = -Math.PI / 2 + (index * tau) / labels.length;
      const r = radius * Math.max(0, Math.min(1, value01));
      return {
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r,
      };
    };

    ctx.strokeStyle = "rgba(30, 42, 47, 0.22)";
    ctx.fillStyle = "rgba(30, 42, 47, 0.55)";
    ctx.font = "11px 'Space Grotesk', sans-serif";

    for (let s = 1; s <= stepCount; s += 1) {
      const level = s / stepCount;
      ctx.beginPath();
      labels.forEach((_, i) => {
        const p = pointAt(i, level);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.stroke();
    }

    labels.forEach((label, i) => {
      const axisEnd = pointAt(i, 1);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(axisEnd.x, axisEnd.y);
      ctx.stroke();
      ctx.fillText(label, axisEnd.x * 0.94 + cx * 0.06 - 26, axisEnd.y * 0.94 + cy * 0.06);
    });

    ctx.beginPath();
    values.forEach((value, index) => {
      const p = pointAt(index, value);
      if (index === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.fillStyle = "rgba(201, 95, 45, 0.2)";
    ctx.strokeStyle = "#c95f2d";
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();

    const legend = document.getElementById("profileRadarLegend");
    if (legend) {
      legend.textContent = `Category profile for ${candidate.display_name || candidate.name || candidate.application_id}`;
    }

    const scoreWrap = document.getElementById("profileRadarScores");
    if (scoreWrap) {
      scoreWrap.innerHTML = `
        <div class="profile-radar-score-item"><span>Education</span><strong>${Number(vector.education || 0).toFixed(2)}</strong></div>
        <div class="profile-radar-score-item"><span>Experience</span><strong>${Number(vector.experience || 0).toFixed(2)}</strong></div>
        <div class="profile-radar-score-item"><span>Research</span><strong>${Number(vector.research_outputs || 0).toFixed(2)}</strong></div>
        <div class="profile-radar-score-item"><span>Skills</span><strong>${Number(vector.skills_and_methods || 0).toFixed(2)}</strong></div>
      `;
    }
  }

  function renderSingleCandidateSubfeatures(candidate) {
    const wrap = document.getElementById("profileSubfeatureBars");
    const wrapOuter = document.getElementById("profileSubfeatureBarsWrap");
    const toggleBtn = document.getElementById("profileSubfeaturesToggle");
    if (!wrap) return;

    const categories = [
      { key: "education", label: "Education" },
      { key: "experience", label: "Experience" },
      { key: "research_outputs", label: "Research outputs" },
      { key: "skills_and_methods", label: "Skills & methods" },
    ];

    const mapFeatureCategory = (featureKey) => {
      const key = String(featureKey || "").toLowerCase();
      if (!key) return "skills_and_methods";
      if (/(education|degree|thesis|gpa|academic|study|master|phd)/.test(key)) return "education";
      if (/(experience|employment|intern|industry|teaching|leadership|years)/.test(key)) return "experience";
      if (/(research|publication|paper|citation|conference|journal|proposal)/.test(key)) return "research_outputs";
      return "skills_and_methods";
    };

    const humanizeFeatureLabel = (featureKey) => {
      const raw = String(featureKey || "").trim().toLowerCase();
      if (!raw) return "Feature";
      const tokens = raw.split(/_+/g).filter(Boolean);
      const mapped = tokens.map((token) => {
        if (token === "gpa") return "GPA";
        if (token === "phd") return "PhD";
        if (token === "msc") return "MSc";
        if (token === "ba") return "BA";
        if (token === "bsc") return "BSc";
        if (token === "num") return "#";
        if (token === "0" || token === "100") return token;
        return token.charAt(0).toUpperCase() + token.slice(1);
      });
      return mapped
        .join(" ")
        .replace(/\s+#\s+/g, " #")
        .replace(/\b0 100\b/g, "(0-100)")
        .replace(/\s+/g, " ")
        .trim();
    };

    const keyLikelyNumeric = (featureKey) => {
      const key = String(featureKey || "").toLowerCase();
      return /(normalized|years|num|count|score|level|gpa|grade|months|percent|ratio|has_)/.test(key);
    };

    const normalizedScoreFromValue = (value) => {
      if (typeof value === "boolean") return value ? 1 : 0;
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return null;
      if (numeric >= 0 && numeric <= 1) return numeric;
      if (numeric >= 0 && numeric <= 100) return numeric / 100;
      return null;
    };

    const formatRawFeatureValue = (value) => {
      if (value === null || value === undefined || value === "") return "";
      if (typeof value === "boolean") return value ? "Yes" : "No";
      if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
      if (Array.isArray(value)) return value.map((item) => String(item)).join(", ");
      if (typeof value === "object") {
        try {
          return JSON.stringify(value);
        } catch {
          return String(value);
        }
      }
      return String(value);
    };

    const buildSubfeaturesFromCbrFeatures = (sourceCandidate) => {
      const source = (sourceCandidate && sourceCandidate.cbr_features && typeof sourceCandidate.cbr_features === "object")
        ? sourceCandidate.cbr_features
        : {};
      const categoryMap = {
        education: { subfeatures: {} },
        experience: { subfeatures: {} },
        research_outputs: { subfeatures: {} },
        skills_and_methods: { subfeatures: {} },
      };

      const addFeature = (categoryKey, featureKey, rawValue) => {
        if (!featureKey) return;
        let score = normalizedScoreFromValue(rawValue);
        let raw = rawValue;
        let hasExplicitScore = false;
        if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
          if (Object.prototype.hasOwnProperty.call(rawValue, "raw")) {
            raw = rawValue.raw;
          }
          if (Object.prototype.hasOwnProperty.call(rawValue, "value")) {
            raw = rawValue.value;
          }
          if (Number.isFinite(Number(rawValue.score))) {
            score = normalizedScoreFromValue(rawValue.score);
            hasExplicitScore = true;
          }
        }

        const rawText = formatRawFeatureValue(raw);
        const rawIsNumeric = rawText !== "" && /^-?\d+(\.\d+)?$/.test(rawText);
        if (!keyLikelyNumeric(featureKey) && !rawIsNumeric) {
          score = null;
        }

        categoryMap[categoryKey].subfeatures[featureKey] = {
          label: humanizeFeatureLabel(featureKey),
          score: score === null ? null : Math.max(0, Math.min(1, Number(score))),
          raw: rawText,
        };
      };

      const knownCategories = ["education", "experience", "research_outputs", "skills_and_methods"];
      const hasNestedCategories = knownCategories.some((categoryKey) => {
        const value = source[categoryKey];
        return value && typeof value === "object" && !Array.isArray(value);
      });

      if (hasNestedCategories) {
        knownCategories.forEach((categoryKey) => {
          const categoryData = source[categoryKey];
          if (!categoryData || typeof categoryData !== "object" || Array.isArray(categoryData)) return;
          Object.entries(categoryData).forEach(([featureKey, rawValue]) => {
            addFeature(categoryKey, String(featureKey || "").trim(), rawValue);
          });
        });
      } else {
        Object.entries(source).forEach(([rawKey, rawValue]) => {
          const featureKey = String(rawKey || "").trim();
          if (!featureKey || featureKey === "sensitive_attributes_not_for_evaluation") return;
          const categoryKey = mapFeatureCategory(featureKey);
          addFeature(categoryKey, featureKey, rawValue);
        });
      }

      return categoryMap;
    };

    const breakdownSubfeatures = (candidate.cbr_breakdown && candidate.cbr_breakdown.subfeatures) || {};
    const hasBreakdownSubfeatures = Object.values(breakdownSubfeatures).some((entry) => {
      const sub = entry && entry.subfeatures;
      return sub && typeof sub === "object" && Object.keys(sub).length;
    });
    const all = hasBreakdownSubfeatures ? breakdownSubfeatures : buildSubfeaturesFromCbrFeatures(candidate);

    const sections = categories.map((category) => {
      const categoryData = all[category.key] || {};
      const subfeatures = categoryData.subfeatures || {};
      const keys = Object.keys(subfeatures);
      if (!keys.length) return "";

      const rows = keys.map((key) => {
        const feature = subfeatures[key] || {};
        const label = feature.label || key;
        const raw = feature.raw;
        const rawText = raw === null || raw === undefined || raw === "" ? "" : String(raw).trim();
        const rawIsNumber = rawText !== "" && /^-?\d+(\.\d+)?$/.test(rawText);
        const candidateScore = Number(feature.score);
        const hasScore = Number.isFinite(candidateScore) && !(rawText && !rawIsNumber && candidateScore === 0);
        const score = hasScore ? candidateScore : 0;
        const extraValue = !rawIsNumber && rawText ? `<div class="feature-extra-value muted">${escapeHtml(rawText)}</div>` : "";
        const scoreLabel = hasScore ? score.toFixed(2) : "n/a";
        const scoreBarWidth = hasScore ? Math.round(score * 100) : 0;

        return `
          <div class="feature-row">
            <div class="feature-name">${escapeHtml(String(label))}</div>
            <div class="feature-bars-stack">
              <div class="feature-candidate-row">
                <div class="bar-track"><div class="bar-fill left" style="width:${scoreBarWidth}%"></div></div>
                <div class="bar-value">${scoreLabel}</div>
              </div>
              ${extraValue}
            </div>
          </div>
        `;
      }).join("");

      return `
        <section class="feature-detail-block">
          <h4>${category.label}</h4>
          <div class="feature-rows">${rows}</div>
        </section>
      `;
    }).join("");

    wrap.innerHTML = sections || '<p class="muted">No sub-feature data available.</p>';

    if (!wrapOuter || !toggleBtn) return;

    wrapOuter.classList.remove("expanded");
    toggleBtn.textContent = "View all";
    toggleBtn.setAttribute("aria-expanded", "false");
    toggleBtn.hidden = !sections;

    toggleBtn.onclick = () => {
      const container = document.getElementById("profileSubfeatureBarsWrap");
      const button = document.getElementById("profileSubfeaturesToggle");
      if (!container || !button) return;

      const expanded = container.classList.toggle("expanded");
      button.textContent = expanded ? "Collapse" : "View all";
      button.setAttribute("aria-expanded", expanded ? "true" : "false");
    };

  }

  const PROFILE_MATERIALS_CACHE = {};

  async function fetchCandidateProfilePayload(applicationId) {
    const id = String(applicationId || "").trim();
    if (!id) return { materials: {} };
    if (PROFILE_MATERIALS_CACHE[id]) {
      return PROFILE_MATERIALS_CACHE[id];
    }

    try {
      const payload = await fetchJSON(`/api/candidate-profile/${encodeURIComponent(id)}`);
      PROFILE_MATERIALS_CACHE[id] = payload;
      return payload;
    } catch {
      const fallback = { materials: {} };
      PROFILE_MATERIALS_CACHE[id] = fallback;
      return fallback;
    }
  }

  function formatMaterialValue(value) {
    if (value === null || value === undefined) {
      return '<p class="muted">No content provided.</p>';
    }
    if (typeof value === "string") {
      const text = String(value || "").trim();
      if (!text) return '<p class="muted">No content provided.</p>';
      return `<pre style="white-space:pre-wrap; margin:0">${escapeHtml(text)}</pre>`;
    }

    return `<pre style="white-space:pre-wrap; margin:0">${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
  }

  function renderStrengthWeakness(candidate) {
    const wrap = document.getElementById("profileStrengthWeakness");
    if (!wrap) return;

    const sections = parseSummarySections(candidate.summary_text || "");
    const strengths = sectionContentByAliases(sections, STRENGTH_SECTION_ALIASES);
    const weaknesses = sectionContentByAliases(sections, WEAKNESS_SECTION_ALIASES);

    wrap.innerHTML = `
      <section class="profile-summary-section-card">
        <h4 style="margin-top:0">Strengths</h4>
        <div class="section-summary-body">${sectionContentToHtml(strengths)}</div>
      </section>
      <section class="profile-summary-section-card">
        <h4 style="margin-top:0">Weaknesses</h4>
        <div class="section-summary-body">${sectionContentToHtml(weaknesses)}</div>
      </section>
    `;
  }

  function renderSummarySections(candidate) {
    const wrap = document.getElementById("profileSectionSummaries");
    if (!wrap) return;

    const sections = parseSummarySections(candidate.summary_text || "");
    const filtered = sections.filter((section) => {
      const key = normalizeSectionKey(section.title);
      return !sectionKeyMatchesAliases(key, STRENGTH_SECTION_ALIASES)
        && !sectionKeyMatchesAliases(key, WEAKNESS_SECTION_ALIASES);
    });

    if (!filtered.length) {
      wrap.innerHTML = '<p class="muted">No summary sections available.</p>';
      return;
    }

    wrap.innerHTML = filtered.map((section) => `
      <section class="profile-summary-section-card">
        <h4 style="margin-top:0">${escapeHtml(section.title || "Section")}</h4>
        <div class="section-summary-body">${sectionContentToHtml(section.content || "")}</div>
      </section>
    `).join("");
  }

  function formatProfileMaterialLabel(rawKey) {
    const compact = String(rawKey || "")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!compact) return "Document";

    const uppercaseTokens = new Set(["cv", "pdf", "id", "eu", "eea", "ntnu", "gpa", "phd", "msc", "bsc"]);
    return compact
      .split(" ")
      .map((token) => {
        const lower = token.toLowerCase();
        if (uppercaseTokens.has(lower)) return lower.toUpperCase();
        return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
      })
      .join(" ");
  }

  function renderProfileTopTabs(materials, activeKey, onSelect) {
    const tabsWrap = document.getElementById("profileMaterialTabs");
    if (!tabsWrap) return;

    const source = materials && typeof materials === "object" ? materials : {};
    const keys = Object.keys(source).filter((key) => String(key || "").trim());
    const allKeys = ["__overview__", ...keys];

    tabsWrap.innerHTML = "";
    allKeys.forEach((key) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `profile-top-tab${key === activeKey ? " active" : ""}`;
      button.textContent = key === "__overview__" ? "Profile Overview" : formatProfileMaterialLabel(key);
      button.onclick = () => onSelect(key);
      tabsWrap.appendChild(button);
    });
  }

  function renderProfileView(materials, activeKey) {
    const overviewWrap = document.getElementById("profileOverviewContent");
    const materialWrap = document.getElementById("profileMaterialContent");
    const materialTitle = document.getElementById("profileDocumentTitle");
    const materialBody = document.getElementById("profileDocumentBody");
    if (!overviewWrap || !materialWrap || !materialTitle || !materialBody) return;

    const source = materials && typeof materials === "object" ? materials : {};
    if (!activeKey || activeKey === "__overview__") {
      overviewWrap.hidden = false;
      materialWrap.hidden = true;
      return;
    }

    overviewWrap.hidden = true;
    materialWrap.hidden = false;
    materialTitle.textContent = formatProfileMaterialLabel(activeKey);
    materialBody.innerHTML = formatMaterialValue(source[activeKey]);
  }

  async function renderCandidateProfileCandidate(candidate, rankRow, totalComparisons) {
    const title = document.getElementById("profileCandidateTitle");
    const subtitle = document.getElementById("profileCandidateSubtitle");
    const summaryGrid = document.getElementById("profileSummaryGrid");

    if (title) title.textContent = candidate.display_name || candidate.name || candidate.application_id;
    if (subtitle) subtitle.textContent = "";

    if (summaryGrid) {
      summaryGrid.innerHTML = "";
    }

    renderStrengthWeakness(candidate);
    renderSingleCandidateRadar(candidate);
    renderSingleCandidateSubfeatures(candidate);
    renderSummarySections(candidate);
  }

  async function loadCandidateProfilesPage() {
    const params = new URLSearchParams(window.location.search);
    const profileSource = String(params.get("source") || "").trim().toLowerCase();
    const openedFromOmittedList = profileSource === "omitted";
    const poolsAside = document.querySelector(".profile-pools-floating");

    if (openedFromOmittedList && poolsAside) {
      poolsAside.hidden = true;
    }

    await ensureWorkflowSessionReady();

    let allCandidates = getH2HCandidateCatalog();
    if (!allCandidates.length) {
      allCandidates = getH2HCandidates();
    }
    let state = getH2HState();
    const meta = document.getElementById("profileMeta");
    const preselectedList = document.getElementById("preselectedCandidatesList");
    const h2hPoolList = document.getElementById("h2hPoolCandidatesList");
    const poolActionsWrap = document.getElementById("profilePoolActions");
    const poolStatus = document.getElementById("profilePoolStatus");

    if (!state) {
      state = {
        cacheVersion: H2H_CACHE_VERSION,
        signature: "",
        configSignature: "",
        aliasMap: null,
        finalRankingLogged: false,
        jobDir: DEFAULT_JOB_DIR_FALLBACK(),
        sourcePath: DEFAULT_SOURCE_PATH_FALLBACK(),
        comparisons: [],
      };
    }

    if (!allCandidates.length) {
      try {
        const config = getStoredConfig() || defaultConfig();
        const runResult = await runPipeline({
          ...config,
          evaluator_mode: "cbr",
        });
        allCandidates = Array.isArray(runResult && runResult.pool) ? runResult.pool : [];
      } catch {
        allCandidates = [];
      }
    }

    if (!allCandidates.length) {
      if (meta) meta.textContent = "No candidates available yet.";
      [preselectedList, h2hPoolList].forEach((list) => {
        if (!list) return;
        list.innerHTML = '<p class="muted">No candidates available.</p>';
      });
      return;
    }

    const byId = new Map();
    allCandidates.forEach((candidate) => {
      const id = String((candidate && candidate.application_id) || "").trim();
      if (!id) return;
      byId.set(id, candidate);
    });
    allCandidates = Array.from(byId.values());

    ensureCandidateAliases(allCandidates, state);
    saveH2HState(state);
    mergeIntoH2HCandidateCatalog(allCandidates);

    let poolCandidates = getH2HCandidates();
    if (!Array.isArray(poolCandidates) || !poolCandidates.length) {
      poolCandidates = allCandidates.slice(0, H2H_POOL_SIZE);
    }
    ensureCandidateAliases(poolCandidates, state);
    saveH2HCandidates(poolCandidates);

    const allCandidateIds = allCandidates.map((candidate) => String(candidate.application_id || "").trim()).filter(Boolean);
    const normalizePoolIds = (ids) => {
      const seen = new Set();
      return (Array.isArray(ids) ? ids : [])
        .map((id) => String(id || "").trim())
        .filter((id) => id && byId.has(id) && !seen.has(id) && seen.add(id));
    };
    let h2hIds = normalizePoolIds(poolCandidates.map((candidate) => candidate.application_id));
    let preselectedIds = allCandidateIds.filter((id) => !h2hIds.includes(id));

    const getCatalogMap = () => {
      const map = {};
      allCandidates.forEach((candidate) => {
        const id = String((candidate && candidate.application_id) || "").trim();
        if (!id) return;
        map[id] = candidate;
      });
      poolCandidates.forEach((candidate) => {
        const id = String((candidate && candidate.application_id) || "").trim();
        if (!id) return;
        map[id] = candidate;
      });
      return map;
    };

    const queryCandidateId = params.get("candidate_id");
    let pinnedCandidateId = String(queryCandidateId || "").trim();
    let activeId = pinnedCandidateId;
    const tabStateByCandidate = {};
    let renderGeneration = 0;
    let activeMaterials = {};

    const updatePoolStatus = (message) => {
      if (poolStatus) {
        poolStatus.textContent = String(message || "");
      }
    };

    const updateH2HPoolState = () => {
      const idSet = new Set(h2hIds);
      state.comparisons = (Array.isArray(state.comparisons) ? state.comparisons : []).filter((comparison) => (
        idSet.has(String((comparison && comparison.left) || ""))
        && idSet.has(String((comparison && comparison.right) || ""))
        && idSet.has(String((comparison && comparison.winner) || ""))
        && idSet.has(String((comparison && comparison.loser) || ""))
      ));
      state.signature = h2hIds.join("|");
      state.finalRankingLogged = false;
      const h2hCandidates = h2hIds.map((id) => byId.get(id)).filter(Boolean);
      ensureCandidateAliases(h2hCandidates, state);
      saveH2HCandidates(h2hCandidates);
      saveH2HState(state);
    };

    const rebalancePools = () => {
      h2hIds = normalizePoolIds(h2hIds);
      preselectedIds = normalizePoolIds(preselectedIds).filter((id) => !h2hIds.includes(id));
      const missingIds = allCandidateIds.filter((id) => !h2hIds.includes(id) && !preselectedIds.includes(id));
      preselectedIds = preselectedIds.concat(missingIds);
    };

    const persistPools = () => {
      rebalancePools();
      updateH2HPoolState();
      mergeIntoH2HCandidateCatalog(allCandidates);
    };

    const deriveProfiles = () => {
      const profiles = allCandidates
        .map((candidate) => ({ row: null, candidate }))
        .sort((a, b) => String(a.candidate.display_name || "").localeCompare(String(b.candidate.display_name || "")));

      const normalizedFocusId = String(pinnedCandidateId || "").trim();
      if (normalizedFocusId && !profiles.some((entry) => String(entry.candidate.application_id) === normalizedFocusId)) {
        const extraCandidate = getCatalogMap()[normalizedFocusId] || {
          application_id: normalizedFocusId,
          display_name: buildCandidateAlias(normalizedFocusId),
          summary_text: "",
        };
        profiles.unshift({ row: null, candidate: extraCandidate });
      }

      return profiles;
    };

    const insertIdAt = (list, id, index) => {
      const next = (Array.isArray(list) ? list : []).filter((item) => item !== id);
      if (typeof index !== "number" || Number.isNaN(index)) {
        next.push(id);
        return next;
      }
      const target = Math.max(0, Math.min(next.length, Math.floor(index)));
      next.splice(target, 0, id);
      return next;
    };

    const addToPool = (poolKey, candidateId, targetIndex) => {
      const id = String(candidateId || "").trim();
      if (!id || !byId.has(id)) return;
      if (poolKey === "h2h") {
        h2hIds = insertIdAt(h2hIds, id, targetIndex);
        preselectedIds = preselectedIds.filter((item) => item !== id);
        return;
      }
      if (poolKey === "preselected") {
        preselectedIds = insertIdAt(preselectedIds, id, targetIndex);
        h2hIds = h2hIds.filter((item) => item !== id);
      }
    };

    const removeFromPool = (poolKey, candidateId) => {
      const id = String(candidateId || "").trim();
      if (!id) return;
      if (poolKey === "h2h") {
        h2hIds = h2hIds.filter((item) => item !== id);
        preselectedIds = insertIdAt(preselectedIds, id);
      }
    };

    const getDropInsertIndex = (listEl, clientY, draggedId) => {
      if (!listEl) return null;
      const chips = Array.from(listEl.querySelectorAll(".profile-pool-chip"))
        .filter((chip) => String(chip.dataset.candidateId || "") !== String(draggedId || ""));
      if (!chips.length) return 0;
      for (let index = 0; index < chips.length; index += 1) {
        const rect = chips[index].getBoundingClientRect();
        if (clientY < rect.top + (rect.height / 2)) {
          return index;
        }
      }
      return chips.length;
    };

    const setPoolMembership = async (candidateId, includeInPool) => {
      const targetId = String(candidateId || "").trim();
      if (!targetId) return;

      const isAlreadyInPool = h2hIds.includes(targetId);
      if (includeInPool && isAlreadyInPool) return;
      if (!includeInPool && !isAlreadyInPool) return;

      if (!includeInPool && h2hIds.length <= 2) {
        updatePoolStatus("At least 2 candidates must remain in the pool.");
        return;
      }

      if (includeInPool) {
        const candidate = getCatalogMap()[targetId];
        if (!candidate) {
          updatePoolStatus("Candidate is not available in the local catalog.");
          return;
        }
        addToPool("h2h", targetId);
        updatePoolStatus("Candidate added to pool.");
      } else {
        removeFromPool("h2h", targetId);
        updatePoolStatus("Candidate removed from pool.");
      }
      persistPools();

      if (!includeInPool) {
        pinnedCandidateId = targetId;
      }
      await render();
    };

    const renderPoolActions = (candidate) => {
      if (!poolActionsWrap) return;
      const candidateId = String((candidate && candidate.application_id) || "").trim();
      const inH2H = h2hIds.includes(candidateId);

      poolActionsWrap.innerHTML = "";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn secondary";
      button.textContent = inH2H ? "Remove From Head-to-Head Pool" : "Add To Head-to-Head Pool";
      button.onclick = async () => {
        await setPoolMembership(candidateId, !inH2H);
      };
      poolActionsWrap.append(button);
    };

    const renderPoolList = (listEl, poolKey, ids) => {
      if (!listEl) return;
      listEl.innerHTML = "";
      if (!ids.length) {
        listEl.innerHTML = '<p class="muted">No candidates in this pool.</p>';
        return;
      }

      ids.forEach((id) => {
        const candidate = byId.get(id);
        if (!candidate) return;
        const chip = document.createElement("div");
        chip.className = `profile-pool-chip ${poolKey === "h2h" ? "h2h" : "preselected"}`;
        chip.draggable = true;
        chip.dataset.candidateId = id;
        chip.dataset.poolKey = poolKey;
        chip.addEventListener("dragstart", (event) => {
          event.dataTransfer.setData("text/plain", JSON.stringify({ candidate_id: id, from_pool: poolKey }));
          event.dataTransfer.effectAllowed = "copy";
        });

        const labelButton = document.createElement("button");
        labelButton.type = "button";
        labelButton.className = "profile-pool-chip-label";
        labelButton.textContent = String(candidate.display_name || candidate.name || candidate.application_id);
        labelButton.onclick = () => {
          activeId = id;
          render();
        };

        const badge = document.createElement("span");
        badge.className = `profile-pool-chip-badge ${poolKey === "h2h" ? "h2h" : "preselected"}`;
        badge.setAttribute("aria-label", poolKey === "h2h" ? "Head-to-Head pool" : "Pre-selected pool");
        badge.title = poolKey === "h2h" ? "Head-to-Head pool" : "Pre-selected pool";

        const controlsWrap = document.createElement("div");
        controlsWrap.style.display = "flex";
        controlsWrap.style.alignItems = "center";
        controlsWrap.style.gap = "6px";

        if (poolKey === "h2h") {
          const removeButton = document.createElement("button");
          removeButton.type = "button";
          removeButton.className = "profile-pool-chip-remove";
          removeButton.title = "Remove from Head-to-Head pool";
          removeButton.textContent = "−";
          removeButton.onclick = async () => {
            if (h2hIds.length <= 2) {
              updatePoolStatus("At least 2 candidates must remain in the Head-to-Head pool.");
              return;
            }
            removeFromPool("h2h", id);
            persistPools();
            updatePoolStatus(`Removed ${candidate.display_name || id} from Head-to-Head Pool.`);
            await render();
          };
          controlsWrap.append(badge, removeButton);
        } else {
          const addButton = document.createElement("button");
          addButton.type = "button";
          addButton.className = "profile-pool-chip-add";
          addButton.title = "Add to Head-to-Head pool";
          addButton.textContent = "+";
          addButton.onclick = async () => {
            addToPool("h2h", id);
            persistPools();
            updatePoolStatus(`Added ${candidate.display_name || id} to Head-to-Head Pool.`);
            await render();
          };
          controlsWrap.append(badge, addButton);
        }

        chip.append(labelButton, controlsWrap);
        listEl.appendChild(chip);
      });
    };

    const setupPoolDropZone = (listEl, poolKey) => {
      if (!listEl) return;
      listEl.addEventListener("dragover", (event) => {
        event.preventDefault();
        listEl.classList.add("drag-over");
      });
      listEl.addEventListener("dragleave", () => {
        listEl.classList.remove("drag-over");
      });
      listEl.addEventListener("drop", async (event) => {
        event.preventDefault();
        listEl.classList.remove("drag-over");
        let payload = null;
        try {
          payload = JSON.parse(event.dataTransfer.getData("text/plain") || "{}");
        } catch {
          payload = null;
        }
        const candidateId = String((payload && payload.candidate_id) || "").trim();
        if (!candidateId || !byId.has(candidateId)) return;
        const targetIndex = getDropInsertIndex(listEl, event.clientY, candidateId);
        if (poolKey === "preselected") {
          addToPool("preselected", candidateId, targetIndex);
        } else {
          addToPool("h2h", candidateId, targetIndex);
        }
        persistPools();
        updatePoolStatus(`${poolKey === "h2h" ? "Added" : "Moved"} ${byId.get(candidateId).display_name || candidateId} ${poolKey === "h2h" ? "to" : "to Pre-selected from"} ${poolKey === "h2h" ? "Head-to-Head Pool" : "Head-to-Head Pool"}.`);
        await render();
      });
    };

    setupPoolDropZone(preselectedList, "preselected");
    setupPoolDropZone(h2hPoolList, "h2h");

    const showTab = (nextTab) => {
      tabStateByCandidate[activeId] = nextTab;
      renderProfileTopTabs(activeMaterials, nextTab, showTab);
      renderProfileView(activeMaterials, nextTab);
    };

    const render = async () => {
      const generation = ++renderGeneration;
      const profiles = deriveProfiles();
      const totalComparisons = Array.isArray(state.comparisons) ? state.comparisons.length : 0;
      if (!profiles.length) {
        if (meta) meta.textContent = "No candidates available for pool editing.";
        [preselectedList, h2hPoolList].forEach((list) => {
          if (!list) return;
          list.innerHTML = '<p class="muted">No candidates available.</p>';
        });
        return;
      }

      if (!activeId || !profiles.some((entry) => String(entry.candidate.application_id) === activeId)) {
        const preferred = pinnedCandidateId
          ? profiles.find((entry) => String(entry.candidate.application_id) === pinnedCandidateId)
          : null;
        activeId = preferred ? preferred.candidate.application_id : profiles[0].candidate.application_id;
      }

      if (meta) {
        meta.textContent = `Loaded pool editor for ${profiles.length} candidate(s).`;
      }

      renderPoolList(preselectedList, "preselected", preselectedIds);
      renderPoolList(h2hPoolList, "h2h", h2hIds);

      const active = profiles.find((entry) => entry.candidate.application_id === activeId) || profiles[0];
      if (generation !== renderGeneration) return;
      renderPoolActions(active.candidate);
      await renderCandidateProfileCandidate(active.candidate, active.row, totalComparisons);
      if (generation !== renderGeneration) return;

      const profilePayload = await fetchCandidateProfilePayload(active.candidate.application_id);
      if (generation !== renderGeneration) return;
      if (!String(active.candidate.summary_text || "").trim() && String((profilePayload && profilePayload.summary_text) || "").trim()) {
        active.candidate.summary_text = String(profilePayload.summary_text || "");
      }
      if ((!active.candidate.cbr_breakdown || typeof active.candidate.cbr_breakdown !== "object")
        && profilePayload && profilePayload.cbr_breakdown && typeof profilePayload.cbr_breakdown === "object") {
        active.candidate.cbr_breakdown = profilePayload.cbr_breakdown;
      }
      if ((!active.candidate.cbr_features || typeof active.candidate.cbr_features !== "object")
        && profilePayload && profilePayload.cbr_features && typeof profilePayload.cbr_features === "object") {
        active.candidate.cbr_features = profilePayload.cbr_features;
      }
      if ((!active.candidate.scores || typeof active.candidate.scores !== "object")
        && profilePayload && profilePayload.scores && typeof profilePayload.scores === "object") {
        active.candidate.scores = profilePayload.scores;
      }
      activeMaterials = (profilePayload && profilePayload.materials) || {};

      // Persist hydrated candidate data so subsequent renders/loads are not blank.
      byId.set(String(active.candidate.application_id || ""), active.candidate);
      mergeIntoH2HCandidateCatalog([active.candidate]);

      // Re-render after hydration so summary-driven sections populate immediately.
      await renderCandidateProfileCandidate(active.candidate, active.row, totalComparisons);
      if (generation !== renderGeneration) return;

      await logStageEvent(
        "candidate_profiles",
        "candidate_viewed",
        {
          candidate_id: String(active.candidate.application_id || ""),
        },
        {
          material_count: Object.keys(activeMaterials).length,
          comparison_count: totalComparisons,
        },
      );

      const materialKeys = Object.keys(activeMaterials).filter((key) => String(key || "").trim());
      const currentTab = String(tabStateByCandidate[active.candidate.application_id] || "__overview__");
      const tabExists = currentTab === "__overview__" || materialKeys.includes(currentTab);
      const activeTab = tabExists ? currentTab : "__overview__";
      tabStateByCandidate[active.candidate.application_id] = activeTab;
      activeMaterials = activeMaterials || {};
      showTab(activeTab);
    };

    const initialProfiles = deriveProfiles();
    if (initialProfiles.length) {
      const hasQueryProfile = pinnedCandidateId
        && initialProfiles.some((entry) => String(entry.candidate.application_id) === pinnedCandidateId);
      activeId = hasQueryProfile ? pinnedCandidateId : initialProfiles[0].candidate.application_id;
    }

    await render();
  }

  function normalizeWeightMap(weights) {
    const source = weights && typeof weights === "object" ? weights : {};
    const normalized = {
      education: Math.max(0, Number(source.education || 0)),
      experience: Math.max(0, Number(source.experience || 0)),
      research_outputs: Math.max(0, Number(source.research_outputs || 0)),
      skills_and_methods: Math.max(0, Number(source.skills_and_methods || 0)),
    };
    const total = Object.values(normalized).reduce((sum, value) => sum + value, 0);
    if (total <= 0) {
      return {
        education: 0.25,
        experience: 0.25,
        research_outputs: 0.25,
        skills_and_methods: 0.25,
      };
    }

    return {
      education: normalized.education / total,
      experience: normalized.experience / total,
      research_outputs: normalized.research_outputs / total,
      skills_and_methods: normalized.skills_and_methods / total,
    };
  }

  function loadCandidateRatingsState() {
    const buildState = (parsed) => ({
      by_candidate: parsed && parsed.by_candidate && typeof parsed.by_candidate === "object" ? parsed.by_candidate : {},
      document_weights: parsed && parsed.document_weights && typeof parsed.document_weights === "object" ? parsed.document_weights : {},
      assistant_context_key: parsed && typeof parsed.assistant_context_key === "string" ? parsed.assistant_context_key : "",
    });
    const countMeaningfulBuckets = (state) => Object.values((state && state.by_candidate) || {}).filter((bucket) => {
      if (!bucket || typeof bucket !== "object") return false;
      const overall = Number(bucket.overall_stars || 0);
      const summaryCount = Object.values(bucket.summary_ratings || {}).filter((value) => Number(value || 0) > 0).length;
      const documentCount = Object.values(bucket.document_ratings || {}).filter((value) => Number(value || 0) > 0).length;
      const justification = String(bucket.justification || "").trim();
      return overall > 0 || summaryCount > 0 || documentCount > 0 || justification.length > 0;
    }).length;
    try {
      const raw = getSessionStorageItem(CANDIDATE_RATINGS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      const currentState = buildState(parsed);
      if (countMeaningfulBuckets(currentState) > 0) {
        return currentState;
      }

      const backupRaw = getSessionStorageItem(CANDIDATE_RATINGS_BACKUP_KEY);
      const backupParsed = backupRaw ? JSON.parse(backupRaw) : {};
      const backupState = buildState(backupParsed);
      if (countMeaningfulBuckets(backupState) > 0) {
        setSessionStorageItem(CANDIDATE_RATINGS_KEY, JSON.stringify(backupState));
        return backupState;
      }

      return currentState;
    } catch {
      return { by_candidate: {}, document_weights: {}, assistant_context_key: "" };
    }
  }

  function saveCandidateRatingsState(state) {
    const nextState = state || {};
    setSessionStorageItem(CANDIDATE_RATINGS_KEY, JSON.stringify(nextState));

    const byCandidate = nextState && nextState.by_candidate && typeof nextState.by_candidate === "object"
      ? nextState.by_candidate
      : {};
    const hasMeaningfulRatings = Object.values(byCandidate).some((bucket) => {
      if (!bucket || typeof bucket !== "object") return false;
      const overall = Number(bucket.overall_stars || 0);
      const summaryCount = Object.values(bucket.summary_ratings || {}).filter((value) => Number(value || 0) > 0).length;
      const documentCount = Object.values(bucket.document_ratings || {}).filter((value) => Number(value || 0) > 0).length;
      const justification = String(bucket.justification || "").trim();
      return overall > 0 || summaryCount > 0 || documentCount > 0 || justification.length > 0;
    });
    if (hasMeaningfulRatings) {
      setSessionStorageItem(CANDIDATE_RATINGS_BACKUP_KEY, JSON.stringify(nextState));
    }
  }

  function clearAssistantStateForAllCandidates(ratingsState) {
    const byCandidate = ratingsState && ratingsState.by_candidate && typeof ratingsState.by_candidate === "object"
      ? ratingsState.by_candidate
      : {};

    Object.values(byCandidate).forEach((bucket) => {
      if (!bucket || typeof bucket !== "object") return;

      if (bucket.fairness && typeof bucket.fairness === "object") {
        bucket.fairness.initial_review = null;
        bucket.fairness.last_audit = null;
        bucket.fairness.initial_review_error = "";
        bucket.fairness.initial_review_stream_text = "";
        bucket.fairness.audit_error = "";
        bucket.fairness.audit_stream_text = "";
        bucket.fairness.qa_history = [];
        bucket.fairness.qa_transcript = [];
        bucket.fairness.review_history = [];
        bucket.fairness.audit_history = [];
      }

      if (bucket.ntnu && typeof bucket.ntnu === "object") {
        bucket.ntnu.initial_review = null;
        bucket.ntnu.last_audit = null;
        bucket.ntnu.initial_review_error = "";
        bucket.ntnu.initial_review_stream_text = "";
        bucket.ntnu.audit_error = "";
        bucket.ntnu.audit_stream_text = "";
        bucket.ntnu.qa_history = [];
        bucket.ntnu.review_history = [];
        bucket.ntnu.audit_history = [];
      }
    });
  }

  function getCandidateRatingBucket(state, candidateId) {
    const id = String(candidateId || "").trim();
    if (!id) {
      return {
        summary_ratings: {},
        document_ratings: {},
        overall_stars: 0,
        justification: "",
        weighted_avg: 0,
        final_stars: 0,
        fairness: {
          initial_review: null,
          qa_history: [],
          last_audit: null,
        },
      };
    }
    if (!state.by_candidate[id] || typeof state.by_candidate[id] !== "object") {
      state.by_candidate[id] = {};
    }

    const bucket = state.by_candidate[id];
    if (!bucket.summary_ratings || typeof bucket.summary_ratings !== "object") bucket.summary_ratings = {};
    if (!bucket.document_ratings || typeof bucket.document_ratings !== "object") bucket.document_ratings = {};
    if (!Number.isFinite(Number(bucket.overall_stars))) bucket.overall_stars = 0;
    if (typeof bucket.justification !== "string") bucket.justification = "";
    if (!Number.isFinite(Number(bucket.weighted_avg))) bucket.weighted_avg = 0;
    if (!Number.isFinite(Number(bucket.final_stars))) bucket.final_stars = 0;
    if (!bucket.fairness || typeof bucket.fairness !== "object") {
      bucket.fairness = {};
    }
    if (!Array.isArray(bucket.fairness.qa_history)) bucket.fairness.qa_history = [];
    if (!Array.isArray(bucket.fairness.conversation_history)) bucket.fairness.conversation_history = [];
    if (!Array.isArray(bucket.fairness.review_history)) bucket.fairness.review_history = [];
    if (!Array.isArray(bucket.fairness.audit_history)) bucket.fairness.audit_history = [];
    if (!("initial_review" in bucket.fairness)) bucket.fairness.initial_review = null;
    if (!("last_audit" in bucket.fairness)) bucket.fairness.last_audit = null;
    // Transient async flags should never persist across page reloads.
    if (bucket.fairness.initial_review_loading) bucket.fairness.initial_review_loading = false;
    if (bucket.fairness.qa_loading) bucket.fairness.qa_loading = false;
    if (bucket.fairness.audit_loading) bucket.fairness.audit_loading = false;
    if (typeof bucket.fairness.initial_review_stream_text !== "string") {
      bucket.fairness.initial_review_stream_text = "";
    }
    if (typeof bucket.fairness.audit_stream_text !== "string") {
      bucket.fairness.audit_stream_text = "";
    }

    if (!bucket.ntnu || typeof bucket.ntnu !== "object") {
      bucket.ntnu = {};
    }
    if (!Array.isArray(bucket.ntnu.qa_history)) bucket.ntnu.qa_history = [];
    if (!Array.isArray(bucket.ntnu.review_history)) bucket.ntnu.review_history = [];
    if (!Array.isArray(bucket.ntnu.audit_history)) bucket.ntnu.audit_history = [];
    if (!("initial_review" in bucket.ntnu)) bucket.ntnu.initial_review = null;
    if (!("last_audit" in bucket.ntnu)) bucket.ntnu.last_audit = null;
    if (bucket.ntnu.initial_review_loading) bucket.ntnu.initial_review_loading = false;
    if (bucket.ntnu.qa_loading) bucket.ntnu.qa_loading = false;
    if (bucket.ntnu.audit_loading) bucket.ntnu.audit_loading = false;
    if (typeof bucket.ntnu.initial_review_stream_text !== "string") {
      bucket.ntnu.initial_review_stream_text = "";
    }
    if (typeof bucket.ntnu.audit_stream_text !== "string") {
      bucket.ntnu.audit_stream_text = "";
    }

    return bucket;
  }

  function setFairnessChatFollowLatest(bucket, enabled) {
    const fairnessState = bucket && bucket.fairness ? bucket.fairness : {};
    fairnessState.qa_follow_latest = Boolean(enabled);
  }

  function clampStars(value) {
    const num = Number(value || 0);
    if (!Number.isFinite(num)) return 0;
    return Math.max(0, Math.min(5, Math.round(num)));
  }

  function inferSummaryCategory(title, content) {
    const text = `${String(title || "")} ${String(content || "")}`.toLowerCase();
    if (text.includes("education") || text.includes("thesis")) return "education";
    if (text.includes("experience") || text.includes("teaching") || text.includes("outreach")) return "experience";
    if (text.includes("publication") || text.includes("research output")) return "research_outputs";
    if (text.includes("method") || text.includes("skill") || text.includes("language") || text.includes("project proposal")) return "skills_and_methods";
    return "skills_and_methods";
  }

  function starsLabel(value) {
    const score = clampStars(value);
    if (!score) return "Unrated";
    return `${"★".repeat(score)}${"☆".repeat(5 - score)} (${score}/5)`;
  }

  function renderStarSelector(container, currentValue, onSelect) {
    if (!container) return;
    const current = clampStars(currentValue);
    container.innerHTML = "";

    const wrap = document.createElement("div");
    wrap.className = "rating-stars-control";

    for (let star = 1; star <= 5; star += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `rating-star-btn${star <= current ? " active" : ""}`;
      button.setAttribute("aria-label", `${star} star${star > 1 ? "s" : ""}`);
      button.textContent = "★";
      button.onclick = () => onSelect(star);
      wrap.appendChild(button);
    }

    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "rating-clear-btn";
    clearButton.textContent = "Clear";
    clearButton.onclick = () => onSelect(0);
    wrap.appendChild(clearButton);

    container.appendChild(wrap);
  }

  function buildRatingsSummaryItems(candidate, cbrWeights) {
    const sections = parseSummarySections(candidate.summary_text || "");
    const filtered = sections.filter((section) => {
      const key = normalizeSectionKey(section.title);
      return key !== "evidenced strengths"
        && key !== "evidenced limitations"
        && key !== "reviewer takeaways"
        && key !== "reviewer takeaway";
    });

    const byCategoryCount = {
      education: 0,
      experience: 0,
      research_outputs: 0,
      skills_and_methods: 0,
    };

    const seeded = filtered.map((section, index) => {
      const category = inferSummaryCategory(section.title, section.content);
      byCategoryCount[category] = (byCategoryCount[category] || 0) + 1;
      const key = normalizeSectionKey(section.title) || `summary-${index + 1}`;
      return {
        key,
        label: section.title || `Summary ${index + 1}`,
        category,
      };
    });

    return seeded.map((item) => ({
      ...item,
      weight: 1,
      categoryLabel: String(item.category).replace(/_/g, " "),
    }));
  }

  function buildRatingsDocumentItems(materials, documentWeights) {
    const source = materials && typeof materials === "object" ? materials : {};
    const keys = Object.keys(source).filter((key) => String(key || "").trim());
    return keys.map((key) => ({
      key,
      label: formatProfileMaterialLabel(key),
      weight: 1,
    }));
  }

  function computeWeightedRatingStats(summaryItems, documentItems, ratingBucket) {
    let numerator = 0;
    let denominator = 0;
    let ratedCount = 0;
    const totalCount = summaryItems.length + documentItems.length;

    summaryItems.forEach((item) => {
      const score = clampStars(ratingBucket.summary_ratings[item.key]);
      if (!score) return;
      numerator += score;
      denominator += 1;
      ratedCount += 1;
    });

    documentItems.forEach((item) => {
      const score = clampStars(ratingBucket.document_ratings[item.key]);
      if (!score) return;
      numerator += score;
      denominator += 1;
      ratedCount += 1;
    });

    const average = denominator > 0 ? numerator / denominator : 0;
    return {
      average,
      ratedCount,
      totalCount,
      denominator,
    };
  }

  function renderRatingRows(container, items, getValue, onSetValue) {
    if (!container) return;
    container.innerHTML = "";

    if (!items.length) {
      container.innerHTML = '<p class="muted">No fields available for rating.</p>';
      return;
    }

    items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "rating-row";

      const meta = document.createElement("div");
      meta.className = "rating-row-meta";
      const title = document.createElement("div");
      title.className = "rating-row-title";
      title.textContent = item.label;
      meta.append(title);

      const starsWrap = document.createElement("div");
      starsWrap.className = "rating-row-stars";
      renderStarSelector(starsWrap, getValue(item.key), (next) => onSetValue(item.key, next));

      row.append(meta, starsWrap);
      container.appendChild(row);
    });
  }

  async function renderCandidateRatingOverview(candidate, rankRow, totalComparisons) {
    await renderCandidateProfileCandidate(candidate, rankRow, totalComparisons);
  }

  function renderRatingsProfileTopTabs(materials, activeKey, onSelect) {
    const tabsWrap = document.getElementById("profileMaterialTabs");
    if (!tabsWrap) return;

    const source = materials && typeof materials === "object" ? materials : {};
    const keys = Object.keys(source).filter((key) => String(key || "").trim());
    const allKeys = ["__overview__", ...keys, "__sensitive__"];

    tabsWrap.innerHTML = "";
    allKeys.forEach((key) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `profile-top-tab${key === activeKey ? " active" : ""}`;
      if (key === "__overview__") {
        button.textContent = "Profile Overview";
      } else if (key === "__sensitive__") {
        button.textContent = "Sensitive Information";
      } else {
        button.textContent = formatProfileMaterialLabel(key);
      }
      button.onclick = () => onSelect(key);
      tabsWrap.appendChild(button);
    });
  }

  function renderRatingsProfileView(materials, activeKey, profilePayload = {}) {
    const overviewWrap = document.getElementById("profileOverviewContent");
    const materialWrap = document.getElementById("profileMaterialContent");
    const sensitiveWrap = document.getElementById("profileSensitiveContent");
    const realNameEl = document.getElementById("profileSensitiveRealName");
    const sensitiveAttrsEl = document.getElementById("profileSensitiveAttributes");

    if (!overviewWrap || !materialWrap || !sensitiveWrap || !realNameEl || !sensitiveAttrsEl) {
      renderProfileView(materials, activeKey);
      return;
    }

    if (activeKey === "__sensitive__") {
      overviewWrap.hidden = true;
      materialWrap.hidden = true;
      sensitiveWrap.hidden = false;

      const source = profilePayload && typeof profilePayload === "object" ? profilePayload : {};
      const realName = String(source.variant_assigned_name || source.source_seed_candidate_name || "Unknown").trim();
      realNameEl.textContent = realName || "Unknown";

      const sensitive = source.sensitive_attributes && typeof source.sensitive_attributes === "object"
        ? source.sensitive_attributes
        : {};
      const rows = Object.entries(sensitive)
        .filter(([key]) => String(key || "").trim().length > 0)
        .map(([key, value]) => {
          const label = formatProfileMaterialLabel(key);
          const text = String(value == null || value === "" ? "—" : value);
          return `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(text)}</li>`;
        });

      sensitiveAttrsEl.innerHTML = rows.length
        ? `<ul>${rows.join("")}</ul>`
        : '<p class="muted">No sensitive attributes available.</p>';
      return;
    }

    sensitiveWrap.hidden = true;
    renderProfileView(materials, activeKey);
  }

  async function requestFairnessCandidateReview(payload) {
    return fetchJSON("/api/fairness/candidate-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
  }

  async function streamFairnessRequest(endpoint, payload, handlers = {}) {
    const onStart = typeof handlers.onStart === "function" ? handlers.onStart : null;
    const onDelta = typeof handlers.onDelta === "function" ? handlers.onDelta : null;
    const onError = typeof handlers.onError === "function" ? handlers.onError : null;

    const request = fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });

    const timeoutMs = 120000;
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Fairness streaming request timed out")), timeoutMs);
    });

    const response = await Promise.race([request, timeout]);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "Request failed");
    }
    if (!response.body) {
      throw new Error("Streaming response body unavailable");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalResult = null;
    let streamStartMeta = {};

    const handleBlock = (block) => {
      const lines = block.split(/\r?\n/);
      const data = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.replace(/^data:\s?/, ""))
        .join("\n");
      if (!data) return;
      const eventPayload = JSON.parse(data);
      if (eventPayload.type === "start") {
        streamStartMeta = {
          ...streamStartMeta,
          routed_categories: Array.isArray(eventPayload.routed_categories) ? eventPayload.routed_categories : [],
          retrieved_files: Array.isArray(eventPayload.retrieved_files) ? eventPayload.retrieved_files : [],
        };
        if (onStart) onStart(eventPayload);
        return;
      }
      if (eventPayload.type === "delta") {
        if (onDelta) onDelta(eventPayload);
        return;
      }
      if (eventPayload.type === "error") {
        if (onError) onError(eventPayload);
        return;
      }
      if (eventPayload.type === "done") {
        finalResult = {
          ...(eventPayload.result || eventPayload),
          ...streamStartMeta,
        };
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: !done });
        let separatorIndex = buffer.search(/\r?\n\r?\n/);
        while (separatorIndex !== -1) {
          handleBlock(buffer.slice(0, separatorIndex));
          const separatorMatch = buffer.slice(separatorIndex).match(/^\r?\n\r?\n/);
          const separatorLength = separatorMatch ? separatorMatch[0].length : 2;
          buffer = buffer.slice(separatorIndex + separatorLength);
          separatorIndex = buffer.search(/\r?\n\r?\n/);
        }
      }
      if (done) break;
    }

    if (buffer.trim()) {
      handleBlock(buffer);
    }

    if (!finalResult) {
      throw new Error("Streaming response completed without a final fairness payload.");
    }

    return finalResult;
  }

  // ─── Shared assistant stream response normalizer ─────────────────────────────
  // All assistant endpoints share the same "done" payload shape. This helper
  // maps raw stream output to a consistent shape used by each call-site.
  // `resultKey`   – the key to use for the parsed JSON result ("review" / "response" / "audit")
  // `includeRouting` – whether to include routed_categories / retrieved_files (NTNU only)
  function normalizeStreamedAssistantResponse(streamed, resultKey, includeRouting = false) {
    const base = {
      [resultKey]: (streamed && streamed.result) || {},
      prompt_system: String((streamed && streamed.prompt_system) || ""),
      prompt_user: String((streamed && streamed.prompt_user) || ""),
      response_text: String((streamed && streamed.response_text) || ""),
      meta: {
        model: String((streamed && streamed.model) || ""),
      },
    };
    if (includeRouting) {
      base.routed_categories = Array.isArray((streamed && streamed.routed_categories)) ? streamed.routed_categories : [];
      base.retrieved_files = Array.isArray((streamed && streamed.retrieved_files)) ? streamed.retrieved_files : [];
    }
    return base;
  }

  async function requestFairnessCandidateReviewStream(payload, handlers = {}) {
    const streamed = await streamFairnessRequest("/api/fairness/candidate-review-stream", payload, handlers);
    return {
      candidate_id: String((payload && payload.candidate_id) || ""),
      ...normalizeStreamedAssistantResponse(streamed, "review"),
    };
  }

  async function requestFairnessQA(payload) {
    return fetchJSON("/api/fairness/qa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
  }

  async function requestFairnessQAStream(payload, handlers = {}) {
    const streamed = await streamFairnessRequest("/api/fairness/qa-stream", payload, handlers);
    return normalizeStreamedAssistantResponse(streamed, "response");
  }

  async function requestFairnessCrossCandidateAudit(payload) {
    return fetchJSON("/api/fairness/cross-candidate-audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
  }

  async function requestFairnessCrossCandidateAuditStream(payload, handlers = {}) {
    const streamed = await streamFairnessRequest("/api/fairness/cross-candidate-audit-stream", payload, handlers);
    return normalizeStreamedAssistantResponse(streamed, "audit");
  }

  async function requestNTNUInitialReviewStream(payload, handlers = {}) {
    const streamed = await streamFairnessRequest("/api/ntnu/candidate-review-stream", payload, handlers);
    return normalizeStreamedAssistantResponse(streamed, "review", true);
  }

  async function requestNTNUQAStream(payload, handlers = {}) {
    const streamed = await streamFairnessRequest("/api/ntnu/qa-stream", payload, handlers);
    return normalizeStreamedAssistantResponse(streamed, "response", true);
  }

  async function requestNTNUFinalAuditStream(payload, handlers = {}) {
    const streamed = await streamFairnessRequest("/api/ntnu/final-audit-stream", payload, handlers);
    return normalizeStreamedAssistantResponse(streamed, "audit", true);
  }

  async function submitUserFeedback(payload) {
    return fetchJSON("/api/user-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
  }

  function formatNTNUList(items) {
    const rows = Array.isArray(items) ? items : [];
    if (!rows.length) {
      return "";
    }
    return `<ul>${rows.map((item) => {
      if (item && typeof item === "object") {
        const candidate = String(item.candidate || item.application_id || "").trim();
        const flag = String(item.flag || item.message || item.issue || item.note || "").trim();
        if (candidate && flag) {
          return `<li><strong>${escapeHtml(candidate)}:</strong> ${escapeHtml(flag)}</li>`;
        }
        if (flag) {
          return `<li>${escapeHtml(flag)}</li>`;
        }
        const fallback = Object.entries(item)
          .map(([key, value]) => `${String(key)}: ${String(value || "")}`)
          .join("; ");
        return `<li>${escapeHtml(fallback || String(item || ""))}</li>`;
      }
      return `<li>${escapeHtml(String(item || ""))}</li>`;
    }).join("")}</ul>`;
  }

  function replaceCandidateIdsWithAliases(value, aliasById) {
    const aliases = aliasById instanceof Map ? aliasById : new Map();
    const replaceText = (text) => {
      let output = String(text || "");
      aliases.forEach((alias, applicationId) => {
        const id = String(applicationId || "").trim();
        const display = String(alias || "").trim();
        if (!id || !display) return;
        const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        output = output.replace(new RegExp(`\\b${escapedId}\\b`, "g"), display);
      });
      return output;
    };

    if (typeof value === "string") {
      return replaceText(value);
    }
    if (Array.isArray(value)) {
      return value.map((item) => replaceCandidateIdsWithAliases(item, aliases));
    }
    if (value && typeof value === "object") {
      const output = {};
      Object.entries(value).forEach(([key, nested]) => {
        if ((key === "candidate" || key === "application_id") && typeof nested === "string") {
          output[key] = aliases.get(String(nested || "").trim()) || replaceText(nested);
        } else {
          output[key] = replaceCandidateIdsWithAliases(nested, aliases);
        }
      });
      return output;
    }
    return value;
  }

  function formatListWithoutEmptyState(items) {
    const rows = Array.isArray(items)
      ? items.map((item) => String(item || "").trim()).filter((item) => item.length > 0)
      : [];
    if (!rows.length) return "";
    return `<ul>${rows.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  }

  function renderInitialReportDetails(title, issueCount, detailsHtml, collapsedPreview = "") {
    const count = Math.max(0, Number(issueCount) || 0);
    const warningIcon = count > 0 ? '<span class="assistant-issue-warning" aria-hidden="true">&#9888;</span> ' : "";
    const summaryText = `${warningIcon}${count} issue${count === 1 ? "" : "s"} flagged`;
    const bodyHtml = String(detailsHtml || "").trim() || '<div class="muted">No additional details.</div>';
    const detailsClass = `assistant-initial-report-details${count > 0 ? " flagged" : ""}`;
    const previewText = String(collapsedPreview || "").trim();
    const previewHtml = previewText
      ? `<span>${escapeHtml(previewText)}</span>`
      : "";
    return `
      <details class="${detailsClass}">
        <summary>${previewHtml}<span class="assistant-summary-footer"><span class="assistant-expand-link"><span class="assistant-expand-hint">See details...</span></span><span class="muted">${summaryText}</span></span></summary>
        <div class="assistant-initial-report-body">${bodyHtml}</div>
      </details>
    `;
  }

  function formatNTNUInitialReviewHtml(reviewPayload) {
    const review = reviewPayload && typeof reviewPayload === "object" ? reviewPayload : {};
    const rawFlags = Array.isArray(review.flags) ? review.flags : [];
    const parsedFlags = rawFlags.map((flag) => {
      if (!flag || typeof flag !== "object") return null;
      return {
        severity: String(flag.severity || "").toLowerCase(),
        issue: String(flag.issue || "").trim(),
        why: String(flag.why_it_matters || "").trim(),
        source: String(flag.source || "").trim(),
      };
    }).filter(Boolean);

    const mustCheck = Array.isArray(review.must_check)
      ? review.must_check
      : parsedFlags
        .filter((flag) => flag.severity === "high")
        .map((flag) => `${flag.issue}${flag.why ? ` - ${flag.why}` : ""}`)
        .filter((text) => text.trim());

    const potentialIssues = Array.isArray(review.potential_issues)
      ? review.potential_issues
      : parsedFlags
        .map((flag) => {
          const sev = flag.severity ? `${flag.severity.toUpperCase()}: ` : "";
          return `${sev}${flag.issue}${flag.why ? ` - ${flag.why}` : ""}`;
        })
        .filter((text) => text.trim());

    const adminNotes = Array.isArray(review.administrative_notes) ? review.administrative_notes : [];
    const observations = Array.isArray(review.ntnu_relevant_observations)
      ? review.ntnu_relevant_observations
      : Array.isArray(review.key_points)
        ? review.key_points
        : [];
    const sources = Array.isArray(review.sources)
      ? review.sources
      : [...new Set(parsedFlags.map((flag) => flag.source).filter((text) => text))];

    const sectionHtml = (label, items) => {
      const listHtml = formatListWithoutEmptyState(items);
      if (!listHtml) return "";
      return `<div><strong>${label}</strong>${listHtml}</div>`;
    };

    const issueCount = parsedFlags.length || [...new Set([...mustCheck, ...potentialIssues].map((item) => String(item || "").trim().toLowerCase()).filter((item) => item))].length;
    const mustCheckHtml = sectionHtml("Must check", mustCheck);
    const potentialIssuesHtml = sectionHtml("Potential issues", potentialIssues);
    const adminNotesHtml = sectionHtml("Administrative notes", adminNotes);
    const observationsHtml = sectionHtml("NTNU observations", observations);
    const sourcesHtml = sectionHtml("Sources", sources);
    const summary = String(review.summary || "").trim();
    const summaryHtml = summary ? `<div class="fairness-item">${escapeHtml(summary)}</div>` : "";
    return renderInitialReportDetails(
      "Initial NTNU Review",
      issueCount,
      `${mustCheckHtml}${potentialIssuesHtml}${adminNotesHtml}${observationsHtml}${sourcesHtml}${summaryHtml}`,
    );
  }

  function formatNTNUQaAnswerHtml(answerPayload) {
    const payload = answerPayload && typeof answerPayload === "object" ? answerPayload : {};
    const answer = escapeHtml(String(payload.answer || payload.response_text || "No NTNU policy answer returned."));
    const confidence = escapeHtml(String(payload.confidence || "unknown"));
    const normalizeList = (items) => {
      const seen = new Set();
      const output = [];
      (Array.isArray(items) ? items : []).forEach((item) => {
        const text = String(item || "").trim();
        if (!text) return;
        const key = text.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        output.push(text);
      });
      return output;
    };
    const explicitSupportingDocs = normalizeList(payload.supporting_documents);
    const sources = normalizeList(payload.sources);
    const supportingDocs = explicitSupportingDocs.length ? explicitSupportingDocs : sources;
    const keyPoints = Array.isArray(payload.key_points) ? payload.key_points : [];
    const docs = formatNTNUList(supportingDocs);
    const keyPointsHtml = keyPoints.length
      ? `<div><strong>Key points</strong>${formatNTNUList(keyPoints)}</div>`
      : "";
    const docsHtml = docs ? `<div><strong>Supporting documents</strong>${docs}</div>` : "";
    const sourcesOnly = sources.filter((item) => !supportingDocs.some((doc) => doc.toLowerCase() === item.toLowerCase()));
    const sourcesHtml = sourcesOnly.length
      ? `<div><strong>Sources</strong>${formatNTNUList(sourcesOnly)}</div>`
      : "";
    return `<div>${answer}</div><div><strong>Confidence:</strong> ${confidence}</div>${keyPointsHtml}${docsHtml}${sourcesHtml}`;
  }

  function formatNTNUFinalAuditHtml(auditPayload) {
    const audit = auditPayload && typeof auditPayload === "object" ? auditPayload : {};
    const sectionHtml = (label, items) => {
      const listHtml = formatNTNUList(items);
      return listHtml ? `<div>${label}${listHtml}</div>` : "";
    };
    const candidateFlagsHtml = sectionHtml("Candidate flags", audit.candidate_flags);
    const rationaleFlagsHtml = sectionHtml("Rationale flags", audit.rationale_flags);
    const policyNotesHtml = sectionHtml("Policy notes", audit.policy_notes);
    const sourcesHtml = sectionHtml("Sources", audit.sources);
    return `${candidateFlagsHtml}${rationaleFlagsHtml}${policyNotesHtml}${sourcesHtml}`;
  }

  function formatFairnessIssuesHtml(issues) {
    const rows = Array.isArray(issues) ? issues : [];
    if (!rows.length) {
      return '<div class="fairness-item ok">No specific fairness concerns were flagged.</div>';
    }

    return rows.map((issue) => {
      const severity = String((issue && issue.severity) || "low").toLowerCase();
      const cls = severity === "high" || severity === "medium" ? "warn" : "ok";
      // Support both prompt schema (message/question) and legacy schema (type/description/evidence/recommendation)
      const rawLabel = String((issue && (issue.type || issue.message)) || "Potential concern");
      const rawBody = String((issue && (issue.description || (issue.type ? "" : issue.message) || "")) || "");
      const normalizedLabel = rawLabel.trim();
      const normalizedBody = rawBody.trim();
      const label = escapeHtml(normalizedLabel);
      const body = normalizedBody && normalizedBody !== normalizedLabel
        ? escapeHtml(normalizedBody)
        : "";
      const detail = escapeHtml(String((issue && (issue.evidence || issue.question || "")) || ""));
      const detailLabel = (issue && issue.question) ? "Consider" : (issue && issue.evidence) ? "Evidence" : "";
      const recommendation = escapeHtml(String((issue && issue.recommendation) || ""));
      return `
        <div class="fairness-item ${cls}">
          <div>${label} <span class="muted">(${escapeHtml(severity)})</span></div>
          ${body ? `<div>${body}</div>` : ""}
          ${detail && detailLabel ? `<div class="muted">${detailLabel === "Consider" ? `<strong>${detailLabel}:</strong>` : `${detailLabel}:`} ${detail}</div>` : ""}
          ${recommendation ? `<div class="muted">Recommendation: ${recommendation}</div>` : ""}
        </div>
      `;
    }).join("");
  }

  function formatFairnessQaAnswerHtml(answerPayload) {
    const payload = answerPayload && typeof answerPayload === "object" ? answerPayload : {};
    const fallbackText = payload.response_text || payload.raw_response_text || payload.summary || payload.message || "";
    const streamErrorMessage = String(payload.stream_error_message || payload.error_message || "").trim();
    const answerText = String(payload.answer || fallbackText || "").trim();
    const emptyFallback = streamErrorMessage
      ? `No structured answer returned. ${streamErrorMessage}`
      : "No structured answer returned. The model may have returned no text for this request.";
    const answer = escapeHtml(answerText || emptyFallback);
    const considerations = Array.isArray(payload.key_considerations)
      ? payload.key_considerations
      : Array.isArray(payload.considerations)
        ? payload.considerations
        : [];
    const risks = Array.isArray(payload.potential_risks)
      ? payload.potential_risks
      : Array.isArray(payload.risks)
        ? payload.risks
        : Array.isArray(payload.potential_bias_risks)
          ? payload.potential_bias_risks
        : [];
    const considerationsLabel = Array.isArray(payload.key_considerations) ? "Key considerations" : "Considerations";
    const considerationsHtml = considerations.length
      ? `<div><strong>${considerationsLabel}</strong><ul>${considerations.map((item) => `<li>${escapeHtml(String(item || ""))}</li>`).join("")}</ul></div>`
      : "";
    const risksHtml = risks.length
      ? `<div><strong>Potential risks</strong><ul>${risks.map((item) => `<li>${escapeHtml(String(item || ""))}</li>`).join("")}</ul></div>`
      : "";
    return `<div>${answer}</div>${considerationsHtml}${risksHtml}`;
  }

  function toStreamFieldLabel(key) {
    return String(key || "")
      .replace(/[_-]+/g, " ")
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function findJsonStringEnd(text, startQuoteIndex) {
    let escaped = false;
    for (let index = startQuoteIndex + 1; index < text.length; index += 1) {
      const char = text[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        return index;
      }
    }
    return -1;
  }

  function findJsonValueBoundary(text, startIndex) {
    let nesting = 0;
    let inString = false;
    let escaped = false;

    for (let index = startIndex; index < text.length; index += 1) {
      const char = text[index];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === "{" || char === "[") {
        nesting += 1;
        continue;
      }

      if (char === "}" || char === "]") {
        if (nesting === 0 && char === "}") {
          return { endIndex: index, delimiter: "}", complete: true };
        }
        if (nesting > 0) nesting -= 1;
        continue;
      }

      if (char === "," && nesting === 0) {
        return { endIndex: index, delimiter: ",", complete: true };
      }
    }

    return { endIndex: text.length, delimiter: null, complete: false };
  }

  // Parse top-level JSON fields from a partial stream so each field can render as soon as it starts.
  function parseTopLevelJsonFieldsFromStream(streamText) {
    const text = String(streamText || "");
    const objectStart = text.indexOf("{");
    if (objectStart === -1) return [];

    const fields = [];
    let index = objectStart + 1;

    while (index < text.length) {
      while (index < text.length && /[\s,]/.test(text[index])) index += 1;
      if (index >= text.length || text[index] === "}") break;
      if (text[index] !== '"') break;

      const keyEnd = findJsonStringEnd(text, index);
      if (keyEnd === -1) break;

      const keyToken = text.slice(index, keyEnd + 1);
      let key = "";
      try {
        key = JSON.parse(keyToken);
      } catch {
        key = keyToken.slice(1, -1);
      }

      index = keyEnd + 1;
      while (index < text.length && /\s/.test(text[index])) index += 1;
      if (text[index] !== ":") break;

      index += 1;
      while (index < text.length && /\s/.test(text[index])) index += 1;

      const valueStart = index;
      const boundary = findJsonValueBoundary(text, valueStart);
      const rawValue = text.slice(valueStart, boundary.endIndex).trim();
      fields.push({
        key,
        rawValue,
        complete: boundary.complete,
      });

      if (!boundary.complete || boundary.delimiter === "}") break;
      index = boundary.endIndex + 1;
    }

    return fields;
  }

  function decodePartialJsonText(rawValue) {
    let text = String(rawValue || "").trim();
    if (!text) return "";
    if (text.startsWith('"')) text = text.slice(1);
    text = text
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\r/g, "\r")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
    if (text.endsWith('"')) text = text.slice(0, -1);
    return text;
  }

  function decodeJsonStringFragment(fragment) {
    const text = String(fragment || "");
    return text
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\r/g, "\r")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }

  // Extract string items from a JSON array as it is streaming, including the in-progress final item.
  function extractStreamingStringArrayItems(rawValue) {
    const text = String(rawValue || "").trim();
    if (!text) return [];

    let source = text;
    if (source.startsWith("[")) source = source.slice(1);

    const items = [];
    let inString = false;
    let escaped = false;
    let current = "";

    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];

      if (!inString) {
        if (char === '"') {
          inString = true;
          current = "";
        } else if (char === "]") {
          break;
        }
        continue;
      }

      if (escaped) {
        current += `\\${char}`;
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === '"') {
        items.push(decodeJsonStringFragment(current));
        inString = false;
        current = "";
        continue;
      }

      current += char;
    }

    if (inString && current) {
      items.push(decodeJsonStringFragment(current));
    }

    return items.filter((item) => String(item || "").trim().length > 0);
  }

  function formatJsonValueForStream(value) {
    if (value == null) return '<div class="muted">No content.</div>';

    if (typeof value === "string") {
      const rendered = sectionContentToHtml(value);
      return rendered || '<div class="muted">No content.</div>';
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return `<div class="section-paragraph">${escapeHtml(String(value))}</div>`;
    }

    if (Array.isArray(value)) {
      if (!value.length) return '<div class="muted">No entries.</div>';

      if (value.every((item) => typeof item === "string" || item == null)) {
        return `<ul>${value.map((item) => `<li>${escapeHtml(String(item || ""))}</li>`).join("")}</ul>`;
      }

      return value.map((item, idx) => `
        <div class="fairness-item">
          <div><strong>Item ${idx + 1}</strong></div>
          ${formatJsonValueForStream(item)}
        </div>
      `).join("");
    }

    if (typeof value === "object") {
      const entries = Object.entries(value);
      if (!entries.length) return '<div class="muted">No details.</div>';

      return entries.map(([key, nestedValue]) => {
        const label = escapeHtml(toStreamFieldLabel(key));
        if (typeof nestedValue === "string") {
          return `<div class="section-subheading"><strong>${label}</strong></div>${sectionContentToHtml(nestedValue)}`;
        }
        if (nestedValue == null || typeof nestedValue === "number" || typeof nestedValue === "boolean") {
          return `<div class="section-paragraph"><strong>${label}:</strong> ${escapeHtml(String(nestedValue ?? ""))}</div>`;
        }
        return `<div class="section-subheading"><strong>${label}</strong></div>${formatJsonValueForStream(nestedValue)}`;
      }).join("");
    }

    return `<pre>${escapeHtml(String(value))}</pre>`;
  }

  function formatStructuredFairnessStreamHtml(streamText, streamTitle) {
    const text = String(streamText || "");
    if (!text.trim()) {
      return `<div class="fairness-item"><strong>${escapeHtml(String(streamTitle || "Live stream"))}</strong><div class="muted">Waiting for first streamed field...</div></div>`;
    }

    const fields = parseTopLevelJsonFieldsFromStream(text);
    if (!fields.length) {
      const fallbackHtml = sectionContentToHtml(text) || `<pre>${escapeHtml(text)}</pre>`;
      return `<div class="fairness-item"><strong>${escapeHtml(String(streamTitle || "Live stream"))}</strong></div>${fallbackHtml}`;
    }

    const answerField = fields.find((field) => normalizeSectionKey(field.key) === "answer");
    const considerationsField = fields.find((field) => {
      const key = normalizeSectionKey(field.key);
      return key === "considerations" || key === "key considerations" || key === "keyconsiderations";
    });

    if (answerField || considerationsField) {
      let answerText = "";
      if (answerField) {
        if (answerField.complete) {
          try {
            const parsed = JSON.parse(answerField.rawValue || "null");
            answerText = typeof parsed === "string" ? parsed : String(parsed ?? "");
          } catch {
            answerText = decodePartialJsonText(answerField.rawValue || "");
          }
        } else {
          answerText = decodePartialJsonText(answerField.rawValue || "");
        }
      }

      let considerations = [];
      if (considerationsField) {
        if (considerationsField.complete) {
          try {
            const parsed = JSON.parse(considerationsField.rawValue || "[]");
            if (Array.isArray(parsed)) {
              considerations = parsed.map((item) => String(item || "")).filter((item) => item.trim().length > 0);
            }
          } catch {
            considerations = extractStreamingStringArrayItems(considerationsField.rawValue || "");
          }
        } else {
          considerations = extractStreamingStringArrayItems(considerationsField.rawValue || "");
        }
      }

      const answerHtml = answerText
        ? `<div class="section-paragraph">${escapeHtml(answerText)}</div>`
        : '<div class="muted">Waiting for answer...</div>';

      const considerationsHtml = considerationsField
        ? `<div><strong>Considerations:</strong>${considerations.length ? `<ul>${considerations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : '<div class="muted">Waiting for considerations...</div>'}</div>`
        : "";

      return `<div class="fairness-item"><strong>${escapeHtml(String(streamTitle || "Live stream"))}</strong></div>${answerHtml}${considerationsHtml}`;
    }

    const fieldsHtml = fields.map((field) => {
      let valueHtml = "";
      if (field.complete) {
        try {
          valueHtml = formatJsonValueForStream(JSON.parse(field.rawValue || "null"));
        } catch {
          valueHtml = `<pre>${escapeHtml(String(field.rawValue || ""))}</pre>`;
        }
      } else {
        const partialText = decodePartialJsonText(field.rawValue || "");
        valueHtml = partialText
          ? sectionContentToHtml(partialText)
          : '<div class="muted">Waiting for content...</div>';
      }

      return `<div class="fairness-item"><div><strong>${escapeHtml(toStreamFieldLabel(field.key))}</strong></div>${valueHtml}</div>`;
    }).join("");

    return `<div class="fairness-item"><strong>${escapeHtml(String(streamTitle || "Live stream"))}</strong></div>${fieldsHtml}`;
  }

  function buildCrossCandidateRatingsPayload(ratingsState) {
    const byCandidate = (ratingsState && ratingsState.by_candidate) || {};
    const ratings = {};
    const rationales = {};

    Object.entries(byCandidate).forEach(([candidateId, bucket]) => {
      const b = bucket && typeof bucket === "object" ? bucket : {};
      ratings[candidateId] = {
        overall_stars: clampStars(b.overall_stars),
        weighted_avg: Number(b.weighted_avg || 0),
        final_stars: clampStars(b.final_stars),
        summary_ratings: b.summary_ratings && typeof b.summary_ratings === "object" ? b.summary_ratings : {},
        document_ratings: b.document_ratings && typeof b.document_ratings === "object" ? b.document_ratings : {},
      };
      rationales[candidateId] = String(b.justification || "");
    });

    return { ratings, rationales };
  }

  function buildCrossCandidateMetadata(rankedProfiles) {
    return (Array.isArray(rankedProfiles) ? rankedProfiles : []).map((entry) => {
      const candidate = (entry && entry.candidate) || {};
      const row = (entry && entry.row) || {};
      return {
        application_id: String(candidate.application_id || ""),
        display_name: String(candidate.display_name || candidate.name || candidate.application_id || ""),
        rank: Number(row.rank || 0),
        score: Number(row.score || 0),
        baseline_score: Number(row.baseline_score || 0),
        summary_text: String(candidate.summary_text || ""),
      };
    });
  }

  async function loadCandidateRatingsPage() {
    await ensureWorkflowSessionReady();
    const candidates = getH2HCandidates();
    const state = getH2HState();
    const meta = document.getElementById("candidateRatingsMeta");
    const listWrap = document.getElementById("ratingCandidateList");
    const summaryRatingsWrap = document.getElementById("summaryFieldRatings");
    const documentRatingsWrap = document.getElementById("documentFieldRatings");
    const overallStarsWrap = document.getElementById("ratingOverallStarsControl");
    const weightedAvgValue = document.getElementById("ratingWeightedAverageValue");
    const weightedAvgMeta = document.getElementById("ratingWeightedAverageMeta");
    const finalBadge = document.getElementById("ratingFinalStarsBadge");
    const ratingScoreDetails = document.getElementById("ratingScoreDetails");
    const groupsWrap = document.getElementById("ratingGroups");
    const submitAllRatingsRunAuditsBtn = document.getElementById("submitAllRatingsRunAuditsBtn");
    const overallJustification = document.getElementById("ratingOverallJustification");
    const submitEvaluationBtn = document.getElementById("ratingSubmitEvaluationBtn");
    const submitEvaluationStatus = document.getElementById("ratingSubmitEvaluationStatus");
    const fairnessInitialStatus = document.getElementById("fairnessInitialStatus");
    const fairnessInitialReview = document.getElementById("fairnessInitialReview");
    const fairnessQuestionInput = document.getElementById("fairnessQuestionInput");
    const fairnessAskBtn = document.getElementById("fairnessAskBtn");
    const fairnessChatLog = document.getElementById("fairnessChatLog");
    const ntnuInitialStatus = document.getElementById("ntnuInitialStatus");
    const ntnuInitialReview = document.getElementById("ntnuInitialReview");
    const ntnuQuestionInput = document.getElementById("ntnuQuestionInput");
    const ntnuAskBtn = document.getElementById("ntnuAskBtn");
    const ntnuChatLog = document.getElementById("ntnuChatLog");
    let fairnessChatAutoScrollObserver = null;
    let ntnuChatAutoScrollObserver = null;

    const scrollChatLogToBottom = (logEl) => {
      if (!logEl) return;
      logEl.scrollTop = Math.max(0, logEl.scrollHeight - logEl.clientHeight);
      requestAnimationFrame(() => {
        if (!logEl) return;
        logEl.scrollTop = Math.max(0, logEl.scrollHeight - logEl.clientHeight);
      });
      window.setTimeout(() => {
        if (!logEl) return;
        logEl.scrollTop = Math.max(0, logEl.scrollHeight - logEl.clientHeight);
      }, 0);
    };

    const scrollFairnessChatToBottom = () => scrollChatLogToBottom(fairnessChatLog);
    const scrollNTNUChatToBottom = () => scrollChatLogToBottom(ntnuChatLog);

    const attachChatScrollObserver = (logEl, scrollFn) => {
      if (!logEl) return null;
      const observer = new MutationObserver(() => {
        if (logEl.dataset.followLatest === "true") scrollFn();
      });
      observer.observe(logEl, { childList: true, subtree: true, characterData: true });
      return observer;
    };

    if (!fairnessChatAutoScrollObserver) {
      fairnessChatAutoScrollObserver = attachChatScrollObserver(fairnessChatLog, scrollFairnessChatToBottom);
    }

    if (!ntnuChatAutoScrollObserver) {
      ntnuChatAutoScrollObserver = attachChatScrollObserver(ntnuChatLog, scrollNTNUChatToBottom);
    }

    if (ratingScoreDetails) {
      ratingScoreDetails.open = true;
    }

    if (!candidates.length || !state) {
      if (meta) meta.textContent = "No head-to-head data found. Run rounds first.";
      if (listWrap) listWrap.innerHTML = '<p class="muted">Start at Head-to-Head to generate candidate ratings.</p>';
      return;
    }

    ensureCandidateAliases(candidates, state);
    saveH2HCandidates(candidates);
    saveH2HState(state);

    const h2hState = await computeH2HState(candidates, state.comparisons || []);
    const rows = Array.isArray(h2hState.rows) ? h2hState.rows : [];
    const topRows = rows.slice(0, 6).map((row, index) => ({ ...row, rank: index + 1 }));
    const cmap = candidateMap(candidates);
    const rankedProfiles = topRows
      .map((row) => ({ row, candidate: cmap[row.application_id] }))
      .filter((entry) => Boolean(entry.candidate));

    if (!rankedProfiles.length) {
      const fallbackCandidates = candidates.slice(0, 6).map((candidate, index) => ({
        row: {
          rank: index + 1,
          score: 0,
          wins: 0,
          losses: 0,
          comparisons: 0,
        },
        candidate,
      }));

      if (fallbackCandidates.length) {
        rankedProfiles.push(...fallbackCandidates);
        if (meta) {
          meta.textContent = "No comparisons yet, so showing saved candidates and loading fairness notes from the first available profile.";
        }
      } else {
        if (meta) meta.textContent = "Could not derive top candidates from current state.";
        return;
      }
    }

    if (meta) {
      if (Array.isArray(state.comparisons) && state.comparisons.length > 0) {
        meta.textContent = `Rate top ${rankedProfiles.length} candidates from ${state.comparisons.length} recorded comparisons.`;
      }
    }

    await logStageEvent(
      "candidate_ratings",
      "page_loaded",
      {},
      {
        candidate_count: rankedProfiles.length,
        comparison_count: Number((Array.isArray(state.comparisons) ? state.comparisons.length : 0) || 0),
      },
    );

    const storedConfig = getStoredConfig() || defaultConfig();
    const fairnessAssistantConfig = {
      model: String((((storedConfig || {}).fairness_assistant || {}).model) || "gpt-5.4-mini"),
      prompt_dir: "prompts/eval_assistants",
      additional_instructions: String((((storedConfig || {}).fairness_assistant || {}).additional_instructions) || ""),
    };
    const ntnuAssistantConfig = {
      model: String((((storedConfig || {}).ntnu_assistant || {}).model) || "gpt-5.4-mini"),
      prompt_dir: "prompts/eval_assistants",
      additional_instructions: String((((storedConfig || {}).ntnu_assistant || {}).additional_instructions) || ""),
    };
    const cbrWeights = normalizeWeightMap(storedConfig.cbr_weights || defaultConfig().cbr_weights);
    const ratingsState = loadCandidateRatingsState();
    const assistantContextKey = JSON.stringify({
      signature: String((state && state.signature) || ""),
      configSignature: String((state && state.configSignature) || ""),
      sourcePath: String((state && state.sourcePath) || ""),
      comparisonCount: Number((state && Array.isArray(state.comparisons) ? state.comparisons.length : 0) || 0),
    });

    if (ratingsState.assistant_context_key !== assistantContextKey) {
      clearAssistantStateForAllCandidates(ratingsState);
      ratingsState.assistant_context_key = assistantContextKey;
      saveCandidateRatingsState(ratingsState);
    }

    const queryCandidateId = new URLSearchParams(window.location.search).get("candidate_id");
    const queryCandidateExists = Boolean(
      queryCandidateId
      && rankedProfiles.some((entry) => entry.candidate.application_id === queryCandidateId)
    );
    let activeId = queryCandidateExists ? String(queryCandidateId) : rankedProfiles[0].candidate.application_id;
    const totalComparisons = Array.isArray(state.comparisons) ? state.comparisons.length : 0;
    const tabStateByCandidate = {};
    let renderGeneration = 0;
    let activeMaterials = {};
    let activeProfilePayload = {};
    let activeProfileTab = "__overview__";
    let activeSummaryItems = [];
    let activeDocumentItems = [];
    let activeBucket = null;
    let activeRefreshScoring = () => {};
    let activeLogRatingAction = () => {};

    // ─── Shared assistant chat-log renderer ───────────────────────────────────
    // Both panels render the same HTML for their QA history; only the assistant
    // title string and scroll callback differ.
    const renderAssistantChatLog = (logEl, qaHistory, assistantTitle, scrollFn) => {
      if (!logEl) return;
      const previousWasNearBottom = (
        logEl.scrollHeight - logEl.clientHeight - logEl.scrollTop
      ) < 72;
      const followLatest = qaHistory.length > 0;
      logEl.dataset.followLatest = followLatest ? "true" : "false";

      logEl.innerHTML = qaHistory.length
        ? qaHistory.map((entry) => {
          const role = String((entry && entry.role) || "assistant");
          const cls = role === "user" ? "user" : "assistant";
          const title = role === "user" ? "You" : assistantTitle;
          const cleanedAssistantHtml = String((entry && entry.html) || "")
            .replace(/<details class="fairness-raw-response"[\s\S]*?<\/details>/gi, "");
          const body = role === "assistant"
            ? cleanedAssistantHtml
            : `<div>${escapeHtml(String((entry && entry.text) || ""))}</div>`;
          return `<div class="fairness-chat-message ${cls}"><strong>${title}</strong>${body}</div>`;
        }).join("")
        : '<p class="muted">No questions yet.</p>';

      if (followLatest || previousWasNearBottom) {
        scrollFn();
      }
    };

    const getSensitiveAttributes = (candidateProfile = {}, candidate = null) => {
      const profileSensitive = candidateProfile && typeof candidateProfile.sensitive_attributes === "object"
        ? candidateProfile.sensitive_attributes
        : {};
      if (Object.keys(profileSensitive).length > 0) {
        return profileSensitive;
      }

      const candidateSensitive = candidate && candidate.cbr_features
        && typeof candidate.cbr_features === "object"
        && candidate.cbr_features.sensitive_attributes_not_for_evaluation
        && typeof candidate.cbr_features.sensitive_attributes_not_for_evaluation === "object"
        ? candidate.cbr_features.sensitive_attributes_not_for_evaluation
        : {};
      return candidateSensitive;
    };

    const renderFairnessPanel = (bucket) => {
      const fairnessState = bucket.fairness || {};
      const review = fairnessState.initial_review;
      const qaHistory = Array.isArray(fairnessState.qa_history) ? fairnessState.qa_history : [];

      if (fairnessInitialStatus) {
        if (fairnessState.initial_review_loading) {
          fairnessInitialStatus.textContent = "Fairness assistant is reviewing this candidate...";
        } else if (fairnessState.initial_review_error) {
          fairnessInitialStatus.textContent = `Could not load fairness notes: ${fairnessState.initial_review_error}`;
        } else if (review) {
          fairnessInitialStatus.textContent = "Fairness notes loaded. Keep these in mind while rating.";
        } else {
          fairnessInitialStatus.textContent = "Loading fairness notes...";
        }
      }

      if (fairnessInitialReview) {
        if (fairnessState.initial_review_loading && fairnessState.initial_review_stream_text) {
          fairnessInitialReview.innerHTML = formatStructuredFairnessStreamHtml(
            fairnessState.initial_review_stream_text,
            "Live fairness review stream",
          );
        } else if (review && typeof review === "object") {
          const rawFlags = Array.isArray(review.fairness_flags)
            ? review.fairness_flags
            : Array.isArray(review.flags)
              ? review.flags
              : [];
          const flags = rawFlags.map((flag) => {
            if (flag && typeof flag === "object") {
              return {
                type: String(flag.type || flag.issue || "Potential concern"),
                description: String(flag.description || flag.message || flag.issue || ""),
                what_to_check: String(flag.what_to_check || flag.question || flag.why_it_matters || ""),
              };
            }
            return {
              type: "Potential concern",
              description: String(flag || ""),
              what_to_check: "",
            };
          }).filter((flag) => flag.description || flag.what_to_check || flag.type);
          const reflectionQuestions = Array.isArray(review.reflection_questions) ? review.reflection_questions : [];
          const overallNote = escapeHtml(String(review.overall_note || review.summary || ""));
          const flagHtml = flags.length
            ? flags.map((flag) => {
              const type = escapeHtml(String((flag && flag.type) || "Potential concern"));
              const description = escapeHtml(String((flag && flag.description) || ""));
              const check = escapeHtml(String((flag && flag.what_to_check) || ""));
              return `<div class="fairness-item warn"><div><strong>${type}</strong></div>${description ? `<div>${description}</div>` : ""}${check ? `<div class="muted">What to check: ${check}</div>` : ""}</div>`;
            }).join("")
            : "";
          const reflectionsHtml = reflectionQuestions.length
            ? `<div class="fairness-item"><div><strong>Reflection questions</strong></div><ul>${reflectionQuestions.map((item) => `<li>${escapeHtml(String(item || ""))}</li>`).join("")}</ul></div>`
            : "";
          fairnessInitialReview.innerHTML = renderInitialReportDetails(
            "Initial Fairness Notes",
            flags.length,
            `${flagHtml}${reflectionsHtml}${overallNote ? `<div class="fairness-item">${overallNote}</div>` : ""}`,
          );
        } else {
          fairnessInitialReview.innerHTML = "";
        }
      }

      renderAssistantChatLog(
        fairnessChatLog,
        qaHistory.map((entry) => ({ ...entry, qa_loading_override: fairnessState.qa_loading })),
        "Fairness Assistant",
        scrollFairnessChatToBottom,
      );

      // Reflect qa_loading state: if loading, keep followLatest on so live updates scroll.
      if (fairnessChatLog && fairnessState.qa_loading) {
        fairnessChatLog.dataset.followLatest = "true";
      }
    };

    const renderNTNUPanel = (bucket) => {
      const ntnuState = bucket.ntnu || {};
      const review = ntnuState.initial_review;
      const qaHistory = Array.isArray(ntnuState.qa_history) ? ntnuState.qa_history : [];

      if (ntnuInitialStatus) {
        if (ntnuState.initial_review_loading) {
          ntnuInitialStatus.textContent = "NTNU assistant is reviewing this candidate...";
        } else if (ntnuState.initial_review_error) {
          ntnuInitialStatus.textContent = `Could not load NTNU review: ${ntnuState.initial_review_error}`;
        } else if (review) {
          ntnuInitialStatus.textContent = "NTNU review loaded. Use these checks during evaluation.";
        } else {
          ntnuInitialStatus.textContent = "Loading NTNU review";
        }
      }

      if (ntnuInitialReview) {
        if (ntnuState.initial_review_loading && ntnuState.initial_review_stream_text) {
          ntnuInitialReview.innerHTML = formatStructuredFairnessStreamHtml(
            ntnuState.initial_review_stream_text,
            "Live NTNU review stream",
          );
        } else if (review && typeof review === "object") {
          ntnuInitialReview.innerHTML = formatNTNUInitialReviewHtml(review);
        } else {
          ntnuInitialReview.innerHTML = "";
        }
      }

      renderAssistantChatLog(ntnuChatLog, qaHistory, "NTNU Assistant", scrollNTNUChatToBottom);

      if (ntnuChatLog && ntnuState.qa_loading) {
        ntnuChatLog.dataset.followLatest = "true";
      }
    };

    // ─── Shared initial-review lifecycle helper ───────────────────────────────
    // Both assistants follow: guard → set loading → stream → commit → log → finally.
    // `opts.getAssistantState(bucket)` - returns the mutable state object inside the bucket
    // `opts.streamRequest(candidate, candidateMaterials, onDelta, onError)` - fires the stream
    // `opts.commitResult(assState, response)` - persists the response into the state
    // `opts.logEvent(response, candidate)` - fires logStageEvent for this assistant
    // `opts.renderPanel(bucket)` - re-renders the sidebar panel
    // `opts.errorPrefix` - prefix for error strings
    const runInitialAssistantReview = async (bucket, candidate, candidateMaterials, opts) => {
      const assState = opts.getAssistantState(bucket);
      if (assState.initial_review_loading) return;
      if (assState.initial_review) return;

      assState.initial_review_loading = true;
      assState.initial_review_error = "";
      saveCandidateRatingsState(ratingsState);
      opts.renderPanel(bucket);

      try {
        const response = await opts.streamRequest(candidate, candidateMaterials, {
          onDelta: (eventPayload) => {
            assState.initial_review_stream_text = String((eventPayload && eventPayload.response_text) || "");
            opts.renderPanel(bucket);
          },
          onError: (eventPayload) => {
            assState.initial_review_error = String(
              (eventPayload && eventPayload.error_message) || `${opts.errorPrefix} review stream error`,
            );
          },
        });

        opts.commitResult(assState, response);
        assState.initial_review_error = "";
        assState.initial_review_stream_text = "";
        opts.logEvent(response, candidate);
      } catch (error) {
        assState.initial_review_error = String(
          (error && error.message) || error || `Unknown ${opts.errorPrefix} review error`,
        );
        assState.initial_review_stream_text = "";
      } finally {
        assState.initial_review_loading = false;
        saveCandidateRatingsState(ratingsState);
        opts.renderPanel(bucket);
      }
    };

    const startInitialFairnessReview = async (bucket, candidate, candidateMaterials, candidateProfile = {}) => {
      await runInitialAssistantReview(bucket, candidate, candidateMaterials, {
        getAssistantState: (b) => b.fairness || {},
        renderPanel: renderFairnessPanel,
        errorPrefix: "Fairness",
        streamRequest: (cand, mats, handlers) => requestFairnessCandidateReviewStream({
          candidate_id: String(cand.application_id || ""),
          candidate_materials: {
            application_id: String(cand.application_id || ""),
            display_name: String(cand.display_name || cand.name || cand.application_id || ""),
            summary_text: String(cand.summary_text || ""),
            profile_materials: mats || {},
          },
          candidate_summary: String((candidateProfile && candidateProfile.summary_text) || cand.summary_text || ""),
          sensitive_attributes: getSensitiveAttributes(candidateProfile, cand),
          ratings: {
            overall_stars: clampStars(bucket.overall_stars),
            weighted_avg: Number(bucket.weighted_avg || 0),
            final_stars: clampStars(bucket.final_stars),
            summary_ratings: bucket.summary_ratings || {},
            document_ratings: bucket.document_ratings || {},
          },
          notes: String(bucket.justification || ""),
          fairness_config: fairnessAssistantConfig,
        }, handlers),
        commitResult: (fairnessState, response) => {
          fairnessState.initial_review = (response && response.review) || {};
          fairnessState.review_history.push({
            type: "initial_review",
            candidate_id: String(candidate.application_id || ""),
            prompt_system: String((response && response.prompt_system) || ""),
            prompt_user: String((response && response.prompt_user) || ""),
            response_text: String((response && response.response_text) || ""),
            raw_response_text: String((response && response.response_text) || ""),
            response_json: (response && response.review) || {},
          });
        },
        logEvent: (response) => logStageEvent(
          "candidate_ratings",
          "fairness_candidate_review_loaded",
          { candidate_id: String(candidate.application_id || "") },
          {
            candidate_id: String(candidate.application_id || ""),
            prompt_system_excerpt: truncateForLog(String((response && response.prompt_system) || ""), 400),
            prompt_user_excerpt: truncateForLog(String((response && response.prompt_user) || ""), 600),
            response_text_excerpt: truncateForLog(String((response && response.response_text) || ""), 1200),
            flag_count: Array.isArray(((response || {}).review || {}).fairness_flags) ? ((response || {}).review || {}).fairness_flags.length : 0,
          },
        ),
      });
    };

    const startInitialNTNUReview = async (bucket, candidate, candidateMaterials, candidateProfile = {}) => {
      await runInitialAssistantReview(bucket, candidate, candidateMaterials, {
        getAssistantState: (b) => b.ntnu || {},
        renderPanel: renderNTNUPanel,
        errorPrefix: "NTNU",
        streamRequest: (cand, mats, handlers) => requestNTNUInitialReviewStream({
          candidate_id: String(cand.application_id || ""),
          candidate_materials: {
            application_id: String(cand.application_id || ""),
            display_name: String(cand.display_name || cand.name || cand.application_id || ""),
            summary_text: String(cand.summary_text || ""),
            profile_materials: mats || {},
          },
          candidate_summary: String(cand.summary_text || ""),
          sensitive_attributes: getSensitiveAttributes(candidateProfile, cand),
          ntnu_config: ntnuAssistantConfig,
        }, handlers),
        commitResult: (ntnuState, response) => {
          ntnuState.initial_review = (response && response.review) || {};
          ntnuState.review_history = Array.isArray(ntnuState.review_history) ? ntnuState.review_history : [];
          ntnuState.review_history.push({
            type: "initial_review",
            response_text: String((response && response.response_text) || ""),
            response_json: (response && response.review) || {},
            routed_categories: (response && response.routed_categories) || [],
            retrieved_files: (response && response.retrieved_files) || [],
          });
        },
        logEvent: (response) => logStageEvent(
          "candidate_ratings",
          "ntnu_candidate_review_loaded",
          { candidate_id: String(candidate.application_id || "") },
          {
            candidate_id: String(candidate.application_id || ""),
            response_text_excerpt: truncateForLog(String((response && response.response_text) || ""), 1200),
            routed_categories: Array.isArray((response && response.routed_categories)) ? response.routed_categories : [],
            retrieved_files: Array.isArray((response && response.retrieved_files)) ? response.retrieved_files : [],
          },
        ),
      });
    };

    const buildFairnessConversationContext = (bucket, candidate) => {
      const fairnessState = (bucket && bucket.fairness) || {};
      const reviewHistory = Array.isArray(fairnessState.review_history) ? fairnessState.review_history : [];
      const auditHistory = Array.isArray(fairnessState.audit_history) ? fairnessState.audit_history : [];
      const qaTranscript = Array.isArray(fairnessState.qa_transcript) ? fairnessState.qa_transcript : [];
      const qaHistory = Array.isArray(fairnessState.qa_history) ? fairnessState.qa_history : [];

      const shortText = (value, maxLen = 1400) => truncateForLog(String(value || ""), maxLen);
      const recentQaHistory = qaHistory.slice(-12).map((entry) => ({
        role: String((entry && entry.role) || "assistant"),
        text: shortText((entry && (entry.text || entry.raw_response_text || "")) || "", 1400),
      }));
      const recentReviewSummaries = reviewHistory.slice(-2).map((entry) => ({
        type: "initial_review",
        response_text: shortText((entry && (entry.response_text || entry.raw_response_text || "")) || "", 1800),
        response_json: entry && entry.response_json ? entry.response_json : null,
      }));
      const recentAuditSummaries = auditHistory.slice(-1).map((entry) => ({
        type: "cross_candidate_audit",
        response_text: shortText((entry && (entry.response_text || entry.raw_response_text || "")) || "", 2000),
        response_json: entry && entry.response_json ? entry.response_json : null,
      }));
      const recentQaTurns = qaTranscript.slice(-6).map((entry) => ({
        type: "qa_turn",
        question: shortText(entry && entry.question, 800),
        response_text: shortText((entry && (entry.response_text || entry.raw_response_text || "")) || "", 1400),
        response_json: entry && entry.response_json ? entry.response_json : null,
      }));

      return {
        candidate_id: String((candidate && candidate.application_id) || ""),
        candidate_display_name: String((candidate && (candidate.display_name || candidate.name || candidate.application_id)) || ""),
        current_justification: shortText(bucket && bucket.justification, 1200),
        current_ratings: {
          overall_stars: clampStars(bucket && bucket.overall_stars),
          weighted_avg: Number(bucket && bucket.weighted_avg || 0),
          final_stars: clampStars(bucket && bucket.final_stars),
          summary_ratings: bucket && bucket.summary_ratings ? bucket.summary_ratings : {},
          document_ratings: bucket && bucket.document_ratings ? bucket.document_ratings : {},
        },
        candidate_materials: {
          summary_text: shortText((candidate && candidate.summary_text) || "", 4000),
          profile_material_keys: Object.keys(activeMaterials || {}),
          sensitive_attributes: getSensitiveAttributes(activeProfilePayload, candidate),
        },
        conversation_history: [
          ...recentQaHistory.map((entry) => ({
            type: entry.role === "user" ? "qa_question" : "qa_answer_preview",
            candidate_id: String((candidate && candidate.application_id) || ""),
            text: entry.text,
          })),
          ...recentReviewSummaries,
          ...recentAuditSummaries,
          ...recentQaTurns,
        ],
        qa_history: recentQaHistory,
      };
    };

    const buildNTNUConversationContext = (bucket, candidate) => {
      const ntnuState = (bucket && bucket.ntnu) || {};
      const qaHistory = Array.isArray(ntnuState.qa_history) ? ntnuState.qa_history : [];
      return {
        candidate_id: String((candidate && candidate.application_id) || ""),
        candidate_display_name: String((candidate && (candidate.display_name || candidate.name || candidate.application_id)) || ""),
        current_justification: truncateForLog(bucket && bucket.justification, 1200),
        current_ratings: {
          overall_stars: clampStars(bucket && bucket.overall_stars),
          weighted_avg: Number(bucket && bucket.weighted_avg || 0),
          final_stars: clampStars(bucket && bucket.final_stars),
          summary_ratings: bucket && bucket.summary_ratings ? bucket.summary_ratings : {},
          document_ratings: bucket && bucket.document_ratings ? bucket.document_ratings : {},
        },
        recent_ntnu_chat: qaHistory.slice(-12).map((entry) => ({
          role: String((entry && entry.role) || "assistant"),
          text: truncateForLog((entry && (entry.text || entry.raw_response_text || "")) || "", 1200),
        })),
      };
    };

    const getFinalStars = (candidateId) => {
      const bucket = getCandidateRatingBucket(ratingsState, candidateId);
      const overall = clampStars(bucket.overall_stars);
      if (overall > 0) return overall;
      return clampStars(Math.round(Number(bucket.weighted_avg || 0)));
    };

    const renderGroups = () => {
      if (!groupsWrap) return;
      const grouped = { 5: [], 4: [], 3: [], 2: [], 1: [], 0: [] };
      rankedProfiles.forEach((entry) => {
        const stars = getFinalStars(entry.candidate.application_id);
        grouped[stars].push(entry);
      });

      groupsWrap.innerHTML = [5, 4, 3, 2, 1, 0].map((stars) => {
        const members = grouped[stars] || [];
        const title = stars === 0 ? "Unrated" : `${stars} Star${stars > 1 ? "s" : ""}`;
        const chips = members.length
          ? members.map((entry) => {
            const name = entry.candidate.display_name || entry.candidate.name || entry.candidate.application_id;
            const starLabel = stars === 0 ? "" : ` <span class="muted">${starsLabel(stars)}</span>`;
            return `<button type="button" class="rating-group-chip" data-candidate-id="${escapeHtml(String(entry.candidate.application_id))}">${escapeHtml(String(name))}${starLabel}</button>`;
          }).join("")
          : '<p class="muted">No candidates in this group.</p>';

        return `
          <section class="rating-group-card">
            <h4>${title}</h4>
            <div class="rating-group-members">${chips}</div>
          </section>
        `;
      }).join("");

      groupsWrap.querySelectorAll(".rating-group-chip").forEach((el) => {
        el.addEventListener("click", () => {
          const id = String(el.getAttribute("data-candidate-id") || "").trim();
          if (!id) return;
          activeId = id;
          render();
        });
      });
    };

    const showTab = (nextTab) => {
      activeProfileTab = nextTab;
      tabStateByCandidate[activeId] = nextTab;
      renderRatingsProfileTopTabs(activeMaterials, nextTab, showTab);
      renderRatingsProfileView(activeMaterials, nextTab, activeProfilePayload);

      const sectionCards = Array.from(document.querySelectorAll("#profileSectionSummaries .profile-summary-section-card"));
      sectionCards.forEach((card) => {
        const heading = card.querySelector("h4");
        if (!heading) return;
        const headingKey = normalizeSectionKey(String(heading.textContent || ""));
        const item = activeSummaryItems.find((entry) => normalizeSectionKey(entry.key) === headingKey);

        const existing = card.querySelector(".rating-inline-control");
        if (!item) {
          if (existing) existing.remove();
          return;
        }

        const control = existing || document.createElement("div");
        control.className = "rating-inline-control";
        if (!existing) {
          const insertBefore = card.querySelector(".section-summary-body") || null;
          card.insertBefore(control, insertBefore);
        }

        renderStarSelector(control, (activeBucket && activeBucket.summary_ratings[item.key]) || 0, (stars) => {
          if (!activeBucket) return;
          activeBucket.summary_ratings[item.key] = clampStars(stars);
          activeRefreshScoring();
          activeLogRatingAction("summary_rating_updated_inline");
          render();
        });
      });

      const documentControl = document.getElementById("profileDocumentRatingControl");
      if (documentControl) {
        if (!activeBucket || !nextTab || nextTab === "__overview__" || nextTab === "__sensitive__") {
          documentControl.innerHTML = "";
          documentControl.hidden = true;
        } else {
          const item = activeDocumentItems.find((entry) => entry.key === nextTab);
          if (!item) {
            documentControl.innerHTML = "";
            documentControl.hidden = true;
          } else {
            documentControl.hidden = false;
            renderStarSelector(documentControl, activeBucket.document_ratings[item.key], (stars) => {
              if (!activeBucket) return;
              activeBucket.document_ratings[item.key] = clampStars(stars);
              activeRefreshScoring();
              activeLogRatingAction("document_rating_updated_inline");
              render();
            });
          }
        }
      }
    };

    const render = async () => {
      const generation = ++renderGeneration;
      if (listWrap) {
        listWrap.innerHTML = "";
        rankedProfiles.forEach((entry) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = `profile-top-tab rating-candidate-tab${entry.candidate.application_id === activeId ? " active" : ""}`;
          button.textContent = entry.candidate.display_name || entry.candidate.name || entry.candidate.application_id;
          button.onclick = () => {
            activeId = entry.candidate.application_id;
            render();
          };
          listWrap.appendChild(button);
        });
      }

      const active = rankedProfiles.find((entry) => entry.candidate.application_id === activeId) || rankedProfiles[0];
      if (generation !== renderGeneration) return;
      await renderCandidateRatingOverview(active.candidate, active.row, totalComparisons);
      if (generation !== renderGeneration) return;

      const profilePayload = await fetchCandidateProfilePayload(active.candidate.application_id);
      if (generation !== renderGeneration) return;
      activeMaterials = (profilePayload && profilePayload.materials) || {};
      activeProfilePayload = profilePayload || {};

      const materialKeys = Object.keys(activeMaterials).filter((key) => String(key || "").trim());

      const currentTab = String(tabStateByCandidate[active.candidate.application_id] || "__overview__");
      const tabExists = currentTab === "__overview__" || currentTab === "__sensitive__" || materialKeys.includes(currentTab);
      const activeTab = tabExists ? currentTab : "__overview__";
      tabStateByCandidate[active.candidate.application_id] = activeTab;

      const summaryItems = buildRatingsSummaryItems(active.candidate, cbrWeights);
      const documentItems = buildRatingsDocumentItems(activeMaterials, ratingsState.document_weights);
      const bucket = getCandidateRatingBucket(ratingsState, active.candidate.application_id);
      const fairnessState = bucket.fairness;
      const ntnuState = bucket.ntnu;
      const persistFairnessPanel = () => {
        saveCandidateRatingsState(ratingsState);
        renderFairnessPanel(bucket);
      };
      const persistNTNUPanel = () => {
        saveCandidateRatingsState(ratingsState);
        renderNTNUPanel(bucket);
      };

      void startInitialFairnessReview(bucket, active.candidate, activeMaterials, activeProfilePayload);
      void startInitialNTNUReview(bucket, active.candidate, activeMaterials, activeProfilePayload);

      const refreshScoring = () => {
        const stats = computeWeightedRatingStats(summaryItems, documentItems, bucket);
        bucket.weighted_avg = stats.average;
        const overall = clampStars(bucket.overall_stars);
        bucket.final_stars = overall > 0 ? overall : clampStars(Math.round(stats.average));
        saveCandidateRatingsState(ratingsState);

        if (weightedAvgValue) weightedAvgValue.textContent = stats.average > 0 ? `${stats.average.toFixed(2)} / 5` : "-";
        if (weightedAvgMeta) weightedAvgMeta.textContent = `${stats.ratedCount}/${stats.totalCount} fields rated`;
        if (finalBadge) finalBadge.textContent = starsLabel(bucket.final_stars);
        renderGroups();
      };

      const logRatingAction = (action) => {
        logStageEvent(
          "candidate_ratings",
          action,
          {
            candidate_id: String(active.candidate.application_id || ""),
          },
          {
            weighted_avg: Number(bucket.weighted_avg || 0),
            overall_stars: clampStars(bucket.overall_stars),
            final_stars: clampStars(bucket.final_stars),
            rated_summary_fields: Object.values(bucket.summary_ratings || {}).filter((value) => clampStars(value) > 0).length,
            rated_documents: Object.values(bucket.document_ratings || {}).filter((value) => clampStars(value) > 0).length,
            document_count: documentItems.length,
          },
        );
      };

      activeSummaryItems = summaryItems;
      activeDocumentItems = documentItems;
      activeBucket = bucket;
      activeRefreshScoring = refreshScoring;
      activeLogRatingAction = logRatingAction;
      showTab(activeTab);

      renderRatingRows(
        summaryRatingsWrap,
        summaryItems,
        (key) => bucket.summary_ratings[key],
        (key, stars) => {
          bucket.summary_ratings[key] = clampStars(stars);
          refreshScoring();
          logRatingAction("summary_rating_updated");
          render();
        },
      );

      renderRatingRows(
        documentRatingsWrap,
        documentItems,
        (key) => bucket.document_ratings[key],
        (key, stars) => {
          bucket.document_ratings[key] = clampStars(stars);
          refreshScoring();
          logRatingAction("document_rating_updated");
          render();
        },
      );

      renderStarSelector(overallStarsWrap, bucket.overall_stars, (next) => {
        bucket.overall_stars = clampStars(next);
        refreshScoring();
        logRatingAction("overall_stars_updated");
        render();
      });

      if (overallJustification) {
        overallJustification.value = bucket.justification || "";
        const logJustificationIfChanged = () => {
          const latest = String(bucket.justification || "");
          const lastLogged = String(bucket.last_logged_justification || "");
          if (latest === lastLogged) return;
          bucket.last_logged_justification = latest;
          saveCandidateRatingsState(ratingsState);
          logRatingAction("overall_justification_updated");
        };
        overallJustification.oninput = () => {
          bucket.justification = String(overallJustification.value || "");
          saveCandidateRatingsState(ratingsState);
        };
        overallJustification.onblur = logJustificationIfChanged;
        overallJustification.onchange = logJustificationIfChanged;
      }

      if (submitEvaluationBtn) {
        submitEvaluationBtn.onclick = () => {
          bucket.justification = String((overallJustification && overallJustification.value) || bucket.justification || "");
          saveCandidateRatingsState(ratingsState);
          logRatingAction("evaluation_submitted");

          if (submitEvaluationStatus) {
            submitEvaluationStatus.textContent = "Evaluation saved.";
          }
        };
      }

      if (submitAllRatingsRunAuditsBtn) {
        submitAllRatingsRunAuditsBtn.onclick = () => {
          window.location.href = "/ratings-audits";
        };
      }

      if (fairnessAskBtn && fairnessQuestionInput) {
        fairnessAskBtn.onclick = async () => {
          const question = String(fairnessQuestionInput.value || "").trim();
          if (!question) return;

          setFairnessChatFollowLatest(bucket, true);
          fairnessState.qa_history.push({ role: "user", text: question });
          const assistantEntry = {
            role: "assistant",
            html: "<div class=\"muted\">Fairness assistant is drafting a response...</div>",
            raw_response_text: "",
          };
          fairnessState.qa_history.push(assistantEntry);
          fairnessQuestionInput.value = "";
          persistFairnessPanel();

          fairnessState.qa_loading = true;
          saveCandidateRatingsState(ratingsState);

          let latestStreamText = "";
          let latestStreamError = "";

          try {
            const candidateContext = buildFairnessConversationContext(bucket, active.candidate);
            const response = await requestFairnessQAStream({
              question,
              optional_context: candidateContext,
              fairness_config: fairnessAssistantConfig,
            }, {
              onDelta: (eventPayload) => {
                const liveText = String((eventPayload && eventPayload.response_text) || "");
                latestStreamText = liveText;
                assistantEntry.html = formatStructuredFairnessStreamHtml(
                  liveText,
                  "Live fairness response stream",
                );
                renderFairnessPanel(bucket);
                scrollFairnessChatToBottom();
              },
              onError: (eventPayload) => {
                latestStreamError = String((eventPayload && eventPayload.error_message) || "Unknown stream error");
                assistantEntry.html = `<div>Could not get fairness answer: ${escapeHtml(latestStreamError)}</div>`;
              },
            });

            const answerPayload = (response && response.response) || {};
            const rawResponseText = String((response && response.response_text) || latestStreamText || "");
            assistantEntry.html = formatFairnessQaAnswerHtml({
              ...answerPayload,
              response_text: rawResponseText,
              raw_response_text: rawResponseText,
              stream_error_message: latestStreamError,
            });
            assistantEntry.raw_response_text = rawResponseText;

            fairnessState.qa_transcript = Array.isArray(fairnessState.qa_transcript) ? fairnessState.qa_transcript : [];
            fairnessState.qa_transcript.push({
              type: "qa_turn",
              candidate_id: String(active.candidate.application_id || ""),
              question,
              prompt_system: String((response && response.prompt_system) || ""),
              prompt_user: String((response && response.prompt_user) || ""),
              response_text: rawResponseText,
              raw_response_text: rawResponseText,
              response_json: answerPayload,
            });

            logStageEvent(
              "candidate_ratings",
              "fairness_question_answered",
              {
                candidate_id: String(active.candidate.application_id || ""),
                question,
              },
              {
                candidate_id: String(active.candidate.application_id || ""),
                prompt_system_excerpt: truncateForLog(String((response && response.prompt_system) || ""), 400),
                prompt_user_excerpt: truncateForLog(String((response && response.prompt_user) || ""), 600),
                response_text_excerpt: truncateForLog(rawResponseText, 1200),
                key_considerations_count: Array.isArray(answerPayload.key_considerations) ? answerPayload.key_considerations.length : 0,
                potential_risks_count: Array.isArray(answerPayload.potential_risks) ? answerPayload.potential_risks.length : 0,
              },
            );
          } catch (error) {
            assistantEntry.html = `<div>Could not get fairness answer: ${escapeHtml(String((error && error.message) || error || "Unknown error"))}</div>`;
          } finally {
            fairnessState.qa_loading = false;
            persistFairnessPanel();
            scrollFairnessChatToBottom();
          }
        };
      }

      if (ntnuAskBtn && ntnuQuestionInput) {
        ntnuAskBtn.onclick = async () => {
          const question = String(ntnuQuestionInput.value || "").trim();
          if (!question) return;

          ntnuState.qa_history.push({ role: "user", text: question });
          const assistantEntry = {
            role: "assistant",
            html: '<div class="muted">NTNU assistant is drafting a response...</div>',
            raw_response_text: "",
          };
          ntnuState.qa_history.push(assistantEntry);
          ntnuQuestionInput.value = "";
          ntnuState.qa_loading = true;
          persistNTNUPanel();

          let latestStreamText = "";
          let latestStreamError = "";

          try {
            const ntnuContext = buildNTNUConversationContext(bucket, active.candidate);
            const response = await requestNTNUQAStream({
              question,
              chat_history: ntnuContext.recent_ntnu_chat,
              candidate_context: {
                application_id: String(active.candidate.application_id || ""),
                display_name: String(active.candidate.display_name || active.candidate.name || ""),
                summary_text: String(active.candidate.summary_text || ""),
                profile_materials: activeMaterials || {},
                sensitive_attributes: getSensitiveAttributes(activeProfilePayload, active.candidate),
              },
              ntnu_config: ntnuAssistantConfig,
            }, {
              onDelta: (eventPayload) => {
                const liveText = String((eventPayload && eventPayload.response_text) || "");
                latestStreamText = liveText;
                assistantEntry.html = formatStructuredFairnessStreamHtml(
                  liveText,
                  "Live NTNU response stream",
                );
                renderNTNUPanel(bucket);
                scrollNTNUChatToBottom();
              },
              onError: (eventPayload) => {
                latestStreamError = String((eventPayload && eventPayload.error_message) || "Unknown stream error");
                assistantEntry.html = `<div>Could not get NTNU answer: ${escapeHtml(latestStreamError)}</div>`;
              },
            });

            const answerPayload = (response && response.response) || {};
            const rawResponseText = String((response && response.response_text) || latestStreamText || "");
            assistantEntry.html = formatNTNUQaAnswerHtml({
              ...answerPayload,
              response_text: rawResponseText,
              error_message: latestStreamError,
            });
            assistantEntry.raw_response_text = rawResponseText;

            ntnuState.review_history = Array.isArray(ntnuState.review_history) ? ntnuState.review_history : [];
            ntnuState.review_history.push({
              type: "qa_turn",
              question,
              response_text: rawResponseText,
              response_json: answerPayload,
              routed_categories: (response && response.routed_categories) || [],
              retrieved_files: (response && response.retrieved_files) || [],
            });

            logStageEvent(
              "candidate_ratings",
              "ntnu_question_answered",
              {
                candidate_id: String(active.candidate.application_id || ""),
                question,
              },
              {
                candidate_id: String(active.candidate.application_id || ""),
                response_text_excerpt: truncateForLog(rawResponseText, 1200),
                routed_categories: Array.isArray((response && response.routed_categories)) ? response.routed_categories : [],
                retrieved_files: Array.isArray((response && response.retrieved_files)) ? response.retrieved_files : [],
              },
            );
          } catch (error) {
            assistantEntry.html = `<div>Could not get NTNU answer: ${escapeHtml(String((error && error.message) || error || "Unknown error"))}</div>`;
          } finally {
            ntnuState.qa_loading = false;
            persistNTNUPanel();
            scrollNTNUChatToBottom();
          }
        };
      }

      refreshScoring();
      renderFairnessPanel(bucket);
      renderNTNUPanel(bucket);
      logRatingAction("candidate_scoring_viewed");
    };

    await render();
  }

  async function loadRatingsAuditsPage() {
    await ensureWorkflowSessionReady();
    const meta = document.getElementById("ratingsAuditMeta");
    const columnsWrap = document.getElementById("ratingsAuditColumns");
    const fairnessStatus = document.getElementById("ratingsAuditFairnessStatus");
    const fairnessOutput = document.getElementById("ratingsAuditFairnessOutput");
    const ntnuStatus = document.getElementById("ratingsAuditNTNUStatus");
    const ntnuOutput = document.getElementById("ratingsAuditNTNUOutput");
    if (!meta || !columnsWrap || !fairnessStatus || !fairnessOutput || !ntnuStatus || !ntnuOutput) return;

    const candidates = getH2HCandidates();
    const state = getH2HState();
    if (!candidates.length || !state) {
      meta.textContent = "Missing head-to-head state. Return to Candidate Ratings and submit ratings first.";
      return;
    }

    ensureCandidateAliases(candidates, state);
    const h2hState = await computeH2HState(candidates, state.comparisons || []);
    const rows = Array.isArray(h2hState.rows) ? h2hState.rows : [];
    const rowById = new Map(rows.map((row) => [String((row && row.application_id) || ""), row]));
    const candidateById = candidateMap(candidates);
    const ratingsState = loadCandidateRatingsState();

    const baselineTop6 = candidates
      .map((candidate) => {
        const id = String((candidate && candidate.application_id) || "");
        const row = rowById.get(id) || {};
        return {
          application_id: id,
          display_name: String((candidate && (candidate.display_name || candidate.name || id)) || id),
          baseline_score: Number((row && row.baseline_score) || 0),
          post_h2h_score: Number((row && row.score) || 0),
        };
      })
      .sort((a, b) => b.baseline_score - a.baseline_score)
      .slice(0, 6)
      .map((row, index) => ({ ...row, rank: index + 1 }));

    const postH2HTop6 = rows
      .slice()
      .sort((a, b) => Number((b && b.score) || 0) - Number((a && a.score) || 0))
      .slice(0, 6)
      .map((row, index) => {
        const id = String((row && row.application_id) || "");
        const candidate = candidateById[id] || {};
        return {
          application_id: id,
          display_name: String((candidate && (candidate.display_name || candidate.name || id)) || id),
          post_h2h_score: Number((row && row.score) || 0),
          baseline_score: Number((row && row.baseline_score) || 0),
          rank: index + 1,
        };
      });

    const getFinalRankScore = (applicationId) => {
      const bucket = getCandidateRatingBucket(ratingsState, applicationId);
      const overall = clampStars(bucket.overall_stars);
      return overall > 0 ? overall : clampStars(Math.round(Number(bucket.weighted_avg || 0)));
    };

    const finalTop6 = postH2HTop6
      .map((row) => ({
        ...row,
        final_rank_score: getFinalRankScore(row.application_id),
      }))
      .sort((a, b) => {
        if (b.final_rank_score !== a.final_rank_score) return b.final_rank_score - a.final_rank_score;
        return b.post_h2h_score - a.post_h2h_score;
      })
      .slice(0, 6)
      .map((row, index) => ({ ...row, final_order: index + 1 }));

    const renderColumn = (title, rowsToRender, valueRenderer) => {
      const body = rowsToRender.length
        ? `<ol class="candidate-rank-list">${rowsToRender.map((row) => `<li><strong>${escapeHtml(row.display_name)}</strong> <span class="muted">${valueRenderer(row)}</span></li>`).join("")}</ol>`
        : '<p class="muted">No candidates available.</p>';
      return `<section class="rating-panel"><h4 style="margin-top:0">${escapeHtml(title)}</h4>${body}</section>`;
    };

    columnsWrap.innerHTML = [
      renderColumn("A) Top 6 Baseline (Pre H2H)", baselineTop6, (row) => `Score ${Number(row.baseline_score || 0).toFixed(3)}`),
      renderColumn("B) Top 6 Post Head-to-Head", postH2HTop6, (row) => `Score ${Number(row.post_h2h_score || 0).toFixed(3)}`),
      renderColumn("C) Final Top 6", finalTop6, (row) => `Rank ${Number(row.final_rank_score || 0)}/5`),
    ].join("");

    meta.textContent = `Loaded ${finalTop6.length} final candidates and running cross-candidate audits.`;

    await logStageEvent(
      "ratings_audits",
      "page_loaded",
      {},
      {
        final_candidate_count: finalTop6.length,
        comparison_count: Number((state.comparisons || []).length || 0),
      },
    );

    const selectedCandidates = finalTop6.map((row) => {
      const candidate = candidateById[row.application_id] || {};
      return {
        application_id: String(row.application_id || ""),
        display_name: String(row.display_name || row.application_id || ""),
        rank: Number(row.final_order || 0),
        score: Number(row.post_h2h_score || 0),
        baseline_score: Number(row.baseline_score || 0),
        summary_text: String((candidate && candidate.summary_text) || ""),
      };
    });
    const aliasById = new Map(selectedCandidates.map((candidate) => [
      String((candidate && candidate.application_id) || "").trim(),
      String((candidate && candidate.display_name) || "").trim(),
    ]));

    const auditData = buildCrossCandidateRatingsPayload(ratingsState);
    const storedConfig = getStoredConfig() || defaultConfig();
    const fairnessAssistantConfig = {
      model: String((((storedConfig || {}).fairness_assistant || {}).model) || "gpt-5.4-mini"),
      prompt_dir: "prompts/eval_assistants",
      additional_instructions: String((((storedConfig || {}).fairness_assistant || {}).additional_instructions) || ""),
    };
    const ntnuAssistantConfig = {
      model: String((((storedConfig || {}).ntnu_assistant || {}).model) || "gpt-5.4-mini"),
      prompt_dir: "prompts/eval_assistants",
      additional_instructions: String((((storedConfig || {}).ntnu_assistant || {}).additional_instructions) || ""),
    };

    const sensitiveAttributesByCandidate = Object.fromEntries(await Promise.all(selectedCandidates.map(async (candidate) => {
      const id = String((candidate && candidate.application_id) || "").trim();
      if (!id) return ["", {}];
      const profile = await fetchCandidateProfilePayload(id);
      return [id, (profile && profile.sensitive_attributes) || {}];
    })).then((rowsList) => rowsList.filter(([id]) => id)));

    fairnessStatus.textContent = "Loading Fairness audit...";
    ntnuStatus.textContent = "Loading NTNU audit...";
    fairnessOutput.innerHTML = "";
    ntnuOutput.innerHTML = "";

    await Promise.all([
      (async () => {
        try {
          const response = await requestFairnessCrossCandidateAuditStream({
            candidate_metadata: selectedCandidates,
            ratings: auditData.ratings,
            rationales: auditData.rationales,
            sensitive_attributes: sensitiveAttributesByCandidate,
            fairness_config: fairnessAssistantConfig,
          }, {
            onDelta: () => {},
          });

          const rawAudit = (response && response.audit) || {};
          const audit = replaceCandidateIdsWithAliases(rawAudit, aliasById);
          const issues = Array.isArray(audit.issues) ? audit.issues
            : Array.isArray(audit.issues_found) ? audit.issues_found : [];
          const summary = String(audit.summary || "").trim();
          const detailsHtml = formatFairnessIssuesHtml(issues);
          fairnessOutput.innerHTML = renderInitialReportDetails("Fairness Audit", issues.length, detailsHtml, summary);
          fairnessStatus.textContent = `Fairness audit complete (${issues.length} issues).`;
        } catch (error) {
          fairnessStatus.textContent = `Fairness audit failed: ${String((error && error.message) || error || "Unknown error")}`;
        }
      })(),
      (async () => {
        try {
          const response = await requestNTNUFinalAuditStream({
            selected_candidates: selectedCandidates,
            ratings: auditData.ratings,
            rationales: auditData.rationales,
            sensitive_attributes: sensitiveAttributesByCandidate,
            ntnu_config: ntnuAssistantConfig,
          }, {
            onDelta: () => {},
          });

          const rawAudit = (response && response.audit) || {};
          const audit = replaceCandidateIdsWithAliases(rawAudit, aliasById);
          const detailsHtml = formatNTNUFinalAuditHtml(audit);
          const flagCount = (Array.isArray(audit.candidate_flags) ? audit.candidate_flags.length : 0)
            + (Array.isArray(audit.rationale_flags) ? audit.rationale_flags.length : 0);
          ntnuOutput.innerHTML = renderInitialReportDetails("NTNU Audit", flagCount, detailsHtml, String(audit.summary || ""));
          ntnuStatus.textContent = `NTNU audit complete (${flagCount} flags).`;
        } catch (error) {
          ntnuStatus.textContent = `NTNU audit failed: ${String((error && error.message) || error || "Unknown error")}`;
        }
      })(),
    ]);
  }

  function defaultUserFeedbackState() {
    return {
      role: "",
      experience_level: "",
      workflow_stage: "",
      useful_features: "",
      design_comments: "",
      missing_functions: "",
      decision_impact: "",
      fairness_impact: "",
      trust_comments: "",
      improvement_suggestions: "",
      general_comments: "",
      recommendation: "",
      quantitative: Object.fromEntries(USER_FEEDBACK_LIKERT_ITEMS.map((item) => [item.key, ""])),
      updated_at: "",
    };
  }

  function loadUserFeedbackState() {
    try {
      const raw = getSessionStorageItem(USER_FEEDBACK_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      const defaults = defaultUserFeedbackState();
      const quantitative = parsed && parsed.quantitative && typeof parsed.quantitative === "object"
        ? parsed.quantitative
        : {};
      return {
        ...defaults,
        ...(parsed && typeof parsed === "object" ? parsed : {}),
        quantitative: {
          ...defaults.quantitative,
          ...quantitative,
        },
      };
    } catch {
      return defaultUserFeedbackState();
    }
  }

  function saveUserFeedbackState(state) {
    const next = {
      ...defaultUserFeedbackState(),
      ...(state && typeof state === "object" ? state : {}),
      quantitative: {
        ...defaultUserFeedbackState().quantitative,
        ...((state && state.quantitative && typeof state.quantitative === "object") ? state.quantitative : {}),
      },
      updated_at: new Date().toISOString(),
    };
    setSessionStorageItem(USER_FEEDBACK_STORAGE_KEY, JSON.stringify(next));
    return next;
  }

  function collectUserFeedbackFormState(formEl) {
    const defaults = defaultUserFeedbackState();
    if (!formEl) return defaults;
    const getFieldValue = (name) => {
      const field = formEl.elements.namedItem(name);
      if (!field) return "";
      if (field instanceof RadioNodeList) {
        return String(field.value || "").trim();
      }
      return String(field.value || "").trim();
    };

    return {
      role: getFieldValue("role"),
      experience_level: getFieldValue("experience_level"),
      workflow_stage: getFieldValue("workflow_stage"),
      useful_features: getFieldValue("useful_features"),
      design_comments: getFieldValue("design_comments"),
      missing_functions: getFieldValue("missing_functions"),
      decision_impact: getFieldValue("decision_impact"),
      fairness_impact: getFieldValue("fairness_impact"),
      trust_comments: getFieldValue("trust_comments"),
      improvement_suggestions: getFieldValue("improvement_suggestions"),
      general_comments: getFieldValue("general_comments"),
      recommendation: getFieldValue("recommendation"),
      quantitative: Object.fromEntries(USER_FEEDBACK_LIKERT_ITEMS.map((item) => [item.key, getFieldValue(`quant_${item.key}`)])),
      updated_at: "",
    };
  }

  function populateUserFeedbackForm(formEl, state) {
    if (!formEl) return;
    const source = state && typeof state === "object" ? state : defaultUserFeedbackState();
    [
      "role",
      "experience_level",
      "workflow_stage",
      "useful_features",
      "design_comments",
      "missing_functions",
      "decision_impact",
      "fairness_impact",
      "trust_comments",
      "improvement_suggestions",
      "general_comments",
      "recommendation",
    ].forEach((key) => {
      const field = formEl.elements.namedItem(key);
      if (field && !(field instanceof RadioNodeList)) {
        field.value = String(source[key] || "");
      }
    });

    USER_FEEDBACK_LIKERT_ITEMS.forEach((item) => {
      const field = formEl.elements.namedItem(`quant_${item.key}`);
      if (!field) return;
      if (field instanceof RadioNodeList) {
        field.value = String((source.quantitative || {})[item.key] || "");
      }
    });
  }

  function renderUserFeedbackLikertGrid(container, state) {
    if (!container) return;
    const source = state && typeof state === "object" ? state : defaultUserFeedbackState();
    container.innerHTML = USER_FEEDBACK_LIKERT_ITEMS.map((item) => {
      const current = String(((source.quantitative || {})[item.key]) || "");
      const radios = [1, 2, 3, 4, 5].map((value) => `
        <label class="feedback-likert-option">
          <input type="radio" name="quant_${item.key}" value="${value}" ${current === String(value) ? "checked" : ""} />
          <span>${value}</span>
        </label>
      `).join("");
      return `
        <div class="feedback-likert-row">
          <div class="feedback-likert-prompt">${escapeHtml(item.prompt)}</div>
          <div class="feedback-likert-options">${radios}</div>
        </div>
      `;
    }).join("");
  }

  function buildUserFeedbackSessionSummary() {
    const h2hCandidates = getH2HCandidates();
    const h2hState = getH2HState();
    const ratingsState = loadCandidateRatingsState();
    const ratedCandidates = Object.values((ratingsState && ratingsState.by_candidate) || {}).filter((bucket) => {
      if (!bucket || typeof bucket !== "object") return false;
      return clampStars(bucket.overall_stars) > 0 || String(bucket.justification || "").trim().length > 0;
    }).length;
    return {
      workflow_session_id: getWorkflowSessionId(),
      candidate_count: Array.isArray(h2hCandidates) ? h2hCandidates.length : 0,
      comparison_count: Array.isArray((h2hState && h2hState.comparisons)) ? h2hState.comparisons.length : 0,
      rated_candidates: ratedCandidates,
      workflow_signature: String((h2hState && h2hState.signature) || ""),
    };
  }

  function saveUserFeedbackConfirmationState(state) {
    sessionStorage.setItem(USER_FEEDBACK_CONFIRMATION_KEY, JSON.stringify(state || {}));
  }

  function loadUserFeedbackConfirmationState() {
    try {
      const raw = sessionStorage.getItem(USER_FEEDBACK_CONFIRMATION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function goToUserFeedbackConfirmation(mode, detail) {
    saveUserFeedbackConfirmationState({
      mode: String(mode || "save"),
      ...(detail && typeof detail === "object" ? detail : {}),
      timestamp: new Date().toISOString(),
    });
    window.location.href = `/feedback-confirmation?mode=${encodeURIComponent(String(mode || "save"))}`;
  }

  async function loadFeedbackQuestionnairePage() {
    await ensureWorkflowSessionReady();
    const formEl = document.getElementById("feedbackForm");
    const meta = document.getElementById("feedbackMeta");
    const status = document.getElementById("feedbackStatus");
    const submitBtn = document.getElementById("feedbackSubmitBtn");
    const saveBtn = document.getElementById("feedbackSaveBtn");
    const clearBtn = document.getElementById("feedbackClearBtn");
    const downloadBtn = document.getElementById("feedbackDownloadBtn");
    const summaryEl = document.getElementById("feedbackSessionSummary");
    const likertGrid = document.getElementById("feedbackLikertGrid");
    if (!formEl || !meta || !status || !submitBtn || !saveBtn || !clearBtn || !downloadBtn || !summaryEl || !likertGrid) return;

    let saveTimer = null;
    const sessionSummary = buildUserFeedbackSessionSummary();
    const storedState = loadUserFeedbackState();

    meta.textContent = `Capture user feedback after reviewing ${sessionSummary.candidate_count} candidates, ${sessionSummary.comparison_count} comparisons, and ${sessionSummary.rated_candidates} saved rating notes.`;
    summaryEl.innerHTML = `
      <div class="feedback-summary-item"><span class="muted">Workflow session ID</span><strong>${escapeHtml(String(sessionSummary.workflow_session_id || ""))}</strong></div>
      <div class="feedback-summary-item"><span class="muted">Candidates in active pool</span><strong>${sessionSummary.candidate_count}</strong></div>
      <div class="feedback-summary-item"><span class="muted">Recorded comparisons</span><strong>${sessionSummary.comparison_count}</strong></div>
      <div class="feedback-summary-item"><span class="muted">Candidates with saved ratings</span><strong>${sessionSummary.rated_candidates}</strong></div>
    `;

    renderUserFeedbackLikertGrid(likertGrid, storedState);
    populateUserFeedbackForm(formEl, storedState);

    const persist = (message) => {
      const nextState = saveUserFeedbackState({
        ...collectUserFeedbackFormState(formEl),
        session_context: sessionSummary,
      });
      status.textContent = message || `Draft saved ${new Date(nextState.updated_at).toLocaleString()}.`;
      return nextState;
    };

    const scheduleAutosave = () => {
      status.textContent = "Saving draft...";
      if (saveTimer) window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        persist();
      }, 250);
    };

    formEl.addEventListener("input", scheduleAutosave);
    formEl.addEventListener("change", scheduleAutosave);

    saveBtn.addEventListener("click", () => {
      const nextState = persist("Draft saved.");
      goToUserFeedbackConfirmation("save", {
        session_context: sessionSummary,
        feedback: nextState,
      });
    });

    clearBtn.addEventListener("click", () => {
      if (!window.confirm("Clear all questionnaire responses?")) return;
      removeSessionStorageItem(USER_FEEDBACK_STORAGE_KEY);
      renderUserFeedbackLikertGrid(likertGrid, defaultUserFeedbackState());
      formEl.reset();
      populateUserFeedbackForm(formEl, defaultUserFeedbackState());
      status.textContent = "Feedback form cleared.";
    });

    downloadBtn.addEventListener("click", () => {
      const nextState = persist("Draft saved and prepared for download.");
      const payload = {
        exported_at: new Date().toISOString(),
        workflow_session_id: String(sessionSummary.workflow_session_id || ""),
        session_context: sessionSummary,
        feedback: nextState,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `user-feedback-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      goToUserFeedbackConfirmation("download", payload);
    });

    submitBtn.addEventListener("click", async () => {
      status.textContent = "Submitting feedback...";
      submitBtn.disabled = true;
      try {
        const nextState = persist();
        const payload = {
          exported_at: new Date().toISOString(),
          workflow_session_id: String(sessionSummary.workflow_session_id || ""),
          session_context: sessionSummary,
          feedback: nextState,
        };
        const response = await submitUserFeedback(payload);
        removeSessionStorageItem(USER_FEEDBACK_STORAGE_KEY);
        goToUserFeedbackConfirmation("submit", {
          ...payload,
          server_response: response,
        });
      } catch (error) {
        status.textContent = `Could not submit feedback: ${String((error && error.message) || error || "Unknown error")}`;
        submitBtn.disabled = false;
      }
    });

    await logStageEvent(
      "feedback_questionnaire",
      "page_loaded",
      {},
      {
        candidate_count: sessionSummary.candidate_count,
        comparison_count: sessionSummary.comparison_count,
        rated_candidates: sessionSummary.rated_candidates,
      },
    );
  }

  async function loadFeedbackConfirmationPage() {
    await ensureWorkflowSessionReady();
    const titleEl = document.getElementById("feedbackConfirmationTitle");
    const messageEl = document.getElementById("feedbackConfirmationMessage");
    const summaryEl = document.getElementById("feedbackConfirmationSummary");
    const primaryEl = document.getElementById("feedbackConfirmationPrimary");
    if (!titleEl || !messageEl || !summaryEl || !primaryEl) return;

    const url = new URL(window.location.href);
    const mode = String(url.searchParams.get("mode") || "save");
    const state = loadUserFeedbackConfirmationState() || {};
    const sessionContext = state.session_context && typeof state.session_context === "object"
      ? state.session_context
      : {};
    const feedback = state.feedback && typeof state.feedback === "object"
      ? state.feedback
      : {};
    const updatedAt = String((feedback && feedback.updated_at) || state.timestamp || "").trim();

    const modeCopy = {
      save: {
        title: "Draft saved successfully.",
        message: "Your user feedback draft has been saved, and you can return to continue editing whenever you want.",
        primary: "Continue Editing",
        href: "/feedback-questionnaire",
      },
      download: {
        title: "Feedback downloaded.",
        message: "Your user feedback export has been prepared and downloaded. You can return to the questionnaire or continue with the workflow.",
        primary: "Return To Questionnaire",
        href: "/feedback-questionnaire",
      },
      submit: {
        title: "Feedback submitted. Thank you.",
        message: "Your user feedback has been stored in the project logs for later review, and this workflow session is complete.",
        primary: "Start New Response",
        href: "/feedback-questionnaire",
      },
    };

    const copy = modeCopy[mode] || modeCopy.save;
    titleEl.textContent = copy.title;
    messageEl.textContent = copy.message;
    primaryEl.textContent = copy.primary;
    primaryEl.href = copy.href;
    summaryEl.innerHTML = `
      <div class="feedback-summary-item"><span class="muted">Action</span><strong>${escapeHtml(mode)}</strong></div>
      <div class="feedback-summary-item"><span class="muted">Candidates in active pool</span><strong>${escapeHtml(String(sessionContext.candidate_count || 0))}</strong></div>
      <div class="feedback-summary-item"><span class="muted">Recorded comparisons</span><strong>${escapeHtml(String(sessionContext.comparison_count || 0))}</strong></div>
      <div class="feedback-summary-item"><span class="muted">Saved at</span><strong>${escapeHtml(updatedAt || "Not available")}</strong></div>
    `;

    await logStageEvent(
      "feedback_confirmation",
      "page_loaded",
      { mode },
      {
        candidate_count: Number(sessionContext.candidate_count || 0),
        comparison_count: Number(sessionContext.comparison_count || 0),
      },
    );
  }

  window.Webtool = {
    loadOverviewPage,
    loadNTNUKnowledgeBasePage,
    loadConfigPage,
    loadPreselectionPage,
    loadModelSnapshotPage,
    loadHeadToHeadPage,
    loadTopCandidatesPage,
    loadCandidateProfilesPage,
    loadCandidateRatingsPage,
    loadRatingsAuditsPage,
    loadFeedbackQuestionnairePage,
    loadFeedbackConfirmationPage,
    renderTopList,
  };
})();
