/**
 * ContextBridge — Claude.ai Injector
 * Retrieves the pending context payload from storage
 * and injects it into Claude.ai's chat input box.
 */

'use strict';

(async function () {

  // ─── Retrieve Payload ───────────────────────────────────────────────────────

  let payload = null;

  try {
    const result = await chrome.storage.local.get('pendingInjection');
    payload = result.pendingInjection || null;
  } catch (err) {
    console.error('[ContextBridge] Claude injector: failed to read storage:', err);
    return;
  }

  if (!payload || !payload.content) {
    console.warn('[ContextBridge] Claude injector: no pending payload found.');
    return;
  }

  // Expire payloads older than 2 minutes
  if (Date.now() - (payload.timestamp || 0) > 120000) {
    console.warn('[ContextBridge] Claude injector: payload expired.');
    await chrome.storage.local.remove('pendingInjection');
    return;
  }

  // ─── Find Input ─────────────────────────────────────────────────────────────

  const input = await waitForElement([
    '[contenteditable="true"][data-placeholder]',
    'div[contenteditable="true"].ProseMirror',
    'div[contenteditable="true"]',
    '[data-testid="chat-input"]',
    'textarea[placeholder]',
    'textarea'
  ], 15000);

  if (!input) {
    console.error('[ContextBridge] Claude injector: could not find input box after 15s.');
    await chrome.storage.local.remove('pendingInjection');
    return;
  }

  // ─── Inject Content ─────────────────────────────────────────────────────────

  try {
    await injectIntoInput(input, payload.content);
    await chrome.storage.local.remove('pendingInjection');
    console.log('[ContextBridge] Claude injector: content injected successfully.');
  } catch (err) {
    console.error('[ContextBridge] Claude injector: injection failed:', err);
    await chrome.storage.local.remove('pendingInjection');
  }

})();

// ─── Injection Logic ──────────────────────────────────────────────────────────

async function injectIntoInput(input, content) {
  input.focus();
  await sleep(120);

  const tagName = input.tagName.toLowerCase();

  if (tagName === 'textarea') {
    // Standard textarea injection
    injectIntoTextarea(input, content);
  } else if (input.isContentEditable) {
    // Claude uses a ProseMirror contenteditable div
    injectIntoContentEditable(input, content);
  }

  // Small delay then trigger React/framework change detection
  await sleep(80);
  triggerInputEvents(input);
}

function injectIntoTextarea(textarea, content) {
  // Use native setter to bypass React's synthetic event system
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value'
  ).set;

  nativeInputValueSetter.call(textarea, content);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
}

function injectIntoContentEditable(el, content) {
  // Clear existing content
  el.innerHTML = '';
  el.focus();

  // Claude's ProseMirror editor works best with execCommand
  // for cross-browser compatibility
  try {
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    document.execCommand('insertText', false, content);
  } catch (_) {
    // Fallback: set textContent directly
    el.textContent = content;

    // Move cursor to end
    const range    = document.createRange();
    const sel      = window.getSelection();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
}

function triggerInputEvents(el) {
  const events = [
    new Event('input',   { bubbles: true, cancelable: true }),
    new Event('change',  { bubbles: true, cancelable: true }),
    new KeyboardEvent('keydown', { bubbles: true, key: ' ', code: 'Space' }),
    new KeyboardEvent('keyup',   { bubbles: true, key: ' ', code: 'Space' })
  ];

  events.forEach(ev => el.dispatchEvent(ev));
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Poll the DOM until one of the selectors matches or timeout is hit.
 * @param {string[]} selectors
 * @param {number}   timeout   ms
 * @returns {Promise<Element|null>}
 */
function waitForElement(selectors, timeout = 10000) {
  return new Promise(resolve => {
    const interval = 300;
    let   elapsed  = 0;

    const timer = setInterval(() => {
      for (const sel of selectors) {
        try {
          const el = document.querySelector(sel);
          if (el) {
            clearInterval(timer);
            resolve(el);
            return;
          }
        } catch (_) { /* bad selector */ }
      }

      elapsed += interval;
      if (elapsed >= timeout) {
        clearInterval(timer);
        resolve(null);
      }
    }, interval);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}