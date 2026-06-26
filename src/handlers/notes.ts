import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  registerMainMenuItem,
  inlineButton,
  inlineKeyboard,
  type InlineKeyboardMarkup,
  type InlineButton,
} from "../toolkit/index.js";
import { getStore } from "../store.js";

registerMainMenuItem({ label: "📝 Create note", data: "note:create:start", order: 10 });
registerMainMenuItem({ label: "📋 My notes", data: "note:list", order: 20 });

function noteViewKeyboard(noteId: string, isOwner = false): InlineKeyboardMarkup {
  const row2: InlineButton[] = [
    inlineButton("📜 History", `note:history:${noteId}`),
  ];
  if (isOwner) {
    row2.push(inlineButton("➕ Invite", `note:invite:${noteId}`));
  }
  const row3: InlineButton[] = [];
  if (isOwner) {
    row3.push(inlineButton("🗑️ Delete", `note:delete:${noteId}`));
  }
  row3.push(inlineButton("⬅️ Menu", "menu:main"));
  return inlineKeyboard([
    [
      inlineButton("✏️ Edit", `note:edit:${noteId}`),
      inlineButton("👥 Members", `note:members:${noteId}`),
    ],
    row2,
    row3,
  ]);
}

function backToNoteButton(noteId: string) {
  return inlineKeyboard([[inlineButton("⬅️ Back to note", `note:view:${noteId}`)]]);
}

function backToNotesButton() {
  return inlineKeyboard([[inlineButton("⬅️ Back to notes", "note:list")]]);
}

async function getUserId(ctx: Ctx): Promise<number> {
  const id = ctx.from?.id ?? ctx.callbackQuery?.from.id;
  if (!id) throw new Error("Cannot determine user ID");
  return id;
}

const composer = new Composer<Ctx>();

composer.command("new", async (ctx) => {
  ctx.session.creatingNote = { step: "awaiting_title" };
  await ctx.reply("Send the title for your new note:", { reply_markup: { force_reply: true } });
});

composer.command("list", async (ctx) => {
  const store = getStore();
  const userId = await getUserId(ctx);
  const notes = await store.listNotesByUser(userId);
  if (notes.length === 0) {
    await ctx.reply("No notes yet — tap 📝 Create note to add one.", {
      reply_markup: inlineKeyboard([[inlineButton("⬅️ Menu", "menu:main")]]),
    });
    return;
  }
  const rows = notes.map((n) => [
    inlineButton(`📄 ${n.title}`, `note:view:${n.id}`),
  ]);
  await ctx.reply("Your notes:", {
    reply_markup: inlineKeyboard([...rows, [inlineButton("⬅️ Menu", "menu:main")]]),
  });
});

composer.callbackQuery("note:list", async (ctx) => {
  await ctx.answerCallbackQuery();
  const store = getStore();
  const userId = await getUserId(ctx);
  const notes = await store.listNotesByUser(userId);
  if (notes.length === 0) {
    await ctx.editMessageText(
      "No notes yet — tap 📝 Create note to add one.",
      { reply_markup: inlineKeyboard([[inlineButton("⬅️ Menu", "menu:main")]]) },
    );
    return;
  }
  const rows = notes.map((n) => [
    inlineButton(`📄 ${n.title}`, `note:view:${n.id}`),
  ]);
  await ctx.editMessageText("Your notes:", {
    reply_markup: inlineKeyboard([...rows, [inlineButton("⬅️ Menu", "menu:main")]]),
  });
});

composer.callbackQuery("note:create:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.creatingNote = { step: "awaiting_title" };
  await ctx.reply("Send the title for your new note:", { reply_markup: { force_reply: true } });
});

composer.on("message:text", async (ctx, next) => {
  const session = ctx.session;

  if (session.creatingNote?.step === "awaiting_title") {
    const title = ctx.message.text.trim();
    if (!title) {
      await ctx.reply("Title cannot be empty. Please send a title:");
      return;
    }
    session.creatingNote = { step: "awaiting_body", title };
    await ctx.reply("Now send the body of the note:", { reply_markup: { force_reply: true } });
    return;
  }

  if (session.creatingNote?.step === "awaiting_body") {
    const body = ctx.message.text.trim();
    const title = session.creatingNote.title ?? "Untitled";
    session.creatingNote = undefined;
    const store = getStore();
    const userId = await getUserId(ctx);
    const note = await store.createNote(userId, title, body);
    await ctx.reply(`📄 ${note.title}\n\n${note.body}`, {
      reply_markup: noteViewKeyboard(note.id, true),
    });
    return;
  }

  if (session.editingNote?.step === "awaiting_title") {
    const title = ctx.message.text.trim();
    if (!title) {
      await ctx.reply("Title cannot be empty. Please send a title:");
      return;
    }
    const newTitle = title === "." ? undefined : title;
    session.editingNote = {
      noteId: session.editingNote.noteId,
      step: "awaiting_body",
      newTitle,
    };
    const store = getStore();
    const note = await store.getNote(session.editingNote.noteId);
    if (!note) {
      session.editingNote = undefined;
      await ctx.reply("Note no longer exists.");
      return;
    }
    await ctx.reply(
      `Current body:\n${note.body}\n\nSend the new body:`,
      { reply_markup: { force_reply: true } },
    );
    return;
  }

  if (session.editingNote?.step === "awaiting_body") {
    const body = ctx.message.text.trim();
    const noteId = session.editingNote.noteId;
    const newTitle = session.editingNote.newTitle;
    session.editingNote = undefined;
    const store = getStore();
    const userId = await getUserId(ctx);
    const note = await store.getNote(noteId);
    if (!note) {
      await ctx.reply("Note no longer exists.");
      return;
    }
    const title = newTitle ?? note.title;
    const updated = await store.updateNote(noteId, title, body, userId);
    if (!updated) {
      await ctx.reply("Note no longer exists.");
      return;
    }
    const allMembers = await store.getNoteMembers(noteId);
    for (const member of allMembers) {
      if (member.user_id !== userId) {
        try {
          await ctx.api.sendMessage(
            member.user_id,
            `Note "${updated.title}" was edited.`,
            {
              reply_markup: inlineKeyboard([
                [inlineButton("📄 Open note", `note:view:${noteId}`)],
              ]),
            },
          );
        } catch {
          // Non-fatal
        }
      }
    }
    const memberships = await store.getMembershipsByUser(userId);
    if (memberships.some((m) => m.note_id === noteId)) {
      await ctx.reply(`📄 ${updated.title}\n\n${updated.body}`, {
        reply_markup: noteViewKeyboard(noteId, updated.owner_id === userId),
      });
    }
    return;
  }

  return next();
});

composer.callbackQuery(/^note:view:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const noteId = ctx.match[1]!;
  const store = getStore();
  const note = await store.getNote(noteId);
  if (!note) {
    await ctx.editMessageText("Note not found.", {
      reply_markup: backToNotesButton(),
    });
    return;
  }
  const userId = await getUserId(ctx);
  const membership = await store.getMembership(userId, noteId);
  if (!membership) {
    await ctx.editMessageText("You don't have access to this note.", {
      reply_markup: backToNotesButton(),
    });
    return;
  }
  await ctx.editMessageText(`📄 ${note.title}\n\n${note.body}`, {
    reply_markup: noteViewKeyboard(note.id, note.owner_id === userId),
  });
});

composer.callbackQuery(/^note:edit:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const noteId = ctx.match[1]!;
  const store = getStore();
  const note = await store.getNote(noteId);
  if (!note) {
    await ctx.editMessageText("Note not found.", {
      reply_markup: backToNotesButton(),
    });
    return;
  }
  const userId = await getUserId(ctx);
  const membership = await store.getMembership(userId, noteId);
  if (!membership) {
    await ctx.answerCallbackQuery({ text: "You don't have access to this note.", show_alert: true });
    return;
  }
  ctx.session.editingNote = { noteId, step: "awaiting_title" };
  await ctx.editMessageText(
    `Editing "${note.title}"\n\nCurrent title: ${note.title}\n\nSend new title (or send "." to keep):`,
  );
});

composer.callbackQuery(/^note:delete:confirm:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const noteId = ctx.match[1]!;
  const store = getStore();
  const note = await store.getNote(noteId);
  if (!note) {
    await ctx.editMessageText("Note not found.", {
      reply_markup: backToNotesButton(),
    });
    return;
  }
  const userId = await getUserId(ctx);
  if (note.owner_id !== userId) {
    await ctx.editMessageText("Only the owner can delete this note.", {
      reply_markup: backToNotesButton(),
    });
    return;
  }
  const allMembers = await store.getNoteMembers(noteId);
  await store.deleteNote(noteId);
  for (const member of allMembers) {
    if (member.user_id !== userId) {
      try {
        await ctx.api.sendMessage(
          member.user_id,
          `Note "${note.title}" has been deleted by its owner.`,
        );
      } catch {
        // Non-fatal
      }
    }
  }
  await ctx.editMessageText(`"${note.title}" deleted.`, {
    reply_markup: backToNotesButton(),
  });
});

composer.callbackQuery(/^note:delete:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const noteId = ctx.match[1]!;
  const store = getStore();
  const note = await store.getNote(noteId);
  if (!note) {
    await ctx.editMessageText("Note not found.", {
      reply_markup: backToNotesButton(),
    });
    return;
  }
  const userId = await getUserId(ctx);
  if (note.owner_id !== userId) {
    await ctx.answerCallbackQuery({
      text: "Only the owner can delete this note.",
      show_alert: true,
    });
    return;
  }
  await ctx.editMessageText(`Delete "${note.title}"? This cannot be undone.`, {
    reply_markup: inlineKeyboard([
      [
        inlineButton("✅ Yes, delete", `note:delete:confirm:${noteId}`),
        inlineButton("❌ Cancel", `note:view:${noteId}`),
      ],
    ]),
  });
});

composer.callbackQuery(/^note:history:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const noteId = ctx.match[1]!;
  const store = getStore();
  const note = await store.getNote(noteId);
  if (!note) {
    await ctx.editMessageText("Note not found.", {
      reply_markup: backToNotesButton(),
    });
    return;
  }
  const userId = await getUserId(ctx);
  const membership = await store.getMembership(userId, noteId);
  if (!membership) {
    await ctx.answerCallbackQuery({ text: "You don't have access to this note.", show_alert: true });
    return;
  }
  const edits = await store.getEdits(noteId);
  if (edits.length === 0) {
    await ctx.editMessageText("No edit history for this note.", {
      reply_markup: backToNoteButton(noteId),
    });
    return;
  }
  const lines = edits.map(
    (e, i) => `${i + 1}. ${new Date(e.timestamp).toLocaleString()} — ${e.diff_summary}`,
  );
  const text = `Edit history for "${note.title}":\n\n${lines.join("\n")}`;
  const rows = edits.map((e, i) => [
    inlineButton(`↩ Revert #${i + 1}`, `note:revert:${noteId}:${e.id}`),
  ]);
  rows.push([inlineButton("⬅️ Back to note", `note:view:${noteId}`)]);
  await ctx.editMessageText(text, {
    reply_markup: inlineKeyboard(rows),
  });
});

composer.callbackQuery(/^note:revert:confirm:([^:]+):(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const noteId = ctx.match[1]!;
  const editId = ctx.match[2]!;
  const store = getStore();
  const note = await store.getNote(noteId);
  if (!note) {
    await ctx.editMessageText("Note not found.", {
      reply_markup: backToNotesButton(),
    });
    return;
  }
  const userId = await getUserId(ctx);
  const membership = await store.getMembership(userId, noteId);
  if (!membership) {
    await ctx.editMessageText("You don't have access to this note.", {
      reply_markup: backToNotesButton(),
    });
    return;
  }
  const reverted = await store.revertToEdit(noteId, editId);
  if (!reverted) {
    await ctx.editMessageText("Could not revert — revision not found.", {
      reply_markup: backToNoteButton(noteId),
    });
    return;
  }
  const allMembers = await store.getNoteMembers(noteId);
  for (const member of allMembers) {
    if (member.user_id !== userId) {
      try {
        await ctx.api.sendMessage(
          member.user_id,
          `Note "${reverted.title}" was reverted to an earlier version.`,
          {
            reply_markup: inlineKeyboard([
              [inlineButton("📄 Open note", `note:view:${noteId}`)],
            ]),
          },
        );
      } catch {
        // Non-fatal
      }
    }
  }
  await store.addEdit(noteId, userId, "Reverted to earlier version", reverted.title, reverted.body);
  await ctx.editMessageText(
    `Reverted "${reverted.title}" to an earlier version.`,
    {
      reply_markup: noteViewKeyboard(noteId, note.owner_id === userId),
    },
  );
});

composer.callbackQuery(/^note:revert:(\d+):(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const noteId = ctx.match[1]!;
  const editId = ctx.match[2]!;
  const store = getStore();
  const note = await store.getNote(noteId);
  if (!note) {
    await ctx.editMessageText("Note not found.", {
      reply_markup: backToNotesButton(),
    });
    return;
  }
  const userId = await getUserId(ctx);
  const membership = await store.getMembership(userId, noteId);
  if (!membership) {
    await ctx.editMessageText("You don't have access to this note.", {
      reply_markup: backToNotesButton(),
    });
    return;
  }
  const edits = await store.getEdits(noteId);
  const targetEdit = edits.find((e) => e.id === editId);
  if (!targetEdit) {
    await ctx.editMessageText("Edit revision not found.", {
      reply_markup: backToNoteButton(noteId),
    });
    return;
  }
  await ctx.editMessageText(
    `Revert "${note.title}" to version from ${new Date(targetEdit.timestamp).toLocaleString()}?`,
    {
      reply_markup: inlineKeyboard([
        [
          inlineButton("✅ Yes, revert", `note:revert:confirm:${noteId}:${editId}`),
          inlineButton("❌ Cancel", `note:history:${noteId}`),
        ],
      ]),
    },
  );
});

export default composer;