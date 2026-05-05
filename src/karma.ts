import fs from 'fs';
import path from 'path';
import { KarmaMessages } from './types';

const KARMA_PATTERN = /\b(\S+?)(\+\+|--)(?:\s|$)/g;

let karmaMessages: KarmaMessages | null = null;

function loadKarmaMessages(): KarmaMessages {
  if (karmaMessages) return karmaMessages;

  const filePath = path.resolve(__dirname, '..', 'karmaMessages.json');
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw);

  karmaMessages = {
    emojis: {
      positive: parsed.emojis?.positive || [],
      negative: parsed.emojis?.negative || [],
    },
    compliments: parsed.compliments || [],
    insults: parsed.insults || [],
  };

  return karmaMessages;
}

export function reloadKarmaMessages(): void {
    karmaMessages = null;
    loadKarmaMessages();
}

export function checkKarma(message: string): string | null {
    const messages = loadKarmaMessages();

    const matches = [...message.matchAll(KARMA_PATTERN)];
    if (matches.length === 0) return null;

    const first = matches[0];
    if (!first || first.length < 3) return null;
    const subject = first[1]!;
    const type = first[2]!;

  const isPositive = type === '++';
  const list = isPositive ? messages.compliments : messages.insults;
  const emojiList = isPositive ? messages.emojis.positive : messages.emojis.negative;

  if (list.length === 0 || emojiList.length === 0) return null;

  const emoji = emojiList[Math.floor(Math.random() * emojiList.length)]!;

  const idx = Math.floor(Math.random() * list.length);
  const template = list[idx];
  if (!template) return null;
  const filled = template.split('{name}').join(subject);

    return `${emoji} ${filled}`;
}
