import * as path from "path";

export const config: WebdriverIO.Config = {
    runner: 'local',
    framework: 'mocha',
    specs: ['./tests/specs/**/*.e2e.ts'],
    maxInstances: 1,

    capabilities: [{
        browserName: 'obsidian',
        browserVersion: 'latest',
        'wdio:obsidianOptions': {
            installerVersion: 'earliest',
            plugins: ['./bin'],
            vault: './test-vault',
        },
    }],

    services: ['obsidian'],
    reporters: ['spec'],

    cacheDir: path.resolve('.obsidian-cache'),

    mochaOpts: {
        ui: 'bdd',
        timeout: 600000, // 10 分钟（LLM 摘要多章节需要时间）
    },

    autoCompileOpts: {
        autoCompile: true,
        tsNodeOpts: { project: 'tsconfig.json' },
    },

    logLevel: 'warn',
};
