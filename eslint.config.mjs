import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';

export default tseslint.config(
  {
    ignores: ['bin/', 'node_modules/', 'test-vault/', 'scripts/', 'tests/', '**/*.mjs', '**/*.js', 'src/pageindex/parsers/pdf-to-markdown.ts'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    plugins: {
      import: importPlugin,
    },
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    settings: {
      'import/resolver': {
        typescript: true,
        node: true,
      },
    },
    rules: {
      // --- 错误捕获 ---
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // --- Import 规范 ---
      'import/no-duplicates': 'warn',
      'import/order': ['warn', {
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
        'newlines-between': 'never',
        alphabetize: { order: 'asc', caseInsensitive: true },
      }],

      // --- 代码质量 ---
      'no-constant-condition': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'prefer-const': 'warn',
      '@typescript-eslint/consistent-type-imports': ['warn', {
        prefer: 'type-imports',
        fixStyle: 'inline-type-imports',
      }],

      // --- 降级已有代码中的 recommended errors 为 warn ---
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-this-alias': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      '@typescript-eslint/no-namespace': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      '@typescript-eslint/no-unsafe-function-type': 'warn',

      // --- 移动端兼容护栏 ---
      // 禁止业务代码静态 import Node 核心模块 / adm-zip：
      // 移动端 Capacitor Obsidian 无完整 Node polyfill，静态 import 会让插件加载即崩。
      // allowTypeImports: type-only import 不引入运行时依赖，放行。
      // 运行时访问统一走 utils/node-compat.ts 的惰性工厂。
      // 兜底：scripts/mobile-load-check.cjs 在 build 期验证加载阶段未触发 Node require。
      '@typescript-eslint/no-restricted-imports': ['error', {
        paths: [
          { name: 'adm-zip', message: 'adm-zip 顶层 require fs/path，静态 import 会让移动端加载即崩。改用 nodeAdmZip()（utils/node-compat.ts）。', allowTypeImports: true },
          { name: 'fs', message: '移动端无 Node polyfill，静态 import 会让插件加载即崩。改用 utils/node-compat.ts / node-fs.ts 的惰性工厂，或函数内 require()。', allowTypeImports: true },
          { name: 'fs/promises', message: '改用 nodeFs()（utils/node-fs.ts）。', allowTypeImports: true },
          { name: 'path', message: '移动端无 Node polyfill，静态 import 会让插件加载即崩。改用函数内 require("path") 或 utils/node-compat.ts。', allowTypeImports: true },
          { name: 'crypto', message: '同上。', allowTypeImports: true },
          { name: 'os', message: '同上。', allowTypeImports: true },
          { name: 'child_process', message: '移动端完全没有 child_process。', allowTypeImports: true },
          { name: 'node:fs', message: '移动端不识别 node: 前缀且无 polyfill。', allowTypeImports: true },
          { name: 'node:fs/promises', message: '同上。', allowTypeImports: true },
          { name: 'node:path', message: '同上。', allowTypeImports: true },
          { name: 'node:crypto', message: '同上。', allowTypeImports: true },
          { name: 'node:os', message: '同上。', allowTypeImports: true },
          { name: 'node:child_process', message: '同上。', allowTypeImports: true },
        ],
      }],
    },
  },
  // 动态加载模块豁免：这些模块通过 dynamic import / external 在运行时按需加载，
  // 不在 main.js 加载阶段执行，故顶层 import Node 模块不会触发移动端加载崩。
  // ⚠️ 新增文件不要加到这里——业务代码默认禁止静态 import Node 模块。
  {
    files: [
      'src/pageindex/unified.ts',
      'src/pageindex/vault/search-v2.ts',
      'src/pageindex/vault/compiler.ts',
      'src/pageindex/vault/compiler-scan.ts',
      'src/pageindex/vault/compiler-reorg.ts',
      'src/pageindex/vault/compiler-state.ts',
    ],
    rules: {
      '@typescript-eslint/no-restricted-imports': 'off',
    },
  },
);
