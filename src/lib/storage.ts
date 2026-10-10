/**
 * Local persistence. Conversations live in IndexedDB; small preferences live in
 * localStorage. Nothing here ever leaves the device, and everything degrades to
 * memory when storage is blocked (private windows, locked-down browsers)
 * instead of throwing.
 */

import { clear, createStore, del, get, set } from 'idb-keyval';
import type { ChatMessage } from '../types';

const INDEX_KEY = 'index';
const conversationKey = (id: string) => `conv:${id}`;

const idbStore = createStore('chatbot', 'v1');
const memory = new Map<string, unknown>();
let idbBroken = false;

async function read<T>(key: string): Promise<T | undefined> {
  if (!idbBroken) {
    try {
      return (await get<T>(key, idbStore)) ?? (memory.get(key) as T | undefined);
    } catch {
      idbBroken = true;
    }
  }
  return memory.get(key) as T | undefined;
}

async function write(key: string, value: unknown): Promise<void> {
  memory.set(key, value);
  if (idbBroken) return;
  try {
    await set(key, value, idbStore);
  } catch {
    idbBroken = true;
  }
}

async function remove(key: string): Promise<void> {
  memory.delete(key);
  if (idbBroken) return;
  try {
    await del(key, idbStore);
  } catch {
    idbBroken = true;
  }
}

export const CHAT_SCHEMA_VERSION = 1;

export interface ConversationMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  modelId: string;
  messageCount: number;
}

export interface StoredIndex {
  version: number;
  conversations: ConversationMeta[];
  activeId: string | null;
  updatedAt: number;
}

export interface StoredConversation {
  version: number;
  meta: ConversationMeta;
  messages: ChatMessage[];
}

export async function loadIndex(): Promise<StoredIndex | null> {
  const index = await read<StoredIndex>(INDEX_KEY);
  if (!index || index.version !== CHAT_SCHEMA_VERSION) return null;
  return index;
}

export async function saveIndex(index: StoredIndex): Promise<void> {
  await write(INDEX_KEY, index);
}

export async function loadConversation(id: string): Promise<StoredConversation | null> {
  const record = await read<StoredConversation>(conversationKey(id));
  if (!record || record.version !== CHAT_SCHEMA_VERSION) return null;
  return record;
}

export async function saveConversation(record: StoredConversation): Promise<void> {
  await write(conversationKey(record.meta.id), record);
}

export async function deleteConversationRecord(id: string): Promise<void> {
  await remove(conversationKey(id));
}

export async function clearChatStorage(): Promise<void> {
  memory.clear();
  try {
    await clear(idbStore);
  } catch {
    idbBroken = true;
  }
}

/** True when IndexedDB is usable, so Settings can tell the truth about storage. */
export function storageMode(): 'indexeddb' | 'memory' {
  return idbBroken ? 'memory' : 'indexeddb';
}
