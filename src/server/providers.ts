import { config, DATABASE_EMBEDDING_DIMENSIONS } from "./config.js";
import { KnowTraceError, requireConfig } from "./errors.js";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type WebResult = { title: string; url: string; excerpt: string; score?: number };

export interface LlmProvider {
  complete(messages: ChatMessage[], options?: { json?: boolean }): Promise<string>;
}

export interface EmbeddingProvider {
  dimensions: number;
  embed(texts: string[], purpose?: "document" | "query"): Promise<number[][]>;
}

export interface WebSearchProvider {
  search(query: string, maxResults: number): Promise<WebResult[]>;
}

async function providerFetch(url: string, init: RequestInit, stage: string) {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new KnowTraceError({
      code: "PROVIDER_UNREACHABLE",
      message: error instanceof Error ? error.message : `Unable to reach provider at ${url}`,
      stage,
      retryable: true,
    }, 502);
  }
  if (!response.ok) {
    const body = (await response.text()).slice(0, 800);
    throw new KnowTraceError({
      code: "PROVIDER_REQUEST_FAILED",
      message: `${stage} provider returned ${response.status}: ${body}`,
      stage,
      retryable: response.status === 429 || response.status >= 500,
    }, 502);
  }
  return response;
}

export class OpenAICompatibleLlm implements LlmProvider {
  async complete(messages: ChatMessage[], options?: { json?: boolean }) {
    const apiKey = requireConfig(config.llm.apiKey, "LLM_API_KEY", "LLM");
    const model = requireConfig(config.llm.model, "LLM_MODEL", "LLM");
    const response = await providerFetch(`${config.llm.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0,
        ...(options?.json ? { response_format: { type: "json_object" } } : {}),
      }),
    }, "LLM");
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new KnowTraceError({ code: "LLM_EMPTY_RESPONSE", message: "LLM returned no content.", stage: "LLM", retryable: true });
    return content;
  }
}

export class OpenAICompatibleEmbeddings implements EmbeddingProvider {
  dimensions = config.embedding.dimensions;

  async embed(texts: string[]) {
    assertDatabaseEmbeddingDimensions(this.dimensions);
    const apiKey = requireConfig(config.embedding.apiKey, "EMBEDDING_API_KEY", "Embedding");
    const model = requireConfig(config.embedding.model, "EMBEDDING_MODEL", "Embedding");
    const response = await providerFetch(`${config.embedding.baseUrl}/embeddings`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: texts, dimensions: this.dimensions }),
    }, "Embedding");
    const data = await response.json() as { data?: Array<{ index: number; embedding: number[] }> };
    const vectors = [...(data.data ?? [])].sort((a, b) => a.index - b.index).map((item) => item.embedding);
    if (vectors.length !== texts.length || vectors.some((vector) => vector.length !== this.dimensions)) {
      throw new KnowTraceError({
        code: "EMBEDDING_SHAPE_MISMATCH",
        message: `Embedding provider must return ${texts.length} vectors of dimension ${this.dimensions}.`,
        stage: "Embedding",
        retryable: false,
      });
    }
    return vectors;
  }
}

function assertDatabaseEmbeddingDimensions(dimensions: number) {
  if (dimensions !== DATABASE_EMBEDDING_DIMENSIONS) {
    throw new KnowTraceError({
      code: "EMBEDDING_DIMENSION_DATABASE_MISMATCH",
      message: "EMBEDDING_DIMENSIONS must be " + DATABASE_EMBEDDING_DIMENSIONS + " to match the Chunk.embedding database column.",
      stage: "Embedding",
      retryable: false,
    });
  }
}

function volcengineEmbeddingEndpoint(baseUrl: string) {
  const normalized = baseUrl.replace(/\/$/, "");
  return normalized.endsWith("/embeddings/multimodal")
    ? normalized
    : normalized + "/embeddings/multimodal";
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const runWorker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runWorker));
  return results;
}

export class VolcengineMultimodalEmbeddings implements EmbeddingProvider {
  dimensions = config.embedding.dimensions;

  async embed(texts: string[]) {
    if (!texts.length) return [];
    assertDatabaseEmbeddingDimensions(this.dimensions);
    const apiKey = requireConfig(config.embedding.apiKey, "EMBEDDING_API_KEY", "Embedding");
    const model = requireConfig(config.embedding.model, "EMBEDDING_MODEL", "Embedding");
    const endpoint = volcengineEmbeddingEndpoint(config.embedding.baseUrl);

    return mapWithConcurrency(texts, config.embedding.concurrency, async (text) => {
      const response = await providerFetch(endpoint, {
        method: "POST",
        headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          input: [{ type: "text", text }],
          dimensions: this.dimensions,
        }),
      }, "Embedding");
      const payload = await response.json() as {
        data?: { embedding?: number[] } | Array<{ embedding?: number[] }>;
      };
      const vector = Array.isArray(payload.data)
        ? payload.data[0]?.embedding
        : payload.data?.embedding;
      if (!vector || vector.length !== this.dimensions || vector.some((value) => !Number.isFinite(value))) {
        throw new KnowTraceError({
          code: "EMBEDDING_SHAPE_MISMATCH",
          message: "Volcengine embedding provider must return data.embedding with dimension " + this.dimensions + ".",
          stage: "Embedding",
          retryable: false,
        });
      }
      return vector;
    });
  }
}

function createEmbeddingProvider(): EmbeddingProvider {
  const provider = config.embedding.provider;
  const useVolcengine = provider === "volcengine"
    || provider === "ark"
    || (provider === "auto" && (
      config.embedding.baseUrl.includes("volces.com")
      || config.embedding.model?.startsWith("doubao-embedding-vision")
    ));
  if (useVolcengine) return new VolcengineMultimodalEmbeddings();
  if (provider === "auto" || provider === "openai" || provider === "openai-compatible") {
    return new OpenAICompatibleEmbeddings();
  }
  throw new KnowTraceError({
    code: "EMBEDDING_PROVIDER_UNSUPPORTED",
    message: "Unsupported EMBEDDING_PROVIDER: " + provider,
    stage: "Embedding",
    retryable: false,
  });
}

export class TavilyWebSearch implements WebSearchProvider {
  async search(query: string, maxResults: number) {
    const apiKey = requireConfig(config.webSearchApiKey, "WEB_SEARCH_API_KEY", "Web Search");
    const response = await providerFetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, query, max_results: maxResults, search_depth: "advanced", include_answer: false }),
    }, "Web Search");
    const data = await response.json() as { results?: Array<{ title: string; url: string; content: string; score?: number }> };
    return (data.results ?? []).map((item) => ({ title: item.title, url: item.url, excerpt: item.content, score: item.score }));
  }
}

export const llmProvider: LlmProvider = new OpenAICompatibleLlm();
export const embeddingProvider: EmbeddingProvider = createEmbeddingProvider();
export const webSearchProvider: WebSearchProvider = new TavilyWebSearch();
