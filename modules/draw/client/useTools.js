// The drawer's tool, kept on the client: nothing here is ever sent, only the strokes it makes are.
// Depends on: vue and shared/drawing.js (the brush sizes the server will accept).
import { reactive } from 'vue';
import { BRUSH } from '../../../shared/drawing.js';

/** The three brush sizes, with the word each is called by and how big its dot looks in the toolbox. */
export const WIDTHS = [
  { width: BRUSH.min, label: 'table.thin', dot: 6 },
  { width: Math.round((BRUSH.min + BRUSH.max) / 2), label: 'table.medium', dot: 11 },
  { width: BRUSH.max, label: 'table.thick', dot: 16 },
];

/**
 * The tool this player is drawing with: which kind, which colour of the palette, and how wide.
 * @returns {{ kind: string, colour: number, width: number }} changed in place by the toolbox
 * Side effects: none.
 */
export const newTool = () => reactive({ kind: 'pen', colour: 13, width: WIDTHS[0].width });
