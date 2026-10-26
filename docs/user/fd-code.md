# FD CODE

FD CODE is Faheem's customised FD CODE app, based on the newer Alpha codebase. It includes Brain continuity, ARTsie tools, a persistent General chat, and local Laya routing.

## Install on macOS

Download [FD-CODE-macOS-arm64.dmg](https://github.com/faheemdehalvi/fd-code/releases/latest/download/FD-CODE-macOS-arm64.dmg), open it, and drag **FD CODE.app** into Applications. Quit the existing FD CODE normally before replacing it. The app keeps its existing T3 data directory and desktop profile; installing it does not import or erase the older Beta profile.

This release is locally signed, not Apple-notarized. macOS may require you to allow it under System Settings → Privacy & Security after the first launch attempt. If macOS instead reports that the app is damaged, run `xattr -dr com.apple.quarantine "/Applications/FD CODE.app"` and open it again.

## Install on Windows

Download [FD-CODE-Windows-x64.exe](https://github.com/faheemdehalvi/fd-code/releases/latest/download/FD-CODE-Windows-x64.exe) and run it. The installer is not code-signed, so Windows SmartScreen may stop it: choose **More info**, then **Run anyway**.

## Add-ons

Laya, the RAG and Graphify skills, and individual ARTsie editors install separately. The [README](../../README.md#add-ons) has one command for each.

## General chat and Laya

Use **General chat** at the top of the sidebar. It reopens a persistent, pinned conversation. Ordinary questions and web requests remain there; a confidently identified project request can continue in its matching existing conversation. General retains a link to the destination. Uncertain decisions and busy destinations stay in General.

Local Laya is optional. Without it, General chat still works, and explicitly named destinations can be resolved directly. To prepare Laya on a new machine with Python 3.11 installed, run from this checkout:

```sh
node scripts/laya-setup.mjs
```

The setup installs Laya 0.4.11 in an isolated environment under `~/.fd-code/laya`, creates a local token and downloads its model cache. For a custom T3 data directory, pass `--home-dir /your/data/directory`. General starts the authenticated loopback service on demand. No model account is needed for Laya. Chat providers still use your own configured accounts.

Routing applies to plain-text, single-model messages in the primary desktop/web environment. Messages with attachments, thread context, slash commands, or multiple selected models use the normal chat flow. The separate mobile client has not been given a General navigation control in this release.

ARTsie and Brain use their installed local services. Their data, provider credentials, chat histories and Laya tokens are not bundled in the DMG.

## Recall history on demand

Provider switches carry a bounded history handoff. Changing models within a resumed
provider session keeps its existing context. Neither action automatically adds a
second Brain digest or runs a graph search.

Use `/rag your question` to search this conversation, or `/graphify your question`
for graph retrieval. `/grafify` is also accepted. Results are focused and bounded;
the full saved history remains available for follow-up queries and paging. Agents
can use `t3_rag` and `t3_brain_memory` when they need additional context.

For a document knowledge base, ask the agent to use the installed RAG skill with
the knowledge-base name. For a repository graph, ask it to use the Graphify skill
against that repository. These are separate from conversation recall.

## Hugging Face models

Hugging Face Inference Providers use the same OpenCode integration as OpenRouter.
On the machine running FD CODE, connect your account:

```sh
opencode auth login huggingface
```

Enter a Hugging Face token in OpenCode's credential prompt. The token needs
**Make calls to Inference Providers** permission. Create it in
[Hugging Face token settings](https://huggingface.co/settings/tokens); do not paste
it into a chat or commit it to this repository.

In **Settings → Providers**, enable OpenCode and refresh its model list. Select
OpenCode in the composer and search for `huggingface/` to choose a supported chat
model. A listed model does not by itself confirm that the account is authenticated
or has inference credits. Hugging Face inference uses its own account and billing,
separately from ChatGPT, Claude, and OpenRouter.
