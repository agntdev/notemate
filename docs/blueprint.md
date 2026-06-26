# Collaborative Notes Manager — Bot specification

**Archetype:** workflow

Telegram bot for creating and sharing plain-text notes with specific collaborators. Features include note creation/editing, invite management, edit history, and real-time notifications for changes and invites.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- Individuals needing private notes
- Small teams collaborating in Telegram

## Success criteria

- Users can create and share notes with specific Telegram users
- Collaborators receive notifications about edits and invites
- Edit history with 20 revisions retained per note

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open main menu with 'Create note' button
- **Create note** (button, actor: user, callback: note:create:start) — Initiates note creation flow
- **List my notes** (button, actor: user, callback: note:list) — Shows owned/editable notes with Open/Invite buttons
- **/list** (command, actor: user, command: /list) — Alternative access to note list

## Flows

### Note creation
_Trigger:_ /new or 'Create' button

1. Request title via ForceReply
2. Request body via ForceReply
3. Confirm creation and show Note view

_Data touched:_ Note, Membership

### Invite collaborator
_Trigger:_ Invite button in Note view

1. Request @username via ForceReply
2. Send invitation with Accept/Decline buttons
3. Update Membership on acceptance

_Data touched:_ Invitation, Membership

### Edit note
_Trigger:_ Edit button in Note view

1. Open inline editor
2. Save changes creating Edit record
3. Notify all collaborators

_Data touched:_ Note, Edit

### Revoke access
_Trigger:_ Members view action

1. Confirm removal
2. Update Membership
3. Notify removed user

_Data touched:_ Membership

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

- **Note** _(retention: persistent)_ — Text document with metadata
  - fields: title, body, owner_id, created_at, updated_at
- **Membership** _(retention: persistent)_ — User access permissions
  - fields: user_id, note_id, role
- **Invitation** _(retention: session)_ — Pending collaboration invite
  - fields: owner_id, telegram_user_id, note_id
- **Edit** _(retention: persistent)_ — Change history record
  - fields: note_id, author_id, timestamp, diff_summary

## Integrations

- **Telegram** (required) — Bot API messaging
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Create/delete notes
- Invite/edit collaborators
- View/edit history
- Revoke access

## Notifications

- Invite sent/accepted/declined notifications
- Edit notifications with optional note link
- Access revoked notifications

## Permissions & privacy

- Editors can only access notes they're explicitly invited to
- Invitees must start bot to receive interactive messages
- Deleted notes removed from all collaborators' lists

## Edge cases

- Invitee hasn't started bot (prompt to start)
- Concurrent edits (last-write-wins)
- History limit reached (oldest entry discarded)

## Required tests

- End-to-end invite flow with notification delivery
- Edit history persistence and revert functionality
- Access revocation with list update verification

## Assumptions

- Contact selection UI uses @username format
- Notifications include optional note open button
- 20-edit history limit is sufficient for most use cases
