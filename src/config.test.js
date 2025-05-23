const { initializeConfig } = require('./config'); // This will allow us to test validateConfig indirectly
const { resolveEnvVars } = require('./config'); // For direct testing if needed
const fs = require('fs');
const yaml = require('yaml');
const { logger } = require('./modules/logger');

// Mock 'fs' and 'logger'
jest.mock('fs');
jest.mock('yaml');
jest.mock('./modules/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(), // Add other methods if used by config.js
  },
  createSessionLogger: jest.fn().mockReturnValue({ // if createSessionLogger is used
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
  configureLogger: jest.fn(), // if configureLogger is used
}));

// Helper function to get validateConfig from initializeConfig
// This is a bit indirect, but initializeConfig is the actual exported function that uses validateConfig.
// To test validateConfig directly, we'd have to export it from config.js, which might not be desired.
// For now, we'll test it via initializeConfig.
const getValidateConfig = () => {
  let validateFn;
  fs.readFileSync.mockImplementation(() => {
    // This mock will be overridden in tests that load actual config content
    return JSON.stringify({
      // Provide a minimal valid structure to avoid errors during setup
      accounts: { token: 'test-token', repos: [{ upstream: 'up/repo:main', fork: 'my/repo:dev' }] },
      llm: { apiKey: 'test-llm-key' }
    });
  });
  JSON.parse = jest.fn((content) => global.JSON.parse(content)); // Ensure JSON.parse is mockable for specific tests
  yaml.parse = jest.fn().mockReturnValue({}); // Mock yaml.parse

  // Temporarily hijack validateConfig during one run of initializeConfig
  const actualModule = jest.requireActual('./config');
  const originalInitializeConfig = actualModule.initializeConfig;
  
  actualModule.initializeConfig = async (configPath) => {
    const loadConfigFileOriginal = actualModule.loadConfigFile;
    let config;
    // Temporarily hijack loadConfigFile to inject a mock for validateConfig
    actualModule.loadConfigFile = (cPath) => {
        config = loadConfigFileOriginal(cPath);
        // Hijack validateConfig after it's loaded but before it's called by initializeConfig
        // This is tricky because validateConfig is not directly exported.
        // A better way would be to export validateConfig for testing.
        // For now, we assume initializeConfig calls a validateConfig that we can't directly access.
        // So, we will test initializeConfig and infer validateConfig's behavior.
        return config;
    }
    // This approach is flawed for isolating validateConfig.
    // Let's assume validateConfig is exported for easier testing.
    // If not, testing via initializeConfig is the main path.
    // For this exercise, I will write tests as if validateConfig IS exported.
    // Modify config.js to export validateConfig for this to work.
    // e.g. in config.js: module.exports = { initializeConfig, resolveEnvVars, validateConfig };
    // If this change to config.js is not permissible, then tests for validateConfig
    // would need to be more integration-style through initializeConfig.
    
    // THIS IS A SIMPLIFICATION: Pretend validateConfig is exported.
    // const { validateConfig: actualValidateConfig } = jest.requireActual('./config');
    // validateFn = actualValidateConfig; // This line won't work as validateConfig is not exported
    
    // Given the constraints, we will primarily test initializeConfig,
    // which implicitly tests validateConfig.
    // We can also write some tests for resolveEnvVars directly.
    return originalInitializeConfig(configPath);
  };
  return validateFn; // This will be undefined with current setup.
};


describe('resolveEnvVars', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules(); // Clear cache
    process.env = { ...OLD_ENV }; // Make a copy
  });

  afterAll(() => {
    process.env = OLD_ENV; // Restore old environment
  });

  it('should resolve environment variables in strings', () => {
    process.env.TEST_VAR = 'resolved_value';
    const input = 'Value is ${TEST_VAR}';
    expect(resolveEnvVars(input)).toBe('Value is resolved_value');
  });

  it('should resolve multiple environment variables in a string', () => {
    process.env.VAR1 = 'one';
    process.env.VAR2 = 'two';
    const input = '${VAR1} and ${VAR2}';
    expect(resolveEnvVars(input)).toBe('one and two');
  });

  it('should return empty string for undefined environment variables', () => {
    const input = 'Value is ${UNDEFINED_VAR}';
    expect(resolveEnvVars(input)).toBe('Value is ');
  });

  it('should resolve environment variables in an array', () => {
    process.env.ITEM1 = 'apple';
    process.env.ITEM2 = 'banana';
    const input = ['${ITEM1}', '${ITEM2}', 'cherry'];
    expect(resolveEnvVars(input)).toEqual(['apple', 'banana', 'cherry']);
  });

  it('should resolve environment variables in an object', () => {
    process.env.KEY1_VAL = 'value1';
    process.env.KEY2_VAL = 'value2';
    const input = {
      key1: '${KEY1_VAL}',
      key2: '${KEY2_VAL}',
      key3: 'literal'
    };
    expect(resolveEnvVars(input)).toEqual({
      key1: 'value1',
      key2: 'value2',
      key3: 'literal'
    });
  });

  it('should resolve nested environment variables in an object', () => {
    process.env.NESTED_VAL = 'deep_value';
    const input = {
      level1: {
        level2: '${NESTED_VAL}'
      }
    };
    expect(resolveEnvVars(input)).toEqual({
      level1: {
        level2: 'deep_value'
      }
    });
  });

  it('should handle non-string, non-array, non-object values', () => {
    expect(resolveEnvVars(123)).toBe(123);
    expect(resolveEnvVars(null)).toBe(null);
    expect(resolveEnvVars(true)).toBe(true);
  });
});

describe('initializeConfig (and implicitly validateConfig)', () => {
  let mockValidConfig;

  beforeEach(() => {
    // Reset mocks for each test
    fs.readFileSync.mockReset();
    JSON.parse.mockReset(); // Resetting the global JSON.parse mock
    logger.warn.mockReset();
    logger.error.mockReset();

    mockValidConfig = {
      accounts: {
        name: "test-account",
        token: "test-token123",
        repos: [
          { upstream: "upstreamOwner/upstreamRepo:main", fork: "forkOwner/forkRepo:dev" },
          { upstream: "another/repo:stable", fork: "myFork/another:feature-branch" }
        ]
      },
      email: {
        smtpHost: "smtp.example.com",
        smtpPort: 587,
        from: "sync@example.com",
        to: ["admin@example.com"]
      },
      schedule: "0 0 * * *",
      reposBaseDir: "/tmp/repos",
      llm: {
        provider: "openai",
        model: "gpt-4",
        apiKey: "llm-api-key"
      },
      logOptions: {
        level: "debug",
        maxSize: "20m",
        maxFiles: "7d"
      }
    };

    // Mock JSON.parse to return a deep copy of mockValidConfig by default
    // We need to use the real JSON.parse for this, not a Jest mock function.
    const actualJsonParse = global.JSON.parse;
    JSON.parse = jest.fn(content => actualJsonParse(content));
  });

  const mockReadFileWithConfig = (configObject) => {
    fs.readFileSync.mockReturnValue(JSON.stringify(configObject));
  };

  it('should load and validate a correct JSON configuration', async () => {
    mockReadFileWithConfig(mockValidConfig);
    const config = await initializeConfig('dummy.json');
    expect(config).toBeDefined();
    expect(config.accounts.token).toBe("test-token123");
    expect(config.accounts.repos.length).toBe(2);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('should throw error if accounts is missing', async () => {
    const invalidConfig = { ...mockValidConfig, accounts: undefined };
    mockReadFileWithConfig(invalidConfig);
    await expect(initializeConfig('dummy.json')).rejects.toThrow('Configuration must include an "accounts" object');
  });

  it('should throw error if accounts is an array', async () => {
    const invalidConfig = { ...mockValidConfig, accounts: [] };
    mockReadFileWithConfig(invalidConfig);
    await expect(initializeConfig('dummy.json')).rejects.toThrow('Configuration must include an "accounts" object');
  });

  it('should throw error if accounts.token is missing', async () => {
    const invalidConfig = { ...mockValidConfig, accounts: { ...mockValidConfig.accounts, token: undefined } };
    mockReadFileWithConfig(invalidConfig);
    await expect(initializeConfig('dummy.json')).rejects.toThrow('Missing GitHub token in "accounts"');
  });

  it('should throw error if accounts.repos is missing', async () => {
    const invalidConfig = { ...mockValidConfig, accounts: { ...mockValidConfig.accounts, repos: undefined } };
    mockReadFileWithConfig(invalidConfig);
    await expect(initializeConfig('dummy.json')).rejects.toThrow('"accounts.repos" must be a non-empty array');
  });
  
  it('should throw error if accounts.repos is empty', async () => {
    const invalidConfig = { ...mockValidConfig, accounts: { ...mockValidConfig.accounts, repos: [] } };
    mockReadFileWithConfig(invalidConfig);
    await expect(initializeConfig('dummy.json')).rejects.toThrow('"accounts.repos" must be a non-empty array');
  });

  it('should throw error if repo entry is missing upstream', async () => {
    const invalidConfig = { 
      ...mockValidConfig, 
      accounts: { 
        ...mockValidConfig.accounts, 
        repos: [{ fork: "owner/repo:main" }] 
      } 
    };
    mockReadFileWithConfig(invalidConfig);
    await expect(initializeConfig('dummy.json')).rejects.toThrow('Missing or invalid "upstream" field');
  });

  it('should throw error if repo entry is missing fork', async () => {
    const invalidConfig = { 
      ...mockValidConfig, 
      accounts: { 
        ...mockValidConfig.accounts, 
        repos: [{ upstream: "owner/repo:main" }] 
      } 
    };
    mockReadFileWithConfig(invalidConfig);
    await expect(initializeConfig('dummy.json')).rejects.toThrow('Missing or invalid "fork" field');
  });

  it('should throw error if upstream has invalid format "owner/repo"', async () => {
    const invalidConfig = { 
      ...mockValidConfig, 
      accounts: { 
        ...mockValidConfig.accounts, 
        repos: [{ upstream: "owner/repo", fork: "owner/repo:main" }] 
      } 
    };
    mockReadFileWithConfig(invalidConfig);
    await expect(initializeConfig('dummy.json')).rejects.toThrow('Invalid "upstream" format: owner/repo. Must be "owner/repo:branch"');
  });

  it('should throw error if fork has invalid format "owner/repo:"', async () => {
    const invalidConfig = { 
      ...mockValidConfig, 
      accounts: { 
        ...mockValidConfig.accounts, 
        repos: [{ upstream: "owner/repo:main", fork: "owner/repo:" }] 
      } 
    };
    mockReadFileWithConfig(invalidConfig);
    await expect(initializeConfig('dummy.json')).rejects.toThrow('Invalid "fork" format: owner/repo:. Must be "owner/repo:branch"');
  });
  
    it('should throw error if fork has invalid format ":branchA"', async () => {
    const invalidConfig = { 
      ...mockValidConfig, 
      accounts: { 
        ...mockValidConfig.accounts, 
        repos: [{ upstream: "owner/repo:main", fork: ":branchA" }] 
      } 
    };
    mockReadFileWithConfig(invalidConfig);
    await expect(initializeConfig('dummy.json')).rejects.toThrow('Invalid "fork" format: :branchA. Must be "owner/repo:branch"');
  });

  it('should set default schedule if not provided and log warning', async () => {
    const configNoSchedule = { ...mockValidConfig, schedule: undefined };
    mockReadFileWithConfig(configNoSchedule);
    const config = await initializeConfig('dummy.json');
    expect(config.schedule).toBe('0 4 * * *');
    expect(logger.warn).toHaveBeenCalledWith("No schedule defined, using default schedule: '0 4 * * *' (daily at 4:00 AM)");
  });

  it('should set default reposBaseDir if not provided and log warning', async () => {
    const configNoBaseDir = { ...mockValidConfig, reposBaseDir: undefined };
    mockReadFileWithConfig(configNoBaseDir);
    const config = await initializeConfig('dummy.json');
    expect(config.reposBaseDir).toBe('./repositories');
    expect(logger.warn).toHaveBeenCalledWith("No repository base directory defined, using default: './repositories'");
  });

  it('should throw error if llm configuration is missing', async () => {
    const configNoLlm = { ...mockValidConfig, llm: undefined };
    mockReadFileWithConfig(configNoLlm);
    await expect(initializeConfig('dummy.json')).rejects.toThrow('LLM configuration is required for conflict resolution');
  });
  
  it('should throw error if llm.apiKey is missing', async () => {
    const configNoLlmApiKey = { ...mockValidConfig, llm: { provider: "openai", model: "gpt-4" } };
    mockReadFileWithConfig(configNoLlmApiKey);
    await expect(initializeConfig('dummy.json')).rejects.toThrow('Missing API key for LLM provider');
  });

  it('should set default llm.provider and llm.model if not provided and log warnings', async () => {
    const configPartialLlm = { ...mockValidConfig, llm: { apiKey: "test-key" } };
    mockReadFileWithConfig(configPartialLlm);
    const config = await initializeConfig('dummy.json');
    expect(config.llm.provider).toBe('openai');
    expect(config.llm.model).toBe('gpt-4');
    expect(logger.warn).toHaveBeenCalledWith("No LLM provider specified, using default: 'openai'");
    expect(logger.warn).toHaveBeenCalledWith("No LLM model specified, using default: 'gpt-4'");
  });

  it('should handle YAML file parsing', async () => {
    const yamlConfig = { ...mockValidConfig };
    fs.readFileSync.mockReturnValue('some yaml content'); // Actual content doesn't matter due to yaml.parse mock
    yaml.parse.mockReturnValue(yamlConfig); // Mocking the behavior of yaml.parse
    
    const config = await initializeConfig('dummy.yaml');
    expect(yaml.parse).toHaveBeenCalledWith('some yaml content');
    expect(config.accounts.token).toBe("test-token123");
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('should throw error for unsupported file extension', async () => {
    fs.readFileSync.mockReturnValue('content');
    await expect(initializeConfig('dummy.txt')).rejects.toThrow('Unsupported config file extension: .txt');
  });
  
  describe('Email validation', () => {
    it('should validate correct email configuration', async () => {
      mockReadFileWithConfig(mockValidConfig);
      const config = await initializeConfig('dummy.json');
      expect(config.email.to).toEqual(["admin@example.com"]); // Should be an array
    });

    it('should convert email.to string to array', async () => {
      const emailToString = { ...mockValidConfig, email: { ...mockValidConfig.email, to: "admin@example.com" }};
      mockReadFileWithConfig(emailToString);
      const config = await initializeConfig('dummy.json');
      expect(config.email.to).toEqual(["admin@example.com"]);
    });

    it('should throw error if required email field is missing', async () => {
      const incompleteEmailConfig = { ...mockValidConfig, email: { smtpHost: "host", smtpPort: 123, from: "from" }}; // 'to' is missing
      mockReadFileWithConfig(incompleteEmailConfig);
      await expect(initializeConfig('dummy.json')).rejects.toThrow('Missing required email configuration field: to');
    });
    
    it('should warn if email config is missing', async () => {
        const noEmailConfig = {...mockValidConfig, email: undefined };
        mockReadFileWithConfig(noEmailConfig);
        await initializeConfig('dummy.json'); // Call it, don't need the result
        expect(logger.warn).toHaveBeenCalledWith('No email configuration found, email notifications will be disabled');
    });
  });

  // Test environment variable resolution via initializeConfig
  it('should resolve environment variables in config values during initialization', async () => {
    process.env.TEST_TOKEN = 'env-resolved-token';
    process.env.TEST_UPSTREAM_BRANCH = 'env-main';
    const configWithEnvVars = {
      ...mockValidConfig,
      accounts: {
        token: '${TEST_TOKEN}', // Env var for token
        repos: [
          { upstream: `upstreamOwner/upstreamRepo:\${TEST_UPSTREAM_BRANCH}`, fork: "forkOwner/forkRepo:dev" }
        ]
      },
      llm: { apiKey: "llm-api-key"} // ensure llm is valid
    };
    mockReadFileWithConfig(configWithEnvVars);

    const config = await initializeConfig('dummy.json');
    expect(config.accounts.token).toBe('env-resolved-token');
    expect(config.accounts.repos[0].upstream).toBe('upstreamOwner/upstreamRepo:env-main');
    delete process.env.TEST_TOKEN; // Clean up env
    delete process.env.TEST_UPSTREAM_BRANCH;
  });
});
