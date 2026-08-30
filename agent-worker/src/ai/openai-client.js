import { AppError } from '../lib/errors.js';
import {
  AUDIT_DEVELOPER_INSTRUCTIONS, AUDIT_SCHEMA, DISCUSSION_DEVELOPER_INSTRUCTIONS,
  DISCUSSION_SCHEMA, buildAuditEvidence, buildDiscussionEvidence
} from './audit-prompt.js';

function outputText(response) {
  const parts = [];
  for (const item of response.output || []) {
    if (item.type !== 'message') continue;
    for (const content of item.content || []) {
      if (content.type === 'refusal') throw new AppError(`The model refused the audit: ${content.refusal || 'No reason supplied.'}`, { code: 'MODEL_REFUSAL' });
      if (content.type === 'output_text' && content.text) parts.push(content.text);
    }
  }
  return parts.join('');
}

export class OpenAIClient {
  constructor(config, { fetchImpl = fetch } = {}) {
    this.apiKey = config.openAIKey;
    this.model = config.openAIModel;
    this.embeddingModel = config.embeddingModel;
    this.embeddingDimensions = config.embeddingDimensions || 1536;
    this.reasoningEffort = config.reasoningEffort || 'medium';
    this.maxOutputTokens = config.maxOutputTokens || 24_000;
    this.timeoutMs = config.openAITimeoutMs;
    this.fetch = fetchImpl;
  }

  async request(path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('OpenAI request timed out.')), this.timeoutMs);
    try {
      const response = await this.fetch(`https://api.openai.com/v1/${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: controller.signal
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
        throw new AppError(`OpenAI request failed (${response.status}): ${payload?.error?.message || 'Unknown error'}`, { code: 'OPENAI_REQUEST_FAILED', retryable });
      }
      return payload;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(error.name === 'AbortError' ? 'OpenAI request timed out.' : `OpenAI request failed: ${error.message}`, { code: 'OPENAI_NETWORK_ERROR', retryable: true });
    } finally { clearTimeout(timer); }
  }

  async embed(text) {
    if (!text?.trim()) return null;
    const response = await this.request('embeddings', {
      model: this.embeddingModel,
      input: text.slice(0, 24_000),
      encoding_format: 'float',
      dimensions: this.embeddingDimensions
    });
    const embedding = response.data?.[0]?.embedding;
    if (!Array.isArray(embedding)) throw new AppError('OpenAI returned no embedding.', { code: 'EMBEDDING_INVALID', retryable: true });
    return embedding;
  }

  async evaluate({ payload, inspection, memory }) {
    const evidence = buildAuditEvidence({ payload, inspection, memory });
    const content = [{
      type: 'input_text',
      text: JSON.stringify(evidence)
    }];
    for (const page of inspection.pages) {
      if (page.screenshotDataUrl) {
        content.push({ type: 'input_text', text: `Screenshot evidence for ${page.url}` });
        content.push({ type: 'input_image', image_url: page.screenshotDataUrl, detail: 'high' });
      }
    }
    const response = await this.request('responses', {
      model: this.model,
      store: false,
      reasoning: { effort: this.reasoningEffort },
      max_output_tokens: this.maxOutputTokens,
      input: [
        { role: 'developer', content: [{ type: 'input_text', text: AUDIT_DEVELOPER_INSTRUCTIONS }] },
        { role: 'user', content }
      ],
      text: { format: { type: 'json_schema', name: 'website_audit', strict: true, schema: AUDIT_SCHEMA } }
    });
    const text = outputText(response);
    try { return JSON.parse(text); }
    catch { throw new AppError('The model response was not valid structured JSON.', { code: 'MODEL_RESULT_INVALID', retryable: true }); }
  }

  async discuss({ payload, memory }) {
    const response = await this.request('responses', {
      model: this.model,
      store: false,
      reasoning: { effort: this.reasoningEffort },
      max_output_tokens: Math.min(this.maxOutputTokens, 8_000),
      input: [
        { role: 'developer', content: [{ type: 'input_text', text: DISCUSSION_DEVELOPER_INSTRUCTIONS }] },
        { role: 'user', content: [{ type: 'input_text', text: JSON.stringify(buildDiscussionEvidence({ payload, memory })) }] }
      ],
      text: { format: { type: 'json_schema', name: 'rule_discussion', strict: true, schema: DISCUSSION_SCHEMA } }
    });
    const text = outputText(response);
    try { return JSON.parse(text); }
    catch { throw new AppError('The model discussion was not valid structured JSON.', { code: 'MODEL_RESULT_INVALID', retryable: true }); }
  }
}
