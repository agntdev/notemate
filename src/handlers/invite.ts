import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  inlineButton,
  inlineKeyboard,
  type InlineKeyboardMarkup,
} from "../toolkit/index.js";
import { getStore } from "../store.js";

function backToNoteButton(noteId: string): InlineKeyboardMarkup {
  return inlineKeyboard([[inlineButton("⬅️ Back to note", `note:view:${noteId}`)]]) ;
}

async function getUserId(ctx: Ctx): Promise<number> {
  const id = ctx.from?.id ?? ctx.callbackQuery?.from.id;
  if (!id) throw new Error("Cannot determine user ID");
  return id;
}

async function notifyOwner(ctx: Ctx, ownerId: number, text: string, noteId?: string): Promise<void> {
  try {
    const markup = noteId
      ? inlineKeyboard([[inlineButton("📄 Open note", `note:view:${noteId}`)]])
      : undefined;
    await ctx.api.sendMessage(ownerId, text, { reply_markup: markup });
  } catch {
    // Non-fatal: user may not have started the bot
  }
}

const composer = new Composer<Ctx>();

composer.callbackQuery(/^note:invite:(.+)$/, async (ctx) => {
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
  if (note.owner_id !== userId) {
    await ctx.answerCallbackQuery({
      text: "Only the owner can invite collaborators.",
      show_alert: true,
    });
    return;
  }
  ctx.session.invitingToNote = { noteId };
  await ctx.editMessageText(
    `Inviting to "${note.title}"\n\nSend the @username of the person you want to invite:`,
    { reply_markup: { force_reply: true } as any },
  );
});

composer.on("message:text", async (ctx, next) => {
  const session = ctx.session;
  if (!session.invitingToNote) return next();

  const raw = ctx.message.text.trim();
  const username = raw.startsWith("@") ? raw.slice(1) : raw;
  const noteId = session.invitingToNote.noteId;
  session.invitingToNote = undefined;

  const store = getStore();
  const note = await store.getNote(noteId);
  if (!note) {
    await ctx.reply("Note no longer exists.");
    return;
  }

  const userId = await getUserId(ctx);

  const invitation = await store.createInvitation({
    note_id: noteId,
    owner_id: userId,
    telegram_user_id: 0,
    invited_username: username,
    note_title: note.title,
  });

  await ctx.reply(
    `Invitation created for @${username} on note "${note.title}". They'll see it when they /start the bot.`,
    {
      reply_markup: backToNoteButton(noteId),
    },
  );
});

composer.callbackQuery(/^invite:accept:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const inviteId = ctx.match[1]!;
  const store = getStore();
  const invite = await store.getInvitation(inviteId);
  if (!invite) {
    await ctx.editMessageText("This invitation is no longer valid.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Menu", "menu:main")]]),
    });
    return;
  }

  const note = await store.getNote(invite.note_id);
  if (!note) {
    await store.deleteInvitation(inviteId);
    await ctx.editMessageText("The note has been deleted.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Menu", "menu:main")]]),
    });
    return;
  }

  const userId = await getUserId(ctx);
  const existing = await store.getMembership(userId, invite.note_id);
  if (existing) {
    await ctx.editMessageText("You already have access to this note.", {
      reply_markup: inlineKeyboard([
        [inlineButton("📄 Open note", `note:view:${invite.note_id}`)],
      ]),
    });
    await store.deleteInvitation(inviteId);
    return;
  }

  await store.addMembership(userId, invite.note_id, "editor");
  await store.deleteInvitation(inviteId);

  await ctx.editMessageText(
    `You now have access to "${note.title}".`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("📄 Open note", `note:view:${invite.note_id}`)],
      ]),
    },
  );

  await notifyOwner(
    ctx,
    invite.owner_id,
    `@${invite.invited_username} accepted your invitation to "${note.title}".`,
    invite.note_id,
  );
});

composer.callbackQuery(/^invite:decline:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const inviteId = ctx.match[1]!;
  const store = getStore();
  const invite = await store.getInvitation(inviteId);
  if (!invite) {
    await ctx.editMessageText("This invitation is no longer valid.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Menu", "menu:main")]]),
    });
    return;
  }

  const note = await store.getNote(invite.note_id);
  const noteTitle = note ? note.title : "(deleted)";
  await store.deleteInvitation(inviteId);

  await ctx.editMessageText(`You declined the invitation to "${noteTitle}".`, {
    reply_markup: inlineKeyboard([[inlineButton("⬅️ Menu", "menu:main")]]),
  });

  await notifyOwner(
    ctx,
    invite.owner_id,
    `@${invite.invited_username} declined your invitation to "${noteTitle}".`,
  );
});

export default composer;