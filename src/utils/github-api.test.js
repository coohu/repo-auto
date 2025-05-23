'use strict';
require('dotenv').config();

const { initializeGitHubClient, getOctokit, getRepoDetails, } = require('./github-api');
const TEST_TOKEN = process.env.GITHUB_TOKEN_PERSONAL
const TEST_REPO_OWNER = 'coohu';
const TEST_REPO_NAME = 'generalBot';
console.log(TEST_TOKEN,"-------------GITHUB_TOKEN_PERSONAL-------------")
async function runTests() {
  try {
    initializeGitHubClient(TEST_TOKEN);
    const octokit = getOctokit();
    if (octokit) {
      console.log('测试通过: Octokit 实例成功初始化');
    } else {
      console.error('测试失败: Octokit 实例未初始化');
    }
    const repoDetails = await getRepoDetails(TEST_REPO_OWNER, TEST_REPO_NAME);
    if (repoDetails) {
      console.log('测试通过: 成功获取仓库详情');
      console.log(JSON.stringify(repoDetails, null, 2));
    } else {
      console.error('测试失败: 无法获取仓库详情');
    }
  } catch (error) {
    console.error('测试过程中发生错误:', error);
  }
}
runTests();