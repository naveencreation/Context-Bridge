/**
 * ContextBridge — Platform Detector
 * Detects which AI platform the user is currently on,
 * and provides metadata about all supported platforms.
 */

(function () {
  'use strict';

  const PLATFORMS = {
    claude: {
      id: 'claude',
      name: 'Claude.ai',
      shortName: 'Claude',
      emoji: '🟠',
      color: '#f97316',
      badgeClass: 'claude',
      url: 'https://claude.ai/new',
      hostname: 'claude.ai',
      newChatPath: '/new'
    },
    chatgpt: {
      id: 'chatgpt',
      name: 'ChatGPT',
      shortName: 'ChatGPT',
      emoji: '🟢',
      color: '#10b981',
      badgeClass: 'chatgpt',
      url: 'https://chatgpt.com/',
      hostname: 'chatgpt.com',
      newChatPath: '/'
    },
    gemini: {
      id: 'gemini',
      name: 'Google Gemini',
      shortName: 'Gemini',
      emoji: '🔵',
      color: '#3b82f6',
      badgeClass: 'gemini',
      url: 'https://gemini.google.com/app',
      hostname: 'gemini.google.com',
      newChatPath: '/app'
    },
    unknown: {
      id: 'unknown',
      name: 'Unknown',
      shortName: 'Unknown',
      emoji: '⚪',
      color: '#6b7280',
      badgeClass: '',
      url: null,
      hostname: null,
      newChatPath: null
    }
  };

  /**
   * Detect platform from a full URL string.
   * @param {string} url
   * @returns {string} platform id
   */
  function detectFromUrl(url) {
    if (!url || typeof url !== 'string') return 'unknown';

    try {
      const { hostname } = new URL(url);

      if (hostname === 'claude.ai' || hostname.endsWith('.claude.ai')) {
        return 'claude';
      }
      if (
        hostname === 'chatgpt.com' ||
        hostname === 'chat.openai.com' ||
        hostname.endsWith('.chatgpt.com')
      ) {
        return 'chatgpt';
      }
      if (hostname === 'gemini.google.com') {
        return 'gemini';
      }
    } catch (_) {
      // Invalid URL
    }

    return 'unknown';
  }

  /**
   * Detect platform from current window location (use in content scripts).
   * @returns {string} platform id
   */
  function detectCurrent() {
    return detectFromUrl(window.location.href);
  }

  /**
   * Get full platform metadata object by id.
   * @param {string} platformId
   * @returns {object}
   */
  function getPlatformInfo(platformId) {
    return PLATFORMS[platformId] || PLATFORMS.unknown;
  }

  /**
   * Get all supported platforms (excludes unknown).
   * @returns {object[]}
   */
  function getAllPlatforms() {
    return Object.values(PLATFORMS).filter(p => p.id !== 'unknown');
  }

  /**
   * Check if a platform id is supported.
   * @param {string} platformId
   * @returns {boolean}
   */
  function isSupported(platformId) {
    return platformId !== 'unknown' && Boolean(PLATFORMS[platformId]);
  }

  /**
   * Get the new chat URL for a target platform.
   * @param {string} platformId
   * @returns {string|null}
   */
  function getNewChatUrl(platformId) {
    return PLATFORMS[platformId]?.url || null;
  }

  // Expose on globalThis so all scripts can access it
  globalThis.PlatformDetector = {
    PLATFORMS,
    detectFromUrl,
    detectCurrent,
    getPlatformInfo,
    getAllPlatforms,
    isSupported,
    getNewChatUrl
  };

})();