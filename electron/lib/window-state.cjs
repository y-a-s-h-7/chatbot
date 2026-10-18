'use strict';

/**
 * Remembers where the window was and how big it was.
 *
 * Deliberately hand-rolled rather than pulling in `electron-window-state`: it is
 * forty lines, it has no dependency tree, and the one thing that actually
 * matters — refusing to restore a position onto a monitor that is no longer
 * attached — is easier to get right here than to configure there.
 */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = { width: 1100, height: 780 };
const MIN = { width: 420, height: 520 };
const SAVE_DEBOUNCE_MS = 400;

function createWindowState(filePath, screen) {
  function read() {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return {};
      return parsed;
    } catch {
      return {};
    }
  }

  function write(value) {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
    } catch {
      /* a read-only profile directory must not stop the app from starting */
    }
  }

  /** Bounds that are guaranteed to be on a display that exists right now. */
  function restore() {
    const saved = read();
    const width = Number.isFinite(saved.width) ? Math.max(MIN.width, Math.round(saved.width)) : DEFAULTS.width;
    const height = Number.isFinite(saved.height) ? Math.max(MIN.height, Math.round(saved.height)) : DEFAULTS.height;
    const bounds = { width, height };

    if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      const x = Math.round(saved.x);
      const y = Math.round(saved.y);
      const visible = screen.getAllDisplays().some((display) => {
        const area = display.workArea;
        // Require a decent slice of the title bar to be reachable, not just one
        // pixel of overlap.
        return (
          x + 80 > area.x &&
          y + 40 > area.y &&
          x < area.x + area.width - 80 &&
          y < area.y + area.height - 40
        );
      });
      if (visible) {
        bounds.x = x;
        bounds.y = y;
      }
    }
    return bounds;
  }

  /** Saves position and size, debounced, and only while the window is normal. */
  function track(win) {
    let timer = null;

    const capture = () => {
      if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
      const bounds = win.getNormalBounds();
      const maximized = win.isMaximized();
      const previous = read();
      write({ ...previous, ...bounds, maximized });
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        capture();
      }, SAVE_DEBOUNCE_MS);
    };

    win.on('resize', schedule);
    win.on('move', schedule);
    win.on('maximize', schedule);
    win.on('unmaximize', schedule);
    win.on('close', () => {
      if (timer) clearTimeout(timer);
      capture();
    });
  }

  return { restore, track, DEFAULTS, MIN };
}

module.exports = { createWindowState };
