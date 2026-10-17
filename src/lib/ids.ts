import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"; // Crockford-ish, no look-alikes

/** Short, sortable-enough, URL-safe id with a human-readable prefix. */
export function id(prefix: string): string {
  const time = Date.now().toString(36).padStart(9, "0");
  const bytes = randomBytes(8);
  let rand = "";
  for (const b of bytes) rand += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${time}${rand}`;
}

export const newBuildId = () => id("xm");
export const newEventId = () => id("ev");
export const newFileId = () => id("fl");
export const newLedgerId = () => id("lg");
export const newOrderId = () => id("or");
