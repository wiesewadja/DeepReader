# Spec: DeepReader Mobile Node Compatibility Layer

## Objective
Implement a Node.js compatibility layer for DeepReader plugin to support mobile environments (Android Obsidian Capacitor) where Node core modules are not available. The compatibility layer will polyfill missing Node modules (fs/promises, path, crypto, stream, events, timers, os, util, zlib) while maintaining full desktop functionality.

**User Stories:**
- As a mobile user, I can load the DeepReader plugin without Node module errors
- As a mobile user, I can index PDFs and EPUBs using the PageIndex system
- As a mobile user, I can use the plugin's core features without desktop-specific dependencies
- As a desktop user, the plugin continues to work exactly as before with no performance impact

## Tech Stack
- **Target Environment:** Obsidian mobile (Android Capacitor) + Obsidian desktop (Electron)
- **Primary Languages:** TypeScript, Node.js polyfills
- **Key Dependencies:** @types/node (for type definitions), existing node-fs.ts, mobile-fs.ts
- **Build Tools:** esbuild (with Node modules polyfill plugin)
- **Testing:** wdio mobile tests, existing unit tests

## Commands
```bash
# Build with Node modules polyfill for mobile
npm run build:mobile

# Build for desktop (full Node support)
npm run build:desktop

# Run mobile compatibility tests
npm run test:mobile

# Run desktop tests
npm run test:desktop

# Run mobile load simulation
node scripts/smoke/lib/mobile-load-trace.mjs
```

## Project Structure
```
src/
├── utils/
│   ├── mobile-fs.ts              # Existing Obsidian adapter (mobile-compatible)
│   ├── node-fs.ts                # Existing lazy fs/promises loader
│   └── mobile-node-compat.ts     # NEW: Mobile Node compatibility layer
├── pageindex/
│   ├── node.ts                   # Node.js compatible core API
│   └── ...                       # Other pageindex modules
├── components/
│   ├── reading-mode/
│   │   └── selection-toolbar.ts # Uses mobile-fs.ts
│   └── ...                       # Other components
└── main.ts                       # Plugin entry point

scripts/
├── smoke/
│   └── lib/
│       └── mobile-load-trace.mjs # Mobile load simulator
└── e2e-light/
    └── ...                       # Existing e2e tests

tests/
├── mobile/                       # NEW: Mobile-specific tests
│   └── load.e2e.ts              # Node module availability tests
└── ...                          # Existing tests
```

## Code Style
```typescript
// Example: Mobile Node compatibility pattern
export class MobileNodeCompat {
  // Polyfill fs/promises using Obsidian vault adapter
  static async readFile(path: string): Promise<string> {
    return app.vault.adapter.read(path);
  }
  
  // Polyfill path using utility functions
  static joinPath(...segments: string[]): string {
    return normalizePath(segments.filter(Boolean).join('/'));
  }
  
  // Polyfill crypto using Web Crypto API
  static async sha256(data: string): Promise<string> {
    const encoded = new TextEncoder().encode(data);
    const hash = await crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
}
```

## Testing Strategy
- **Mobile Tests:** wdio mobile tests in `tests/mobile/` to verify Node module polyfills
- **Desktop Tests:** Existing unit tests in `tests/` to verify no regression
- **Load Simulation:** `mobile-load-trace.mjs` to verify plugin loads on mobile
- **Integration Tests:** End-to-end tests for core functionality
- **Coverage:** 100% of mobile Node modules tested, maintain existing desktop coverage

## Boundaries
- **Always:**
  - Maintain full desktop functionality
  - Keep performance impact minimal (< 5% overhead)
  - Ensure no breaking changes to public API
  - Update mobile-load-trace.mjs to test new polyfills
  - Add mobile tests to CI/CD pipeline

- **Ask first:**
  - Adding new external dependencies for polyfills
  - Changing esbuild configuration for mobile builds
  - Modifying plugin manifest or Obsidian API usage

- **Never:**
  - Remove existing desktop Node module support
  - Break existing tests
  - Add code that only works on mobile (must work on both)
  - Commit secrets or API keys

## Success Criteria
1. **Mobile Load Test:** `node scripts/smoke/lib/mobile-load-trace.mjs` exits with code 0 (no Node dependencies in loading phase)
2. **Node Module Availability:** All Node modules (fs/promises, path, crypto, stream, events, timers, os, util, zlib) are available in mobile environment
3. **Plugin Functionality:** Core plugin features work on mobile (PDF/EPUB indexing, chat, reading mode)
4. **Desktop Compatibility:** All existing desktop tests pass without modification
5. **Performance:** Plugin startup time increases by < 10% on desktop
6. **Code Coverage:** 100% of mobile Node modules have test coverage

## Open Questions
1. Should we use an existing polyfill library (like `node-modules-polyfill`) or build our own minimal implementations?
2. What is the maximum acceptable performance overhead for the polyfill layer?
3. Are there any Node modules not yet identified that mobile users might need?
4. Should we consider using WebAssembly implementations for certain Node modules?
5. How will we handle Node modules that have platform-specific behavior (e.g., `os.platform()`)?