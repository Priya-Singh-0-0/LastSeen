/**
 * Minimal Gemini `generateContent` client for the ModelRenderer.
 *
 * Deliberately `fetch` rather than `@google/genai`: this is one unary POST with
 * a timeout, and CLAUDE.md forbids introducing infrastructure without a concrete
 * current requirement. An SDK would add a dependency to the worker's tree to
 * save about fifteen lines, and would hide the abort behaviour that the
 * fallback contract depends on.
 *
 * Every failure mode — non-2xx, malformed body, timeout, blocked candidate —
 * surfaces as a thrown Error, because the caller's only response to any of them
 * is the same: use the deterministic template.
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface GeminiClient {
  generate(systemInstruction: string, prompt: string): Promise<string>;
}

export interface GeminiClientOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs: number;
}

interface GenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
}

export function createGeminiClient(opts: GeminiClientOptions): GeminiClient {
  return {
    async generate(systemInstruction: string, prompt: string): Promise<string> {
      const response = await fetch(`${ENDPOINT}/${opts.model}:generateContent`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': opts.apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            // Two sentences of prose. The cap is a backstop; the validator
            // enforces the real length budget.
            maxOutputTokens: 4096,
            // Gemini 3 reasoning is tuned for default sampling — the migration
            // guidance is explicitly not to set temperature/topP/topK. Reasoning
            // effort is the supported dial, and this task needs none of it.
            // Note the nesting: `thinkingLevel` at the top of generationConfig is
            // rejected with "Unknown name" — it belongs under thinkingConfig.
            thinkingConfig: { thinkingLevel: 'low' },
          },
        }),
        signal: AbortSignal.timeout(opts.timeoutMs),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`gemini ${response.status}: ${body.slice(0, 200)}`);
      }

      const data = (await response.json()) as GenerateContentResponse;

      const blockReason = data.promptFeedback?.blockReason;
      if (blockReason) throw new Error(`gemini blocked the prompt: ${blockReason}`);

      const candidate = data.candidates?.[0];
      if (!candidate) throw new Error('gemini returned no candidate');

      // A truncated candidate can end mid-figure, which is precisely the kind of
      // mangled number the grounding check exists to catch — but failing here is
      // clearer than relying on that.
      if (candidate.finishReason && candidate.finishReason !== 'STOP') {
        throw new Error(`gemini finished with ${candidate.finishReason}`);
      }

      const text = (candidate.content?.parts ?? [])
        .map((p) => p.text ?? '')
        .join('')
        .trim();
      if (text.length === 0) throw new Error('gemini returned empty text');

      return text;
    },
  };
}
