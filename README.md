# FeonixLLM

Local-first AI desktop studio for Windows — built with Electron.

Runs entirely on your own machine by default (via [Ollama](https://ollama.com)), with optional connections to any OpenAI-compatible cloud provider when you need extra models.

## Features

- 🖥️ **Local-first** — runs local LLMs via Ollama; no data leaves your machine unless you choose a cloud provider
- 🔧 **Real tool-calling** — sandboxed file, shell, and Python execution via [MCP](https://modelcontextprotocol.io) (Model Context Protocol)
- 🔗 **Multi-agent chains** — chain specialized agents with conditional routing between stages
- 📚 **RAG** — ground answers in your own uploaded documents
- 🔒 **Encrypted vault** — optional local encryption (AES-256-GCM) for sensitive conversations
- ⚖️ **Model comparison lab** — run the same prompt across multiple models side by side
- 📊 **Performance dashboard** — track latency and token usage per model
- 🖼️ **File & image attachments** — attach images (vision models) or text/code files directly in chat
- 🔄 **Device sync** — sync app state between two devices on the same network

## Requirements

- Windows 10/11
- [Ollama](https://ollama.com) installed locally (for local models)
- Node.js (only if building from source)

## Installation

Download the latest installer from the [Releases](../../releases) page and run `FeonixLLM Setup x.x.x.exe`.

## Building from source

```bash
npm install
npm start        # run in development
npm run dist      # build a distributable .exe
```

## Project structure

```
FeonixLLM/
├── main.js         # Electron main process + local API/sandbox backend
├── preload.js       # Preload script
├── app/
│   ├── index.html    # Main app UI
│   ├── native.js      # Renderer ↔ native backend bridge
│   └── manifest.json  # PWA manifest
└── build/          # App icons
```

## Privacy & security

- All conversations and settings are stored locally by default.
- Local tool execution (shell/Python/file access) runs in a sandboxed workspace folder and requires your approval before running.
- See the app's in-app Privacy Policy for full details.

## License

Not yet licensed for redistribution — all rights reserved unless stated otherwise.
