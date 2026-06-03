/* ============================================================
   S2C Cash Sweep Entry — Application JavaScript
   ============================================================ */

// -------------------------------------------------------
// Section Navigation
// -------------------------------------------------------
const sectionLabels = {
  'dashboard': 'Dashboard',
  'input-receipt': 'Step 1 — Input Receipt',
  'data-validation': 'Step 2 — Data Validation',
  'file-prep': 'Step 3 — File Preparation',
  'ap-data': 'Step 4 — AP Data Entry',
  'ar-data': 'Step 5 — AR Validation',
  'sap-workflow': 'Step 6 — SAP Workflow',
  'volume-tracker': 'Volume Tracker',
};

const workflowOrder = ['input-receipt', 'data-validation', 'file-prep', 'ap-data', 'ar-data', 'sap-workflow', 'posted'];
const workflowState = Object.fromEntries(workflowOrder.map(id => [id, 'pending']));
const staticBackendValidation = {
  fileName: 'static_email_reconciliation_backend.json',
  source: 'Backend email capture service',
  emailTotal: 1240500.00,
  fileTotal: 1240500.00,
  status: 'Matched',
  rows: [
    { tabDate: '2026-05-31', emailAmount: 1240500.00, fileAmount: 1240500.00, status: 'Matched' }
  ]
};

function showSection(id, navEl) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const section = document.getElementById('section-' + id);
  if (section) section.classList.add('active');

  if (navEl) navEl.classList.add('active');
  else {
    const item = document.querySelector(`[data-section="${id}"]`);
    if (item) item.classList.add('active');
  }

  const label = sectionLabels[id] || id;
  const bc = document.getElementById('breadcrumbSection');
  if (bc) bc.textContent = label;

  if (workflowOrder.includes(id) && workflowState[id] !== 'completed') {
    setWorkflowStep(id, 'active');
  }
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// -------------------------------------------------------
// Date Display
// -------------------------------------------------------
function updateDate() {
  const el = document.getElementById('currentDate');
  if (el) {
    const now = new Date();
    el.textContent = now.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  }
}

// -------------------------------------------------------
// Toast Notification
// -------------------------------------------------------
let toastTimer = null;
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 3500);
}

function setWorkflowStep(id, state, repaint = true) {
  if (!workflowOrder.includes(id)) return;
  if (state === 'completed') {
    workflowState[id] = 'completed';
    const nextIndex = workflowOrder.indexOf(id) + 1;
    const nextId = workflowOrder[nextIndex];
    if (nextId && workflowState[nextId] !== 'completed') workflowState[nextId] = 'active';
  } else if (state === 'active' && workflowState[id] !== 'completed') {
    workflowOrder.forEach(stepId => {
      if (workflowState[stepId] === 'active') workflowState[stepId] = 'pending';
    });
    workflowState[id] = 'active';
  } else {
    workflowState[id] = state;
  }
  if (repaint) updateProcessFlow();
}

function updateProcessFlow() {
  const steps = document.querySelectorAll('.process-flow .flow-step');
  steps.forEach((step, index) => {
    const id = workflowOrder[index];
    const state = workflowState[id] || 'pending';
    step.classList.remove('completed', 'active', 'pending');
    step.classList.add(state === 'completed' ? 'completed' : state === 'active' ? 'active' : 'pending');
  });
}

// -------------------------------------------------------
// File Upload
// -------------------------------------------------------
function handleDrop(e) {
  e.preventDefault();
  const zone = document.getElementById('uploadZone');
  zone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) processFile(file);
}

function handleDragOver(e) {
  e.preventDefault();
  document.getElementById('uploadZone').classList.add('dragover');
}

function handleDragLeave(e) {
  document.getElementById('uploadZone').classList.remove('dragover');
}

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (file) processFile(file);
}

function processFile(file) {
  const allowed = ['.xlsx', '.xls', '.csv'];
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  if (!allowed.includes(ext)) {
    showToast('Invalid file type. Please upload .xlsx, .xls, or .csv', 'error');
    return;
  }

  // Show file info panel
  document.getElementById('fileName').textContent = file.name;
  document.getElementById('fileSize').textContent = formatFileSize(file.size);
  document.getElementById('fileInfo').style.display = 'flex';
  document.getElementById('uploadZone').style.display = 'none';

  // Update checkpoint statuses
  document.getElementById('check1Status').innerHTML = '<span class="status-indicator pending-ind">Ready to Check</span>';
  document.getElementById('check2Status').innerHTML = '<span class="status-indicator pending-ind">Ready to Check</span>';

  // Only parse CSV files
  if (ext !== '.csv') {
    showToast(`File "${file.name}" uploaded successfully`, 'success');
    return;
  }

  // Read and parse CSV content
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      parseAndPopulateCSV(e.target.result);
      showToast(`File "${file.name}" uploaded & all fields populated!`, 'success');
    } catch(err) {
      showToast(`File uploaded. Could not auto-fill fields: ${err.message}`, 'info');
    }
  };
  reader.readAsText(file);
}

// -------------------------------------------------------
// CSV Parser — reads all sections and fills every field
// -------------------------------------------------------
function parseAndPopulateCSV(raw) {
  const lines = raw.split(/\r?\n/);

  // Detect which section we are currently in
  let section = null;
  // Collected rows per section (arrays of trimmed non-empty, non-header lines)
  const sections = {
    email: [],
    datewise: [],
    colorcode: [],
    ap: [],
    ar: [],
    sap: [],
    fileprep: []
  };

  const sectionMap = {
    'SECTION 1': 'email',
    'SECTION 2': 'datewise',
    'SECTION 3': 'colorcode',
    'SECTION 4': 'ap',
    'SECTION 5': 'ar',
    'SECTION 6': 'sap',
    'SECTION 7': 'fileprep'
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Detect section header lines like "SECTION 1 —..."
    const secMatch = line.match(/SECTION\s+(\d)/i);
    if (secMatch) {
      const key = 'SECTION ' + secMatch[1];
      section = sectionMap[key] || null;
      continue;
    }

    // Skip separator and description lines
    if (line.startsWith('===') || line.startsWith('Use ') || line.startsWith('Copy ') ||
        line.startsWith('Enter ') || line.startsWith('Email Amount must match') || line.startsWith('AR ') ||
        line.startsWith('FIELD,VALUE') || line.startsWith('Color,') ||
        line.startsWith('Tab Date,') || line.startsWith('Date Tab,') ||
        line.startsWith('GRAND TOTAL') || line.startsWith('AP TOTAL') ||
        line.startsWith('AR TOTAL')) {
      continue;
    }

    if (section) {
      sections[section].push(line);
    }
  }

  // ---------- SECTION 1: Email Metadata ----------
  const emailMap = {};
  for (const row of sections.email) {
    const idx = row.indexOf(',');
    if (idx < 0) continue;
    const key = row.substring(0, idx).trim().toLowerCase();
    const val = row.substring(idx + 1).trim();
    emailMap[key] = val;
  }

  if (emailMap['sender']) {
    const senderEl = document.getElementById('emailSender');
    const senderVal = emailMap['sender'].toLowerCase();
    if (senderVal.includes('drew')) senderEl.value = 'drew';
    else if (senderVal.includes('nicole')) senderEl.value = 'nicole';
  }
  if (emailMap['email date']) {
    document.getElementById('emailDate').value = emailMap['email date'];
  }
  if (emailMap['email subject']) {
    document.getElementById('emailSubject').value = emailMap['email subject'];
  }
  if (emailMap['total amount per email body (usd)']) {
    const amt = emailMap['total amount per email body (usd)'].replace(/[^0-9.]/g, '');
    document.getElementById('emailTotalAmount').value = amt;
  }
  if (emailMap['notes']) {
    document.getElementById('emailNotes').value = emailMap['notes'];
  }

  // ---------- SECTION 2: Date-wise Tab Reconciliation ----------
  const tbody = document.getElementById('tabReconBody');
  if (sections.datewise.length > 0) {
    tbody.innerHTML = '';
    for (const row of sections.datewise) {
      const cols = row.split(',');
      if (cols.length < 3) continue;
      const tabDate = (cols[0] || '').trim();
      const emailAmt = (cols[1] || '').trim().replace(/[^0-9.]/g, '');
      const fileAmt  = (cols[2] || '').trim().replace(/[^0-9.]/g, '');
      if (!tabDate || !emailAmt) continue;

      const tr = document.createElement('tr');
      const diff = (parseFloat(fileAmt) - parseFloat(emailAmt)).toFixed(2);
      const isMatch = Math.abs(parseFloat(diff)) < 0.01;
      tr.innerHTML = `
        <td><input type="date" class="table-input" value="${tabDate}" /></td>
        <td><input type="text" class="table-input" value="${emailAmt}" oninput="calcDiff(this)" /></td>
        <td><input type="text" class="table-input" value="${fileAmt}" oninput="calcDiff(this)" /></td>
        <td class="diff-cell"><span class="diff-value ${isMatch ? 'match' : 'mismatch'}">${isMatch ? '✓ Match' : '$' + diff}</span></td>
        <td><span class="badge ${isMatch ? 'badge-green' : 'badge-red'}">${isMatch ? 'Matched' : 'Mismatch'}</span></td>
        <td><button class="btn-icon-danger" onclick="removeTabRow(this)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button></td>
      `;
      tbody.appendChild(tr);
    }
    updateGrandTotals();
  }

  // ---------- SECTION 3: Color-code Subtotals ----------
  const colorMap = { yellow: {}, green: {}, blue: {} };
  for (const row of sections.colorcode) {
    const cols = row.split(',');
    if (cols.length < 3) continue;
    const colorLabel = (cols[0] || '').trim().toLowerCase();
    const fileSum    = (cols[1] || '').trim().replace(/[^0-9.]/g, '');
    const subtotal   = (cols[2] || '').trim().replace(/[^0-9.]/g, '');
    if (colorLabel.includes('yellow')) { colorMap.yellow.file = fileSum; colorMap.yellow.sub = subtotal; }
    if (colorLabel.includes('green'))  { colorMap.green.file  = fileSum; colorMap.green.sub  = subtotal; }
    if (colorLabel.includes('blue'))   { colorMap.blue.file   = fileSum; colorMap.blue.sub   = subtotal; }
  }
  for (const color of ['yellow', 'green', 'blue']) {
    if (colorMap[color].file) {
      const fEl = document.getElementById(color + 'File');
      const sEl = document.getElementById(color + 'Sub');
      if (fEl) { fEl.value = colorMap[color].file; }
      if (sEl) { sEl.value = colorMap[color].sub || colorMap[color].file; }
      verifyColor(color);
    }
  }

  // ---------- SECTION 4: AP Data ----------
  const apBody = document.getElementById('apTableBody');
  if (sections.ap.length > 0) {
    apBody.innerHTML = '';
    for (const row of sections.ap) {
      const cols = row.split(',');
      if (cols.length < 9) continue;
      const [dateTab, compCode, cpDoc, account, amount, pc, partnerPc, text, postKey] = cols.map(c => c.trim());
      if (!dateTab || !compCode) continue;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="date" class="table-input" value="${dateTab}" /></td>
        <td><input type="text" class="table-input" value="${compCode}" maxlength="4" style="text-transform:uppercase" /></td>
        <td><input type="text" class="table-input" value="${cpDoc}" /></td>
        <td><input type="text" class="table-input" value="${account}" /></td>
        <td><input type="text" class="table-input" value="${amount}" oninput="updateAPTotal()" /></td>
        <td><input type="text" class="table-input" value="${pc}" /></td>
        <td><input type="text" class="table-input" value="${partnerPc}" /></td>
        <td><input type="text" class="table-input" value="${text}" /></td>
        <td>
          <select class="table-select">
            <option ${postKey === '31' ? 'selected' : ''}>31</option>
            <option ${postKey === '40' ? 'selected' : ''}>40</option>
            <option ${postKey === '50' ? 'selected' : ''}>50</option>
            <option ${postKey === '21' ? 'selected' : ''}>21</option>
          </select>
        </td>
        <td><button class="btn-icon-danger" onclick="removeRow(this)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button></td>
      `;
      apBody.appendChild(tr);
    }
    updateAPTotal();
  }

  // ---------- SECTION 5: AR Data ----------
  const arBody = document.getElementById('arTableBody');
  if (sections.ar.length > 0) {
    arBody.innerHTML = '';
    for (const row of sections.ar) {
      const cols = row.split(',');
      if (cols.length < 9) continue;
      const [dateTab, company, cpNum, account, amount, taxCode, acctType, pc, text] = cols.map(c => c.trim());
      if (!dateTab || !company) continue;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="date" class="table-input" value="${dateTab}" /></td>
        <td><input type="text" class="table-input" value="${company}" /></td>
        <td><input type="text" class="table-input" value="${cpNum}" /></td>
        <td><input type="text" class="table-input" value="${account}" /></td>
        <td><input type="text" class="table-input" value="${amount}" /></td>
        <td><input type="text" class="table-input" value="${taxCode}" style="width:80px" /></td>
        <td>
          <select class="table-select">
            <option value="D" ${acctType === 'D' ? 'selected' : ''}>D - Customer</option>
            <option value="K" ${acctType === 'K' ? 'selected' : ''}>K - Vendor</option>
          </select>
        </td>
        <td><input type="text" class="table-input" value="${pc}" /></td>
        <td><input type="text" class="table-input" value="${text}" /></td>
        <td>
          <label class="toggle-wrap">
            <input type="checkbox" class="toggle-input" onchange="updateARValidation(this)" />
            <span class="toggle-slider"></span>
          </label>
        </td>
        <td><button class="btn-icon-danger" onclick="removeRow(this)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button></td>
      `;
      arBody.appendChild(tr);
    }
  }

  // ---------- SECTION 6: SAP Header ----------
  const sapMap = {};
  for (const row of sections.sap) {
    const idx = row.indexOf(',');
    if (idx < 0) continue;
    const key = row.substring(0, idx).trim().toLowerCase();
    const val = row.substring(idx + 1).trim();
    sapMap[key] = val;
  }
  if (sapMap['document date'])    document.getElementById('docDate').value = sapMap['document date'];
  if (sapMap['translation date']) document.getElementById('translationDate').value = sapMap['translation date'];
  if (sapMap['posting date'])     document.getElementById('postingDate').value = sapMap['posting date'];
  if (sapMap['currency'])         document.getElementById('currency').value = sapMap['currency'];
  if (sapMap['company code'])     document.getElementById('companyCode').value = sapMap['company code'];
  if (sapMap['reference #'])      document.getElementById('refNum').value = sapMap['reference #'];
  if (sapMap['document header text']) document.getElementById('docHeaderText').value = sapMap['document header text'];

  // ---------- SECTION 7: File Preparation ----------
  const fpMap = {};
  for (const row of sections.fileprep) {
    const idx = row.indexOf(',');
    if (idx < 0) continue;
    const key = row.substring(0, idx).trim().toLowerCase();
    const val = row.substring(idx + 1).trim();
    fpMap[key] = val;
  }
  if (fpMap['current month']) {
    const monthNames = { january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',
      july:'07',august:'08',september:'09',october:'10',november:'11',december:'12' };
    const mKey = fpMap['current month'].toLowerCase();
    const mVal = monthNames[mKey];
    if (mVal) document.getElementById('fileMonth').value = mVal;
  }
  if (fpMap['current year']) {
    document.getElementById('fileYear').value = fpMap['current year'];
  }
  if (fpMap['source folder path']) {
    document.getElementById('folderPath').value = fpMap['source folder path'];
  }
  updateFileName();
  setWorkflowStep('input-receipt', 'completed');
}

function clearFile() {
  document.getElementById('fileInput').value = '';
  document.getElementById('fileInfo').style.display = 'none';
  document.getElementById('uploadZone').style.display = 'block';
  document.getElementById('check1Status').innerHTML = '<span class="status-indicator pending-ind">Awaiting File</span>';
  document.getElementById('check2Status').innerHTML = '<span class="status-indicator pending-ind">Awaiting File</span>';
  showToast('File removed', 'info');
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// -------------------------------------------------------
// Calculation Helpers (Added for CSV Auto-fill)
// -------------------------------------------------------
function calcDiff(input) {
  const tr = input.closest('tr');
  const inputs = tr.querySelectorAll('input[type="text"]');
  if (inputs.length < 2) return;
  const emailAmt = parseFloat(inputs[0].value.replace(/[^0-9.-]/g, '')) || 0;
  const fileAmt = parseFloat(inputs[1].value.replace(/[^0-9.-]/g, '')) || 0;
  const diff = fileAmt - emailAmt;
  const isMatch = Math.abs(diff) < 0.01;

  const diffCell = tr.querySelector('.diff-value');
  if (diffCell) {
    diffCell.className = `diff-value ${isMatch ? 'match' : 'mismatch'}`;
    diffCell.textContent = isMatch ? '✓ Match' : '$' + diff.toFixed(2);
  }
  const badge = tr.querySelector('.badge');
  if (badge) {
    badge.className = `badge ${isMatch ? 'badge-green' : 'badge-red'}`;
    badge.textContent = isMatch ? 'Matched' : 'Mismatch';
  }
  document.querySelectorAll('#tabReconBody tr').forEach(row => {
    const amountInput = row.querySelectorAll('.table-input')[1];
    if (amountInput) calcDiff(amountInput);
  });
}

function updateGrandTotals() {
  const tbody = document.getElementById('tabReconBody');
  if (!tbody) return;
  let emailTotal = 0;
  let fileTotal = 0;
  tbody.querySelectorAll('tr').forEach(tr => {
    const inputs = tr.querySelectorAll('input[type="text"]');
    if (inputs.length >= 2) {
      emailTotal += parseFloat(inputs[0].value.replace(/[^0-9.-]/g, '')) || 0;
      fileTotal += parseFloat(inputs[1].value.replace(/[^0-9.-]/g, '')) || 0;
    }
  });

  const emailEl = document.getElementById('emailGrandTotal');
  const fileEl = document.getElementById('fileGrandTotal');
  const diffEl = document.getElementById('grandDiff');
  
  if (emailEl) emailEl.textContent = formatCurrency(emailTotal);
  if (fileEl) fileEl.textContent = formatCurrency(fileTotal);
  
  if (diffEl) {
    const diff = fileTotal - emailTotal;
    const isMatch = Math.abs(diff) < 0.01;
    diffEl.className = isMatch ? 'match' : 'mismatch';
    diffEl.style.color = isMatch ? 'var(--success)' : 'var(--danger)';
    diffEl.textContent = isMatch ? '✓ Balanced' : '$' + diff.toFixed(2);
  }
}

function removeTabRow(btn) {
  btn.closest('tr').remove();
  updateGrandTotals();
}

function verifyColor(color) {
  const fileEl = document.getElementById(color + 'File');
  const subEl = document.getElementById(color + 'Sub');
  const statusEl = document.getElementById(color + 'Status');
  if (!fileEl || !subEl || !statusEl) return;
  
  const fileAmt = parseFloat(fileEl.value.replace(/[^0-9.-]/g, '')) || 0;
  const subAmt = parseFloat(subEl.value.replace(/[^0-9.-]/g, '')) || 0;
  const isMatch = Math.abs(fileAmt - subAmt) < 0.01;
  
  if (fileEl.value === '' || subEl.value === '') {
    statusEl.className = 'badge badge-gray';
    statusEl.textContent = 'Pending';
  } else if (isMatch) {
    statusEl.className = 'badge badge-green';
    statusEl.textContent = 'Values Match';
  } else {
    statusEl.className = 'badge badge-red';
    statusEl.textContent = 'Mismatch';
  }
}

function updateAPTotal() {
  const tbody = document.getElementById('apTableBody');
  if (!tbody) return;
  let total = 0;
  tbody.querySelectorAll('tr').forEach(tr => {
    // Amount is the 5th input (index 4)
    const inputs = tr.querySelectorAll('input[type="text"]');
    if (inputs.length >= 4) {
      // Find the input that holds the amount. Account is 3, Amount is 4.
      // Actually, there are 2 date/text inputs before the text inputs. Let's just grab the 4th text input.
      const amtInput = inputs[3];
      if (amtInput) {
        total += parseFloat(amtInput.value.replace(/[^0-9.-]/g, '')) || 0;
      }
    }
  });
  const totalEl = document.getElementById('apTotal');
  if (totalEl) totalEl.textContent = formatCurrency(total);
}

// -------------------------------------------------------
// Input Receipt
// -------------------------------------------------------
function saveInputReceipt() {
  const sender = document.getElementById('emailSender').value;
  const date = document.getElementById('emailDate').value;
  const amount = document.getElementById('emailTotalAmount').value;

  if (!sender) { showToast('Please select a sender', 'error'); return; }
  if (!date) { showToast('Please enter the email date', 'error'); return; }
  if (!amount) { showToast('Please enter the total amount from email', 'error'); return; }

  showToast('Input receipt saved! Proceed to Data Validation.', 'success');
  setWorkflowStep('input-receipt', 'completed');
  setTimeout(() => {
    showSection('data-validation', document.querySelector('[data-section=data-validation]'));
  }, 1200);
}

// -------------------------------------------------------
// Validation Checks
// -------------------------------------------------------
function runCheck1() {
  const fileInfo = document.getElementById('fileInfo');
  if (fileInfo.style.display === 'none' || fileInfo.style.display === '') {
    showToast('Please upload an input file first', 'error');
    return;
  }
  // Simulate check
  setTimeout(() => {
    const pass = Math.random() > 0.2;
    const el = document.getElementById('check1Status');
    if (pass) {
      el.innerHTML = '<span class="status-indicator pass-ind">✓ Check Passed</span>';
      showToast('Check 1: Date-wise tab totals match ✓', 'success');
    } else {
      el.innerHTML = '<span class="status-indicator fail-ind">✗ Mismatch Found</span>';
      showToast('Check 1: Amount mismatch detected — review required', 'error');
    }
  }, 800);
}

function runCheck2() {
  const fileInfo = document.getElementById('fileInfo');
  if (fileInfo.style.display === 'none' || fileInfo.style.display === '') {
    showToast('Please upload an input file first', 'error');
    return;
  }
  setTimeout(() => {
    const pass = Math.random() > 0.2;
    const el = document.getElementById('check2Status');
    if (pass) {
      el.innerHTML = '<span class="status-indicator pass-ind">✓ Check Passed</span>';
      showToast('Check 2: Color-coded subtotals match ✓', 'success');
    } else {
      el.innerHTML = '<span class="status-indicator fail-ind">✗ Mismatch Found</span>';
      showToast('Check 2: Subtotal mismatch — review highlighted areas', 'error');
    }
  }, 800);
}

// -------------------------------------------------------
// Data Validation — Tab Reconciliation
// -------------------------------------------------------
function addTabRow() {
  const tbody = document.getElementById('tabReconBody');
  const row = document.createElement('tr');
  row.innerHTML = `
    <td><input type="date" class="table-input" /></td>
    <td><input type="text" class="table-input" placeholder="0.00" oninput="calcDiff(this)" /></td>
    <td><input type="text" class="table-input" placeholder="0.00" oninput="calcDiff(this)" /></td>
    <td class="diff-cell"><span class="diff-value">—</span></td>
    <td><span class="badge badge-yellow">Pending</span></td>
    <td><button class="btn-icon-danger" onclick="removeTabRow(this)">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button></td>
  `;
  tbody.appendChild(row);
}

function removeTabRow(btn) {
  btn.closest('tr').remove();
  updateGrandTotals();
}

function calcDiff(input) {
  const row = input.closest('tr');
  const inputs = row.querySelectorAll('.table-input');
  const emailAmt = parseFloat(inputs[1].value.replace(/,/g, '')) || 0;
  const fileAmt = parseFloat(inputs[2].value.replace(/,/g, '')) || 0;
  const diff = fileAmt - emailAmt;
  const diffEl = row.querySelector('.diff-value');
  const statusEl = row.querySelector('.badge');

  if (inputs[1].value && inputs[2].value) {
    const isMatch = Math.abs(diff) < 0.01;
    diffEl.textContent = isMatch ? '✓ Match' : formatCurrency(diff);
    diffEl.className = `diff-value ${isMatch ? 'match' : 'mismatch'}`;
    statusEl.className = `badge ${isMatch ? 'badge-green' : 'badge-red'}`;
    statusEl.textContent = isMatch ? 'Matched' : 'Mismatch';
  }
  updateGrandTotals();
}

function updateGrandTotals() {
  const rows = document.querySelectorAll('#tabReconBody tr');
  let emailTotal = 0, fileTotal = 0;
  rows.forEach(row => {
    const inputs = row.querySelectorAll('.table-input');
    emailTotal += parseFloat(inputs[1]?.value?.replace(/,/g, '')) || 0;
    fileTotal += parseFloat(inputs[2]?.value?.replace(/,/g, '')) || 0;
  });
  document.getElementById('grandTotalEmail').textContent = formatCurrency(emailTotal);
  document.getElementById('grandTotalFile').textContent = formatCurrency(fileTotal);
}

// -------------------------------------------------------
// Color Code Verification
// -------------------------------------------------------
function verifyColor(color) {
  const fileVal = parseFloat(document.getElementById(color + 'File').value.replace(/,/g, '')) || 0;
  const subVal = parseFloat(document.getElementById(color + 'Sub').value.replace(/,/g, '')) || 0;
  const resultEl = document.getElementById(color + 'Result');

  if (fileVal && subVal) {
    const match = Math.abs(fileVal - subVal) < 0.01;
    resultEl.textContent = match ? '✓ Values Match' : `✗ Difference: ${formatCurrency(Math.abs(fileVal - subVal))}`;
    resultEl.style.color = match ? 'var(--success)' : 'var(--danger)';
    resultEl.style.background = match ? 'var(--success-soft)' : 'var(--danger-soft)';
  } else {
    resultEl.textContent = '—';
    resultEl.style.color = '';
    resultEl.style.background = '';
  }
}

function markValidationComplete() {
  showToast('Data Validation marked complete! Proceeding to File Preparation.', 'success');
  setWorkflowStep('data-validation', 'completed');
  setTimeout(() => {
    showSection('file-prep', document.querySelector('[data-section=file-prep]'));
  }, 1200);
}

function loadStaticValidationDemo() {
  const tbody = document.getElementById('tabReconBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  staticBackendValidation.rows.forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="date" class="table-input" value="${row.tabDate}" /></td>
      <td><input type="text" class="table-input" value="${row.emailAmount.toFixed(2)}" oninput="calcDiff(this)" /></td>
      <td><input type="text" class="table-input" value="${row.fileAmount.toFixed(2)}" oninput="calcDiff(this)" /></td>
      <td class="diff-cell"><span class="diff-value match">✓ Match</span></td>
      <td><span class="badge badge-green">${row.status}</span></td>
      <td><button class="btn-icon-danger" onclick="removeTabRow(this)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button></td>
    `;
    tbody.appendChild(tr);
  });

  const sub = document.getElementById('backendValidationSub');
  const status = document.getElementById('backendValidationStatus');
  if (sub) sub.textContent = `${staticBackendValidation.fileName} reconciled email body total ${formatCurrency(staticBackendValidation.emailTotal)} with file total ${formatCurrency(staticBackendValidation.fileTotal)}.`;
  if (status) {
    status.className = 'badge badge-green';
    status.textContent = 'Matched';
  }
  updateGrandTotals();
  showToast('Static backend validation file reconciled with email body.', 'success');
}

// -------------------------------------------------------
// File Preparation
// -------------------------------------------------------
function updateFileName() {
  const month = document.getElementById('fileMonth').value;
  const year = document.getElementById('fileYear').value;
  const name = `CSP_IC_Invoice_${year}_${month}.xlsx`;
  document.getElementById('generatedFileName').textContent = name;

  // Previous month
  let prevMonth = parseInt(month) - 1;
  let prevYear = parseInt(year);
  if (prevMonth === 0) { prevMonth = 12; prevYear--; }
  const prevName = `CSP_IC_Invoice_${prevYear}_${String(prevMonth).padStart(2, '0')}.xlsx`;
  document.getElementById('prevFileName').value = prevName;
}

function copyFileName() {
  const name = document.getElementById('generatedFileName').textContent;
  navigator.clipboard.writeText(name).then(() => {
    showToast('File name copied to clipboard!', 'success');
  }).catch(() => {
    showToast('File name: ' + name, 'info');
  });
}

function confirmFilePrepared() {
  const chks = document.querySelectorAll('.checklist-check');
  const allChecked = Array.from(chks).every(c => c.checked);
  if (!allChecked) {
    showToast('Please complete all checklist items before proceeding', 'error');
    return;
  }
  showToast('File preparation confirmed! Proceed to AP Data Entry.', 'success');
  setWorkflowStep('file-prep', 'completed');
  setTimeout(() => {
    showSection('ap-data', document.querySelector('[data-section=ap-data]'));
  }, 1200);
}

// -------------------------------------------------------
// AP Data Table
// -------------------------------------------------------
function addAPRow() {
  const tbody = document.getElementById('apTableBody');
  const row = document.createElement('tr');
  row.innerHTML = `
    <td><input type="date" class="table-input" /></td>
    <td><input type="text" class="table-input" placeholder="e.g. US01" maxlength="4" style="text-transform:uppercase" /></td>
    <td><input type="text" class="table-input" placeholder="Doc #" /></td>
    <td><input type="text" class="table-input" placeholder="Account #" /></td>
    <td><input type="text" class="table-input" placeholder="0.00" oninput="updateAPTotal()" /></td>
    <td><input type="text" class="table-input" placeholder="Profit Ctr" /></td>
    <td><input type="text" class="table-input" placeholder="Partner PC" /></td>
    <td><input type="text" class="table-input" placeholder="Text" /></td>
    <td>
      <select class="table-select">
        <option>31</option><option>40</option><option>50</option><option>21</option>
      </select>
    </td>
    <td><button class="btn-icon-danger" onclick="removeRow(this)">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button></td>
  `;
  tbody.appendChild(row);
}

function updateAPTotal() {
  let total = 0;
  document.querySelectorAll('#apTableBody tr').forEach(row => {
    const amtInput = row.querySelectorAll('.table-input')[4];
    if (amtInput) total += parseFloat(amtInput.value.replace(/,/g, '')) || 0;
  });
  document.getElementById('apTotal').textContent = formatCurrency(total);
}

function updateARTotal() {
  let total = 0;
  document.querySelectorAll('#arTableBody tr').forEach(row => {
    const amtInput = row.querySelectorAll('.table-input')[4];
    if (amtInput) total += parseFloat(amtInput.value.replace(/,/g, '')) || 0;
  });
  const totalEl = document.getElementById('arTotal');
  if (totalEl) totalEl.textContent = formatCurrency(total);
}

function saveAPData() {
  const rows = document.querySelectorAll('#apTableBody tr');
  let valid = true;
  rows.forEach(row => {
    const inputs = row.querySelectorAll('.table-input');
    if (!inputs[1]?.value || !inputs[4]?.value) valid = false;
  });
  if (!valid) { showToast('Please fill in all required AP fields (Company Code & Amount)', 'error'); return; }
  syncFromAP(false);
  setWorkflowStep('ap-data', 'completed');
  showToast('AP Data saved. AR data prepared from AP tab.', 'success');
  setTimeout(() => {
    showSection('ar-data', document.querySelector('[data-section=ar-data]'));
  }, 900);
}

function syncFromAP(showMessage = true) {
  const apRows = document.querySelectorAll('#apTableBody tr');
  const arBody = document.getElementById('arTableBody');
  arBody.innerHTML = '';

  apRows.forEach(apRow => {
    const inputs = apRow.querySelectorAll('.table-input');
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><input type="date" class="table-input" value="${inputs[0]?.value || ''}" /></td>
      <td><input type="text" class="table-input" value="${inputs[1]?.value || ''}" /></td>
      <td><input type="text" class="table-input" value="${inputs[2]?.value || ''}" /></td>
      <td><input type="text" class="table-input" value="140010" placeholder="Account #" /></td>
      <td><input type="text" class="table-input" value="${inputs[4]?.value || ''}" placeholder="0.00" /></td>
      <td><input type="text" class="table-input" value="O1" placeholder="Tax Code" style="width:80px" /></td>
      <td>
        <select class="table-select">
          <option value="D" selected>D - Customer</option>
          <option value="K">K - Vendor</option>
        </select>
      </td>
      <td><input type="text" class="table-input" value="${inputs[5]?.value || 'PC1001'}" placeholder="PC" /></td>
      <td><input type="text" class="table-input" value="${inputs[7]?.value || ''}" /></td>
      <td>
        <label class="toggle-wrap">
          <input type="checkbox" class="toggle-input" onchange="updateARValidation(this)" />
          <span class="toggle-slider"></span>
        </label>
      </td>
      <td><button class="btn-icon-danger" onclick="removeRow(this)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button></td>
    `;
    arBody.appendChild(row);
  });
  updateARTotal();
  if (showMessage) showToast('AR data synced from AP tab', 'success');
}

// -------------------------------------------------------
// AR Data Table
// -------------------------------------------------------
function addARRow() {
  const tbody = document.getElementById('arTableBody');
  const row = document.createElement('tr');
  row.innerHTML = `
    <td><input type="date" class="table-input" /></td>
    <td><input type="text" class="table-input" placeholder="Company" /></td>
    <td><input type="text" class="table-input" placeholder="Counterpart #" /></td>
    <td><input type="text" class="table-input" placeholder="Account #" /></td>
    <td><input type="text" class="table-input" placeholder="0.00" /></td>
    <td><input type="text" class="table-input" placeholder="Tax Code" style="width:80px" /></td>
    <td>
      <select class="table-select">
        <option value="D">D - Customer</option>
        <option value="K">K - Vendor</option>
      </select>
    </td>
    <td><input type="text" class="table-input" placeholder="PC" /></td>
    <td><input type="text" class="table-input" placeholder="Text" /></td>
    <td>
      <label class="toggle-wrap">
        <input type="checkbox" class="toggle-input" onchange="updateARValidation(this)" />
        <span class="toggle-slider"></span>
      </label>
    </td>
    <td><button class="btn-icon-danger" onclick="removeRow(this)">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button></td>
  `;
  tbody.appendChild(row);
}

function updateARValidation(checkbox) {
  const row = checkbox.closest('tr');
  if (checkbox.checked) {
    row.style.background = 'var(--success-soft)';
    row.style.borderColor = 'var(--success)';
  } else {
    row.style.background = '';
    row.style.borderColor = '';
  }
}

function saveARData() {
  updateARTotal();
  setWorkflowStep('ar-data', 'completed');
  showToast('AR Data saved! Proceed to SAP Workflow.', 'success');
  setTimeout(() => {
    showSection('sap-workflow', document.querySelector('[data-section=sap-workflow]'));
  }, 1200);
}

// -------------------------------------------------------
// SAP Workflow Steps
// -------------------------------------------------------
let completedSteps = new Set();

function completeStep(stepNum) {
  const stepEl = document.getElementById('wf' + stepNum);
  if (stepEl) {
    stepEl.classList.add('done');
    completedSteps.add(stepNum);

    const btn = stepEl.querySelector('.wf-btn');
    if (btn && stepNum !== 7) {
      btn.textContent = '✓ Done';
      btn.style.background = 'var(--success)';
      btn.style.color = 'white';
      btn.style.borderColor = 'var(--success)';
    }
  }

  if (stepNum === 7) {
    const sapNum = document.getElementById('sapDocNum').value;
    if (!sapNum) {
      showToast('Please enter the SAP Document Number before posting', 'error');
      completedSteps.delete(7);
      if (stepEl) stepEl.classList.remove('done');
      return;
    }
    showToast(`Transaction posted! SAP Doc #: ${sapNum}`, 'success');
    document.getElementById('workflowComplete').style.display = 'flex';
    setWorkflowStep('sap-workflow', 'completed');
    setWorkflowStep('posted', 'completed');
  } else {
    const messages = {
      1: 'SAP S/4 PR3 logged in ✓',
      2: 'Document header entered ✓',
      3: 'Transfer Posting with Clearing checked ✓',
      4: 'First line item (AP) entered ✓',
      5: 'Vendor open items cleared ✓',
      6: 'AR tab processing complete ✓',
    };
    showToast(messages[stepNum] || `Step ${stepNum} completed`, 'success');
  }
}

// -------------------------------------------------------
// Utility
// -------------------------------------------------------
function removeRow(btn) {
  btn.closest('tr').remove();
  updateAPTotal();
}

function formatAmount(input) {
  // Allow only numbers and decimal
  let val = input.value.replace(/[^0-9.]/g, '');
  input.value = val;
}

function formatCurrency(amount) {
  return '$' + amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function exportData() {
  const rows = [
    ['#', 'Entry Date', 'Company', 'Counterpart', 'AP Amount', 'AR Amount', 'SAP Doc #', 'Posted By', 'Status'],
  ];
  document.querySelectorAll('#volumeTable tbody tr').forEach((tr, i) => {
    const cells = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim());
    rows.push(cells);
  });
  const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'S2C_CashSweep_June2026.csv';
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exported successfully!', 'success');
}

// -------------------------------------------------------
// SAP Header — auto-fill today's posting date
// -------------------------------------------------------
function initSAPDates() {
  const today = new Date().toISOString().split('T')[0];
  const postingDate = document.getElementById('postingDate');
  if (postingDate && !postingDate.value) postingDate.value = today;
}

// -------------------------------------------------------
// Init
// -------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  updateDate();
  updateFileName();
  initSAPDates();
  updateGrandTotals();
  ['yellow', 'green', 'blue'].forEach(verifyColor);
  updateAPTotal();
  updateARTotal();
  updateProcessFlow();

  // Set initials in SAP Reference field
  const refInput = document.getElementById('refNum');
  if (refInput) refInput.placeholder = 'e.g. SB';

  // Animate KPI values
  document.querySelectorAll('.kpi-value').forEach(el => {
    const target = parseInt(el.textContent);
    if (!isNaN(target)) {
      let current = 0;
      const step = target / 20;
      const timer = setInterval(() => {
        current = Math.min(current + step, target);
        el.textContent = Math.round(current);
        if (current >= target) clearInterval(timer);
      }, 40);
    }
  });

  // Close sidebar on outside click (mobile)
  document.querySelector('.main-content').addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar');
    if (sidebar.classList.contains('open') && window.innerWidth < 900) {
      sidebar.classList.remove('open');
    }
  });
});
