/**
 * 前端 Agent 核心类型定义
 */

// ==================== 消息类型 ====================

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  /** 标记是否对用户隐藏（用于画像更新消息注入，不显示在界面但发送给 LLM） */
  hidden?: boolean;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

// ==================== 工具类型 ====================

// 支持嵌套的参数属性类型
export interface ToolParameterProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: ToolParameterProperty;
  properties?: Record<string, ToolParameterProperty>;
  required?: string[];
  default?: unknown;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, ToolParameterProperty>;
      required?: string[];
    };
  };
}

export interface ToolResult {
  tool_call_id: string;
  content: string;
}

// ==================== Skill 类型 ====================

export interface Skill {
  name: string;
  description: string;
  body: string;
  path: string;
  isDefault: boolean;
  keywords?: string[];
  meta?: {
    version?: string;
    author?: string;
    tags?: string[];
  };
}

// ==================== Agent 配置 ====================

export interface AgentConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  maxIterations?: number;
}

export interface AgentCallbacks {
  onContent: (text: string) => void;
  onToolCall: (toolName: string, args: Record<string, unknown>) => void;
  onProgress: (status: string) => void;
  onComplete: () => void;
  onError: (error: string) => void;
}

// ==================== LLM 响应 ====================

export interface LLMResponse {
  id: string;
  choices: {
    index: number;
    message: {
      role: 'assistant';
      content?: string;
      tool_calls?: ToolCall[];
    };
    finish_reason: 'stop' | 'tool_calls' | 'length' | null;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface StreamChunk {
  id: string;
  choices: {
    index: number;
    delta: {
      role?: 'assistant';
      content?: string;
      tool_calls?: {
        index: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }[];
    };
    finish_reason: 'stop' | 'tool_calls' | 'length' | null;
  }[];
}
