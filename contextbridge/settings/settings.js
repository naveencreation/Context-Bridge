/**
 * ContextBridge — Settings Page Logic
 * Loads, validates, and saves all user preferences.
 */

'use strict';

// ─── Default Values ───────────────────────────────────────────────────────────

const DEFAULTS = {
  geminiApiKey:  '',
  transferMode:  'raw',
  maxTurns:      100,
  autoSend:      false,
  theme:         'dark'
};

// ─── DOM References ───────────────────────────────────────────────────────────

const el = {
  apiKeyInput:    document.getElementById('apiKeyInput'),
  toggleKeyBtn:   document.getElementById('toggleKeyBtn'),
  modeSelect:     document.getElementById('modeSelect'),
  maxTurnsInput:  document.getElementById('maxTurnsInput'),
  autoSendToggle: document.getElementById('autoSendToggle'),
  themeSelect:    document.getElementById('themeSelect'),
  saveBtn:        document.getElementById('saveBtn'),
  cancelBtn:      document.getElementById('cancelBtn'),
  clearDataBtn:   document.getElementById('clearDataBtn'),
  successBanner:  document.getElementById('successBanner'),
  successText:    document.getElementById('successText'),
  errorBanner:    document.getElementById('errorBanner'),
  errorText:      document.getElementById('errorText')
};

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);

async function init() {
  await loadSettings();
  bindEvents();
}

// ─── Load Settings ────────────────────────────────────────────────────────────

async function loadSettings() {
  try {
    const result = await chrome.storage.sync.get(Object.keys(DEFAULTS));
    const settings = { ...DEFAULTS, ...result };

    el.apiKeyInput.value        = settings.geminiApiKey || '';
    el.modeSelect.value         = settings.transferMode  || 'raw';
    el.maxTurnsInput.value      = settings.maxTurns      ?? 100;
    el.autoSendToggle.checked   = settings.autoSend      ?? false;
    el.themeSelect.value        = settings.theme         || 'dark';

  } catch (err) {
    showError(`Failed to load settings: ${err.message}`);
  }
}

// ─── Save Settings ────────────────────────────────────────────────────────────

async function saveSettings() {
  hideError();
  hideSucess();

  // ── Validate ──
  const apiKey   = el.apiKeyInput.value.trim();
  const maxTurns = parseInt(el.maxTurnsInput.value, 10);
  const mode     = el.modeSelect.value;
  const autoSend = el.autoSendToggle.checked;
  const theme    = el.themeSelect.value;

  if (apiKey && !apiKey.startsWith('AIza')) {
    showError('Gemini API keys usually start with "AIza". Please double-check your key.');
    return;
  }

  if (isNaN(maxTurns) || maxTurns < 1 || maxTurns > 500) {
    showError('Max Turns must be a number between 1 and 500.');
    el.maxTurnsInput.focus();
    return;
  }

  if (!['raw', 'summary'].includes(mode)) {
    showError('Invalid transfer mode selected.');
    return;
  }

  // ── Save ──
  try {
    await chrome.storage.sync.set({
      geminiApiKey: apiKey,
      transferMode: mode,
      maxTurns:     maxTurns,
      autoSend:     autoSend,
      theme:        theme
    });

    showSuccess('Settings saved successfully!');

  } catch (err) {
    if (err.message?.includes('QUOTA_BYTES_PER_ITEM')) {
      showError('API key is too long for sync storage. Please check it and try again.');
    } else {
      showError(`Failed to save: ${err.message}`);
    }
  }
}

// ─── Clear All Data ───────────────────────────────────────────────────────────

async function clearAllData() {
  const confirmed = confirm(
    'Reset all ContextBridge settings to defaults?\n\n' +
    'This will remove your Gemini API key and all preferences.\n' +
    'This cannot be undone.'
  );

  if (!confirmed) return;

  try {
    await chrome.storage.sync.clear();
    await chrome.storage.local.clear();
    await loadSettings();
    showSuccess('All settings have been reset to defaults.');
  } catch (err) {
    showError(`Failed to reset: ${err.message}`);
  }
}

// ─── Event Binding ────────────────────────────────────────────────────────────

function bindEvents() {

  // Save
  el.saveBtn.addEventListener('click', saveSettings);

  // Cancel — close the tab
  el.cancelBtn.addEventListener('click', () => window.close());

  // Clear all
  el.clearDataBtn.addEventListener('click', clearAllData);

  // Toggle API key visibility
  let keyVisible = false;
  el.toggleKeyBtn.addEventListener('click', () => {
    keyVisible = !keyVisible;
    el.apiKeyInput.type     = keyVisible ? 'text' : 'password';
    el.toggleKeyBtn.textContent = keyVisible ? '🙈' : '👁';
  });

  // Save on Enter in any input
  [el.apiKeyInput, el.maxTurnsInput].forEach(input => {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') saveSettings();
    });
  });

  // Auto-hide success banner after 3s
  el.successBanner.addEventListener('animationend', hideSucess);
}

// ─── Banner Helpers ───────────────────────────────────────────────────────────

function showSuccess(message) {
  el.successText.textContent = message;
  el.successBanner.classList.remove('hidden');

  // Auto-dismiss after 3 seconds
  setTimeout(hideSucess, 3000);
}

function hideSucess() {
  el.successBanner.classList.add('hidden');
}

function showError(message) {
  el.errorText.textContent = message;
  el.errorBanner.classList.remove('hidden');
}

function hideError() {
  el.errorBanner.classList.add('hidden');
  el.errorText.textContent = '';
}