/**
 * ContextBridge — Prompt Builder
 * Builds the final transfer prompt that gets injected
 * into the target platform. Two modes: raw and summary.
 */

(function () {
  'use strict';

  /**
   * Build a RAW transfer prompt.
   * Includes the full conversation transcript wrapped in
   * a clear context-transfer instruction block.
   *
   * @param {Array<{role: string, content: string}>} turns
   * @param {string} sourcePlatformName  e.g. "Claude.ai"
   * @returns {string}
   */
  function buildRawPrompt(turns, sourcePlatformName) {
    if (!turns || turns.length === 0) {
      throw new Error('Cannot build prompt: no conversation turns provided.');
    }

    const formatted = turns
      .map((t, i) => {
        const roleLabel = t.role === 'user' ? '👤 User' : '🤖 Assistant';
        const content = t.content.trim();
        return `[Turn ${i + 1}] ${roleLabel}:\n${content}`;
      })
      .join('\n\n' + '─'.repeat(60) + '\n\n');

    const lastTurn = turns[turns.length - 1];
    const lastRole = lastTurn.role === 'user' ? 'the user asked a question' : 'the assistant gave a response';

    return `╔══════════════════════════════════════════════════════════╗
║           CONTEXT TRANSFER — ContextBridge               ║
╚══════════════════════════════════════════════════════════╝

You are continuing an ongoing conversation that was started on ${sourcePlatformName}.

The conversation had to be moved to a new platform due to usage limits.
Please read the FULL conversation history below carefully, then continue
as a knowledgeable assistant with complete awareness of everything
that has been discussed so far.

Important instructions:
- Do NOT summarize or acknowledge the transfer — just continue naturally
- Maintain the same tone, style, and depth as the previous assistant
- The last thing that happened is that ${lastRole}
- Continue directly from where the conversation left off

${'═'.repeat(62)}
CONVERSATION HISTORY (${turns.length} messages from ${sourcePlatformName})
${'═'.repeat(62)}

${formatted}

${'═'.repeat(62)}
END OF CONVERSATION HISTORY
${'═'.repeat(62)}

The conversation above has now been transferred to you.
Please continue naturally from where the last message left off.`;
  }

  /**
   * Build a SUMMARY transfer prompt.
   * Uses the Gemini-generated structured brief as context.
   *
   * @param {string} summary  The structured summary from Gemini
   * @param {string} sourcePlatformName  e.g. "Claude.ai"
   * @returns {string}
   */
  function buildSummaryPrompt(summary, sourcePlatformName) {
    if (!summary || summary.trim() === '') {
      throw new Error('Cannot build summary prompt: summary is empty.');
    }

    return `╔══════════════════════════════════════════════════════════╗
║       CONTEXT TRANSFER (Summary) — ContextBridge         ║
╚══════════════════════════════════════════════════════════╝

You are continuing a conversation that was started on ${sourcePlatformName}.

The conversation has been summarized by an AI to preserve the key
context. Read the structured brief below carefully, then continue
as a knowledgeable assistant with full awareness of this context.

Important instructions:
- Do NOT mention that this is a summary or a transfer — just continue
- Treat this context as if you were already part of the conversation
- Match the tone and expertise level described in the brief
- Pick up exactly from "WHERE WE LEFT OFF"

${'═'.repeat(62)}
CONVERSATION CONTEXT BRIEF
${'═'.repeat(62)}

${summary.trim()}

${'═'.repeat(62)}
END OF CONTEXT BRIEF
${'═'.repeat(62)}

You now have full context of the conversation. Please continue
assisting the user from exactly where we left off.`;
  }

  /**
   * Truncate turns to stay within a character limit.
   * Keeps the MOST RECENT turns (they matter most for context).
   * Always keeps at least the first turn for context anchoring.
   *
   * @param {Array<{role: string, content: string}>} turns
   * @param {number} maxChars  default 80000 (~20k tokens)
   * @returns {Array<{role: string, content: string}>}
   */
  function truncateTurns(turns, maxChars = 80000) {
    if (!turns || turns.length === 0) return [];

    let totalChars = turns.reduce((sum, t) => sum + t.content.length, 0);

    if (totalChars <= maxChars) return turns;

    // Always keep first turn for context, drop from the middle
    const result = [...turns];
    let dropped = 0;

    while (
      totalChars > maxChars &&
      result.length > 2
    ) {
      // Remove second item (keep first + last N)
      const removed = result.splice(1, 1)[0];
      totalChars -= removed.content.length;
      dropped++;
    }

    if (dropped > 0) {
      // Insert a notice where we dropped turns
      result.splice(1, 0, {
        role: 'system',
        content: `[${dropped} earlier messages were omitted to fit the context limit]`
      });
    }

    return result;
  }

  /**
   * Count approximate tokens in a string.
   * Uses the rough heuristic of 1 token ≈ 4 chars.
   * @param {string} text
   * @returns {number}
   */
  function estimateTokens(text) {
    return Math.ceil((text || '').length / 4);
  }

  /**
   * Get a short preview string from turns (for popup display).
   * @param {Array<{role: string, content: string}>} turns
   * @param {number} maxLength
   * @returns {string}
   */
  function buildPreview(turns, maxLength = 120) {
    if (!turns || turns.length === 0) return 'No messages found.';
    const first = turns[0];
    const label = first.role === 'user' ? 'You' : 'AI';
    const content = first.content.trim().replace(/\n+/g, ' ');
    return `${label}: ${content.length > maxLength
      ? content.slice(0, maxLength) + '...'
      : content}`;
  }

  // Expose globally
  globalThis.PromptBuilder = {
    buildRawPrompt,
    buildSummaryPrompt,
    truncateTurns,
    estimateTokens,
    buildPreview
  };

})();