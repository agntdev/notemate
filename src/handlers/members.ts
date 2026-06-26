import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  type InlineKeyboardMarkup,
  type InlineButton,
} from "../toolkit/index.js";
import { getStore } from "../store.js";

function backToNoteButton(noteId: string): InlineKeyboardMarkup {
  return inlineKeyboard([[inlineButton("⬅️ Back to note", `note:view:${noteId}`)]]);
}

async function getUserId(ctx: Ctx): Promise<number> {
  return ctx.from?.id ?? ctx.callbackQuery?.from.id ?? 0;
}

async function notifyUser(ctx: Ctx, userId: number, text: string): Promise<void> {
  try {
    await ctx.api.sendMessage(userId, text);
  } catch {
    // Non-fatal
  }
}

const composer = new Composer<Ctx>();

composer.callbackQuery("noop", async (ctx) => {
  await ctx.answerCallbackQuery();
});

composer.callbackQuery(/^note:members:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const noteId = ctx.match[1]!;
  const store = getStore();
  const note = await store.getNote(noteId);
  if (!note) {
    await ctx.editMessageText("Note not found.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Menu", "menu:main")]]),
    });
    return;
  }

  const userId = await getUserId(ctx);
  const membership = await store.getMembership(userId, noteId);
  if (!membership) {
    await ctx.answerCallbackQuery({
      text: "You don't have access to this note.",
      show_alert: true,
    });
    return;
  }

  const members = await store.getNoteMembers(noteId);
  const isOwner = note.owner_id === userId;

  const rows: InlineButton[][] = [];

  for (const m of members) {
    const label = m.user_id === note.owner_id
      ? `👑 User ${m.user_id} (owner)`
      : `👤 User ${m.user_id}`;
    const row: InlineButton[] = [inlineButton(label, "noop")];
    if (isOwner && m.user_id !== note.owner_id) {
      row.push(
        inlineButton("❌ Remove", `note:revoke:${noteId}:${m.user_id}`),
      );
    }
    rows.push(row);
  }

  rows.push([inlineButton("⬅️ Back to note", `note:view:${noteId}`)]);

  await ctx.editMessageText(`Members of "${note.title}":`, {
    reply_markup: inlineKeyboard(rows),
  });
});

composer.callbackQuery(/^note:revoke:([^:]+):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const noteId = ctx.match[1]!;
  const targetUserId = parseInt(ctx.match[2]!, 10);
  const store = getStore();
  const note = await store.getNote(noteId);
  if (!note) {
    await ctx.editMessageText("Note not found.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Menu", "menu:main")]]),
    });
    return;
  }

  const userId = await getUserId(ctx);
  if (note.owner_id !== userId) {
    await ctx.answerCallbackQuery({
      text: "Only the owner can revoke access.",
      show_alert: true,
    });
    return;
  }

  await ctx.editMessageText(
    `Remove user ${targetUserId} from "${note.title}"?`,
    {
      reply_markup: inlineKeyboard([
        [
          inlineButton("✅ Yes, remove", `note:revoke:confirm:${noteId}:${targetUserId}`),
          inlineButton("❌ Cancel", `note:members:${noteId}`),
        ],
      ]),
    },
  );
});

composer.callbackQuery(/^note:revoke:confirm:([^:]+):(\d+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const noteId = ctx.match[1]!;
  const targetUserId = parseInt(ctx.match[2]!, 10);
  const store = getStore();
  const note = await store.getNote(noteId);
  if (!note) {
    await ctx.editMessageText("Note not found.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Menu", "menu:main")]]),
    });
    return;
  }

  const userId = await getUserId(ctx);
  if (note.owner_id !== userId) {
    await ctx.editMessageText("Only the owner can revoke access.", {
      reply_markup: backToNoteButton(noteId),
    });
    return;
  }

  await store.removeMembership(targetUserId, noteId);
  await ctx.editMessageText(`User ${targetUserId} removed from "${note.title}".`, {
    reply_markup: inlineKeyboard([
      [inlineButton("👥 Back to members", `note:members:${noteId}`)],
      [inlineButton("⬅️ Back to note", `note:view:${noteId}`)],
    ]),
  });

  await notifyUser(
    ctx,
    targetUserId,
    `Your access to note "${note.title}" has been revoked.`,
  );
});

export default composer;