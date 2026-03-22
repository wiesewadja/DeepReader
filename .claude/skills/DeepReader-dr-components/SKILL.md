---
name: DeepReader-dr-components
description: Use when working with the components module of DeepReader - UI component library for Obsidian plugin providing chat interface, modals, navigation, and reading mode features
---

# DeepReader Components Module

## 1. Module Purpose & Capabilities

This module provides the complete UI component library for DeepReader, an Obsidian plugin for AI-powered document reading and chat. It implements a component-based architecture with a base `Component` class and 20+ specialized UI components.

### What This Module Does

The components module handles all user interface rendering for DeepReader:
- Chat interface with streaming AI responses
- Document library management with progress tracking
- Reading mode with text selection tools
- Navigation components (top bar, chapter navigation, minimap)
- Modal dialogs for settings, confirmations, and excerpts

### Key Public API Surface

**Base Class:**
- `Component` (`/frontend/src/components/component.ts`) - Abstract base with `render()`, `getElement()`, `destroy()` lifecycle methods

**Chat Components:**
- `ChatInput` (`/frontend/src/components/chat-input/chat-input.ts`) - Multi-line input with file mentions (@ and [[]]), quote support, streaming state
- `Message` (`/frontend/src/components/message/message.ts`) - ChatGPT-style message bubbles with Markdown rendering
- `MessageList` (`/frontend/src/components/message-list/message-list.ts`) - Message container with empty state and guidance buttons
- `QuestionMinimap` (`/frontend/src/components/question-minimap/question-minimap.ts`) - Sidebar navigation for conversation history

**Modal Components:**
- `ConfirmModal` (`/frontend/src/components/confirm-modal.ts`) - Confirmation dialog with optional checkbox
- `LibraryModal` (`/frontend/src/components/library-modal/library-modal.ts`) - Book card grid with cover images and indexing progress
- `ChatSettingsModal` (`/frontend/src/components/chat-settings-modal/chat-settings-modal.ts`) - Chat mode configuration
- `ExcerptModal` (`/frontend/src/components/excerpt/excerpt-modal.ts`) - Save AI responses as notes

**Navigation Components:**
- `TopNav` (`/frontend/src/components/top-nav/top-nav.ts`) - Header with logo, status indicator, action buttons
- `ReadingTopbar` (`/frontend/src/components/reading-topbar/reading-topbar.ts`) - Book info display for reading mode
- `ChapterNav` (`/frontend/src/components/reading-mode/chapter-nav.ts`) - Previous/Next chapter navigation
- `IndexManager` (`/frontend/src/components/index-manager/index-manager.ts`) - Collapsible document list panel

**Reading Mode Components:**
- `SelectionToolbar` (`/frontend/src/components/reading-mode/selection-toolbar.ts`) - Floating toolbar for text selection (quote/excerpt/highlight)
- `SelectionMenu` (`/frontend/src/components/excerpt/selection-menu.ts`) - Similar toolbar for AI response bubbles

**Utility Components:**
- `Drawer` (`/frontend/src/components/drawer/drawer.ts`) - Slide-in panel from left/right
- `FileSuggest` (`/frontend/src/components/file-suggest/file-suggest.ts`) - File search dropdown for @ mentions
- `ContextTags` (`/frontend/src/components/context-tags/context-tags.ts`) - Display loaded document tags
- `AgentModeToggle` (`/frontend/src/components/agent-mode-toggle/agent-mode-toggle.ts`) - Fast/Agent mode switcher
- `IndexStatusBadge` (`/frontend/src/components/index-status-badge.ts`) - Progress indicator for indexing
- `TaskProgressCard` (`/frontend/src/components/task-progress-card.ts`) - Detailed progress display

---

## 2. Core Design Logic

### Why This Architecture Was Chosen

**1. Component Inheritance Pattern**

The module uses an abstract `Component` base class rather than Obsidian's built-in `Component` because:
- Custom lifecycle control (`render()` → `getElement()` → `destroy()`)
- Consistent DOM element reference management (`protected el: HTMLElement | null`)
- Clean memory cleanup pattern

```typescript
// Base pattern in component.ts
export abstract class Component {
    protected el: HTMLElement | null = null;
    abstract render(): HTMLElement;
    getElement(): HTMLElement | null { return this.el; }
    destroy(): void { /* Remove from DOM, nullify references */ }
}
```

**2. Event Handler Storage Pattern**

Components store bound event handlers as instance properties to enable proper cleanup:

```typescript
// Example from chat-input.ts
private clickHandler: (() => void) | null = null;
// In attachEventListeners():
this.clickHandler = () => { /* ... */ };
this.sendButton.addEventListener('click', this.clickHandler);
// In destroy():
if (this.clickHandler) {
    this.sendButton.removeEventListener('click', this.clickHandler);
    this.clickHandler = null;
}
```

**3. Callback-Based Communication**

Parent-to-child communication uses constructor options with callbacks, avoiding tight coupling:

```typescript
interface ChatInputOptions {
    onSend: (message: string, quotes: QuoteItem[]) => void;
    onStop?: () => void;
    onHeightChange?: (height: number) => void;
    // ... more callbacks
}
```

**4. State-Driven Rendering**

Components like `LibraryModal` maintain internal state and re-render on changes:
- `indexes: IndexListItem[]` - Current document list
- `selectedIndexId: string | null` - Active selection
- `coverCache: Map<string, string>` - Loaded cover images

**5. Progressive Enhancement**

Components support optional features through configuration:
- `ChatInput` works standalone but enables file mentions when `app` is provided
- `SelectionToolbar` supports optional highlight persistence via `onSaveHighlight`

### Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| Separate modals extend Obsidian's `Modal` | Leverages built-in overlay/positioning, consistent styling |
| Inline SVG icons in `Icons` constant | Avoids HTTP requests, enables dynamic coloring via CSS |
| CSS class-based theming | Works with Obsidian's theme system, all classes prefixed `deeppdf-` |
| `requestAnimationFrame` for scroll/resize | Prevents layout thrashing on rapid updates |

### Trade-offs Made

1. **No Virtual DOM** - Direct DOM manipulation is faster for simple updates but requires manual state sync
2. **Callback props over Events** - Simpler for parent-child, but doesn't scale for deep hierarchies
3. **Monolithic modals** - `LibraryModal` is large (900+ lines) but keeps related logic together

---

## 3. Core Data Structures

### Message System Types

**File:** `/frontend/src/components/message/message.ts`

```typescript
type MessageRole = 'user' | 'assistant';

interface MessageData {
    id: string;
    role: MessageRole;
    content: string;
    timestamp?: number;
    isStreaming?: boolean;
    hidden?: boolean;
    // Agent-specific fields
    thoughts?: AgentThought[];
    toolCalls?: AgentToolCall[];
    currentStatus?: string;
}

interface AgentToolCall {
    name: string;
    args: string;
    status: 'pending' | 'success' | 'error';
    result?: string;
}

interface AgentThought {
    content: string;
    step?: number;
}
```

### Chat Input Types

**File:** `/frontend/src/components/chat-input/chat-input.ts`

```typescript
interface QuoteItem {
    id: string;
    text: string;
    source?: string;
}

interface ChatInputOptions {
    onSend: (message: string, quotes: QuoteItem[]) => void;
    onKeyDown?: (event: KeyboardEvent) => void;
    placeholder?: string;
    disabled?: boolean;
    minRows?: number;       // Default: 1
    maxRows?: number;       // Default: 5
    maxHeight?: number;     // Default: 150px
    onSelectFile?: (file: TFile) => void;
    app?: App;
    onStop?: () => void;
    onHeightChange?: (height: number) => void;
    onLoadCurrentDoc?: () => void;
    onQuoteAdded?: (quote: QuoteItem) => void;
    onQuoteRemoved?: (quoteId: string) => void;
    onDeepSearchToggle?: () => void;
    deepSearchMode?: boolean;
}
```

### Index/Progress Types

**File:** `/frontend/src/types/index.ts`

```typescript
interface TaskProgress {
    id: string;
    status: "pending" | "processing" | "completed" | "failed" | "cancelled";
    message: string;
    pdf_name?: string;
    current_step?: string;
    progress_percent?: number;
    total_steps?: number;
    completed_steps?: number;
    error?: string;
}

const STEP_CONFIG: Record<string, { label: string; icon: string; minPercent: number; maxPercent: number }> = {
    "start": { label: "任务开始", icon: "🚀", minPercent: 0, maxPercent: 5 },
    "parsing_pdf": { label: "加载文档内容", icon: "📖", minPercent: 50, maxPercent: 55 },
    "generating_summaries": { label: "生成章节摘要", icon: "✍️", minPercent: 65, maxPercent: 85 },
    // ... more steps
};
```

### Excerpt Types

**File:** `/frontend/src/types/excerpt.ts` (imported by excerpt components)

```typescript
interface ExcerptContent {
    text: string;
}

interface ExcerptMetadata {
    sourcePdf: string;
    sourceType: 'reading' | 'chat';
    page?: number;
    chapterName?: string;
    question?: string;
    createdAt: string;
    conversationId?: string;
    messageId?: string;
}
```

### Context Manager Types

**File:** `/frontend/src/services/context-manager.ts` (imported by context-tags)

```typescript
interface LoadedDocument {
    path: string;
    name: string;
    charCount: number;
    content: string;
}
```

---

## 4. State Flow

### Chat Message Flow

```
User types in ChatInput
    ↓
[Enter] or [Send button click]
    ↓
ChatInput.handleSend()
    ↓
options.onSend(message, quotes)  ← Callback to parent
    ↓
Parent calls MessageList.addMessage(messageData)
    ↓
MessageList creates Message component
    ↓
Message.render() creates DOM with MarkdownRenderer
    ↓
For streaming: MessageList.updateMessage(id, { content, isStreaming })
    ↓
Message.update() appends content to existing DOM
```

### Document Indexing Flow

```
LibraryModal.handleAddDocument()
    ↓
PDFFileSelectorModal opens
    ↓
User selects file → callback receives FileSelectResult
    ↓
apiClient.uploadAndIndex() or apiClient.indexPDF()
    ↓
Progress callbacks update tempIndex.progress_percent
    ↓
updateCardProgress() updates progress bar in card DOM
    ↓
On completion: refreshIndexes() fetches new list
    ↓
renderGrid() creates book cards with covers
```

### Text Selection Flow (Reading Mode)

```
User selects text in reading view
    ↓
SelectionToolbar.handleMouseUp()
    ↓
checkSelection() verifies selection exists
    ↓
show(text, range) positions toolbar
    ↓
User clicks button (quote/excerpt/highlight)
    ↓
handleAction() or handleHighlight()
    ↓
Callback: onQuote(text), onExcerpt(text, range), etc.
    ↓
Parent handles: add to chat context, open modal, or apply highlight
```

### Entry Points and Outputs

| Entry Point | Input | Output/Effect |
|-------------|-------|---------------|
| `ChatInput` constructor | Options with callbacks | DOM element for input area |
| `MessageList.addMessage()` | `MessageData` object | Rendered message in DOM |
| `LibraryModal.onOpen()` | Modal opens | Book grid rendered |
| `SelectionToolbar.init()` | None (called once) | Global mouseup listener attached |
| `IndexManager.setIndexes()` | `IndexListItem[]` | List items rendered |

### Error Handling Paths

1. **API Errors in LibraryModal** - Caught in `handleAddDocument()`, displays `Notice` with error message
2. **Missing DOM Elements** - Components check `if (!this.el) return;` before operations
3. **Invalid Selection** - `SelectionToolbar.checkSelection()` hides toolbar if selection is empty
4. **Failed Cover Load** - `loadCoverAndDisplay()` falls back to placeholder icon

### Side Effects

- **DOM Mutation** - All components directly create/modify DOM elements
- **Event Listeners** - Attached to `document`, `window`, and element targets
- **Obsidian API Calls** - `Notice` for notifications, `Modal.open()` for dialogs
- **Storage** - `LibraryModal` caches cover images in `coverCache: Map`

---

## 5. Common Modification Scenarios

### Scenario 1: Add a New Guidance Button

**Goal:** Add a "Key Quotes" button to the empty state guidance grid.

**Files to modify:**
- `/frontend/src/components/message-list/message-list.ts`

**Changes:**
```typescript
// 1. Add to GuidanceType union (line ~22)
export type GuidanceType =
    | 'overview'
    | 'core-views'
    | 'chapter-nav'
    | 'key-concepts'
    | 'author-info'
    | 'explore'
    | 'key-quotes';  // NEW

// 2. Add to GUIDANCE_BUTTONS array (line ~36)
export const GUIDANCE_BUTTONS: GuidanceButton[] = [
    // ... existing buttons
    {
        type: 'key-quotes',
        label: 'Key Quotes',
        prompt: 'What are the most important quotes from this book?'
    },
];
```

The grid automatically renders all buttons in `GUIDANCE_BUTTONS`.

### Scenario 2: Change Default Chat Mode

**Goal:** Change default mode from "fast" to "agent".

**Files to modify:**
- `/frontend/src/components/agent-mode-toggle/agent-mode-toggle.ts`

**Changes:**
```typescript
// In constructor (line ~60-66)
constructor(options: AgentModeToggleOptions = {}) {
    this.options = {
        initialMode: 'agent',  // Changed from 'fast'
        disabled: false,
        ...options
    };
    // ...
}
```

### Scenario 3: Add New Highlight Color

**Goal:** Add purple highlight option.

**Files to modify:**
- `/frontend/src/components/reading-mode/selection-toolbar.ts`
- `/frontend/src/components/excerpt/selection-menu.ts`

**Changes:**
```typescript
// In SelectionToolbar.ts (line ~22-28)
export const HIGHLIGHT_COLORS = [
    { id: 'yellow', label: '黄色', color: '#ffeb3b', bg: 'rgba(255, 235, 59, 0.4)' },
    { id: 'green', label: '绿色', color: '#4caf50', bg: 'rgba(76, 175, 80, 0.4)' },
    { id: 'blue', label: '蓝色', color: '#2196f3', bg: 'rgba(33, 150, 243, 0.4)' },
    { id: 'pink', label: '粉色', color: '#e91e63', bg: 'rgba(233, 30, 99, 0.4)' },
    { id: 'orange', label: '橙色', color: '#ff9800', bg: 'rgba(255, 152, 0, 0.4)' },
    { id: 'purple', label: '紫色', color: '#9c27b0', bg: 'rgba(156, 39, 176, 0.4)' },  // NEW
] as const;

// Also update getHighlightColor() method (line ~224-233)
private getHighlightColor(color: HighlightColorId): string {
    const colors: Record<HighlightColorId, string> = {
        // ... existing colors
        purple: 'rgba(156, 39, 176, 0.4)',
    };
    return colors[color] || colors.yellow;
}
```

Apply same changes to `selection-menu.ts`.

### Scenario 4: Customize Message Bubble Styling

**Goal:** Add timestamp display to message bubbles.

**Files to modify:**
- `/frontend/src/components/message/message.ts`

**Changes:**
```typescript
// In Message class, add to render method (around line 150-200)
// Look for the message content container creation

private render(): HTMLElement {
    // ... existing code ...

    // Add timestamp after content
    if (this.data.timestamp) {
        const timeEl = container.createEl('div', {
            cls: 'deeppdf-message-timestamp'
        });
        timeEl.textContent = new Date(this.data.timestamp).toLocaleTimeString();
    }

    // ... rest of render ...
}
```

Add CSS in theme file:
```css
.deeppdf-message-timestamp {
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 4px;
}
```

### Scenario 5: Add Keyboard Shortcut to ChatInput

**Goal:** Add Ctrl+Enter to send message.

**Files to modify:**
- `/frontend/src/components/chat-input/chat-input.ts`

**Changes:**
```typescript
// In handleKeyDown method (line ~359-368)
private handleKeyDown(event: KeyboardEvent): void {
    this.options.onKeyDown?.(event);

    // Enter sends (without Shift) OR Ctrl+Enter
    if (event.key === 'Enter') {
        if (!event.shiftKey || (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            this.handleSend();
        }
    }
}
```

### Scenario 6: Add New Index Step

**Goal:** Add "Analyzing images" step at 45% progress.

**Files to modify:**
- `/frontend/src/types/index.ts`

**Changes:**
```typescript
// In STEP_CONFIG (line ~41-83)
export const STEP_CONFIG: Record<string, {...}> = {
    // ... existing steps

    "analyzing_images": {
        label: "分析图片内容",
        icon: "🖼️",
        minPercent: 45,
        maxPercent: 50
    },

    // Adjust surrounding step percentages if needed
};
```

### Scenario 7: Change Library Modal Card Layout

**Goal:** Show 3 cards per row instead of auto-fit.

**Files to modify:**
- CSS file (not in components, but affects `LibraryModal`)

**Changes:**
```css
.deeppdf-lib-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);  /* Force 3 columns */
    gap: 16px;
}
```

Or modify in `LibraryModal.render()`:
```typescript
// Add inline style to grid element
this.gridEl = contentEl.createDiv({ cls: 'deeppdf-lib-grid' });
this.gridEl.style.gridTemplateColumns = 'repeat(3, 1fr)';
```

---

## File Path Index

```
/frontend/src/components/
├── component.ts                    # Base Component class
├── confirm-modal.ts                # ConfirmModal
├── index-status-badge.ts           # IndexStatusBadge, createIndexStatusBadge, createIndexCardBadge
├── task-progress-card.ts           # TaskProgressCard
├── agent-mode-toggle/
│   ├── agent-mode-toggle.ts        # AgentModeToggle
│   └── index.ts                    # Exports
├── chat-input/
│   ├── chat-input.ts               # ChatInput, QuoteItem, ChatInputOptions
│   └── index.ts                    # Exports
├── chat-settings-modal/
│   ├── chat-settings-modal.ts      # ChatSettingsModal
│   └── index.ts                    # Exports
├── context-tags/
│   ├── context-tags.ts             # ContextTags
│   └── index.ts                    # Exports
├── drawer/
│   └── drawer.ts                   # Drawer, DrawerOptions
├── excerpt/
│   ├── excerpt-modal.ts            # ExcerptModal
│   └── selection-menu.ts           # SelectionMenu
├── file-suggest/
│   └── file-suggest.ts             # FileSuggest
├── index-manager/
│   └── index-manager.ts            # IndexManager
├── library-modal/
│   ├── library-modal.ts            # LibraryModal
│   └── index.ts                    # Exports
├── message/
│   └── message.ts                  # Message, MessageData, createMessage, parseAgentContent
├── message-list/
│   └── message-list.ts             # MessageList, GUIDANCE_BUTTONS
├── question-minimap/
│   ├── question-minimap.ts         # QuestionMinimap
│   └── index.ts                    # Exports
├── reading-mode/
│   ├── chapter-nav.ts              # ChapterNav
│   ├── selection-toolbar.ts        # SelectionToolbar, HIGHLIGHT_COLORS
│   └── index.ts                    # Exports
├── reading-topbar/
│   ├── reading-topbar.ts           # ReadingTopbar
│   └── index.ts                    # Exports
└── top-nav/
    ├── top-nav.ts                  # TopNav
    └── index.ts                    # Exports

/frontend/src/types/
└── index.ts                        # TaskProgress, STEP_CONFIG, SearchFilters

/frontend/src/utils/
└── icons.ts                        # Icons object, getIcon, createIconElement
```

---

## Dependencies

**Internal Dependencies:**
- `../../utils/icons.js` - SVG icon constants
- `../../utils/logger.js` - Logging utilities
- `../../types/index.js` - TaskProgress, STEP_CONFIG
- `../../types/excerpt` - ExcerptContent, ExcerptMetadata
- `../../services/context-manager.js` - LoadedDocument type
- `../../services/excerpt-service` - ExcerptService class
- `../../api/http-client.js` - IndexListItem, API client

**Obsidian API Dependencies:**
- `obsidian` - App, Modal, Setting, Notice, TFile, MarkdownRenderer, Component

**Design Patterns Used:**
- Abstract Factory (Component base class)
- Observer (callback-based event handling)
- State (internal component state drives rendering)
- Singleton (global selection toolbar instance)
