Great choices. Let me put together a full plan.

---

## 🧩 Extension Name Idea: **ContextBridge**

---

## 1. Big Picture Architecture

The extension has 4 core responsibilities:

```
[Read]  →  [Process]  →  [Package]  →  [Inject]
Extract     Summarize     Wrap with     Paste into
the chat    or keep raw   smart prompt  target platform
```

---

## 2. Supported Platforms (Phase-wise)

**Phase 1 — Core platforms**
- Claude.ai
- ChatGPT (chat.openai.com)

**Phase 2 — Expand**
- Google Gemini
- Microsoft Copilot
- Perplexity

Each platform needs its own **Reader** and **Injector** module since their DOM structures are completely different.

---

## 3. Technical Stack

| Layer | Choice | Why |
|---|---|---|
| Extension standard | Manifest V3 | Works on both Chrome & Firefox |
| Language | Vanilla JS + HTML/CSS | No build step, simpler to maintain |
| AI Summarization | Gemini API (gemini-2.5-flash) | Fast, cheap, perfect for summarizing |
| Storage | Chrome/Firefox `storage.sync` | Save user preferences across devices |

---

## 4. Extension Components

**A. Content Scripts** (runs inside each AI platform tab)
- One script per platform: `claude-reader.js`, `chatgpt-reader.js` etc.
- Walks the DOM and extracts conversation turns as structured JSON
- Listens for the popup's "extract" command

**B. Popup UI** (the little window when you click the extension icon)
- Shows the current platform detected
- Lets user choose: Raw Copy vs AI Summary
- Shows a preview of what will be transferred
- "Open in → [platform]" button

**C. Background Service Worker**
- Handles communication between popup and content scripts
- Calls the Gemini API for summarization
- Opens the target platform tab and coordinates injection

**D. Injector Scripts** (runs inside the target platform tab)
- Finds the chat input box
- Types/pastes the packaged context
- Triggers the send action (optional — user may want to review first)

---

## 5. The Data Flow (Step by Step)

```
1. User is on Claude.ai, hits the limit
2. Clicks ContextBridge extension icon
3. Popup detects "You are on Claude.ai"
4. User picks: Raw Copy or AI Summary
5. Extension reads all conversation turns from the DOM
6. If Summary → calls Gemini API to compress it
7. Wraps output in a smart context prompt
8. User clicks "Transfer to ChatGPT"
9. Extension opens chat.openai.com in new tab
10. Injects the packaged context into the input box
11. User reviews and hits send
```

---

## 6. The Smart Context Prompt (the secret sauce)

This is what gets injected — not just raw text:

```
[CONTEXT TRANSFER — ContextBridge]

You are continuing a conversation that was started on another AI platform. 
Below is the full conversation history. Please read it carefully and 
continue as a knowledgeable assistant with complete awareness of everything discussed.

--- CONVERSATION START ---
User: ...
Assistant: ...
(full turns)
--- CONVERSATION END ---

The user's last message was: "..."
Please continue from exactly here.
```

For the **Summary mode**, it would look like:

```
[CONTEXT TRANSFER — ContextBridge Summary]

Here is a structured brief of a prior conversation:

TOPIC: Building a microservices audit reconciliation system
KEY DECISIONS MADE:
  - Event-driven architecture using Kafka
  - 25+ agent types for TDS, GST, EPF reconciliation
  - ...
CURRENT PROBLEM BEING SOLVED: ...
WHERE WE LEFT OFF: ...

Please continue assisting with full context of the above.
```

---

## 7. Folder Structure

```
contextbridge/
├── manifest.json
├── manifest.firefox.json
├── package.json
├── icons/
│   └── (generate icons - instructions at the end)
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── settings/
│   ├── settings.html
│   ├── settings.css
│   └── settings.js
├── background/
│   └── service-worker.js
├── content/
│   ├── readers/
│   │   ├── claude-reader.js
│   │   ├── chatgpt-reader.js
│   │   └── gemini-reader.js
│   └── injectors/
│       ├── claude-injector.js
│       ├── chatgpt-injector.js
│       └── gemini-injector.js
└── utils/
    ├── browser-polyfill.js
    ├── platform-detector.js
    ├── prompt-builder.js
    └── storage.js
```

---

## 8. Key Challenges to Solve

| Challenge | Solution |
|---|---|
| DOM changes when platform updates their UI | Reader scripts use multiple CSS selector fallbacks |
| Long conversations exceed input limits | Summary mode + auto-truncate with "most recent N turns" option |
| Platform blocks programmatic input | Use `InputEvent` + `clipboardData` simulation |
| API key for summarization | User stores their own Gemini API key in extension settings |
| Firefox vs Chrome API differences | Thin `browser-polyfill.js` wrapper |

---

## 9. Phased Build Plan

**Week 1 — Foundation**
- `manifest.json` for both browsers
- Platform detector
- Claude reader script
- Basic popup UI

**Week 2 — Transfer**
- ChatGPT injector
- Raw copy mode working end-to-end
- Prompt builder

**Week 3 — Intelligence**
- Summarizer API integration
- Summary mode UI
- Settings page (API key, preferences)

**Week 4 — Polish**
- Add Gemini reader/injector
- Error handling (platform not detected, DOM changed, etc.)
- Chrome Web Store + Firefox Add-ons submission

---

## 10. What We Are NOT Building (to keep scope clean)

- No cloud storage of conversations (privacy-first)
- No login/account system
- No automatic sending — user always reviews before sending
- No mobile support (extensions are desktop-only)

---

This is a well-scoped, buildable project. The hardest part will be the **reader scripts** since each platform's DOM is unique and can change anytime.

Ready to start coding? I'd suggest we begin with `manifest.json` + the **platform detector** + **Claude reader** as the first working slice.