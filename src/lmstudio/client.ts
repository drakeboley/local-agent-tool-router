export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

export interface LMStudioModelInfo {
  id: string;
  object: string;
}

export interface CompletionResponse {
  id: string;
  choices: Array<{
    index: number;
    message: ChatMessage;
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class LMStudioClient {
  private baseUrl: string;

  constructor(baseUrl: string = "http://127.0.0.1:1234") {
    // Trim trailing slash
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Check connection to LM Studio and fetch available models
   */
  public async getModels(): Promise<string[]> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/models`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(5000)
      });

      if (!res.ok) {
        throw new Error(`LM Studio returned status ${res.status}: ${res.statusText}`);
      }

      const data = (await res.json()) as { data: LMStudioModelInfo[] };
      return data.data ? data.data.map((m) => m.id) : [];
    } catch (err: any) {
      throw new Error(`Failed to connect to LM Studio at ${this.baseUrl}: ${err.message}`);
    }
  }

  /**
   * Health check
   */
  public async checkHealth(): Promise<{ online: boolean; models: string[]; error?: string }> {
    try {
      const models = await this.getModels();
      return { online: true, models };
    } catch (err: any) {
      return { online: false, models: [], error: err.message };
    }
  }

  /**
   * Create a chat completion with optional native tools
   */
  public async createChatCompletion(params: {
    model: string;
    messages: ChatMessage[];
    tools?: any[];
    temperature?: number;
    max_tokens?: number;
  }): Promise<CompletionResponse> {
    const body: Record<string, any> = {
      model: params.model,
      messages: params.messages,
      temperature: params.temperature ?? 0.1
    };

    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools;
      body.tool_choice = "auto";
    }

    if (params.max_tokens) {
      body.max_tokens = params.max_tokens;
    }

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
    } catch (err: any) {
      throw new Error(`LM Studio request failed: ${err.message}`);
    }

    if (!res.ok) {
      const text = await res.text();
      // If error indicates tools are unsupported by this model in LM Studio, throw specific message
      if (text.toLowerCase().includes("tool") || text.toLowerCase().includes("function")) {
        throw new Error(`TOOL_UNSUPPORTED: ${text}`);
      }
      throw new Error(`LM Studio HTTP ${res.status}: ${text}`);
    }

    return (await res.json()) as CompletionResponse;
  }
}
