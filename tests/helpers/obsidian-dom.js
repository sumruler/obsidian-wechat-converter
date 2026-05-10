// tests/helpers/obsidian-dom.js
//
// Helper for tests that need to render real Obsidian-style DOM trees and
// inspect them. The Obsidian runtime extends every element it owns with
// `empty`, `addClass`, `removeClass`, `setText`, `createEl`, `createDiv`,
// etc. JSDOM elements don't have these by default, so we install the same
// extensions before handing the element to plugin code.

function applyExtensions(el) {
  if (!el || el.__obsidianExtensionsApplied) return el;
  el.__obsidianExtensionsApplied = true;
  el.empty = function empty() {
    while (this.firstChild) this.removeChild(this.firstChild);
  };
  el.addClass = function addClass(cls) {
    if (cls) this.classList.add(cls);
    return this;
  };
  el.removeClass = function removeClass(cls) {
    if (cls) this.classList.remove(cls);
    return this;
  };
  el.toggleClass = function toggleClass(cls, force) {
    if (cls) this.classList.toggle(cls, force);
    return this;
  };
  el.setText = function setText(text) {
    this.textContent = text == null ? '' : String(text);
  };
  el.appendText = function appendText(text) {
    this.appendChild(document.createTextNode(text == null ? '' : String(text)));
  };
  el.createEl = function createEl(tag, opts = {}, callback) {
    const child = applyExtensions(document.createElement(tag));
    if (opts && typeof opts === 'object') {
      if (opts.cls) child.className = opts.cls;
      if (opts.text !== undefined) child.textContent = opts.text;
      if (opts.value !== undefined && 'value' in child) child.value = opts.value;
      if (opts.href && 'href' in child) child.href = opts.href;
      if (opts.attr && typeof opts.attr === 'object') {
        Object.entries(opts.attr).forEach(([key, value]) => {
          if (value === undefined || value === null) return;
          child.setAttribute(key, String(value));
        });
      }
    }
    this.appendChild(child);
    if (typeof callback === 'function') callback(child);
    return child;
  };
  el.createDiv = function createDiv(opts = {}, callback) {
    return this.createEl('div', opts, callback);
  };
  el.createSpan = function createSpan(opts = {}, callback) {
    return this.createEl('span', opts, callback);
  };
  return el;
}

function createObsidianLikeElement(tag = 'div') {
  return applyExtensions(document.createElement(tag));
}

function resetSettingNamesRegistry() {
  globalThis.__obsidianSettingNamesRegistry = [];
  return globalThis.__obsidianSettingNamesRegistry;
}

function getSettingNamesRegistry() {
  return globalThis.__obsidianSettingNamesRegistry || [];
}

module.exports = {
  applyExtensions,
  createObsidianLikeElement,
  resetSettingNamesRegistry,
  getSettingNamesRegistry,
};
