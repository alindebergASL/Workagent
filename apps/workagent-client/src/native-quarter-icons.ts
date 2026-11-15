import { iconGroup, iconMap } from '@univerjs/preset-sheets-conditional-formatting';

// First-party 16px assets. Native IDs run full -> empty; OOXML runs low -> high.
// A white disc and dark sectors retain five distinct areas at the native 15px
// canvas size as well as the 20px picker size. No workbook-derived SVG or URLs.
const disc = '<circle cx="8" cy="8" r="6.5" fill="white"/>';
const outline = '<circle cx="8" cy="8" r="6.5" fill="none" stroke="#4b5563" stroke-width="1"/>';
export const quarterIconSources = [
  '<circle cx="8" cy="8" r="6.5" fill="#4b5563"/>',
  '<path d="M8 8 L8 1.5 A6.5 6.5 0 1 1 1.5 8 Z" fill="#4b5563"/>',
  '<path d="M8 8 L8 1.5 A6.5 6.5 0 0 1 8 14.5 Z" fill="#4b5563"/>',
  '<path d="M8 8 L8 1.5 A6.5 6.5 0 0 1 14.5 8 Z" fill="#4b5563"/>',
  '',
].map(sector => 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">${disc}${sector}${outline}</svg>`));
Object.freeze(quarterIconSources);

// Univer 1.4 freezes each original list, but exports mutable registry entries.
// Canvas _init and previews read iconMap; the native family picker reads
// iconGroup.list. Replace both references before createUniver builds renderers
// and image caches. Static, idempotent process setup; never per-workbook state.
export function installNativeQuarterIcons() {
  const group = iconGroup.flatMap(section => section.group).find(item => item.name === '5Quarters')!;
  iconMap['5Quarters'] = quarterIconSources;
  group.list = quarterIconSources;
}
