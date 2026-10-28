# Working in this repo

## Workflow

1. **Branch.** Work on a branch off `main`. Never commit to `main` directly.
2. **Implement and verify.**
   - Run `npm run golden` to verify your changes. A refactor must stay pixel-identical. After a deliberate visual change,
     accept it with `npm run golden:update` on the work's branch. You don't need to ask first, because the new baselines reach
     `main` only through the PR, where the user reviews them. Never update goldens on `main`.
   - Run `npm run check` (it needs the dev server: `npm run dev`, on 127.0.0.1:5180). If the server is already running, use it
     and don't kill it.
   - Add an entry under **Unreleased** in `CHANGELOG.md` for every change to the renderer.
   - Never edit `src/reference/` without the user's agreement. Pass 0 and Pass 1 must stay pixel-identical.
3. **Clean the working tree.** Remove the scratch files, probes and debug renders you created for this work, so the PR holds
   only the changes the work needs. Never delete or revert changes you didn't make (the user may have uncommitted work in the
   tree), and don't run `git checkout`/`reset`/`clean`/`stash` on them.
4. **Independent review.** Once the feature or fix is done get them reviewed from Sol using the review-with-sol skill.
