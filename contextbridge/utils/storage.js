/**
 * ContextBridge — Storage Utility
 * Unified wrapper around chrome.storage with validation,
 * defaults, and error handling. Works in both content
 * scripts and the service worker.
 */

(function () {
  'use strict';

  // Default settings applied when a key is missing
  const DEFAULTS = {
    geminiApiKey: '',
    transferMode: 'raw',          // 'raw' | 'summary'
    autoSend: false,              // auto-press send after injecting
    maxTurns: 100,                // max conversation turns to extract
    showPreview: true,            // show preview in popup
    lastUsedTarget: null,         // last platform transferred to
    theme: 'dark'                 // 'dark' | 'light'
  };

  // Keys that hold sensitive data — never log these
  const SENSITIVE_KEYS = ['geminiApiKey'];

  /**
   * Safely get chrome.storage.sync (preferred) or local as fallback.
   * sync has a 100KB quota but works across devices.
   * local has 10MB quota but stays on one machine.
   */
  function getSyncStorage() {
    return chrome.storage.sync || chrome.storage.local;
  }

  function getLocalStorage() {
    return chrome.storage.local;
  }

  /**
   * Get a single setting value.
   * Returns the default if the key is not set.
   * @param {string} key
   * @returns {Promise<any>}
   */
  async function get(key) {
    try {
      const result = await getSyncStorage().get(key);
      const value = result[key];
      if (value === undefined || value === null) {
        return DEFAULTS[key] ?? null;
      }
      return value;
    } catch (error) {
      console.error(`[ContextBridge] Storage.get failed for key "${key}":`, error);
      return DEFAULTS[key] ?? null;
    }
  }

  /**
   * Get multiple setting values at once.
   * @param {string[]} keys
   * @returns {Promise<object>}
   */
  async function getMany(keys) {
    try {
      const result = await getSyncStorage().get(keys);
      const out = {};
      for (const key of keys) {
        out[key] = result[key] !== undefined ? result[key] : (DEFAULTS[key] ?? null);
      }
      return out;
    } catch (error) {
      console.error('[ContextBridge] Storage.getMany failed:', error);
      const out = {};
      for (const key of keys) {
        out[key] = DEFAULTS[key] ?? null;
      }
      return out;
    }
  }

  /**
   * Get all settings, merging stored values with defaults.
   * @returns {Promise<object>}
   */
  async function getAll() {
    try {
      const result = await getSyncStorage().get(null);
      return { ...DEFAULTS, ...result };
    } catch (error) {
      console.error('[ContextBridge] Storage.getAll failed:', error);
      return { ...DEFAULTS };
    }
  }

  /**
   * Set a single value.
   * @param {string} key
   * @param {any} value
   * @returns {Promise<void>}
   */
  async function set(key, value) {
    validateKey(key, value);
    try {
      await getSyncStorage().set({ [key]: value });
    } catch (error) {
      console.error(
        `[ContextBridge] Storage.set failed for key "${key}":`,
        SENSITIVE_KEYS.includes(key) ? '[redacted]' : error
      );
      throw error;
    }
  }

  /**
   * Set multiple values at once.
   * @param {object} obj
   * @returns {Promise<void>}
   */
  async function setMany(obj) {
    for (const [key, value] of Object.entries(obj)) {
      validateKey(key, value);
    }
    try {
      await getSyncStorage().set(obj);
    } catch (error) {
      console.error('[ContextBridge] Storage.setMany failed:', error);
      throw error;
    }
  }

  /**
   * Remove a key from storage.
   * @param {string} key
   * @returns {Promise<void>}
   */
  async function remove(key) {
    try {
      await getSyncStorage().remove(key);
    } catch (error) {
      console.error(`[ContextBridge] Storage.remove failed for key "${key}":`, error);
      throw error;
    }
  }

  /**
   * Clear all ContextBridge settings (reset to defaults).
   * @returns {Promise<void>}
   */
  async function clearAll() {
    try {
      await getSyncStorage().clear();
    } catch (error) {
      console.error('[ContextBridge] Storage.clearAll failed:', error);
      throw error;
    }
  }

  /**
   * Store pending injection data in local storage (session-like).
   * Used by service worker to pass content to injector scripts.
   * @param {object} payload
   * @returns {Promise<void>}
   */
  async function setPendingInjection(payload) {
    try {
      await getLocalStorage().set({
        pendingInjection: {
          ...payload,
          timestamp: Date.now()
        }
      });
    } catch (error) {
      console.error('[ContextBridge] Storage.setPendingInjection failed:', error);
      throw error;
    }
  }

  /**
   * Retrieve and immediately clear the pending injection payload.
   * @returns {Promise<object|null>}
   */
  async function consumePendingInjection() {
    try {
      const result = await getLocalStorage().get('pendingInjection');
      const payload = result.pendingInjection || null;

      if (payload) {
        // Expire payloads older than 2 minutes
        const age = Date.now() - (payload.timestamp || 0);
        if (age > 120000) {
          await getLocalStorage().remove('pendingInjection');
          return null;
        }
        // Consume it
        await getLocalStorage().remove('pendingInjection');
      }

      return payload;
    } catch (error) {
      console.error('[ContextBridge] Storage.consumePendingInjection failed:', error);
      return null;
    }
  }

  /**
   * Validate a key/value before storing.
   * Throws on invalid inputs to prevent silent corruption.
   */
  function validateKey(key, value) {
    if (typeof key !== 'string' || key.trim() === '') {
      throw new Error(`[ContextBridge] Storage key must be a non-empty string. Got: ${key}`);
    }
    if (value === undefined) {
      throw new Error(`[ContextBridge] Storage value for "${key}" is undefined. Use null to clear.`);
    }
    // Validate known keys
    if (key === 'maxTurns') {
      if (typeof value !== 'number' || value < 1 || value > 500) {
        throw new Error('[ContextBridge] maxTurns must be a number between 1 and 500.');
      }
    }
    if (key === 'transferMode') {
      if (!['raw', 'summary'].includes(value)) {
        throw new Error('[ContextBridge] transferMode must be "raw" or "summary".');
      }
    }
    if (key === 'theme') {
      if (!['dark', 'light'].includes(value)) {
        throw new Error('[ContextBridge] theme must be "dark" or "light".');
      }
    }
  }

  // Expose globally
  globalThis.CBStorage = {
    DEFAULTS,
    get,
    getMany,
    getAll,
    set,
    setMany,
    remove,
    clearAll,
    setPendingInjection,
    consumePendingInjection
  };

})();