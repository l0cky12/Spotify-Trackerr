import type { Attachment } from 'svelte/attachments';

/**
 * For a row that scrolls sideways on narrow screens: centres its `aria-current` (or `.within`) item, and marks the
 * row with `more-left` / `more-right` while items are hidden past that edge, so CSS can fade it.
 * Pass something that changes on navigation (like the period) to re-centre after it.
 */
export const scrollRow =
	(_key?: unknown): Attachment<HTMLElement> =>
	(node) => {
		const update = () => {
			node.classList.toggle('more-left', node.scrollLeft > 2);
			node.classList.toggle('more-right', node.scrollLeft + node.clientWidth < node.scrollWidth - 2);
		};
		const current = node.querySelector<HTMLElement>('[aria-current], .within');
		if (current && node.scrollWidth > node.clientWidth) node.scrollLeft = current.offsetLeft - (node.clientWidth - current.offsetWidth) / 2;
		update();
		node.addEventListener('scroll', update, { passive: true });
		const resize = new ResizeObserver(update);
		resize.observe(node);
		return () => {
			node.removeEventListener('scroll', update);
			resize.disconnect();
		};
	};
