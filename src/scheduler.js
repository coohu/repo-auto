/**
 * Scheduler module
 * 
 * Handles scheduling of repository sync tasks
 */

'use strict';

const cron = require('node-cron');
const { logger } = require('./modules/logger');
const { startSync } = require('./controller');
const { sendDailyReport } = require('./modules/mailer');

// Store active cron tasks
const activeTasks = {sync: null, report: null};

/**
 * Setup scheduler based on configuration
 * @param {Object} config - Application configuration
 * @param {Object} options - Scheduler options
 * @param {string} options.accountFilter - Filter to specific account
 * @param {string} options.repoFilter - Filter to specific repository
 */
function setupScheduler(config) {
  // Clean up any existing tasks
  stopScheduler();
  
  // Validate cron expression
  if (!config.schedule || !cron.validate(config.schedule)) {
    throw new Error(`Invalid cron schedule expression: ${config.schedule}`);
  }
  
  logger.info(`Setting up scheduler with expression: ${config.schedule}`);
  
  // Schedule sync task
  activeTasks.sync = cron.schedule(config.schedule, async () => {
    logger.info('Starting scheduled repository sync task');
    
    try {
      await startSync(config, options);
      logger.info('Scheduled repository sync task completed');
    } catch (error) {
      logger.error('Error in scheduled sync task:', error);
    }
  });
  
  // Schedule daily report if enabled
  if (config.sendDailyReport && config.email) {
    // Default to 6:00 AM for daily reports
    const reportSchedule = '0 6 * * *';
    logger.info(`Setting up daily report scheduler with expression: ${reportSchedule}`);
    
    activeTasks.report = cron.schedule(reportSchedule, async () => {
      logger.info('Generating daily report');
      
      try {
        await sendDailyReport(config);
        logger.info('Daily report sent successfully');
      } catch (error) {
        logger.error('Error sending daily report:', error);
      }
    });
  }
  logger.info('Scheduler setup completed');
}

/**
 * Stop all scheduled tasks
 */
function stopScheduler() {
  for (const [name, task] of Object.entries(activeTasks)) {
    if (task) {
      logger.info(`Stopping ${name} task`);
      task.stop();
      activeTasks[name] = null;
    }
  }
}

module.exports = {setupScheduler, stopScheduler};
