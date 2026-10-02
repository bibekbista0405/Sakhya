# Sakhya Phase 7 — Friends & Messaging UX

## Unified friend flow
- Replaced the separate Friends / Requests / Blocked tabs with a unified People screen.
- Search results show contextual state: Add, Pending, Accept/Decline, or Chat.
- Incoming requests appear inline at the top of the People screen.
- Sent requests appear inline with their pending state.
- Existing friends are shown below with a direct Chat action.
- Blocked users remain manageable without requiring the request tabs.

## Accept -> Chat
- Accepting a request returns the accepted friend from the API.
- The accepting user is immediately routed to `/chats/:friendId`.
- The requester receives `friend_accept` with the accepted friend and is immediately routed to the same chat.
- Existing Socket.IO refresh behavior remains intact.

## Safety / behavior
- Request buttons are disabled while the specific request is being processed.
- Errors are shown inline instead of silently failing.
- Existing friend/request/block authorization remains server-side.
