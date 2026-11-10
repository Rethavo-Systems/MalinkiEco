// Check live DOM state, including native dialogs which do not trigger an App render.
export function canReadVisibleContent(): boolean {
  return !document.hidden && document.hasFocus()
    && !document.querySelector('.settings-overlay, dialog[open], [role="dialog"][aria-modal="true"], .brand-avatar-menu')
}
