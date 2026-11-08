import { config } from "./config";
import { sgc, runStream, type Message } from "./sgc";
import { initOrbit, createFeedbackTask } from "./orbit";

const QUESTION = "Vuoi inviare questo feedback? Rispondi si/no";
const SENT = "Grazie! Il tuo feedback è stato inviato ✅";
const CANCELLED = "Ok, feedback non inviato. Scrivimi di nuovo quando vuoi.";
const ASK_AGAIN = "Non ho capito. Vuoi inviare questo feedback? Rispondi si/no";
const FAILED = "Si è verificato un errore durante l'invio del feedback. Riprova più tardi.";

// ---------- state (survives restarts) ----------

interface Pending { messageId: number; content: string; images: string[]; createdAt: string }
interface State { lastMessageId: number; pending: Record<string, Pending> }

let state: State = { lastMessageId: 0, pending: {} };

async function loadState(): Promise<boolean> {
  const file = Bun.file(config.stateFile);
  if (!(await file.exists())) return false;
  state = { lastMessageId: 0, pending: {}, ...(await file.json()) };
  return true;
}

async function saveState() {
  await Bun.write(config.stateFile, JSON.stringify(state, null, 2));
}

// ---------- answer parsing (case insensitive) ----------

function parseAnswer(text: string): "yes" | "no" | null {
  const word = text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // "Sì" -> "si"
    .replace(/[^\p{L}]+/gu, ""); // drop punctuation, spaces, emoji: "SI!" -> "si"
  if (word === "si") return "yes";
  if (word === "no") return "no";
  return null;
}

// ---------- message handling ----------

let botUsername = "";

async function handle(msg: Message) {
  if (msg.id <= state.lastMessageId) return; // already handled
  state.lastMessageId = msg.id;

  if (msg.sender.toLowerCase() === botUsername) return void (await saveState());

  const user = msg.sender;
  const pending = state.pending[user];

  try {
    if (pending) {
      const answer = parseAnswer(msg.content);
      if (answer === "yes") {
        const task = await sendToOrbit(user, pending);
        delete state.pending[user];
        await sgc.send(user, SENT, pending.messageId);
        console.log(`[bot] @${user}: feedback sent -> ${task.identifier ?? task.id}`);
      } else if (answer === "no") {
        delete state.pending[user];
        await sgc.send(user, CANCELLED);
        console.log(`[bot] @${user}: feedback cancelled`);
      } else {
        await sgc.send(user, ASK_AGAIN, pending.messageId);
      }
    } else {
      // A new DM: hold it and ask for confirmation.
      state.pending[user] = {
        messageId: msg.id,
        content: msg.content,
        images: msg.images ?? [],
        createdAt: msg.created_at,
      };
      await sgc.send(user, QUESTION, msg.id);
      console.log(`[bot] @${user}: asked for confirmation on message ${msg.id}`);
    }
    await sgc.markRead(user).catch(() => {});
  } catch (err) {
    console.error(`[bot] error handling message ${msg.id} from @${user}:`, err);
    if (pending && parseAnswer(msg.content) === "yes") {
      await sgc.send(user, FAILED).catch(() => {});
    }
  } finally {
    await saveState();
  }
}

function sendToOrbit(user: string, fb: Pending) {
  const firstLine = fb.content.trim().split("\n")[0] || "(solo immagini)";
  const title = `Feedback da @${user}: ${firstLine}`.slice(0, 200);
  const images = fb.images.map((p) => `![](${new URL(p, config.sgcUrl).href})`).join("\n");
  const description = [
    `**Da:** [@${user}](${config.sgcUrl}/@${user})`,
    `**Inviato:** ${fb.createdAt}`,
    "",
    fb.content.trim() || "_(nessun testo)_",
    images && `\n${images}`,
  ]
    .filter((l) => l !== "")
    .join("\n");
  return createFeedbackTask(title, description);
}

// Handle messages one at a time, in order, whether from the stream or a catch-up.
let queue = Promise.resolve();
const enqueue = (msg: Message) => (queue = queue.then(() => handle(msg)).catch(console.error));

async function catchUp() {
  for (;;) {
    const batch = await sgc.received(state.lastMessageId, 100);
    for (const m of batch) enqueue(m);
    await queue;
    if (batch.length < 100) break;
  }
}

// ---------- main ----------

const me = await sgc.me();
botUsername = me.username.toLowerCase();
if (me.muted) console.warn(`[sgc] warning: bot is muted (${me.mute_reason ?? "no reason"})`);
console.log(`[sgc] signed in as @${me.username}`);

await initOrbit();

if (!(await loadState())) {
  // First run: don't answer DMs that arrived before the bot existed.
  const recent = await sgc.received(undefined, 100);
  state.lastMessageId = recent.reduce((max, m) => Math.max(max, m.id), 0);
  await saveState();
}

await runStream({
  onReady: () => catchUp().catch((e) => console.error("[bot] catch-up failed:", e)),
  onMessage: (msg) => void enqueue(msg),
});
