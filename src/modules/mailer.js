/**
 * Mailer module
 *
 * Handles sending email notifications using Nodemailer.
 */

'use strict';

const nodemailer = require('nodemailer'); //
const { logger, getTodayLogs } = require('./logger');
const fs = require('fs');
const path = require('path');

let mailConfig;
let transporter;

/**
 * Initializes the mailer with configuration.
 * @param {Object} config - Email configuration object from the main config.
 */
function initializeMailer(config) {
  if (!config || !config.smtpHost || !config.smtpPort || !config.from || !config.to) {
    logger.warn('Email configuration is missing or incomplete. Email notifications will be disabled.');
    mailConfig = null;
    transporter = null;
    return;
  }
  mailConfig = config;
  try {
    transporter = nodemailer.createTransport({
      host: mailConfig.smtpHost,
      port: mailConfig.smtpPort,
      secure: mailConfig.smtpPort === 465, // true for 465, false for other ports
      auth: {
        user: mailConfig.user, // SMTP username
        pass: mailConfig.pass, // SMTP password
      },
    });
    logger.info('Mailer initialized successfully.');
  } catch (error) {
    logger.error('Failed to initialize mailer transport:', error);
    transporter = null;
  }
}

/**
 * Send an email.
 * @param {string} subject - Email subject.
 * @param {string} textBody - Plain text body of the email.
 * @param {string} [htmlBody] - HTML body of the email (optional).
 * @param {Array<Object>} [attachments] - Array of attachment objects (optional).
 * Example: [{ filename: 'log.txt', content: 'log content...' }]
 * @returns {Promise<boolean>} - True if email was sent successfully, false otherwise.
 */
async function sendEmail(subject, textBody, htmlBody, attachments = []) {
  if (!transporter) {
    logger.warn('Mailer not initialized or initialization failed. Cannot send email.');
    return false;
  }
  if (!mailConfig || !mailConfig.to || mailConfig.to.length === 0) {
    logger.warn('No recipients configured for email. Cannot send email.');
    return false;
  }

  const mailOptions = {
    from: mailConfig.from, //
    to: mailConfig.to.join(', '), //
    subject: subject,
    text: textBody,
    html: htmlBody || textBody,
    attachments: attachments,
  };

  try {
    logger.info(`Sending email with subject: "${subject}" to: ${mailOptions.to}`);
    const info = await transporter.sendMail(mailOptions);
    logger.info('Email sent successfully.', { messageId: info.messageId });
    return true;
  } catch (error) {
    logger.error('Error sending email:', error);
    return false;
  }
}

/**
 * Send a synchronization report email.
 * @param {Object} appConfig - The main application configuration.
 * @param {Object} syncResults - The results from the sync process.
 * Includes { success, syncedRepos, failedRepos, skippedRepos, details }.
 * @returns {Promise<void>}
 */
async function sendSyncReport(appConfig, syncResults) {
  if (!appConfig.email) { // Check if email config exists
    logger.info('Email configuration not provided. Skipping sync report.');
    return;
  }
  initializeMailer(appConfig.email); // Ensure mailer is initialized with latest config

  if (!transporter && !appConfig.sendMailOnFailure) { //
     logger.info('Mailer not available and not configured to send mail on failure. Skipping report.');
     return;
  }
  if (!transporter && appConfig.sendMailOnFailure && syncResults.failedRepos === 0) {
     logger.info('Mailer not available, but configured for failure mail. No failures to report.');
     return;
  }


  const subject = `Fork Sync Report: ${syncResults.success ? 'Success' : 'Some Operations Failed'}`;
  let textBody = `Fork Synchronization Report:\n\n`;
  textBody += `Overall Status: ${syncResults.success ? 'All operations successful' : 'One or more operations failed'}\n`;
  textBody += `Synced Repositories: ${syncResults.syncedRepos}\n`;
  textBody += `Failed Repositories: ${syncResults.failedRepos}\n`;
  textBody += `Skipped Repositories (already up-to-date): ${syncResults.skippedRepos}\n\n`;
  textBody += `Details:\n`;

  syncResults.details.forEach(detail => {
    textBody += `------------------------------------\n`;
    textBody += `Account: ${detail.account}\n`;
    textBody += `Repository: ${detail.repository}\n`;
    textBody += `Status: ${detail.status}\n`;
    if (detail.message) textBody += `Message: ${detail.message}\n`;
    if (detail.error) textBody += `Error: ${detail.error}\n`;
    if (detail.hadConflicts) textBody += `Conflicts Encountered: Yes\n`;
    if (detail.usedLLM) textBody += `LLM Used for Resolution: Yes\n`;
    if (detail.testsStatus) textBody += `Tests Status: ${detail.testsStatus}\n`;
  });

  let attachments = [];
  if (appConfig.logOptions && appConfig.logOptions.outputFile) { //
    try {
      const logFile = path.resolve(process.cwd(), appConfig.logOptions.outputFile);
      if (fs.existsSync(logFile)) {
        attachments.push({
          filename: path.basename(logFile),
          path: logFile
        });
        logger.info(`Attaching log file: ${logFile} to the report.`);
      } else {
        logger.warn(`Log file ${logFile} not found for attachment.`);
      }
    } catch (e) {
        logger.error(`Error accessing log file for attachment: ${appConfig.logOptions.outputFile}`, e);
    }
  }


  // Determine if email should be sent based on configuration
  const shouldSend = (syncResults.failedRepos > 0 && appConfig.sendMailOnFailure) || //
                     (syncResults.syncedRepos > 0 || syncResults.failedRepos > 0); // Send if any activity

  if (shouldSend) {
    await sendEmail(subject, textBody, null, attachments);
  } else {
    logger.info('No conditions met to send sync report email (e.g., no failures, no activity, or mailer not configured).');
  }
}

/**
 * Send a daily summary report.
 * @param {Object} appConfig - The main application configuration.
 * @returns {Promise<void>}
 */
async function sendDailyReport(appConfig) {
  if (!appConfig.email || !appConfig.sendDailyReport) { //
    logger.info('Email configuration or daily report sending not enabled. Skipping daily report.');
    return;
  }
  initializeMailer(appConfig.email);

  if (!transporter) {
    logger.warn('Mailer not initialized. Cannot send daily report.');
    return;
  }

  const subject = 'Fork Sync Daily Summary Report';
  let textBody = `Daily Summary Report for Fork Sync Tool\n\n`;

  try {
    const todaysLogs = await getTodayLogs();
    if (todaysLogs.length === 0) {
      textBody += 'No activity recorded today.\n';
    } else {
      textBody += 'Today\'s activity log summary:\n\n';
      textBody += todaysLogs.join('\n');
    }
  } catch (error) {
    logger.error('Failed to retrieve logs for daily report:', error);
    textBody += 'Could not retrieve logs for today.\n';
  }

  // Optionally, attach the full log file if configured
  let attachments = [];
   if (appConfig.logOptions && appConfig.logOptions.outputFile) { //
    try {
      const logFile = path.resolve(process.cwd(), appConfig.logOptions.outputFile);
      if (fs.existsSync(logFile)) {
        attachments.push({
          filename: path.basename(logFile),
          path: logFile
        });
      }
    } catch (e) {
        logger.error(`Error accessing log file for daily report attachment: ${appConfig.logOptions.outputFile}`, e);
    }
  }

  await sendEmail(subject, textBody, null, attachments);
}


module.exports = {
  initializeMailer,
  sendEmail,
  sendSyncReport,
  sendDailyReport,
};