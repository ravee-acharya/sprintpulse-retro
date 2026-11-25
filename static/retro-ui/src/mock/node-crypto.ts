/** Browser stand-in for `node:crypto` (mock mode only). */
export const randomUUID = (): string => crypto.randomUUID();
