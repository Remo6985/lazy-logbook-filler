// ==UserScript==
// @name         BINUS Logbook Filler
// @namespace    local.lazy-logbook-filler
// @version      0.1.2
// @description  Fill visible internship logbook entries from pasted Excel rows.
// @match        https://activity-enrichment.apps.binus.ac.id/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  if (window.__llf) {
    window.__llf.show();
    return;
  }

  const CONFIG = {
    delayMs: 5000,
    modalTimeoutMs: 12000,
    clockTimeoutMs: 8000,
    saveTimeoutMs: 30000,
  };
  const MONTHS = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
    apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
    aug: 8, august: 8, sep: 9, sept: 9, september: 9,
    oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  };
  const ERROR_RE = /must not|not found|cannot be longer|only one|failed|error|invalid|exception|gagal/i;

  let running = false;
  let stopRequested = false;
  let panel;
  let launcher;
  let statusEl;
  let logEl;
  let textarea;
  let delayInput;
  let dryBtn;
  let startBtn;
  let stopBtn;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clean = (value) => String(value == null ? '' : value).replace(/\r/g, '').trim();
  const oneLine = (value) => clean(value).replace(/\s+/g, ' ');
  const isVisible = (el) => {
    if (!el || !el.isConnected) return false;
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 &&
      style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  };

  function setStatus(message, kind = 'info') {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.dataset.kind = kind;
  }

  function log(message) {
    if (!logEl) return;
    const line = document.createElement('div');
    line.className = 'llf-log-line';
    line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function clearLog() {
    if (logEl) logEl.textContent = '';
  }

  function updateButtons() {
    if (!dryBtn) return;
    dryBtn.disabled = running;
    startBtn.disabled = running;
    stopBtn.disabled = !running;
    textarea.disabled = running;
    delayInput.disabled = running;
    if (launcher) {
      launcher.classList.toggle('llf-running', running);
      launcher.setAttribute('aria-label', running ? 'Open logbook filler, running' : 'Open logbook filler');
      launcher.title = running ? 'Logbook filler is running' : 'Open logbook filler';
    }
  }

  function configuredDelayMs() {
    if (String(delayInput.value).trim() === '') return CONFIG.delayMs;
    const value = Number(delayInput.value);
    if (!Number.isFinite(value) || value < 0) return CONFIG.delayMs;
    return Math.min(value, 300) * 1000;
  }

  function parseIsoDate(value) {
    const text = clean(value);
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return `${match[1]}-${match[2]}-${match[3]}`;
  }

  function parsePageDate(value) {
    const text = oneLine(value);
    const match = text.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\b/);
    if (!match) return null;
    const month = MONTHS[match[2].toLowerCase()];
    if (!month) return null;
    const year = Number(match[3]);
    const day = Number(match[1]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function parseDelimited(text) {
    const raw = String(text == null ? '' : text).replace(/^\uFEFF/, '');
    const delimiter = raw.includes('\t') ? '\t' : ',';
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;

    for (let index = 0; index < raw.length; index += 1) {
      const char = raw[index];
      if (quoted) {
        if (char === '"' && raw[index + 1] === '"') {
          field += '"';
          index += 1;
        } else if (char === '"') {
          quoted = false;
        } else {
          field += char;
        }
        continue;
      }
      if (char === '"' && field === '') {
        quoted = true;
      } else if (char === delimiter) {
        row.push(field);
        field = '';
      } else if (char === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else if (char !== '\r') {
        field += char;
      }
    }
    if (field !== '' || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter((cells) => cells.some((cell) => clean(cell) !== ''));
  }

  function parseData(text) {
    const rows = parseDelimited(text);
    if (!rows.length) return { entries: new Map(), errors: ['Paste Date, Activity, Description from Excel first.'] };

    const first = rows[0].map((cell) => clean(cell).toLowerCase());
    const hasHeader = first[0].includes('date') || first[1] === 'activity' || first[2] === 'description';
    const entries = new Map();
    const errors = [];
    const start = hasHeader ? 1 : 0;

    for (let index = start; index < rows.length; index += 1) {
      const cells = rows[index];
      const rowNumber = index + 1;
      const date = parseIsoDate(cells[0]);
      const activity = clean(cells[1]);
      const description = String(cells[2] == null ? '' : cells[2]).trim();
      const bothBlank = !activity && !description;

      if (!date) {
        errors.push(`Row ${rowNumber}: date must be YYYY-MM-DD.`);
        continue;
      }
      if (entries.has(date)) {
        errors.push(`Row ${rowNumber}: duplicate date ${date}.`);
        continue;
      }
      if (bothBlank) {
        entries.set(date, { date, empty: true, off: false, activity: '', description: '' });
        continue;
      }

      const activityOff = activity.toUpperCase() === 'OFF';
      const descriptionOff = description.toUpperCase() === 'OFF';
      if (activityOff !== descriptionOff) {
        errors.push(`Row ${rowNumber}: Activity and Description must both be OFF.`);
        continue;
      }
      if (activityOff) {
        entries.set(date, { date, empty: false, off: true, activity: 'OFF', description: 'OFF' });
        continue;
      }
      if (!activity) {
        errors.push(`Row ${rowNumber}: Activity is empty.`);
        continue;
      }
      if (!description) {
        errors.push(`Row ${rowNumber}: Description is empty.`);
        continue;
      }
      if (activity.length > 255) {
        errors.push(`Row ${rowNumber}: Activity is longer than 255 characters.`);
        continue;
      }
      entries.set(date, { date, empty: false, off: false, activity, description });
    }

    return { entries, errors };
  }

  function getTable() {
    const direct = document.querySelector('#logBookTable');
    if (direct) return direct;
    return Array.from(document.querySelectorAll('table')).find((table) => {
      const text = oneLine(table.innerText).toUpperCase();
      return text.includes('DATE') && text.includes('ACTIVITY') && text.includes('ACTION');
    }) || null;
  }

  function entryButtonFor(row) {
    return Array.from(row.querySelectorAll('button, input[type=button], a')).find((el) => {
      if (el.disabled) return false;
      const text = oneLine(el.innerText || el.value || '');
      return text.toUpperCase() === 'ENTRY';
    }) || null;
  }

  function rowInfo(row) {
    const cells = Array.from(row.cells || []);
    if (!cells.length) return null;
    const dateText = oneLine(cells[0].innerText);
    const date = parsePageDate(dateText);
    if (!date) return null;
    const action = oneLine(cells[cells.length - 1].innerText);
    const button = entryButtonFor(row);
    return {
      row,
      date,
      dateText,
      action,
      entryButton: button,
      acceptance: cells.length > 1 ? oneLine(cells[cells.length - 2].innerText) : '',
    };
  }

  function scanRows() {
    const table = getTable();
    if (!table) return { table: null, rows: [], error: 'Logbook table not found. Open the November logbook.' };
    return {
      table,
      rows: Array.from(table.querySelectorAll('tbody tr')).map(rowInfo).filter(Boolean),
      error: null,
    };
  }

  function findRowByDate(date) {
    const table = getTable();
    if (!table) return null;
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    for (const row of rows) {
      const info = rowInfo(row);
      if (info && info.date === date) return info;
    }
    return null;
  }

  function getDialog() {
    return document.querySelector('#logBookEditPopup');
  }

  function field(id) {
    return document.getElementById(id);
  }

  function modalControl(text) {
    const dialog = getDialog();
    if (!dialog) return null;
    const wanted = text.toLowerCase();
    return Array.from(dialog.querySelectorAll('a-encoded, button, a, [role=button]')).find((el) => {
      if (!isVisible(el) || el.disabled) return false;
      return oneLine(el.innerText || el.value || '').toLowerCase() === wanted;
    }) || null;
  }

  function modalDate() {
    const el = field('editDate');
    if (!el) return null;
    let value = '';
    if (window.jQuery) value = String(window.jQuery(el).val() || '');
    if (!value) value = String(el.value || '');
    if (!value) return null;
    return parseIsoDate(value) || parsePageDate(value);
  }

  function setNativeValue(el, value) {
    if (!el) throw new Error('Field not found.');
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function closeDialog() {
    const dialog = getDialog();
    if (!dialog || !isVisible(dialog)) return true;
    for (const target of [document, window]) {
      target.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true,
      }));
    }
    if (window.jQuery && window.jQuery.fancybox && typeof window.jQuery.fancybox.close === 'function') {
      try { window.jQuery.fancybox.close(); } catch (error) { /* ignore */ }
    }
    const wasHidden = !isVisible(dialog);
    if (wasHidden) return true;
    dialog.style.display = 'none';
    return !isVisible(dialog);
  }

  function preparePlan() {
    const parsed = parseData(textarea.value);
    const scan = scanRows();
    if (scan.error) {
      return { errors: [scan.error], targets: [], missing: [], rows: [], available: [] };
    }
    if (!parsed.entries.size && parsed.errors.length) {
      return { errors: parsed.errors, targets: [], missing: [], rows: scan.rows, available: [] };
    }

    const targets = [];
    const missing = [];
    for (const info of scan.rows) {
      if (!info.entryButton) continue;
      const data = parsed.entries.get(info.date);
      if (!data || data.empty) {
        missing.push(info);
        continue;
      }
      targets.push({
        date: info.date,
        dateText: info.dateText,
        mode: data.off ? 'off' : 'entry',
        activity: data.activity,
        description: data.description,
      });
    }
    targets.sort((a, b) => a.date.localeCompare(b.date));

    return {
      errors: parsed.errors,
      targets,
      missing,
      rows: scan.rows,
      available: scan.rows.filter((info) => !!info.entryButton),
    };
  }

  function reportPlan(plan) {
    clearLog();
    log(`Page rows: ${plan.rows.length}. Visible ENTRY buttons: ${plan.available.length}.`);
    if (plan.missing.length) {
      log(`No data for: ${plan.missing.map((info) => info.date).join(', ')}. These will be skipped.`);
    }
    for (const target of plan.targets) {
      log(`READY ${target.date} [${target.mode.toUpperCase()}] ${oneLine(target.activity).slice(0, 72)}`);
    }
    if (!plan.targets.length) log('No matching rows are ready to fill.');
  }

  async function waitFor(check, timeoutMs, label) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = check();
      if (result) return result;
      await sleep(150);
    }
    throw new Error(`Timed out waiting for ${label}.`);
  }

  async function waitForSave(date, alerts) {
    const deadline = Date.now() + CONFIG.saveTimeoutMs;
    while (Date.now() < deadline) {
      const error = alerts.find((message) => ERROR_RE.test(message));
      if (error) throw new Error(`Site rejected the save: ${oneLine(error)}`);

      const current = findRowByDate(date);
      if (current && !current.entryButton) {
        if (getDialog() && isVisible(getDialog())) closeDialog();
        return;
      }
      await sleep(250);
    }
    const last = alerts.length ? ` Last message: ${oneLine(alerts[alerts.length - 1])}` : '';
    throw new Error(`Save did not finish within ${CONFIG.saveTimeoutMs / 1000}s.${last}`);
  }

  async function fillOne(target) {
    const current = findRowByDate(target.date);
    if (!current || !current.entryButton) throw new Error(`ENTRY button not found for ${target.date}.`);
    if (getDialog() && isVisible(getDialog())) throw new Error('Another entry dialog is still open.');

    current.entryButton.scrollIntoView({ block: 'center', inline: 'nearest' });
    current.entryButton.click();

    const dialog = await waitFor(() => {
      const el = getDialog();
      if (!el || !isVisible(el)) return null;
      if (!field('editActivity') || !field('editDescription')) return null;
      return el;
    }, CONFIG.modalTimeoutMs, 'entry dialog');

    const actualDate = modalDate();
    if (actualDate && actualDate !== target.date) {
      throw new Error(`Dialog date ${actualDate} does not match row ${target.date}.`);
    }

    const activityInput = field('editActivity');
    const descriptionInput = field('editDescription');

    if (target.mode === 'entry') {
      await waitFor(() => {
        const clockIn = field('editClockIn');
        const clockOut = field('editClockOut');
        return clockIn && clockOut && clean(clockIn.value) && clean(clockOut.value);
      }, CONFIG.clockTimeoutMs, 'clock in/out values');

      setNativeValue(activityInput, target.activity);
      setNativeValue(descriptionInput, target.description);
      if (activityInput.value !== target.activity || descriptionInput.value !== target.description) {
        throw new Error('Fields did not accept the pasted values.');
      }
    } else {
      const off = modalControl('OFF');
      if (!off) throw new Error('OFF button not found in dialog.');
      off.click();
      await waitFor(() => ['editActivity', 'editDescription', 'editClockIn', 'editClockOut']
        .every((id) => clean(field(id) && field(id).value) === 'OFF'), 3000, 'OFF fields');
    }

    const submit = modalControl('Submit');
    if (!submit) throw new Error('Submit button not found in dialog.');

    const originalAlert = window.alert;
    const alerts = [];
    window.alert = (message) => {
      alerts.push(String(message));
    };

    try {
      submit.click();
      await waitForSave(target.date, alerts);
    } finally {
      window.alert = originalAlert;
    }

    if (getDialog() && isVisible(getDialog())) {
      closeDialog();
      await sleep(200);
      if (getDialog() && isVisible(getDialog())) throw new Error('Saved, but the entry dialog did not close.');
    }
  }

  async function waitDelay(ms) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (stopRequested) return false;
      await sleep(100);
    }
    return !stopRequested;
  }

  async function start() {
    if (running) return;
    const plan = preparePlan();
    reportPlan(plan);
    if (plan.errors.length) {
      plan.errors.slice(0, 12).forEach((error) => log(`ERROR ${error}`));
      setStatus('Fix the pasted rows before starting.', 'error');
      return;
    }
    if (!plan.targets.length) {
      setStatus('No matching visible ENTRY rows to fill.', 'warning');
      return;
    }

    running = true;
    stopRequested = false;
    updateButtons();
    let saved = 0;
    let failed = 0;

    try {
      for (let index = 0; index < plan.targets.length; index += 1) {
        if (stopRequested) break;
        const target = plan.targets[index];
        const delayMs = configuredDelayMs();
        setStatus(`Filling ${target.date} (${index + 1}/${plan.targets.length})...`, 'busy');
        log(`Filling ${target.date} as ${target.mode.toUpperCase()}.`);

        try {
          await fillOne(target);
          saved += 1;
          log(`Saved ${target.date}.`);
        } catch (error) {
          failed += 1;
          log(`FAILED ${target.date}: ${error.message}`);
          setStatus(`Stopped on ${target.date}: ${error.message}`, 'error');
          break;
        }

        if (index < plan.targets.length - 1) {
          if (stopRequested) break;
          log(`Waiting ${delayMs / 1000}s before the next entry.`);
          const shouldContinue = await waitDelay(delayMs);
          if (!shouldContinue) break;
        }
      }
    } finally {
      running = false;
      updateButtons();
    }

    if (stopRequested) {
      setStatus(`Stopped. Saved ${saved}${failed ? `, failed ${failed}` : ''}.`, 'warning');
      log(`Stopped. Saved ${saved}${failed ? `, failed ${failed}` : ''}.`);
    } else if (!failed) {
      setStatus(`Done. Saved ${saved}${plan.missing.length ? `, skipped ${plan.missing.length}` : ''}.`, 'success');
      log(`Done. Saved ${saved}${plan.missing.length ? `, skipped ${plan.missing.length}` : ''}.`);
    }
  }

  function show() {
    if (panel) panel.style.display = 'flex';
    if (launcher) launcher.style.display = 'none';
  }

  function hide() {
    if (panel) panel.style.display = 'none';
    if (launcher) launcher.style.display = 'flex';
  }

  function install() {
    const style = document.createElement('style');
    style.textContent = `
      #llf-panel, #llf-panel * { box-sizing: border-box; }
      #llf-panel {
        position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
        width: min(390px, calc(100vw - 32px)); max-height: min(80vh, 720px);
        display: flex; flex-direction: column; gap: 10px; padding: 14px;
        background: #ffffff; color: #16181d; border: 1px solid #b9bec7;
        border-radius: 8px; box-shadow: 0 8px 30px rgba(0,0,0,.22);
        font: 13px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      }
      #llf-panel h2 { margin: 0; font-size: 15px; line-height: 1.25; }
      #llf-panel .llf-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
      #llf-panel .llf-close {
        flex: 0 0 auto; width: 30px; height: 30px; min-height: 30px; padding: 0;
        border-radius: 5px; font-size: 18px; line-height: 1; font-weight: 500;
      }
      #llf-launcher {
        position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
        display: none; align-items: center; justify-content: center;
        min-height: 40px; padding: 8px 13px; border: 1px solid #1f6feb; border-radius: 7px;
        background: #1f6feb; color: #fff; box-shadow: 0 4px 16px rgba(0,0,0,.24);
        font: 600 13px/1.2 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
        cursor: pointer;
      }
      #llf-launcher:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
      #llf-launcher.llf-running { background: #14532d; border-color: #14532d; }
      @media (prefers-color-scheme: dark) {
        #llf-launcher { background: #2d7ff9; border-color: #2d7ff9; }
        #llf-launcher.llf-running { background: #166534; border-color: #166534; }
      }
      #llf-panel .llf-sub { margin: 0; color: #5b6270; font-size: 12px; }
      #llf-panel textarea {
        width: 100%; height: 118px; resize: vertical; padding: 8px;
        border: 1px solid #b9bec7; border-radius: 5px; background: #fff; color: inherit;
        font: 12px/1.4 ui-monospace, SFMono-Regular, Consolas, monospace;
      }
      #llf-panel .llf-row { display: flex; gap: 8px; flex-wrap: wrap; }
      #llf-panel .llf-delay { display: flex; align-items: center; gap: 6px; font-size: 12px; }
      #llf-panel .llf-delay input {
        width: 72px; padding: 5px 6px; border: 1px solid #b9bec7; border-radius: 5px;
        background: #fff; color: inherit; font: inherit;
      }
      #llf-panel button {
        min-height: 34px; padding: 6px 12px; border: 1px solid #6f7683;
        border-radius: 5px; background: #f5f6f8; color: #16181d; cursor: pointer;
        font: inherit; font-weight: 600;
      }
      #llf-panel button:focus-visible, #llf-panel textarea:focus-visible,
      #llf-panel .llf-delay input:focus-visible {
        outline: 2px solid #1f6feb; outline-offset: 2px;
      }
      #llf-panel button:disabled { opacity: .5; cursor: not-allowed; }
      #llf-panel #llf-start { background: #1f6feb; color: #fff; border-color: #1f6feb; }
      #llf-panel #llf-status {
        min-height: 18px; padding: 7px 8px; border-radius: 5px;
        background: #eef1f5; color: #303743; font-size: 12px;
      }
      #llf-panel #llf-status[data-kind="error"] { background: #fdecec; color: #8b1a1a; }
      #llf-panel #llf-status[data-kind="warning"] { background: #fff6dd; color: #6d4b00; }
      #llf-panel #llf-status[data-kind="success"] { background: #e9f7ee; color: #14532d; }
      #llf-panel #llf-status[data-kind="busy"] { background: #e8f0fe; color: #174ea6; }
      #llf-panel #llf-log {
        max-height: 190px; overflow: auto; padding: 8px; border: 1px solid #d5d9e0;
        border-radius: 5px; background: #fafbfc; font: 11.5px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace;
      }
      #llf-panel .llf-log-line { white-space: pre-wrap; overflow-wrap: anywhere; }
      #llf-panel .llf-note { color: #5b6270; font-size: 11px; margin: 0; }
      @media (prefers-color-scheme: dark) {
        #llf-panel { background: #1c1f24; color: #f2f4f7; border-color: #4a505a; }
        #llf-panel .llf-sub, #llf-panel .llf-note { color: #b2bac6; }
        #llf-panel textarea, #llf-panel button, #llf-panel #llf-log,
        #llf-panel .llf-delay input {
          background: #24282f; color: #f2f4f7; border-color: #555d69;
        }
        #llf-panel #llf-status { background: #2a2f37; color: #dbe1ea; }
        #llf-panel #llf-status[data-kind="error"] { background: #4a2020; color: #ffd7d7; }
        #llf-panel #llf-status[data-kind="warning"] { background: #463918; color: #ffe4a3; }
        #llf-panel #llf-status[data-kind="success"] { background: #163a26; color: #b8f5cd; }
        #llf-panel #llf-status[data-kind="busy"] { background: #1b3350; color: #cfe2ff; }
        #llf-panel #llf-start { background: #2d7ff9; border-color: #2d7ff9; }
      }
    `;
    document.head.appendChild(style);

    panel = document.createElement('section');
    panel.id = 'llf-panel';
    panel.setAttribute('aria-label', 'Logbook filler');
    panel.innerHTML = `
      <div class="llf-head">
        <div>
          <h2>Logbook Filler</h2>
          <p class="llf-sub">Targets visible ENTRY rows only. Page-level SUBMIT is never clicked.</p>
        </div>
        <button type="button" class="llf-close" id="llf-close" aria-label="Close logbook filler" title="Close">&#215;</button>
      </div>
      <textarea id="llf-data" spellcheck="false"
        placeholder="Paste Date, Activity, Description from Excel, including the header row."></textarea>
      <div class="llf-row">
        <button type="button" id="llf-dry">Dry run</button>
        <button type="button" id="llf-start">Fill ready entries</button>
        <button type="button" id="llf-stop" disabled>Stop</button>
      </div>
      <label class="llf-delay" for="llf-delay">Delay between entries
        <input id="llf-delay" type="number" min="0" max="300" step="1" value="5" inputmode="numeric"> seconds
      </label>
      <div id="llf-status" data-kind="info">Paste rows, then dry-run.</div>
      <div id="llf-log" aria-live="polite"></div>
      <p class="llf-note">Missing dates are skipped. Page-level SUBMIT is never clicked.</p>
    `;
    document.body.appendChild(panel);

    launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.id = 'llf-launcher';
    launcher.textContent = 'Logbook';
    launcher.setAttribute('aria-label', 'Open logbook filler');
    launcher.title = 'Open logbook filler';
    document.body.appendChild(launcher);

    textarea = document.getElementById('llf-data');
    delayInput = document.getElementById('llf-delay');
    dryBtn = document.getElementById('llf-dry');
    startBtn = document.getElementById('llf-start');
    stopBtn = document.getElementById('llf-stop');
    statusEl = document.getElementById('llf-status');
    logEl = document.getElementById('llf-log');

    document.getElementById('llf-close').addEventListener('click', hide);
    launcher.addEventListener('click', show);
    updateButtons();

    dryBtn.addEventListener('click', () => {
      if (running) return;
      const plan = preparePlan();
      reportPlan(plan);
      if (plan.errors.length) {
        plan.errors.slice(0, 12).forEach((error) => log(`ERROR ${error}`));
        setStatus('Fix the pasted rows before starting.', 'error');
        return;
      }
      setStatus(`${plan.targets.length} ready, ${plan.missing.length} missing data.`, 'info');
    });

    startBtn.addEventListener('click', () => {
      start().catch((error) => {
        log(`FAILED: ${error.message}`);
        setStatus(`Stopped: ${error.message}`, 'error');
        running = false;
        updateButtons();
      });
    });

    stopBtn.addEventListener('click', () => {
      if (!running) return;
      stopRequested = true;
      stopBtn.disabled = true;
      setStatus('Stopping after the current save...', 'warning');
      log('Stop requested.');
    });

    window.__llf = { show, hide, parseData, preparePlan, version: '0.1.2' };
  }

  install();
})();