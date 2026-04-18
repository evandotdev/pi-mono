---
description: Create a concise implementation plan from a task description
---

Create a short, actionable implementation plan for: $ARGUMENTS

# Requirements:

- If no task details are provided, ask for the missing context first.
- Keep the plan concise and execution-focused.
- Do not write code unless the user explicitly requests.
- Estimate the simplicity of the plan in terms of how easy it is for you to understand. From a scale of 1-10, where 1 is extremely difficult to understand, and 10 is easy to understand.
- Ensure that the plan is fleshed out, if you encounter any ambiguity, defer back to the user.
- Use checkboxes to keep track of progress made and update them as you go along.

# Output format:

1. Goal / Intent
2. Constraints / assumptions
3. Steps to achieve goal & crucial touchpoints
4. Validation checks
5. Open questions (only if needed)

# Note

- Make sure to save the plan under the same location as the session data, by default under (~/.pi/agent/sessions/<folder_name>)
- Do not edit the session `.jsonl` files, instead follow the naming convention and create plan files.

Behaviour:
workspace: <workspace_name>
session location: ~/.pi/agent/sessions/<workspace_name>/

- create a plan folder inside of that session's folder if it doesn't exist ~/.pi/agent/sessions/<workspace_name>/plans/
- make the plan file a .jsonl, where each entry is tied to the session that the plan was created in.

```json
{
  "type": "message",
  "id": "899eaacb",
  "sessionId": "c25f20e0",
  "timestamp": "2026-04-18T01:52:29.130Z",
  "message": {
    "role": "assistant",
    "content": [{ "type": "plan", "content": "... plan details ...}" }]
  }
}
```
