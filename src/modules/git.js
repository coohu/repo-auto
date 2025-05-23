/**
 * Git operations module
 * 
 * Handles all Git operations using simple-git library
 */

'use strict';

const simpleGit = require('simple-git');
const fs = require('fs');
const path = require('path');

/**
 * GitClient class for handling Git operations
 */
class GitClient {
  /**
   * Create a new GitClient instance
   * @param {Object} options - Configuration options
   * @param {string} options.repoDir - Path to the repository directory
   * @param {string} options.token - GitHub access token
   * @param {Object} options.logger - Logger instance
   */
  constructor(options) {
    this.repoDir = options.repoDir;
    this.token = options.token;
    this.logger = options.logger;
    
    // Initialize simple-git
    this.git = simpleGit({
      baseDir: this.repoDir,
      binary: 'git',
      maxConcurrentProcesses: 1,
      trimmed: true
    });
  }

  /**
   * Check if the directory is a Git repository
   * @returns {Promise<boolean>} - True if directory is a Git repository
   */
  async checkIsRepo() {
    try {
      if (!fs.existsSync(this.repoDir)) {
        return false;
      }
      
      return await this.git.checkIsRepo();
    } catch (error) {
      this.logger.error('Error checking if directory is a Git repository:', error);
      return false;
    }
  }

  /**
   * Clone a repository
   * @param {string} url - Repository URL
   * @returns {Promise<void>}
   */
  async clone(url) {
    try {
      // Create parent directory if it doesn't exist
      const parentDir = path.dirname(this.repoDir);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      
      this.logger.info(`Cloning repository to ${this.repoDir}`);
      await simpleGit().clone(url, this.repoDir);
      
      // Update simple-git instance with new directory
      this.git = simpleGit({
        baseDir: this.repoDir,
        binary: 'git',
        maxConcurrentProcesses: 1,
        trimmed: true
      });
      
      this.logger.info('Repository cloned successfully');
    } catch (error) {
      this.logger.error('Error cloning repository:', error);
      throw error;
    }
  }

  /**
   * Get list of remotes
   * @returns {Promise<Array>} - List of remotes
   */
  async getRemotes() {
    try {
      return await this.git.getRemotes(true);
    } catch (error) {
      this.logger.error('Error getting remotes:', error);
      throw error;
    }
  }

  /**
   * Add a remote
   * @param {string} name - Remote name
   * @param {string} url - Remote URL
   * @returns {Promise<void>}
   */
  async addRemote(name, url) {
    try {
      await this.git.addRemote(name, url);
      this.logger.info(`Added remote ${name} -> ${url}`);
    } catch (error) {
      this.logger.error(`Error adding remote ${name}:`, error);
      throw error;
    }
  }

  /**
   * Fetch from remote
   * @param {Array} options - Fetch options
   * @returns {Promise<void>}
   */
  async fetch(options = []) {
    try {
      await this.git.fetch(options);
      this.logger.info('Fetch completed');
    } catch (error) {
      this.logger.error('Error fetching from remote:', error);
      throw error;
    }
  }

  /**
   * Checkout a branch
   * @param {string} branch - Branch name
   * @returns {Promise<void>}
   */
  async checkout(branch) {
    try {
      await this.git.checkout(branch);
      this.logger.info(`Checked out branch: ${branch}`);
    } catch (error) {
      // If branch doesn't exist, create it
      if (error.message.includes('did not match any file(s) known to git')) {
        this.logger.info(`Branch ${branch} does not exist, creating it`);
        try {
          await this.git.checkout(['-b', branch]);
          this.logger.info(`Created and checked out branch: ${branch}`);
        } catch (createError) {
          this.logger.error(`Error creating branch ${branch}:`, createError);
          throw createError;
        }
      } else {
        this.logger.error(`Error checking out branch ${branch}:`, error);
        throw error;
      }
    }
  }

  /**
   * Merge branches
   * @param {Array} options - Merge options
   * @returns {Promise<void>}
   */
  async merge(options = []) {
    try {
      await this.git.merge(options);
      this.logger.info(`Merge completed: ${options.join(' ')}`);
    } catch (error) {
      this.logger.error('Error merging:', error);
      throw error;
    }
  }

  /**
   * Get repository status
   * @returns {Promise<Object>} - Repository status
   */
  async status() {
    try {
      return await this.git.status();
    } catch (error) {
      this.logger.error('Error getting status:', error);
      throw error;
    }
  }

  /**
   * Add files to staging
   * @param {Array} files - Files to add
   * @returns {Promise<void>}
   */
  async add(files) {
    try {
      await this.git.add(files);
      this.logger.info(`Added files: ${Array.isArray(files) ? files.join(', ') : files}`);
    } catch (error) {
      this.logger.error('Error adding files:', error);
      throw error;
    }
  }

  /**
   * Commit changes
   * @param {string} message - Commit message
   * @returns {Promise<void>}
   */
  async commit(message) {
    try {
      await this.git.commit(message);
      this.logger.info(`Committed changes: ${message}`);
    } catch (error) {
      this.logger.error('Error committing changes:', error);
      throw error;
    }
  }

  /**
   * Push changes to remote
   * @param {Array} options - Push options
   * @returns {Promise<void>}
   */
  async push(options = []) {
    try {
      await this.git.push(options);
      this.logger.info(`Pushed changes: ${options.join(' ')}`);
    } catch (error) {
      this.logger.error('Error pushing changes:', error);
      throw error;
    }
  }

  /**
   * Get list of commits between two revisions
   * @param {Array} options - Options for git rev-list
   * @returns {Promise<string>} - List of commits
   */
  async revList(options = []) {
    try {
      return await this.git.raw(['rev-list', ...options]);
    } catch (error) {
      this.logger.error('Error getting rev-list:', error);
      throw error;
    }
  }

  /**
   * Get commit hash for a reference
   * @param {Array} options - Options for git rev-parse
   * @returns {Promise<string>} - Commit hash
   */
  async revParse(options = []) {
    try {
      return await this.git.revparse(options);
    } catch (error) {
      this.logger.error('Error parsing revision:', error);
      throw error;
    }
  }

  /**
   * Reset to a specific state
   * @param {Array} options - Reset options
   * @returns {Promise<void>}
   */
  async reset(options = []) {
    try {
      await this.git.reset(options);
      this.logger.info(`Reset completed: ${options.join(' ')}`);
    } catch (error) {
      this.logger.error('Error resetting:', error);
      throw error;
    }
  }

  /**
   * Get diff between two revisions
   * @param {Array} options - Diff options
   * @returns {Promise<string>} - Diff output
   */
  async diff(options = []) {
    try {
      return await this.git.diff(options);
    } catch (error) {
      this.logger.error('Error getting diff:', error);
      throw error;
    }
  }

  /**
   * Get file content from a specific revision
   * @param {string} rev - Revision (commit hash, branch, etc.)
   * @param {string} filePath - Path to file
   * @returns {Promise<string>} - File content
   */
  async getFileContent(rev, filePath) {
    try {
      return await this.git.show([`${rev}:${filePath}`]);
    } catch (error) {
      this.logger.error(`Error getting file content at ${rev}:${filePath}:`, error);
      throw error;
    }
  }
}

module.exports = {  GitClient };