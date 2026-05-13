# 贡献指南

感谢你对 DeepReader 的关注！欢迎参与贡献。

## 开发流程

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feat/your-feature`
3. 提交修改：遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范
4. 推送分支：`git push origin feat/your-feature`
5. 提交 Pull Request

## 本地开发

```bash
npm install          # 安装依赖
npm run dev          # 启动 watch 模式
npm run build        # 生产构建
npm run test:run     # 运行测试
npm run deploy       # 部署到 test-vault
```

## 代码规范

- TypeScript strict mode
- 函数和变量使用 camelCase
- CSS 类名使用 kebab-case，前缀 `deeppdf-`
- 日志通过 `utils/logger.ts` 模块化输出
- 文件路径通过 Vault API 获取，不硬编码

## Commit 规范

```
feat: 新功能
fix: 修复 bug
refactor: 重构（不改变行为）
docs: 文档更新
test: 测试相关
chore: 构建/工具变更
```

## 测试

- 新功能需附带测试
- 运行 `npm run test:run` 确保不引入回归
- 构建 `npm run build` 必须通过

## 问题反馈

请在 GitHub Issues 中提交 bug 或功能建议。
