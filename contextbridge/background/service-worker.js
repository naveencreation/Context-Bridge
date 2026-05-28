/**
 * ContextBridge — Service Worker (Background)
 * Handles: Gemini API calls, tab management,
 * script injection into target platforms.
 */

'use strict';

// ─── Constants ───────────────────────────────────────────────────────────────

const PLATFORM_URLS = {
  claude:  'https://claude.ai/new',
  chatgpt: 'https://chatgpt.com/',
  gemini:  'https://gemini.google.com/app'
};

const PLATFORM_NAMES = {
  claude:  'Claude.ai',
  chatgpt: 'ChatGPT',
  gemini:  'Google Gemini'
};

const INJECTOR_SCRIPTS = {
  claude:  'content/injectors/claude-injector.js',
  chatgpt: 'content/injectors/chatgpt-injector.js',
  gemini:  'content/injectors/gemini-injector.js'
};

const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

// Extra delay (ms) after tab load for SPA to render
const SPA_RENDER_DELAY = {
  claude:  3000,
  chatgpt: 3500,
  gemini:  3000
};

// ─── Message Router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, payload } = message;

  switch (type) {

    case 'SUMMARIZE_CONVERSATION':
      handleSummarize(payload)
        .then(data  => sendResponse({ success: true,  data }))
        .catch(err  => sendResponse({ success: false, error: err.message }));
      return true; // keep channel open for async

    case 'OPEN_AND_INJECT':
      handleOpenAndInject(payload)
        .then(()   => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'PING':
      sendResponse({ success: true, alive: true });
      break;

    default:
      sendResponse({ success: false, error: `Unknown message type: ${type}` });
  }
});

// ─── Summarize via Gemini API ─────────────────────────────────────────────────

async function handleSummarize({ turns, apiKey }) {
  if (!apiKey || apiKey.trim() === '') {
    throw new Error(
      'Gemini API key is not set. Please open Settings and add your API key.'
    );
  }

  if (!turns || turns.length === 0) {
    throw new Error('No conversation turns to summarize.');
  }

  // Build conversation text
  const conversationText = turns
    .map(t => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content.trim()}`)
    .join('\n\n');

  const prompt = buildSummarizationPrompt(conversationText);

  // Call Gemini
  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        temperature:     0.2,
        maxOutputTokens: 1500,
        topK:            40,
        topP:            0.95
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
      ]
    })
  });

  if (!response.ok) {
    let errMsg = `Gemini API error: ${response.status} ${response.statusText}`;
    try {
      const errData = await response.json();
      if (errData?.error?.message) errMsg = `Gemini: ${errData.error.message}`;
    } catch (_) { /* ignore parse error */ }
    throw new Error(errMsg);
  }

  const data = await response.json();

  // Validate response shape
  if (!data.candidates || data.candidates.length === 0) {
    throw new Error(
      'Gemini returned no candidates. The content may have been blocked by safety filters.'
    );
  }

  const candidate = data.candidates[0];

  if (candidate.finishReason === 'SAFETY') {
    throw new Error(
      'Gemini blocked this summarization due to safety filters. Try the Raw Copy mode instead.'
    );
  }

  if (candidate.finishReason === 'MAX_TOKENS') {
    console.warn('[ContextBridge] Gemini hit max tokens — summary may be truncated.');
  }

  const summaryText = candidate?.content?.parts?.[0]?.text;
  if (!summaryText) {
    throw new Error('Gemini returned an empty summary. Please try again.');
  }

  return summaryText;
}

function buildSummarizationPrompt(conversationText) {
  return `You are a professional AI conversation summarizer.

Your job is to read a conversation between a user and an AI assistant, then produce a structured context brief that a DIFFERENT AI assistant can use to seamlessly continue the conversation.

Return ONLY the structured brief below. No preamble. No explanation. No markdown formatting outside the structure.

TOPIC: [main subject or project being discussed]
BACKGROUND: [essential background information and constraints established]
KEY DECISIONS MADE:
- [decision or conclusion 1]
- [decision or conclusion 2]
TECHNICAL DETAILS:
- [important technical or factual detail 1]
- [important technical or factual detail 2]
CURRENT OBJECTIVE: [what the user is actively trying to accomplish right now]
LAST ASSISTANT RESPONSE: [one sentence summary of what the assistant last said or did]
WHERE WE LEFT OFF: [exact state — what was just asked, what is unresolved, what the next step is]
CRITICAL CONTEXT: [anything else the next AI must know to help effectively without asking again]

Conversation to summarize:
${'─'.repeat(60)}
${conversationText}
${'─'.repeat(60)}`;
}

// ─── Open Tab & Inject ────────────────────────────────────────────────────────

async function handleOpenAndInject({ targetPlatform, content }) {
  if (!PLATFORM_URLS[targetPlatform]) {
    throw new Error(`Unsupported target platform: "${targetPlatform}"`);
  }

  if (!content || content.trim() === '') {
    throw new Error('No content to inject.');
  }

  // 1. Store payload in local storage so the injector can pick it up
  await chrome.storage.local.set({
    pendingInjection: {
      content,
      targetPlatform,
      timestamp: Date.now()
    }
  });

  // 2. Open new tab
  const tab = await chrome.tabs.create({ url: PLATFORM_URLS[targetPlatform] });

  // 3. Wait for the tab's page to fully load
  await waitForTabComplete(tab.id);

  // 4. Extra delay for the SPA framework to render its UI
  await sleep(SPA_RENDER_DELAY[targetPlatform] || 3000);

  // 5. Inject the platform-specific injector script
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [INJECTOR_SCRIPTS[targetPlatform]]
    });
  } catch (error) {
    // Clean up pending injection on failure
    await chrome.storage.local.remove('pendingInjection');
    throw new Error(
      `Failed to inject script into ${PLATFORM_NAMES[targetPlatform]}: ${error.message}. ` +
      `Make sure you are not in Incognito mode and the extension has permissions.`
    );
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns a Promise that resolves when the given tab reaches status "complete".
 * Rejects after 30 seconds.
 */
function waitForTabComplete(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tab took too long to load (30s timeout). Please try again.'));
    }, 30000);

    function listener(id, changeInfo) {
      if (id === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);

    // Also check immediately in case tab is already complete
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) return;
      if (tab.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}