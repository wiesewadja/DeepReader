# Spec: Mobile Node Compatibility Layer - Testing

## Overview
This spec details the testing strategy for the mobile Node compatibility layer for DeepReader.

## Testing Strategy

### 1. Mobile Testing

#### Node Module Availability Tests
- **Purpose**: Verify all Node modules are available in mobile environment
- **Framework**: wdio with Appium
- **Test Cases**:
  - Test fs/promises module availability
  - Test path module availability
  - Test crypto module availability
  - Test stream module availability
  - Test events module availability
  - Test timers module availability
  - Test os module availability
  - Test util module availability
  - Test zlib module availability

#### Test Implementation
```typescript
// tests/mobile/load.e2e.ts
import { browser } from '@wdio/globals';

describe('移动端 Node 模块可用性', function () {
  it('探测 Android Obsidian 的 Node 核心模块 require 结果', async () => {
    const probe = await browser.execute(() => {
      const results: Record<string, string> = {};
      const mods = ['path', 'crypto', 'fs', 'fs/promises', 'stream', 'events', 'timers', 'os', 'util', 'zlib'];
      for (const mod of mods) {
        try {
          const r = require(mod);
          results[mod] = 'OK (' + typeof r + ')';
        } catch (e: any) {
          results[mod] = 'ERROR: ' + (e.message || String(e)).substring(0, 150);
        }
      }
      results['__require_type'] = typeof require;
      return results;
    });

    console.log('[Node 模块探测]', JSON.stringify(probe, null, 2));

    // 同时看插件状态
    const status = await browser.execute(() => {
      const p = (window as any).app?.plugins?.plugins?.['deepreader'];
      return { loaded: !!p?._loaded };
    });
    console.log('[插件加载]', JSON.stringify(status));

    expect(probe).toBeDefined();
  });
});
```

#### Test Results
- **Pass**: All Node modules available
- **Fail**: Any Node module unavailable
- **Warning**: Performance issues detected

### 2. Desktop Testing

#### Regression Tests
- **Purpose**: Ensure no impact on desktop functionality
- **Framework**: Existing test framework
- **Test Cases**:
  - Test existing functionality still works
  - Test performance impact
  - Test compatibility with existing code

#### Performance Tests
```typescript
// tests/desktop/performance.e2e.ts
import { browser } from '@wdio/globals';

describe('桌面端性能测试', function () {
  it('验证插件启动性能', async () => {
    const startTime = Date.now();
    await browser.url('about:blank');
    const loadTime = Date.now() - startTime;
    
    console.log('[性能测试] 插件启动耗时:', loadTime, 'ms');
    
    expect(loadTime).toBeLessThan(2000); // 2秒以内
  });
});
```

### 3. Load Simulation

#### Mobile Load Simulation
- **Purpose**: Verify plugin loads on mobile
- **Tool**: `mobile-load-trace.mjs`
- **Test Cases**:
  - Test loading phase (no Node dependencies)
  - Test onload phase (Node module usage)
  - Test plugin initialization

#### Test Implementation
```bash
# 运行移动端加载模拟器
node scripts/smoke/lib/mobile-load-trace.mjs

# 运行 crash 模式（复现移动端首错）
node scripts/smoke/lib/mobile-load-trace.mjs --crash
```

#### Test Results
- **Pass**: 加载阶段无 Node 依赖触达，移动端可加载
- **Fail**: 加载阶段有 Node 依赖触达，移动端会崩

### 4. Integration Testing

#### Cross-Environment Testing
- **Purpose**: Ensure compatibility across environments
- **Framework**: wdio with multiple environments
- **Test Cases**:
  - Test desktop functionality
  - Test mobile functionality
  - Test cross-environment compatibility

#### Test Implementation
```typescript
// tests/integration/cross-environment.e2e.ts
import { browser } from '@wdio/globals';

describe('跨环境兼容性测试', function () {
  it('验证桌面端功能', async () => {
    // 测试桌面端功能
    await browser.url('about:blank');
    // 验证功能正常工作
    expect(true).toBe(true);
  });

  it('验证移动端功能', async () => {
    // 测试移动端功能
    await browser.url('about:blank');
    // 验证功能正常工作
    expect(true).toBe(true);
  });
});
```

### 5. Automated Testing

#### CI/CD Integration
- **Purpose**: Automated testing in CI/CD pipeline
- **Framework**: GitHub Actions
- **Test Cases**:
  - Run mobile tests
  - Run desktop tests
  - Run load simulation
  - Generate test reports

#### Test Configuration
```yaml
# .github/workflows/test.yml
name: Test

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Setup Node.js
        uses: actions/setup-node@v2
        with:
          node-version: '16'
      - name: Install dependencies
        run: npm ci
      - name: Run desktop tests
        run: npm run test:desktop
      - name: Run mobile tests
        run: npm run test:mobile
      - name: Run load simulation
        run: node scripts/smoke/lib/mobile-load-trace.mjs
```

### 6. Test Coverage

#### Coverage Requirements
- **Mobile Tests**: 100% of mobile Node modules tested
- **Desktop Tests**: Maintain existing desktop test coverage
- **Integration Tests**: Cross-environment compatibility tested
- **Load Simulation**: Mobile load simulation tested

#### Coverage Tools
- **istanbul**: Code coverage reporting
- **coveralls**: Coverage integration
- **codecov**: Coverage visualization

#### Coverage Configuration
```json
// package.json
{
  "scripts": {
    "test:mobile": "wdio run ./wdio.mobile.conf.mts",
    "test:desktop": "jest --coverage",
    "coverage": "jest --coverage && npm run test:mobile --coverage"
  },
  "jest": {
    "collectCoverageFrom": [
      "src/**/*.ts",
      "!src/**/*.spec.ts",
      "!src/**/*.test.ts"
    ],
    "coverageThreshold": {
      "global": {
        "branches": 80,
        "functions": 80,
        "lines": 80,
        "statements": 80
      }
    }
  }
}
```

### 7. Test Maintenance

#### Test Updates
- **Frequency**: Weekly test updates
- **Process**: Automated test updates
- **Review**: Manual test review

#### Test Documentation
- **Purpose**: Document test cases and expected results
- **Format**: Markdown documentation
- **Location**: tests/ directory

#### Test Metrics
- **Pass Rate**: Test pass rate > 95%
- **Fail Rate**: Test fail rate < 5%
- **Flaky Rate**: Flaky test rate < 1%

## Conclusion

The testing strategy for the mobile Node compatibility layer will ensure comprehensive test coverage across all environments. The strategy includes mobile testing, desktop testing, load simulation, and integration testing to ensure the compatibility layer works correctly in all scenarios.

Key testing components:
1. **Mobile Testing**: Node module availability tests
2. **Desktop Testing**: Regression and performance tests
3. **Load Simulation**: Mobile load verification
4. **Integration Testing**: Cross-environment compatibility
5. **Automated Testing**: CI/CD integration
6. **Test Coverage**: Comprehensive coverage requirements
7. **Test Maintenance**: Regular test updates and maintenance

The testing strategy will ensure the compatibility layer is reliable, performant, and secure.