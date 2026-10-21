// Découpage d'un long texte en morceaux d'environ N tokens.

/** En français, 1 token ≈ 3,5 caractères (estimation prudente, pas besoin de tokenizer). */
const CHARS_PER_TOKEN = 3.5;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Découpe `text` en morceaux de `maxTokens` tokens maximum, en coupant
 * de préférence sur des fins de phrase ou des retours à la ligne.
 */
export function splitText(text: string, maxTokens: number): string[] {
  const maxChars = Math.floor(maxTokens * CHARS_PER_TOKEN);
  const clean = text.trim();
  if (clean.length <= maxChars) return clean ? [clean] : [];

  // Phrases : on coupe après . ! ? ou un retour à la ligne.
  const sentences = clean.match(/[^.!?\n]+[.!?]*\s*|\n+/g) ?? [clean];
  const chunks: string[] = [];
  let current = '';

  const push = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };

  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      // Phrase géante (transcription sans ponctuation) : coupe brute.
      push();
      for (let i = 0; i < sentence.length; i += maxChars) {
        chunks.push(sentence.slice(i, i + maxChars).trim());
      }
      continue;
    }
    if (current.length + sentence.length > maxChars) push();
    current += sentence;
  }
  push();
  return chunks.filter(Boolean);
}
