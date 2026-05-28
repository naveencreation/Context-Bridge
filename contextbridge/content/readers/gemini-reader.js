/**
 * ContextBridge — Google Gemini Reader
 * Extracts conversation turns from Gemini's DOM.
 * Injected as a content script on gemini.google.com pages.
 */

'use strict';

// ─── Selectors ────────────────────────────────────────────────────────────────

const SELECTORS = {
  // Gemini wraps each exchange in a conversation-turn element
  conversationTurn: [
    'conversation-turn',
    '[class*="conversation-turn"]',
    '[class*="ConversationTurn"]',
    '.conversation-container > *'
  ],

  // User query inside a turn
  userQuery: [
    '.query-text',
    '[class*="query-text"]',
    '[class*="QueryText"]',
    '.user-query',
    '[class*="user-query"]',
    'user-query'
  ],

  // Model response inside a turn
  modelResponse: [
    '.model-response-text',
    '[class*="response-content"]',
    '[class*="ResponseContent"]',
    'model-response',
    '[class*="model-response"]',
    '.markdown-main-panel'
  ]
};

// ─── Message Listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'EXTRACT_CONVERSATION') return;

  try {
    const turns = extractConversation();

    if (turns.length === 0) {
      sendResponse({
        success: false,
        error: 'No conversation found. Make sure a Gemini chat with messages is open.'
      });
      return;
    }

    sendResponse({ success: true, turns });

  } catch (err) {
    sendResponse({
      success: false,
      error: `Gemini reader error: ${err.message}`
    });
  }

  return true;
});

// ─── Core Extraction ──────────────────────────────────────────────────────────

function extractConversation() {
  // Strategy 1: conversation-turn custom elements (most reliable for Gemini)
  let turns = extractByConversationTurn();
  if (turns.length > 0) return turns;

  // Strategy 2: query + response pair scanning
  turns = extractByQueryResponsePairs();
  if (turns.length > 0) return turns;

  // Strategy 3: Generic role-based fallback
  turns = extractByRoleAttributes();
  return turns;
}

// ── Strategy 1: conversation-turn elements ────────────────────────────────────

function extractByConversationTurn() {
  // Gemini uses Angular custom elements like <conversation-turn>
  const turnEls = document.querySelectorAll('conversation-turn');
  if (turnEls.length === 0) return [];

  const turns = [];

  turnEls.forEach(turn => {
    // Each turn contains both user query and model response
    const userEl = findFirst(turn, SELECTORS.userQuery);
    const modelEl = findFirst(turn, SELECTORS.modelResponse);

    if (userEl) {
      const text = extractTextFromElement(userEl);
      if (text) turns.push({ role: 'user', content: text });
    }

    if (modelEl) {
      const text = extractTextFromElement(modelEl);
      if (text) turns.push({ role: 'assistant', content: text });
    }
  });

  return turns;
}

// ── Strategy 2: Query + Response pairs ───────────────────────────────────────

function extractByQueryResponsePairs() {
  const turns = [];

  // Find all user queries
  const userEls = [
    ...document.querySelectorAll('.query-text'),
    ...document.querySelectorAll('[class*="query-text"]'),
    ...document.querySelectorAll('user-query'),
  ];

  // Find all model responses
  const modelEls = [
    ...document.querySelectorAll('.model-response-text'),
    ...document.querySelectorAll('[class*="response-content"]'),
    ...document.querySelectorAll('model-response'),
  ];

  if (userEls.length === 0 && modelEls.length === 0) return [];

  // Combine and sort by DOM position
  const allEls = [
    ...userEls.map(el => ({ el, role: 'user' })),
    ...modelEls.map(el => ({ el, role: 'assistant' }))
  ];

  allEls.sort((a, b) => {
    const pos = a.el.compareDocumentPosition(b.el);
    return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });

  // Deduplicate nested elements
  const deduped = [];
  for (const item of allEls) {
    const isDuplicate = deduped.some(d =>
      d.el.contains(item.el) || item.el.contains(d.el)
    );
    if (!isDuplicate) deduped.push(item);
  }

  deduped.forEach(({ el, role }) => {
    const text = extractTextFromElement(el);
    if (text && text.length > 2) {
      turns.push({ role, content: text });
    }
  });

  return turns;
}

// ── Strategy 3: Role attribute fallback ──────────────────────────────────────

function extractByRoleAttributes() {
  const turns = [];

  // Some Gemini versions use aria roles or data attributes
  const candidates = document.querySelectorAll(
    '[data-speaker], [data-role], [aria-label*="You"], [aria-label*="Gemini"]'
  );

  if (candidates.length === 0) return [];

  candidates.forEach(el => {
    const speaker   = el.getAttribute('data-speaker') || '';
    const role      = el.getAttribute('data-role')    || '';
    const ariaLabel = el.getAttribute('aria-label')   || '';

    let messageRole = null;

    if (
      speaker.toLowerCase().includes('user') ||
      role.toLowerCase().includes('user') ||
      ariaLabel.toLowerCase().includes('you')
    ) {
      messageRole = 'user';
    } else if (
      speaker.toLowerCase().includes('model') ||
      speaker.toLowerCase().includes('gemini') ||
      role.toLowerCase().includes('assistant') ||
      ariaLabel.toLowerCase().includes('gemini')
    ) {
      messageRole = 'assistant';
    }

    if (!messageRole) return;

    const text = extractTextFromElement(el);
    if (text && text.length > 2) {
      turns.push({ role: messageRole, content: text });
    }
  });

  return turns;
}

// ─── Text Extraction ──────────────────────────────────────────────────────────

function extractTextFromElement(el) {
  if (!el) return '';

  const clone = el.cloneNode(true);

  // Remove Gemini UI chrome
  const removeSelectors = [
    'button',
    'svg',
    'mat-icon',
    '[class*="action"]',
    '[class*="button"]',
    '[class*="copy-button"]',
    '[class*="CopyButton"]',
    '[class*="toolbar"]',
    '[class*="thumbs"]',
    '[class*="feedback"]',
    '[class*="Feedback"]',
    '[class*="like"]',
    '[class*="dislike"]',
    '.sr-only',
    '[aria-hidden="true"]',
    '[class*="tooltip"]',
    '[class*="badge"]',
    'menu',
    '[role="menu"]'
  ];

  removeSelectors.forEach(sel => {
    clone.querySelectorAll(sel).forEach(node => node.remove());
  });

  // Preserve code blocks with language tags
  clone.querySelectorAll('pre code').forEach(code => {
    const langClass = Array.from(code.classList)
      .find(c => c.startsWith('language-'));
    const lang    = langClass ? langClass.replace('language-', '') : '';
    const marker  = lang ? `\`\`\`${lang}\n` : '```\n';
    const wrapped = document.createTextNode(
      `\n${marker}${code.textContent}\n\`\`\`\n`
    );
    code.replaceWith(wrapped);
  });

  // Standalone <pre>
  clone.querySelectorAll('pre').forEach(pre => {
    if (!pre.querySelector('code')) {
      pre.replaceWith(
        document.createTextNode(`\n\`\`\`\n${pre.textContent}\n\`\`\`\n`)
      );
    }
  });

  // Convert <br> to newlines
  clone.querySelectorAll('br').forEach(br => {
    br.replaceWith(document.createTextNode('\n'));
  });

  // Headings
  ['h1','h2','h3','h4'].forEach((tag, i) => {
    const prefix = '#'.repeat(i + 1);
    clone.querySelectorAll(tag).forEach(h => {
      h.insertAdjacentText('beforebegin', `\n${prefix} `);
      h.insertAdjacentText('afterend', '\n');
    });
  });

  // List items
  clone.querySelectorAll('li').forEach(li => {
    li.insertAdjacentText('beforebegin', '\n• ');
  });

  // Block spacing
  clone.querySelectorAll('p, div').forEach(block => {
    if (block.textContent.trim()) {
      block.insertAdjacentText('afterend', '\n');
    }
  });

  return clone.textContent
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── Utility ──────────────────────────────────────────────────────────────────

/**
 * Try each selector in order, return the first matching element.
 * @param {Element} root
 * @param {string[]} selectors
 * @returns {Element|null}
 */
function findFirst(root, selectors) {
  for (const sel of selectors) {
    try {
      const found = root.querySelector(sel);
      if (found) return found;
    } catch (_) {
      // Invalid selector — skip
    }
  }
  return null;
}