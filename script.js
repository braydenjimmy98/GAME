/* DataVault: local-first entry management, with safe text rendering throughout. */
(() => {
  "use strict";

  const STORAGE_KEY = "datavault.entries.v1";
  const CATEGORIES = ["Notes", "Links", "Ideas", "Tasks"];
  const form = document.querySelector("#entry-form");
  const titleInput = document.querySelector("#entry-title");
  const categoryInput = document.querySelector("#entry-category");
  const detailsInput = document.querySelector("#entry-details");
  const titleError = document.querySelector("#title-error");
  const submitLabel = document.querySelector("#submit-label");
  const cancelEditButton = document.querySelector("#cancel-edit");
  const entryList = document.querySelector("#entry-list");
  const emptyState = document.querySelector("#empty-state");
  const emptyTitle = document.querySelector("#empty-title");
  const emptyCopy = document.querySelector("#empty-copy");
  const entryCount = document.querySelector("#entry-count");
  const searchInput = document.querySelector("#search-input");
  const importFile = document.querySelector("#import-file");
  const toast = document.querySelector("#toast");

  let entries = loadEntries();
  let editingId = null;
  let activeCategory = "All";
  let toastTimer;

  // Read entries defensively so malformed or unavailable storage never breaks the UI.
  function loadEntries() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (!Array.isArray(stored)) return [];
      return stored.filter(isValidEntry).map(normalizeEntry);
    } catch (error) {
      console.warn("DataVault could not read saved entries.", error);
      return [];
    }
  }

  // Persist the complete collection, reporting storage failures in a friendly way.
  function saveEntries() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
      return true;
    } catch (error) {
      console.error("DataVault could not save entries.", error);
      showToast("Could not save your entries. Check available browser storage.");
      return false;
    }
  }

  // Only render entries matching both the live search and selected category.
  function renderEntries({ animateId = null, deletingId = null } = {}) {
    const query = searchInput.value.trim().toLocaleLowerCase();
    const visibleEntries = [...entries]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .filter((entry) => activeCategory === "All" || entry.category === activeCategory)
      .filter((entry) => !query || `${entry.title} ${entry.category} ${entry.details}`.toLocaleLowerCase().includes(query));

    entryList.replaceChildren();
    entryCount.textContent = String(entries.length);
    entryList.setAttribute("aria-busy", "false");

    for (const entry of visibleEntries) {
      const card = createEntryCard(entry, entry.id === animateId);
      if (entry.id === deletingId) card.classList.add("is-deleting");
      entryList.append(card);
    }

    const hasEntries = visibleEntries.length > 0;
    emptyState.hidden = hasEntries;
    if (!entries.length) {
      emptyTitle.textContent = "Your vault is a blank canvas.";
      emptyCopy.textContent = "Add your first note, link, idea, or task to get started.";
    } else if (!hasEntries) {
      emptyTitle.textContent = "Nothing here just yet.";
      emptyCopy.textContent = "Try another search or category to find what you’re looking for.";
    }
  }

  // Build cards with DOM APIs and textContent so user-provided text is never interpreted as HTML.
  function createEntryCard(entry, animate) {
    const card = document.createElement("article");
    card.className = "entry-card";
    if (!animate) card.style.animation = "none";

    const top = document.createElement("div");
    top.className = "card-top";
    const title = document.createElement("h3");
    title.className = "card-title";
    title.textContent = entry.title;
    const badge = document.createElement("span");
    badge.className = "category-badge";
    badge.dataset.category = entry.category;
    badge.textContent = entry.category;
    top.append(title, badge);

    const details = document.createElement("p");
    details.className = "card-details";
    details.textContent = entry.details || "No details added.";
    if (!entry.details) details.classList.add("is-empty");

    const bottom = document.createElement("div");
    bottom.className = "card-bottom";
    const date = document.createElement("time");
    date.className = "card-date";
    date.dateTime = entry.createdAt;
    date.textContent = formatDate(entry.createdAt);

    const actions = document.createElement("div");
    actions.className = "card-actions";
    const editButton = makeCardButton("Edit", "edit", entry.id);
    const deleteButton = makeCardButton("Delete", "delete", entry.id);
    deleteButton.classList.add("delete");
    actions.append(editButton, deleteButton);
    bottom.append(date, actions);
    card.append(top, details, bottom);
    return card;
  }

  function makeCardButton(label, action, id) {
    const button = document.createElement("button");
    button.className = "card-action";
    button.type = "button";
    button.dataset.action = action;
    button.dataset.id = id;
    button.textContent = label;
    button.setAttribute("aria-label", `${label} entry`);
    return button;
  }

  // Create or update an entry, then clear the form for the next thought.
  function addEntry(event) {
    event.preventDefault();
    const title = titleInput.value.trim();
    if (!title) {
      showTitleError();
      titleInput.focus();
      return;
    }

    clearTitleError();
    const now = new Date().toISOString();
    let savedId;
    if (editingId) {
      const current = entries.find((entry) => entry.id === editingId);
      if (!current) {
        resetForm();
        return;
      }
      savedId = editingId;
      entries = entries.map((entry) => entry.id === editingId
        ? { ...entry, title, category: categoryInput.value, details: detailsInput.value.trim(), updatedAt: now }
        : entry);
      showToast("Your changes have been saved.");
    } else {
      savedId = createId();
      entries.push({ id: savedId, title, category: categoryInput.value, details: detailsInput.value.trim(), createdAt: now, updatedAt: now });
    }

    if (!saveEntries()) return;
    resetForm();
    activeCategory = "All";
    updateFilterButtons();
    searchInput.value = "";
    renderEntries({ animateId: savedId });
    if (!editingId) showToast("Added to your vault.");
  }

  // Return an entry to the form for editing without changing its original added date.
  function editEntry(id) {
    const entry = entries.find((item) => item.id === id);
    if (!entry) return;
    editingId = entry.id;
    titleInput.value = entry.title;
    categoryInput.value = entry.category;
    detailsInput.value = entry.details;
    submitLabel.textContent = "Save changes";
    cancelEditButton.hidden = false;
    clearTitleError();
    document.querySelector("#form-heading").textContent = "Edit your entry";
    document.querySelector(".form-panel").scrollIntoView({ behavior: "smooth", block: "center" });
    titleInput.focus({ preventScroll: true });
  }

  // Animate a card out before removing it from storage and the page.
  function deleteEntry(id) {
    const card = [...entryList.querySelectorAll(".entry-card")].find((item) => item.querySelector(`[data-id="${CSS.escape(id)}"]`));
    if (card) {
      card.classList.add("is-deleting");
      window.setTimeout(() => finishDelete(id), 230);
    } else {
      finishDelete(id);
    }
  }

  function finishDelete(id) {
    entries = entries.filter((entry) => entry.id !== id);
    saveEntries();
    if (editingId === id) resetForm();
    renderEntries();
    showToast("Entry deleted.");
  }

  function resetForm() {
    form.reset();
    editingId = null;
    submitLabel.textContent = "Add to vault";
    cancelEditButton.hidden = true;
    document.querySelector("#form-heading").textContent = "Add to your vault";
    clearTitleError();
  }

  function showTitleError() {
    titleError.hidden = false;
    titleInput.setAttribute("aria-invalid", "true");
  }

  function clearTitleError() {
    titleError.hidden = true;
    titleInput.removeAttribute("aria-invalid");
  }

  function updateFilterButtons() {
    document.querySelectorAll(".filter-button").forEach((button) => {
      const selected = button.dataset.category === activeCategory;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Date unavailable";
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2800);
  }

  function createId() {
    return globalThis.crypto?.randomUUID?.() || `entry-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function isValidEntry(value) {
    return value && typeof value === "object" && typeof value.title === "string" && value.title.trim() && typeof value.details === "string" && CATEGORIES.includes(value.category);
  }

  function normalizeEntry(value) {
    const createdAt = typeof value.createdAt === "string" && !Number.isNaN(Date.parse(value.createdAt)) ? value.createdAt : new Date().toISOString();
    return {
      id: typeof value.id === "string" && value.id ? value.id : createId(),
      title: value.title.trim().slice(0, 120),
      category: value.category,
      details: value.details.slice(0, 5000),
      createdAt,
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : createdAt,
    };
  }

  function exportEntries() {
    const file = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = `datavault-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast(`Exported ${entries.length} ${entries.length === 1 ? "entry" : "entries"}.`);
  }

  async function importEntries(file) {
    try {
      const parsed = JSON.parse(await file.text());
      const imported = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.entries) ? parsed.entries : null;
      if (!imported) throw new Error("Expected a JSON array of entries.");
      const validEntries = imported.filter(isValidEntry).map(normalizeEntry);
      const seen = new Set(entries.map((entry) => entry.id));
      for (const entry of validEntries) {
        if (seen.has(entry.id)) entry.id = createId();
        seen.add(entry.id);
      }
      entries = [...entries, ...validEntries];
      if (!saveEntries()) return;
      activeCategory = "All";
      searchInput.value = "";
      updateFilterButtons();
      renderEntries();
      showToast(`Imported ${validEntries.length} ${validEntries.length === 1 ? "entry" : "entries"}.`);
    } catch (error) {
      console.error("DataVault could not import this file.", error);
      showToast("That file doesn’t look like a valid DataVault JSON export.");
    } finally {
      importFile.value = "";
    }
  }

  form.addEventListener("submit", addEntry);
  titleInput.addEventListener("input", () => { if (titleInput.value.trim()) clearTitleError(); });
  cancelEditButton.addEventListener("click", resetForm);
  searchInput.addEventListener("input", () => renderEntries());
  document.querySelector(".filter-list").addEventListener("click", (event) => {
    const button = event.target.closest(".filter-button");
    if (!button) return;
    activeCategory = button.dataset.category;
    updateFilterButtons();
    renderEntries();
  });
  entryList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    if (button.dataset.action === "edit") editEntry(button.dataset.id);
    if (button.dataset.action === "delete") deleteEntry(button.dataset.id);
  });
  document.querySelector("#export-button").addEventListener("click", exportEntries);
  document.querySelector("#import-button").addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", () => { if (importFile.files?.[0]) importEntries(importFile.files[0]); });
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      searchInput.focus();
    }
    if (event.key === "Escape" && document.activeElement === searchInput) {
      searchInput.value = "";
      renderEntries();
    }
  });

  renderEntries();
})();
