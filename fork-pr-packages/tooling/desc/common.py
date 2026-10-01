BASE_SHA = "467125fafb47a8520856504fecc48d6e32055db1"
BUG_FIELDS = ("What happened", "Expected behavior", "Steps to reproduce", "Paperclip version or commit", "Deployment mode")
MODEL_USED = """- Provider and model: Anthropic Claude, used through Claude Code (an agentic coding CLI).
- Capabilities used: tool use (shell, file reads and edits), code execution, extended reasoning, and a subagent for the duplicate search.
- The commit trailers carry the Claude attribution. The person who opens this pull request adds the exact model ID and context window here."""
