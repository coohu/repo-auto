const { startSync } = require('./controller');
const { logger, createSessionLogger, configureLogger } = require('./modules/logger');
const { GitClient } = require('./modules/git');
const { resolveConflicts } = require('./modules/conflict-resolver');
const { runTests } = require('./modules/tester');
const { sendSyncReport } = require('./modules/mailer');
const fs = require('fs'); // For path.join, fs.existsSync, fs.mkdirSync if used directly

// --- Mocks ---
jest.mock('./modules/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  createSessionLogger: jest.fn().mockReturnValue({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
  configureLogger: jest.fn(),
}));

jest.mock('./modules/git'); // Mocks GitClient constructor and all its methods

jest.mock('./modules/conflict-resolver', () => ({
  resolveConflicts: jest.fn(),
}));

jest.mock('./modules/tester', () => ({
  runTests: jest.fn(),
}));

jest.mock('./modules/mailer', () => ({
  sendSyncReport: jest.fn(),
}));

jest.mock('fs', () => ({
  ...jest.requireActual('fs'), // Import and retain default behavior
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
}));

describe('Controller: startSync', () => {
  let mockConfig;
  let mockGitClientInstance;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock GitClient methods that might be called during the flow
    mockGitClientInstance = {
      checkIsRepo: jest.fn(),
      clone: jest.fn(),
      updateRemoteUrl: jest.fn(),
      getRemotes: jest.fn().mockResolvedValue([]), // Default to no remotes
      addRemote: jest.fn(),
      fetch: jest.fn(),
      checkout: jest.fn(),
      branch: jest.fn(),
      revList: jest.fn(),
      revParse: jest.fn().mockResolvedValue('mocked-head-commit'),
      merge: jest.fn(),
      push: jest.fn(),
      status: jest.fn().mockResolvedValue({ conflicted: [] }), // Default to no conflicts
      commit: jest.fn(),
      reset: jest.fn(), // For rollback scenarios
    };
    GitClient.mockImplementation(() => mockGitClientInstance);


    mockConfig = {
      accounts: {
        name: "test-account",
        token: "test-token",
        repos: [
          { upstream: "upstreamOwner/repo1:main", fork: "forkOwner/repo1:dev" },
          { upstream: "upstreamOwner/repo2:stable", fork: "forkOwner/repo2:feature" },
        ],
      },
      reposBaseDir: "/tmp/ghsync-tests",
      llm: { provider: "openai", model: "gpt-4", apiKey: "test-llm-key" }, // Needed for merge conflict resolution path
      // Other config options can be added as needed
    };

    fs.existsSync.mockReturnValue(true); // Assume base directory exists by default
  });

  it('should process all repositories for the account if no filter is applied', async () => {
    // Mock downstream functions to simulate successful syncs without changes
    mockGitClientInstance.checkIsRepo.mockResolvedValue(true);
    mockGitClientInstance.revList.mockResolvedValue(''); // No changes

    await startSync(mockConfig);

    expect(createSessionLogger).toHaveBeenCalledTimes(2); // Once for each repo
    expect(GitClient).toHaveBeenCalledTimes(2);
    // syncRepository calls initializeRepository, checkForUpstreamChanges
    expect(mockGitClientInstance.checkIsRepo).toHaveBeenCalledTimes(2);
    expect(mockGitClientInstance.checkout).toHaveBeenCalledTimes(4); // 2 for init (forkBranch), 2 for check (forkBranch)
    expect(mockGitClientInstance.revList).toHaveBeenCalledTimes(2); 
    expect(logger.info).toHaveBeenCalledWith('Starting fork sync process', { options: {} });
    expect(logger.info).toHaveBeenCalledWith('Processing account: test-account');
  });

  it('should filter repositories based on options.repoFilter (matching fork)', async () => {
    mockGitClientInstance.checkIsRepo.mockResolvedValue(true);
    mockGitClientInstance.revList.mockResolvedValue(''); // No changes

    const options = { repoFilter: "forkOwner/repo1:dev" };
    await startSync(mockConfig, options);

    expect(createSessionLogger).toHaveBeenCalledTimes(1);
    expect(GitClient).toHaveBeenCalledTimes(1);
    expect(GitClient).toHaveBeenCalledWith(expect.objectContaining({
      // repoDir will be based on forkOwner/repo1
      repoDir: expect.stringContaining('test-account-forkOwner-repo1') 
    }));
    expect(logger.info).toHaveBeenCalledWith('Starting fork sync process', { options });
  });
  
  it('should filter repositories based on options.repoFilter (matching upstream)', async () => {
    mockGitClientInstance.checkIsRepo.mockResolvedValue(true);
    mockGitClientInstance.revList.mockResolvedValue(''); // No changes

    const options = { repoFilter: "upstreamOwner/repo2:stable" };
    await startSync(mockConfig, options);

    expect(createSessionLogger).toHaveBeenCalledTimes(1);
    expect(GitClient).toHaveBeenCalledTimes(1);
     expect(GitClient).toHaveBeenCalledWith(expect.objectContaining({
      repoDir: expect.stringContaining('test-account-forkOwner-repo2') 
    }));
  });


  it('should skip processing if options.accountFilter does not match', async () => {
    const options = { accountFilter: "nonexistent-account" };
    const result = await startSync(mockConfig, options);

    expect(GitClient).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('Account name "test-account" does not match filter "nonexistent-account". Skipping.');
    expect(result.success).toBe(false);
    expect(result.message).toBe('Account name does not match filter');
  });
  
  it('should configure logger if logOptions are provided', async () => {
    mockConfig.logOptions = { level: "debug" };
    await startSync(mockConfig);
    expect(configureLogger).toHaveBeenCalledWith({ level: "debug" });
  });
  
  it('should send email report if configured and sync activity occurs', async () => {
    mockConfig.email = { smtpHost: 'host', smtpPort: 123, from: 'f', to: ['t']}; // Valid email config
    mockGitClientInstance.checkIsRepo.mockResolvedValue(true);
    mockGitClientInstance.revList.mockResolvedValue('onecommit'); // Has changes
    mockGitClientInstance.merge.mockResolvedValue({}); // Successful merge

    await startSync(mockConfig);
    expect(sendSyncReport).toHaveBeenCalled();
  });

  it('should handle errors during syncRepository call and report failure', async () => {
    mockGitClientInstance.checkIsRepo.mockRejectedValue(new Error("Git boom!")); // Initialize fails

    const results = await startSync(mockConfig);
    expect(results.success).toBe(false);
    expect(results.failedRepos).toBe(2); // Both repos would fail
    expect(createSessionLogger).toHaveBeenCalledTimes(2); // Logger created for both attempts
    // Check if the error from syncRepository (which comes from initializeRepository) is logged
    // The sessionLogger.error is called from within syncRepository's catch block
    const firstSessionLoggerInstance = createSessionLogger.mock.results[0].value;
    expect(firstSessionLoggerInstance.error).toHaveBeenCalledWith('Sync process failed:', expect.any(Error));
  });
});

describe('Controller: syncRepository (and helpers)', () => {
  let mockAccount;
  let mockMainConfig;
  let repoConfig;
  let sessionLoggerInstance;
  let gitClientInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    mockAccount = { name: "test-user", token: "user-token" };
    mockMainConfig = { 
        reposBaseDir: "/base",
        llm: { provider: "test", model: "test", apiKey: "key" },
        runTestsAfterMerge: false, // Default to false
    };
    repoConfig = { upstream: "up/repo:main", fork: "user/fork:dev" };
    
    sessionLoggerInstance = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    createSessionLogger.mockReturnValue(sessionLoggerInstance);

    gitClientInstance = {
      checkIsRepo: jest.fn().mockResolvedValue(true), // Assume repo exists
      clone: jest.fn(),
      updateRemoteUrl: jest.fn(),
      getRemotes: jest.fn().mockResolvedValue([{name: 'origin', url: 'git@github.com:user/fork.git'}, {name: 'upstream', url: 'git@github.com:up/repo.git'}]),
      addRemote: jest.fn(),
      fetch: jest.fn(),
      checkout: jest.fn(),
      branch: jest.fn(),
      revList: jest.fn().mockResolvedValue(""), // No changes by default
      revParse: jest.fn().mockResolvedValue('mock-HEAD'),
      merge: jest.fn(),
      push: jest.fn(),
      status: jest.fn().mockResolvedValue({ conflicted: [] }),
      commit: jest.fn(),
      reset: jest.fn(),
      merge: jest.fn(),
    };
    GitClient.mockImplementation(() => gitClientInstance);
    fs.existsSync.mockReturnValue(true);
  });

  // Dynamically import controller to get access to internal functions for focused testing
  // This is generally not best practice for unit tests (prefer testing via public API),
  // but for this exercise, we'll assume it's okay to isolate them.
  let syncRepository, initializeRepository, checkForUpstreamChanges, mergeUpstreamChanges;
  beforeAll(async () => {
    const controllerModule = require('./controller');
    syncRepository = controllerModule.startSync; // This is not syncRepository, startSync is the export
    // The helper functions are not exported. We will test them via startSync -> syncRepository path.
    // To test them in isolation, they would need to be exported from controller.js
    // For now, tests will focus on behavior observable through startSync/syncRepository.
  });


  // --- initializeRepository Tests (tested via syncRepository call path) ---
  describe('initializeRepository behavior', () => {
    it('should clone fork, add upstream, fetch, and checkout forkBranch if repo does not exist', async () => {
      gitClientInstance.checkIsRepo.mockResolvedValue(false); // Repo does not exist
      gitClientInstance.getRemotes.mockResolvedValue([]); // No remotes initially

      // Call startSync which will call syncRepository -> initializeRepository
      await startSync({ accounts: mockAccount, ...mockMainConfig, repos: [repoConfig] });

      expect(gitClientInstance.clone).toHaveBeenCalledWith('https://user-token@github.com/user/fork.git');
      expect(gitClientInstance.addRemote).toHaveBeenCalledWith('upstream', 'https://github.com/up/repo.git');
      expect(gitClientInstance.fetch).toHaveBeenCalledWith(['--all']);
      expect(gitClientInstance.checkout).toHaveBeenCalledWith('dev'); // forkBranch
      expect(gitClientInstance.branch).toHaveBeenCalledWith(['--set-upstream-to', 'origin/dev']);
      expect(sessionLoggerInstance.info).toHaveBeenCalledWith('Cloning repository user/fork');
    });

    it('should update remotes, fetch, and checkout if repo exists', async () => {
      gitClientInstance.checkIsRepo.mockResolvedValue(true); // Repo exists
      // Simulate upstream having a different URL initially
      gitClientInstance.getRemotes.mockResolvedValue([
        { name: 'origin', url: 'https://user-token@github.com/user/fork.git' },
        { name: 'upstream', url: 'https://some-other-url.com/up/repo.git' }
      ]);

      await startSync({ accounts: mockAccount, ...mockMainConfig, repos: [repoConfig] });

      expect(gitClientInstance.clone).not.toHaveBeenCalled();
      expect(gitClientInstance.updateRemoteUrl).toHaveBeenCalledWith('origin', 'https://user-token@github.com/user/fork.git');
      expect(gitClientInstance.updateRemoteUrl).toHaveBeenCalledWith('upstream', 'https://github.com/up/repo.git');
      expect(gitClientInstance.fetch).toHaveBeenCalledWith(['--all']);
      expect(gitClientInstance.checkout).toHaveBeenCalledWith('dev'); // forkBranch
      expect(sessionLoggerInstance.info).toHaveBeenCalledWith('Repository user/fork already exists locally');
    });
  });

  // --- checkForUpstreamChanges Tests (tested via syncRepository call path) ---
  describe('checkForUpstreamChanges behavior', () => {
    it('should checkout forkBranch, fetch upstream, and return true if revList has output', async () => {
      gitClientInstance.revList.mockResolvedValue('onecommit\n'); // Has changes

      const result = await startSync({ accounts: mockAccount, ...mockMainConfig, repos: [repoConfig] });
      
      expect(gitClientInstance.checkout).toHaveBeenCalledWith('dev'); // forkBranch
      expect(gitClientInstance.fetch).toHaveBeenCalledWith(['upstream']); // Only fetch upstream
      expect(gitClientInstance.revList).toHaveBeenCalledWith(['dev..upstream/main']);
      expect(sessionLoggerInstance.info).toHaveBeenCalledWith('Found changes in upstream/main to sync to dev.');
      // Check that merge was attempted (part of the "synced" path)
      expect(gitClientInstance.merge).toHaveBeenCalled(); 
    });

    it('should return false if revList is empty, and skip merge', async () => {
      gitClientInstance.revList.mockResolvedValue(''); // No changes

      const resultContainer = await startSync({ accounts: mockAccount, ...mockMainConfig, repos: [repoConfig] });
      
      expect(gitClientInstance.checkout).toHaveBeenCalledWith('dev');
      expect(gitClientInstance.fetch).toHaveBeenCalledWith(['upstream']);
      expect(gitClientInstance.revList).toHaveBeenCalledWith(['dev..upstream/main']);
      expect(sessionLoggerInstance.info).toHaveBeenCalledWith('No new changes in upstream/main to sync to dev.');
      expect(gitClientInstance.merge).not.toHaveBeenCalled();
      expect(resultContainer.details[0].status).toBe('skipped');
    });
  });

  // --- mergeUpstreamChanges Tests (tested via syncRepository call path) ---
  describe('mergeUpstreamChanges behavior', () => {
    beforeEach(() => {
        gitClientInstance.revList.mockResolvedValue('onecommit\n'); // Ensure checkForUpstreamChanges returns true
    });

    it('should checkout forkBranch, merge upstream/upstreamBranch, and push to origin forkBranch on success', async () => {
      await startSync({ accounts: mockAccount, ...mockMainConfig, repos: [repoConfig] });

      expect(gitClientInstance.checkout).toHaveBeenCalledWith('dev'); // Ensures on forkBranch before merge
      expect(gitClientInstance.revParse).toHaveBeenCalledWith(['HEAD']);
      expect(gitClientInstance.merge).toHaveBeenCalledWith(['upstream/main']);
      expect(gitClientInstance.push).toHaveBeenCalledWith(['origin', 'dev']);
      expect(sessionLoggerInstance.info).toHaveBeenCalledWith('Merge of upstream/main into dev completed successfully without conflicts.');
      expect(sessionLoggerInstance.info).toHaveBeenCalledWith('Pushing merged changes to origin/dev.');
    });

    it('should attempt LLM conflict resolution if merge conflicts occur', async () => {
      gitClientInstance.merge.mockRejectedValueOnce(new Error('Merge failed with CONFLICTS'));
      gitClientInstance.status.mockResolvedValueOnce({ conflicted: ['file1.js', 'file2.txt'] });
      resolveConflicts.mockResolvedValueOnce({ success: true }); // LLM resolves successfully

      await startSync({ accounts: mockAccount, ...mockMainConfig, repos: [repoConfig] });

      expect(resolveConflicts).toHaveBeenCalledWith(gitClientInstance, ['file1.js', 'file2.txt'], mockMainConfig.llm, sessionLoggerInstance);
      expect(gitClientInstance.commit).toHaveBeenCalledWith('Automated merge conflict resolution from upstream/main');
      expect(gitClientInstance.push).toHaveBeenCalledWith(['origin', 'dev']);
      expect(sessionLoggerInstance.info).toHaveBeenCalledWith('Conflicts resolved successfully by LLM.');
    });

    it('should abort merge if LLM conflict resolution fails', async () => {
      gitClientInstance.merge.mockRejectedValueOnce(new Error('Merge failed with CONFLICTS'));
      gitClientInstance.status.mockResolvedValueOnce({ conflicted: ['file1.js'] });
      resolveConflicts.mockResolvedValueOnce({ success: false, error: 'LLM dun goofed' });
      gitClientInstance.merge.mockResolvedValueOnce({}); // For the --abort call

      const resultContainer = await startSync({ accounts: mockAccount, ...mockMainConfig, repos: [repoConfig] });

      expect(resolveConflicts).toHaveBeenCalledTimes(1);
      expect(gitClientInstance.merge).toHaveBeenCalledWith(['--abort']); // Attempt to abort
      expect(sessionLoggerInstance.error).toHaveBeenCalledWith('LLM conflict resolution failed:', 'LLM dun goofed');
      expect(resultContainer.details[0].success).toBe(false);
      expect(resultContainer.details[0].error).toContain('Failed to resolve conflicts');
    });
    
    it('should run tests if configured and merge is successful', async () => {
        mockMainConfig.runTestsAfterMerge = true;
        runTests.mockResolvedValue(true); // Tests pass

        await startSync({ accounts: mockAccount, ...mockMainConfig, repos: [repoConfig] });

        expect(runTests).toHaveBeenCalledWith(expect.stringContaining('/base/test-user-user-fork')); // repoDir
        expect(sessionLoggerInstance.info).toHaveBeenCalledWith('Running post-merge tests');
        expect(sessionLoggerInstance.info).toHaveBeenCalledWith('Post-merge tests passed');
    });
  });
  
  // Test overall syncRepository success and failure reporting
  describe('syncRepository overall status reporting', () => {
    it('should report success and "synced" status on a full successful run', async () => {
        gitClientInstance.revList.mockResolvedValue('onecommit\n'); // Has changes
        gitClientInstance.merge.mockResolvedValue({}); // Merge success

        const resultContainer = await startSync({ accounts: mockAccount, ...mockMainConfig, repos: [repoConfig] });
        expect(resultContainer.success).toBe(true);
        expect(resultContainer.syncedRepos).toBe(1);
        expect(resultContainer.failedRepos).toBe(0);
        expect(resultContainer.details[0].success).toBe(true);
        expect(resultContainer.details[0].status).toBe('synced');
        expect(resultContainer.details[0].repository).toBe('user/fork');
    });

    it('should report failure and "error" status if initialization fails', async () => {
        gitClientInstance.checkIsRepo.mockRejectedValueOnce(new Error("Init failed"));
        
        const resultContainer = await startSync({ accounts: mockAccount, ...mockMainConfig, repos: [repoConfig] });
        expect(resultContainer.success).toBe(false);
        expect(resultContainer.failedRepos).toBe(1);
        expect(resultContainer.details[0].success).toBe(false);
        expect(resultContainer.details[0].status).toBe('error');
        expect(resultContainer.details[0].error).toBe('Failed to initialize repository');
    });
  });
});
