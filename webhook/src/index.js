// Webhook mínimo do Instagram (Meta).
// Responde a verificação da Meta e devolve 200 para todo evento.
// Não guarda nem lê nada: só diz "ok".
export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (req.method === 'GET') {
      const ok = u.searchParams.get('hub.mode') === 'subscribe' && !!env.VERIFY_TOKEN && u.searchParams.get('hub.verify_token') === env.VERIFY_TOKEN;
      return new Response(ok ? (u.searchParams.get('hub.challenge') ?? '') : 'forbidden', { status: ok ? 200 : 403, headers: { 'content-type': 'text/plain' } });
    }
    return new Response('ok', { status: 200 });
  }
};
