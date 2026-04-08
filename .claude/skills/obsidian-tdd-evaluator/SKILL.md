---
name: obsidian-tdd-evaluator
description: Automates Obsidian plugin testing. Triggers npm build, hot-reloads the plugin via Obsidian CLI, and evaluates JS in the Electron runtime.
---

# Obsidian Plugin TDD Evaluator

## When to use this skill
Invoke this skill whenever the user modifies the TypeScript code of their Obsidian plugin and asks to "test it", "check if it works", "reload Obsidian", or "run TDD". 

## Prerequisites
- The user must have the `obsidian` CLI tool installed and configured.
- Obsidian must be running in the background.
- The user's plugin ID is `your-plugin-id` (Claude: Please verify the actual plugin ID from manifest.json before proceeding).

## Workflow Instructions
When triggered, you must execute the following automated validation loop. Do not skip any steps.

### Step 1: Build the Source
Always compile the latest TypeScript changes first.
- **Action**: Run the build command in the terminal.
- **Command**: `npm run build` or `npm run dev`

### Step 2: Hot Reload the Plugin
Force Obsidian to load the freshly compiled `main.js`.
- **Action**: Use the Obsidian CLI to reload the plugin.
- **Command**: `obsidian plugin:reload id=<actual-plugin-id>`

### Step 3: End-to-End Evaluation
Test the new logic by injecting JavaScript into the Obsidian Electron runtime.
- **Action**: Do not write inline code with complex quotes. Instead, use the provided `eval_runner.sh` script in this skill directory to pass the JavaScript code securely.
- **Command**: `./eval_runner.sh "app.plugins.plugins['<actual-plugin-id>'].YOUR_TEST_METHOD()"`

### Step 4: Error Monitoring & Recovery
If Step 3 fails or returns an unexpected result, do not guess the fix.
- **Action**: Fetch the real error trace from the Obsidian console.
- **Command**: `obsidian dev:errors`
- **Resolution**: Analyze the trace, propose a code fix to the user, and if approved, repeat this workflow from Step 1.

## Examples
**User**: "I just updated the search_markdown_text function, can you test it?"
**Claude**: 
1. Runs `npm run build`
2. Runs `obsidian plugin:reload id=my-agent-plugin`
3. Writes a small JS snippet calling the search function and runs it via `eval_runner.sh`.
4. Reports the search results or errors back to the user.