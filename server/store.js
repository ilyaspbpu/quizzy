import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.join(__dirname, 'data.json');

const initialData = {
  users: [],
  quizzes: [],
  sessions: []
};

let state = structuredClone(initialData);
let writeQueue = Promise.resolve();

export async function loadStore() {
  try {
    const raw = await fs.readFile(dataPath, 'utf8');
    state = { ...structuredClone(initialData), ...JSON.parse(raw) };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await persist();
  }
  return state;
}

export function getState() {
  return state;
}

export async function persist() {
  const serialized = JSON.stringify(state, null, 2);
  writeQueue = writeQueue.then(() => fs.writeFile(dataPath, serialized, 'utf8'));
  await writeQueue;
}

export async function mutate(mutator) {
  const result = mutator(state);
  await persist();
  return result;
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt
  };
}
