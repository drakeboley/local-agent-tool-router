export class LMStudioClient {
    baseUrl;
    constructor(baseUrl = "http://127.0.0.1:1234") {
        // Trim trailing slash
        this.baseUrl = baseUrl.replace(/\/+$/, "");
    }
    getBaseUrl() {
        return this.baseUrl;
    }
    /**
     * Check connection to LM Studio and fetch available models
     */
    async getModels() {
        try {
            const res = await fetch(`${this.baseUrl}/v1/models`, {
                method: "GET",
                headers: { "Content-Type": "application/json" },
                signal: AbortSignal.timeout(5000)
            });
            if (!res.ok) {
                throw new Error(`LM Studio returned status ${res.status}: ${res.statusText}`);
            }
            const data = (await res.json());
            return data.data ? data.data.map((m) => m.id) : [];
        }
        catch (err) {
            throw new Error(`Failed to connect to LM Studio at ${this.baseUrl}: ${err.message}`);
        }
    }
    /**
     * Health check
     */
    async checkHealth() {
        try {
            const models = await this.getModels();
            return { online: true, models };
        }
        catch (err) {
            return { online: false, models: [], error: err.message };
        }
    }
    /**
     * Create a chat completion with optional native tools
     */
    async createChatCompletion(params) {
        const body = {
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
        let res;
        try {
            res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            });
        }
        catch (err) {
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
        return (await res.json());
    }
}
//# sourceMappingURL=client.js.map