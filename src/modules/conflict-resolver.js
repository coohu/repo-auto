/**
 * Conflict Resolver module
 *
 * Handles resolving merge conflicts using an LLM.
 */

'use strict';

const { initializeLLMClient, generateText } = require('../utils/llm-client');
const { logger } = require('./logger');
const fs = require('fs').promises;
const path = require('path');

/**
 * Resolve merge conflicts using LLM.
 * @param {GitClient} git - Initialized GitClient instance.
 * @param {string[]} conflictedFiles - Array of paths to conflicted files.
 * @param {Object} llmConfig - LLM configuration.
 * @param {Object} sessionLogger - Session-specific logger.
 * @returns {Promise<Object>} - Result of the resolution { success: boolean, error?: string }.
 */
async function resolveConflicts(git, conflictedFiles, llmConfig, sessionLogger) {
  sessionLogger.info(`Attempting to resolve conflicts in files: ${conflictedFiles.join(', ')}`);

  try {
    initializeLLMClient(llmConfig); // Initialize LLM client with config from main flow
  } catch (error) {
    sessionLogger.error('Failed to initialize LLM client for conflict resolution:', error);
    return { success: false, error: `LLM client initialization failed: ${error.message}` };
  }

  let allResolved = true;

  for (const filePath of conflictedFiles) {
    const absoluteFilePath = path.join(git.repoDir, filePath);
    sessionLogger.info(`Processing conflicted file: ${filePath}`);

    try {
      const fileContent = await fs.readFile(absoluteFilePath, 'utf-8');

      // Attempt to get base, ours, theirs. This is a simplified approach.
      // A more robust method would use `git diff --base`, `git show :2:file`, `git show :3:file`
      // or parse conflict markers more reliably.
      // For this implementation, we'll send the whole conflicted file to the LLM.
      // More advanced parsing of `<<<<<<<`, `=======`, `>>>>>>>` can be added here.

      const baseContent = await git.getFileContent('MERGE_HEAD', filePath).catch(() => 'Unavailable'); // Upstream/Theirs in a typical merge
      const oursContent = await git.getFileContent('HEAD', filePath).catch(() => 'Unavailable'); // Local/Ours

      // Constructing the prompt
      const prompt = `
The following file has merge conflicts: ${filePath}

--- OURS (Current branch) ---
${oursContent}
--- END OURS ---

--- THEIRS (Branch being merged) ---
${baseContent} // In a standard merge, MERGE_HEAD is 'theirs'
--- END THEIRS ---

--- CONFLICTED FILE CONTENT ---
${fileContent}
--- END CONFLICTED FILE CONTENT ---

Please resolve the conflicts in the file content.
Analyze the changes from OURS and THEIRS against the CONFLICTED FILE CONTENT.
Your goal is to integrate the changes from THEIRS into OURS, preserving the functionality of OURS while incorporating the updates from THEIRS.
Output ONLY the fully resolved file content. Do not include any explanations, comments, or markdown formatting around the code.
Ensure the output is ready to be written directly back to the file.
`;

      sessionLogger.info(`Sending prompt to LLM for file: ${filePath}`);
      const resolvedContent = await generateText(prompt, { max_tokens: 4000 }); // Increased max_tokens for potentially large files

      if (resolvedContent) {
        await fs.writeFile(absoluteFilePath, resolvedContent, 'utf-8');
        sessionLogger.info(`LLM provided resolution for ${filePath}. Applying and adding to git.`);
        await git.add([filePath]);
      } else {
        sessionLogger.error(`LLM did not return content for ${filePath}.`);
        allResolved = false;
        break; // Stop if one file fails
      }
    } catch (error) {
      sessionLogger.error(`Error resolving conflict in file ${filePath}:`, error);
      allResolved = false;
      break; // Stop if one file fails
    }
  }

  if (allResolved && conflictedFiles.length > 0) {
    try {
      await git.commit(`Automated merge conflict resolution by LLM for ${conflictedFiles.length} file(s)`); //
      sessionLogger.info('Successfully committed LLM-resolved changes.');
      return { success: true };
    } catch (commitError) {
      sessionLogger.error('Failed to commit LLM-resolved changes:', commitError);
      return { success: false, error: `Failed to commit changes: ${commitError.message}` };
    }
  } else if (conflictedFiles.length === 0) {
    sessionLogger.info('No conflicted files were passed to resolver.');
    return { success: true }; // No conflicts to resolve
  } else {
    sessionLogger.warn('Not all conflicts were resolved by LLM.');
    return { success: false, error: 'LLM failed to resolve all conflicts.' };
  }
}

module.exports = {
  resolveConflicts,
};