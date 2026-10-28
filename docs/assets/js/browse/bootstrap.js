// 閲覧画面の共通要素とイベントを初期化する。後続ファイルから使う画面要素・状態もここで定義する。
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search');
const clearSearchButton = document.getElementById('clear-search');
const rowsElement = document.getElementById('rows');
const treeElement = document.getElementById('tree');
const summaryElement = document.getElementById('summary');
const modeDescription = document.getElementById('mode-description');
let renderTargetClassList = null;
let renderInstanceList = null;
let refreshListSortOptions = null;
let refreshBrowseListFilterSummary = null;
let treeStickyLayoutFrame = 0;
let browseStickyBoundsFrame = 0;

function setInlineStyleIfChanged(element, property, value) {
  if (element.style.getPropertyValue(property) === value) return;
  element.style.setProperty(property, value);
}

function scheduleBrowseTreeLayout() {
  if (treeStickyLayoutFrame) return;
  treeStickyLayoutFrame = requestAnimationFrame(() => {
    treeStickyLayoutFrame = 0;
    syncBrowseTreeStickyBounds();
    window.updateTreeStickyOffsets(treeElement);
    window.updateTreeTargetRowStarts(treeElement);
  });
}
function syncBrowseTreeStickyBounds() {
  const panel = document.getElementById('tree-panel');
  const controls = panel?.querySelector('.tree-controls');
  const filter = panel?.querySelector('.tree-filter');
  if (!panel || !controls) return;
  const controlsBounds = controls.getBoundingClientRect();
  setInlineStyleIfChanged(panel, '--browse-controls-sticky-top', `${controlsBounds.height}px`);
  const filterBounds = filter && !filter.hidden ? filter.getBoundingClientRect() : null;
  const filterGap = filter ? Number.parseFloat(getComputedStyle(filter).marginBottom) || 0 : 0;
  const headingTop = Math.max(controlsBounds.bottom, filterBounds ? filterBounds.bottom + filterGap : controlsBounds.bottom);
  setInlineStyleIfChanged(treeElement, '--browse-tree-heading-sticky-top', `${headingTop}px`);
}
function alignBrowseHeadingToStickyPosition(heading) {
  let attempts = 0;
  const adjust = () => {
    syncBrowseTreeStickyBounds();
    const targetTop = Number.parseFloat(getComputedStyle(heading).top) || 0;
    const difference = heading.getBoundingClientRect().top - targetTop;
    if (Math.abs(difference) <= 1 || attempts >= 3) return;
    attempts += 1;
    window.scrollBy(0, difference);
    window.requestAnimationFrame(adjust);
  };
  window.requestAnimationFrame(adjust);
}
function getBrowseStickyHeadersBottom(target) {
  const controls = document.querySelector('#tree-panel .tree-controls');
  const filter = document.querySelector('#tree-panel .tree-filter');
  const controlsHeight = controls?.getBoundingClientRect().height ?? 0;
  const filterHeight = filter && !filter.hidden ? filter.getBoundingClientRect().height : 0;
  const filterGap = filter ? Number.parseFloat(getComputedStyle(filter).marginBottom) || 0 : 0;
  const headingTop = controlsHeight + filterHeight + filterGap;
  let bottom = headingTop;
  const topClass = target.closest('.tree-top-class');
  const topSummary = topClass?.querySelector(':scope > summary');
  if (topSummary) bottom = Math.max(bottom, headingTop + topSummary.getBoundingClientRect().height);
  let middleClass = target.closest('.tree-middle-class');
  while (middleClass) {
    const summary = middleClass.querySelector(':scope > summary');
    const offset = Number.parseFloat(getComputedStyle(middleClass).getPropertyValue('--middle-sticky-top')) || 0;
    if (summary) bottom = Math.max(bottom, headingTop + offset + summary.getBoundingClientRect().height);
    middleClass = middleClass.parentElement?.closest('.tree-middle-class');
  }
  return bottom;
}

window.addEventListener('resize', scheduleBrowseTreeLayout);
window.addEventListener('scroll', () => {
  if (browseStickyBoundsFrame) return;
  browseStickyBoundsFrame = requestAnimationFrame(() => {
    browseStickyBoundsFrame = 0;
    syncBrowseTreeStickyBounds();
  });
}, { passive: true });

let pendingBrowseCloseDetails = null;
treeElement.addEventListener('click', (event) => {
  const summary = event.target.closest('summary');
  const details = summary?.parentElement;
  if (!details?.matches('.tree-top-class, .tree-middle-class') || !details.open) return;
  if (event.target.closest('button, input, select, textarea, a')) return;
  pendingBrowseCloseDetails = details;
}, true);

document.querySelector('[data-close-all-tree]')?.addEventListener('click', () => {
  treeElement.querySelectorAll('details[open]').forEach((details) => { details.open = false; });
});

const toggleBrowseIds = document.getElementById('toggle-browse-ids');
if (toggleBrowseIds) {
  toggleBrowseIds.addEventListener('click', () => {
    const visible = document.body.classList.toggle('browse-show-ids');
    toggleBrowseIds.setAttribute('aria-pressed', visible ? 'true' : 'false');
    toggleBrowseIds.textContent = `クラスID表示: ${visible ? 'ON' : 'OFF'}`;
  });
}

