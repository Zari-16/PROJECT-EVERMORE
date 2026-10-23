# Security and Backup Checklist

Use this before and during the two-account acceptance pass. This is a practical project checklist, not a formal security audit.

## Before Migration 024

- Create a Supabase database backup or export before applying the migration.
- Back up Storage objects separately; a database backup does not include uploaded files.
- Apply `migrations/024_final_features.sql` after the earlier migrations, including 023.
- Confirm the migration completes without SQL errors before testing the new controls.

## Two-Account Test

Use both paired accounts, plus an unpaired test account for denial checks.

- Calendar: create a monthly event on the 29th, 30th, or 31st and verify its shorter-month occurrence; test a yearly leap-day event, recurrence end date, and browser reminder permission.
- Chat: send, edit, and delete a message; add/remove reactions; verify typing and unread state on the other account; upload an allowed image or PDF and confirm it is private to the paired space.
- Chat validation: reject unsupported file types and files over 10 MB; verify an unpaired account cannot read messages, reactions, attachments, or broadcast typing on the pair channel.
- Daily questions: test private, shared, and `after_both` answers before and after both accounts respond; add comments/reactions only to visible answers; export history and confirm hidden answers are absent.
- Memory Garden: attach an allowed file to a private memory and confirm the partner cannot see it; repeat with a shared memory; export JSON and check it includes only visible memories.
- Whiteboard: undo and redo strokes and clear operations from each account; draw after undo and verify the redo branch is gone on both screens.
- Notifications: create a shared calendar event and send a chat message; verify only the intended paired account sees each notification and read state is per account.
- Negative access: use the unpaired account to try each shared RPC, table, storage path, question interaction, and notification row; each attempt should be denied or return no data.

## Ongoing Checks

- Schedule and periodically verify Supabase database backups; rehearse restores in a non-production project.
- Back up private Storage objects separately and verify restores do not make the bucket public.
- Keep only the Supabase publishable key in browser configuration; never put a service-role key in the app or repository.
- Review RLS for every new table and confirm `SECURITY DEFINER` RPCs validate authentication, membership, ownership, and visibility.
- Re-run the production build and two-account checklist after schema or access-policy changes.

## Delivery Limits

- Calendar reminders use the browser Notification API while the app is open; they are not push notifications and may not fire when the browser is closed or suspended.
- Realtime updates require Supabase Realtime publication and both accounts online.
