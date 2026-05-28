/**
 * ContextBridge — Browser Polyfill
 * Normalizes chrome.* and browser.* APIs across Chrome and Firefox.
 * This file is injected first in every content script and the service worker.
 */

(function () {
  'use strict';

  // If browser is already defined (Firefox native), nothing to do
  if (typeof globalThis.browser !== 'undefined') return;

  // If chrome is not defined either, we're in an unsupported environment
  if (typeof globalThis.chrome === 'undefined') return;

  /**
   * Wraps a chrome.* method that uses callbacks into a Promise-returning function.
   * If the original already returns a Promise (MV3 Chrome), it passes through.
   */
  function promisify(fn, context) {
    return function (...args) {
      // If last arg is already a function (callback style), call directly
      if (typeof args[args.length - 1] === 'function') {
        return fn.apply(context, args);
      }
      return new Promise((resolve, reject) => {
        fn.apply(context, [
          ...args,
          function (result) {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(result);
            }
          }
        ]);
      });
    };
  }

  /**
   * Recursively wraps an API namespace object.
   * Functions get promisified; sub-namespaces are wrapped recursively.
   * Event objects (with addListener) are passed through as-is.
   */
  function wrapNamespace(chromeObj) {
    if (!chromeObj || typeof chromeObj !== 'object') return chromeObj;

    const wrapped = {};

    for (const key of Object.keys(chromeObj)) {
      const value = chromeObj[key];

      if (typeof value === 'function') {
        // Promisify all functions except those that deal with events
        wrapped[key] = promisify(value, chromeObj);
      } else if (
        value &&
        typeof value === 'object' &&
        typeof value.addListener === 'function'
      ) {
        // This is an event — pass through directly
        wrapped[key] = value;
      } else if (value && typeof value === 'object') {
        // Recurse into sub-namespaces
        wrapped[key] = wrapNamespace(value);
      } else {
        // Primitive — pass through
        wrapped[key] = value;
      }
    }

    return wrapped;
  }

  // Build the browser polyfill from chrome namespaces we use
  const namespacesToWrap = [
    'runtime',
    'tabs',
    'storage',
    'scripting',
    'action',
    'windows'
  ];

  const browserPolyfill = {};

  for (const ns of namespacesToWrap) {
    if (chrome[ns]) {
      browserPolyfill[ns] = wrapNamespace(chrome[ns]);
    }
  }

  // Expose as globalThis.browser
  globalThis.browser = browserPolyfill;

  // Convenience: also expose a unified API reference for our own code
  globalThis.cbAPI = globalThis.browser;

})();