/**
 * LLM Client module
 *
 * Handles communication with the Large Language Model provider.
 */

'use strict';

const OpenAI = require('openai');
const { logger } = require('../modules/logger');

let openai;
let llmConfig;

/**
 * Initialize the LLM client with configuration.
 * @param {Object} config - LLM configuration object.
 * @param {string} config.provider - The LLM provider (e.g., 'openai').
 * @param {string} config.apiKey - API key for the LLM provider.
 * @param {string} config.model - The model to use.
 * @param {number} [config.maxRetries=3] - Maximum number of retries for API calls.
 */
function initializeLLMClient(config) {
  if (!config || !config.apiKey || !config.provider || !config.model) {
    logger.error('LLM client configuration is missing or incomplete.', { config });
    throw new Error('LLM client configuration is missing or incomplete. apiKey, provider, and model are required.');
  }
  llmConfig = {
    maxRetries: 3, // Default maxRetries
    ...config
  };

  if (llmConfig.provider.toLowerCase() === 'openai') {
    openai = new OpenAI({
      baseurl:llmConfig.url,
      apiKey: llmConfig.apiKey,
    });
    logger.info(`OpenAI client initialized with model: ${llmConfig.model}`);
  } else {
    logger.error(`Unsupported LLM provider: ${llmConfig.provider}`);
    throw new Error(`Unsupported LLM provider: ${llmConfig.provider}. Currently, only 'openai' is supported.`);
  }
}

/**
 * Generates text using the configured LLM.
 * @param {string} prompt - The prompt to send to the LLM.
 * @param {Object} [options={}] - Additional options for the LLM call.
 * @param {number} [options.max_tokens=2048] - Maximum tokens to generate.
 * @param {number} [options.temperature=0.7] - Temperature for generation.
 * @returns {Promise<string>} - The LLM-generated text.
 * @throws {Error} If the LLM client is not initialized or API call fails.
 */
async function generateText(prompt, options = {}) {
  if (!openai) {
    logger.error('LLM client not initialized. Call initializeLLMClient first.');
    throw new Error('LLM client not initialized.');
  }

  const params = {
    model: llmConfig.model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: options.max_tokens || 2048,
    temperature: options.temperature || 0.7,
    ...options, // Allow overriding defaults or adding more specific params
  };

  logger.debug('Sending request to LLM with params:', { params: { ...params, messages: [{ role: 'user', content: "Prompt hidden for brevity" }] } });

  let retries = 0;
  while (retries <= (llmConfig.maxRetries || 3)) { //
    try {
      const completion = await openai.chat.completions.create(params);
      const textResponse = completion.choices[0]?.message?.content?.trim();
      if (!textResponse) {
        logger.warn('LLM returned an empty response.', { completion });
        throw new Error('LLM returned an empty or invalid response.');
      }
      logger.info('LLM generated text successfully.');
      logger.debug('LLM Response:', { response: textResponse });
      return textResponse;
    } catch (error) {
      logger.error(`LLM API call failed (attempt ${retries + 1}/${(llmConfig.maxRetries || 3) +1}):`, error);
      retries++;
      if (retries > (llmConfig.maxRetries || 3)) {
        throw new Error(`Failed to generate text after ${llmConfig.maxRetries || 3} retries: ${error.message}`);
      }
      // Optional: Add a delay before retrying
      await new Promise(resolve => setTimeout(resolve, 1000 * retries)); // Exponential backoff basic
    }
  }
}

module.exports = {
  initializeLLMClient,
  generateText,
};