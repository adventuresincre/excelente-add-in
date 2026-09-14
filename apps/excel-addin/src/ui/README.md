# ui

React components for the taskpane.

## Planned layout

```
ui/
└── taskpane/
    ├── App.tsx                # root layout, routes between views
    ├── Chat/
    │   ├── ChatPanel.tsx      # message list + composer + streaming
    │   ├── MessageBubble.tsx
    │   └── ToolCallCard.tsx
    ├── Settings/
    │   ├── SettingsPanel.tsx  # API key, model picker, reasoning slider
    │   └── ModelPicker.tsx
    ├── Skills/
    │   ├── SkillsDrawer.tsx   # browse, install, enable/disable
    │   └── SkillCard.tsx
    └── ToolApproval/
        └── ApprovalDialog.tsx # pending writes, approve / deny / approve-all-session
```

## Rules

- No `Excel.run` calls in UI. All Excel I/O goes through `core/tools/excel/*`.
- No direct OpenRouter calls. All model traffic goes through `core/openrouter`.
- State lives in the React tree; persistence goes through `core/storage`.

## Phase 0 status

Phase 0 ships a minimal shell at `src/taskpane/{main.tsx, App.tsx}`. Components migrate into `src/ui/taskpane/` as Phase 1 fleshes them out.

## Lands in

Phase 1 — Chat + Settings UI. Skills UI in Phase 4. Tool Approval in Phase 3.
