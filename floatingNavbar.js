/**
 * Floating Navbar Plugin for Squarespace
 * Turns the site header into a rounded, blurred bar that floats over the page.
 * By default it swaps in once the visitor scrolls past a threshold; set the
 * display setting to "auto" and the bar is in place from page load instead.
 * Can be stood down on mobile.
 * Copyright Will-Myers.com
 **/

class WMFloatingNavbar {
  static pluginName = 'floating-navbar';

  /* Classes the stylesheet hooks into, all on <body>. */
  static namespaceClass = 'wm-floating-navbar';
  static activeClass = 'wm-floating-navbar-active';
  static noTransitionClass = 'wm-floating-navbar-no-transition';

  /* Squarespace's primary mobile breakpoint. Matches the CSS media query. */
  static mobileQuery = '(max-width: 767px)';

  static displayModes = ['scroll', 'auto'];

  static defaultSettings = {
    display: 'scroll', // 'scroll' | 'auto'
    disableOnMobile: false,
    scrollThreshold: 80
  };

  static emitEvent(type, detail = {}, elem = document) {
    elem.dispatchEvent(
      new CustomEvent(`wm-${WMFloatingNavbar.pluginName}${type}`, {
        detail,
        bubbles: true
      })
    );
  }

  /* Coerces a settings value to a boolean, number or object, so a value typed
     as a string in Code Injection ("false", "120") still behaves. */
  static parseAttributeValue(value) {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (trimmed !== '' && !isNaN(Number(trimmed))) return Number(trimmed);
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.parse(trimmed);
      } catch (error) {
        console.warn(`[${WMFloatingNavbar.pluginName}] Could not parse value`, value, error);
        return value;
      }
    }
    return value;
  }

  constructor(settings = {}) {
    this.pluginName = WMFloatingNavbar.pluginName;
    this.settings = this.parseSettings(settings);
    this.body = document.body;
    this.header = document.querySelector('#header');

    if (!this.header) {
      console.warn(`[${this.pluginName}] No #header found on this page, nothing to float.`);
      return;
    }

    this.isActive = false;
    this.ticking = false;
    this.mobileMediaQuery = window.matchMedia(WMFloatingNavbar.mobileQuery);
    this.boundOnScroll = null;
    this.boundOnMobileChange = null;
    this.boundOnLoad = null;

    this.init();
  }

  init() {
    WMFloatingNavbar.emitEvent(':beforeInit', {settings: this.settings});
    this.setup();
    this.bindEvents();
    this.update();
    this.releaseTransitionLock();
    WMFloatingNavbar.emitEvent(':afterInit', {el: this.header, settings: this.settings});
    WMFloatingNavbar.emitEvent(':ready', {el: this.header});
  }

  /* ================================
     SETTINGS
     ================================ */

  parseSettings(settings) {
    const parsed = {...WMFloatingNavbar.defaultSettings};

    Object.keys(WMFloatingNavbar.defaultSettings).forEach(key => {
      if (settings[key] === undefined) return;
      parsed[key] = WMFloatingNavbar.parseAttributeValue(settings[key]);
    });

    if (!WMFloatingNavbar.displayModes.includes(parsed.display)) {
      console.warn(
        `[${WMFloatingNavbar.pluginName}] Unknown display "${parsed.display}", falling back to "scroll".`
      );
      parsed.display = 'scroll';
    }

    parsed.disableOnMobile = !!parsed.disableOnMobile;

    if (typeof parsed.scrollThreshold !== 'number' || parsed.scrollThreshold < 0) {
      parsed.scrollThreshold = WMFloatingNavbar.defaultSettings.scrollThreshold;
    }

    return parsed;
  }

  /* ================================
     SETUP
     ================================ */

  setup() {
    // The transition lock keeps "auto" display from animating the bar in on
    // load. It is released a couple of frames later, once the bar is placed.
    this.body.classList.add(
      WMFloatingNavbar.namespaceClass,
      WMFloatingNavbar.noTransitionClass
    );
  }

  releaseTransitionLock() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.body.classList.remove(WMFloatingNavbar.noTransitionClass);
      });
    });
  }

  /* ================================
     EVENTS
     ================================ */

  bindEvents() {
    // "auto" display never changes on scroll, so the listener is only worth
    // attaching in scroll mode.
    if (this.settings.display === 'scroll') this.addScrollEventListener();
    this.addMobileQueryListener();
    this.addLoadEventListener();
  }

  addScrollEventListener() {
    this.boundOnScroll = () => {
      if (this.ticking) return;
      this.ticking = true;
      requestAnimationFrame(() => {
        this.update();
        this.ticking = false;
      });
    };
    window.addEventListener('scroll', this.boundOnScroll, {passive: true});
  }

  addMobileQueryListener() {
    this.boundOnMobileChange = () => this.update();
    if (typeof this.mobileMediaQuery.addEventListener === 'function') {
      this.mobileMediaQuery.addEventListener('change', this.boundOnMobileChange);
    } else if (typeof this.mobileMediaQuery.addListener === 'function') {
      // Safari 13 and below
      this.mobileMediaQuery.addListener(this.boundOnMobileChange);
    }
  }

  addLoadEventListener() {
    // Late-loading announcement bars and web fonts can shift the page after
    // DOMContentLoaded, so the state is re-checked once everything has landed.
    if (document.readyState === 'complete') return;
    this.boundOnLoad = () => this.update();
    window.addEventListener('load', this.boundOnLoad, {once: true});
  }

  /* ================================
     STATE
     ================================ */

  getScrollPosition() {
    return window.pageYOffset || document.documentElement.scrollTop || 0;
  }

  isDisabled() {
    return this.settings.disableOnMobile && this.mobileMediaQuery.matches;
  }

  shouldFloat() {
    if (this.isDisabled()) return false;
    if (this.settings.display === 'auto') return true;
    return this.getScrollPosition() > this.settings.scrollThreshold;
  }

  update() {
    const shouldFloat = this.shouldFloat();
    if (shouldFloat === this.isActive) return;

    this.isActive = shouldFloat;
    this.body.classList.toggle(WMFloatingNavbar.activeClass, shouldFloat);
    WMFloatingNavbar.emitEvent(shouldFloat ? ':float' : ':unfloat', {el: this.header});
  }

  destroy() {
    if (this.boundOnScroll) {
      window.removeEventListener('scroll', this.boundOnScroll);
    }
    if (this.boundOnMobileChange) {
      if (typeof this.mobileMediaQuery.removeEventListener === 'function') {
        this.mobileMediaQuery.removeEventListener('change', this.boundOnMobileChange);
      } else if (typeof this.mobileMediaQuery.removeListener === 'function') {
        this.mobileMediaQuery.removeListener(this.boundOnMobileChange);
      }
    }
    if (this.boundOnLoad) {
      window.removeEventListener('load', this.boundOnLoad);
    }

    this.body.classList.remove(
      WMFloatingNavbar.namespaceClass,
      WMFloatingNavbar.activeClass,
      WMFloatingNavbar.noTransitionClass
    );
    this.isActive = false;
    WMFloatingNavbar.emitEvent(':destroy');
  }
}

/* ================================
   INITIALIZATION
   ================================ */
(function () {
  if (window.__wmFloatingNavbarInit) return;
  window.__wmFloatingNavbarInit = true;

  function start() {
    // Leave the header alone inside the Squarespace editor.
    if (document.body.classList.contains('sqs-edit-mode-active')) return;
    if (window.__wmFloatingNavbar) return;
    const settings = window.wmFloatingNavbarSettings || {};
    window.__wmFloatingNavbar = new WMFloatingNavbar(settings);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
