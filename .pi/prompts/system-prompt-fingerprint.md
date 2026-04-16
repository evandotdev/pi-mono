---
description: Compare and validate canonical /share:system-prompt artifacts
---
Analyze the attached `/share:system-prompt` artifact(s): $ARGUMENTS

## Canonical input

The canonical input for this prompt is the Markdown gist or file produced by `/share:system-prompt`.

If only raw JSONL is attached:
- say explicitly that raw JSONL does not normally contain `systemPrompt`
- recommend running `/share:system-prompt`
- stop

## Goal

For each attached `/share:system-prompt` artifact:
- extract the frontmatter metadata
- extract the raw system prompt body
- validate the metadata against the body
- compare hashes across artifacts
- emit tracking rows

## Required checks

Validate these metadata tags when present:
- `type`
- `app`
- `version`
- `date`
- `sessionId`
- `sessionName`
- `sessionFile`
- `cwd`
- `provider`
- `model`
- `thinkingLevel`
- `activeTools`
- `systemPromptSha256`
- `systemPromptChars`
- `systemPromptLines`

## Required output

Produce these sections:

1. **Artifact inventory**
   - artifact path or URL
   - session name
   - session file
   - date

2. **Prompt fingerprint validation**
   - recomputed SHA-256 hash of the prompt body
   - whether it matches `systemPromptSha256`
   - recomputed character count
   - whether it matches `systemPromptChars`
   - recomputed line count
   - whether it matches `systemPromptLines`

3. **Metadata validation**
   - missing tags
   - malformed tags
   - suspicious values

4. **Hash grouping**
   - group identical prompts together by hash
   - list which sessions share the same prompt hash

5. **Tracking rows**
   - emit one Markdown table row per artifact
   - columns: session name, hash, short hash, source, notes

## Notes

- Normalize line endings to LF only when recomputing the hash.
- Preserve all other whitespace in the prompt body exactly.
- Do not create gists here.
- Do not mutate or archive anything in this prompt.
