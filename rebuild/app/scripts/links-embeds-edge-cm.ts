// Re-export CodeMirror through Vite's module graph. A direct
// ssrLoadModule("@codemirror/state") is a second copy, and EditorState.create
// then rejects markdownSyntax.
export { EditorState } from "@codemirror/state";
export { ensureSyntaxTree } from "@codemirror/language";
