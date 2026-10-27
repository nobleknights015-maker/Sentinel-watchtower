import OpenAI from 'openai';
import { config } from './config.js';
import { SENTINEL_SYSTEM } from './personality.js';

export async function generateSentinelReply(input: {
  userName: string;
  userText: string;
  channelContext: Array<{ display_name: string; content: string; created_at: Date }>;
  explicitMemories: string[];
}) {
  if (!config.OPENAI_API_KEY || !config.OPENAI_MODEL) {
    throw new Error('OpenAI runtime is not configured.');
  }

  const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  const context = input.channelContext.length
    ? input.channelContext.map(m => `[${m.display_name}] ${m.content}`).join('\n')
    : '(No stored channel context.)';
  const memories = input.explicitMemories.length
    ? input.explicitMemories.map((m, i) => `${i + 1}. ${m}`).join('\n')
    : '(No explicit memory for this user.)';

  const response = await openai.responses.create({
    model: config.OPENAI_MODEL,
    instructions: SENTINEL_SYSTEM,
    input: `Recent permitted channel context:\n${context}\n\nExplicit memories for the requesting user:\n${memories}\n\nCurrent speaker: ${input.userName}\nCurrent message: ${input.userText}`,
  });

  return response.output_text?.trim() || 'Watchtower received that, but I have no useful response yet.';
}
