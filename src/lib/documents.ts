export type BlockType = 'paragraph' | 'heading' | 'bullet' | 'checklist' | 'quote';
export interface DocumentBlock {
  id: string;
  type: BlockType;
  text: string;
  checked?: boolean;
}
export interface BlockDocument {
  schema: 'stmarys.blocks';
  version: 1;
  blocks: DocumentBlock[];
}
export interface DocumentRevision {
  version: number;
  title: string;
  category: string;
  content: string;
  updatedAt: string;
  updatedBy: string;
}
export const blockTypes: { value: BlockType; label: string }[] = [
  { value: 'paragraph', label: 'Paragraph' },
  { value: 'heading', label: 'Heading' },
  { value: 'bullet', label: 'Bullet point' },
  { value: 'checklist', label: 'Checklist item' },
  { value: 'quote', label: 'Quote' },
];
export const newBlock = (type: BlockType = 'paragraph', text = ''): DocumentBlock => ({
  id:
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `block-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`,
  type,
  text,
  ...(type === 'checklist' ? { checked: false } : {}),
});
export function decodeDocument(content: string): DocumentBlock[] {
  try {
    const parsed = JSON.parse(content) as BlockDocument;
    if (
      parsed.schema === 'stmarys.blocks' &&
      parsed.version === 1 &&
      Array.isArray(parsed.blocks) &&
      parsed.blocks.length <= 100 &&
      parsed.blocks.every(
        (block) =>
          block &&
          typeof block.id === 'string' &&
          typeof block.text === 'string' &&
          blockTypes.some((type) => type.value === block.type),
      )
    )
      return parsed.blocks.map((block) => ({
        id: block.id,
        type: block.type,
        text: block.text,
        ...(block.type === 'checklist' ? { checked: Boolean(block.checked) } : {}),
      }));
  } catch {
    /* Existing plain-text documents are retained as plain text. */
  }
  return [newBlock('paragraph', content)];
}
export function encodeDocument(blocks: DocumentBlock[]): string {
  return JSON.stringify({ schema: 'stmarys.blocks', version: 1, blocks } satisfies BlockDocument);
}
export function documentText(content: string): string {
  return decodeDocument(content)
    .map((block) => block.text)
    .join('\n');
}
