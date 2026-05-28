/**
 * ContextBridge — Claude.ai Reader
 * Extracts conversation turns from Claude.ai's DOM.
 * Injected as a content script on claude.ai pages.
 */

'use strict';

// ─── Selectors (in priority order, fallbacks if Claude updates their UI) ──────

const SELECTORS = {
  // Outer container for each message bubble
  messageBubble: [
    '[data-testid="human-turn"]',
    '[data-testid="ai-turn"]',
    '.human-turn',
    '.ai-turn',
    '[class*="HumanTurn"]',
    '[class*="AssistantTurn"]'
  ],

  // Human (user) message wrappers
  humanTurn: [
    '[data-testid="human-turn"]',
    '.human-turn',
    '[class*="HumanTurn"]',
    '[class*="human-turn"]'
  ],

  // Assistant message wrappers
  assistantTurn: [
    '[data-testid="ai-turn"]',
    '.ai-turn',
    '[class*="AssistantTurn"]',
    '[class*="assistant-turn"]',
    '[class*="AiTurn"]'
  ],

  // The actual text content inside a turn
  turnContent: [
    '.whitespace-pre-wrap',
    '[class*="prose"]',
    '[class*="message-content"]',
    'p',
    'div[class*="content"]'
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
        error: 'No conversation found on this page. Make sure a chat with messages is open.'
      });
      return;
    }

    sendResponse({ success: true, turns });

  } catch (err) {
    sendResponse({
      success: false,
      error: `Claude reader error: ${err.message}`
    });
  }

  return true; // keep channel open
});

// ─── Core Extraction ──────────────────────────────────────────────────────────

function extractConversation() {
  // Strategy 1: Use data-testid attributes (most reliable)
  let turns = extractByTestId();
  if (turns.length > 0) return turns;

  // Strategy 2: Use class-name patterns
  turns = extractByClassPattern();
  if (turns.length > 0) return turns;

  // Strategy 3: Generic fallback — find alternating message blocks
  turns = extractByStructure();
  return turns;
}

// ── Strategy 1: data-testid ───────────────────────────────────────────────────

function extractByTestId() {
  const turns = [];

  // Try to find all turns in document order
  const humanTurns    = document.querySelectorAll('[data-testid="human-turn"]');
  const assistantTurns = document.querySelectorAll('[data-testid="ai-turn"]');

  if (humanTurns.length === 0 && assistantTurns.length === 0) return [];

  // Collect all turns with their DOM position for ordering
  const allTurns = [];

  humanTurns.forEach(el => {
    const text = extractTextFromElement(el);
    if (text) allTurns.push({ el, role: 'user', text });
  });

  assistantTurns.forEach(el => {
    const text = extractTextFromElement(el);
    if (text) allTurns.push({ el, role: 'assistant', text });
  });

  // Sort by DOM order using compareDocumentPosition
  allTurns.sort((a, b) => {
    const pos = a.el.compareDocumentPosition(b.el);
    return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });

  return allTurns.map(t => ({ role: t.role, content: t.text }));
}

// ── Strategy 2: Class pattern matching ───────────────────────────────────────

function extractByClassPattern() {
  const turns = [];

  const humanPatterns     = ['HumanTurn', 'human-turn', 'UserMessage', 'user-message'];
  const assistantPatterns = ['AssistantTurn', 'assistant-turn', 'AiTurn', 'ai-turn', 'BotMessage'];

  const allElements = document.querySelectorAll('div, article, section');
  const matched     = [];

  allElements.forEach(el => {
    const className = el.className || '';

    const isHuman = humanPatterns.some(p =>
      className.includes(p) || el.getAttribute('class')?.includes(p)
    );
    const isAssistant = assistantPatterns.some(p =>
      className.includes(p) || el.getAttribute('class')?.includes(p)
    );

    if (isHuman || isAssistant) {
      const text = extractTextFromElement(el);
      if (text && text.length > 5) {
        matched.push({
          el,
          role: isHuman ? 'user' : 'assistant',
          text
        });
      }
    }
  });

  // Sort by DOM position
  matched.sort((a, b) => {
    const pos = a.el.compareDocumentPosition(b.el);
    return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });

  // Deduplicate (child/parent elements may both match)
  const deduped = [];
  for (const item of matched) {
    const isDuplicate = deduped.some(d =>
      d.el.contains(item.el) || item.el.contains(d.el)
    );
    if (!isDuplicate) deduped.push(item);
  }

  return deduped.map(t => ({ role: t.role, content: t.text }));
}

// ── Strategy 3: Structural fallback ──────────────────────────────────────────

function extractByStructure() {
  // Look for a scrollable chat container
  const chatContainer = findChatContainer();
  if (!chatContainer) return [];

  const children  = Array.from(chatContainer.children);
  const turns     = [];
  let   turnIndex = 0;

  for (const child of children) {
    const text = extractTextFromElement(child);
    if (!text || text.length < 10) continue;

    // Alternate user/assistant based on position (best we can do structurally)
    const role = turnIndex % 2 === 0 ? 'user' : 'assistant';
    turns.push({ role, content: text });
    turnIndex++;
  }

  return turns;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract clean text from a DOM element.
 * Handles code blocks, lists, and nested structure.
 */
function extractTextFromElement(el) {
  if (!el) return '';

  // Clone to avoid mutating the live DOM
  const clone = el.cloneNode(true);

  // Remove UI chrome: buttons, tooltips, copy-buttons, etc.
  const removeSelectors = [
    'button',
    '[aria-label]',
    '[data-testid*="copy"]',
    '[data-testid*="action"]',
    '[data-testid*="button"]',
    '.sr-only',
    '[class*="tooltip"]',
    '[class*="action-bar"]',
    '[class*="ActionBar"]',
    'svg'
  ];

  removeSelectors.forEach(sel => {
    clone.querySelectorAll(sel).forEach(node => node.remove());
  });

  // Preserve code block content with markers
  clone.querySelectorAll('pre code, pre').forEach(code => {
    const lang    = code.getAttribute('data-language') || '';
    const marker  = lang ? `\`\`\`${lang}\n` : '```\n';
    const wrapped = document.createTextNode(`\n${marker}${code.textContent}\n\`\`\`\n`);
    code.replaceWith(wrapped);
  });

  // Convert <br> to newlines
  clone.querySelectorAll('br').forEach(br => {
    br.replaceWith(document.createTextNode('\n'));
  });

  // Convert block elements to preserve paragraph spacing
  const blockEls = ['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'blockquote'];
  blockEls.forEach(tag => {
    clone.querySelectorAll(tag).forEach(block => {
      if (block.textContent.trim()) {
        block.insertAdjacentText('afterend', '\n');
      }
    });
  });

  return clone.textContent
    .replace(/\n{3,}/g, '\n\n')   // collapse excessive blank lines
    .trim();
}

/**
 * Try to find the main chat scroll container.
 */
function findChatContainer() {
  const candidates = [
    document.querySelector('[class*="conversation"]'),
    document.querySelector('[class*="chat-content"]'),
    document.querySelector('main'),
    document.querySelector('[role="main"]')
  ];

  return candidates.find(Boolean) || null;
}