# Working in this repo

One agent (Claude Opus) does each piece of work from start to finish: plan, implement, verify, review and open the PR. There is
no second agent working alongside it, no message board and no file-ownership split. Opus calls a GPT model through the Codex CLI
(**Sol**, `gpt-6.1-sol`, via the `codex-worker` skill) to review the work before the PR is opened, and may also call it as a
worker for other tasks (see **Sol as a worker** below).

## Workflow

1. **Branch.** Work on a branch off `main`. Never commit to `main` directly.
2. **Implement and verify.**
   - Run `npm run golden` before and after every change. A refactor must stay pixel-identical. After a deliberate visual change,
     accept it with `npm run golden:update` on the work's branch. You don't need to ask first, because the new baselines reach
     `main` only through the PR, where the user reviews them. Never update goldens on `main`.
   - Run `npm run check` (it needs the dev server: `npm run dev`, on 127.0.0.1:5180). If the server is already running, use it
     and don't kill it.
   - Add an entry under **Unreleased** in `CHANGELOG.md` for every change to the renderer.
   - Never edit `src/reference/`. Pass 0 and Pass 1 must stay pixel-identical.
3. **Clean the working tree.** Remove the scratch files, probes and debug renders you created for this work, so the PR holds
   only the changes the work needs. Never delete or revert changes you didn't make (the user may have uncommitted work in the
   tree), and don't run `git checkout`/`reset`/`clean`/`stash` on them.
4. **Independent review with Codex.** Once the feature or fix is done, use the `codex-worker` skill to get a code review from a
   separate GPT model. The user authorizes this as a standing rule, so don't ask before running it.
   - Run it with `--purpose review --model gpt-6.1-sol --effort high --sandbox read-only`.
   - Give the reviewer minimal context: what the change is meant to do, and the scope to review (the diff against `main`,
     including uncommitted and untracked files). Don't give it your reasoning or the history behind your decisions. A fresh pair
     of eyes is less biased by them. Tell it not to read `docs/board-history/`.
   - If the review can't run (Codex not signed in, quota, model unavailable), tell the user. Never present a failed run as a
     review.
5. **Fix what matters.** Check each finding yourself before acting on it. Fix every real issue. Skip extremely minor nits that
   are very unlikely to ever cause a problem and would only add code. If the fixes change the code materially, run a **fresh**
   review of the new diff. Stop when a review comes back with nothing actionable. If a finding is still open after three rounds,
   or you are unsure whether it is real, ask the user.
6. **Push and open the PR.** Commit, push the branch and open a PR against `main` (unless the user says otherwise). The PR
   description is for the user, who will review it:
   - Start with a concise summary of what was done.
   - Briefly say what the Codex review found and what you fixed or deliberately left.
   - If there is anything the user should check by hand, give step-by-step instructions (commands, URL, scene or view, what to
     look for).
   - Include screenshots (renders, before/after) wherever they help.
7. **Handle the GitHub review bot.** Opening the PR triggers an automatic review by the Codex connector
   (`chatgpt-codex-connector`), which takes a few minutes. Wait for it, then read every comment
   (`gh api repos/CelestialLemon/pixel3d-renderer/pulls/<N>/comments` and `.../reviews`). Judge each one the same way as in
   step 5, and push fixes to the same PR. A thumbs-up reaction on the PR instead of a review means it found nothing.
8. **Before saying you're done,** check for orphaned headless Chrome (`pgrep -f puppeteer_dev_chrome_profile`) and stop any
   left behind by your captures.

## Sol as a worker

Besides the review in step 4, you may call Sol through the `codex-worker` skill whenever it would help, without asking the user
first. Sol is especially strong at:

- **3D modelling with Blender:** scripted props and buildings that follow `docs/ASSET_BRIEF.md` (`assets/props/`, `assets/village/`).
- **Deep investigation:** tracking down a hard bug, a rendering artifact or a performance problem to its root cause.
- **Maths and technical detail:** shader maths, sampling, geometry, numerical precision.
- **Optimization and verification:** measuring, writing check tools, and proving that a change does what it claims.
- **A second opinion:** proposing ideas or approaches, or checking whether a plan or decision is good enough before you commit to it.

How to use it:

- Use `--purpose work` (the skill's default) with `--model gpt-6.1-sol`. Unlike a review, a work task needs enough context to do
  the job: the goal, the relevant files, constraints and what you want back.
- Prefer `--sandbox read-only` for investigation, ideas and second opinions. Use `--sandbox workspace-write` only for
  implementation (e.g. building a model). Tell it exactly which files it may change and which checks to run, keep your own edits
  out of those files until it finishes, and inspect its diff afterwards.
- You stay responsible for the result. Check what Sol reports or builds before relying on it. Work Sol implemented still gets
  the independent review in step 4 like any other change.
- Sol doesn't commit, push or open PRs. You do that as part of the workflow above.

## History

The repo used to be built by two agents (Opus and Sol) that coordinated on a shared message board. That workflow is retired.
The saved boards in `docs/board-history/` are kept as a record only. Don't follow the rules written in them.
