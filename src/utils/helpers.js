/**
 * Helper Utilities module
 *
 * Contains common utility functions used across the application.
 */

'use strict';

/**
 * Simple promise-based delay function.
 * @param {number} ms - Milliseconds to delay.
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Validates if a string is a non-empty string.
 * @param {*} str - The value to validate.
 * @returns {boolean} - True if str is a non-empty string, false otherwise.
 */
function isNonEmptyString(str) {
    return typeof str === 'string' && str.trim().length > 0;
}

/**
 * Sanitize a string to be used as part of a directory or file name.
 * Replaces non-alphanumeric characters (excluding hyphens and underscores) with an underscore.
 * @param {string} inputString - The string to sanitize.
 * @returns {string} - The sanitized string.
 */
function sanitizeForFileSystem(inputString) {
    if (!inputString) return '';
    return inputString.replace(/[^a-zA-Z0-9_-]/g, '_');
}


module.exports = {
  delay,
  isNonEmptyString,
  sanitizeForFileSystem,
};