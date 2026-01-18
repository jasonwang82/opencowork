# 配置指南

WorkBuddy 提供了灵活的配置选项，允许您自定义 API 连接、模型选择以及其他高级设置。

## 默认配置

WorkBuddy 开箱即用，默认配置如下：

-   **接入方式 (Integration Mode)**: `API 模式`
-   **API 地址 (API URL)**: `https://api.minimaxi.com/anthropic`
-   **模型 (Model)**: `MiniMax-M2.1`

该默认配置经过优化，可提供流畅的 Cowork 体验。

## 接入方式

WorkBuddy 支持两种接入方式：

### 1. API 模式（默认）

通过 API 直接调用 AI 模型。这是推荐的方式，适用于大多数场景。

**配置步骤：**
1. 在设置中选择「API 模式 (Claude API)」
2. 输入 API Key
3. 配置 API URL 和模型名称

### 2. CLI 模式（CodeBuddy）

使用 CodeBuddy CLI 工具运行。这种方式类似于 Claude Code 的工作方式。

**前提条件：**
- 需要在系统中安装 `codebuddy` 命令行工具
- CodeBuddy 的参数与 Claude Code 基本一致

**使用方式：**
1. 在设置中选择「CLI 模式 (CodeBuddy)」
2. 确保 `codebuddy` 命令已安装并在 PATH 中可用
3. 运行 `codebuddy --help` 查看可用参数
4. API Key 和模型配置会自动传递给 codebuddy

**优势：**
- 与 Claude Code 工作流程兼容
- 可以利用 CLI 工具的特性
- 适合已经习惯使用命令行的开发者

## 自定义配置

您可以点击应用界面右下角的齿轮图标 **(⚙️)** 进入设置面板。

### 修改 API 设置

如果您希望使用其他兼容改模型（如 Claude, GPT 等），请按需修改以下字段：

1.  **接入方式**: 选择 API 模式或 CLI 模式（CodeBuddy）
2.  **API Key**: 输入您的服务商提供的 API 密钥（API 模式下必需）。
3.  **API URL**: 输入服务商的 API 端点地址（API 模式下必需）。
4.  **Model**: 输入您希望调用的模型名称（如 `claude-3-opus-20240229`）。

### 环境变量

您也可以通过项目根目录下的 `.env` 文件进行配置（仅限开发环境）：

```env
VITE_API_URL=https://your-api-url.com
VITE_MODEL_NAME=your-model-name
```
