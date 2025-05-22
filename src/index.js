#!/usr/bin/env node

/**
 * Fork Sync CLI
 * 
 * A Node.js command-line tool for automatically syncing GitHub fork repositories
 * with their upstream repositories, including intelligent conflict resolution.
 */

'use strict';

// Load environment variables from .env file
require('dotenv').config();

// Import required modules
const { program } = require('commander');
const { initializeConfig } = require('./src/config');
const { setupScheduler } = require('./src/scheduler');
const { startSync } = require('./src/controller');
const { logger } = require('./src/modules/logger');
const path = require('path');
const fs = require('fs');

// Setup CLI commands
program.name('fork-sync')
  .description('A Node.js CLI tool for automatically syncing GitHub forks with upstream repositories')
  .version('1.0.0');

// Main command
program.option('-c, --config <path>', 'Path to configuration file', './config.json')
  .option('-r, --run-once', 'Run sync once and exit (no scheduling)', false)
  .option('-a, --account <name>', 'Sync only the specified account')
  .option('-p, --repository <repo>', 'Sync only the specified repository')
  .option('-v, --verbose', 'Enable verbose output', false)
  .action(async (options) => {
    try {
      // Verify config file exists
      const configPath = path.resolve(process.cwd(), options.config);
      if (!fs.existsSync(configPath)) {
        logger.error(`Config file not found: ${configPath}`);
        console.error(`Error: Config file not found: ${configPath}`);
        process.exit(1);
      }

      // Set verbose logging if requested
      if (options.verbose) {
        logger.level = 'debug';
      }

      // Initialize configuration
      const config = await initializeConfig(configPath);
      
      // If run-once is specified, run the sync process once and exit
      if (options.runOnce) {
        logger.info('Running one-time sync process...');
        await startSync(config, {
          accountFilter: options.account,
          repoFilter: options.repository
        });
        logger.info('One-time sync process completed.');
      } else {
        // Otherwise, set up the scheduler according to the configuration
        logger.info('Setting up scheduled sync process...');
        setupScheduler(config, {
          accountFilter: options.account,
          repoFilter: options.repository
        });
        logger.info(`Scheduler configured with cron expression: ${config.schedule}`);
        logger.info('Fork Sync CLI is now running. Press Ctrl+C to exit.');
      }
    } catch (error) {
      logger.error('Error in main process:', error);
      console.error('An error occurred:', error.message);
      process.exit(1);
    }
  });

// Parse command line arguments
program.parse(process.argv);
