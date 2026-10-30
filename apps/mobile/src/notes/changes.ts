// "The notes changed": every Notes screen reads the core again when it
// hears this, so a change on one (a new note, a moved folder, an undo)
// shows on the screens under it. Kept free of React Native.

const listeners = new Set<() => void>();

export function onNotesChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notesChanged() {
  for (const listener of [...listeners]) listener();
}
