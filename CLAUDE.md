# Project instructions — Chameleon CV

Before planning, implementing, reviewing, or resuming work in this repository:

1. Read and follow `docs/REDEFINICAO_PRODUTO_PESSOAL.md` (product) and `docs/decisions/ADR-0015-fluxo-career-ops-base-markdown.md` (the current flow).
2. Apply `.claude/skills/personal-resume-workbench/SKILL.md` (invoke `/personal-resume-workbench` when appropriate).
3. Preserve existing working code, security controls, data, and tests. A destructive database migration needs the owner's explicit approval and a backup first.
4. On session resumption, inspect Git state, worktrees, and any in-progress agents before changing files. Do not duplicate work or overwrite another agent's changes.

The goal: work like career-ops. The owner keeps a professional base (CV + profile/rules in Markdown), pastes a job, gets an AI evaluation (score, verdict, requirements × evidence, gaps, salary) and a tailored resume checked against the base, edits, approves and exports DOCX/PDF. Used by one person today; it may be published for others later, so keep auth and owner isolation, but do not build new multi-user features now.
