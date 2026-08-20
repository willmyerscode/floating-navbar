/**
 * Floating Navbar Plugin for Squarespace
 * Turns the site header into a rounded, blurred bar that floats over the page.
 * By default it swaps in once the visitor scrolls past a threshold; set the
 * display setting to "auto" and the bar is in place from page load instead.
 * The bar can either follow the visitor down the page or sit at the top only,
 * and can be stood down on mobile. The plugin pins the header itself and
 * reserves the space it vacates, so Squarespace's own header position setting
 * makes no difference to how it behaves.
 * Copyright Will-Myers.com
 **/

class WMFloatingNavbar {
  static pluginName = 'floating-navbar';

  /* Classes the stylesheet hooks into, all on <body>. */
  static namespaceClass = 'wm-floating-navbar';
  static activeClass = 'wm-floating-navbar-active';
  static noTransitionClass = 'wm-floating-navbar-no-transition';
  static positionClasses = {
    fixed: 'wm-floating-navbar-fixed',
    top: 'wm-floating-navbar-top'
  };
  static reserveSpaceClass = 'wm-floating-navbar-reserve-space';
  /* Squarespace's own flag for the open mobile overlay. It lands on #header,
     and on body in some versions. */
  static menuOpenClass = 'header--menu-open';
  static heightProperty = '--wm-floating-navbar-header-height';

  /* Where the reserved space goes when the header has to leave the page flow.
     First match wins. */
  static contentSelectors = ['#sections', 'main#page', '#page', 'main'];

  /* Squarespace's primary mobile breakpoint. Matches the CSS media query. */
  static mobileQuery = '(max-width: 767px)';

  static displayModes = ['scroll', 'auto'];
  static positionModes = ['fixed', 'top'];

  static defaultSettings = {
    display: 'scroll', // 'scroll' | 'auto'
    position: 'fixed', // 'fixed' | 'top'
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
    this.boundOnResize = null;
    this.resizeTimeout = null;
    this.menuIsOpen = false;
    this.menuObserver = null;

    // Both of these have to be read before any plugin class lands on the
    // body, while the header is still exactly as Squarespace rendered it.
    this.headerIsInFlow = this.detectHeaderInFlow();
    this.naturalHeaderHeight = this.header.offsetHeight;
    this.contentContainer = this.resolveContentContainer();

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

    if (!WMFloatingNavbar.positionModes.includes(parsed.position)) {
      console.warn(
        `[${WMFloatingNavbar.pluginName}] Unknown position "${parsed.position}", falling back to "fixed".`
      );
      parsed.position = 'fixed';
    }

    // A bar that isn't pinned has usually scrolled out of view by the time a
    // scroll-triggered swap would fire, so the pairing is worth flagging.
    if (parsed.position === 'top' && parsed.display === 'scroll') {
      console.warn(
        `[${WMFloatingNavbar.pluginName}] position "top" scrolls away with the page, so display "scroll" will swap the bar in off-screen. Use display "auto" with position "top".`
      );
    }

    parsed.disableOnMobile = !!parsed.disableOnMobile;

    if (typeof parsed.scrollThreshold !== 'number' || parsed.scrollThreshold < 0) {
      parsed.scrollThreshold = WMFloatingNavbar.defaultSettings.scrollThreshold;
    }

    return parsed;
  }

  /* ================================
     HEADER FLOW
     Squarespace's own header position setting doesn't matter to the plugin:
     the bar pins itself. But a header that wasn't already pinned leaves the
     page flow when it does, and the content underneath jumps up by the
     header's height. That gap gets reserved on the content container instead.
     ================================ */

  /* Only a header that actually occupies space in the page flow leaves a gap
     behind when the plugin pins it. static, relative and sticky all take up
     space; absolute and fixed do not. Squarespace's adaptive and transparent
     headers are absolutely positioned, so reserving space for one of those
     adds padding the page never lost in the first place. */
  detectHeaderInFlow() {
    const position = window.getComputedStyle(this.header).position;
    return position !== 'absolute' && position !== 'fixed';
  }

  resolveContentContainer() {
    for (const selector of WMFloatingNavbar.contentSelectors) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    console.warn(
      `[${this.pluginName}] No content container found, so the space the pinned header leaves behind can't be reserved.`
    );
    return null;
  }

  /* Only needed when the plugin is the thing taking the header out of the
     flow. A header Squarespace already positions out of flow is accounted for
     in its own layout, and "top" position never leaves the flow at all. */
  reservesSpace() {
    return (
      this.settings.position === 'fixed' &&
      this.headerIsInFlow &&
      !!this.contentContainer
    );
  }

  measureHeaderHeight() {
    // Measured only while the bar is inactive, because the floating state has
    // its own padding and would report the pill's height rather than the
    // height the page flow actually needs back.
    if (this.isActive) return;
    const height = this.header.offsetHeight;
    if (height) this.naturalHeaderHeight = height;
    this.body.style.setProperty(
      WMFloatingNavbar.heightProperty,
      `${this.naturalHeaderHeight}px`
    );
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

    // The position classes themselves are applied by update(), so that
    // disableOnMobile can hand the header back to Squarespace wholesale.
    if (this.reservesSpace()) {
      this.contentContainer.setAttribute('data-wm-floating-navbar-spacer', '');
      this.measureHeaderHeight();
    }
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
    this.addResizeEventListener();
    this.addLoadEventListener();
    this.addMenuObserver();
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

  addResizeEventListener() {
    if (!this.reservesSpace()) return;
    this.boundOnResize = () => {
      window.clearTimeout(this.resizeTimeout);
      this.resizeTimeout = window.setTimeout(() => this.measureHeaderHeight(), 150);
    };
    window.addEventListener('resize', this.boundOnResize, {passive: true});
  }

  /* The open mobile overlay is Squarespace's UI, not the plugin's. Rather than
     overriding the bar's styling back off again — which means guessing at the
     padding Squarespace would have used — the bar is simply stood down for as
     long as the menu is open, and the native header styling applies untouched. */
  addMenuObserver() {
    this.menuObserver = new MutationObserver(() => this.syncMenuState());
    this.menuObserver.observe(this.header, {attributes: true, attributeFilter: ['class']});
    this.menuObserver.observe(this.body, {attributes: true, attributeFilter: ['class']});
    this.syncMenuState();
  }

  syncMenuState() {
    const isOpen =
      this.header.classList.contains(WMFloatingNavbar.menuOpenClass) ||
      this.body.classList.contains(WMFloatingNavbar.menuOpenClass);
    if (isOpen === this.menuIsOpen) return;
    this.menuIsOpen = isOpen;
    this.update();
  }

  addLoadEventListener() {
    // Late-loading announcement bars and web fonts can shift the page after
    // DOMContentLoaded, so the state and the header height are both re-checked
    // once everything has landed.
    if (document.readyState === 'complete') return;
    this.boundOnLoad = () => {
      this.update();
      this.measureHeaderHeight();
    };
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
    if (this.menuIsOpen) return false;
    if (this.settings.display === 'auto') return true;
    return this.getScrollPosition() > this.settings.scrollThreshold;
  }

  update() {
    const disabled = this.isDisabled();

    // Ownership of the header's position is all-or-nothing: when the plugin is
    // disabled on mobile it stops pinning too, rather than leaving a pinned
    // header with none of the bar's styling on it.
    this.body.classList.toggle(
      WMFloatingNavbar.positionClasses[this.settings.position],
      !disabled
    );
    if (this.reservesSpace()) {
      this.body.classList.toggle(WMFloatingNavbar.reserveSpaceClass, !disabled);
    }

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
    if (this.boundOnResize) {
      window.removeEventListener('resize', this.boundOnResize);
      window.clearTimeout(this.resizeTimeout);
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
    if (this.menuObserver) {
      this.menuObserver.disconnect();
    }

    if (this.contentContainer) {
      this.contentContainer.removeAttribute('data-wm-floating-navbar-spacer');
    }
    this.body.style.removeProperty(WMFloatingNavbar.heightProperty);
    this.body.classList.remove(
      WMFloatingNavbar.namespaceClass,
      WMFloatingNavbar.activeClass,
      WMFloatingNavbar.noTransitionClass,
      WMFloatingNavbar.reserveSpaceClass,
      WMFloatingNavbar.positionClasses.fixed,
      WMFloatingNavbar.positionClasses.top
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
