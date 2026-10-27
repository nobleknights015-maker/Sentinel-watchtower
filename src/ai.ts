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

  const response = await client.chat.completions.create({
    model: config.AI_MODEL,
    messages: [
      { role: 'system', content: SENTINEL_SYSTEM },
      {
        role: 'user',
        content: `Recent permitted channel context:\n${context}\n\nExplicit memories for the requesting user:\n${explicit}\n\nLearned memories for the requesting user:\n${learned}\n\nCurrent speaker: ${input.userName}\nCurrent message: ${input.userText}`,
      },
    ],
  });

  const text = response.choices[0]?.message?.content;
  return typeof text === 'string' && text.trim()
    ? text.trim()
    : 'Watchtower received that, but I have no useful response yet.';
}
