// ── F.R.I.D.A.Y. Popover ────────────────────────────────────────────────────
// Vanilla TS popover component — replaces every browser-default `title`
// attribute in the renderer. Behaviour locked by DECISIONS_LOCKED §10.1
// (hover open after 300 ms, hover close after 300 ms grace, click toggles
// instantly, Esc / outside-click dismiss, single-instance).
//
// No third-party deps (no Tippy.js, Floating UI, Popper) — those are
// banned by work-order anti-pattern §2 and would regress bundle size +
// privacy posture. The whole module is < 200 LOC of vanilla DOM.
//
// API:
//   const handle = attachPopover(triggerEl, contentBuilder, opts);
//   handle.dismiss();   // close if open
//   handle.destroy();   // tear down listeners + DOM
//
// `contentBuilder` is invoked once per show — pass it a fresh element.
// Read state off the trigger via dataset attributes inside the builder.

const HOVER_DELAY_MS_DEFAULT = 300;
const HIDE_DELAY_MS_DEFAULT  = 300;
const VIEWPORT_PADDING_PX    = 8;
const ARROW_GAP_PX           = 6;
const TOP_FLIP_THRESHOLD_PX  = 100;

export interface PopoverOptions {
  /** ms before hover triggers a show. Default 300. */
  hoverDelayMs?: number;
  /** ms grace after mouse-leave before hide. Default 300. */
  hideDelayMs?: number;
  /** 'auto' = above unless near top of viewport. */
  placement?: 'auto' | 'above' | 'below';
}

export interface PopoverHandle {
  /** Programmatically close. No-op if already closed. */
  dismiss(): void;
  /** Tear down listeners and remove DOM. After destroy() the handle is dead. */
  destroy(): void;
}

// ── Single-instance registry ────────────────────────────────────────────────
// Per §10.1: opening any popover closes any other open one. Tracked via
// module-level state (single-process renderer — no race).
let currentlyOpen: { handle: PopoverHandle; trigger: HTMLElement } | null = null;

// Keyboard + outside-click listeners are attached lazily once any popover
// has been registered (so the cost is zero if a window has none).
let globalListenersInstalled = false;

function installGlobalListeners(): void {
  if (globalListenersInstalled) return;
  globalListenersInstalled = true;

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && currentlyOpen) {
      currentlyOpen.handle.dismiss();
    }
  });

  // Outside-click: close if the click landed neither on the active
  // trigger nor inside the open popover element.
  document.addEventListener('mousedown', (e) => {
    if (!currentlyOpen) return;
    const target = e.target as Node | null;
    if (!target) return;
    const popoverEl = (currentlyOpen as { handle: PopoverHandle & { _el?: HTMLElement } }).handle._el;
    if (popoverEl && popoverEl.contains(target)) return;
    if (currentlyOpen.trigger.contains(target)) return;
    currentlyOpen.handle.dismiss();
  });
}

// ── Positioning ────────────────────────────────────────────────────────────
function placePopover(
  popEl: HTMLElement,
  triggerRect: DOMRect,
  preferred: 'auto' | 'above' | 'below',
): 'above' | 'below' {
  // Resolve placement.
  let placement: 'above' | 'below';
  if (preferred === 'above') placement = 'above';
  else if (preferred === 'below') placement = 'below';
  else placement = triggerRect.top < TOP_FLIP_THRESHOLD_PX ? 'below' : 'above';

  // Read after layout — needs the popover already in the DOM.
  const popRect = popEl.getBoundingClientRect();

  // Vertical placement.
  let top: number;
  if (placement === 'above') {
    top = triggerRect.top - popRect.height - ARROW_GAP_PX;
  } else {
    top = triggerRect.bottom + ARROW_GAP_PX;
  }

  // Horizontal: centre on the trigger, then clamp to viewport.
  const triggerCenter = triggerRect.left + triggerRect.width / 2;
  let left = triggerCenter - popRect.width / 2;
  const minLeft = VIEWPORT_PADDING_PX;
  const maxLeft = window.innerWidth - popRect.width - VIEWPORT_PADDING_PX;
  if (left < minLeft) left = minLeft;
  if (left > maxLeft) left = maxLeft;

  popEl.style.top = `${Math.round(top)}px`;
  popEl.style.left = `${Math.round(left)}px`;

  // Position the arrow horizontally over the trigger centre. Even when
  // the popover was clamped, the arrow tracks the trigger so the
  // visual link stays correct.
  const arrow = popEl.querySelector<HTMLElement>('.pop-arrow');
  if (arrow) {
    const arrowLeft = triggerCenter - left - 6; // 6 = half arrow width
    const clampedArrow = Math.max(8, Math.min(popRect.width - 14, arrowLeft));
    arrow.style.left = `${Math.round(clampedArrow)}px`;
  }

  return placement;
}

// ── Public API ─────────────────────────────────────────────────────────────
export function attachPopover(
  trigger: HTMLElement,
  contentBuilder: (trigger: HTMLElement) => HTMLElement,
  opts: PopoverOptions = {},
): PopoverHandle {
  installGlobalListeners();

  const hoverDelay = opts.hoverDelayMs ?? HOVER_DELAY_MS_DEFAULT;
  const hideDelay  = opts.hideDelayMs  ?? HIDE_DELAY_MS_DEFAULT;
  const placementPref = opts.placement ?? 'auto';

  let popEl: HTMLElement | null = null;
  let openTimer:  ReturnType<typeof setTimeout> | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  // True once attachPopover has rendered the popover at least once.
  // Used by destroy() to tear down DOM cleanly even if never shown.
  let destroyed = false;

  function clearOpenTimer():  void { if (openTimer)  { clearTimeout(openTimer);  openTimer  = null; } }
  function clearCloseTimer(): void { if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; } }

  function show(): void {
    if (destroyed) return;
    if (popEl) return;  // already open

    // Single-instance: close anyone else first. §10.1.
    if (currentlyOpen && currentlyOpen.handle !== handle) {
      currentlyOpen.handle.dismiss();
    }

    popEl = contentBuilder(trigger);
    if (!popEl.classList.contains('popover')) {
      popEl.classList.add('popover');
    }
    document.body.appendChild(popEl);

    // First paint with placement=above guess, then re-place after we
    // know the popover's true height.
    const triggerRect = trigger.getBoundingClientRect();
    const placement = placePopover(popEl, triggerRect, placementPref);
    popEl.classList.add(`placement-${placement}`);

    // Bind hover listeners on the popover itself so the user can move
    // their cursor INTO the popover without it closing (§10.1 grace).
    popEl.addEventListener('mouseenter', clearCloseTimer);
    popEl.addEventListener('mouseleave', scheduleHide);

    // Force a reflow so the .is-open transition runs (rather than
    // jumping to opacity:1 on first paint).
    void popEl.offsetWidth;
    popEl.classList.add('is-open');

    currentlyOpen = { handle, trigger };
  }

  function hide(): void {
    clearOpenTimer();
    clearCloseTimer();
    if (!popEl) return;
    if (currentlyOpen && currentlyOpen.handle === handle) currentlyOpen = null;
    // Skip the fade-out on remove — keeps the destroy path simple and
    // avoids a stale popover element living for 150 ms after dismiss.
    popEl.remove();
    popEl = null;
  }

  function scheduleShow(): void {
    clearCloseTimer();
    if (popEl) return;
    if (openTimer) return;
    openTimer = setTimeout(() => {
      openTimer = null;
      show();
    }, hoverDelay);
  }

  function scheduleHide(): void {
    clearOpenTimer();
    if (closeTimer) return;
    closeTimer = setTimeout(() => {
      closeTimer = null;
      hide();
    }, hideDelay);
  }

  // Hover open — only when no popover is currently open from THIS
  // trigger. Mouse leave starts the grace timer; if the cursor enters
  // the popover before it fires, the popover's own mouseenter cancels.
  trigger.addEventListener('mouseenter', scheduleShow);
  trigger.addEventListener('mouseleave', scheduleHide);

  // Click toggles immediately (no delay) — power users + keyboard / touch.
  trigger.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();  // don't trip the document-level outside-click handler
    clearOpenTimer();
    clearCloseTimer();
    if (popEl) hide();
    else show();
  });

  const handle: PopoverHandle & { _el?: HTMLElement } = {
    dismiss: () => hide(),
    destroy: () => {
      destroyed = true;
      hide();
      trigger.removeEventListener('mouseenter', scheduleShow);
      trigger.removeEventListener('mouseleave', scheduleHide);
      // The click listener is anonymous — we leave it bound. After
      // destroy() the trigger element is typically removed from the
      // DOM by its owning renderer, which severs the listener anyway.
    },
  };
  // Outside-click handler peeks at the open popover's element via
  // currentlyOpen.handle._el. Expose it through the handle so the
  // global listener can find it without keeping its own map.
  Object.defineProperty(handle, '_el', { get: () => popEl });

  return handle;
}
