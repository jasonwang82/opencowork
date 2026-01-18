# Configuration Guide

WorkBuddy provides flexible configuration options, allowing you to customize API connections, model selection, and other advanced settings.

## Default Configuration

WorkBuddy is ready to use out of the box with the following defaults:

-   **Integration Mode**: `API Mode`
-   **API URL**: `https://api.minimaxi.com/anthropic`
-   **Model**: `MiniMax-M2.1`

This configuration is optimized for a smooth Cowork experience.

## Integration Modes

WorkBuddy supports two integration modes:

### 1. API Mode (Default)

Directly calls AI models through API. This is the recommended approach suitable for most scenarios.

**Configuration Steps:**
1. Select "API Mode (Claude API)" in settings
2. Enter your API Key
3. Configure API URL and model name

### 2. CLI Mode (CodeBuddy)

Uses the CodeBuddy CLI tool. This mode works similarly to Claude Code.

**Prerequisites:**
- Requires `codebuddy` command-line tool to be installed on your system
- CodeBuddy parameters are mostly compatible with Claude Code

**Usage:**
1. Select "CLI Mode (CodeBuddy)" in settings
2. Ensure `codebuddy` command is installed and available in PATH
3. Run `codebuddy --help` to see available parameters
4. API Key and model configuration will be automatically passed to codebuddy

**Advantages:**
- Compatible with Claude Code workflow
- Leverages CLI tool features
- Ideal for developers familiar with command-line tools

## Custom Configuration

You can access the Settings panel by clicking the gear icon **(⚙️)** in the bottom right corner of the application interface.

### Modifying API Settings

If you wish to use other compatible models (such as Claude, GPT, etc.), please modify the following fields as needed:

1.  **Integration Mode**: Select API Mode or CLI Mode (CodeBuddy)
2.  **API Key**: Enter the API key provided by your provider (required for API Mode).
3.  **API URL**: Enter the API endpoint address of your provider (required for API Mode).
4.  **Model**: Enter the model name you wish to call (e.g., `claude-3-opus-20240229`).

### Environment Variables

You can also configure settings via the `.env` file in the project root (development environment only):

```env
VITE_API_URL=https://your-api-url.com
VITE_MODEL_NAME=your-model-name
```
