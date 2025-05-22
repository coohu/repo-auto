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
  // Check if accounts are defined
  if (!config.accounts || !Array.isArray(config.accounts) || config.accounts.length === 0) {
    throw new Error('Configuration must include at least one account');
  }

  // Validate each account
  for (const [index, account] of config.accounts.entries()) {
    if (!account.token) {
      throw new Error(`Missing GitHub token for account at index ${index}`);
    }
    
    if (!account.repos || !Array.isArray(account.repos) || account.repos.length === 0) {
      throw new Error(`Account ${account.name || index} must include at least one repository`);
    }
    
    // Ensure each repo has proper format (owner/repo)
    for (const repo of account.repos) {
      if (!/^[^/]+\/[^/]+$/.test(repo)) {
        throw new Error(`Invalid repository format: ${repo}. Must be in format "owner/repo"`);
      }
    }
    
    // Set default branches if not specified
    if (!account.devBranch) {
      account.devBranch = 'dev';
      logger.warn(`No development branch specified for account ${account.name || index}, using 'dev' as default`);
    }
    
    if (!account.upstreamBranch) {
      account.upstreamBranch = 'main';
      logger.warn(`No upstream branch specified for account ${account.name || index}, using 'main' as default`);
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
