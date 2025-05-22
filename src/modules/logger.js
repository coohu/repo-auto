/**
 * Logger module
 * 
 * Handles logging functionality for the application
 */

'use strict';

const winston = require('winston');
const { format } = winston;
const path = require('path');
const fs = require('fs');

// Create logs directory if it doesn't exist
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Default log file
const defaultLogFile = path.join(logsDir, 'sync-log.txt');

// Custom format with timestamp, level, and message
const customFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.printf(({ timestamp, level, message, ...rest }) => {
    const restString = Object.keys(rest).length ? `\n${JSON.stringify(rest, null, 2)}` : '';
    return `[${timestamp}] ${level.toUpperCase()}: ${message}${restString}`;
  })
);

// Create the logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: customFormat,
  transports: [
    new winston.transports.File({ filename: defaultLogFile }),
  ],
});

// Add console transport if not in production
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: format.combine(
      format.colorize(),
      customFormat
    ),
  }));
}

/**
 * Configure the logger with options from config
 * @param {Object} logOptions - Logging options from config
 */
function configureLogger(logOptions) {
  if (!logOptions) return;

  // Set log level if specified
  if (logOptions.level) {
    logger.level = logOptions.level;
  }

  // Remove existing transports
  logger.clear();

  // Add file transport with configured path
  if (logOptions.outputFile) {
    const outputDir = path.dirname(logOptions.outputFile);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    logger.add(new winston.transports.File({ 
      filename: logOptions.outputFile 
    }));
  } else {
    logger.add(new winston.transports.File({ 
      filename: defaultLogFile 
    }));
  }

  // Add console transport if enabled
  if (logOptions.enableConsole) {
    logger.add(new winston.transports.Console({
      format: format.combine(
        format.colorize(),
        customFormat
      ),
    }));
  }

  logger.info('Logger configuration updated');
}

/**
 * Creates a session logger that includes context info
 * @param {Object} context - Context information (account, repo, etc.)
 * @returns {Object} - Logger with context
 */
function createSessionLogger(context) {
  return {
    debug: (message, meta = {}) => logger.debug(message, { ...context, ...meta }),
    info: (message, meta = {}) => logger.info(message, { ...context, ...meta }),
    warn: (message, meta = {}) => logger.warn(message, { ...context, ...meta }),
    error: (message, meta = {}) => logger.error(message, { ...context, ...meta }),
  };
}

/**
 * Get logs for a specific time period
 * @param {Date} startDate - Start date for logs
 * @param {Date} endDate - End date for logs
 * @returns {Promise<Array>} - Array of log entries
 */
async function getLogsBetween(startDate, endDate) {
  return new Promise((resolve, reject) => {
    try {
      const logFile = logger.transports.find(t => t instanceof winston.transports.File)?.filename || defaultLogFile;
      
      if (!fs.existsSync(logFile)) {
        return resolve([]);
      }
      
      const logs = [];
      const fileContent = fs.readFileSync(logFile, 'utf8');
      const lines = fileContent.split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        try {
          // Extract timestamp from log line
          const timestampMatch = line.match(/\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]/);
          if (timestampMatch) {
            const timestamp = new Date(timestampMatch[1]);
            if (timestamp >= startDate && timestamp <= endDate) {
              logs.push(line);
            }
          }
        } catch (err) {
          // Skip problematic lines
          continue;
        }
      }
      
      resolve(logs);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get today's logs
 * @returns {Promise<Array>} - Array of today's log entries
 */
async function getTodayLogs() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  return getLogsBetween(today, tomorrow);
}

module.exports = {
  logger,
  configureLogger,
  createSessionLogger,
  getLogsBetween,
  getTodayLogs
};
