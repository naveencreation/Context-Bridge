/**
 * ContextBridge — Popup Logic
 * Orchestrates the full extract → configure → transfer flow.
 */

'use strict';

// ─── Platform Config ──────────────────────────────────────────────────────────

const PLATFORM_INFO = {
  claude:  { name: 'Claude.ai',      shortName: 'Claude',  emoji: '🟠', badgeClass: 'claude'  },
  chatgpt: { name: 'ChatGPT',        shortName: 'ChatGPT', emoji: '🟢', badgeClass: 'chatgpt' },
  gemini:  { name: 'Google Gemini',  shortName: 'Gemini',  emoji: '🔵', badgeClass: 'gemini'  },
  unknown: { name: 'Unknown',        shortName: '?',       emoji: '⚪', badgeClass: ''        }
};

// ─── App State ────────────────────────────────────────────────────────────────

const state = {
  currentPlatform: 'unknown',
  currentTabId:    null,
  turns:           [],
  selectedTarget:  null,
  transferMode:    'raw'
};

// ─── DOM References ───────────────────────────────────────────────────────────

const el = {
  platformBadge:    document.getElementById('platformBadge'),
  settingsBtn:      document.getElementById('settingsBtn'),
  errorBanner:      document.getElementById('errorBanner'),
  errorText:        document.getElementById('errorText'),
  errorClose:       document.getElementById('errorClose'),
  unsupportedState: document.getElementById('unsupportedState'),

  step1:            document.getElementById('step1'),
  step2:            document.getElementById('step2'),
  step3:            document.getElementById('step3'),
  step4:            document.getElementById('step4'),

  extractBtn:       document.getElementById('extractBtn'),
  turnsCount:       document.getElementById('turnsCount'),
  tokensCount:      document.getElementById('tokensCount'),
  previewBox:       document.getElementById('previewBox'),
  platformGrid:     document.getElementById('platformGrid'),
  transferBtn:      document.getElementById('transferBtn'),
  transferBtnText:  document.getElementById('transferBtnText'),
  resetBtn:         document.getElementById('resetBtn'),
  processingTitle:  document.getElementById('processingTitle'),
  processingSub:    document.getElementById('processingSub'),
  transferAgainBtn: document.getElementById('transferAgainBtn')
};

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);

async function init() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.currentTabId    = tab.id;
    state.currentPlatform = detectPlatformFromUrl(tab.url);

    renderPlatformBadge();
    renderTargetPlatformGrid();
    bindEvents();
    await restoreLastSettings();

    if (state.currentPlatform === 'unknown') {
      showUnsupported();
    } else {
      showStep(1);
    }
  } catch (err) {
    showError(`Initialization failed: ${err.message}`);
  }
}

// ─── Platform Detection ───────────────────────────────────────────────────────

function detectPlatformFromUrl(url) {
  if (!url) return 'unknown';
  try {
    const { hostname } = new URL(url);
    if (hostname === 'claude.ai')                               return 'claude';
    if (hostname === 'chatgpt.com' || hostname === 'chat.openai.com') return 'chatgpt';
    if (hostname === 'gemini.google.com')                       return 'gemini';
  } catch (_) { /* invalid url */ }
  return 'unknown';
}

// ─── Render ───────────────────────────────────────────────────────────────────

function renderPlatformBadge() {
  const info = PLATFORM_INFO[state.currentPlatform];
  el.platformBadge.textContent  = `${info.emoji} ${info.name}`;
  el.platformBadge.className    = `platform-badge ${info.badgeClass}`;
}

function renderTargetPlatformGrid() {
  const platforms = ['claude', 'chatgpt', 'gemini'];

  el.platformGrid.innerHTML = platforms.map(pid => {
    const info       = PLATFORM_INFO[pid];
    const isCurrent  = pid === state.currentPlatform;
    const isSelected = pid === state.selectedTarget;

    const classes = [
      'platform-card',
      isCurrent  ? 'platform-card--disabled'  : '',
      isSelected ? 'platform-card--selected'  : ''
    ].filter(Boolean).join(' ');

    return `
      <div class="${classes}"
           data-platform="${pid}"
           title="${isCurrent
             ? `You are already on ${info.name}`
             : `Transfer to ${info.name}`}">
        <span class="platform-card-emoji">${info.emoji}</span>
        <span>${info.shortName}</span>
      </div>`;
  }).join('');

  // Bind click handlers
  el.platformGrid.querySelectorAll('.platform-card:not(.platform-card--disabled)')
    .forEach(card => card.addEventListener('click', () => {
      selectTarget(card.dataset.platform);
    }));
}

function renderPreview() {
  const total  = state.turns.length;
  const tokens = estimateTokens(state.turns);

  el.turnsCount.textContent = `${total} message${total !== 1 ? 's' : ''}`;
  el.tokensCount.textContent = `~${tokens.toLocaleString()} tokens`;

  // Show up to 4 turns in preview
  const preview = state.turns.slice(0, 4);
  el.previewBox.innerHTML = preview.map(t => {
    const isUser  = t.role === 'user';
    const label   = isUser ? '👤 You' : '🤖 AI';
    const snippet = truncateText(t.content.trim().replace(/\n+/g, ' '), 90);
    return `
      <div class="preview-turn">
        <span class="role-label ${isUser ? 'user' : ''}">${label}</span>
        <div class="turn-content">${escapeHtml(snippet)}</div>
      </div>`;
  }).join('') + (total > 4
    ? `<div class="preview-turn" style="color:var(--text-muted);font-size:11px">
         + ${total - 4} more message${total - 4 !== 1 ? 's' : ''} included
       </div>`
    : '');
}

// ─── Event Binding ────────────────────────────────────────────────────────────

function bindEvents() {
  el.settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  el.errorClose.addEventListener('click', hideError);

  el.extractBtn.addEventListener('click', handleExtract);
  el.resetBtn.addEventListener('click', handleReset);
  el.transferBtn.addEventListener('click', handleTransfer);
  el.transferAgainBtn.addEventListener('click', handleReset);

  // Mode radio buttons
  document.querySelectorAll('input[name="mode"]').forEach(radio => {
    radio.addEventListener('change', e => {
      state.transferMode = e.target.value;
      chrome.storage.sync.set({ transferMode: state.transferMode });
    });
  });
}

// ─── Settings Restore ─────────────────────────────────────────────────────────

async function restoreLastSettings() {
  try {
    const result = await chrome.storage.sync.get(['transferMode', 'lastUsedTarget']);

    if (result.transferMode) {
      state.transferMode = result.transferMode;
      const radio = document.querySelector(`input[name="mode"][value="${result.transferMode}"]`);
      if (radio) radio.checked = true;
    }

    if (result.lastUsedTarget && result.lastUsedTarget !== state.currentPlatform) {
      state.selectedTarget = result.lastUsedTarget;
    }
  } catch (_) { /* non-critical */ }
}

// ─── Platform Selection ───────────────────────────────────────────────────────

function selectTarget(platformId) {
  state.selectedTarget = platformId;

  // Persist selection
  chrome.storage.sync.set({ lastUsedTarget: platformId });

  // Update grid UI
  el.platformGrid.querySelectorAll('.platform-card').forEach(card => {
    card.classList.toggle(
      'platform-card--selected',
      card.dataset.platform === platformId
    );
  });

  // Enable transfer button
  const info = PLATFORM_INFO[platformId];
  el.transferBtn.disabled     = false;
  el.transferBtnText.textContent = `Transfer to ${info.shortName}`;
}

// ─── Step Management ──────────────────────────────────────────────────────────

function showStep(n) {
  hideError();
  el.unsupportedState.classList.add('hidden');
  [el.step1, el.step2, el.step3, el.step4].forEach((s, i) => {
    s.classList.toggle('hidden', i + 1 !== n);
  });
}

function showUnsupported() {
  hideError();
  el.unsupportedState.classList.remove('hidden');
  [el.step1, el.step2, el.step3, el.step4].forEach(s => s.classList.add('hidden'));
}

function setProcessing(title, sub = 'Please wait...') {
  el.processingTitle.textContent = title;
  el.processingSub.textContent   = sub;
  showStep(3);
}

// ─── Error Handling ───────────────────────────────────────────────────────────

function showError(message) {
  el.errorText.textContent = message;
  el.errorBanner.classList.remove('hidden');
}

function hideError() {
  el.errorBanner.classList.add('hidden');
  el.errorText.textContent = '';
}

// ─── Extract Handler ──────────────────────────────────────────────────────────

async function handleExtract() {
  hideError();
  el.extractBtn.disabled     = true;
  el.extractBtn.innerHTML    = '<span class="btn-icon">⏳</span> Extracting...';

  try {
    const response = await chrome.tabs.sendMessage(
      state.currentTabId,
      { type: 'EXTRACT_CONVERSATION' }
    );

    if (!response?.success) {
      throw new Error(
        response?.error ||
        'Could not extract the conversation. Make sure a chat with messages is open.'
      );
    }

    if (!response.turns || response.turns.length === 0) {
      throw new Error(
        'No messages found on this page. Open a conversation with at least one exchange.'
      );
    }

    state.turns = response.turns;
    renderPreview();

    // Re-render grid to reflect current platform
    renderTargetPlatformGrid();

    // Re-apply saved target selection if valid
    if (state.selectedTarget && state.selectedTarget !== state.currentPlatform) {
      selectTarget(state.selectedTarget);
    }

    showStep(2);

  } catch (err) {
    // chrome.tabs.sendMessage throws if no content script is listening
    if (err.message?.includes('Could not establish connection') ||
        err.message?.includes('Receiving end does not exist')) {
      showError(
        'Could not connect to the page. Try refreshing the tab, then click Extract again.'
      );
    } else {
      showError(err.message);
    }
  } finally {
    el.extractBtn.disabled  = false;
    el.extractBtn.innerHTML = '<span class="btn-icon">📋</span> Extract Conversation';
  }
}

// ─── Reset Handler ────────────────────────────────────────────────────────────

function handleReset() {
  state.turns          = [];
  state.selectedTarget = null;
  el.transferBtn.disabled        = true;
  el.transferBtnText.textContent = 'Select a target platform';
  renderTargetPlatformGrid();
  showStep(1);
}

// ─── Transfer Handler ─────────────────────────────────────────────────────────

async function handleTransfer() {
  hideError();

  if (!state.selectedTarget) {
    showError('Please select a target platform first.');
    return;
  }

  if (state.turns.length === 0) {
    showError('No conversation to transfer. Please extract first.');
    return;
  }

  const sourceName = PLATFORM_INFO[state.currentPlatform].name;
  const targetName = PLATFORM_INFO[state.selectedTarget].name;

  try {
    let content;

    // ── Summary Mode ──
    if (state.transferMode === 'summary') {
      setProcessing('Summarizing with Gemini...', 'This usually takes 5–10 seconds');

      const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');

      if (!geminiApiKey || geminiApiKey.trim() === '') {
        throw new Error(
          'Gemini API key is not set. Go to Settings (⚙) and add your key to use Summary mode.'
        );
      }

      const summaryRes = await chrome.runtime.sendMessage({
        type:    'SUMMARIZE_CONVERSATION',
        payload: { turns: state.turns, apiKey: geminiApiKey }
      });

      if (!summaryRes?.success) {
        throw new Error(summaryRes?.error || 'Summarization failed. Try Raw Copy mode instead.');
      }

      content = buildSummaryPrompt(summaryRes.data, sourceName);

    // ── Raw Mode ──
    } else {
      const truncated = truncateTurns(state.turns, 80000);
      content = buildRawPrompt(truncated, sourceName);
    }

    // ── Open & Inject ──
    setProcessing(`Opening ${targetName}...`, 'A new tab will open shortly');

    const injectRes = await chrome.runtime.sendMessage({
      type:    'OPEN_AND_INJECT',
      payload: { targetPlatform: state.selectedTarget, content }
    });

    if (!injectRes?.success) {
      throw new Error(injectRes?.error || 'Injection failed. Please try again.');
    }

    showStep(4);

  } catch (err) {
    showError(err.message);
    showStep(2);
  }
}

// ─── Prompt Builders ──────────────────────────────────────────────────────────

function buildRawPrompt(turns, sourcePlatformName) {
  const formatted = turns.map((t, i) => {
    const role = t.role === 'user' ? '👤 User' : '🤖 Assistant';
    return `[Turn ${i + 1}] ${role}:\n${t.content.trim()}`;
  }).join('\n\n' + '─'.repeat(60) + '\n\n');

  return `╔══════════════════════════════════════════════════════════╗
║           CONTEXT TRANSFER — ContextBridge               ║
╚══════════════════════════════════════════════════════════╝

You are continuing an ongoing conversation that was started on ${sourcePlatformName}.
Read the FULL conversation history below, then continue naturally as if
you were already part of this conversation. Do not acknowledge the transfer.

${'═'.repeat(62)}
CONVERSATION HISTORY (${turns.length} messages)
${'═'.repeat(62)}

${formatted}

${'═'.repeat(62)}
END OF HISTORY — Please continue from here.
${'═'.repeat(62)}`;
}

function buildSummaryPrompt(summary, sourcePlatformName) {
  return `╔══════════════════════════════════════════════════════════╗
║     CONTEXT TRANSFER (Summary) — ContextBridge           ║
╚══════════════════════════════════════════════════════════╝

You are continuing a conversation that started on ${sourcePlatformName}.
Read the structured brief below and continue naturally. Do not mention
the transfer or the summary — just continue as a helpful assistant.

${'═'.repeat(62)}
CONVERSATION CONTEXT BRIEF
${'═'.repeat(62)}

${summary.trim()}

${'═'.repeat(62)}
END OF BRIEF — Please continue from "WHERE WE LEFT OFF".
${'═'.repeat(62)}`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function estimateTokens(turns) {
  const totalChars = turns.reduce((sum, t) => sum + (t.content?.length || 0), 0);
  return Math.ceil(totalChars / 4);
}

function truncateTurns(turns, maxChars) {
  let total = turns.reduce((s, t) => s + t.content.length, 0);
  if (total <= maxChars) return turns;

  const result  = [...turns];
  let dropped   = 0;

  while (total > maxChars && result.length > 2) {
    const removed = result.splice(1, 1)[0];
    total -= removed.content.length;
    dropped++;
  }

  if (dropped > 0) {
    result.splice(1, 0, {
      role:    'system',
      content: `[${dropped} earlier messages omitted to fit context limit]`
    });
  }

  return result;
}

function truncateText(text, max) {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}