# CodeBuddy CLI Integration

## Overview

OpenCowork now supports integration with CodeBuddy CLI tool, which provides a command-line interface for AI-powered coding assistance similar to Claude Code.

## Features

- **CLI-based execution**: Uses the `codebuddy` command instead of direct API calls
- **Claude Code compatible**: Parameters are mostly compatible with Claude Code CLI
- **Flexible configuration**: API keys and model settings passed automatically
- **Seamless integration**: Works with existing OpenCowork features

## Installation

### Prerequisites

Before using CodeBuddy mode, you need to install the `codebuddy` command-line tool:

```bash
# Installation method depends on CodeBuddy distribution
# Example (adjust based on actual installation method):
npm install -g codebuddy
# or
pip install codebuddy
```

### Verify Installation

```bash
codebuddy --version
codebuddy --help
```

## Configuration

1. Open OpenCowork Settings (⚙️ icon)
2. Go to the "通用" (General) tab
3. Select "CLI 模式 (CodeBuddy)" from the Integration Mode dropdown
4. (Optional) Configure API Key and Model - these will be passed to codebuddy

## How It Works

When CodeBuddy mode is enabled:

1. User messages are sent to the `codebuddy` command
2. OpenCowork executes: `codebuddy --directory <work_dir> --api-key <key> --model <model> --message "<user_message>"`
3. Output is streamed back to the UI in real-time
4. Command execution happens in the authorized working directory

## Command Parameters

The following parameters are automatically passed to `codebuddy`:

- `--directory`: Working directory (from authorized folders)
- `--api-key`: API key for authentication
- `--model`: Model name to use
- `--message`: User's input message

Environment variables are also set:
- `CODEBUDDY_API_KEY`: API key value

## Switching Modes

You can switch between API Mode and CLI Mode at any time:

- **API Mode**: Direct API calls (default, recommended for most users)
- **CLI Mode (CodeBuddy)**: CLI tool execution (for advanced users or Claude Code compatibility)

## Troubleshooting

### "CodeBuddy CLI not found" error

Make sure:
1. CodeBuddy is installed on your system
2. The `codebuddy` command is available in your PATH
3. Try running `codebuddy --version` in your terminal

### Command fails with authentication error

Verify:
1. API Key is configured in Settings
2. API Key has the correct permissions
3. Check CodeBuddy documentation for authentication requirements

### Output not appearing

Check:
1. CodeBuddy command is running (check task manager/activity monitor)
2. Look for error messages in the developer console (Help > Toggle Developer Tools)
3. Try running the same command manually in terminal to debug

## Comparison: API Mode vs CLI Mode

| Feature | API Mode | CLI Mode (CodeBuddy) |
|---------|----------|---------------------|
| Setup Complexity | Low | Medium (requires CLI tool) |
| Performance | Fast | Depends on CLI tool |
| Image Support | Yes | Limited/No |
| Streaming | Yes | Yes |
| Tools/MCP | Full support | Via CLI tool |
| Best For | Most users | Claude Code users, advanced workflows |

## Development

For developers working on the CodeBuddy integration:

- Source code: `electron/agent/CLIAgentRuntime.ts`
- Configuration: `electron/config/ConfigStore.ts`
- UI: `src/components/SettingsView.tsx`

## See Also

- [Configuration Guide](./configuration.md)
- [Configuration Guide (中文)](./configuration_cn.md)
