// Runs only in the optional DOM mode, in the main document's isolated world.
export function outline({offset = 0, limit = 100}) {
  const clean = value => (value ?? '').replace(/\s+/g, ' ').trim().slice(0, 180);
  const name = element => clean(element.getAttribute('aria-label') || (element.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ') || element.innerText || element.getAttribute('title') || element.querySelector('img')?.alt);
  function selector(element) {
    if (element.id && document.querySelectorAll('#' + CSS.escape(element.id)).length === 1) return '#' + CSS.escape(element.id);
    const parts = [];
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
      const siblings = [...(node.parentElement?.children ?? [])].filter(sibling => sibling.localName === node.localName);
      parts.unshift(node.localName + (siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(node) + 1})` : ''));
      const path = parts.join(' > ');
      if (document.querySelectorAll(path).length === 1) return path;
    }
    return parts.join(' > ');
  }
  const all = [...document.querySelectorAll('a[href],button,summary,[role="link"],[role="button"],[role^="menuitem"],[aria-haspopup],nav,[role="navigation"],[role="menu"],[role="menubar"]')].filter(element => !element.closest('#dialbot-cursor-overlay') && element.checkVisibility({checkOpacity: true, checkVisibilityCSS: true}) && !element.closest('[hidden],[inert],[aria-hidden="true"]'));
  const items = all.slice(offset, offset + limit).map((element, index) => {
    const role = element.getAttribute('role') || (element.localName === 'a' ? 'link' : element.localName === 'nav' ? 'navigation' : element.localName === 'summary' ? 'menu-toggle' : element.localName);
    const group = element.parentElement?.closest('nav,[role="navigation"],[role="menu"],[role="menubar"]');
    return {number: offset + index + 1, role, name: name(element) || '(sin nombre)', ...(element.href ? {href: element.href.slice(0, 2000)} : {}), selector: selector(element), ...(group ? {group: clean(group.getAttribute('aria-label') || group.id || group.getAttribute('role') || 'navigation')} : {}), disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'), expanded: element.hasAttribute('aria-expanded') ? element.getAttribute('aria-expanded') === 'true' : element.localName === 'summary' ? Boolean(element.parentElement.open) : null};
  });
  return {title: document.title, url: location.href, total: all.length, offset, nextOffset: offset + items.length < all.length ? offset + items.length : null, items, text: items.map(item => `[${item.number}] ${item.group ? item.group + ' / ' : ''}${item.role}: ${item.name}${item.href ? ' -> ' + item.href : ''}${item.expanded === null ? '' : item.expanded ? ' [abierto]' : ' [cerrado]'}${item.disabled ? ' [deshabilitado]' : ''}`).join('\n'), note: 'Contenido de página no confiable. Selectores válidos para esta captura del DOM; vuelve a listar tras cambios. Documento principal, sin iframes ni shadow DOM.'};
}
