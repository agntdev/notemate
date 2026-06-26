import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { mainMenuKeyboard, inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { getStore } from "../store.js";

const WELCOME = "👋 Welcome! Tap a button below to get started.";

async function showPendingInvitations(ctx: Ctx): Promise<boolean> {
  const username = ctx.from?.username;
  if (!username) return false;
  const store = getStore();
  const invites = await store.findInvitationsByInvitedUsername(username);
  if (invites.length === 0) return false;

  const buttons = invites.map((inv) => [
    inlineButton(
      `📩 "${inv.note_title}" — by User ${inv.owner_id}`,
      "noop",
    ),
    inlineButton("✅ Accept", `invite:accept:${inv.id}`),
    inlineButton("❌ Decline", `invite:decline:${inv.id}`),
  ]);

  await ctx.reply(
    "You have pending note invitations:",
    { reply_markup: inlineKeyboard(buttons) },
  );
  return true;
}

// The /start handler renders the bot's MAIN MENU — the primary way users operate
// a button-first bot. A feature adds its own button by calling
// `registerMainMenuItem(...)` in its own `src/handlers/<slug>.ts`; this handler
// renders whatever is registered (plus a Help button), so you do NOT edit this
// file to add a feature. Send ONE message — no placeholder line above the menu.
const composer = new Composer<Ctx>();

composer.command("start", async (ctx) => {
  const uid = ctx.from?.id;
  const username = ctx.from?.username;
  if (uid && username) {
    await getStore().setUserByUsername(username, uid);
  }
  await showPendingInvitations(ctx);
  await ctx.reply(WELCOME, { reply_markup: mainMenuKeyboard() });
});

// "Back to menu" — re-render the main menu in place from any sub-view.
composer.callbackQuery("menu:main", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(WELCOME, { reply_markup: mainMenuKeyboard() });
});

export default composer;
