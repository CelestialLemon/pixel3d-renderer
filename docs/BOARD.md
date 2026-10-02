# Message board: Opus ⇄ Sol

The shared scratchpad for the two agents working in this repo. The user reads it too.

This file is a **template**. Each new piece of joint work starts from this header with no posts below it, and the posts are
working notes that never get committed. Reset the file to this template only after the work's PR has been merged (see
**Finishing a piece of work** below). Lasting results belong in
`docs/ROADMAP.md`, `docs/ASSET_BRIEF.md`, the code or the commit messages, not here.

- **Opus** (Claude): writes clean, scalable code and is usually better at user-facing work like the frontend and visuals. I think
  of Opus as the clean software engineer.
- **Sol** (Codex): very good at diving deep into anything, and at reviewing and verifying things. I think of Sol as the very smart
  researcher/scientist. It also builds the Blender props per `docs/ASSET_BRIEF.md`.
- Who owns which files is agreed on the board at the start of each piece of work, before anyone edits.

This is not a hierarchy. Neither Opus nor Sol is a sub-agent: you are peers on the same level, collaborating to get the work done.
One of you being strong at something doesn't stop the other from reviewing, questioning or critiquing that work. Good collaboration
and communication are what get good results.

## Rules

1. **Append only.** Add new posts at the bottom and never edit or delete someone else's post. Append with the shell so two writers can't
   clobber each other: `cat >> docs/BOARD.md <<'EOF' ... EOF`. Don't rewrite the whole file with an editor.
2. **Post header:** `### YYYY-MM-DD HH:MM · <Name> → <Name|all> · <tag>`. Tags: `status`, `question`, `answer`, `handoff`, `request`,
   `observation`, `review`, `banter`. Get the time from `date "+%Y-%m-%d %H:%M"`.
3. **Keep posts short.** Use bullets and file paths. Put long things (probes, images, JSON) in your scratch directory and link them.
4. **Re-read the board** before starting a new piece of work and before posting. Answer open questions addressed to you first.
5. **Agree before editing.** Propose a split and wait for the other agent to accept it. Stay in the files you own, and keep any
   uncommitted changes, the user's dev server and the golden baselines intact.
6. **Handoffs say exactly what's ready:** paths, how to view or run it, and known issues.
7. **Neither agent is always online.** Each one only reads the board while it is working. If you need a reply to continue, post a
   `question` and check back. If your harness can watch a file, watch this one. While you wait for the other agent's results, carry on
   with your own work if you genuinely have some that doesn't depend on them. **If you have nothing real to do while you wait, go to
   sleep (wait on the board) instead of inventing work just to stay busy.**
8. **Git and goldens.** While the work is in progress, nobody commits or pushes; that happens only in the finishing steps below,
   or earlier if the user says so. Either agent may run `golden:update` for a deliberate visual change on the work's branch without
   asking first; the new baselines reach `main` only through the PR, where the user reviews them. Never update or commit golden
   images directly on `main`. Agree on the board which agent owns commits, the push and the PR. Never commit this board's posts.
9. **Banter is welcome.** Keep it light and keep it from burying the work.
10. **Communicate often.** Don't work silently. Reply to the other agent's posts before acting on them, especially a proposed split or
    an "agree or amend". Post a short `status` when you start something, when something lands and when you change course, and read
    every new post in full (not just the last few lines) each time you check the board.

## When to stop

Keep working until one of these is true, then stop:

- **The whole scope is done.** Every part of the agreed work is complete and the finishing steps below have been carried through
  to an open PR. Don't stop part-way through the scope, and don't stretch the scope beyond what was asked.
- **You are both stuck.** You and the other agent have both tried and cannot resolve an issue. Stop rather than going round in
  circles.
- **You need the user.** Something can't go further without the user's input, such as a decision, access, or a clarification only
  they can give.

When you stop, post a `status` on the board that says which of these applies and, if it's one of the last two, exactly what is
blocking you and what you need from the user. Tell the user the same thing in your reply.

## Finishing a piece of work

Start these steps only once **both** agents have agreed on the board that the work is complete. Do them in order.

1. **Clean the working tree.** Remove scratch files, probes, debug renders and anything else that won't go into the PR. Leave only
   the changes the work actually needs (plus this board, which stays uncommitted).
2. **Independent review by sub-agents.** Each agent spins up its own reviewer sub-agent, so there are two reviews in total. Use
   exactly these models for the reviewers:
   - Opus's reviewer: **Sonnet 5.5**.
   - Sol's reviewer: **GPT 6.1 Sol**.
   - Each reviewer reviews **all** of the work, not just the split its parent agent owned.
   - Give the reviewers minimal context: what the change is meant to do and where it lives (e.g. the diff against `main`), but not
     the reasoning or history behind the decisions. They are a fresh pair of eyes, and the less they know about why things were
     done, the less their review is biased by it.
   - Tell each reviewer explicitly **not to read `docs/BOARD.md`**.
3. **Fix what matters.** When both reviews are in, post them (or a summary with a link) on the board, then work together again,
   as peers, to triage and fix the findings. Fix every real issue. Skip extremely minor nits that are very unlikely ever to cause
   a problem and would only add code. If you're unsure whether something is real, discuss it on the board.
4. **Push and open the PR.** Only after the review findings are addressed: commit, push the branch and open a PR. The base is
   `main` unless the user has said otherwise. The PR description is for the user, who will review it:
   - Start with a concise summary of what was done.
   - If there is anything the user should check by hand, give clear step-by-step instructions for running it locally (commands,
     URL, which scene or view to open, what to look for).
   - Include screenshots (renders, before/after) wherever they help the user understand the change.
5. **Keep the board until the PR is merged.** The user or review bots may leave comments that need more work. Handle them as part
   of the same piece of work, using this board. Reset the board to the template only after the PR has been approved and merged.

---
