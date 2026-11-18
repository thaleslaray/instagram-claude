# instagram-claude

- **O que vale direto da `main`:** o `INSTALL.md` e o `README.md`. Não têm versão nenhuma e baixam da última release (`releases/latest/download`), então correção de texto chega com um push, sem versão nova.
- **O que só chega por release:** a skill e a extensão, nos três arquivos da release: `instagram-mcp.mcpb`, `instagram-mcp.mcpb.sha256` e `instagram-app-meta.skill`. Mudou a skill ou o código do `mcp/`? Só chega ao público com versão nova.
- **Versão nova só por `npm run lancar`** (em `mcp/`): `preparar X.Y.Z`, revisar o diff, `publicar X.Y.Z --notas "..."`. Nunca crie tag, release nem aumente versão à mão. Os três arquivos saem de `npm run pacote-da-release`.
- **Não existe "ponto solto" depois da tag.** A tag e a release não se movem: o que foi achado se corrige antes de publicar; erro depois só sai com versão nova.
- **A pasta `skill/` é a skill `instagram-app-meta` do conector.** A skill do ManyCraft mora no repositório do ManyCraft (`.claude/skills/instagram-manycraft`) e nunca é editada aqui.
- **Mudou a skill, o INSTALL ou o README?** Rode `npm run conferir-lancamento` em `mcp/`.
