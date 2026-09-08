# Sakhya

A minimal, fully working WhatsApp-style messaging and calling app. Real-time chat, friend
requests, blocking, voice/video calling over WebRTC, notifications, and call history — all
running entirely on your machine with SQLite. No cloud services, no external accounts
required.

This repo has been built, then substantially polished into a mobile-first v1.0: a Facebook-style
multi-step onboarding flow, light/dark/system theming, a bottom nav on mobile with a desktop
top nav, skeleton loaders, date-grouped call logs and notifications, and several real
performance fixes (see "Performance notes" below). Every change was verified against the
running backend and Socket.IO connection during development.

## Tech stack

- **Frontend:** Next.js 15 (App Router), TypeScript, Tailwind CSS v4 (with class-based dark
  mode), custom Tailwind-based component primitives (Button/Input/Avatar/Badge/Skeleton —
  hand-built rather than pulled from the shadcn CLI registry, since this environment has no
  network access to it, but styled in the same spirit: unstyled-primitive + utility classes)
- **Backend:** Node.js, Express, Socket.IO, WebRTC signaling
- **Database:** SQLite via `better-sqlite3` (zero external services, file-based, with a
  lightweight migration path so upgrading an existing local DB doesn't require deleting data)
- **Auth:** JWT + bcrypt password hashing

## Project structure

```
sakhya/
├── scripts/                # One-command dev/build/start orchestration
├── server/                 # Express + Socket.IO + SQLite backend
│   ├── src/
│   │   ├── index.ts         # App entry point (Express + HTTP + Socket.IO wiring)
│   │   ├── db/               # SQLite connection + schema (auto-created/migrated on boot)
│   │   ├── routes/           # REST endpoints: auth, users, friends, messages, calls,
│   │   │                     # notifications, profile
│   │   ├── socket/            # Socket.IO event handlers + online-user registry
│   │   ├── middleware/        # JWT auth middleware
│   │   ├── utils/             # Shared helpers (sanitization, notifications, blocking, etc.)
│   │   └── types/             # Shared TypeScript types
│   ├── .env.example
│   └── package.json
├── client/                  # Next.js 15 frontend
│   ├── app/
│   │   ├── (auth)/login, register        # Public auth pages (multi-step onboarding)
│   │   └── (app)/chats, calls, friends,   # Protected app shell (top nav on desktop,
│   │        notifications, profile,       # bottom nav on mobile)
│   │        settings
│   ├── components/            # UI (chat, calls, layout, primitives, skeletons)
│   ├── hooks/                 # React contexts: auth, socket, notifications, calls (WebRTC),
│   │                          # theme (light/dark/system)
│   ├── lib/                   # API client, socket client, utils
│   ├── types/                 # Shared frontend types
│   └── package.json
└── README.md                 # This file
```

## Prerequisites

- Node.js 18+ and npm
- A modern browser (Chrome, Firefox, Edge, Safari) — camera/microphone access is required
  for calling and only works on `localhost` or HTTPS.

## Installation & running

Sakhya is configured as a single workspace. You do **not** need to start the frontend and
backend separately.

### 1. Install everything

From the Sakhya root directory:

```bash
npm install
```

The root workspace installs dependencies for both `client` and `server`.

### 2. Development mode

Run:

```bash
npm run dev
```

This single command starts:

- Frontend: `http://localhost:3000`
- Backend/API + Socket.IO: `http://localhost:4000`

The required local environment files are created automatically when needed.

Press `Ctrl+C` once to stop both services.

### 3. Production mode

Run:

```bash
npm start
```

If a production build does not exist, Sakhya automatically runs the build first. It then starts
both the backend and frontend with the same command.

You can also build manually:

```bash
npm run build
npm start
```

Open **http://localhost:3000** in two different browsers (or one normal + one incognito
window) to simulate two separate users.

## Trying it out end-to-end

1. Go through the multi-step sign-up flow (name → date of birth → gender → email →
   password) in two browser windows to create two accounts. A username is generated for you
   automatically from your name (editable later in Profile).
2. From window A, open the **Friends** tab, search for the other account's username, and
   send a friend request.
3. From window B, open **Friends → Requests** — accept it.
4. Open **Chats**, select the conversation, and send messages — typing indicators and
   delivered/seen ticks update live.
5. Tap the phone or video icon in the chat header to start a call; the other window shows an
   incoming-call screen with accept/decline, then a live call screen with mute/camera/end
   controls and a running duration.
6. Check **Calls** for the logged entry, grouped under Today/Yesterday/Older.
7. Trigger a friend request, message, and missed call, then check **Notifications**, also
   grouped by date, with "mark all as read".
8. Try **Friends → Block** on a friend — they disappear from your friends list and can no
   longer message, call, or re-add you until you unblock them from **Friends → Blocked** (or
   **Settings → Privacy → Blocked users**).
9. In **Settings**, switch between Light / Dark / System appearance.
10. Log out and log back in — all messages, friends, blocks, and call history persist in
    SQLite.

## Performance notes

A few concrete fixes worth calling out, since "make it faster" is otherwise hard to verify:

- **Chat list no longer refetches on every message.** It used to call the REST API and
  reload every conversation on each `receive_message`/`message_seen` socket event. It now
  patches the affected conversation's `lastMessage`/`unreadCount` in place and re-sorts
  locally — O(1) socket handling instead of a full round-trip per event.
- **Message bubbles and chat-list rows are memoized** (`React.memo`) so a new message or an
  unrelated state change doesn't re-render the entire scrollback/list.
- **The WebRTC call UI is code-split** via a client-only lazy import, so it isn't included in
  the JS bundle for the login/register routes, which never need it.
- **Skeleton loaders** replace spinners on the chat list, chat window, calls, notifications,
  and friends pages, so the layout doesn't jump and perceived load feels instant.
- Search inputs (friend search) are debounced (250ms) instead of firing a request per
  keystroke.
- Theme is applied via a tiny inline script before hydration, so there's no flash of the
  wrong theme on load; the whole palette is CSS custom properties, so light/dark needs no
  per-component `dark:` class management.

## REST API

Base URL: `http://localhost:4000/api`. All routes except `/auth/register` and `/auth/login`
require an `Authorization: Bearer <token>` header.

| Method | Path | Description |
|---|---|---|
| POST | `/auth/register` | Create an account: `{ firstName, lastName, dateOfBirth, gender, email, password }` → `{ user, token }`. Username is auto-generated from the name (editable later). |
| POST | `/auth/login` | Log in, returns `{ user, token }` |
| POST | `/auth/logout` | Invalidate the current session |
| GET | `/auth/me` | Get the current authenticated user |
| GET | `/users/search?q=` | Live search users by username (excludes anyone blocked in either direction) |
| GET | `/users/:id` | Get a user's public profile |
| PUT | `/profile` | Update username, bio, avatar, first/last name |
| PUT | `/profile/password` | Change password |
| DELETE | `/profile` | Delete your account permanently |
| GET | `/friends` | List accepted friends |
| GET | `/friends/requests` | List incoming/outgoing pending requests |
| POST | `/friends/request/:userId` | Send a friend request |
| POST | `/friends/accept/:requestId` | Accept a friend request |
| POST | `/friends/reject/:requestId` | Reject a friend request |
| DELETE | `/friends/:friendId` | Remove a friend |
| GET | `/friends/blocked` | List users you've blocked |
| POST | `/friends/block/:userId` | Block a user (also removes any friendship/pending request) |
| POST | `/friends/unblock/:userId` | Unblock a user |
| GET | `/messages/conversations` | Chat list: friends + last message + unread count |
| GET | `/messages/:friendId` | Full message history with a friend (marks as seen) |
| GET | `/calls` | Call history (incoming/outgoing/missed/completed) |
| GET | `/notifications` | List notifications |
| PUT | `/notifications/:id/read` | Mark one notification as read |
| PUT | `/notifications/read-all` | Mark all notifications as read |
| GET | `/health` | Health check |

## Socket.IO events

Connect with `io(SOCKET_URL, { auth: { token } })`.

**Client → server**

| Event | Payload | Description |
|---|---|---|
| `send_message` | `{ receiverId, content }` | Send a chat message (rejected if either side has blocked the other) |
| `typing` / `stop_typing` | `{ receiverId }` | Typing indicator |
| `message_seen` | `{ friendId }` | Mark a friend's messages as seen |
| `call_user` | `{ receiverId, type, offer }` | Start a call (WebRTC offer; rejected if blocked) |
| `call_accepted` | `{ callId, answer }` | Accept an incoming call (WebRTC answer) |
| `call_rejected` | `{ callId }` | Decline an incoming call |
| `ice_candidate` | `{ callId, targetId, candidate }` | Relay an ICE candidate |
| `end_call` | `{ callId }` | End/cancel a call |

**Server → client**

| Event | Payload | Description |
|---|---|---|
| `online_users` | `{ userIds }` | Full list of currently online users (on connect) |
| `user_online` / `user_offline` | `{ userId }` | Presence change for a friend |
| `receive_message` | `Message` | New message (to sender and receiver) |
| `typing` / `stop_typing` | `{ senderId }` | Typing indicator |
| `message_seen` | `{ by }` | A friend has seen your messages |
| `friend_request` | `{ request, sender }` | New incoming friend request |
| `friend_accept` | `{ requestId, friend }` | Your friend request was accepted |
| `notification` | `Notification` | Any new notification |
| `call_initiated` | `{ callId, receiverId, type }` | Ack to the caller with the new call ID |
| `incoming_call` | `{ callId, type, offer, caller }` | Incoming call for the receiver |
| `call_accepted` | `{ callId, answer }` | Callee accepted (to caller) |
| `call_rejected` | `{ callId }` | Callee declined (to caller) |
| `call_failed` | `{ reason }` | Call could not be placed (e.g. user offline) |
| `ice_candidate` | `{ callId, candidate }` | Relayed ICE candidate |
| `call_ended` | `{ callId, duration }` | Call ended (by either side, or on disconnect) |
| `error_message` | `{ error }` | Action rejected (e.g. messaging/calling a blocked user) |

## Database schema

SQLite tables (auto-created/migrated on server start): `users` (now includes `firstName`,
`lastName`, `dateOfBirth`, `gender`), `sessions`, `friend_requests`, `friends`,
`blocked_users`, `messages`, `calls`, `notifications`. See `server/src/db/index.ts` for the
full schema. If you have an existing `sakhya.db` from before this update, it will be
auto-migrated in place the next time the server starts — no need to delete it.

## Notes & scope

- Calling uses public Google STUN servers for NAT traversal (no TURN server is included,
  so calls between two devices on very restrictive/symmetric NATs may not connect — this is
  a standard limitation of a STUN-only WebRTC setup).
- Only text messages are supported (no media/stickers/reactions), matching the MVP scope.
- Messages cannot be edited or deleted, matching the MVP scope.
- No screen sharing, matching the MVP scope.
- "Forgot password" is a placeholder — there's no email service in this local-only MVP, so
  it explains that rather than pretending to send an email.
- No group chats, stories, or any of the other explicitly-excluded features.


### Navigation performance

Primary navigation uses Next.js `Link` directly. Manual hover/touch prefetching and global route warmup were removed to prevent competing route requests that could make tab navigation feel delayed or require repeated clicks, especially in development.
