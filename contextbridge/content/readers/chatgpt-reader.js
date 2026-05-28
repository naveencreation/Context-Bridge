/**
 * ContextBridge — ChatGPT Reader
 * Extracts conversation turns from ChatGPT's DOM.
 * Injected as a content script on chatgpt.com pages.
 */

'use strict';

// ─── Selectors ────────────────────────────────────────────────────────────────

const SELECTORS = {
  // ChatGPT uses data-message-author-role attribute — most reliable
  userMessage: [
    '[data-message-author-role="user"]',
    '[class*="user-message"]',
    '[class*="UserMessage"]'
  ],
  assistantMessage: [
    '[data-message-author-role="assistant"]',
    '[class*="assistant-message"]',
    '[class*="AssistantMessage"]',
    '[class*="bot-message"]'
  ],
  // Content inside a message
  messageContent: [
    '.markdown',
    '[class*="markdown"]',
    '[class*="prose"]',
    '[class*="message-content"]',
    '[class*="MessageContent"]'
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
        error: 'No conversation found. Make sure a chat with messages is open.'
      });
      return;
    }

    sendResponse({ success: true, turns });

  } catch (err) {
    sendResponse({
      success: false,
      error: `ChatGPT reader error: ${err.message}`
    });
  }

  return true;
});

// ─── Core Extraction ──────────────────────────────────────────────────────────

function extractConversation() {
  // Strategy 1: data-message-author-role (most reliable for ChatGPT)
  let turns = extractByAuthorRole();
  if (turns.length > 0) return turns;

  // Strategy 2: class pattern matching
  turns = extractByClassPattern();
  if (turns.length > 0) return turns;

  // Strategy 3: article elements (ChatGPT wraps messages in <article>)
  turns = extractByArticle();
  return turns;
}

// ── Strategy 1: data-message-author-role ─────────────────────────────────────

function extractByAuthorRole() {
  const allMessages = document.querySelectorAll('[data-message-author-role]');
  if (allMessages.length === 0) return [];

  const turns = [];

  allMessages.forEach(el => {
    const role = el.getAttribute('data-message-author-role');
    if (role !== 'user' && role !== 'assistant') return;

    const text = extractTextFromElement(el);
    if (!text || text.length < 1) return;

    turns.push({
      role:    role === 'user' ? 'user' : 'assistant',
      content: text
    });
  });

  return turns;
}

// ── Strategy 2: Class pattern matching ───────────────────────────────────────

function extractByClassPattern() {
  const userPatterns      = ['user-message', 'UserMessage', 'human-message'];
  const assistantPatterns = ['assistant-message', 'AssistantMessage', 'bot-message', 'gpt-message'];

  const allElements = document.querySelectorAll('div, article');
  const matched     = [];

  allElements.forEach(el => {
    const cls = el.className || '';

    const isUser      = userPatterns.some(p => cls.includes(p));
    const isAssistant = assistantPatterns.some(p => cls.includes(p));

    if (!isUser && !isAssistant) return;

    const text = extractTextFromElement(el);
    if (!text || text.length < 5) return;

    matched.push({
      el,
      role: isUser ? 'user' : 'assistant',
      text
    });
  });

  // Sort by DOM order
  matched.sort((a, b) => {
    const pos = a.el.compareDocumentPosition(b.el);
    return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });

  // Deduplicate nested matches
  const deduped = [];
  for (const item of matched) {
    const isDuplicate = deduped.some(d =>
      d.el.contains(item.el) || item.el.contains(d.el)
    );
    if (!isDuplicate) deduped.push(item);
  }

  return deduped.map(t => ({ role: t.role, content: t.text }));
}

// ── Strategy 3: Article elements ─────────────────────────────────────────────

function extractByArticle() {
  // ChatGPT sometimes wraps each turn in an <article>
  const articles = document.querySelectorAll('article');
  if (articles.length === 0) return [];

  const turns = [];

  articles.forEach((article, index) => {
    const text = extractTextFromElement(article);
    if (!text || text.length < 5) return;

    // Odd index = user, even index = assistant (ChatGPT pattern)
    // Try to detect from aria or class first
    let role = 'assistant';

    const ariaLabel = article.getAttribute('aria-label') || '';
    if (ariaLabel.toLowerCase().includes('you said') ||
        ariaLabel.toLowerCase().includes('user')) {
      role = 'user';
    } else if (index % 2 === 0) {
      role = 'user';
    }

    turns.push({ role, content: text });
  });

  return turns;
}

// ─── Text Extraction ──────────────────────────────────────────────────────────

function extractTextFromElement(el) {
  if (!el) return '';

  const clone = el.cloneNode(true);

  // Remove UI chrome
  const removeSelectors = [
    'button',
    'svg',
    '[class*="copy"]',
    '[class*="action"]',
    '[class*="button"]',
    '[class*="toolbar"]',
    '[class*="Toolbar"]',
    '[aria-label*="Copy"]',
    '[aria-label*="Edit"]',
    '[aria-label*="Regenerate"]',
    '.sr-only',
    '[class*="tooltip"]'
  ];

  removeSelectors.forEach(sel => {
    clone.querySelectorAll(sel).forEach(node => node.remove());
  });

  // Preserve code blocks
  clone.querySelectorAll('pre code').forEach(code => {
    // Try to get language from class e.g. "language-python"
    const langClass = Array.from(code.classList)
      .find(c => c.startsWith('language-'));
    const lang    = langClass ? langClass.replace('language-', '') : '';
    const marker  = lang ? `\`\`\`${lang}\n` : '```\n';
    const wrapped = document.createTextNode(`\n${marker}${code.textContent}\n\`\`\`\n`);
    code.replaceWith(wrapped);
  });

  // Handle standalone <pre> (no code child)
  clone.querySelectorAll('pre').forEach(pre => {
    if (!pre.querySelector('code')) {
      const wrapped = document.createTextNode(`\n\`\`\`\n${pre.textContent}\n\`\`\`\n`);
      pre.replaceWith(wrapped);
    }
  });

  // Convert <br> to newlines
  clone.querySelectorAll('br').forEach(br => {
    br.replaceWith(document.createTextNode('\n'));
  });

  // Headings — add markdown-style prefixes
  const headingMap = { H1: '#', H2: '##', H3: '###', H4: '####' };
  Object.entries(headingMap).forEach(([tag, prefix]) => {
    clone.querySelectorAll(tag.toLowerCase()).forEach(h => {
      h.insertAdjacentText('beforebegin', `\n${prefix} `);
      h.insertAdjacentText('afterend', '\n');
    });
  });

  // List items
  clone.querySelectorAll('li').forEach(li => {
    li.insertAdjacentText('beforebegin', '\n• ');
  });

  // Paragraphs and divs — preserve spacing
  clone.querySelectorAll('p, div').forEach(block => {
    if (block.textContent.trim()) {
      block.insertAdjacentText('afterend', '\n');
    }
  });

  return clone.textContent
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}