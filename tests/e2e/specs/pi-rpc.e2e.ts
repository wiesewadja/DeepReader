/**
 * PI Agent RPC 通信 E2E 测试
 *
 * 在 Obsidian Electron 环境中验证 PI RPC 协议完整流程：
 * spawn → prompt → 流式事件 → 工具调用 → session 管理
 *
 * 注意：browser.executeObsidian 的参数序列化限制导致无法提取
 * 公共辅助函数。每个测试用例内联 spawn + JSONL 解析逻辑。
 */

const PI_BASE_ARGS = [
    '--mode', 'rpc',
    '--provider', 'xiaomi-token-plan-cn',
    '--model', 'mimo-v2.5',
    '--no-session', '--no-skills', '--no-extensions',
];

/**
 * 在 Obsidian Electron 内构建 spawn 环境（PATH 补全）
 */
function buildSpawnEnv(): Record<string, string> {
    const { homedir } = require('os');
    const { join } = require('path');
    const extraPaths = ['/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.npm-global/bin')];
    const existingPath = (process.env.PATH ?? '').split(':');
    return { ...process.env, PATH: [...new Set([...extraPaths, ...existingPath])].join(':') } as Record<string, string>;
}

describe('PI Agent RPC 通信', () => {
    it('基础通信：prompt → agent_end 完整事件链', async () => {
        const events = await browser.executeObsidian(async () => {
            const { spawn } = require('child_process');
            const env = { ...process.env, PATH: ['/opt/homebrew/bin', '/usr/local/bin', ...(process.env.PATH ?? '').split(':')].join(':') };

            return new Promise<any[]>((resolve, reject) => {
                const child = spawn('/opt/homebrew/bin/pi', [
                    '--mode', 'rpc', '--provider', 'xiaomi-token-plan-cn', '--model', 'mimo-v2.5',
                    '--no-session', '--no-skills', '--no-tools', '--no-extensions',
                ], { stdio: ['pipe', 'pipe', 'pipe'], env });

                const events: any[] = [];
                let buffer = '';
                let settled = false;

                const timer = setTimeout(() => {
                    if (!settled) { settled = true; child.kill(); reject(new Error('timeout')); }
                }, 90_000);

                child.stdout.on('data', (d: Buffer) => {
                    buffer += d.toString('utf8');
                    while (true) {
                        const idx = buffer.indexOf('\n');
                        if (idx === -1) break;
                        const line = buffer.substring(0, idx);
                        buffer = buffer.substring(idx + 1);
                        if (!line.trim()) continue;
                        try {
                            const evt = JSON.parse(line);
                            events.push(evt);
                            if (evt.type === 'agent_end' && !settled) {
                                settled = true;
                                clearTimeout(timer);
                                setTimeout(() => { child.kill(); resolve(events); }, 200);
                            }
                        } catch {}
                    }
                });

                child.on('error', (err: Error) => {
                    if (!settled) { settled = true; clearTimeout(timer); reject(err); }
                });
                child.on('close', () => {
                    if (!settled) { settled = true; clearTimeout(timer); resolve(events); }
                });

                setTimeout(() => {
                    child.stdin.write(JSON.stringify({ type: 'prompt', message: '回复 OK' }) + '\n');
                }, 1000);
            });
        });

        const types = events.map((e: any) => e.type);
        expect(types).toContain('response');
        expect(types).toContain('agent_start');
        expect(types).toContain('agent_end');

        const resp = events.find((e: any) => e.type === 'response');
        expect(resp.success).toBe(true);

        const agentEnd = events.find((e: any) => e.type === 'agent_end');
        expect(agentEnd.messages).toBeDefined();
        expect(agentEnd.messages.length).toBeGreaterThanOrEqual(2);
    });

    it('流式事件：收到 text_delta', async () => {
        const events = await browser.executeObsidian(async () => {
            const { spawn } = require('child_process');
            const env = { ...process.env, PATH: ['/opt/homebrew/bin', '/usr/local/bin', ...(process.env.PATH ?? '').split(':')].join(':') };

            return new Promise<any[]>((resolve, reject) => {
                const child = spawn('/opt/homebrew/bin/pi', [
                    '--mode', 'rpc', '--provider', 'xiaomi-token-plan-cn', '--model', 'mimo-v2.5',
                    '--no-session', '--no-skills', '--no-tools', '--no-extensions',
                ], { stdio: ['pipe', 'pipe', 'pipe'], env });

                const events: any[] = [];
                let buffer = '';
                let settled = false;

                const timer = setTimeout(() => {
                    if (!settled) { settled = true; child.kill(); reject(new Error('timeout')); }
                }, 90_000);

                child.stdout.on('data', (d: Buffer) => {
                    buffer += d.toString('utf8');
                    while (true) {
                        const idx = buffer.indexOf('\n');
                        if (idx === -1) break;
                        const line = buffer.substring(0, idx);
                        buffer = buffer.substring(idx + 1);
                        if (!line.trim()) continue;
                        try {
                            const evt = JSON.parse(line);
                            events.push(evt);
                            if (evt.type === 'agent_end' && !settled) {
                                settled = true;
                                clearTimeout(timer);
                                setTimeout(() => { child.kill(); resolve(events); }, 200);
                            }
                        } catch {}
                    }
                });

                child.on('error', (err: Error) => {
                    if (!settled) { settled = true; clearTimeout(timer); reject(err); }
                });
                child.on('close', () => {
                    if (!settled) { settled = true; clearTimeout(timer); resolve(events); }
                });

                setTimeout(() => {
                    child.stdin.write(JSON.stringify({ type: 'prompt', message: '说你好' }) + '\n');
                }, 1000);
            });
        });

        const textDeltas = events.filter(
            (e: any) => e.type === 'message_update'
                && e.assistantMessageEvent?.type === 'text_delta',
        );

        expect(textDeltas.length).toBeGreaterThan(0);

        const fullText = textDeltas
            .map((e: any) => e.assistantMessageEvent.delta ?? '')
            .join('');
        expect(fullText.length).toBeGreaterThan(0);

        console.log('[PI-E2E] 流式文本:', fullText.substring(0, 100));
    });

    it('工具调用：write 文件', async () => {
        const testFilePath = '/tmp/pi-e2e-write-test.txt';
        const testContent = 'PI E2E test ' + Date.now();

        const events = await browser.executeObsidian(async (filePath: string, content: string) => {
            const { spawn } = require('child_process');
            const env = { ...process.env, PATH: ['/opt/homebrew/bin', '/usr/local/bin', ...(process.env.PATH ?? '').split(':')].join(':') };

            return new Promise<any[]>((resolve, reject) => {
                const child = spawn('/opt/homebrew/bin/pi', [
                    '--mode', 'rpc', '--provider', 'xiaomi-token-plan-cn', '--model', 'mimo-v2.5',
                    '--no-session', '--no-skills', '--no-extensions',
                    '--tools', 'write',
                ], { stdio: ['pipe', 'pipe', 'pipe'], env });

                const events: any[] = [];
                let buffer = '';
                let settled = false;

                const timer = setTimeout(() => {
                    if (!settled) { settled = true; child.kill(); reject(new Error('timeout')); }
                }, 90_000);

                child.stdout.on('data', (d: Buffer) => {
                    buffer += d.toString('utf8');
                    while (true) {
                        const idx = buffer.indexOf('\n');
                        if (idx === -1) break;
                        const line = buffer.substring(0, idx);
                        buffer = buffer.substring(idx + 1);
                        if (!line.trim()) continue;
                        try {
                            const evt = JSON.parse(line);
                            events.push(evt);
                            if (evt.type === 'agent_end' && !settled) {
                                settled = true;
                                clearTimeout(timer);
                                setTimeout(() => { child.kill(); resolve(events); }, 200);
                            }
                        } catch {}
                    }
                });

                child.on('error', (err: Error) => {
                    if (!settled) { settled = true; clearTimeout(timer); reject(err); }
                });
                child.on('close', () => {
                    if (!settled) { settled = true; clearTimeout(timer); resolve(events); }
                });

                setTimeout(() => {
                    child.stdin.write(JSON.stringify({
                        type: 'prompt',
                        message: `Write exactly "${content}" to ${filePath}. No extra text.`,
                    }) + '\n');
                }, 1000);
            });
        }, testFilePath, testContent);

        const types = events.map((e: any) => e.type);
        expect(types).toContain('tool_execution_start');
        expect(types).toContain('tool_execution_end');

        const toolStart = events.find((e: any) => e.type === 'tool_execution_start');
        expect(toolStart.toolName).toBe('write');

        const toolEnd = events.find((e: any) => e.type === 'tool_execution_end');
        expect(toolEnd.isError).toBe(false);

        const writeResult = toolEnd.result?.content?.map((c: any) => c.text ?? '').join('') ?? '';
        expect(writeResult.toLowerCase()).toContain('wrote');
        console.log('[PI-E2E] write 工具结果:', writeResult.substring(0, 100));
    });

    it('new_session 隔离上下文', async () => {
        const result = await browser.executeObsidian(async () => {
            const { spawn } = require('child_process');
            const env = { ...process.env, PATH: ['/opt/homebrew/bin', '/usr/local/bin', ...(process.env.PATH ?? '').split(':')].join(':') };

            return new Promise<any>((resolve, reject) => {
                const child = spawn('/opt/homebrew/bin/pi', [
                    '--mode', 'rpc', '--provider', 'xiaomi-token-plan-cn', '--model', 'mimo-v2.5',
                    '--no-session', '--no-skills', '--no-tools', '--no-extensions',
                ], { stdio: ['pipe', 'pipe', 'pipe'], env });

                let buffer = '';
                let settled = false;
                let phase: 'first-prompt' | 'new-session' | 'second-prompt' = 'first-prompt';
                const phases: Record<string, any[]> = { 'first-prompt': [], 'new-session': [], 'second-prompt': [] };

                const timer = setTimeout(() => {
                    if (!settled) { settled = true; child.kill(); reject(new Error('timeout')); }
                }, 120_000);

                const processEvents = () => {
                    while (true) {
                        const idx = buffer.indexOf('\n');
                        if (idx === -1) break;
                        const line = buffer.substring(0, idx);
                        buffer = buffer.substring(idx + 1);
                        if (!line.trim()) continue;
                        try {
                            const evt = JSON.parse(line);
                            phases[phase].push(evt);

                            if (evt.type === 'agent_end') {
                                if (phase === 'first-prompt') {
                                    phase = 'new-session';
                                    child.stdin.write(JSON.stringify({ type: 'new_session', id: 'ns-1' }) + '\n');
                                } else if (phase === 'second-prompt') {
                                    settled = true;
                                    clearTimeout(timer);
                                    setTimeout(() => { child.kill(); resolve(phases); }, 200);
                                }
                            }

                            if (evt.type === 'response' && phase === 'new-session') {
                                phase = 'second-prompt';
                                setTimeout(() => {
                                    child.stdin.write(JSON.stringify({
                                        type: 'prompt', message: '回复 SECOND',
                                    }) + '\n');
                                }, 500);
                            }
                        } catch {}
                    }
                };

                child.stdout.on('data', (d: Buffer) => {
                    buffer += d.toString('utf8');
                    processEvents();
                });

                child.on('error', (err: Error) => {
                    if (!settled) { settled = true; clearTimeout(timer); reject(err); }
                });
                child.on('close', () => {
                    if (!settled) { settled = true; clearTimeout(timer); resolve(phases); }
                });

                setTimeout(() => {
                    child.stdin.write(JSON.stringify({ type: 'prompt', message: '回复 FIRST' }) + '\n');
                }, 1000);
            });
        });

        const firstMessages = result['first-prompt'].find((e: any) => e.type === 'agent_end')?.messages ?? [];
        const firstUserText = firstMessages[0]?.content?.[0]?.text ?? '';
        expect(firstUserText).toContain('FIRST');

        const nsResp = result['new-session'].find((e: any) => e.type === 'response');
        expect(nsResp?.success).toBe(true);

        const secondMessages = result['second-prompt'].find((e: any) => e.type === 'agent_end')?.messages ?? [];
        const secondUserText = secondMessages[0]?.content?.[0]?.text ?? '';
        expect(secondUserText).toContain('SECOND');
        expect(secondMessages.length).toBeLessThanOrEqual(2);
    });

    it('get_session_stats 返回统计数据', async () => {
        const result = await browser.executeObsidian(async () => {
            const { spawn } = require('child_process');
            const env = { ...process.env, PATH: ['/opt/homebrew/bin', '/usr/local/bin', ...(process.env.PATH ?? '').split(':')].join(':') };

            return new Promise<any>((resolve, reject) => {
                const child = spawn('/opt/homebrew/bin/pi', [
                    '--mode', 'rpc', '--provider', 'xiaomi-token-plan-cn', '--model', 'mimo-v2.5',
                    '--no-session', '--no-skills', '--no-tools', '--no-extensions',
                ], { stdio: ['pipe', 'pipe', 'pipe'], env });

                const events: any[] = [];
                let buffer = '';
                let settled = false;
                let promptDone = false;

                const timer = setTimeout(() => {
                    if (!settled) { settled = true; child.kill(); reject(new Error('timeout')); }
                }, 90_000);

                child.stdout.on('data', (d: Buffer) => {
                    buffer += d.toString('utf8');
                    while (true) {
                        const idx = buffer.indexOf('\n');
                        if (idx === -1) break;
                        const line = buffer.substring(0, idx);
                        buffer = buffer.substring(idx + 1);
                        if (!line.trim()) continue;
                        try {
                            const evt = JSON.parse(line);
                            events.push(evt);

                            if (evt.type === 'agent_end' && !promptDone) {
                                promptDone = true;
                                setTimeout(() => {
                                    child.stdin.write(JSON.stringify({
                                        type: 'get_session_stats', id: 'stats-1',
                                    }) + '\n');
                                }, 500);
                            }

                            if (evt.type === 'response' && evt.id === 'stats-1') {
                                settled = true;
                                clearTimeout(timer);
                                setTimeout(() => { child.kill(); resolve(events); }, 200);
                            }
                        } catch {}
                    }
                });

                child.on('error', (err: Error) => {
                    if (!settled) { settled = true; clearTimeout(timer); reject(err); }
                });
                child.on('close', () => {
                    if (!settled) { settled = true; clearTimeout(timer); resolve(events); }
                });

                setTimeout(() => {
                    child.stdin.write(JSON.stringify({ type: 'prompt', message: 'hello' }) + '\n');
                }, 1000);
            });
        });

        const statsResp = result.find((e: any) => e.type === 'response' && e.id === 'stats-1');
        expect(statsResp).toBeDefined();
        expect(statsResp.success).toBe(true);

        const data = statsResp.data;
        expect(data.userMessages).toBeGreaterThanOrEqual(1);
        expect(data.tokens).toBeDefined();
        expect(data.tokens.total).toBeGreaterThan(0);
        expect(data.cost).toBeDefined();

        console.log('[PI-E2E] Session stats:', JSON.stringify({
            userMessages: data.userMessages,
            totalTokens: data.tokens.total,
            cost: data.cost,
        }));
    });
});
