import OpenAI from 'openai';
import { config } from './config.js';
import { SENTINEL_SYSTEM } from './personality.js';

export async function generateSentinelReply(input: {
  userName: string;
  userText: string;
  channelContext: Array<{ display_name: string; content: string; created_at: Date }>;
  explicitMemories: string[];
  learnedMemories: string[];
}) {
  if (!config.OPENROUTER_API_KEY) {
    throw new Error('OpenRouter runtime is not configured.');
  }

  const client = new OpenAI({
    apiKey: config.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'X-Title': 'Sentinel Watchtower',
    },
  });

  const context = input.channelContext.length
    ? input.channelContext.map(m => `[${m.display_name}] ${m.content}`).join('\n')
    : '(No stored channel context.)';
  const explicit = input.explicitMemories.length
    ? input.explicitMemories.map((m, i) => `${i + 1}. ${m}`).join('\n')
    : '(No explicit memory for this user.)';
  const learned = input.learnedMemories.length
    ? input.learnedMemories.map((m, i) => `${i + 1}. ${m}`).join('\n')
    : '(No learned memory for this user.)';

  const messages = [
    { role: 'system' as const, content: SENTINEL_SYSTEM },
    {
      role: 'user' as const,
      content: `Recent permitted channel context:\n${context}\n\nExplicit memories for the requesting user:\n${explicit}\n\nLearned memories for the requesting user:\n${learned}\n\nCurrent speaker: ${input.userName}\nCurrent message: ${input.userText}`,
    },
  ];

  const run = (model: string) => client.chat.completions.create({
    model,
    messages,
    temperature: 0.78,
    max_tokens: 500,
  });

  const extractText = (response: unknown): string | null => {
    const text = (response as { choices?: Array<{ message?: { content?: unknown } }> } | null | undefined)
      ?.choices?.[0]?.message?.content;
    return typeof text === 'string' && text.trim() ? text.trim() : null;
  };

  let response;
  try {
    response = await run(config.AI_MODEL);
    const primaryText = extractText(response);
    if (primaryText) return primaryText;

    console.warn(`[watchtower] primary model ${config.AI_MODEL} returned no usable text`);
    if (config.AI_MODEL !== 'openrouter/free') {
      response = await run('openrouter/free');
      const fallbackText = extractText(response);
      if (fallbackText) return fallbackText;
      console.warn('[watchtower] free-router fallback returned no usable text');
    }
  } catch (error) {
    if (config.AI_MODEL === 'openrouter/free') throw error;
    console.warn(`[watchtower] primary model ${config.AI_MODEL} unavailable; using free-router fallback`, error);
    response = await run('openrouter/free');
    const fallbackText = extractText(response);
    if (fallbackText) return fallbackText;
    console.warn('[watchtower] free-router fallback returned no usable text');
  }

  return 'I caught the message. The useful part of my reply appears to have wandered off.';
}
