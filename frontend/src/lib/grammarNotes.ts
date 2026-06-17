const STORAGE_KEY = "jp-grammar-personal-notes-v1";

type NoteMap = Record<string, string>;

const readNotes = (): NoteMap => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as NoteMap : {};
  } catch {
    return {};
  }
};

const writeNotes = (notes: NoteMap) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
};

export const getGrammarNote = (grammarId: string) => readNotes()[grammarId] ?? "";

export const setGrammarNote = (grammarId: string, note: string) => {
  const notes = readNotes();
  const trimmed = note.trim();
  if (trimmed) {
    notes[grammarId] = trimmed;
  } else {
    delete notes[grammarId];
  }
  writeNotes(notes);
  return trimmed;
};
