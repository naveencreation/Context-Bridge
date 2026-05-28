/**
 * ContextBridge — Google Gemini Injector
 * Retrieves the pending context payload from storage
 * and injects it into Gemini's chat input box.
 */

'use strict';

(async function () {

  // ─── Retrieve Payload ───────────────────────────────────────────────────────

  let payload = null;

  try {
    const result = await chrome.storage.local.get('pendingInjection');
    payload = result.pendingInjection || null;
  } catch (err) {
    console.error('[ContextBridge] Gemini injector: failed to read storage:', err);
    return;
  }

  if (!payload || !payload.content) {
    console.warn('[ContextBridge] Gemini injector: no pending payload found.');
    return;
  }

  // Expire payloads older than 2 minutes
  if (Date.now() - (payload.timestamp || 0) > 120000) {
    console.warn('[ContextBridge] Gemini injector: payload expired.');
    await chrome.storage.local.remove('pendingInjection');
    return;
  }

  // ─── Find Input ─────────────────────────────────────────────────────────────

  // Gemini uses a rich-text div with specific attributes
  const input = await waitForElement([
    'rich-textarea div[contenteditable="true"]',
    '.ql-editor[contenteditable="true"]',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"].textarea',
    '[data-testid="chat-input"] div[contenteditable]',
    'div[contenteditable="true"]',
    'textarea[placeholder]',
    'textarea'
  ], 15000);

  if (!input) {
    console.error('[ContextBridge] Gemini injector: could not find input box after 15s.');
    await chrome.storage.local.remove('pendingInjection');
    return;
  }

  // ─── Inject Content ─────────────────────────────────────────────────────────

  try {
    await injectIntoInput(input, payload.content);
    await chrome.storage.local.remove('pendingInjection');
    console.log('[ContextBridge] Gemini injector: content injected successfully.');
  } catch (err) {
    console.error('[ContextBridge] Gemini injector: injection failed:', err);
    await chrome.storage.local.remove('pendingInjection');
  }

})();

// ─── Injection Logic ──────────────────────────────────────────────────────────

async function injectIntoInput(input, content) {
  input.focus();
  await sleep(200);

  const tagName = input.tagName.toLowerCase();

  if (tagName === 'textarea') {
    injectIntoTextarea(input, content);
  } else if (input.isContentEditable) {
    await injectIntoContentEditable(input, content);
  }

  await sleep(120);
  triggerInputEvents(input);
}

function injectIntoTextarea(textarea, content) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value'
  ).set;

  nativeInputValueSetter.call(textarea, content);
  textarea.dispatchEvent(new Event('input',  { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
}

async function injectIntoContentEditable(el, content) {
  el.focus();
  await sleep(80);

  // Step 1: Clear existing content
  try {
    document.execCommand('selectAll', false, null);
    document.execCommand('delete',    false, null);
  } catch (_) {
    el.innerHTML = '';
  }

  await sleep(80);

  // Step 2: Gemini uses Quill editor in some versions — try clipboard API first
  // as it preserves newlines better than execCommand line-by-line
  const injected = await tryClipboardInject(el, content);

  if (!injected) {
    // Fallback: execCommand insertText
    try {
      document.execCommand('insertText', false, content);
    } catch (_) {
      // Last resort: set innerHTML with <br> for newlines
      el.innerHTML = content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
    }
  }

  await sleep(80);
  moveCursorToEnd(el);
}

/**
 * Attempt injection via the Clipboard API.
 * More reliable for rich editors (Quill, ProseMirror) that intercept paste.
 * @returns {Promise<boolean>} true if successful
 */
async function tryClipboardInject(el, content) {
  try {
    // Write to clipboard
    await navigator.clipboard.writeText(content);

    // Simulate Ctrl+V paste
    el.focus();

    const pasteEvent = new ClipboardEvent('paste', {
      bubbles:    true,
      cancelable: true,
      clipboardData: new DataTransfer()
    });

    // Try to set clipboard data on the event
    try {
      pasteEvent.clipboardData.setData('text/plain', content);
    } catch (_) { /* DataTransfer may be read-only */ }

    el.dispatchEvent(pasteEvent);
    await sleep(100);

    // Verify injection worked by checking content
    const hasContent = (el.textContent || el.value || '').length > 10;
    return hasContent;

  } catch (_) {
    return false;
  }
}

function triggerInputEvents(el) {
  // Gemini's Angular framework needs these events to detect changes
  const events = [
    new Event('input',   { bubbles: true, cancelable: true }),
    new Event('change',  { bubbles: true, cancelable: true }),
    new InputEvent('input', {
      bubbles:    true,
      cancelable: true,
      inputType:  'insertText',
      data:       ' '
    }),
    new KeyboardEvent('keydown', {
      bubbles: true,
      key:     'End',
      code:    'End'
    }),
    new KeyboardEvent('keyup', {
      bubbles: true,
      key:     'End',
      code:    'End'
    })
  ];

  events.forEach(ev => el.dispatchEvent(ev));

  // Angular change detection needs a second pass
  setTimeout(() => {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, 150);
}

function moveCursorToEnd(el) {
  try {
    const range = document.createRange();
    const sel   = window.getSelection();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch (_) { /* non-critical */ }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

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