// Webhook mínimo do Instagram (Meta).
// Responde a verificação da Meta e devolve 200 para todo evento.
// Não guarda nem lê nada: só diz "ok".
// Também serve as duas páginas que a Meta pede para publicar o app:
// /privacidade (política de privacidade) e /exclusao-de-dados.

const PAGINAS = {
  '/privacidade': {
    titulo: 'Política de privacidade',
    corpo: `
<p>Este app é usado só pelo dono da conta do Instagram ligada a ele, para cuidar da própria conta: ler e responder mensagens diretas e comentários, publicar e ver os números da conta.</p>
<h2>Que dados passam pelo app</h2>
<p>Mensagens, comentários, nome de usuário e foto de perfil de quem fala com a conta. Eles são lidos pela API oficial da Meta, no computador do dono da conta.</p>
<h2>Para que são usados</h2>
<p>Só para o dono da conta ler e responder. As respostas são escritas com a ajuda do Claude, a IA da Anthropic, e só são enviadas depois que o dono da conta aprova cada uma.</p>
<h2>O que é guardado</h2>
<p>Este endereço não guarda nem lê nada: ele só confirma para a Meta que está no ar. O computador do dono da conta pode guardar um registro das ações feitas pelo app, como as respostas enviadas.</p>
<h2>Compartilhamento</h2>
<p>Os dados não são vendidos nem usados para publicidade. Eles passam só pela Meta e pela Anthropic, para o funcionamento descrito acima.</p>
<h2>Seus direitos e contato</h2>
<p>Para pedir acesso, correção ou exclusão dos seus dados, mande uma mensagem direta para a conta do Instagram que usa este app. Veja também <a href="/exclusao-de-dados">como pedir a exclusão</a>.</p>`
  },
  '/exclusao-de-dados': {
    titulo: 'Exclusão de dados',
    corpo: `
<p>Este endereço não guarda dados de ninguém.</p>
<p>Para pedir que o dono da conta apague as suas mensagens ou qualquer registro sobre você, mande uma mensagem direta para a conta do Instagram que usa este app, pedindo a exclusão. O pedido é atendido em até 30 dias.</p>
<p>Você também pode apagar a conversa no seu próprio Instagram a qualquer momento.</p>
<p><a href="/privacidade">Política de privacidade</a></p>`
  }
};

function pagina({ titulo, corpo }) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${titulo}</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;line-height:1.6;color:#222}h2{font-size:1.1em;margin-top:1.6em}</style>
</head>
<body>
<h1>${titulo}</h1>
${corpo}
</body>
</html>`;
}

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (req.method === 'GET' || req.method === 'HEAD') {
      const p = PAGINAS[u.pathname.replace(/\/+$/, '')];
      if (p) return new Response(req.method === 'HEAD' ? null : pagina(p), { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
      const ok = u.searchParams.get('hub.mode') === 'subscribe' && !!env.VERIFY_TOKEN && u.searchParams.get('hub.verify_token') === env.VERIFY_TOKEN;
      return new Response(ok ? (u.searchParams.get('hub.challenge') ?? '') : 'forbidden', { status: ok ? 200 : 403, headers: { 'content-type': 'text/plain' } });
    }
    return new Response('ok', { status: 200 });
  }
};
