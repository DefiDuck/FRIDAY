# Contributing to F.R.I.D.A.Y.

This project uses **atomic commits** following the
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) spec.
Every commit on `main` is a single logical change that:

1. **Has one focused purpose.** A commit fixes one bug, adds one feature, or
   refactors one thing. Mixed-concern commits ("feat: notes list + fix:
   settings scrollbar") are split.
2. **Builds and tests cleanly on its own.** `npm run build && npm test` must
   pass at every commit, not just at the tip of a branch. This means a reviewer
   can `git checkout` any historical commit and have a working app.
3. **Can be reverted independently.** If a regression lands, `git revert <sha>`
   should undo exactly one feature/fix without taking unrelated work with it.
4. **Has a clear, conventional message.** See [Commit message format](#commit-message-format).

## Why atomic commits

- **Bisectable history.** When a bug shows up in `v0.2.0` that wasn't there in
  `v0.1.5`, `git bisect run npm test` finds the offending commit in O(log n)
  steps. That only works if every commit builds and passes.
- **Reviewable diffs.** A commit that touches one concern is reviewable in a
  glance. A commit that touches twelve files for three reasons isn't.
- **Surgical reverts.** Production hotfixes need to undo "the thing that
  broke" — not "the thing that broke + the four other things from the same
  PR".

## Workflow

```
                                 ┌── feat: short descriptive subject
git checkout -b feat/<topic>     │   (atomic — one concern per commit)
work + commit + commit + commit  ├── feat: another atomic step
git push -u origin feat/<topic>  │
open PR                          ├── docs: update CHANGELOG
review                           │
"Rebase and merge" on GitHub     └── (chain preserved on main)
```

**Always merge with "Rebase and merge".** Never use "Squash and merge" — that
collapses the atomic chain into one giant commit, defeating the entire
discipline. "Create a merge commit" is also discouraged on this project; it
clutters the history with merge commits that don't carry semantic meaning.

For trivial single-commit changes (typos, doc tweaks, tightening a comment),
pushing directly to `main` is fine — the commit itself is already atomic.

## Commit message format

```
<type>(<optional scope>): <subject in imperative mood, lowercase, no period>

<optional body — wrapped at 72 cols, explains the WHY, not the WHAT>

<optional footer — BREAKING CHANGE / Refs / Co-authored-by>
```

### Types

| Type       | Use when …                                                       |
|------------|------------------------------------------------------------------|
| `feat`     | A user-facing capability lands (new tray menu item, new wizard step) |
| `fix`      | A reported bug is fixed                                          |
| `refactor` | Code shape changes; behaviour does not                           |
| `perf`     | A measurable performance win                                     |
| `test`     | Tests added or fixed; no production code change                  |
| `docs`     | README, CHANGELOG, code comments, or work-order updates          |
| `style`    | Whitespace / formatting only                                     |
| `chore`    | Build config, deps, tooling, version bump                        |
| `revert`   | Undoing a prior commit                                           |
| `security` | Vulnerability fix, including data-handling and crypto changes    |

### Scope

Optional. Use the area the change lives in:
`feat(briefing):`, `fix(secrets):`, `refactor(providers):`, `chore(deps):`,
`docs(changelog):`, etc. Skip scope for cross-cutting changes.

### Subject line

- Imperative mood (`add`, not `added`/`adds`).
- Lowercase first word.
- No trailing period.
- ≤ 72 characters when possible. Hard cap 100.

### Body

- Explains the **why**, not the **what** (the diff shows the what).
- Wrap at 72 columns.
- Use blank lines to separate paragraphs.

### Examples

Good:

```
feat(notes-list): add chronological view of all non-sample notes

The tray menu's "View all notes" item is no longer disabled. Opens a
480×600 frameless window listing every non-sample note newest-first,
with click-to-expand cards that reveal the full text and any pattern
markers. Markers reuse attachPopover from v0.1.4.

Refs: WORK_ORDER_FRIDAY_V0-1-5_NOTES_AND_REPORT.md §5
```

```
fix(settings): use useContentSize so 480×560 is the client area

Without useContentSize the OS chrome eats into the dimensions and the
form clips on a 1366×768 laptop. One-line ctor change.
```

```
security(secrets): scrub apiKey from provider error messages

fetch() can echo the outbound URL or auth header verbatim on some
failure modes; that would leak the key into console.warn. Route
err.message through sanitizeError(msg, config.apiKey) in each cloud
provider's catch block.
```

Bad:

```
Update stuff                              ← no type, vague subject
feat: Added the notes list and fixed bug. ← past tense, period, two concerns
fix: bug                                  ← no detail, doesn't say which bug
WIP                                       ← never on main
```

## Splitting work into atomic commits

If you find yourself writing a commit message with "and" in it, the change
should probably be two commits.

A typical work-order session might land as:

```
feat(types): add NotesListEntry and PatternReportPayload types
feat(store): expose getNotes() filter for sample exclusion
feat(ipc): add notes:list-all and pattern:report handlers
feat(notes-list): add chronological notes-list renderer + window
feat(pattern-report): add aggregated pattern-report renderer + window
feat(tray): wire View all notes / Pattern report menu items
test(pattern-report): cover pickUpTo3Matches + empty-state helper
docs(changelog): document v0.1.5 changes
chore: bump version to 0.1.5
```

Each line is its own commit. Each builds and tests on its own. Each can be
reverted on its own. The PR carries the chain; "Rebase and merge" lands it
verbatim on main.

If a commit needs another file's change to compile, those two changes belong
in the same commit. The "atomic" rule isn't "tiniest possible" — it's "the
smallest set of changes that still represents a single coherent step."

## First-clone setup

A `.gitmessage` template lives in the repo. Wire it locally on first clone so
your editor opens with the scaffold prefilled when you `git commit`:

```
git config --local commit.template .gitmessage
```

(This writes to `.git/config`, not the working tree — every contributor runs
it once.)

## Pre-commit checklist

Before `git commit`:

```
npm run build                 # must succeed
npm test                      # must keep all existing tests green
git diff --cached --check     # no whitespace errors
```

Before `git push`:

```
git log --oneline origin/main..HEAD
# Read your own history. Does each line make sense as a unit?
# If two commits should be one, `git rebase -i` and squash.
# If one commit should be two, `git reset HEAD~` and re-stage selectively.
```

## Tags and releases

Each shipped version gets an annotated tag:

```
git tag -a v0.1.6 -m "v0.1.6 — closed-beta build"
git push origin v0.1.6
```

The CHANGELOG entry for that version is updated **in the same commit that
flips `package.json` to that version**. The tag is created on that commit,
then pushed.

## Co-authored commits

When ClaudeCode (or any AI coding assistant) drafts a commit, the message
ends with:

```
Co-Authored-By: ClaudeCode <noreply@anthropic.com>
```

Human review and the discipline above still applies — the AI authoring just
gets credited for traceability.

## Out-of-scope work

If you spot something worth fixing that doesn't belong in the current commit,
stash it for a separate commit. Don't tack it onto the current one. Use
`git stash` or open an issue.
