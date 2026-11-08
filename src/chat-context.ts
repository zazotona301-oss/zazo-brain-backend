export type ChatTurn = {
  role: 'user' | 'assistant';
  content: string;
};

export const MAX_CHAT_INPUT_CHARS = 10_000;
export const MAX_CHAT_HISTORY_CHARS = 1_400;
export const MAX_ACTIVE_CONTEXT_CHARS = 800;
export const MAX_NEON_CONTEXT_CHARS = 1_000;
export const MAX_KNOWLEDGE_CONTEXT_CHARS = 5_200;
export const MAX_LEARNED_EXAMPLES_CHARS = 600;

export function truncatePromptSection(value: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  if (value.length <= maxChars) return value;

  const marker = '\n[اختصار]';
  if (maxChars <= marker.length) return value.slice(0, maxChars);
  return `${value.slice(0, maxChars - marker.length).trimEnd()}${marker}`;
}

export function fitChatMessages(messages: ChatTurn[], maxChars = MAX_CHAT_HISTORY_CHARS): ChatTurn[] {
  if (maxChars <= 0 || messages.length === 0) return [];

  const recent = messages.slice(-40);
  let latestUserIndex = -1;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    if (recent[index].role === 'user') {
      latestUserIndex = index;
      break;
    }
  }
  const latestIndex = latestUserIndex >= 0 ? latestUserIndex : recent.length - 1;
  const latestMessage = recent[latestIndex];
  const latestContent = latestMessage.content.length > maxChars
    ? latestMessage.content.slice(-maxChars)
    : latestMessage.content;

  const selected: ChatTurn[] = [{ ...latestMessage, content: latestContent }];
  let remaining = maxChars - latestContent.length;

  for (let index = latestIndex - 1; index >= 0 && remaining > 0; index -= 1) {
    const message = recent[index];
    if (!message.content) continue;
    const content = message.content.length > remaining
      ? message.content.slice(-remaining)
      : message.content;
    selected.unshift({ ...message, content });
    remaining -= content.length;
  }

  return selected;
}

export function isReplyLikelyNonArabic(question: string, reply: string): boolean {
  if (!/[\u0600-\u06FF]/u.test(question)) return false;
  const letters = reply.match(/\p{L}/gu) || [];
  if (!letters.length) return true;
  const arabicLetters = reply.match(/\p{Script=Arabic}/gu) || [];
  return arabicLetters.length / letters.length < 0.35;
}

export type WorkersAiFailureCategory =
  | 'context_limit'
  | 'quota_limit'
  | 'lora_configuration'
  | 'model_configuration'
  | 'provider_unavailable'
  | 'unknown';

export function classifyWorkersAiFailure(error: unknown): WorkersAiFailureCategory {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (/\b3006\b|request too large|context.{0,20}(limit|length)|too many tokens|sequence length/.test(message)) return 'context_limit';
  if (/\b4006\b|\b429\b|quota|rate.?limit|neuron.{0,20}(limit|quota)/.test(message)) return 'quota_limit';
  if (/\b5005\b|lora|adapter|fine.?tun/.test(message)) return 'lora_configuration';
  if (/\b3042\b|invalid model|model.{0,20}(not found|invalid)/.test(message)) return 'model_configuration';
  if (/\b503\b|timeout|temporarily unavailable|service unavailable/.test(message)) return 'provider_unavailable';
  return 'unknown';
}
