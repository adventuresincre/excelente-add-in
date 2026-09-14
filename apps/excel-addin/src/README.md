# src layout

```
src/
├── core/      # Framework — model client, agent loop, tools, skills, context, storage
│   ├── openrouter/   # OpenRouter HTTP client (chat, streaming, tool calls, reasoning)
│   ├── context/      # Workbook context engine — outline / sheet / range / dependencies
│   ├── agent/        # Orchestrator loop, sub-agent spawning, context budget
│   ├── tools/        # Tool registry + Excel tool implementations
│   ├── skills/       # Open Agent Skills loader, progressive disclosure
│   ├── modes/        # Mode presets (CRE underwriting, 3-statement, FP&A, …)
│   └── storage/      # Settings, API key, conversation history (see storage/README.md)
└── ui/        # React components for the taskpane (Chat, Settings, Skills, Tool Approval)
```

Rules:

- All Excel I/O goes through `core/tools/excel/*`. No `Excel.run` calls in UI code.
- All OpenRouter calls go through `core/openrouter`.
- Each `core/*` folder exposes its public interface via `index.ts`.
- Each module has its own `README.md` describing its public interface.
