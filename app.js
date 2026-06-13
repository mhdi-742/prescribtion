/* ================================================
   PrescribeRx — Main Application Logic
   ================================================ */

// ================================================
// FUZZY SEARCH ENGINE
// ================================================
const FuzzySearch = {
  /**
   * Levenshtein distance between two strings
   */
  levenshtein(a, b) {
    const an = a.length;
    const bn = b.length;
    if (an === 0) return bn;
    if (bn === 0) return an;

    const matrix = [];
    for (let i = 0; i <= bn; i++) matrix[i] = [i];
    for (let j = 0; j <= an; j++) matrix[0][j] = j;

    for (let i = 1; i <= bn; i++) {
      for (let j = 1; j <= an; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          );
        }
      }
    }
    return matrix[bn][an];
  },

  /**
   * Jaro-Winkler similarity (0 to 1, higher is better)
   */
  jaroWinkler(s1, s2) {
    if (s1 === s2) return 1.0;
    const len1 = s1.length;
    const len2 = s2.length;
    if (len1 === 0 || len2 === 0) return 0.0;

    const matchDistance = Math.floor(Math.max(len1, len2) / 2) - 1;
    const s1Matches = new Array(len1).fill(false);
    const s2Matches = new Array(len2).fill(false);

    let matches = 0;
    let transpositions = 0;

    for (let i = 0; i < len1; i++) {
      const start = Math.max(0, i - matchDistance);
      const end = Math.min(i + matchDistance + 1, len2);
      for (let j = start; j < end; j++) {
        if (s2Matches[j] || s1[i] !== s2[j]) continue;
        s1Matches[i] = true;
        s2Matches[j] = true;
        matches++;
        break;
      }
    }

    if (matches === 0) return 0.0;

    let k = 0;
    for (let i = 0; i < len1; i++) {
      if (!s1Matches[i]) continue;
      while (!s2Matches[k]) k++;
      if (s1[i] !== s2[k]) transpositions++;
      k++;
    }

    const jaro = (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;

    // Winkler prefix bonus
    let prefix = 0;
    for (let i = 0; i < Math.min(4, Math.min(len1, len2)); i++) {
      if (s1[i] === s2[i]) prefix++;
      else break;
    }

    return jaro + prefix * 0.1 * (1 - jaro);
  },

  /**
   * Calculate combined relevance score
   */
  score(query, text) {
    const q = query.toLowerCase().trim();
    const t = text.toLowerCase().trim();

    if (t === q) return 1.0;
    if (t.startsWith(q)) return 0.95;
    if (t.includes(q)) return 0.85;

    const jw = this.jaroWinkler(q, t);
    const maxLen = Math.max(q.length, t.length);
    const lev = this.levenshtein(q, t);
    const levScore = 1 - lev / maxLen;

    // Weighted combination — Jaro-Winkler rewards prefix matching
    return jw * 0.6 + levScore * 0.4;
  },

  /**
   * Search medicines with fuzzy matching
   * @param {string} query — user's input
   * @param {Array} medicines — array of medicine objects
   * @param {number} limit — max results to return
   * @returns {Array} sorted array of { medicine, score, matchedField }
   */
  search(query, medicines, limit = 12) {
    if (!query || query.trim().length < 1) return [];

    const q = query.toLowerCase().trim();
    const results = [];

    for (const med of medicines) {
      let bestScore = 0;
      let matchedField = 'name';

      // Score against brand name
      const nameScore = this.score(q, med.name);
      if (nameScore > bestScore) {
        bestScore = nameScore;
        matchedField = 'name';
      }

      // Score against generic name
      const genericScore = this.score(q, med.genericName);
      if (genericScore > bestScore) {
        bestScore = genericScore;
        matchedField = 'genericName';
      }

      // Score against category
      const catScore = this.score(q, med.category) * 0.7; // Lower weight for category
      if (catScore > bestScore) {
        bestScore = catScore;
        matchedField = 'category';
      }

      // Threshold — only include reasonably close matches
      if (bestScore > 0.45) {
        results.push({ medicine: med, score: bestScore, matchedField });
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, limit);
  }
};


// ================================================
// STORAGE MANAGER
// ================================================
const Storage = {
  KEYS: {
    PROFILE: 'prescribeRx_profile',
    PRESCRIPTIONS: 'prescribeRx_prescriptions',
    CUSTOM_MEDS: 'prescribeRx_customMeds',
    SETUP_DONE: 'prescribeRx_setupDone'
  },

  get(key, fallback = null) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : fallback;
    } catch {
      return fallback;
    }
  },

  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error('Storage error:', e);
    }
  },

  // Profile
  getProfile() {
    return this.get(this.KEYS.PROFILE, {});
  },

  saveProfile(profile) {
    this.set(this.KEYS.PROFILE, profile);
  },

  // Prescriptions
  getPrescriptions() {
    return this.get(this.KEYS.PRESCRIPTIONS, []);
  },

  savePrescription(rx) {
    const all = this.getPrescriptions();
    const idx = all.findIndex(p => p.id === rx.id);
    if (idx >= 0) {
      all[idx] = rx;
    } else {
      all.unshift(rx);
    }
    // Keep last 100
    if (all.length > 100) all.length = 100;
    this.set(this.KEYS.PRESCRIPTIONS, all);
  },

  deletePrescription(id) {
    const all = this.getPrescriptions().filter(p => p.id !== id);
    this.set(this.KEYS.PRESCRIPTIONS, all);
  },

  // Custom Medicines
  getCustomMedicines() {
    return this.get(this.KEYS.CUSTOM_MEDS, []);
  },

  saveCustomMedicine(med) {
    const all = this.getCustomMedicines();
    med.id = 'custom_' + Date.now();
    med.isCustom = true;
    all.push(med);
    this.set(this.KEYS.CUSTOM_MEDS, all);
  },

  removeCustomMedicine(id) {
    const all = this.getCustomMedicines().filter(m => m.id !== id);
    this.set(this.KEYS.CUSTOM_MEDS, all);
  },

  // Setup
  isSetupDone() {
    return this.get(this.KEYS.SETUP_DONE, false);
  },

  markSetupDone() {
    this.set(this.KEYS.SETUP_DONE, true);
  }
};


// ================================================
// TOAST NOTIFICATIONS
// ================================================
const Toast = {
  show(message, type = 'success', duration = 3000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span>${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span>
      <span>${message}</span>
    `;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('hiding');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }
};


// ================================================
// MAIN APP CONTROLLER
// ================================================
const App = {
  currentView: 'dashboard',
  medicineRowCount: 0,
  allMedicines: [],

  // ---- Initialization ----
  init() {
    this.loadMedicines();
    this.bindNavigation();
    this.bindDashboard();
    this.bindEditor();
    this.bindMedicineManager();
    this.bindSettings();
    this.bindSetupModal();

    // Check first-time setup
    if (!Storage.isSetupDone()) {
      document.getElementById('setup-modal').classList.remove('hidden');
    } else {
      this.applyProfile();
    }

    this.updateDashboard();
  },

  // ---- Medicine Loading ----
  loadMedicines() {
    const base = (typeof MEDICINES_DB !== 'undefined') ? MEDICINES_DB : [];
    const custom = Storage.getCustomMedicines();
    this.allMedicines = [...base, ...custom];
  },

  getAllMedicines() {
    return this.allMedicines;
  },

  // ---- Navigation ----
  bindNavigation() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        this.showView(view);
      });
    });
  },

  showView(viewName) {
    // Hide all views
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

    // Show target view
    const view = document.getElementById(`view-${viewName}`);
    const nav = document.querySelector(`[data-view="${viewName}"]`);
    if (view) view.classList.add('active');
    if (nav) nav.classList.add('active');

    this.currentView = viewName;

    // View-specific refresh
    if (viewName === 'dashboard') this.updateDashboard();
    if (viewName === 'medicines') this.updateMedicineManager();
    if (viewName === 'settings') this.loadSettings();
    if (viewName === 'editor' && this.medicineRowCount === 0) this.addMedicineRow();
  },

  // ---- Dashboard ----
  bindDashboard() {
    document.getElementById('btn-new-rx').addEventListener('click', () => {
      this.newPrescription();
    });
  },

  updateDashboard() {
    const profile = Storage.getProfile();
    const name = profile.doctorName || 'Doctor';
    document.getElementById('doctor-name-display').textContent = name.startsWith('Dr') ? name : `Dr. ${name}`;

    const prescriptions = Storage.getPrescriptions();
    const today = new Date().toISOString().split('T')[0];

    document.getElementById('stat-total').textContent = prescriptions.length;
    document.getElementById('stat-today').textContent = prescriptions.filter(p => p.date === today).length;

    // Unique patients
    const patients = new Set(prescriptions.map(p => (p.patientName || '').toLowerCase()).filter(Boolean));
    document.getElementById('stat-patients').textContent = patients.size;

    // Recent prescriptions
    this.renderRecentPrescriptions(prescriptions.slice(0, 6));
  },

  renderRecentPrescriptions(prescriptions) {
    const container = document.getElementById('recent-prescriptions');

    if (prescriptions.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📋</div>
          <p>No prescriptions yet. Create your first one!</p>
          <button class="btn-primary" onclick="App.newPrescription()">+ New Prescription</button>
        </div>
      `;
      return;
    }

    container.innerHTML = prescriptions.map(rx => `
      <div class="recent-card" data-id="${rx.id}">
        <div class="recent-card-header">
          <span class="recent-card-name">${rx.patientName || 'Unknown Patient'}</span>
          <span class="recent-card-date">${this.formatDate(rx.date)}</span>
        </div>
        <div class="recent-card-diagnosis">${rx.diagnosis || 'No diagnosis'}</div>
        <div class="recent-card-meds">${(rx.medicines || []).length} medicine(s)</div>
        <div class="recent-card-actions">
          <button class="btn-ghost" onclick="App.loadPrescription('${rx.id}')">📝 Edit</button>
          <button class="btn-ghost" onclick="App.printPrescription('${rx.id}')">🖨 Print</button>
          <button class="btn-danger" onclick="App.deletePrescription('${rx.id}')">🗑</button>
        </div>
      </div>
    `).join('');
  },

  // ---- Prescription Editor ----
  bindEditor() {
    document.getElementById('btn-back').addEventListener('click', () => this.showView('dashboard'));
    document.getElementById('btn-save').addEventListener('click', () => this.savePrescription());
    document.getElementById('btn-print').addEventListener('click', () => window.print());
    document.getElementById('btn-clear').addEventListener('click', () => this.clearPrescription());
    document.getElementById('btn-add-medicine').addEventListener('click', () => this.addMedicineRow());
  },

  newPrescription() {
    this.clearPrescription();
    this.applyProfile();

    // Set today's date
    document.getElementById('rx-date').value = new Date().toISOString().split('T')[0];

    // Generate unique ID
    this._currentRxId = 'rx_' + Date.now();

    this.showView('editor');
  },

  clearPrescription() {
    // Clear patient fields
    document.getElementById('rx-patient-name').value = '';
    document.getElementById('rx-patient-age').value = '';
    document.getElementById('rx-patient-sex').value = '';
    document.getElementById('rx-patient-weight').value = '';
    document.getElementById('rx-patient-height').value = '';
    document.getElementById('rx-date').value = new Date().toISOString().split('T')[0];

    // Clear vitals
    document.getElementById('rx-bp').value = '';
    document.getElementById('rx-pulse').value = '';
    document.getElementById('rx-temp').value = '';
    document.getElementById('rx-spo2').value = '';

    // Clear diagnosis & advice
    document.getElementById('rx-diagnosis').value = '';
    document.getElementById('rx-advice').value = '';
    document.getElementById('rx-followup').value = '';

    // Clear medicines
    document.getElementById('medicine-list').innerHTML = '';
    this.medicineRowCount = 0;

    // New ID
    this._currentRxId = 'rx_' + Date.now();
  },

  applyProfile() {
    const p = Storage.getProfile();
    if (!p.doctorName) return;

    document.getElementById('rx-clinic-name').value = p.clinicName || '';
    document.getElementById('rx-clinic-tagline').value = p.clinicTagline || '';
    document.getElementById('rx-doctor-name').value = p.doctorName || '';
    document.getElementById('rx-doctor-spec').value = p.specialization || '';
    document.getElementById('rx-doctor-qual').value = p.qualifications || '';
    document.getElementById('rx-doctor-reg').value = p.regNumber ? `Reg. No: ${p.regNumber}` : '';
    document.getElementById('rx-timing').value = p.timing || '';
    document.getElementById('rx-phone').value = p.phone || '';
    document.getElementById('rx-emergency').value = p.emergency || '';
    document.getElementById('rx-ambulance').value = p.ambulance || '';
    document.getElementById('rx-address').value = p.address || '';
  },

  // ---- Medicine Rows ----
  addMedicineRow(data = null) {
    this.medicineRowCount++;
    const idx = this.medicineRowCount;
    const container = document.getElementById('medicine-list');

    const row = document.createElement('div');
    row.className = 'medicine-row';
    row.id = `med-row-${idx}`;
    row.dataset.index = idx;

    row.innerHTML = `
      <div class="med-row-top">
        <span class="med-number">${idx}.</span>
        <select class="med-form" id="med-form-${idx}">
          <option value="Tab">Tab.</option>
          <option value="Cap">Cap.</option>
          <option value="Syp">Syp.</option>
          <option value="Inj">Inj.</option>
          <option value="Drop">Drop</option>
          <option value="Cream">Cream</option>
          <option value="Oint">Oint.</option>
          <option value="Gel">Gel</option>
          <option value="Spray">Spray</option>
          <option value="Inhaler">Inhaler</option>
          <option value="Susp">Susp.</option>
          <option value="Sachet">Sachet</option>
          <option value="Patch">Patch</option>
          <option value="Powder">Powder</option>
          <option value="Lotion">Lotion</option>
          <option value="Solution">Sol.</option>
        </select>
        <div class="med-search-container">
          <input type="text" class="med-name-input" id="med-name-${idx}"
                 placeholder="Search medicine..." autocomplete="off">
          <div class="med-search-dropdown" id="med-dropdown-${idx}"></div>
        </div>
        <input type="text" class="med-strength" id="med-strength-${idx}" placeholder="Strength">
        <button class="med-remove-btn" onclick="App.removeMedicineRow(${idx})" title="Remove">✕</button>
      </div>
      <div class="med-row-bottom">
        <div class="med-dose">
          <label>Dose:</label>
          <input type="text" class="med-dose-qty" id="med-dose-${idx}" value="1" placeholder="1">
        </div>
        <div class="med-frequency">
          <label>Freq:</label>
          <div class="freq-toggles">
            <button class="freq-btn active" data-row="${idx}" data-period="M" title="Morning" type="button">M</button>
            <span class="freq-separator">-</span>
            <button class="freq-btn" data-row="${idx}" data-period="A" title="Afternoon" type="button">A</button>
            <span class="freq-separator">-</span>
            <button class="freq-btn" data-row="${idx}" data-period="E" title="Evening" type="button">E</button>
            <span class="freq-separator">-</span>
            <button class="freq-btn active" data-row="${idx}" data-period="N" title="Night" type="button">N</button>
          </div>
        </div>
        <div class="med-duration">
          <label>Duration:</label>
          <input type="number" class="med-dur-value" id="med-dur-${idx}" placeholder="5" min="1">
          <select class="med-dur-unit" id="med-durunit-${idx}">
            <option value="days">days</option>
            <option value="weeks">weeks</option>
            <option value="months">months</option>
          </select>
        </div>
        <div class="med-instructions">
          <select class="med-instruction-select" id="med-instr-${idx}">
            <option value="">-- Instructions --</option>
            <option value="After food">After food</option>
            <option value="Before food">Before food</option>
            <option value="Empty stomach">Empty stomach</option>
            <option value="With milk">With milk</option>
            <option value="With water">With water</option>
            <option value="At bedtime">At bedtime</option>
            <option value="As needed (SOS)">As needed (SOS)</option>
            <option value="Twice a day">Twice a day</option>
            <option value="Once a day">Once a day</option>
            <option value="Every 8 hours">Every 8 hours</option>
            <option value="Sublingual">Sublingual</option>
          </select>
        </div>
      </div>
    `;

    container.appendChild(row);

    // Bind events for this row
    this.bindMedicineRowEvents(idx);

    // If loading data, fill it in
    if (data) {
      this.fillMedicineRow(idx, data);
    }

    // Focus the name input
    setTimeout(() => {
      document.getElementById(`med-name-${idx}`).focus();
    }, 100);
  },

  fillMedicineRow(idx, data) {
    if (data.form) document.getElementById(`med-form-${idx}`).value = data.form;
    if (data.name) {
      const input = document.getElementById(`med-name-${idx}`);
      input.value = data.name;
      input.classList.add('has-value');
    }
    if (data.strength) document.getElementById(`med-strength-${idx}`).value = data.strength;
    if (data.dose) document.getElementById(`med-dose-${idx}`).value = data.dose;
    if (data.duration) document.getElementById(`med-dur-${idx}`).value = data.duration;
    if (data.durationUnit) document.getElementById(`med-durunit-${idx}`).value = data.durationUnit;
    if (data.instructions) document.getElementById(`med-instr-${idx}`).value = data.instructions;

    // Set frequency toggles
    if (data.frequency) {
      const toggles = document.querySelectorAll(`#med-row-${idx} .freq-btn`);
      toggles.forEach(btn => {
        const period = btn.dataset.period;
        if (data.frequency.includes(period)) {
          btn.classList.add('active');
        } else {
          btn.classList.remove('active');
        }
      });
    }
  },

  bindMedicineRowEvents(idx) {
    const nameInput = document.getElementById(`med-name-${idx}`);
    const dropdown = document.getElementById(`med-dropdown-${idx}`);
    let highlightedIndex = -1;

    // Search on input
    nameInput.addEventListener('input', (e) => {
      const query = e.target.value;
      highlightedIndex = -1;
      if (query.length < 1) {
        dropdown.classList.remove('show');
        nameInput.classList.remove('has-value');
        return;
      }
      nameInput.classList.remove('has-value');
      const results = FuzzySearch.search(query, this.getAllMedicines());
      this.renderDropdown(dropdown, results, idx, query);
    });

    // Show dropdown on focus if there's text
    nameInput.addEventListener('focus', () => {
      const query = nameInput.value;
      if (query.length >= 1 && !nameInput.classList.contains('has-value')) {
        const results = FuzzySearch.search(query, this.getAllMedicines());
        this.renderDropdown(dropdown, results, idx, query);
      }
    });

    // Keyboard navigation
    nameInput.addEventListener('keydown', (e) => {
      if (!dropdown.classList.contains('show')) return;

      const items = dropdown.querySelectorAll('.med-dropdown-item');

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        highlightedIndex = Math.min(highlightedIndex + 1, items.length - 1);
        this.updateDropdownHighlight(items, highlightedIndex);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlightedIndex = Math.max(highlightedIndex - 1, 0);
        this.updateDropdownHighlight(items, highlightedIndex);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (highlightedIndex >= 0 && items[highlightedIndex]) {
          items[highlightedIndex].click();
        }
      } else if (e.key === 'Escape') {
        dropdown.classList.remove('show');
      }
    });

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest(`#med-row-${idx} .med-search-container`)) {
        dropdown.classList.remove('show');
      }
    });

    // Frequency toggle buttons
    const freqBtns = document.querySelectorAll(`#med-row-${idx} .freq-btn`);
    freqBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        btn.classList.toggle('active');
      });
    });
  },

  renderDropdown(dropdown, results, rowIdx, query) {
    if (results.length === 0) {
      dropdown.innerHTML = `
        <div class="med-dropdown-add" onclick="App.quickAddMedicine('${query.replace(/'/g, "\\'")}', ${rowIdx})">
          ➕ Add "${query}" as new medicine
        </div>
      `;
      dropdown.classList.add('show');
      return;
    }

    let html = results.map((r, i) => `
      <div class="med-dropdown-item" data-idx="${i}"
           onclick="App.selectMedicine(${rowIdx}, ${JSON.stringify(r.medicine).replace(/"/g, '&quot;')})">
        <div class="med-dropdown-item-info">
          <span class="med-dropdown-name">${this.highlightMatch(r.medicine.name, query)}</span>
          <span class="med-dropdown-generic">${r.medicine.genericName}${r.medicine.strengths ? ' — ' + r.medicine.strengths.slice(0, 3).join(', ') : ''}</span>
        </div>
        <span class="med-dropdown-category">${r.medicine.category}</span>
      </div>
    `).join('');

    // Add "add new" option at bottom
    html += `
      <div class="med-dropdown-add" onclick="App.quickAddMedicine('${query.replace(/'/g, "\\'")}', ${rowIdx})">
        ➕ Add "${query}" as new medicine
      </div>
    `;

    dropdown.innerHTML = html;
    dropdown.classList.add('show');
  },

  highlightMatch(text, query) {
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const idx = lowerText.indexOf(lowerQuery);
    if (idx === -1) return text;
    return text.substring(0, idx) +
           '<strong style="color:var(--accent)">' + text.substring(idx, idx + query.length) + '</strong>' +
           text.substring(idx + query.length);
  },

  updateDropdownHighlight(items, highlightedIndex) {
    items.forEach((item, i) => {
      item.classList.toggle('highlighted', i === highlightedIndex);
    });
    if (items[highlightedIndex]) {
      items[highlightedIndex].scrollIntoView({ block: 'nearest' });
    }
  },

  selectMedicine(rowIdx, medicine) {
    const nameInput = document.getElementById(`med-name-${rowIdx}`);
    const strengthInput = document.getElementById(`med-strength-${rowIdx}`);
    const formSelect = document.getElementById(`med-form-${rowIdx}`);
    const dropdown = document.getElementById(`med-dropdown-${rowIdx}`);

    nameInput.value = medicine.name;
    nameInput.classList.add('has-value');
    dropdown.classList.remove('show');

    // Auto-fill strength if available
    if (medicine.strengths && medicine.strengths.length > 0) {
      strengthInput.value = medicine.strengths[0];
    }

    // Auto-fill form if available
    if (medicine.forms && medicine.forms.length > 0) {
      const form = medicine.forms[0];
      const options = formSelect.options;
      for (let i = 0; i < options.length; i++) {
        if (options[i].value === form) {
          formSelect.selectedIndex = i;
          break;
        }
      }
    }

    // Focus duration
    document.getElementById(`med-dur-${rowIdx}`).focus();
  },

  quickAddMedicine(name, rowIdx) {
    // Add as custom medicine with minimal info
    const med = {
      name: name,
      genericName: name,
      category: 'Custom',
      forms: ['Tab'],
      strengths: []
    };
    Storage.saveCustomMedicine(med);
    this.loadMedicines(); // Refresh

    // Select it in the row
    const nameInput = document.getElementById(`med-name-${rowIdx}`);
    nameInput.value = name;
    nameInput.classList.add('has-value');
    document.getElementById(`med-dropdown-${rowIdx}`).classList.remove('show');

    Toast.show(`"${name}" added to your custom medicines!`, 'success');
  },

  removeMedicineRow(idx) {
    const row = document.getElementById(`med-row-${idx}`);
    if (row) {
      row.style.animation = 'medRowIn 0.2s ease reverse';
      setTimeout(() => {
        row.remove();
        this.renumberMedicineRows();
      }, 200);
    }
  },

  renumberMedicineRows() {
    const rows = document.querySelectorAll('#medicine-list .medicine-row');
    rows.forEach((row, i) => {
      row.querySelector('.med-number').textContent = `${i + 1}.`;
    });
  },

  // ---- Save Prescription ----
  savePrescription() {
    const patientName = document.getElementById('rx-patient-name').value.trim();
    if (!patientName) {
      Toast.show('Please enter patient name', 'error');
      document.getElementById('rx-patient-name').focus();
      return;
    }

    const rx = {
      id: this._currentRxId || 'rx_' + Date.now(),
      date: document.getElementById('rx-date').value,
      patientName: patientName,
      patientAge: document.getElementById('rx-patient-age').value,
      patientSex: document.getElementById('rx-patient-sex').value,
      patientWeight: document.getElementById('rx-patient-weight').value,
      patientHeight: document.getElementById('rx-patient-height').value,
      bp: document.getElementById('rx-bp').value,
      pulse: document.getElementById('rx-pulse').value,
      temp: document.getElementById('rx-temp').value,
      spo2: document.getElementById('rx-spo2').value,
      diagnosis: document.getElementById('rx-diagnosis').value,
      advice: document.getElementById('rx-advice').value,
      followup: document.getElementById('rx-followup').value,
      medicines: this.collectMedicines(),
      // Clinic info (in case doctor edits it per-prescription)
      clinicName: document.getElementById('rx-clinic-name').value,
      doctorName: document.getElementById('rx-doctor-name').value,
      savedAt: new Date().toISOString()
    };

    Storage.savePrescription(rx);
    Toast.show('Prescription saved!', 'success');
    this.updateDashboard();
  },

  collectMedicines() {
    const rows = document.querySelectorAll('#medicine-list .medicine-row');
    const medicines = [];

    rows.forEach(row => {
      const idx = row.dataset.index;
      const name = document.getElementById(`med-name-${idx}`)?.value?.trim();
      if (!name) return;

      // Get frequency
      const freqBtns = row.querySelectorAll('.freq-btn');
      const frequency = [];
      freqBtns.forEach(btn => {
        if (btn.classList.contains('active')) {
          frequency.push(btn.dataset.period);
        }
      });

      medicines.push({
        form: document.getElementById(`med-form-${idx}`)?.value || 'Tab',
        name: name,
        strength: document.getElementById(`med-strength-${idx}`)?.value || '',
        dose: document.getElementById(`med-dose-${idx}`)?.value || '1',
        frequency: frequency,
        duration: document.getElementById(`med-dur-${idx}`)?.value || '',
        durationUnit: document.getElementById(`med-durunit-${idx}`)?.value || 'days',
        instructions: document.getElementById(`med-instr-${idx}`)?.value || ''
      });
    });

    return medicines;
  },

  // ---- Load Prescription ----
  loadPrescription(id) {
    const prescriptions = Storage.getPrescriptions();
    const rx = prescriptions.find(p => p.id === id);
    if (!rx) {
      Toast.show('Prescription not found', 'error');
      return;
    }

    this.clearPrescription();
    this._currentRxId = rx.id;

    // Fill patient info
    document.getElementById('rx-date').value = rx.date || '';
    document.getElementById('rx-patient-name').value = rx.patientName || '';
    document.getElementById('rx-patient-age').value = rx.patientAge || '';
    document.getElementById('rx-patient-sex').value = rx.patientSex || '';
    document.getElementById('rx-patient-weight').value = rx.patientWeight || '';
    document.getElementById('rx-patient-height').value = rx.patientHeight || '';

    // Vitals
    document.getElementById('rx-bp').value = rx.bp || '';
    document.getElementById('rx-pulse').value = rx.pulse || '';
    document.getElementById('rx-temp').value = rx.temp || '';
    document.getElementById('rx-spo2').value = rx.spo2 || '';

    // Diagnosis & advice
    document.getElementById('rx-diagnosis').value = rx.diagnosis || '';
    document.getElementById('rx-advice').value = rx.advice || '';
    document.getElementById('rx-followup').value = rx.followup || '';

    // Clinic info
    if (rx.clinicName) document.getElementById('rx-clinic-name').value = rx.clinicName;
    if (rx.doctorName) document.getElementById('rx-doctor-name').value = rx.doctorName;

    // Apply profile for remaining clinic fields
    this.applyProfile();

    // Medicines
    if (rx.medicines && rx.medicines.length > 0) {
      rx.medicines.forEach(med => this.addMedicineRow(med));
    } else {
      this.addMedicineRow();
    }

    this.showView('editor');
    Toast.show('Prescription loaded', 'info');
  },

  // ---- Print Prescription ----
  printPrescription(id) {
    if (id) {
      this.loadPrescription(id);
      setTimeout(() => window.print(), 500);
    } else {
      window.print();
    }
  },

  // ---- Delete Prescription ----
  deletePrescription(id) {
    if (confirm('Delete this prescription?')) {
      Storage.deletePrescription(id);
      this.updateDashboard();
      Toast.show('Prescription deleted', 'success');
    }
  },

  // ---- Medicine Manager ----
  bindMedicineManager() {
    document.getElementById('btn-add-custom-med').addEventListener('click', () => {
      this.addCustomMedicine();
    });
  },

  updateMedicineManager() {
    const base = (typeof MEDICINES_DB !== 'undefined') ? MEDICINES_DB : [];
    const custom = Storage.getCustomMedicines();

    document.getElementById('med-count-base').textContent = base.length;
    document.getElementById('med-count-custom').textContent = custom.length;
    document.getElementById('med-count-total').textContent = base.length + custom.length;

    const container = document.getElementById('custom-med-list');
    if (custom.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">💊</div>
          <p>No custom medicines added yet.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = custom.map(med => `
      <div class="custom-med-card">
        <div class="custom-med-info">
          <h4>${med.name}</h4>
          <p>${med.genericName}</p>
          <span class="custom-med-badge">${med.category}</span>
        </div>
        <button class="btn-danger" onclick="App.deleteCustomMedicine('${med.id}')">✕</button>
      </div>
    `).join('');
  },

  addCustomMedicine() {
    const name = document.getElementById('new-med-name').value.trim();
    const generic = document.getElementById('new-med-generic').value.trim();
    const category = document.getElementById('new-med-category').value.trim();
    const forms = document.getElementById('new-med-forms').value.split(',').map(s => s.trim()).filter(Boolean);
    const strengths = document.getElementById('new-med-strengths').value.split(',').map(s => s.trim()).filter(Boolean);

    if (!name || !generic || !category) {
      Toast.show('Please fill in Name, Generic Name, and Category', 'error');
      return;
    }

    Storage.saveCustomMedicine({
      name,
      genericName: generic,
      category,
      forms: forms.length > 0 ? forms : ['Tab'],
      strengths
    });

    this.loadMedicines();
    this.updateMedicineManager();

    // Clear form
    document.getElementById('new-med-name').value = '';
    document.getElementById('new-med-generic').value = '';
    document.getElementById('new-med-category').value = '';
    document.getElementById('new-med-forms').value = '';
    document.getElementById('new-med-strengths').value = '';

    Toast.show(`"${name}" added successfully!`, 'success');
  },

  deleteCustomMedicine(id) {
    if (confirm('Remove this custom medicine?')) {
      Storage.removeCustomMedicine(id);
      this.loadMedicines();
      this.updateMedicineManager();
      Toast.show('Medicine removed', 'success');
    }
  },

  // ---- Settings ----
  bindSettings() {
    document.getElementById('btn-save-settings').addEventListener('click', () => this.saveSettings());
    document.getElementById('btn-reset-settings').addEventListener('click', () => this.resetAllData());
  },

  loadSettings() {
    const p = Storage.getProfile();
    document.getElementById('set-doctor-name').value = p.doctorName || '';
    document.getElementById('set-doctor-qual').value = p.qualifications || '';
    document.getElementById('set-doctor-spec').value = p.specialization || '';
    document.getElementById('set-doctor-reg').value = p.regNumber || '';
    document.getElementById('set-clinic-name').value = p.clinicName || '';
    document.getElementById('set-clinic-tagline').value = p.clinicTagline || '';
    document.getElementById('set-clinic-address').value = p.address || '';
    document.getElementById('set-clinic-timing').value = p.timing || '';
    document.getElementById('set-clinic-phone').value = p.phone || '';
    document.getElementById('set-clinic-emergency').value = p.emergency || '';
    document.getElementById('set-clinic-ambulance').value = p.ambulance || '';
  },

  saveSettings() {
    const profile = {
      doctorName: document.getElementById('set-doctor-name').value.trim(),
      qualifications: document.getElementById('set-doctor-qual').value.trim(),
      specialization: document.getElementById('set-doctor-spec').value.trim(),
      regNumber: document.getElementById('set-doctor-reg').value.trim(),
      clinicName: document.getElementById('set-clinic-name').value.trim(),
      clinicTagline: document.getElementById('set-clinic-tagline').value.trim(),
      address: document.getElementById('set-clinic-address').value.trim(),
      timing: document.getElementById('set-clinic-timing').value.trim(),
      phone: document.getElementById('set-clinic-phone').value.trim(),
      emergency: document.getElementById('set-clinic-emergency').value.trim(),
      ambulance: document.getElementById('set-clinic-ambulance').value.trim()
    };

    Storage.saveProfile(profile);
    Toast.show('Settings saved!', 'success');
    this.updateDashboard();
  },

  resetAllData() {
    if (confirm('⚠️ This will delete ALL your data including prescriptions, custom medicines, and settings. Are you sure?')) {
      localStorage.clear();
      Toast.show('All data cleared. Refreshing...', 'info');
      setTimeout(() => window.location.reload(), 1500);
    }
  },

  // ---- First-Time Setup Modal ----
  bindSetupModal() {
    document.getElementById('btn-setup-save').addEventListener('click', () => {
      const name = document.getElementById('setup-name').value.trim();
      if (!name) {
        Toast.show('Please enter your name', 'error');
        return;
      }

      const profile = {
        doctorName: name,
        qualifications: document.getElementById('setup-qual').value.trim(),
        specialization: document.getElementById('setup-spec').value.trim(),
        clinicName: document.getElementById('setup-clinic').value.trim(),
        regNumber: document.getElementById('setup-reg').value.trim(),
        clinicTagline: '',
        address: '',
        timing: '',
        phone: '',
        emergency: '',
        ambulance: ''
      };

      Storage.saveProfile(profile);
      Storage.markSetupDone();

      document.getElementById('setup-modal').classList.add('hidden');
      this.applyProfile();
      this.updateDashboard();

      Toast.show(`Welcome, ${name}! 🎉`, 'success');
    });
  },

  // ---- Utility ----
  formatDate(dateStr) {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr + 'T00:00:00');
      return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
      return dateStr;
    }
  }
};


// ================================================
// BOOT
// ================================================
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
