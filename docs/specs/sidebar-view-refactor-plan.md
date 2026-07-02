# Implementation Plan: SidebarView God Object Refactor

## Overview

Refactor `SidebarView` (currently 1,537 lines and coordinating 8+ responsibilities) into a thin view shell that owns only Obsidian `ItemView` lifecycle, DOM creation, and wiring. Business logic moves into focused Domains (`BookDomain`, `SessionDomain`, `AgentDomain`, `TTSDomain`), UI-event mapping moves into `ChatPresenter`, and chat document context moves into `ChatDocumentService`. Communication between Domains and the presenter uses a per-view typed `EventBus`; synchronous orchestration uses direct method calls.

This plan follows the decisions in ADR-0001 and the vocabulary in `CONTEXT.md`.

## Architecture Decisions

- **Per-view EventBus**: Each `SidebarView` instance owns an `EventBus`. Domains publish typed events; `ChatPresenter` and cross-domain subscribers consume them. No global bus is introduced.
- **Domain ownership**: `BookDomain` owns books/indexes, `SessionDomain` owns chat history and orchestration, `AgentDomain` is a stateless thinking engine, `TTSDomain` owns TTS playback, `ChatDocumentService` owns attached Markdown documents.
- **Presenter layer**: `ChatPresenter` is the only object that knows how to map domain events to imperative updates on `MessageList`, `ChatInput`, and `ReadingTopbar`.
- **Direct orchestration for critical paths**: `SessionDomain` calls `AgentDomain.stream(request)` directly rather than through the EventBus.
- **Vertical slicing**: Each task extracts one domain/service, updates `SidebarView` wiring, adds tests, and leaves the system in a working state.

## Task List

### Phase 1: Foundation

#### Task 1: Create typed EventBus infrastructure

**Description:** Implement the per-view typed `EventBus` that Domains and the presenter will use for notification-style communication.

**Acceptance criteria:**
- [ ] `EventBus` supports typed `on(event, handler)`, `off(event, handler)`, `emit(event, payload)`, and `dispose()`.
- [ ] `on()` returns an unsubscribe function.
- [ ] `dispose()` removes all handlers to prevent memory leaks.
- [ ] Event types are defined as a discriminated union (or mapped type) covering chat, TTS, and book events.

**Verification:**
- [ ] Tests pass: `npx vitest run tests/unit/views/sidebar/event-bus.test.ts`
- [ ] Build succeeds: `npm run build`

**Dependencies:** None

**Files likely touched:**
- `src/views/sidebar/event-bus.ts`
- `tests/unit/views/sidebar/event-bus.test.ts`

**Estimated scope:** Small

---

#### Task 2: Extract ChatDocumentService

**Description:** Rename/move `ContextManager` to `ChatDocumentService`, place it under `src/views/sidebar/services/`, and move `parseAndLoadReferences`, `autoSyncCurrentChapter`, and related helpers out of `SidebarView` into it. `SidebarView` keeps only the constructor wiring and delegates document operations to the service.

**Acceptance criteria:**
- [ ] `ChatDocumentService` exposes `loadCurrentDocument`, `loadByPath`, `removeDocument`, `clearAll`, `getLoadedDocuments`, `getCombinedContext`, and emits a change event.
- [ ] `SidebarView` no longer creates `ContextManager` directly; it creates `ChatDocumentService`.
- [ ] `SidebarView` methods `loadCurrentDocument`, `unloadCurrentDocument`, `parseAndLoadReferences`, `getContextDocs`, and `autoSyncCurrentChapter` delegate to `ChatDocumentService` or are removed.
- [ ] Existing behavior (active file auto-sync, wikilink loading, load button state) is preserved.

**Verification:**
- [ ] Tests pass: `npx vitest run tests/unit/views/sidebar/chat-document-service.test.ts`
- [ ] Build succeeds: `npm run build`
- [ ] Deploy to test-vault and verify document loading/unloading still works.

**Dependencies:** Task 1 (if change events are emitted through EventBus; otherwise can be deferred)

**Files likely touched:**
- `src/services/context-manager.ts` → `src/views/sidebar/services/chat-document-service.ts`
- `src/views/sidebar/sidebar-view.ts`
- `tests/unit/views/sidebar/chat-document-service.test.ts`

**Estimated scope:** Medium

---

### Checkpoint: Foundation

- [ ] `npm run test:run` passes
- [ ] `npm run build` succeeds
- [ ] Manual smoke: document loading / unloading in test-vault works
- [ ] Review with human before proceeding

---

### Phase 2: Domains

#### Task 3: Extract BookDomain

**Description:** Extract book/index/booklist logic from `BookManager` into `BookDomain`. `BookDomain` owns current book state, index list, booklists, and bookshelf summary. It publishes `book:changed` when selection changes. `SidebarView` delegates `loadIndexes`, `selectIndex`, `deleteIndex`, `restoreBooklist`, and `getDisplayName` to it.

**Acceptance criteria:**
- [ ] `BookDomain` exposes `loadIndexes`, `selectIndex`, `selectBookByName`, `deleteIndex`, `openLibrary`, `getBookshelfSummary`, `getCurrentBookContext`, and state accessors.
- [ ] `BookDomain` emits `book:changed` after selection changes.
- [ ] `SidebarView` no longer reads `BookManager` state directly through getters; it calls `BookDomain` methods.
- [ ] Reading topbar and message list still update correctly when the book changes.

**Verification:**
- [ ] Tests pass: `npx vitest run tests/unit/views/sidebar/book-domain.test.ts`
- [ ] Build succeeds: `npm run build`
- [ ] Smoke: open library, select book, switch book, delete index in test-vault.

**Dependencies:** Task 1 (for `book:changed` event)

**Files likely touched:**
- `src/views/sidebar/domains/book-domain.ts`
- `src/views/sidebar/book-manager.ts` (gradually replaced)
- `src/views/sidebar/sidebar-view.ts`
- `tests/unit/views/sidebar/book-domain.test.ts`

**Estimated scope:** Medium

---

#### Task 4: Extract TTSDomain and introduce ChatPresenter TTS handling

**Description:** Extract TTS playback logic from `TTSController` into `TTSDomain`. Create the `ChatPresenter` skeleton and have it handle TTS events (`tts:state-changed`, `tts:progress-changed`, `tts:paragraph-changed`) by updating `MessageList` and `ReadingTopbar`. `TTSDomain` depends on `ReadingModeService` for reading-mode playback but does not touch UI components directly.

**Acceptance criteria:**
- [ ] `TTSDomain` exposes `speak(messageId, content)`, `stop()`, `pause()`, `resume()`, `readCurrentPage(customText?)`, `stopReading()`, `destroy()`.
- [ ] `TTSDomain` publishes typed TTS events and no longer calls `MessageList` methods directly.
- [ ] `ChatPresenter` subscribes to TTS events and maps them to `MessageList` / `ReadingTopbar` updates.
- [ ] Message TTS and reading TTS still work end-to-end.

**Verification:**
- [ ] Tests pass: `npx vitest run tests/unit/views/sidebar/tts-domain.test.ts`
- [ ] Build succeeds: `npm run build`
- [ ] Smoke: play/pause/stop message TTS and reading TTS in test-vault.

**Dependencies:** Tasks 1, 3 (BookDomain provides current book info)

**Files likely touched:**
- `src/views/sidebar/domains/tts-domain.ts`
- `src/views/sidebar/presenters/chat-presenter.ts`
- `src/views/sidebar/tts-controller.ts` (gradually replaced)
- `src/views/sidebar/sidebar-view.ts`
- `tests/unit/views/sidebar/tts-domain.test.ts`
- `tests/unit/views/sidebar/chat-presenter.test.ts` (initial TTS cases)

**Estimated scope:** Large

---

#### Task 5: Extract AgentDomain

**Description:** Extract the agent invocation and streaming logic from `AgentChatController` into a stateless `AgentDomain`. `AgentDomain` accepts an `AgentRequest` and returns `AsyncIterable<AgentEvent>`. It does not manage history, message IDs, or UI state.

**Acceptance criteria:**
- [ ] `AgentDomain` exposes `stream(request: AgentRequest): AsyncIterable<AgentEvent>`.
- [ ] `AgentRequest` contains `messages`, `runtime`, `book`, `search`, and `prompt` contexts.
- [ ] `AgentEvent` union includes `text`, `reference`, `diagram-start`, `diagram-ready`, `diagram-failed`, `error`, and `complete`.
- [ ] `AgentDomain` uses the plugin's `FrontendAgent` internally but exposes no UI or history getters.

**Verification:**
- [ ] Tests pass: `npx vitest run tests/unit/views/sidebar/agent-domain.test.ts`
- [ ] Build succeeds: `npm run build`

**Dependencies:** None

**Files likely touched:**
- `src/views/sidebar/domains/agent-domain.ts`
- `src/views/sidebar/types/agent-events.ts` (or similar)
- `tests/unit/views/sidebar/agent-domain.test.ts`

**Estimated scope:** Medium

---

### Checkpoint: Domains

- [ ] `npm run test:run` passes
- [ ] `npm run build` succeeds
- [ ] Book selection and TTS work in test-vault
- [ ] Review with human before proceeding

---

### Phase 3: Core Chat Flow

#### Task 6: Extract SessionDomain and expand ChatPresenter for chat events

**Description:** Extract session management and chat orchestration from `SessionManager` and `AgentChatController` into `SessionDomain`. `SessionDomain` owns finalized messages and `pendingAssistantMessage`, orchestrates `AgentDomain.stream`, translates `AgentEvent`s into UI-semantic events, and holds `ChatDocumentService`. Expand `ChatPresenter` to handle chat events. Remove or deprecate `AgentChatController` and `SessionManager`.

**Acceptance criteria:**
- [ ] `SessionDomain` exposes `sendUserMessage`, `startNewSession`, `restoreSession`, `cancelStream`, and state accessors.
- [ ] `SessionDomain` generates message IDs, maintains `messages` + `pendingAssistantMessage`, and emits UI-semantic events (`chat:user-message-added`, `chat:assistant-message-started`, `chat:assistant-text-chunk`, `chat:assistant-message-completed`, `chat:diagram-ready`, etc.).
- [ ] `ChatPresenter` maps chat events to `MessageList`, `ChatInput`, and `ReadingTopbar` updates.
- [ ] Streaming, references, diagrams, stop-generation, and session restore still work.
- [ ] `AgentChatController` and `SessionManager` are removed or reduced to thin compatibility shims.

**Verification:**
- [ ] Tests pass: `npx vitest run tests/unit/views/sidebar/session-domain.test.ts tests/unit/views/sidebar/chat-presenter.test.ts`
- [ ] Build succeeds: `npm run build`
- [ ] Smoke / light E2E: full chat flow with streaming, references, and diagrams in test-vault.

**Dependencies:** Tasks 1, 2, 3, 4, 5

**Files likely touched:**
- `src/views/sidebar/domains/session-domain.ts`
- `src/views/sidebar/presenters/chat-presenter.ts`
- `src/views/sidebar/agent-chat-controller.ts` (removed/replaced)
- `src/views/sidebar/session-manager.ts` (removed/replaced)
- `src/views/sidebar/sidebar-view.ts`
- `tests/unit/views/sidebar/session-domain.test.ts`
- `tests/unit/views/sidebar/chat-presenter.test.ts`

**Estimated scope:** Large

---

### Phase 4: Shell Cleanup

#### Task 7: Finalize SidebarView as a view shell

**Description:** Reduce `SidebarView` to ~200–300 lines. Remove all remaining business logic, getters, and direct controller references. `SidebarView` should only handle `ItemView` lifecycle, DOM creation, instantiating the EventBus/Domains/Presenter, registering Obsidian workspace events, and cleanup.

**Acceptance criteria:**
- [ ] `SidebarView` contains no business logic methods such as `getDisplayName`, `parseAndLoadReferences`, `preloadTTSPreview`, `toggleDeepSearchMode`, etc.
- [ ] `SidebarView` creates `EventBus`, `BookDomain`, `AgentDomain`, `SessionDomain`, `TTSDomain`, `ChatDocumentService`, and `ChatPresenter` in `renderMainUI`.
- [ ] `SidebarView` registers Obsidian events (`active-leaf-change`, `deeppdf:select-index`, `deeppdf:quote-selection`, etc.) and forwards them to the appropriate Domain/Presenter.
- [ ] `onClose` cancels streams, destroys TTS, destroys UI components, and disposes the EventBus.

**Verification:**
- [ ] Tests pass: `npm run test:run`
- [ ] Build succeeds: `npm run build`
- [ ] Light E2E: `npm run e2e-light` passes
- [ ] Manual: open/close sidebar, switch books, send messages, use TTS in test-vault.

**Dependencies:** Tasks 1–6

**Files likely touched:**
- `src/views/sidebar/sidebar-view.ts`
- `tests/unit/views/sidebar-view.test.ts`

**Estimated scope:** Medium

---

### Checkpoint: Complete

- [ ] All unit tests pass
- [ ] Build succeeds
- [ ] Light E2E passes
- [ ] Manual smoke in test-vault passes
- [ ] `SidebarView` line count is under ~300 lines
- [ ] Ready for review

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Regression in streaming chat flow (diagrams, references, stop-generation) | High | Keep old controllers as thin shims during transition; run smoke/E2E after each checkpoint. |
| Circular dependencies reappear between new Domains | Medium | Enforce one-way dependencies in plan; `SessionDomain` orchestrates, others publish events. |
| Mobile-specific behavior broken | Medium | Test on mobile or mobile simulator during Phase 4; keep mobile keyboard adaptation in `SidebarView`. |
| Obsidian workspace event handlers misfire after wiring changes | Medium | Forward events explicitly in `SidebarView`; add integration tests for URI select-index and quote-selection. |
| `AgentDomain` extraction reveals hidden state coupling | Medium | Extract `AgentDomain` as a pure function first; test with mocked `FrontendAgent` before connecting to `SessionDomain`. |

## Open Questions

- Should old controller files (`AgentChatController`, `SessionManager`, `BookManager`, `TTSController`) be deleted immediately after each extraction or kept as shims until the final cleanup task? *Recommendation: keep as shims during transition, delete in Task 7.*
- Does `TTSDomain` need `BookDomain` injected, or should `SessionDomain` pass current book info into `readCurrentPage` calls? *Recommendation: `TTSDomain` receives `BookDomain` for current-book metadata; `ReadingModeService` handles reading-mode paragraphs.*
- Should we add integration tests that verify the full `SidebarView` → Domain → Presenter → UI event chain? *Recommendation: yes, in Task 7 after the shell is stable.*
