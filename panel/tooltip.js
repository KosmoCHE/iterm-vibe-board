"use strict";

// One delegated tooltip for Graph, including items rebuilt by polling.
(() => {
  const tip = document.createElement("div");
  tip.id = "tooltip";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  document.body.append(tip);
  let source = null, timer = null, warmUntil = 0;

  function hide(reset = false) {
    clearTimeout(timer);
    if (!tip.hidden) warmUntil = performance.now() + 500;
    if (reset) warmUntil = 0;
    if (source) source.removeAttribute("aria-describedby");
    source = null;
    tip.hidden = true;
  }

  function show(target, x, y) {
    if (target === source) return;
    hide();
    if (!target || !target.dataset.tooltip) return;
    source = target;
    timer = setTimeout(() => {
      if (!graphOnly() || !target.isConnected || !target.getClientRects().length) return hide(true);
      tip.textContent = target.dataset.tooltip;
      tip.hidden = false;
      target.setAttribute("aria-describedby", tip.id);
      const left = Math.max(8, Math.min(x + 10, innerWidth - tip.offsetWidth - 8));
      const top = y + 14 + tip.offsetHeight <= innerHeight - 8 ? y + 14 : y - tip.offsetHeight - 10;
      tip.style.left = left + "px";
      tip.style.top = Math.max(8, top) + "px";
    }, performance.now() < warmUntil ? 0 : 200);
  }

  function graphOnly() {
    return document.body.classList.contains("graph-view");
  }

  function targetOf(node) {
    return node instanceof Element ? node.closest("[data-tooltip]") : null;
  }

  document.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "touch" && graphOnly()) show(targetOf(e.target), e.clientX, e.clientY);
    else if (!graphOnly()) hide(true);
  });
  document.addEventListener("pointerout", (e) => {
    if (targetOf(e.relatedTarget) !== source) hide();
  });
  document.addEventListener("focusin", (e) => {
    if (!graphOnly() || !e.target.matches(":focus-visible")) return;
    const target = targetOf(e.target);
    if (target) {
      const bounds = target.getBoundingClientRect();
      show(target, bounds.left, bounds.bottom);
    }
  });
  document.addEventListener("focusout", () => hide());
  document.addEventListener("pointerdown", () => hide(true));
  document.addEventListener("keydown", () => hide(true));
  document.addEventListener("scroll", () => hide(true), true);
  window.addEventListener("blur", () => hide(true));
  window.addEventListener("resize", () => hide(true));
  new MutationObserver(() => {
    if (source && (!graphOnly() || !source.isConnected || !source.getClientRects().length)) hide(true);
  }).observe(document.body, { childList: true, subtree: true });
})();
