/**
 * Sync Controller
 * 
 * Main controller for the fork synchronization process
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { logger, createSessionLogger } = require('./modules/logger');
const { GitClient } = require('./modules/git');
const { resolveConflicts } = require('./modules/conflict-resolver');
const { runTests } = require('./modules/tester');
const { sendSyncReport } = require('./modules/mailer');
const { configureLogger } = require('./modules/logger');

/**
 * Start the sync process for all configured repositories
 * @param {Object} config - Application configuration
 * @param {Object} options - Optional filters and settings
 * @param {string} options.accountFilter - Filter to specific account
 * @param {string} options.repoFilter - Filter to specific repository
 * @returns {Promise<Object>} - Summary of sync results
 */
async function startSync(config, options = {}) {
  // Configure logger based on config settings
  if (config.logOptions) {
    configureLogger(config.logOptions);
  }

  logger.info('Starting fork sync process', { options });

  // Filter accounts if specified
  const accounts = options.accountFilter
    ? config.accounts.filter(account => account.name === options.accountFilter)
    : config.accounts;

  if (accounts.length === 0) {
    logger.warn(`No accounts found matching filter: ${options.accountFilter}`);
    return { success: false, message: 'No matching accounts found' };
  }

  // Results collection for reporting
  const results = {
    success: true,
    syncedRepos: 0,
    failedRepos: 0,
    skippedRepos: 0,
    details: []
  };

  // Process each account
  for (const account of accounts) {
    logger.info(`Processing account: ${account.name}`);
    
    // Filter repositories if specified
    const repos = options.repoFilter
      ? account.repos.filter(repo => repo === options.repoFilter)
      : account.repos;
    
    if (repos.length === 0) {
      logger.warn(`No repositories found matching filter: ${options.repoFilter} for account: ${account.name}`);
      continue;
    }
    
    // Process each repository
    for (const repo of repos) {
      try {
        const repoResult = await syncRepository(repo, account, config);
        results.details.push(repoResult);
        
        if (repoResult.success) {
          if (repoResult.status === 'synced') {
            results.syncedRepos++;
          } else if (repoResult.status === 'skipped') {
            results.skippedRepos++;
          }
        } else {
          results.failedRepos++;
          results.success = false;
        }
      } catch (error) {
        logger.error(`Error processing repository ${repo}:`, error);
        results.failedRepos++;
        results.success = false;
        results.details.push({
          repository: repo,
          account: account.name,
          success: false,
          status: 'error',
          error: error.message
        });
      }
    }
  }
  
  // Send email report if configured and there was activity or errors
  if (config.email && (results.syncedRepos > 0 || results.failedRepos > 0 || config.sendMailOnFailure)) {
    try {
      await sendSyncReport(config, results);
    } catch (error) {
      logger.error('Failed to send sync report email:', error);
    }
  }
  
  // Log summary
  logger.info('Sync process completed', {
    syncedRepos: results.syncedRepos,
    failedRepos: results.failedRepos,
    skippedRepos: results.skippedRepos
  });
  
  return results;
}

/**
 * Sync a single repository
 * @param {string} repoFullName - Repository full name (owner/repo)
 * @param {Object} account - Account configuration
 * @param {Object} config - Application configuration
 * @returns {Promise<Object>} - Results of sync operation
 */
async function syncRepository(repoFullName, account, config) {
  // Create session-specific logger for this repository
  const sessionLogger = createSessionLogger({
    account: account.name,
    repository: repoFullName
  });
  
  sessionLogger.info('Starting sync process');
  
  // Parse repository name
  const [owner, repoName] = repoFullName.split('/');
  if (!owner || !repoName) {
    sessionLogger.error('Invalid repository format, must be "owner/repo"');
    return {
      repository: repoFullName,
      account: account.name,
      success: false,
      status: 'error',
      error: 'Invalid repository format'
    };
  }

  // Set up repository paths
  const repoBaseDir = path.resolve(process.cwd(), config.reposBaseDir);
  const repoDir = path.join(repoBaseDir, `${account.name}-${owner}-${repoName}`);
  
  // Make sure the base directory exists
  if (!fs.existsSync(repoBaseDir)) {
    sessionLogger.info(`Creating base directory: ${repoBaseDir}`);
    fs.mkdirSync(repoBaseDir, { recursive: true });
  }
  
  // Initialize Git client
  const git = new GitClient({
    repoDir,
    token: account.token,
    logger: sessionLogger
  });
  
  try {
    // Initialize repository (clone if needed)
    const initialized = await initializeRepository(git, repoFullName, account, sessionLogger);
    if (!initialized) {
      return {
        repository: repoFullName,
        account: account.name,
        success: false,
        status: 'error',
        error: 'Failed to initialize repository'
      };
    }
    
    // Check if upstream has changes
    const hasChanges = await checkForUpstreamChanges(git, account, sessionLogger);
    if (!hasChanges) {
      sessionLogger.info('No upstream changes to sync');
      return {
        repository: repoFullName,
        account: account.name,
        success: true,
        status: 'skipped',
        message: 'No upstream changes to sync'
      };
    }
    
    // Try to merge upstream changes
    const mergeResult = await mergeUpstreamChanges(git, account, config, sessionLogger);
    
    // Run tests if configured and merge was successful
    if (config.runTestsAfterMerge && mergeResult.success) {
      try {
        sessionLogger.info('Running post-merge tests');
        const testsPassed = await runTests(repoDir);
        
        if (!testsPassed) {
          sessionLogger.warn('Post-merge tests failed');
          mergeResult.testsStatus = 'failed';
        } else {
          sessionLogger.info('Post-merge tests passed');
          mergeResult.testsStatus = 'passed';
        }
      } catch (error) {
        sessionLogger.error('Error running tests:', error);
        mergeResult.testsStatus = 'error';
      }
    }
    
    return {
      repository: repoFullName,
      account: account.name,
      success: mergeResult.success,
      status: mergeResult.success ? 'synced' : 'error',
      hadConflicts: mergeResult.hadConflicts,
      usedLLM: mergeResult.usedLLM,
      testsStatus: mergeResult.testsStatus,
      message: mergeResult.message,
      error: mergeResult.error
    };
  } catch (error) {
    sessionLogger.error('Sync process failed:', error);
    return {
      repository: repoFullName,
      account: account.name,
      success: false,
      status: 'error',
      error: error.message
    };
  }
}

/**
 * Initialize repository (clone if needed, set up remotes)
 * @param {GitClient} git - Git client instance
 * @param {string} repoFullName - Repository full name (owner/repo)
 * @param {Object} account - Account configuration
 * @param {Object} logger - Session logger
 * @returns {Promise<boolean>} - Whether initialization was successful
 */
async function initializeRepository(git, repoFullName, account, sessionLogger) {
  try {
    // Check if we already have the repo locally
    const isRepo = await git.checkIsRepo();
    
    if (!isRepo) {
      // Clone the repository if it doesn't exist locally
      sessionLogger.info(`Cloning repository ${repoFullName}`);
      await git.clone(`https://${account.token}@github.com/${repoFullName}.git`);
    } else {
      sessionLogger.info('Repository already exists locally');
    }
    
    // Set upstream remote if not already set
    const remotes = await git.getRemotes();
    if (!remotes.find(remote => remote.name === 'upstream')) {
      // Parse repository name to get upstream
      const [owner, repoName] = repoFullName.split('/');
      
      sessionLogger.info('Adding upstream remote');
      await git.addRemote('upstream', `https://github.com/${owner}/${repoName}.git`);
    }
    
    // Update remotes
    sessionLogger.info('Fetching from remotes');
    await git.fetch(['--all']);
    
    return true;
  } catch (error) {
    sessionLogger.error('Repository initialization failed:', error);
    return false;
  }
}

/**
 * Check if there are upstream changes to pull
 * @param {GitClient} git - Git client instance
 * @param {Object} account - Account configuration
 * @param {Object} logger - Session logger
 * @returns {Promise<boolean>} - Whether there are changes to pull
 */
async function checkForUpstreamChanges(git, account, sessionLogger) {
  try {
    // Make sure we're on the development branch
    await git.checkout(account.devBranch);
    
    // Check if upstream branch has changes that aren't in our dev branch
    sessionLogger.info(`Checking for changes in upstream/${account.upstreamBranch}`);
    const revList = await git.revList([`${account.devBranch}..upstream/${account.upstreamBranch}`]);
    
    return revList.trimEnd().length > 0;
  } catch (error) {
    sessionLogger.error('Failed to check for upstream changes:', error);
    throw error;
  }
}

/**
 * Merge upstream changes into the development branch
 * @param {GitClient} git - Git client instance
 * @param {Object} account - Account configuration
 * @param {Object} config - Application configuration
 * @param {Object} logger - Session logger
 * @returns {Promise<Object>} - Results of merge operation
 */
async function mergeUpstreamChanges(git, account, config, sessionLogger) {
  let hadConflicts = false;
  let usedLLM = false;
  
  try {
    // Make sure we're on the development branch
    await git.checkout(account.devBranch);
    
    // Record the current commit for potential rollback
    const originalHead = await git.revParse(['HEAD']);
    sessionLogger.info(`Current HEAD: ${originalHead}, attempting merge`);
    
    try {
      // Try to merge upstream changes
      await git.merge([`upstream/${account.upstreamBranch}`]);
      sessionLogger.info('Merge completed successfully without conflicts');
      
      // Push the changes
      await git.push(['origin', account.devBranch]);
      sessionLogger.info('Changes pushed to origin');
      
      return {
        success: true,
        hadConflicts,
        usedLLM,
        message: 'Successfully merged and pushed upstream changes'
      };
    } catch (mergeError) {
      // Check if this is a merge conflict
      if (mergeError.message.includes('CONFLICTS')) {
        sessionLogger.info('Merge conflicts detected');
        hadConflicts = true;
        
        // Get list of conflicted files
        const status = await git.status();
        const conflictedFiles = status.conflicted;
        
        if (conflictedFiles.length === 0) {
          throw new Error('Failed to identify conflicted files');
        }
        
        sessionLogger.info(`Attempting to resolve ${conflictedFiles.length} conflicted files using LLM`);
        
        // Use LLM to resolve conflicts
        const resolveResult = await resolveConflicts(git, conflictedFiles, config.llm, sessionLogger);
        usedLLM = true;
        
        if (resolveResult.success) {
          sessionLogger.info('Conflicts resolved successfully by LLM');
          
          // Push the changes
          await git.push(['origin', account.devBranch]);
          sessionLogger.info('Resolved changes pushed to origin');
          
          return {
            success: true,
            hadConflicts,
            usedLLM,
            message: `Successfully resolved ${conflictedFiles.length} conflicts and pushed changes`
          };
        } else {
          // If conflict resolution failed, abort merge and roll back
          sessionLogger.error('LLM conflict resolution failed:', resolveResult.error);
          
          // Abort merge
          try {
            await git.reset(['--hard', originalHead]);
            sessionLogger.info(`Rolled back to original HEAD: ${originalHead}`);
          } catch (resetError) {
            sessionLogger.error('Failed to roll back changes:', resetError);
          }
          
          return {
            success: false,
            hadConflicts,
            usedLLM,
            error: `Failed to resolve conflicts: ${resolveResult.error}`,
            message: 'Merge aborted due to unresolvable conflicts'
          };
        }
      } else {
        // Not a conflict error, rethrow
        throw mergeError;
      }
    }
  } catch (error) {
    sessionLogger.error('Merge process failed:', error);
    return {
      success: false,
      hadConflicts,
      usedLLM,
      error: `Failed to merge: ${error.message}`
    };
  }
}

module.exports = {
  startSync
};
