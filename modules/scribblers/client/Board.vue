<script setup>
// File: the drawing board.  A canvas of a fixed 1600 x 900, shown at whatever size the table has room for, so that
// everybody draws and sees the same picture whatever their screen.
// Depends on: Vue and ./draw.js (the palette, the brush, and the flood fill).
// Props: active (may this viewer draw), tool ({ kind, colour, width }), width / height (the size to show it at, in pixels).
// Emits: ops (instructions the player has just made, for the table to send on).
// Exposes: apply(ops) adds instructions from somebody else; reset(ops) redraws the board from scratch.
// Side effects: draws on its own canvas element; captures the pointer while a stroke is being made.
import { computed, onMounted, ref, watch } from 'vue';
import { useGameText } from '../../../src/useGameText.js';
import { BOARD_HEIGHT, BOARD_WIDTH } from './layout.js';
import { PALETTE, WHITE, applyOp, applyOps, blankBoard } from './draw.js';

const props = defineProps({
  active: { type: Boolean, default: false },
  tool: { type: Object, default: () => ({ kind: 'pen', colour: 13, width: 8 }) },
  width: { type: Number, default: 800 },
  height: { type: Number, default: 450 },
});
const emit = defineEmits(['ops']);
const { t } = useGameText();

const canvas = ref(null);
let context = null; // the canvas's 2D context, once it is mounted
let pixels = null; // the board as pixels: the truth, which the canvas only shows (see draw.js)
let pending = []; // instructions made since the last frame, waiting to be sent
let frame = null; // the animation frame that will send them
let lastX = 0;
let lastY = 0;
let drawing = false;

/**
 * Makes sure the board is ready to be drawn on.
 * @returns {boolean} false when there is no canvas to draw on (a browser without one, or a test)
 * Side effects: takes the canvas's context and blanks the board the first time.
 */
function ready() {
  if (context && pixels) return true;
  const element = canvas.value;
  if (!element) return false;
  try {
    context = element.getContext('2d', { alpha: false });
  } catch {
    context = null; // no canvas: the board simply shows nothing
  }
  if (!context) return false;
  pixels = blankBoard(context);
  return true;
}

/**
 * Adds instructions somebody else made.
 * @param {object[]} ops  line and fill instructions
 * @returns {void}
 * Side effects: draws on the canvas.
 */
function apply(ops) {
  if (!ready() || !ops?.length) return;
  applyOps(context, pixels, ops);
}

/**
 * Draws the board again from nothing: an empty list blanks it.
 * @param {object[]} ops  the whole drawing
 * @returns {void}
 * Side effects: blanks the canvas and draws the instructions on it.
 */
function reset(ops = []) {
  if (!ready()) return;
  pixels = blankBoard(context);
  if (ops.length) applyOps(context, pixels, ops);
}

defineExpose({ apply, reset });

/**
 * Keeps one instruction to be sent with the next frame's worth, so that a fast pen is one message rather than fifty.
 * @param {object} op  the instruction
 * @returns {void}
 * Side effects: adds to `pending` and asks for an animation frame that emits them.
 */
function queue(op) {
  pending.push(op);
  if (frame !== null) return;
  const send = () => {
    frame = null;
    if (!pending.length) return;
    const ops = pending;
    pending = [];
    emit('ops', ops);
  };
  frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(send) : setTimeout(send, 16);
}

/**
 * Where a pointer is on the board, in the board's own units.
 * @param {PointerEvent} event  the pointer event
 * @returns {{ x: number, y: number }}
 * Side effects: none (reads the canvas's position).
 */
function at(event) {
  const box = canvas.value.getBoundingClientRect();
  const scaleX = box.width ? BOARD_WIDTH / box.width : 1;
  const scaleY = box.height ? BOARD_HEIGHT / box.height : 1;
  return { x: Math.round((event.clientX - box.left) * scaleX), y: Math.round((event.clientY - box.top) * scaleY) };
}

/**
 * How wide the stroke should be: the chosen width, or what a pen is being pressed with.
 * @param {PointerEvent} event  the pointer event
 * @returns {number} the width in board units
 * Side effects: none.
 */
function strokeWidth(event) {
  if (event.pointerType !== 'pen' || !event.pressure || event.pressure === 0.5) return props.tool.width;
  return Math.min(32, Math.max(8, Math.ceil(event.pressure * 32)));
}

/** The colour the tool draws with: the rubber paints white, which is what the board starts as. */
const colour = computed(() => (props.tool.kind === 'rubber' ? WHITE : props.tool.colour));

/**
 * Draws one instruction here and now and queues it to be sent.
 * @param {object} op  the instruction
 * @returns {void}
 * Side effects: draws on the canvas and queues the instruction.
 */
function make(op) {
  if (!ready()) return;
  applyOp(context, pixels, op);
  queue(op);
}

/**
 * The player puts the pen (or their finger) down: a dot, a fill, or the start of a stroke.
 * @param {PointerEvent} event
 * @returns {void}
 * Side effects: captures the pointer and draws (see make).
 */
function onDown(event) {
  if (!props.active || event.button !== 0) return;
  event.preventDefault();
  canvas.value.setPointerCapture?.(event.pointerId);
  const { x, y } = at(event);
  lastX = x;
  lastY = y;
  if (props.tool.kind === 'fill') {
    if (x >= 0 && y >= 0 && x < BOARD_WIDTH && y < BOARD_HEIGHT) make({ t: 'fill', x, y, c: colour.value });
    return;
  }
  drawing = true;
  make({ t: 'line', x, y, x2: x, y2: y, c: colour.value, w: strokeWidth(event) }); // a dot, so a tap leaves a mark
}

/**
 * The player moves the pen: carry the stroke on from where it was.
 * @param {PointerEvent} event
 * @returns {void}
 * Side effects: draws (see make).
 */
function onMove(event) {
  if (!drawing || !props.active) return;
  event.preventDefault();
  const { x, y } = at(event);
  if (x === lastX && y === lastY) return;
  make({ t: 'line', x: lastX, y: lastY, x2: x, y2: y, c: colour.value, w: strokeWidth(event) });
  lastX = x;
  lastY = y;
}

/**
 * The player lifts the pen.
 * @param {PointerEvent} event
 * @returns {void}
 * Side effects: releases the pointer capture.
 */
function onUp(event) {
  drawing = false;
  canvas.value?.releasePointerCapture?.(event.pointerId);
}

// A ring the size of the brush, so the drawer can see how thick the line will be before they draw it.
const cursor = computed(() => {
  if (!props.active) return 'default';
  const screen = props.width ? Math.max(6, Math.round((props.tool.width * props.width) / BOARD_WIDTH)) : props.tool.width;
  const size = screen + 4;
  const middle = size / 2;
  const fill = props.tool.kind === 'rubber' ? PALETTE[WHITE] : PALETTE[props.tool.colour];
  const ring = props.tool.colour === WHITE || props.tool.kind === 'rubber' ? '#000000' : '#ffffff';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${middle}" cy="${middle}" r="${screen / 2}" fill="${fill}" stroke="${ring}" stroke-width="1.5"/></svg>`;
  return `url("data:image/svg+xml;base64,${btoa(svg)}") ${middle} ${middle}, crosshair`;
});

onMounted(() => ready());
// The board is blank again whenever the canvas is replaced (a new turn remounts it through its key).
watch(() => [props.width, props.height], () => ready());
</script>

<template>
  <canvas
    ref="canvas"
    class="board"
    :width="BOARD_WIDTH"
    :height="BOARD_HEIGHT"
    :style="{ width: `${width}px`, height: `${height}px`, cursor }"
    :aria-label="t('board.label')"
    role="img"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
    @pointerleave="onUp"
  />
</template>

<style scoped>
.board {
  display: block;
  background: #ffffff;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  touch-action: none; /* a finger draws on it rather than scrolling the page */
}
</style>
