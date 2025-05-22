/**
 * Tester module
 *
 * Handles running automated tests in a repository.
 */

'use strict';

const { exec } = require('child_process');
const { logger } = require('./logger'); // Using global logger, or pass sessionLogger if preferred
const path = require('path');
const fs = require('fs');

/**
 * Run tests in the specified repository directory.
 * Looks for a package.json and attempts to run `npm test`.
 * @param {string} repoDir - The directory of the repository.
 * @returns {Promise<boolean>} - True if tests passed or no tests found, false otherwise.
 */
async function runTests(repoDir) {
  logger.info(`Attempting to run tests in ${repoDir}`);

  return new Promise((resolve) => {
    const packageJsonPath = path.join(repoDir, 'package.json');

    if (!fs.existsSync(packageJsonPath)) {
      logger.info(`No package.json found in ${repoDir}. Skipping tests.`);
      resolve(true); // No tests to run, consider as passed
      return;
    }

    let packageJson;
    try {
      packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    } catch (error) {
      logger.error(`Failed to parse package.json in ${repoDir}:`, error);
      resolve(false); // Error parsing, consider tests failed
      return;
    }

    if (!packageJson.scripts || !packageJson.scripts.test) {
      logger.info(`No 'test' script found in package.json in ${repoDir}. Skipping tests.`);
      resolve(true); // No test script, consider as passed
      return;
    }

    logger.info(`Executing 'npm test' in ${repoDir}`);
    exec('npm install && npm test', { cwd: repoDir }, (error, stdout, stderr) => {
      if (error) {
        logger.error(`Tests failed in ${repoDir}:`, {
          message: error.message,
          stdout: stdout,
          stderr: stderr
        });
        resolve(false);
      } else {
        logger.info(`Tests passed successfully in ${repoDir}.`);
        logger.debug('Test Output:', { stdout, stderr });
        resolve(true);
      }
    });
  });
}

module.exports = {
  runTests,
};