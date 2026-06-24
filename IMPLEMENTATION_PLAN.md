# Implementation Plan: DeepReader Mobile Node Compatibility Layer

## Overview
Implement a Node.js compatibility layer for DeepReader plugin to support mobile environments (Android Obsidian Capacitor) where Node core modules are not available. The compatibility layer will polyfill missing Node modules (fs/promises, path, crypto, stream, events, timers, os, util, zlib) while maintaining full desktop functionality.

## Architecture Decisions

### 1. Polyfill Strategy
- **Existing Foundation**: Leverage existing `node-fs.ts` (lazy fs/promises) and `mobile-fs.ts` (Obsidian vault adapter)
- **New Layer**: Create `mobile-node-compat.ts` as the main polyfill module
- **Integration**: Use existing Obsidian API where possible, polyfill only missing functionality

### 2. Implementation Approach
- **Desktop**: Use native Node modules (no polyfill overhead)
- **Mobile**: Use polyfill implementations
- **Detection**: Runtime environment detection based on Obsidian API availability
- **Build Separation**: Separate build configurations for desktop vs mobile

### 3. Testing Strategy
- **Mobile Tests**: wdio tests in `tests/mobile/` for Node module availability
- **Desktop Tests**: Existing unit tests to ensure no regression
- **Load Simulation**: `mobile-load-trace.mjs` for mobile load verification
- **Integration Tests**: Cross-environment compatibility tests

## Task List

### Phase 1: Foundation (Tasks 1-3)

#### Task 1: Create Mobile Node Compatibility Module
**Description:** Implement `src/utils/mobile-node-compat.ts` with polyfills for all missing Node modules.

**Acceptance criteria:**
- [ ] All Node modules (fs/promises, path, crypto, stream, events, timers, os, util, zlib) are available in mobile environment
- [ ] Polyfills use Obsidian API where possible
- [ ] Desktop builds use native Node modules (no polyfill overhead)
- [ ] Mobile builds use polyfill implementations

**Verification:**
- [ ] Build passes: `npm run build:desktop`
- [ ] Build passes: `npm run build:mobile`
- [ ] Tests pass: `npm run test:mobile`

**Dependencies:** None

**Files likely touched:**
- `src/utils/mobile-node-compat.ts`
- `esbuild.config.mjs`
- `package.json`

**Estimated scope:** Medium

#### Task 2: Update Build Configuration
**Description:** Update `esbuild.config.mjs` to support separate desktop and mobile builds with Node modules polyfill.

**Acceptance criteria:**
- [ ] Desktop build uses native Node modules
- [ ] Mobile build uses Node modules polyfill plugin
- [ ] Both builds produce working plugin binaries
- [ ] Build process is automated via npm scripts

**Verification:**
- [ ] Desktop build passes: `npm run build:desktop`
- [ ] Mobile build passes: `npm run build:mobile`
- [ ] Both builds produce valid Obsidian plugin files

**Dependencies:** Task 1

**Files likely touched:**
- `esbuild.config.mjs`
- `package.json`

**Estimated scope:** Small

#### Task 3: Update Mobile Load Simulator
**Description:** Update `scripts/smoke/lib/mobile-load-trace.mjs` to test new polyfills and verify mobile compatibility.

**Acceptance criteria:**
- [ ] Simulator tests all Node modules in polyfill
- [ ] Simulator reports success when all modules available
- [ ] Simulator reports failure when any module missing
- [ ] Simulator integrates with new build process

**Verification:**
- [ ] Simulator runs successfully: `node scripts/smoke/lib/mobile-load-trace.mjs`
- [ ] Simulator reports all Node modules available
- [ ] Simulator exits with code 0 on success

**Dependencies:** Task 1, Task 2

**Files likely touched:**
- `scripts/smoke/lib/mobile-load-trace.mjs`

**Estimated scope:** Small

### Checkpoint: Foundation
- [ ] All foundation tasks complete
- [ ] Desktop and mobile builds successful
- [ ] Mobile load simulator passes
- [ ] Core Node module polyfills functional

### Phase 2: Integration and Testing (Tasks 4-6)

#### Task 4: Update PageIndex Integration
**Description:** Update pageindex modules to use mobile polyfills when on mobile platform.

**Acceptance criteria:**
- [ ] `book-search-v2.ts` uses mobile polyfills on mobile
- [ ] `proposition-search.ts` uses mobile polyfills on mobile
- [ ] `index-tracer.ts` uses mobile polyfills on mobile
- [ ] Desktop behavior unchanged

**Verification:**
- [ ] PageIndex tests pass: `npm run test:desktop`
- [ ] Mobile tests pass: `npm run test:mobile`
- [ ] Plugin functionality verified end-to-end

**Dependencies:** Task 1

**Files likely touched:**
- `src/pageindex/book-search-v2.ts`
- `src/pageindex/proposition-search.ts`
- `src/pageindex/index-tracer.ts`

**Estimated scope:** Medium

#### Task 5: Update Plugin Entry Point
**Description:** Update `src/main.ts` to use mobile polyfills and handle platform-specific behavior.

**Acceptance criteria:**
- [ ] Plugin initializes correctly on both platforms
- [ ] Mobile-specific polyfills loaded when needed
- [ ] Desktop-specific optimizations used on desktop
- [ ] Plugin API remains consistent across platforms

**Verification:**
- [ ] Plugin loads successfully on desktop
- [ ] Plugin loads successfully on mobile
- [ ] Plugin API functions correctly on both platforms

**Dependencies:** Task 1, Task 4

**Files likely touched:**
- `src/main.ts`

**Estimated scope:** Medium

#### Task 6: Add Comprehensive Tests
**Description:** Add comprehensive tests for mobile Node compatibility and cross-platform functionality.

**Acceptance criteria:**
- [ ] All Node modules tested on mobile
- [ ] Cross-platform compatibility verified
- [ ] Performance benchmarks established
- [ ] Test coverage maintained

**Verification:**
- [ ] Mobile tests pass: `npm run test:mobile`
- [ ] Desktop tests pass: `npm run test:desktop`
- [ ] Test coverage meets requirements

**Dependencies:** Task 1, Task 4, Task 5

**Files likely touched:**
- `tests/mobile/load.e2e.ts`
- `tests/e2e-light/`

**Estimated scope:** Medium

### Checkpoint: Core Features
- [ ] All core tasks complete
- [ ] PageIndex integration functional
- [ ] Plugin entry point optimized
- [ ] Comprehensive tests passing

### Phase 3: Validation and Deployment (Tasks 7-8)

#### Task 7: Final Verification
**Description:** Run final verification tests and ensure all requirements are met.

**Acceptance criteria:**
- [ ] All success criteria from spec met
- [ ] Mobile load test passes
- [ ] Desktop functionality unchanged
- [ ] Performance targets achieved

**Verification:**
- [ ] Mobile load test: `node scripts/smoke/lib/mobile-load-trace.mjs`
- [ ] Desktop tests: `npm run test:desktop`
- [ ] Mobile tests: `npm run test:mobile`
- [ ] Build verification: `npm run build:desktop` and `npm run build:mobile`

**Dependencies:** All previous tasks

**Files likely touched:**
- All implementation files
- All test files

**Estimated scope:** Small

#### Task 8: Documentation and Deployment
**Description:** Update documentation and prepare for deployment.

**Acceptance criteria:**
- [ ] Documentation updated
- [ ] Deployment process documented
- [ ] User guides updated
- [ ] Release notes prepared

**Verification:**
- [ ] Documentation complete
- [ ] Deployment process tested
- [ ] User guides updated
- [ ] Release notes prepared

**Dependencies:** All previous tasks

**Files likely touched:**
- Documentation files
- Deployment scripts
- Release notes

**Estimated scope:** Small

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Polyfill correctness | High | Comprehensive testing, use existing Obsidian API where possible |
| Performance impact | Medium | Lazy loading, use native implementations when available |
| Security vulnerabilities | High | Secure polyfill implementations, validate all inputs |
| Build complexity | Medium | Separate build configurations, automate build process |
| Test coverage | Medium | Comprehensive test coverage, maintain existing desktop tests |

## Open Questions
- [ ] Should we use an existing polyfill library (like `node-modules-polyfill`) or build our own minimal implementations?
- [ ] What is the maximum acceptable performance overhead for the polyfill layer?
- [ ] Are there any Node modules not yet identified that mobile users might need?
- [ ] Should we consider using WebAssembly implementations for certain Node modules?
- [ ] How will we handle Node modules that have platform-specific behavior (e.g., `os.platform()`)?

## Verification Checklist

Before starting implementation, confirm:

- [ ] Spec requirements understood and documented
- [ ] Task dependencies identified and ordered correctly
- [ ] No task touches more than ~5 files
- [ ] All tasks have acceptance criteria
- [ ] All tasks have verification steps
- [ ] Checkpoints exist between major phases
- [ ] Human has reviewed and approved the plan

## Parallelization Opportunities

- **Safe to parallelize:** Independent feature slices, tests for already-implemented features, documentation
- **Must be sequential:** Database migrations, shared state changes, dependency chains
- **Needs coordination:** Features that share an API contract (define the contract first, then parallelize)

## Task Sizing Reference

| Size | Files | Scope | Example |
|------|-------|-------|---------|
| **XS** | 1 | Single function or config change | Add a validation rule |
| **S** | 1-2 | One component or endpoint | Add a new API endpoint |
| **M** | 3-5 | One feature slice | User registration flow |
| **L** | 5-8 | **Too large — break it down further** | Search with filtering and pagination |
| **XL** | 8+ | — | — |

If a task is L or larger, it should be broken into smaller tasks. An agent performs best on S and M tasks.

## Red Flags

- Starting implementation without a written task list
- Tasks that say "implement the feature" without acceptance criteria
- No verification steps in the plan
- All tasks are XL-sized
- No checkpoints between tasks
- Dependency order isn't considered
- A task involves 3 or more unrelated modules

## Conclusion

This implementation plan provides a structured approach to implementing the mobile Node compatibility layer for DeepReader. The plan follows the dependency graph, uses vertical slicing, and includes comprehensive testing and verification steps. The plan is broken down into manageable tasks with clear acceptance criteria and verification steps.

Key success factors:
1. **Correctness**: Polyfills must match Node.js behavior
2. **Performance**: Minimal performance impact
3. **Security**: Secure polyfill implementations
4. **Maintainability**: Easy to maintain and extend
5. **Testing**: Comprehensive test coverage
6. **Verification**: Clear verification steps for each task

The plan provides a clear roadmap for implementing the mobile Node compatibility layer while ensuring all requirements are met and the plugin works correctly on both desktop and mobile platforms.