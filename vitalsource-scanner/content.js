// content.js — VitalSource to PDF
// Single page navigation, iframe cropping, and tooltip handling

(function () {
  if (window.__VS_PDF_LOADED__) return;
  window.__VS_PDF_LOADED__ = true;

  const SCROLL_AMOUNT = 600;

  // ── Book Iframe Detection ──────────────────────────────────

  function getBookIframe() {
    let iframe = document.querySelector('iframe[src*="wrapper.html"]');
    if (iframe) return iframe;

    iframe = document.querySelector('iframe[src*="jigsaw"], iframe[src*="vitalsource"], iframe[id*="book"], iframe[class*="reader"]');
    if (iframe) return iframe;

    const allIframes = document.querySelectorAll('iframe');
    for (const f of allIframes) {
      const rect = f.getBoundingClientRect();
      if (rect.width > 250 && rect.height > 250) return f;
    }

    return null;
  }

  function getIframeRect() {
    const iframe = getBookIframe();
    if (iframe) {
      const rect = iframe.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    }

    const reader = document.querySelector('main, [role="main"], #content-container, .reader-container');
    if (reader) {
      const rect = reader.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    }

    return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  }

  // ── TOC Panel & Tooltips ───────────────────────────────────

  function closeTOCIfOpen() {
    const btn = document.querySelector('button[aria-label="Table of Contents"][aria-expanded="true"]');
    if (btn) {
      simulateClick(btn);
      return true;
    }
    return false;
  }

  function hideTooltips() {
    const STYLE_ID = '__vs_pdf_hide_tooltips__';
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      [role="tooltip"],
      [id^="tooltip-"],
      .Tooltip__tooltip-bxUwOb { display: none !important; }
    `;
    document.head.appendChild(style);
  }

  // ── Next Button ──────────────────────────────────────────

  function getNextButton() {
    // 1. Exact aria-label="Next" (standard VitalSource Next button in Single/Double page view)
    let btn = document.querySelector('button[aria-label="Next"]');
    if (btn && isButtonClickable(btn)) return btn;

    // 2. Explicit Next Page
    btn = document.querySelector('button[aria-label="Next Page" i], button[aria-label="Next page" i]');
    if (btn && isButtonClickable(btn)) return btn;

    // 3. Fallback on classes
    btn = document.querySelector(
      'button[class*="next"]:not([disabled]), button[class*="forward"]:not([disabled])'
    );
    if (btn && isButtonClickable(btn)) return btn;

    // 4. Broad scan of all buttons, skipping chapter/section buttons
    for (const b of document.querySelectorAll('button')) {
      const label = (b.getAttribute('aria-label') || '').toLowerCase();
      const title = (b.getAttribute('title') || '').toLowerCase();

      // Don't click buttons that explicitly say chapter or section
      if (label.includes('chapter') || title.includes('chapter') || label.includes('section') || title.includes('section')) {
        continue;
      }

      if ((label.includes('next') || label.includes('forward')) && isButtonClickable(b)) {
        return b;
      }
    }

    return null;
  }

  function isButtonClickable(btn) {
    if (!btn) return false;
    if (btn.disabled) return false;
    if (btn.getAttribute('aria-disabled') === 'true') return false;
    const style = window.getComputedStyle(btn);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return true;
  }

  function isNextEnabled() {
    const btn = getNextButton();
    return isButtonClickable(btn);
  }

  /**
   * Simulates a realistic mouse click sequence (React / Angular compatible)
   */
  function simulateClick(element) {
    const opts = { bubbles: true, cancelable: true, view: window };
    element.dispatchEvent(new MouseEvent('mouseover', opts));
    element.dispatchEvent(new MouseEvent('mouseenter', { ...opts, bubbles: false }));
    element.dispatchEvent(new MouseEvent('mousedown', opts));
    element.dispatchEvent(new MouseEvent('mouseup', opts));
    element.dispatchEvent(new MouseEvent('click', opts));
  }

  function clickNext() {
    const btn = getNextButton();
    if (btn) {
      simulateClick(btn);
      return true;
    }
    return false;
  }

  // ── Scroll Handling ──────────────────────────────────────

  function getScrollInfo() {
    const html = document.documentElement;
    const scrollTop = html.scrollTop;
    const clientHeight = html.clientHeight;
    const scrollHeight = html.scrollHeight;
    const maxScroll = scrollHeight - clientHeight;
    return {
      scrollTop, clientHeight, scrollHeight, maxScroll,
      isScrollable: maxScroll > 50,
      isAtBottom: scrollTop >= maxScroll - 10
    };
  }

  function scrollDown() {
    const before = document.documentElement.scrollTop;
    document.documentElement.scrollBy(0, SCROLL_AMOUNT);
    const after = document.documentElement.scrollTop;
    return { ok: true, didScroll: after > before, ...getScrollInfo() };
  }

  function resetScroll() {
    document.documentElement.scrollTop = 0;
    return { ok: true, scrollTop: 0 };
  }

  // ── Page Info & Navigation ───────────────────────────────

  function getPageInfo() {
    const dpr = window.devicePixelRatio || 1;
    const iframeRect = getIframeRect();
    return {
      ok: true,
      left: iframeRect.left,
      top: iframeRect.top,
      width: iframeRect.width,
      height: iframeRect.height,
      dpr,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      hasNext: isNextEnabled(),
      ...getScrollInfo()
    };
  }

  function goToNextPage() {
    document.documentElement.scrollTop = 0;
    const clicked = clickNext();
    return {
      ok: clicked,
      message: clicked ? 'Navigated to next page' : 'Next button not available'
    };
  }

  // ── Message Listener ─────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.cmd) return;
    console.log('[VS-PDF] Received:', msg.cmd);

    switch (msg.cmd) {
      case 'VS_CLOSE_TOC':
        try {
          const closed = closeTOCIfOpen();
          sendResponse({ ok: true, closed });
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
        break;

      case 'VS_HIDE_TOOLTIPS':
        try {
          hideTooltips();
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
        break;

      case 'VS_GET_PAGE_INFO':
        try { sendResponse(getPageInfo()); }
        catch (e) { sendResponse({ ok: false, error: String(e) }); }
        break;

      case 'VS_NEXT_PAGE':
        try { sendResponse(goToNextPage()); }
        catch (e) { sendResponse({ ok: false, error: String(e) }); }
        break;

      case 'VS_SCROLL_DOWN':
        try { sendResponse(scrollDown()); }
        catch (e) { sendResponse({ ok: false, error: String(e) }); }
        break;

      case 'VS_RESET_SCROLL':
        try { sendResponse(resetScroll()); }
        catch (e) { sendResponse({ ok: false, error: String(e) }); }
        break;

      case 'VS_GET_SCROLL_INFO':
        try { sendResponse({ ok: true, ...getScrollInfo() }); }
        catch (e) { sendResponse({ ok: false, error: String(e) }); }
        break;

      case 'VS_CHECK_NEXT':
        try { sendResponse({ ok: true, hasNext: isNextEnabled() }); }
        catch (e) { sendResponse({ ok: false, error: String(e) }); }
        break;

      default:
        sendResponse({ ok: false, error: 'Unknown command: ' + msg.cmd });
    }

    return true; // async response
  });

  console.log('[VS-PDF] Content script loaded successfully');
})();
