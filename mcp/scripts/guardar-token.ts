// `npm run guardar-token`: copie o token da Meta e rode. Ele vai da área de transferência
// para o Keychain (serviço instagram-mcp, conta token-suat) sem aparecer na tela.
// Com IG_ACCOUNT_ID definido, também testa o token na Meta.

import { cadastrarToken } from "../src/cadastro.ts";

process.exitCode = await cadastrarToken();
