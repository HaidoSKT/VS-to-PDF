// popup.js - VitalSource to PDF v2.0
// Features: Resume/Pause workflow, full-screen lightbox preview, batch PDF generation, auto-crop

let capturedPages = [];
let isScanning = false;
let scanCancelled = false;
let currentModalIndex = 0;
const isUnlocked = true; // Permanently unlocked PRO v2

const MAX_PAGES = 5000;

// -------- Utility --------

function $(id) { return document.getElementById(id); }

function setStatus(text, type = '') {
  const s = $("status");
  if (!s) return;
  s.textContent = text || "";
  s.className = type;
}

function showLoading(show) {
  const el = $("loadingIndicator");
  if (el) el.classList.toggle("visible", show);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0]) return resolve(tabs[0]);
      chrome.tabs.query({ url: '*://*.vitalsource.com/*' }, (vsTabs) => {
        resolve(vsTabs && vsTabs[0] ? vsTabs[0] : null);
      });
    });
  });
}

function sendToTab(tabId, msg) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, msg, (resp) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(resp || { ok: false, error: "No response" });
      }
    });
  });
}

function getQualitySettings() {
  const quality = $("quality") ? $("quality").value : "png";
  switch (quality) {
    case "jpeg-high": return { format: "jpeg", quality: 0.92 };
    case "jpeg-low":  return { format: "jpeg", quality: 0.80 };
    default:          return { format: "png",  quality: 1.0 };
  }
}

// -------- Screenshot & Cropping --------

async function captureTabWithRetry(maxRetries = 5) {
  const qs = getQualitySettings();
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await new Promise((resolve) => {
      const opts = { format: qs.format };
      if (qs.format === "jpeg") opts.quality = Math.round(qs.quality * 100);
      chrome.tabs.captureVisibleTab(null, opts, (dataUrl) => {
        if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
        else if (!dataUrl)            resolve({ ok: false, error: "Screenshot not available" });
        else                          resolve({ ok: true, dataUrl });
      });
    });
    if (res.ok) return res;
    if (res.error && res.error.includes("MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND")) {
      await sleep(1200);
      continue;
    }
    return res;
  }
  return { ok: false, error: "Screenshot retry limit exceeded" };
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

async function cropToBookArea(dataUrl, pageInfo) {
  const img  = await loadImage(dataUrl);
  const dpr  = pageInfo.dpr || window.devicePixelRatio || 1;
  const sx   = Math.round(pageInfo.left   * dpr);
  const sy   = Math.round(pageInfo.top    * dpr);
  const sw   = Math.round(pageInfo.width  * dpr);
  const sh   = Math.round(pageInfo.height * dpr);

  if (sw > 100 && sh > 100 && sx >= 0 && sy >= 0 && sx + sw <= img.width && sy + sh <= img.height) {
    const canvas = document.createElement("canvas");
    canvas.width  = sw;
    canvas.height = sh;
    canvas.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    const qs = getQualitySettings();
    return qs.format === "jpeg"
      ? canvas.toDataURL("image/jpeg", qs.quality)
      : canvas.toDataURL("image/png");
  }

  return dataUrl;
}

// -------- Preview & Modal Viewer --------

function updatePreview() {
  const container    = $("previewContainer");
  const countDisplay = $("pageCountDisplay");
  if (!container || !countDisplay) return;

  container.innerHTML = "";
  if (capturedPages.length === 0) { countDisplay.textContent = ""; return; }

  // Render thumbnails
  for (let idx = 0; idx < capturedPages.length; idx++) {
    const dataUrl = capturedPages[idx];
    const thumb = document.createElement("div");
    thumb.className = "page-thumb";
    thumb.title = `Page ${idx + 1} • Click to view full size`;

    const img = document.createElement("img");
    img.loading = "lazy";
    img.decoding = "async";
    img.src = dataUrl;

    const badge = document.createElement("span");
    badge.className = "thumb-badge";
    badge.textContent = idx + 1;

    // Individual delete button (Trash icon)
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "thumb-delete-btn";
    deleteBtn.title = `Delete Page ${idx + 1}`;
    deleteBtn.innerHTML = `🗑`;
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation(); // Prevent opening modal
      deleteSinglePage(idx);
    });

    thumb.appendChild(img);
    thumb.appendChild(badge);
    thumb.appendChild(deleteBtn);

    // Requirement 1: Click to open in large screen modal viewer
    thumb.addEventListener("click", () => openImageViewer(idx));

    container.appendChild(thumb);
  }

  countDisplay.textContent = `${capturedPages.length} page${capturedPages.length !== 1 ? 's' : ''} captured (click any page to view)`;
  container.scrollTop = container.scrollHeight;
}

async function deleteSinglePage(index) {
  if (isScanning) {
    setStatus("Cannot delete pages while scanning is in progress. Pause scan first.", "error");
    return;
  }
  if (index < 0 || index >= capturedPages.length) return;

  const pageNum = index + 1;
  capturedPages.splice(index, 1);

  // Sync updated array to chrome.storage
  await syncPagesToStorage();

  updatePreview();
  updateButtons();
  setStatus(`Page ${pageNum} removed (${capturedPages.length} remaining)`);

  // If modal viewer is currently open, advance or close
  const modal = $("imageModal");
  if (modal && modal.style.display !== "none") {
    if (capturedPages.length === 0) {
      closeImageViewer();
    } else {
      const nextIdx = Math.min(index, capturedPages.length - 1);
      openImageViewer(nextIdx);
    }
  }
}

async function syncPagesToStorage() {
  await clearStoredPages();
  const storageObj = { vsPdfPageCount: capturedPages.length };
  for (let i = 0; i < capturedPages.length; i++) {
    storageObj[`vsPdfPage_${i}`] = capturedPages[i];
  }
  return new Promise(resolve => chrome.storage.local.set(storageObj, resolve));
}

function openImageViewer(index) {
  if (index < 0 || index >= capturedPages.length) return;
  currentModalIndex = index;

  const modal = $("imageModal");
  const modalImg = $("modalImg");
  const modalTitle = $("modalPageTitle");
  const prevBtn = $("modalPrevBtn");
  const nextBtn = $("modalNextBtn");

  if (!modal || !modalImg) return;

  modalImg.src = capturedPages[index];
  modalTitle.textContent = `Page ${index + 1} of ${capturedPages.length}`;

  if (prevBtn) prevBtn.style.visibility = index > 0 ? "visible" : "hidden";
  if (nextBtn) nextBtn.style.visibility = index < capturedPages.length - 1 ? "visible" : "hidden";

  modal.style.display = "flex";
}

function closeImageViewer() {
  const modal = $("imageModal");
  if (modal) modal.style.display = "none";
}

function updateButtons() {
  const hasPages = capturedPages.length > 0;
  const scanBtn  = $("scanBtn");
  const stopBtn  = $("stopBtn");
  const clearBtn = $("clearBtn");
  const pdfBtn   = $("pdfBtn");

  if (scanBtn) {
    scanBtn.disabled = isScanning;
    if (isScanning) {
      scanBtn.innerHTML = "▶ Scanning...";
    } else if (hasPages) {
      scanBtn.innerHTML = "▶ Resume Scan";
      scanBtn.title = `Resume scan from page ${capturedPages.length + 1}`;
    } else {
      scanBtn.innerHTML = "▶ Start Scan";
      scanBtn.title = "Start scanning from current page";
    }
  }

  if (stopBtn) {
    stopBtn.disabled = !isScanning;
    stopBtn.innerHTML = "⏸ Pause";
    stopBtn.title = isScanning ? "Pause scanning (can be resumed anytime)" : "Scan is not running";
  }

  if (clearBtn) clearBtn.disabled = isScanning || !hasPages;
  if (pdfBtn)   pdfBtn.disabled   = isScanning || !hasPages;
}

// -------- Scan Loop (Resume & Pause Aware) --------

function quickHash(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const size = 32;
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, size, size);
      const d = ctx.getImageData(0, 0, size, size).data;
      let hash = 0;
      for (let i = 0; i < d.length; i += 16) {
        hash = ((hash << 5) - hash + d[i])     | 0;
        hash = ((hash << 5) - hash + d[i + 1]) | 0;
        hash = ((hash << 5) - hash + d[i + 2]) | 0;
      }
      resolve(hash.toString(16));
    };
    img.onerror = () => resolve(Math.random().toString());
    img.src = dataUrl;
  });
}

async function startScan() {
  if (isScanning) return;

  const isResuming = capturedPages.length > 0;
  isScanning    = true;
  scanCancelled = false;

  // Requirement 2: Do NOT reset capturedPages on resume!
  // We preserve all existing pages and continue scanning.

  updateButtons();
  updatePreview();
  showLoading(true);

  if (isResuming) {
    setStatus(`Resuming scan from page ${capturedPages.length + 1}...`);
  } else {
    setStatus("Initializing...");
  }

  const tab = await getActiveTab();
  if (!tab || !tab.id) {
    setStatus("No VitalSource book tab found. Please open your book first.", "error");
    isScanning = false;
    showLoading(false);
    updateButtons();
    return;
  }

  const tabId   = tab.id;
  const delayMs = parseInt($("delayMs").value) || 1500;

  // 1. Ensure content script is ready
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
  } catch (e) {
    console.log('Script injection note:', e);
  }

  // 2. Close TOC panel and hide tooltips
  setStatus("Closing side panels for clean capture...");
  const tocResult = await sendToTab(tabId, { cmd: "VS_CLOSE_TOC" });
  if (tocResult && tocResult.closed) {
    await sleep(900);
  } else {
    await sleep(200);
  }
  await sendToTab(tabId, { cmd: "VS_HIDE_TOOLTIPS" });

  let pageNumber     = capturedPages.length;
  let lastHash       = isResuming && capturedPages.length > 0 ? await quickHash(capturedPages[capturedPages.length - 1]) : null;
  let duplicateCount = 0;

  while (pageNumber < MAX_PAGES) {
    if (scanCancelled) {
      setStatus(`Scan paused at ${capturedPages.length} pages. Click "Resume Scan" to continue.`);
      break;
    }

    pageNumber++;
    setStatus(`Capturing page ${pageNumber}...`);

    // Wait configured delay
    await sleep(delayMs);
    if (scanCancelled) {
      setStatus(`Scan paused at ${capturedPages.length} pages. Click "Resume Scan" to continue.`);
      break;
    }

    // Get book dimensions
    let pageInfo = await sendToTab(tabId, { cmd: "VS_GET_PAGE_INFO" });
    if (!pageInfo || !pageInfo.ok) {
      console.log('Page info retry...');
      await sleep(500);
      pageInfo = await sendToTab(tabId, { cmd: "VS_GET_PAGE_INFO" });
      if (!pageInfo || !pageInfo.ok) {
        setStatus("Error: could not read book dimensions. Ensure book is open.", "error");
        break;
      }
    }

    // Capture tab
    const shot = await captureTabWithRetry();
    if (!shot.ok) {
      setStatus("Screenshot error: " + shot.error, "error");
      break;
    }

    try {
      const croppedDataUrl = await cropToBookArea(shot.dataUrl, pageInfo);
      const currentHash    = await quickHash(croppedDataUrl);

      if (currentHash === lastHash) {
        duplicateCount++;
        console.log(`[VS-PDF] Duplicate detected #${duplicateCount}`);
        if (duplicateCount >= 3) {
          setStatus(`Scan complete! ${capturedPages.length} pages captured`, "success");
          break;
        }
      } else {
        capturedPages.push(croppedDataUrl);
        lastHash       = currentHash;
        duplicateCount = 0;
        updatePreview();
        await savePageToStorage(capturedPages.length - 1, croppedDataUrl);
        saveToStorage();
      }
    } catch (e) {
      console.error("[VS-PDF] Crop error:", e);
      setStatus("Image cropping error", "error");
      break;
    }

    if (scanCancelled) {
      setStatus(`Scan paused at ${capturedPages.length} pages. Click "Resume Scan" to continue.`);
      break;
    }

    // Check if Next button exists
    const checkNext = await sendToTab(tabId, { cmd: "VS_CHECK_NEXT" });
    if (!checkNext.hasNext) {
      setStatus(`End of book reached! ${capturedPages.length} pages captured`, "success");
      break;
    }

    // Turn page
    const nextResult = await sendToTab(tabId, { cmd: "VS_NEXT_PAGE" });
    if (!nextResult.ok) {
      setStatus(`End of book reached. ${capturedPages.length} pages captured`, "success");
      break;
    }
  }

  isScanning = false;
  showLoading(false);
  updateButtons();
}

function stopScan() {
  if (!isScanning) return;
  scanCancelled = true;
  setStatus(`Scan paused at ${capturedPages.length} pages. Click "Resume Scan" to continue.`);
  updateButtons();
}

async function clearPages() {
  if (isScanning) return;
  if (capturedPages.length > 0) {
    const ok = confirm(`Are you sure you want to clear all ${capturedPages.length} captured pages?`);
    if (!ok) return;
  }
  capturedPages = [];
  await clearStoredPages();
  updatePreview();
  updateButtons();
  saveToStorage();
  setStatus("All pages cleared. Ready to start new scan.");
}

// -------- PDF Creation with pdf-lib (Batching) --------

const A4_WIDTH_PT  = 595.28;
const A4_HEIGHT_PT = 841.89;

function calculatePageDimensions(imgWidth, imgHeight, marginX, marginY) {
  const isLandscape = imgWidth > imgHeight;
  const maxPW = A4_WIDTH_PT  - marginX * 2;
  const maxPH = A4_HEIGHT_PT - marginY * 2;
  const maxLW = A4_HEIGHT_PT - marginX * 2;
  const maxLH = A4_WIDTH_PT  - marginY * 2;
  let contentWidth, contentHeight;

  if (isLandscape) {
    const scale = Math.min(maxLW / imgWidth, maxLH / imgHeight, 1);
    contentWidth  = imgWidth  * scale;
    contentHeight = imgHeight * scale;
  } else {
    const scale = Math.min(maxPW / imgWidth, maxPH / imgHeight, 1);
    contentWidth  = imgWidth  * scale;
    contentHeight = imgHeight * scale;
  }

  return {
    contentWidth, contentHeight,
    pdfWidth:  contentWidth  + marginX * 2,
    pdfHeight: contentHeight + marginY * 2
  };
}

function dataUrlToUint8Array(dataUrl) {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function getImageMimeFromDataUrl(dataUrl) {
  const m = String(dataUrl || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
  return m ? m[1].toLowerCase() : '';
}

async function embedImageSafe(pdfDoc, dataUrl) {
  const mime  = getImageMimeFromDataUrl(dataUrl);
  const bytes = dataUrlToUint8Array(dataUrl);
  if (mime.includes('jpeg') || mime.includes('jpg')) return await pdfDoc.embedJpg(bytes);
  if (mime.includes('png'))                           return await pdfDoc.embedPng(bytes);
  try { return await pdfDoc.embedPng(bytes); } catch { return await pdfDoc.embedJpg(bytes); }
}

async function buildPdfBatchWithPdfLib(pages, startIdx, endIdx, marginX, marginY, totalPages) {
  const { PDFDocument } = PDFLib;
  const pdfDoc = await PDFDocument.create();

  for (let i = startIdx; i < endIdx; i++) {
    const dataUrl = pages[i];
    if (!dataUrl || typeof dataUrl !== 'string') continue;

    const embImg = await embedImageSafe(pdfDoc, dataUrl);
    const dims   = calculatePageDimensions(embImg.width, embImg.height, marginX, marginY);
    const page   = pdfDoc.addPage([dims.pdfWidth, dims.pdfHeight]);

    page.drawImage(embImg, { x: marginX, y: marginY, width: dims.contentWidth, height: dims.contentHeight });

    setStatus(`Processing page ${i + 1} of ${totalPages}...`);
    await sleep(5);
  }

  return await pdfDoc.save({ useObjectStreams: true });
}

async function createPDF() {
  if (capturedPages.length === 0) { setStatus("No pages to convert", "error"); return; }
  setStatus("Creating PDF...");
  showLoading(true);
  updateButtons();

  try {
    const { PDFDocument } = PDFLib;
    const marginX = 20, marginY = 30;
    const BATCH_SIZE = 20;
    const totalPages = capturedPages.length;
    const batchCount = Math.ceil(totalPages / BATCH_SIZE);

    let finalBytes = null;
    let mergedPdf = batchCount > 1 ? await PDFDocument.create() : null;

    for (let b = 0; b < batchCount; b++) {
      const startIdx = b * BATCH_SIZE;
      const endIdx   = Math.min(startIdx + BATCH_SIZE, totalPages);
      setStatus(`Creating PDF batch ${b + 1}/${batchCount}...`);

      let batchBytes = await buildPdfBatchWithPdfLib(
        capturedPages, startIdx, endIdx, marginX, marginY, totalPages
      );
      if (!batchBytes || !(batchBytes instanceof Uint8Array) || batchBytes.byteLength === 0)
        throw new Error(`PDF batch ${b + 1} failed`);

      if (batchCount === 1) {
        finalBytes = batchBytes;
      } else {
        setStatus(`Merging batch ${b + 1} of ${batchCount}...`);
        let srcDoc = await PDFDocument.load(batchBytes);
        const copiedPages = await mergedPdf.copyPages(srcDoc, srcDoc.getPageIndices());
        copiedPages.forEach(p => mergedPdf.addPage(p));

        srcDoc = null;
        batchBytes = null;
      }

      await sleep(25);
    }

    if (batchCount > 1) {
      setStatus("Finalizing PDF...");
      finalBytes = await mergedPdf.save({ useObjectStreams: true });
      mergedPdf = null;
    }

    if (!finalBytes || !(finalBytes instanceof Uint8Array) || finalBytes.byteLength === 0)
      throw new Error("Final PDF creation failed");

    const blob      = new Blob([finalBytes], { type: "application/pdf" });
    const timestamp = new Date().toISOString().slice(0, 10);
    const fileName  = `vitalsource-book-${timestamp}.pdf`;
    const blobUrl   = URL.createObjectURL(blob);

    if (chrome.downloads && chrome.downloads.download) {
      chrome.downloads.download({ url: blobUrl, filename: fileName, saveAs: true }, () => {
        if (chrome.runtime.lastError) setStatus("Download error: " + chrome.runtime.lastError.message, "error");
        else                          setStatus("PDF created and downloaded!", "success");
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
      });
    } else {
      window.open(blobUrl, "_blank");
      setStatus("PDF created (opened in new tab)", "success");
    }
  } catch (e) {
    console.error("[VS-PDF] PDF error:", e);
    setStatus("PDF creation error: " + (e && e.message ? e.message : String(e)), "error");
  } finally {
    showLoading(false);
    updateButtons();
  }
}

// -------- Storage --------

async function savePageToStorage(index, dataUrl) {
  return new Promise(resolve => chrome.storage.local.set({ [`vsPdfPage_${index}`]: dataUrl }, resolve));
}

function saveToStorage() {
  chrome.storage.local.set({ vsPdfPageCount: capturedPages.length });
}

async function clearStoredPages() {
  return new Promise(resolve => {
    chrome.storage.local.get(null, (items) => {
      const keys = Object.keys(items).filter(k => k.startsWith('vsPdfPage_'));
      keys.length > 0 ? chrome.storage.local.remove(keys, resolve) : resolve();
    });
  });
}

async function loadPagesFromStorage() {
  return new Promise(resolve => {
    chrome.storage.local.get(null, (items) => {
      const count = items.vsPdfPageCount || 0;
      const pages = [];
      for (let i = 0; i < count; i++) {
        if (items[`vsPdfPage_${i}`]) pages.push(items[`vsPdfPage_${i}`]);
      }
      resolve(pages);
    });
  });
}

async function loadFromStorage() {
  const data = await new Promise(resolve =>
    chrome.storage.local.get(["vsPdfPageCount", "vsPdfDelay", "vsPdfQuality"], resolve)
  );
  capturedPages = await loadPagesFromStorage();
  if (data.vsPdfDelay)   $("delayMs").value = data.vsPdfDelay;
  if (data.vsPdfQuality) $("quality").value = data.vsPdfQuality;
}

function saveSettings() {
  chrome.storage.local.set({ vsPdfDelay: $("delayMs").value, vsPdfQuality: $("quality").value });
}

// -------- Init --------

async function init() {
  await loadFromStorage();
  updatePreview();
  updateButtons();

  $("scanBtn").addEventListener("click", startScan);
  $("stopBtn").addEventListener("click", stopScan);
  $("clearBtn").addEventListener("click", clearPages);
  $("pdfBtn").addEventListener("click", createPDF);
  $("delayMs").addEventListener("change", saveSettings);
  $("quality").addEventListener("change", saveSettings);

  const closeBtn = $("modalCloseBtn");
  const prevBtn = $("modalPrevBtn");
  const nextBtn = $("modalNextBtn");
  const modalDeleteBtn = $("modalDeleteBtn");
  const modal = $("imageModal");

  if (closeBtn) closeBtn.addEventListener("click", closeImageViewer);
  if (prevBtn) prevBtn.addEventListener("click", () => openImageViewer(currentModalIndex - 1));
  if (nextBtn) nextBtn.addEventListener("click", () => openImageViewer(currentModalIndex + 1));
  if (modalDeleteBtn) {
    modalDeleteBtn.addEventListener("click", () => {
      deleteSinglePage(currentModalIndex);
    });
  }

  // Close modal when clicking dark backdrop outside the image
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal || e.target.classList.contains("modal-body") || e.target.classList.contains("modal-container")) {
        closeImageViewer();
      }
    });
  }

  // Keyboard navigation for image modal
  document.addEventListener("keydown", (e) => {
    if (!modal || modal.style.display === "none") return;
    if (e.key === "Escape") {
      closeImageViewer();
    } else if (e.key === "ArrowLeft") {
      if (currentModalIndex > 0) openImageViewer(currentModalIndex - 1);
    } else if (e.key === "ArrowRight") {
      if (currentModalIndex < capturedPages.length - 1) openImageViewer(currentModalIndex + 1);
    }
  });

  setStatus("");
  showLoading(false);
}

document.addEventListener("DOMContentLoaded", init);
