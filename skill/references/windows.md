# Aluno com Windows

**A extensão `.mcpb` é o caminho também no Windows** (ela foi feita para Mac e Windows): o token vai no campo da extensão e o Claude Desktop o guarda no cofre do Windows. **Nada disso foi provado num Windows.** Diga isso ao aluno com franqueza antes de começar, e peça que ele avise se algo sair diferente do roteiro.

As etapas 1 a 8 acontecem na Meta e no Instagram e funcionam em qualquer sistema.

## O que muda no Windows

| Passo | Mac | Windows (PowerShell) |
|---|---|---|
| Conferir o token (etapa 8b) | `curl` com `pbpaste` | `curl.exe` (nunca `curl`: no PowerShell 5.1 é outro comando), com o token lido por `Get-Clipboard -Raw` |
| Colar o token na extensão (etapa 9b) | Cmd+V | Ctrl+V |
| Onde o token fica guardado | cofre do Mac | cofre do Windows, pelo Claude Desktop |

A pesquisa dos comandos está em `~/pesquisas/pesquisa-mcp-instagram-windows-2026-11-10.md`, no computador do professor.
