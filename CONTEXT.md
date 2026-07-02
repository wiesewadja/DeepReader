# DeepReader Sidebar Context

The language used for the sidebar chat/reading interface in DeepReader, where the user interacts with the AI companion (奚童), manages books, sessions, and TTS playback.

## Language

**SidebarView**:
The Obsidian ItemView subclass that owns the sidebar DOM lifecycle and wires together the domain layer and the presenter layer.
_Avoid_: God object, coordinator, view controller

**Domain**:
A stateful object that owns a specific area of sidebar behavior and business rules. Domains orchestrate their own operations and publish events when state changes.
_Avoid_: Controller, manager, service (when referring to the sidebar behavioral objects)

**BookDomain**:
The domain that owns the current book, index list, booklists, and bookshelf metadata.
_Avoid_: BookManager, book controller

**SessionDomain**:
The domain that owns the current chat session, including finalized messages, the transient streaming assistant message, and attached reference documents.
_Avoid_: SessionManager, chat controller

**AgentDomain**:
The stateless thinking engine that turns a request (messages + context) into a stream of agent events. It does not own history or UI state.
_Avoid_: Agent controller, chat logic

**TTSDomain**:
The domain that owns TTS playback state and logic for both message reading and page reading.
_Avoid_: TTS controller, voice controller

**ChatDocumentService**:
The service that manages Markdown documents attached to the current chat session (loaded via current file, mention, or wikilink).
_Avoid_: ContextManager, context service

**ChatPresenter**:
The object that subscribes to domain events and maps them to imperative updates on the concrete UI components (MessageList, ChatInput, ReadingTopbar).
_Avoid_: View controller, UI manager

**EventBus**:
The per-SidebarView typed pub/sub channel used to decouple domains from the presenter and from each other for notification-style communication.
_Avoid_: Global event bus, emitter

**AgentRequest**:
The single input object passed to AgentDomain, containing messages plus narrowly-scoped context (runtime, book, search, prompt).
_Avoid_: SharedContext, config bag

**AgentEvent**:
The raw output event from AgentDomain describing a step in the thinking process, such as a text chunk, a reference, or a diagram completion.
_Avoid_: Stream chunk, raw output

**UI-semantic event**:
An event published by SessionDomain that translates raw AgentEvent into a user-interface meaning, such as "assistant text chunk" or "diagram ready".
_Avoid_: Domain event (ambiguous), raw event

**pendingAssistantMessage**:
The transient slot in SessionDomain that holds the assistant message currently being streamed, before it is finalized into the session history.
_Avoid_: streaming message, partial message
