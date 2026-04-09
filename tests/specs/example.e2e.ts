describe('DeepReader', () => {
    it('应该能正常加载并执行命令', async () => {
        // 1. 等待 Obsidian 加载完成
        await browser.pause(2000); 

        // 2. 使用服务提供的快捷命令执行 Obsidian 指令
        // 假设你的插件注册了一个名为 "open-sample-modal" 的命令
        await browser.executeObsidian((app) => {
            app.commands.executeCommandById('your-plugin-id:open-sample-modal');
        });

        // 3. UI 验证：检查 Modal 是否弹出
        const modal = await $('.modal');
        await expect(modal).toBeDisplayed();

        // 4. 内容验证
        const title = await $('.modal-title');
        await expect(title).toHaveText('Sample Modal');
    });

    it('验证文件创建逻辑', async () => {
        // 直接在 Obsidian 环境内运行 JS 并返回结果
        const fileExists = await browser.executeObsidian(async (app) => {
            await app.vault.create('test-file.md', 'Hello World');
            return app.vault.getAbstractFileByPath('test-file.md') !== null;
        });

        expect(fileExists).toBe(true);
    });
});