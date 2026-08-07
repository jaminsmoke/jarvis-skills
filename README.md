# Jarvis Skills

Agent skills for the [Jarvis](https://github.com/jaminsmoke/Jarvis) personal assistant project — reusable, installable via `npx skills`.

## Skills

| Skill | Description |
|---|---|
| **jarvis-github-kanban** | Full kanban workflow for GitHub Projects V2 — 6-state lifecycle, GraphQL mutations, field/option IDs, labels, versioning, changelog auto-generation |
| **jarvis-github-agentuse** | Guide to GitHub tools for AI agents — gh CLI vs MCP vs GraphQL vs REST, token differences (classic PAT, fine-grained, GITHUB_TOKEN), common patterns and limitations |

## Install

```bash
# List available skills
npx skills add jaminsmoke/jarvis-skills --list

# Install both
npx skills add jaminsmoke/jarvis-skills --skill jarvis-github-kanban --skill jarvis-github-agentuse --yes

# Or just one
npx skills add jaminsmoke/jarvis-skills --skill jarvis-github-kanban --yes
```

## Usage

Once installed, load a skill in any AI agent:

```
skill("jarvis-github-kanban")    # Full kanban workflow reference
skill("jarvis-github-agentuse")  # GitHub tools guide for agents
```

## License

MIT
