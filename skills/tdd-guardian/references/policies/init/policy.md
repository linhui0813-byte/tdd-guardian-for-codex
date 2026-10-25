# Initialization policy

Use `<plugin_root>/skills/tdd-guardian/references/workflows/init.md` for detection, verified proposals, and config writes. Use `<plugin_root>/skills/tdd-guardian/references/workflows/shared/load-config.md` for the schema. Resolve `plugin_root` from the main skill.

Keep both blocking switches off unless the user explicitly enables each one. Existing config changes require a displayed diff and authorization for the requested settings. Updating the plugin package alone preserves project config and state.
