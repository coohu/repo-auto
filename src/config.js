/**
 * Configuration module
 * 
 * Handles loading, parsing, and validating the configuration file.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('yaml');
const { logger } = require('./modules/logger');

/**
 * Resolve environment variables in configuration values
 * @param {string|object} value - The value to process
 * @returns {string|object} - Processed value with environment variables resolved
 */
function resolveEnvVars(value) {
  if (typeof value === 'string') {
    return value.replace(/\${([^}]+)}/g, (_, varName) => {
      return process.env[varName] || '';
    });
  } else if (Array.isArray(value)) {
    return value.map(item => resolveEnvVars(item));
  } else if (value !== null && typeof value === 'object') {
    const result = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = resolveEnvVars(val);
    }
    return result;
  }
  return value;
}

/**
 * Load and parse configuration file
 * @param {string} configPath - Path to the configuration file
 * @returns {object} - Parsed configuration object
 */
function loadConfigFile(configPath) {
  const ext = path.extname(configPath).toLowerCase();
  const content = fs.readFileSync(configPath, 'utf8');
  
  if (ext === '.json') {
    try {
      // Parse JSON with comment support
      const jsonContent = content.replace(/\/\/.*$/gm, ''); // Remove single-line comments
      return JSON.parse(jsonContent);
    } catch (err) {
      throw new Error(`Failed to parse JSON config file: ${err.message}`);
    }
  } else if (ext === '.yaml' || ext === '.yml') {
    try {
      return yaml.parse(content);
    } catch (err) {
      throw new Error(`Failed to parse YAML config file: ${err.message}`);
    }
  } else {
    throw new Error(`Unsupported config file extension: ${ext}`);
  }
}

/**
 * Validate configuration object
 * @param {object} config - Configuration object to validate
 * @throws {Error} If configuration is invalid
 */
function validateConfig(config) {
  // Check if account are defined
  if (!config.account || typeof config.account !== 'object' || Array.isArray(config.account)) {
    throw new Error('Configuration must include an "account" object');
  }

  // Validate the account
  const account = config.account; // Renaming for clarity within this scope
  if (!account.token) {
    throw new Error('Missing GitHub token in "account"');
  }
  
  if (!account.repos || !Array.isArray(account.repos) || account.repos.length === 0) {
    throw new Error('"account.repos" must be a non-empty array');
  }
  
  // Validate each repo entry in account.repos
  for (const repoEntry of account.repos) {
    if (!repoEntry.upstream || typeof repoEntry.upstream !== 'string') {
      throw new Error(`Missing or invalid "upstream" field in repository entry: ${JSON.stringify(repoEntry)}. Must be a string.`);
    }
    if (!repoEntry.fork || typeof repoEntry.fork !== 'string') {
      throw new Error(`Missing or invalid "fork" field in repository entry: ${JSON.stringify(repoEntry)}. Must be a string.`);
    }

    const repoBranchRegex = /^[^/]+\/[^/]+:[^:]+$/;
    if (!repoBranchRegex.test(repoEntry.upstream)) {
      throw new Error(`Invalid "upstream" format: ${repoEntry.upstream}. Must be "owner/repo:branch"`);
    }
    if (!repoBranchRegex.test(repoEntry.fork)) {
      throw new Error(`Invalid "fork" format: ${repoEntry.fork}. Must be "owner/repo:branch"`);
    }
  }

  // Validate email configuration if present
  if (config.email) {
    const requiredEmailFields = ['smtpHost', 'smtpPort', 'from', 'to'];
    for (const field of requiredEmailFields) {
      if (!config.email[field]) {
        throw new Error(`Missing required email configuration field: ${field}`);
      }
    }
    
    if (!Array.isArray(config.email.to)) {
      config.email.to = [config.email.to];
    }
  } else {
    logger.warn('No email configuration found, email notifications will be disabled');
  }

  // Set default values for optional fields
  if (!config.schedule) {
    config.schedule = '0 4 * * *'; // Default to 4:00 AM daily
    logger.warn("No schedule defined, using default schedule: '0 4 * * *' (daily at 4:00 AM)");
  }

  if (!config.reposBaseDir) {
    config.reposBaseDir = './repositories';
    logger.warn("No repository base directory defined, using default: './repositories'");
  }

  // Validate LLM configuration if present
  if (config.llm) {
    if (!config.llm.provider) {
      config.llm.provider = 'openai';
      logger.warn("No LLM provider specified, using default: 'openai'");
    }
    
    if (!config.llm.model) {
      config.llm.model = 'gpt-4';
      logger.warn("No LLM model specified, using default: 'gpt-4'");
    }
    
    if (!config.llm.apiKey) {
      throw new Error('Missing API key for LLM provider');
    }
  } else {
    throw new Error('LLM configuration is required for conflict resolution');
  }

  return config;
}

/**
 * Initialize and load configuration
 * @param {string} configPath - Path to the configuration file
 * @returns {object} - Parsed and validated configuration
 */
async function initializeConfig(configPath) {
  try {
    logger.info(`Loading configuration from ${configPath}`);
    let config = loadConfigFile(configPath);
    
    // Resolve environment variables in configuration
    config = resolveEnvVars(config);
    
    // Validate configuration
    config = validateConfig(config);
    
    logger.info('Configuration loaded successfully');
    return config;
  } catch (error) {
    logger.error('Failed to initialize configuration:', error);
    throw error;
  }
}

module.exports = {
  initializeConfig,
  resolveEnvVars
};
