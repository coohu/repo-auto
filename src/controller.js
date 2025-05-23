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

  // config.accounts is now a single object
  const account = config.accounts;

  // Check if account name matches if filter is provided
  if (options.accountFilter && account.name !== options.accountFilter) {
    logger.warn(`Account name "${account.name}" does not match filter "${options.accountFilter}". Skipping.`);
    return { success: false, message: 'Account name does not match filter' };
  }

  if (!account) {
    logger.warn('No account configuration found.');
    return { success: false, message: 'No account configuration found' };
  }

  // Results collection for reporting
  const results = {
    success: true,
    syncedRepos: 0,
    failedRepos: 0,
    skippedRepos: 0,
    details: []
  };

  // Process the single account
  logger.info(`Processing account: ${account.name}`);
  
  // Filter repositories if specified
  // options.repoFilter should now match the 'fork' or 'upstream' string like "owner/repo:branch"
  const reposToProcess = options.repoFilter
    ? account.repos.filter(repoConfig => repoConfig.fork === options.repoFilter || repoConfig.upstream === options.repoFilter)
    : account.repos;
  
  if (reposToProcess.length === 0) {
    logger.warn(`No repositories found matching filter: ${options.repoFilter} for account: ${account.name}`);
    // If there was a filter, and nothing matched, it's not an overall failure, just no work for this filter.
    // If there wasn't a filter, and repo list is empty, it's a config issue handled by config validation.
    // So, we don't `continue` here, but let it proceed to send a report if needed.
  }
  
  // Process each repository configuration
  for (const repoConfig of reposToProcess) {
    try {
      // Pass the repoConfig object, the single account, and the main config
      const repoResult = await syncRepository(repoConfig, account, config);
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
      // Use repoConfig.fork or a relevant identifier for logging
      const repoIdentifier = repoConfig.fork || repoConfig.upstream || 'unknown repository';
      logger.error(`Error processing repository ${repoIdentifier}:`, error);
      results.failedRepos++;
      results.success = false;
      results.details.push({
        repository: repoIdentifier,
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
 * Sync a single repository based on its configuration
 * @param {Object} repoConfig - Repository configuration (e.g., {"upstream":"owner/repo:branch", "fork":"owner/repo:branch"})
 * @param {Object} account - Account configuration
 * @param {Object} config - Application configuration
 * @returns {Promise<Object>} - Results of sync operation
 */
async function syncRepository(repoConfig, account, config) {
  // Helper to parse "owner/repo:branch" string
  const parseRepoBranchString = (repoBranchStr) => {
    const [repoFullName, branch] = repoBranchStr.split(':');
    const [owner, repoName] = repoFullName.split('/');
    return { repoFullName, branch, owner, repoName };
  };

  const upstreamInfo = parseRepoBranchString(repoConfig.upstream);
  const forkInfo = parseRepoBranchString(repoConfig.fork);

  // Create session-specific logger for this repository fork
  const sessionLogger = createSessionLogger({
    account: account.name,
    repository: forkInfo.repoFullName // Log based on the fork repository
  });
  
  sessionLogger.info(`Starting sync process for fork ${forkInfo.repoFullName} from upstream ${upstreamInfo.repoFullName}`);
  
  // Set up repository paths based on the fork
  const repoBaseDir = path.resolve(process.cwd(), config.reposBaseDir);
  // Use fork owner and reponame for directory structure to avoid collisions if multiple forks of same upstream
  const repoDir = path.join(repoBaseDir, `${account.name}-${forkInfo.owner}-${forkInfo.repoName}`);
  
  // Make sure the base directory exists
  if (!fs.existsSync(repoBaseDir)) {
    sessionLogger.info(`Creating base directory: ${repoBaseDir}`);
    fs.mkdirSync(repoBaseDir, { recursive: true });
  }
  
  // Initialize Git client
  const git = new GitClient({repoDir, token: account.token, logger: sessionLogger});
  
  try {
    // Initialize repository (clone if needed)
    // Pass forkRepoName, forkBranch, upstreamRepoName, account, sessionLogger
    const initialized = await initializeRepository(git, forkInfo.repoFullName, forkInfo.branch, upstreamInfo.repoFullName, account, sessionLogger);
    if (!initialized) {
      return {
        repository: forkInfo.repoFullName, // Report with fork repo name
        account: account.name,
        success: false,
        status: 'error',
        error: 'Failed to initialize repository'
      };
    }
    
    // Check if upstream has changes
    // Pass git, forkBranch, upstreamBranch, sessionLogger
    const hasChanges = await checkForUpstreamChanges(git, forkInfo.branch, upstreamInfo.branch, sessionLogger);
    if (!hasChanges) {
      sessionLogger.info(`No changes to sync from upstream ${upstreamInfo.repoFullName}:${upstreamInfo.branch} to fork ${forkInfo.repoFullName}:${forkInfo.branch}`);
      return {
        repository: forkInfo.repoFullName,
        account: account.name,
        success: true,
        status: 'skipped',
        message: 'No upstream changes to sync'
      };
    }
    
    // Try to merge upstream changes
    // Pass git, forkBranch, upstreamBranch, config (for LLM settings), sessionLogger
    const mergeResult = await mergeUpstreamChanges(git, forkInfo.branch, upstreamInfo.branch, config, sessionLogger);
    
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
      repository: forkInfo.repoFullName, // Report with fork repo name
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
      repository: forkInfo.repoFullName, // Report with fork repo name
      account: account.name,
      success: false,
      status: 'error',
      error: error.message
    };
  }
}

/**
 * Initialize repository (clone if needed, set up remotes, checkout forkBranch)
 * @param {GitClient} git - Git client instance
 * @param {string} forkRepoName - Full name of the fork repository (owner/repo)
 * @param {string} forkBranch - Branch in the fork repository to sync to
 * @param {string} upstreamRepoName - Full name of the upstream repository (owner/repo)
 * @param {Object} account - Account configuration (for token)
 * @param {Object} sessionLogger - Session logger
 * @returns {Promise<boolean>} - Whether initialization was successful
 */
async function initializeRepository(git, forkRepoName, forkBranch, upstreamRepoName, account, sessionLogger) {
  try {
    // Check if we already have the repo locally
    const isRepo = await git.checkIsRepo();
    
    if (!isRepo) {
      // Clone the fork repository if it doesn't exist locally
      sessionLogger.info(`Cloning repository ${forkRepoName}`);
      await git.clone(`https://${account.token}@github.com/${forkRepoName}.git`);
    } else {
      sessionLogger.info(`Repository ${forkRepoName} already exists locally`);
      // Ensure origin remote URL is correct, especially if token changed or repo was moved
      await git.updateRemoteUrl('origin', `https://${account.token}@github.com/${forkRepoName}.git`);
    }
    
    // Set upstream remote if not already set or if URL is different
    const remotes = await git.getRemotes();
    const upstreamRemote = remotes.find(remote => remote.name === 'upstream');
    const expectedUpstreamUrl = `https://github.com/${upstreamRepoName}.git`;

    if (!upstreamRemote) {
      sessionLogger.info(`Adding upstream remote for ${upstreamRepoName}`);
      await git.addRemote('upstream', expectedUpstreamUrl);
    } else if (upstreamRemote.url !== expectedUpstreamUrl) {
      sessionLogger.info(`Updating upstream remote URL for ${upstreamRepoName} from ${upstreamRemote.url} to ${expectedUpstreamUrl}`);
      await git.updateRemoteUrl('upstream', expectedUpstreamUrl);
    } else {
      sessionLogger.info(`Upstream remote for ${upstreamRepoName} already configured correctly.`);
    }
    
    // Fetch from all remotes to ensure all branches are up-to-date
    sessionLogger.info('Fetching from all remotes (origin and upstream)');
    await git.fetch(['--all']);

    // Checkout the specified forkBranch.
    // The git.checkout method in git.js should handle creating it if it doesn't exist locally but exists on origin.
    // If it doesn't exist on origin either, git.js checkout might create it locally based on HEAD.
    // It's crucial that forkBranch exists on the fork remote or is a valid new branch name.
    sessionLogger.info(`Checking out fork branch: ${forkBranch}`);
    await git.checkout(forkBranch); // This might create forkBranch if it doesn't exist locally
                                    // and try to track origin/forkBranch if it exists on remote.
    
    // Ensure the local forkBranch is tracking the remote forkBranch on origin.
    // This is important if the branch was created locally or if tracking was not set up.
    try {
        await git.branch(['--set-upstream-to', `origin/${forkBranch}`]);
        sessionLogger.info(`Ensured local branch ${forkBranch} tracks origin/${forkBranch}`);
    } catch (setUpstreamError) {
        // This can happen if origin/forkBranch doesn't exist yet.
        // This is fine if it's a new branch we are about to push.
        sessionLogger.warn(`Could not set local branch ${forkBranch} to track origin/${forkBranch}. This is okay if the remote branch doesn't exist yet. Error: ${setUpstreamError.message}`);
    }
    
    return true;
  } catch (error) {
    sessionLogger.error(`Repository initialization for ${forkRepoName}:${forkBranch} failed:`, error);
    return false;
  }
}

/**
 * Check if there are upstream changes to pull into the fork's branch
 * @param {GitClient} git - Git client instance
 * @param {string} forkBranch - The branch in the fork repository
 * @param {string} upstreamBranch - The branch in the upstream repository
 * @param {Object} sessionLogger - Session logger
 * @returns {Promise<boolean>} - Whether there are changes to pull
 */
async function checkForUpstreamChanges(git, forkBranch, upstreamBranch, sessionLogger) {
  try {
    // Ensure we are on the correct local forkBranch
    sessionLogger.info(`Switching to branch ${forkBranch} to check for upstream changes.`);
    await git.checkout(forkBranch);
    
    // Fetch latest changes from upstream to ensure comparison is up-to-date
    sessionLogger.info(`Fetching from upstream remote to compare against upstream/${upstreamBranch}`);
    await git.fetch(['upstream']); // Only fetch upstream, origin was fetched during init or previous steps

    // Check if upstream/upstreamBranch has changes that aren't in our local forkBranch
    // This command lists commits that are in upstream/upstreamBranch but not in forkBranch
    sessionLogger.info(`Checking for changes in upstream/${upstreamBranch} not present in local ${forkBranch}`);
    const revList = await git.revList([`${forkBranch}..upstream/${upstreamBranch}`]);
    
    if (revList.trim().length > 0) {
      sessionLogger.info(`Found changes in upstream/${upstreamBranch} to sync to ${forkBranch}.`);
      return true;
    } else {
      sessionLogger.info(`No new changes in upstream/${upstreamBranch} to sync to ${forkBranch}.`);
      return false;
    }
  } catch (error) {
    sessionLogger.error(`Failed to check for upstream changes for ${forkBranch} from upstream/${upstreamBranch}:`, error);
    throw error;
  }
}

/**
 * Merge upstream changes from upstreamBranch into forkBranch
 * @param {GitClient} git - Git client instance
 * @param {string} forkBranch - The branch in the fork repository to merge into
 * @param {string} upstreamBranch - The branch in the upstream repository to merge from
 * @param {Object} config - Application configuration (for LLM settings)
 * @param {Object} sessionLogger - Session logger
 * @returns {Promise<Object>} - Results of merge operation
 */
async function mergeUpstreamChanges(git, forkBranch, upstreamBranch, config, sessionLogger) {
  let hadConflicts = false;
  let usedLLM = false;
  
  try {
    // Ensure we are on the correct local forkBranch
    sessionLogger.info(`Switching to branch ${forkBranch} to merge changes.`);
    await git.checkout(forkBranch);
    
    // Record the current commit for potential rollback
    const originalHead = await git.revParse(['HEAD']);
    sessionLogger.info(`Current HEAD on ${forkBranch} is ${originalHead}. Attempting to merge from upstream/${upstreamBranch}.`);
    
    try {
      // Try to merge upstream changes from upstream/upstreamBranch into the current branch (forkBranch)
      await git.merge([`upstream/${upstreamBranch}`]);
      sessionLogger.info(`Merge of upstream/${upstreamBranch} into ${forkBranch} completed successfully without conflicts.`);
      
      // Push the changes to origin (the fork repository) on the forkBranch
      sessionLogger.info(`Pushing merged changes to origin/${forkBranch}.`);
      await git.push(['origin', forkBranch]);
      sessionLogger.info(`Changes pushed to origin/${forkBranch}.`);
      
      return {
        success: true,
        hadConflicts,
        usedLLM,
        message: `Successfully merged upstream/${upstreamBranch} into ${forkBranch} and pushed to origin/${forkBranch}`
      };
    } catch (mergeError) {
      // Check if this is a merge conflict
      if (mergeError.message.includes('CONFLICT') || mergeError.message.includes('failed to merge')) { // Git messages can vary
        sessionLogger.warn(`Merge conflicts detected when merging upstream/${upstreamBranch} into ${forkBranch}.`);
        hadConflicts = true;
        
        // Get list of conflicted files
        const status = await git.status(); // Ensure this correctly identifies conflicted files
        const conflictedFiles = status.conflicted;
        
        if (!conflictedFiles || conflictedFiles.length === 0) {
           // Attempt to parse conflicted files from error message if status doesn't list them
           // This is a fallback, ideally git.status() should work
           const conflictMatcher = /CONFLICT \(content\): Merge conflict in ([^\s]+)/g;
           let match;
           const filesFromError = [];
           while ((match = conflictMatcher.exec(mergeError.message)) !== null) {
             filesFromError.push(match[1]);
           }
           if (filesFromError.length > 0) {
             sessionLogger.warn(`Identified conflicted files from error message: ${filesFromError.join(', ')}`);
             // This part is tricky as `resolveConflicts` expects paths relative to repo root.
             // For now, we rely on git.status() and log if it fails.
           }
          sessionLogger.error('Failed to identify conflicted files via git.status(). Merge resolution cannot proceed automatically.');
          // Abort merge if we can't identify files
          await git.merge(['--abort']);
          sessionLogger.info('Merge aborted due to inability to identify conflicted files.');
          return {
            success: false,
            hadConflicts,
            usedLLM: false, // LLM not used
            error: 'Failed to identify conflicted files for resolution.',
            message: 'Merge aborted as conflicted files could not be determined.'
          };
        }
        
        sessionLogger.info(`Attempting to resolve ${conflictedFiles.length} conflicted files using LLM: ${conflictedFiles.join(', ')}`);
        
        // Use LLM to resolve conflicts
        const resolveResult = await resolveConflicts(git, conflictedFiles, config.llm, sessionLogger);
        usedLLM = true;
        
        if (resolveResult.success) {
          sessionLogger.info('Conflicts resolved successfully by LLM.');
          
          // Commit the resolved changes
          // The commit message could be more descriptive
          await git.commit(`Automated merge conflict resolution from upstream/${upstreamBranch}`);
          sessionLogger.info('Committed resolved changes.');

          // Push the changes to origin (the fork repository) on the forkBranch
          sessionLogger.info(`Pushing resolved changes to origin/${forkBranch}.`);
          await git.push(['origin', forkBranch]);
          sessionLogger.info(`Resolved changes pushed to origin/${forkBranch}.`);
          
          return {
            success: true,
            hadConflicts,
            usedLLM,
            message: `Successfully resolved ${conflictedFiles.length} conflicts in ${forkBranch} from upstream/${upstreamBranch} and pushed changes`
          };
        } else {
          // If conflict resolution failed, abort merge and roll back
          sessionLogger.error('LLM conflict resolution failed:', resolveResult.error);
          
          // Abort merge using `git merge --abort` is cleaner than reset if merge is still in progress
          try {
            sessionLogger.info('Attempting to abort the merge.');
            await git.merge(['--abort']);
            sessionLogger.info('Merge aborted successfully.');
          } catch (abortError) {
            sessionLogger.error('Failed to abort merge, attempting hard reset to original HEAD:', abortError);
            // Fallback to reset if abort fails (e.g., if already committed or other state)
            try {
              await git.reset(['--hard', originalHead]);
              sessionLogger.info(`Rolled back to original HEAD on ${forkBranch}: ${originalHead}`);
            } catch (resetError) {
              sessionLogger.error(`Failed to roll back changes on ${forkBranch} to ${originalHead}:`, resetError);
              // This is a bad state, manual intervention might be needed.
            }
          }
          
          return {
            success: false,
            hadConflicts,
            usedLLM,
            error: `Failed to resolve conflicts for ${forkBranch} from upstream/${upstreamBranch}: ${resolveResult.error}`,
            message: `Merge of upstream/${upstreamBranch} into ${forkBranch} aborted due to unresolvable conflicts.`
          };
        }
      } else {
        // Not a conflict error, rethrow
        sessionLogger.error(`An unexpected error occurred during merge of upstream/${upstreamBranch} into ${forkBranch}:`, mergeError);
        throw mergeError;
      }
    }
  } catch (error) {
    // Catch errors from checkout, revParse, or rethrown merge errors
    sessionLogger.error(`Merge process for ${forkBranch} from upstream/${upstreamBranch} failed:`, error);
    return {
      success: false,
      hadConflicts, // This might be true if error happened after conflicts were detected
      usedLLM,      // This might be true if error happened after LLM was invoked
      error: `Failed to merge changes into ${forkBranch} from upstream/${upstreamBranch}: ${error.message}`
    };
  }
}

module.exports = {
  startSync
};
