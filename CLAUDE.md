# instagram-claude

- **Versão nova só por `npm run lancar`** (em `mcp/`): `preparar X.Y.Z`, revisar o diff, `publicar X.Y.Z --notas "..."`. Nunca crie tag, release nem aumente versão à mão.
- **Não existe "ponto solto" depois da tag.** A tag é o que o instalador baixa (INSTALL do README, tarball e `.mcpb` com SHA-256) e ela não se move. O que foi achado se corrige antes de publicar; erro depois da tag só sai com versão nova.
- **A pasta `skill/` é a skill `instagram-app-meta` do conector.** A skill do ManyCraft mora no repositório do ManyCraft (`.claude/skills/instagram-manycraft`) e nunca é editada aqui.
- **Mudou a skill, o INSTALL ou o README?** Rode `npm run conferir-lancamento` em `mcp/`.
