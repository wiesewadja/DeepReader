import * as path from "path";

export const config: WebdriverIO.Config = {
    runner: 'local',
    framework: 'mocha',
    specs: ['tests/e2e/specs/**/*.e2e.ts'],
    maxInstances: 1,

    capabilities: [{
        browserName: 'obsidian',
        browserVersion: 'latest',
        'wdio:obsidianOptions': {
            installerVersion: 'latest',
            plugins: [path.resolve(__dirname, '../bin')],
            vault: path.resolve(__dirname, '../test-vault'),
        },
    }],

    services: ['obsidian'],
    reporters: ['spec'],

    cacheDir: path.resolve(__dirname, '../.obsidian-cache'),

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
