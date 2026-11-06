# OneTab agent instructions

## Required startup

Use pstack for every repository task. This is a required workflow for agents that read this file. It is not an executable hook or proof that an editor enforced it.

1. Read [spec.md](spec.md), [architecture](docs/architecture.md), [contracts](docs/contracts.md), [development setup](docs/development.md), the assigned [card](docs/implementation-map.md) when one exists, and the current repository state.
2. Locate a readable pstack `poteto-mode/SKILL.md` in the host's available skills or installed plugin files. Reuse an existing installation.
3. If pstack is missing, install it using the host-specific procedure below before implementation. This repository instruction requests that setup. Use normal host permissions and never bypass an approval requirement.
4. Read `poteto-mode/SKILL.md` in full, select its playbook, and load each routed skill when needed. Installation alone does not activate the workflow.
5. State the selected playbook, the skill path used, the card, and the intended verification in the first work update.

Do not claim to use pstack if its files cannot be read. If installation needs an action only the human can perform, report the exact blocker and setup action. Wait for that prerequisite instead of implementing without pstack. Read-only setup diagnosis may continue.

## Install pstack when missing

Use the official [cursor/plugins pstack source](https://github.com/cursor/plugins/tree/main/pstack). Install only for the current host. Preserve existing skill customizations, project instructions and operator model settings.

### Cursor

Use Cursor's plugin action in chat:

```text
/add-plugin pstack
```

This is a Cursor command, not a shell command. Once installed, activate `/poteto-mode` for the task or read its installed skill file directly. If the host requires the user to run the plugin action, provide that exact command and wait for installation.

### Claude Code

If the official marketplace is absent, add it first. Then install the plugin. The terminal commands are:

```sh
claude plugin marketplace add cursor/plugins
claude plugin install pstack@cursor-plugins --scope local
```

The corresponding chat commands are `/plugin marketplace add cursor/plugins` and `/plugin install pstack@cursor-plugins`. In chat, select local/project scope when offered to avoid changing unrelated projects.

Verify the plugin appears in `claude plugin list --json`. Use `/pstack:poteto-mode` and read the installed `docs/harness/claude-code.md` adapter. For routed skills whose slash invocation is unavailable, read their `SKILL.md` files directly as the adapter specifies.

### Codex

If no usable pstack installation is already available, run this from the repository root with Node.js/npm available:

```sh
npx --yes skills@1.7.6 add https://github.com/cursor/plugins/tree/main/pstack --agent codex --skill '*' --yes
```

This installs the pstack skills into the project's `.agents/skills/` directory. It does not install a native Cursor plugin or prove that Cursor-specific tools exist. Keep generated skill files and installer metadata local, as covered by `.gitignore`.

Before proceeding, verify these files are readable:

```text
.agents/skills/poteto-mode/SKILL.md
.agents/skills/poteto-mode/playbooks/feature.md
.agents/skills/how/SKILL.md
.agents/skills/technical-writing/SKILL.md
.agents/skills/unslop/SKILL.md
```

Read the installed `poteto-mode/SKILL.md` directly for this task. A new turn/session may be needed for discovery in the host's skill menu. Do not rely on installation output alone.

The skills installer does not install pstack's agent-role definitions. When a step requires those roles, read the official [poteto-agent](https://github.com/cursor/plugins/blob/main/pstack/agents/poteto-agent.md) or [comment-sicko](https://github.com/cursor/plugins/blob/main/pstack/agents/comment-sicko.md) definition and use the host's supported delegation API.

### Dependencies and other hosts

Check capabilities when the selected playbook needs them. pstack references additional skills such as `deslop` and control tools from [cursor-team-kit](https://github.com/cursor/plugins/tree/main/cursor-team-kit). If a required dependency is missing, install or read it from that official source through the host's supported mechanism before executing that step.

On Codex, a project-local `deslop` installation uses the same verified installer form:

```sh
npx --yes skills@1.7.6 add https://github.com/cursor/plugins/tree/main/cursor-team-kit --agent codex --skill deslop --yes
```

Use supported tool equivalents when the host provides them. Do not invent subagent types, model IDs, browser controls or successful checks. Report any required capability that has no equivalent. Do not claim the blocked step passed.

For another coding host, use its documented Agent Skills or plugin installer against the official pstack source. If no supported installation path is available, report that prerequisite before implementation.

## Model settings

Honor operator-approved role/model configuration already supplied by the host or session. Installation must not overwrite it. If none exists, use `setup-pstack` to detect available models and establish the operator's preferences. In Claude Code, use `/pstack:setup-pstack` and its adapter.

Keep model IDs and reasoning effort in the separate fields the host accepts. If a configured model is unavailable, report that and obtain a supported replacement. Never pretend a same-family review is cross-family review.

## Work within the assigned lane

- Use the agreed Next.js App Router, React and TypeScript stack. Frontend owns the single root application scaffold, npm manifest and lockfile.
- Follow [file ownership](docs/architecture.md#module-and-file-ownership) and [shared contracts](docs/contracts.md). Frontend ownership of src/app/ excludes API routes. Coordinate contract changes with their owner before consumers diverge.
- Work on a separate branch. Preserve unrelated local changes and teammates' branches.
- Payments supplies the dependency versions proven by the real-wallet experiment.
- Keep implementation within the card's scope. Update the spec when an agreed product rule changes, and link the related card.
- Keep architecture and contract documents consistent with implementation. Update both the repository card and live issue when task scope changes. The board remains authoritative for status.
- Keep source code, migrations and evidence consistent. Do not mark a card Done until its completion check has passed.

## Verification and reporting

Read the repository's actual scripts and tools before choosing commands. At the time these instructions were added, the repository had no application scaffold or test commands. Do not invent passing builds or tests.

Apply the selected pstack playbook at the scope of the change. For documentation, check links, internal consistency and the setup steps that changed. For payment work, the acceptance checks in the spec require real wallet, database or chain evidence where stated.

Distinguish fixtures, local runs and the hosted Devnet app in reports. Report the command or scenario, observed outcome, remaining limitations, and the card/PR link. A plan or screenshot of a proposed state is not implementation evidence.

Follow explicit owner gates for merge, deployment and external actions. Keep private keys, seed phrases and privileged database credentials out of code, prompts, logs and evidence.

## Setup references

- [pstack installation and activation](https://github.com/cursor/plugins/blob/main/pstack/README.md)
- [Claude Code adapter](https://github.com/cursor/plugins/blob/main/pstack/docs/harness/claude-code.md)
- [Skills CLI commands](https://github.com/vercel-labs/skills/blob/main/docs/commands.md)
