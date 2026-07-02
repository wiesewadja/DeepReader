# Split SidebarView into Domains, Presenter, and per-view EventBus

SidebarView had grown to 1,537 lines and coordinated 8+ responsibilities (chat, sessions, TTS, books, quotes, voice input, reading context) through 15+ bidirectional getters. We decided to collapse it into a view shell by extracting business logic into domains, UI mapping into a presenter, and using a per-view typed EventBus for notification-style decoupling.

## Decision

- **SessionDomain** owns the chat session, including finalized messages and the transient `pendingAssistantMessage`. It orchestrates calls to AgentDomain and translates raw `AgentEvent`s into UI-semantic events.
- **AgentDomain** is a stateless thinking engine: it receives an `AgentRequest` and returns `AsyncIterable<AgentEvent>`. It does not own history or UI state.
- **BookDomain** owns current book, index list, and booklists. It publishes `book:changed` when the selection changes.
- **TTSDomain** owns TTS playback state for both message and reading sources, publishing typed events for UI updates.
- **ChatDocumentService** (formerly ContextManager) manages Markdown documents attached to the current chat session; it is held by SessionDomain.
- **ChatPresenter** subscribes to domain events and maps them to imperative updates on MessageList, ChatInput, and ReadingTopbar.
- **EventBus** is created per SidebarView instance. Domains publish to it; the presenter and cross-domain subscribers consume it. Synchronous orchestration (e.g., SessionDomain calling AgentDomain.stream) uses direct method calls, not the bus.

## Considered Options

**Pure EventBus for all domain communication.** Rejected because SessionDomain calling AgentDomain.stream is inherent orchestration, not a notification. Forcing it through events would turn control flow into an implicit state machine and complicate error handling.

**MessageList/Message components subscribe directly to the EventBus.** Rejected because it would spread UI-update logic across components and reintroduce coupling between domain event vocabulary and component internals. The presenter gives us a single place to own the mapping.

## Consequences

- SidebarView is reduced to lifecycle, DOM creation, wiring, and cleanup.
- Domains can be unit tested with mocked collaborators instead of a full Obsidian ItemView.
- The `AgentRequest` object replaces the 11-field SharedContext for Agent calls, narrowing each consumer's interface.
