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
export declare class LMStudioClient {
    private baseUrl;
    constructor(baseUrl?: string);
    getBaseUrl(): string;
    /**
     * Check connection to LM Studio and fetch available models
     */
    getModels(): Promise<string[]>;
    /**
     * Health check
     */
    checkHealth(): Promise<{
        online: boolean;
        models: string[];
        error?: string;
    }>;
    /**
     * Create a chat completion with optional native tools
     */
    createChatCompletion(params: {
        model: string;
        messages: ChatMessage[];
        tools?: any[];
        temperature?: number;
        max_tokens?: number;
    }): Promise<CompletionResponse>;
}
