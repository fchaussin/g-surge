/** Les réponses du serveur, JSON partout, et les refus nommés. */

export const json = (value: unknown, status = 200, headers?: HeadersInit): Response =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });

/** Un refus : un code court que le client peut afficher ou ignorer, jamais une pile. */
export const refuse = (status: number, error: string, extra?: Record<string, unknown>): Response =>
  json({ error, ...extra }, status);
