/**
 * GitHub API Utility module
 *
 * Handles direct interactions with the GitHub API using Octokit.
 */

'use strict';

const { Octokit } = require('octokit'); //
const { logger } = require('../modules/logger');

let octokitInstance;

/**
 * Initialize the Octokit client.
 * @param {string} authToken - GitHub personal access token.
 */
function initializeGitHubClient(authToken) {
  if (!authToken) {
    logger.warn('GitHub auth token not provided. GitHub API client will not be initialized.');
    octokitInstance = null;
    return;
  }
  octokitInstance = new Octokit({ auth: authToken });
  logger.info('Octokit client initialized for GitHub API interactions.');
}

/**
 * Get the Octokit instance.
 * @returns {Octokit|null} The initialized Octokit instance, or null if not initialized.
 * @throws {Error} if client is not initialized.
 */
function getOctokit() {
  if (!octokitInstance) {
    // logger.warn('Octokit client accessed before initialization.');
    throw new Error('Octokit client has not been initialized. Call initializeGitHubClient(token) first.');
  }
  return octokitInstance;
}

// Example function (add more as needed)
/**
 * Get repository details.
 * @param {string} owner - The owner of the repository.
 * @param {string} repo - The name of the repository.
 * @returns {Promise<Object|null>} Repository data or null on error.
 */
async function getRepoDetails(owner, repo) {
  if (!octokitInstance) {
    logger.error('Cannot get repo details: Octokit client not initialized.');
    return null;
  }
  try {
    logger.info(`Workspaceing details for repository: ${owner}/${repo}`);
    const response = await octokitInstance.request('GET /repos/{owner}/{repo}', {
      owner,
      repo,
    });
    return response.data;
  } catch (error) {
    logger.error(`Error fetching repository details for ${owner}/${repo}:`, error);
    return null;
  }
}

module.exports = {
  initializeGitHubClient,
  getOctokit,
  getRepoDetails,
  // Add other GitHub API utility functions here
};