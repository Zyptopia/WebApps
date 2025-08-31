# Creative Web App Hub — Instance 1 (SDK + Lobby)

## Quick Start

```bash
pnpm install
pnpm --filter @app/hub dev
# open http://localhost:5173
Build
bash
Copy code
pnpm -r build
# output: apps/hub/dist
Firebase (free tier)
Realtime Database enabled.

Deploy rules:

bash
Copy code
cd infra/firebase
firebase use <your-project-id>
firebase deploy --only database
Packages/Exports
@sdk/game-sdk: RoomClient + types (Room, Player, Avatar, ChatMessage)

@pkg/avatars: AvatarEditorStub, renderAvatar, getPresetIds

@pkg/ui: Button, Input

Avatars — how to change
See packages/avatars/README.md (how to replace/add SVG presets).

Error Codes (client)
ERR_CODE_NOT_FOUND, ERR_ROOM_FULL, ERR_NAME_INVALID

Reserved GA4 Events (stub)
room_create, room_join, lobby_view, chat_send

Known limitations / TODO (Instance 2)
Chat moderation (profanity/caps/dup), throttling

Full doodle editor (undo/clear/palette save)

Ready-up & countdown

Optional: switch to Firebase Anonymous Auth and tighten rules

yaml
Copy code

---

# 🧪 Quick acceptance test

1) **Create Room** on device A → see 4-char code.
2) **Join by code** from device B → both players appear; avatars render.
3) **Presence**: close B’s tab → B disappears within ~30–60s.
4) **Chat**: send messages (Enter to send); messages show under `rooms/{id}/chat`.
5) **Leave lobby** button returns to home and cleans presence.

---

If you want, I can also drop a tiny `.github/workflows/pages.yml` for GitHub Pages later, but it’s not required for Instance-1.





Ask ChatGPT
```
