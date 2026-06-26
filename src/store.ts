import { createRequire } from "node:module";

export interface Note {
  id: string;
  title: string;
  body: string;
  owner_id: number;
  created_at: number;
  updated_at: number;
}

export interface Membership {
  user_id: number;
  note_id: string;
  role: "owner" | "editor";
}

export interface Edit {
  id: string;
  note_id: string;
  author_id: number;
  timestamp: number;
  title: string;
  body: string;
}

export interface Invitation {
  id: string;
  note_id: string;
  owner_id: number;
  invited_user_id: number;
  invited_username: string;
  note_title: string;
}

const MAX_EDITS = 20;

interface Backend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
  incr(key: string): Promise<number>;
}

class MemoryBackend implements Backend {
  private store = new Map<string, string>();
  private counters = new Map<string, number>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async incr(key: string): Promise<number> {
    const v = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, v);
    return v;
  }
}

const REDIS_KEY_PREFIX = "cnm:";

function resolveBackend(): Backend {
  if (process.env.REDIS_URL) {
    const require = createRequire(import.meta.url);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ioredis: any = require("ioredis");
    const Redis = ioredis.default ?? ioredis.Redis ?? ioredis;
    const client = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      lazyConnect: false,
    });
    return {
      async get(key: string) {
        return client.get(`${REDIS_KEY_PREFIX}${key}`) as Promise<string | null>;
      },
      async set(key: string, value: string) {
        await client.set(`${REDIS_KEY_PREFIX}${key}`, value);
      },
      async del(key: string) {
        await client.del(`${REDIS_KEY_PREFIX}${key}`);
      },
      async incr(key: string) {
        return (await client.incr(`${REDIS_KEY_PREFIX}${key}`)) as number;
      },
    };
  }
  return new MemoryBackend();
}

export class PersistentStore {
  private backend: Backend;

  constructor(backend?: Backend) {
    this.backend = backend ?? resolveBackend();
  }

  private noteKey(id: string): string {
    return `note:${id}`;
  }

  private membershipKey(userId: number, noteId: string): string {
    return `mem:${userId}:${noteId}`;
  }

  private userNotesKey(userId: number): string {
    return `unotes:${userId}`;
  }

  private noteMembersKey(noteId: string): string {
    return `nmembers:${noteId}`;
  }

  private editsKey(noteId: string): string {
    return `edits:${noteId}`;
  }

  private inviteKey(id: string): string {
    return `invite:${id}`;
  }

  private async getJsonArray(key: string): Promise<string[]> {
    const raw = await this.backend.get(key);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as string[];
    } catch {
      return [];
    }
  }

  private async setJsonArray(key: string, arr: string[]): Promise<void> {
    await this.backend.set(key, JSON.stringify(arr));
  }

  private async addToJsonSet(key: string, value: string): Promise<void> {
    const arr = await this.getJsonArray(key);
    if (!arr.includes(value)) {
      arr.push(value);
      await this.setJsonArray(key, arr);
    }
  }

  private async removeFromJsonSet(key: string, value: string): Promise<void> {
    const arr = await this.getJsonArray(key);
    const filtered = arr.filter((v) => v !== value);
    await this.setJsonArray(key, filtered);
  }

  async createNote(
    ownerId: number,
    title: string,
    body: string,
  ): Promise<Note> {
    const id = String(await this.backend.incr("note:id"));
    const now = Date.now();
    const note: Note = {
      id,
      title,
      body,
      owner_id: ownerId,
      created_at: now,
      updated_at: now,
    };
    await this.backend.set(this.noteKey(id), JSON.stringify(note));
    await this.addMembership(ownerId, id, "owner");
    return note;
  }

  async getNote(id: string): Promise<Note | null> {
    const raw = await this.backend.get(this.noteKey(id));
    if (!raw) return null;
    return JSON.parse(raw) as Note;
  }

  async updateNote(
    id: string,
    title: string,
    body: string,
    editorId: number,
  ): Promise<Note | null> {
    const note = await this.getNote(id);
    if (!note) return null;
    const now = Date.now();
    note.title = title;
    note.body = body;
    note.updated_at = now;
    await this.backend.set(this.noteKey(id), JSON.stringify(note));
    await this.addEdit(id, editorId, title, body);
    return note;
  }

  async deleteNote(id: string): Promise<void> {
    const members = await this.getNoteMemberIds(id);
    for (const userId of members) {
      await this.removeMembership(parseInt(userId, 10), id);
    }
    await this.backend.del(this.noteKey(id));
    await this.backend.del(this.noteMembersKey(id));
  }

  async listNotesByUser(userId: number): Promise<Note[]> {
    const noteIds = await this.getJsonArray(this.userNotesKey(userId));
    const notes: Note[] = [];
    for (const nid of noteIds) {
      const note = await this.getNote(nid);
      if (note) notes.push(note);
    }
    notes.sort((a, b) => b.updated_at - a.updated_at);
    return notes;
  }

  async addMembership(
    userId: number,
    noteId: string,
    role: "owner" | "editor",
  ): Promise<Membership> {
    const m: Membership = { user_id: userId, note_id: noteId, role };
    await this.backend.set(
      this.membershipKey(userId, noteId),
      JSON.stringify(m),
    );
    await this.addToJsonSet(this.userNotesKey(userId), noteId);
    await this.addToJsonSet(this.noteMembersKey(noteId), String(userId));
    return m;
  }

  async removeMembership(userId: number, noteId: string): Promise<void> {
    await this.backend.del(this.membershipKey(userId, noteId));
    await this.removeFromJsonSet(this.userNotesKey(userId), noteId);
    await this.removeFromJsonSet(this.noteMembersKey(noteId), String(userId));
  }

  async getMembership(
    userId: number,
    noteId: string,
  ): Promise<Membership | null> {
    const raw = await this.backend.get(this.membershipKey(userId, noteId));
    if (!raw) return null;
    return JSON.parse(raw) as Membership;
  }

  async getMembershipsByUser(userId: number): Promise<Membership[]> {
    const noteIds = await this.getJsonArray(this.userNotesKey(userId));
    const out: Membership[] = [];
    for (const nid of noteIds) {
      const m = await this.getMembership(userId, nid);
      if (m) out.push(m);
    }
    return out;
  }

  async getNoteMemberIds(noteId: string): Promise<string[]> {
    return this.getJsonArray(this.noteMembersKey(noteId));
  }

  async getNoteMembers(noteId: string): Promise<Membership[]> {
    const ids = await this.getNoteMemberIds(noteId);
    const out: Membership[] = [];
    for (const uid of ids) {
      const m = await this.getMembership(parseInt(uid, 10), noteId);
      if (m) out.push(m);
    }
    return out;
  }

  async addEdit(
    noteId: string,
    authorId: number,
    title: string,
    body: string,
  ): Promise<Edit> {
    const id = String(await this.backend.incr("edit:id"));
    const edit: Edit = {
      id,
      note_id: noteId,
      author_id: authorId,
      timestamp: Date.now(),
      title,
      body,
    };
    const raw = await this.backend.get(this.editsKey(noteId));
    const edits: Edit[] = raw ? JSON.parse(raw) : [];
    edits.push(edit);
    while (edits.length > MAX_EDITS) {
      edits.shift();
    }
    await this.backend.set(this.editsKey(noteId), JSON.stringify(edits));
    return edit;
  }

  async getEdits(noteId: string): Promise<Edit[]> {
    const raw = await this.backend.get(this.editsKey(noteId));
    if (!raw) return [];
    return JSON.parse(raw) as Edit[];
  }

  async deleteEdits(noteId: string): Promise<void> {
    await this.backend.del(this.editsKey(noteId));
  }

  async createInvitation(inv: Omit<Invitation, "id">): Promise<Invitation> {
    const id = String(await this.backend.incr("invite:id"));
    const invitation: Invitation = { ...inv, id };
    await this.backend.set(this.inviteKey(id), JSON.stringify(invitation));
    return invitation;
  }

  async getInvitation(id: string): Promise<Invitation | null> {
    const raw = await this.backend.get(this.inviteKey(id));
    if (!raw) return null;
    return JSON.parse(raw) as Invitation;
  }

  async deleteInvitation(id: string): Promise<void> {
    await this.backend.del(this.inviteKey(id));
  }
}

let _store: PersistentStore | null = null;

export function getStore(): PersistentStore {
  if (!_store) _store = new PersistentStore();
  return _store;
}

export function resetStore(): void {
  _store = new PersistentStore(new MemoryBackend());
}