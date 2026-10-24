/**
 * GM relay for players who lack the core "Create New Actors" permission. The player's client sends
 * the finished actor data; the active GM's client creates it and grants the player ownership.
 */
import { SOCKET } from "../constants.mjs";
import { setting, t } from "../utils.mjs";

const waiting = new Map();
const TIMEOUT = 30_000;

export function registerSocket() {
  game.socket.on(SOCKET, onMessage);
}

function sanitize(data, userId) {
  const clean = foundry.utils.deepClone(data);
  delete clean._id;
  delete clean.folder;
  delete clean.sort;
  clean.type = "character";
  clean.ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE, [userId]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER };
  return clean;
}

export function targetFolder() {
  const name = setting("actorFolder");
  if ( !name ) return null;
  return game.folders.find(f => (f.type === "Actor") && (f.name === name))?.id ?? null;
}

async function onMessage(message, senderId) {
  if ( !message?.action ) return;

  if ( message.action === "create" ) {
    if ( game.user !== game.users.activeGM ) return;
    const userId = senderId ?? message.userId;
    const user = game.users.get(userId);
    const reply = payload => game.socket.emit(SOCKET, { action: "created", requestId: message.requestId, userId, ...payload });
    if ( !user || user.isGM ) return;
    if ( !setting("playerCreation") ) return reply({ error: t("Errors.RelayDisabled") });
    try {
      const data = sanitize(message.data, userId);
      data.folder = targetFolder();
      const actor = await Actor.implementation.create(data, { keepEmbeddedIds: true });
      ui.notifications.info(t("Notifications.RelayCreated", { user: user.name, name: actor.name }));
      reply({ actorId: actor.id });
    } catch(err) {
      console.error(err);
      reply({ error: err.message });
    }
    return;
  }

  if ( (message.action === "created") && (message.userId === game.user.id) ) {
    const pending = waiting.get(message.requestId);
    if ( !pending ) return;
    waiting.delete(message.requestId);
    clearTimeout(pending.timer);
    if ( message.error ) pending.reject(new Error(message.error));
    else pending.resolve(message.actorId);
  }
}

/** Wait (briefly) for a document the GM just created to replicate to this client. */
async function awaitActor(id) {
  for ( let i = 0; i < 40; i++ ) {
    const actor = game.actors.get(id);
    if ( actor ) return actor;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return game.actors.get(id) ?? null;
}

/**
 * Ask the active GM to create a character for this user.
 * @returns {Promise<Actor>}
 */
export async function requestCreation(data) {
  if ( !game.users.activeGM ) throw new Error(t("Errors.NoGM"));
  const requestId = foundry.utils.randomID();
  const actorId = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.delete(requestId);
      reject(new Error(t("Errors.RelayTimeout")));
    }, TIMEOUT);
    waiting.set(requestId, { resolve, reject, timer });
    game.socket.emit(SOCKET, { action: "create", requestId, userId: game.user.id, data });
  });
  return awaitActor(actorId);
}
