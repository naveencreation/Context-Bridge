/**
 * ContextBridge — ChatGPT Injector
 * Retrieves the pending context payload from storage
 * and injects it into ChatGPT's chat input box.
 */

'use strict';

(async function () {

  // ─── Retrieve Payload ───────────────────────────────────────────────────────

  let payload = null;

  try {
    const result = await chrome.storage.local.get('pendingInjection');
    payload = result.pendingInjection || null;
  } catch (err) {
    console.error('[ContextBridge] ChatGPT injector: failed to read storage:', err);
    return;
  }

  if (!payload || !payload.content) {
    console.warn('[ContextBridge] ChatGPT injector: no pending payload found.');
    return;
  }

  // Expire payloads older than 2 minutes
  if (Date.now() - (payload.timestamp || 0) > 120000) {
    console.warn('[ContextBridge] ChatGPT injector: payload expired.');
    await chrome.storage.local.remove('pendingInjection');
    return;
  }

  // ─── Find Input ─────────────────────────────────────────────────────────────

  // ChatGPT uses a contenteditable div with id="prompt-textarea"
  const input = await waitForElement([
    '#prompt-textarea',
    'div[contenteditable="true"][id="prompt-textarea"]',
    'div[contenteditable="true"][data-id="root"]',
    'div[contenteditable="true"].ProseMirror',
    'textarea[data-id="root"]',
    'div[contenteditable="true"]',
    'textarea[placeholder]',
    'textarea'
  ], 15000);

  if (!input) {
    console.error('[ContextBridge] ChatGPT injector: could not find input box after 15s.');
    await chrome.storage.local.remove('pendingInjection');
    return;
  }

  // ─── Inject Content ─────────────────────────────────────────────────────────

  try {
    await injectIntoInput(input, payload.content);
    await chrome.storage.local.remove('pendingInjection');
    console.log('[ContextBridge] ChatGPT injector: content injected successfully.');
  } catch (err) {
    console.error('[ContextBridge] ChatGPT injector: injection failed:', err);
    await chrome.storage.local.remove('pendingInjection');
  }

})();

// ─── Injection Logic ──────────────────────────────────────────────────────────

async function injectIntoInput(input, content) {
  input.focus();
  await sleep(150);

  const tagName = input.tagName.toLowerCase();

  if (tagName === 'textarea') {
    injectIntoTextarea(input, content);
  } else if (input.isContentEditable) {
    // ChatGPT uses a ProseMirror contenteditable div
    await injectIntoContentEditable(input, content);
  }

  await sleep(100);
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
  // Step 1: Focus and clear
  el.focus();
  await sleep(60);

  // Step 2: Select all existing content and delete it
  try {
    document.execCommand('selectAll', false, null);
    document.execCommand('delete',    false, null);
  } catch (_) {
    el.innerHTML = '';
  }

  await sleep(60);

  // Step 3: ChatGPT's ProseMirror handles newlines as <p> blocks.
  // Insert the content in chunks to preserve paragraph structure.
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line === '') {
      // Empty line = paragraph break in ProseMirror
      try {
        document.execCommand('insertParagraph', false, null);
      } catch (_) {
        document.execCommand('insertText', false, '\n');
      }
    } else {
      try {
        document.execCommand('insertText', false, line);
      } catch (_) {
        // Fallback for browsers that block execCommand
        const textNode = document.createTextNode(line);
        const sel      = window.getSelection();
        if (sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          range.insertNode(textNode);
          range.setStartAfter(textNode);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
    }

    // Add paragraph break between lines (except last)
    if (i < lines.length - 1 && line !== '') {
      // Don't add extra breaks after already-empty lines
    }
  }

  // Step 4: Move cursor to end
  moveCursorToEnd(el);
}

function triggerInputEvents(el) {
  // ChatGPT's React needs specific event sequence to enable the send button
  const events = [
    new Event('input',   { bubbles: true, cancelable: true }),
    new Event('change',  { bubbles: true, cancelable: true }),
    new InputEvent('input', {
      bubbles:      true,
      cancelable:   true,
      inputType:    'insertText',
      data:         ' '
    }),
    new KeyboardEvent('keydown', {
      bubbles:  true,
      key:      'a',
      code:     'KeyA',
      keyCode:  65
    }),
    new KeyboardEvent('keyup', {
      bubbles:  true,
      key:      'a',
      code:     'KeyA',
      keyCode:  65
    })
  ];

  events.forEach(ev => el.dispatchEvent(ev));

  // Final input event to make sure React re-renders the send button
  setTimeout(() => {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, 100);
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