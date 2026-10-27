export interface TextSelection {
  start: number
  end: number
  text: string
}

export function textLengthBefore(root: HTMLElement, node: Node, offset: number): number {
  const prefix = document.createRange()
  prefix.selectNodeContents(root)
  try {
    prefix.setEnd(node, offset)
  } catch {
    return 0
  }
  return prefix.toString().length
}

export function readSelection(root: HTMLElement | null): TextSelection | null {
  if (!root) return null
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return null
  const text = range.toString()
  if (!text.trim()) return null
  const start = textLengthBefore(root, range.startContainer, range.startOffset)
  const end = textLengthBefore(root, range.endContainer, range.endOffset)
  if (end <= start) return null
  return { start, end, text }
}

export function rangeFromOffsets(
  root: HTMLElement,
  start: number,
  end: number,
): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let position = 0
  let startNode: Node | null = null
  let startOffset = 0
  let endNode: Node | null = null
  let endOffset = 0
  let node = walker.nextNode()
  while (node) {
    const length = node.textContent?.length ?? 0
    const nodeStart = position
    const nodeEnd = position + length
    if (!startNode && start >= nodeStart && start <= nodeEnd) {
      startNode = node
      startOffset = Math.min(length, start - nodeStart)
    }
    if (end >= nodeStart && end <= nodeEnd) {
      endNode = node
      endOffset = Math.min(length, end - nodeStart)
      break
    }
    position = nodeEnd
    node = walker.nextNode()
  }
  if (!startNode || !endNode) return null
  try {
    const range = document.createRange()
    range.setStart(startNode, startOffset)
    range.setEnd(endNode, endOffset)
    return range
  } catch {
    return null
  }
}

const HIGHLIGHT_NAMES: Record<string, string> = {
  '#f2b705': 'diary-ann-yellow',
  '#e05252': 'diary-ann-red',
  '#2e9b6b': 'diary-ann-green',
  '#4f7fd6': 'diary-ann-blue',
}

const ALL_HIGHLIGHTS = Object.values(HIGHLIGHT_NAMES)

export function applyTextHighlights(
  root: HTMLElement | null,
  annotations: Array<{
    color: string
    range: { start: number; end: number } | null
  }>,
): void {
  if (!root) return
  const css = CSS as unknown as {
    highlights?: {
      set: (name: string, value: unknown) => void
      delete: (name: string) => void
    }
  }
  type HighlightLike = { add: (range: Range) => void }
  const HighlightCtor = (window as unknown as { Highlight?: new () => HighlightLike }).Highlight
  if (!css.highlights || typeof HighlightCtor !== 'function') return
  for (const name of ALL_HIGHLIGHTS) css.highlights.delete(name)

  const groups = new Map<string, Range[]>()
  for (const annotation of annotations) {
    if (!annotation.range) continue
    const range = rangeFromOffsets(root, annotation.range.start, annotation.range.end)
    if (!range) continue
    const name = HIGHLIGHT_NAMES[annotation.color] ?? HIGHLIGHT_NAMES['#f2b705']
    const list = groups.get(name) ?? []
    list.push(range)
    groups.set(name, list)
  }
  for (const [name, ranges] of groups) {
    const highlight = new HighlightCtor()
    for (const range of ranges) highlight.add(range)
    css.highlights.set(name, highlight)
  }
}

export function clearTextHighlights(): void {
  const css = CSS as unknown as {
    highlights?: { delete: (name: string) => void }
  }
  if (!css.highlights) return
  for (const name of ALL_HIGHLIGHTS) css.highlights.delete(name)
}
