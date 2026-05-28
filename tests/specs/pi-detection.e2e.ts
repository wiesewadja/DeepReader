/**
 * PI Agent CLI — 检测 + 更新操作 E2E 测试
 *
 * 验证 spawn + buildSpawnEnv 方案在 Obsidian Electron 环境中
 * 能正确检测 PI CLI 并执行更新操作。
 */
describe('PI Agent 集成', () => {
    it('应该检测到已安装的 PI CLI', async () => {
        const result = await browser.executeObsidian(async () => {
            const { spawn } = require('child_process');
            const { homedir } = require('os');
            const { join } = require('path');

            const extraPaths = ['/opt/homebrew/bin', '/usr/local/bin'];
            const existingPath = (process.env.PATH ?? '').split(':');
            const env = { ...process.env, PATH: [...new Set([...extraPaths, ...existingPath])].join(':') };

            const candidates = ['/opt/homebrew/bin/pi', '/usr/local/bin/pi', 'pi'];

            for (const cliPath of candidates) {
                try {
                    const output = await new Promise<string>((resolve, reject) => {
                        const child = spawn(cliPath, ['--version'], {
                            timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'], env,
                        });
                        let out = '';
                        child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
                        child.stderr.on('data', (d: Buffer) => { out += d.toString(); });
                        child.on('error', reject);
                        child.on('close', (code: number) => {
                            code === 0 ? resolve(out.trim()) : reject(new Error(`Exit ${code}`));
                        });
                    });
                    if (/^\d+\.\d+\.\d+/.test(output)) {
                        return { detected: true, version: output, path: cliPath };
                    }
                } catch { continue; }
            }
            return { detected: false };
        });

        console.log('[PI-E2E] 检测结果:', JSON.stringify(result));
        expect(result.detected).toBe(true);
    });

    it('应该能执行 pi update --self 并获取更新结果', async () => {
        const result = await browser.executeObsidian(async () => {
            const { spawn } = require('child_process');
            const { homedir } = require('os');
            const { join } = require('path');

            // 构建 spawn env（与 buildSpawnEnv 相同逻辑）
            const extraPaths = ['/opt/homebrew/bin', '/usr/local/bin'];
            const existingPath = (process.env.PATH ?? '').split(':');
            const env = { ...process.env, PATH: [...new Set([...extraPaths, ...existingPath])].join(':') };

            // 先获取更新前版本
            const beforeVersion = await new Promise<string>((resolve, reject) => {
                const child = spawn('/opt/homebrew/bin/pi', ['--version'], {
                    timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'], env,
                });
                let out = '';
                child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
                child.stderr.on('data', (d: Buffer) => { out += d.toString(); });
                child.on('error', reject);
                child.on('close', (code: number) => {
                    code === 0 ? resolve(out.trim()) : reject(new Error(`Exit ${code}`));
                });
            });

            // 执行更新
            const updateResult = await new Promise<{ success: boolean; output: string }>((resolve) => {
                const child = spawn('/opt/homebrew/bin/pi', ['update', '--self'], {
                    timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'], env,
                });
                let stdout = '';
                let stderr = '';
                child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
                child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
                child.on('error', (e: Error) => resolve({ success: false, output: e.message }));
                child.on('close', (code: number) => {
                    resolve({
                        success: code === 0,
                        output: (stdout + stderr).trim(),
                    });
                });
            });

            // 获取更新后版本
            const afterVersion = await new Promise<string>((resolve, reject) => {
                const child = spawn('/opt/homebrew/bin/pi', ['--version'], {
                    timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'], env,
                });
                let out = '';
                child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
                child.stderr.on('data', (d: Buffer) => { out += d.toString(); });
                child.on('error', reject);
                child.on('close', (code: number) => {
                    code === 0 ? resolve(out.trim()) : reject(new Error(`Exit ${code}`));
                });
            });

            return { beforeVersion, updateResult, afterVersion };
        });

        console.log('[PI-E2E] 更新前版本:', result.beforeVersion);
        console.log('[PI-E2E] 更新结果:', JSON.stringify(result.updateResult));
        console.log('[PI-E2E] 更新后版本:', result.afterVersion);

        // 验证更新命令执行成功
        expect(result.updateResult.success).toBe(true);
        // 验证更新后仍能获取版本号
        expect(result.afterVersion).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('npm install 命令在 Obsidian 环境中可执行', async () => {
        const result = await browser.executeObsidian(async () => {
            const { spawn } = require('child_process');
            const { homedir } = require('os');
            const { join } = require('path');

            const extraPaths = ['/opt/homebrew/bin', '/usr/local/bin'];
            const existingPath = (process.env.PATH ?? '').split(':');
            const env = { ...process.env, PATH: [...new Set([...extraPaths, ...existingPath])].join(':') };

            // 不实际安装，只验证 npm --version 能执行（证明 npm 可用）
            return new Promise<{ success: boolean; version?: string; error?: string }>((resolve) => {
                const child = spawn('npm', ['--version'], {
                    timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'], env,
                });
                let out = '';
                child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
                child.stderr.on('data', (d: Buffer) => { out += d.toString(); });
                child.on('error', (e: Error) => resolve({ success: false, error: e.message }));
                child.on('close', (code: number) => {
                    if (code === 0) resolve({ success: true, version: out.trim() });
                    else resolve({ success: false, error: `Exit ${code}: ${out.trim()}` });
                });
            });
        });

        console.log('[PI-E2E] npm 可用性:', JSON.stringify(result));
        expect(result.success).toBe(true);
    });
});
