# Working in this repo

## Workflow

1. **Branch.** Work on a branch off `main`. Never commit to `main` directly.
2. **Implement and verify.**
   - Run `npm run golden` before and after every change. A refactor must stay pixel-identical. After a deliberate visual change,
     accept it with `npm run golden:update` on the work's branch. You don't need to ask first, because the new baselines reach
     `main` only through the PR, where the user reviews them. Never update goldens on `main`.
   - Run `npm run check` (it needs the dev server: `npm run dev`, on 127.0.0.1:5180). If the server is already running, use it
     and don't kill it.
   - Add an entry under **Unreleased** in `CHANGELOG.md` for every change to the renderer.
   - Never edit `src/reference/` without the user's agreement. Pass 0 and Pass 1 must stay pixel-identical.
3. **Clean the working tree.** Remove the scratch files, probes and debug renders you created for this work, so the PR holds
   only the changes the work needs. Never delete or revert changes you didn't make (the user may have uncommitted work in the
   tree), and don't run `git checkout`/`reset`/`clean`/`stash` on them.
4. **Independent review.** Once the feature or fix is done, get a code review from a fresh `gpt-6.1-sol` session through the
   Codex CLI. The user authorizes this as a standing rule, so don't ask before running it. Write the review request to a file
   outside the repo, then run:

   ```sh
   codex exec --ephemeral --model gpt-6.1-sol -c model_reasoning_effort="high" --sandbox read-only \
     --cd "$(git rev-parse --show-toplevel)" --output-last-message /tmp/review.md - < /tmp/review-request.txt
   ```

   - Give the reviewer minimal context: what the change is meant to do, and the scope to review (the diff against `main`,
     including uncommitted and untracked files). Don't give it your reasoning or the history behind your decisions. A fresh pair
     of eyes is less biased by them. Ask for actionable issues with severity and file/line evidence, or an explicit "no
     findings".
   - If the review can't run (Codex not signed in, quota, model unavailable), tell the user. Never present a failed run as a
     review.
5. **Fix what matters.** Check each finding yourself before acting on it. Fix every real issue. Skip extremely minor nits that
   are very unlikely to ever cause a problem and would only add code. If the fixes change the code materially, run a **fresh**
   review of the new diff. Stop when a review comes back with nothing actionable. If a finding is still open after three rounds,
   or you are unsure whether it is real, ask the user.
6. **Push and open the PR.** Commit, push the branch and open a PR against `main` (unless the user says otherwise). The PR
   description is for the user, who will review it:
   - Start with a concise summary of what was done.
   - Briefly say what the review found and what you fixed or deliberately left.
   - If there is anything the user should check by hand, give step-by-step instructions (commands, URL, scene or view, what to
     look for).
   - Include screenshots (renders, before/after) wherever they help.
7. **Handle the GitHub review bot.** Opening the PR triggers an automatic review by the Codex connector
   (`chatgpt-codex-connector`), which takes a few minutes. Wait for it, then read every comment
   (`gh api repos/CelestialLemon/pixel3d-renderer/pulls/<N>/comments` and `.../reviews`). Judge each one the same way as in
   step 5, and push fixes to the same PR. A thumbs-up reaction on the PR instead of a review means it found nothing.
8. **Before saying you're done,** check for orphaned headless Chrome (`pgrep -f puppeteer_dev_chrome_profile`) and stop any
   left behind by your captures.
